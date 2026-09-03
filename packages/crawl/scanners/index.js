/**
 * The static-tier scanner registry. Adding a new discipline means adding a
 * module to this list — never editing one growing monolith function. See
 * shared.js for the `{ id, perPage?, crossPage? }` contract each module
 * implements, and crawler.js's module doc for why this tier never runs
 * JavaScript (jsdom parse only) and how it relates to the separate, richer
 * rendered tier (packages/rules/browser-rules.js, run in the user's own
 * browser via the optional render pass).
 */
import seo from './seo.js';
import structure from './structure.js';
import schema from './schema.js';
import content from './content.js';
import webQuality from './web-quality.js';
import security from './security.js';
import { withDefaultConfidence, fingerprintOf } from './shared.js';

export const STATIC_SCANNERS = [seo, structure, schema, content, webQuality, security];

/** Runs every registered scanner's perPage hook against one freshly
 * collected page and returns a flat, fingerprinted finding list. */
export function runPerPageScanners(pageMeta, pageUrl) {
  const out = [];
  for (const scanner of STATIC_SCANNERS) {
    if (!scanner.perPage) continue;
    const findings = withDefaultConfidence(scanner.perPage(pageMeta, pageUrl) || []);
    for (const f of findings) out.push({ ...f, fingerprint: fingerprintOf(pageUrl, f.ruleId) });
  }
  return out;
}

/** Runs every registered scanner's crossPage hook once, after the crawl
 * completes, and merges their per-URL results into one Map. `ctx` carries
 * whole-crawl facts no single page's data can provide (sitemap set,
 * inbound-link counts, whether the frontier was cut off by maxPages) — see
 * crawler.js's runAudit() for how it's built. */
export function runCrossPageScanners(fetchedUrls, ctx) {
  const merged = new Map();
  function mergeIn(map) {
    for (const [url, findings] of map) {
      const fingerprinted = withDefaultConfidence(findings).map((f) => ({ ...f, fingerprint: fingerprintOf(url, f.ruleId, f.detail) }));
      if (!merged.has(url)) merged.set(url, []);
      merged.get(url).push(...fingerprinted);
    }
  }
  for (const scanner of STATIC_SCANNERS) {
    if (!scanner.crossPage) continue;
    mergeIn(scanner.crossPage(fetchedUrls, ctx) || new Map());
  }
  return merged;
}
