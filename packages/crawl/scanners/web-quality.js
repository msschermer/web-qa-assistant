/**
 * General markup/document hygiene and redirect/security-adjacent signals
 * that are checkable from raw static HTML plus the response headers the
 * crawler already fetched. ruleIds reused verbatim from the rendered tier
 * where the fact is the same: web.viewport-missing, web.charset-missing,
 * social.og-incomplete.
 */
import { STATIC_EVIDENCE_NOTE } from './shared.js';

const REDIRECT_CHAIN_WARN_HOPS = 3;

function perPage(meta, pageUrl) {
  const out = [];

  if (!meta.hasViewport) {
    out.push({ ruleId: 'web.viewport-missing', title: 'Viewport metadata is missing', detail: `No viewport meta tag was found in the static HTML for ${pageUrl}. ${STATIC_EVIDENCE_NOTE}`, category: 'fix', severity: 'medium', confidence: 'inferred' });
  }

  // The rendered tier only inspects the DOM for a charset declaration; a
  // charset can also be declared validly via the HTTP Content-Type header
  // with no <meta charset> in the markup at all (very common). Check the
  // header first — it's already in hand — so this doesn't repeat that gap.
  const headerDeclaresCharset = /charset=/i.test(meta.contentType || '');
  if (!meta.hasCharset && !headerDeclaresCharset) {
    out.push({ ruleId: 'web.charset-missing', title: 'Character encoding declaration was not observed', detail: `No meta charset and no charset in the HTTP Content-Type header were found for ${pageUrl}. Confirm encoding is declared reliably.`, category: 'review', severity: 'low', confidence: 'inferred' });
  }

  if (!meta.hasOgTitle || !meta.hasOgDescription) {
    out.push({ ruleId: 'social.og-incomplete', title: 'Open Graph metadata is incomplete', detail: `One or more core Open Graph title/description fields were not found in the static HTML for ${pageUrl}. Review sharing metadata if social previews matter for this page. ${STATIC_EVIDENCE_NOTE}`, category: 'context', severity: 'info', confidence: 'inferred' });
  }

  if (meta.redirectHops >= REDIRECT_CHAIN_WARN_HOPS) {
    out.push({ ruleId: 'navigation.redirect-chain-long', title: 'Page required a long redirect chain', detail: `${pageUrl} required ${meta.redirectHops} redirect hops to resolve before it could be fetched. Long chains slow down both crawlers and real visitors, and each hop is a point where the redirect could break.`, category: 'review', severity: meta.hadInsecureHop ? 'high' : 'medium', confidence: 'confirmed', count: meta.redirectHops });
  } else if (meta.hadInsecureHop) {
    out.push({ ruleId: 'security.redirect-insecure-hop', title: 'Redirect chain passed through a plain HTTP hop', detail: `${pageUrl} was reached through a redirect chain that included at least one plain http:// hop. That leg of the chain travels unencrypted before landing on the final https:// destination.`, category: 'review', severity: 'medium', confidence: 'confirmed' });
  }

  if (Array.isArray(meta.insecureResourceRefs) && meta.insecureResourceRefs.length && !meta.hasCspUpgradeInsecure) {
    // Weaker and narrower than the rendered tier's browser-observed
    // security.mixed-content(-passive): this only sees http:// URLs typed
    // directly into the static markup for scripts/stylesheets (both
    // active content, unconditionally blocked by real browsers) — it
    // cannot see JS-injected resources, protocol-relative URLs the browser
    // resolves at render time, or passive content like <img>, and it
    // suppresses when the page's own CSP already upgrades these requests.
    out.push({ ruleId: 'security.mixed-content-static', title: 'Page references active content over plain HTTP', detail: `${pageUrl} loads ${meta.insecureResourceRefs.length} script/stylesheet resource${meta.insecureResourceRefs.length === 1 ? '' : 's'} over plain http:// on what may be an https:// page. Modern browsers block this outright. ${STATIC_EVIDENCE_NOTE}`, category: 'fix', severity: 'high', confidence: 'inferred', count: meta.insecureResourceRefs.length });
  }

  if (meta.hasMetaRefresh) {
    // Reuses the rendered tier's exact ruleId — directly observable from raw
    // markup with no JS dependency, so it's 'confirmed' here too.
    out.push({ ruleId: 'web.meta-refresh', title: 'Page uses a meta refresh', detail: `A meta refresh tag was found in the static HTML for ${pageUrl}. Meta refresh can create unexpected navigation and accessibility issues; a proper HTTP redirect or client-side navigation is usually preferable.`, category: 'review', severity: 'medium', confidence: 'confirmed' });
  }

  if (!meta.hasDoctype) {
    out.push({ ruleId: 'web-quality.doctype-missing', title: 'Document has no doctype', detail: `No <!DOCTYPE html> declaration was found for ${pageUrl}. Without a doctype, browsers render the page in quirks mode, which can cause inconsistent layout and CSS behavior.`, category: 'fix', severity: 'medium', confidence: 'confirmed' });
  }

  if (Array.isArray(meta.analyticsSignals) && meta.analyticsSignals.length) {
    // Positive-only, deliberately: see static-collector.js's
    // detectAnalyticsSignals doc comment for why an absence claim here
    // would be inverted (compliant, consent-gated implementations leave
    // nothing recognizable in raw HTML).
    out.push({ ruleId: 'analytics.detected', title: 'Analytics/tracking tag detected', detail: `${pageUrl} references: ${meta.analyticsSignals.join(', ')}.`, category: 'context', severity: 'info', confidence: 'confirmed', count: meta.analyticsSignals.length });
  }

  return out;
}

export default { id: 'web-quality', perPage };
