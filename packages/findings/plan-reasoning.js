/**
 * Reasoning across findings, rather than about one of them.
 *
 * Two jobs live here, and both are things no single scanner can do because both
 * are questions about the *relationship* between things several scanners each
 * reported separately.
 *
 * ## Merging: are these one job or several?
 *
 * Grouping is per rule today, so a template that emits a bad heading, a
 * duplicated title and no description produces three changes over the same
 * forty-seven URLs. Each is correct. Together they overstate the work by three
 * times, and they hide the only fact that matters: there is one template and
 * somebody has to open it once.
 *
 * The merge is deliberately conservative, and it is set arithmetic rather than
 * judgement. Two changes merge when the URLs they land on are substantially the
 * same set, when that set covers most of a page group the site model measured,
 * and when they are **different kinds of work**. Nothing merges on a hunch about
 * what the pages are for, and nothing merges across page groups.
 *
 * That last condition is the one that took a wrong answer to find. Overlap
 * alone merged three broken links that appeared on every page, because anything
 * in a shared header overlaps with everything else in it. But three dead hrefs
 * are three dead hrefs: same field, three times, possibly in three files. What
 * makes something one template edit is several *different* fields of one
 * template being wrong at once — the heading, the title and the structured data
 * — which is one file opened once. So a merge needs at least two distinct
 * remediation causes, and repetitions of one cause stay separate.
 *
 * A merge never replaces the changes it covers. It sits above them, names them,
 * and carries their ids, so the plan still reconciles against Findings and a
 * reader can always get back to the evidence. A layer that consumed its own
 * inputs would be a layer nobody could check.
 *
 * ## Uncertainty: when the honest answer is "not yet"
 *
 * The second job is refusing to answer. A plan that recommends something for
 * every observation is a plan that recommends things it cannot support, and the
 * expensive failures in this product are all confident ones. Where several
 * signals disagree — a canonical pointing one way, the sitemap listing another,
 * the internal links preferring a third — there is a real problem and no
 * defensible instruction, and the useful output is the question plus what would
 * settle it.
 */

import { groupCoverage } from './site-model.js';

/** How much two URL sets have to overlap before they are treated as the same
 * set. High, because the cost of a wrong merge is a plan that tells someone to
 * edit a template that does not exist. */
const SAME_SET = 0.8;

/** How much of a page group a change has to cover before it is a statement
 * about the group rather than about some of its pages. */
const GROUP_COVERAGE = 0.7;

function jaccard(a, b) {
  const left = new Set(a);
  const right = new Set(b);
  if (!left.size && !right.size) return 1;
  let shared = 0;
  for (const value of left) if (right.has(value)) shared++;
  return shared / (left.size + right.size - shared);
}

/**
 * Changes that appear to be one edit to one template.
 *
 * Returns proposals, not replacements. Each names the changes it covers, the
 * group it lands on, and how much work it claims to collapse.
 */
export function mergeCandidates(changes = [], siteModel = null) {
  if (!siteModel?.groups?.length || changes.length < 2) return [];

  // Only changes that reach several pages can be template work. A single-page
  // change is a single-page change however similar it looks to another.
  const eligible = changes.filter((c) => (c.urls || []).length >= 2 && c.scope !== 'page');
  const used = new Set();
  const merges = [];
  let sequence = 1;

  for (let i = 0; i < eligible.length; i++) {
    if (used.has(eligible[i].id)) continue;
    const seed = eligible[i];
    const coverage = groupCoverage(siteModel, seed.urls);
    if (!coverage || coverage.coverage < GROUP_COVERAGE) continue;

    const members = [seed];
    for (let j = i + 1; j < eligible.length; j++) {
      const other = eligible[j];
      if (used.has(other.id)) continue;
      if (jaccard(seed.urls, other.urls) < SAME_SET) continue;
      const otherCoverage = groupCoverage(siteModel, other.urls);
      if (!otherCoverage || otherCoverage.group.id !== coverage.group.id) continue;
      members.push(other);
    }
    // One template edit means several different things about one template being
    // wrong, not the same thing being wrong repeatedly. Without this, everything
    // in a shared header merges with everything else in it.
    const causes = new Set(members.map((m) => m.area));
    if (members.length < 2 || causes.size < 2) continue;
    for (const member of members) used.add(member.id);

    const urls = [...new Set(members.flatMap((m) => m.urls))];
    const findings = members.reduce((n, m) => n + Number(m.instances || 0), 0);
    merges.push({
      id: `T${String(sequence++).padStart(2, '0')}`,
      group: {
        id: coverage.group.id,
        label: coverage.group.label,
        kind: coverage.group.kind,
        count: coverage.group.count,
        cohesion: coverage.group.cohesion,
        confidence: coverage.group.confidence
      },
      // What is being claimed, in the terms it can be defended in. Note what is
      // absent: no statement about what these pages are for.
      rootCause: `${members.length} different kinds of change land on the same ${coverage.matched} pages, which are ${coverage.coverage >= 0.99 ? 'all' : `${Math.round(coverage.coverage * 100)}%`} of ${coverage.group.label}. Several separate things being wrong across one page family, where the pages agree at ${Math.round(coverage.group.cohesion * 100)}% on title shape and structure, usually means one template emitting all of them, so this is likely one file opened once rather than ${members.length} pieces of work.`,
      resolves: members.map((m) => m.id),
      resolvesRules: [...new Set(members.map((m) => m.ruleId))],
      causes: [...causes],
      implementation: members.map((m) => ({ id: m.id, location: m.location, action: m.action || '', doneWhen: m.doneWhen })),
      urls,
      pages: urls.length,
      findings,
      // findings resolved per implementation change, which is the number that
      // says whether merging was worth doing at all.
      leverage: findings,
      // The template is a reading of served HTML, never something the crawl
      // saw. It cannot be more certain than the group it rests on.
      confidence: coverage.group.confidence === 'confirmed' ? 'inferred' : 'inconclusive',
      caveat: coverage.group.kind === 'shape'
        ? 'These pages share no path, so the family itself is a measurement rather than something the site states. Confirm they are one template before editing as one.'
        : 'Confirm these pages are emitted by one template before editing as one. The crawl reads served HTML and never sees the code behind it.'
    });
  }
  return merges;
}

