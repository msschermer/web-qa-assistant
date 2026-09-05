import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { openAuditStore, normalizeAuditUrl, newAuditId } from '../packages/crawl/store.js';

function freshStore() { return openAuditStore(':memory:'); }

test('normalizeAuditUrl strips fragments, default ports, and trailing slashes for dedup', () => {
  assert.equal(normalizeAuditUrl('https://example.com/a/#section'), 'https://example.com/a');
  assert.equal(normalizeAuditUrl('https://example.com:443/a/'), 'https://example.com/a');
  assert.equal(normalizeAuditUrl('https://example.com/'), 'https://example.com/');
});

test('creating an audit persists config and starts in queued/queued', () => {
  const store = freshStore();
  const id = store.createAudit({ siteOrigin: 'https://example.com', startUrl: 'https://example.com/', config: { maxPages: 25 } });
  const audit = store.getAudit(id);
  assert.equal(audit.status, 'queued');
  assert.equal(audit.phase, 'queued');
  assert.deepEqual(audit.config, { maxPages: 25 });
  store.close();
});

test('enqueueUrl deduplicates by normalized URL within one audit', () => {
  const store = freshStore();
  const id = store.createAudit({ siteOrigin: 'https://example.com', startUrl: 'https://example.com/', config: {} });
  assert.equal(store.enqueueUrl(id, 'https://example.com/about', 'link'), true);
  assert.equal(store.enqueueUrl(id, 'https://example.com/about/', 'link'), false, 'trailing-slash duplicate must not re-queue');
  assert.equal(store.urlCountsByStatus(id).queued, 1);
  store.close();
});

test('claimNextQueuedUrl moves a row from queued to fetching, FIFO', () => {
  const store = freshStore();
  const id = store.createAudit({ siteOrigin: 'https://example.com', startUrl: 'https://example.com/', config: {} });
  store.enqueueUrl(id, 'https://example.com/a', 'link');
  store.enqueueUrl(id, 'https://example.com/b', 'link');
  const first = store.claimNextQueuedUrl(id);
  assert.equal(first.url, 'https://example.com/a');
  assert.equal(store.urlCountsByStatus(id).fetching, 1);
  assert.equal(store.urlCountsByStatus(id).queued, 1);
  store.close();
});

test('recordUrlResult upserts fetched metadata without creating a duplicate row', () => {
  const store = freshStore();
  const id = store.createAudit({ siteOrigin: 'https://example.com', startUrl: 'https://example.com/', config: {} });
  store.enqueueUrl(id, 'https://example.com/', 'start');
  store.recordUrlResult(id, 'https://example.com/', { status: 'fetched', httpStatus: 200, title: 'Home', indexable: true, h1Count: 1 });
  const rows = store.listUrls(id);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].status, 'fetched');
  assert.equal(rows[0].title, 'Home');
  assert.equal(rows[0].indexable, 1);
  store.close();
});

test('recordLinks and inlinkCountForTarget track cross-page relationships', () => {
  const store = freshStore();
  const id = store.createAudit({ siteOrigin: 'https://example.com', startUrl: 'https://example.com/', config: {} });
  store.recordLinks(id, 'https://example.com/', [{ url: 'https://example.com/about', internal: true, status: 'healthy', text: 'About' }]);
  store.recordLinks(id, 'https://example.com/contact', [{ url: 'https://example.com/about', internal: true, status: 'healthy', text: 'About us' }]);
  assert.equal(store.inlinkCountForTarget(id, 'https://example.com/about'), 2);
  assert.equal(store.linkCountsByStatus(id).healthy, 2);
  store.close();
});

test('recordFindings and findingsByRule group instances and affected URLs per rule', () => {
  const store = freshStore();
  const id = store.createAudit({ siteOrigin: 'https://example.com', startUrl: 'https://example.com/', config: {} });
  store.recordFindings(id, 'https://example.com/a', [{ ruleId: 'seo.title-missing', category: 'fix', severity: 'high', fingerprint: 'x' }]);
  store.recordFindings(id, 'https://example.com/b', [{ ruleId: 'seo.title-missing', category: 'fix', severity: 'high', fingerprint: 'y' }]);
  const grouped = store.findingsByRule(id);
  assert.equal(grouped.length, 1);
  assert.equal(grouped[0].rule_id, 'seo.title-missing');
  assert.equal(grouped[0].instances, 2);
  assert.equal(grouped[0].affected_urls, 2);
  store.close();
});

