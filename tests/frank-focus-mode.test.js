import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

test('Ask Frank focus mode persists workspace before closing the side panel', () => {
  const panel = fs.readFileSync('apps/extension/sidepanel.js', 'utf8');
  const bg = fs.readFileSync('apps/extension/background.js', 'utf8');
  const content = fs.readFileSync('apps/extension/content.js', 'utf8');

  assert.match(panel, /SAVE_WORKSPACE_SNAPSHOT/);
  assert.match(panel, /window\.close\(\)/);
  assert.match(panel, /restoreWorkspaceOrRescan/);
  assert.match(panel, /Returned to QA with your previous scan/);
  assert.match(bg, /RETURN_TO_QA/);
  assert.match(bg, /chrome\.sidePanel\.open\(\{windowId\}\)/);
  assert.match(bg, /chrome\.storage\.session/);
  assert.match(bg, /withCoachMetrics/);
  assert.match(content, /Return to QA/);
  assert.match(content, /RETURN_TO_QA/);
  assert.doesNotMatch(content, /in the sidebar/);
});
