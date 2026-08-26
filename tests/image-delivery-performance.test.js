import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { JSDOM } from 'jsdom';
import { finalizeCorrelatedFindings } from '../packages/findings/correlate.js';
import { applyFindingPolicy } from '../packages/findings/policy.js';
import { composeAttention } from '../packages/findings/compose.js';
import { presentFinding } from '../packages/presentation/present.js';
import { guidanceFor } from '../packages/frank/guidance.js';
import { applyPerformanceCorrelations } from '../packages/findings/correlation.js';
import { limitedCoverageLabels, isStaleBuildRevision } from '../packages/findings/coverage.js';

const source = fs.readFileSync('packages/rules/browser-rules.js', 'utf8');

function scan(html, { url = 'https://www.example.com/perf', dpr = 1, resources = [], lcp = null } = {}) {
  const dom = new JSDOM(html, { url, pretendToBeVisual: true, contentType: 'text/html', runScripts: 'outside-only' });
  Object.defineProperty(dom.window, 'devicePixelRatio', { configurable: true, get: () => dpr });
  for (const img of dom.window.document.images) {
    const w = Number(img.getAttribute('data-natural-width') || 0);
    const h = Number(img.getAttribute('data-natural-height') || 0);
    if (w && h) {
      Object.defineProperty(img, 'naturalWidth', { configurable: true, get: () => w });
      Object.defineProperty(img, 'naturalHeight', { configurable: true, get: () => h });
      Object.defineProperty(img, 'complete', { configurable: true, get: () => true });
      Object.defineProperty(img, 'currentSrc', {
        configurable: true,
        get: () => img.getAttribute('data-current-src') || img.getAttribute('src') || ''
      });
      img.getBoundingClientRect = () => ({
        width: Number(img.getAttribute('data-css-width') || 100),
        height: Number(img.getAttribute('data-css-height') || 100),
        top: 0, left: 0, right: 0, bottom: 0, x: 0, y: 0, toJSON() { return {}; }
      });
      Object.defineProperty(img, 'clientWidth', {
        configurable: true,
        get: () => Number(img.getAttribute('data-css-width') || 100)
      });
      Object.defineProperty(img, 'clientHeight', {
        configurable: true,
        get: () => Number(img.getAttribute('data-css-height') || 100)
      });
    }
  }
  class FakePerformanceObserver {
    constructor(cb) { this.cb = cb; }
    observe() {
      if (!lcp) return;
      const el = typeof lcp.selector === 'string'
        ? dom.window.document.querySelector(lcp.selector)
        : lcp.element;
      const entry = {
        startTime: Number(lcp.startTime || 4500),
        size: Number(lcp.size || 120000),
        url: lcp.url || el?.currentSrc || el?.src || '',
        element: el || null
      };
      // Fire synchronously so buffered LCP is available before the sync scan run().
      try { this.cb({ getEntries: () => [entry] }); } catch {}
    }
    disconnect() {}
  }
  const context = {
    window: dom.window,
    document: dom.window.document,
    location: dom.window.location,
    performance: {
      now: () => 0,
      getEntriesByType: (type) => {
        if (type === 'navigation') return [{ responseStart: 120, requestStart: 0, domContentLoadedEventEnd: 400, loadEventEnd: 800, duration: 800, transferSize: 1000 }];
        if (type === 'resource') return resources;
        if (type === 'paint') return [{ name: 'first-contentful-paint', startTime: 300 }];
        return [];
      }
    },
    PerformanceObserver: FakePerformanceObserver,
    CSS: dom.window.CSS,
    Node: dom.window.Node,
    HTMLElement: dom.window.HTMLElement,
    setTimeout: dom.window.setTimeout.bind(dom.window),
    clearTimeout: dom.window.clearTimeout.bind(dom.window),
    devicePixelRatio: dpr,
    URL: dom.window.URL,
    console: { warn() {}, error() {}, log() {} },
    globalThis: null
  };
  context.globalThis = context;
  vm.createContext(context);
  vm.runInContext(source, context);
  return { report: context.WebQARules.run(), context, dom };
}

