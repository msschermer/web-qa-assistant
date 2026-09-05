/**
 * Structured-data validation over the items the crawl recorded.
 *
 * Three kinds of statement come out of here, and keeping them apart is the
 * whole discipline of this file:
 *
 *   error        A property is wrong or missing on an item we actually parsed.
 *                Confirmed: the item is in hand and the fault is in it.
 *   conflict     Two pages disagree about the same entity. Confirmed, because
 *                both sides of the disagreement were parsed.
 *   opportunity  Markup a page could carry and does not. Never an error, and
 *                never confirmed — the static tier does not execute JavaScript,
 *                so "this page has no Product schema" is an inference about
 *                what we could see, not a fact about the page. Reported as an
 *                opportunity with inferred confidence, exactly as PRODUCT.md
 *                requires unverifiable absence to be reported.
 *
 * The distinction is not cosmetic. "LocalBusiness has no address" is confirmed
 * because we hold the LocalBusiness. "This page has no LocalBusiness" is not,
 * because a script we did not run may have added one.
 */

/** Required properties, by type. Deliberately short: each entry is a property
 * whose absence makes the item unusable to a consumer, not every property the
 * vocabulary defines. A validator that reports optional properties as errors
 * teaches the reader to ignore it. */
const REQUIRED = {
  Organization: ['name'],
  LocalBusiness: ['name', 'address'],
  Product: ['name'],
  Article: ['headline'],
  NewsArticle: ['headline'],
  BlogPosting: ['headline'],
  BreadcrumbList: ['itemListElement'],
  ListItem: ['position', 'name'],
  FAQPage: ['mainEntity'],
  Question: ['name', 'acceptedAnswer'],
  Event: ['name', 'startDate'],
  Person: ['name'],
  Review: ['reviewRating'],
  Recipe: ['name'],
  JobPosting: ['title', 'hiringOrganization'],
  VideoObject: ['name', 'thumbnailUrl', 'uploadDate']
};

/** Types that inherit LocalBusiness's requirements. schema.org has dozens of
 * subtypes and a site is as likely to use one of these as the base type. */
const LOCAL_BUSINESS_SUBTYPES = new Set([
  'LegalService', 'Attorney', 'Dentist', 'Physician', 'MedicalBusiness', 'Restaurant',
  'Store', 'ProfessionalService', 'HomeAndConstructionBusiness', 'AutomotiveBusiness',
  'FinancialService', 'RealEstateAgent', 'InsuranceAgency', 'AccountingService',
  'Plumber', 'Electrician', 'RoofingContractor', 'GeneralContractor', 'HVACBusiness'
]);

/** The address subfields a postal address needs to be actionable. */
const ADDRESS_PARTS = ['streetAddress', 'addressLocality', 'addressRegion', 'postalCode'];

const isEmpty = (prop) => !prop || prop.kind === 'empty' || (prop.kind === 'list' && !prop.count);

function requiredFor(type) {
  if (REQUIRED[type]) return REQUIRED[type];
  if (LOCAL_BUSINESS_SUBTYPES.has(type)) return REQUIRED.LocalBusiness;
  return null;
}

function issue(fields) {
  return {
    kind: 'error',
    confidence: 'confirmed',
    ...fields
  };
}

/**
 * Everything wrong with the items on one page.
 * `page` is { url, items, invalidBlocks, truncated }.
 */
export function validatePageSchema(page) {
  const out = [];
  const url = page.url;

  for (const block of page.invalidBlocks || []) {
    out.push(issue({
      code: 'schema.invalid-json',
      url,
      title: 'JSON-LD block does not parse',
      detail: `Block ${block.blockIndex + 1} on this page is not valid JSON, so nothing inside it is read by any consumer. ${block.reason}`,
      evidence: block.reason
    }));
  }

  for (const item of page.items || []) {
    const label = item.type || '(no type)';

    if (!item.type) {
      out.push(issue({
        code: 'schema.missing-type',
        url,
        title: 'Structured data item has no @type',
        detail: 'An item was declared but never says what it is, so no consumer can interpret it.',
        evidence: item.path,
        itemPath: item.path
      }));
      continue;
    }

    const required = requiredFor(item.type);
    if (required) {
      for (const prop of required) {
        if (!(prop in item.props)) {
          out.push(issue({
            code: 'schema.required-property-missing',
            url,
            type: item.type,
            property: prop,
            title: `${label} is missing ${prop}`,
            detail: `This ${label} item carries no ${prop} property. The item was parsed from this page's markup, so this is a fault in the item rather than a limit on what could be read.`,
            evidence: `${item.path} · properties present: ${item.propKeys.join(', ') || 'none'}`,
            itemPath: item.path
          }));
        } else if (isEmpty(item.props[prop])) {
          out.push(issue({
            code: 'schema.empty-property',
            url,
            type: item.type,
            property: prop,
            title: `${label} ${prop} is empty`,
            detail: `The ${prop} property exists on this ${label} but carries no value, which a consumer treats the same as absent while a developer reading the markup sees the field and assumes it works.`,
            evidence: item.path,
            itemPath: item.path
          }));
        }
      }
    }

    // An address that exists but cannot be posted to.
    const address = item.props.address;
    if (address && address.kind === 'node') {
      const missing = ADDRESS_PARTS.filter((part) => !address.keys.includes(part));
      if (missing.length) {
        out.push(issue({
          code: 'schema.address-incomplete',
          url,
          type: item.type,
          property: 'address',
          title: `${label} address is incomplete`,
          detail: `The address on this ${label} is missing ${missing.join(', ')}. A partial address is what search engines use to decide two listings are different businesses.`,
          evidence: `${item.path}.address · present: ${address.keys.join(', ') || 'none'}`,
          itemPath: item.path
        }));
      }
    }

    // Breadcrumbs whose items have no position are unordered, and a breadcrumb
    // without an order is not a breadcrumb.
    if (item.type === 'BreadcrumbList') {
      const list = item.props.itemListElement;
      if (list && list.kind === 'list') {
        const positionless = (list.items || []).filter((entry) => entry.kind === 'node' && !entry.keys.includes('position'));
        if (positionless.length) {
          out.push(issue({
            code: 'schema.breadcrumb-position-empty',
            url,
            type: item.type,
            property: 'position',
            title: 'Breadcrumb position is empty',
            detail: 'At least one itemListElement on this breadcrumb carries no position, so the trail has no defined order.',
            evidence: `${item.path}.itemListElement`,
            itemPath: item.path
          }));
        }
      }
    }
  }

  return out;
}

