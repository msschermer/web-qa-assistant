import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { JSDOM } from 'jsdom';
import { finalizeCorrelatedFindings, composeReportAttention } from '../packages/findings/correlate.js';
import { applyFindingPolicy } from '../packages/findings/policy.js';
import { guidanceFor } from '../packages/frank/guidance.js';
import { buildEvidenceGraph } from '../packages/frank/evidence.js';
import { deterministicFrankPlan, validateFrankPlan } from '../packages/frank/plan.js';

const source = fs.readFileSync('packages/rules/browser-rules.js', 'utf8');
const cleanHtml = fs.readFileSync('fixtures/qa-matrix/clean.html', 'utf8');
const problemsHtml = fs.readFileSync('fixtures/qa-matrix/problems.html', 'utf8');

const NEW_RULES = [
  'security.mixed-content',
  'security.mixed-content-passive',
  'web.stylesheet-failed',
  'runtime.script-failed',
  'runtime.uncaught-error',
  'ux.inert-link',
  'web.nested-form',
  'ux.form-no-submit',
  'ux.hidden-required',
  'ux.input-type-mismatch',
  'seo.hreflang-invalid',
  'seo.robots-googlebot-conflict',
  'web.horizontal-overflow',
  'correlation.viewport-overflow',
  'performance.browser.cls'
];

function scan(html, { url = 'https://example.com/page', resources = [], runtimeErrorCount = 0, innerWidth, overflowPx } = {}) {
  const dom = new JSDOM(html, { url, pretendToBeVisual: true, contentType: 'text/html' });
  if (Number.isFinite(innerWidth)) {
    Object.defineProperty(dom.window, 'innerWidth', { value: innerWidth, configurable: true });
  }
  if (Number.isFinite(overflowPx)) {
    const width = Number.isFinite(innerWidth) ? innerWidth : Number(dom.window.innerWidth) || 1024;
    const scrollWidth = width + overflowPx;
    Object.defineProperty(dom.window.document.documentElement, 'scrollWidth', { value: scrollWidth, configurable: true });
    if (dom.window.document.body) Object.defineProperty(dom.window.document.body, 'scrollWidth', { value: scrollWidth, configurable: true });
  }
  const nav = [{
    responseStart: 40, requestStart: 0, domContentLoadedEventEnd: 120, loadEventEnd: 180, duration: 180, transferSize: 1200
  }];
  const context = {
    window: dom.window,
    document: dom.window.document,
    location: dom.window.location,
    innerWidth: Number.isFinite(innerWidth) ? innerWidth : dom.window.innerWidth,
    getComputedStyle: dom.window.getComputedStyle.bind(dom.window),
    CSS: dom.window.CSS,
    Node: dom.window.Node,
    Intl,
    URL,
    performance: {
      getEntriesByType(type) {
        if (type === 'navigation') return nav;
        if (type === 'resource') return resources;
        if (type === 'paint') return [];
        return [];
      }
    },
    PerformanceObserver: function () { return { observe() {}, disconnect() {} }; },
    fetch: async () => ({ status: 200, url, redirected: false }),
    console
  };
  context.globalThis = context;
  vm.createContext(context);
  vm.runInContext(source, context);
  if (runtimeErrorCount) context.WebQARules.recordRuntimeErrors({ count: runtimeErrorCount });
  const report = context.WebQARules.run();
  return { report, rules: context.WebQARules, document: dom.window.document, context };
}

function pipeline(report) {
  const correlated = finalizeCorrelatedFindings(report.findings, report);
  const findings = applyFindingPolicy(correlated, { type: 'production' });
  const attention = composeReportAttention(findings);
  return { findings, attention };
}

function ids(findings) {
  return [...new Set(findings.map(f => f.ruleId))];
}

