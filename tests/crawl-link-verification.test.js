import test from 'node:test';
import assert from 'node:assert/strict';
import { createUnverifiableLedger, isKnownUnverifiableHost, isRejectionStatus, hostKey } from '../packages/crawl/link-verification.js';

test('subdomains of a known platform resolve to the same host key', () => {
  assert.equal(hostKey('https://www.facebook.com/a-page'), 'facebook.com');
  assert.equal(hostKey('https://m.facebook.com/x'), 'facebook.com');
  assert.equal(hostKey('https://facebook.com/x'), 'facebook.com');
  assert.ok(isKnownUnverifiableHost('https://www.facebook.com/x'));
  assert.ok(isKnownUnverifiableHost('https://www.linkedin.com/company/x'));
  // A client's own site is never on this list.
  assert.ok(!isKnownUnverifiableHost('https://example.com/'));
  assert.ok(!isKnownUnverifiableHost('https://example.org/estate/wills/x.html'));
});

test('a rejection status is one that describes the probe, not the resource', () => {
  // Facebook answers our probe with 400; others use 403/429; 0 is a reset.
  for (const status of [0, 400, 401, 403, 405, 429, 999]) assert.ok(isRejectionStatus(status), `${status} should be a rejection`);
  // A real answer about the resource is not a rejection.
  for (const status of [200, 301, 404, 410, 500, 503]) assert.ok(!isRejectionStatus(status), `${status} should not be a rejection`);
});

test('a footer link repeated across pages is one coverage fact, counted, not N of them', () => {
  const ledger = createUnverifiableLedger();
  const target = 'https://www.facebook.com/a-page';
  for (const page of ['https://example.com/', 'https://example.com/a', 'https://example.com/b', 'https://example.com/c']) {
    assert.equal(ledger.record(target, 400, page), true, 'each occurrence is accounted as coverage');
  }
  const summary = ledger.summary();
  assert.equal(summary.destinationCount, 1, 'one destination, however many pages link to it');
  assert.equal(summary.occurrenceCount, 4);
  assert.deepEqual(summary.hosts, ['facebook.com']);
  assert.equal(summary.destinations[0].sourcePages, 4);
  assert.equal(summary.destinations[0].occurrences, 4);
  assert.match(summary.destinations[0].reason, /Facebook rejects automated requests/);
});

test('a known platform that actually answers is not coverage, and an unknown host that rejects stays a finding', () => {
  const ledger = createUnverifiableLedger();
  // 200 from Facebook: verified, nothing to excuse.
  assert.equal(ledger.record('https://www.facebook.com/x', 200, 'https://example.com/'), false);
  // A 404 anywhere is a real answer about the resource.
  assert.equal(ledger.record('https://www.facebook.com/x', 404, 'https://example.com/'), false);
  // An unknown host rejecting us is genuinely unexplained, so it must NOT be
  // silently absorbed into coverage — it still deserves to surface.
  assert.equal(ledger.record('https://example.org/x', 403, 'https://example.com/'), false);
  assert.equal(ledger.summary().destinationCount, 0);
});

test('destinations are reported most-repeated first, so the worst offender leads', () => {
  const ledger = createUnverifiableLedger();
  ledger.record('https://www.linkedin.com/company/x', 999, 'https://example.com/');
  for (let i = 0; i < 5; i++) ledger.record('https://www.facebook.com/x', 400, `https://example.com/${i}`);
  const summary = ledger.summary();
  assert.equal(summary.destinationCount, 2);
  assert.equal(summary.occurrenceCount, 6);
  assert.equal(summary.destinations[0].host, 'facebook.com');
  assert.deepEqual(summary.hosts, ['facebook.com', 'linkedin.com']);
});

// --- wiring: the crawl must carry the coverage statement out with its stats ---
import { openAuditStore } from '../packages/crawl/store.js';
import { runAudit, planCrawlConfig } from '../packages/crawl/crawler.js';

function page({ url, links = [] }) {
  return {
    ok: true, httpStatus: 200, finalUrl: url, redirected: false, isHtml: true, contentType: 'text/html',
    title: 'Page', titleCount: 1, description: 'Description', descriptionCount: 1,
    canonical: url, canonicalCount: 1, robots: '', h1s: ['H1'], wordCount: 200, links,
    schemaBlockCount: 1, schemaInvalidCount: 0, schemaTypes: ['WebPage']
  };
}

test('a social footer link on every page becomes one counted coverage fact, not a finding per page', async () => {
  const store = openAuditStore(':memory:');
  const origin = 'https://client.example.com';
  const home = `${origin}/`;
  const a = `${origin}/a`;
  const b = `${origin}/b`;
  const social = 'https://www.facebook.com/a-page';
  const genuine404 = 'https://vendor.example.com/gone';
  const footer = [{ url: social, text: 'Facebook' }, { url: genuine404, text: 'Vendor' }];
  const pages = {
    [home]: page({ url: home, links: [{ url: a, text: 'A' }, { url: b, text: 'B' }, ...footer] }),
    [a]: page({ url: a, links: footer }),
    [b]: page({ url: b, links: footer })
  };
  const id = store.createAudit({ siteOrigin: origin, startUrl: home, config: { maxPages: 10 } });
  const config = planCrawlConfig({ maxPages: 10, respectRobots: false });
  const result = await runAudit({
    auditId: id, startUrl: home, config, store,
    collectPage: async (url) => pages[url] || page({ url }),
    // Facebook answers an automated probe with 400; the vendor link is really gone.
    checkLink: async (url) => ({ url, status: url === social ? 400 : url === genuine404 ? 404 : 200, finalUrl: url, redirected: false, method: 'GET', attempts: 1 })
  });

  const cov = result.stats.unverifiableExternal;
  assert.ok(cov, 'the crawl must carry an unverifiable-external coverage statement');
  assert.equal(cov.destinationCount, 1, 'one destination, however many pages carry the footer');
  assert.equal(cov.occurrenceCount, 3, 'but the occurrences are still counted honestly');
  assert.deepEqual(cov.hosts, ['facebook.com']);
  assert.equal(cov.destinations[0].sourcePages, 3);

  const findings = store.listFindings(id);
  assert.equal(findings.filter((f) => (f.detail || '').includes('facebook.com')).length, 0, 'a platform that refuses robots must never become a finding');

  // The genuinely broken vendor link is untouched: it still reports per page,
  // because which pages carry a confirmed defect is what tells you where to fix it.
  const broken = findings.filter((f) => f.rule_id === 'navigation.link-404-external');
  assert.equal(broken.length, 3, 'a real 404 still reports against every page that links to it');
  store.close();
});
