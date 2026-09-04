(() => {
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
function allowedNumbers(envelope) {
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
function briefEnvelope(brief, counts = {}) {
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
const BRIEF_PHRASING_RULES = [
  'Rewrite only the wording. The order of the areas, their severity, their confidence and every count are already decided and must not change.',
  'Return every area id you were given, once each, in the order you were given them.',
  'Use only numbers that appear in the evidence you were given. Do not compute new totals, percentages or comparisons.',
  'Do not use the words confirmed, corroborated, inferred or inconclusive about an area unless that is the confidence recorded for it.',
  'Do not include any URL, domain, file path or code.',
  'Do not claim one area caused another. You have no evidence of causation.',
  'Write for a professional auditing a client site: specific, plain, and free of filler.'
];

/**
 * The gate between a language model and the Lumen brief.
 *
 * A model may phrase the brief. It may not decide it. Everything that
 * constitutes a claim — which disciplines appear, their order, their severity,
 * their confidence, and every count — is composed deterministically and is
 * merged back over the response here, so a model that tries to change one of
 * those is not corrected, it is rejected.
 *
 * The rules in BRIEF_PHRASING_RULES and the checks below are one to one on
 * purpose. A constraint that is asked for in the prompt and not verified here
 * is a promise the product makes to itself and never keeps.
 *
 * The most dangerous failure this closes is not a clumsy sentence. It is a
 * confident invented number: "affects 40 pages" reads exactly as trustworthy
 * as "affects 32 pages", and only one of them came from the crawl.
 */


const CONFIDENCE_WORDS = ['confirmed', 'corroborated', 'inferred', 'inconclusive'];

/** Boilerplate a model reaches for when it has nothing to say. Guidance that
 * says "review and fix as appropriate" is worse than the deterministic
 * sentence it would replace, because it costs a model call to say less. */
const FILLER = /\b(as appropriate|as necessary|review the (?:issue|evidence)|take action|best practice[s]? dictate|it is important to|make necessary changes|address these issues)\b/i;

function fail(code, message) {
  return { ok: false, code, message };
}

function textOf(candidate) {
  const parts = [String(candidate?.summary || '')];
  for (const area of candidate?.areas || []) {
    parts.push(String(area?.action || ''), String(area?.rationale || ''));
  }
  return parts.join(' \n ');
}

/**
 * @param {object} candidate  the model's parsed JSON response
 * @param {object} envelope   briefEnvelope() output the model was given
 */
function validateBriefPhrasing(candidate, envelope) {
  if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) {
    return fail('BRIEF_AI_INVALID_JSON', 'The model did not return a brief object.');
  }
  const expected = envelope?.areas || [];
  const areas = Array.isArray(candidate.areas) ? candidate.areas : null;
  if (!areas) return fail('BRIEF_AI_INVALID_JSON', 'The model returned no areas.');

  // The ranking is the product's claim. A response that drops, adds or
  // reorders an area is rejected rather than reconciled — reconciling it would
  // mean guessing which of the two orders the model meant.
  if (areas.length !== expected.length) {
    return fail('BRIEF_AI_AREA_MISMATCH', `The model returned ${areas.length} areas for ${expected.length}.`);
  }
  for (let i = 0; i < expected.length; i++) {
    if (String(areas[i]?.id || '') !== expected[i].id) {
      return fail('BRIEF_AI_AREA_MISMATCH', 'The model changed the order or identity of the ranked areas.');
    }
  }

  const summary = String(candidate.summary || '').trim();
  if (summary.length < 40) return fail('BRIEF_AI_THIN', 'The model summary was too short to be worth showing.');
  for (const area of areas) {
    if (String(area?.action || '').trim().length < 8) return fail('BRIEF_AI_THIN', 'An area headline was too short.');
    if (String(area?.rationale || '').trim().length < 25) return fail('BRIEF_AI_THIN', 'An area rationale was too short.');
  }

  const text = textOf(candidate);

  if (/https?:\/\/|www\.|\b[a-z0-9-]+\.(?:com|org|net|io|law|co|dev)\b/i.test(text)) {
    return fail('BRIEF_AI_URL', 'The model introduced a URL or domain; the brief is given none, so any is invented.');
  }
  if (FILLER.test(text)) {
    return fail('BRIEF_AI_FILLER', 'The model returned generic filler in place of the deterministic wording.');
  }

  // Every figure must have come from the evidence. This is the check that
  // stops a plausible, confident, wrong number reaching a client.
  const permitted = allowedNumbers(envelope);
  for (const match of text.matchAll(/\d[\d,]*/g)) {
    const value = Number(String(match[0]).replace(/,/g, ''));
    if (!Number.isFinite(value)) continue;
    if (!permitted.has(value)) {
      return fail('BRIEF_AI_INVENTED_NUMBER', `The model used the figure ${match[0]}, which is not in the evidence it was given.`);
    }
  }

  // A confidence word may only be used about an area that actually carries it.
  // Saying "confirmed" of inferred evidence is the single most expensive lie
  // this product can tell, and it is one token away at all times.
  for (let i = 0; i < areas.length; i++) {
    const said = `${areas[i]?.action || ''} ${areas[i]?.rationale || ''}`.toLowerCase();
    for (const word of CONFIDENCE_WORDS) {
      if (said.includes(word) && expected[i].confidence !== word) {
        return fail('BRIEF_AI_CONFIDENCE', `The model called ${expected[i].id} "${word}" when the scanners recorded "${expected[i].confidence}".`);
      }
    }
  }
  const summaryLower = summary.toLowerCase();
  for (const word of CONFIDENCE_WORDS) {
    if (summaryLower.includes(word) && !expected.some((a) => a.confidence === word)) {
      return fail('BRIEF_AI_CONFIDENCE', `The model summary claims "${word}" evidence that no ranked area carries.`);
    }
  }

  return { ok: true, code: '', message: '' };
}

/**
 * Merge accepted phrasing back over the deterministic brief.
 *
 * Structurally identical to what mergeLocalFrankGuidance does for
 * walkthroughs: the deterministic object is spread, and the response may only
 * land in the fields that hold words. Order, counts, severity, confidence and
 * membership all come from `brief`, so even a response that somehow passed
 * validation cannot move them.
 */
function mergeBriefPhrasing(brief, candidate) {
  const byId = new Map((candidate?.areas || []).map((a) => [String(a?.id || ''), a]));
  return {
    ...brief,
    summary: String(candidate?.summary || brief?.summary || '').trim() || brief?.summary,
    guidanceSource: 'model',
    groups: (brief?.groups || []).map((group) => {
      const said = byId.get(String(group.area || ''));
      if (!said) return group;
      return {
        ...group,
        title: String(said.action || '').trim() || group.title,
        modelRationale: String(said.rationale || '').trim() || ''
      };
    })
  };
}

globalThis.LumenBriefPhrasing = { briefEnvelope, allowedNumbers, BRIEF_PHRASING_RULES, validateBriefPhrasing, mergeBriefPhrasing };
})();