test('clean QA matrix fixture stays quiet for new rule families', () => {
  const { report } = scan(cleanHtml, { url: 'https://example.com/clean' });
  const { findings, attention } = pipeline(report);
  assert.equal(report.findings.length, 0);
  assert.equal(findings.length, 0);
  for (const rule of NEW_RULES) {
    assert.equal(findings.some(f => f.ruleId === rule), false, `clean page emitted ${rule}`);
  }
  assert.equal(attention.worthChecking.some(w => (w.findings || []).some(f => NEW_RULES.includes(f.ruleId))), false);
  const roIds = attention.groups.flatMap(g => [g.lead?.ruleId, ...(g.findings || []).map(f => f.ruleId)]);
  for (const rule of NEW_RULES) assert.equal(roIds.includes(rule), false);
});

test('problem matrix detects mixed content, forms, hreflang, overflow correlation, and inert links', () => {
  const { report } = scan(problemsHtml, { url: 'https://example.com/problems', innerWidth: 390, overflowPx: 1810 });
  const { findings, attention } = pipeline(report);
  const present = ids(findings);
  assert.ok(present.includes('security.mixed-content'));
  assert.ok(present.includes('security.mixed-content-passive'));
  assert.ok(present.includes('ux.inert-link'));
  assert.ok(present.includes('ux.form-no-submit'));
  assert.ok(present.includes('ux.hidden-required'));
  assert.ok(present.includes('ux.input-type-mismatch'));
  assert.ok(present.includes('seo.hreflang-invalid'));
  const hreflangRows = findings.filter(f => f.ruleId === 'seo.hreflang-invalid');
  assert.ok(hreflangRows.some(f => f.evidence === 'empty-href'));
  for (const row of hreflangRows) {
    assert.doesNotMatch(String(row.evidence || ''), /<link|javascript:/i);
    assert.doesNotMatch(String(row.detail || ''), /javascript:/i);
  }
  assert.ok(present.includes('seo.robots-googlebot-conflict'));
  assert.ok(present.includes('web.horizontal-overflow'));
  assert.ok(present.includes('correlation.viewport-overflow'));
  assert.ok(present.includes('web.duplicate-id'));
  assert.match(findings.find(f => f.ruleId === 'web.duplicate-id').detail, /label\[for\]/);

  const mixed = findings.find(f => f.ruleId === 'security.mixed-content');
  assert.equal(mixed.frankVisible, true);
  assert.doesNotMatch(JSON.stringify(mixed), /javascript:/i);

  const hidden = findings.find(f => f.ruleId === 'ux.hidden-required');
  assert.doesNotMatch(JSON.stringify(hidden), /value=/i);
  assert.equal(hidden.targetType, 'document');
  assert.equal(hidden.frankVisible, true);
  assert.match(hidden.detail, /not a confirmed submit blocker|typically ignores required/i);

  const inert = findings.find(f => f.ruleId === 'ux.inert-link');
  assert.equal(inert.frankVisible, false);
  assert.equal(inert.worthChecking, true);
  assert.ok(attention.worthChecking.some(w => (w.findings || []).some(f => f.ruleId === 'ux.inert-link')));

  const noSubmit = findings.find(f => f.ruleId === 'ux.form-no-submit');
  assert.equal(noSubmit.targetType, 'document');
  assert.equal(noSubmit.selector || '', '');
  assert.doesNotMatch(JSON.stringify(noSubmit), /value=/i);

  const googlebot = findings.find(f => f.ruleId === 'seo.robots-googlebot-conflict');
  assert.equal(googlebot.frankVisible, false);
  assert.equal(googlebot.worthChecking, true);

  const correlated = findings.find(f => f.ruleId === 'correlation.viewport-overflow');
  assert.equal(correlated.frankVisible, true);
  assert.equal(findings.find(f => f.ruleId === 'web.viewport-fixed').frankVisible, false);
  assert.equal(findings.find(f => f.ruleId === 'web.horizontal-overflow').frankVisible, false);
  assert.ok(attention.groups.some(g => g.lead?.ruleId === 'correlation.viewport-overflow' || (g.findings || []).some(f => f.ruleId === 'correlation.viewport-overflow')));
});