/**
 * Disagreements that only exist across pages.
 *
 * An entity's identity is the thing a site most often gets wrong at scale:
 * every template emits its own Organization, each with a different `@id` or no
 * `@id` at all, and the site ends up claiming to be several organisations.
 * That cannot be seen one page at a time, which is why it lives here.
 */
export function validateSiteSchema(pages) {
  const out = [];
  const byType = new Map();

  for (const page of pages) {
    for (const item of page.items || []) {
      if (!item.type) continue;
      if (!byType.has(item.type)) byType.set(item.type, []);
      byType.get(item.type).push({ url: page.url, item });
    }
  }

  // Sitewide singletons: types that describe the site itself rather than a
  // page. Two different identities for one of these is a real conflict; two
  // different Products are simply two products.
  for (const type of ['Organization', 'LocalBusiness', 'WebSite', ...LOCAL_BUSINESS_SUBTYPES]) {
    const rows = byType.get(type);
    if (!rows || rows.length < 2) continue;

    const ids = new Map();
    for (const row of rows) {
      const key = row.item.nodeId || '';
      if (!ids.has(key)) ids.set(key, []);
      ids.get(key).push(row.url);
    }
    if (ids.size > 1) {
      const variants = [...ids.entries()].map(([id, urls]) => ({ id: id || '(no @id)', pages: urls.length, sample: urls.slice(0, 5) }));
      out.push({
        kind: 'conflict',
        confidence: 'confirmed',
        code: 'schema.identity-conflict',
        type,
        title: `${type} @id is inconsistent`,
        detail: `${type} appears on ${rows.length} crawled pages under ${ids.size} different identities. A consumer reading this site cannot tell whether it is one ${type} or ${ids.size}.`,
        evidence: variants.map((v) => `${v.id}: ${v.pages} page${v.pages === 1 ? '' : 's'}`).join(' · '),
        variants,
        urls: rows.map((r) => r.url)
      });
    }

    const names = new Set(rows.map((r) => r.item.name).filter(Boolean));
    if (names.size > 1) {
      out.push({
        kind: 'conflict',
        confidence: 'confirmed',
        code: 'schema.name-conflict',
        type,
        title: `${type} name differs between pages`,
        detail: `${type} is published under ${names.size} different names across the crawled pages.`,
        evidence: [...names].slice(0, 5).join(' · '),
        urls: rows.map((r) => r.url)
      });
    }
  }

  return out;
}

/**
 * Opportunities, which are the part of this file most able to do harm.
 *
 * These are inferences about markup a page does not appear to have, drawn from
 * what comparable pages on the same site do have. Two rules keep them honest:
 * they are never errors, and they are only raised where the site itself has
 * already established the pattern — a page missing an Article type on a site
 * that publishes Articles everywhere else is a real observation; the same page
 * on a site with no Articles at all is us inventing an SEO checklist.
 */
/**
 * Types that describe what a page is *about*, as opposed to the plumbing a CMS
 * emits around it.
 *
 * A template-gap check is type-agnostic by construction, so without this it
 * reports things like "CommentAction is on most pages but not all". That is
 * true, it is useless, and a plan that contains it is a plan a consultant stops
 * reading. Nothing here suppresses an error or a conflict: those are about
 * markup that exists and is wrong, whatever the type.
 */
