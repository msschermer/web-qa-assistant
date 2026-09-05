import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const overlay = fs.readFileSync('apps/extension/content.js', 'utf8');

test('no request to a model is awaited without a deadline', () => {
  // The defect this closes: session.prompt() is an unbounded await on someone
  // else's runtime. A model that accepted the request and never answered left
  // the brief reading "asking AI for wording" for as long as the overlay stayed
  // open — reproduced in headed Chrome, still pending after 35 seconds. The
  // deterministic wording is already on screen, so waiting longer buys nothing
  // except a label that never resolves.
  assert.match(overlay, /const BRIEF_AI_DEADLINE_MS = \d+/);
  assert.match(overlay, /function withDeadline\(/);
  // Both surfaces that talk to a model go through it.
  const brief = overlay.match(/function requestBriefPhrasing\([\s\S]*?\n  \}/)[0];
  const plan = overlay.match(/async function requestPlanPhrasing\([\s\S]*?\n  \}/)[0];
  for (const [name, body] of [['brief', brief], ['plan', plan]]) {
    assert.match(body, /withDeadline\(/, `the ${name} phrasing request must be bounded`);
    assert.match(body, /BRIEF_AI_DEADLINE_MS/, `the ${name} request must use the shared deadline`);
  }
});

test('a failed wording request is a stated coverage fact, not a silent fallback', () => {
  // Four different outcomes used to render one sentence: no model, model
  // unavailable, model answer rejected, request never made. An operator could
  // not tell a brief Lumen wrote from one where a configured model failed.
  // PRODUCT.md: unavailable reasoning is a coverage fact, never a silent
  // omission.
  assert.match(overlay, /const BRIEF_UNAVAILABLE_REASON = \{/);
  const reasons = overlay.match(/const BRIEF_UNAVAILABLE_REASON = \{[\s\S]*?\n  \};/)[0];
  for (const code of ['BRIEF_AI_OFF', 'LOCAL_AI_API_UNAVAILABLE', 'LOCAL_AI_DOWNLOADABLE',
    'BRIEF_AI_TIMEOUT', 'BRIEF_AI_REJECTED']) {
    assert.match(reasons, new RegExp(code), `${code} needs a reason a reader can understand`);
  }
  // 'unavailable' is its own status, distinct from 'deterministic'. Collapsing
  // them is what made the failure invisible.
  assert.match(overlay, /status: "unavailable", code: result\.code/);
  // Both surfaces read the reason through the one function that decides
  // whether it is worth showing, rather than indexing the table directly.
  assert.match(overlay, /function briefUnavailableReason\(code\)/);
  assert.equal((overlay.match(/briefUnavailableReason\(state\.code\)/g) || []).length, 2,
    'the brief and the plan both report through it');
});

test('configured absence is not dressed up as a failure', () => {
  // The complaint this closes: a brief nobody asked a model to rewrite carried
  // "on-device AI unavailable here" on a screen where nothing had gone wrong.
  // Having no model is a choice, and the line should say only who wrote the
  // words. A configured model that timed out or was rejected still reports.
  const set = overlay.match(/const BRIEF_NOT_A_FAILURE = new Set\(\[[\s\S]*?\]\);/)[0];
  for (const quiet of ['BRIEF_AI_OFF', 'BRIEF_AI_NO_PROVIDER', 'BYO_AI_NO_ENDPOINT', 'LOCAL_AI_API_UNAVAILABLE']) {
    assert.match(set, new RegExp(quiet), `${quiet} is an absence, not a fault`);
  }
  for (const loud of ['BRIEF_AI_TIMEOUT', 'BRIEF_AI_REJECTED', 'BYO_AI_TIMEOUT', 'BYO_AI_FAILED']) {
    assert.ok(!set.includes(loud), `${loud} is a real failure and must still be stated`);
  }
  // And the label never names the mechanism where it can name the author.
  const provenance = overlay.match(/const BRIEF_PROVENANCE = \{[\s\S]*?\n  \};/)[0]
    + overlay.match(/const PLAN_PROVENANCE = \{[\s\S]*?\n  \};/)[0];
  assert.ok(!/AI wording/i.test(provenance), 'the label says who wrote the words, not that a machine was involved');
});

test('the model writes words and never the order', () => {
  // The sequence, counts, severity and confidence are decided before a model is
  // asked anything. An accepted phrasing may only set phrased* fields, and the
  // priority it belongs to is matched by id rather than by position, so a
  // reordered reply cannot reorder the plan.
  const apply = overlay.match(/function applyPlanPhrasing\([\s\S]*?\n  \}/)[0];
  assert.match(apply, /plan\.priorities\.find\(\(p\) => p\.id === area\.id\)/);
  assert.match(apply, /priority\.phrasedTitle =/);
  assert.match(apply, /priority\.phrasedSummary =/);
  for (const forbidden of ['priority.order', 'priority.severity', 'priority.confidence', 'priority.findings', 'priority.actions']) {
    assert.ok(!apply.includes(`${forbidden} =`), `${forbidden} must not be writable by a model`);
  }
  // And it is validated by the brief's validator rather than a second copy of
  // the rules — one definition of what an invented number is.
  assert.match(overlay, /api\.validateBriefPhrasing\(parsed, envelope\)/);
});

test('Optimize is started deliberately and never blocks on the model', () => {
  // The plan is the product and is deterministic; the wording is optional. The
  // sequence renders first and the wording pass runs after it is on screen, so
  // an unavailable model looks like an unavailable model rather than a broken
  // audit.
  assert.match(overlay, /function renderOptimizeIdle\(\)/);
  assert.match(overlay, /optimize-start-btn/);
  const build = overlay.match(/async function buildOptimizePlanNow\([\s\S]*?\n  \}/)[0];
  const renderAt = build.indexOf('renderOptimizeSection()');
  const phraseAt = build.indexOf('requestPlanPhrasing');
  assert.ok(renderAt > -1 && phraseAt > renderAt, 'the sequence must render before the wording is requested');
});

test('working states are visible, and survive reduced motion', () => {
  // A surface that looks finished while a request is still out is why the
  // fallback wording read as the final answer.
  assert.match(overlay, /class="work-dot"/);
  const rule = overlay.match(/\.work-dot\{[^}]*\}/)[0];
  assert.match(rule, /display:inline-flex/);
  // Reduced motion stops the movement and keeps the state visible; hiding it
  // would trade one silent surface for another.
  const reduced = overlay.match(/@media\(prefers-reduced-motion:reduce\)\{\s*\.work-dot[\s\S]*?\}\s*\}/);
  assert.ok(reduced, 'the working indicator needs a reduced-motion form');
  assert.match(reduced[0], /animation:none/);
  assert.match(reduced[0], /opacity:\.7/, 'still visible, just still');
});
