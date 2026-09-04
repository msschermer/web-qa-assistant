import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

/**
 * The overlay side of brief phrasing, exercised without a browser.
 *
 * The model path cannot be run here — Chrome's built-in model reports
 * "unavailable" on most machines, including CI — so what matters most is that
 * the *absence* of a model is completely uneventful. The deterministic brief
 * was already on screen before the request was made; a refusal must leave it
 * exactly as it was and must never throw into the render path.
 *
 * The functions are lifted out of the built content script rather than
 * reimplemented, so this tests the code that actually ships.
 */

const BUILT = 'dist/extension/content.js';
const BUNDLE = 'dist/extension/brief-phrasing.browser.js';

function lift(names) {
  const src = fs.readFileSync(BUILT, 'utf8');
  const parts = names.map((name) => {
    const re = new RegExp('^  (?:async )?function ' + name + '\\([\\s\\S]*?\\n  \\}', 'm');
    const found = src.match(re);
    assert.ok(found, name + ' should exist in the built content script');
    return found[0];
  });
  return parts.join('\n') + '\nreturn { ' + names.join(', ') + ' };';
}

function harness({ languageModel = undefined, kicker = null } = {}) {
  const scope = {};
  new Function('globalThis', fs.readFileSync(BUNDLE, 'utf8'))(scope);
  const repaints = [];
  const siteAudit = {
    auditId: 'audit-1',
    rawFindingGroups: [],
    audit: {},
    shadow: { querySelector: (sel) => (sel.includes('brief-source') ? kicker : null) }
  };
  const globals = { LumenBriefPhrasing: scope.LumenBriefPhrasing, LanguageModel: languageModel };
  const api = new Function(
    'globalThis', 'siteAudit', 'BRIEF_PROVENANCE', 'renderLumenBrief',
    lift(['phraseBriefOnDevice', 'requestBriefPhrasing', 'renderBriefProvenance'])
  )(globals, siteAudit, {
    deterministic: 'grounded in scan evidence',
    pending: 'grounded in scan evidence · asking on-device AI',
    model: 'scan evidence · wording by on-device AI'
  }, () => repaints.push('repaint'));
  return { api, siteAudit, repaints };
}

const brief = () => ({
  summary: 'Start with the destinations that fail for a visitor.',
  totalInstances: 4,
  groups: [{
    area: 'availability', title: 'Repair confirmed broken destinations', severity: 'high',
    pages: 2, leadPages: 2, instances: 2, rules: [{}],
    lead: { rule_id: 'navigation.link-404-external', confidence: 'confirmed' }
  }]
});
const audit = () => ({ id: 'audit-1', urlCounts: { fetched: 4, queued: 6 } });

const built = fs.existsSync(BUILT) && fs.existsSync(BUNDLE);

test('with no on-device model the request refuses quietly and repaints nothing', { skip: !built }, async () => {
  const { api, siteAudit, repaints } = harness({ languageModel: undefined });
  const result = await api.phraseBriefOnDevice(brief(), audit());
  assert.equal(result.ok, false);
  assert.equal(result.code, 'LOCAL_AI_API_UNAVAILABLE');

  api.requestBriefPhrasing(brief(), audit());
  await new Promise((r) => setTimeout(r, 30));
  assert.equal(siteAudit.briefPhrasing.status, 'deterministic', 'the brief stays as composed');
  assert.equal(repaints.length, 0, 'a refusal must not repaint the brief');
});

test('a model that is merely downloadable is never triggered', { skip: !built }, async () => {
  // "downloadable" means Chrome would fetch a multi-gigabyte model. Starting
  // that on an operator's behalf, mid-audit, without asking, is not on.
  let created = 0;
  const languageModel = {
    availability: async () => 'downloadable',
    create: async () => { created++; return { prompt: async () => '{}', destroy() {} }; }
  };
  const { api } = harness({ languageModel });
  const result = await api.phraseBriefOnDevice(brief(), audit());
  assert.equal(result.ok, false);
  assert.equal(result.code, 'LOCAL_AI_DOWNLOADABLE');
  assert.equal(created, 0, 'no session may be created for a model that is not present');
});

