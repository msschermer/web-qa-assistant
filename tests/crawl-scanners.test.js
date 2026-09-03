import test from 'node:test';
import assert from 'node:assert/strict';
import { runPerPageScanners, runCrossPageScanners } from '../packages/crawl/scanners/index.js';

function meta(overrides = {}) {
  return {
    title: 'A Perfectly Reasonable Page Title', titleCount: 1,
    description: 'A perfectly reasonable meta description that sits comfortably inside the normal length range for search snippets.', descriptionCount: 1,
    canonical: 'https://example.com/page', canonicalCount: 1,
    robots: '', h1s: ['Heading'], wordCount: 400,
    schemaBlockCount: 1, schemaInvalidCount: 0, schemaTypes: ['WebPage'],
    hasViewport: true, viewport: 'width=device-width', hasCharset: true, contentType: 'text/html; charset=utf-8',
    hasOgTitle: true, hasOgDescription: true,
    hreflangTags: [], headingLevels: [1], htmlLang: 'en',
    imagesTotal: 0, imagesMissingAlt: 0,
    insecureResourceRefs: [], hasCspUpgradeInsecure: false,
    analyticsSignals: [],
    redirectHops: 0, hadInsecureHop: false,
    h1Text: 'Heading',
    hasHsts: true, hasXContentTypeOptions: true, hasXFrameOptions: true, hasFrameAncestorsCsp: false, hasReferrerPolicy: true,
    hasDoctype: true, hasMetaRefresh: false,
    fragmentLinks: [], elementIds: [],
    formControlsTotal: 0, formControlsMissingLabel: 0,
    ...overrides
  };
}

function ruleIds(findings) { return findings.map((f) => f.ruleId); }

test('every static-tier finding gets a confidence, defaulting to inferred rather than the general confirmed fallback', () => {
  const findings = runPerPageScanners(meta({ title: '' }), 'https://example.com/page');
  const titleMissing = findings.find((f) => f.ruleId === 'seo.title-missing');
  assert.equal(titleMissing.confidence, 'inferred');
  for (const f of findings) assert.ok(f.confidence, `${f.ruleId} must carry an explicit confidence`);
});

test('a genuine heading-level skip (e.g. H1 straight to H3) inside the scoped landmark is still flagged, not just silenced by the false-positive fix', () => {
  const skipped = runPerPageScanners(meta({ headingLevels: [1, 3] }), 'https://example.com/x');
  assert.ok(ruleIds(skipped).includes('structure.heading-skip'));
  const ordered = runPerPageScanners(meta({ headingLevels: [1, 2, 3, 2] }), 'https://example.com/x');
  assert.ok(!ruleIds(ordered).includes('structure.heading-skip'), 'stepping back down a level is normal document structure, not a skip');
});

test('title and description length outliers are flagged with confirmed confidence, since the length itself is directly measured', () => {
  const short = runPerPageScanners(meta({ title: 'Short', description: 'Short too' }), 'https://example.com/x');
  assert.ok(ruleIds(short).includes('seo.title-short'));
  assert.ok(ruleIds(short).includes('seo.description-short'));
  assert.equal(short.find((f) => f.ruleId === 'seo.title-short').confidence, 'confirmed');

  const long = runPerPageScanners(meta({ title: 'A'.repeat(90), description: 'B'.repeat(200) }), 'https://example.com/x');
  assert.ok(ruleIds(long).includes('seo.title-long'));
  assert.ok(ruleIds(long).includes('seo.description-long'));

  const normal = runPerPageScanners(meta(), 'https://example.com/x');
  assert.ok(!ruleIds(normal).some((r) => r.startsWith('seo.title-') && r !== 'seo.title-missing'), 'a normal-length title must not be flagged either way');
});

