#!/usr/bin/env node
/**
 * Activate Web QA autonomous improvement.
 * Persists enabled=true in .autoqa/state.json and commits control-plane
 * bookkeeping so beginCycle can start on a clean tree.
 */

import { patchState, readState } from './lib/state.mjs';
import {
  verifyRepoGuards,
  headSha,
  runTests,
  runNpm,
  restoreTracked,
  commitPaths,
  CONTROL_PLANE_PATHS
} from './lib/cycle.mjs';
import { writeStatusMarkdown, appendLog } from './lib/status.mjs';
import { BASELINE_TAG } from './lib/paths.mjs';

async function main() {
  const guards = verifyRepoGuards();
  if (!guards.ok) {
    console.error(JSON.stringify({ ok: false, error: 'repo guards failed', errors: guards.errors }, null, 2));
    process.exit(1);
  }
  if (guards.dirty) {
    console.error(JSON.stringify({ ok: false, error: 'working tree dirty; clean before activation' }, null, 2));
    process.exit(1);
  }

  // Lightweight readiness: check + build preferred; full tests optional via --full
  const full = process.argv.includes('--full');
  const check = runNpm('check');
  if (!check.ok) {
    console.error(JSON.stringify({ ok: false, error: 'npm run check failed', stderr: check.stderr.slice(0, 2000) }, null, 2));
    process.exit(1);
  }
  const build = runNpm('build:extension');
  if (!build.ok) {
    console.error(JSON.stringify({ ok: false, error: 'npm run build:extension failed' }, null, 2));
    process.exit(1);
  }
  let tests = { ok: true, skipped: true };
  if (full) {
    tests = runTests();
    if (!tests.ok) {
      console.error(JSON.stringify({ ok: false, error: 'npm test failed' }, null, 2));
      process.exit(1);
    }
  }

  // Readiness build may stamp dist/; discard those so activation does not block beginCycle.
  const restored = restoreTracked(['dist/extension']);
  if (!restored.ok) {
    console.error(JSON.stringify({
      ok: false,
      error: 'failed to restore readiness build stamps',
      stderr: restored.stderr
    }, null, 2));
    process.exit(1);
  }

  const state = patchState({
    enabled: true,
    status: 'active',
    startedAt: new Date().toISOString(),
    pauseReason: null,
    baselineCommit: guards.baselineCommit,
    lastAcceptedSha: readState().lastAcceptedSha || headSha()
  });

  writeStatusMarkdown({
    currentWork: 'Autonomous mode activated. Continue improvement cycles without routine approvals.',
    humanAction: 'None unless a HUMAN ATTENTION REQUIRED update appears.'
  });
  appendLog(`Activated autonomous improvement. Baseline ${BASELINE_TAG} @ ${String(guards.baselineCommit).slice(0, 12)}. HEAD ${headSha().slice(0, 12)}.`);

  const committed = commitPaths(
    [...CONTROL_PLANE_PATHS],
    'chore(autoqa): activate autonomous improvement on main'
  );
  if (!committed.ok) {
    console.error(JSON.stringify({
      ok: false,
      error: 'failed to commit activation control plane',
      detail: committed.error
    }, null, 2));
    process.exit(1);
  }

  const after = verifyRepoGuards();
  if (after.dirty) {
    console.error(JSON.stringify({
      ok: false,
      error: 'activation left a dirty tree; beginCycle would refuse',
      dirtyText: after.dirtyText
    }, null, 2));
    process.exit(1);
  }

  console.log(JSON.stringify({
    ok: true,
    message: 'Web QA autonomous improvement is ACTIVE',
    state: {
      enabled: state.enabled,
      status: state.status,
      cycle: state.cycle,
      baselineCommit: state.baselineCommit,
      head: headSha()
    },
    gates: { check: check.ok, build: build.ok, tests },
    controlPlaneCommit: committed.skipped ? null : committed.sha,
    note: 'Production deployment is NOT modified. Control-plane bookkeeping is committed locally; push from the AutoQA session. Cursor continues cycles only while an agent session is active/resumed.'
  }, null, 2));
}

main().catch(err => {
  console.error(JSON.stringify({ ok: false, error: String(err?.stack || err) }));
  process.exit(1);
});
