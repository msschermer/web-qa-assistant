import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { REPO_ROOT, EXPECTED_REMOTE, EXPECTED_BRANCH, BASELINE_TAG, RUNS_DIR, ACCEPTED_DIR, cycleDirName, ensureAutoqaDirs } from './paths.mjs';
import { readState, patchState } from './state.mjs';

function git(args, opts = {}) {
  const r = spawnSync('git', args, {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    ...opts
  });
  return {
    status: r.status ?? 1,
    stdout: String(r.stdout || '').trim(),
    stderr: String(r.stderr || '').trim()
  };
}

export function verifyRepoGuards(state = readState()) {
  const errors = [];
  const root = git(['rev-parse', '--show-toplevel']).stdout.replace(/\\/g, '/');
  const expected = String(state.repoRootExpected || '').replace(/\\/g, '/');
  if (expected && root.toLowerCase() !== expected.toLowerCase()) {
    errors.push(`repo root mismatch: ${root} != ${expected}`);
  }
  const remote = git(['remote', 'get-url', 'origin']).stdout;
  if (!remote.includes(EXPECTED_REMOTE)) {
    errors.push(`origin remote is not ${EXPECTED_REMOTE}: ${remote}`);
  }
  const branch = git(['branch', '--show-current']).stdout;
  if (branch !== EXPECTED_BRANCH) {
    errors.push(`current branch is ${branch || '(detached)'}, expected ${EXPECTED_BRANCH}`);
  }
  const tag = git(['rev-list', '-n', '1', BASELINE_TAG]);
  if (tag.status !== 0 || !tag.stdout) {
    errors.push(`baseline tag ${BASELINE_TAG} missing`);
  }
  const dirty = git(['status', '--porcelain']).stdout;
  return {
    ok: errors.length === 0,
    errors,
    root,
    remote,
    branch,
    baselineCommit: tag.stdout || state.baselineCommit,
    dirty: Boolean(dirty),
    dirtyText: dirty
  };
}

export function headSha() {
  return git(['rev-parse', 'HEAD']).stdout;
}

export function shortSha(sha = headSha()) {
  return String(sha || '').slice(0, 12);
}

export function beginCycle({ goal = null } = {}) {
  const guards = verifyRepoGuards();
  if (!guards.ok) {
    return { ok: false, error: guards.errors.join('; '), guards };
  }
  if (guards.dirty) {
    return { ok: false, error: 'working tree is dirty; refuse to begin cycle', guards };
  }
  const preCycleSha = headSha();
  const state = patchState({
    preCycleSha,
    activeGoal: goal,
    status: readState().enabled ? 'active' : readState().status
  });
  ensureAutoqaDirs();
  const dir = path.join(RUNS_DIR, cycleDirName(state.cycle + 1));
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'pre-cycle.json'), `${JSON.stringify({
    preCycleSha,
    goal,
    startedAt: new Date().toISOString()
  }, null, 2)}\n`);
  return { ok: true, preCycleSha, cycle: state.cycle + 1, runDir: dir, guards };
}

/**
 * Restore tracked files to preCycleSha. Preserves .autoqa/runs artifacts.
 * Does not delete untracked AutoQA evidence under .autoqa/runs.
 */
export function rejectAndRestore(preCycleSha = readState().preCycleSha) {
  if (!preCycleSha) return { ok: false, error: 'preCycleSha missing' };
  const reset = git(['reset', '--hard', preCycleSha]);
  if (reset.status !== 0) {
    return { ok: false, error: reset.stderr || reset.stdout || 'git reset --hard failed' };
  }
  // Remove untracked candidate source files. Preserve AutoQA memory, runs, corpus, and harness.
  const clean = git([
    'clean', '-fd',
    '--exclude=.autoqa',
    '--exclude=qa-sites',
    '--exclude=tools/autoqa',
    '--exclude=AUTOQA_STATUS.md',
    '--exclude=AUTOQA_LOG.md',
    '--exclude=.cursor',
    '--exclude=qa-runs',
    '--exclude=node_modules',
    '--exclude=dist'
  ]);
  if (clean.status !== 0) {
    return { ok: false, error: clean.stderr || 'git clean failed', resetOk: true };
  }
  patchState({ preCycleSha: null, activeGoal: null });
  return { ok: true, restoredTo: preCycleSha, head: headSha() };
}

export function acceptCommit({ message, cycle, metadata = {} }) {
  const add = git(['add', '-A', '--', '.', ':(exclude).autoqa/runs', ':(exclude).autoqa/profiles', ':(exclude)qa-runs']);
  if (add.status !== 0) return { ok: false, error: add.stderr || 'git add failed' };
  const staged = git(['diff', '--cached', '--name-only']).stdout;
  if (!staged) return { ok: false, error: 'nothing staged to commit' };
  const commit = git(['commit', '-m', message]);
  if (commit.status !== 0) return { ok: false, error: commit.stderr || commit.stdout || 'git commit failed' };
  const sha = headSha();
  ensureAutoqaDirs();
  const metaPath = path.join(ACCEPTED_DIR, `cycle-${String(cycle).padStart(4, '0')}.json`);
  fs.writeFileSync(metaPath, `${JSON.stringify({
    cycle,
    commit: sha,
    parent: metadata.parent || null,
    message,
    judge: metadata.judge || null,
    artifacts: metadata.artifacts || [],
    acceptedAt: new Date().toISOString()
  }, null, 2)}\n`);
  patchState({
    lastAcceptedSha: sha,
    preCycleSha: null,
    activeGoal: null,
    cycle: Number(cycle) || readState().cycle,
    lastCycleAt: new Date().toISOString()
  });
  return { ok: true, sha, metaPath };
}

export function pushMain() {
  const branch = git(['branch', '--show-current']).stdout;
  if (branch !== EXPECTED_BRANCH) {
    return { ok: false, error: `refuse push from branch ${branch}` };
  }
  const remote = git(['remote', 'get-url', 'origin']).stdout;
  if (!remote.includes(EXPECTED_REMOTE)) {
    return { ok: false, error: `refuse push to unexpected remote ${remote}` };
  }
  const push = git(['push', 'origin', 'HEAD']);
  if (push.status !== 0) return { ok: false, error: push.stderr || push.stdout || 'git push failed' };
  return { ok: true, stdout: push.stdout };
}

export function runNpm(script, env = {}) {
  const r = spawnSync('npm', ['run', script], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    env: { ...process.env, ...env },
    shell: true
  });
  return { ok: r.status === 0, status: r.status, stdout: r.stdout || '', stderr: r.stderr || '' };
}

export function runTests() {
  const r = spawnSync('npm', ['test'], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    shell: true
  });
  const out = `${r.stdout || ''}\n${r.stderr || ''}`;
  const passMatch = out.match(/ℹ pass (\d+)/);
  const failMatch = out.match(/ℹ fail (\d+)/);
  const testsMatch = out.match(/ℹ tests (\d+)/);
  return {
    ok: r.status === 0,
    status: r.status,
    passed: passMatch ? Number(passMatch[1]) : 0,
    failed: failMatch ? Number(failMatch[1]) : (r.status === 0 ? 0 : 1),
    total: testsMatch ? Number(testsMatch[1]) : 0,
    stdout: r.stdout || '',
    stderr: r.stderr || ''
  };
}