function oversized(report) {
  return (report.findings || []).filter(f => /image-oversized|lcp-image-oversized/.test(f.ruleId));
}

test('DPR 1 appropriately sized image stays quiet', () => {
  const html = `<!doctype html><html lang="en"><head><title>Ok</title></head><body>
    <img src="https://www.example.com/a.jpg" data-natural-width="400" data-natural-height="300" data-css-width="400" data-css-height="300" alt="">
  </body></html>`;
  const { report } = scan(html, { dpr: 1 });
  assert.equal(oversized(report).length, 0);
});

test('DPR 2 appropriately sized 2x asset stays quiet', () => {
  const html = `<!doctype html><html lang="en"><head><title>Ok</title></head><body>
    <img src="https://www.example.com/a@2x.jpg" data-natural-width="800" data-natural-height="600" data-css-width="400" data-css-height="300" alt="">
  </body></html>`;
  const { report } = scan(html, { dpr: 2 });
  assert.equal(oversized(report).length, 0);
});

test('genuinely oversized at DPR 1 emits confirmed meaningful finding', () => {
  const html = `<!doctype html><html lang="en"><head><title>Big</title></head><body>
    <img id="hero" src="https://www.example.com/huge.jpg" data-natural-width="1600" data-natural-height="1200" data-css-width="400" data-css-height="300" alt="">
  </body></html>`;
  const { report } = scan(html, { dpr: 1 });
  const rows = oversized(report);
  assert.ok(rows.length >= 1);
  const lead = rows[0];
  assert.equal(lead.confidence, 'confirmed');
  assert.equal(lead.imageMetrics.devicePixelRatio, 1);
  assert.equal(lead.imageMetrics.requiredPhysicalWidth, 400);
  assert.ok(lead.imageMetrics.magnitude === 'meaningful' || lead.imageMetrics.magnitude === 'severe');
  assert.match(lead.detail, /1600×1200|400×300|needed/i);
});

test('genuinely oversized at DPR 2 accounts for density need', () => {
  // 1600x1200 at CSS 400x300 with DPR 2 needs 800x600 → still 2x oversize each axis → meaningful
  const html = `<!doctype html><html lang="en"><head><title>Big2</title></head><body>
    <img src="https://www.example.com/huge.jpg" data-natural-width="1600" data-natural-height="1200" data-css-width="400" data-css-height="300" alt="">
  </body></html>`;
  const { report } = scan(html, { dpr: 2 });
  const lead = oversized(report)[0];
  assert.ok(lead);
  assert.equal(lead.imageMetrics.requiredPhysicalWidth, 800);
  assert.equal(lead.imageMetrics.requiredPhysicalHeight, 600);
  assert.ok(lead.imageMetrics.widthOversizeRatio >= 2);
});

test('mild excess is quieted outside Recommended Order', () => {
  // CSS 400, DPR1 need 400; intrinsic 600 → 1.5 ratio → mild
  const html = `<!doctype html><html lang="en"><head><title>Mild</title></head><body>
    <img src="https://www.example.com/mild.jpg" data-natural-width="600" data-natural-height="450" data-css-width="400" data-css-height="300" alt="">
  </body></html>`;
  const { report } = scan(html, { dpr: 1 });
  const raw = oversized(report);
  assert.ok(raw.length >= 1);
  assert.equal(raw[0].imageMetrics.magnitude, 'mild');
  const policed = applyFindingPolicy(finalizeCorrelatedFindings(report.findings, report), { type: 'production' });
  const mild = policed.find(f => f.ruleId === 'performance.browser.image-oversized');
  assert.equal(mild.frankVisible, false);
  const attention = composeAttention(policed);
  assert.equal(attention.groups.some(g => g.lead.ruleId === 'performance.browser.image-oversized' && g.lead.imageMetrics?.magnitude === 'mild'), false);
});

