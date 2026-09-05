/**
 * Site-audit crawl engine. Pure orchestration: it owns the URL queue,
 * concurrency, robots/sitemap discovery and evidence extraction, but it
 * does not know how a page actually gets fetched or a link actually gets
 * checked — those are injected (`collectPage(url)`, `checkLink(url)`),
 * defaulting to the real cheap implementations (services/api/server.js
 * wires the defaults; tests inject fakes).
 *
 * Collection tier, stated once and load-bearing everywhere else in this
 * file: every page here is fetched as plain HTML and parsed with jsdom
 * (JavaScript NOT executed) — see static-collector.js. No headless browser
 * runs on our server for a site crawl. That is a deliberate, permanent
 * boundary, not a phase-1 shortcut: our infrastructure must never scale
 * with the number of pages a user chooses to audit. Findings this tier can
 * make (broken links, missing/duplicate title & meta & canonical, missing
 * H1, noindex) are confidence:'inferred' or 'confirmed' as appropriate —
 * never claiming to have seen JS-rendered content, because it hasn't.
 * JS-dependent and visual checks (axe, runtime errors, image sizing) come
 * from the separate, optional local render pass: the extension drives the
 * user's own browser through the exact same single-page scan pipeline
 * "Scan Page" already uses, one URL at a time, and posts results back per
 * page (see services/api/server.js's /render-queue and /render-result
 * routes). That pass costs the user's CPU, never ours, and is resumable —
 * every completed page is checkpointed in the store, so losing the
 * extension mid-pass loses no completed work.
 */
import { isPrivateProbeHost } from '../security/safe-probe.js';
import { probeExternalDestination } from '../security/safe-probe.js';
import { applyFindingPolicy } from '../findings/policy.js';
import { fetchRobotsRules, isDisallowed, fetchSitemapUrls } from './robots.js';
import { createUnverifiableLedger, isKnownUnverifiableHost, isRejectionStatus, unverifiableReason } from './link-verification.js';
import { collectSiteSignals } from './site-signals.js';
import { composeAuditSummary } from './audit-summary.js';
import { parseRobotsTxt } from './robots.js';
import { collectStaticPage } from './static-collector.js';
import { normalizeAuditUrl } from './store.js';
import { runPerPageScanners, runCrossPageScanners } from './scanners/index.js';
import { fingerprintOf } from './scanners/shared.js';

// A sitemap can list tens of thousands of URLs on a large site; reading it
// is cheap (a handful of HTTP requests + regex extraction, no per-URL
// crawling) so this cap is independent of maxPages, not scaled to it — the
// crawl's own page budget bounds how many of these get FETCHED, not how
// many get read for sitemap-reconciliation purposes. See scanners/seo.js's
// crossPage for why an under-read sitemap would otherwise manufacture
// false "never reached" findings on exactly the large sites this matters
// most for.
const SITEMAP_READ_CAP = 5000;

export const CRAWL_LIMITS = Object.freeze({
  defaultMaxPages: 40,
  hardMaxPages: 300,
  defaultConcurrency: 3,
  maxConcurrency: 6,
  linkCheckConcurrency: 8
});

export const CRAWL_USER_AGENT = 'Lumen-WebQA-SiteAudit/1.0 (+https://github.com/msschermer/web-qa-assistant)';

export function isCrawlableStartUrl(raw) {
  let u;
  try { u = new URL(String(raw)); } catch { return { ok: false, error: 'invalid-url' }; }
  if (!/^https?:$/.test(u.protocol)) return { ok: false, error: 'unsupported-protocol' };
  if (u.username || u.password) return { ok: false, error: 'destination-not-allowed' };
  if (isPrivateProbeHost(u.hostname)) return { ok: false, error: 'destination-not-allowed' };
  u.hash = '';
  return { ok: true, url: u.toString() };
}

const MAX_PATTERNS = 20;
const MAX_PATTERN_LENGTH = 300;

/** Validates and caps a user-supplied list of include/exclude URL-pattern
 * strings. Patterns are matched as substrings against the URL's pathname —
 * deliberately not full regex/glob: accepting arbitrary regex from a crawl
 * config is an easy way to let a user (accidentally or not) submit a
 * catastrophic-backtracking pattern that hangs a worker for every URL
 * checked against it. Substring matching covers the overwhelming majority
 * of real use ("skip /wp-admin/", "only /blog/") without that risk. */
