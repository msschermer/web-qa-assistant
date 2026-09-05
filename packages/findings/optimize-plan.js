/**
 * Optimize: scanner evidence, what the site appears to be, and the coverage of
 * both, turned into a sequenced plan.
 *
 * Three things this file is careful about, because each is a way a "prioritised
 * recommendations" screen normally starts lying:
 *
 * 1. **The order is a dependency sequence, not a severity ranking.** Group 1
 *    comes first because everything measured later is measured on pages that
 *    have to resolve — not because a broken link outranks everything else in
 *    importance. A confirmed high-severity finding in group 4 is not less
 *    serious than a low-severity one in group 1; it simply has nothing waiting
 *    on it. The screen says so, because a reader who mistakes a sequence for a
 *    ranking will deprioritise the wrong work.
 *
 * 2. **Nothing here invents a finding.** Every action names the rules behind
 *    it, how many findings and pages those cover, and the weakest confidence
 *    among them. An action with no findings behind it is not emitted — there is
 *    no template of generic SEO advice waiting to fill a quiet plan.
 *
 * 3. **Coverage travels with the plan.** A plan built from 40 of 193 pages is a
 *    plan about 40 pages, and every priority carries that limit rather than
 *    letting the reader assume the crawl saw everything.
 *
 * Like `priority.js`, this is a lens over the scanner's labels and never a
 * replacement for them: no severity, confidence or count is changed here.
 */

import { disciplineOf, disciplineLabel } from './disciplines.js';
import { buildChanges, summariseChanges, AREA_RATIONALE, byPriority, bestPriority, comparePriority } from './optimize-changes.js';
import { draftableField } from './change-drafts.js';
import { buildSiteModel, groupCoverage } from './site-model.js';
import { mergeCandidates, openQuestions, planCompression } from './plan-reasoning.js';

const SEVERITY_RANK = { critical: 0, high: 1, medium: 2, low: 3, info: 4 };
const CONFIDENCE_RANK = { confirmed: 0, corroborated: 1, inferred: 2, inconclusive: 3 };

/**
 * Technical causes: what you change, rather than what the scanner called it.
 *
 * This is the axis that turns hundreds of findings into a day's work. Twenty
 * broken links across ten pages is one job — go and fix the hrefs — while a
 * missing title and a missing description are two edits in the same template.
 * Grouping by discipline cannot say that; grouping by remediation locus can.
 *
 * First match wins, and the last entry catches everything, so no finding is
 * dropped on the way into the plan.
 */
export const CAUSE_RULES = [
  ['link-targets', 'Link targets', 'The hrefs a page publishes, and whether their destinations resolve.',
    [/^navigation\.link-/, /^navigation\.fragment-missing/, /^ux\.inert-link/]],
  ['crawl-reachability', 'Crawl reachability', 'Whether a page can be reached and followed at all.',
    [/^structure\.orphan-page/, /^navigation\.redirect-chain-long/, /^seo\.soft-404/]],
  ['indexing-directives', 'Indexing directives', 'Canonicals, robots directives and the signals that decide what gets indexed.',
    [/^seo\.(canonical|noindex|robots)/, /^web\.meta-refresh/]],
  ['sitemaps', 'Sitemaps', 'What the site declares about itself to crawlers.', [/^seo\.sitemap-/]],
  ['entity-markup', 'Entity markup', 'Structured data: the machine-readable description of what each page is.',
    [/^schema\./]],
  ['page-metadata', 'Page metadata', 'Titles and descriptions, usually emitted by one template.',
    [/^seo\.(title|description|duplicate)/, /^social\./]],
  ['link-text', 'Link text and on-page copy', 'The words a page uses, including the text its links are given.', [/^content\./]],
  ['document-structure', 'Document structure', 'Headings and the outline a page presents.',
    [/^structure\.(h1-|heading-skip|duplicate-h1)/]],
  ['media', 'Media', 'Images and their alternatives.', [/^structure\.image-alt-missing/, /^performance\.image/]],
  ['accessibility-implementation', 'Accessibility implementation', 'Markup and interaction faults measured in a real browser.',
    [/^(axe|a11y)\./, /^ux\./]],
  ['delivery-performance', 'Delivery and performance', 'How fast and how heavily the page is served.', [/^performance\./]],
  ['transport-security', 'Transport and security headers', 'Headers and transport settings served with every response.',
    [/^security\./]],
  ['runtime-errors', 'Runtime errors', 'Failures that only appear once the page is running.',
    [/^runtime\./]],
  ['international', 'International signals', 'Language and regional targeting.', [/^seo\.hreflang-/, /^a11y\.lang-/]],
  ['other-quality', 'Other web quality', 'Everything else the scanners recorded.', [/./]]
];

