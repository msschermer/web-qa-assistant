/**
 * Structured data (JSON-LD) discipline.
 *
 * The per-page hook answers the cheapest question: is there a block, and does
 * it parse. Everything richer needs the parsed items from every page at once,
 * which only exists after the crawl, so it runs as a cross-page pass over what
 * the store recorded.
 *
 * That validation already existed in packages/findings/schema-validation.js and
 * was reachable from exactly one place: the Structured data screen. So a site
 * could publish an Organization with no address, two conflicting identities, and
 * a type present on eight of ten templates, and none of it reached Findings, the
 * Action Plan or the export. Evidence Lumen computes and does not turn into a
 * finding is evidence nothing downstream can act on.
 */
import { STATIC_EVIDENCE_NOTE } from './shared.js';
import { validatePageSchema, validateSiteSchema, schemaOpportunities, isSiteScopeStatement } from '../../findings/schema-validation.js';

function perPage(meta, pageUrl) {
  const out = [];
  // A JSON-LD block that IS present and fails to parse is a real, confirmed
  // defect regardless of rendering. Its ABSENCE is not equally certain: some
  // sites inject schema via client-side JavaScript rather than serving it in
  // the raw HTML — a static-only "missing" verdict would be a false positive
  // on exactly those sites, so it gets the inferred treatment and disclosure.
  if (meta.schemaInvalidCount > 0) {
    out.push({ ruleId: 'schema.invalid-json', title: 'Structured data is not valid JSON', detail: `${meta.schemaInvalidCount} application/ld+json block${meta.schemaInvalidCount === 1 ? '' : 's'} on ${pageUrl} could not be parsed as JSON, so search engines cannot read the structured data it was meant to carry.`, category: 'fix', severity: 'medium', confidence: 'confirmed', count: meta.schemaInvalidCount });
  } else if (!meta.schemaBlockCount) {
    out.push({ ruleId: 'schema.missing', title: 'No structured data (schema.org) was found', detail: `No application/ld+json block was found in the static HTML for ${pageUrl}. Structured data is optional, but it is what lets search engines show rich results (reviews, FAQs, breadcrumbs, products) for this page. ${STATIC_EVIDENCE_NOTE}`, category: 'review', severity: 'low', confidence: 'inferred' });
  }
  return out;
}

/**
 * How a validation statement becomes a finding.
 *
 * The three statement kinds are deliberately not equal and must not be
 * flattened. An error or a conflict is something the markup demonstrably says;
 * an opportunity is a pattern across templates and is inferred, never a defect.
 * Collapsing them would let "this type is on most pages but not all" arrive
 * looking exactly like "this block does not parse".
 */
const STATEMENT_SHAPE = {
  error: { category: 'fix', severity: 'medium', confidence: 'confirmed' },
  conflict: { category: 'fix', severity: 'medium', confidence: 'confirmed' },
  opportunity: { category: 'review', severity: 'low', confidence: 'inferred' }
};

// perPage already reports an unparseable block, and the richer pass would say
// it a second time against the same page.
const PER_PAGE_OWNS = new Set(['schema.invalid-json']);

function crossPage(fetchedUrls, ctx) {
  const merged = new Map();
  const pages = ctx?.schemaPages || [];
  if (!pages.length) return merged;

  const add = (url, finding) => {
    if (!url) return;
    if (!merged.has(url)) merged.set(url, []);
    merged.get(url).push(finding);
  };
  const emit = (statement, url) => {
    if (PER_PAGE_OWNS.has(statement.code)) return;
    const shape = STATEMENT_SHAPE[statement.kind] || STATEMENT_SHAPE.opportunity;
    add(url, {
      ruleId: statement.code,
      title: statement.title,
      detail: statement.kind === 'opportunity'
        ? `${statement.detail} ${STATIC_EVIDENCE_NOTE}`
        : statement.detail,
      ...shape,
      evidence: statement.evidence || ''
    });
  };

  for (const page of pages) for (const statement of validatePageSchema(page)) emit(statement, statement.url || page.url);
  // Site-level statements land on the first page that carries the evidence, so
  // the finding opens somewhere real rather than on a synthetic site row.
  for (const statement of validateSiteSchema(pages)) emit(statement, statement.url || pages[0]?.url);
  for (const statement of schemaOpportunities(pages)) {
    // A site-level statement is one job however many pages carry the evidence,
    // and recording it per page would put ten identical rows into a plan built
    // to collapse exactly that.
    if (isSiteScopeStatement(statement) || !statement.urls?.length) {
      emit(statement, statement.urls?.[0] || pages[0]?.url);
      continue;
    }
    for (const url of statement.urls.slice(0, 50)) emit(statement, url);
  }
  return merged;
}

export default { id: 'schema', perPage, crossPage };
