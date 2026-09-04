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

import { allowedNumbers } from './brief-envelope.js';

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
export function validateBriefPhrasing(candidate, envelope) {
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
export function mergeBriefPhrasing(brief, candidate) {
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
