/**
 * Lumen priority: the order a consultant should work in.
 *
 * It is a lens over the scanner's own labels, never a replacement for them —
 * nothing here changes a finding's severity, confidence or count. The order is
 * deterministic and explainable in one sentence, which is the whole point: a
 * ranking a client cannot have explained to them is worth less than no
 * ranking at all.
 *
 * The rule, in order:
 *   1. A confirmed availability failure leads. A visitor following a link
 *      reaches a destination that independently returned an error; that is a
 *      break in what the page is supposed to do, not an optimisation warning.
 *   2. Then the scanner's own severity, then how many pages carry it.
 *   3. Anything inconclusive sinks. It has not been established, so it cannot
 *      be the first thing anyone is asked to spend a day on.
 *
 * No discipline is promoted or demoted for being easy to detect. Accessibility
 * findings are cheap and plentiful to collect and would otherwise crowd the
 * top of any list that is not deliberately balanced.
 *
 * Shared so the Site Audit overlay's priority lens and the exported client
 * report put the same thing first. A consultant who has walked a client
 * through the screen cannot then hand them a document that disagrees.
 */

import { disciplineOf } from './disciplines.js';

const SEVERITY_RANK = { critical: 0, high: 1, medium: 2, low: 3, info: 4 };

export function isEstablished(group) {
  return group?.confidence === 'confirmed' || group?.confidence === 'corroborated';
}

/** The scanner's own ordering: severity, then breadth. Used on its own by the
 * discipline sections, and as the second term of the priority sort. */
export function byScannerSeverity(a, b) {
  return (SEVERITY_RANK[a.severity] ?? 9) - (SEVERITY_RANK[b.severity] ?? 9)
    || (b.affected_urls || 0) - (a.affected_urls || 0);
}

export function byLumenPriority(a, b) {
  const lead = (g) => Number(disciplineOf(g.rule_id) === 'availability' && isEstablished(g));
  return lead(b) - lead(a)
    || byScannerSeverity(a, b)
    || Number(a.confidence === 'inconclusive') - Number(b.confidence === 'inconclusive');
}

export function orderByLumenPriority(groups) {
  return [...(groups || [])].sort(byLumenPriority);
}
