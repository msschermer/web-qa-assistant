/**
 * Phase 0 of the Sitebulb parity plan (docs/SITEBULB-PARITY-PLAN.md): the
 * results screen must not overstate what was actually checked.
 *
 * Four behaviours are locked down here:
 *   1. A status label never breaks across lines inside its own pill.
 *   2. A partial crawl is stated in the results header, not only in a card
 *      below the fold, and the statement survives a tab change.
 *   3. Every summary tile opens the rows behind its number.
 *   4. An unrun render pass reads as "Not established", never as a clean
 *      accessibility/performance result.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { openAuditStore, URL_STATUSES, URL_GAP_STATUSES, normalizeUrlStatuses } from '../packages/crawl/store.js';

const overlay = fs.readFileSync('apps/extension/content.js', 'utf8');

test('a status pill never wraps mid-word inside its own pill', () => {
  // The reported defect rendered "broken" as "broke / n" in Links and
  // "queued" as "queue / d" in Pages: .data-table td sets word-break:break-word,
  // which happily breaks a six-letter word when the column is squeezed.
  const pill = overlay.match(/\.status-pill\{[^}]*\}/);
  assert.ok(pill, '.status-pill rule should exist');
  assert.match(pill[0], /white-space:nowrap/);
  assert.match(pill[0], /word-break:normal/);
  assert.match(pill[0], /display:inline-block/);
  // The column must also size to its content, or the cell squeezes the pill.
  assert.match(overlay, /\.data-table td\.col-status[^{]*\{[^}]*width:1%/);
  // Both tables' status headers and cells opt into it.
  assert.match(overlay, /<th data-sort="status" class="col-status">Status<\/th>/);
  assert.match(overlay, /<th class="col-status">Status<\/th>/);
  assert.match(overlay, /statusTd\.className = 'col-status'/);
  assert.match(overlay, /tr\.cells\[1\]\.className = 'col-status'/);
});

test('a partial crawl is stated in the results header and survives a tab change', () => {
  assert.match(overlay, /function renderScopeBanner/);
  assert.match(overlay, /Partial crawl/);
  assert.match(overlay, /not the whole site/);
  // A crawl still running says so rather than claiming truncation.
  assert.match(overlay, /Crawl in progress/);
  // The page limit is named as the cause when it is the cause.
  assert.match(overlay, /limit stopped the crawl first/);
  // The banner lives outside the tab panels, so it stays on screen on
  // Findings, Pages and Links — every count in all four sections is a count
  // of the pages that were actually fetched.
  const bannerIdx = overlay.indexOf('<div class="scope-banner"');
  const panelIdx = overlay.indexOf('<div class="tab-panel overview-panel">');
  assert.ok(bannerIdx > 0 && panelIdx > 0, 'both elements should exist');
  assert.ok(bannerIdx < panelIdx, 'the scope banner must sit outside (before) the tab panels');
  // It repaints while a crawl is still running, not only on first render.
  const poll = overlay.match(/async function pollSiteAuditOnce\(\)[\s\S]*?\n  \}/);
  assert.ok(poll, 'pollSiteAuditOnce should exist');
  assert.match(poll[0], /loadAndPaintResults\(\)/, 'the results view repaints while a crawl runs');
  // And it repaints as one thing. A banner on a faster beat than the tiles put
  // two different numbers for the same fact on screen at once — first 40 above
  // 20, then 39 above 32 — which is precisely what the banner exists to stop.
  // The whole view comes from one read of the audit, or from none.
  assert.doesNotMatch(poll[0], /renderScopeBanner\(audit\)/, 'the banner must not repaint on its own cadence');
  const paint = overlay.match(/async function loadAndPaintResults\([\s\S]*?\n  \}/);
  assert.ok(paint, 'loadAndPaintResults should exist');
  assert.match(paint[0], /renderScopeBanner\(audit\)/, 'it repaints inside the single results paint instead');
  assert.match(paint[0], /renderSiteAuditRenderSection\(audit\)/);
  // A finished crawl gets a last repaint, or the final figures never land.
  assert.match(poll[0], /due \|\| finished/);
  // Coverage is hatched, never coloured as a defect.
  assert.match(overlay, /\.scope-banner::before\{[^}]*var\(--sa-hatch\)/);
});

test('every summary tile opens the rows behind its number', () => {
  for (const kind of ['crawled', 'findings', 'fix', 'gaps']) {
    assert.match(overlay, new RegExp(`data-open="${kind}"`), `tile ${kind} should be openable`);
  }
  assert.match(overlay, /function openSummaryTile/);
  assert.match(overlay, /function openUrlsWithStatus/);
  // "Needs fixing" writes into the visible control so the filter is undoable.
  assert.match(overlay, /shadow\.querySelector\('\.findings-category'\)\.value = 'fix'/);
  // A tile with a zero count offers no drill-in to an empty list.
  assert.match(overlay, /btn\.disabled = !tileCounts\[btn\.dataset\.open\]/);
  // Landing on a filtered list explains itself and offers a way out.
  assert.match(overlay, /class="scoped-note"/);
  assert.match(overlay, /Show all pages/);
  assert.match(overlay, /function renderScopedNote/);
  // The pager counts inside the filtered set, not the whole crawl.
  assert.match(overlay, /function urlTotalForStatus/);
  // The overlay's notion of a coverage gap matches the store's.
  assert.deepEqual(
    overlay.match(/const URL_GAP_STATUSES = \[([^\]]*)\]/)[1].replace(/['\s]/g, '').split(','),
    [...URL_GAP_STATUSES]
  );
});

test('an unrun render pass reads as not established, never as clean', () => {
  // Zero rendered pages means accessibility, runtime errors and performance
  // were not measured on this site. Saying nothing would let a client read
  // the audit as silence-means-fine.
  assert.match(overlay, /section\.dataset\.state = 'none'/);
  assert.match(overlay, /Not established/);
  assert.match(overlay, /Accessibility, JavaScript and performance are unchecked/);
  assert.match(overlay, /That is a gap in coverage, not a clean result/);
  // A finished pass is the only state allowed to read as Observed.
  assert.match(overlay, /stateEl\.textContent = 'Observed'/);
  // The panel sits above Site conditions and above the crawl-shape charts.
  const renderIdx = overlay.indexOf('<section class="render-section"');
  const conditionsIdx = overlay.indexOf('conditions" hidden>');
  const shapeIdx = overlay.indexOf('<div class="section-grid crawl-shape">');
  assert.ok(renderIdx > 0 && conditionsIdx > 0 && shapeIdx > 0);
  assert.ok(renderIdx < conditionsIdx, 'render pass state belongs above Site conditions');
  assert.ok(renderIdx < shapeIdx, 'render pass state belongs above the crawl charts');
  // Unrun is a coverage fact, so it is hatched rather than given a severity colour.
  assert.match(overlay, /\.render-section\[data-state=none\][^}]*var\(--sa-hatch\)/);
});

test('listUrls narrows to crawl states so a coverage-gap count can be opened', () => {
  const store = openAuditStore(':memory:');
  const id = store.createAudit({ siteOrigin: 'https://example.com', startUrl: 'https://example.com/', config: {} });
  for (const p of ['a', 'b', 'c', 'd']) store.enqueueUrl(id, 'https://example.com/' + p, 'seed');
  store.recordUrlResult(id, 'https://example.com/a', { status: 'fetched', httpStatus: 200 });
  store.recordUrlResult(id, 'https://example.com/b', { status: 'error', error: 'boom' });
  store.recordUrlResult(id, 'https://example.com/c', { status: 'skipped', error: 'robots-disallowed' });
  // /d is left queued.

  assert.equal(store.listUrls(id).length, 4, 'no filter lists everything');
  assert.equal(store.listUrls(id, { statuses: 'fetched' }).length, 1);
  assert.equal(store.listUrls(id, { statuses: URL_GAP_STATUSES }).length, 3);
  assert.deepEqual(
    store.listUrls(id, { statuses: 'queued,error,skipped' }).map((u) => u.status).sort(),
    ['error', 'queued', 'skipped']
  );
  // Pagination applies inside the filtered set, not across the whole crawl.
  assert.equal(store.listUrls(id, { statuses: URL_GAP_STATUSES, limit: 2 }).length, 2);
  assert.equal(store.listUrls(id, { statuses: URL_GAP_STATUSES, limit: 2, offset: 2 }).length, 1);
  store.close();
});

test('an unknown status filter is dropped rather than reaching SQL', () => {
  // The filter is caller-supplied, so the only values that can be interpolated
  // into the IN clause are '?' placeholders for allow-listed statuses.
  assert.deepEqual(normalizeUrlStatuses('fetched'), ['fetched']);
  assert.deepEqual(normalizeUrlStatuses(' FETCHED '), ['fetched']);
  assert.deepEqual(normalizeUrlStatuses('fetched,fetched'), ['fetched']);
  assert.deepEqual(normalizeUrlStatuses('fetched,bogus'), ['fetched']);
  assert.deepEqual(normalizeUrlStatuses('bogus'), []);
  assert.deepEqual(normalizeUrlStatuses("fetched'); DROP TABLE audit_urls;--"), []);
  assert.deepEqual(normalizeUrlStatuses(null), []);
  for (const status of URL_STATUSES) assert.deepEqual(normalizeUrlStatuses(status), [status]);

  const store = openAuditStore(':memory:');
  const id = store.createAudit({ siteOrigin: 'https://example.com', startUrl: 'https://example.com/', config: {} });
  store.enqueueUrl(id, 'https://example.com/a', 'seed');
  // An unrecognized filter falls back to the full list rather than erroring:
  // an older client asking for a status this build dropped should still see
  // its pages.
  assert.equal(store.listUrls(id, { statuses: 'nonsense' }).length, 1);
  assert.equal(store.listUrls(id, { statuses: "a'); DROP TABLE audit_urls;--" }).length, 1);
  assert.equal(store.listUrls(id).length, 1, 'the table is still there');
  store.close();
});

/**
 * A check that has already run must never be reported as one that has not.
 *
 * robots.txt, the XML sitemap and llms.txt are all fetched in the discovering
 * phase, before a single page is crawled. But stats_json was written only by
 * finishAudit(), so for the whole length of a crawl the results view had no
 * access to answers the audit had settled minutes earlier — and said so, in
 * those words: "Not checked in this audit".
 */
