import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { JSDOM } from 'jsdom';
import { collectSchemaItems } from '../packages/crawl/schema-items.js';
import { validatePageSchema, validateSiteSchema, schemaOpportunities, summariseSchema } from '../packages/findings/schema-validation.js';

const dom = (body) => new JSDOM(`<!doctype html><html><body>${body}</body></html>`).window.document;
const ld = (obj) => `<script type="application/ld+json">${JSON.stringify(obj)}</script>`;
const page = (url, html) => ({ url, ...collectSchemaItems(dom(html)) });
const codes = (rows) => rows.map((r) => r.code).sort();

test('a JSON-LD @graph yields one item per typed node, not one per reference', () => {
  // The shape every WordPress SEO plugin emits: nodes carry @id, and properties
  // point at them by @id rather than repeating them. Counting those pointers as
  // items reported 106 "item has no @type" errors against one real ten-page
  // site whose markup was correct — the validator would have been wrong more
  // often than the sites it audits.
  const doc = dom(ld({
    '@context': 'https://schema.org',
    '@graph': [
      { '@type': 'WebPage', '@id': 'https://example.com/#webpage', isPartOf: { '@id': 'https://example.com/#website' }, about: { '@id': 'https://example.com/#org' } },
      { '@type': 'WebSite', '@id': 'https://example.com/#website', name: 'X' },
      { '@type': 'Organization', '@id': 'https://example.com/#org', name: 'X Ltd' }
    ]
  }));
  const { items } = collectSchemaItems(doc);
  assert.deepEqual(items.map((i) => i.type).sort(), ['Organization', 'WebPage', 'WebSite']);
  assert.equal(validatePageSchema({ url: 'https://example.com/', items, invalidBlocks: [] }).length, 0);
});

test('an untyped node whose @id resolves to a typed node is a reference, not a fault', () => {
  // Yoast writes author as { "@id": …, "name": … } beside a full Person under
  // the same @id. Inlining a property onto a reference is legal JSON-LD.
  const doc = dom(ld({
    '@graph': [
      { '@type': 'Article', '@id': 'https://example.com/#a', headline: 'H', author: { '@id': 'https://example.com/#p', name: 'Example Author' } },
      { '@type': 'Person', '@id': 'https://example.com/#p', name: 'Example Author' }
    ]
  }));
  const { items } = collectSchemaItems(doc);
  assert.equal(items.filter((i) => !i.type).length, 0, 'the resolved reference is not an item');
  assert.deepEqual(items.map((i) => i.type).sort(), ['Article', 'Person']);
});

test('an untyped node that resolves to nothing is still reported', () => {
  // The guard above must not become a way for genuinely untyped data to hide.
  const doc = dom(ld({ '@id': 'https://example.com/#orphan', name: 'Nameless thing', url: 'https://example.com/' }));
  const { items } = collectSchemaItems(doc);
  assert.equal(items.length, 1);
  assert.equal(items[0].type, '');
  assert.deepEqual(codes(validatePageSchema({ url: 'https://example.com/', items, invalidBlocks: [] })), ['schema.missing-type']);
});

test('a block that does not parse is reported with the reason, not silently dropped', () => {
  // A page whose only JSON-LD is broken has no items. Without this it would be
  // reported as a page with no structured data, which is the opposite of true.
  const doc = dom('<script type="application/ld+json">{ "@type": "Organization", }</script>');
  const found = collectSchemaItems(doc);
  assert.equal(found.schemaBlockCount, 1);
  assert.equal(found.schemaInvalidCount, 1);
  assert.equal(found.invalidBlocks.length, 1);
  assert.ok(found.invalidBlocks[0].reason, 'the parser message is kept so a developer is not sent to read the whole block');
  const rows = validatePageSchema({ url: 'https://example.com/', items: found.items, invalidBlocks: found.invalidBlocks });
  assert.deepEqual(codes(rows), ['schema.invalid-json']);
  assert.equal(rows[0].confidence, 'confirmed');
});

