/**
 * Site-level signals: the documents a site publishes *about itself* at fixed,
 * well-known paths — robots.txt, sitemap.xml and llms.txt.
 *
 * These are collected independently of whether the crawl obeys them. Turning
 * off "respect robots.txt" changes how we crawl; it must not change whether we
 * can tell the operator what the file says. The crawl's own robots handling
 * (robots.js) stays a gating concern and is deliberately not merged into this.
 *
 * Every field records what was actually observed. "We could not reach it" is
 * kept distinct from "it is not there", because those are different facts and
 * only one of them is the site's doing.
 */

export const LLMS_TXT_PATH = '/llms.txt';

/** One fetch, reduced to the facts a report can defend: did we reach it, what
 * did it answer, and how big was the body. Never throws. */
async function probe(url, { fetchImpl, userAgent, accept }) {
  try {
    const res = await fetchImpl(url, { headers: { 'user-agent': userAgent, ...(accept ? { accept } : {}) }, redirect: 'follow' });
    const status = Number(res.status || 0);
    const body = res.ok ? await res.text() : '';
    return { reached: true, status, ok: Boolean(res.ok), body, bytes: body.length, finalUrl: res.url || url };
  } catch (error) {
    return { reached: false, status: 0, ok: false, body: '', bytes: 0, finalUrl: url, error: String(error?.message || error).slice(0, 200) };
  }
}

/**
 * robots.txt as a reportable document rather than as crawl rules.
 * `blocksEverything` is the one that matters most to a consultant: a site that
 * ships `Disallow: /` for `*` has told every search engine to stay out, which
 * is usually a staging config that escaped to production.
 */
export function describeRobots(result, parsed) {
  if (!result.reached) {
    return { present: null, status: 0, reachable: false, error: result.error || 'unreachable', sitemaps: [], disallowCount: 0, blocksEverything: false, confidence: 'inconclusive' };
  }
  if (result.status === 404 || result.status === 410) {
    return { present: false, status: result.status, reachable: true, sitemaps: [], disallowCount: 0, blocksEverything: false, confidence: 'confirmed' };
  }
  if (!result.ok) {
    return { present: null, status: result.status, reachable: true, sitemaps: [], disallowCount: 0, blocksEverything: false, confidence: 'inconclusive' };
  }
  const disallow = parsed?.disallow || [];
  return {
    present: true,
    status: result.status,
    reachable: true,
    bytes: result.bytes,
    sitemaps: parsed?.sitemaps || [],
    disallowCount: disallow.length,
    // Only a bare `/` for the wildcard agent is a whole-site block. A long
    // disallow list is normal housekeeping and is not reported as one.
    blocksEverything: disallow.some((rule) => rule.trim() === '/'),
    confidence: 'confirmed'
  };
}

/** llms.txt is a *proposed* convention, not a standard. Its absence is never a
 * defect and must never be reported as one — only its presence is a fact worth
 * stating, because a site that ships one has made a deliberate choice. */
export function describeLlmsTxt(result) {
  if (!result.reached) return { present: null, status: 0, reachable: false, confidence: 'inconclusive', standard: 'proposed' };
  if (result.ok && result.bytes > 0) return { present: true, status: result.status, reachable: true, bytes: result.bytes, confidence: 'confirmed', standard: 'proposed' };
  if (result.status === 404 || result.status === 410) return { present: false, status: result.status, reachable: true, confidence: 'confirmed', standard: 'proposed' };
  return { present: null, status: result.status, reachable: true, confidence: 'inconclusive', standard: 'proposed' };
}

/**
 * Collects the well-known documents for an origin.
 *
 * `parseRobotsTxt` and `fetchSitemapUrls` are injected rather than imported so
 * this module stays independent of the crawl's gating path and remains trivial
 * to test without a network.
 */
export async function collectSiteSignals(origin, {
  fetchImpl = fetch,
  userAgent = 'Lumen-WebQA-SiteAudit',
  parseRobotsTxt,
  fetchSitemapUrls,
  sitemapReadCap = 2000
} = {}) {
  const [robotsResult, llmsResult] = await Promise.all([
    probe(`${origin}/robots.txt`, { fetchImpl, userAgent, accept: 'text/plain' }),
    probe(`${origin}${LLMS_TXT_PATH}`, { fetchImpl, userAgent, accept: 'text/plain' })
  ]);

  const parsedRobots = robotsResult.ok && parseRobotsTxt ? parseRobotsTxt(robotsResult.body) : { disallow: [], sitemaps: [] };
  const robots = describeRobots(robotsResult, parsedRobots);

  // A sitemap declared in robots.txt is the site's own answer; /sitemap.xml is
  // the conventional fallback. Record which one we actually read, because
  // "declared and present" is a different fact from "found at the usual path".
  const declared = robots.sitemaps || [];
  const candidates = declared.length ? declared.slice(0, 5) : [`${origin}/sitemap.xml`];
  let sitemap = { declaredInRobots: declared.length > 0, declared, source: null, present: false, urlCount: 0, truncated: false, confidence: 'confirmed' };
  if (fetchSitemapUrls) {
    for (const candidate of candidates) {
      let urls = [];
      try { urls = await fetchSitemapUrls(candidate, { maxUrls: sitemapReadCap }); } catch { urls = []; }
      if (urls.length) {
        sitemap = {
          declaredInRobots: declared.length > 0,
          declared,
          source: candidate,
          present: true,
          urlCount: urls.length,
          truncated: urls.length >= sitemapReadCap,
          // The URL list itself is not carried here: it would bloat the audit
          // stats blob for no reporting gain. Cross-page scanners get the set
          // they need from the crawl directly.
          confidence: 'confirmed'
        };
        break;
      }
    }
  }

  return {
    origin,
    checkedAt: new Date().toISOString(),
    robots,
    sitemap,
    llmsTxt: describeLlmsTxt(llmsResult)
  };
}
