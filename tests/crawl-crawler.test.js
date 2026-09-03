import test from 'node:test';
import assert from 'node:assert/strict';
import { openAuditStore } from '../packages/crawl/store.js';
import { runAudit, isCrawlableStartUrl, planCrawlConfig, CRAWL_LIMITS } from '../packages/crawl/crawler.js';

// A tiny fake page factory, shaped like static-collector.js's collectStaticPage()
// resolution (no browser involved — see crawler.js's module doc for why the
// crawl's default collection tier is HTML fetch + parse, never a headless render).
function page({ url, title = 'Page', description = 'Description', canonical, h1s = ['H1'], links = [], httpStatus = 200, isHtml = true, robots = '', schemaBlockCount = 1, schemaInvalidCount = 0, schemaTypes = ['WebPage'], wordCount = 200 }) {
  return {
    ok: true, httpStatus, finalUrl: url, redirected: false, isHtml, contentType: 'text/html',
    title, titleCount: title ? 1 : 0, description, descriptionCount: description ? 1 : 0,
    canonical: canonical ?? url, canonicalCount: canonical === undefined ? 1 : (canonical ? 1 : 0),
    robots, h1s, wordCount, links, schemaBlockCount, schemaInvalidCount, schemaTypes
  };
}
function fakeLinkChecker(statusByUrl) {
  return async (url) => {
    const status = statusByUrl[url] ?? 200;
    return { url, status, finalUrl: url, redirected: false, method: status ? 'HEAD' : 'GET', attempts: 1 };
  };
}

test('isCrawlableStartUrl rejects private/invalid destinations and normalizes the rest', () => {
  assert.equal(isCrawlableStartUrl('http://127.0.0.1/').ok, false);
  assert.equal(isCrawlableStartUrl('ftp://example.com/').ok, false);
  assert.equal(isCrawlableStartUrl('not a url').ok, false);
  const ok = isCrawlableStartUrl('https://example.com/path#frag');
  assert.equal(ok.ok, true);
  assert.equal(ok.url, 'https://example.com/path');
});

test('planCrawlConfig clamps maxPages and concurrency to sane, hard-capped ranges', () => {
  assert.equal(planCrawlConfig({ maxPages: 999999 }).maxPages, CRAWL_LIMITS.hardMaxPages);
  assert.equal(planCrawlConfig({ maxPages: 0 }).maxPages, CRAWL_LIMITS.defaultMaxPages);
  assert.equal(planCrawlConfig({ concurrency: 999 }).concurrency, CRAWL_LIMITS.maxConcurrency);
  assert.equal(planCrawlConfig({}).respectRobots, true);
});

test('a two-page site is crawled breadth-first, links and findings are recorded, and the frontier closes', async () => {
  const store = openAuditStore(':memory:');
  const origin = 'https://shop.example.com';
  const home = `${origin}/`;
  const about = `${origin}/about`;
  const external = 'https://dead-external.example.com/gone';
  const pages = {
    [home]: page({ url: home, title: 'Home', links: [{ url: about, text: 'About' }, { url: external, text: 'External' }] }),
    [about]: page({ url: about, title: '', description: '', canonical: '', links: [{ url: home, text: 'Home' }] })
  };
  const id = store.createAudit({ siteOrigin: origin, startUrl: home, config: { maxPages: 10 } });
  const config = planCrawlConfig({ maxPages: 10, concurrency: 2, respectRobots: false });
  const progressPhases = [];
  const result = await runAudit({
    auditId: id, startUrl: home, config, store,
    collectPage: async (url) => pages[url] || page({ url }),
    checkLink: fakeLinkChecker({ [external]: 404 }),
    onProgress: (p) => progressPhases.push(p.phase)
  });

  assert.equal(result.cancelled, false);
  const urlCounts = store.urlCountsByStatus(id);
  assert.equal(urlCounts.fetched, 2, 'both discovered pages must be fetched exactly once');
  assert.equal(urlCounts.queued || 0, 0, 'the frontier must drain once every reachable page is processed');

  const urls = store.listUrls(id);
  const aboutRow = urls.find((u) => u.url === about);
  assert.equal(aboutRow.discovered_via, 'link', 'about was only reachable via the home page link, not the start URL');
  assert.equal(aboutRow.collection_method, 'static');

  const links = store.listLinks(id);
  assert.ok(links.some((l) => l.target_url === external && l.status === 'broken'));
  assert.ok(links.some((l) => l.target_url === about && l.internal === 1 && l.status === 'healthy'));

  const findings = store.listFindings(id);
  assert.ok(findings.some((f) => f.rule_id === 'navigation.link-404-external'), 'the broken external link must produce a finding');
  assert.ok(findings.some((f) => f.rule_id === 'seo.title-missing'), 'the about page has no title in static HTML');
  assert.ok(findings.every((f) => f.collection_method === 'static'), 'the crawl itself never produces rendered findings');

  assert.ok(progressPhases.includes('discovering'));
  assert.ok(progressPhases.includes('crawling'));
  assert.ok(progressPhases.includes('analyzing'));
  store.close();
});