test('listFindings can be filtered by ruleId, and by ruleId+confidence to match one exact findingsByRule row', () => {
  // groupFindingsByRule groups by (rule_id, confidence), so a rule that fired
  // at both confidence levels appears as two separate rows in that grouped
  // list — drilling into one of those rows must fetch only ITS URLs, not
  // every URL for the rule regardless of confidence.
  const store = freshStore();
  const id = store.createAudit({ siteOrigin: 'https://example.com', startUrl: 'https://example.com/', config: {} });
  store.recordFindings(id, 'https://example.com/a', [{ ruleId: 'seo.canonical-missing', category: 'review', severity: 'medium', confidence: 'inferred', fingerprint: 'x' }]);
  store.recordFindings(id, 'https://example.com/b', [{ ruleId: 'seo.canonical-missing', category: 'review', severity: 'medium', confidence: 'confirmed', fingerprint: 'y' }]);
  store.recordFindings(id, 'https://example.com/c', [{ ruleId: 'structure.h1-missing', category: 'review', severity: 'medium', confidence: 'inferred', fingerprint: 'z' }]);

  const byRule = store.listFindings(id, { ruleId: 'seo.canonical-missing' });
  assert.equal(byRule.length, 2, 'both confidence levels of the rule must be returned when only ruleId is given');
  assert.ok(byRule.every((f) => f.rule_id === 'seo.canonical-missing'));

  const byRuleAndConfidence = store.listFindings(id, { ruleId: 'seo.canonical-missing', confidence: 'confirmed' });
  assert.equal(byRuleAndConfidence.length, 1);
  assert.equal(byRuleAndConfidence[0].url, 'https://example.com/b');
  store.close();
});

test('finishAudit records terminal status, timestamps, and stats', () => {
  const store = freshStore();
  const id = store.createAudit({ siteOrigin: 'https://example.com', startUrl: 'https://example.com/', config: {} });
  store.finishAudit(id, { status: 'complete', stats: { pagesProcessed: 3 } });
  const audit = store.getAudit(id);
  assert.equal(audit.status, 'complete');
  assert.equal(audit.phase, 'complete');
  assert.ok(audit.completed_at);
  assert.deepEqual(audit.stats, { pagesProcessed: 3 });
  store.close();
});

test('listAudits returns audits for a site newest-first, scoped to that site', () => {
  const store = freshStore();
  const a = store.createAudit({ siteOrigin: 'https://example.com', startUrl: 'https://example.com/', config: {} });
  store.createAudit({ siteOrigin: 'https://other.example.com', startUrl: 'https://other.example.com/', config: {} });
  const list = store.listAudits('https://example.com', 'shared');
  assert.equal(list.length, 1);
  assert.equal(list[0].id, a);
  store.close();
});

test('listAudits also scopes by owner, so one tenant never sees another tenant\'s audits of the same site', () => {
  const store = freshStore();
  const shared = store.createAudit({ siteOrigin: 'https://example.com', startUrl: 'https://example.com/', config: {}, owner: 'shared' });
  const installed = store.createAudit({ siteOrigin: 'https://example.com', startUrl: 'https://example.com/', config: {}, owner: 'install:abc' });
  assert.deepEqual(store.listAudits('https://example.com', 'shared').map((a) => a.id), [shared]);
  assert.deepEqual(store.listAudits('https://example.com', 'install:abc').map((a) => a.id), [installed]);
  store.close();
});

test('nextUrlsNeedingRender only offers fetched pages that have not yet been rendered, and markUrlRendered removes them from the queue', () => {
  const store = freshStore();
  const id = store.createAudit({ siteOrigin: 'https://example.com', startUrl: 'https://example.com/', config: {} });
  store.enqueueUrl(id, 'https://example.com/a', 'start');
  store.enqueueUrl(id, 'https://example.com/b', 'link');
  store.recordUrlResult(id, 'https://example.com/a', { status: 'fetched' });
  store.recordUrlResult(id, 'https://example.com/b', { status: 'fetched' });
  assert.deepEqual(store.nextUrlsNeedingRender(id, 10).map((r) => r.url).sort(), ['https://example.com/a', 'https://example.com/b']);
  assert.deepEqual(store.renderProgress(id), { total: 2, rendered: 0, remaining: 2 });

  store.markUrlRendered(id, 'https://example.com/a/'); // trailing slash must still resolve to the same normalized row
  // 'b' was already claimed by the call above, so it is intentionally NOT
  // re-offered yet — see the claim/lease test below for that lifecycle.
  assert.deepEqual(store.nextUrlsNeedingRender(id, 10), []);
  assert.deepEqual(store.renderProgress(id), { total: 2, rendered: 1, remaining: 1 });
  store.close();
});