test('multiple oversized images group under one root cause; LCP twin stays separate', () => {
  const html = `<!doctype html><html lang="en"><head><title>Many</title></head><body>
    <img id="a" src="https://www.example.com/a.jpg" data-natural-width="1600" data-natural-height="1200" data-css-width="400" data-css-height="300" alt="">
    <img id="b" src="https://www.example.com/b.jpg" data-natural-width="1800" data-natural-height="1200" data-css-width="420" data-css-height="280" alt="">
    <img id="lcp" src="https://www.example.com/lcp.jpg" data-natural-width="2000" data-natural-height="1200" data-css-width="400" data-css-height="240" alt="">
  </body></html>`;
  const { report, context } = scan(html, { dpr: 1 });
  // Inject LCP element identity onto signals path by re-running with mocked LCP via page diagnostics is hard;
  // instead correlate after marking one finding as LCP via assess path: set lcp on performanceSignals through report mutation.
  report.browserPerformance = {
    available: true,
    largestContentfulPaintMs: 4500,
    lcpElement: {
      url: 'https://www.example.com/lcp.jpg',
      selector: '#lcp',
      intrinsic: { width: 2000, height: 1200 },
      rendered: { width: 400, height: 240 }
    }
  };
  // Force LCP oversize finding from a second scan that includes LCP marker by setting __ and re-running assess via findings.
  const lcpFinding = {
    id: 'performance.browser.lcp-image-oversized:test',
    ruleId: 'performance.browser.lcp-image-oversized',
    title: 'LCP image is substantially oversized',
    detail: 'test',
    category: 'review',
    severity: 'high',
    confidence: 'confirmed',
    resourceUrl: 'https://www.example.com/lcp.jpg',
    imageMetrics: {
      intrinsicWidth: 2000, intrinsicHeight: 1200, renderedWidth: 400, renderedHeight: 240,
      devicePixelRatio: 1, requiredPhysicalWidth: 400, requiredPhysicalHeight: 240,
      magnitude: 'severe', selectedSource: 'https://www.example.com/lcp.jpg', isLcpResource: true
    },
    rootCauseKey: 'lcp-resource:test',
    sources: ['browser'],
    count: 1
  };
  const withLcp = [...report.findings, lcpFinding];
  // Also add a generic twin for the same LCP URL to ensure quieting.
  withLcp.push({
    id: 'performance.browser.image-oversized:twin',
    ruleId: 'performance.browser.image-oversized',
    title: 'Image is substantially oversized for its display size',
    detail: 'twin',
    category: 'review',
    severity: 'medium',
    confidence: 'confirmed',
    resourceUrl: 'https://www.example.com/lcp.jpg',
    imageMetrics: { ...lcpFinding.imageMetrics, isLcpResource: true, magnitude: 'severe' },
    sources: ['browser'],
    count: 1
  });
  const correlated = applyPerformanceCorrelations(withLcp, {
    available: true,
    largestContentfulPaintMs: 4500,
    lcpElement: {
      url: 'https://www.example.com/lcp.jpg',
      selector: '#lcp',
      intrinsic: { width: 2000, height: 1200 },
      rendered: { width: 400, height: 240 }
    }
  });
  const twin = correlated.find(f => f.id === 'performance.browser.image-oversized:twin');
  assert.equal(twin.supersededBy, 'performance.browser.lcp-image-oversized');
  const policed = applyFindingPolicy(finalizeCorrelatedFindings(correlated, { ...report, findings: correlated, browserPerformance: report.browserPerformance }), { type: 'production' });
  const attention = composeAttention(policed);
  const oversizeGroup = attention.groups.find(g => g.key === 'images-oversized' || g.lead.rootCauseKey === 'images-oversized');
  const lcpGroup = attention.groups.find(g => /lcp-image-oversized|lcp-resource/.test(String(g.key || g.lead.ruleId || '')));
  assert.ok(oversizeGroup, 'expected grouped non-LCP oversized');
  assert.ok(oversizeGroup.size >= 2, `expected multiple instances, got ${oversizeGroup.size}`);
  assert.ok(lcpGroup, 'expected separate LCP oversized lead');
  assert.ok(context);
});