test('site signals are readable while the crawl is still running', () => {
  const store = openAuditStore(':memory:');
  const id = store.createAudit({ siteOrigin: 'https://example.com', startUrl: 'https://example.com/', config: {} });
  // The audit is still running: nothing has called finishAudit.
  assert.equal(store.getAudit(id).stats, null);
  const signals = { origin: 'https://example.com', robots: { present: true, status: 200 }, sitemap: { present: true, urlCount: 106 }, llmsTxt: { present: true, status: 200, bytes: 1576 } };
  store.mergeAuditStats(id, { siteSignals: signals });
  assert.deepEqual(store.getAudit(id).stats.siteSignals, signals, 'a settled fact is readable the moment it is settled');
  // The merge is additive: a later write must not drop what is already there.
  store.mergeAuditStats(id, { pagesProcessed: 3 });
  assert.equal(store.getAudit(id).stats.siteSignals.sitemap.urlCount, 106);
  assert.equal(store.getAudit(id).stats.pagesProcessed, 3);
  store.close();
});

test('the crawl records its site signals before it starts crawling', () => {
  const crawler = fs.readFileSync('packages/crawl/crawler.js', 'utf8');
  const collect = crawler.indexOf('const siteSignals = await collectSiteSignals(');
  const persist = crawler.indexOf('store.mergeAuditStats(auditId, { siteSignals })');
  const firstFetch = crawler.indexOf("store.setPhase(auditId, 'analyzing')");
  assert.ok(collect > 0 && persist > 0, 'signals should be collected and persisted');
  assert.ok(persist > collect, 'persisted after collection');
  assert.ok(persist < firstFetch, 'and long before the crawl finishes');
});

