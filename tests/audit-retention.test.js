/**
 * Retention is a promise about a client's data, so the policy is tested as a
 * pure decision rather than only through a live store: given these rows and
 * this clock, exactly these ids are deleted.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  selectPurgeableAudits,
  purgeAudits,
  retentionPolicyFromEnv,
  describeRetention,
  RETENTION_DEFAULTS
} from '../packages/crawl/retention.js';
import { openAuditStore } from '../packages/crawl/store.js';

const NOW = Date.parse('2026-09-05T12:00:00.000Z');
const hoursAgo = (h) => new Date(NOW - h * 3600_000).toISOString();

function row(id, { site = 'https://example.com', owner = 'shared', status = 'complete', age = 1 } = {}) {
  return { id, site_origin: site, owner, status, created_at: hoursAgo(age) };
}

const ids = (list) => list.map((r) => r.id).sort();

test('an audit older than the TTL is purged, a newer one is kept', () => {
  const rows = [row('old', { age: 200 }), row('fresh', { age: 2 })];
  const out = selectPurgeableAudits(rows, { now: NOW, ttlHours: 168, keepPerSite: 0 });
  assert.deepEqual(ids(out), ['old']);
  assert.equal(out[0].reason, 'expired');
});

test('a running or queued audit is never purged, however old', () => {
  // The render pass deliberately survives a closed panel, so age alone must not
  // delete the rows underneath a crawl that still owns them.
  const rows = [
    row('running', { age: 5000, status: 'running' }),
    row('queued', { age: 5000, status: 'queued' }),
    row('paused', { age: 5000, status: 'paused' }),
    row('done', { age: 5000, status: 'complete' })
  ];
  const out = selectPurgeableAudits(rows, { now: NOW, ttlHours: 1, keepPerSite: 0 });
  assert.deepEqual(ids(out), ['done']);
});

test('only the newest N per site survive the count rule', () => {
  const rows = [1, 2, 3, 4, 5, 6, 7].map((n) => row(`a${n}`, { age: n }));
  const out = selectPurgeableAudits(rows, { now: NOW, ttlHours: 0, keepPerSite: 5 });
  // age 1 is newest, so 6 and 7 are the two oldest and the ones to go.
  assert.deepEqual(ids(out), ['a6', 'a7']);
  assert.ok(out.every((o) => o.reason === 'over-count'));
});

test('the count rule is per site and per owner, not global', () => {
  const rows = [
    ...[1, 2, 3].map((n) => row(`x${n}`, { site: 'https://example.org', age: n })),
    ...[1, 2, 3].map((n) => row(`y${n}`, { site: 'https://example.net', age: n })),
    ...[1, 2, 3].map((n) => row(`z${n}`, { site: 'https://example.org', owner: 'other', age: n }))
  ];
  assert.deepEqual(selectPurgeableAudits(rows, { now: NOW, ttlHours: 0, keepPerSite: 3 }), []);
  const out = selectPurgeableAudits(rows, { now: NOW, ttlHours: 0, keepPerSite: 2 });
  assert.deepEqual(ids(out), ['x3', 'y3', 'z3']);
});

test('an audit failing both rules is reported once, as expired', () => {
  const rows = [...[1, 2, 3, 4, 5].map((n) => row(`keep${n}`, { age: n })), row('doomed', { age: 900 })];
  const out = selectPurgeableAudits(rows, { now: NOW, ttlHours: 168, keepPerSite: 5 });
  assert.equal(out.length, 1);
  assert.equal(out[0].id, 'doomed');
  assert.equal(out[0].reason, 'expired');
});

test('a row with an unreadable timestamp is not deleted on age', () => {
  // An unparseable date is not evidence of age; the count rule still governs it.
  const rows = [{ id: 'undated', site_origin: 'https://example.com', owner: 'shared', status: 'complete', created_at: 'not-a-date' }];
  assert.deepEqual(selectPurgeableAudits(rows, { now: NOW, ttlHours: 1, keepPerSite: 0 }), []);
});

test('zero disables a rule but a bad value falls back rather than keeping forever', () => {
  assert.deepEqual(retentionPolicyFromEnv({ AUDIT_RETENTION_HOURS: '0' }), { ttlHours: 0, keepPerSite: 5 });
  assert.deepEqual(retentionPolicyFromEnv({ AUDIT_RETENTION_HOURS: 'banana' }), RETENTION_DEFAULTS);
  assert.deepEqual(retentionPolicyFromEnv({ AUDIT_KEEP_PER_SITE: '-3' }), RETENTION_DEFAULTS);
  assert.deepEqual(retentionPolicyFromEnv({}), RETENTION_DEFAULTS);
});

test('the policy describes itself in a sentence a client can be shown', () => {
  assert.equal(describeRetention({ ttlHours: 168, keepPerSite: 5 }),
    'Audits are deleted after 7 days, and only the 5 most recent per site are kept.');
  assert.equal(describeRetention({ ttlHours: 24, keepPerSite: 0 }), 'Audits are deleted after 1 day.');
  assert.equal(describeRetention({ ttlHours: 5, keepPerSite: 0 }), 'Audits are deleted after 5 hours.');
  assert.equal(describeRetention({ ttlHours: 0, keepPerSite: 0 }), 'Audits are kept until deleted manually.');
});

test('purging a real store removes the audit and everything hanging off it', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lumen-retention-'));
  const store = openAuditStore(path.join(dir, 'audits.db'));
  try {
    const origin = 'https://example.com';
    for (const [id, age] of [['keep', 1], ['drop', 900]]) {
      store.createAudit({ id, siteOrigin: origin, startUrl: `${origin}/`, config: { maxPages: 2 } });
      store.enqueueUrl(id, `${origin}/page-${id}`, 'link', 1);
      store.recordUrlResult(id, `${origin}/page-${id}`, { status: 'fetched', httpStatus: 200, finalUrl: `${origin}/page-${id}`, title: 'T' });
      store.recordFindings(id, `${origin}/page-${id}`, [{ ruleId: 'seo.title-short', title: 'x', detail: 'y', category: 'review', severity: 'low', confidence: 'confirmed' }]);
      store.finishAudit(id, { status: 'complete', stats: {} });
      // Backdate by rewriting created_at the way age would have.
      store.raw.prepare('UPDATE audits SET created_at = ? WHERE id = ?')
        .run(new Date(Date.now() - age * 3600_000).toISOString(), id);
    }
    assert.equal(store.auditsForRetention().length, 2);

    const result = purgeAudits(store, { ttlHours: 168, keepPerSite: 5 });
    assert.equal(result.deleted, 1);
    assert.equal(result.expired, 1);

    assert.ok(store.getAudit('keep'));
    assert.ok(!store.getAudit('drop'), 'the expired audit row is gone');
    // The cascade matters: an orphaned findings row would keep client evidence
    // after the audit that explains it is gone.
    assert.equal(store.listFindings('drop', { limit: 10, offset: 0 }).length, 0);
    assert.equal(store.listUrls('drop', { limit: 10 }).length, 0);
  } finally {
    try { store.close?.(); } catch { /* better-sqlite3 may already be closed */ }
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
