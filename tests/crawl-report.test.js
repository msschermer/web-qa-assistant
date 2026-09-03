import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { renderAuditReportHtml } from '../packages/crawl/report.js';
import { DISCIPLINE_ORDER, disciplineOf } from '../packages/findings/disciplines.js';
import { guidanceForRule } from '../packages/findings/rule-guidance.js';

function baseAudit(overrides = {}) {
  return { site_origin: 'https://example.com', start_url: 'https://example.com/', status: 'complete', urlCounts: { fetched: 2 }, ...overrides };
}

test('the exported report carries the same five destinations as the Site Audit screen', () => {
  const html = renderAuditReportHtml({
    audit: baseAudit(),
    urls: [{ url: 'https://example.com/', status: 'fetched', http_status: 200, title: 'Home', schema_types: null, rendered: 0 }],
    links: [{ source_url: 'https://example.com/', target_url: 'https://example.com/gone', status: 'broken', http_status: 404 }],
    findings: [{ url: 'https://example.com/', rule_id: 'seo.title-missing', category: 'fix', severity: 'high', confidence: 'inferred', collection_method: 'static' }],
    findingGroups: [{ rule_id: 'seo.title-missing', category: 'fix', severity: 'high', confidence: 'inferred', instances: 1, affected_urls: 1 }]
  });
  assert.match(html, /<!doctype html>/i);
  // The client's document and the consultant's screen navigate the same way.
  assert.deepEqual([...html.matchAll(/data-tab="([a-z-]+)"/g)].map((m) => m[1]),
    ['overview', 'findings', 'pages', 'links', 'browser']);
  assert.match(html, /class="nav-label">Explore</);
  assert.match(html, /class="nav-label">Validate</);
});

test('a partial crawl says so at the top, in the document the client keeps', () => {
  const html = renderAuditReportHtml({
    audit: baseAudit({ urlCounts: { fetched: 12, queued: 102 } }),
    urls: [], links: [], findings: [], findingGroups: []
  });
  assert.match(html, /Partial crawl/);
  assert.match(html, /12 pages of 114 discovered were fetched/);
  assert.match(html, /102 never fetched/);
  assert.match(html, /describes those 12 pages, not the whole site/);

  const complete = renderAuditReportHtml({
    audit: baseAudit({ urlCounts: { fetched: 9 } }),
    urls: [], links: [], findings: [], findingGroups: []
  });
  assert.match(complete, /Complete crawl/);
  assert.doesNotMatch(complete, /Partial crawl/);
});

test('priority order matches the screen: a confirmed availability failure leads', () => {
  // The defect this closes: the screen led with the confirmed broken link and
  // the exported report led with whatever was most severe, so the document
  // contradicted the walkthrough the client had just been given.
  const html = renderAuditReportHtml({
    audit: baseAudit(),
    urls: [], links: [], findings: [],
    findingGroups: [
      { rule_id: 'seo.description-missing', title: 'Meta description is missing', category: 'review', severity: 'critical', confidence: 'inferred', instances: 50, affected_urls: 50 },
      { rule_id: 'navigation.link-404-external', title: 'External link points to a missing page', category: 'fix', severity: 'high', confidence: 'confirmed', instances: 1, affected_urls: 1 },
      { rule_id: 'structure.h1-missing', title: 'H1 is missing', category: 'review', severity: 'medium', confidence: 'inferred', instances: 5, affected_urls: 5 }
    ]
  });
  const priorities = html.slice(html.indexOf('class="priorities"'), html.indexOf('</ol>'));
  const order = ['navigation.link-404-external', 'seo.description-missing', 'structure.h1-missing'];
  const positions = order.map((id) => priorities.indexOf(id));
  assert.ok(positions.every((p) => p >= 0), 'every pattern should appear in the priority list');
  assert.ok(positions[0] < positions[1] && positions[1] < positions[2],
    'a confirmed availability failure leads; then the scanner severity; then breadth');
});