/** What the plan would need in order to answer. Named so the interface can
 * offer it and, later, a follow-up check can run it. */
const SETTLED_BY = {
  'canonical-vs-sitemap': 'Decide which URL should be the indexed one, then make the canonical, the sitemap and the internal links all name it.',
  'canonical-vs-links': 'Decide which URL should be the indexed one, then repoint the internal links at it.',
  'redirect-in-sitemap': 'Remove the redirecting URL from the sitemap and list its destination instead.',
  'sitemap-omits-indexable': 'Decide whether these pages should be indexed. If they should, add them to the sitemap; if not, mark them noindex.'
};

/**
 * Where several signals disagree and no single one settles it.
 *
 * Each of these is invisible to every individual scanner by construction: the
 * canonical is correct markup, the sitemap is a valid sitemap, the links resolve.
 * Only holding them together shows the contradiction, and the honest output is
 * the question rather than a recommendation nobody can defend.
 */
export function openQuestions({ pages = [], links = [], sitemapUrls = null, siteOrigin = '', normalizeUrl = null } = {}) {
  // The set was normalised on the way in by the crawl, so membership has to be
  // tested with the same function. A second copy of the rule here disagreed on
  // exactly one URL — the site root, which the crawl keeps as "/" and a naive
  // trailing-slash strip does not — and one silent mismatch is enough to make
  // every question below answer wrongly. The caller owns the definition.
  const normalize = typeof normalizeUrl === 'function' ? normalizeUrl : null;
  // Comparing two URLs that came off the same page needs no shared vocabulary
  // with the crawl, so it has a local fallback. Sitemap membership does need
  // one, which is why only that is gated on the caller supplying it.
  const plainly = (url) => String(url || '').replace(/#.*$/, '').replace(/\/+$/, '');
  const sameUrl = (a, b) => (normalize ? normalize(a) === normalize(b) : plainly(a) === plainly(b));
  const questions = [];
  // No sitemap read is not the same as a sitemap that omits something. Without
  // one, every question below would be asked against an absence and answered
  // wrongly, so none of them are asked at all.
  // Membership also needs the caller's normaliser. Without it the comparison
  // is raw string equality, which reported eleven of twelve pages missing from
  // a sitemap that listed all twelve, differing only by a trailing slash. A
  // check that cannot be made correctly is not made at all.
  const haveSitemap = sitemapUrls instanceof Set && sitemapUrls.size > 0 && Boolean(normalize);

  const fetched = pages.filter((p) => p.status === 'fetched');
  const byUrl = new Map(fetched.map((p) => [p.final_url || p.url, p]));
  const internalTargets = new Map();
  for (const link of links) {
    if (!Number(link.internal)) continue;
    const target = link.normalized_target || link.target_url;
    if (!target) continue;
    internalTargets.set(target, (internalTargets.get(target) || 0) + 1);
  }

  const conflicts = [];
  for (const page of fetched) {
    const url = page.final_url || page.url;
    const canonical = String(page.canonical || '').trim();
    if (!canonical || sameUrl(canonical, url)) continue;
    // The page says another URL should be indexed instead. That is a legitimate
    // thing to say; it becomes a question only when the rest of the site
    // disagrees with it.
    const canonicalInSitemap = haveSitemap && sitemapUrls.has(normalize(canonical));
    const selfInSitemap = haveSitemap && sitemapUrls.has(normalize(url));
    const linksToSelf = internalTargets.get(url) || 0;
    const linksToCanonical = internalTargets.get(canonical) || 0;

    if (haveSitemap && selfInSitemap && !canonicalInSitemap) {
      conflicts.push({ url, canonical, code: 'canonical-vs-sitemap',
        detail: `This page canonicalises to ${canonical}, but the sitemap lists this URL and not that one.` });
    } else if (linksToSelf > linksToCanonical && linksToSelf > 0) {
      conflicts.push({ url, canonical, code: 'canonical-vs-links',
        detail: `This page canonicalises to ${canonical}, but ${linksToSelf} internal link${linksToSelf === 1 ? '' : 's'} point here and ${linksToCanonical} point there.` });
    }
  }

  if (conflicts.length) {
    const code = conflicts[0].code;
    questions.push({
      id: 'Q-canonical',
      question: conflicts.length === 1
        ? 'Which URL is this page meant to be indexed as?'
        : `Which URLs are these ${conflicts.length} pages meant to be indexed as?`,
      why: 'The canonical, the sitemap and the internal links do not agree. Each signal is valid on its own, which is why no single check reports a problem, and search engines resolve the disagreement themselves rather than asking.',
      // Deliberately not a recommendation. Consolidating the wrong way round
      // costs a client rankings on the page they meant to keep.
      blocked: 'Lumen cannot tell which URL was intended without knowing what the site meant to publish.',
      settledBy: SETTLED_BY[code],
      urls: conflicts.slice(0, 25).map((c) => c.url),
      detail: conflicts.slice(0, 5).map((c) => c.detail),
      count: conflicts.length,
      confidence: 'confirmed'
    });
  }

  if (haveSitemap) {
    const missing = fetched.filter((p) => {
      const url = p.final_url || p.url;
      if (Number(p.indexable) !== 1) return false;
      if (sitemapUrls.has(normalize(url))) return false;
      // A page that canonicalises *elsewhere* is meant to be absent, and asking
      // about it would be asking a question the page already answered. A page
      // that canonicalises to itself is the normal case and stays in scope: the
      // first version of this test excluded it and so found nothing on a site
      // where every page self-canonicalises, which is most of them.
      const canonical = String(p.canonical || '').trim();
      return !canonical || sameUrl(canonical, url);
    });
    if (missing.length >= 3) {
      questions.push({
        id: 'Q-sitemap-omission',
        question: `Should these ${missing.length} pages be in the sitemap?`,
        why: 'They were fetched, they are indexable, and they declare no canonical pointing elsewhere, yet the sitemap does not list them. That is either an omission or a deliberate decision, and the markup does not say which.',
        blocked: 'Being absent from a sitemap is not itself a defect, so Lumen will not call it one.',
        settledBy: SETTLED_BY['sitemap-omits-indexable'],
        urls: missing.slice(0, 25).map((p) => p.final_url || p.url),
        count: missing.length,
        confidence: 'confirmed'
      });
    }

    const redirecting = fetched.filter((p) => Number(p.redirected) === 1 && sitemapUrls.has(normalize(p.url)));
    if (redirecting.length) {
      questions.push({
        id: 'Q-sitemap-redirects',
        question: `Why does the sitemap list ${redirecting.length} URL${redirecting.length === 1 ? '' : 's'} that redirect?`,
        why: 'A sitemap is a statement about which URLs should be indexed, and a redirecting URL is by definition not one of them. This is usually a stale sitemap rather than a decision.',
        blocked: 'Whether the destination or the listed URL is the intended one is a decision about the site, not something the crawl observed.',
        settledBy: SETTLED_BY['redirect-in-sitemap'],
        urls: redirecting.slice(0, 25).map((p) => p.url),
        count: redirecting.length,
        confidence: 'confirmed'
      });
    }
  }

  void siteOrigin;
  return questions;
}

/**
 * How much the plan compressed the audit, and how much of that was structural.
 *
 * Reported rather than optimised. Fewer actions is not the goal — the goal is
 * the smallest defensible set — so this exists to be checked against the plan
 * rather than to be maximised, and a compression figure with no merges behind
 * it is just the grouping that was always there.
 */
export function planCompression({ findings = 0, changes = 0, merges = [] } = {}) {
  const mergedAway = merges.reduce((n, m) => n + Math.max(0, m.resolves.length - 1), 0);
  const jobs = Math.max(0, changes - mergedAway);
  return {
    findings,
    changes,
    templateActions: merges.length,
    jobs,
    // Findings per job, which says what the reader gets for opening the plan.
    ratio: jobs ? Number((findings / jobs).toFixed(1)) : 0
  };
}