test('required properties are checked on the item that was parsed, and confirmed', () => {
  const p = page('https://example.com/', ld({ '@type': 'LocalBusiness', '@id': 'https://example.com/#b', name: 'B' }));
  const rows = validatePageSchema(p);
  assert.deepEqual(codes(rows), ['schema.required-property-missing']);
  assert.equal(rows[0].property, 'address');
  // Confirmed, because the item is in hand: this is a fault in the markup we
  // read, not a claim about markup we could not see.
  assert.equal(rows[0].confidence, 'confirmed');
});

test('a LocalBusiness subtype inherits the base type requirements', () => {
  const p = page('https://example.com/', ld({ '@type': 'Attorney', name: 'Firm' }));
  assert.deepEqual(codes(validatePageSchema(p)), ['schema.required-property-missing']);
});

test('an address that exists but cannot be posted to is reported as incomplete', () => {
  const p = page('https://example.com/', ld({
    '@type': 'LocalBusiness', name: 'B',
    address: { '@type': 'PostalAddress', streetAddress: '1 Main St', addressLocality: 'Town' }
  }));
  const rows = validatePageSchema(p);
  assert.deepEqual(codes(rows), ['schema.address-incomplete']);
  assert.match(rows[0].detail, /addressRegion, postalCode/);
});

test('a breadcrumb whose items carry no position has no order', () => {
  const p = page('https://example.com/', ld({
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'Home' },
      { '@type': 'ListItem', name: 'Second' }
    ]
  }));
  assert.ok(codes(validatePageSchema(p)).includes('schema.breadcrumb-position-empty'));
});

test('an empty required property is distinguished from a missing one', () => {
  const p = page('https://example.com/', ld({ '@type': 'Organization', name: '   ' }));
  const rows = validatePageSchema(p);
  assert.deepEqual(codes(rows), ['schema.empty-property']);
});

test('two identities for one sitewide entity is a confirmed conflict', () => {
  const pages = [
    page('https://example.com/a', ld({ '@type': 'Organization', '@id': 'https://example.com/#org', name: 'X' })),
    page('https://example.com/b', ld({ '@type': 'Organization', '@id': 'https://example.com/#organization', name: 'X' }))
  ];
  const rows = validateSiteSchema(pages);
  const conflict = rows.find((r) => r.code === 'schema.identity-conflict');
  assert.ok(conflict, 'the same Organization under two @ids is a conflict');
  assert.equal(conflict.confidence, 'confirmed', 'both sides were parsed, so this is not an inference');
  assert.equal(conflict.variants.length, 2);
});

test('two different Products are not a conflict', () => {
  // Only sitewide singletons can conflict. A page-scoped type appearing with
  // different identities is a site with more than one of them.
  const pages = [
    page('https://example.com/a', ld({ '@type': 'Product', '@id': 'https://example.com/a#p', name: 'A' })),
    page('https://example.com/b', ld({ '@type': 'Product', '@id': 'https://example.com/b#p', name: 'B' }))
  ];
  assert.equal(validateSiteSchema(pages).length, 0);
});

test('opportunities are inferred, never errors, and never fire on a thin pattern', () => {
  const pages = [
    page('https://example.com/a', ld({ '@type': 'Article', headline: 'A' })),
    page('https://example.com/b', ld({ '@type': 'Article', headline: 'B' }))
  ];
  // Two pages is not a pattern.
  assert.equal(schemaOpportunities(pages).length, 0);

  const many = [
    ...['a', 'b', 'c', 'd', 'e', 'f', 'g'].map((s) => page(`https://example.com/${s}`, ld({ '@type': 'Article', headline: s }))),
    page('https://example.com/x', ld({ '@type': 'WebPage', name: 'x' })),
    page('https://example.com/y', ld({ '@type': 'WebPage', name: 'y' }))
  ];
  const opps = schemaOpportunities(many);
  const gap = opps.find((o) => o.code === 'schema.template-gap');
  assert.ok(gap, 'seven of nine pages carrying Article is a pattern the other two miss');
  assert.equal(gap.kind, 'opportunity');
  assert.equal(gap.confidence, 'inferred', 'the static tier runs no JavaScript, so absence is never confirmed');
  assert.match(gap.detail, /does not run JavaScript/);
});

