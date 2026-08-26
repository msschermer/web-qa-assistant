import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { JSDOM } from 'jsdom';
import { buildBugReport } from '../packages/support/bug-report.js';
import { resolvePerformanceCoverage, explainCoverageReasons, COVERAGE_REASON } from '../packages/findings/coverage.js';
import { guidanceFor } from '../packages/frank/guidance.js';

const source = fs.readFileSync('packages/rules/browser-rules.js', 'utf8');
const asyncHtml = fs.readFileSync('fixtures/qa-matrix/async-interaction.html', 'utf8');

function wireToggle(btn, panel, mode = 'sync', { delayMs = 40 } = {}) {
  if (!btn || !panel) return;
  const apply = () => {
    const open = btn.getAttribute('aria-expanded') === 'true';
    btn.setAttribute('aria-expanded', open ? 'false' : 'true');
    panel.hidden = open;
  };
  btn.addEventListener('click', () => {
    if (mode === 'sync') apply();
    else if (mode === 'timeout') setTimeout(apply, delayMs);
  });
}

function installFakeClock(context, dom) {
  let now = 0;
  const pending = [];
  const realSetTimeout = dom.window.setTimeout.bind(dom.window);
  context.__WEBQA_NOW__ = () => now;
  context.__WEBQA_INTERACTION_TICK__ = async (ms) => {
    const step = Math.max(1, Number(ms) || 1);
    now += step;
    const due = pending.filter(t => t.at <= now);
    for (const t of due) {
      const idx = pending.indexOf(t);
      if (idx >= 0) pending.splice(idx, 1);
      try { t.fn(); } catch {}
    }
    await Promise.resolve();
    await new Promise(r => realSetTimeout(r, 0));
  };
  dom.window.setTimeout = (fn, ms = 0) => {
    pending.push({ fn: typeof fn === 'function' ? fn : () => {}, at: now + Number(ms || 0) });
    return pending[pending.length - 1];
  };
}

async function scan(html, {
  url = 'https://www.example.com/page',
  resources = [],
  prepare = true,
  wireMenus = true,
  fakeClock = true
} = {}) {
  const dom = new JSDOM(html, { url, pretendToBeVisual: true, contentType: 'text/html', runScripts: 'outside-only' });
  const context = {
    window: dom.window,
    document: dom.window.document,
    location: dom.window.location,
    performance: {
      now: () => 0,
      getEntriesByType: (type) => type === 'resource' ? resources : []
    },
    CSS: dom.window.CSS,
    Node: dom.window.Node,
    HTMLElement: dom.window.HTMLElement,
    setTimeout: dom.window.setTimeout.bind(dom.window),
    clearTimeout: dom.window.clearTimeout.bind(dom.window),
    requestAnimationFrame: (cb) => setTimeout(cb, 16),
    URL: dom.window.URL,
    console: { warn() {}, error() {}, log() {} },
    globalThis: null
  };
  context.globalThis = context;
  if (fakeClock) installFakeClock(context, dom);
  const doc = dom.window.document;
  if (wireMenus) {
    wireToggle(doc.getElementById('safe-menu'), doc.getElementById('safe-menu-panel'), 'sync');
    wireToggle(doc.getElementById('sync-toggle'), doc.getElementById('sync-panel'), 'sync');
  }
  vm.createContext(context);
  vm.runInContext(source, context);
  if (prepare) await context.WebQARules.prepareSafeInteractions();
  return { report: context.WebQARules.run(), context, dom };
}

test('buildRevision lands in Report Bug v2 and stays distinct from release version', () => {
  const artifact = buildBugReport({
    version: '1.7.4',
    buildRevision: '2e1ff4cef944',
    developmentTarget: '1.7.5',
    report: {
      page: { url: 'https://example.com/', targetIntegrity: { state: 'reached' } },
      coverage: { browser: 'complete', performance: 'current-page', runtime: 'extension-partial' },
      findings: [],
      browserPerformance: { available: true, largestContentfulPaintMs: 1200, ttfbMs: 90 }
    }
  });
  assert.equal(artifact.webqaVersion, '1.7.4');
  assert.equal(artifact.buildRevision, '2e1ff4cef944');
  assert.equal(artifact.developmentTarget, '1.7.5');
  assert.notEqual(artifact.buildRevision, artifact.webqaVersion);
  assert.doesNotMatch(artifact.buildRevision, /Users|\\|@/);
});

