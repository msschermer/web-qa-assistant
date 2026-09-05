/**
 * Changes: the unit of work a plan is actually executed in.
 *
 * A findings table answers "what is wrong". A work plan answers "what do we
 * change, where exactly, what does it say now, and how will we know it is
 * done". Those are different documents, and the gap between them is where an
 * audit stops being useful — the reader has to do the translation themselves,
 * every time, for every finding.
 *
 * The single most important thing this file computes is **scope**. Twenty-seven
 * pages missing a meta description is not twenty-seven jobs; it is one template
 * that does not emit one. The same twenty-seven findings on twenty-seven
 * unrelated pages is twenty-seven jobs. Nothing in a findings count separates
 * those two cases, and a plan that gets it wrong either terrifies the client
 * with a number or hides a day of work behind a single line.
 *
 * Everything here is derived from evidence the crawl recorded. A change never
 * invents a location, never invents the current value, and never claims a fix
 * has an outcome it cannot verify. Where a field is unknown it is absent rather
 * than filled — an empty cell in a plan is honest, and a plausible guess in one
 * is what gets a consultant caught in front of a client.
 */

import { disciplineOf, disciplineLabel } from './disciplines.js';
import { causeOf, causeLabel } from './optimize-plan.js';

/**
 * Where a change is made. Not the page — the thing on the page you edit.
 *
 * This is the "Location" column of a real tracker, and it is the difference
 * between "fix the title" and "the <title> tag". First match wins.
 */
const CHANGE_LOCATION = [
  [/^seo\.title/, 'The <title> tag'],
  [/^seo\.description/, 'The <meta name="description"> tag'],
  [/^seo\.canonical/, 'The <link rel="canonical"> tag'],
  [/^seo\.(noindex|robots)/, 'The robots directive (meta tag or X-Robots-Tag header)'],
  [/^seo\.hreflang/, 'The hreflang annotations in <head>'],
  [/^seo\.sitemap/, 'The XML sitemap and its robots.txt declaration'],
  [/^schema\./, 'The JSON-LD block in <head>'],
  [/^structure\.duplicate-h1/, 'The page H1'],
  [/^structure\.h1-/, 'The page H1'],
  [/^structure\.heading-skip/, 'The heading outline (H1–H6 order)'],
  [/^structure\.image-alt-missing/, 'The <img> elements without an alt attribute'],
  [/^structure\.orphan-page/, 'Internal links on other pages that should point here'],
  [/^navigation\.link-/, 'The link href and its destination'],
  [/^navigation\.fragment-missing/, 'The in-page link and the id it targets'],
  [/^navigation\.redirect-chain/, 'The redirect rule'],
  [/^content\.generic-link-text/, 'The link anchor text'],
  [/^content\./, 'The page copy'],
  [/^security\./, 'The response headers'],
  [/^performance\./, 'The asset or template the measurement names'],
  [/^(axe|a11y)\./, 'The markup the rule names, measured in a real browser'],
  [/^runtime\./, 'The script raising the error'],
  [/^ux\./, 'The control the finding names'],
  [/^analytics\./, 'The tag configuration']
];

export function changeLocation(ruleId) {
  const id = String(ruleId || '');
  for (const [pattern, label] of CHANGE_LOCATION) if (pattern.test(id)) return label;
  return 'The affected page';
}

/**
 * What "done" looks like, in terms someone can check without this tool.
 *
 * A verification step that only says "re-run the audit" makes the audit the
 * authority on its own work. These name the observable instead, so a developer
 * can close the ticket and a client can see it closed.
 */