test('the site root is never counted as missing a template', () => {
  // A home page legitimately carries no Article. The first version of this
  // check reported exactly that against a real crawl.
  const pages = [
    ...['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'].map((s) => page(`https://example.com/${s}`, ld({ '@type': 'Article', headline: s }))),
    page('https://example.com/', ld({ '@type': 'WebPage', name: 'home' }))
  ];
  assert.equal(schemaOpportunities(pages).filter((o) => o.code === 'schema.template-gap').length, 0);
});

test('microdata is read, so an itemprop site is not reported as having no schema', () => {
  const doc = dom(`
    <div itemscope itemtype="https://schema.org/LocalBusiness">
      <span itemprop="name">Example business</span>
      <span itemprop="telephone">555</span>
    </div>`);
  const { items } = collectSchemaItems(doc);
  assert.equal(items.length, 1);
  assert.equal(items[0].format, 'microdata');
  assert.equal(items[0].type, 'LocalBusiness');
  assert.equal(items[0].name, 'Example business');
});

test('the projection is bounded rather than a copy of the page markup', () => {
  const big = { '@type': 'Article', headline: 'H', articleBody: 'x'.repeat(5000) };
  const { items } = collectSchemaItems(dom(ld(big)));
  const serialised = JSON.stringify(items[0].props);
  assert.ok(serialised.length < 2000, `the stored projection should stay small, was ${serialised.length}`);
  // A non-valued property is recorded as present, without its value.
  assert.equal(items[0].props.articleBody.value, undefined);
  assert.ok(items[0].propKeys.includes('articleBody'));
});

test('the summary counts pages that were parsed and found empty', () => {
  // The denominator must be pages the crawl read, not pages that had schema, or
  // every coverage statement built on it overstates.
  const pages = [
    page('https://example.com/a', ld({ '@type': 'Organization', name: 'X' })),
    { url: 'https://example.com/b', items: [], invalidBlocks: [], truncated: false }
  ];
  const summary = summariseSchema(pages);
  assert.equal(summary.pagesParsed, 2);
  assert.equal(summary.pagesWithSchema, 1);
  assert.equal(summary.itemCount, 1);
});

test('the overlay keeps the three kinds of statement apart', () => {
  const overlay = fs.readFileSync('apps/extension/content.js', 'utf8');
  // Errors and conflicts are confirmed faults; opportunities are inferences.
  // Folding them into one "issues" figure is how a schema tool ends up telling
  // a client their correct markup is broken, so the tiles stay separate and the
  // navigation badge counts only what is confirmed.
  assert.match(overlay, /schema: 'Structured data'/);
  assert.match(overlay, /siteAudit\.schema\.errors\.length \+ siteAudit\.schema\.conflicts\.length/);
  assert.doesNotMatch(overlay, /opportunities\.length \+ .*errors\.length/, 'opportunities are never added into a defect count');
  // The opportunity lens carries its own standing caveat.
  assert.match(overlay, /These are inferences, not defects/);
  // Not-established is drawn with the hatch, never with a severity colour.
  const oppRule = overlay.match(/\.schema-opportunities li\{[^}]*\}/)[0];
  assert.match(oppRule, /var\(--sa-hatch\)/, 'an inference is drawn as not-established, not as a warning');
  assert.doesNotMatch(oppRule, /--sa-warn|--sa-critical/);
});

test('the schema endpoint counts only pages the crawl actually fetched', () => {
  // The denominator decides whether "34 of 40 pages have schema" is a finding or
  // a coverage artefact. Pages that were never fetched carry no evidence either
  // way, and counting them would report the page limit as a schema problem.
  const server = fs.readFileSync('services/api/server.js', 'utf8');
  const route = server.match(/app\.get\('\/api\/audits\/:id\/schema'[\s\S]*?\n\}\);/)[0];
  assert.match(route, /statuses: 'fetched'/);
  assert.match(route, /summariseSchema/);
});
