import { IMPACT_CLASSES, IMPACT_CLASS_IDS, impactClassFor, materialityScore } from './impact.js';

// The composer turns a flat findings list into a QA brief.
//
// Two problems it solves, both observed in real acceptance testing:
//   1. A scanner that emits many rows (axe) crowds out single high-impact rows
//      (a confirmed navigation 404) purely by volume.
//   2. The same rule failing on six controls reads as six problems when it is
//      one problem with six instances.

export function formatInstanceCountLabel(count) {
  const n = Math.max(1, Number(count) || 1);
  return `${n} ${n === 1 ? 'instance' : 'instances'}`;
}

export function shouldShowHighlightNav(highlightableCount) {
  return Number(highlightableCount || 0) >= 2;
}

function groupKey(finding) {
  // Prefer an explicit root-cause key when correlation metadata is present so
  // five anchors to one dead URL (or LCP + heavy LCP image) collapse to one issue.
  if (finding.rootCauseKey) return String(finding.rootCauseKey);
  const rule = String(finding.ruleId || '').replace(/\.review$/, '');
  // Link findings are grouped per destination, not per rule, because two broken
  // destinations are genuinely two problems.
  if (finding.link?.url) return `dest:${finding.link.url}`;
  return rule;
}

function bestOf(rows) {
  return rows.slice().sort((a, b) => materialityScore(b) - materialityScore(a))[0];
}

function groupTitle(lead, size) {
  if (size < 2) return lead.title;
  const rule = String(lead.ruleId || '');
  if (rule === 'performance.browser.image-oversized' || lead.rootCauseKey === 'images-oversized') {
    return `${size} images are substantially oversized for their display size`;
  }
  if (/blank-opener/.test(rule) || lead.rootCauseKey === 'security.blank-opener') {
    return `${size} links open new tabs without opener protection`;
  }
  if (/color-contrast/.test(rule) || lead.rootCauseKey === 'axe.color-contrast') {
    return `${size} text elements fail color contrast`;
  }
  if (/link-in-text-block/.test(rule) || lead.rootCauseKey === 'axe.link-in-text-block') {
    return `${size} links are not distinguishable from surrounding text`;
  }
  const base = String(lead.title || '').replace(/\s*\(\d+\s+instances?\)\s*$/i, '');
  return `${base} (${formatInstanceCountLabel(size)})`;
}

export function groupFindings(findings = []) {
  const buckets = new Map();
  for (const f of findings) {
    const key = groupKey(f);
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key).push(f);
  }
  const groups = [];
  for (const [key, rows] of buckets) {
    const lead = bestOf(rows);
    const impactClass = impactClassFor(lead);
    groups.push({
      key,
      impactClass,
      lead,
      size: rows.length,
      instances: rows,
      // Instance count reflects grouped rows and per-row occurrence counts, so
      // "6 instances" means six places on the page, not six scanner rows.
      instanceCount: rows.reduce((n, r) => n + Math.max(1, Number(r.count || 1)), 0),
      score: materialityScore(lead),
      title: groupTitle(lead, rows.length),
      selectors: rows.map(r => r.selector).filter(Boolean).slice(0, 12)
    });
  }
  return groups.sort((a, b) => b.score - a.score);
}

// Interleave by class so the brief always reads across disciplines. Within a
// class, order stays score-driven. A class is never padded: if it has nothing
// material, it simply does not appear.
export function composeAttention(findings = [], { limit = 8 } = {}) {
  const material = findings.filter(f => f.frankVisible !== false && f.category !== 'context' && f.confidence !== 'inconclusive');
  const groups = groupFindings(material);
  const byClass = new Map(IMPACT_CLASS_IDS.map(id => [id, []]));
  for (const g of groups) byClass.get(g.impactClass)?.push(g);

  const ordered = [];
  const classOrder = IMPACT_CLASS_IDS
    .filter(id => (byClass.get(id) || []).length)
    .sort((a, b) => {
      const top = list => (byClass.get(list)[0]?.score || 0);
      return (top(b) - top(a)) || (IMPACT_CLASSES[a].order - IMPACT_CLASSES[b].order);
    });

  // Round 1 guarantees every represented class contributes its strongest group
  // before any class contributes a second.
  for (const id of classOrder) ordered.push(byClass.get(id).shift());
  const remaining = groups.filter(g => !ordered.includes(g)).sort((a, b) => b.score - a.score);
  const composed = [...ordered, ...remaining].slice(0, limit);

  const counts = {};
  for (const g of groups) counts[g.impactClass] = (counts[g.impactClass] || 0) + 1;

  return {
    groups: composed,
    allGroups: groups,
    classCounts: counts,
    materialGroupCount: groups.length,
    materialFindingCount: material.length,
    representedClasses: classOrder
  };
}

export { groupKey as attentionGroupKey };

function phrase(group) {
  const title = String(group.title || '').replace(/\s*\(\d+\s+instances?\)$/i, '').toLowerCase();
  if (group.instanceCount > 1) return `${title} across ${group.instanceCount} places`;
  return title;
}

export function composedBrief(composition, { linkAudit = null, coverage = {}, targetIntegrity = null } = {}) {
  const { groups, materialGroupCount, classCounts } = composition;
  const inconclusive = Number(linkAudit?.inconclusive || 0);
  const unavailable = Object.entries(coverage || {}).filter(([, v]) => /unavailable|substituted|blocked|not_applicable/i.test(String(v))).map(([k]) => k);

  const checked = Number(linkAudit?.checked || 0);
  if (targetIntegrity?.state && targetIntegrity.state !== 'reached') {
    const blocked = targetIntegrity.state === 'probable_interstitial'
      ? 'WebQA could not confirm it reached the requested page. The renderer likely received a challenge or security interstitial instead, so page QA conclusions about the target site were withheld.'
      : targetIntegrity.state === 'blocked'
        ? 'WebQA could not reach the requested page because access was blocked. Page QA conclusions about the target site were withheld.'
        : 'WebQA could not confidently confirm the requested page was reached. Treat page QA conclusions as incomplete until target integrity is verified.';
    return blocked;
  }
  if (!groups.length) {
    if (inconclusive) return `No confirmed material issues were found. Link verification stayed inconclusive for ${inconclusive} of ${checked || inconclusive} checked destination${(checked || inconclusive) === 1 ? '' : 's'}, so Frank did not count those URLs as broken links.`;
    if (unavailable.length) return `No confirmed material issues were found in the available coverage. ${unavailable.join(', ')} could not be checked, so treat this as a partial pass.`;
    return 'No confirmed material issues were found in the available coverage. Lower-priority observations are still available under Show all checks.';
  }

  const lead = groups.slice(0, 3).map(phrase);
  const spread = Object.keys(classCounts).length;
  const head = materialGroupCount === 1
    ? 'One issue needs attention'
    : `${materialGroupCount} issues need attention across ${spread} area${spread === 1 ? '' : 's'}`;

  const body = lead.length === 1
    ? `${lead[0]}.`
    : `Start with ${lead[0]}, then ${lead.slice(1).join(', then ')}.`;

  const tail = inconclusive ? ` ${inconclusive} of ${checked || inconclusive} checked link destinations could not be verified and ${inconclusive === 1 ? 'was' : 'were'} not counted as broken.` : '';
  return `${head}. ${body}${tail}`;
}
