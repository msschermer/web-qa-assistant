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
    'http://localhost:8787/*',
    'http://127.0.0.1:3000/*',
    'http://127.0.0.1:8787/*'
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
  assert.match(panel, /Highlighted the exact affected element/);
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
  assert.match(distPanel, /Walk through/);
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
  assert.match(web, /buildCoverageAccounting/);
  assert.match(panel, /labDegraded|Historical monitor from monitor evidence/);
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
  assert.match(read('services/api/server.js'), /\/assets\/coverage\.js/);
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
  assert.match(panel, /Acceptance: Start a new scan/);
});

test('scanning again always targets the currently active tab, and the button reads "New scan"', () => {
  const panel = read('apps/extension/sidepanel.js');
  assert.match(panel, /textContent = 'New scan'/);
  assert.doesNotMatch(panel, /textContent = 'Rescan'/);
  const start = panel.indexOf('async function rescan');
  const end = panel.indexOf('async function updateWatch');
  const rescanBlock = panel.slice(start, end);
  // A stale cached `tab` from a previous scan must be refreshed from the real
  // active tab before deciding which tab to scan — otherwise switching tabs or
  // navigating without closing/reopening the panel silently re-scans the
  // wrong page (SCAN_TAB with an old id) instead of the page actually on screen.
  assert.match(rescanBlock, /type: 'GET_ACTIVE' \}/);
  const activeIdx = rescanBlock.indexOf("type: 'GET_ACTIVE'");
  const scanTabIdx = rescanBlock.indexOf("type: 'SCAN_TAB'");
  assert.ok(activeIdx >= 0 && scanTabIdx > activeIdx, 'the active tab must be refreshed before the SCAN_TAB/SCAN_ACTIVE decision');
});

test('New scan recovers from a missing activeTab grant by requesting site permission and retrying once', () => {
  const panel = read('apps/extension/sidepanel.js');
  // Chrome only grants activeTab to the tab that was active when the user
  // clicked the toolbar icon. Switching tabs while the panel stays open does
  // not extend that grant, so a scan on the newly active tab fails until the
  // user re-invokes the extension via the icon — the exact "close and reopen"
  // workaround this fix is meant to eliminate. The fallback below is the one
  // legitimate way around it: request permission for just that origin (the
  // same mechanism as "Watch this site") and retry, instead of dead-ending.
  assert.match(panel, /function isPageAccessError\(r\)/);
  assert.match(panel, /page access expired\|cannot access\|missing host permission\|activetab/i);
  assert.match(panel, /async function requestScanPermission\(url\)/);
  assert.match(panel, /chrome\.permissions\.request\(\{ origins: \[pattern\] \}\)/);
  const start = panel.indexOf('async function rescan');
  const end = panel.indexOf('async function updateWatch');
  const rescanBlock = panel.slice(start, end);
  assert.match(rescanBlock, /isPageAccessError\(r\)/);
  assert.match(rescanBlock, /requestScanPermission\(tab\?\.url\)/);
  // The retry must re-send the same scan request, not just request permission
  // and stop — a permission grant with no follow-up scan is still a dead end.
  const firstSend = rescanBlock.indexOf("type: 'SCAN_TAB'");
  const retrySend = rescanBlock.indexOf("type: 'SCAN_TAB'", firstSend + 1);
  assert.ok(retrySend > firstSend, 'a granted permission must trigger a second scan attempt on the same tab');
});

