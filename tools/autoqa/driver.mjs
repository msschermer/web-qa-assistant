#!/usr/bin/env node
/**
 * Lumen (web-qa-assistant) run driver — agent-facing harness.
 *
 * Two things are hard to do by hand in this repo, and this script does both:
 *
 *  1. Drive a real site audit end-to-end through the gateway API (start it,
 *     poll it, read the findings back) instead of hand-rolling curl + node
 *     one-liners every time.
 *  2. Actually SEE the Chrome extension UI. The product surface is a
 *     content-script overlay + a side panel inside a Chrome extension, so
 *     nothing about it is visible from `npm test` or `curl`. This launches
 *     installed Chrome against the repo's dedicated AutoQA profile (which
 *     already has the unpacked extension durably installed) and screenshots
 *     the real thing.
 *
 * Browser/profile/extension-id resolution deliberately reuses the repo's own
 * tools/autoqa/lib helpers rather than hardcoding paths, so this keeps working
 * on another machine and stays honest about the profile's install state.
 *
 * Run from the repo root:  node tools/autoqa/driver.mjs <command>
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
// Two levels up from tools/autoqa. This harness is documented as mandatory in
// AGENTS.md and the README, so it lives in the tree beside the tools/autoqa/lib
// modules it depends on: anything a reader is told to run has to be in the
// clone, and for a while this was not.
const REPO = path.resolve(HERE, '../..');

const { resolveSystemChrome, chromeLaunchOptions } = await import(
  pathToImport('tools/autoqa/lib/chrome.mjs')
);
const { AUTOQA_CHROME_PROFILE_DIR, ensureAutoqaChromeProfile } = await import(
  pathToImport('tools/autoqa/lib/chrome-profile.mjs')
);
const { readExpectedExtensionId, profileHasDurableExtension, readProfileExtensionState } =
  await import(pathToImport('tools/autoqa/lib/chrome-extension-persist.mjs'));

function pathToImport(rel) {
  return new URL(`file:///${path.join(REPO, rel).replace(/\\/g, '/')}`).href;
}

const EXTENSION_DIR = path.join(REPO, 'dist', 'extension');
const SHOT_DIR = path.join(REPO, '.autoqa', 'runs', 'driver');
const API_BASE = process.env.WEBQA_API_BASE || 'http://localhost:3000';
const CONTENT_SCRIPT_FILES = [
  'vendor/axe.min.js',
  'image-purpose.js',
  'target-integrity.browser.js',
  'brief-phrasing.browser.js',
  'browser-rules.js',
  'content.js'
];

function log(...a) { console.log(...a); }
function die(msg) { console.error(`\nERROR: ${msg}\n`); process.exit(1); }
function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

function argOf(argv, flag, fallback = null) {
  const i = argv.indexOf(flag);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback;
}

// ---------------------------------------------------------------- gateway API

async function apiHealth() {
  try {
    const r = await fetch(`${API_BASE}/api/health`, { signal: AbortSignal.timeout(4000) });
    if (!r.ok) return null;
    return await r.json();
  } catch {
    return null;
  }
}

/**
 * Start services/api/server.js if it is not already answering. Returns a stop()
 * that is a no-op when we attached to an already-running server — the driver
 * must never kill a gateway somebody else started.
 */
