import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { resolveBriefProvider } from '../packages/ai/brief-provider.js';

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

function harness({ languageModel = undefined, kicker = null, provider = 'byo', byoReady = false, byoReply = null, localAvailable = undefined } = {}) {
  const settings = {
    briefAiProvider: provider,
    byoAiBaseUrl: byoReady ? 'https://models.example.com/v1' : '',
    byoAiModel: byoReady ? 'a-model' : ''
  };
  const canRunLocally = localAvailable === undefined ? Boolean(languageModel) : localAvailable;
  const resolved = resolveBriefProvider(settings, { localAvailable: canRunLocally });
  const scope = {};
  new Function('globalThis', fs.readFileSync(BUNDLE, 'utf8'))(scope);
  const repaints = [];
  const siteAudit = {
    auditId: 'audit-1',
    rawFindingGroups: [],
    audit: {},
    shadow: { querySelector: (sel) => (sel.includes('brief-source') ? kicker : null) }
  };
  const sent = [];
  const chrome = {
    runtime: {
      sendMessage: async (msg) => {
        sent.push(msg);
        if (msg.type === 'BRIEF_AI_SETTINGS') {
          return { ok: true, provider, resolved: { id: resolved.id, ready: resolved.ready, substituted: resolved.substituted, reason: resolved.reason } };
        }
        if (msg.type === 'BRIEF_AI_PHRASE') return byoReply || { ok: false, code: 'BYO_AI_FAILED' };
        return {};
      }
    }
  };
  const globals = { LumenBriefPhrasing: scope.LumenBriefPhrasing, LanguageModel: languageModel, chrome };
  const api = new Function(
    'globalThis', 'siteAudit', 'BRIEF_PROVENANCE', 'BRIEF_UNAVAILABLE_REASON', 'BRIEF_NOT_A_FAILURE', 'BRIEF_AI_DEADLINE_MS', 'renderLumenBrief', 'chrome',
    lift(['withDeadline', 'briefPromptFor', 'acceptBriefPhrasing', 'phraseBriefWithOwnAi', 'phraseBriefOnDevice', 'localModelUsable', 'briefUnavailableReason', 'briefPhrasingProvider', 'requestBriefPhrasing', 'renderBriefProvenance'])
  )(globals, siteAudit, {
    deterministic: 'written by Lumen from scan evidence',
    pending: 'written by Lumen from scan evidence · rewriting',
    model: 'scan evidence · written by the model on this device',
    byo: 'scan evidence · written by your model',
    unavailable: 'written by Lumen from scan evidence'
  }, {
    BRIEF_AI_NO_PROVIDER: 'no model is configured',
    LOCAL_AI_API_UNAVAILABLE: 'this browser has no built-in model',
    BRIEF_AI_TIMEOUT: 'the model did not answer in time'
  }, new Set(['BRIEF_AI_OFF', 'BRIEF_AI_NO_PROVIDER', 'LOCAL_AI_API_UNAVAILABLE']),
  200, () => repaints.push('repaint'), chrome);
  return { api, siteAudit, repaints, sent };
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
  assert.equal(siteAudit.briefPhrasing.status, 'unavailable', 'a refusal is recorded, not hidden');
  // With nothing configured the resolver reaches no provider at all, which is
  // a truer answer than the built-in model's own error and, unlike it, is not
  // rendered as a failure on a screen where nothing went wrong.
  assert.equal(siteAudit.briefPhrasing.code, 'BRIEF_AI_NO_PROVIDER', 'and it says why');
  assert.equal(api.briefUnavailableReason('BRIEF_AI_NO_PROVIDER'), '', 'an absence is not badged as a fault');
  assert.ok(api.briefUnavailableReason('BRIEF_AI_TIMEOUT').length > 5, 'a real failure still is');
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
  assert.match(kicker.textContent, /written by Lumen from scan evidence/);
  siteAudit.briefPhrasing = { auditId: 'audit-1', status: 'model' };
  api.renderBriefProvenance();
  assert.match(kicker.textContent, /written by the model on this device/, 'the reader must be told when a model wrote the words');
});

// --- bring your own AI ------------------------------------------------------

const byoGood = () => ({
  ok: true,
  text: JSON.stringify({
    summary: 'Two destinations fail outright for a visitor, so they come first in the order of work.',
    areas: [{ id: 'availability', action: 'Repair the 2 dead destinations', rationale: 'A visitor following these links reaches an error the scanners reached themselves.' }]
  })
});