test('the side panel is per-tab like DevTools, not a single panel shared across every tab in the window', () => {
  const bg = read('apps/extension/background.js');
  // The manifest's side_panel.default_path enables the panel globally for
  // every tab by default. That has to be explicitly disabled at runtime
  // (setOptions with no tabId = the default for every tab), or Lumen stays
  // visible on every tab regardless of the per-tab enabling below.
  assert.match(bg, /function disableGlobalSidePanelDefault\(\)\{chrome\.sidePanel\.setOptions\(\{path:'sidepanel\.html',enabled:false\}\)/);
  const onInstalledIdx = bg.indexOf('chrome.runtime.onInstalled.addListener');
  const onStartupIdx = bg.indexOf('chrome.runtime.onStartup.addListener');
  assert.match(bg.slice(onInstalledIdx, onInstalledIdx + 160), /disableGlobalSidePanelDefault\(\)/);
  assert.match(bg.slice(onStartupIdx, onStartupIdx + 160), /disableGlobalSidePanelDefault\(\)/);
  // Only a fresh toolbar-icon click on a specific tab enables + opens Lumen
  // for that tab — this is also what keeps activeTab valid for scanning,
  // since the panel only ever becomes visible right after its own tab's click.
  const clickStart = bg.indexOf('chrome.action.onClicked.addListener');
  const clickEnd = bg.indexOf('\n});', clickStart);
  const clickBlock = bg.slice(clickStart, clickEnd);
  assert.match(clickBlock, /chrome\.sidePanel\.setOptions\(\{tabId:tab\.id,path:'sidepanel\.html',enabled:true\}\)/);
  assert.match(clickBlock, /chrome\.sidePanel\.open\(\{tabId:tab\.id\}\)/);
  assert.doesNotMatch(clickBlock, /chrome\.sidePanel\.open\(\{windowId/);
  // A closed tab's per-tab panel state must not linger for a future tab that reuses its id.
  assert.match(bg, /chrome\.tabs\.onRemoved\.addListener\(tabId=>\{chrome\.sidePanel\.setOptions\(\{tabId,enabled:false\}\)/);
});

test('broken-link findings can be highlighted even without a pre-registered targetId', () => {
  const panel = read('apps/extension/sidepanel.js');
  // Gateway-confirmed external link findings (safe-probe.js) never get a
  // targetId — there's no live DOM at probe time — only a selector captured
  // when the link was queued. Requiring targetId here hid Highlight for
  // exactly the broken-link findings most worth pointing at.
  assert.match(panel, /targetType === 'visual' && \(row\?\.targetId \|\| row\?\.selector\)/g);
  assert.match(panel, /if \(!target\?\.targetId && !target\?\.selector\)/);
});

test('"Likely owner" is no longer shown on finding cards', () => {
  const panel = read('apps/extension/sidepanel.js');
  assert.doesNotMatch(panel, /Likely owner/);
  assert.doesNotMatch(panel, /fixOwner/);
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
  assert.equal(manifest.version,'1.7.5');
  assert.match(manifest.key,/^[A-Za-z0-9+/=]+$/);
  assert.ok(manifest.key.length>300);
});

test('a configured custom gateway is authoritative rather than silently falling back',()=>{
  const bg=read('apps/extension/background.js');
  assert.match(bg,/if\(s\.apiBase\)return\[s\.apiBase\.replace/);
  assert.match(bg,/\[401,403\]\.includes/);
});

test('an unreachable or out-of-date gateway names its own cause, not a generic failure',()=>{
  // Reported symptom: after reinstalling the extension (which clears the
  // stored gateway URL), Start audit failed with only "The extension could not
  // complete this action." The real condition was knowable and had a specific
  // remedy — localhost was down and the fallback gateway predates /api/audits,
  // answering "Unknown API route." Two conditions, two different actions, and
  // the generic message named neither.
  const bg=read('apps/extension/background.js');
  const payload=bg.match(/function failurePayload\([\s\S]*?\n\}/);
  assert.ok(payload,'failurePayload should exist');
  const body=payload[0];
  // A gateway that answers but lacks the route is a version problem.
  assert.match(body,/Unknown API route/);
  assert.match(body,/older version/);
  // Nothing answering at all is a "start it or configure it" problem.
  assert.match(body,/Failed to fetch/);
  assert.match(body,/No assistant gateway could be reached/);
  // Both branches must be tested before the generic fallback can win.
  const generic=body.indexOf('could not complete this action');
  assert.ok(generic>0&&generic<body.indexOf('Unknown API route'),'the generic message stays the default, overridden by the specific branches');
});