test('a link shared by every page is checked once but a finding is recorded against every page that links to it', async () => {
  // This is what keeps link-checking cheap on a real site (a broken footer
  // link is one HTTP request, not one per page) while still letting the
  // audit's own findingsByRule grouping show "N of M pages share this link".
  const store = openAuditStore(':memory:');
  const origin = 'https://big.example.com';
  const home = `${origin}/`;
  const a = `${origin}/a`;
  const b = `${origin}/b`;
  const brokenFooterLink = 'https://vendor.example.com/gone';
  let brokenLinkCheckCalls = 0;
  const pages = {
    [home]: page({ url: home, links: [{ url: a, text: 'A' }, { url: b, text: 'B' }] }),
    [a]: page({ url: a, links: [{ url: brokenFooterLink, text: 'Footer' }] }),
    [b]: page({ url: b, links: [{ url: brokenFooterLink, text: 'Footer' }] })
  };
  const id = store.createAudit({ siteOrigin: origin, startUrl: home, config: { maxPages: 10 } });
  const config = planCrawlConfig({ maxPages: 10, respectRobots: false });
  await runAudit({
    auditId: id, startUrl: home, config, store,
    collectPage: async (url) => pages[url] || page({ url }),
    checkLink: async (url) => {
      if (url === brokenFooterLink) brokenLinkCheckCalls++;
      return { url, status: url === brokenFooterLink ? 404 : 200, finalUrl: url, redirected: false, method: 'GET', attempts: 2 };
    }
  });
  assert.equal(brokenLinkCheckCalls, 1, 'the shared broken link must be checked exactly once across the whole audit, no matter how many pages link to it');
  const brokenFindings = store.listFindings(id).filter((f) => f.rule_id === 'navigation.link-404-external');
  assert.equal(brokenFindings.length, 2, 'both pages linking to it must each get their own finding');
  assert.deepEqual(new Set(brokenFindings.map((f) => f.url)), new Set([a, b]));
  store.close();
});

test('missing or invalid structured data produces a finding, and detected schema types are persisted on the URL row', async () => {
  const store = openAuditStore(':memory:');
  const origin = 'https://shop.example.com';
  const home = `${origin}/`;
  const noSchema = `${origin}/no-schema`;
  const badSchema = `${origin}/bad-schema`;
  const pages = {
    [home]: page({ url: home, links: [{ url: noSchema, text: '' }, { url: badSchema, text: '' }], schemaTypes: ['Organization', 'WebPage'] }),
    [noSchema]: page({ url: noSchema, schemaBlockCount: 0, schemaTypes: [] }),
    [badSchema]: page({ url: badSchema, schemaBlockCount: 1, schemaInvalidCount: 1, schemaTypes: [] })
  };
  const id = store.createAudit({ siteOrigin: origin, startUrl: home, config: { maxPages: 10 } });
  const config = planCrawlConfig({ maxPages: 10, respectRobots: false });
  await runAudit({
    auditId: id, startUrl: home, config, store,
    collectPage: async (url) => pages[url] || page({ url }),
    checkLink: fakeLinkChecker({})
  });
  const findings = store.listFindings(id);
  const missing = findings.find((f) => f.rule_id === 'schema.missing' && f.url === noSchema);
  assert.ok(missing, 'a page with zero JSON-LD blocks must be flagged');
  assert.equal(missing.confidence, 'inferred', 'absence can only be inferred from static HTML — some sites inject schema via JS, which this tier cannot see');
  const invalid = findings.find((f) => f.rule_id === 'schema.invalid-json' && f.url === badSchema);
  assert.ok(invalid, 'a JSON-LD block that fails to parse must be flagged');
  assert.equal(invalid.confidence, 'confirmed', 'a block that IS present and fails to parse is a real, directly-observed defect');
  assert.ok(!findings.some((f) => f.rule_id.startsWith('schema.') && f.url === home), 'a page with valid schema must not be flagged');
  const homeRow = store.listUrls(id).find((u) => u.url === home);
  assert.deepEqual(JSON.parse(homeRow.schema_types), ['Organization', 'WebPage']);
  store.close();
});