test('a pending check is never worded as a skipped one', () => {
  // Three surfaces reported "not checked" for work that was either already
  // done or still in flight. Each now distinguishes the two.
  assert.match(overlay, /Being fetched — this audit reads it before it crawls/);
  // The conditions readout is populated from the signals while the crawl is
  // still running, rather than staying blank until the server composes it.
  const summary = overlay.match(/function renderAuditSummary\(audit\)[\s\S]*?\n  \}/);
  assert.ok(summary, 'renderAuditSummary should exist');
  assert.match(summary[0], /composed\.length \? composed : \(signals \? provisionalConditionRows\(signals\)/,
    'a running audit stands in the settled signals rather than showing nothing');
  const provisional = overlay.match(/function provisionalConditionRows\(signals\)[\s\S]*?\n  \}/);
  assert.ok(provisional, 'provisionalConditionRows should exist');
  // Same ids as the server composes, so its rows replace these seamlessly.
  for (const id of ['indexable', 'sitemap', 'llms']) {
    assert.ok(provisional[0].includes(`id: '${id}'`), `${id} must use the composed row's own id`);
  }
});

/**
 * The reverse failure: a check that did NOT run must never be reported as a
 * clean result. seo.js withholds "sitemap URL never reached" when the page
 * limit cut the crawl short, because unreached would only mean "not gotten to
 * yet". The Sitemaps tile rendered that silence as a confident 0.
 */
