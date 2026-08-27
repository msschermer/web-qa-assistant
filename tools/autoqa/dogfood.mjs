import { pathToFileURL } from 'node:url';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import path from 'node:path';
import { chromium } from 'playwright';
import { REPO_ROOT, EXTENSION_DIR, safeSiteName } from './lib/paths.mjs';
import { compactRunSummary, sanitizeUrl } from './lib/sanitize.mjs';
import { evaluateInvariants } from './lib/invariants.mjs';
import { frankCriticEvaluate } from './lib/frank-critic.mjs';
import { isAuthorizedDogfoodUrl } from './lib/corpus.mjs';
import {
  ensureChromeReady,
  markChromeLaunchFailed,
  markChromeLaunchSucceeded,
  resolveSystemChrome
} from './lib/chrome.mjs';
import {
  ensureAutoqaChromeProfile,
  urlNeedsOptionalHostPermission,
  bootstrapRequiredMessage,
  writePermissionState,
  AUTOQA_CHROME_PROFILE_DIR
} from './lib/chrome-profile.mjs';
import { gracefulCloseChromeSession } from './lib/chrome-shutdown.mjs';
import {
  readExpectedExtensionId,
  profileHasDurableExtension,
  clearInstalledViaCdpFlag,
  persistUnpackedExtensionViaReload,
  ensureDeveloperMode
} from './lib/chrome-extension-persist.mjs';
import { buildBugReport } from '../../packages/support/bug-report.js';

function now() {
  return Date.now();
}

function getFreePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      server.close((err) => (err ? reject(err) : resolve(port)));
    });
    server.on('error', reject);
  });
}

function waitForDebugger(port, timeoutMs = 25000) {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    const tick = () => {
      const req = http.get({ host: '127.0.0.1', port, path: '/json/version', timeout: 1000 }, (res) => {
        let body = '';
        res.on('data', (chunk) => { body += chunk; });
        res.on('end', () => {
          try {
            resolve(JSON.parse(body));
          } catch (error) {
            reject(error);
          }
        });
      });
      req.on('error', () => {
        if (Date.now() - start > timeoutMs) reject(new Error(`Chrome remote debugging not ready on port ${port}`));
        else setTimeout(tick, 250);
      });
    };
    tick();
  });
}

async function waitForServiceWorker(context, extensionId, timeoutMs = 45000) {
  const start = Date.now();
  const want = `chrome-extension://${extensionId}/`;
  while (Date.now() - start < timeoutMs) {
    const sw = context.serviceWorkers().find(w => w.url().startsWith(want));
    if (sw) return sw;
    await new Promise(r => setTimeout(r, 250));
  }
  throw new Error(`No extension service worker for ${extensionId}`);
}

async function capture(page, filePath) {
  try {
    await page.screenshot({ path: filePath, fullPage: false });
    return filePath;
  } catch {
    return null;
  }
}

/**
 * Verify optional host permissions already granted in the persistent AutoQA profile.
 * Never prompts for host access here — one-time bootstrap owns that UX.
 */
async function verifyOptionalHostPermissions(panel, { required = false } = {}) {
  const snapshot = await panel.evaluate(async () => {
    try {
      const all = await chrome.permissions.getAll();
      const http = await chrome.permissions.contains({ origins: ['http://*/*'] });
      const https = await chrome.permissions.contains({ origins: ['https://*/*'] });
      return {
        ok: Boolean(http && https),
        http,
        https,
        origins: all?.origins || []
      };
    } catch (error) {
      return { ok: false, error: String(error?.message || error) };
    }
  });

  writePermissionState({
    optionalHttp: Boolean(snapshot.http),
    optionalHttps: Boolean(snapshot.https),
    lastVerifiedAt: new Date().toISOString(),
    lastError: snapshot.ok ? null : (snapshot.error || 'optional host permissions not granted')
  });

  if (required && !snapshot.ok) {
    throw new Error(bootstrapRequiredMessage());
  }
  return snapshot;
}

