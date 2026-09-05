/**
 * The recommended next move for a rule, as one deterministic sentence.
 *
 * This is a static lookup, never a model call: what to do about a missing
 * <title> does not vary by site, and the one thing an operator must be able to
 * trust about a recommendation is that it did not get invented for them. The
 * reasoning layer explains verified evidence; this names the fix.
 *
 * Shared rather than copied. It reached the operator through the exported HTML
 * report only; the Site Audit overlay's Guidance tab needs the same sentences,
 * and a second copy is how two surfaces start recommending different things
 * for the same rule.
 */
const RULE_GUIDANCE = {
  'seo.title-missing': 'Add a unique, descriptive <title> to each affected page.',
  'seo.title-multiple': 'Keep exactly one <title> element per page.',
  'seo.title-short': 'Expand the title so it describes the page rather than labelling it.',
  'seo.title-long': 'Shorten the title so search results do not truncate it.',
  'seo.description-missing': 'Add a meta description summarizing the page for search results.',
  'seo.description-multiple': 'Keep exactly one meta description per page.',
  'seo.description-short': 'Expand the description; a short one gives search engines little to work with.',
  'seo.description-long': 'Shorten the description so it is not truncated in results.',
  'seo.canonical-missing': 'Declare a canonical URL, or confirm the page intentionally has none.',
  'seo.canonical-multiple': 'Keep exactly one canonical link per page.',
  'seo.canonical-cross-host': 'Confirm the cross-host canonical is deliberate, because it hands ranking to another host.',
  'seo.noindex': 'Confirm noindex is intentional, because it removes the page from search results.',
  'structure.h1-missing': "Add a single H1 that describes the page's main topic.",
  'structure.h1-multiple': 'Reduce to one H1 per page; use H2+ for subsections.',
  'structure.heading-skip': 'Close the heading-level gap so the outline reads in order.',
  'structure.image-alt-missing': 'Describe each informative image in its alt attribute, and mark decorative images alt="".',
  'structure.orphan-page': 'Link to the page from somewhere in the site, or accept that discovery depends on the sitemap alone.',
  'schema.missing': 'Add schema.org structured data (JSON-LD) relevant to this page type.',
  'schema.invalid-json': 'Fix the JSON syntax in the structured data block so search engines can read it.',
  'seo.duplicate-title': 'Give each page a unique, specific title. Merge or differentiate pages that currently share one.',
  'seo.duplicate-description': 'Write a unique meta description for each page, or remove the duplicate so it is not misleading in search results.',
  'structure.duplicate-h1': 'Differentiate the H1 on each page so the main topic is not repeated across the site.',
  'seo.thin-content': 'Expand the page with substantive, unique content, or consolidate/redirect it into a more complete page.',
  'seo.sitemap-orphan': 'Add the page to the sitemap, or confirm it is deliberately excluded.',
  'seo.sitemap-unreached': 'Link to the URL internally, or remove a stale entry from the sitemap.',
  'seo.sitemap-blocked-by-robots': 'Resolve the contradiction: the sitemap asks search engines to index a URL robots.txt tells them not to crawl.',
  'security.hsts-missing': 'Send Strict-Transport-Security so a future visit cannot be downgraded to http.',
  'security.content-type-options-missing': 'Send X-Content-Type-Options: nosniff.',
  'security.clickjacking-exposure': 'Send X-Frame-Options or a CSP frame-ancestors directive; either one prevents the page being framed.',
  'security.referrer-policy-missing': 'Send a Referrer-Policy so full URLs do not leak to third-party destinations.',
  'security.mixed-content-static': 'Serve every subresource over https, or the browser will block or downgrade it.',
  'security.insecure-form-action': 'Point the form at an https endpoint.',
  'web.viewport-missing': 'Add a viewport meta tag so the page adapts to a phone.',
  'web.charset-missing': 'Declare the character encoding so the browser does not have to guess it.',
  'web-quality.doctype-missing': 'Add <!doctype html> so the browser renders in standards mode.',
  'web.meta-refresh': 'Replace the meta refresh with a server-side 301 redirect.',
  'a11y.lang-missing': 'Set a lang attribute on <html> so assistive technology picks the right voice.',
  'a11y.lang-invalid': 'Correct the lang attribute to a valid BCP 47 tag.',
  'seo.hreflang-invalid': 'Correct the hreflang value to a valid language or language-region tag.',
  'seo.hreflang-duplicate-target': 'Give each language variant its own URL, because search engines expect distinct targets.',
  'content.generic-link-text': 'Replace generic link text with words that describe the destination.',
  'social.og-incomplete': 'Complete the Open Graph tags so shared links render with a title, description and image.',
  'navigation.fragment-missing': 'Add the missing element id, or point the link at one that exists.'
};

/** Falls back by rule family, then to a generic instruction. Every rule gets a
 * sentence — a finding with no recommended move is not finished. */
export function guidanceForRule(ruleId) {
  const id = String(ruleId || '');
  if (RULE_GUIDANCE[id]) return RULE_GUIDANCE[id];
  if (/^navigation\.link-(404|410)/.test(id)) return 'Fix or remove the link, or 301-redirect the destination to a working URL.';
  if (/^navigation\.link-5xx/.test(id)) return 'Investigate the server error at the destination; the link itself may be fine once that is fixed.';
  if (/^navigation\.link-review/.test(id)) return 'Confirm whether the destination is meant to require authentication or is rate-limiting requests.';
  if (/^axe\./.test(id)) return 'Open this rule in the browser-checks view for its WCAG detail. It was found by rendering the page in a real browser.';
  if (/^performance\.browser\./.test(id)) return 'Review the measured resource for size, format or loading-order improvements.';
  if (/^runtime\./.test(id)) return 'Reproduce the page in a browser with the console open. This was raised by the page executing, not by its markup.';
  if (/^ux\./.test(id)) return 'Operate the control the finding names and confirm it behaves as a visitor would expect.';
  if (/^security\./.test(id)) return 'Set the response header or destination the finding names.';
  return 'Review the affected pages and apply the fix implied by the finding above.';
}

export { RULE_GUIDANCE };
