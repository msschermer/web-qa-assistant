import fs from 'node:fs';
import { STATUS_MD, LOG_MD } from './paths.mjs';
import { headSha, shortSha } from './cycle.mjs';
import { readState } from './state.mjs';

export function writeStatusMarkdown(extra = {}) {
  const state = readState();
  const head = shortSha(headSha());
  const body = `# Web QA Autonomous Improvement

Status: ${String(state.status || 'inactive').toUpperCase()}
Enabled: ${state.enabled ? 'yes' : 'no'}
Baseline: ${state.baselineTag || 'v1.7.5'} (\`${String(state.baselineCommit || '').slice(0, 12)}\`)
Current main: \`${head}\`
Cycle: ${state.cycle}
${state.activeGoal ? `Active goal: ${state.activeGoal}\n` : ''}${state.pauseReason ? `Pause reason: ${state.pauseReason}\n` : ''}
## Current quality
${extra.qualityBlock || '_Baseline evaluation recorded under `.autoqa/baseline/`. Scores populate after dogfood cycles._'}

## Last accepted change
${extra.lastAccepted || (state.lastAcceptedSha ? `Commit \`${String(state.lastAcceptedSha).slice(0, 12)}\`` : 'None yet (bootstrap).')}

## Current work
${extra.currentWork || (state.enabled ? 'Awaiting next autonomous cycle.' : 'Autonomous mode is OFF.')}

## Human action
${extra.humanAction || 'None.'}
`;
  fs.writeFileSync(STATUS_MD, body);
  return STATUS_MD;
}

export function appendLog(entry) {
  const line = `\n## ${new Date().toISOString()}\n\n${String(entry).trim()}\n`;
  if (!fs.existsSync(LOG_MD)) {
    fs.writeFileSync(LOG_MD, `# AutoQA log\n\nConcise chronological cycle history. Details live under \`.autoqa/runs/\`.\n${line}`);
  } else {
    fs.appendFileSync(LOG_MD, line);
  }
  return LOG_MD;
}