async function ensureApi() {
  const existing = await apiHealth();
  if (existing) {
    log(`gateway: already running (${existing.service} ${existing.version})`);
    return { started: false, stop: async () => {} };
  }
  log('gateway: not running — starting services/api/server.js');
  const child = spawn(process.execPath, ['services/api/server.js'], {
    cwd: REPO,
    env: { ...process.env },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  child.stdout.on('data', (c) => process.stdout.write(`[api] ${c}`));
  child.stderr.on('data', (c) => process.stderr.write(`[api] ${c}`));

  const t0 = Date.now();
  while (Date.now() - t0 < 30000) {
    await sleep(400);
    if (await apiHealth()) {
      log(`gateway: up after ${Date.now() - t0}ms`);
      return {
        started: true,
        stop: async () => { try { child.kill(); } catch {} }
      };
    }
    if (child.exitCode !== null) die(`API server exited early with code ${child.exitCode}`);
  }
  try { child.kill(); } catch {}
  die('API server did not become healthy within 30s');
}

async function apiJson(pathname, init) {
  const r = await fetch(`${API_BASE}${pathname}`, {
    ...init,
    headers: { 'content-type': 'application/json', ...(init?.headers || {}) },
    signal: AbortSignal.timeout(30000)
  });
  const body = await r.json().catch(() => ({}));
  if (!r.ok || body.ok === false) {
    throw new Error(`${pathname} -> HTTP ${r.status} ${JSON.stringify(body).slice(0, 300)}`);
  }
  return body;
}

/**
 * Run one audit to completion.
 *
 * NOTE the request body shape: crawl options are FLAT top-level fields, not
 * nested under `config`. POST /api/audits reads them via planCrawlConfig(req.body),
 * so a nested {config:{maxPages:80}} is silently ignored and you get defaults.
 */
async function runAudit(startUrl, opts = {}) {
  const body = { startUrl, ...opts };
  const created = await apiJson('/api/audits', { method: 'POST', body: JSON.stringify(body) });
  const id = created.auditId;
  log(`audit: ${id}`);
  log(`config: ${JSON.stringify(created.config)}`);

  const t0 = Date.now();
  let audit;
  while (Date.now() - t0 < 15 * 60 * 1000) {
    const r = await apiJson(`/api/audits/${encodeURIComponent(id)}`);
    audit = r.audit;
    const done = ['complete', 'failed', 'cancelled'].includes(audit.status);
    log(`  ${audit.status}/${audit.phase} pages=${audit.stats?.pagesProcessed ?? 0} findings=${audit.findingsCount ?? 0}`);
    if (done) break;
    await sleep(4000);
  }
  return { id, audit };
}

function printFindingGroups(groups) {
  if (!groups?.length) { log('  (no findings)'); return; }
  const w = Math.max(...groups.map((g) => g.rule_id.length));
  log(`\n  ${'RULE'.padEnd(w)}  INST  URLS  CONF        SEV`);
  for (const g of [...groups].sort((a, b) => b.instances - a.instances)) {
    log(
      `  ${g.rule_id.padEnd(w)}  ${String(g.instances).padStart(4)}  ` +
      `${String(g.affected_urls).padStart(4)}  ${String(g.confidence || '').padEnd(11)} ${g.severity || ''}`
    );
  }
}

// ------------------------------------------------------------------- browser

function resolveExtensionId() {
  try {
    return readExpectedExtensionId(EXTENSION_DIR);
  } catch (error) {
    die(
      `Could not derive the extension id from ${EXTENSION_DIR}/manifest.json (${error.message}).\n` +
      'Run: npm run build:extension'
    );
  }
}

/**
 * Launch installed Chrome on the repo's dedicated AutoQA profile.
 *
 * The profile already carries a DURABLE unpacked install of dist/extension
 * (creation_flags without INSTALLED_VIA_CDP) plus granted optional host
 * permissions, so we deliberately do NOT pass --load-extension: re-installing
 * over CDP is what sets INSTALLED_VIA_CDP and makes Chrome wipe the grants on
 * next start. See tools/autoqa/lib/chrome-extension-persist.mjs.
 */
async function launchBrowser({ headless = false } = {}) {
  const { chromium } = await import(pathToImport('node_modules/playwright/index.mjs'))
    .catch(() => import('playwright'));

  if (!fs.existsSync(path.join(EXTENSION_DIR, 'manifest.json'))) {
    die(`No built extension at ${EXTENSION_DIR}. Run: npm run build:extension`);
  }
  const extensionId = resolveExtensionId();
  ensureAutoqaChromeProfile();

  const state = readProfileExtensionState(AUTOQA_CHROME_PROFILE_DIR, extensionId);
  const durable = profileHasDurableExtension(AUTOQA_CHROME_PROFILE_DIR, extensionId, EXTENSION_DIR);
  if (!durable) {
    die(
      `The AutoQA Chrome profile does not have a durable install of dist/extension.\n` +
      `  profile: ${AUTOQA_CHROME_PROFILE_DIR}\n` +
      `  state:   ${JSON.stringify(state)}\n` +
      'Bootstrap it once with: node tools/autoqa/chrome-profile-bootstrap.mjs'
    );
  }

  const resolved = resolveSystemChrome();
  const launchOpts = chromeLaunchOptions(resolved);
  log(`chrome: ${resolved.executablePath || resolved.channel} (${resolved.version || 'unknown'})`);
  log(`profile: ${AUTOQA_CHROME_PROFILE_DIR}`);
  log(`extension: ${extensionId}`);

  const context = await chromium.launchPersistentContext(AUTOQA_CHROME_PROFILE_DIR, {
    ...launchOpts,
    headless,
    viewport: null,
    args: [
      '--enable-extensions', '--no-first-run', '--no-default-browser-check', '--disable-default-apps',
      // The Site Audit overlay polls progress on a setTimeout loop. Chrome
      // throttles timers hard in occluded/background windows, and this window
      // is always behind the editor when an agent drives it — without these
      // the progress view sits frozen at "0 crawled / 0s elapsed" forever and
      // looks like the audit hung.
      '--disable-backgrounding-occluded-windows',
      '--disable-renderer-backgrounding',
      '--disable-background-timer-throttling'
    ],
    // Playwright ships --disable-extensions in its default args. Leave it in
    // and every chrome-extension:// URL dies with ERR_BLOCKED_BY_CLIENT and the
    // service worker never starts — which looks exactly like "the extension
    // isn't installed". Same removal tools/accept-dogfood/extension-accept.mjs makes.
    ignoreDefaultArgs: ['--disable-extensions', '--enable-automation']
  });

  const serviceWorker = await wakeServiceWorker(context, extensionId);
  return { context, extensionId, serviceWorker };
}

/**
 * An MV3 service worker is lazy: on a cold Chrome start nothing has woken it,
 * so context.serviceWorkers() stays empty forever and it looks like the
 * extension failed to install. Opening an extension page (the side panel) is
 * what actually starts it — same trick as
 * tools/autoqa/lib/chrome-extension-persist.mjs reattachExtensionSidePanel().
 */
async function wakeServiceWorker(context, extensionId) {
  const find = () => context.serviceWorkers().find((w) => w.url().includes(extensionId));
  if (find()) return find();

  const waker = await context.newPage();
  try {
    await waker.goto(`chrome-extension://${extensionId}/sidepanel.html`, {
      waitUntil: 'domcontentloaded',
      timeout: 20000
    });
  } catch { /* the panel page itself may be slow; the SW may still come up */ }

  const t0 = Date.now();
  while (!find() && Date.now() - t0 < 20000) await sleep(300);
  await waker.close().catch(() => {});
  return find() || null;
}

/** Inject the content-script bundle, matching background.js's ensureInjected order. */
async function ensureInjected(serviceWorker, tabId) {
  return serviceWorker.evaluate(async ({ tabId, files }) => {
    try {
      await chrome.tabs.sendMessage(tabId, { type: 'PING' });
      return { injected: false, reason: 'already present' };
    } catch {
      await chrome.scripting.executeScript({ target: { tabId }, files });
      return { injected: true };
    }
  }, { tabId, files: CONTENT_SCRIPT_FILES });
}

async function tabIdFor(serviceWorker, page) {
  const url = page.url();
  return serviceWorker.evaluate(async (url) => {
    const tabs = await chrome.tabs.query({});
    const hit = tabs.find((t) => t.url === url) || tabs.find((t) => (t.url || '').startsWith(url));
    return hit ? hit.id : null;
  }, url);
}

/**
 * Read the Site Audit overlay's own state. The overlay renders inside a shadow
 * root on a host element the content script appends, so ordinary page selectors
 * cannot see it — walk every element's shadowRoot to find it.
 */
async function overlayState(page) {
  return page.evaluate(() => {
    for (const el of document.querySelectorAll('*')) {
      const sr = el.shadowRoot;
      if (!sr || !sr.querySelector('.view')) continue;
      const active = [...sr.querySelectorAll('.view')].find((v) => v.classList.contains('active'));
      return {
        present: true,
        view: active ? [...active.classList].find((c) => c.startsWith('view-')) || 'unknown' : 'none',
        startUrl: sr.querySelector('.start-url')?.value || '',
        error: (sr.querySelector('.setup-error')?.textContent || '').slice(0, 200)
      };
    }
    return { present: false };
  }).catch(() => ({ present: false }));
}

function shotPath(name, override) {
  fs.mkdirSync(SHOT_DIR, { recursive: true });
  return override ? path.resolve(REPO, override) : path.join(SHOT_DIR, name);
}

// ------------------------------------------------------------------ commands

async function cmdHealth() {
  const api = await ensureApi();
  const h = await apiHealth();
  log(JSON.stringify(h, null, 2));
  await api.stop();
}

async function cmdAudit(argv) {
  const url = argv[0];
  if (!url || url.startsWith('--')) die('usage: driver.mjs audit <url> [--max-pages N] [--concurrency N]');
  const api = await ensureApi();
  try {
    const opts = {};
    const maxPages = argOf(argv, '--max-pages');
    const concurrency = argOf(argv, '--concurrency');
    const maxDepth = argOf(argv, '--max-depth');
    if (maxPages) opts.maxPages = Number(maxPages);
    if (concurrency) opts.concurrency = Number(concurrency);
    if (maxDepth) opts.maxDepth = Number(maxDepth);

    const { id, audit } = await runAudit(url, opts);
    log(`\nstatus: ${audit.status}  pages=${audit.stats?.pagesProcessed ?? 0}  findings=${audit.stats?.findingsTotal ?? 0}`);
    log(`links: ${JSON.stringify(audit.stats?.linkCounts || {})}`);
    const g = await apiJson(`/api/audits/${encodeURIComponent(id)}/findings?groupByRule=1`);
    printFindingGroups(g.groups);
    log(`\nCSV: ${API_BASE}/api/audits/${id}/export.csv?dataset=findings`);
  } finally {
    await api.stop();
  }
}

async function cmdUi(argv) {
  const target = argv.find((a) => !a.startsWith('--')) || 'https://example.com/';
  const out = argOf(argv, '--out');
  const api = await ensureApi();
  const { context, serviceWorker } = await launchBrowser();
  try {
    if (!serviceWorker) die('Extension service worker never appeared — is dist/extension installed in the profile?');

    const page = context.pages()[0] || (await context.newPage());
    await page.bringToFront().catch(() => {});
    log(`navigating: ${target}`);
    await page.goto(target, { waitUntil: 'domcontentloaded', timeout: 45000 });
    await page.waitForTimeout(1200);

    const tabId = await tabIdFor(serviceWorker, page);
    if (tabId == null) die('Could not resolve the Chrome tab id for the target page');
    log(`tab: ${tabId}`);
    log(`inject: ${JSON.stringify(await ensureInjected(serviceWorker, tabId))}`);

    await serviceWorker.evaluate(
      async ({ tabId, startUrl }) => chrome.tabs.sendMessage(tabId, { type: 'OPEN_SITE_AUDIT', startUrl }),
      { tabId, startUrl: target }
    );
    await page.waitForTimeout(1500);

    const setupShot = shotPath('site-audit-setup.png', out);
    await page.screenshot({ path: setupShot });
    log(`screenshot: ${setupShot}`);

    // Report the overlay's own view state so a caller can tell a real render
    // from a stuck one without opening the PNG.
    const state = await overlayState(page);
    log(`overlay state: ${JSON.stringify(state)}`);
  } finally {
    await context.close().catch(() => {});
    await api.stop();
  }
}

async function cmdPanel(argv) {
  const out = argOf(argv, '--out');
  const api = await ensureApi();
  const { context, extensionId } = await launchBrowser();
  try {
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/sidepanel.html`, {
      waitUntil: 'domcontentloaded',
      timeout: 30000
    });
    await page.setViewportSize({ width: 420, height: 900 });
    await page.waitForTimeout(2500);
    const p = shotPath('sidepanel.png', out);
    await page.screenshot({ path: p, fullPage: true });
    log(`screenshot: ${p}`);
  } finally {
    await context.close().catch(() => {});
    await api.stop();
  }
}

async function cmdWeb(argv) {
  const out = argOf(argv, '--out');
  const api = await ensureApi();
  const { chromium } = await import('playwright');
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    await page.goto(`${API_BASE}/`, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(1200);
    const p = shotPath('web-app.png', out);
    await page.screenshot({ path: p, fullPage: true });
    log(`screenshot: ${p}`);
  } finally {
    await browser.close().catch(() => {});
    await api.stop();
  }
}

// ---------------------------------------------------------------------- main

const [cmd, ...rest] = process.argv.slice(2);
const COMMANDS = { health: cmdHealth, audit: cmdAudit, ui: cmdUi, panel: cmdPanel, web: cmdWeb };

if (!cmd || !COMMANDS[cmd]) {
  console.log(`
Lumen run driver — run from the repo root.

  node tools/autoqa/driver.mjs <command>

  health                 Start the gateway if needed and print /api/health
  audit <url> [opts]     Run a full site audit through the API and print findings
                           --max-pages N  --concurrency N  --max-depth N
  ui <url>               Launch Chrome + extension, inject the content script,
                         open the Site Audit overlay and screenshot it
  panel                  Screenshot the extension side panel
  web                    Screenshot the local web app at ${API_BASE}/

  Screenshots land in .autoqa/runs/driver/ (gitignored). --out FILE overrides.
`);
  process.exit(cmd ? 1 : 0);
}

COMMANDS[cmd](rest).catch((error) => {
  console.error(`\nFAILED: ${error?.stack || error}\n`);
  process.exit(1);
});
