/**
 * How the site is built, read from the site.
 *
 * Every other layer in Lumen treats a URL as an independent thing that happened
 * to be fetched. That is the right default for a scanner and the wrong one for a
 * plan: sites are not made of pages, they are made of a handful of templates
 * that emit pages, and the difference between "47 pages have a heading problem"
 * and "one template emits a bad heading" is the difference between forty-seven
 * jobs and one.
 *
 * ## Read, never guessed
 *
 * The temptation here is to name what pages *are*: attorney profiles, practice
 * areas, locations. A model can guess that from a slug and it will be right
 * often enough to be dangerous. Telling a client "your attorney profile
 * template" when it is actually the practice-area template is exactly the class
 * of confident error this product exists not to make.
 *
 * So a group is named by the site's own path segment, verbatim. If the site
 * publishes `/attorneys/jesse-nix`, the group is called `attorneys` because the
 * site says so, not because anything inferred what an attorney is. Where a
 * segment is meaningless the group is described by its shape instead. Nothing
 * here decides what a page is *for*.
 *
 * ## Membership is structural, cohesion is measured
 *
 * Pages group by URL shape, which is a fact. Whether they then look like one
 * template is a separate question with a separate answer: cohesion is measured
 * from signals the crawl recorded — the shape of their titles, the structured
 * data types they publish, and how similar their body sizes are — and reported
 * as a number with the evidence behind it. A group with low cohesion is still a
 * group; it just is not a template, and the plan must not treat it as one.
 *
 * Confidence follows the measurement rather than the intent: `confirmed` for
 * membership, because the URLs demonstrably share a path; `inferred` for the
 * claim that they share a template, because the crawl reads served HTML and
 * cannot see the code that produced it.
 */

const MIN_GROUP = 3;
const TEMPLATE_COHESION = 0.6;

/** Path segments that are routing furniture rather than a page family. A
 * grouping keyed on these describes the CMS, not the site. */
const NOISE_SEGMENTS = new Set(['page', 'p', 'index', 'default', 'home', 'en', 'en-us', 'www', 'amp', 'feed']);

const isNumericish = (segment) => /^\d+$/.test(segment) || /^\d{4}$/.test(segment);

function pathSegments(url) {
  try {
    return new URL(url).pathname.split('/').filter(Boolean).map((s) => decodeURIComponent(s).toLowerCase());
  } catch {
    return [];
  }
}

/**
 * The words a title contributes to a shape.
 *
 * Sites brand their titles with a shared suffix, so `A | Firm` and `B | Firm`
 * share `firm`. That shared remainder is what makes a set of titles look
 * template-generated, and it is measurable without reading meaning into any of
 * them.
 */
function titleShape(title) {
  return new Set(String(title || '')
    .toLowerCase()
    // The separators sites brand their titles with, escaped rather than
    // literal so the copy gate reads this as a character class and not as prose.
    .split(/[|\u2013\u2014:\-\u00B7]+|\s+/)
    .map((w) => w.replace(/[^a-z0-9]/g, ''))
    .filter((w) => w.length >= 3));
}

function jaccard(a, b) {
  if (!a.size && !b.size) return 1;
  let shared = 0;
  for (const value of a) if (b.has(value)) shared++;
  return shared / (a.size + b.size - shared);
}