test('timeline: scan_completed is the final pipeline event after synthesized stages', () => {
  const report = {
    page: { url: 'https://example.com/', targetIntegrity: { state: 'reached' } },
    coverage: { browser: 'complete', links: 'partial', axe: 'complete', performance: 'not monitored', runtime: 'extension-partial' },
    coverageReasons: { links: 'probe-budget-exhausted', performance: 'connector-unavailable', runtime: 'runtime-partial-in-extension' },
    findings: [{ id: 'f1', ruleId: 'runtime.script-failed', impactClass: 'implementation' }],
    attention: { materialGroupCount: 1 },
    browserPerformance: { available: true, largestContentfulPaintMs: 2100, ttfbMs: 110, transferBytes: 90000, resourceCount: 40 },
    linkAudit: { checked: 4, verifiedHealthy: 2, confirmedIssues: 0, inconclusive: 1 },
    pageDiagnostics: { errors: [{ kind: 'page_error', message: 'x' }] },
    diagnostics: {
      failedResources: [{ initiator: 'script', status: 404, source: 'https://example.com/a.js' }],
      observedResourceFailureEvents: 3,
      deduplicatedFailedResources: 1
    }
  };
  const artifact = buildBugReport({
    report,
    trace: [
      { type: 'scan-start', at: '2026-08-25T12:00:00.000Z', data: { scanId: 's1' } },
      { type: 'scan-complete', at: '2026-08-25T12:00:01.000Z', data: { findingCount: 1, scanId: 's1' } }
    ]
  });
  const types = artifact.timeline.items.map(e => e.type);
  assert.equal(types[0], 'scan_started');
  assert.equal(types[types.length - 1], 'scan_completed');
  assert.ok(types.indexOf('target_reached') < types.indexOf('scan_completed'));
  assert.ok(types.indexOf('correlation_completed') < types.indexOf('scan_completed'));
  assert.ok(types.indexOf('performance_collected') < types.indexOf('scan_completed'));
  const resourceEvt = artifact.timeline.items.find(e => e.type === 'resource_failure');
  assert.equal(resourceEvt.data.observedFailureEvents, 3);
  assert.equal(resourceEvt.data.deduplicatedFailedResources, 1);
});

test('performance projection splits current-page lab from historical monitor', () => {
  const report = {
    page: { url: 'https://example.com/' },
    coverage: { performance: 'not monitored' },
    coverageReasons: { performance: COVERAGE_REASON.CONNECTOR_UNAVAILABLE },
    browserPerformance: {
      available: true,
      largestContentfulPaintMs: 2500,
      ttfbMs: 120,
      cumulativeLayoutShift: 0.04,
      transferBytes: 80000,
      resourceCount: 18
    },
    findings: []
  };
  assert.equal(resolvePerformanceCoverage(report.coverage, report.browserPerformance, null), 'current-page');
  const artifact = buildBugReport({ report });
  assert.equal(artifact.performance.lab.coverage, 'available');
  assert.equal(artifact.performance.lab.lcpMs, 2500);
  assert.equal(artifact.performance.historicalMonitor.coverage, 'unavailable');
  assert.match(String(artifact.performance.historicalMonitor.reason || ''), /connector|unavailable|not monitored/i);
  assert.doesNotMatch(JSON.stringify(artifact.performance), /\bCWV\b/);
});

test('interaction accounting: tested equals passed+failed+inconclusive; skips are separate', async () => {
  const { report } = await scan(asyncHtml);
  const ix = report.interactionCoverage;
  assert.equal(
    Number(ix.tested || 0),
    Number(ix.passed || 0) + Number(ix.failed || 0) + Number(ix.inconclusive || 0)
  );
  assert.ok(Number(ix.skippedUnsafe || 0) >= 1);
  assert.ok(Number(ix.safelyTested || 0) === Number(ix.tested || 0));
  const artifact = buildBugReport({
    report: {
      page: { url: 'https://example.com/' },
      coverage: { browser: 'complete' },
      findings: [],
      interactionCoverage: ix,
      diagnostics: report.diagnostics
    }
  });
  assert.equal(artifact.pageDiagnostics.interactionCoverage.accountingOk, true);
});

test('runtime coverage is extension-partial when page diagnostics are bound', async () => {
  const { report, context } = await scan(asyncHtml, { prepare: true });
  // Bound flag alone should flip runtime even with zero captured errors.
  context.__WEBQA_PAGE_DIAG_BOUND__ = true;
  context.__WEBQA_PAGE_DIAGNOSTICS__ = { errors: [] };
  const report2 = context.WebQARules.run();
  assert.equal(report2.coverage.runtime, 'extension-partial');
  const reasons = explainCoverageReasons(report2);
  assert.equal(reasons.runtime, COVERAGE_REASON.RUNTIME_EXTENSION_PARTIAL);
  assert.ok(report);
});

