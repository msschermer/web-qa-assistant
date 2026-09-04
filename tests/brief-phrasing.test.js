import test from 'node:test';
import assert from 'node:assert/strict';
import { briefEnvelope, allowedNumbers, BRIEF_PHRASING_RULES } from '../packages/findings/brief-envelope.js';
import { validateBriefPhrasing, mergeBriefPhrasing } from '../packages/findings/brief-phrasing.js';

/** The deterministic brief composeLumenBrief() produces, in miniature. */
function brief() {
  return {
    summary: 'Start with the destinations that fail for a visitor.',
    totalInstances: 343,
    fetched: 40,
    groups: [
      {
        area: 'availability', label: 'Availability', title: 'Repair confirmed broken destinations',
        severity: 'high', leadConfirmed: true, journeyFailure: true, sitewide: false,
        pages: 2, leadPages: 2, instances: 2, rules: [{}],
        lead: { rule_id: 'navigation.link-404-external', confidence: 'confirmed' }
      },
      {
        area: 'security', label: 'Security', title: 'Add the missing response headers consistently',
        severity: 'medium', leadConfirmed: true, journeyFailure: false, sitewide: true,
        pages: 40, leadPages: 40, instances: 120, rules: [{}, {}],
        lead: { rule_id: 'security.hsts-missing', confidence: 'confirmed' }
      },
      {
        area: 'content', label: 'Content', title: 'Restore the on-page signals missing across the site',
        severity: 'medium', leadConfirmed: false, journeyFailure: false, sitewide: false,
        pages: 32, leadPages: 32, instances: 64, rules: [{}],
        lead: { rule_id: 'seo.description-missing', confidence: 'inferred' }
      }
    ]
  };
}
const counts = () => ({ fetched: 40, queued: 74 });

/** A response that respects every rule. */
function goodCandidate() {
  return {
    summary: 'Two destinations fail outright for a visitor, so they come before anything cosmetic. The header gap repeats on every page analysed, which makes it one change rather than many.',
    areas: [
      { id: 'availability', action: 'Repair the two dead destinations', rationale: 'A visitor following these links reaches an error, and the scanners reached that error themselves.' },
      { id: 'security', action: 'Set the missing response headers site-wide', rationale: 'The same header is absent on all 40 pages analysed, so one deployment change closes it everywhere.' },
      { id: 'content', action: 'Restore the missing on-page descriptions', rationale: 'Read from the page markup rather than a rendered browser, so treat it as a strong signal rather than a settled fact.' }
    ]
  };
}

// --- the envelope is the sanitisation boundary ------------------------------

