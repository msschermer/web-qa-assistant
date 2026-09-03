/**
 * Phase 1 of the Sitebulb parity plan (docs/SITEBULB-PARITY-PLAN.md): the Site
 * Audit report gains a section per discipline, drawn entirely from data the
 * crawl already collected.
 *
 * What is locked down here:
 *   1. The nav carries the planned sections, grouped, with availability ahead
 *      of accessibility — the standing prioritization rule made structural.
 *   2. Every rule id any scanner can emit lands in exactly one discipline, so
 *      no finding can fall out of the report.
 *   3. A section ranks its findings by severity, never by instance count.
 *   4. Every discipline states its own coverage, and a discipline whose
 *      evidence tier never ran reads as "Not established", never as clean.
 *   5. Crawl depth is persisted (it used to be computed and discarded) and
 *      keeps the shortest route to a URL.
 *   6. The distributions are aggregates over already-collected columns, they
 *      summarise fetched pages only, and their bands agree with the findings
 *      they sit beside.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { openAuditStore, normalizeUrlDepth, HTTP_STATUS_CLASS_RANGE } from '../packages/crawl/store.js';

const overlay = fs.readFileSync('apps/extension/content.js', 'utf8');

/** content.js is one content-script IIFE with no exports, so lift the real
 * declarations out of the source and evaluate them rather than a copy. */
function lift(names) {
  const parts = [];
  for (const name of names) {
    // A declaration ends at its own closing line: `];` for the array
    // constants, `};` for the object ones, `}` for a function.
    const re = new RegExp(`^  (?:const|function) ${name}\\b[\\s\\S]*?\\r?\\n  [\\]}];?$`, 'm');
    const m = overlay.match(re);
    assert.ok(m, `${name} should exist in content.js`);
    parts.push(m[0]);
  }
  return new Function(`${parts.join('\n')}\nreturn { ${names.join(', ')} };`)();
}

// --- 1. The nav ------------------------------------------------------------

test('the report nav is two destinations, then Explore, then Validate', () => {
  const { SITE_AUDIT_NAV_GROUPS, SITE_AUDIT_TAB_LABEL } = lift(['SITE_AUDIT_NAV_GROUPS', 'SITE_AUDIT_TAB_LABEL']);
  assert.deepEqual(SITE_AUDIT_NAV_GROUPS.map((g) => g.label), ['', 'Explore', 'Validate']);
  assert.deepEqual(SITE_AUDIT_NAV_GROUPS[0].items, ['overview', 'findings'], 'the audit is read here');
  assert.deepEqual(SITE_AUDIT_NAV_GROUPS[1].items, ['urls', 'links'], 'the rows are interrogated here');
  assert.deepEqual(SITE_AUDIT_NAV_GROUPS[2].items, ['browser'], 'the evidence that must be asked for');
  for (const id of SITE_AUDIT_NAV_GROUPS.flatMap((g) => g.items)) assert.ok(SITE_AUDIT_TAB_LABEL[id], id + ' needs a label');
});

test('Pages and Links carry sub-views, and every one is a scope the store can answer', () => {
  const { SITE_AUDIT_SUBVIEWS } = lift(['SITE_AUDIT_SUBVIEWS']);
  assert.deepEqual(Object.keys(SITE_AUDIT_SUBVIEWS), ['urls', 'links']);
  // A sub-view that cannot narrow the query behind it is a bookmark wearing
  // navigation's clothes. Each one names a real store filter.
  for (const v of SITE_AUDIT_SUBVIEWS.urls) {
    assert.ok(v.id && v.label, 'a sub-view needs an id and a label');
    if (v.id === 'all') continue;
    const keys = Object.keys(v.scope || {});
    assert.ok(keys.length, v.id + ' must carry a scope');
    for (const k of keys) assert.ok(['statuses', 'indexable', 'depth', 'httpClass'].includes(k), k + ' is not a listUrls filter');
  }
  for (const v of SITE_AUDIT_SUBVIEWS.links) assert.ok('status' in v, v.id + ' must name a link status');
});