function sanitizePatterns(input) {
  if (!Array.isArray(input)) return [];
  return input
    .map((p) => String(p || '').trim())
    .filter(Boolean)
    .slice(0, MAX_PATTERNS)
    .map((p) => p.slice(0, MAX_PATTERN_LENGTH));
}

export function planCrawlConfig(input = {}) {
  return Object.freeze({
    maxPages: Math.max(1, Math.min(CRAWL_LIMITS.hardMaxPages, Math.trunc(Number(input.maxPages)) || CRAWL_LIMITS.defaultMaxPages)),
    concurrency: Math.max(1, Math.min(CRAWL_LIMITS.maxConcurrency, Math.trunc(Number(input.concurrency)) || CRAWL_LIMITS.defaultConcurrency)),
    respectRobots: input.respectRobots !== false,
    includeSubdomains: input.includeSubdomains === true,
    userAgent: CRAWL_USER_AGENT,
    // Advanced controls — all optional, all default to today's behavior so
    // an old client omitting them sees no change.
    maxDepth: input.maxDepth == null ? null : Math.max(0, Math.min(50, Math.trunc(Number(input.maxDepth)) || 0)),
    includePatterns: sanitizePatterns(input.includePatterns),
    excludePatterns: sanitizePatterns(input.excludePatterns),
    checkExternalLinks: input.checkExternalLinks !== false,
    respectNofollow: input.respectNofollow === true,
    requestDelayMs: Math.max(0, Math.min(5000, Math.trunc(Number(input.requestDelayMs)) || 0))
  });
}

function pathMatchesAnyPattern(pathname, patterns) {
  return patterns.some((p) => pathname.includes(p));
}

function isCrawlTarget(url, { origin, includeSubdomains }) {
  try {
    const u = new URL(url);
    if (!/^https?:$/.test(u.protocol)) return false;
    if (isPrivateProbeHost(u.hostname)) return false;
    if (u.origin === origin) return true;
    if (!includeSubdomains) return false;
    // Deliberately conservative: match only exact subdomains of the actual
    // starting hostname (blog.shop.example.com is in scope for shop.example.com).
    // A "last two labels" heuristic looks appealing but is simply wrong for
    // multi-part public suffixes (.co.uk, .com.au, .github.io) — it would
    // treat "co.uk" itself as the shared domain and pull in unrelated sites
    // that happen to share a public suffix. Getting this right in general
    // needs a public-suffix list, which is real scope for later; until then,
    // under-including is the safe failure mode, not over-including.
    const originHost = new URL(origin).hostname;
    return u.hostname === originHost || u.hostname.endsWith(`.${originHost}`);
  } catch { return false; }
}

/** Maps a safe-probe.js result row to the crawl's own healthy/broken/
 * inconclusive/blocked vocabulary (matches the export/UI contract that
 * already existed before this module started doing its own link checks). */
function classifyLinkRow(row) {
  const status = Number(row?.status || 0);
  if (status >= 200 && status < 400) return 'healthy';
  if ([401, 403, 429].includes(status)) return 'blocked';
  if (status === 404 || status === 410 || status >= 500) return 'broken';
  return 'inconclusive';
}

function linkFinding(link, internal, disposition, row) {
  const status = Number(row?.status || 0);
  if (disposition === 'broken') {
    const serverError = status >= 500;
    const ruleId = serverError ? (internal ? 'navigation.link-5xx' : 'navigation.link-5xx-external') : `navigation.link-${status === 410 ? 410 : 404}${internal ? '' : '-external'}`;
    return {
      ruleId, title: `${internal ? 'Internal' : 'External'} link points to ${serverError ? 'a server error' : 'a missing page'}`,
      detail: `${link.text ? `"${link.text}" ` : ''}points to ${link.url}. An independent request confirmed HTTP ${status}.`,
      category: 'fix', severity: serverError ? 'critical' : 'high', confidence: 'confirmed',
      link: { url: link.url, internal, status, finalUrl: row.finalUrl || link.url, redirected: Boolean(row.redirected), text: link.text || '' }
    };
  }
  if (disposition === 'blocked') {
    const label = status === 429 ? 'rate-limited' : status === 401 ? 'unauthorized' : 'forbidden';
    return {
      ruleId: internal ? 'navigation.link-review' : 'navigation.link-review-external',
      title: `${internal ? 'Internal' : 'External'} link returned a ${label} response`,
      detail: `${link.text ? `"${link.text}" ` : ''}points to ${link.url}. An independent request received HTTP ${status}. This commonly means the destination's own bot-protection blocked the automated check (sites like Yelp, LinkedIn, and many WAFs do this to any non-browser request), not that the page is actually down. This is NOT treated as a broken link; confirm by visiting it yourself if you're unsure.`,
      category: 'review', severity: 'low', confidence: 'inconclusive',
      link: { url: link.url, internal, status, finalUrl: row.finalUrl || link.url, redirected: Boolean(row.redirected), text: link.text || '' }
    };
  }
  return null;
}