test('a withheld sitemap comparison reads as not compared, never as zero', () => {
  const builder = overlay.match(/    sitemaps\(\) \{[\s\S]*?\n    \},/);
  assert.ok(builder, 'the sitemaps section builder should exist');
  const body = builder[0];
  assert.match(body, /pageLimitStopped\(audit\)/, 'the page limit is what withholds the comparison');
  assert.match(body, /label: 'Never reached', value: '—'/, 'an em-dash, not a zero');
  assert.match(body, /not compared/);
  assert.match(body, /have not been compared against the crawl, because/, 'and the coverage line says why');
  // The gate it mirrors must still exist on the scanner side.
  const seo = fs.readFileSync('packages/crawl/scanners/seo.js', 'utf8');
  assert.match(seo, /if \(unreachedCount > 0 && !ctx\.maxPagesReached\)/);
});

test('pageLimitStopped is derived from the crawl, not assumed', () => {
  const fn = overlay.match(/function pageLimitStopped\(audit\)[\s\S]*?\n  \}/);
  assert.ok(fn, 'pageLimitStopped should exist');
  assert.match(fn[0], /counts\.queued/, 'a queued backlog is what "the limit stopped it" means');
});

test('the three published documents are stated once, and can be opened', () => {
  // They were briefly a second Overview block restating the three facts the
  // conditions rows above them already carried, in different words. One
  // readout now owns them, and the link that block existed for came with it.
  assert.doesNotMatch(overlay, /class="signals"/, 'the duplicate block is gone');
  // The Sitemaps section legitimately keeps that phrase in its own lede; what
  // must not come back is a second Overview block headed with it.
  assert.doesNotMatch(overlay, /feed-heading">What this site publishes/);
  const url = overlay.match(/function conditionDocumentUrl\(rowId, signals, origin\)[\s\S]*?\n  \}/);
  assert.ok(url, 'conditionDocumentUrl should exist');
  assert.match(url[0], /robots\.txt/);
  assert.match(url[0], /llms\.txt/);
  assert.match(url[0], /signals\?\.sitemap\?\.source/);
  // A proposed convention's absence is context, never a defect.
  const provisional = overlay.match(/function provisionalConditionRows\(signals\)[\s\S]*?\n  \}/)[0];
  assert.match(provisional, /llms\.present === false[\s\S]*?state: 'ok'/, 'no llms.txt is not a fault');
  assert.match(provisional, /its absence is not a defect/);
  assert.match(overlay, /openBtn\.className = 'cond-open'/);
});