test('srcset selected currentSrc differs from src and drives oversize math', () => {
  const selected = 'https://www.example.com/hero-2400.jpg';
  const html = `<!doctype html><html lang="en"><head><title>Srcset</title></head><body>
    <img id="hero"
      src="https://www.example.com/hero-400.jpg"
      srcset="https://www.example.com/hero-400.jpg 400w, ${selected} 2400w"
      sizes="400px"
      data-current-src="${selected}"
      data-natural-width="2400" data-natural-height="1600"
      data-css-width="400" data-css-height="267" alt="">
  </body></html>`;
  const { report } = scan(html, { dpr: 1 });
  const lead = oversized(report)[0];
  assert.ok(lead, 'expected oversized finding for selected large candidate');
  assert.equal(lead.imageMetrics.selectedSource, selected);
  assert.equal(lead.imageMetrics.responsiveSourcePresent, true);
  assert.equal(lead.imageMetrics.intrinsicWidth, 2400);
  assert.match(lead.detail, /Responsive markup is present|selected candidate/i);
});

test('scanner emits lcp-image-oversized when LCP element matches oversized currentSrc', () => {
  const selected = 'https://www.example.com/lcp-selected.jpg';
  const html = `<!doctype html><html lang="en"><head><title>LCP</title></head><body>
    <img id="lcp" src="https://www.example.com/lcp-fallback.jpg" data-current-src="${selected}"
      data-natural-width="2000" data-natural-height="1200" data-css-width="400" data-css-height="240" alt="">
  </body></html>`;
  const { report } = scan(html, {
    dpr: 1,
    lcp: { selector: '#lcp', startTime: 4500, url: selected }
  });
  const lcpRows = (report.findings || []).filter(f => f.ruleId === 'performance.browser.lcp-image-oversized');
  assert.ok(lcpRows.length >= 1, `expected scanner-emitted LCP oversized, got ${(report.findings || []).map(f => f.ruleId).join(',')}`);
  assert.equal(lcpRows[0].imageMetrics.selectedSource, selected);
  assert.equal(lcpRows[0].imageMetrics.isLcpResource, true);
  assert.equal(lcpRows[0].confidence, 'confirmed');
});

test('selectedSource strips URL userinfo', () => {
  const html = `<!doctype html><html lang="en"><head><title>Cred</title></head><body>
    <img src="https://user:secret@www.example.com/huge.jpg" data-natural-width="1600" data-natural-height="1200" data-css-width="400" data-css-height="300" alt="">
  </body></html>`;
  const { report } = scan(html, { dpr: 1 });
  const lead = oversized(report)[0];
  assert.ok(lead);
  assert.equal(/user:secret@/i.test(String(lead.imageMetrics.selectedSource || '')), false);
  assert.match(lead.imageMetrics.selectedSource, /^https:\/\/www\.example\.com\/huge\.jpg/);
});

test('mild present/Frank copy does not say substantially oversized', () => {
  const finding = {
    ruleId: 'performance.browser.image-oversized',
    imageMetrics: {
      intrinsicWidth: 600, intrinsicHeight: 450, renderedWidth: 400, renderedHeight: 300,
      devicePixelRatio: 1, requiredPhysicalWidth: 400, requiredPhysicalHeight: 300,
      magnitude: 'mild', selectedSource: 'https://www.example.com/mild.jpg'
    }
  };
  const card = presentFinding(finding);
  assert.match(card.title, /mildly larger/i);
  assert.equal(/substantially oversized/i.test(card.title), false);
  const g = guidanceFor(finding);
  assert.match(g.interpretation, /mildly larger/i);
  assert.equal(/substantially more image data/i.test(g.interpretation), false);
});