test('a claimed render row is not re-offered to a second poller until it is rendered or the claim goes stale', () => {
  // Two side panels open on the same install, or a retried request racing a
  // slow-but-successful one, must not both grab and duplicate-render the
  // same URL — this is the render-queue's data-integrity guarantee.
  const store = freshStore();
  const id = store.createAudit({ siteOrigin: 'https://example.com', startUrl: 'https://example.com/', config: {} });
  store.enqueueUrl(id, 'https://example.com/a', 'start');
  store.recordUrlResult(id, 'https://example.com/a', { status: 'fetched' });

  const firstPoller = store.nextUrlsNeedingRender(id, 5);
  assert.deepEqual(firstPoller.map((r) => r.url), ['https://example.com/a']);
  const secondPoller = store.nextUrlsNeedingRender(id, 5);
  assert.deepEqual(secondPoller, [], 'a second poller must not receive a URL the first poller already claimed');

  // Simulate the claim going stale (the tab/service worker that claimed it
  // died mid-render) by backdating claimed_at past the lease timeout —
  // the row must become offerable again with no separate "release" call.
  store.raw.prepare('UPDATE audit_urls SET claimed_at = ? WHERE audit_id = ?').run(new Date(Date.now() - 20 * 60 * 1000).toISOString(), id);
  const thirdPoller = store.nextUrlsNeedingRender(id, 5);
  assert.deepEqual(thirdPoller.map((r) => r.url), ['https://example.com/a'], 'a stale claim must expire and become offerable again');
  store.close();
});

test('a page still queued or errored is never offered for rendering — only pages that actually fetched', () => {
  const store = freshStore();
  const id = store.createAudit({ siteOrigin: 'https://example.com', startUrl: 'https://example.com/', config: {} });
  store.enqueueUrl(id, 'https://example.com/still-queued', 'link');
  store.enqueueUrl(id, 'https://example.com/broken', 'link');
  store.recordUrlResult(id, 'https://example.com/broken', { status: 'error', error: 'timeout' });
  assert.deepEqual(store.nextUrlsNeedingRender(id, 10), []);
  store.close();
});

test('recordFindings tags each finding with its collection method, defaulting to static', () => {
  const store = freshStore();
  const id = store.createAudit({ siteOrigin: 'https://example.com', startUrl: 'https://example.com/', config: {} });
  store.recordFindings(id, 'https://example.com/a', [{ ruleId: 'seo.title-missing', category: 'fix', severity: 'high', fingerprint: 'x' }]);
  store.recordFindings(id, 'https://example.com/a', [{ ruleId: 'axe.color-contrast', category: 'fix', severity: 'high', fingerprint: 'y' }], { collectionMethod: 'rendered' });
  const findings = store.listFindings(id);
  assert.equal(findings.find((f) => f.rule_id === 'seo.title-missing').collection_method, 'static');
  assert.equal(findings.find((f) => f.rule_id === 'axe.color-contrast').collection_method, 'rendered');
  store.close();
});

test('opening a pre-existing database created before the owner column existed migrates in place instead of crashing', () => {
  // Reproduces a real failure: a deployment's data/audits.db (persisted
  // across redeploys via services/api/Dockerfile's VOLUME) predates the
  // tenant-isolation "owner" column. CREATE TABLE IF NOT EXISTS is a no-op
  // against an existing table, so opening an old database must migrate the
  // schema forward rather than throw "no such column: owner" on boot.
  const dbPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'audit-store-')), 'audits.db');
  const legacy = new DatabaseSync(dbPath);
  legacy.exec(`
    CREATE TABLE audits (
      id TEXT PRIMARY KEY, site_origin TEXT NOT NULL, start_url TEXT NOT NULL, config_json TEXT NOT NULL,
      status TEXT NOT NULL, phase TEXT NOT NULL, error TEXT, created_at TEXT NOT NULL,
      started_at TEXT, completed_at TEXT, stats_json TEXT
    );
  `);
  legacy.prepare('INSERT INTO audits (id, site_origin, start_url, config_json, status, phase, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run('audit_legacy', 'https://example.com', 'https://example.com/', '{}', 'complete', 'analyzing', new Date().toISOString());
  legacy.close();

  const store = openAuditStore(dbPath);
  const migrated = store.getAudit('audit_legacy');
  assert.equal(migrated.owner, 'shared', 'pre-existing rows must default to the shared owner, not null or an error');
  const newId = store.createAudit({ siteOrigin: 'https://example.com', startUrl: 'https://example.com/', config: {} });
  assert.deepEqual(store.listAudits('https://example.com', 'shared').map((a) => a.id).sort(), ['audit_legacy', newId].sort());
  store.close();
});