function median(values) {
  if (!values.length) return 0;
  const sorted = [...values].sort((x, y) => x - y);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function schemaTypes(page) {
  try {
    const parsed = JSON.parse(page.schema_types || '[]');
    return new Set(Array.isArray(parsed) ? parsed.map(String) : []);
  } catch {
    return new Set();
  }
}

/**
 * How alike are these pages, given only what the crawl recorded?
 *
 * Three independent signals, averaged, each of which a template would push
 * towards 1 and a set of unrelated pages towards 0. Averaged rather than
 * required together because a real template fails one of them regularly: a blog
 * archive publishes no structured data, a location page's body length varies
 * with how much the client wrote.
 */
export function cohesionOf(pages) {
  if (pages.length < 2) return { score: 0, signals: {} };

  const titles = pages.map((p) => titleShape(p.title));
  let titlePairs = 0;
  let titleTotal = 0;
  for (let i = 0; i < titles.length; i++) {
    for (let j = i + 1; j < titles.length; j++) {
      titleTotal += jaccard(titles[i], titles[j]);
      titlePairs++;
    }
  }
  const titleScore = titlePairs ? titleTotal / titlePairs : 0;

  const typeSets = pages.map(schemaTypes);
  const anyTypes = typeSets.some((s) => s.size);
  let typeScore = 0;
  if (anyTypes) {
    let pairs = 0;
    let total = 0;
    for (let i = 0; i < typeSets.length; i++) {
      for (let j = i + 1; j < typeSets.length; j++) {
        total += jaccard(typeSets[i], typeSets[j]);
        pairs++;
      }
    }
    typeScore = pairs ? total / pairs : 0;
  }

  // Body length: how tightly the pages cluster around their own median, which
  // is high for generated pages and low for a set of unrelated documents.
  const words = pages.map((p) => Number(p.word_count || 0)).filter((n) => n > 0);
  const mid = median(words);
  const lengthScore = !mid || words.length < 2
    ? 0
    : words.reduce((sum, n) => sum + Math.max(0, 1 - Math.abs(n - mid) / mid), 0) / words.length;

  const parts = [titleScore, lengthScore, ...(anyTypes ? [typeScore] : [])];
  const score = parts.reduce((a, b) => a + b, 0) / parts.length;
  return {
    score: Number(score.toFixed(2)),
    signals: {
      titlePattern: Number(titleScore.toFixed(2)),
      bodyLength: Number(lengthScore.toFixed(2)),
      ...(anyTypes ? { structuredDataTypes: Number(typeScore.toFixed(2)) } : {})
    }
  };
}

/**
 * Pages that look alike but do not live together.
 *
 * Path grouping assumes the site expresses its families in its URLs, and a
 * great many do not: the first real site this was run against publishes every
 * article at the root, so `/what-is-a-plea-in-abeyance/` and
 * `/attorney-jesse-nix-interviewed-by-fox-13/` share nothing but a slash. Path
 * grouping found nothing, correctly, and would have been useless on most of
 * WordPress.
 *
 * So when the URLs say nothing, the pages themselves are asked. Cohesion is
 * already measured pairwise; pages whose similarity clears the bar are linked,
 * and connected components of enough size become groups.
 *
 * These groups carry a weaker claim than path families and say so. Membership
 * in `/attorneys/*` is a fact about the URL. Membership here is a measurement,
 * so it is `inferred` and the plan may not treat it as settled.
 */
const CLUSTER_SIMILARITY = 0.6;

/** Types a CMS emits around every page. They are shared by construction, so
 * they name nothing about a family and must not become its label. */
const STRUCTURAL_TYPES = new Set(['WebPage', 'WebSite', 'BreadcrumbList', 'ListItem', 'ImageObject',
  'SearchAction', 'EntryPoint', 'ReadAction', 'CommentAction', 'PropertyValueSpecification']);

/**
 * Shape clustering compares every candidate with every other, which is fine at
 * a dozen pages and quadratic beyond it: 600 flat pages took 617 ms, and
 * nothing in the crawl config stops an operator raising the page budget and
 * resuming.
 *
 * A ceiling, and nothing cleverer. Bucketing candidates on cheap keys first was
 * tried and removed: it does not help the case that actually costs anything,
 * because one large template is one bucket, and on the first real site it met
 * it split a family of eleven into a six and a three by their body lengths,
 * producing two groups with the same label. A page separated from its family is
 * a worse outcome than a slow one, and the ceiling already prevents the slow
 * one.
 */
const CLUSTER_CEILING = 1200;

/** How alike two pages are, on the same three signals cohesion uses, so a
 * cluster and its reported cohesion cannot disagree about what "alike" means. */
function pairSimilarity(a, b) {
  const title = jaccard(titleShape(a.title), titleShape(b.title));
  const types = jaccard(schemaTypes(a), schemaTypes(b));
  const wa = Number(a.word_count || 0);
  const wb = Number(b.word_count || 0);
  const length = wa && wb ? Math.max(0, 1 - Math.abs(wa - wb) / Math.max(wa, wb)) : 0;
  const anyTypes = schemaTypes(a).size || schemaTypes(b).size;
  const parts = anyTypes ? [title, types, length] : [title, length];
  return parts.reduce((x, y) => x + y, 0) / parts.length;
}

/** The label such a group can honestly carry: what the pages measurably share,
 * never what they are for. There is no path word to quote here, so the shared
 * structured-data types are quoted instead, and failing that the measurement
 * itself is named. */
function clusterLabel(pages) {
  const sets = pages.map(schemaTypes);
  const shared = [...(sets[0] || new Set())].filter((type) => sets.every((s) => s.has(type)));
  const meaningful = shared.filter((t) => !STRUCTURAL_TYPES.has(t));
  if (meaningful.length) {
    return {
      label: `Pages publishing ${meaningful.slice(0, 2).join(' and ')}`,
      basisWord: `every page publishes ${meaningful.slice(0, 2).join(' and ')}`
    };
  }
  return { label: 'Pages with a matching shape', basisWord: 'their titles and body lengths match' };
}

function shapeClusters(candidates, minGroup) {
  if (candidates.length < minGroup) return { groups: [], clustered: new Set() };
  // Beyond the ceiling the comparison is not attempted at all rather than run
  // slowly: an unbounded quadratic in the request path is a worse failure than
  // a site model that says it did not look.
  if (candidates.length > CLUSTER_CEILING) return { groups: [], clustered: new Set(), skipped: candidates.length };
  // Connected components over the similarity graph. Union-find rather than a
  // full clustering algorithm: the question is only "does this page belong with
  // that one", and a transitive answer is the right one for a template.
  const parent = candidates.map((_, i) => i);
  const find = (i) => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  for (let i = 0; i < candidates.length; i++) {
    for (let j = i + 1; j < candidates.length; j++) {
      if (pairSimilarity(candidates[i].page, candidates[j].page) >= CLUSTER_SIMILARITY) {
        parent[find(i)] = find(j);
      }
    }
  }
  const byRoot = new Map();
  candidates.forEach((member, i) => {
    const root = find(i);
    if (!byRoot.has(root)) byRoot.set(root, []);
    byRoot.get(root).push(member);
  });

  const groups = [];
  const clustered = new Set();
  let n = 1;
  for (const members of byRoot.values()) {
    if (members.length < minGroup) continue;
    const pages = members.map((m) => m.page);
    const cohesion = cohesionOf(pages);
    const { label, basisWord } = clusterLabel(pages);
    groups.push({
      id: `shape-${n++}`,
      segment: '',
      label,
      kind: 'shape',
      urls: members.map((m) => m.url),
      count: members.length,
      cohesion: cohesion.score,
      cohesionSignals: cohesion.signals,
      probableTemplate: cohesion.score >= TEMPLATE_COHESION,
      // Unlike a path family, nothing about the site states this membership.
      // It is measured, so it is inferred, and it never hardens.
      confidence: 'inferred',
      templateConfidence: cohesion.score >= TEMPLATE_COHESION ? 'inferred' : 'inconclusive',
      basis: `${members.length} pages sit at unrelated addresses but ${basisWord}, agreeing at ${Math.round(cohesion.score * 100)}%. Their URLs say nothing about a shared family, so this is a reading of the pages rather than of the site's structure.`
    });
    for (const member of members) clustered.add(member.url);
  }
  return { groups, clustered };
}

/**
 * The site's page groups.
 *
 * Grouping key is the first meaningful path segment, which is how nearly every
 * CMS on the web expresses a page family. Two deliberate exclusions: the site
 * root is its own group of one because a home page is never a template
 * instance, and numeric or paginated segments are skipped so `/blog/2024/x` and
 * `/blog/2025/y` land together under `blog` rather than splitting by year.
 */
export function buildSiteModel(pages = [], { minGroup = MIN_GROUP } = {}) {
  const fetched = pages.filter((p) => (p.status || 'fetched') === 'fetched');
  const byKey = new Map();
  const singles = [];

  for (const page of fetched) {
    const url = page.final_url || page.url;
    const segments = pathSegments(url).filter((s) => !NOISE_SEGMENTS.has(s) && !isNumericish(s));
    if (!segments.length) {
      singles.push({ url, page, reason: 'site root' });
      continue;
    }
    // A one-segment page is a section landing page, not a member of the family
    // beneath it: /attorneys and /attorneys/jesse-nix are different jobs.
    const key = segments.length === 1 ? `${segments[0]}::landing` : segments[0];
    if (!byKey.has(key)) byKey.set(key, []);
    byKey.get(key).push({ url, page });
  }

  const groups = [];
  for (const [key, members] of byKey) {
    const [segment, kind] = key.split('::');
    if (members.length < minGroup) {
      for (const member of members) singles.push({ ...member, reason: `only ${members.length} page${members.length === 1 ? '' : 's'} under /${segment}/` });
      continue;
    }
    const cohesion = cohesionOf(members.map((m) => m.page));
    const template = cohesion.score >= TEMPLATE_COHESION;
    groups.push({
      id: key.replace(/[^a-z0-9]+/g, '-'),
      // The site's own word for this family, quoted rather than interpreted.
      // Lumen does not decide what an "attorney" is; the site published the
      // path and this repeats it.
      segment,
      label: kind === 'landing' ? `/${segment}` : `/${segment}/*`,
      kind: kind === 'landing' ? 'section' : 'family',
      urls: members.map((m) => m.url),
      count: members.length,
      cohesion: cohesion.score,
      cohesionSignals: cohesion.signals,
      // Membership is a fact about the URLs. Sharing a template is a reading of
      // served HTML, and the crawl never sees the code that produced it.
      probableTemplate: template,
      confidence: 'confirmed',
      templateConfidence: template ? 'inferred' : 'inconclusive',
      basis: `${members.length} fetched pages share the path /${segment}/, and their titles, body lengths${cohesion.signals.structuredDataTypes === undefined ? '' : ' and structured-data types'} agree at ${Math.round(cohesion.score * 100)}%.`
    });
  }

  // Whatever the URLs could not explain, the pages get a chance to.
  // The site root never joins a shape cluster. A home page shares a title
  // suffix and a schema block with everything else on the site, so it lands in
  // whatever cluster forms and quietly adds itself to a template it is not an
  // instance of. Path grouping already excludes it for the same reason.
  const { groups: shaped, clustered, skipped } = shapeClusters(
    singles.filter((s) => s.page && s.reason !== 'site root'), minGroup);
  groups.push(...shaped);
  const remaining = singles.filter((s) => !clustered.has(s.url));

  groups.sort((a, b) => b.count - a.count || String(a.segment).localeCompare(String(b.segment)));
  return {
    groups,
    // Named rather than silently dropped: a plan that says "these 12 pages are
    // in no group" is more useful than one that pretends every page belongs
    // somewhere.
    ungrouped: remaining.map((s) => ({ url: s.url, reason: s.reason })),
    pagesConsidered: fetched.length,
    grouped: groups.reduce((n, g) => n + g.count, 0),
    // A check that was not run is not the same as a check that found nothing,
    // and on a large flat site the two would otherwise render identically as
    // "no structure found". Stated so the reader knows which they are reading.
    shapeSearchSkipped: skipped ? { candidates: skipped, ceiling: CLUSTER_CEILING } : null
  };
}

/** The group a URL belongs to, for attaching findings to structure. */
export function groupForUrl(model, url) {
  return (model?.groups || []).find((g) => g.urls.includes(url)) || null;
}

/**
 * Which group, if any, does this set of URLs land in?
 *
 * `coverage` is the share of the group the URLs cover, and it is the number
 * that decides whether something is a template problem: a rule firing on 7 of 7
 * pages in a family is a statement about the family, and the same rule on 2 of
 * 47 is a statement about two pages.
 */
export function groupCoverage(model, urls = []) {
  const unique = [...new Set(urls)];
  let best = null;
  for (const group of model?.groups || []) {
    const inGroup = unique.filter((u) => group.urls.includes(u));
    if (!inGroup.length) continue;
    const coverage = inGroup.length / group.count;
    // A set that is mostly outside the group says nothing about the group.
    const share = inGroup.length / unique.length;
    if (share < 0.8) continue;
    if (!best || coverage > best.coverage) best = { group, matched: inGroup.length, coverage: Number(coverage.toFixed(2)) };
  }
  return best;
}