test('viewport/charset reuse the rendered tier\'s exact ruleIds, and a header-declared charset with no meta tag is correctly not flagged', () => {
  const noViewport = runPerPageScanners(meta({ hasViewport: false }), 'https://example.com/x');
  assert.ok(ruleIds(noViewport).includes('web.viewport-missing'));

  // Charset declared via HTTP header only, no <meta charset> — a real,
  // common pattern the rendered-tier check doesn't account for; the static
  // tier has the header in hand and must not manufacture a false positive.
  const headerCharset = runPerPageScanners(meta({ hasCharset: false, contentType: 'text/html; charset=UTF-8' }), 'https://example.com/x');
  assert.ok(!ruleIds(headerCharset).includes('web.charset-missing'));

  const noCharsetAtAll = runPerPageScanners(meta({ hasCharset: false, contentType: 'text/html' }), 'https://example.com/x');
  assert.ok(ruleIds(noCharsetAtAll).includes('web.charset-missing'));
});

test('hreflang findings reuse the rendered tier\'s exact ruleIds so policy quieting and reporting buckets both still apply', () => {
  const invalid = runPerPageScanners(meta({ hreflangTags: [{ lang: 'en_US', href: 'https://example.com/fr' }] }), 'https://example.com/x');
  assert.ok(ruleIds(invalid).includes('seo.hreflang-invalid'));

  const dup = runPerPageScanners(meta({ hreflangTags: [{ lang: 'fr', href: 'https://example.com/shared' }, { lang: 'de', href: 'https://example.com/shared' }] }), 'https://example.com/x');
  assert.ok(ruleIds(dup).includes('seo.hreflang-duplicate-target'));

  const clean = runPerPageScanners(meta({ hreflangTags: [{ lang: 'fr', href: 'https://example.com/fr' }, { lang: 'x-default', href: 'https://example.com/' }] }), 'https://example.com/x');
  assert.ok(!ruleIds(clean).some((r) => r.startsWith('seo.hreflang')));
});

test('mixed-content-static is suppressed when the page\'s own CSP already upgrades insecure requests, and is otherwise flagged', () => {
  const flagged = runPerPageScanners(meta({ insecureResourceRefs: ['http://cdn.example.com/app.js'] }), 'https://example.com/x');
  assert.ok(ruleIds(flagged).includes('security.mixed-content-static'));

  const suppressed = runPerPageScanners(meta({ insecureResourceRefs: ['http://cdn.example.com/app.js'], hasCspUpgradeInsecure: true }), 'https://example.com/x');
  assert.ok(!ruleIds(suppressed).includes('security.mixed-content-static'), 'upgrade-insecure-requests CSP makes the http:// reference moot in a real browser');
});

test('analytics detection is positive-only: it reports what was found and never claims analytics is absent', () => {
  const found = runPerPageScanners(meta({ analyticsSignals: ['Google Analytics (GA4)'] }), 'https://example.com/x');
  const detected = found.find((f) => f.ruleId === 'analytics.detected');
  assert.ok(detected);
  assert.equal(detected.confidence, 'confirmed');

  const none = runPerPageScanners(meta({ analyticsSignals: [] }), 'https://example.com/x');
  assert.ok(!ruleIds(none).some((r) => r.startsWith('analytics.')), 'absence of a recognized tag must never itself become a finding');
});

test('a long redirect chain is flagged, and severity escalates when any hop was plain http', () => {
  const httpsOnly = runPerPageScanners(meta({ redirectHops: 4, hadInsecureHop: false }), 'https://example.com/x');
  const chain = httpsOnly.find((f) => f.ruleId === 'navigation.redirect-chain-long');
  assert.ok(chain);
  assert.equal(chain.severity, 'medium');

  const withInsecureHop = runPerPageScanners(meta({ redirectHops: 4, hadInsecureHop: true }), 'https://example.com/x');
  const chain2 = withInsecureHop.find((f) => f.ruleId === 'navigation.redirect-chain-long');
  assert.equal(chain2.severity, 'high', 'a chain that passed through plain http should be treated as more severe than an all-https chain');

  const shortChain = runPerPageScanners(meta({ redirectHops: 1, hadInsecureHop: false }), 'https://example.com/x');
  assert.ok(!ruleIds(shortChain).includes('navigation.redirect-chain-long'), 'a single redirect hop is normal and must not be flagged');
});