test('the Overview states each fact once', () => {
  // The complaint that prompted the earlier pass: the same three documents in
  // two blocks, three cards slicing one set of findings, and several cards
  // holding a single line each. The mockup-driven rebuild keeps that discipline.
  const panel = overlay.slice(
    overlay.indexOf('<div class="tab-panel overview-panel">'),
    overlay.indexOf('<div class="tab-panel findings-panel"')
  );
  assert.ok(panel.length > 0, 'the overview panel should exist');
  // The impact card repeated the count already on every nav row; the filter
  // that card carried moved to the list it narrows.
  assert.doesNotMatch(panel, /impact-breakdown/, 'the impact card is gone from the Overview');
  assert.match(overlay, /<select class="findings-impact"/, 'and survives as a control on the Findings list');
  assert.match(overlay, /function renderImpactFilter\(groups\)/);
  // Severity and the ranked patterns share one card, not three.
  assert.match(panel, /class="panel-card mix-card"/);
  assert.ok(panel.indexOf('severity-bar') > 0 && panel.indexOf('top-issues') > panel.indexOf('severity-bar'),
    'severity and the ranked issues share one card');
  // The three published documents are stated once, in the conditions readout.
  assert.doesNotMatch(panel, /class="signals"/);
  // And the header states provenance rather than restating the tiles below it.
  assert.match(overlay, /function auditProvenanceLine\(audit\)/);
});

test('a partial crawl is stated in the results header and survives a tab change', () => {
  assert.match(overlay, /function renderScopeBanner/);
  assert.match(overlay, /Partial crawl/);
  assert.match(overlay, /not the whole site/);
  // A crawl still running says so rather than claiming truncation.
  assert.match(overlay, /Crawl in progress/);
  // The page limit is named as the cause when it is the cause.
  assert.match(overlay, /limit stopped the crawl first/);
  // The banner lives outside the tab panels, so it stays on screen on
  // Findings, Pages and Links — every count in all four sections is a count
  // of the pages that were actually fetched.
  const bannerIdx = overlay.indexOf('<div class="scope-banner"');
  const panelIdx = overlay.indexOf('<div class="tab-panel overview-panel">');
  assert.ok(bannerIdx > 0 && panelIdx > 0, 'both elements should exist');
  assert.ok(bannerIdx < panelIdx, 'the scope banner must sit outside (before) the tab panels');
  // It repaints while a crawl is still running, not only on first render.
  const poll = overlay.match(/async function pollSiteAuditOnce\(\)[\s\S]*?\n  \}/);
  assert.ok(poll, 'pollSiteAuditOnce should exist');
  assert.match(poll[0], /loadAndPaintResults\(\)/, 'the results view repaints while a crawl runs');
  // And it repaints as one thing. A banner on a faster beat than the tiles put
  // two different numbers for the same fact on screen at once — first 40 above
  // 20, then 39 above 32 — which is precisely what the banner exists to stop.
  // The whole view comes from one read of the audit, or from none.
  assert.doesNotMatch(poll[0], /renderScopeBanner\(audit\)/, 'the banner must not repaint on its own cadence');
  const paint = overlay.match(/async function loadAndPaintResults\([\s\S]*?\n  \}/);
  assert.ok(paint, 'loadAndPaintResults should exist');
  assert.match(paint[0], /renderScopeBanner\(audit\)/, 'it repaints inside the single results paint instead');
  assert.match(paint[0], /renderSiteAuditRenderSection\(audit\)/);
  // A finished crawl gets a last repaint, or the final figures never land.
  assert.match(poll[0], /due \|\| finished/);
  // Coverage is hatched, never coloured as a defect.
  assert.match(overlay, /\.scope-banner::before\{[^}]*var\(--sa-hatch\)/);
});