test('two pages sharing an identical title or description are flagged as duplicates of each other, and a unique page is not', async () => {
  // Reproduced live against a real site (a WordPress "duplicate post" plugin
  // had generated a second copy of the same article at a "-2" slug, both
  // pages carrying the exact same <title>) — Sitebulb-style crawlers treat
  // this as a standard SEO finding, and it can only be detected by comparing
  // pages against each other after the whole crawl completes, not per-page.
  const store = openAuditStore(':memory:');
  const origin = 'https://shop.example.com';
  const home = `${origin}/`;
  const dup1 = `${origin}/estate-guide`;
  const dup2 = `${origin}/estate-guide-2`;
  const unique = `${origin}/unique-page`;
  const pages = {
    [home]: page({ url: home, links: [{ url: dup1, text: '' }, { url: dup2, text: '' }, { url: unique, text: '' }] }),
    [dup1]: page({ url: dup1, title: 'Estate Planning Guide', description: 'Learn the basics.' }),
    [dup2]: page({ url: dup2, title: 'Estate Planning Guide', description: 'Learn the basics.' }),
    [unique]: page({ url: unique, title: 'Unique Page Title', description: 'A different summary entirely.' })
  };
  const id = store.createAudit({ siteOrigin: origin, startUrl: home, config: { maxPages: 10 } });
  const config = planCrawlConfig({ maxPages: 10, respectRobots: false });
  await runAudit({
    auditId: id, startUrl: home, config, store,
    collectPage: async (url) => pages[url] || page({ url }),
    checkLink: fakeLinkChecker({})
  });
  const findings = store.listFindings(id);
  for (const url of [dup1, dup2]) {
    const titleFinding = findings.find((f) => f.rule_id === 'seo.duplicate-title' && f.url === url);
    assert.ok(titleFinding, `${url} must be flagged for sharing its title with another page`);
    assert.equal(titleFinding.confidence, 'confirmed', 'the title text itself was directly observed, not guessed');
    const descFinding = findings.find((f) => f.rule_id === 'seo.duplicate-description' && f.url === url);
    assert.ok(descFinding, `${url} must be flagged for sharing its description with another page`);
  }
  assert.ok(!findings.some((f) => f.rule_id === 'seo.duplicate-title' && f.url === unique), 'a page with a one-of-a-kind title must not be flagged');
  assert.ok(!findings.some((f) => f.rule_id === 'seo.duplicate-title' && f.url === home), 'the homepage title (unique here) must not be flagged');
  store.close();
});

test('a page with very little text is flagged as thin content, with an honest inferred confidence since a static fetch cannot see JS-rendered text', async () => {
  const store = openAuditStore(':memory:');
  const origin = 'https://shop.example.com';
  const home = `${origin}/`;
  const thin = `${origin}/thin-page`;
  const pages = {
    [home]: page({ url: home, links: [{ url: thin, text: '' }] }),
    [thin]: page({ url: thin, wordCount: 40 })
  };
  const id = store.createAudit({ siteOrigin: origin, startUrl: home, config: { maxPages: 10 } });
  const config = planCrawlConfig({ maxPages: 10, respectRobots: false });
  await runAudit({
    auditId: id, startUrl: home, config, store,
    collectPage: async (url) => pages[url] || page({ url }),
    checkLink: fakeLinkChecker({})
  });
  const findings = store.listFindings(id);
  const thinFinding = findings.find((f) => f.rule_id === 'seo.thin-content' && f.url === thin);
  assert.ok(thinFinding, 'a 40-word page must be flagged as thin content');
  assert.equal(thinFinding.confidence, 'inferred', 'static word count can undercount JS-rendered content, so this cannot be claimed as confirmed');
  assert.ok(!findings.some((f) => f.rule_id === 'seo.thin-content' && f.url === home), 'the 200-word homepage must not be flagged');
  store.close();
});

