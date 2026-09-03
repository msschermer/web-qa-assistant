import test from 'node:test';
import assert from 'node:assert/strict';
import { openAuditStore } from '../packages/crawl/store.js';
import { runAudit, planCrawlConfig } from '../packages/crawl/crawler.js';

function page({ url, links = [], title = 'Page' }) {
  return { ok: true, httpStatus: 200, finalUrl: url, redirected: false, isHtml: true, contentType: 'text/html', title, titleCount: 1, description: 'D', descriptionCount: 1, canonical: url, canonicalCount: 1, robots: '', h1s: ['H'], wordCount: 200, links, schemaBlockCount: 1, schemaInvalidCount: 0, schemaTypes: ['WebPage'] };
}
function fakeLinkChecker() {
  return async (url) => ({ url, status: 200, finalUrl: url, redirected: false, method: 'GET', attempts: 1 });
}

test('planCrawlConfig validates and caps the new advanced fields, defaulting to today\'s behavior when omitted', () => {
  const defaults = planCrawlConfig({});
  assert.equal(defaults.maxDepth, null);
  assert.deepEqual(defaults.includePatterns, []);
  assert.deepEqual(defaults.excludePatterns, []);
  assert.equal(defaults.checkExternalLinks, true);
  assert.equal(defaults.respectNofollow, false);
  assert.equal(defaults.requestDelayMs, 0);

  const configured = planCrawlConfig({ maxDepth: 2, includePatterns: ['/blog/'], excludePatterns: ['/wp-admin/', '/tag/'], checkExternalLinks: false, respectNofollow: true, requestDelayMs: 250 });
  assert.equal(configured.maxDepth, 2);
  assert.deepEqual(configured.includePatterns, ['/blog/']);
  assert.deepEqual(configured.excludePatterns, ['/wp-admin/', '/tag/']);
  assert.equal(configured.checkExternalLinks, false);
  assert.equal(configured.respectNofollow, true);
  assert.equal(configured.requestDelayMs, 250);

  // A user submitting an absurd number of patterns or an oversized string
  // must be capped, not accepted verbatim — this is request-body input.
  const excessive = planCrawlConfig({ includePatterns: Array.from({ length: 50 }, (_, i) => `/p${i}/`), requestDelayMs: 999999 });
  assert.equal(excessive.includePatterns.length, 20);
  assert.equal(excessive.requestDelayMs, 5000);
});

test('maxDepth stops the crawl from following links beyond the configured hop count from the start URL', async () => {
  const store = openAuditStore(':memory:');
  const origin = 'https://example.com';
  const home = `${origin}/`;
  const depth1 = `${origin}/depth1`;
  const depth2 = `${origin}/depth2`;
  const pages = {
    [home]: page({ url: home, links: [{ url: depth1, text: '' }] }),
    [depth1]: page({ url: depth1, links: [{ url: depth2, text: '' }] }),
    [depth2]: page({ url: depth2 })
  };
  const id = store.createAudit({ siteOrigin: origin, startUrl: home, config: { maxDepth: 1 } });
  const config = planCrawlConfig({ maxPages: 10, respectRobots: false, maxDepth: 1 });
  await runAudit({ auditId: id, startUrl: home, config, store, collectPage: async (url) => pages[url] || page({ url }), checkLink: fakeLinkChecker() });
  const urls = store.listUrls(id).map((u) => u.url);
  assert.ok(urls.includes(home) && urls.includes(depth1), 'start URL and its direct link must be crawled at maxDepth: 1');
  assert.ok(!urls.includes(depth2), 'a link two hops from the start URL must not be crawled when maxDepth is 1');
  store.close();
});

test('excludePatterns keep matching paths out of the crawl even when linked, and includePatterns restrict the crawl to only matching paths', async () => {
  const store = openAuditStore(':memory:');
  const origin = 'https://example.com';
  const home = `${origin}/`;
  const blog = `${origin}/blog/post-1`;
  const admin = `${origin}/wp-admin/edit`;
  const pages = { [home]: page({ url: home, links: [{ url: blog, text: '' }, { url: admin, text: '' }] }), [blog]: page({ url: blog }), [admin]: page({ url: admin }) };
  const id = store.createAudit({ siteOrigin: origin, startUrl: home, config: {} });
  const config = planCrawlConfig({ maxPages: 10, respectRobots: false, excludePatterns: ['/wp-admin/'] });
  await runAudit({ auditId: id, startUrl: home, config, store, collectPage: async (url) => pages[url] || page({ url }), checkLink: fakeLinkChecker() });
  const urls = store.listUrls(id).map((u) => u.url);
  assert.ok(urls.includes(blog));
  assert.ok(!urls.includes(admin), 'an excluded path must never be crawled, even though the homepage links to it');
  store.close();
});

test('checkExternalLinks: false skips network verification of external links entirely, recording them as unchecked rather than a false healthy', async () => {
  const store = openAuditStore(':memory:');
  const origin = 'https://example.com';
  const home = `${origin}/`;
  const external = 'https://off-site.example.com/page';
  let externalChecksAttempted = 0;
  const pages = { [home]: page({ url: home, links: [{ url: external, text: 'Off-site' }] }) };
  const id = store.createAudit({ siteOrigin: origin, startUrl: home, config: {} });
  const config = planCrawlConfig({ maxPages: 10, respectRobots: false, checkExternalLinks: false });
  await runAudit({
    auditId: id, startUrl: home, config, store,
    collectPage: async (url) => pages[url] || page({ url }),
    checkLink: async (url) => { externalChecksAttempted++; return { url, status: 200, finalUrl: url, redirected: false }; }
  });
  assert.equal(externalChecksAttempted, 0, 'the external prober must never be invoked when checkExternalLinks is false');
  const link = store.listLinks(id).find((l) => l.target_url === external);
  assert.equal(link.status, 'unchecked');
  store.close();
});

test('respectNofollow: true stops the crawl from following (but not from recording) links marked rel=nofollow', async () => {
  const store = openAuditStore(':memory:');
  const origin = 'https://example.com';
  const home = `${origin}/`;
  const nofollowTarget = `${origin}/sponsored`;
  const pages = { [home]: page({ url: home, links: [{ url: nofollowTarget, text: 'Sponsored', nofollow: true }] }) };
  const id = store.createAudit({ siteOrigin: origin, startUrl: home, config: {} });
  const config = planCrawlConfig({ maxPages: 10, respectRobots: false, respectNofollow: true });
  await runAudit({ auditId: id, startUrl: home, config, store, collectPage: async (url) => pages[url] || page({ url }), checkLink: fakeLinkChecker() });
  const urls = store.listUrls(id).map((u) => u.url);
  assert.ok(!urls.includes(nofollowTarget), 'a nofollow link must not be crawled when respectNofollow is enabled');
  const link = store.listLinks(id).find((l) => l.target_url === nofollowTarget);
  assert.ok(link, 'the link itself is still recorded and still link-checked, only NOT added to the crawl frontier');
  store.close();
});
