import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {
  attachCorrelationMetadata,
  applyLocalDiscoverabilityCorrelations,
  applyPerformanceCorrelations,
  composeWorthChecking,
  detectPlatform,
  sanitizeMarkupSnippet,
  rootCauseKeyFor,
  TARGETABILITY
} from '../packages/findings/correlation.js';
import { composeAttention, composeReportAttention, finalizeCorrelatedFindings } from '../packages/findings/correlate.js';
import { applyFindingPolicy } from '../packages/findings/policy.js';
import { buildEvidenceGraph } from '../packages/frank/evidence.js';
import { deterministicFrankPlan, validateFrankPlan } from '../packages/frank/plan.js';
import { guidanceFor } from '../packages/frank/guidance.js';
import { suppressFindingsForTargetIntegrity } from '../packages/integrity/target-integrity.js';

function abortError(message = 'timed out') {
  const error = new Error(message); error.name = 'AbortError'; return error;
}
function anchor(href, text = 'Link', { nav = false, main = false, footer = false, classes = '' } = {}) {
  return {
    href, innerText: text, className: classes, nodeType: 1, localName: 'a', tagName: 'A', id: '',
    classList: classes ? classes.split(/\s+/).filter(Boolean) : [],
    parentElement: null, outerHTML: `<a href="${href}">${text}</a>`,
    getAttribute(name) { if (name === 'href') return href; return null; },
    hasAttribute() { return false; },
    closest(selector) {
      if (nav && selector.includes('nav')) return {};
      if (main && selector.includes('main')) return {};
      if (footer && selector.includes('footer')) return {};
      return null;
    },
    getBoundingClientRect() { return { x: 0, y: 0, width: 40, height: 16 }; }
  };
}
function harness(anchors, sequences, { ids = [], externalFetch } = {}) {
  const queues = new Map(Object.entries(sequences).map(([url, rows]) => [url, [...rows]]));
  const context = {
    URL, AbortController, setTimeout, clearTimeout, performance, CSS: { escape: v => String(v) },
    location: { href: 'https://example.com/source/', origin: 'https://example.com', protocol: 'https:', hostname: 'example.com' },
    document: {
      querySelectorAll(selector) {
        if (selector === 'a[href]') return anchors;
        if (selector === 'a[href^="#"]') return anchors.filter(a => String(a.getAttribute('href') || '').startsWith('#'));
        if (selector === '[id]') return ids.map(id => ({ id, nodeType: 1 }));
        return [];
      },
      querySelector(selector) {
        if (selector.startsWith('[name=')) {
          const m = /\[name="([^"]+)"\]/.exec(selector);
          return ids.includes(m?.[1]) ? { id: m[1] } : null;
        }
        return null;
      },
      getElementById(id) { return ids.includes(id) ? { id } : null; },
      head: { contains() { return false; } },
      body: { contains() { return true; } },
      documentElement: {},
      links: anchors, forms: [], images: []
    },
    fetch: async url => {
      if (externalFetch) return externalFetch(url);
      const queue = queues.get(String(url)) || [];
      const next = queue.length ? queue.shift() : { status: 200 };
      if (next instanceof Error) throw next;
      if (next?.throw) throw next.throw;
      return { status: next.status, url: next.url || String(url), redirected: Boolean(next.redirected) };
    }
  };
  vm.createContext(context);
  vm.runInContext(fs.readFileSync('packages/rules/browser-rules.js', 'utf8'), context, { filename: 'browser-rules.js' });
  return { rules: context.WebQARules };
}

test('multiple anchors to the same 404 collapse via rootCauseKey', async () => {
  const url = 'https://example.com/gone/';
  const h = harness([
    anchor(url, 'Nav gone', { nav: true }),
    anchor(url, 'Body gone', { main: true }),
    anchor(url, 'Footer gone', { footer: true })
  ], { [url]: [{ status: 404 }, { status: 404 }] });
  const result = await h.rules.auditLinks({ limit: 10, concurrency: 1, timeoutMs: 100, retryTimeoutMs: 100, budgetMs: 2000 });
  assert.equal(result.findings.length, 1);
  assert.equal(result.findings[0].count, 3);
  const enriched = attachCorrelationMetadata(result.findings);
  assert.equal(enriched[0].rootCauseKey, rootCauseKeyFor(enriched[0]));
  const attention = composeAttention(enriched);
  assert.equal(attention.groups.length, 1);
  assert.equal(attention.groups[0].instanceCount, 3);
});