test('exactly one provider is asked, and it is one that can answer', { skip: !built }, async () => {
  // The defect this closes: the overlay always tried Chrome's built-in model
  // first and only then fell back. On the machines where that reports
  // "unavailable" and cannot be made to report anything else, a configured
  // endpoint was reached only after a guaranteed failure, and every surface
  // showed the built-in model's error. Readiness now decides, in the worker,
  // and the overlay asks the one provider it is given.
  const languageModel = {
    availability: async () => 'available',
    create: async () => ({ prompt: async () => byoGood().text, destroy() {} })
  };
  // A chosen endpoint is used even where the built-in model would also work.
  const own = harness({ languageModel, provider: 'byo', byoReady: true, byoReply: byoGood() });
  own.api.requestBriefPhrasing(brief(), audit());
  await new Promise((r) => setTimeout(r, 40));
  assert.equal(own.siteAudit.briefPhrasing.status, 'byo', 'the operator chose their endpoint, so it is used');

  // And choosing on-device where it works asks nothing of any endpoint.
  const local = harness({ languageModel, provider: 'on-device', byoReady: true, byoReply: byoGood() });
  local.api.requestBriefPhrasing(brief(), audit());
  await new Promise((r) => setTimeout(r, 40));
  assert.equal(local.siteAudit.briefPhrasing.status, 'model');
  assert.equal(local.sent.some((m) => m.type === 'BRIEF_AI_PHRASE'), false, 'nothing leaves the machine');
});

test('a chosen provider that cannot answer is substituted, not simply failed', { skip: !built }, async () => {
  // The whole point of resolving by readiness: an operator who left the
  // default on the built-in model, on a machine that cannot run it, still gets
  // the endpoint they configured rather than an error.
  const { api, siteAudit, sent, repaints } = harness({
    languageModel: undefined, provider: 'on-device', byoReady: true, byoReply: byoGood()
  });
  api.requestBriefPhrasing(brief(), audit());
  await new Promise((r) => setTimeout(r, 40));
  assert.equal(siteAudit.briefPhrasing.status, 'byo');
  assert.equal(siteAudit.briefPhrasing.brief.groups[0].title, 'Repair the 2 dead destinations');
  assert.equal(siteAudit.briefPhrasing.brief.groups[0].severity, 'high', 'the scanners still own severity');
  assert.equal(repaints.length, 1);
  const call = sent.find((m) => m.type === 'BRIEF_AI_PHRASE');
  assert.ok(call, 'the service worker makes the request, not the content script');
  assert.equal(call.provider, 'byo');
});

test('the same gate applies to the operator endpoint', { skip: !built }, async () => {
  // A remote model gets no more latitude than the local one.
  const invented = {
    ok: true,
    text: JSON.stringify({
      summary: 'A summary that is comfortably long enough to clear the floor check.',
      areas: [{ id: 'availability', action: 'Repair the 91 dead destinations', rationale: 'A visitor following these links reaches an error page.' }]
    })
  };
  const { api, siteAudit } = harness({ provider: 'byo', byoReady: true, byoReply: invented });
  api.requestBriefPhrasing(brief(), audit());
  await new Promise((r) => setTimeout(r, 40));
  assert.equal(siteAudit.briefPhrasing.status, 'unavailable');
  assert.equal(siteAudit.briefPhrasing.code, 'BRIEF_AI_INVENTED_NUMBER');
});

test('an unconfigured endpoint is never called', { skip: !built }, async () => {
  const { api, siteAudit, sent } = harness({ provider: 'byo', byoReady: false });
  api.requestBriefPhrasing(brief(), audit());
  await new Promise((r) => setTimeout(r, 40));
  assert.equal(sent.some((m) => m.type === 'BRIEF_AI_PHRASE'), false);
  assert.equal(siteAudit.briefPhrasing.status, 'unavailable');
  // Nothing was configured and nothing failed, so the reader is told who wrote
  // the words and not that something is broken.
  assert.equal(siteAudit.briefPhrasing.code, 'BRIEF_AI_NO_PROVIDER');
});

test('choosing off asks nothing of anyone', { skip: !built }, async () => {
  const languageModel = {
    availability: async () => 'available',
    create: async () => { throw new Error('should not be reached'); }
  };
  const { api, siteAudit, sent } = harness({ languageModel, provider: 'off', byoReady: true, byoReply: byoGood() });
  api.requestBriefPhrasing(brief(), audit());
  await new Promise((r) => setTimeout(r, 40));
  assert.equal(siteAudit.briefPhrasing.status, 'unavailable');
  assert.equal(siteAudit.briefPhrasing.code, 'BRIEF_AI_OFF');
  assert.equal(sent.some((m) => m.type === 'BRIEF_AI_PHRASE'), false);
});

test('every provenance state is distinguishable to a reader', { skip: !built }, () => {
  const kicker = { textContent: '' };
  const { api, siteAudit } = harness({ kicker });
  const seen = new Set();
  for (const status of ['deterministic', 'pending', 'model', 'byo']) {
    siteAudit.briefPhrasing = { auditId: 'audit-1', status };
    api.renderBriefProvenance();
    seen.add(kicker.textContent);
  }
  assert.equal(seen.size, 4, 'a reader must be able to tell the four states apart');
  siteAudit.briefPhrasing = { auditId: 'audit-1', status: 'byo' };
  api.renderBriefProvenance();
  assert.match(kicker.textContent, /written by your model/);
});
