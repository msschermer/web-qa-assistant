import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { evaluateInvariants } from '../tools/autoqa/lib/invariants.mjs';
import { frankCriticEvaluate } from '../tools/autoqa/lib/frank-critic.mjs';
import { releaseJudge, JUDGE_DECISIONS } from '../tools/autoqa/lib/release-judge.mjs';
import { selectCycleTargets, loadCorpus } from '../tools/autoqa/lib/corpus.mjs';
import { readState } from '../tools/autoqa/lib/state.mjs';
import { safeSiteName } from '../tools/autoqa/lib/paths.mjs';

test('AutoQA state defaults to disabled', () => {
  const state = readState();
  assert.equal(state.enabled, false);
  assert.equal(state.status, 'inactive');
  assert.equal(state.baselineVersion, '1.7.5');
  assert.equal(state.baselineTag, 'v1.7.5');
  assert.match(state.baselineCommit, /^33e378f/);
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
});