test('the envelope carries counts and labels but never client content', () => {
  const env = briefEnvelope(brief(), counts());
  const serialized = JSON.stringify(env);
  assert.doesNotMatch(serialized, /https?:\/\//, 'no URLs may reach the model');
  assert.doesNotMatch(serialized, /moran|example\.com/i, 'no host may reach the model');
  assert.equal(env.scope.fetched, 40);
  assert.equal(env.scope.discovered, 114);
  assert.equal(env.scope.neverFetched, 74);
  assert.equal(env.areas.length, 3);
  assert.deepEqual(env.areas.map((a) => a.id), ['availability', 'security', 'content']);
  // Rank is explicit so the ordering is data the model is told, not a
  // convention it has to infer from array position alone.
  assert.deepEqual(env.areas.map((a) => a.rank), [1, 2, 3]);
  assert.equal(env.areas[2].confidence, 'inferred', 'the lead rule decides the confidence, not the group');
});

test('every rule stated to the model has a check behind it', () => {
  // The prompt and the validator drift apart the moment a rule is added to one
  // and not the other, and the drift is invisible until a bad brief ships.
  assert.ok(BRIEF_PHRASING_RULES.length >= 6);
  const rules = BRIEF_PHRASING_RULES.join(' ').toLowerCase();
  for (const promised of ['order', 'numbers', 'confirmed', 'url']) {
    assert.ok(rules.includes(promised), `the prompt should state the ${promised} rule`);
  }
});

// --- the validator, against output that is wrong in each way ----------------

test('a well-formed response is accepted', () => {
  const result = validateBriefPhrasing(goodCandidate(), briefEnvelope(brief(), counts()));
  assert.equal(result.ok, true, result.message);
});

test('a response that reorders the ranking is rejected, not reconciled', () => {
  const env = briefEnvelope(brief(), counts());
  const candidate = goodCandidate();
  [candidate.areas[0], candidate.areas[1]] = [candidate.areas[1], candidate.areas[0]];
  const result = validateBriefPhrasing(candidate, env);
  assert.equal(result.ok, false);
  assert.equal(result.code, 'BRIEF_AI_AREA_MISMATCH');
});

test('a response that drops or invents an area is rejected', () => {
  const env = briefEnvelope(brief(), counts());
  const short = goodCandidate(); short.areas.pop();
  assert.equal(validateBriefPhrasing(short, env).code, 'BRIEF_AI_AREA_MISMATCH');
  const extra = goodCandidate();
  extra.areas.push({ id: 'performance', action: 'Speed the site up', rationale: 'It felt slow when I read about it.' });
  assert.equal(validateBriefPhrasing(extra, env).code, 'BRIEF_AI_AREA_MISMATCH');
});

test('an invented number is rejected — the failure that would reach a client', () => {
  const env = briefEnvelope(brief(), counts());
  const candidate = goodCandidate();
  // 37 is plausible, adjacent to the real figures, and entirely made up.
  candidate.areas[1].rationale = 'The same header is absent on all 37 pages analysed.';
  const result = validateBriefPhrasing(candidate, env);
  assert.equal(result.ok, false);
  assert.equal(result.code, 'BRIEF_AI_INVENTED_NUMBER');
  assert.match(result.message, /37/);
});

test('a real figure from the evidence is allowed through', () => {
  const env = briefEnvelope(brief(), counts());
  const candidate = goodCandidate();
  candidate.areas[2].rationale = 'Missing on 32 of the pages analysed, which is where the work is.';
  assert.equal(validateBriefPhrasing(candidate, env).ok, true);
});

test('claiming confirmation of inferred evidence is rejected', () => {
  const env = briefEnvelope(brief(), counts());
  const candidate = goodCandidate();
  candidate.areas[2].rationale = 'Independently confirmed on every page the crawl read.';
  const result = validateBriefPhrasing(candidate, env);
  assert.equal(result.ok, false);
  assert.equal(result.code, 'BRIEF_AI_CONFIDENCE');
  assert.match(result.message, /content/);
});

test('a confidence word is fine on the area that actually carries it', () => {
  const env = briefEnvelope(brief(), counts());
  const candidate = goodCandidate();
  candidate.areas[0].rationale = 'The scanners confirmed the error response themselves.';
  assert.equal(validateBriefPhrasing(candidate, env).ok, true);
});

test('a URL or domain in the response is rejected by construction', () => {
  const env = briefEnvelope(brief(), counts());
  const candidate = goodCandidate();
  candidate.areas[0].rationale = 'The link to https://example.com/gone returns an error.';
  assert.equal(validateBriefPhrasing(candidate, env).code, 'BRIEF_AI_URL');
});

test('filler is rejected, because it says less than the wording it replaces', () => {
  const env = briefEnvelope(brief(), counts());
  const candidate = goodCandidate();
  candidate.areas[0].rationale = 'Review the issue and take action as appropriate for your situation.';
  assert.equal(validateBriefPhrasing(candidate, env).code, 'BRIEF_AI_FILLER');
});

test('thin or malformed output is rejected', () => {
  const env = briefEnvelope(brief(), counts());
  assert.equal(validateBriefPhrasing(null, env).code, 'BRIEF_AI_INVALID_JSON');
  assert.equal(validateBriefPhrasing({ summary: 'x' }, env).code, 'BRIEF_AI_INVALID_JSON');
  const thin = goodCandidate(); thin.summary = 'Some issues.';
  assert.equal(validateBriefPhrasing(thin, env).code, 'BRIEF_AI_THIN');
});

// --- the merge cannot move anything that constitutes a claim ---------------

test('the merge replaces words and nothing else', () => {
  const deterministic = brief();
  const merged = mergeBriefPhrasing(deterministic, goodCandidate());

  assert.deepEqual(merged.groups.map((g) => g.area), deterministic.groups.map((g) => g.area), 'order is untouched');
  for (let i = 0; i < merged.groups.length; i++) {
    for (const key of ['severity', 'pages', 'leadPages', 'instances', 'sitewide', 'journeyFailure']) {
      assert.deepEqual(merged.groups[i][key], deterministic.groups[i][key], `${key} must come from the scanners`);
    }
    assert.equal(merged.groups[i].lead.confidence, deterministic.groups[i].lead.confidence);
  }
  assert.equal(merged.totalInstances, deterministic.totalInstances);
  assert.equal(merged.guidanceSource, 'model', 'the reader must be able to tell where the words came from');
  assert.equal(merged.groups[0].title, 'Repair the two dead destinations');
});

test('a response missing an area leaves that area entirely deterministic', () => {
  const deterministic = brief();
  const candidate = goodCandidate();
  candidate.areas = candidate.areas.slice(0, 1);
  const merged = mergeBriefPhrasing(deterministic, candidate);
  assert.equal(merged.groups[1].title, deterministic.groups[1].title);
  assert.equal(merged.groups[1].modelRationale, undefined);
});

test('allowedNumbers admits the evidence and nothing adjacent to it', () => {
  const permitted = allowedNumbers(briefEnvelope(brief(), counts()));
  for (const real of [40, 114, 74, 343, 2, 32, 120, 64]) assert.ok(permitted.has(real), `${real} is in the evidence`);
  for (const invented of [37, 41, 113, 999]) assert.ok(!permitted.has(invented), `${invented} is not`);
});

// --- the bundled copy the overlay runs must be the copy the tests cover -----

test('the browser bundle exposes the same gate these tests exercise', async () => {
  // The overlay is a classic content script and cannot import, so the build
  // bundles these modules into one global. If that bundle drifts, the rule
  // that rejects invented numbers stops applying exactly where it matters —
  // on the screen a consultant shows a client.
  const fs = await import('node:fs');
  const bundlePath = 'dist/extension/brief-phrasing.browser.js';
  if (!fs.existsSync(bundlePath)) return; // build not run in this checkout
  const scope = {};
  new Function('globalThis', fs.readFileSync(bundlePath, 'utf8'))(scope);
  const api = scope.LumenBriefPhrasing;
  assert.ok(api, 'the bundle should expose LumenBriefPhrasing');
  for (const name of ['briefEnvelope', 'allowedNumbers', 'BRIEF_PHRASING_RULES', 'validateBriefPhrasing', 'mergeBriefPhrasing']) {
    assert.equal(typeof api[name] !== 'undefined', true, `${name} must be exported`);
  }

  const env = api.briefEnvelope(brief(), counts());
  assert.deepEqual(env.areas.map((a) => a.id), briefEnvelope(brief(), counts()).areas.map((a) => a.id));
  assert.equal(api.validateBriefPhrasing(goodCandidate(), env).ok, true);

  const invented = goodCandidate();
  invented.areas[1].rationale = 'The same header is absent on all 37 pages analysed.';
  assert.equal(api.validateBriefPhrasing(invented, env).code, 'BRIEF_AI_INVENTED_NUMBER');

  const reordered = goodCandidate();
  [reordered.areas[0], reordered.areas[1]] = [reordered.areas[1], reordered.areas[0]];
  assert.equal(api.validateBriefPhrasing(reordered, env).code, 'BRIEF_AI_AREA_MISMATCH');
});

// --- the regression an on-device model actually produced --------------------

/**
 * The first live on-device run passed every check that existed and was still
 * worse than the template it replaced. These are that exact output, so the
 * rules added afterwards are held to the failure that motivated them rather
 * than to an invented one.
 */
const OBSERVED_ON_DEVICE_OUTPUT = {
  summary: 'The availability of your site is severely impacted by broken destinations, addressed through repairing confirmed broken destinations. Security concerns stem from insufficient response headers, requiring consistent addition. Content and indexability issues require remediation of missing on-page signals and resolution of indexability blockers.',
  areas: [
    { id: 'availability', action: 'Repair confirmed broken destinations', rationale: 'Broken destinations are addressed through repairing confirmed broken destinations.' },
    { id: 'security', action: 'Add missing response headers consistently', rationale: 'Security concerns stem from insufficient response headers, requiring consistent addition.' },
    { id: 'content', action: 'Restore missing on-page signals', rationale: 'Content issues require remediation of missing on-page signals.' }
  ]
};

test('the output that shipped worse than the template is now rejected', () => {
  const env = briefEnvelope(brief(), counts());
  const result = validateBriefPhrasing(OBSERVED_ON_DEVICE_OUTPUT, env);
  assert.equal(result.ok, false, 'this is the text that motivated the quality rules');
  // "Severely" is caught first: nothing in this audit is recorded as critical.
  assert.equal(result.code, 'BRIEF_AI_OVERSTATED');
  assert.match(result.message, /severely/i);
});

test('unearned intensity is rejected, and earned intensity is not', () => {
  const env = briefEnvelope(brief(), counts());
  const loud = goodCandidate();
  loud.areas[0].rationale = 'This is a critical failure for every visitor who follows the link.';
  assert.equal(validateBriefPhrasing(loud, env).code, 'BRIEF_AI_OVERSTATED');

  // When the scanners did record a critical severity, the word is available.
  const severe = brief();
  severe.groups[0].severity = 'critical';
  const severeEnv = briefEnvelope(severe, counts());
  assert.equal(validateBriefPhrasing(loud, severeEnv).ok, true, 'critical evidence may be called critical');
});

test('a reason that reads its own headline back is rejected', () => {
  // Verbatim read-back is what the rule targets, and what the live model
  // actually did. A paraphrased restatement can still slip through: perfect
  // semantic echo detection is not available to a string rule, and a check
  // that rejected good writing would cost more than the mediocre writing it
  // saved — a rejection only ever falls back to the composed brief.
  const env = briefEnvelope(brief(), counts());
  const echo = goodCandidate();
  echo.areas[0].action = 'Repair confirmed broken destinations';
  echo.areas[0].rationale = 'These are addressed by repairing confirmed broken destinations across the estate.';
  const result = validateBriefPhrasing(echo, env);
  assert.equal(result.ok, false);
  assert.equal(result.code, 'BRIEF_AI_ECHO');
  assert.match(result.message, /availability/);
  assert.match(result.message, /confirmed broken destinations/);
});

test('the observed regression is caught by the echo rule too, not only by tone', () => {
  // The live output tripped the overstatement rule first. With that one word
  // removed it must still fail, or the echo rule is decorative.
  const env = briefEnvelope(brief(), counts());
  const quieter = JSON.parse(JSON.stringify(OBSERVED_ON_DEVICE_OUTPUT));
  quieter.summary = quieter.summary.replace('severely impacted', 'affected');
  const result = validateBriefPhrasing(quieter, env);
  assert.equal(result.ok, false);
  assert.equal(result.code, 'BRIEF_AI_ECHO');
});

test('a summary that only restates its headlines is rejected', () => {
  const env = briefEnvelope(brief(), counts());
  const echo = goodCandidate();
  echo.summary = 'Repair the two dead destinations, set the missing response headers site-wide, restore the missing on-page descriptions.';
  assert.equal(validateBriefPhrasing(echo, env).code, 'BRIEF_AI_ECHO');
});

test('a reason that adds a consequence still passes', () => {
  // The rules must reject restatement without rejecting good writing.
  const env = briefEnvelope(brief(), counts());
  const good = goodCandidate();
  good.areas[0].rationale = 'A visitor following the link lands on an error instead of the destination, and the scanners reached that error themselves.';
  assert.equal(validateBriefPhrasing(good, env).ok, true);
});

test('the deterministic summary itself would pass its own gate', () => {
  // If the composed wording could not survive the rules, the rules would be
  // demanding something the product does not do.
  const env = briefEnvelope(brief(), counts());
  const asCandidate = {
    summary: 'Start with the destinations that fail for a visitor, which are journey failures rather than stylistic warnings. Then repair the pattern repeated across the whole estate: one shared cause is one fix, not 40.',
    areas: [
      { id: 'availability', action: 'Repair the broken destinations', rationale: 'Someone following the link reaches an error instead of the content they wanted.' },
      { id: 'security', action: 'Add the missing response headers', rationale: 'The same omission repeats on 40 pages, so one deployment change closes all of them.' },
      { id: 'content', action: 'Restore the on-page signals', rationale: 'Search results and shared links fall back to whatever the crawler can guess.' }
    ]
  };
  const result = validateBriefPhrasing(asCandidate, env);
  assert.equal(result.ok, true, result.message);
});