/** The remediation category a cause names, for the surfaces that show one. */
export function causeLabel(cause) {
  const found = CAUSE_RULES.find(([id]) => id === cause);
  return found ? found[1] : 'Other web quality';
}

export function causeOf(ruleId) {
  const id = String(ruleId || '');
  for (const [cause, , , patterns] of CAUSE_RULES) {
    if (patterns.some((re) => re.test(id))) return cause;
  }
  return 'other-quality';
}

const CAUSE_META = new Map(CAUSE_RULES.map(([id, label, description]) => [id, { label, description }]));

/**
 * The dependency sequence.
 *
 * Each group states what it unblocks, which is the only defensible reason to
 * put one body of work before another. `causes` is the set this group owns;
 * anything not claimed by a group lands in the last one so the plan cannot
 * silently drop work.
 */
export const PRIORITY_GROUPS = [
  {
    id: 'integrity',
    title: 'Resolve crawl and link integrity',
    summary: 'Fix broken targets, unreachable pages and redirect problems.',
    unblocks: 'Everything after this is measured on pages that resolve. A page that returns an error cannot be indexed, ranked or assessed, so work done on it is spent twice.',
    causes: ['link-targets', 'crawl-reachability', 'runtime-errors']
  },
  {
    id: 'signals',
    title: 'Correct indexing and canonical signals',
    summary: 'Make the site legible to crawlers: directives, canonicals, sitemaps and entity identity.',
    unblocks: 'A page that resolves but tells crawlers not to index it, or claims to be another page, cannot benefit from any content work done on it afterwards.',
    causes: ['indexing-directives', 'sitemaps', 'entity-markup']
  },
  {
    id: 'templates',
    title: 'Fix shared templates at source',
    summary: 'Metadata, structure, media and headers that one template emits across many pages.',
    unblocks: 'These are the fixes that multiply: one edit changes every page carrying the template, so doing them before per-page work avoids repeating the same edit by hand.',
    causes: ['page-metadata', 'document-structure', 'link-text', 'media', 'transport-security', 'international']
  },
  {
    id: 'page-level',
    title: 'Complete page-level quality and accessibility',
    summary: 'The remaining findings that belong to individual pages rather than to a shared template.',
    unblocks: 'Nothing depends on these, which is why they are sequenced last. Being last in a dependency order is not being least important: a confirmed high-severity fault here outranks a low-severity one above it, and the severity mix on each group says so.',
    causes: ['accessibility-implementation', 'delivery-performance', 'other-quality']
  }
];

const GROUP_FOR_CAUSE = new Map();
for (const group of PRIORITY_GROUPS) for (const cause of group.causes) GROUP_FOR_CAUSE.set(cause, group.id);

const worst = (rows, key, ranks) => rows.reduce((acc, row) => {
  const rank = ranks[row[key]] ?? 9;
  return rank < acc.rank ? { rank, value: row[key] } : acc;
}, { rank: 9, value: null }).value;

const weakest = (rows, key, ranks) => rows.reduce((acc, row) => {
  const rank = ranks[row[key]] ?? -1;
  return rank > acc.rank ? { rank, value: row[key] } : acc;
}, { rank: -1, value: null }).value;

/**
 * What the site appears to be, from evidence rather than from a guess.
 *
 * The structured data the crawl now parses is the strongest signal available:
 * a site publishing LegalService on twelve pages is telling us what it is in
 * machine-readable form. Where that evidence is absent the model is reported as
 * not established — an audit that guesses the client's industry and gets it
 * wrong has spent its credibility on a decoration.
 */