test('every summary tile opens the rows behind its number', () => {
  for (const kind of ['crawled', 'findings', 'fix', 'gaps']) {
    assert.match(overlay, new RegExp(`data-open="${kind}"`), `tile ${kind} should be openable`);
  }
  assert.match(overlay, /function openSummaryTile/);
  assert.match(overlay, /function openUrlsWithStatus/);
  // "Needs fixing" writes into the visible control so the filter is undoable.
  assert.match(overlay, /shadow\.querySelector\('\.findings-category'\)\.value = 'fix'/);
  // A tile with a zero count offers no drill-in to an empty list.
  assert.match(overlay, /btn\.disabled = !tileCounts\[btn\.dataset\.open\]/);
  // Landing on a filtered list explains itself and offers a way out.
  assert.match(overlay, /class="scoped-note"/);
  assert.match(overlay, /Show all pages/);
  assert.match(overlay, /function renderScopedNote/);
  // The pager counts inside the filtered set, not the whole crawl.
  assert.match(overlay, /function urlTotalForStatus/);
  // The overlay's notion of a coverage gap matches the store's.
  assert.deepEqual(
    overlay.match(/const URL_GAP_STATUSES = \[([^\]]*)\]/)[1].replace(/['\s]/g, '').split(','),
    [...URL_GAP_STATUSES]
  );
});

test('an unrun render pass reads as not established, never as clean', () => {
  // Zero rendered pages means accessibility, runtime errors and performance
  // were not measured on this site. Saying nothing would let a client read
  // the audit as silence-means-fine.
  assert.match(overlay, /section\.dataset\.state = 'none'/);
  assert.match(overlay, /Not established/);
  assert.match(overlay, /Accessibility, JavaScript and performance are unchecked/);
  assert.match(overlay, /That is a gap in coverage, not a clean result/);
  // A finished pass is the only state allowed to read as Observed.
  assert.match(overlay, /stateEl\.textContent = 'Observed'/);
  // The panel sits above Site conditions and above the crawl-shape charts.
  const renderIdx = overlay.indexOf('<section class="render-section"');
  const conditionsIdx = overlay.indexOf('conditions" hidden>');
  const shapeIdx = overlay.indexOf('<div class="section-grid crawl-shape">');
  assert.ok(renderIdx > 0 && conditionsIdx > 0 && shapeIdx > 0);
  assert.ok(renderIdx < conditionsIdx, 'render pass state belongs above Site conditions');
  assert.ok(renderIdx < shapeIdx, 'render pass state belongs above the crawl charts');
  // Unrun is a coverage fact, so it is hatched rather than given a severity colour.
  assert.match(overlay, /\.render-section\[data-state=none\][^}]*var\(--sa-hatch\)/);
});

test('listUrls narrows to crawl states so a coverage-gap count can be opened', () => {
  const store = openAuditStore(':memory:');
  const id = store.createAudit({ siteOrigin: 'https://example.com', startUrl: 'https://example.com/', config: {} });
  for (const p of ['a', 'b', 'c', 'd']) store.enqueueUrl(id, 'https://example.com/' + p, 'seed');
  store.recordUrlResult(id, 'https://example.com/a', { status: 'fetched', httpStatus: 200 });
  store.recordUrlResult(id, 'https://example.com/b', { status: 'error', error: 'boom' });
  store.recordUrlResult(id, 'https://example.com/c', { status: 'skipped', error: 'robots-disallowed' });
  // /d is left queued.

  assert.equal(store.listUrls(id).length, 4, 'no filter lists everything');
  assert.equal(store.listUrls(id, { statuses: 'fetched' }).length, 1);
  assert.equal(store.listUrls(id, { statuses: URL_GAP_STATUSES }).length, 3);
  assert.deepEqual(
    store.listUrls(id, { statuses: 'queued,error,skipped' }).map((u) => u.status).sort(),
    ['error', 'queued', 'skipped']
  );
  // Pagination applies inside the filtered set, not across the whole crawl.
  assert.equal(store.listUrls(id, { statuses: URL_GAP_STATUSES, limit: 2 }).length, 2);
  assert.equal(store.listUrls(id, { statuses: URL_GAP_STATUSES, limit: 2, offset: 2 }).length, 1);
  store.close();
});

test('an unknown status filter is dropped rather than reaching SQL', () => {
  // The filter is caller-supplied, so the only values that can be interpolated
  // into the IN clause are '?' placeholders for allow-listed statuses.
  assert.deepEqual(normalizeUrlStatuses('fetched'), ['fetched']);
  assert.deepEqual(normalizeUrlStatuses(' FETCHED '), ['fetched']);
  assert.deepEqual(normalizeUrlStatuses('fetched,fetched'), ['fetched']);
  assert.deepEqual(normalizeUrlStatuses('fetched,bogus'), ['fetched']);
  assert.deepEqual(normalizeUrlStatuses('bogus'), []);
  assert.deepEqual(normalizeUrlStatuses("fetched'); DROP TABLE audit_urls;--"), []);
  assert.deepEqual(normalizeUrlStatuses(null), []);
  for (const status of URL_STATUSES) assert.deepEqual(normalizeUrlStatuses(status), [status]);

  const store = openAuditStore(':memory:');
  const id = store.createAudit({ siteOrigin: 'https://example.com', startUrl: 'https://example.com/', config: {} });
  store.enqueueUrl(id, 'https://example.com/a', 'seed');
  // An unrecognized filter falls back to the full list rather than erroring:
  // an older client asking for a status this build dropped should still see
  // its pages.
  assert.equal(store.listUrls(id, { statuses: 'nonsense' }).length, 1);
  assert.equal(store.listUrls(id, { statuses: "a'); DROP TABLE audit_urls;--" }).length, 1);
  assert.equal(store.listUrls(id).length, 1, 'the table is still there');
  store.close();
});

