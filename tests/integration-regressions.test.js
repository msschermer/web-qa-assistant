import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { correlate } from '../packages/findings/correlate.js';

function read(path){ return fs.readFileSync(path,'utf8'); }

test('legacy Preflight connector is removed from active correlation and runtime architecture', () => {
  const local = { page: { url: 'https://example.com/' }, findings: [] };
  const context = {
    meta: {}, performance: {}, wcag: { data: { mapping: {} } },
    preflight: { status: 'complete', data: { findings: [{ ruleId:'preflight.indexing.noindex', title:'Noindex', detail:'Found noindex', category:'fix', severity:'high' }] } }
  };
  const out = correlate(local, context);
  assert.equal(out.some(f => String(f.ruleId).startsWith('preflight.')), false);
  assert.equal(fs.existsSync('apps/extension/connected.js'), false);
  const manifest = JSON.parse(read('apps/extension/manifest.json'));
  assert.equal(manifest.host_permissions.some(p => /preflight|meta-state|psi\.msschermer|wcag-translator/i.test(p)), false);
});

test('extension uses one assistant gateway rather than direct specialized-service adapters', () => {
  const bg = read('apps/extension/background.js');
  const api = read('services/api/server.js');
  const connectors = read('packages/connectors/connectors.js');
  const manifest = JSON.parse(read('apps/extension/manifest.json'));
  assert.match(bg, /gatewayPost\('\/api\/context'/);
  assert.match(bg, /gatewayPost\('\/api\/frank\/plan'/);
  assert.match(api, /app\.post\('\/api\/context'/);
  assert.match(connectors, /TOOL_REGISTRY/);
  assert.deepEqual(manifest.host_permissions,[
    'https://assistant.msschermer.us/*',
    'http://localhost:3000/*',
    'http://localhost:8787/*'
  ]);
});

test('legacy Explain path is removed and gateway JSON handling stays robust', () => {
  const bg = read('apps/extension/background.js');
  const api = read('services/api/server.js');
  assert.doesNotMatch(bg, /deterministicExplanation|type==='EXPLAIN'|type === 'EXPLAIN'/);
  assert.doesNotMatch(api, /\/api\/explain|explainFinding/);
  assert.match(bg, /empty response/);
  assert.doesNotMatch(bg, /return await r\.json\(\)/);
});

test('side panel gives useful action feedback and supports copyable diagnostics', () => {
  const panel = read('apps/extension/sidepanel.js');
  const html = read('apps/extension/sidepanel.html');
  assert.match(panel, /Highlighted on page/);
  assert.match(panel, /Issue handoff copied/);
  assert.match(panel, /extension action timed out/i);
  assert.match(panel, /showFailure/);
  assert.match(panel, /Diagnostics copied/);
  assert.match(html, /Latest technical error/);
  assert.match(html, /Copy technical error/);
  assert.match(html, /Report a bug/);
});

test('rescan, highlight and recheck stay bound to the inspected tab', () => {
  const bg = read('apps/extension/background.js');
  const panel = read('apps/extension/sidepanel.js');
  assert.match(bg, /msg\.type==='SCAN_TAB'/);
  assert.match(bg, /scanExistingTab\(msg\.tabId\)/);
  assert.match(bg, /msg\.type==='RECHECK_FINDING'/);
  assert.match(panel, /type: 'SCAN_TAB'/);
  assert.match(panel, /type: 'RECHECK_FINDING'/);
  assert.match(panel, /tabId: tab\?\.id/);
});

test('link audit runs in enrichment instead of blocking the first local scan', () => {
  const content = read('apps/extension/content.js');
  const bg = read('apps/extension/background.js');
  assert.match(content, /AUDIT_LINKS/);
  const scanBlock = content.slice(content.indexOf('async function scan()'), content.indexOf('async function auditLinks()'));
  assert.doesNotMatch(scanBlock, /auditLinks\(/);
  assert.match(bg, /addLinkAudit/);
});

test('finding lifecycle is persisted only after enriched findings are available', () => {
  const bg = read('apps/extension/background.js');
  const localScanStart = bg.indexOf('async function localScan');
  const localScanEnd = bg.indexOf('async function addLinkAudit', localScanStart);
  const localScan = bg.slice(localScanStart, localScanEnd);
  assert.doesNotMatch(localScan, /updateState\(/);
  const enrichHandlerStart = bg.indexOf("if(msg.type==='ENRICH')");
  const enrichHandlerEnd = bg.indexOf("if(msg.type==='ASK_FRANK')", enrichHandlerStart);
  assert.match(bg.slice(enrichHandlerStart,enrichHandlerEnd), /updateState\(/);
  assert.match(bg, /resolvedItems/);
  assert.match(bg, /siteSessions/);
});

test('release build cannot silently ship stale extension files', () => {
  const pkg = JSON.parse(read('package.json'));
  const sourceManifest = JSON.parse(read('apps/extension/manifest.json'));
  const lock = JSON.parse(read('package-lock.json'));
  const distManifest = JSON.parse(read('dist/extension/manifest.json'));
  const distPanel = read('dist/extension/sidepanel.html');
  const distBackground = read('dist/extension/background.js');
  assert.equal(sourceManifest.version, pkg.version);
  assert.equal(lock.version, pkg.version);
  assert.equal(lock.packages[''].version, pkg.version);
  assert.equal(distManifest.version, sourceManifest.version);
  assert.match(distPanel, /Ask Frank/);
  assert.match(distPanel, /Technical evidence/);
  assert.doesNotMatch(distPanel, />Explain</);
  assert.doesNotMatch(distBackground, /return await r\.json\(\)/);
});

test('standalone renderer can use installed Chrome or Chromium without a Playwright browser download', () => {
  const renderer = read('services/renderer/server.js');
  const dev = read('scripts/dev.mjs');
  assert.match(renderer, /CHROMIUM_EXECUTABLE_PATH/);
  assert.match(renderer, /resolvedChromium/);
  assert.match(dev, /CHROMIUM_EXECUTABLE_PATH/);
});

test('web and extension surfaces lead with Frank judgment while preserving quiet checks', () => {
  const web = read('apps/web/public/app.js');
  const webHtml = read('apps/web/public/index.html');
  const panel = read('apps/extension/sidepanel.js');
  const panelHtml = read('apps/extension/sidepanel.html');
  assert.match(web, /visibleFindings/);
  assert.match(web, /f\.frankVisible!==false/);
  assert.match(webHtml, /Show all checks/);
  assert.match(panel, /judgment\(\)/);
  assert.match(panelHtml, /id="frank-overview"/);
  assert.match(panelHtml, /Technical evidence/);
  assert.match(panelHtml, /Site session/);
  assert.match(panelHtml, /Resolved this scan/);
});

test('local development serves the complete stack on port 3000', () => {
  const pkg = JSON.parse(read('package.json'));
  const dev = read('scripts/dev.mjs');
  const bg = read('apps/extension/background.js');
  assert.equal(pkg.scripts.dev, 'node scripts/dev.mjs');
  assert.ok(dev.includes('localhost:${port}'));
  assert.ok(dev.includes('services/renderer/server.js'));
  assert.ok(dev.includes('services/egress-proxy/server.js'));
  assert.ok(bg.includes('http://localhost:3000'));
});

test('localScan is safe from the 1.2.0 const reassignment regression', () => {
  const bg = read('apps/extension/background.js');
  const start = bg.indexOf('async function localScan');
  const end = bg.indexOf('async function addLinkAudit', start);
  const block = bg.slice(start, end);
  assert.match(block, /let report=await chrome\.tabs\.sendMessage/);
  assert.doesNotMatch(block, /const report=await chrome\.tabs\.sendMessage/);
  assert.match(block, /return contextualize\(report\)/);
});

test('coverage keeps unverified links separate from real findings', () => {
  const bg = read('apps/extension/background.js');
  const panel = read('apps/extension/sidepanel.js');
  const html = read('apps/extension/sidepanel.html');
  assert.match(bg, /incompleteChecks/);
  assert.match(panel, /were not counted as broken links/);
  assert.match(html, /coverage-notes/);
});

test('finding cards expose confidence, recheck and team handoff', () => {
  const panel = read('apps/extension/sidepanel.js');
  const html = read('apps/extension/sidepanel.html');
  assert.match(html, /chip-confidence/);
  assert.match(panel, /f\.confidence/);
  assert.match(html, /class="recheck/);
  assert.match(html, /Copy issue/);
  assert.match(panel, /Acceptance: Rescan/);
});

test('gateway exposes request IDs, protected extension routes and integration health', () => {
  const api = read('services/api/server.js');
  assert.match(api, /X-Web-QA-Request-ID/);
  assert.match(api, /ASSISTANT_ACCESS_TOKEN/);
  assert.match(api, /app\.get\('\/api\/health\/integrations',\s*requireExtensionKey/);
  assert.match(api, /requireExtensionKey/);
  assert.match(api, /app\.post\('\/api\/context',\s*requireExtensionKey/);
  assert.match(api, /app\.post\('\/api\/frank\/plan',\s*requireExtensionKey/);
});

test('GitHub CI and release packaging are part of the repository', () => {
  const ci = read('.github/workflows/ci.yml');
  const release = read('.github/workflows/release.yml');
  assert.match(ci, /npm ci/);
  assert.match(ci, /npm run build:extension/);
  assert.match(ci, /npm run check/);
  assert.match(ci, /npm test/);
  assert.match(release, /release:validate/);
  assert.match(release, /web-qa-assistant-extension-/);
  assert.match(release, /web-qa-assistant-full-/);
});


test('gateway context and Frank requests are sanitized before leaving the extension',()=>{
  const bg=read('apps/extension/background.js');
  const build=read('scripts/build-extension.mjs');
  assert.match(bg,/gatewayContextEnvelope\(report\)/);
  assert.match(bg,/gatewayFrankGraph\(graph\)/);
  assert.match(build,/evidence-contract\.js/);
});

test('connected finding recheck uses the enriched scan rather than falsely resolving from local-only evidence',()=>{
  const bg=read('apps/extension/background.js');
  const start=bg.indexOf('async function recheckFinding');
  const end=bg.indexOf('async function frankMessage',start);
  const block=bg.slice(start,end);
  assert.match(block,/current=await enrich\(current,tabId\)/);
  assert.match(block,/current verified scan/);
});

test('custom gateway setup requests only the selected origin and can test connection health',()=>{
  const panel=read('apps/extension/sidepanel.js');
  const html=read('apps/extension/sidepanel.html');
  const bg=read('apps/extension/background.js');
  assert.match(panel,/chrome\.permissions\.request\(\{ origins: \[pattern\] \}\)/);
  assert.match(panel,/type: 'TEST_GATEWAY'/);
  assert.match(html,/Test connection/);
  assert.match(html,/gateway-status/);
  assert.match(bg,/msg\.type==='TEST_GATEWAY'/);
  assert.match(bg,/\/api\/health\/integrations/);
});

test('public web scanner and extension cloud AI remain opt-in while the extension prefers on-device reasoning',()=>{
  const api=read('services/api/server.js');
  const env=read('.env.example');
  assert.match(api,/function publicAiEnabled/);
  assert.match(api,/if \(publicAiEnabled\(\)\) \{/);
  assert.match(api,/reasoning = \{ status: 'operational', mode: 'ai'/);
  assert.match(api,/allowAi: publicAiEnabled\(\)/);
  assert.match(env,/PUBLIC_AI_ENABLED=false/);
  assert.match(env,/EXTENSION_CLOUD_AI_ENABLED=false/);
  assert.match(api,/preferredFrankAi: 'chrome-built-in'/);
});


test('extension manifest pins a stable unpacked identity for settings continuity',()=>{
  const manifest=JSON.parse(read('apps/extension/manifest.json'));
  assert.equal(manifest.version,'1.7.1');
  assert.match(manifest.key,/^[A-Za-z0-9+/=]+$/);
  assert.ok(manifest.key.length>300);
});

test('a configured custom gateway is authoritative rather than silently falling back',()=>{
  const bg=read('apps/extension/background.js');
  assert.match(bg,/if\(s\.apiBase\)return\[s\.apiBase\.replace/);
  assert.match(bg,/\[401,403\]\.includes/);
});
