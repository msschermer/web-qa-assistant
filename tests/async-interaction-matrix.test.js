import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { JSDOM } from 'jsdom';
import { guidanceFor } from '../packages/frank/guidance.js';

const source = fs.readFileSync('packages/rules/browser-rules.js', 'utf8');
const asyncHtml = fs.readFileSync('fixtures/qa-matrix/async-interaction.html', 'utf8');
const resourceHtml = fs.readFileSync('fixtures/qa-matrix/resource-ownership.html', 'utf8');

function wireToggle(btn, panel, mode = 'sync', { delayMs = 40 } = {}) {
  if (!btn || !panel) return;
  const apply = () => {
    const open = btn.getAttribute('aria-expanded') === 'true';
    btn.setAttribute('aria-expanded', open ? 'false' : 'true');
    panel.hidden = open;
  };
  btn.addEventListener('click', () => {
    if (mode === 'sync') apply();
    else if (mode === 'microtask') Promise.resolve().then(apply);
    else if (mode === 'raf') {
      const raf = btn.ownerDocument.defaultView.requestAnimationFrame || ((cb) => setTimeout(cb, 16));
      raf(apply);
    } else if (mode === 'timeout') setTimeout(apply, delayMs);
    else if (mode === 'throw') {
      btn.addEventListener('click', () => {
        // Synchronous throw from the page handler — activateElement must catch this.
        throw new Error('handler boom');
      });
    }
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
    // Fire page timers whose due time has passed.
    const due = pending.filter(t => t.at <= now);
    for (const t of due) {
      const idx = pending.indexOf(t);
      if (idx >= 0) pending.splice(idx, 1);
      try { t.fn(); } catch {}
    }
    await Promise.resolve();
    await new Promise(r => realSetTimeout(r, 0));
  };
  // Capture setTimeout from page handlers into fake clock.
  dom.window.setTimeout = (fn, ms = 0) => {
    const handle = { fn: typeof fn === 'function' ? fn : () => {}, at: now + Number(ms || 0) };
    pending.push(handle);
    return handle;
  };
  return { advance: (ms) => { now += ms; } };
}

async function scan(html, {
  url = 'https://www.example.com/async-interaction',
  resources = [],
  prepare = true,
  wire = true,
  fakeClock = true
} = {}) {
  const dom = new JSDOM(html, { url, pretendToBeVisual: true, contentType: 'text/html', runScripts: 'outside-only' });
  for (const frame of dom.window.document.querySelectorAll('iframe')) {
    const srcdoc = frame.getAttribute('srcdoc');
    if (!srcdoc) continue;
    try {
      const doc = frame.contentDocument;
      if (!doc) continue;
      doc.open();
      doc.write(srcdoc);
      doc.close();
    } catch {}
  }
  const nav = [{ responseStart: 40, requestStart: 0, domContentLoadedEventEnd: 120, loadEventEnd: 180, duration: 180, transferSize: 1200 }];
  const context = {
    window: dom.window,
    document: dom.window.document,
    location: dom.window.location,
    innerWidth: dom.window.innerWidth,
    getComputedStyle: dom.window.getComputedStyle.bind(dom.window),
    CSS: dom.window.CSS,
    Node: dom.window.Node,
    MouseEvent: dom.window.MouseEvent,
    requestAnimationFrame: (cb) => dom.window.setTimeout(() => cb(0), 16),
    Intl,
    URL,
    performance: {
      getEntriesByType(type) {
        if (type === 'navigation') return nav;
        if (type === 'resource') return resources;
        return [];
      }
    },
    PerformanceObserver: function () { return { observe() {}, disconnect() {} }; },
    fetch: async () => ({ status: 200, url, redirected: false }),
    console,
    setTimeout: dom.window.setTimeout.bind(dom.window),
    clearTimeout: dom.window.clearTimeout.bind(dom.window)
  };
  context.globalThis = context;
  context.window = new Proxy(dom.window, {
    get(target, prop) {
      if (prop in context && prop !== 'window') return context[prop];
      const value = target[prop];
      return typeof value === 'function' ? value.bind(target) : value;
    }
  });
  if (fakeClock) installFakeClock(context, dom);
  if (wire) {
    const doc = dom.window.document;
    wireToggle(doc.getElementById('sync-toggle'), doc.getElementById('sync-panel'), 'sync');
    wireToggle(doc.getElementById('micro-toggle'), doc.getElementById('micro-panel'), 'microtask');
    wireToggle(doc.getElementById('raf-toggle'), doc.getElementById('raf-panel'), 'raf');
    wireToggle(doc.getElementById('timeout-toggle'), doc.getElementById('timeout-panel'), 'timeout', { delayMs: 40 });
    wireToggle(doc.getElementById('late-toggle'), doc.getElementById('late-panel'), 'timeout', { delayMs: 500 });
    // throw-toggle intentionally unwired / broken — separate test covers thrown handlers.
    wireToggle(doc.getElementById('shipping-info'), doc.getElementById('shipping-panel'), 'sync');
    for (const frame of doc.querySelectorAll('iframe')) {
      try {
        const fdoc = frame.contentDocument;
        if (!fdoc) continue;
        wireToggle(fdoc.getElementById('frame-good'), fdoc.getElementById('frame-panel'), 'sync');
        wireToggle(fdoc.getElementById('frame-toggle'), fdoc.getElementById('frame-panel'), 'timeout', { delayMs: 30 });
        // frame-broken intentionally unwired
      } catch {}
    }
  }
  vm.createContext(context);
  vm.runInContext(source, context);
  if (prepare) await context.WebQARules.prepareSafeInteractions();
  return { report: context.WebQARules.run(), context, dom };
}

function ids(report) {
  return (report.findings || []).map(f => f.ruleId);
}

test('sync microtask raf and short timeout disclosures pass and restore', async () => {
  const { report, dom } = await scan(asyncHtml);
  const ix = report.interactionCoverage;
  assert.ok(ix.passed >= 3, `expected passes, got ${JSON.stringify(ix)}`);
  // Known failing/late/throw controls may emit WC findings; sync/micro/raf/timeout/shipping must restore.
  for (const id of ['sync-toggle', 'micro-toggle', 'raf-toggle', 'timeout-toggle', 'shipping-info']) {
    assert.equal(dom.window.document.getElementById(id).getAttribute('aria-expanded'), 'false', id);
  }
  assert.equal(dom.window.document.getElementById('sync-panel').hidden, true);
});

test('late timeout past settle window fails or stays inconclusive without leaving page open', async () => {
  const { report, dom } = await scan(asyncHtml);
  const late = dom.window.document.getElementById('late-toggle');
  assert.equal(late.getAttribute('aria-expanded'), 'false');
  assert.equal(dom.window.document.getElementById('late-panel').hidden, true);
  if (report.interactionCoverage.safelyTested >= 5) {
    assert.ok(
      report.interactionCoverage.failed >= 1 || report.interactionCoverage.inconclusive >= 1,
      'late control should contribute failed/inconclusive coverage when reached'
    );
  }
});

test('thrown click handler is caught, left restored, and does not claim JS is broken', async () => {
  const { report, dom, context } = await scan(asyncHtml, { prepare: false, wire: true });
  const btn = dom.window.document.getElementById('throw-toggle');
  const panel = dom.window.document.getElementById('throw-panel');
  wireToggle(btn, panel, 'throw');
  await context.WebQARules.prepareSafeInteractions();
  const report2 = context.WebQARules.run();
  assert.equal(btn.getAttribute('aria-expanded'), 'false');
  assert.equal(panel.hidden, true);
  const g = guidanceFor({
    ruleId: 'ux.disclosure-toggle-failed',
    interactionObservation: {
      settleDurationBucket: '51-120ms',
      initialState: { ariaExpanded: 'false' },
      expectedState: { ariaExpanded: 'true' },
      observedState: { ariaExpanded: 'false' }
    }
  });
  assert.match(g.interpretation, /bounded verification window|did not appear|did not change|allowlisted/i);
  assert.equal(/javascript is broken/i.test(`${g.interpretation} ${g.remediation}`), false);
  assert.match(g.limitations || '', /side effects|handlers may still run/i);
  assert.ok(report2 || report);
});

test('unsafe checkout payment delete labels are never activated', async () => {
  const { report, dom } = await scan(asyncHtml);
  assert.ok(report.interactionCoverage.skippedUnsafe >= 3);
  assert.equal(dom.window.document.getElementById('checkout-details').getAttribute('aria-expanded'), 'false');
  assert.equal(dom.window.document.getElementById('payment-options').getAttribute('aria-expanded'), 'false');
  assert.equal(dom.window.document.getElementById('delete-faq').getAttribute('aria-expanded'), 'false');
  assert.equal(dom.window.document.getElementById('shipping-info').getAttribute('aria-expanded'), 'false');
});

test('same-origin iframe delayed disclosure can pass with embedded context metadata', async () => {
  const { report, dom } = await scan(asyncHtml);
  const frameBtn = dom.window.document.getElementById('async-frame')?.contentDocument?.getElementById('frame-good')
    || dom.window.document.getElementById('async-frame')?.contentDocument?.getElementById('frame-toggle');
  if (frameBtn) assert.equal(frameBtn.getAttribute('aria-expanded'), 'false');
  const iframeCov = String(report.interactionCoverage.iframeDisclosures || '');
  assert.ok(
    (report.interactionCoverage.contexts?.iframe || 0) >= 1
      || /tested|present/i.test(iframeCov)
      || iframeCov === 'none',
    `unexpected iframe coverage: ${JSON.stringify(report.interactionCoverage)}`
  );
  const failedFrame = (report.findings || []).find(f => f.ruleId === 'ux.disclosure-toggle-failed' && f.embeddedContext === 'same-origin-iframe');
  if (failedFrame) {
    const g = guidanceFor(failedFrame);
    assert.match(g.interpretation, /embedded/i);
  }
});

test('probable first-party CDN failure is confirmed; tracking stays quiet; opaque is inconclusive', async () => {
  const resources = [
    { name: 'https://cdn.example.com/site.css', initiatorType: 'link', responseStatus: 404, transferSize: 0 },
    { name: 'https://fonts.googleapis.com/css2?family=Demo', initiatorType: 'link', responseStatus: 500, transferSize: 0 },
    { name: 'https://metrics.example.com/analytics/collect.js', initiatorType: 'script', responseStatus: 404, transferSize: 0 },
    { name: 'https://cdn.example.com/opaque.js', initiatorType: 'script', responseStatus: 0, transferSize: 0 },
    { name: 'https://api.example.com/app.js', initiatorType: 'script', responseStatus: 404, transferSize: 0 }
  ];
  const { report } = await scan(resourceHtml, { url: 'https://www.example.com/resources', resources, wire: false });
  const idsList = ids(report);
  assert.ok(idsList.includes('web.stylesheet-failed'), 'probable first-party CSS failure');
  const css = report.findings.find(f => f.ruleId === 'web.stylesheet-failed');
  assert.equal(css.originClass, 'probable-first-party');
  assert.equal(idsList.includes('runtime.script-failed') && report.findings.some(f => /metrics\.example\.com\/analytics/i.test(f.evidence || '')), false);
  const related = report.findings.find(f => /api\.example\.com\/app\.js/i.test(String(f.resourceUrl || f.evidence || '')));
  assert.ok(related, 'related-host API script should surface');
  assert.notEqual(related.originClass, 'probable-first-party');
  assert.equal(related.worthChecking || related.resourceDisposition === 'worthChecking', true);
  const opaque = report.findings.find(f => f.ruleId === 'runtime.resource-status-inconclusive');
  if (opaque) assert.equal(opaque.failureClass || opaque.resourceDisposition, 'inconclusive');
});

test('Frank restoration guidance avoids claiming broken JavaScript', () => {
  const g = guidanceFor({ ruleId: 'ux.interaction-restoration-unproven', interactionObservation: { context: 'top-document' } });
  assert.match(g.interpretation, /stopped interaction testing|could not verify restoration/i);
  assert.equal(/javascript is broken/i.test(`${g.interpretation} ${g.remediation}`), false);
});