function extractLinkMetrics(report) {
  const audit = report?.linkAudit || {};
  const qm = audit.queueMetrics || report?.queueMetrics || {};
  const incomplete = audit.incompleteChecks || [];
  const countStatus = (re) => incomplete.filter(c => re.test(String(c.status || c.reason || ''))).length;
  return {
    discovered: audit.discovered ?? audit.eligible ?? null,
    eligible: audit.eligible,
    attempted: audit.attempted,
    healthy: audit.verifiedHealthy,
    broken: audit.confirmedIssues,
    inconclusive: audit.inconclusive,
    unprobed: audit.unprobed,
    scannerAborted: audit.scannerAborted,
    explicitlySkipped: audit.explicitlySkipped,
    cacheHits: audit.cacheHits ?? qm.cacheHits ?? null,
    cacheMisses: audit.cacheMisses ?? qm.cacheMisses ?? null,
    networkProbeCount: audit.networkProbeCount ?? qm.networkProbeCount ?? audit.attempted ?? null,
    primaryLinkMs: report?.scanTimings?.primaryLinkMs ?? null,
    refinementLinkMs: report?.scanTimings?.refinementLinkMs ?? null,
    peakTargetConcurrency: qm.targetConcurrency?.final ?? qm.peakTargetConcurrency ?? null,
    externalPeakConcurrency: qm.externalPeakConcurrency ?? null,
    count429: countStatus(/429/),
    count5xx: countStatus(/5\d\d|http-5/),
    timeoutCount: countStatus(/timeout/i),
    networkFailureCount: countStatus(/network|failed|abort/i),
    accountingOk: report?.coverage?.accountingOk !== false,
    queueTerminationReason: audit.queueTerminationReason || qm.terminationReason || null
  };
}

/**
 * Launch installed Google Chrome and load unpacked extension via CDP.
 * @param {string} userDataDir
 * @param {string} extensionAbsPath
 * @param {{ forceCdpLoad?: boolean }} [opts]
 */