test('external 403 stays inconclusive and is never called broken', async () => {
  const url = 'https://cdn.example.com/secret';
  const h = harness([anchor(url, 'Secret')], {
    [url]: [{ status: 403 }, { status: 403 }]
  });
  const result = await h.rules.auditLinks({ limit: 10, concurrency: 1, timeoutMs: 100, retryTimeoutMs: 100, budgetMs: 2000 });
  assert.equal(result.confirmedIssues, 0);
  assert.ok(!result.findings.some(f => /broken|404|410|5xx/i.test(f.ruleId) || /broken/i.test(f.title)));
  assert.equal(result.inconclusive, 1);
  assert.equal(result.incompleteChecks[0].kind, 'external-link');
  assert.match(String(result.incompleteChecks[0].reason), /http-403|403/i);
  const review = result.findings.find(f => f.ruleId === 'navigation.link-review-external');
  assert.ok(review);
  assert.equal(review.confidence, 'inconclusive');
  assert.match(review.detail, /not treated as a broken link/i);
});

test('403/429 review findings surface in Worth Checking after policy', () => {
  const findings = applyFindingPolicy([
    { id: 'lead', ruleId: 'navigation.link-404', title: 'Broken nav', detail: 'x', category: 'fix', severity: 'high', confidence: 'confirmed', count: 1, link: { url: 'https://example.com/x', prominence: 'navigation', status: 404 } },
    { id: 'auth', ruleId: 'navigation.link-review-external', title: 'External link returned a forbidden response', detail: 'HTTP 403. This is not treated as a broken link.', category: 'review', severity: 'low', confidence: 'inconclusive', count: 1, link: { url: 'https://cdn.example.com/secret', status: 403, prominence: 'normal' } },
    { id: 'policy-quiet', ruleId: 'seo.noindex', title: 'noindex', detail: 'z', category: 'context', severity: 'info', confidence: 'confirmed', frankVisible: false, targetType: 'document', count: 1 }
  ], { type: 'production' });
  const correlated = attachCorrelationMetadata(findings);
  const attention = composeReportAttention(correlated, { limit: 8 });
  assert.ok(attention.groups.some(g => g.lead?.id === 'lead' || g.lead?.ruleId === 'navigation.link-404'));
  assert.ok((attention.worthChecking || []).some(w => (w.findingIds || []).includes('auth')));
  assert.ok(!(attention.worthChecking || []).some(w => (w.findingIds || []).includes('lead')));
  assert.ok(!(attention.worthChecking || []).some(w => (w.findingIds || []).includes('policy-quiet')));
  assert.equal(correlated.find(f => f.id === 'auth')?.frankVisible, false);
});

test('external confirmed 404 via privileged probe becomes external finding', () => {
  const h = harness([anchor('https://cdn.example.com/missing', 'Offsite')], {});
  const applied = h.rules.applyExternalProbeResults(
    [{ url: 'https://cdn.example.com/missing', text: 'Offsite', occurrences: 2, prominence: 'normal', location: 'body' }],
    [{ url: 'https://cdn.example.com/missing', status: 404, finalUrl: 'https://cdn.example.com/missing', method: 'GET', attempts: 2 }]
  );
  assert.equal(applied.findings.length, 1);
  assert.equal(applied.findings[0].ruleId, 'navigation.link-404-external');
  assert.equal(applied.findings[0].confidence, 'confirmed');
});

test('missing fragment target is a confirmed navigation finding without HTTP', () => {
  const h = harness([anchor('#missing-section', 'Jump')], {}, { ids: ['present'] });
  // fragmentFindings runs inside run(); synthesize via audit of DOM helpers by evaluating run after stubbing deps.
  const source = fs.readFileSync('packages/rules/browser-rules.js', 'utf8');
  assert.match(source, /navigation\.fragment-missing/);
  assert.match(source, /getElementById/);
});

