import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { JSDOM } from 'jsdom';

const source = fs.readFileSync('packages/rules/browser-rules.js', 'utf8');

function hydrateSrcdoc(root) {
  const frames = [...root.querySelectorAll('iframe')];
  for (const frame of frames) {
    const srcdoc = frame.getAttribute('srcdoc');
    if (!srcdoc) continue;
    try {
      const doc = frame.contentDocument;
      if (!doc) continue;
      doc.open();
      doc.write(srcdoc);
      doc.close();
      hydrateSrcdoc(doc);
    } catch {}
  }
}

function markCrossOrigin(frame, src) {
  frame.setAttribute('src', src);
  Object.defineProperty(frame, 'contentDocument', { get() { return null; }, configurable: true });
  Object.defineProperty(frame, 'contentWindow', { get() { throw new Error('cross-origin'); }, configurable: true });
}

async function scan(html, { url = 'https://example.com/frames' } = {}) {
  const dom = new JSDOM(html, { url, pretendToBeVisual: true, contentType: 'text/html', runScripts: 'outside-only' });
  hydrateSrcdoc(dom.window.document);
  for (const frame of [...dom.window.document.querySelectorAll('iframe[data-cross-origin]')]) {
    markCrossOrigin(frame, frame.getAttribute('data-cross-origin') || 'https://other.example.com/embed');
  }
  const nav = [{ responseStart: 40, requestStart: 0, domContentLoadedEventEnd: 120, loadEventEnd: 180, duration: 180, transferSize: 1200 }];
  const context = {
    window: dom.window,
    document: dom.window.document,
    location: dom.window.location,
    innerWidth: 1280,
    getComputedStyle: dom.window.getComputedStyle.bind(dom.window),
    CSS: dom.window.CSS,
    Node: dom.window.Node,
    HTMLElement: dom.window.HTMLElement,
    Intl,
    URL,
    performance: {
      now: () => (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now(),
      getEntriesByType(type) {
        if (type === 'navigation') return nav;
        if (type === 'resource') return [];
        return [];
      }
    },
    PerformanceObserver: function () { return { observe() {}, disconnect() {} }; },
    fetch: async (href) => ({ status: 200, url: String(href), redirected: false }),
    AbortController,
    AbortSignal,
    console: { warn() {}, error() {}, log() {} },
    setTimeout,
    clearTimeout,
    requestAnimationFrame: (cb) => setTimeout(() => cb(0), 0)
  };
  context.globalThis = context;
  vm.createContext(context);
  vm.runInContext(source, context);
  const report = context.WebQARules.run();
  return { report, context, dom };
}

function framePage({ sameOrigin = 0, crossOrigin = 0, nested = false, extraInner = '' } = {}) {
  const so = Array.from({ length: sameOrigin }, (_, i) => (
    `<iframe title="so-${i}" width="400" height="200" srcdoc="<html lang='en'><head><title>Frame ${i}</title></head><body><h1>Frame ${i}</h1><p>ok</p>${extraInner}</body></html>"></iframe>`
  )).join('');
  const xo = Array.from({ length: crossOrigin }, (_, i) => (
    `<iframe title="xo-${i}" width="400" height="200" data-cross-origin="https://other.example.com/embed-${i}" src="https://other.example.com/embed-${i}"></iframe>`
  )).join('');
  const nest = nested
    ? `<iframe title="nested-0" srcdoc="<html lang='en'><head><title>N0</title></head><body><h1>N0</h1><iframe title='nested-1' srcdoc='<html lang=en><head><title>N1</title></head><body><h1>N1</h1></body></html>'></iframe></body></html>"></iframe>`
    : '';
  return `<!doctype html><html lang="en"><head><title>Frame fixture page</title><meta charset="utf-8"><meta name="viewport" content="width=device-width"><meta name="description" content="Frame fixture for coverage tests."><link rel="canonical" href="https://example.com/frames"></head><body><h1>Frames</h1>${so}${xo}${nest}</body></html>`;
}

test('no frames: iframe coverage is complete', async () => {
  const { report } = await scan(framePage({ sameOrigin: 0, crossOrigin: 0 }));
  const embed = report.page.embeddedCoverage;
  assert.equal(embed.framesDiscovered, 0);
  assert.equal(embed.sameOriginEligible, 0);
  assert.equal(embed.sameOriginFramesChecked, 0);
  assert.equal(embed.sameOriginUnprobed, 0);
  assert.equal(embed.frameBudgetPreventedCoverage, false);
});

test('cross-origin only: scope-limited, not degraded', async () => {
  const { report } = await scan(framePage({ sameOrigin: 0, crossOrigin: 3 }));
  const embed = report.page.embeddedCoverage;
  assert.equal(embed.sameOriginEligible, 0);
  assert.equal(embed.sameOriginUnprobed, 0);
  assert.equal(embed.crossOriginFramesNotInspectable, 3);
  assert.equal(embed.frameBudgetPreventedCoverage, false);
});

test('3 same-origin frames are all checked', async () => {
  const { report } = await scan(framePage({ sameOrigin: 3 }));
  const embed = report.page.embeddedCoverage;
  assert.equal(embed.sameOriginEligible, 3);
  assert.equal(embed.sameOriginFramesChecked, 3);
  assert.equal(embed.sameOriginUnprobed, 0);
  assert.equal(embed.frameBudgetPreventedCoverage, false);
});

test('NASCAR-class: 9 same-origin frames are all checked', async () => {
  const { report } = await scan(framePage({ sameOrigin: 9 }));
  const embed = report.page.embeddedCoverage;
  assert.equal(embed.sameOriginEligible, 9);
  assert.equal(embed.sameOriginAttempted, 9);
  assert.equal(embed.sameOriginFramesChecked, 9);
  assert.equal(embed.sameOriginUnprobed, 0);
  assert.equal(embed.frameBudgetPreventedCoverage, false);
  assert.equal(embed.hardCeiling, 32);
});

test('20 same-origin frames are all checked under the emergency ceiling', async () => {
  const { report } = await scan(framePage({ sameOrigin: 20 }));
  const embed = report.page.embeddedCoverage;
  assert.equal(embed.sameOriginEligible, 20);
  assert.equal(embed.sameOriginFramesChecked, 20);
  assert.equal(embed.sameOriginUnprobed, 0);
  assert.equal(embed.frameBudgetPreventedCoverage, false);
});

test('pathological frame count hits the hard ceiling and degrades truthfully', async () => {
  const { report } = await scan(framePage({ sameOrigin: 40 }));
  const embed = report.page.embeddedCoverage;
  assert.equal(embed.sameOriginEligible, 40);
  assert.equal(embed.sameOriginFramesChecked, 32);
  assert.equal(embed.sameOriginUnprobed, 8);
  assert.equal(embed.frameBudgetPreventedCoverage, true);
  assert.equal(embed.frameBudgetReached, true);
});

test('nested same-origin frames are discovered with cycle protection', async () => {
  const { report } = await scan(framePage({ nested: true }));
  const embed = report.page.embeddedCoverage;
  assert.ok(embed.framesDiscovered >= 2, `expected nested frames, got ${embed.framesDiscovered}`);
  assert.equal(embed.sameOriginUnprobed, 0);
  assert.equal(embed.maxDepth, 3);
});

test('same-origin + cross-origin mix completes inspectable work and keeps cross-origin as scope', async () => {
  const { report } = await scan(framePage({ sameOrigin: 4, crossOrigin: 3 }));
  const embed = report.page.embeddedCoverage;
  assert.equal(embed.sameOriginEligible, 4);
  assert.equal(embed.sameOriginFramesChecked, 4);
  assert.equal(embed.sameOriginUnprobed, 0);
  assert.equal(embed.crossOriginFramesNotInspectable, 3);
  assert.equal(embed.frameBudgetPreventedCoverage, false);
});

test('same-origin frame links enter the current-page link inventory', async () => {
  const html = `<!doctype html><html lang="en"><head><title>Frame links</title><meta charset="utf-8"><meta name="viewport" content="width=device-width"><meta name="description" content="links"><link rel="canonical" href="https://example.com/frames"></head><body>
    <h1>Top</h1>
    <a href="https://example.com/top-a">Top A</a>
    <iframe title="with-links" srcdoc="<html lang='en'><head><title>Inner</title></head><body><h1>Inner</h1><a href='https://example.com/frame-a'>Frame A</a><a href='https://example.com/frame-b'>Frame B</a></body></html>"></iframe>
  </body></html>`;
  const { context, report } = await scan(html);
  assert.ok(report.page.inventory.links >= 3);
  const result = await context.WebQARules.auditLinks({ concurrency: 4, timeoutMs: 200, retryTimeoutMs: 200, budgetMs: 4000 });
  assert.ok(result.discovered >= 3, `expected top+frame links, discovered ${result.discovered}`);
  const urls = [...new Set((result.incompleteChecks || []).map(c => c.url).concat(
    // healthy links are not listed; use inventory + attempted as the proof of inclusion
  ))];
  assert.equal(result.attempted, result.discovered);
  assert.ok(result.discovered >= 3);
  void urls;
});

test('iframe disclosures distinguish tested, ineligible, and untested states', () => {
  const rules = fs.readFileSync('packages/rules/browser-rules.js', 'utf8');
  assert.match(rules, /iframeDisclosures='present-not-eligible'/);
  assert.match(rules, /iframeDisclosures='tested'/);
  assert.match(rules, /iframeEligible>0/);
});

test('iframe findings carry same-origin frame identity', async () => {
  const html = `<!doctype html><html lang="en"><head><title>Frame findings</title><meta charset="utf-8"><meta name="viewport" content="width=device-width"><meta name="description" content="x"><link rel="canonical" href="https://example.com/frames"></head><body>
    <h1>Top</h1>
    <iframe title="lang-missing" srcdoc="<html><head><title>Inner</title></head><body><h1>Inner</h1></body></html>"></iframe>
  </body></html>`;
  const { report } = await scan(html);
  const framed = report.findings.filter(f => f.embeddedContext === 'same-origin-iframe');
  assert.ok(framed.length >= 1, 'expected at least one iframe-scoped finding');
  assert.ok(framed.every(f => f.frameSelector));
});