test('relative hreflang and x-default are not invalid', () => {
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Hreflang ok</title>
    <link rel="alternate" hreflang="x-default" href="https://example.com/">
    <link rel="alternate" hreflang="en" href="/en"></head><body><h1>Ok</h1></body></html>`;
  const { report } = scan(html);
  assert.equal(report.findings.some(f => f.ruleId === 'seo.hreflang-invalid'), false);
});

test('javascript:void with role=button is not an inert-link finding', () => {
  const html = `<!doctype html><html lang="en"><head><title>Menu</title></head><body>
    <a href="javascript:void(0)" role="button">Menu</a>
    <a href="javascript:void(0)" role="button menuitem">Also menu</a></body></html>`;
  const { report } = scan(html);
  assert.equal(report.findings.some(f => f.ruleId === 'ux.inert-link'), false);
});

test('form with any button is not form-no-submit', () => {
  const html = `<!doctype html><html lang="en"><head><title>Newsletter</title></head><body>
    <form action="https://example.com/subscribe" method="post">
      <input name="email" type="email">
      <input name="name" type="text">
      <button type="button">Subscribe</button>
    </form>
    <form action="https://example.com/alt" method="post">
      <input name="email" type="email">
      <input name="name" type="text">
      <input type="button" value="Subscribe">
    </form></body></html>`;
  const { report } = scan(html);
  assert.equal(report.findings.some(f => f.ruleId === 'ux.form-no-submit'), false);
});

test('nested forms are detected from the live DOM', () => {
  const { report, document, rules } = scan(`<!doctype html><html lang="en"><head><title>Forms</title></head><body></body></html>`);
  assert.equal(report.findings.some(f => f.ruleId === 'web.nested-form'), false);
  const outer = document.createElement('form');
  const inner = document.createElement('form');
  outer.appendChild(inner);
  document.body.appendChild(outer);
  const nested = rules.run();
  assert.equal(nested.findings.some(f => f.ruleId === 'web.nested-form'), true);
});

test('same-origin failed script uses responseStatus and does not use CORS-null stylesheets', () => {
  const html = `<!doctype html><html lang="en"><head><title>Assets</title>
    <script src="/app.js"></script>
    <link rel="stylesheet" href="https://fonts.example.com/css"></head><body><h1>Assets</h1></body></html>`;
  const { report } = scan(html, {
    resources: [
      { name: 'https://example.com/app.js', initiatorType: 'script', responseStatus: 404, decodedBodySize: 0, transferSize: 0 },
      { name: 'https://fonts.example.com/css', initiatorType: 'link', responseStatus: undefined, decodedBodySize: 0, transferSize: 0 }
    ]
  });
  assert.equal(report.findings.some(f => f.ruleId === 'runtime.script-failed'), true);
  assert.equal(report.findings.some(f => f.ruleId === 'web.stylesheet-failed'), false);
});

test('same-origin failed preload is not classified as a stylesheet', () => {
  const html = `<!doctype html><html lang="en"><head><title>Preload</title>
    <link rel="preload" href="/font.woff2" as="font">
    <link rel="stylesheet" href="/app.css"></head><body><h1>Preload</h1></body></html>`;
  const { report } = scan(html, {
    resources: [
      { name: 'https://example.com/font.woff2', initiatorType: 'link', responseStatus: 404, decodedBodySize: 0, transferSize: 0 },
      { name: 'https://example.com/icon.woff2', initiatorType: 'css', responseStatus: 404, decodedBodySize: 0, transferSize: 0 },
      { name: 'https://example.com/app.css', initiatorType: 'link', responseStatus: 404, decodedBodySize: 0, transferSize: 0 }
    ]
  });
  assert.equal(report.findings.some(f => f.ruleId === 'web.stylesheet-failed' && /font\.woff2/.test(f.evidence || '')), false);
  assert.equal(report.findings.some(f => f.ruleId === 'web.stylesheet-failed' && /icon\.woff2/.test(f.evidence || '')), false);
  assert.equal(report.findings.some(f => f.ruleId === 'web.stylesheet-failed' && /app\.css/.test(f.evidence || '')), true);
});

test('clipped carousel descendants do not count as document overflow', () => {
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Carousel</title>
    <meta name="description" content="Quiet carousel control."><link rel="canonical" href="https://example.com/carousel">
    </head><body><div style="overflow-x:auto;width:100%"><div style="width:2400px">track</div></div></body></html>`;
  const { report } = scan(html, { innerWidth: 390 });
  assert.equal(report.findings.some(f => f.ruleId === 'web.horizontal-overflow'), false);
  assert.equal(report.findings.some(f => f.ruleId === 'correlation.viewport-overflow'), false);
});

