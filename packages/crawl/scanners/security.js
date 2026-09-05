/**
 * Response-header security discipline. Unlike most of this tier's checks,
 * these facts come straight from the HTTP response, not from parsed markup —
 * they are unaffected by whatever JavaScript the page runs, so (unlike an
 * absence-of-markup claim) they are 'confirmed', not 'inferred'.
 */

function perPage(meta, pageUrl) {
  const out = [];
  let isHttps = false;
  try { isHttps = new URL(pageUrl).protocol === 'https:'; } catch {}

  if (isHttps && !meta.hasHsts) {
    out.push({ ruleId: 'security.hsts-missing', title: 'HTTP Strict Transport Security header is missing', detail: `${pageUrl} was served over HTTPS but did not send a Strict-Transport-Security header. Without HSTS, a browser can still be downgraded to a plain http:// connection on a future visit (for example via a stripped link), giving an attacker a window to intercept traffic.`, category: 'fix', severity: 'medium', confidence: 'confirmed' });
  }
  if (!meta.hasXContentTypeOptions) {
    out.push({ ruleId: 'security.content-type-options-missing', title: 'X-Content-Type-Options header is missing', detail: `${pageUrl} did not send X-Content-Type-Options: nosniff. Without it, some browsers may try to "sniff" a response's real content type, which has historically enabled certain content-spoofing attacks.`, category: 'review', severity: 'low', confidence: 'confirmed' });
  }
  if (!meta.hasXFrameOptions && !meta.hasFrameAncestorsCsp) {
    out.push({ ruleId: 'security.clickjacking-exposure', title: 'Page has no clickjacking protection', detail: `${pageUrl} sent neither an X-Frame-Options header nor a Content-Security-Policy frame-ancestors directive. Either one alone is sufficient to prevent the page being embedded in a hidden iframe on another site for a clickjacking attack; this page has neither.`, category: 'fix', severity: 'medium', confidence: 'confirmed' });
  }
  if (!meta.hasReferrerPolicy) {
    out.push({ ruleId: 'security.referrer-policy-missing', title: 'Referrer-Policy header is missing', detail: `${pageUrl} did not send a Referrer-Policy header. Without one, the browser's default behavior may leak this page's full URL, including any sensitive query parameters, to third-party destinations linked from it.`, category: 'review', severity: 'low', confidence: 'confirmed' });
  }
  return out;
}

export default { id: 'security', perPage };