async function launchChromeWithExtension(userDataDir, extensionAbsPath, opts = {}) {
  const chrome = ensureChromeReady();
  if (!chrome.ok) {
    throw new Error(
      chrome.lastError ||
      'Installed Google Chrome is not available for AutoQA. Install Google Chrome or set CHROME_PATH.'
    );
  }

  const resolved = resolveSystemChrome();
  const executablePath = resolved.executablePath || chrome.executablePath;
  if (!executablePath || !fs.existsSync(executablePath)) {
    markChromeLaunchFailed('Chrome executable missing');
    throw new Error(
      'Installed Google Chrome executable was not found. Install Google Chrome or set CHROME_PATH. Playwright bundled Chromium is not used.'
    );
  }

  const wall0 = now();
  const port = await getFreePort();
  const spawnAt = now();
  const absoluteProfile = path.resolve(userDataDir);
  const child = spawn(executablePath, [
    `--remote-debugging-port=${port}`,
    '--enable-unsafe-extension-debugging',
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-default-apps',
    `--user-data-dir=${absoluteProfile}`,
    'about:blank'
  ], {
    stdio: ['ignore', 'ignore', 'pipe'],
    windowsHide: false
  });

  let stderr = '';
  child.stderr?.on('data', (chunk) => { stderr += String(chunk); });

  const forceKillChild = async () => {
    if (!child.killed && child.exitCode === null) {
      try { child.kill(); } catch { /* ignore */ }
    }
  };

  try {
    const versionInfo = await waitForDebugger(port);
    const chromeLaunchMs = now() - spawnAt;
    const cdpAt = now();
    const browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
    const cdpConnectMs = now() - cdpAt;
    if (typeof browser.newBrowserCDPSession !== 'function') {
      throw new Error('Playwright newBrowserCDPSession is required to load extensions into Google Chrome');
    }

    const extensionAbs = path.resolve(extensionAbsPath);
    const expectedId = readExpectedExtensionId(extensionAbs);
    const durable = profileHasDurableExtension(absoluteProfile, expectedId, extensionAbs);
    const forceCdpLoad = Boolean(opts.forceCdpLoad);

    const extAt = now();
    let extensionId = expectedId;
    let launchMethod = 'profile-durable-unpacked';
    let loadedViaCdp = false;

    if (!durable || forceCdpLoad) {
      // CDP loadUnpacked is session-scoped on Chrome 151+ (INSTALLED_VIA_CDP).
      // Bootstrap converts it to a durable unpacked install after first grant.
      const browserSession = await browser.newBrowserCDPSession();
      const loaded = await browserSession.send('Extensions.loadUnpacked', {
        path: extensionAbs
      });
      extensionId = loaded?.id || expectedId;
      if (!extensionId) {
        throw new Error(`Extensions.loadUnpacked did not return an id: ${JSON.stringify(loaded)}`);
      }
      loadedViaCdp = true;
      launchMethod = 'cdp:Extensions.loadUnpacked';
      const bootPage = await (browser.contexts()[0] || await browser.newContext()).newPage();
      await ensureDeveloperMode(bootPage).catch(() => ({ ok: false }));
      await bootPage.close().catch(() => {});
    }

    const context = browser.contexts()[0] || await browser.newContext();
    const boot = await context.newPage();
    await boot.goto(`chrome-extension://${extensionId}/sidepanel.html`, { waitUntil: 'domcontentloaded', timeout: 20000 }).catch(() => {});
    await boot.waitForTimeout(500);
    await waitForServiceWorker(context, extensionId, 45000);
    const extensionLoadMs = now() - extAt;

    markChromeLaunchSucceeded({
      resolutionMethod: launchMethod,
      channel: null,
      executablePath,
      version: chrome.version || versionInfo?.Browser || null
    });

    const panel = context.pages().find(p => p.url().includes('sidepanel.html')) || boot;
    if (!panel.url().includes('sidepanel.html')) {
      await panel.goto(`chrome-extension://${extensionId}/sidepanel.html`, { waitUntil: 'domcontentloaded', timeout: 20000 });
    }
    // Never auto-request permissions here. Bootstrap is a separate one-time human step.
    const permissionSnapshot = await verifyOptionalHostPermissions(panel, { required: false });

    const session = {
      browser,
      context,
      panel,
      extensionId,
      child,
      port,
      versionInfo,
      chromeInfo: chrome,
      permissionSnapshot,
      profileDir: absoluteProfile,
      loadedViaCdp,
      durableInstall: durable && !forceCdpLoad,
      launch: {
        method: launchMethod,
        executablePath,
        port,
        browser: versionInfo?.Browser || 'chrome',
        profileDir: absoluteProfile,
        loadedViaCdp,
        durableInstall: durable && !forceCdpLoad
      },
      launchTimings: {
        chromeLaunchMs,
        cdpConnectMs,
        extensionLoadMs,
        sessionOpenMs: now() - wall0
      },
      lastShutdown: null,
      async close() {
        const diagnostics = await gracefulCloseChromeSession(session, { exitTimeoutMs: 5000 });
        session.lastShutdown = diagnostics;
        return diagnostics.totalShutdownMs;
      }
    };
    return session;
  } catch (error) {
    await forceKillChild();
    markChromeLaunchFailed(error?.message || error);
    throw new Error(
      `AutoQA could not launch installed Google Chrome with unpacked extension (${String(error?.message || error)}). ${stderr ? `stderr: ${stderr.slice(0, 300)}` : ''}`.trim()
    );
  }
}

/**
 * Scan one URL inside an already-open Chrome+extension session.
 */
