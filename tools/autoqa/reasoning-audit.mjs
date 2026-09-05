/**
 * A synthetic audit carrying the conditions the reasoning layer exists for.
 *
 * The real test site is well built: zero template merges and zero
 * contradictions, which proves the discipline but shows none of the interface.
 * This builds an audit that has both, so the cards can be looked at rather than
 * assumed. Synthetic throughout, on example.com, per the repository's fixture
 * rule.
 *
 * `npm run autoqa:reasoning-fixture`, then open the audit in the product.
 *
 * This is NOT what the state gallery does, and the two are not substitutes.
 * The gallery renders a template-action card as a specimen: it proves the card
 * is *drawn* correctly, through the cascade the overlay really uses. This
 * proves the card is *earned* — that `buildOptimizePlan()` reads 21 raw
 * findings across 7 pages and concludes there is one template behind them, and
 * that it notices the canonical and the sitemap disagreeing. Deriving and
 * displaying are adjacent rungs and each needs its own fixture; delete this and
 * nothing in the repository exercises the deriving one against a whole audit.
 *
 * It lives beside the harness rather than under a `tools/fixtures/` directory
 * that shadowed the real `fixtures/` at the repository root, and it is tracked,
 * because anything a reader is told to run belongs in the clone.
 */
import { openAuditStore, normalizeAuditUrl } from '../../packages/crawl/store.js';

const store = openAuditStore('data/audits.db');
// One id, replaced on every run. The first version minted a new id each time
// because the store had no delete, which left a fixture audit behind for every
// invocation.
const id = 'audit_fixture_reasoning';
const origin = 'https://example.com';

store.deleteAudit(id);
store.createAudit({ id, siteOrigin: origin, startUrl: `${origin}/`, config: { maxPages: 40 } });

const TEAM = Array.from({ length: 7 }, (_, i) => `${origin}/team/person-${i + 1}`);
const SERVICES = Array.from({ length: 5 }, (_, i) => `${origin}/services/service-${i + 1}`);
const pages = [
  { url: `${origin}/`, title: 'Example Firm', h1: 'Example Firm', words: 1200, schema: ['Organization', 'WebSite'] },
  ...TEAM.map((url, i) => ({
    url, title: `Person ${i + 1} | Example Firm`, h1: 'Our team', words: 640 + i * 5,
    schema: ['WebPage', 'BreadcrumbList']
  })),
  ...SERVICES.map((url, i) => ({
    url, title: `Service ${i + 1} | Example Firm`, h1: `Service ${i + 1}`, words: 900 + i * 7,
    schema: ['Service', 'Organization']
  }))
];

for (const p of pages) {
  store.enqueueUrl(id, p.url, 'link', 1);
  store.recordUrlResult(id, p.url, {
    status: 'fetched', httpStatus: 200, finalUrl: p.url, title: p.title, h1Text: p.h1, h1Count: 1,
    wordCount: p.words, schemaTypes: p.schema, indexable: true,
    // The contradiction: every team page canonicalises to the team index, but
    // the sitemap lists the team pages themselves and not the index.
    canonical: TEAM.includes(p.url) ? `${origin}/team` : p.url,
    metaDescription: SERVICES.includes(p.url) ? 'A service we offer.' : null
  });
}

// Three different things wrong across the same seven team pages: a duplicated
// heading, an over-long title, and no entity markup. One template.
const findings = [];
for (const url of TEAM) {
  findings.push({ url, ruleId: 'structure.duplicate-h1', title: 'Duplicate H1 across pages',
    detail: 'The H1 "Our team" is used on 7 pages.', category: 'fix', severity: 'low', confidence: 'confirmed' });
  findings.push({ url, ruleId: 'seo.title-long', title: 'Title is longer than search results display',
    detail: 'The title is 78 characters.', category: 'fix', severity: 'low', confidence: 'confirmed', count: 78 });
  findings.push({ url, ruleId: 'schema.required-property-missing', title: 'Person is missing name',
    detail: 'This page describes a person but publishes no Person item.', category: 'fix', severity: 'medium', confidence: 'confirmed' });
}
// And an unrelated confirmed failure, so the plan is not all template work.
findings.push({ url: `${origin}/`, ruleId: 'navigation.link-404', title: 'Internal link points to a missing page',
  detail: 'The link "Careers" points to a page that returns 404.', category: 'fix', severity: 'high', confidence: 'confirmed',
  link: { url: `${origin}/careers`, status: 404 } });

for (const f of findings) store.recordFindings(id, f.url, [f]);

// The sitemap lists the team pages and the home page, but not /team.
store.recordSitemapUrls(id, [`${origin}/`, ...TEAM, ...SERVICES].map((u) => ({
  normalized: normalizeAuditUrl(u), url: u, source: `${origin}/sitemap.xml`
})));

store.finishAudit(id, {
  status: 'complete',
  stats: { pagesProcessed: pages.length, findingsTotal: findings.length, urlCounts: store.urlCountsByStatus(id) }
});

console.log('audit:', id);
console.log('pages:', pages.length, 'findings:', findings.length, 'sitemap:', store.sitemapUrlCount(id));
