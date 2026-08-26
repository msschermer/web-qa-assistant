import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { JSDOM } from 'jsdom';
import { finalizeCorrelatedFindings } from '../packages/findings/correlate.js';
import { guidanceFor } from '../packages/frank/guidance.js';

const source = fs.readFileSync('packages/rules/browser-rules.js', 'utf8');
const frameHtml = fs.readFileSync('fixtures/qa-matrix/frame-interaction.html', 'utf8');
const cleanHtml = fs.readFileSync('fixtures/qa-matrix/interaction-clean.html', 'utf8');
const quietHtml = fs.readFileSync('fixtures/qa-matrix/clean.html', 'utf8');

function scan(html, { url = 'https://example.com/frame-interaction', resources = [], wireToggles = true } = {}) {
  const dom = new JSDOM(html, { url, pretendToBeVisual: true, contentType: 'text/html', runScripts: 'outside-only' });
  // Ensure same-origin iframe interiors exist even when srcdoc parsing is incomplete.
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
    console
  };
  context.globalThis = context;
  context.window = new Proxy(dom.window, {
    get(target, prop) {
      if (prop in context && prop !== 'window') return context[prop];
      const value = target[prop];
      return typeof value === 'function' ? value.bind(target) : value;
    }
  });
  if (wireToggles) {
    const good = dom.window.document.getElementById('good-toggle');
    const ok = dom.window.document.getElementById('ok-toggle');
    for (const btn of [good, ok].filter(Boolean)) {
      btn.addEventListener('click', function () {
        const open = this.getAttribute('aria-expanded') === 'true';
        this.setAttribute('aria-expanded', open ? 'false' : 'true');
        const panel = dom.window.document.getElementById(this.getAttribute('aria-controls'));
        if (panel) panel.hidden = open;
      });
    }
  }
  // Mark complete broken images inside srcdoc frames for JSDOM.
  for (const frame of dom.window.document.querySelectorAll('iframe')) {
    try {
      const doc = frame.contentDocument;
      if (!doc) continue;
      for (const img of doc.querySelectorAll('img')) {
        Object.defineProperty(img, 'complete', { value: true });
        Object.defineProperty(img, 'naturalWidth', { value: 0 });
        Object.defineProperty(img, 'naturalHeight', { value: 0 });
      }
      for (const field of doc.querySelectorAll('input,select,textarea')) {
        field.getBoundingClientRect = () => ({ width: 120, height: 24, top: 0, left: 0, bottom: 24, right: 120 });
      }
    } catch {}
  }
  vm.createContext(context);
  vm.runInContext(source, context);
  return { report: context.WebQARules.run(), context, dom };
}

function ruleIds(report) {
  return (report.findings || []).map(f => f.ruleId);
}

test('quiet and interaction-clean controls stay free of toggle failures', () => {
  const quiet = scan(quietHtml);
  assert.equal(ruleIds(quiet.report).includes('ux.disclosure-toggle-failed'), false);
  const clean = scan(cleanHtml);
  assert.equal(ruleIds(clean.report).includes('ux.disclosure-toggle-failed'), false);
  assert.ok((clean.report.interactionCoverage?.passed || 0) >= 1);
});

test('broken disclosure fails safe interaction check; working one passes and restores', () => {
  const { report, dom } = scan(frameHtml);
  const ids = ruleIds(report);
  assert.ok(ids.includes('ux.disclosure-toggle-failed'));
  const failed = report.findings.find(f => f.ruleId === 'ux.disclosure-toggle-failed');
  assert.equal(failed.interactionObservation?.interactionType, 'disclosure-toggle');
  assert.equal(failed.interactionObservation?.restoredState?.restored, true);
  assert.equal(dom.window.document.getElementById('broken-toggle').getAttribute('aria-expanded'), 'false');
  assert.equal(dom.window.document.getElementById('good-toggle').getAttribute('aria-expanded'), 'false');
  assert.equal(dom.window.document.getElementById('good-panel').hidden, true);
  assert.equal(dom.window.document.getElementById('broken-panel').hidden, true);
  assert.ok(report.interactionCoverage.safelyTested >= 1);
  assert.ok(report.interactionCoverage.failed >= 1);
  assert.ok(report.interactionCoverage.passed >= 1);
});