/** What structured data the crawl actually found, across every fetched page. */
function schemaCoverageFor(store, auditId) {
  const types = new Map();
  let pagesChecked = 0;
  let pagesWithSchema = 0;
  const pageSize = 500;
  for (let offset = 0; ; offset += pageSize) {
    const rows = store.listUrls(auditId, { limit: pageSize, offset });
    if (!rows.length) break;
    for (const r of rows) {
      if (r.status !== 'fetched') continue;
      pagesChecked++;
      let parsed = [];
      try { parsed = JSON.parse(r.schema_types || '[]'); } catch { parsed = []; }
      if (!Array.isArray(parsed) || !parsed.length) continue;
      pagesWithSchema++;
      for (const t of parsed) types.set(t, (types.get(t) || 0) + 1);
    }
    if (rows.length < pageSize) break;
  }
  return { pagesChecked, pagesWithSchema, types };
}

async function mapWithConcurrency(items, limit, fn) {
  const results = new Array(items.length);
  let cursor = 0;
  async function worker() {
    while (cursor < items.length) {
      const index = cursor++;
      results[index] = await fn(items[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

/**
 * Runs one audit to completion (or cancellation). `store` is a
 * packages/crawl/store.js instance already holding the audit row.
 * `collectPage(url)` defaults to the static (no-browser) collector;
 * `checkLink(url)` defaults to the same privileged, SSRF-safe prober used
 * for single-page external link confirmation.
 */
export async function runAudit({
  auditId, startUrl, config, store,
  collectPage = (url) => collectStaticPage(url, { userAgent: config.userAgent }),
  checkLink = (url) => probeExternalDestination(url, { timeoutMs: 8000 }),
  onProgress = () => {}, isCancelled = () => false, isPaused = () => false, log = () => {}
}) {
  const origin = new URL(startUrl).origin;
  const stats = { pagesProcessed: 0, pagesErrored: 0, pagesSkippedRobots: 0, findingsTotal: 0, linksTotal: 0, linksChecked: 0 };
  // A destination is the unit of a link problem, not an anchor. A footer link
  // repeated on every page is one fact about one URL; emitting it per
  // occurrence let a single social icon out-number every real defect on the
  // site. These two structures keep the reporting unit honest.
  const unverifiable = createUnverifiableLedger();

  store.setPhase(auditId, 'discovering');
  const siteSignals = await collectSiteSignals(origin, {
    userAgent: config.userAgent,
    parseRobotsTxt,
    fetchSitemapUrls,
    sitemapReadCap: SITEMAP_READ_CAP
  });
  // Persist them immediately. Everything below this line can take minutes, and
  // these three facts are already settled — an operator watching the run is
  // entitled to see them now rather than at the end.
  store.mergeAuditStats(auditId, { siteSignals });
  const robots = config.respectRobots
    ? await fetchRobotsRules(origin, { userAgent: config.userAgent })
    : { disallow: [], sitemaps: [] };

  store.enqueueUrl(auditId, startUrl, 'start', 0);
  const depthByNormalizedUrl = new Map([[normalizeAuditUrl(startUrl), 0]]);
  const sitemapUrls = new Set();
  // Kept so the set survives the crawl. See audit_sitemap_urls in store.js.
  const sitemapEntries = [];
  let sitemapFetched = false;
  let sitemapTruncated = false;
  if (config.respectRobots) {
    const sitemapCandidates = robots.sitemaps.length ? robots.sitemaps : [`${origin}/sitemap.xml`];
    for (const sitemapUrl of sitemapCandidates.slice(0, 5)) {
      const urls = await fetchSitemapUrls(sitemapUrl, { maxUrls: SITEMAP_READ_CAP });
      if (urls.length) sitemapFetched = true;
      if (urls.length >= SITEMAP_READ_CAP) sitemapTruncated = true;
      for (const u of urls) {
        if (!isCrawlTarget(u, { origin, includeSubdomains: config.includeSubdomains })) continue;
        const pathname = (() => { try { return new URL(u).pathname; } catch { return '/'; } })();
        if (config.excludePatterns.length && pathMatchesAnyPattern(pathname, config.excludePatterns)) continue;
        if (config.includePatterns.length && !pathMatchesAnyPattern(pathname, config.includePatterns)) continue;
        sitemapUrls.add(normalizeAuditUrl(u));
        sitemapEntries.push({ normalized: normalizeAuditUrl(u), url: u, source: sitemapUrl });
        // Sitemap URLs are treated as depth 0 (directly known), not reached
        // via link traversal, so maxDepth never excludes them.
        depthByNormalizedUrl.set(normalizeAuditUrl(u), 0);
        store.enqueueUrl(auditId, u, 'sitemap', 0);
      }
    }
  }
  onProgress({ phase: 'discovering', ...store.urlCountsByStatus(auditId) });

  store.setPhase(auditId, 'crawling');
  let inFlight = 0;
  let cancelledEarly = false;

  // maxPages must bound total render ATTEMPTS, not just successes — otherwise
  // a target with a high error rate (flaky pages, timeouts) never converges
  // and the crawl silently costs far more time than the user asked for.
  // Seeded from work already off the frontier, so the page budget counts the
  // audit's total rather than this worker run's. Without it, continuing a
  // 6-page crawl at a 12-page budget fetched twelve MORE pages and finished
  // with eighteen — a budget that means something different on the second run
  // than the first is not a budget.
  let pagesAttempted = Object.entries(store.urlCountsByStatus(auditId))
    .filter(([status]) => status !== 'queued')
    .reduce((total, [, count]) => total + Number(count || 0), 0);
  // Every discovered link is checked at most once per audit no matter how
  // many pages reference it — this is what keeps link-checking cheap on a
  // site with a shared nav/footer — but a finding is still recorded against
  // every page that links to a broken destination, so pattern grouping
  // ("172 of 184 pages share this broken link") stays accurate downstream.
  const linkStatusCache = new Map();

  async function checkOneLink(sourceUrl, link) {
    const normalized = normalizeAuditUrl(link.url);
    const internal = isCrawlTarget(link.url, { origin, includeSubdomains: config.includeSubdomains });
    if (!internal && !config.checkExternalLinks) {
      // The user explicitly asked to skip external verification (for speed,
      // or to avoid triggering a destination's bot-protection at all) — the
      // link is still recorded and still counts toward internal-page
      // discovery decisions, it just never leaves an "unchecked" status
      // rather than a false "healthy".
      return { internal, disposition: 'unchecked', row: { status: 0, finalUrl: link.url, redirected: false }, finding: null };
    }
    let cached = linkStatusCache.get(normalized);
    if (!cached) {
      let row;
      try { row = await checkLink(link.url); } catch (error) { row = { status: 0, error: String(error?.message || error) }; }
      cached = { row, disposition: classifyLinkRow(row) };
      linkStatusCache.set(normalized, cached);
      stats.linksChecked++;
    }
    // A platform that refuses robots tells us nothing about the link, so it is
    // counted as coverage and never becomes a finding. Everything else keeps
    // its per-page finding: for a confirmed defect, which pages carry it is
    // exactly what the operator needs in order to fix it.
    const countedAsCoverage = !internal && unverifiable.record(link.url, cached.row?.status, sourceUrl);
    const finding = countedAsCoverage ? null : linkFinding(link, internal, cached.disposition, cached.row);
    return { internal, disposition: cached.disposition, row: cached.row, finding, countedAsCoverage };
  }

  async function worker() {
    while (true) {
      if (isCancelled()) { cancelledEarly = true; return; }
      // Paused workers park rather than exit. Exiting would settle the whole
      // crawl and move it to analysis, which is a different thing entirely
      // from what the operator asked for when they pressed Pause.
      while (isPaused() && !isCancelled()) await new Promise((r) => setTimeout(r, 200));
      if (isCancelled()) { cancelledEarly = true; return; }
      if (pagesAttempted >= config.maxPages) return;
      const job = store.claimNextQueuedUrl(auditId);
      if (!job) {
        if (inFlight === 0) return;
        await new Promise((r) => setTimeout(r, 60));
        continue;
      }
      inFlight++;
      try {
        let pathname = '/';
        try { pathname = new URL(job.url).pathname; } catch {}
        if (config.respectRobots && isDisallowed(pathname, robots.disallow)) {
          store.recordUrlResult(auditId, job.url, { status: 'skipped', error: 'robots-disallowed', discoveredVia: job.discovered_via });
          stats.pagesSkippedRobots++;
          continue;
        }
        pagesAttempted++;
        if (config.requestDelayMs) await new Promise((r) => setTimeout(r, config.requestDelayMs));
        let page;
        try {
          page = await collectPage(job.url);
        } catch (error) {
          store.recordUrlResult(auditId, job.url, { status: 'error', error: String(error?.message || error).slice(0, 500), discoveredVia: job.discovered_via });
          stats.pagesErrored++;
          log('page-error', { url: job.url, error: String(error?.message || error) });
          continue;
        }
        if (!page.ok) {
          store.recordUrlResult(auditId, job.url, { status: 'error', error: String(page.error || 'collection-failed').slice(0, 500), discoveredVia: job.discovered_via, httpStatus: page.httpStatus || null });
          stats.pagesErrored++;
          continue;
        }

        store.recordUrlResult(auditId, job.url, {
          status: 'fetched', discoveredVia: job.discovered_via, collectionMethod: 'static',
          httpStatus: page.httpStatus, finalUrl: page.finalUrl || job.url,
          redirected: page.redirected, title: page.title || '', metaDescription: page.description || '',
          canonical: page.canonical || '', indexable: !/noindex/i.test(page.robots || ''), h1Count: page.h1s?.length || 0,
          h1Text: page.h1Text || '', wordCount: page.wordCount || null, schemaTypes: page.schemaTypes || []
        });

        // The structured-data items behind schemaTypes. Recorded per page as the
        // crawl goes so a paused or page-limited audit still holds the inventory
        // for everything it did read, rather than only for a run that finished.
        store.recordSchema(auditId, job.url, {
          items: page.schemaItems || [],
          invalidBlocks: page.schemaInvalidBlocks || [],
          truncated: Boolean(page.schemaTruncated)
        });

        if (!page.isHtml) { stats.pagesProcessed++; continue; }

        const links = Array.isArray(page.links) ? page.links : [];
        const results = await mapWithConcurrency(links, CRAWL_LIMITS.linkCheckConcurrency, (link) => checkOneLink(job.url, link));
        stats.linksTotal += links.length;

        const linkFindings = [];
        const toEnqueue = [];
        const sourceDepth = depthByNormalizedUrl.get(normalizeAuditUrl(job.url)) ?? 0;
        for (let i = 0; i < links.length; i++) {
          const link = links[i];
          const { internal, disposition, row, finding } = results[i];
          store.recordLinks(auditId, job.url, [{ url: link.url, internal, text: link.text, status: disposition, httpStatus: Number(row.status || 0), finalUrl: row.finalUrl || link.url, redirected: Boolean(row.redirected) }]);
          if (finding) linkFindings.push({ ...finding, fingerprint: fingerprintOf(job.url, link.url, finding.ruleId) });
          if (!internal) continue;
          if (config.respectNofollow && link.nofollow) continue;
          if (config.maxDepth != null && sourceDepth + 1 > config.maxDepth) continue;
          let pathname = '/';
          try { pathname = new URL(link.url).pathname; } catch {}
          if (config.excludePatterns.length && pathMatchesAnyPattern(pathname, config.excludePatterns)) continue;
          if (config.includePatterns.length && !pathMatchesAnyPattern(pathname, config.includePatterns)) continue;
          const normalizedTarget = normalizeAuditUrl(link.url);
          if (!depthByNormalizedUrl.has(normalizedTarget)) depthByNormalizedUrl.set(normalizedTarget, sourceDepth + 1);
          // The depth travels with the URL into the queue: it is what the
          // report's crawl-depth distribution is drawn from, and it has to be
          // recorded for pages the crawl never gets to as well as the ones it
          // fetches — "20 URLs discovered at depth 4, none reached" is the
          // fact a page-limited crawl most needs to state.
          toEnqueue.push({ url: link.url, depth: depthByNormalizedUrl.get(normalizedTarget) });
        }

        const pageFindings = runPerPageScanners(page, job.url);
        const findings = applyFindingPolicy([...pageFindings, ...linkFindings], { type: 'unknown' });
        store.recordFindings(auditId, job.url, findings);
        stats.findingsTotal += findings.length;
        stats.pagesProcessed++;

        for (const { url, depth } of toEnqueue) store.enqueueUrl(auditId, url, 'link', depth);
      } finally {
        inFlight--;
        onProgress({ phase: 'crawling', ...stats, ...store.urlCountsByStatus(auditId) });
      }
    }
  }

  /**
   * `config.maxPages` is deliberately read live rather than captured: the
   * operator can raise the page budget while the crawl runs, or after the
   * workers have already stopped at the old one, and the frontier reopens
   * instead of the whole audit having to be run again. Every worker returns
   * when the budget is reached, so raising it after that point needs them
   * spawned again — hence the loop rather than a single Promise.all.
   */
  const runWorkers = async () => {
    const remaining = Math.max(1, config.maxPages - pagesAttempted);
    const workerCount = Math.max(1, Math.min(config.concurrency, remaining));
    await Promise.all(Array.from({ length: workerCount }, () => worker()));
  };
  await runWorkers();
  while (
    !cancelledEarly && !isCancelled() &&
    pagesAttempted < config.maxPages &&
    Number(store.urlCountsByStatus(auditId).queued || 0) > 0
  ) {
    await runWorkers();
  }

  store.setPhase(auditId, 'analyzing');
  store.recordSitemapUrls(auditId, sitemapEntries);
  const allUrls = store.listUrls(auditId, { limit: 100000, offset: 0 });
  const fetchedUrls = allUrls.filter((u) => u.status === 'fetched');
  const crawlContext = {
    startUrl,
    sitemapFetched, sitemapTruncated, sitemapUrls,
    robotsDisallow: robots.disallow,
    // A queued backlog when the loop stops means maxPages (or cancellation)
    // cut the crawl off short, not that the frontier was naturally
    // exhausted — gates seo.js's "sitemap URL never reached" direction,
    // which is only meaningful once the crawl actually finished exploring
    // every internal link it could find.
    maxPagesReached: (store.urlCountsByStatus(auditId).queued || 0) > 0,
    inlinkCounts: store.internalInlinkCounts(auditId),
    // The parsed structured data from every page, so the schema discipline can
    // validate the site as a whole rather than one page at a time. Recorded
    // during the crawl; read here because cross-page validation is the only
    // thing that can see a conflict or a template gap.
    schemaPages: store.schemaPages(auditId, { parsedUrls: fetchedUrls.map((u) => u.final_url || u.url) })
  };
  const crossFindings = runCrossPageScanners(fetchedUrls, crawlContext);
  for (const [url, findings] of crossFindings) {
    const policed = applyFindingPolicy(findings, { type: 'unknown' });
    store.recordFindings(auditId, url, policed);
    stats.findingsTotal += policed.length;
  }

  const urlCounts = store.urlCountsByStatus(auditId);
  const linkCounts = store.linkCountsByStatus(auditId);
  const findingsByRule = store.findingsByRule(auditId);
  const unverifiableExternal = unverifiable.summary();
  const finalStats = {
    ...stats,
    urlCounts,
    linkCounts,
    unverifiableExternal,
    siteSignals,
    auditSummary: composeAuditSummary({
      signals: siteSignals,
      urlCounts,
      linkCounts,
      findingsByRule,
      schema: schemaCoverageFor(store, auditId),
      unverifiableExternal
    }),
    findingsByRule
  };
  onProgress({ phase: cancelledEarly ? 'cancelled' : 'analyzing', ...finalStats });
  return { cancelled: cancelledEarly, stats: finalStats };
}