test('findings are filed under the same disciplines the overlay uses, availability first', () => {
  const html = renderAuditReportHtml({
    audit: baseAudit(),
    urls: [], links: [], findings: [],
    findingGroups: [
      { rule_id: 'axe.color-contrast', title: 'Contrast is insufficient', severity: 'high', confidence: 'confirmed', instances: 4, affected_urls: 2 },
      { rule_id: 'navigation.link-404-external', title: 'External link points to a missing page', severity: 'high', confidence: 'confirmed', instances: 2, affected_urls: 2 },
      { rule_id: 'security.hsts-missing', title: 'HSTS is missing', severity: 'medium', confidence: 'confirmed', instances: 2, affected_urls: 2 }
    ]
  });
  assert.equal(disciplineOf('navigation.link-404-external'), 'availability');
  const headings = [...html.matchAll(/class="d-head">([^<]+)/g)].map((m) => m[1].trim());
  assert.deepEqual(headings, ['Availability', 'Security', 'Accessibility'],
    'the report reads in DISCIPLINE_ORDER — accessibility does not lead because it is easy to detect');
  assert.equal(DISCIPLINE_ORDER[0], 'availability');
  // The fix sentence is the shared one, not a second copy.
  assert.ok(html.includes(guidanceForRule('security.hsts-missing')));
});

test('a render pass that never ran is stated, not left as an empty section reading clean', () => {
  const notRun = renderAuditReportHtml({
    audit: baseAudit(),
    urls: [{ url: 'https://example.com/', status: 'fetched', rendered: 0 }],
    links: [],
    findings: [{ url: 'https://example.com/', rule_id: 'seo.title-missing', severity: 'high', confidence: 'inferred', collection_method: 'static' }],
    findingGroups: []
  });
  assert.match(notRun, /Not run for this audit/);
  assert.match(notRun, /an empty section is not a clean bill of health/);

  const ran = renderAuditReportHtml({
    audit: baseAudit(),
    urls: [{ url: 'https://example.com/', status: 'fetched', rendered: 1 }],
    links: [],
    findings: [{ url: 'https://example.com/', rule_id: 'axe.color-contrast', title: 'Contrast', severity: 'high', confidence: 'confirmed', collection_method: 'rendered' }],
    findingGroups: []
  });
  assert.doesNotMatch(ran, /Not run for this audit/);
  assert.match(ran, /axe\.color-contrast/);
});

test('the report inlines the one palette rather than keeping a copy that drifts', () => {
  const html = renderAuditReportHtml({ audit: baseAudit(), urls: [], links: [], findings: [], findingGroups: [] });
  const tokens = fs.readFileSync('packages/ui/tokens.css', 'utf8');
  for (const name of ['--wqa-canvas', '--wqa-brand', '--wqa-sev-critical', '--wqa-ink-faint']) {
    const value = tokens.match(new RegExp(`${name}:\\s*(#[0-9A-Fa-f]{6})`))[1];
    assert.ok(html.includes(`${name}:${value}`) || html.includes(`${name}: ${value}`),
      `${name} should reach the report from tokens.css, not from a copy`);
  }
  // A document gets printed, and light text on a background the browser strips
  // is not a document.
  assert.match(html, /@media print/);
  assert.match(html, /section\{display:block !important/);
});

test('page-derived content is HTML-escaped everywhere, closing an XSS path through a crawled title or anchor', () => {
  const html = renderAuditReportHtml({
    audit: baseAudit(),
    urls: [{ url: 'https://example.com/', status: 'fetched', title: '<script>alert(1)</script>', schema_types: JSON.stringify(['<img onerror=alert(1)>']), rendered: 0 }],
    links: [{ source_url: 'https://example.com/', target_url: 'https://example.com/"><script>alert(2)</script>', status: 'broken', http_status: 404 }],
    findings: [{ url: 'https://example.com/', rule_id: '<b>rule</b>', title: '<i>bad</i>', category: 'fix', severity: 'high', confidence: 'confirmed', collection_method: 'static' }],
    findingGroups: [{ rule_id: '<b>rule</b>', title: '<i>bad</i>', severity: 'high', confidence: 'confirmed', instances: 1, affected_urls: 1 }]
  });
  assert.ok(!html.includes('<script>alert(1)</script>'));
  assert.ok(!html.includes('<img onerror=alert(1)>'));
  assert.ok(!html.includes('<script>alert(2)</script>'));
  assert.ok(!html.includes('<b>rule</b>'));
  assert.ok(!html.includes('<i>bad</i>'));
  assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
});

test('an audit with no findings or links renders cleanly instead of crashing on empty data', () => {
  const html = renderAuditReportHtml({ audit: baseAudit(), urls: [], links: [], findings: [], findingGroups: [] });
  assert.match(html, /No findings recorded/);
  assert.match(html, /No pages were crawled/);
  assert.match(html, /Every link checked resolved/);
});