test('includeSubdomains only follows real subdomains of the start host, never siblings sharing a multi-part public suffix', async () => {
  // A naive "last two labels" heuristic would compute "co.uk" as the shared
  // domain here and treat any other *.co.uk site as in-scope — a real
  // scope-escape bug for multi-part suffixes (.co.uk, .com.au, .github.io).
  const store = openAuditStore(':memory:');
  const origin = 'https://shop.example.co.uk';
  const start = `${origin}/`;
  const realSubdomain = 'https://blog.shop.example.co.uk/post';
  const unrelatedSibling = 'https://other-example.co.uk/';
  const id = store.createAudit({ siteOrigin: origin, startUrl: start, config: { maxPages: 5 } });
  const config = planCrawlConfig({ maxPages: 5, respectRobots: false, includeSubdomains: true });
  await runAudit({
    auditId: id, startUrl: start, config, store,
    collectPage: async (url) => page({ url, links: url === start ? [{ url: realSubdomain, text: '' }, { url: unrelatedSibling, text: '' }] : [] }),
    checkLink: fakeLinkChecker({})
  });
  const urls = store.listUrls(id).map((u) => u.url);
  assert.ok(urls.includes(realSubdomain), 'a genuine subdomain of the start host must be followed');
  assert.ok(!urls.includes(unrelatedSibling), 'an unrelated site sharing only a public suffix must never be followed');
  store.close();
});

test('a 403/401/429 link is reported as blocked with its anchor text and an explicit "not a broken link" caveat, never as confirmed-broken', async () => {
  // Reproduced live against a real site: our own automated request got a 403
  // from Yelp that a real browser never saw — a common bot-protection
  // response, not evidence the destination is actually down. Overclaiming
  // here would be exactly the kind of false positive this project promised
  // never to manufacture.
  const store = openAuditStore(':memory:');
  const origin = 'https://shop.example.com';
  const home = `${origin}/`;
  const blocked = 'https://social.example.com/business-page';
  const id = store.createAudit({ siteOrigin: origin, startUrl: home, config: { maxPages: 5 } });
  const config = planCrawlConfig({ maxPages: 5, respectRobots: false });
  await runAudit({
    auditId: id, startUrl: home, config, store,
    collectPage: async (url) => page({ url, links: url === home ? [{ url: blocked, text: 'Find us on Social' }] : [] }),
    checkLink: async (url) => ({ url, status: url === blocked ? 403 : 200, finalUrl: url, redirected: false, method: 'GET', attempts: 2 })
  });
  const link = store.listLinks(id).find((l) => l.target_url === blocked);
  assert.equal(link.status, 'blocked', 'a 403 must never be classified the same as a confirmed-broken link');
  assert.equal(link.anchor_text, 'Find us on Social', 'anchor text must be captured for every link, not just broken ones');
  const finding = store.listFindings(id).find((f) => f.rule_id === 'navigation.link-review-external');
  assert.ok(finding, 'a blocked link still produces a review finding so it is visible, just not as "broken"');
  assert.equal(finding.confidence, 'inconclusive');
  assert.match(finding.detail, /bot-protection/i);
  assert.match(finding.detail, /not treated as a broken link/i);
  store.close();
});

test('the page-count limit stops the crawl and leaves the rest honestly queued, not silently dropped', async () => {
  const store = openAuditStore(':memory:');
  const origin = 'https://big-site.example.com';
  const start = `${origin}/`;
  const id = store.createAudit({ siteOrigin: origin, startUrl: start, config: { maxPages: 2 } });
  const config = planCrawlConfig({ maxPages: 2, concurrency: 1, respectRobots: false });
  let calls = 0;
  await runAudit({
    auditId: id, startUrl: start, config, store,
    collectPage: async (url) => { calls++; return page({ url, links: [{ url: `${origin}/page-${calls}`, text: '' }] }); },
    checkLink: fakeLinkChecker({})
  });
  assert.equal(calls, 2, 'collection must stop at the configured page limit');
  const counts = store.urlCountsByStatus(id);
  assert.equal(counts.fetched, 2);
  assert.ok((counts.queued || 0) >= 1, 'pages discovered beyond the limit must remain visibly queued, not disappear');
  store.close();
});

