import test from 'node:test';
import assert from 'node:assert/strict';
import { renderAuditReportHtml } from '../packages/crawl/report.js';

function baseAudit(overrides = {}) {
  return { site_origin: 'https://example.com', start_url: 'https://example.com/', status: 'complete', urlCounts: { fetched: 2 }, ...overrides };
}

test('a single self-contained HTML document is produced with a tab per data view', () => {
  const html = renderAuditReportHtml({
    audit: baseAudit(),
    urls: [{ url: 'https://example.com/', status: 'fetched', http_status: 200, title: 'Home', schema_types: null, rendered: 0 }],
    links: [{ source_url: 'https://example.com/', target_url: 'https://example.com/gone', status: 'broken', http_status: 404 }],
    findings: [{ url: 'https://example.com/', rule_id: 'seo.title-missing', category: 'fix', severity: 'high', confidence: 'inferred', collection_method: 'static' }],
    findingGroups: [{ rule_id: 'seo.title-missing', category: 'fix', severity: 'high', instances: 1, affected_urls: 1 }]
  });
  assert.match(html, /<!doctype html>/i);
  assert.match(html, /data-tab="overview"/);
  assert.match(html, /data-tab="links"/);
  assert.match(html, /data-tab="schema"/);
  assert.match(html, /data-tab="seo"/);
  assert.match(html, /data-tab="a11y"/);
});

test('top priorities are ranked by severity first, then by how many pages are affected', () => {
  const html = renderAuditReportHtml({
    audit: baseAudit(),
    urls: [], links: [],
    findings: [],
    findingGroups: [
      { rule_id: 'seo.description-missing', category: 'review', severity: 'medium', instances: 50, affected_urls: 50 },
      { rule_id: 'navigation.link-404-external', category: 'fix', severity: 'critical', instances: 1, affected_urls: 1 },
      { rule_id: 'structure.h1-missing', category: 'review', severity: 'medium', instances: 5, affected_urls: 5 }
    ]
  });
  const order = ['navigation.link-404-external', 'seo.description-missing', 'structure.h1-missing'];
  const positions = order.map((id) => html.indexOf(id));
  assert.ok(positions[0] < positions[1] && positions[1] < positions[2], 'critical severity must lead even with fewer instances; among equal severity, more affected pages ranks first');
});

test('findings are bucketed into the right topic tab by rule prefix', () => {
  const html = renderAuditReportHtml({
    audit: baseAudit(),
    urls: [], links: [],
    findings: [
      { url: 'https://example.com/', rule_id: 'axe.color-contrast', category: 'fix', severity: 'high', confidence: 'confirmed', collection_method: 'rendered' },
      { url: 'https://example.com/', rule_id: 'performance.browser.image-oversized', category: 'review', severity: 'high', confidence: 'confirmed', collection_method: 'rendered' },
      { url: 'https://example.com/', rule_id: 'schema.missing', category: 'review', severity: 'low', confidence: 'confirmed', collection_method: 'static' }
    ],
    findingGroups: []
  });
  assert.match(html, /Accessibility \(1\)/);
  assert.match(html, /Performance \(1\)/);
  assert.match(html, /Schema \(1\)/);
});

test('page-derived content is HTML-escaped everywhere, closing an XSS path through a crawled title or anchor', () => {
  const html = renderAuditReportHtml({
    audit: baseAudit(),
    urls: [{ url: 'https://example.com/', status: 'fetched', title: '<script>alert(1)</script>', schema_types: JSON.stringify(['<img onerror=alert(1)>']), rendered: 0 }],
    links: [{ source_url: 'https://example.com/', target_url: 'https://example.com/"><script>alert(2)</script>', status: 'broken', http_status: 404 }],
    findings: [{ url: 'https://example.com/', rule_id: '<b>rule</b>', category: 'fix', severity: 'high', confidence: 'confirmed', collection_method: 'static' }],
    findingGroups: []
  });
  assert.ok(!html.includes('<script>alert(1)</script>'));
  assert.ok(!html.includes('<img onerror=alert(1)>'));
  assert.ok(!html.includes('<script>alert(2)</script>'));
  assert.ok(!html.includes('<b>rule</b>'));
  assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
});

test('an audit with no findings or links renders cleanly instead of crashing on empty data', () => {
  const html = renderAuditReportHtml({ audit: baseAudit(), urls: [], links: [], findings: [], findingGroups: [] });
  assert.match(html, /No findings recorded/);
  assert.match(html, /Nothing to show here/);
});