const DONE_WHEN = [
  [/^seo\.title/, 'The page returns a unique title of about 60 characters that names the page, and no other crawled page uses it.'],
  [/^seo\.description/, 'View source shows a meta description on every affected page.'],
  [/^seo\.canonical/, 'Each page declares a self-referencing canonical, or one that points at the version that should be indexed.'],
  [/^seo\.(noindex|robots)/, 'Only the pages that should be excluded carry a noindex directive.'],
  [/^schema\.identity-conflict/, 'One entity id for the whole site, and Google’s Rich Results Test shows a single entity per page with no conflicting types.'],
  [/^schema\./, 'Google’s Rich Results Test and the schema.org validator both parse the block with no errors.'],
  [/^structure\.duplicate-h1/, 'Each page carries an H1 that describes only that page.'],
  [/^structure\.heading-skip/, 'The outline runs H1 → H2 → H3 with no level skipped.'],
  [/^structure\.image-alt-missing/, 'Every content image has an alt attribute; decorative images carry alt="".'],
  [/^structure\.orphan-page/, 'At least one other page on the site links to this page in its body content.'],
  [/^navigation\.link-404/, 'The link resolves to a working page, or has been removed, or the destination 301-redirects to a live URL.'],
  [/^navigation\.link-/, 'The destination returns a successful response to an independent request.'],
  [/^navigation\.fragment-missing/, 'The target id exists on the destination page, or the fragment is removed from the link.'],
  [/^content\.generic-link-text/, 'The anchor text describes the destination when read on its own, out of the surrounding sentence.'],
  [/^security\./, 'The response header is present on a fresh request to the affected pages.'],
  [/^performance\./, 'The measurement is re-taken and lands inside the threshold the finding names.'],
  [/^(axe|a11y)\./, 'The rule reports no violations when the page is re-checked in the browser pass.']
];

export function doneWhen(ruleId) {
  const id = String(ruleId || '');
  for (const [pattern, text] of DONE_WHEN) if (pattern.test(id)) return text;
  return 'The rule reports no remaining findings on the affected pages when the audit is re-run.';
}

/**
 * Why an area of work matters, in the client's terms rather than the scanner's.
 *
 * The tracker this is modelled on carries a "why it matters to the firm" column
 * beside every area, and it is the column a non-technical reader actually
 * reads. These are consequences, not restatements of the finding.
 */
export const AREA_RATIONALE = {
  'link-targets': 'A link that leads nowhere spends a visitor’s intent and a crawler’s budget on a dead end, and any authority the linking page could have passed on is lost at the break.',
  'crawl-reachability': 'A page nothing links to is a page search engines are slow to find and quick to forget, however good it is.',
  'indexing-directives': 'These signals decide which version of a page gets indexed. When they disagree, search engines pick for you, and they do not always pick the page you built for the job.',
  sitemaps: 'The sitemap is what the site says about itself to a crawler. When it disagrees with the site, the crawler trusts neither.',
  'entity-markup': 'Structured data is how the site tells search engines and AI assistants who it is. When a site describes itself two ways, engines guess which is right.',
  'page-metadata': 'The title and description are the advert for the page in the results. They are usually emitted by one template, so one edit changes every page carrying it.',
  'link-text': 'Anchor text is the description a link carries into the ranking system, and the only description a screen-reader user hears out of context.',
  'document-structure': 'The heading outline is how both readers and machines work out what a page is about and which parts answer which question.',
  media: 'An image with no alternative is invisible to a screen reader and to an image search, and it is the most common accessibility failure on a content site.',
  'transport-security': 'These headers are set once at the server and apply to every response. They are among the few improvements entirely inside the site owner’s control.',
  international: 'Language and regional annotations decide which version of a page is served to which audience.',
  'accessibility-implementation': 'These are the faults a real user of assistive technology meets, measured in a browser rather than inferred from markup.',
  'delivery-performance': 'How fast the page is served affects both what a visitor does and how the page is assessed.',
  'runtime-errors': 'An error thrown while the page runs can break the part of the page a visitor came for, without breaking the part a static crawl can see.',
  'other-quality': 'Recorded by the scanners and not yet grouped into one of the areas above.'
};

const SITEWIDE_SHARE = 0.8;
const TEMPLATE_MIN_PAGES = 3;

/**
 * Scope, from evidence: is this one fix or many?
 *
 * The share is taken against pages the crawl actually fetched, never against
 * pages it discovered — a finding on 8 of 10 fetched pages is a template
 * problem whether or not the crawl stopped at 10 of 193.
 */
