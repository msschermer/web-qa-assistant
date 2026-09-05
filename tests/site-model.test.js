import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildSiteModel, cohesionOf, groupForUrl, groupCoverage } from '../packages/findings/site-model.js';
import { mergeCandidates, openQuestions, planCompression } from '../packages/findings/plan-reasoning.js';

const page = (url, over = {}) => ({
  url, final_url: url, status: 'fetched', title: 'A page | Example Firm', h1_text: 'A page',
  word_count: 800, schema_types: '["Article","Organization"]', canonical: url, indexable: 1, redirected: 0, ...over
});

const family = (prefix, n, over = {}) => Array.from({ length: n }, (_, i) =>
  page(`https://example.com/${prefix}/person-${i + 1}`, { title: `Person ${i + 1} | Example Firm`, ...over }));

test('a page family is named by the site, never by what Lumen thinks the pages are', () => {
  // The dangerous version of this feature guesses "attorney profiles" from a
  // slug. Telling a client the wrong template is exactly the confident error
  // the product exists not to make, so the group quotes the site's own path.
  const model = buildSiteModel([page('https://example.com/'), ...family('attorneys', 5), ...family('practice-areas', 4)]);
  const labels = model.groups.map((g) => g.label);
  assert.ok(labels.includes('/attorneys/*'), labels.join(', '));
  assert.ok(labels.includes('/practice-areas/*'));
  const attorneys = model.groups.find((g) => g.label === '/attorneys/*');
  assert.equal(attorneys.count, 5);
  assert.equal(attorneys.segment, 'attorneys');
  // Membership is a fact about the URLs, so it is confirmed. Whether they share
  // a template is a reading of served HTML, so it is not.
  assert.equal(attorneys.confidence, 'confirmed');
  assert.ok(['inferred', 'inconclusive'].includes(attorneys.templateConfidence));
  assert.ok(!/attorney profile|lawyer|bio/i.test(attorneys.basis), 'the basis states measurement, not purpose');
  // The home page is never a template instance.
  assert.ok(model.ungrouped.some((u) => /site root/.test(u.reason)));
});

