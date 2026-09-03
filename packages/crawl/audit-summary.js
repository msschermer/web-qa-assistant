/**
 * The audit summary: a factual state readout of the site, not a score.
 *
 * A number would be the easiest thing to build here and the least defensible
 * thing to hand a client. Any weighting we picked would be invented, and a
 * score is precisely what gets quoted back without its caveats. So this
 * composes a small set of named states, each carrying the evidence it rests on
 * and the confidence that evidence supports — the same vocabulary every
 * finding uses (confirmed / corroborated / inferred / inconclusive).
 *
 * A row whose evidence could not settle the question says so. It never guesses,
 * and it never fills a gap with a reassuring default.
 */

/** Row states. `attention` means the evidence says something is wrong;
 * `unknown` means the evidence could not settle it. They are never merged —
 * conflating "we could not check" with "it is fine" is the failure this
 * product exists to avoid. */
export const SUMMARY_STATES = ['ok', 'attention', 'unknown'];

function row(id, label, state, headline, evidence, confidence, extra = {}) {
  return { id, label, state, headline, evidence: evidence.filter(Boolean), confidence, ...extra };
}

function pct(n, of) {
  if (!of) return 0;
  return Math.round((n / of) * 100);
}

/**
 * @param {object} input
 * @param {object} input.signals      collectSiteSignals() output
 * @param {object} input.urlCounts    store.urlCountsByStatus()
 * @param {object} input.linkCounts   store.linkCountsByStatus()
 * @param {Array}  input.findingsByRule  [{ rule_id, severity, confidence, category, n }]
 * @param {object} input.schema       { pagesWithSchema, pagesChecked, types: Map|Object }
 * @param {object} input.unverifiableExternal  createUnverifiableLedger().summary()
 */