export function classifyScope(pageCount, fetchedPages) {
  const fetched = Math.max(1, Number(fetchedPages || 0));
  const pages = Number(pageCount || 0);
  if (pages >= TEMPLATE_MIN_PAGES && pages / fetched >= SITEWIDE_SHARE) {
    return { scope: 'sitewide', label: 'Sitewide', effort: 'One change, applied once' };
  }
  if (pages >= TEMPLATE_MIN_PAGES) {
    return { scope: 'template', label: 'Shared template', effort: 'One change if these pages share a template' };
  }
  return { scope: 'page', label: pages === 1 ? 'Single page' : `${pages} pages`, effort: pages === 1 ? 'One page' : `${pages} separate edits` };
}

/** The quoted value a finding's own sentence carries, where it carries one.
 * The crawl writes the observed string into detail for exactly the rules where
 * a reader needs to see it — the title it measured, the H1 it found repeated,
 * the anchor text on the broken link. */
function quotedFrom(detail) {
  const match = String(detail || '').match(/[“"]([^”"]{2,200})[”"]/);
  return match ? match[1] : '';
}

/** What the page says now, preferred from the stored page row and falling back
 * to the finding's own sentence. Absent rather than guessed. */
function currentValue(ruleId, finding, page) {
  const id = String(ruleId || '');
  if (/^seo\.title/.test(id)) return page?.title || quotedFrom(finding.detail);
  if (/^seo\.description/.test(id)) return page?.meta_description || '';
  if (/^seo\.canonical/.test(id)) return page?.canonical || '';
  if (/^structure\.(duplicate-h1|h1-)/.test(id)) return page?.h1_text || quotedFrom(finding.detail);
  if (/^navigation\.link-/.test(id)) {
    let link = null;
    try { link = JSON.parse(finding.evidence_json || '{}').link; } catch { link = null; }
    if (link?.url) {
      const anchor = quotedFrom(finding.detail);
      return `${anchor ? `"${anchor}" → ` : ''}${link.url}${link.status ? ` (HTTP ${link.status})` : ''}`;
    }
  }
  return quotedFrom(finding.detail);
}

/**
 * What is being edited, where a rule can fire more than once for different
 * things on the same page.
 *
 * Scope alone is not enough for link rules. Three pages carrying a dead link is
 * one change when all three point at the same dead URL — it is one href in a
 * shared nav — and three changes when they point at three different ones.
 * Counting pages cannot tell those apart; the destination can. Rules with no
 * such subject return one key, which leaves them grouped exactly as before.
 */
function changeSubject(ruleId, finding) {
  const id = String(ruleId || '');
  // A duplicated value is one problem, not one per page that carries it: the
  // job is to tell those pages apart, and it is done once. Rendered per page it
  // also produced adjacent rows showing the same string, which reads as a bug.
  if (/^(structure\.duplicate-h1|seo\.duplicate-title|seo\.duplicate-description)/.test(id)) {
    return quotedFrom(finding.detail);
  }
  if (!/^(navigation\.|ux\.inert-link|content\.generic-link-text)/.test(id)) return '';
  try {
    const link = JSON.parse(finding.evidence_json || '{}').link;
    if (link?.url) return String(link.url);
  } catch { /* a row without parseable evidence groups with its rule */ }
  return '';
}

/**
 * Why a change has no current value.
 *
 * "Not present" and "not recorded" are different claims. The first is the
 * finding itself — the tag is missing, which is why there is work to do. The
 * second is a limit of what the crawl captured. Printing one word for both
 * makes the plan look like it failed to read the page.
 */
function absenceNote(ruleId) {
  return /(-missing|^structure\.orphan-page)/.test(String(ruleId || '')) ? 'not present' : 'value not recorded';
}

/**
 * Remediation priority, which is not scanner severity.
 *
 * Severity says how bad the thing found is. Priority says how soon it should be
 * done, and those come apart constantly: a medium-severity title pattern on
 * every page of the site outranks a high-severity fault on one page nobody can
 * reach, and a confirmed indexing blocker outranks both because everything else
 * is measured on pages that can be indexed.
 *
 * Ordering by severity alone was the "arbitrary severity sort" this replaces.
 * Every input below is a fact already established from evidence, and the reason
 * is carried on the change so the plan can say why an action sits where it does
 * rather than asserting an order.
 */
/** Causes whose faults decide whether a page is indexed at all. Deliberately
 * narrow. An orphan page is a real discoverability problem and an unreachable
 * sitemap entry is a real contradiction, but neither stops a page being indexed
 * the way a stray noindex or a canonical pointing elsewhere does, and calling
 * everything a blocker is how the word stops meaning anything. */
const BLOCKING_CAUSES = new Set(['indexing-directives']);

/** A change that reaches every page is a different proposition from the same
 * change on one page, whatever the scanner made of the individual instance. */
const LEVERAGED = new Set(['sitewide', 'template']);

export const PRIORITY_LABEL = { blocker: 'Blocker', high: 'High', medium: 'Medium', low: 'Low' };

const BASE_BAND = { critical: 'high', high: 'high', medium: 'medium', low: 'low', info: 'low' };
const ORDER = ['blocker', 'high', 'medium', 'low'];
const promote = (band) => ORDER[Math.max(1, ORDER.indexOf(band) - 1)];
const demote = (band) => ORDER[Math.min(ORDER.length - 1, ORDER.indexOf(band) + 1)];

/**
 * Remediation priority, which is not scanner severity.
 *
 * Severity says how bad the thing found is. Priority says how soon it should be
 * done, and the two come apart constantly: a medium-severity title pattern on
 * every page outranks a high-severity fault on one page nobody reaches, and a
 * confirmed indexing blocker outranks both because the rest is measured on
 * pages that can be indexed.
 *
 * Expressed as a base the evidence sets plus the two adjustments that actually
 * change what a person would do first, rather than a ladder of special cases,
 * because the reason has to travel with the answer. The plan states why an
 * action sits where it does, and a rule nobody can restate in one sentence
 * cannot be defended to a client.
 */
export function changePriority(change) {
  const severity = String(change.severity || 'info');
  const confirmed = String(change.confidence || '') === 'confirmed';
  const leverage = LEVERAGED.has(change.scope) && Number(change.pages || 0) >= 3;

  if (BLOCKING_CAUSES.has(change.area) && confirmed) {
    return { band: 'blocker', reason: 'Confirmed, and it decides whether these pages are indexed at all. Everything else is measured on pages that survive it.' };
  }

  let band = BASE_BAND[severity] || 'low';
  const because = [];
  if (!confirmed) {
    band = demote(band);
    because.push('the evidence is inferred rather than confirmed');
  }
  // The adjustment a severity sort cannot see: the same edit, made once,
  // landing on every page that carries it.
  if (leverage && confirmed) {
    band = promote(band);
    because.push(`one edit resolves it on all ${change.pages} pages carrying it`);
  }

  const opening = {
    high: 'Near the front of the queue',
    medium: 'Worth doing, with nothing downstream waiting on it',
    low: 'A genuine improvement that changes least for the effort'
  }[band] || 'In the queue';
  const severityWord = severity === 'info' ? 'informational' : severity;
  const evidence = `the scanner recorded it as ${severityWord} and ${confirmed ? 'confirmed' : String(change.confidence || 'inferred')}`;
  return { band, reason: `${opening}: ${[evidence, ...because].join(', and ')}.` };
}

/** Plan order within a phase: the sequence between phases is a dependency
 * order and stays untouched, but inside one there is no reason to show a low
 * before a blocker. */
export function byPriority(a, b) {
  return ORDER.indexOf(a.priority) - ORDER.indexOf(b.priority)
    || (b.pages || 0) - (a.pages || 0);
}

/** The most urgent thing in a group, so a phase can order its areas by the work
 * inside them rather than by the order the causes happen to be declared in. */
export function bestPriority(changes = []) {
  return changes.reduce((best, c) => (ORDER.indexOf(c.priority) < ORDER.indexOf(best) ? c.priority : best), 'low');
}

export function comparePriority(a, b) {
  return ORDER.indexOf(a) - ORDER.indexOf(b);
}

/**
 * Build the changes.
 *
 * `findings` are the per-URL rows, `groups` the rule-level rollup, `pages` the
 * stored page rows keyed by URL. A sitewide or template finding becomes one
 * change covering its pages; a page-scoped finding becomes one change per page.
 * That split is the whole point — it is what turns a findings count into a
 * number of jobs.
 */
export function buildChanges({ findings = [], groups = [], pages = new Map(), fetchedPages = 0 } = {}) {
  const byRule = new Map();
  for (const finding of findings) {
    if (!byRule.has(finding.rule_id)) byRule.set(finding.rule_id, []);
    byRule.get(finding.rule_id).push(finding);
  }

  const changes = [];
  let sequence = 1;
  const ordered = [...groups].sort((a, b) => {
    const sev = { critical: 0, high: 1, medium: 2, low: 3, info: 4 };
    return (sev[a.severity] ?? 9) - (sev[b.severity] ?? 9) || (b.affected_urls || 0) - (a.affected_urls || 0);
  });

  for (const group of ordered) {
    const allRows = byRule.get(group.rule_id) || [];
    if (!allRows.length) continue;
    // Split by what is being edited before measuring how far it reaches, so a
    // single shared href is one job and three unrelated hrefs are three.
    const subjects = new Map();
    for (const row of allRows) {
      const key = changeSubject(group.rule_id, row);
      if (!subjects.has(key)) subjects.set(key, []);
      subjects.get(key).push(row);
    }
    for (const [subject, subjectRows] of subjects) emit(group, subjectRows, Boolean(subject));
  }

  function emit(group, rows, shared) {
    const urls = [...new Set(rows.map((r) => r.url))];
    const scope = classifyScope(urls.length, fetchedPages);
    // Rows that grouped because they share one subject are one job however few
    // pages carry it. Splitting them per page would undo the grouping and put
    // the same value on two adjacent rows, which is what the split is for
    // avoiding in the first place.
    if (shared && scope.scope === 'page' && urls.length > 1) {
      scope.effort = `One change, in up to ${urls.length} places`;
    }
    const cause = causeOf(group.rule_id);
    const base = {
      ruleId: group.rule_id,
      area: cause,
      areaLabel: disciplineLabel(disciplineOf(group.rule_id)),
      title: group.title || group.rule_id,
      severity: group.severity || 'info',
      confidence: group.confidence || 'inferred',
      location: changeLocation(group.rule_id),
      absence: absenceNote(group.rule_id),
      // The remediation taxonomy, not the scanner's own subsystem: what kind of
      // work this is, in the words someone scheduling it would use.
      category: causeLabel(cause),
      action: group.guidance || '',
      doneWhen: doneWhen(group.rule_id),
      scope: scope.scope,
      scopeLabel: scope.label,
      effort: scope.effort
    };

    if (!shared && scope.scope === 'page') {
      // One change per page: these are separate edits and a plan that pretends
      // otherwise under-counts the work.
      for (const url of urls) {
        const row = rows.find((r) => r.url === url) || {};
        changes.push({
          ...base,
          // The rule may span several pages; this change is one of them, and the
          // label has to describe the change rather than the rule.
          scopeLabel: 'Single page',
          effort: 'One page',
          id: `C${String(sequence++).padStart(2, '0')}`,
          urls: [url],
          pages: 1,
          instances: rows.filter((r) => r.url === url).length,
          detail: row.detail || '',
          current: currentValue(group.rule_id, row, pages.get(url))
        });
      }
      return;
    }

    // One change for the template or the whole site. The pages are carried so
    // the reader can still see exactly where it lands.
    const sample = rows[0] || {};
    changes.push({
      ...base,
      id: `C${String(sequence++).padStart(2, '0')}`,
      urls,
      pages: urls.length,
      instances: rows.length,
      detail: sample.detail || '',
      current: currentValue(group.rule_id, sample, pages.get(sample.url)),
      // True only where the value could differ page to page. Rows that grouped
      // because they share one subject carry the same value by construction.
      currentIsSample: !shared
    });
  }

  for (const change of changes) {
    const { band, reason } = changePriority(change);
    change.priority = band;
    change.priorityLabel = PRIORITY_LABEL[band];
    change.priorityReason = reason;
  }
  return changes;
}

/** What the plan is asking for, counted the way a plan is counted. */
export function summariseChanges(changes) {
  const byScope = { sitewide: 0, template: 0, page: 0 };
  for (const change of changes) byScope[change.scope] = (byScope[change.scope] || 0) + 1;
  return {
    total: changes.length,
    ...byScope,
    // The claim that makes the plan worth reading: this many findings collapse
    // into this many jobs.
    findings: changes.reduce((n, c) => n + Number(c.instances || 0), 0)
  };
}