test('axe duplicate-id-aria is quieted when web.duplicate-id is visible', () => {
  const rows = applyFindingPolicy([
    { ruleId: 'web.duplicate-id', title: 'Duplicate element ID', detail: 'id dup', category: 'fix', severity: 'medium', confidence: 'confirmed' },
    { ruleId: 'axe.duplicate-id', title: 'IDs must be unique', detail: 'axe dup', category: 'fix', severity: 'high', confidence: 'confirmed', axe: { impact: 'serious' } },
    { ruleId: 'axe.duplicate-id-aria', title: 'ARIA IDs must be unique', detail: 'axe aria dup', category: 'fix', severity: 'high', confidence: 'confirmed', axe: { impact: 'serious' } }
  ], { type: 'production' });
  assert.equal(rows.find(f => f.ruleId === 'web.duplicate-id').frankVisible, true);
  assert.equal(rows.find(f => f.ruleId === 'axe.duplicate-id').frankVisible, false);
  assert.equal(rows.find(f => f.ruleId === 'axe.duplicate-id-aria').frankVisible, false);
});

test('extension scans mark runtime coverage as not applicable', () => {
  const { report } = scan(cleanHtml, { url: 'https://example.com/clean' });
  assert.equal(report.coverage.runtime, 'not applicable');
});

test('renderer uncaught errors are count-only Worth Checking findings', () => {
  const { report } = scan(cleanHtml, { url: 'https://example.com/clean', runtimeErrorCount: 2 });
  const { findings, attention } = pipeline(report);
  const row = findings.find(f => f.ruleId === 'runtime.uncaught-error');
  assert.ok(row);
  assert.equal(row.frankVisible, false);
  assert.equal(row.worthChecking, true);
  assert.match(row.evidence, /count=2/);
  assert.doesNotMatch(JSON.stringify(row), /sk-live|supersecret|token=/i);
  assert.ok(attention.worthChecking.some(w => (w.findings || []).some(f => f.ruleId === 'runtime.uncaught-error')));
});

test('1px overflow is ignored at desktop width', () => {
  const html = `<!doctype html><html lang="en"><head><meta name="viewport" content="width=device-width, initial-scale=1"><title>Almost</title></head>
    <body><div style="width:1025px">tiny</div></body></html>`;
  const { report } = scan(html, { innerWidth: 1024 });
  assert.equal(report.findings.some(f => f.ruleId === 'web.horizontal-overflow'), false);
});