test('images missing alt are flagged on presence/absence of the attribute only, never on alt="" (a legitimate decorative-image marker)', () => {
  const missing = runPerPageScanners(meta({ imagesTotal: 5, imagesMissingAlt: 2 }), 'https://example.com/x');
  const finding = missing.find((f) => f.ruleId === 'structure.image-alt-missing');
  assert.ok(finding);
  assert.equal(finding.count, 2);

  const allPresent = runPerPageScanners(meta({ imagesTotal: 5, imagesMissingAlt: 0 }), 'https://example.com/x');
  assert.ok(!ruleIds(allPresent).includes('structure.image-alt-missing'));
});

test('security response-header checks fire independently and are confirmed, not inferred, since headers are transport-layer facts unaffected by JS', () => {
  const clean = runPerPageScanners(meta(), 'https://example.com/x');
  assert.deepEqual(ruleIds(clean).filter((id) => id.startsWith('security.')), []);

  const noHsts = runPerPageScanners(meta({ hasHsts: false }), 'https://example.com/x');
  assert.ok(ruleIds(noHsts).includes('security.hsts-missing'));
  assert.equal(noHsts.find((f) => f.ruleId === 'security.hsts-missing').confidence, 'confirmed');

  const httpPage = runPerPageScanners(meta({ hasHsts: false }), 'http://example.com/x');
  assert.ok(!ruleIds(httpPage).includes('security.hsts-missing'), 'HSTS is meaningless over plain http, so a non-https page must never be flagged for lacking it');

  const noSniff = runPerPageScanners(meta({ hasXContentTypeOptions: false }), 'https://example.com/x');
  assert.ok(ruleIds(noSniff).includes('security.content-type-options-missing'));

  const clickjackable = runPerPageScanners(meta({ hasXFrameOptions: false, hasFrameAncestorsCsp: false }), 'https://example.com/x');
  assert.ok(ruleIds(clickjackable).includes('security.clickjacking-exposure'));
  const cspProtected = runPerPageScanners(meta({ hasXFrameOptions: false, hasFrameAncestorsCsp: true }), 'https://example.com/x');
  assert.ok(!ruleIds(cspProtected).includes('security.clickjacking-exposure'), 'a CSP frame-ancestors directive alone is sufficient protection, so X-Frame-Options must not also be required');

  const noReferrerPolicy = runPerPageScanners(meta({ hasReferrerPolicy: false }), 'https://example.com/x');
  assert.ok(ruleIds(noReferrerPolicy).includes('security.referrer-policy-missing'));
});

test('a meta refresh tag and a missing doctype are both flagged, reusing the rendered tier\'s web.meta-refresh ruleId', () => {
  const findings = runPerPageScanners(meta({ hasMetaRefresh: true, hasDoctype: false }), 'https://example.com/x');
  assert.ok(findings.find((f) => f.ruleId === 'web.meta-refresh' && f.confidence === 'confirmed'));
  assert.ok(findings.find((f) => f.ruleId === 'web-quality.doctype-missing' && f.confidence === 'confirmed'));

  const clean = runPerPageScanners(meta({ hasMetaRefresh: false, hasDoctype: true }), 'https://example.com/x');
  assert.ok(!ruleIds(clean).includes('web.meta-refresh'));
  assert.ok(!ruleIds(clean).includes('web-quality.doctype-missing'));
});

test('generic link text ("click here", "read more") is flagged by exact case-insensitive match, not partial/substring match', () => {
  const links = [{ url: 'https://example.com/a', text: 'Click Here' }, { url: 'https://example.com/b', text: 'Read more' }, { url: 'https://example.com/c', text: 'View our Palm Beach probate guide' }];
  const findings = runPerPageScanners(meta({ links }), 'https://example.com/x');
  const finding = findings.find((f) => f.ruleId === 'content.generic-link-text');
  assert.ok(finding);
  assert.equal(finding.count, 2, 'only the two generic-text links should count, not the descriptive third link');

  const descriptiveOnly = runPerPageScanners(meta({ links: [links[2]] }), 'https://example.com/x');
  assert.ok(!ruleIds(descriptiveOnly).includes('content.generic-link-text'));
});

