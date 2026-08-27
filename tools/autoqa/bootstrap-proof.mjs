#!/usr/bin/env node
/**
 * Harmless end-to-end AutoQA lifecycle proof (REJECT + restore).
 * Does not leave permanent product code. Leaves enabled=false.
 */

import fs from 'node:fs';
import path from 'node:path';
import { beginCycle, rejectAndRestore, headSha, verifyRepoGuards, runTests } from './lib/cycle.mjs';
import { evaluateInvariants } from './lib/invariants.mjs';
import { frankCriticEvaluate } from './lib/frank-critic.mjs';
import { releaseJudge } from './lib/release-judge.mjs';
import { patchState, readState, writeState } from './lib/state.mjs';
import { writeStatusMarkdown, appendLog } from './lib/status.mjs';
import { REPO_ROOT, BASELINE_DIR, ensureAutoqaDirs } from './lib/paths.mjs';

async function main() {
  ensureAutoqaDirs();
  const guards = verifyRepoGuards();
  if (!guards.ok) {
    console.error(JSON.stringify({ ok: false, stage: 'guards', errors: guards.errors }, null, 2));
    process.exit(1);
  }
  if (guards.dirty) {
    console.error(JSON.stringify({ ok: false, stage: 'guards', error: 'dirty tree' }, null, 2));
    process.exit(1);
  }

  const headBefore = headSha();
  const started = beginCycle({ goal: 'bootstrap-harmless-reject-proof' });
  if (!started.ok) {
    console.error(JSON.stringify({ ok: false, stage: 'beginCycle', error: started.error }, null, 2));
    process.exit(1);
  }

  // Harmless dirty candidate: temporary root note (cleaned on reject; not product code).
  const probePath = path.join(REPO_ROOT, 'AUTOQA_BOOTSTRAP_PROBE.tmp.md');
  fs.writeFileSync(probePath, `# bootstrap probe\n\nTemporary AutoQA lifecycle probe. Safe to delete.\nCycle ${started.cycle}\n`);

  const fixtureReport = {
    coverage: { links: 'complete', browser: 'complete' },
    linkAudit: {
      eligible: 3,
      attempted: 3,
      unprobed: 0,
      explicitlySkipped: 0,
      verifiedHealthy: 2,
      confirmedIssues: 0,
      inconclusive: 1
    },
    findings: [],
    guidanceSource: 'deterministic',
    frankReview: { modelReadiness: 'ready', completed: false, source: 'none' }
  };

  const invariants = evaluateInvariants(fixtureReport);
  const critic = frankCriticEvaluate({
    finding: { ruleId: 'axe.link-in-text-block', confidence: 'confirmed' },
    frank: {
      plan: {
        guidanceSource: 'deterministic',
        steps: [
          { id: 'read', type: 'interpretation', body: 'The link is not distinguishable without color.' },
          { id: 'fix', type: 'remediation', body: 'The simplest fix is to add a persistent underline. The simplest fix is to add a persistent underline.' }
        ]
      }
    },
    report: fixtureReport
  });

  const judge = releaseJudge({
    invariants,
    frankCritic: critic,
    tests: { passed: 1, failed: 0, total: 1 },
    build: { ok: true },
    check: { ok: true },
    dogfood: { completed: true, hardFailures: [] },
    candidate: {
      intent: 'bootstrap-proof',
      explainable: true
    },
    baseline: { tag: 'v1.7.5', head: headBefore },
    bootstrapHarmless: true
  });

  fs.writeFileSync(path.join(started.runDir, 'evaluation.json'), `${JSON.stringify({ invariants, critic, judge }, null, 2)}\n`);
  fs.writeFileSync(path.join(started.runDir, 'cycle-summary.json'), `${JSON.stringify({
    classification: 'PASS',
    result: judge.decision,
    cycle: started.cycle,
    intent: 'bootstrap-harmless-reject-proof'
  }, null, 2)}\n`);

  if (judge.decision !== 'REJECT') {
    console.error(JSON.stringify({ ok: false, stage: 'judge', judge }, null, 2));
    process.exit(1);
  }

  const restored = rejectAndRestore(started.preCycleSha);
  if (!restored.ok) {
    console.error(JSON.stringify({ ok: false, stage: 'restore', restored }, null, 2));
    process.exit(1);
  }

  // Probe file is untracked under .autoqa — remove explicitly if still present
  if (fs.existsSync(probePath)) fs.unlinkSync(probePath);

  const headAfter = headSha();
  if (headAfter !== headBefore) {
    console.error(JSON.stringify({ ok: false, stage: 'head-mismatch', headBefore, headAfter }, null, 2));
    process.exit(1);
  }

  // Targeted unit proof for AutoQA libs (full suite optional)
  const unit = runTests(); // still run full suite once for bootstrap confidence

  const baselineEval = {
    baselineTag: 'v1.7.5',
    baselineCommit: guards.baselineCommit,
    head: headAfter,
    evaluatedAt: new Date().toISOString(),
    invariantsSmoke: invariants,
    frankCriticSmoke: { score: critic.score, issueCodes: critic.issues.map(i => i.code) },
    releaseJudgeSmoke: judge,
    tests: { ok: unit.ok, passed: unit.passed, failed: unit.failed, total: unit.total },
    notes: 'Synthetic baseline smoke during bootstrap. Real corpus dogfood remains session-gated (browser).'
  };
  fs.writeFileSync(path.join(BASELINE_DIR, 'evaluation.json'), `${JSON.stringify(baselineEval, null, 2)}\n`);

  // Leave autonomous mode OFF
  writeState({
    ...readState(),
    enabled: false,
    status: 'inactive',
    cycle: started.cycle,
    lastCycleAt: new Date().toISOString(),
    preCycleSha: null,
    activeGoal: null,
    baselineCommit: guards.baselineCommit,
    lastAcceptedSha: headAfter
  });

  writeStatusMarkdown({
    qualityBlock: `- Bootstrap lifecycle: REJECT + restore proved\n- Tests at bootstrap: ${unit.passed}/${unit.total} passed\n- Baseline tag: v1.7.5`,
    lastAccepted: 'None from AutoQA yet (bootstrap REJECT only).',
    currentWork: 'Bootstrap complete. Autonomous mode OFF.',
    humanAction: 'Say “Activate Web QA autonomous improvement.” when ready.'
  });
  appendLog(`Bootstrap proof cycle ${started.cycle}: Release Judge REJECT; restored ${headBefore.slice(0, 12)}. enabled=false.`);

  console.log(JSON.stringify({
    ok: true,
    proof: 'REJECT_RESTORE',
    cycle: started.cycle,
    preCycleSha: started.preCycleSha,
    head: headAfter,
    judge,
    criticIssues: critic.issues.map(i => i.code),
    tests: { ok: unit.ok, passed: unit.passed, failed: unit.failed, total: unit.total },
    enabled: false
  }, null, 2));
}

main().catch(err => {
  console.error(JSON.stringify({ ok: false, error: String(err?.stack || err) }));
  process.exit(1);
});