test('Frank guidance for new families is specific and does not invent broken controls or field CWV', () => {
  const inert = guidanceFor({ ruleId: 'ux.inert-link', title: 'Link href does not declare a navigation destination' });
  assert.match(inert.interpretation, /not treating the control as broken|did not verify click/i);
  assert.doesNotMatch(`${inert.interpretation} ${inert.remediation}`, /cannot activate|cannot submit|is broken\b/i);
  assert.match(inert.remediation, /not treating this as a confirmed broken control/i);

  const form = guidanceFor({ ruleId: 'ux.form-no-submit', title: 'HTML form has an action but no submit control' });
  assert.match(form.interpretation, /not treated as a confirmed broken form/i);

  const cls = guidanceFor({ ruleId: 'performance.browser.cls', performanceObservation: { cumulativeLayoutShift: 0.31 } });
  assert.match(cls.interpretation, /lab observation/i);
  assert.match(cls.interpretation, /not a field score or Core Web Vitals result/i);
  assert.doesNotMatch(cls.remediation, /real users|hurts ranking|fails CWV/i);

  const overflow = guidanceFor({
    ruleId: 'correlation.viewport-overflow',
    overflowMetrics: { viewportWidth: 390, scrollWidth: 980, overflowPx: 590 }
  });
  assert.match(overflow.interpretation, /does not prove the viewport is the sole cause/i);
  assert.match(overflow.remediation, /Do not use overflow-x:hidden as the underlying fix/i);

  const err = guidanceFor({ ruleId: 'runtime.uncaught-error' });
  assert.match(err.interpretation, /untrusted runtime output/i);
  assert.doesNotMatch(err.remediation, /null check|add a try/);
  const errPlan = deterministicFrankPlan(buildEvidenceGraph({
    finding: { id: 'runtime.uncaught-error:1', ruleId: 'runtime.uncaught-error', title: 'Uncaught script error', detail: err.interpretation, category: 'review', severity: 'low', confidence: 'inferred', targetability: 'document', targetType: 'page' },
    page: { url: 'https://example.com/' }, coverage: { runtime: 'renderer' }
  }));
  assert.match(errPlan.assessment.limitations, /extension-partial/i);

  const hiddenGuide = guidanceFor({ ruleId: 'ux.hidden-required' });
  assert.doesNotMatch(hiddenGuide.impact, /can block form submission/i);
  assert.match(hiddenGuide.impact, /not a confirmed native submit blocker/i);

  const hreflangGuide = guidanceFor({ ruleId: 'seo.hreflang-invalid' });
  assert.match(hreflangGuide.remediation, /hreflang/i);
  assert.doesNotMatch(hreflangGuide.remediation, /html lang/i);

  const graph = buildEvidenceGraph({
    finding: {
      id: 'ux.inert-link:1', ruleId: 'ux.inert-link', title: 'Link href does not declare a navigation destination',
      detail: inert.interpretation, category: 'review', severity: 'low', confidence: 'inferred',
      targetability: 'spotlight', targetType: 'visual', count: 1, selector: 'a'
    },
    page: { url: 'https://example.com/' }, coverage: {}
  });
  const plan = deterministicFrankPlan(graph);
  assert.equal(validateFrankPlan(plan, graph), true);
  assert.equal(plan.assessment.status, 'review');
});

test('mixed-content evidence strips userinfo and ignores javascript: URLs', () => {
  const html = `<!doctype html><html lang="en"><head><title>Mixed</title>
    <script src="http://user:secret@cdn.example.com/widget.js"></script>
    <script src="javascript:alert(1)"></script>
    </head><body><h1>Mixed</h1></body></html>`;
  const { report } = scan(html, { url: 'https://example.com/mixed' });
  const mixed = report.findings.filter(f => f.ruleId === 'security.mixed-content');
  assert.ok(mixed.length);
  const blob = JSON.stringify(mixed);
  assert.doesNotMatch(blob, /user:secret/i);
  assert.doesNotMatch(blob, /javascript:/i);
});

test('hreflang unsupported-scheme evidence does not copy javascript: hrefs', () => {
  const html = `<!doctype html><html lang="en"><head><title>Lang</title>
    <link rel="alternate" hreflang="en" href="javascript:void(0)">
    <link rel="alternate" hreflang="!!!" href="javascript:alert(1)">
    <link rel="alternate" hreflang="de" href="http://["></head><body><h1>Lang</h1></body></html>`;
  const { report } = scan(html);
  const rows = report.findings.filter(f => f.ruleId === 'seo.hreflang-invalid');
  assert.ok(rows.length >= 3);
  const blob = JSON.stringify(rows);
  assert.doesNotMatch(blob, /javascript:void/i);
  assert.doesNotMatch(blob, /javascript:alert/i);
  assert.doesNotMatch(blob, /href=["']javascript/i);
  assert.doesNotMatch(blob, /http:\/\/\[/);
  assert.ok(rows.some(f => /scheme=/.test(f.evidence)));
  assert.ok(rows.some(f => /^lang=/.test(f.evidence)));
  assert.ok(rows.some(f => f.evidence === 'unparseable-href'));
});
