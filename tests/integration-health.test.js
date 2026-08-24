import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const connectors = fs.readFileSync('packages/connectors/connectors.js', 'utf8');
const background = fs.readFileSync('apps/extension/background.js', 'utf8');
const panel = fs.readFileSync('apps/extension/sidepanel.js', 'utf8');

// Defect found in acceptance: a 404 from a health endpoint was reported as
// "available", which hid a misconfigured integration URL entirely.
test('a health endpoint that returns 404 is not reported as available', () => {
  assert.doesNotMatch(connectors, /res\.ok \|\| res\.status < 500 \? 'available'/,
    'reachability was being treated as availability');
  assert.match(connectors, /code === 404 \|\| code === 410/);
  assert.match(connectors, /'not-found'/);
});

test('an unauthorised health endpoint is distinguished from an unavailable one', () => {
  assert.match(connectors, /code === 401 \|\| code === 403/);
  assert.match(connectors, /'unauthorized'/);
  assert.match(connectors, /reachable: true/);
  assert.match(connectors, /reachable: false/);
});

test('every integration status carries an actionable detail string', () => {
  assert.match(connectors, /integration access token or service policy/);
  assert.match(connectors, /integration URL\/path/);
  assert.match(connectors, /could not be reached/);
});

// Health must validate the actual capability route, not a guessed /health URL.


test('integration health probes the same capability contracts used during scans', () => {
  assert.match(connectors, /META_STATE_HEALTH_PATH[\s\S]*META_STATE_PATH[\s\S]*\/api\/inspect/);
  assert.match(connectors, /Performance Monitor'[\s\S]*\/api\/data/);
  assert.match(connectors, /WCAG Translator'[\s\S]*query: 'alt'[\s\S]*version: '2\.2'/);
  assert.match(connectors, /method: 'POST', body: \{ url: 'https:\/\/example\.com\/' \}/);
  assert.match(connectors, /Capability probe succeeded/);
});

// Second acceptance defect: Test connection could not tell the difference
// between "the gateway is down" and "the gateway is protected and rejected us".
test('test connection separates reachability from authorisation', () => {
  assert.match(background, /reachable:false,auth:'unknown'/);
  assert.match(background, /'rejected':'required'/);
  assert.match(background, /status===401/);
  assert.match(background, /assistant access was rejected/);
  assert.match(background, /managed installation access/);
  assert.match(background, /developer access key may be required/);
});

test('the panel surfaces per-integration status rather than a single count', () => {
  assert.match(panel, /gateway-integrations/);
  assert.match(panel, /integration-row/);
  assert.match(panel, /r\.reachable/);
});

test('a rejected key is shown as a warning, not as a healthy connection', () => {
  assert.match(panel, /auth === 'rejected'/);
  assert.match(panel, /'warn'/);
});


test('scan enrichment distinguishes missing and rejected gateway keys from an outage', () => {
  assert.match(background, /connectedMode=status===401\?\(\(s\.apiKey\|\|s\.installToken\)\?'auth-rejected':'auth-required'\)/);
  assert.match(panel, /report\.connectedMode === 'auth-required'/);
  assert.match(panel, /report\.connectedMode === 'auth-rejected'/);
  assert.match(panel, /assistant gateway could not be reached/);
});

test('connection test checks the values currently visible in the form', () => {
  assert.match(panel, /type: 'TEST_GATEWAY', apiBase, apiKey, cloudAiFallback/);
  assert.match(background, /testGateway\(\{apiBase:msg\.apiBase,apiKey:msg\.apiKey,cloudAiFallback:Boolean\(msg\.cloudAiFallback\)\}\)/);
  assert.match(panel, /Saving first is not required/);
});

test('saving connection settings immediately validates them and resolves the verifying notice', () => {
  assert.match(panel, /Connection settings saved\. Verifying them now/);
  assert.match(panel, /const verification = await runGatewayTest\(\)/);
  assert.match(panel, /connectionVerificationNotice\(verification\)/);
  assert.match(panel, /Connection settings saved and verified\./);
  assert.match(panel, /access key was rejected/);
  assert.match(panel, /integration\$\{problems === 1/);
});