export function composeAuditSummary({
  signals = {},
  urlCounts = {},
  linkCounts = {},
  findingsByRule = [],
  schema = {},
  unverifiableExternal = null
} = {}) {
  const rows = [];

  const fetched = Number(urlCounts.fetched || 0);
  const queued = Number(urlCounts.queued || 0);
  const errored = Number(urlCounts.error || 0);
  const skipped = Number(urlCounts.skipped || 0);
  const discovered = fetched + queued + errored + skipped;

  // --- Indexable -----------------------------------------------------------
  const robots = signals.robots || {};
  if (robots.present === true && robots.blocksEverything) {
    rows.push(row('indexable', 'Indexable', 'attention',
      'robots.txt disallows the whole site',
      [`robots.txt returned HTTP ${robots.status} and contains "Disallow: /" for all user agents.`,
        'Search engines that respect robots.txt will not crawl any page here.'],
      'confirmed'));
  } else if (robots.present === true) {
    rows.push(row('indexable', 'Indexable', 'ok',
      'robots.txt allows crawling',
      [`robots.txt returned HTTP ${robots.status} with ${robots.disallowCount} disallow rule${robots.disallowCount === 1 ? '' : 's'} and no site-wide block.`],
      'confirmed'));
  } else if (robots.present === false) {
    // No robots.txt is permissive by default. That is a fact, not a fault.
    rows.push(row('indexable', 'Indexable', 'ok',
      'No robots.txt, so nothing is disallowed',
      [`robots.txt returned HTTP ${robots.status}. With no file present, crawlers treat the whole site as allowed.`],
      'confirmed'));
  } else {
    rows.push(row('indexable', 'Indexable', 'unknown',
      'robots.txt could not be read',
      [robots.error ? `Request failed: ${robots.error}` : `robots.txt returned HTTP ${robots.status || 0}.`,
        'Whether crawling is disallowed could not be established from this audit.'],
      'inconclusive'));
  }

  // --- Crawlable -----------------------------------------------------------
  if (fetched === 0) {
    rows.push(row('crawlable', 'Crawlable', 'unknown',
      'No pages were fetched',
      ['The crawl did not successfully fetch any page, so nothing about this site was observed.'],
      'inconclusive'));
  } else {
    const reachRate = pct(fetched, discovered);
    const limited = queued > 0;
    rows.push(row('crawlable', 'Crawlable', errored > 0 ? 'attention' : 'ok',
      errored > 0
        ? `${fetched} of ${discovered} discovered pages fetched, ${errored} failed`
        : limited
          ? `${fetched} of ${discovered} discovered pages fetched (page limit reached)`
          : `${fetched} of ${discovered} discovered pages fetched`,
      [
        `${reachRate}% of discovered URLs were fetched successfully.`,
        errored > 0 ? `${errored} page${errored === 1 ? '' : 's'} could not be fetched.` : null,
        skipped > 0 ? `${skipped} skipped by robots.txt.` : null,
        limited ? `${queued} still queued when the page limit stopped the crawl — this is a coverage limit, not a site problem.` : null
      ],
      'confirmed',
      { coverageLimited: limited }));
  }

  // --- Sitemap -------------------------------------------------------------
  const sitemap = signals.sitemap || null;
  if (!sitemap) {
    rows.push(row('sitemap', 'Sitemap', 'unknown',
      'Sitemap was not checked',
      ['No site-signal collection ran for this audit, so the presence of a sitemap was never established.'],
      'inconclusive'));
  } else if (sitemap.present) {
    const agreement = fetched && sitemap.urlCount
      ? `The crawl fetched ${fetched} page${fetched === 1 ? '' : 's'}; the sitemap lists ${sitemap.urlCount}.`
      : null;
    rows.push(row('sitemap', 'Sitemap', 'ok',
      sitemap.declaredInRobots ? 'Declared in robots.txt and readable' : 'Found at the conventional path',
      [
        `Read ${sitemap.urlCount} URL${sitemap.urlCount === 1 ? '' : 's'} from ${sitemap.source}.`,
        sitemap.declaredInRobots ? null : 'Not declared in robots.txt; found at /sitemap.xml by convention.',
        sitemap.truncated ? 'The sitemap was longer than this audit reads, so its full contents were not compared.' : null,
        agreement
      ],
      sitemap.truncated ? 'inferred' : 'confirmed'));
  } else if (sitemap.declaredInRobots) {
    rows.push(row('sitemap', 'Sitemap', 'attention',
      'Declared in robots.txt but nothing could be read from it',
      [`robots.txt declares ${sitemap.declared.length} sitemap${sitemap.declared.length === 1 ? '' : 's'}, but no URLs were read from ${sitemap.declared.slice(0, 3).join(', ')}.`,
        'Search engines following that declaration would find nothing usable.'],
      'confirmed'));
  } else {
    rows.push(row('sitemap', 'Sitemap', 'attention',
      'No sitemap found',
      ['Nothing was declared in robots.txt and /sitemap.xml returned no URLs.',
        'Discovery then depends entirely on internal linking.'],
      'confirmed'));
  }

  // --- Structured data -----------------------------------------------------
  const pagesChecked = Number(schema.pagesChecked || 0);
  const pagesWithSchema = Number(schema.pagesWithSchema || 0);
  const types = schema.types instanceof Map ? [...schema.types.entries()] : Object.entries(schema.types || {});
  const topTypes = types.sort((a, b) => b[1] - a[1]).slice(0, 6);
  if (!pagesChecked) {
    rows.push(row('schema', 'Structured data', 'unknown', 'No pages were checked for structured data', ['The crawl fetched no page HTML to inspect.'], 'inconclusive'));
  } else if (pagesWithSchema === 0) {
    rows.push(row('schema', 'Structured data', 'attention',
      'No structured data found on any crawled page',
      [`None of the ${pagesChecked} fetched page${pagesChecked === 1 ? '' : 's'} carried a JSON-LD block in its static HTML.`,
        'Some sites inject schema with JavaScript, which this tier does not execute.'],
      'inferred'));
  } else {
    rows.push(row('schema', 'Structured data', pagesWithSchema === pagesChecked ? 'ok' : 'attention',
      pagesWithSchema === pagesChecked
        ? `Present on all ${pagesChecked} crawled page${pagesChecked === 1 ? '' : 's'}`
        : `Present on ${pagesWithSchema} of ${pagesChecked} crawled pages`,
      [
        topTypes.length ? `Types found: ${topTypes.map(([t, n]) => `${t} (${n})`).join(', ')}.` : null,
        pagesWithSchema < pagesChecked ? `${pagesChecked - pagesWithSchema} page${pagesChecked - pagesWithSchema === 1 ? '' : 's'} carried none.` : null
      ],
      'confirmed',
      { types: topTypes.map(([type, count]) => ({ type, count })) }));
  }

  // --- Availability --------------------------------------------------------
  const brokenLinks = Number(linkCounts.broken || 0);
  const confirmedAvailability = findingsByRule
    .filter((f) => /^navigation\.link-(404|410|5xx)/.test(f.rule_id || '') && (f.confidence === 'confirmed' || f.confidence === 'corroborated'))
    .reduce((n, f) => n + Number(f.n || f.count || 0), 0);
  if (brokenLinks > 0 || confirmedAvailability > 0) {
    rows.push(row('availability', 'Availability', 'attention',
      `${brokenLinks || confirmedAvailability} confirmed broken link${(brokenLinks || confirmedAvailability) === 1 ? '' : 's'}`,
      [`Independent requests confirmed ${brokenLinks || confirmedAvailability} destination${(brokenLinks || confirmedAvailability) === 1 ? '' : 's'} returning a missing-page or server-error response.`],
      'confirmed'));
  } else if (!fetched || !Object.values(linkCounts).some((n) => Number(n) > 0)) {
    // Nothing was probed, so nothing is confirmed. Reporting 'no broken links'
    // here would turn an absence of evidence into a clean bill of health.
    rows.push(row('availability', 'Availability', 'unknown',
      'No links were verified',
      [`The crawl did not verify any destination, so nothing can be said about whether this site's links resolve.`],
      'inconclusive'));
  } else {
    rows.push(row('availability', 'Availability', 'ok',
      'No broken links confirmed',
      [`${Number(linkCounts.healthy || 0)} destination${Number(linkCounts.healthy || 0) === 1 ? '' : 's'} verified healthy.`],
      'confirmed'));
  }

  // --- llms.txt (presence only; a proposed convention, never a defect) ------
  const llms = signals.llmsTxt || {};
  if (llms.present === true) {
    rows.push(row('llms', 'llms.txt', 'ok', 'Published',
      [`Served ${llms.bytes} byte${llms.bytes === 1 ? '' : 's'} at /llms.txt.`,
        'A proposed convention for describing a site to language models. Publishing one is a deliberate choice, not a requirement.'],
      'confirmed', { standard: 'proposed' }));
  } else if (llms.present === false) {
    rows.push(row('llms', 'llms.txt', 'ok', 'Not published',
      ['/llms.txt returned HTTP ' + llms.status + '. This is a proposed convention, not a standard — its absence is not a defect and is reported here as context only.'],
      'confirmed', { standard: 'proposed', informational: true }));
  }

  // --- Coverage limits -----------------------------------------------------
  const unver = unverifiableExternal;
  const coverage = [];
  if (queued > 0) coverage.push(`${queued} discovered page${queued === 1 ? '' : 's'} were never fetched because the page limit stopped the crawl first.`);
  if (unver && unver.destinationCount > 0) {
    coverage.push(`${unver.destinationCount} external destination${unver.destinationCount === 1 ? '' : 's'} on ${unver.hosts.join(', ')} could not be independently verified; ${unver.occurrenceCount} link${unver.occurrenceCount === 1 ? '' : 's'} point to ${unver.destinationCount === 1 ? 'it' : 'them'}. These platforms refuse automated requests, so this says nothing about whether the links work.`);
  }
  if (sitemap?.truncated) coverage.push('The sitemap was longer than this audit reads, so sitemap-to-crawl comparison is partial.');

  return {
    rows,
    coverage,
    // Deliberately no score. See the module comment.
    generatedAt: new Date().toISOString()
  };
}