const VERTICAL_BY_TYPE = [
  [['LegalService', 'Attorney'], 'Legal practice'],
  [['Dentist'], 'Dental practice'],
  [['Physician', 'MedicalBusiness', 'MedicalClinic'], 'Medical practice'],
  [['Restaurant', 'CafeOrCoffeeShop', 'Bakery'], 'Food service'],
  [['Store', 'OnlineStore', 'ClothingStore'], 'Retail'],
  [['RealEstateAgent'], 'Real estate'],
  [['FinancialService', 'AccountingService', 'InsuranceAgency'], 'Financial services'],
  [['Plumber', 'Electrician', 'RoofingContractor', 'GeneralContractor', 'HVACBusiness', 'HomeAndConstructionBusiness'], 'Home services'],
  [['ProfessionalService'], 'Professional services'],
  [['JobPosting'], 'Recruitment'],
  [['Course', 'EducationalOrganization'], 'Education'],
  [['NewsArticle'], 'Publishing'],
  [['Product', 'Offer'], 'Ecommerce']
];

/**
 * What the operator knows that the crawl cannot.
 *
 * Two inputs, and only two, because each one demonstrably changes the plan. A
 * field that is collected and then does not move anything is fake configuration
 * dressed as thoroughness, and this product does not ship those.
 *
 *   siteType        The crawl reads the vertical from published structured data
 *                   and often cannot — an Organization node names no industry.
 *                   The operator can simply say. It changes the site model and
 *                   the wording, and never a finding.
 *   templateAccess  Whether shared templates can be edited this cycle. If they
 *                   cannot, sequencing template work before per-page work is
 *                   advice the operator cannot act on, so the order changes and
 *                   the plan says the change came from them.
 *
 * Anything set here is labelled as stated by the operator wherever it appears.
 * It is not evidence, it does not carry a scanner confidence, and it can never
 * create, remove or re-rate a finding.
 */
export const PLAN_INPUT_FIELDS = Object.freeze({
  siteType: Object.freeze(['', 'Legal practice', 'Medical practice', 'Dental practice', 'Home services',
    'Professional services', 'Financial services', 'Real estate', 'Retail', 'Ecommerce', 'Food service',
    'Education', 'Publishing', 'Recruitment', 'Other']),
  templateAccess: Object.freeze(['', 'open', 'blocked'])
});

export function normalizePlanInputs(raw = {}) {
  const siteType = PLAN_INPUT_FIELDS.siteType.includes(String(raw.siteType || '')) ? String(raw.siteType || '') : '';
  const templateAccess = PLAN_INPUT_FIELDS.templateAccess.includes(String(raw.templateAccess || '')) ? String(raw.templateAccess || '') : '';
  return { siteType, templateAccess };
}

export function inferSiteModel(schema) {
  const types = new Map((schema?.types || []).map((t) => [t.type, t]));
  if (!types.size) {
    return {
      established: false,
      label: 'Not established',
      confidence: 'inconclusive',
      basis: 'No structured data was parsed, so the site does not describe itself in a form this crawl can read. Nothing here infers an industry from page text.',
      evidence: []
    };
  }
  for (const [candidates, label] of VERTICAL_BY_TYPE) {
    const hit = candidates.filter((type) => types.has(type));
    if (!hit.length) continue;
    const evidence = hit.map((type) => ({ type, pages: types.get(type).pages, items: types.get(type).items }));
    const pages = evidence.reduce((n, e) => n + e.pages, 0);
    return {
      established: true,
      label,
      // Corroborated rather than confirmed: the markup is confirmed, but that
      // this markup means the site *is* that kind of business is a reading of
      // it. The distinction is the difference between evidence and conclusion.
      confidence: 'corroborated',
      basis: `Read from the site's own structured data: ${evidence.map((e) => `${e.type} on ${e.pages} page${e.pages === 1 ? '' : 's'}`).join(', ')}. This is what the site publishes about itself, not an inference from its wording. Confirm it before using it in client-facing work.`,
      evidence,
      pages
    };
  }
  const top = [...types.values()].sort((a, b) => b.pages - a.pages)[0];
  return {
    established: false,
    label: 'Not established',
    confidence: 'inferred',
    basis: `Structured data is present, and ${top.type} is the most widespread type, but none of it names a business category this plan recognises. The site model is left unset rather than guessed.`,
    evidence: [{ type: top.type, pages: top.pages, items: top.items }]
  };
}

/**
 * The plan.
 *
 * `groups` are the rule-level finding groups the audit already produces; the
 * plan never reaches past them into individual findings, so its counts and the
 * Findings section's counts cannot disagree.
 */
/**
 * Attach what a drafted replacement needs, to the changes that can have one.
 *
 * Two things, neither of which a change carries on its own: the page's own
 * facts, which is what a draft has to be grounded in, and the values other
 * pages hold for the same field, which is what a duplication has to differ
 * from. Only draftable changes are decorated, because this is page text and it
 * has no business travelling with rows that will never send it anywhere.
 */
