/**
 * The Lumen brief, reduced to the only thing a language model may be shown.
 *
 * The brief is the one place in the product that says "start here". That
 * ranking is composed deterministically — which disciplines appear, in what
 * order, with what severity, confidence and counts — and a model must never be
 * in a position to change it. What a model *can* usefully do is say it better
 * than a lookup table of fixed phrases can.
 *
 * So this builds the skeleton and the facts behind it, and nothing else. It is
 * the sanitisation boundary for brief-level reasoning, the same role
 * packages/ai/evidence-contract.js plays for per-finding walkthroughs:
 *
 *   - No URLs. The brief never needs one, so none is offered, and the
 *     validator can then reject any URL that appears in a response as
 *     invented by construction.
 *   - No page titles, markup, anchor text, selectors or evidence strings.
 *     Those carry client content; a discipline label and a count do not.
 *   - No host. The brief describes what is wrong, not whose site it is.
 *
 * What survives is rule ids, discipline labels, severity and confidence words
 * from closed vocabularies, and integers. That is enough to write a sentence
 * about, and not enough to leak anything.
 */

/** Every number a response is allowed to contain. A figure outside this set
 * was invented, and `validateBriefPhrasing` rejects the response for it. */
export function allowedNumbers(envelope) {
  const numbers = new Set();
  const add = (n) => { if (Number.isFinite(n)) numbers.add(Math.trunc(n)); };
  add(envelope?.scope?.fetched);
  add(envelope?.scope?.discovered);
  add(envelope?.scope?.neverFetched);
  add(envelope?.totalInstances);
  add((envelope?.areas || []).length);
  for (const area of envelope?.areas || []) {
    add(area.pages);
    add(area.leadPages);
    add(area.instances);
    add(area.ruleCount);
  }
  // Ordinals for "first", "second" and so on, and the trivially safe zero/one.
  for (const n of [0, 1, 2, 3, 4]) numbers.add(n);
  return numbers;
}

/**
 * @param {object} brief   composeLumenBrief() output — the deterministic skeleton
 * @param {object} counts  the audit's urlCounts
 */
export function briefEnvelope(brief, counts = {}) {
  const fetched = Number(counts.fetched || 0);
  const discovered = Object.values(counts).reduce((sum, n) => sum + Number(n || 0), 0);
  const areas = (brief?.groups || []).map((group, index) => ({
    // The id is the contract: a response must return these ids, in this order.
    // That is what stops a model reordering the ranking by reordering its
    // answer, and it is checked rather than trusted.
    id: String(group.area || ''),
    rank: index + 1,
    label: String(group.label || group.area || ''),
    deterministicAction: String(group.title || ''),
    severity: String(group.severity || 'info'),
    confidence: String(group.lead?.confidence || (group.leadConfirmed ? 'confirmed' : 'inferred')),
    leadRule: String(group.lead?.rule_id || ''),
    sitewide: Boolean(group.sitewide),
    journeyFailure: Boolean(group.journeyFailure),
    pages: Number(group.pages || 0),
    leadPages: Number(group.leadPages || 0),
    instances: Number(group.instances || 0),
    ruleCount: Array.isArray(group.rules) ? group.rules.length : 0
  }));

  return {
    scope: {
      fetched,
      discovered,
      neverFetched: Math.max(0, discovered - fetched),
      partial: discovered > fetched
    },
    totalInstances: Number(brief?.totalInstances || 0),
    deterministicSummary: String(brief?.summary || ''),
    areas
  };
}

/**
 * The instruction the model is held to.
 *
 * Written as data rather than prose in a call site so the validator, the
 * tests and the prompt cannot drift apart: every constraint stated here has a
 * corresponding check in `validateBriefPhrasing`, and a constraint that cannot
 * be checked does not belong here — it would be a promise the product makes
 * to itself and never verifies.
 */
export const BRIEF_PHRASING_RULES = [
  'Rewrite only the wording. The order of the areas, their severity, their confidence and every count are already decided and must not change.',
  'Return every area id you were given, once each, in the order you were given them.',
  'Use only numbers that appear in the evidence you were given. Do not compute new totals, percentages or comparisons.',
  'Do not use the words confirmed, corroborated, inferred or inconclusive about an area unless that is the confidence recorded for it.',
  'Do not include any URL, domain, file path or code.',
  'Do not claim one area caused another. You have no evidence of causation.',
  'Write for a professional auditing a client site: specific, plain, and free of filler.'
];