/**
 * A check that has already run must never be reported as one that has not.
 *
 * robots.txt, the XML sitemap and llms.txt are all fetched in the discovering
 * phase, before a single page is crawled. But stats_json was written only by
 * finishAudit(), so for the whole length of a crawl the results view had no
 * access to answers the audit had settled minutes earlier — and said so, in
 * those words: "Not checked in this audit".
 */
test('site signals are readable while the crawl is still running', () => {
  const store = openAuditStore(':memory:');
  const id = store.createAudit({ siteOrigin: 'https://example.com', startUrl: 'https://example.com/', config: {} });
  // The audit is still running: nothing has called finishAudit.
  assert.equal(store.getAudit(id).stats, null);
  const signals = { origin: 'https://example.com', robots: { present: true, status: 200 }, sitemap: { present: true, urlCount: 106 }, llmsTxt: { present: true, status: 200, bytes: 1576 } };
  store.mergeAuditStats(id, { siteSignals: signals });
  assert.deepEqual(store.getAudit(id).stats.siteSignals, signals, 'a settled fact is readable the moment it is settled');
  // The merge is additive: a later write must not drop what is already there.
  store.mergeAuditStats(id, { pagesProcessed: 3 });
  assert.equal(store.getAudit(id).stats.siteSignals.sitemap.urlCount, 106);
  assert.equal(store.getAudit(id).stats.pagesProcessed, 3);
  store.close();
});

test('the crawl records its site signals before it starts crawling', () => {
  const crawler = fs.readFileSync('packages/crawl/crawler.js', 'utf8');
  const collect = crawler.indexOf('const siteSignals = await collectSiteSignals(');
  const persist = crawler.indexOf('store.mergeAuditStats(auditId, { siteSignals })');
  const firstFetch = crawler.indexOf("store.setPhase(auditId, 'analyzing')");
  assert.ok(collect > 0 && persist > 0, 'signals should be collected and persisted');
  assert.ok(persist > collect, 'persisted after collection');
  assert.ok(persist < firstFetch, 'and long before the crawl finishes');
});

test('a pending check is never worded as a skipped one', () => {
  // Three surfaces reported "not checked" for work that was either already
  // done or still in flight. Each now distinguishes the two.
  assert.match(overlay, /Being fetched — this audit reads it before it crawls/);
  // The conditions readout is populated from the signals while the crawl is
  // still running, rather than staying blank until the server composes it.
  const summary = overlay.match(/function renderAuditSummary\(audit\)[\s\S]*?\n  \}/);
  assert.ok(summary, 'renderAuditSummary should exist');
  assert.match(summary[0], /composed\.length \? composed : \(signals \? provisionalConditionRows\(signals\)/,
    'a running audit stands in the settled signals rather than showing nothing');
  const provisional = overlay.match(/function provisionalConditionRows\(signals\)[\s\S]*?\n  \}/);
  assert.ok(provisional, 'provisionalConditionRows should exist');
  // Same ids as the server composes, so its rows replace these seamlessly.
  for (const id of ['indexable', 'sitemap', 'llms']) {
    assert.ok(provisional[0].includes(`id: '${id}'`), `${id} must use the composed row's own id`);
  }
});

/**
 * The reverse failure: a check that did NOT run must never be reported as a
 * clean result. seo.js withholds "sitemap URL never reached" when the page
 * limit cut the crawl short, because unreached would only mean "not gotten to
 * yet". The Sitemaps tile rendered that silence as a confident 0.
 */