test('the disciplines survive the nav change as the Findings area filter', () => {
  // The ten discipline sections are gone from the nav. The taxonomy is not:
  // it moved to the filter on the list it narrows, which is where a lens
  // belongs. Losing it would have dropped the rule-to-area map entirely.
  const { SITE_AUDIT_AREA_LABEL, SITE_AUDIT_DISCIPLINE_META } = lift(['SITE_AUDIT_AREA_LABEL', 'SITE_AUDIT_DISCIPLINE_META']);
  assert.deepEqual(Object.keys(SITE_AUDIT_AREA_LABEL), Object.keys(SITE_AUDIT_DISCIPLINE_META), 'every discipline is an area');
  assert.match(overlay, /<select class="findings-impact"/, 'the filter is on Findings');
  const filter = overlay.match(/function renderImpactFilter\(groups\)[\s\S]*?\n  \}/);
  assert.ok(filter, 'the area filter should exist');
  assert.match(filter[0], /disciplineOf\(g\.rule_id\)/, 'areas are disciplines, not impact classes');
  // And the pattern list it filters agrees with it.
  assert.match(overlay, /!area \|\| disciplineOf\(g\.rule_id\) === area/, 'the pattern list filters by the same map');
});

test('availability leads the areas and accessibility does not', () => {
  const { SITE_AUDIT_AREA_LABEL } = lift(['SITE_AUDIT_AREA_LABEL']);
  const order = Object.keys(SITE_AUDIT_AREA_LABEL);
  assert.equal(order[0], 'availability', 'a confirmed functional failure leads');
  assert.ok(order.indexOf('availability') < order.indexOf('accessibility'),
    'accessibility is the cheapest discipline to detect in volume, which is not a claim to precedence');
});

test('the evidence that must be asked for is separated, and says so', () => {
  // Performance and accessibility are the two areas that can legitimately
  // hold nothing, because their evidence comes from a pass that has to be
  // started. They sit under Validate, and the nav row carries a state rather
  // than a count — a count of zero would read as a clean result.
  const { SITE_AUDIT_DISCIPLINE_META } = lift(['SITE_AUDIT_DISCIPLINE_META']);
  for (const id of ['performance', 'accessibility']) assert.equal(SITE_AUDIT_DISCIPLINE_META[id].evidence, 'render');
  const nav = overlay.match(/function renderNavStates\(\)[\s\S]*?\n  \}/);
  assert.ok(nav, 'renderNavStates should exist');
  assert.match(nav[0], /id === 'browser'/);
  assert.match(nav[0], /'Not run'/, 'an unrun pass says so rather than showing zero');
  assert.match(overlay, /class="tab-panel browser-panel"/);
});

// --- 2. No finding can fall out of the report ------------------------------