test('a rejected response leaves the deterministic brief untouched', { skip: !built }, async () => {
  // The model returns a confident, plausible, invented number.
  const languageModel = {
    availability: async () => 'available',
    create: async () => ({
      prompt: async () => JSON.stringify({
        summary: 'A summary that is comfortably long enough to clear the floor check.',
        areas: [{ id: 'availability', action: 'Repair the 91 dead destinations', rationale: 'A visitor following these links reaches an error page.' }]
      }),
      destroy() {}
    })
  };
  const { api } = harness({ languageModel });
  const result = await api.phraseBriefOnDevice(brief(), audit());
  assert.equal(result.ok, false);
  assert.equal(result.code, 'BRIEF_AI_INVENTED_NUMBER');
});

test('an accepted response replaces wording and repaints once', { skip: !built }, async () => {
  const languageModel = {
    availability: async () => 'available',
    create: async () => ({
      prompt: async () => JSON.stringify({
        summary: 'Two destinations fail outright for a visitor, so they come first.',
        areas: [{ id: 'availability', action: 'Repair the 2 dead destinations', rationale: 'A visitor following these links reaches an error the scanners reached themselves.' }]
      }),
      destroy() {}
    })
  };
  const { api, siteAudit, repaints } = harness({ languageModel });
  api.requestBriefPhrasing(brief(), audit());
  await new Promise((r) => setTimeout(r, 40));
  assert.equal(siteAudit.briefPhrasing.status, 'model');
  assert.equal(siteAudit.briefPhrasing.brief.groups[0].title, 'Repair the 2 dead destinations');
  assert.equal(siteAudit.briefPhrasing.brief.groups[0].severity, 'high', 'severity still comes from the scanners');
  assert.equal(repaints.length, 1, 'an accepted phrasing repaints exactly once');
});

test('the session is destroyed even when the model throws', { skip: !built }, async () => {
  let destroyed = 0;
  const languageModel = {
    availability: async () => 'available',
    create: async () => ({
      prompt: async () => { throw new Error('model exploded'); },
      destroy() { destroyed++; }
    })
  };
  const { api } = harness({ languageModel });
  const result = await api.phraseBriefOnDevice(brief(), audit());
  assert.equal(result.ok, false);
  assert.equal(result.code, 'LOCAL_AI_FAILED');
  assert.equal(destroyed, 1, 'a failed call must not leak the session');
});

test('the request runs once per audit, not once per repaint', { skip: !built }, async () => {
  let creates = 0;
  const languageModel = {
    availability: async () => 'available',
    create: async () => { creates++; return { prompt: async () => 'not json', destroy() {} }; }
  };
  const { api } = harness({ languageModel });
  api.requestBriefPhrasing(brief(), audit());
  api.requestBriefPhrasing(brief(), audit());
  api.requestBriefPhrasing(brief(), audit());
  await new Promise((r) => setTimeout(r, 40));
  assert.equal(creates, 1, 'selecting a different brief row must not re-prompt the model');
});

test('provenance rendering tolerates a missing element', { skip: !built }, () => {
  const { api } = harness({ kicker: null });
  assert.doesNotThrow(() => api.renderBriefProvenance());
});

test('provenance names the author of the words, not the source of the facts', { skip: !built }, () => {
  const kicker = { textContent: '' };
  const { api, siteAudit } = harness({ kicker });
  api.renderBriefProvenance();
  assert.match(kicker.textContent, /grounded in scan evidence/);
  siteAudit.briefPhrasing = { auditId: 'audit-1', status: 'model' };
  api.renderBriefProvenance();
  assert.match(kicker.textContent, /on-device AI/, 'the reader must be told when a model wrote the words');
});
