import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createLocalFrankRuntime } from '../apps/extension/local-ai.js';

const panel = fs.readFileSync('apps/extension/sidepanel.js', 'utf8');

function modelWithSession({ availability = 'available', createDelay = 0 } = {}) {
  let createCalls = 0;
  let cloneCalls = 0;
  let baseDestroyed = 0;
  const clones = [];
  const base = {
    async clone() {
      cloneCalls++;
      const clone = { destroyCalls: 0, destroy() { this.destroyCalls++; } };
      clones.push(clone);
      return clone;
    },
    destroy() { baseDestroyed++; }
  };
  const model = {
    async availability(options) {
      assert.equal(options.expectedInputs[0].languages[0], 'en');
      assert.equal(options.expectedOutputs[0].languages[0], 'en');
      return availability;
    },
    create(options) {
      createCalls++;
      assert.equal(options.initialPrompts[0].role, 'system');
      return new Promise(resolve => setTimeout(() => resolve(base), createDelay));
    }
  };
  return { model, base, clones, stats: () => ({ createCalls, cloneCalls, baseDestroyed }) };
}

test('Frank readiness is independent of the page scan and keeps one warm base session', async () => {
  const fake = modelWithSession();
  const runtime = createLocalFrankRuntime({ languageModel: fake.model });
  const warmed = await runtime.prewarmIfAvailable();
  assert.equal(warmed.ok, true);
  assert.equal(runtime.snapshot().status, 'ready');
  assert.equal(fake.stats().createCalls, 1);

  const first = await runtime.cloneTask();
  const second = await runtime.cloneTask();
  assert.notEqual(first, second, 'unrelated findings must not share conversational task state');
  assert.equal(fake.stats().cloneCalls, 2);
  assert.equal(fake.stats().createCalls, 1, 'cloning findings must not recreate the system session');
  assert.equal(fake.stats().baseDestroyed, 0, 'base stays warm while the panel is alive');

  runtime.destroy();
  assert.equal(fake.stats().baseDestroyed, 1);
});

test('background prewarm never starts a first-use model download without user intent', async () => {
  let createCalls = 0;
  const runtime = createLocalFrankRuntime({ languageModel: {
    async availability() { return 'downloadable'; },
    create() { createCalls++; throw new Error('should not create'); }
  }});
  const result = await runtime.prewarmIfAvailable();
  assert.equal(result.status, 'downloadable');
  assert.equal(createCalls, 0);
  assert.equal(runtime.snapshot().status, 'downloadable');
});

test('first-use download progress is observable and resolves in place to ready', async () => {
  let downloadListener;
  let resolveCreate;
  const base = { async clone() { return {}; }, destroy() {} };
  const runtime = createLocalFrankRuntime({ languageModel: {
    create(options) {
      options.monitor({ addEventListener(type, listener) { if (type === 'downloadprogress') downloadListener = listener; } });
      return new Promise(resolve => { resolveCreate = resolve; });
    }
  }});
  const states = [];
  runtime.subscribe(state => states.push(state));
  const preparing = runtime.activateFromGesture();
  downloadListener({ loaded: 0.42, total: 1 });
  assert.equal(runtime.snapshot().status, 'downloading');
  assert.equal(runtime.snapshot().progress, 0.42);
  resolveCreate(base);
  const result = await preparing;
  assert.equal(result.ok, true);
  assert.equal(runtime.snapshot().status, 'ready');
  assert.ok(states.some(state => state.status === 'downloading' && state.progress === 0.42));
  assert.ok(states.some(state => state.status === 'ready'));
});