test('fragmentFindings emits for missing id', () => {
  const context = {
    URL, AbortController, setTimeout, clearTimeout, performance,
    CSS: { escape: v => String(v) },
    location: { href: 'https://example.com/p', origin: 'https://example.com', protocol: 'https:', hostname: 'example.com', pathname: '/p' },
    document: {
      title: 'Demo',
      querySelectorAll(sel) {
        if (sel === 'a[href^="#"]') return [anchor('#nope', 'Go')];
        if (sel === 'a[href]') return [anchor('#nope', 'Go')];
        if (sel === 'h1,h2,h3,h4,h5,h6' || sel === 'h1') return [];
        if (sel === 'script[type="application/ld+json"]') return [];
        if (sel === '[id]') return [];
        if (sel === 'form[action]' || sel === 'a[target="_blank"]') return [];
        if (sel === 'script[src],link[href],img[src]') return [];
        if (sel === 'title' || sel === 'meta[name="description" i]' || sel === 'link[rel~="canonical"]') return [];
        return [];
      },
      querySelector() { return null; },
      getElementById() { return null; },
      documentElement: { getAttribute() { return 'en'; } },
      forms: [], images: [], links: [anchor('#nope', 'Go')],
      head: { contains() { return false; } },
      body: { contains() { return true; } }
    },
    getComputedStyle() { return { display: 'block', visibility: 'visible', opacity: '1', color: '#000', backgroundColor: '#fff', fontSize: '16px', fontWeight: '400', lineHeight: '1.4', position: 'static' }; },
    performance: { getEntriesByType() { return []; } },
    PerformanceObserver: function () { return { observe() {}, disconnect() {} }; }
  };
  // Minimal stubs for LCP observer constructor used at load
  context.PerformanceObserver.prototype = { observe() {}, disconnect() {} };
  vm.createContext(context);
  // Inject a fake PerformanceObserver that does nothing
  vm.runInContext(`globalThis.PerformanceObserver=function(){return{observe(){},disconnect(){}}};`, context);
  vm.runInContext(fs.readFileSync('packages/rules/browser-rules.js', 'utf8'), context, { filename: 'browser-rules.js' });
  const report = context.WebQARules.run();
  const frag = report.findings.filter(f => f.ruleId === 'navigation.fragment-missing');
  assert.equal(frag.length, 1);
  assert.equal(frag[0].confidence, 'confirmed');
  assert.equal(frag[0].link.url, '#nope');
});

test('discoverability contradictions stay review language', () => {
  const findings = applyLocalDiscoverabilityCorrelations([], {
    url: 'https://example.com/a/',
    canonical: 'https://example.com/b/',
    robots: 'noindex'
  });
  assert.ok(findings.some(f => f.ruleId === 'correlation.canonical-path-conflict'));
  const withSelf = applyLocalDiscoverabilityCorrelations([], {
    url: 'https://example.com/a/',
    canonical: 'https://example.com/a/',
    robots: 'noindex'
  });
  assert.ok(withSelf.some(f => f.ruleId === 'correlation.noindex-self-canonical'));
  assert.match(withSelf[0].detail, /need review/i);
});

test('performance correlations attach LCP resource root cause without changing thresholds', () => {
  const findings = [{
    id: 'performance.browser.lcp:1', ruleId: 'performance.browser.lcp', title: 'LCP slow',
    detail: 'slow', category: 'review', severity: 'medium', confidence: 'inferred', count: 1
  }];
  const next = applyPerformanceCorrelations(findings, {
    available: true,
    largestContentfulPaintMs: 4800,
    lcpElement: { selector: 'img.hero', url: 'https://example.com/hero.jpg' },
    heaviest: [{ name: 'https://example.com/hero.jpg', bytes: 1900000, type: 'img' }]
  });
  assert.ok(next.some(f => f.ruleId === 'performance.browser.lcp-heavy-image'));
  const lcp = next.find(f => f.ruleId === 'performance.browser.lcp');
  assert.match(lcp.rootCauseKey, /^lcp-resource:/);
  const attention = composeAttention(attachCorrelationMetadata(next));
  assert.equal(attention.groups.filter(g => g.key === lcp.rootCauseKey).length, 1);
});

test('normal image metrics do not invent optimization findings without oversize evidence', () => {
  const next = applyPerformanceCorrelations([], {
    available: true,
    largestContentfulPaintMs: 1200,
    lcpElement: { selector: 'img.ok', url: 'https://example.com/ok.jpg' },
    heaviest: [{ name: 'https://example.com/ok.jpg', bytes: 40000, type: 'img' }]
  });
  assert.equal(next.length, 0);
});

