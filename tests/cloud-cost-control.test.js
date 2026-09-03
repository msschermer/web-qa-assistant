import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const api=fs.readFileSync('services/api/server.js','utf8');
const bg=fs.readFileSync('apps/extension/background.js','utf8');
const panel=fs.readFileSync('apps/extension/sidepanel.js','utf8');
const html=fs.readFileSync('apps/extension/sidepanel.html','utf8');
const env=fs.readFileSync('.env.example','utf8');
const compose=fs.readFileSync('docker-compose.yml','utf8');

test('normal extension scans never invoke metered cloud AI',()=>{
  assert.match(api,/await enrich\(req\.body, req\.webQaRequestId, \{ allowAi: false \}\)/);
  assert.doesNotMatch(api.slice(api.indexOf("app.post('/api/context'"),api.indexOf("app.post('/api/brief'")),/consumeManagedAiQuota/);
  assert.match(env,/EXTENSION_CLOUD_AI_ENABLED=false/);
  assert.match(compose,/EXTENSION_CLOUD_AI_ENABLED: \$\{EXTENSION_CLOUD_AI_ENABLED:-false\}/);
});

test('cloud Frank is double opt-in: server gate plus extension user setting',()=>{
  assert.match(api,/if \(!extensionCloudAiEnabled\(\)\) return res\.status\(403\).*CLOUD_AI_DISABLED/);
  assert.match(panel,/plan\.mode !== 'ai' && cloudAiFallback/);
  assert.match(html,/id="cloud-ai-fallback"/);
  assert.match(html,/optional · metered/);
  assert.match(bg,/cloudAiFallback:false/);
});

test('Chrome built-in AI is the default walkthrough path and starts from the Walk through gesture',()=>{
  const start=panel.indexOf('async function startFrank');
  const prepare=panel.indexOf("type: 'PREPARE_FRANK'",start);
  const local=panel.indexOf('activateFromGesture',start);
  assert.ok(local>start && local<prepare,'on-device preparation must begin directly from the Walk through gesture');
  assert.match(panel,/provider: 'chrome-built-in'/);
  assert.match(panel,/No metered AI request was used/);
  assert.match(bg,/FRANK_START_PLAN/);
});

test('gateway health does not mark optional cloud AI as a required integration',()=>{
  const block=bg.slice(bg.indexOf('async function testGateway'),bg.indexOf('function localOnlyCoverage'));
  assert.doesNotMatch(block,/problems\.push\(`Frank AI/);
  assert.doesNotMatch(block,/Frank AI configured but not operational/);
});