test('Walk through waits for readiness and never uses Rescan as an AI recovery action', () => {
  const start = panel.indexOf('async function startFrank');
  const rescan = panel.indexOf('async function rescan');
  const update = panel.indexOf('async function updateWatch');
  const startBlock = panel.slice(start, rescan);
  const rescanBlock = panel.slice(rescan, update);

  assert.match(startBlock, /localFrankRuntime\.activateFromGesture\(\)/);
  assert.match(startBlock, /this finding will open automatically when on-device AI is ready/);
  assert.match(startBlock, /Use verified guidance now/);
  assert.match(startBlock, /await localFrankRuntime\.cloneTask\(\)/);
  assert.doesNotMatch(startBlock, /resolveLocalFrankSession|setTimeout\([^)]*10000|LOCAL_AI_PREPARING/);
  assert.doesNotMatch(rescanBlock, /prewarmIfAvailable|activateFromGesture|cloneTask|LanguageModel/);
});

test('page or finding changes cancel pending Frank work before late readiness can open stale guidance', () => {
  assert.match(panel, /pendingFrankCancel\?\.\(\)/);
  assert.match(panel, /currentRequest\(requestId, pageUrl, tabId\)/);
  assert.match(panel, /currentTabStillMatches\(pageUrl, tabId\)/);
  assert.match(panel, /The inspected page changed while the walkthrough was preparing/);
});

test('separate website findings never share page evidence through the warm base session', async () => {
  const taskPrompts = [];
  let basePromptCalls = 0;
  const base = {
    prompt() { basePromptCalls++; throw new Error('base session must never receive page evidence'); },
    async clone() {
      return {
        async prompt(prompt) {
          taskPrompts.push(prompt);
          const marker = prompt.includes('ALPHA_SITE_MARKER') ? 'ALPHA_SITE_MARKER' : 'BETA_SITE_MARKER';
          return JSON.stringify({
            summary: `${marker} finding needs a verified metadata correction.`,
            interpretation: `${marker} metadata is missing from the supplied page evidence.`,
            impact: `${marker} metadata absence reduces the completeness of the page metadata.`,
            remediation: `Add the missing ${marker} metadata described by the verified guidance.`,
            verification: `Recheck ${marker} metadata and confirm the same rule no longer fails.`
          });
        },
        destroy() {}
      };
    },
    destroy() {}
  };
  const runtime = createLocalFrankRuntime({ languageModel: {
    async availability() { return 'available'; },
    async create() { return base; }
  }});
  await runtime.prewarmIfAvailable();
  const { localFrankWalkthrough } = await import('../apps/extension/local-ai.js');
  const makeGraph = marker => ({
    finding: { ruleId: 'seo.description-missing', title: `${marker} metadata missing`, detail: `${marker} metadata is missing.`, category: 'fix', severity: 'medium', confidence: 'confirmed', targetType: 'document', wcag: [] },
    environment: { type: 'production' },
    evidence: [{ source: 'browser', kind: 'page-detail', label: 'Marker', value: marker }]
  });
  const makePlan = marker => ({ version: 3, mode: 'deterministic', summary: `${marker} metadata missing`, steps: [
    { type: 'interpretation', body: `${marker} metadata is missing from the supplied page evidence.` },
    { type: 'impact', body: `${marker} metadata absence reduces the completeness of the page metadata.` },
    { type: 'remediation', body: `Add the missing ${marker} metadata described by the verified guidance.` },
    { type: 'verification', body: `Recheck ${marker} metadata and confirm the same rule no longer fails.` }
  ]});

  for (const marker of ['ALPHA_SITE_MARKER', 'BETA_SITE_MARKER']) {
    const task = await runtime.cloneTask();
    await localFrankWalkthrough({ session: task, graph: makeGraph(marker), deterministicPlan: makePlan(marker) });
    task.destroy();
  }

  assert.equal(basePromptCalls, 0, 'the retained system-only base must never receive site evidence');
  assert.equal(taskPrompts.length, 2);
  assert.match(taskPrompts[0], /ALPHA_SITE_MARKER/);
  assert.doesNotMatch(taskPrompts[0], /BETA_SITE_MARKER/);
  assert.match(taskPrompts[1], /BETA_SITE_MARKER/);
  assert.doesNotMatch(taskPrompts[1], /ALPHA_SITE_MARKER/);
  runtime.destroy();
});