test('an in-page fragment link with no matching id in the static HTML is flagged, reusing the rendered tier\'s navigation.fragment-missing ruleId at inferred confidence', () => {
  const broken = runPerPageScanners(meta({ fragmentLinks: [{ id: 'section-2', text: 'Jump to section 2' }], elementIds: ['section-1'] }), 'https://example.com/x');
  const finding = broken.find((f) => f.ruleId === 'navigation.fragment-missing');
  assert.ok(finding);
  assert.equal(finding.confidence, 'inferred');

  const resolved = runPerPageScanners(meta({ fragmentLinks: [{ id: 'section-1', text: 'Jump to section 1' }], elementIds: ['section-1'] }), 'https://example.com/x');
  assert.ok(!ruleIds(resolved).includes('navigation.fragment-missing'));
});

test('form fields with no label, aria-label, or aria-labelledby in the static HTML are flagged as a11y.form-label-missing', () => {
  const unlabeled = runPerPageScanners(meta({ formControlsTotal: 3, formControlsMissingLabel: 1 }), 'https://example.com/x');
  const finding = unlabeled.find((f) => f.ruleId === 'a11y.form-label-missing');
  assert.ok(finding);
  assert.equal(finding.count, 1);

  const allLabeled = runPerPageScanners(meta({ formControlsTotal: 3, formControlsMissingLabel: 0 }), 'https://example.com/x');
  assert.ok(!ruleIds(allLabeled).includes('a11y.form-label-missing'));
});

test('cross-page: a sitemap URL disallowed by robots.txt is flagged as self-defeating, regardless of sitemap truncation or crawl completeness', () => {
  const sitemapUrls = new Set(['https://example.com/blog', 'https://example.com/wp-admin/hidden']);
  const findings = runCrossPageScanners([], { sitemapFetched: true, sitemapTruncated: true, maxPagesReached: true, sitemapUrls, robotsDisallow: ['/wp-admin/'] });
  assert.ok(findings.get('https://example.com/wp-admin/hidden')?.some((f) => f.ruleId === 'seo.sitemap-blocked-by-robots'));
  assert.ok(!findings.get('https://example.com/blog'), 'a sitemap URL that robots.txt does not disallow must not be flagged');
});

test('cross-page: sitemap-vs-robots conflict check produces nothing when robots.txt has no disallow rules', () => {
  // sitemapTruncated: true isolates this from the unrelated "never reached"
  // check, which would otherwise also fire against an empty fetchedUrls list.
  const sitemapUrls = new Set(['https://example.com/blog']);
  const findings = runCrossPageScanners([], { sitemapFetched: true, sitemapTruncated: true, sitemapUrls, robotsDisallow: [] });
  assert.ok(!findings.get('https://example.com/blog'));
});

test('cross-page: duplicate H1 text across pages is flagged for each page sharing it, using the persisted h1_text column', () => {
  const rows = [
    { url: 'https://example.com/a', title: 'A', meta_description: '', h1_text: 'Contact Us', status: 'fetched', normalized_url: 'https://example.com/a' },
    { url: 'https://example.com/b', title: 'B', meta_description: '', h1_text: 'Contact Us', status: 'fetched', normalized_url: 'https://example.com/b' },
    { url: 'https://example.com/c', title: 'C', meta_description: '', h1_text: 'Unique Heading', status: 'fetched', normalized_url: 'https://example.com/c' }
  ];
  const findings = runCrossPageScanners(rows, {});
  assert.ok(findings.get('https://example.com/a')?.some((f) => f.ruleId === 'structure.duplicate-h1'));
  assert.ok(findings.get('https://example.com/b')?.some((f) => f.ruleId === 'structure.duplicate-h1'));
  assert.ok(!findings.get('https://example.com/c'), 'a page with a unique H1 must not be flagged');
});

