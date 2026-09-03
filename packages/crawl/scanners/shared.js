/**
 * Shared helpers for the static-tier scanner registry (packages/crawl/scanners/*).
 *
 * A "scanner" is one discipline's module: `{ id, perPage?, crossPage? }`.
 * `perPage(pageMeta, pageUrl, ctx) -> Finding[]` runs once per fetched page
 * and can only see that page's own collected data (title, links, headers,
 * etc. — whatever static-collector.js extracted). `crossPage(fetchedRows,
 * ctx) -> Map<url, Finding[]>` runs once after the whole crawl completes and
 * can compare pages against each other or against `ctx` (sitemap set,
 * robots rules, whether the crawl frontier was cut off by maxPages). Most
 * disciplines only need one of the two hooks.
 *
 * The non-negotiable rule enforced centrally, not by author discipline: any
 * finding a static-tier scanner produces without an explicit `confidence`
 * is treated as `'inferred'`, never silently promoted to `'confirmed'` by
 * packages/findings/confidence.js's normal 'confirmed' fallback. A static
 * HTML fetch with no JS execution has structurally weaker evidence than a
 * rendered page, and a registry inviting many independently-written scanner
 * modules must not rely on every author remembering to say so by hand.
 */
import crypto from 'node:crypto';

export const STATIC_EVIDENCE_NOTE = 'Based on the static HTML response — JavaScript was not executed, so content added by client-side scripts (including most single-page apps) will not appear here. The optional render pass checks the rendered DOM instead.';

export function fingerprintOf(...parts) {
  return crypto.createHash('sha1').update(parts.join('|')).digest('base64url').slice(0, 12);
}

export function withDefaultConfidence(findings = []) {
  return findings.map((f) => ({ confidence: 'inferred', ...f }));
}

export function absoluteUrl(href, base) {
  try { return new URL(href, base).toString(); } catch { return null; }
}
