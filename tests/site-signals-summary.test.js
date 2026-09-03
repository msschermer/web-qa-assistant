import test from 'node:test';
import assert from 'node:assert/strict';
import { collectSiteSignals, describeRobots, describeLlmsTxt } from '../packages/crawl/site-signals.js';
import { composeAuditSummary } from '../packages/crawl/audit-summary.js';
import { parseRobotsTxt } from '../packages/crawl/robots.js';

function res(status, body = '') {
  return { status, ok: status >= 200 && status < 300, url: '', text: async () => body };
}
function fetcher(map) {
  return async (url) => {
    const hit = map[String(url)];
    if (hit instanceof Error) throw hit;
    return hit || res(404);
  };
}

test('a missing document and an unreachable one are never the same fact', () => {
  const missing = describeRobots({ reached: true, status: 404, ok: false }, null);
  assert.equal(missing.present, false);
  assert.equal(missing.confidence, 'confirmed', 'a 404 is a real answer');

  const unreachable = describeRobots({ reached: false, status: 0, ok: false, error: 'ECONNRESET' }, null);
  assert.equal(unreachable.present, null, 'unreachable is not "absent"');
  assert.equal(unreachable.confidence, 'inconclusive');

  const serverError = describeRobots({ reached: true, status: 503, ok: false }, null);
  assert.equal(serverError.present, null);
  assert.equal(serverError.confidence, 'inconclusive');
});

test('robots.txt is read as a document, and a site-wide block is called out', async () => {
  const signals = await collectSiteSignals('https://x.example.com', {
    fetchImpl: fetcher({
      'https://x.example.com/robots.txt': res(200, 'User-agent: *\nDisallow: /\nSitemap: https://x.example.com/sm.xml\n'),
      'https://x.example.com/llms.txt': res(404)
    }),
    parseRobotsTxt,
    fetchSitemapUrls: async () => []
  });
  assert.equal(signals.robots.present, true);
  assert.equal(signals.robots.blocksEverything, true);
  assert.deepEqual(signals.robots.sitemaps, ['https://x.example.com/sm.xml']);

  const summary = composeAuditSummary({ signals, urlCounts: { fetched: 3 }, linkCounts: {}, schema: { pagesChecked: 3, pagesWithSchema: 3, types: { WebPage: 3 } } });
  const indexable = summary.rows.find((r) => r.id === 'indexable');
  assert.equal(indexable.state, 'attention');
  assert.match(indexable.headline, /disallows the whole site/);
  assert.equal(indexable.confidence, 'confirmed');
});

test('a long disallow list is ordinary housekeeping, not a site-wide block', async () => {
  const signals = await collectSiteSignals('https://y.example.com', {
    fetchImpl: fetcher({
      'https://y.example.com/robots.txt': res(200, 'User-agent: *\nDisallow: /wp-admin/\nDisallow: /cart/\nDisallow: /search\n'),
      'https://y.example.com/llms.txt': res(404)
    }),
    parseRobotsTxt,
    fetchSitemapUrls: async () => []
  });
  assert.equal(signals.robots.blocksEverything, false);
  assert.equal(signals.robots.disallowCount, 3);
  const summary = composeAuditSummary({ signals, urlCounts: { fetched: 2 }, linkCounts: {}, schema: { pagesChecked: 2, pagesWithSchema: 2, types: {} } });
  assert.equal(summary.rows.find((r) => r.id === 'indexable').state, 'ok');
});

test('llms.txt is reported as a proposed convention and its absence is never a defect', async () => {
  const present = describeLlmsTxt({ reached: true, status: 200, ok: true, bytes: 900 });
  assert.equal(present.present, true);
  assert.equal(present.standard, 'proposed');

  const signals = { robots: { present: false, status: 404 }, sitemap: { present: false, declaredInRobots: false, declared: [] }, llmsTxt: describeLlmsTxt({ reached: true, status: 404, ok: false }) };
  const summary = composeAuditSummary({ signals, urlCounts: { fetched: 1 }, linkCounts: {}, schema: { pagesChecked: 1, pagesWithSchema: 1, types: {} } });
  const llms = summary.rows.find((r) => r.id === 'llms');
  assert.equal(llms.state, 'ok', 'not publishing a proposed convention is not an attention state');
  assert.equal(llms.informational, true);
  assert.match(llms.evidence.join(' '), /not a standard/);
});

