import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { evaluateInvariants } from '../tools/autoqa/lib/invariants.mjs';
import { frankCriticEvaluate } from '../tools/autoqa/lib/frank-critic.mjs';
import { releaseJudge, JUDGE_DECISIONS } from '../tools/autoqa/lib/release-judge.mjs';
import { selectCycleTargets, loadCorpus, isAuthorizedDogfoodUrl, findAuthorizedCorpusSite } from '../tools/autoqa/lib/corpus.mjs';
import { readState } from '../tools/autoqa/lib/state.mjs';
import { safeSiteName } from '../tools/autoqa/lib/paths.mjs';
import { CONTROL_PLANE_PATHS, porcelainPaths } from '../tools/autoqa/lib/cycle.mjs';
import { resolveSystemChrome, chromeLaunchOptions } from '../tools/autoqa/lib/chrome.mjs';

test('AutoQA state schema and immutable baseline', () => {
  const state = readState();
  assert.equal(typeof state.enabled, 'boolean');
  assert.equal(typeof state.status, 'string');
  if (state.enabled) {
    assert.equal(state.status, 'active');
  } else {
    assert.ok(state.status === 'inactive' || state.status === 'paused');
  }
  assert.equal(state.baselineVersion, '1.7.5');
  assert.equal(state.baselineTag, 'v1.7.5');
  assert.match(state.baselineCommit, /^33e378f/);
});

test('porcelainPaths and control-plane list stay beginCycle-safe', () => {
  const paths = porcelainPaths(' M .autoqa/state.json\n M AUTOQA_STATUS.md\n M AUTOQA_LOG.md\n');
  assert.deepEqual(paths, ['.autoqa/state.json', 'AUTOQA_STATUS.md', 'AUTOQA_LOG.md']);
  for (const p of CONTROL_PLANE_PATHS) {
    assert.ok(paths.includes(p) || CONTROL_PLANE_PATHS.includes(p));
  }
  assert.equal(CONTROL_PLANE_PATHS.length, 3);
});

test('AutoQA skill and corpus files exist', () => {
  assert.ok(fs.existsSync('.cursor/skills/webqa-autonomous-improvement/SKILL.md'));
  assert.ok(fs.existsSync('qa-sites/golden.json'));
  assert.ok(fs.existsSync('qa-sites/rotating.json'));
  assert.ok(fs.existsSync('qa-sites/adversarial.json'));
  assert.ok(fs.existsSync('qa-sites/discoveries.json'));
  assert.ok(fs.existsSync('qa-sites/holdout.json'));
  assert.ok(fs.existsSync('tools/autoqa/activate.mjs'));
  assert.ok(fs.existsSync('tools/autoqa/deactivate.mjs'));
  assert.ok(fs.existsSync('tools/autoqa/dogfood.mjs'));
  assert.ok(fs.existsSync('tools/autoqa/bootstrap-proof.mjs'));
});

test('corpus selection excludes holdout from ordinary cycle picks', () => {
  const corpus = loadCorpus();
  assert.ok((corpus.holdout.sites || []).length >= 1);
  const picked = selectCycleTargets({ goldenCount: 2, rotatingCount: 2, seed: 42 });
  const holdoutUrls = new Set((corpus.holdout.sites || []).map(s => s.url));
  for (const site of picked.sites) {
    assert.equal(holdoutUrls.has(site.url), false);
  }
});

test('approved corpus members are authorized dogfood URLs without per-site approval', () => {
  assert.equal(isAuthorizedDogfoodUrl('https://example.com/'), true);
  assert.ok(findAuthorizedCorpusSite('https://example.com/'));
  assert.equal(isAuthorizedDogfoodUrl('http://127.0.0.1:8787/qa-matrix/clean.html'), true);
  assert.equal(isAuthorizedDogfoodUrl('https://example.com/not-an-autoqa-corpus-member'), false);
  const holdout = (loadCorpus().holdout.sites || [])[0];
  if (holdout?.url) {
    assert.equal(isAuthorizedDogfoodUrl(holdout.url), false);
  }
});

