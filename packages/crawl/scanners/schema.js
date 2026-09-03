/**
 * Structured data (JSON-LD) discipline.
 */
import { STATIC_EVIDENCE_NOTE } from './shared.js';

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

export default { id: 'schema', perPage };
