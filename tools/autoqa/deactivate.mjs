#!/usr/bin/env node
/**
 * Deactivate Web QA autonomous improvement.
 * Restores dirty candidate tree to preCycleSha when present.
 */

import { patchState, readState } from './lib/state.mjs';
import { rejectAndRestore, headSha } from './lib/cycle.mjs';
import { writeStatusMarkdown, appendLog } from './lib/status.mjs';

async function main() {
  const state = readState();
  let restore = null;
  if (state.preCycleSha) {
    restore = rejectAndRestore(state.preCycleSha);
    if (!restore.ok) {
      console.error(JSON.stringify({ ok: false, error: 'failed to restore preCycleSha', restore }, null, 2));
      process.exit(1);
    }
  }

  const next = patchState({
    enabled: false,
    status: 'inactive',
    activeGoal: null,
    preCycleSha: null,
    pauseReason: null
  });

  writeStatusMarkdown({
    currentWork: 'Autonomous mode deactivated.',
    humanAction: 'None.'
  });
  appendLog(`Deactivated autonomous improvement. HEAD ${headSha().slice(0, 12)}.${restore?.ok ? ` Restored interrupted candidate to ${restore.restoredTo.slice(0, 12)}.` : ''}`);

  console.log(JSON.stringify({
    ok: true,
    message: 'Web QA autonomous improvement is INACTIVE',
    state: { enabled: next.enabled, status: next.status, cycle: next.cycle },
    restore
  }, null, 2));
}

main().catch(err => {
  console.error(JSON.stringify({ ok: false, error: String(err?.stack || err) }));
  process.exit(1);
});
