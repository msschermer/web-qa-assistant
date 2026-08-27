import fs from 'node:fs';
import { STATE_PATH, ensureAutoqaDirs } from './paths.mjs';

const DEFAULT_STATE = {
  enabled: false,
  baselineVersion: '1.7.5',
  baselineTag: 'v1.7.5',
  baselineCommit: '33e378fd18de5f0c4afd855b7205670faff5be0f',
  cycle: 0,
  status: 'inactive',
  activeGoal: null,
  preCycleSha: null,
  lastAcceptedSha: null,
  startedAt: null,
  lastCycleAt: null,
  pauseReason: null,
  repoRootExpected: 'C:/Users/mike/dev/web-qa-assistant',
  remoteExpected: 'msschermer/web-qa-assistant',
  branchExpected: 'main'
};

export function readState() {
  ensureAutoqaDirs();
  if (!fs.existsSync(STATE_PATH)) {
    writeState(DEFAULT_STATE);
    return { ...DEFAULT_STATE };
  }
  return { ...DEFAULT_STATE, ...JSON.parse(fs.readFileSync(STATE_PATH, 'utf8')) };
}

export function writeState(next) {
  ensureAutoqaDirs();
  const merged = { ...DEFAULT_STATE, ...next };
  fs.writeFileSync(STATE_PATH, `${JSON.stringify(merged, null, 2)}\n`);
  return merged;
}

export function patchState(partial) {
  return writeState({ ...readState(), ...partial });
}

export function isEnabled(state = readState()) {
  return state.enabled === true && state.status === 'active';
}
