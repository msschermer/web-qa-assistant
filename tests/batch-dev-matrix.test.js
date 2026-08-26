import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { JSDOM } from 'jsdom';
import { finalizeCorrelatedFindings } from '../packages/findings/correlate.js';
import { applyFindingPolicy } from '../packages/findings/policy.js';
import { explainCoverageReasons, COVERAGE_REASON } from '../packages/findings/coverage.js';
import { guidanceFor } from '../packages/frank/guidance.js';

const source = fs.readFileSync('packages/rules/browser-rules.js', 'utf8');
const batchHtml = fs.readFileSync('fixtures/qa-matrix/batch-dev.html', 'utf8');
const cleanHtml = fs.readFileSync('fixtures/qa-matrix/clean.html', 'utf8');

function scan(html, { url = 'https://example.com/batch-dev', resources = [], httpStatus = null, pageDiagnostics = [] } = {}) {
  const dom = new JSDOM(html, { url, pretendToBeVisual: true, contentType: 'text/html' });
  const nav = [{ responseStart: 40, requestStart: 0, domContentLoadedEventEnd: 120, loadEventEnd: 180, duration: 180, transferSize: 1200 }];
  const context = {
    window: dom.window,
    document: dom.window.document,
    location: dom.window.location,
    innerWidth: dom.window.innerWidth,
    getComputedStyle: dom.window.getComputedStyle.bind(dom.window),
    CSS: dom.window.CSS,
    Node: dom.window.Node,
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
  if (httpStatus != null) context.globalThis.__WEBQA_HTTP_STATUS__ = httpStatus;
  if (pageDiagnostics.length) context.globalThis.__WEBQA_PAGE_DIAGNOSTICS__ = { errors: pageDiagnostics };
  vm.createContext(context);
  vm.runInContext(source, context);
  return { report: context.WebQARules.run(), context };
}

function ruleIds(report) {
  return (report.findings || []).map(f => f.ruleId);
}

test('clean control stays quiet for new batch rule families', () => {
  const { report } = scan(cleanHtml);
  const batchRules = [
    'seo.soft-404-probable', 'runtime.unhandled-rejection', 'runtime.font-failed',
    'ux.placeholder-only-label', 'ux.form-control-missing-name', 'seo.hreflang-duplicate-target',
    'schema.jsonld-missing-type', 'ux.disclosure-target-missing', 'navigation.skip-link-target-missing',
    'ux.iframe-missing-title', 'ux.controls-target-missing', 'ux.disclosure-toggle-failed',
    'runtime.resource-failed-cross-origin', 'ux.embed-resource-failed', 'web.iframe-title-missing',
    'performance.browser.weight-dominant-resource'
  ];
  for (const id of batchRules) assert.equal(ruleIds(report).includes(id), false, id);
});

test('batch-dev detects soft-404, form, hreflang, schema, interaction, and resource failures', () => {
  const resources = [{
    name: 'https://example.com/missing-batch.js',
    initiatorType: 'script',
    responseStatus: 404,
    transferSize: 0,
    duration: 12
  }];
  const { report } = scan(batchHtml, {
    httpStatus: 200,
    resources,
    pageDiagnostics: [{ kind: 'unhandled_rejection', message: 'async failed', source: '', line: 0 }]
  });
  const ids = ruleIds(report);
  assert.ok(ids.includes('seo.soft-404-probable'));
  assert.ok(ids.includes('runtime.script-failed'));
  assert.ok(ids.includes('runtime.unhandled-rejection'));
  assert.ok(ids.includes('ux.placeholder-only-label'));
  assert.ok(ids.includes('seo.hreflang-duplicate-target'));
  assert.ok(ids.includes('schema.jsonld-missing-type'));
  assert.ok(ids.includes('ux.disclosure-target-missing'));
  assert.ok(ids.includes('navigation.skip-link-target-missing'));
  assert.equal(ids.filter(id => id === 'navigation.fragment-missing').length, 0);
});

test('x-default and en may share a URL without duplicate-target finding', () => {
  const { report } = scan(cleanHtml);
  assert.equal(ruleIds(report).includes('seo.hreflang-duplicate-target'), false);
});

test('broken image dedupes Performance API and DOM observations', () => {
  const imgUrl = 'https://example.com/missing-photo.png';
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Img</title></head><body><img src="${imgUrl}" width="120" height="80"></body></html>`;
  const resources = [{
    name: imgUrl,
    initiatorType: 'img',
    responseStatus: 404,
    transferSize: 0,
    duration: 8
  }];
  const { report } = scan(html, { url: 'https://example.com/img', resources });
  assert.equal(ruleIds(report).filter(id => id === 'web.image-broken').length, 1);
});

test('page diagnostics are not duplicated in scan output', () => {
  const diag = [{ kind: 'page_error', message: 'early fail', source: 'https://example.com/a.js', line: 1 }];
  const { report } = scan(cleanHtml, { pageDiagnostics: diag });
  assert.equal(report.pageDiagnostics.errors.length, 1);
  assert.equal(report.pageDiagnostics.errors[0].message, 'early fail');
});

test('extension-partial runtime maps to partial capture reason', () => {
  const { report } = scan(cleanHtml, {
    pageDiagnostics: [{ kind: 'page_error', message: 'early fail', source: '', line: 0 }]
  });
  report.coverageReasons = explainCoverageReasons(report);
  assert.equal(report.coverage.runtime, 'extension-partial');
  assert.equal(report.coverageReasons.runtime, COVERAGE_REASON.RUNTIME_EXTENSION_PARTIAL);
});

test('runtime and script failures share a root cause when correlated', () => {
  const resources = [{
    name: 'https://example.com/missing-batch.js',
    initiatorType: 'script',
    responseStatus: 404,
    transferSize: 0,
    duration: 12
  }];
  const { report } = scan(batchHtml, { httpStatus: 200, resources });
  const correlated = finalizeCorrelatedFindings(report.findings, report);
  const script = correlated.find(f => f.ruleId === 'runtime.script-failed');
  assert.ok(script?.rootCauseKey);
});

test('Frank guidance covers soft-404 and resource failures without scanner jargon', () => {
  const soft = guidanceFor({ ruleId: 'seo.soft-404-probable', title: 'soft', detail: '', category: 'review' });
  assert.match(soft.interpretation || soft.recommendation, /404|not-found|HTTP/i);
  const script = guidanceFor({ ruleId: 'runtime.script-failed', resourceUrl: 'https://example.com/a.js', title: 'script', detail: '', category: 'fix' });
  assert.match(script.remediation, /script/i);
  const uncaught = guidanceFor({ ruleId: 'runtime.uncaught-error', title: 'err', detail: '', category: 'fix' });
  assert.match(uncaught.limitations, /extension-partial/i);
  assert.doesNotMatch(uncaught.limitations, /do not collect this family/i);
});

test('extension partial runtime coverage when page diagnostics exist', () => {
  const { report, context } = scan(cleanHtml, {
    pageDiagnostics: [{ kind: 'page_error', message: 'early fail', source: 'https://example.com/a.js', line: 1 }]
  });
  const merged = context.WebQARules.merge(report, null, { findings: [], checked: 0 });
  assert.equal(merged.coverage.runtime, 'extension-partial');
});
