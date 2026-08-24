import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const api=fs.readFileSync('services/api/server.js','utf8');
const bg=fs.readFileSync('apps/extension/background.js','utf8');
const html=fs.readFileSync('apps/extension/sidepanel.html','utf8');
const compose=fs.readFileSync('docker-compose.yml','utf8');

test('normal installs can obtain managed access without a bundled shared secret',()=>{
  assert.match(api,/\/api\/install\/register/);
  assert.match(api,/issueInstallationToken/);
  assert.match(bg,/registerManagedAccess/);
  assert.match(bg,/installTokenExpiresAt/);
  assert.match(html,/Developer access key/);
  assert.match(html,/Leave blank for managed installation access/);
  assert.doesNotMatch(bg,/ASSISTANT_ACCESS_TOKEN/);
});

test('managed public access is explicit, opt-in, expiring and quota limited',()=>{
  assert.match(compose,/PUBLIC_EXTENSION_ACCESS_ENABLED: \$\{PUBLIC_EXTENSION_ACCESS_ENABLED:-false\}/);
  assert.match(compose,/INSTALL_TOKEN_TTL_MS/);
  assert.match(compose,/INSTALL_AI_DAILY_LIMIT/);
  assert.match(api,/consumeManagedAiQuota/);
  assert.match(api,/INSTALL_DAILY_LIMIT/);
});

test('connection health probes whether Frank AI is operational, not only configured',()=>{
  assert.match(api,/probeAiHealth\(\{ force:/);
  assert.match(bg,/Frank AI operational/);
  assert.match(bg,/Frank AI configured but not operational/);
});