export async function dogfoodUrlInSession(session, {
  url,
  outDir,
  sampleFrank = true,
  sampleHighlight = true,
  timeoutMs = 180000,
  requireCorpusAuthorization = true,
  pageSettleMs = 1500
} = {}) {
  const dogfoodWallStart = now();
  fs.mkdirSync(outDir, { recursive: true });
  if (requireCorpusAuthorization && !isAuthorizedDogfoodUrl(url)) {
    throw new Error(
      `URL is outside authorized AutoQA corpus (golden/rotating/adversarial/discoveries) and local fixture paths: ${url}`
    );
  }

  if (urlNeedsOptionalHostPermission(url)) {
    const snap = session.permissionSnapshot || await verifyOptionalHostPermissions(session.panel, { required: false });
    session.permissionSnapshot = snap;
    if (!snap.ok) {
      throw new Error(bootstrapRequiredMessage());
    }
  }

  const { context, panel, extensionId, launch: launchMeta, chromeInfo, launchTimings } = session;
  const manifest = JSON.parse(fs.readFileSync(path.join(EXTENSION_DIR, 'manifest.json'), 'utf8'));
  const site = safeSiteName(url);
  const siteDir = path.join(outDir, site);
  fs.mkdirSync(siteDir, { recursive: true });

  const timings = {
    chromeLaunchMs: launchTimings?.chromeLaunchMs ?? null,
    cdpConnectMs: launchTimings?.cdpConnectMs ?? null,
    extensionLoadMs: launchTimings?.extensionLoadMs ?? null,
    navigationMs: null,
    pageSettleMs: null,
    scanTotalMs: null,
    discoveryMs: null,
    axeMs: null,
    primaryLinkMs: null,
    refinementLinkMs: null,
    frameMs: null,
    interactionMs: null,
    performanceMs: null,
    correlationMs: null,
    frankMs: null,
    artifactCaptureMs: null,
    evaluationMs: null,
    cleanupMs: null,
    dogfoodWallMs: null,
    enrichMs: null
  };

  const page = await context.newPage();
  try {
    const navAt = now();
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: Math.min(45000, timeoutMs) });
    timings.navigationMs = now() - navAt;
    const settleAt = now();
    await page.waitForTimeout(pageSettleMs);
    timings.pageSettleMs = now() - settleAt;
    await capture(page, path.join(siteDir, 'page-before.png'));

    const tabs = await panel.evaluate(async () => {
      const list = await chrome.tabs.query({});
      return list.map(t => ({ id: t.id, url: t.url, active: t.active }));
    });
    const wantHost = (() => { try { return new URL(url).hostname; } catch { return ''; } })();
    const tab = tabs.find(t => (t.url || '').includes(wantHost)) || tabs.find(t => t.active);
    if (!tab?.id) throw new Error(`No matching tab for ${url}`);
    await panel.evaluate(async (tabId) => { await chrome.tabs.update(tabId, { active: true }); }, tab.id);

    const scanAt = now();
    const scan = await panel.evaluate(async (tabId) => chrome.runtime.sendMessage({ type: 'SCAN_TAB', tabId }), tab.id);
    if (!scan?.report) throw new Error(`SCAN_TAB failed: ${JSON.stringify(scan)?.slice(0, 400)}`);
    const enrichAt = now();
    const enriched = await panel.evaluate(async ({ tabId, report }) => {
      return chrome.runtime.sendMessage({ type: 'ENRICH', report, tabId });
    }, { tabId: tab.id, report: scan.report });
    timings.enrichMs = now() - enrichAt;
    timings.scanTotalMs = now() - scanAt;
    const report = enriched?.report || scan.report;

    const st = report.scanTimings || {};
    timings.discoveryMs = st.discoveryMs ?? null;
    timings.axeMs = st.axeMs ?? null;
    timings.primaryLinkMs = st.primaryLinkMs ?? null;
    timings.refinementLinkMs = st.refinementLinkMs ?? null;
    timings.frameMs = st.frameMs ?? st.iframeMs ?? null;
    timings.interactionMs = st.interactionMs ?? null;
    timings.performanceMs = st.performanceMs ?? null;
    timings.correlationMs = st.correlationMs ?? null;

    const artAt = now();
    await capture(page, path.join(siteDir, 'page-ready.png'));
    await capture(panel, path.join(siteDir, 'sidepanel.png'));

    let frankSample = null;
    let highlightSample = null;
    const findings = report.findings || [];
    const pick = findings.find(f => f.frankVisible !== false && f.targetId) || findings[0];

    if (sampleFrank && pick) {
      const frankAt = now();
      try {
        const frank = await panel.evaluate(async ({ tabId, finding, report }) => {
          return chrome.runtime.sendMessage({ type: 'PREPARE_FRANK', tabId, finding, report });
        }, { tabId: tab.id, finding: pick, report });
        frankSample = {
          ruleId: pick.ruleId,
          ok: Boolean(frank?.ok || frank?.plan),
          guidanceSource: frank?.plan?.guidanceSource || null,
          steps: (frank?.plan?.steps || []).map(s => ({
            id: s.id,
            type: s.type,
            headline: s.headline,
            body: String(s.body || '').slice(0, 800)
          })),
          plan: frank?.plan || null,
          reasoning: frank?.reasoning || null
        };
        await capture(panel, path.join(siteDir, 'frank-meaning.png'));
        const critic = frankCriticEvaluate({ finding: pick, frank: frankSample, report });
        fs.writeFileSync(path.join(siteDir, 'frank-critic.json'), `${JSON.stringify(critic, null, 2)}\n`);
      } catch (error) {
        frankSample = { ok: false, error: String(error?.message || error) };
      }
      timings.frankMs = now() - frankAt;
    } else {
      timings.frankMs = 0;
    }

    if (sampleHighlight && pick?.targetId) {
      try {
        const hl = await panel.evaluate(async ({ tabId, finding }) => {
          return chrome.runtime.sendMessage({
            type: 'HIGHLIGHT',
            tabId,
            targetId: finding.targetId,
            selector: finding.selector,
            ruleId: finding.ruleId
          });
        }, { tabId: tab.id, finding: pick });
        highlightSample = {
          ruleId: pick.ruleId,
          targetId: pick.targetId,
          claimedSuccess: hl?.ok !== false,
          raw: hl || null
        };
        await capture(page, path.join(siteDir, 'highlight.png'));
      } catch (error) {
        highlightSample = { claimedSuccess: false, error: String(error?.message || error) };
      }
    }
    timings.artifactCaptureMs = now() - artAt;

    const evalAt = now();
    const invariants = evaluateInvariants(report, {
      frankReview: report.frankReview,
      guidanceSource: report.guidanceSource,
      highlight: highlightSample
    });
    const diagnostic = buildBugReport({
      version: manifest.version,
      report,
      readiness: { status: report.frankReview?.modelReadiness || 'unknown' },
      includeContext: false,
      frank: frankSample?.plan ? { plan: frankSample.plan, finding: pick, reasoning: frankSample.reasoning } : null
    });
    fs.writeFileSync(path.join(siteDir, 'diagnostic.json'), `${JSON.stringify(diagnostic, null, 2)}\n`);
    const linkMetrics = extractLinkMetrics(report);
    timings.evaluationMs = now() - evalAt;
    timings.dogfoodWallMs = now() - dogfoodWallStart;

    const summary = compactRunSummary({
      url: sanitizeUrl(url) || url,
      browser: {
        name: 'chrome',
        launch: launchMeta,
        capability: {
          status: 'ready',
          resolutionMethod: 'cdp:Extensions.loadUnpacked',
          version: chromeInfo?.version || null
        }
      },
      scanCompleted: Boolean(report),
      scanDurationMs: timings.scanTotalMs,
      coverage: report.coverage,
      links: {
        eligible: linkMetrics.eligible,
        attempted: linkMetrics.attempted,
        unprobed: linkMetrics.unprobed,
        verifiedHealthy: linkMetrics.healthy,
        confirmedIssues: linkMetrics.broken,
        inconclusive: linkMetrics.inconclusive
      },
      frank: {
        modelReadiness: report.frankReview?.modelReadiness,
        reviewCompleted: report.frankReview?.completed === true,
        source: frankSample?.guidanceSource || report.guidanceSource || report.frankReview?.source
      },
      hardFailures: invariants.hardFailures,
      warnings: invariants.warnings,
      evaluation: { invariantsOk: invariants.ok, highlight: highlightSample, frankSampleOk: frankSample?.ok }
    });
    summary.timings = timings;
    summary.linkMetrics = linkMetrics;
    summary.scanTimings = report.scanTimings || null;

    fs.writeFileSync(path.join(siteDir, 'run-summary.json'), `${JSON.stringify(summary, null, 2)}\n`);
    fs.writeFileSync(path.join(siteDir, 'evaluation.json'), `${JSON.stringify({ invariants, frankSample, highlightSample, timings, linkMetrics }, null, 2)}\n`);
    fs.writeFileSync(path.join(siteDir, 'timings.json'), `${JSON.stringify(timings, null, 2)}\n`);
    fs.writeFileSync(path.join(siteDir, 'notes.md'), `# ${site}\n\nURL: ${sanitizeUrl(url) || url}\nBrowser: chrome\nScan total: ${timings.scanTotalMs}ms\nPrimary links: ${timings.primaryLinkMs}ms\nRefinement: ${timings.refinementLinkMs}ms\nWall (page): ${timings.dogfoodWallMs}ms\nInvariants: ${invariants.ok ? 'PASS' : 'FAIL'}\n`);

    return {
      ok: invariants.ok,
      summary,
      invariants,
      frankSample,
      highlightSample,
      siteDir,
      extensionId,
      browser: launchMeta,
      timings,
      linkMetrics,
      report
    };
  } finally {
    await page.close().catch(() => {});
  }
}