test('cross-page: a fetched page with zero internal inbound links is flagged as an orphan, except the start URL itself', () => {
  const rows = [
    { url: 'https://example.com/', normalized_url: 'https://example.com/', status: 'fetched' },
    { url: 'https://example.com/linked', normalized_url: 'https://example.com/linked', status: 'fetched' },
    { url: 'https://example.com/orphan', normalized_url: 'https://example.com/orphan', status: 'fetched' }
  ];
  const inlinkCounts = new Map([['https://example.com/linked', 3]]); // orphan and start URL absent = 0 inbound
  const findings = runCrossPageScanners(rows, { startUrl: 'https://example.com/', inlinkCounts });
  assert.ok(findings.get('https://example.com/orphan')?.some((f) => f.ruleId === 'structure.orphan-page'));
  assert.ok(!findings.get('https://example.com/linked'), 'a page with inbound links must not be flagged');
  assert.ok(!findings.get('https://example.com/'), 'the start URL is never an orphan even with zero recorded inbound links');
});

test('cross-page: sitemap reconciliation only claims "never reached" when the sitemap was fully read and the crawl actually finished', () => {
  const rows = [{ url: 'https://example.com/a', normalized_url: 'https://example.com/a', status: 'fetched', title: '', meta_description: '' }];
  const sitemapUrls = new Set(['https://example.com/a', 'https://example.com/never-reached']);

  const truncated = runCrossPageScanners(rows, { sitemapFetched: true, sitemapTruncated: true, sitemapUrls, maxPagesReached: false });
  assert.ok(!truncated.get('https://example.com/never-reached'), 'a truncated sitemap read must not produce "never reached" findings — they would be an artifact of the truncation, not a real gap');

  const cutOff = runCrossPageScanners(rows, { sitemapFetched: true, sitemapTruncated: false, sitemapUrls, maxPagesReached: true });
  assert.ok(!cutOff.get('https://example.com/never-reached'), 'a crawl cut off by maxPages has not finished exploring, so "never reached" is not yet a meaningful claim');

  const complete = runCrossPageScanners(rows, { sitemapFetched: true, sitemapTruncated: false, sitemapUrls, maxPagesReached: false });
  assert.ok(complete.get('https://example.com/never-reached')?.some((f) => f.ruleId === 'seo.sitemap-unreached'), 'a complete crawl against a fully-read sitemap should surface a genuinely unreached URL');
});

test('cross-page: sitemap reconciliation compares normalized URLs, so a trailing-slash difference is not mistaken for a real gap', () => {
  // Reproduced live against a real site: raw fetched URLs commonly end in a
  // trailing slash (https://example.com/page/) while normalizeAuditUrl strips
  // it — comparing raw against normalized without normalizing both sides
  // made nearly every real page look "not in the sitemap" and every sitemap
  // entry look "never reached", which is exactly the false-positive-by-
  // default failure this check must not have.
  const rows = [{ url: 'https://example.com/blog/', normalized_url: 'https://example.com/blog', status: 'fetched', title: '', meta_description: '' }];
  const sitemapUrls = new Set(['https://example.com/blog']); // normalizeAuditUrl output, as crawler.js builds it
  const findings = runCrossPageScanners(rows, { sitemapFetched: true, sitemapTruncated: false, sitemapUrls, maxPagesReached: false });
  assert.ok(!findings.get('https://example.com/blog/'), 'a page whose only difference from its sitemap entry is a trailing slash must not be flagged as missing from the sitemap');
});

test('cross-page: a crawled page absent from the sitemap is flagged regardless of truncation (that direction is always safe)', () => {
  const rows = [{ url: 'https://example.com/not-in-sitemap', normalized_url: 'https://example.com/not-in-sitemap', status: 'fetched', title: '', meta_description: '' }];
  const findings = runCrossPageScanners(rows, { sitemapFetched: true, sitemapTruncated: true, sitemapUrls: new Set(), maxPagesReached: false });
  const finding = findings.get('https://example.com/not-in-sitemap')?.find((f) => f.ruleId === 'seo.sitemap-orphan');
  assert.ok(finding);
  assert.equal(finding.confidence, 'inferred');
});