test('maxPages bounds total collection attempts, not just successes — a high error rate must not blow through the frontier', async () => {
  // Caught by a live end-to-end run against a real site: a page limit that
  // only counted successful fetches let a run with several failing pages
  // process far more than the configured limit before finally accumulating
  // enough successes, costing unbounded time/requests against the target.
  const store = openAuditStore(':memory:');
  const origin = 'https://mostly-broken.example.com';
  const start = `${origin}/`;
  const siblings = Array.from({ length: 5 }, (_, i) => ({ url: `${origin}/page-${i}`, text: '' }));
  const id = store.createAudit({ siteOrigin: origin, startUrl: start, config: { maxPages: 3 } });
  const config = planCrawlConfig({ maxPages: 3, concurrency: 1, respectRobots: false });
  let calls = 0;
  await runAudit({
    auditId: id, startUrl: start, config, store,
    collectPage: async (url) => {
      calls++;
      if (calls % 2 === 0) throw new Error('fetch timed out');
      return page({ url, links: url === start ? siblings : [] });
    },
    checkLink: fakeLinkChecker({})
  });
  assert.equal(calls, 3, 'collection attempts (successes + errors) must stop at the configured limit');
  assert.ok(store.urlCountsByStatus(id).queued >= 1, 'unattempted pages must remain honestly queued');
  store.close();
});

test('a page that fails to collect is recorded as an error and the crawl continues', async () => {
  const store = openAuditStore(':memory:');
  const origin = 'https://flaky.example.com';
  const start = `${origin}/`;
  const ok = `${origin}/ok`;
  const id = store.createAudit({ siteOrigin: origin, startUrl: start, config: {} });
  const config = planCrawlConfig({ maxPages: 5, respectRobots: false });
  const result = await runAudit({
    auditId: id, startUrl: start, config, store,
    collectPage: async (url) => { if (url === start) throw new Error('fetch timed out'); return page({ url }); },
    checkLink: fakeLinkChecker({})
  });
  const counts = store.urlCountsByStatus(id);
  assert.equal(counts.error, 1);
  assert.equal(result.stats.pagesErrored, 1);
  store.close();
});

test('a non-2xx or non-HTML terminal response is recorded as fetched with its real status, not treated as a collection failure', async () => {
  // A 404/500 response is real information about the page, not a network or
  // parse failure — collectStaticPage() (and any fake standing in for it)
  // returns { ok:true, isHtml:false, httpStatus } for exactly this case, and
  // the crawler must record it as a fetched page carrying that status rather
  // than lumping it in with genuine collection errors (timeouts, DNS, parse
  // failures), which would hide real HTTP evidence behind a vague "error".
  const store = openAuditStore(':memory:');
  const origin = 'https://mixed.example.com';
  const start = `${origin}/`;
  const id = store.createAudit({ siteOrigin: origin, startUrl: start, config: {} });
  const config = planCrawlConfig({ maxPages: 5, respectRobots: false });
  await runAudit({
    auditId: id, startUrl: start, config, store,
    collectPage: async (url) => ({ ok: true, httpStatus: 500, finalUrl: url, redirected: false, isHtml: false }),
    checkLink: fakeLinkChecker({})
  });
  const urls = store.listUrls(id);
  assert.equal(urls[0].status, 'fetched');
  assert.equal(urls[0].http_status, 500);
  store.close();
});

test('cancellation stops workers promptly without corrupting already-recorded results', async () => {
  const store = openAuditStore(':memory:');
  const origin = 'https://cancel-me.example.com';
  const start = `${origin}/`;
  const id = store.createAudit({ siteOrigin: origin, startUrl: start, config: {} });
  const config = planCrawlConfig({ maxPages: 50, concurrency: 1, respectRobots: false });
  let processed = 0;
  const result = await runAudit({
    auditId: id, startUrl: start, config, store,
    collectPage: async (url) => { processed++; return page({ url, links: [{ url: `${origin}/next-${processed}`, text: '' }] }); },
    checkLink: fakeLinkChecker({}),
    isCancelled: () => processed >= 2
  });
  assert.equal(result.cancelled, true);
  assert.ok(processed <= 3, 'cancellation must stop new work quickly rather than draining the whole frontier');
  store.close();
});
