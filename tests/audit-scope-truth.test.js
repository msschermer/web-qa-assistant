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
  assert.match(overlay, /renderSiteAuditRenderSection\(audit\); renderScopeBanner\(audit\);/);
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
  // The panel sits above Site conditions, not below the overview grid.
  const renderIdx = overlay.indexOf('<section class="render-section"');
  const conditionsIdx = overlay.indexOf('<section class="conditions"');
  const gridIdx = overlay.indexOf('<div class="overview-grid">');
  assert.ok(renderIdx > 0 && conditionsIdx > 0 && gridIdx > 0);
  assert.ok(renderIdx < conditionsIdx, 'render pass state belongs above Site conditions');
  assert.ok(renderIdx < gridIdx, 'render pass state belongs above the overview grid');
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
