import { pathToFileURL } from 'node:url';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';
import { REPO_ROOT, EXTENSION_DIR, safeSiteName } from './lib/paths.mjs';
import { compactRunSummary, sanitizeUrl } from './lib/sanitize.mjs';
import { evaluateInvariants } from './lib/invariants.mjs';
import { frankCriticEvaluate } from './lib/frank-critic.mjs';
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

async function waitForServiceWorker(context, timeoutMs = 45000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const sw = context.serviceWorkers().find(w => w.url().startsWith('chrome-extension://'));
    if (sw) return sw;
    await new Promise(r => setTimeout(r, 250));
  }
  throw new Error('No extension service worker');
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
 * Dogfood one URL against the unpacked extension.
 * @param {object} opts
 * @param {string} opts.url
 * @param {string} opts.outDir
 * @param {boolean} [opts.sampleFrank]
 * @param {boolean} [opts.sampleHighlight]
 * @param {number} [opts.timeoutMs]
 */
export async function dogfoodUrl({
  url,
  outDir,
  sampleFrank = true,
  sampleHighlight = true,
  timeoutMs = 120000
} = {}) {
  fs.mkdirSync(outDir, { recursive: true });
  if (!fs.existsSync(path.join(EXTENSION_DIR, 'manifest.json'))) {
    throw new Error(`Missing extension at ${EXTENSION_DIR}; run npm run build:extension`);
  }

  const manifest = JSON.parse(fs.readFileSync(path.join(EXTENSION_DIR, 'manifest.json'), 'utf8'));
  const predictedId = computeExtensionId(manifest.key);
  const userDataDir = path.join(REPO_ROOT, '.autoqa', 'profiles', `dogfood-${process.pid}`);
  fs.mkdirSync(userDataDir, { recursive: true });

  const chromeCandidates = [
    process.env.CHROME_PATH,
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
    process.env.LOCALAPPDATA ? `${process.env.LOCALAPPDATA}/Google/Chrome/Application/chrome.exe` : ''
  ].filter(Boolean);
  const executablePath = process.env.WEBQA_AUTOQA_SYSTEM_CHROME === '1'
    ? chromeCandidates.find(p => fs.existsSync(p))
    : undefined;

  const extensionPath = EXTENSION_DIR.replace(/\\/g, '/');
  const context = await chromium.launchPersistentContext(userDataDir, {
    headless: false,
    executablePath,
    args: [
      `--disable-extensions-except=${extensionPath}`,
      `--load-extension=${extensionPath}`,
      '--enable-extensions',
      '--no-first-run',
      '--disable-default-apps'
    ],
    viewport: { width: 1280, height: 900 },
    ignoreDefaultArgs: ['--disable-extensions', '--enable-automation']
  });

  const started = Date.now();
  const site = safeSiteName(url);
  const siteDir = path.join(outDir, site);
  fs.mkdirSync(siteDir, { recursive: true });

  try {
    const boot = await context.newPage();
    await boot.goto(`chrome-extension://${predictedId}/sidepanel.html`, { waitUntil: 'domcontentloaded', timeout: 20000 }).catch(() => {});
    await boot.waitForTimeout(1000);
    const sw = await waitForServiceWorker(context, 45000);
    const extensionId = String(sw.url()).split('/')[2];

    const panel = context.pages().find(p => p.url().includes('sidepanel.html')) || await context.newPage();
    if (!panel.url().includes('sidepanel.html')) {
      await panel.goto(`chrome-extension://${extensionId}/sidepanel.html`, { waitUntil: 'domcontentloaded', timeout: 20000 });
    }

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
    fs.writeFileSync(path.join(siteDir, 'notes.md'), `# ${site}\n\nURL: ${sanitizeUrl(url) || url}\nScan duration: ${summary.scanDurationMs}ms\nInvariants: ${invariants.ok ? 'PASS' : 'FAIL'}\n`);

    return {
      ok: invariants.ok,
      summary,
      invariants,
      frankSample,
      highlightSample,
      siteDir,
      extensionId
    };
  } finally {
    await context.close().catch(() => {});
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
  console.log(JSON.stringify({ ok: result.ok, summary: result.summary, siteDir: result.siteDir }, null, 2));
  process.exit(result.ok ? 0 : 1);
}

if (import.meta.url === pathToFileURL(path.resolve(process.argv[1] || '')).href) {
  main().catch(err => {
    console.error(JSON.stringify({ ok: false, error: String(err?.stack || err) }));
    process.exit(1);
  });
}