test('unsafe purchase control is never activated', () => {
  const { report, dom } = scan(frameHtml);
  assert.ok((report.interactionCoverage?.skippedUnsafe || 0) >= 1);
  assert.equal(dom.window.document.getElementById('unsafe-buy').getAttribute('aria-expanded'), 'false');
  const failedSelectors = report.findings.filter(f => f.ruleId === 'ux.disclosure-toggle-failed').map(f => f.selector || '');
  assert.equal(failedSelectors.some(s => /unsafe-buy|Buy now/i.test(s)), false);
});

test('same-origin iframe interior form and lang issues are scoped with frame metadata', () => {
  const { report } = scan(frameHtml);
  const placeholder = report.findings.find(f => f.ruleId === 'ux.placeholder-only-label' && f.embeddedContext === 'same-origin-iframe');
  assert.ok(placeholder, 'expected iframe placeholder-only finding');
  assert.equal(placeholder.spotlightSafe, false);
  assert.ok(placeholder.frameSelector);
  assert.match(guidanceFor(placeholder).interpretation, /embedded same-origin/i);
  const lang = report.findings.find(f => f.ruleId === 'a11y.lang-missing' && f.embeddedContext === 'same-origin-iframe');
  assert.ok(lang);
  assert.ok(report.page.embeddedCoverage.crossOriginFramesNotInspectable >= 1);
});

test('cross-origin iframe is coverage-only without interior findings', () => {
  const { report } = scan(frameHtml);
  assert.ok(report.page.embeddedCoverage.crossOriginIframes >= 1);
  assert.equal(report.page.embeddedCoverage.sameOriginFramesChecked >= 1, true);
  const xoInterior = report.findings.filter(f => /cdn\.example\.net/.test(String(f.evidence || '')) && f.embeddedContext === 'same-origin-iframe');
  assert.equal(xoInterior.length, 0);
});

test('tracking cross-origin failures stay diagnostic; visible third-party script is Worth Checking', () => {
  const resources = [
    { name: 'https://metrics.example.com/analytics/collect.js', initiatorType: 'script', responseStatus: 404, transferSize: 0, duration: 4 },
    { name: 'https://cdn.example.net/widget.js', initiatorType: 'script', responseStatus: 500, transferSize: 0, duration: 6 },
    { name: 'https://player.example.net/embed/frame.js', initiatorType: 'script', responseStatus: 404, transferSize: 0, duration: 5 }
  ];
  const html = `<!doctype html><html lang="en"><head><title>Resources</title>
    <script src="https://cdn.example.net/widget.js"></script>
    <script src="https://player.example.net/embed/frame.js"></script>
  </head><body><h1>Resources</h1><iframe src="https://player.example.net/embed/frame" width="400" height="220" title="Video"></iframe></body></html>`;
  const { report } = scan(html, { url: 'https://example.com/resources', resources, wireToggles: false });
  const ids = ruleIds(report);
  assert.equal(ids.includes('runtime.script-failed'), false);
  assert.ok(ids.includes('runtime.resource-failed-cross-origin') || ids.includes('ux.embed-resource-failed'));
  const trackingFinding = report.findings.find(f => /metrics\.example\.com\/analytics/i.test(String(f.resourceUrl || f.evidence || '')));
  assert.equal(trackingFinding, undefined);
  const diag = report.diagnostics.failedResources || [];
  assert.ok(diag.some(r => /metrics\.example\.com\/analytics/i.test(r.source) && r.disposition === 'diagnosticOnly'));
});

test('script failure plus toggle failure correlate without claiming causation', () => {
  const resources = [{
    name: 'https://example.com/missing-widget.js',
    initiatorType: 'script',
    responseStatus: 404,
    transferSize: 0,
    duration: 8
  }];
  const { report } = scan(frameHtml, { resources });
  const correlated = finalizeCorrelatedFindings(report.findings, report);
  const toggle = correlated.find(f => f.ruleId === 'ux.disclosure-toggle-failed');
  const script = correlated.find(f => f.ruleId === 'runtime.script-failed');
  assert.ok(toggle && script);
  assert.ok(Array.isArray(toggle.relatedRuntimeFailures) && toggle.relatedRuntimeFailures.length >= 1);
  assert.notEqual(toggle.rootCauseKey, script.rootCauseKey);
  assert.match(guidanceFor(toggle).limitations, /not as proven causation|Worth Checking/i);
});

test('PSI remains deferred in scan metadata', () => {
  const { report } = scan(cleanHtml);
  assert.equal(report.psi?.enabled, false);
  assert.equal(report.psi?.attempted, false);
  assert.match(String(report.psi?.unavailableReason || ''), /deferred/i);
});