/** Every rule id the static tier and the rendered tier can emit. */
function everyRuleId() {
  const sources = [
    ...fs.readdirSync('packages/crawl/scanners').map((f) => `packages/crawl/scanners/${f}`),
    'packages/rules/browser-rules.js'
  ];
  const ids = new Set();
  for (const file of sources) {
    const text = fs.readFileSync(file, 'utf8');
    for (const m of text.matchAll(/ruleId: *['"`]([a-zA-Z0-9._-]+)['"`]/g)) ids.add(m[1]);
  }
  return [...ids];
}

test('every rule id any scanner can emit lands in exactly one discipline', () => {
  const { SITE_AUDIT_DISCIPLINE_RULES, disciplineOf, SITE_AUDIT_DISCIPLINE_META } =
    lift(['SITE_AUDIT_DISCIPLINE_RULES', 'disciplineOf', 'SITE_AUDIT_DISCIPLINE_META']);
  const ids = everyRuleId();
  assert.ok(ids.length > 40, `expected the real rule inventory, got ${ids.length}`);
  for (const id of ids) {
    const discipline = disciplineOf(id);
    assert.ok(
      SITE_AUDIT_DISCIPLINE_META[discipline],
      `${id} maps to "${discipline}", which is not a section — the finding would be invisible in every discipline`
    );
  }
  // Every declared discipline is reachable, so the nav holds no dead section.
  const reachable = new Set(ids.map((id) => disciplineOf(id)));
  const declared = SITE_AUDIT_DISCIPLINE_RULES.map(([id]) => id);
  for (const id of declared) {
    assert.ok(SITE_AUDIT_DISCIPLINE_META[id], `${id} has rules but no section metadata`);
  }
  assert.ok(reachable.size >= 8, `only ${reachable.size} disciplines are reachable from the rule inventory`);
});

test('order-sensitive rule mappings resolve to the discipline that owns the fact', () => {
  const { disciplineOf } = lift(['SITE_AUDIT_DISCIPLINE_RULES', 'disciplineOf']);
  // a11y.lang-* is an International fact before it is an accessibility one.
  assert.equal(disciplineOf('a11y.lang-missing'), 'international');
  assert.equal(disciplineOf('seo.hreflang-invalid'), 'international');
  // A missing meta refresh is an indexability problem, not generic markup.
  assert.equal(disciplineOf('web.meta-refresh'), 'indexability');
  assert.equal(disciplineOf('seo.canonical-missing'), 'indexability');
  // Duplicates and sitemaps are carved out of the seo.* prefix.
  assert.equal(disciplineOf('seo.duplicate-title'), 'duplicates');
  assert.equal(disciplineOf('structure.duplicate-h1'), 'duplicates');
  assert.equal(disciplineOf('seo.sitemap-orphan'), 'sitemaps');
  // Link failures are availability, whichever tier found them.
  assert.equal(disciplineOf('navigation.link-404-external'), 'availability');
  assert.equal(disciplineOf('runtime.visible-error'), 'availability');
  // The catch-all still catches.
  assert.equal(disciplineOf('web.viewport-missing'), 'quality');
  assert.equal(disciplineOf('some.rule-nobody-has-written-yet'), 'quality');
  // And the render-pass disciplines keep their own.
  assert.equal(disciplineOf('performance.browser.lcp'), 'performance');
  assert.equal(disciplineOf('axe.color-contrast'), 'accessibility');
});

// --- 3. A section ranks by severity, not by volume -------------------------

test('a discipline section ranks confirmed severity above instance count', () => {
  const { disciplineGroups } = lift(['SITE_AUDIT_DISCIPLINE_RULES', 'disciplineOf', 'disciplineGroups']);
  // The real shape of the defect this replaced: on a site that rate-limits
  // automated requests, one unverifiable group carried 3,519 instances and led
  // Availability while 38 confirmed 404s sat underneath it.
  globalThis.siteAudit = {
    rawFindingGroups: [
      { rule_id: 'navigation.link-review', severity: 'low', confidence: 'inconclusive', instances: 3519, affected_urls: 10 },
      { rule_id: 'navigation.link-404-external', severity: 'high', confidence: 'confirmed', instances: 38, affected_urls: 2 },
      { rule_id: 'navigation.link-410-external', severity: 'high', confidence: 'confirmed', instances: 2, affected_urls: 2 }
    ]
  };
  try {
    const ranked = disciplineGroups('availability').map((g) => g.rule_id);
    assert.deepEqual(ranked, ['navigation.link-404-external', 'navigation.link-410-external', 'navigation.link-review']);
  } finally {
    delete globalThis.siteAudit;
  }
});

// --- 4. Coverage per section ----------------------------------------------

test('every discipline states what its evidence covers', () => {
  const { SITE_AUDIT_DISCIPLINE_META } = lift(['SITE_AUDIT_DISCIPLINE_META']);
  for (const [id, meta] of Object.entries(SITE_AUDIT_DISCIPLINE_META)) {
    assert.ok(meta.lede && meta.lede.length > 40, `${id} needs a lede that says what the section is`);
    assert.ok(meta.findingsNote, `${id} needs a note above its findings list`);
    assert.ok(['static', 'links', 'signals', 'render'].includes(meta.evidence), `${id} has an unknown evidence tier`);
  }
});

test('a section panel carries a coverage statement of its own', () => {
  // Structural: the shared section panel has one coverage line with the same
  // three states the Site conditions readout uses, and it is stated before
  // any figure in the section.
  const panel = overlay.match(/<div class="tab-panel section-panel"[\s\S]*?<\/div>\r?\n          <\/div>/);
  assert.ok(panel, 'the shared discipline section panel should exist');
  const markup = panel[0];
  const covIdx = markup.indexOf('coverage-line');
  const statsIdx = markup.indexOf('section-stats');
  assert.ok(covIdx > 0 && statsIdx > 0, 'both the coverage line and the figures should exist');
  assert.ok(covIdx < statsIdx, 'a section states its coverage before it states its figures');
  assert.match(overlay, /\.coverage-line\[data-state=unknown\]\{[^}]*border-style:dashed/);
});

test('a render-pass discipline with nothing measured reads as unestablished, not clean', () => {
  const source = overlay.match(/  function renderPassSection\([\s\S]*?\n  \}/);
  assert.ok(source, 'renderPassSection should exist');
  const body = source[0];
  assert.match(body, /state: 'unknown'/, 'nothing measured is an unknown state, never ok');
  assert.match(body, /gap in coverage, not a clean result/);
  // And it offers the pass rather than leaving the operator with an empty page.
  assert.match(body, /run: startRenderPass/);
  // The unmeasured figures are held open with an em-dash, which cannot be
  // misread as a measurement of zero.
  assert.match(body, /value: '—'/);
});

test('a section nav chip counts established findings, not unverifiable volume', () => {
  const source = overlay.match(/  function disciplineState\([\s\S]*?\n  \}/);
  assert.ok(source, 'disciplineState should exist');
  assert.match(source[0], /filter\(\(g\) => g\.confidence !== 'inconclusive'\)/);
  // A section whose own coverage statement says something is wrong cannot show
  // a green dot beside it.
  assert.match(source[0], /coverageState === 'attention'/);
  assert.match(source[0], /coverageState === 'unknown'/);
});

// --- 5. Depth is persisted -------------------------------------------------

test('crawl depth is stored, not recomputed and discarded', () => {
  const store = openAuditStore(':memory:');
  const id = store.createAudit({ siteOrigin: 'https://example.com', startUrl: 'https://example.com/', config: {} });
  store.enqueueUrl(id, 'https://example.com/', 'start', 0);
  store.enqueueUrl(id, 'https://example.com/a', 'link', 1);
  store.enqueueUrl(id, 'https://example.com/b/c', 'link', 2);
  const rows = store.listUrls(id);
  assert.deepEqual(rows.map((r) => r.depth), [0, 1, 2]);
  store.close();
});

test('a URL reached again from deeper in the site keeps its shortest route', () => {
  const store = openAuditStore(':memory:');
  const id = store.createAudit({ siteOrigin: 'https://example.com', startUrl: 'https://example.com/', config: {} });
  assert.equal(store.enqueueUrl(id, 'https://example.com/a', 'link', 1), true);
  // The same page linked again from four hops in must not be re-labelled.
  assert.equal(store.enqueueUrl(id, 'https://example.com/a', 'link', 4), false);
  assert.equal(store.listUrls(id)[0].depth, 1);
  store.close();
});

test('recording a fetch result does not erase the depth recorded at enqueue', () => {
  const store = openAuditStore(':memory:');
  const id = store.createAudit({ siteOrigin: 'https://example.com', startUrl: 'https://example.com/', config: {} });
  store.enqueueUrl(id, 'https://example.com/a', 'link', 3);
  store.recordUrlResult(id, 'https://example.com/a', { status: 'fetched', httpStatus: 200, title: 'A' });
  assert.equal(store.listUrls(id)[0].depth, 3);
  store.close();
});

test('the depth distribution covers discovered URLs, not just fetched ones', () => {
  // A page-limited crawl's most useful sentence is "31 URLs found at depth 3,
  // none of them reached". A fetched-only chart could not say it.
  const store = openAuditStore(':memory:');
  const id = store.createAudit({ siteOrigin: 'https://example.com', startUrl: 'https://example.com/', config: {} });
  store.enqueueUrl(id, 'https://example.com/', 'start', 0);
  store.recordUrlResult(id, 'https://example.com/', { status: 'fetched', httpStatus: 200 });
  store.enqueueUrl(id, 'https://example.com/a', 'link', 1);
  store.enqueueUrl(id, 'https://example.com/b', 'link', 1);
  const depth = store.auditDistributions(id).depth;
  assert.deepEqual(depth, [
    { depth: 0, status: 'fetched', n: 1 },
    { depth: 1, status: 'queued', n: 2 }
  ]);
  store.close();
});

// --- 6. The distributions -------------------------------------------------

function seededStore() {
  const store = openAuditStore(':memory:');
  const id = store.createAudit({ siteOrigin: 'https://example.com', startUrl: 'https://example.com/', config: {} });
  store.enqueueUrl(id, 'https://example.com/', 'start', 0);
  store.recordUrlResult(id, 'https://example.com/', {
    status: 'fetched', httpStatus: 200, canonical: 'https://example.com/', indexable: true,
    title: 'A perfectly ordinary title', metaDescription: 'x'.repeat(80), h1Count: 1, wordCount: 700, h1Text: 'Home'
  });
  store.enqueueUrl(id, 'https://example.com/dup', 'link', 1);
  store.recordUrlResult(id, 'https://example.com/dup', {
    status: 'fetched', httpStatus: 404, canonical: '', indexable: false,
    title: 'A perfectly ordinary title', metaDescription: '', h1Count: 0, wordCount: 40, h1Text: 'Home'
  });
  // Never fetched: it has no title to be missing.
  store.enqueueUrl(id, 'https://example.com/never', 'link', 2);
  return { store, id };
}

test('distributions summarise fetched pages only, so a coverage gap is not a content defect', () => {
  const { store, id } = seededStore();
  const d = store.auditDistributions(id);
  assert.equal(d.pages.fetched, 2, 'the never-fetched page is not a fetched page');
  // Exactly one fetched page lacks a title-length band's worth of description.
  assert.equal(d.pages.description.missing, 1);
  assert.equal(d.pages.title.missing, 0, 'the queued page must not count as a missing title');
  assert.equal(d.pages.h1.none, 1);
  assert.equal(d.pages.words.thin, 1);
  assert.equal(d.pages.indexable, 1);
  assert.equal(d.pages.noindex, 1);
  store.close();
});

test('length bands use the same cuts as the findings they sit beside', () => {
  // seo.js: TITLE_MIN 15 / TITLE_MAX 65, DESCRIPTION_MIN 50 / DESCRIPTION_MAX 160.
  const seo = fs.readFileSync('packages/crawl/scanners/seo.js', 'utf8');
  const cut = (name) => Number(seo.match(new RegExp(`const ${name} = (\\d+)`))[1]);
  const store = fs.readFileSync('packages/crawl/store.js', 'utf8');
  const band = store.match(/auditDistributions\(auditId\)[\s\S]*?\n    \},/)[0];
  assert.match(band, new RegExp(`LENGTH\\(title\\) < ${cut('TITLE_MIN')}`));
  assert.match(band, new RegExp(`LENGTH\\(title\\) BETWEEN ${cut('TITLE_MIN')} AND ${cut('TITLE_MAX')}`));
  assert.match(band, new RegExp(`LENGTH\\(meta_description\\) < ${cut('DESCRIPTION_MIN')}`));
  assert.match(band, new RegExp(`LENGTH\\(meta_description\\) BETWEEN ${cut('DESCRIPTION_MIN')} AND ${cut('DESCRIPTION_MAX')}`));
});

test('canonical declarations are classified as self, elsewhere or missing', () => {
  const { store, id } = seededStore();
  const { canonical } = store.auditDistributions(id);
  assert.deepEqual(canonical, { missing: 1, self: 1, other: 0 });
  store.close();
});

test('duplicate sets come from the crawled pages themselves, not from a finding count', () => {
  const { store, id } = seededStore();
  const { duplicates } = store.auditDistributions(id);
  assert.deepEqual(duplicates.titles, [{ value: 'A perfectly ordinary title', pages: 2 }]);
  assert.deepEqual(duplicates.h1s, [{ value: 'Home', pages: 2 }]);
  // An empty description is not a duplicate of another empty description.
  assert.deepEqual(duplicates.descriptions, []);
  store.close();
});

test('links are split by internal versus external, because the fix differs', () => {
  const { store, id } = seededStore();
  store.recordLinks(id, 'https://example.com/', [
    { url: 'https://example.com/a', internal: true, status: 'healthy' },
    { url: 'https://example.org/x', internal: false, status: 'broken' },
    { url: 'https://example.org/y', internal: false, status: 'broken' }
  ]);
  const scope = store.auditDistributions(id).linksByScope;
  assert.deepEqual(
    scope.sort((a, b) => String(a.internal).localeCompare(String(b.internal))),
    [{ internal: false, status: 'broken', n: 2 }, { internal: true, status: 'healthy', n: 1 }]
  );
  store.close();
});

// --- The chart drill-ins -------------------------------------------------

test('a depth bar and a status bar each open the pages behind them', () => {
  const { store, id } = seededStore();
  assert.equal(store.listUrls(id, { depth: 1 }).length, 1);
  assert.equal(store.listUrls(id, { depth: 2 }).length, 1);
  assert.equal(store.listUrls(id, { httpClass: '2xx' }).length, 1);
  assert.equal(store.listUrls(id, { httpClass: '4xx' }).length, 1);
  assert.equal(store.listUrls(id, { httpClass: '5xx' }).length, 0);
  // Combined with a crawl state, the scopes intersect.
  assert.equal(store.listUrls(id, { statuses: 'fetched', httpClass: '4xx' }).length, 1);
  assert.equal(store.listUrls(id, { statuses: 'queued', httpClass: '4xx' }).length, 0);
  store.close();
});

test('an unusable depth or status class widens the listing rather than erroring', () => {
  const { store, id } = seededStore();
  const all = store.listUrls(id).length;
  assert.equal(normalizeUrlDepth('nonsense'), null);
  assert.equal(normalizeUrlDepth(-1), null);
  assert.equal(normalizeUrlDepth('2'), 2);
  assert.equal(store.listUrls(id, { depth: 'nonsense' }).length, all);
  assert.equal(store.listUrls(id, { httpClass: 'DROP TABLE audit_urls' }).length, all);
  assert.deepEqual(Object.keys(HTTP_STATUS_CLASS_RANGE), ['2xx', '3xx', '4xx', '5xx']);
  store.close();
});

test('the Pages scope note describes a depth or status scope, not just a crawl state', () => {
  const source = overlay.match(/  function renderScopedNote\(\)[\s\S]*?\n  \}/);
  assert.ok(source, 'renderScopedNote should exist');
  assert.match(source[0], /link hop/, 'arriving from a depth bar must say which depth');
  assert.match(source[0], /that answered/, 'arriving from a status bar must say which status');
  // Clearing the scope has to clear every axis, or a stale filter survives.
  const clear = overlay.match(/scoped-clear'\)\.addEventListener\([\s\S]*?\}\);/);
  assert.ok(clear, 'the scope-clear handler should exist');
  for (const field of ['urlsStatus', 'urlsDepth', 'urlsHttpClass']) {
    assert.match(clear[0], new RegExp(`siteAudit\\.${field} =`), `clearing the scope must reset ${field}`);
  }
});

// --- The sections and the Overview do not share a container ----------------

test('a discipline section paints into its own container, not the Overview chart grid', () => {
  // Both use the .section-grid layout class and the Overview's copy appears
  // first in the DOM, so a `.section-grid` lookup silently painted every
  // discipline's distributions into the Overview and left the section empty.
  assert.match(overlay, /<div class="section-grid section-blocks"><\/div>/);
  assert.match(overlay, /<div class="section-grid crawl-shape"><\/div>/);
  const render = overlay.match(/  function renderDisciplineSection\(id\)[\s\S]*?\n  \}/)[0];
  assert.match(render, /querySelector\('\.section-blocks'\)/);
  assert.doesNotMatch(render, /querySelector\('\.section-grid'\)/);
});

test('the shared finding-row component still serves every list that uses rows', () => {
  // Findings became a pattern table with its own detail pane, so it no longer
  // uses the row component. Everything that still renders rows — each
  // discipline section, and the browser-checks view — shares one, so an
  // operator who has learned to read a finding row meets the same one.
  assert.match(overlay, /function renderFindingRowsInto\(list, groups, emptyText\)/);
  const section = overlay.match(/ {2}function renderDisciplineSection\(id\)[\s\S]*?\n {2}\}/);
  assert.ok(section, 'renderDisciplineSection should exist');
  assert.match(section[0], /renderFindingRowsInto\(/);
  const browser = overlay.match(/ {2}function renderBrowserChecks\(\)[\s\S]*?\n {2}\}/);
  assert.ok(browser, 'renderBrowserChecks should exist');
  assert.match(browser[0], /renderFindingRowsInto\(/);
});