test('a flat site still groups, and says the claim is weaker', () => {
  // The first real site this met publishes every article at the root, so path
  // grouping found nothing at all — correct, and useless on most of WordPress.
  const flat = Array.from({ length: 6 }, (_, i) =>
    page(`https://example.com/some-article-title-${i + 1}`, { word_count: 900 + i * 10 }));
  const model = buildSiteModel([page('https://example.com/'), ...flat]);
  const shaped = model.groups.filter((g) => g.kind === 'shape');
  assert.equal(shaped.length, 1);
  assert.equal(shaped[0].count, 6);
  // Nothing about the site states this membership, so it cannot be confirmed.
  assert.equal(shaped[0].confidence, 'inferred');
  assert.match(shaped[0].basis, /reading of the pages rather than of the site's structure/);
  // The label quotes what was measured, not what the pages might be for.
  assert.match(shaped[0].label, /Pages publishing|matching shape/);
});

test('cohesion is measured and reported, not asserted', () => {
  const alike = [page('https://example.com/a'), page('https://example.com/b'), page('https://example.com/c')];
  const unlike = [
    page('https://example.com/a', { title: 'Completely different words here', word_count: 120, schema_types: '["FAQPage"]' }),
    page('https://example.com/b', { title: 'Nothing whatever in common', word_count: 9000, schema_types: '["Product"]' }),
    page('https://example.com/c', { title: 'Third unrelated document', word_count: 300, schema_types: '["Event"]' })
  ];
  assert.ok(cohesionOf(alike).score > 0.8, 'template-generated pages agree');
  assert.ok(cohesionOf(unlike).score < 0.4, 'unrelated pages do not');
  // The signals behind the number are published, so the claim can be checked.
  assert.deepEqual(Object.keys(cohesionOf(alike).signals).sort(), ['bodyLength', 'structuredDataTypes', 'titlePattern']);
  assert.equal(cohesionOf([page('https://example.com/a')]).score, 0, 'one page is not a pattern');
});

test('a group too small to be a pattern is reported as ungrouped, not invented', () => {
  const model = buildSiteModel([page('https://example.com/'), ...family('locations', 2)]);
  assert.equal(model.groups.filter((g) => g.kind === 'family').length, 0);
  assert.equal(model.grouped + model.ungrouped.length, model.pagesConsidered);
  assert.ok(model.ungrouped.some((u) => /only 2 pages under \/locations\//.test(u.reason)));
});

test('coverage decides whether something is a statement about a family', () => {
  const model = buildSiteModel([page('https://example.com/'), ...family('attorneys', 5)]);
  const all = family('attorneys', 5).map((p) => p.url);
  assert.equal(groupCoverage(model, all).coverage, 1);
  // Two of five is a statement about two pages.
  assert.equal(groupCoverage(model, all.slice(0, 2)).coverage, 0.4);
  // A set mostly outside the group says nothing about the group.
  assert.equal(groupCoverage(model, [...all.slice(0, 1), 'https://example.com/x', 'https://example.com/y']), null);
  assert.ok(groupForUrl(model, all[0]));
  assert.equal(groupForUrl(model, 'https://example.com/nowhere'), null);
});

// --- merging ---------------------------------------------------------------

const change = (id, area, urls, over = {}) => ({
  id, area, ruleId: `${area}.rule`, urls, pages: urls.length, instances: urls.length,
  scope: 'template', location: `The ${area} thing`, action: `Fix the ${area}`, doneWhen: 'It is fixed', ...over
});

test('several different things wrong across one family is one template edit', () => {
  // The case the whole layer exists for: a heading, a title and a schema
  // property all wrong on the same pages is one file opened once, not three.
  const urls = family('attorneys', 6).map((p) => p.url);
  const model = buildSiteModel([page('https://example.com/'), ...family('attorneys', 6)]);
  const changes = [
    change('C01', 'document-structure', urls),
    change('C02', 'page-metadata', urls),
    change('C03', 'entity-markup', urls)
  ];
  const merges = mergeCandidates(changes, model);
  assert.equal(merges.length, 1);
  assert.deepEqual(merges[0].resolves, ['C01', 'C02', 'C03']);
  assert.equal(merges[0].pages, 6);
  assert.equal(merges[0].findings, 18);
  // A merge is a proposal about a template, and a template is never something
  // the crawl saw, so it can never be confirmed.
  assert.ok(['inferred', 'inconclusive'].includes(merges[0].confidence));
  assert.ok(merges[0].caveat.length > 40);
  // And it names every change it covers, so the plan still reconciles.
  assert.equal(merges[0].implementation.length, 3);
});

test('the same thing wrong repeatedly is not one template edit', () => {
  // The wrong answer this took to find: overlap alone merged three broken links
  // that appeared on every page, because everything in a shared header overlaps
  // with everything else in it. Three dead hrefs are three dead hrefs.
  const urls = family('attorneys', 6).map((p) => p.url);
  const model = buildSiteModel([page('https://example.com/'), ...family('attorneys', 6)]);
  const merges = mergeCandidates([
    change('C01', 'link-targets', urls),
    change('C02', 'link-targets', urls),
    change('C03', 'link-targets', urls)
  ], model);
  assert.equal(merges.length, 0);
});

test('nothing merges across families, or on pages that are not a family', () => {
  const attorneys = family('attorneys', 6).map((p) => p.url);
  const areas = family('practice-areas', 6).map((p) => p.url);
  const model = buildSiteModel([page('https://example.com/'), ...family('attorneys', 6), ...family('practice-areas', 6)]);
  assert.equal(mergeCandidates([
    change('C01', 'document-structure', attorneys),
    change('C02', 'page-metadata', areas)
  ], model).length, 0, 'two families are two templates');
  // A single-page change is a single-page change however similar it looks.
  assert.equal(mergeCandidates([
    change('C01', 'document-structure', [attorneys[0]], { scope: 'page' }),
    change('C02', 'page-metadata', [attorneys[0]], { scope: 'page' })
  ], model).length, 0);
  assert.equal(mergeCandidates([change('C01', 'document-structure', attorneys)], null).length, 0);
});

// --- refusing to answer -----------------------------------------------------

test('disagreeing signals become a question, never a recommendation', () => {
  // No individual scanner reports anything here: the canonical is valid markup,
  // the sitemap is a valid sitemap. Only holding them together shows it.
  const pages = [
    page('https://example.com/a', { canonical: 'https://example.com/b' }),
    page('https://example.com/b')
  ];
  // The disagreement: the page says b should be indexed, the sitemap says a.
  const sitemap = new Set(['https://example.com/a']);
  const normalizeUrl = (u) => String(u).replace(/\/$/, '');
  const questions = openQuestions({ pages, links: [], sitemapUrls: sitemap, normalizeUrl });
  const canonical = questions.find((q) => q.id === 'Q-canonical');
  assert.ok(canonical, questions.map((q) => q.id).join(','));
  assert.match(canonical.question, /\?$/);
  // The point is what it refuses to do. Consolidating the wrong way round costs
  // a client the rankings on the page they meant to keep.
  assert.ok(canonical.blocked.length > 30);
  assert.ok(canonical.settledBy.length > 30);
  assert.ok(!/^(Add|Fix|Remove|Replace|Update)\b/.test(canonical.question), 'a question, not an instruction');
});

test('a sitemap listing URLs that redirect is asked about, not fixed', () => {
  const pages = [page('https://example.com/old', { redirected: 1, final_url: 'https://example.com/new' })];
  const questions = openQuestions({
    pages, links: [], sitemapUrls: new Set(['https://example.com/old']), normalizeUrl: (u) => String(u).replace(/\/$/, '')
  });
  const q = questions.find((x) => x.id === 'Q-sitemap-redirects');
  assert.ok(q);
  assert.equal(q.count, 1);
});

test('a check that cannot be made correctly is not made at all', () => {
  // The failure this closes: without the crawl's own normaliser, membership fell
  // back to raw string equality and reported eleven of twelve pages missing from
  // a sitemap that listed all twelve, differing only by a trailing slash. That
  // sentence in a client report is worse than saying nothing.
  const pages = Array.from({ length: 6 }, (_, i) => page(`https://example.com/p-${i}/`));
  const sitemap = new Set(pages.map((p) => p.url.replace(/\/$/, '')));
  assert.equal(openQuestions({ pages, links: [], sitemapUrls: sitemap }).length, 0,
    'no normaliser means no membership claim');
  assert.equal(openQuestions({ pages, links: [], sitemapUrls: sitemap, normalizeUrl: (u) => String(u).replace(/\/$/, '') }).length, 0,
    'and with one, the pages are correctly found present');
  // No sitemap read at all is different from a sitemap that omits something,
  // and neither supports a conclusion about the other.
  assert.equal(openQuestions({ pages, links: [], sitemapUrls: new Set(), normalizeUrl: (u) => u }).length, 0);
});

test('compression is reported honestly, including when there is none', () => {
  // Fewer actions is not the goal, so this exists to be checked rather than
  // maximised: a compression figure with no merges behind it is just the
  // grouping that was always there.
  assert.deepEqual(planCompression({ findings: 214, changes: 31, merges: [] }),
    { findings: 214, changes: 31, templateActions: 0, jobs: 31, ratio: 6.9 });
  const merged = planCompression({ findings: 214, changes: 31, merges: [{ resolves: ['C1', 'C2', 'C3'] }] });
  assert.equal(merged.jobs, 29, 'three changes became one job');
  assert.equal(merged.templateActions, 1);
  assert.equal(planCompression({}).ratio, 0);
});

test('a site too large to compare pairwise says so instead of reporting no structure', () => {
  // Shape clustering is quadratic: 600 flat pages took 617 ms, and nothing stops
  // an operator raising the page budget and resuming. Past the ceiling the
  // comparison is not attempted, and the difference between "looked and found
  // nothing" and "did not look" is stated rather than left to render the same.
  const many = Array.from({ length: 1400 }, (_, i) =>
    page(`https://example.com/article-${i}`, { title: `Article ${i} | Example Firm`, word_count: 700 + (i % 200) }));
  const started = Date.now();
  const model = buildSiteModel([page('https://example.com/'), ...many]);
  assert.ok(Date.now() - started < 1000, 'the ceiling must actually stop the work');
  assert.equal(model.groups.length, 0);
  assert.equal(model.shapeSearchSkipped.candidates, 1400);
  assert.ok(model.shapeSearchSkipped.ceiling > 0);
  // Under the ceiling it still runs, and reports nothing skipped.
  const smaller = buildSiteModel([page('https://example.com/'), ...many.slice(0, 40)]);
  assert.equal(smaller.shapeSearchSkipped, null);
  assert.equal(smaller.groups.length, 1);
});

test('path families are unaffected by the size of everything else', () => {
  // The ceiling guards the pairwise search only. A site that states its
  // families in its URLs is grouped in one pass however large it is.
  const noise = Array.from({ length: 1400 }, (_, i) => page(`https://example.com/post-${i}`, { title: `Post ${i}` }));
  const model = buildSiteModel([page('https://example.com/'), ...family('attorneys', 8), ...noise]);
  const attorneys = model.groups.find((g) => g.label === '/attorneys/*');
  assert.ok(attorneys, 'the named family survives');
  assert.equal(attorneys.count, 8);
  assert.equal(attorneys.confidence, 'confirmed');
});