test('a withheld sitemap comparison reads as not compared, never as zero', () => {
  const builder = overlay.match(/    sitemaps\(\) \{[\s\S]*?\n    \},/);
  assert.ok(builder, 'the sitemaps section builder should exist');
  const body = builder[0];
  assert.match(body, /pageLimitStopped\(audit\)/, 'the page limit is what withholds the comparison');
  assert.match(body, /label: 'Never reached', value: '—'/, 'an em-dash, not a zero');
  assert.match(body, /not compared/);
  assert.match(body, /have not been compared against the crawl, because/, 'and the coverage line says why');
  // The gate it mirrors must still exist on the scanner side.
  const seo = fs.readFileSync('packages/crawl/scanners/seo.js', 'utf8');
  assert.match(seo, /if \(unreachedCount > 0 && !ctx\.maxPagesReached\)/);
});

test('pageLimitStopped is derived from the crawl, not assumed', () => {
  const fn = overlay.match(/function pageLimitStopped\(audit\)[\s\S]*?\n  \}/);
  assert.ok(fn, 'pageLimitStopped should exist');
  assert.match(fn[0], /counts\.queued/, 'a queued backlog is what "the limit stopped it" means');
});

test('the three published documents are stated once, and can be opened', () => {
  // They were briefly a second Overview block restating the three facts the
  // conditions rows above them already carried, in different words. One
  // readout now owns them, and the link that block existed for came with it.
  assert.doesNotMatch(overlay, /class="signals"/, 'the duplicate block is gone');
  // The Sitemaps section legitimately keeps that phrase in its own lede; what
  // must not come back is a second Overview block headed with it.
  assert.doesNotMatch(overlay, /feed-heading">What this site publishes/);
  const url = overlay.match(/function conditionDocumentUrl\(rowId, signals, origin\)[\s\S]*?\n  \}/);
  assert.ok(url, 'conditionDocumentUrl should exist');
  assert.match(url[0], /robots\.txt/);
  assert.match(url[0], /llms\.txt/);
  assert.match(url[0], /signals\?\.sitemap\?\.source/);
  // A proposed convention's absence is context, never a defect.
  const provisional = overlay.match(/function provisionalConditionRows\(signals\)[\s\S]*?\n  \}/)[0];
  assert.match(provisional, /llms\.present === false[\s\S]*?state: 'ok'/, 'no llms.txt is not a fault');
  assert.match(provisional, /its absence is not a defect/);
  assert.match(overlay, /openBtn\.className = 'cond-open'/);
});

test('indexability is visible per page, not only as an aggregate', () => {
  // audit_urls.indexable was recorded on every crawled page and shown nowhere,
  // so "20 of 20 indexable" could not be checked against a single row.
  assert.match(overlay, /<th data-sort="indexable" class="col-status">Indexable<\/th>/);
  assert.match(overlay, /pill\.textContent = 'noindex'/);
  // And both indexability tiles open the pages behind their number.
  assert.match(overlay, /openUrlsScoped\(\{ indexable: 'no' \}\)/);
  assert.match(overlay, /openUrlsScoped\(\{ indexable: 'yes' \}\)/);
});

test('the indexable filter is tri-state, so an unread page is neither', () => {
  const store = openAuditStore(':memory:');
  const id = store.createAudit({ siteOrigin: 'https://example.com', startUrl: 'https://example.com/', config: {} });
  store.enqueueUrl(id, 'https://example.com/a', 'link', 1);
  store.recordUrlResult(id, 'https://example.com/a', { status: 'fetched', httpStatus: 200, indexable: true });
  store.enqueueUrl(id, 'https://example.com/b', 'link', 1);
  store.recordUrlResult(id, 'https://example.com/b', { status: 'fetched', httpStatus: 200, indexable: false });
  // Never fetched, so its indexability was never read.
  store.enqueueUrl(id, 'https://example.com/c', 'link', 1);

  assert.equal(store.listUrls(id, { indexable: 'yes' }).length, 1);
  assert.equal(store.listUrls(id, { indexable: 'no' }).length, 1);
  // The unread page appears in neither, and is not swept into either bucket.
  assert.equal(store.listUrls(id).length, 3);
  assert.equal(store.listUrls(id, { indexable: 'maybe' }).length, 3, 'an unusable value widens rather than errors');
  store.close();
});