test('card and Frank explain measured DPR evidence without Smush-first or unsupported slow-site claim', () => {
  const finding = {
    ruleId: 'performance.browser.image-oversized',
    title: 'Image is substantially oversized for its display size',
    detail: 'x',
    confidence: 'confirmed',
    imageMetrics: {
      intrinsicWidth: 1600, intrinsicHeight: 900, renderedWidth: 360, renderedHeight: 203,
      devicePixelRatio: 2, requiredPhysicalWidth: 720, requiredPhysicalHeight: 406,
      transferBytes: 412000, responsiveSourcePresent: true, selectedSource: 'https://www.example.com/a.jpg',
      magnitude: 'meaningful', isLcpResource: false
    }
  };
  const card = presentFinding(finding, { type: 'production' });
  assert.match(card.summary, /1600×900|360×203|720×406|2×|412 KB/i);
  assert.equal(/Performance needs review/i.test(card.title), false);
  const g = guidanceFor(finding, { type: 'production' });
  assert.match(g.interpretation, /WebQA flagged|1600×900|2×|720×406/i);
  assert.equal(/install smush|slowing the site/i.test(`${g.interpretation} ${g.remediation} ${g.recommendation}`), false);
  assert.match(g.remediation || '', /selected candidate|sizes|srcset/i);
});

test('LCP Frank path explains LCP significance with dimensions', () => {
  const g = guidanceFor({
    ruleId: 'performance.browser.lcp-image-oversized',
    imageMetrics: {
      intrinsicWidth: 2000, intrinsicHeight: 1200, renderedWidth: 400, renderedHeight: 240,
      devicePixelRatio: 2, requiredPhysicalWidth: 800, requiredPhysicalHeight: 480,
      transferBytes: 380000, responsiveSourcePresent: false, selectedSource: 'https://www.example.com/lcp.jpg',
      magnitude: 'severe', isLcpResource: true
    },
    performanceObservation: { largestContentfulPaintMs: 4800 }
  });
  assert.match(g.interpretation, /LCP image|2000×1200|2×|800×480|4\.8s/i);
  assert.match(g.impact, /LCP|higher performance value/i);
  assert.equal(/install smush/i.test(`${g.remediation}`), false);
});

test('hydration: mismatched or missing buildRevision is treated as stale', () => {
  const current = 'abcdef123456';
  assert.equal(isStaleBuildRevision(current, 'oldrev000001'), true);
  assert.equal(isStaleBuildRevision(current, ''), true);
  assert.equal(isStaleBuildRevision(current, current), false);
  assert.equal(isStaleBuildRevision('', 'oldrev000001'), false);
});

test('coverage banner labels prefer historical performance wording over raw unavailable keys', () => {
  const labels = limitedCoverageLabels({
    coverageReasons: {
      performance: 'lab-partial',
      links: 'probe-budget-exhausted',
      published: 'enrichment-failed'
    },
    coverage: {
      browser: 'complete',
      links: 'partial',
      axe: 'complete',
      performance: 'partial',
      runtime: 'complete',
      published: 'unavailable'
    },
    coverageScope: { runtime: 'post-injection-extension' },
    linkAudit: {
      discovered: 10,
      eligible: 10,
      attempted: 4,
      checked: 4,
      verifiedHealthy: 4,
      confirmedIssues: 0,
      inconclusive: 0,
      unprobed: 6,
      explicitlySkipped: 0
    }
  });
  assert.ok(labels.some(l => /checked 4 of 10 eligible links/i.test(l)));
  assert.ok(labels.includes('current-page performance partial'));
  assert.ok(labels.includes('published-state unavailable'));
  // Expected runtime scope must not appear in the degraded banner.
  assert.equal(labels.some(l => /runtime/i.test(l)), false);
  assert.equal(labels.some(l => l === 'performance' || /^performance$/i.test(l)), false);
  assert.equal(labels.some(l => /not monitored/i.test(l)), false);
});