const STRUCTURAL_TYPES = new Set([
  'WebPage', 'WebSite', 'CollectionPage', 'ItemPage', 'SearchResultsPage', 'ProfilePage',
  'SearchAction', 'ReadAction', 'CommentAction', 'EntryPoint', 'PropertyValueSpecification',
  'ListItem', 'ItemList', 'SiteNavigationElement', 'WPHeader', 'WPFooter', 'WPSideBar',
  'Comment', 'ImageObject', 'Thing'
]);

/**
 * Statements about the site rather than about a page.
 *
 * One Organization block with no sameAs is one edit. Recording it once per page
 * that happens to carry the block would put ten identical rows in a plan whose
 * whole purpose is that it does not do that.
 */
const SITE_SCOPE_CODES = new Set(['schema.no-sameas', 'schema.identity-conflict', 'schema.name-conflict']);

export function schemaOpportunities(pages, { minimumPattern = 3 } = {}) {
  const out = [];
  const withItems = pages.filter((p) => (p.items || []).length);
  if (withItems.length < minimumPattern) return out;

  const typeCounts = new Map();
  for (const page of pages) {
    for (const type of new Set((page.items || []).map((i) => i.type).filter(Boolean))) {
      typeCounts.set(type, (typeCounts.get(type) || 0) + 1);
    }
  }

  // A type the site uses on nearly every page, absent from several, is a
  // template gap. The thresholds are deliberately unkind to this check. Against
  // a real ten-page crawl the first version raised 'Article is on most pages but
  // not all' because the home page carried no Article — which is what a home
  // page is. A site's root legitimately differs from its article templates, so
  // it is excluded, and one odd page out is not a pattern.
  const isSiteRoot = (url) => { try { return new URL(url).pathname === '/'; } catch { return false; } };
  for (const [type, count] of typeCounts) {
    if (count < minimumPattern) continue;
    if (STRUCTURAL_TYPES.has(type)) continue;
    const coverage = count / pages.length;
    if (coverage < 0.7 || coverage >= 1) continue;
    const missing = pages.filter((p) => !isSiteRoot(p.url) && !(p.items || []).some((i) => i.type === type));
    if (missing.length < 2) continue;
    out.push({
      kind: 'opportunity',
      confidence: 'inferred',
      code: 'schema.template-gap',
      type,
      title: `${type} is on most pages but not all`,
      detail: `${count} of ${pages.length} crawled pages publish ${type}; ${missing.length} do not. Because the static crawl does not run JavaScript, this is what could be read rather than proof the markup is absent. Confirm on one of these pages before acting.`,
      evidence: `${count}/${pages.length} pages carry ${type}`,
      urls: missing.map((p) => p.url)
    });
  }

  // A business that publishes an address and no sameAs has nothing tying its
  // listing to the profiles that corroborate it.
  const businesses = [];
  for (const page of pages) {
    for (const item of page.items || []) {
      if (item.type === 'LocalBusiness' || LOCAL_BUSINESS_SUBTYPES.has(item.type) || item.type === 'Organization') {
        businesses.push({ url: page.url, item });
      }
    }
  }
  if (businesses.length >= minimumPattern && !businesses.some((b) => 'sameAs' in b.item.props)) {
    out.push({
      kind: 'opportunity',
      confidence: 'inferred',
      code: 'schema.no-sameas',
      type: businesses[0].item.type,
      title: 'Business identity publishes no sameAs profiles',
      detail: 'None of the parsed business items link out to the profiles that corroborate the same entity elsewhere. This is an addition to consider, not a defect in the markup that exists.',
      evidence: `${businesses.length} business items, none with sameAs`,
      urls: [...new Set(businesses.map((b) => b.url))]
    });
  }

  return out;
}

/** Does this statement describe the site once, rather than each page that
 * carries the evidence for it? */
export function isSiteScopeStatement(statement) {
  return SITE_SCOPE_CODES.has(String(statement?.code || ''));
}

/** The whole picture for one audit, in the shape the API and UI read. */
export function summariseSchema(pages) {
  const errors = [];
  for (const page of pages) errors.push(...validatePageSchema(page));
  const conflicts = validateSiteSchema(pages);
  const opportunities = schemaOpportunities(pages);

  const typeCounts = new Map();
  let itemCount = 0;
  for (const page of pages) {
    for (const item of page.items || []) {
      itemCount++;
      if (!item.type) continue;
      const entry = typeCounts.get(item.type) || { type: item.type, items: 0, pages: new Set(), formats: new Set() };
      entry.items++;
      entry.pages.add(page.url);
      entry.formats.add(item.format);
      typeCounts.set(item.type, entry);
    }
  }

  return {
    pagesWithSchema: pages.filter((p) => (p.items || []).length).length,
    pagesParsed: pages.length,
    itemCount,
    truncatedPages: pages.filter((p) => p.truncated).length,
    types: [...typeCounts.values()]
      .map((t) => ({ type: t.type, items: t.items, pages: t.pages.size, formats: [...t.formats].sort() }))
      .sort((a, b) => b.items - a.items || a.type.localeCompare(b.type)),
    errors,
    conflicts,
    opportunities
  };
}