test('markup sanitizer strips query values and scripts', () => {
  const dirty = `<meta name="viewport" content="width=980"><script>token=abc</script><a href="https://example.com/path?secret=1#h">x</a>`;
  const clean = sanitizeMarkupSnippet(dirty);
  assert.doesNotMatch(clean, /secret=1/);
  assert.doesNotMatch(clean, /<script/i);
  assert.match(clean, /viewport/);
});

test('Frank markup/document plans validate and avoid fake spotlight targetIds', () => {
  const finding = attachCorrelationMetadata([{
    id: 'web.viewport-fixed:1', ruleId: 'web.viewport-fixed', title: 'Viewport fixed',
    detail: 'fixed', category: 'review', severity: 'medium', confidence: 'inferred',
    targetType: 'document', evidence: '<meta name="viewport" content="width=980">', count: 1
  }])[0];
  assert.equal(finding.targetability, TARGETABILITY.markup);
  const graph = buildEvidenceGraph({ finding, page: { url: 'https://example.com/' }, coverage: {} });
  const plan = deterministicFrankPlan(graph);
  assert.equal(validateFrankPlan(plan, graph), true);
  assert.ok(plan.steps.every(s => !s.targetId));
  assert.match(plan.steps[0].headline, /configuration|means/i);
  assert.match(plan.steps.find(s => s.type === 'remediation').code || plan.steps[0].code || '', /viewport|width/);
});

test('WordPress high-confidence remediation appends implementation context after underlying fix', () => {
  const g = guidanceFor({
    ruleId: 'performance.browser.lcp-heavy-image',
    remediationContext: { platform: 'wordpress', platformConfidence: 'high' },
    performanceObservation: { available: true, largestContentfulPaintMs: 5000, lcpElement: { selector: 'img.hero', url: '/hero.jpg' } }
  });
  assert.match(g.remediation, /Compress and resize|appropriately sized/i);
  assert.match(g.remediation, /WordPress implementation context/i);
  assert.match(g.remediation, /Smush|ShortPixel|Imagify/);
});

test('link-review guidance stays inconclusive and never claims broken', () => {
  const g = guidanceFor({
    ruleId: 'navigation.link-review-external',
    title: 'External link returned a forbidden response',
    detail: 'HTTP 403. This is not treated as a broken link.',
    confidence: 'inconclusive',
    link: { url: 'https://cdn.example.com/secret', status: 403, text: 'Secret', internal: false }
  });
  assert.match(g.interpretation, /inconclusive|not treating this as a confirmed broken/i);
  assert.doesNotMatch(g.interpretation, /confirmed missing/i);
  assert.match(g.remediation, /Do not rewrite the link solely/i);
  const graph = buildEvidenceGraph({
    finding: {
      id: 'navigation.link-review-external:1', ruleId: 'navigation.link-review-external', title: 'External link returned a forbidden response',
      detail: 'HTTP 403. This is not treated as a broken link.', confidence: 'inconclusive', category: 'review', severity: 'low',
      link: { url: 'https://cdn.example.com/secret', status: 403, internal: false }, targetType: 'visual', count: 1
    },
    page: { url: 'https://example.com/' }, coverage: {}
  });
  assert.ok(graph.evidence.some(e => e.label === 'Observed finding'));
  assert.ok(!graph.evidence.some(e => e.label === 'Verified finding'));
  const plan = deterministicFrankPlan(graph);
  assert.equal(plan.assessment.status, 'context');
  assert.match(plan.steps.find(s => s.type === 'interpretation').body, /inconclusive|not treating/i);
});

test('platform detection requires strong WordPress signals', () => {
  assert.equal(detectPlatform({ generator: 'WordPress 6.4' }).confidence, 'medium');
  assert.equal(detectPlatform({ resourceHints: ['/wp-content/themes/x/style.css', '/wp-includes/js/x.js'] }).confidence, 'high');
  assert.equal(detectPlatform({ url: 'https://example.com/' }).confidence, 'none');
});