test('the summary states what was found, and never invents a score', () => {
  const summary = composeAuditSummary({
    signals: {
      robots: { present: true, status: 200, disallowCount: 1, blocksEverything: false, sitemaps: ['https://z.example.com/sm.xml'] },
      sitemap: { present: true, declaredInRobots: true, declared: ['https://z.example.com/sm.xml'], source: 'https://z.example.com/sm.xml', urlCount: 103, truncated: false },
      llmsTxt: { present: true, status: 200, bytes: 1576, standard: 'proposed' }
    },
    urlCounts: { fetched: 8, queued: 110 },
    linkCounts: { healthy: 304, broken: 1 },
    findingsByRule: [{ rule_id: 'navigation.link-404-external', confidence: 'confirmed', n: 1 }],
    schema: { pagesChecked: 8, pagesWithSchema: 8, types: { WebPage: 8, Article: 7 } },
    unverifiableExternal: { destinationCount: 1, occurrenceCount: 8, hosts: ['facebook.com'], destinations: [] }
  });

  assert.deepEqual(Object.keys(summary).sort(), ['coverage', 'generatedAt', 'rows'], 'no score, grade or index may appear');
  assert.equal(JSON.stringify(summary).includes('score'), false);

  const schema = summary.rows.find((r) => r.id === 'schema');
  assert.equal(schema.state, 'ok');
  assert.match(schema.headline, /Present on all 8/);
  assert.match(schema.evidence.join(' '), /WebPage \(8\)/, 'the types actually found are stated, not just their absence');

  // Our own page cap is never presented as the site's failing.
  const crawlable = summary.rows.find((r) => r.id === 'crawlable');
  assert.equal(crawlable.state, 'ok');
  assert.match(crawlable.headline, /page limit reached/);
  assert.match(crawlable.evidence.join(' '), /coverage limit, not a site problem/);

  // The unverifiable destinations are coverage, counted once, in the singular.
  assert.match(summary.coverage.join(' '), /1 external destination on facebook.com/);
  assert.match(summary.coverage.join(' '), /8 links point to it\./);
  assert.match(summary.coverage.join(' '), /says nothing about whether the links work/);
});

test('a site with no structured data is inferred, not confirmed, because this tier runs no JavaScript', () => {
  const summary = composeAuditSummary({
    signals: { robots: { present: false, status: 404 }, sitemap: { present: false, declaredInRobots: false, declared: [] }, llmsTxt: {} },
    urlCounts: { fetched: 5 },
    linkCounts: {},
    schema: { pagesChecked: 5, pagesWithSchema: 0, types: {} }
  });
  const schema = summary.rows.find((r) => r.id === 'schema');
  assert.equal(schema.state, 'attention');
  assert.equal(schema.confidence, 'inferred', 'absence from static HTML cannot be confirmed');
  assert.match(schema.evidence.join(' '), /inject schema with JavaScript/);
});

test('nothing fetched yields unknown, never a reassuring default', () => {
  const summary = composeAuditSummary({ signals: {}, urlCounts: { fetched: 0, error: 3 }, linkCounts: {}, schema: {} });
  assert.equal(summary.rows.find((r) => r.id === 'crawlable').state, 'unknown');
  assert.equal(summary.rows.find((r) => r.id === 'indexable').state, 'unknown');
  assert.equal(summary.rows.find((r) => r.id === 'schema').state, 'unknown');
  for (const r of summary.rows) assert.notEqual(r.state, 'ok', 'an unobserved site is never reported as healthy');
});
