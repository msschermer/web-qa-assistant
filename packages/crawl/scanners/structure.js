/**
 * Document structure discipline: headings, document language, image alt
 * text, and the cross-page checks (duplicate H1, orphan pages) that need
 * the whole crawl's link graph.
 *
 * ruleIds reused verbatim from the rendered tier where the same fact is
 * statically checkable: a11y.lang-missing, structure.heading-skip.
 */
import { STATIC_EVIDENCE_NOTE } from './shared.js';

function headingSkip(levels) {
  let prev = 0;
  for (const level of levels) {
    if (prev && level > prev + 1) return true;
    prev = level;
  }
  return false;
}

function perPage(meta, pageUrl) {
  const out = [];
  if (!meta.h1s.length) out.push({ ruleId: 'structure.h1-missing', title: 'No H1 heading is present', detail: `No <h1> element was found in the static HTML for ${pageUrl}. ${STATIC_EVIDENCE_NOTE}`, category: 'review', severity: 'medium', confidence: 'inferred' });
  else if (meta.h1s.length > 1) out.push({ ruleId: 'structure.h1-multiple', title: 'Multiple H1 headings are present', detail: `${meta.h1s.length} <h1> elements were found in the static HTML. ${STATIC_EVIDENCE_NOTE}`, category: 'review', severity: 'low', confidence: 'inferred', count: meta.h1s.length });

  if (Array.isArray(meta.headingLevels) && headingSkip(meta.headingLevels)) {
    out.push({ ruleId: 'structure.heading-skip', title: 'Heading levels skip a level', detail: `The heading hierarchy on ${pageUrl} jumps more than one level (e.g. H1 straight to H3). ${STATIC_EVIDENCE_NOTE}`, category: 'review', severity: 'low', confidence: 'inferred' });
  }

  if (!meta.htmlLang) {
    out.push({ ruleId: 'a11y.lang-missing', title: 'Document language is missing', detail: `The root <html> element on ${pageUrl} has no lang attribute. ${STATIC_EVIDENCE_NOTE}`, category: 'fix', severity: 'medium', confidence: 'confirmed', wcag: ['3.1.1'] });
  } else {
    try { new Intl.Locale(meta.htmlLang); } catch {
      out.push({ ruleId: 'a11y.lang-invalid', title: 'Document language is not a valid language tag', detail: `The html lang value "${meta.htmlLang}" on ${pageUrl} could not be parsed as a valid BCP 47 language tag.`, category: 'fix', severity: 'medium', confidence: 'confirmed', wcag: ['3.1.1'] });
    }
  }

  if (meta.imagesTotal > 0 && meta.imagesMissingAlt > 0) {
    // Attribute-absence only — never a judgment about whether an image is
    // decorative (alt="" is legitimate and correctly not flagged here). The
    // decorative-vs-informative call needs rendered/visual context and stays
    // in the rendered tier's axe.image-alt only.
    out.push({ ruleId: 'structure.image-alt-missing', title: 'Images are missing an alt attribute', detail: `${meta.imagesMissingAlt} of ${meta.imagesTotal} <img> elements on ${pageUrl} have no alt attribute at all (not even alt=""). Screen readers announce the filename as a fallback, which is rarely useful.`, category: 'fix', severity: 'medium', confidence: 'confirmed', count: meta.imagesMissingAlt, wcag: ['1.1.1'] });
  }

  if (Array.isArray(meta.fragmentLinks) && meta.fragmentLinks.length) {
    // Reuses the rendered tier's exact ruleId (browser-rules.js's
    // fragmentFindings) — same fact, just 'inferred' here instead of
    // 'confirmed' because the target id could be added by JavaScript this
    // tier never runs, which the rendered tier would actually observe.
    const ids = new Set(Array.isArray(meta.elementIds) ? meta.elementIds : []);
    const missing = meta.fragmentLinks.filter((f) => !ids.has(f.id));
    if (missing.length) {
      out.push({ ruleId: 'navigation.fragment-missing', title: 'In-page link points to a missing fragment', detail: `${missing.length} in-page link${missing.length === 1 ? '' : 's'} on ${pageUrl} point to a fragment (e.g. "#${missing[0].id}") with no matching id in the static HTML. ${STATIC_EVIDENCE_NOTE}`, category: 'fix', severity: 'medium', confidence: 'inferred', count: missing.length });
    }
  }

  if (meta.formControlsTotal > 0 && meta.formControlsMissingLabel > 0) {
    out.push({ ruleId: 'a11y.form-label-missing', title: 'Form fields are missing an accessible label', detail: `${meta.formControlsMissingLabel} of ${meta.formControlsTotal} form field(s) on ${pageUrl} have no associated <label>, aria-label, or aria-labelledby in the static HTML. ${STATIC_EVIDENCE_NOTE}`, category: 'fix', severity: 'high', confidence: 'inferred', count: meta.formControlsMissingLabel, wcag: ['1.3.1', '4.1.2'] });
  }

  return out;
}

function crossPage(fetchedUrls, ctx) {
  const findingsByUrl = new Map();
  function push(url, finding) {
    if (!findingsByUrl.has(url)) findingsByUrl.set(url, []);
    findingsByUrl.get(url).push(finding);
  }

  const byH1 = new Map();
  for (const row of fetchedUrls) {
    const h1 = (row.h1_text || '').trim();
    if (!h1) continue;
    if (!byH1.has(h1)) byH1.set(h1, []);
    byH1.get(h1).push(row.url);
  }
  for (const [h1Text, urls] of byH1) {
    if (urls.length < 2) continue;
    for (const url of urls) {
      const others = urls.filter((u) => u !== url);
      push(url, { ruleId: 'structure.duplicate-h1', title: 'H1 heading is duplicated on other pages', detail: `The H1 "${h1Text}" is used on ${urls.length} pages, including ${others.slice(0, 3).join(', ')}${others.length > 3 ? `, and ${others.length - 3} more` : ''}. Each page's main heading should describe that page specifically.`, category: 'review', severity: 'low', confidence: 'confirmed', count: urls.length });
    }
  }

  // Orphan pages: reached by the crawl (so we know they exist and resolve),
  // but nothing else the crawl found links to them internally. A page can
  // only be "found" via the start URL, a sitemap, or a link on another
  // crawled page — if its only inbound path was the sitemap, that's still
  // worth surfacing, since a page with zero on-site inbound links is hard
  // for both users and search engines to discover by browsing.
  if (ctx?.inlinkCounts) {
    for (const row of fetchedUrls) {
      if (row.status !== 'fetched' || row.url === ctx.startUrl) continue;
      const inlinks = ctx.inlinkCounts.get(row.normalized_url || row.url) || 0;
      if (inlinks === 0) {
        push(row.url, { ruleId: 'structure.orphan-page', title: 'Page has no internal links pointing to it', detail: `${row.url} was reached by the crawl, but no other crawled page links to it internally. Visitors and search engines relying on on-site navigation may never find it.`, category: 'review', severity: 'medium', confidence: 'confirmed' });
      }
    }
  }

  return findingsByUrl;
}

export default { id: 'structure', perPage, crossPage };