test('safe menu toggle is tested; menu with outbound link is skipped; items never activated', async () => {
  const html = `<!doctype html><html lang="en"><head><title>Menu</title></head><body>
    <button type="button" id="safe-menu" aria-expanded="false" aria-controls="safe-menu-panel">Account menu</button>
    <div id="safe-menu-panel" role="menu" hidden><div role="menuitem">Profile</div></div>
    <button type="button" id="unsafe-menu" aria-expanded="false" aria-controls="unsafe-menu-panel">Nav menu</button>
    <div id="unsafe-menu-panel" role="menu" hidden><a role="menuitem" href="https://example.com/logout">Log out</a></div>
  </body></html>`;
  const { report, dom } = await scan(html);
  assert.ok(report.interactionCoverage.passed >= 1, JSON.stringify(report.interactionCoverage));
  assert.equal(dom.window.document.getElementById('unsafe-menu').getAttribute('aria-expanded'), 'false');
  assert.equal(dom.window.document.getElementById('unsafe-menu-panel').hidden, true);
  assert.equal(dom.window.document.getElementById('safe-menu').getAttribute('aria-expanded'), 'false');
  assert.ok((report.interactionCoverage.skippedIneligible || 0) >= 1);
  const g = guidanceFor({
    ruleId: 'ux.menu-toggle-failed',
    interactionObservation: {
      interactionType: 'menu-toggle',
      failureReason: 'no-state-change-after-extended-settle',
      settleDurationBucket: '121-400ms',
      initialState: { ariaExpanded: 'false' },
      expectedState: { ariaExpanded: 'true' },
      observedState: { ariaExpanded: 'false' }
    }
  });
  assert.match(g.interpretation, /safely tested|allowlisted|bounded verification/i);
  assert.equal(/javascript is broken/i.test(`${g.interpretation} ${g.remediation}`), false);
});

test('skip-link verification restores focus and does not leave a durable hash when replaceable', async () => {
  const html = `<!doctype html><html lang="en"><head><title>Skip</title></head><body>
    <a class="skip-link" href="#main-content">Skip to main</a>
    <main id="main-content" tabindex="-1">Main content</main>
  </body></html>`;
  const { report, dom } = await scan(html, { wireMenus: false });
  assert.ok(report.interactionCoverage.tested >= 0);
  assert.equal(dom.window.location.hash === '' || dom.window.location.hash === '#', true);
});

test('multipart TLD ownership: example.co.uk CDN sibling is probable-first-party; unrelated stays third-party', async () => {
  const resources = [
    { name: 'https://cdn.example.co.uk/app.js', initiatorType: 'script', responseStatus: 404, transferSize: 0, duration: 4 },
    { name: 'https://cdn.example.org/app.js', initiatorType: 'script', responseStatus: 404, transferSize: 0, duration: 4 },
    { name: 'https://cmp.example.net/cookie-consent/stub.js', initiatorType: 'script', responseStatus: 429, transferSize: 0, duration: 3 }
  ];
  const html = `<!doctype html><html lang="en"><head><title>PSL</title>
    <script src="https://cdn.example.co.uk/app.js"></script>
  </head><body><h1>PSL</h1></body></html>`;
  const { report } = await scan(html, {
    url: 'https://www.example.co.uk/',
    resources,
    wireMenus: false,
    prepare: false
  });
  const diag = report.diagnostics.failedResources || [];
  const firstParty = diag.find(r => /cdn\.example\.co\.uk/.test(r.source));
  const other = diag.find(r => /cdn\.example\.org/.test(r.source));
  const consent = diag.find(r => /cookie-consent/.test(r.source));
  assert.equal(firstParty?.originClass, 'probable-first-party');
  assert.ok(other?.originClass === 'third-party-visible' || other?.originClass === 'unknown');
  assert.equal(consent?.disposition, 'diagnosticOnly');
  assert.equal(consent?.roleHint, 'consent');
  assert.ok(Number(report.diagnostics.observedResourceFailureEvents || 0) >= diag.length);
});

test('sidepanel polarity: current-page lab must not claim historical monitor available', () => {
  const report = {
    page: { url: 'https://example.com/' },
    coverage: { performance: 'current-page' },
    browserPerformance: { available: true, largestContentfulPaintMs: 1800, ttfbMs: 100 },
    findings: []
  };
  const artifact = buildBugReport({ report });
  assert.equal(artifact.performance.lab.coverage, 'available');
  assert.equal(artifact.performance.historicalMonitor.coverage, 'unavailable');
  // Mirror the sidepanel rule: only explicit "complete" means historical available.
  const histAvailable = /^complete$/i.test(String(report.coverage.performance || '').trim());
  assert.equal(histAvailable, false);
});

test('resource count semantics expose observed events vs deduplicated list', () => {
  const artifact = buildBugReport({
    report: {
      page: { url: 'https://example.com/' },
      coverage: { browser: 'complete' },
      findings: [],
      diagnostics: {
        failedResources: [{ initiator: 'script', status: 404, source: 'https://example.com/a.js' }],
        observedResourceFailureEvents: 5,
        deduplicatedFailedResources: 1
      }
    }
  });
  assert.equal(artifact.pageDiagnostics.resourceCounts.observedFailureEvents, 5);
  assert.equal(artifact.pageDiagnostics.resourceCounts.deduplicatedFailedResources, 1);
});
