import { pathToFileURL } from 'node:url';
import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
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
import { buildBugReport } from '../../packages/support/bug-report.js';

function computeExtensionId(publicKeyBase64) {
  const der = Buffer.from(publicKeyBase64, 'base64');
  const hash = crypto.createHash('sha256').update(der).digest();
  let id = '';
  for (let i = 0; i < 16; i++) {
    id += String.fromCharCode(97 + (hash[i] >> 4));
    id += String.fromCharCode(97 + (hash[i] & 0xf));
  }
  return id;
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
 * Grant optional http(s) host permissions via a real click gesture in the side panel.
 * Required for public corpus origins; local 127.0.0.1/localhost fixtures are host_permissions.
 */
async function grantOptionalHostPermissions(panel) {
  const already = await panel.evaluate(async () => {
    try {
      const http = await chrome.permissions.contains({ origins: ['http://*/*'] });
      const https = await chrome.permissions.contains({ origins: ['https://*/*'] });
      return { http, https, ok: http && https };
    } catch (error) {
      return { ok: false, error: String(error?.message || error) };
    }
  });
  if (already.ok) return { ok: true, already: true };

  await panel.evaluate(() => {
    let btn = document.getElementById('autoqa-grant-hosts');
    if (!btn) {
      btn = document.createElement('button');
      btn.id = 'autoqa-grant-hosts';
      btn.textContent = 'AutoQA grant hosts';
      btn.style.cssText = 'position:fixed;left:0;top:0;z-index:99999;opacity:0.01;';
      document.body.appendChild(btn);
    }
    btn.onclick = () => {
      window.__autoqaGrantPromise = chrome.permissions.request({
        origins: ['http://*/*', 'https://*/*']
      });
    };
  });
  await panel.click('#autoqa-grant-hosts');
  const granted = await panel.evaluate(async () => {
    try {
      const ok = await window.__autoqaGrantPromise;
      const http = await chrome.permissions.contains({ origins: ['http://*/*'] });
      const https = await chrome.permissions.contains({ origins: ['https://*/*'] });
      return { ok: Boolean(ok) || (http && https), http, https };
    } catch (error) {
      return { ok: false, error: String(error?.message || error) };
    }
  });
  return granted;
}

/**
 * Launch installed Google Chrome, then load the unpacked extension via CDP.
 * Branded Chrome 137+ ignores --load-extension; --enable-unsafe-extension-debugging
 * + Extensions.loadUnpacked is the supported automation path.
 */
async function launchChromeWithExtension(userDataDir, extensionAbsPath) {
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

  const port = await getFreePort();
  const child = spawn(executablePath, [
    `--remote-debugging-port=${port}`,
    '--enable-unsafe-extension-debugging',
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-default-apps',
    `--user-data-dir=${userDataDir}`,
    'about:blank'
  ], {
    stdio: ['ignore', 'ignore', 'pipe'],
    windowsHide: false
  });

  let stderr = '';
  child.stderr?.on('data', (chunk) => { stderr += String(chunk); });

  const cleanupChild = async () => {
    if (!child.killed) {
      try { child.kill(); } catch { /* ignore */ }
    }
  };

  try {
    const versionInfo = await waitForDebugger(port);
    const browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
    if (typeof browser.newBrowserCDPSession !== 'function') {
      throw new Error('Playwright newBrowserCDPSession is required to load extensions into Google Chrome');
    }
    const browserSession = await browser.newBrowserCDPSession();
    const loaded = await browserSession.send('Extensions.loadUnpacked', {
      path: path.resolve(extensionAbsPath)
    });
    const extensionId = loaded?.id;
    if (!extensionId) {
      throw new Error(`Extensions.loadUnpacked did not return an id: ${JSON.stringify(loaded)}`);
    }

    const context = browser.contexts()[0] || await browser.newContext();
    markChromeLaunchSucceeded({
      resolutionMethod: 'cdp:Extensions.loadUnpacked',
      channel: null,
      executablePath,
      version: chrome.version || versionInfo?.Browser || null
    });

    return {
      browser,
      context,
      extensionId,
      child,
      port,
      versionInfo,
      launch: {
        method: 'cdp:Extensions.loadUnpacked',
        executablePath,
        port,
        browser: versionInfo?.Browser || 'chrome'
      },
      async close() {
        await browser.close().catch(() => {});
        await cleanupChild();
      }
    };
  } catch (error) {
    await cleanupChild();
    markChromeLaunchFailed(error?.message || error);
    throw new Error(
      `AutoQA could not launch installed Google Chrome with unpacked extension (${String(error?.message || error)}). ${stderr ? `stderr: ${stderr.slice(0, 300)}` : ''}`.trim()
    );
  }
}

/**
 * Dogfood one URL against the unpacked extension in installed Google Chrome.
 */
export async function dogfoodUrl({
  url,
  outDir,
  sampleFrank = true,
  sampleHighlight = true,
  timeoutMs = 120000,
  requireCorpusAuthorization = true
} = {}) {
  fs.mkdirSync(outDir, { recursive: true });
  if (!fs.existsSync(path.join(EXTENSION_DIR, 'manifest.json'))) {
    throw new Error(`Missing extension at ${EXTENSION_DIR}; run npm run build:extension`);
  }

  if (requireCorpusAuthorization && !isAuthorizedDogfoodUrl(url)) {
    throw new Error(
      `URL is outside authorized AutoQA corpus (golden/rotating/adversarial/discoveries) and local fixture paths: ${url}`
    );
  }

  const chrome = ensureChromeReady();
  if (!chrome.ok) {
    throw new Error(
      chrome.lastError ||
      'Installed Google Chrome is not available for AutoQA. Install Google Chrome or set CHROME_PATH.'
    );
  }

  const manifest = JSON.parse(fs.readFileSync(path.join(EXTENSION_DIR, 'manifest.json'), 'utf8'));
  const predictedId = computeExtensionId(manifest.key);
  const userDataDir = path.join(REPO_ROOT, '.autoqa', 'profiles', `dogfood-${process.pid}-${Date.now()}`);
  fs.mkdirSync(userDataDir, { recursive: true });

  const session = await launchChromeWithExtension(userDataDir, EXTENSION_DIR);
  const { context, launch: launchMeta } = session;
  const started = Date.now();
  const site = safeSiteName(url);
  const siteDir = path.join(outDir, site);
  fs.mkdirSync(siteDir, { recursive: true });

  try {
    const extensionId = session.extensionId || predictedId;
    const boot = await context.newPage();
    await boot.goto(`chrome-extension://${extensionId}/sidepanel.html`, { waitUntil: 'domcontentloaded', timeout: 20000 }).catch(() => {});
    await boot.waitForTimeout(1000);
    await waitForServiceWorker(context, extensionId, 45000);

    const panel = context.pages().find(p => p.url().includes('sidepanel.html')) || await context.newPage();
    if (!panel.url().includes('sidepanel.html')) {
      await panel.goto(`chrome-extension://${extensionId}/sidepanel.html`, { waitUntil: 'domcontentloaded', timeout: 20000 });
    }

    const permissionGrant = await grantOptionalHostPermissions(panel);

    const page = await context.newPage();
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: Math.min(45000, timeoutMs) });
    await capture(page, path.join(siteDir, 'page-before.png'));
    await page.waitForTimeout(1500);

    const tabs = await panel.evaluate(async () => {
      const list = await chrome.tabs.query({});
      return list.map(t => ({ id: t.id, url: t.url, active: t.active }));
    });
    const wantHost = (() => { try { return new URL(url).hostname; } catch { return ''; } })();
    const tab = tabs.find(t => (t.url || '').includes(wantHost)) || tabs.find(t => t.active);
    if (!tab?.id) throw new Error(`No matching tab for ${url}`);

    await panel.evaluate(async (tabId) => { await chrome.tabs.update(tabId, { active: true }); }, tab.id);

    const scan = await panel.evaluate(async (tabId) => chrome.runtime.sendMessage({ type: 'SCAN_TAB', tabId }), tab.id);
    if (!scan?.report) throw new Error(`SCAN_TAB failed: ${JSON.stringify(scan)?.slice(0, 400)}`);

    const enriched = await panel.evaluate(async ({ tabId, report }) => {
      return chrome.runtime.sendMessage({ type: 'ENRICH', report, tabId });
    }, { tabId: tab.id, report: scan.report });
    const report = enriched?.report || scan.report;

    await capture(page, path.join(siteDir, 'page-ready.png'));
    await capture(panel, path.join(siteDir, 'sidepanel.png'));

    let frankSample = null;
    let highlightSample = null;
    const findings = report.findings || [];
    const pick = findings.find(f => f.frankVisible !== false && f.targetId) || findings[0];

    if (sampleFrank && pick) {
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

    const summary = compactRunSummary({
      url: sanitizeUrl(url) || url,
      browser: {
        name: 'chrome',
        launch: launchMeta,
        capability: {
          status: 'ready',
          resolutionMethod: 'cdp:Extensions.loadUnpacked',
          version: chrome.version || null
        }
      },
      scanCompleted: Boolean(report),
      scanDurationMs: Date.now() - started,
      coverage: report.coverage,
      links: {
        eligible: report.linkAudit?.eligible,
        attempted: report.linkAudit?.attempted,
        unprobed: report.linkAudit?.unprobed,
        verifiedHealthy: report.linkAudit?.verifiedHealthy,
        confirmedIssues: report.linkAudit?.confirmedIssues,
        inconclusive: report.linkAudit?.inconclusive
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
    fs.writeFileSync(path.join(siteDir, 'run-summary.json'), `${JSON.stringify(summary, null, 2)}\n`);
    fs.writeFileSync(path.join(siteDir, 'evaluation.json'), `${JSON.stringify({ invariants, frankSample, highlightSample }, null, 2)}\n`);
    fs.writeFileSync(path.join(siteDir, 'notes.md'), `# ${site}\n\nURL: ${sanitizeUrl(url) || url}\nBrowser: chrome (${launchMeta?.method || 'unknown'})\nPermissions: ${permissionGrant?.ok ? 'ok' : 'limited'}\nScan duration: ${summary.scanDurationMs}ms\nInvariants: ${invariants.ok ? 'PASS' : 'FAIL'}\n`);

    return {
      ok: invariants.ok,
      summary,
      invariants,
      frankSample,
      highlightSample,
      siteDir,
      extensionId,
      browser: launchMeta,
      permissionGrant
    };
  } finally {
    await session.close().catch(() => {});
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
  console.log(JSON.stringify({ ok: result.ok, summary: result.summary, siteDir: result.siteDir, browser: result.browser }, null, 2));
  process.exit(result.ok ? 0 : 1);
}

if (import.meta.url === pathToFileURL(path.resolve(process.argv[1] || '')).href) {
  main().catch(err => {
    console.error(JSON.stringify({ ok: false, error: String(err?.stack || err) }));
    process.exit(1);
  });
}