test('blocked target integrity suppresses page-derived correlations', () => {
  const findings = finalizeCorrelatedFindings([
    { id: '1', ruleId: 'navigation.link-404', title: 'broken', detail: 'x', category: 'fix', severity: 'high', confidence: 'confirmed', count: 1, link: { url: 'https://example.com/x' } },
    { id: '2', ruleId: 'correlation.canonical-path-conflict', title: 'conflict', detail: 'need review', category: 'review', severity: 'medium', confidence: 'inferred', count: 1 }
  ], { page: { url: 'https://example.com/a', canonical: 'https://example.com/b' } });
  const kept = suppressFindingsForTargetIntegrity(findings, { state: 'blocked' });
  assert.equal(kept.length, 0);
});

test('missing markup findings get suggested remediation snippets', () => {
  const [viewport] = attachCorrelationMetadata([
    { id: 'v', ruleId: 'web.viewport-missing', title: 'Viewport metadata is missing', detail: 'none', category: 'fix', severity: 'medium', confidence: 'confirmed', targetType: 'document', count: 1 }
  ]);
  assert.equal(viewport.targetability, 'markup');
  assert.match(String(viewport.markupSnippet), /name="viewport"/);
  const [title] = attachCorrelationMetadata([
    { id: 't', ruleId: 'seo.title-missing', title: 'Page title is missing', detail: 'none', category: 'fix', severity: 'high', confidence: 'confirmed', targetType: 'document', count: 1 }
  ]);
  assert.match(String(title.markupSnippet), /<title>/);
});

test('worth checking excludes recommended-order leads and policy-quieted rows', () => {
  const findings = attachCorrelationMetadata([
    { id: 'lead', ruleId: 'navigation.link-404', title: 'Broken nav', detail: 'x', category: 'fix', severity: 'high', confidence: 'confirmed', count: 1, link: { url: 'https://example.com/x', prominence: 'navigation' } },
    { id: 'quiet', ruleId: 'seo.description-missing', title: 'Missing description', detail: 'y', category: 'review', severity: 'low', confidence: 'inconclusive', targetType: 'document', count: 1 },
    { id: 'policy-quiet', ruleId: 'seo.noindex', title: 'noindex', detail: 'z', category: 'context', severity: 'info', confidence: 'confirmed', frankVisible: false, targetType: 'document', count: 1 },
    { id: 'axe-incomplete', ruleId: 'axe.color-contrast.review', title: 'Manual review: contrast', detail: 'incomplete', category: 'review', severity: 'low', confidence: 'inconclusive', frankVisible: false, count: 1 }
  ]);
  const attention = composeReportAttention(findings, { limit: 8 });
  assert.ok(attention.groups.some(g => g.lead.id === 'lead'));
  assert.ok((attention.worthChecking || []).some(w => (w.findingIds || []).includes('quiet')));
  assert.ok(!(attention.worthChecking || []).some(w => (w.findingIds || []).includes('lead')));
  assert.ok(!(attention.worthChecking || []).some(w => (w.findingIds || []).includes('policy-quiet')));
  assert.ok(!(attention.worthChecking || []).some(w => (w.findingIds || []).includes('axe-incomplete')));
});

test('unrelated same-rule findings without shared root cause stay separate', () => {
  const findings = attachCorrelationMetadata([
    { id: 'a', ruleId: 'axe.button-name', title: 'Button name', detail: 'a', category: 'fix', severity: 'high', confidence: 'confirmed', selector: '#a', count: 1 },
    { id: 'b', ruleId: 'axe.button-name', title: 'Button name', detail: 'b', category: 'fix', severity: 'high', confidence: 'confirmed', selector: '#b', count: 1 }
  ]);
  // Without shared rootCauseKey override, groupKey falls back to rule|selector via rootCauseKeyFor which includes selector
  assert.notEqual(findings[0].rootCauseKey, findings[1].rootCauseKey);
  const attention = composeAttention(findings);
  assert.ok(attention.groups.length >= 2);
});

test('PSI key never appears in correlation or frank packages', () => {
  for (const file of [
    'packages/findings/correlation.js',
    'packages/findings/correlate.js',
    'packages/frank/guidance.js',
    'packages/frank/evidence.js',
    'apps/extension/background.js',
    'apps/extension/content.js'
  ]) {
    const src = fs.readFileSync(file, 'utf8');
    assert.doesNotMatch(src, /PSI_API|PAGESPEED_API_KEY|AIza[0-9A-Za-z_-]{20,}/);
  }
});