/**
 * Open a reusable Chrome+extension dogfood session on the dedicated AutoQA profile.
 */
export async function openDogfoodSession(opts = {}) {
  if (!fs.existsSync(path.join(EXTENSION_DIR, 'manifest.json'))) {
    throw new Error(`Missing extension at ${EXTENSION_DIR}; run npm run build:extension`);
  }
  const userDataDir = ensureAutoqaChromeProfile();
  return launchChromeWithExtension(userDataDir, EXTENSION_DIR, opts);
}

export async function closeDogfoodSession(session) {
  if (!session) return { totalShutdownMs: 0, skipped: true };
  const ms = await session.close();
  return { ...(session.lastShutdown || {}), totalShutdownMs: ms };
}

/**
 * Dogfood one URL against the unpacked extension in installed Google Chrome.
 */
export async function dogfoodUrl(opts = {}) {
  const session = await openDogfoodSession();
  try {
    const result = await dogfoodUrlInSession(session, opts);
    const shutdown = await closeDogfoodSession(session);
    const cleanupMs = Number(shutdown?.totalShutdownMs) || 0;
    if (result.timings) {
      result.timings.cleanupMs = cleanupMs;
      result.timings.shutdown = shutdown;
      result.timings.dogfoodWallMs = (result.timings.dogfoodWallMs || 0) + (session.launchTimings?.sessionOpenMs || 0) + cleanupMs;
      result.timings.profileDir = AUTOQA_CHROME_PROFILE_DIR;
      fs.writeFileSync(path.join(result.siteDir, 'timings.json'), `${JSON.stringify(result.timings, null, 2)}\n`);
      if (result.summary) {
        result.summary.timings = result.timings;
        fs.writeFileSync(path.join(result.siteDir, 'run-summary.json'), `${JSON.stringify(result.summary, null, 2)}\n`);
      }
    }
    return result;
  } catch (error) {
    await closeDogfoodSession(session);
    throw error;
  }
}

async function main() {
  const url = process.argv[2] || process.env.WEBQA_AUTOQA_URL;
  const outDir = process.argv[3] || path.join(REPO_ROOT, '.autoqa', 'runs', 'manual');
  if (!url) {
    console.error('Usage: node tools/autoqa/dogfood.mjs <url> [outDir]');
    process.exit(2);
  }
  const result = await dogfoodUrl({ url, outDir });
  console.log(JSON.stringify({
    ok: result.ok,
    summary: result.summary,
    timings: result.timings,
    linkMetrics: result.linkMetrics,
    siteDir: result.siteDir,
    browser: result.browser
  }, null, 2));
  process.exit(result.ok ? 0 : 1);
}

if (import.meta.url === pathToFileURL(path.resolve(process.argv[1] || '')).href) {
  main().catch(err => {
    console.error(JSON.stringify({ ok: false, error: String(err?.stack || err) }));
    process.exit(1);
  });
}