test('opening a database predating the render-pass columns (audit_urls.rendered, audit_findings.collection_method) migrates in place', () => {
  // The real deployed data/audits.db this session was live-testing against
  // was created before the local render pass existed at all — it has
  // audit_urls and audit_findings tables with none of these columns. Every
  // production database in that state must boot cleanly, not just a
  // synthetic one missing only the "audits" table.
  const dbPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'audit-store-')), 'audits.db');
  const legacy = new DatabaseSync(dbPath);
  legacy.exec(`
    CREATE TABLE audits (
      id TEXT PRIMARY KEY, site_origin TEXT NOT NULL, start_url TEXT NOT NULL, config_json TEXT NOT NULL,
      status TEXT NOT NULL, phase TEXT NOT NULL, error TEXT, created_at TEXT NOT NULL,
      started_at TEXT, completed_at TEXT, stats_json TEXT, owner TEXT NOT NULL DEFAULT 'shared'
    );
    CREATE TABLE audit_urls (
      id INTEGER PRIMARY KEY AUTOINCREMENT, audit_id TEXT NOT NULL, url TEXT NOT NULL, normalized_url TEXT NOT NULL,
      discovered_via TEXT, status TEXT NOT NULL, http_status INTEGER, final_url TEXT, redirected INTEGER DEFAULT 0,
      collection_method TEXT, title TEXT, meta_description TEXT, canonical TEXT, indexable INTEGER,
      h1_count INTEGER, word_count INTEGER, error TEXT, fetched_at TEXT, UNIQUE(audit_id, normalized_url)
    );
    CREATE TABLE audit_findings (
      id INTEGER PRIMARY KEY AUTOINCREMENT, audit_id TEXT NOT NULL, url TEXT NOT NULL, rule_id TEXT NOT NULL,
      title TEXT, detail TEXT, category TEXT, severity TEXT, confidence TEXT, impact_class TEXT,
      fingerprint TEXT, count INTEGER DEFAULT 1, evidence_json TEXT, created_at TEXT
    );
  `);
  legacy.prepare('INSERT INTO audit_urls (audit_id, url, normalized_url, status) VALUES (?, ?, ?, ?)')
    .run('audit_legacy', 'https://example.com/', 'https://example.com/', 'fetched');
  legacy.close();

  const store = openAuditStore(dbPath);
  assert.deepEqual(store.renderProgress('audit_legacy'), { total: 1, rendered: 0, remaining: 1 });
  assert.deepEqual(store.nextUrlsNeedingRender('audit_legacy', 10).map((r) => r.url), ['https://example.com/']);
  store.recordFindings('audit_legacy', 'https://example.com/', [{ ruleId: 'seo.title-missing', category: 'fix', severity: 'high', fingerprint: 'x' }]);
  assert.equal(store.listFindings('audit_legacy')[0].collection_method, 'static');
  store.close();
});

test('newAuditId produces distinct, url-safe ids', () => {
  const ids = new Set(Array.from({ length: 50 }, () => newAuditId()));
  assert.equal(ids.size, 50);
  for (const id of ids) assert.match(id, /^audit_[A-Za-z0-9_-]+$/);
});

test('deleting an audit takes everything recorded under it', () => {
  // Every table keys on audit_id and none of them cascade, so removing only the
  // audit row would leave its pages, links, findings, schema and sitemap behind
  // as rows belonging to an audit that no longer exists. Those still answer a
  // COUNT, from data nothing can reach, which is worse than not deleting.
  const store = openAuditStore(':memory:');
  const id = store.createAudit({ siteOrigin: 'https://example.com', startUrl: 'https://example.com/', config: {} });
  store.enqueueUrl(id, 'https://example.com/a', 'link', 1);
  store.recordUrlResult(id, 'https://example.com/a', { status: 'fetched', httpStatus: 200, title: 'A' });
  store.recordFindings(id, 'https://example.com/a', [{ ruleId: 'seo.title-long', title: 'x', category: 'fix', severity: 'low', confidence: 'confirmed' }]);
  store.recordSchema(id, 'https://example.com/a', { items: [{ type: 'Article', props: {}, propKeys: [] }] });
  store.recordSitemapUrls(id, [{ normalized: 'https://example.com/a', url: 'https://example.com/a' }]);

  assert.equal(store.listUrls(id, { limit: 10 }).length, 1);
  assert.equal(store.sitemapUrlCount(id), 1);
  assert.equal(store.schemaItemCount(id), 1);

  assert.equal(store.deleteAudit(id), true);
  assert.equal(store.getAudit(id), null);
  assert.equal(store.listUrls(id, { limit: 10 }).length, 0);
  assert.equal(store.listFindings(id, { limit: 10 }).length, 0);
  assert.equal(store.sitemapUrlCount(id), 0);
  assert.equal(store.schemaItemCount(id), 0);

  // Deleting what is not there is not an error, and says so.
  assert.equal(store.deleteAudit(id), false);
  assert.equal(store.deleteAudit(''), false);
});
