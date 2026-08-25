import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const panel=fs.readFileSync('apps/extension/sidepanel.js','utf8');
const html=fs.readFileSync('apps/extension/sidepanel.html','utf8');
const content=fs.readFileSync('apps/extension/content.js','utf8');

test('scan overview does not imply that AI ran before Ask Frank',()=>{
  assert.match(html,/id="reasoning-mode"[^>]*>Evidence-backed assessment</);
  assert.doesNotMatch(panel.slice(panel.indexOf('async function rescan'),panel.indexOf('async function updateWatch')),/connected reasoning/i);
});

test('Frank states distinguish on-device, optional cloud, and deterministic guidance',()=>{
  assert.match(panel,/On-device reasoning/);
  assert.match(panel,/Cloud reasoning/);
  assert.match(panel,/Verified guidance/);
  assert.doesNotMatch(html,/Standard guidance/);
});

test('Frank walkthrough restores keyboard focus and announces changing step content',()=>{
  assert.match(panel,/frankReturnFocus\s*=\s*button/);
  assert.match(panel,/returnFocus\?\.isConnected && returnFocus\.focus\(\)/);
  assert.match(content,/class=\"body\" aria-live=\"polite\" aria-atomic=\"true\"/);
  assert.match(html,/id="frank-ledger-title" tabindex="-1"/);
  assert.match(panel,/SAVE_WORKSPACE_SNAPSHOT/);
  assert.match(panel,/window\.close\(\)/);
  assert.match(content,/RETURN_TO_QA/);
  assert.match(content,/querySelector\('\.coach'\)\?\.focus/);
});

test('cloud fallback is visibly optional and metered',()=>{
  assert.match(html,/Cloud AI fallback/);
  assert.match(html,/optional · metered/);
  assert.match(html,/id="cloud-ai-fallback" type="checkbox"/);
});