const DRAFT_FIELD_COLUMN = { title: 'title', description: 'meta_description', h1: 'h1_text' };

function decorateDraftable(changes, pages) {
  const rows = [...(pages instanceof Map ? pages.values() : [])];
  for (const change of changes) {
    const spec = draftableField(change.ruleId);
    if (!spec) continue;
    const url = change.urls?.[0] || '';
    const page = pages instanceof Map ? pages.get(url) : null;
    if (page) {
      change.page = {
        title: page.title || '',
        h1_text: page.h1_text || '',
        meta_description: page.meta_description || '',
        word_count: Number(page.word_count || 0)
      };
    }
    const column = DRAFT_FIELD_COLUMN[spec.field];
    if (!column) continue;
    const own = new Set(change.urls || []);
    change.siblings = [...new Set(rows
      .filter((row) => !own.has(row.final_url || row.url))
      .map((row) => String(row[column] || '').trim())
      .filter(Boolean))].slice(0, 12);
  }
}

export function buildOptimizePlan({ groups = [], findings = [], pages = new Map(), urlCounts = {}, renderProgress = {}, schema = null, siteOrigin = '', inputs: rawInputs = {}, pageRows = [], links = [], sitemapUrls = null, normalizeUrl = null } = {}) {
  const inputs = normalizePlanInputs(rawInputs);
  const discovered = Object.values(urlCounts).reduce((n, v) => n + Number(v || 0), 0);
  const fetched = Number(urlCounts.fetched || 0);
  const uncrawled = Math.max(0, discovered - fetched);
  const renderedPages = Number(renderProgress.rendered || 0);
  const renderTotal = Number(renderProgress.total || 0);

  const limits = [];
  if (uncrawled > 0) {
    limits.push({
      code: 'pages-uncrawled',
      text: `Anything wrong on the ${uncrawled} page${uncrawled === 1 ? '' : 's'} the crawl never fetched is absent from this sequence.`
    });
  }
  if (renderTotal > 0 && renderedPages === 0) {
    limits.push({
      code: 'browser-checks-unrun',
      text: 'Browser checks have not run, so this plan carries no accessibility, JavaScript or performance evidence. Those are absent from it, not clear.'
    });
  } else if (renderTotal > 0 && renderedPages < renderTotal) {
    limits.push({
      code: 'browser-checks-partial',
      text: `Browser checks have run on ${renderedPages} of ${renderTotal} pages, so accessibility, JavaScript and performance evidence covers part of the site.`
    });
  }
  if (!schema || !(schema.types || []).length) {
    limits.push({
      code: 'schema-absent',
      text: 'No structured data was parsed, so entity work in this plan rests on nothing the crawl could read.'
    });
  }

  // Informational observations are facts about the site, not work. Recording
  // that a site uses GA4 is worth knowing and is not something anyone is asked
  // to do; letting it become "Priority 3 — work through the remaining findings"
  // fills a plan with a job that does not exist. They are excluded from the
  // actions and counted where the reader can see the exclusion, because a plan
  // that silently drops rows is one whose totals nobody can reconcile.
  const informational = groups.filter((g) => String(g.severity || '') === 'info' && String(g.category || '') !== 'fix');
  const actionable = groups.filter((g) => !informational.includes(g));

  // Cluster by technical cause.
  const byCause = new Map();
  for (const group of actionable) {
    const cause = causeOf(group.rule_id);
    if (!byCause.has(cause)) {
      byCause.set(cause, {
        id: cause,
        label: CAUSE_META.get(cause)?.label || 'Other web quality',
        description: CAUSE_META.get(cause)?.description || '',
        rules: [],
        findings: 0,
        pages: 0,
        disciplines: new Set()
      });
    }
    const entry = byCause.get(cause);
    entry.rules.push(group);
    entry.findings += Number(group.instances || 0);
    entry.pages = Math.max(entry.pages, Number(group.affected_urls || 0));
    entry.disciplines.add(disciplineLabel(disciplineOf(group.rule_id)));
  }

  const clusters = [...byCause.values()].map((entry) => ({
    id: entry.id,
    label: entry.label,
    description: entry.description,
    findings: entry.findings,
    pages: entry.pages,
    rules: entry.rules.map((r) => r.rule_id),
    severity: worst(entry.rules, 'severity', SEVERITY_RANK),
    confidence: weakest(entry.rules, 'confidence', CONFIDENCE_RANK),
    disciplines: [...entry.disciplines]
  })).sort((a, b) => (SEVERITY_RANK[a.severity] ?? 9) - (SEVERITY_RANK[b.severity] ?? 9) || b.findings - a.findings);

  // The work itself, as changes rather than as findings. Scope decides whether
  // a rule that fired on eight pages is one template edit or eight page edits,
  // which is the difference between a plan a client can read and a number that
  // frightens them.
  const changes = buildChanges({ findings, groups: actionable, pages, fetchedPages: fetched });
  decorateDraftable(changes, pages);

  // How the site is built, read from the site. Everything below this line that
  // reasons about templates rather than pages depends on it.
  const rows = pageRows.length ? pageRows : [...pages.values()];
  const siteStructure = buildSiteModel(rows);
  for (const change of changes) {
    const landing = groupCoverage(siteStructure, change.urls || []);
    if (landing) {
      change.pageGroup = { id: landing.group.id, label: landing.group.label, coverage: landing.coverage, confidence: landing.group.confidence };
    }
  }
  // Several different things wrong across one page family is usually one file
  // opened once. Proposals only: they name the changes they cover and never
  // replace them, so the plan still reconciles against Findings.
  const templateActions = mergeCandidates(changes, siteStructure);
  // And where the signals disagree, the useful output is the question.
  const questions = openQuestions({ pages: rows, links, sitemapUrls, siteOrigin, normalizeUrl });
  const changesByArea = new Map();
  for (const change of changes) {
    if (!changesByArea.has(change.area)) changesByArea.set(change.area, []);
    changesByArea.get(change.area).push(change);
  }

  // Sequence the clusters into dependency groups. An action is one cluster's
  // worth of work, and carries the evidence that justifies it.
  const priorities = [];
  for (const group of PRIORITY_GROUPS) {
    const owned = clusters.filter((c) => GROUP_FOR_CAUSE.get(c.id) === group.id);
    if (!owned.length) continue;
    const actions = owned.map((cluster) => {
      const rules = cluster.rules;
      const detail = byCause.get(cluster.id).rules;
      const areaChanges = (changesByArea.get(cluster.id) || []).slice().sort(byPriority);
      return {
        id: cluster.id,
        title: actionTitle(cluster),
        detail: cluster.description,
        // Why this area matters to the client, in consequences rather than in
        // the scanner's words. This is the column a non-technical reader reads.
        rationale: AREA_RATIONALE[cluster.id] || '',
        // The changes this area asks for, each one a job with a location, the
        // value it holds now, and what done looks like.
        changes: areaChanges,
        changeCount: areaChanges.length,
        // Traceability: the rules, the counts and the weakest confidence among
        // them. Everything a reader needs to go and check this themselves.
        evidence: {
          ruleIds: rules,
          findings: cluster.findings,
          pages: cluster.pages,
          severity: cluster.severity,
          confidence: cluster.confidence,
          titles: detail.map((d) => ({ ruleId: d.rule_id, title: d.title, severity: d.severity, confidence: d.confidence, instances: d.instances, pages: d.affected_urls }))
        },
        verify: 'Re-run the audit and confirm these rules report no remaining findings on the pages listed.'
      };
    });
    // Areas inside a phase are ordered by the most urgent work they hold. The
    // sequence between phases is a dependency order and stays exactly as it is;
    // within one, the order the causes happen to be declared in says nothing, and
    // it was putting a confirmed blocker below a low.
    actions.sort((x, y) => comparePriority(bestPriority(x.changes), bestPriority(y.changes)) || y.changeCount - x.changeCount);
    const groupFindings = actions.reduce((n, a) => n + a.evidence.findings, 0);
    const groupChanges = actions.reduce((n, a) => n + a.changeCount, 0);
    priorities.push({
      order: priorities.length + 1,
      id: group.id,
      title: group.title,
      summary: group.summary,
      unblocks: group.unblocks,
      actions,
      findings: groupFindings,
      changes: groupChanges,
      severity: worst(owned, 'severity', SEVERITY_RANK),
      confidence: weakest(owned, 'confidence', CONFIDENCE_RANK),
      disciplines: [...new Set(owned.flatMap((c) => c.disciplines))]
    });
  }

  // Template work sequenced ahead of per-page work is only good advice if the
  // templates can be edited. When the operator says they cannot, the order
  // changes and the plan attributes the change to them rather than to evidence.
  if (inputs.templateAccess === 'blocked') {
    const templates = priorities.find((p) => p.id === 'templates');
    if (templates) {
      priorities.splice(priorities.indexOf(templates), 1);
      priorities.push(templates);
      templates.deferred = true;
      templates.unblocks = 'Moved to the end because you told Lumen the shared templates cannot be edited this cycle. Nothing in the evidence moved it: these are still the fixes that multiply, and they return to their place above the per-page work as soon as the templates are editable.';
      priorities.forEach((p, i) => { p.order = i + 1; });
    }
  }

  return {
    siteOrigin,
    inputs,
    coverage: { discovered, fetched, uncrawled, renderedPages, renderTotal, limits },
    clusters,
    priorities,
    // How many jobs the findings actually collapse into. This is the number a
    // plan is scoped and scheduled against, and it is not the findings count.
    changeSummary: summariseChanges(changes),
    siteStructure,
    templateActions,
    openQuestions: questions,
    compression: planCompression({
      findings: summariseChanges(changes).findings,
      changes: changes.length,
      merges: templateActions
    }),
    siteModel: resolveSiteModel(schema, inputs),
    // Off-site research is not connected. Saying so is the honest answer; a
    // plan that quietly omits the row implies it was considered.
    research: {
      connected: false,
      note: 'No off-site research source is connected, so this plan makes no claim about competitors, search demand, rankings or traffic. Everything in it comes from this crawl.'
    },
    // Every finding is accounted for: the ones the plan sequences, and the ones
    // it deliberately does not, with the reason. A reader can add these back up
    // to the Findings section's total.
    informational: {
      patterns: informational.length,
      findings: informational.reduce((n, g) => n + Number(g.instances || 0), 0),
      rules: informational.map((g) => g.rule_id),
      note: 'Informational observations are recorded in Findings and are not sequenced here, because they describe the site rather than ask for a change.'
    },
    totals: {
      findings: groups.reduce((n, g) => n + Number(g.instances || 0), 0),
      patterns: groups.length,
      actionableFindings: actionable.reduce((n, g) => n + Number(g.instances || 0), 0),
      actionablePatterns: actionable.length,
      clusters: clusters.length,
      priorityGroups: priorities.length
    }
  };
}