test('Chrome resolution prefers installed Chrome and dogfood uses CDP extension load', () => {
  const resolved = resolveSystemChrome();
  assert.equal(resolved.browser, 'chrome');
  assert.ok(resolved.channel === 'chrome' || resolved.executablePath);
  const opts = chromeLaunchOptions(resolved);
  assert.ok(opts.channel === 'chrome' || opts.executablePath);
  const dogfood = fs.readFileSync('tools/autoqa/dogfood.mjs', 'utf8');
  assert.doesNotMatch(dogfood, /WEBQA_AUTOQA_SYSTEM_CHROME/);
  assert.match(dogfood, /Extensions\.loadUnpacked/);
  assert.match(dogfood, /enable-unsafe-extension-debugging/);
  assert.doesNotMatch(dogfood, /playwright-chromium|channel:\s*['\"]chromium['\"]/);
});

test('permissions allow authorized corpus dogfood and block only non-corpus externals', () => {
  const perms = JSON.parse(fs.readFileSync('.cursor/permissions.json', 'utf8'));
  const allow = (perms.autoRun?.allow_instructions || []).join('\n');
  const block = (perms.autoRun?.block_instructions || []).join('\n');
  assert.match(allow, /corpus/i);
  assert.doesNotMatch(block, /until the requested test origin is clear and intentional/);
  assert.match(block, /NOT listed in AutoQA corpus/i);
});

test('safeSiteName blocks path traversal', () => {
  assert.equal(safeSiteName('https://example.com/a/b'), 'example.com');
  assert.doesNotMatch(safeSiteName('../../etc/passwd'), /\.\./);
  assert.ok(!safeSiteName('https://example.com/').includes('/') || safeSiteName('https://example.com/') === 'example.com');
});

test('invariants catch guidanceSource frank-model without completed review', () => {
  const result = evaluateInvariants({
    linkAudit: { eligible: 2, attempted: 2, unprobed: 0, explicitlySkipped: 0, verifiedHealthy: 2, confirmedIssues: 0, inconclusive: 0 },
    guidanceSource: 'frank-model',
    frankReview: { modelReadiness: 'ready', completed: false, source: 'none' }
  });
  assert.equal(result.ok, false);
  assert.ok(result.hardFailures.some(f => f.id === 'readiness-vs-review'));
});

test('invariants pass reconciled link accounting', () => {
  const result = evaluateInvariants({
    linkAudit: { eligible: 5, attempted: 4, unprobed: 1, explicitlySkipped: 0, verifiedHealthy: 3, confirmedIssues: 0, inconclusive: 1 },
    guidanceSource: 'deterministic',
    frankReview: { modelReadiness: 'ready', completed: false, source: 'none' }
  });
  assert.equal(result.ok, true);
});

test('Frank Critic flags duplicate remediation sentences', () => {
  const critic = frankCriticEvaluate({
    finding: { ruleId: 'axe.link-in-text-block', confidence: 'confirmed' },
    frank: {
      plan: {
        guidanceSource: 'deterministic',
        steps: [
          { id: 'fix', type: 'remediation', body: 'Add a persistent underline. Add a persistent underline.' }
        ]
      }
    }
  });
  assert.ok(critic.issues.some(i => i.code === 'duplicate-remediation-sentence'));
  assert.match(critic.untrustedPagePolicy, /UNTRUSTED/);
});

test('Release Judge rejects bootstrap-harmless candidates', () => {
  const judge = releaseJudge({
    invariants: { ok: true, hardFailures: [] },
    tests: { passed: 10, failed: 0, total: 10 },
    build: { ok: true },
    check: { ok: true },
    candidate: { intent: 'bootstrap-proof', explainable: true },
    bootstrapHarmless: true
  });
  assert.equal(judge.decision, JUDGE_DECISIONS.REJECT);
});

test('Release Judge accepts explainable green candidate', () => {
  const judge = releaseJudge({
    invariants: { ok: true, hardFailures: [] },
    frankCritic: { issues: [] },
    tests: { passed: 10, failed: 0, total: 10 },
    build: { ok: true },
    check: { ok: true },
    dogfood: { hardFailures: [] },
    candidate: { intent: 'reuse verified link cache', explainable: true }
  });
  assert.equal(judge.decision, JUDGE_DECISIONS.ACCEPT);
});

test('skill documents activation and deactivation language', () => {
  const skill = fs.readFileSync(path.join('.cursor', 'skills', 'webqa-autonomous-improvement', 'SKILL.md'), 'utf8');
  assert.match(skill, /Activate Web QA autonomous improvement/);
  assert.match(skill, /Deactivate Web QA autonomous improvement/);
  assert.match(skill, /\/autoqa start/);
  assert.match(skill, /\/autoqa stop/);
  assert.match(skill, /no forks/i);
  assert.match(skill, /Chrome-only/i);
  assert.match(skill, /Corpus membership|authorized for bounded AutoQA dogfood/i);
});
