import test from 'node:test';
import assert from 'node:assert/strict';
import { buildAuditDebugBundle } from '../packages/crawl/debug-report.js';

function baseAudit(overrides = {}) {
  return { id: 'audit_1', site_origin: 'https://example.com', start_url: 'https://example.com/', config: { maxPages: 40 }, status: 'complete', phase: 'complete', urlCounts: { fetched: 1 }, ...overrides };
}

test('the debug bundle carries full, unsummarized rows for every table, not a rollup', () => {
  const bundle = buildAuditDebugBundle({
    audit: baseAudit(),
    urls: [{ url: 'https://example.com/', http_status: 200 }],
    links: [{ source_url: 'https://example.com/', target_url: 'https://example.com/x', status: 'broken', anchor_text: 'Click here' }],
    findings: [{ url: 'https://example.com/', rule_id: 'seo.title-missing', evidence_json: '{"link":{"url":"https://example.com/x"}}' }],
    findingGroups: [{ rule_id: 'seo.title-missing', instances: 1, affected_urls: 1 }]
  });
  assert.equal(bundle.schema, 'web-qa-assistant-audit-debug/v1');
  assert.equal(bundle.urlCount, 1);
  assert.equal(bundle.linkCount, 1);
  assert.equal(bundle.links[0].anchor_text, 'Click here');
  assert.equal(bundle.findings[0].evidence.link.url, 'https://example.com/x');
  assert.equal(bundle.findingsTruncated, false);
});

test('a malformed evidence_json blob is reported as null rather than crashing the export', () => {
  const bundle = buildAuditDebugBundle({
    audit: baseAudit(),
    urls: [], links: [],
    findings: [{ url: 'https://example.com/', rule_id: 'x', evidence_json: 'not json' }],
    findingGroups: []
  });
  assert.equal(bundle.findings[0].evidence, null);
});

test('oversized tables are capped and flagged as truncated rather than silently dropped', () => {
  const findings = Array.from({ length: 3005 }, (_, i) => ({ url: `https://example.com/${i}`, rule_id: 'x', evidence_json: '{}' }));
  const bundle = buildAuditDebugBundle({ audit: baseAudit(), urls: [], links: [], findings, findingGroups: [] });
  assert.equal(bundle.findingCount, 3005);
  assert.equal(bundle.findings.length, 3000);
  assert.equal(bundle.findingsTruncated, true);
});