/**
 * The operator's answer, or the crawl's reading of the markup.
 *
 * A stated site type carries no scanner confidence, because it is not a
 * measurement — the closed confidence vocabulary describes evidence, and
 * borrowing one of its words for something a person typed would be the exact
 * conflation this product refuses everywhere else. It is labelled as stated
 * instead, and the crawl's own reading is kept alongside it so a reader can see
 * where the two agree.
 */
export function resolveSiteModel(schema, inputs = {}) {
  const read = inferSiteModel(schema);
  if (!inputs.siteType) return read;
  return {
    established: true,
    stated: true,
    label: inputs.siteType,
    confidence: null,
    basis: read.established
      ? `Stated by you. The crawl independently read ${read.label.toLowerCase()} from this site's published structured data, so the two agree.`
      : `Stated by you. The crawl could not read a business category from this site's structured data, so nothing corroborates this. It is your statement, recorded as such.`,
    evidence: read.evidence || [],
    readFromMarkup: read.established ? read.label : null
  };
}

/** The action's name is the work, phrased as the thing to do. */
function actionTitle(cluster) {
  const titles = {
    'link-targets': 'Repair or redirect broken link targets',
    'crawl-reachability': 'Make unreachable pages reachable',
    'runtime-errors': 'Clear runtime errors',
    'indexing-directives': 'Correct indexing and canonical directives',
    sitemaps: 'Fix what the sitemap declares',
    'entity-markup': 'Resolve structured-data faults and entity identity',
    'page-metadata': 'Correct titles and descriptions in the template',
    'link-text': 'Rewrite uninformative link text',
    'document-structure': 'Fix the heading outline',
    media: 'Give images usable alternatives',
    'transport-security': 'Set the missing security headers',
    international: 'Correct language and regional signals',
    'accessibility-implementation': 'Fix the accessibility faults measured in the browser',
    'delivery-performance': 'Address delivery and performance',
    'other-quality': 'Work through the remaining web-quality findings'
  };
  return titles[cluster.id] || `Address ${cluster.label.toLowerCase()}`;
}
