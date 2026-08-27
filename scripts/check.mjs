import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { provenanceMatchesVersion } from './release-metadata.mjs';

const files = [];
function walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory() && !['node_modules', 'dist'].includes(e.name)) walk(p);
    else if (e.isFile() && p.endsWith('.js')) files.push(p);
  }
}

walk(process.cwd());
let bad = 0;

for (const f of files) {
  const r = spawnSync(process.execPath, ['--check', f], { encoding: 'utf8' });
  if (r.status !== 0) {
    bad++;
    console.error(f, r.stderr);
  }
}

const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
const manifest = JSON.parse(fs.readFileSync('apps/extension/manifest.json', 'utf8'));
const lock = JSON.parse(fs.readFileSync('package-lock.json', 'utf8'));

if (pkg.version !== manifest.version) {
  bad++;
  console.error(`version mismatch: package ${pkg.version}, source manifest ${manifest.version}`);
}

if (lock.version !== pkg.version || lock.packages?.['']?.version !== pkg.version) {
  bad++;
  console.error(`version mismatch: package-lock ${lock.version}, package ${pkg.version}`);
}

const readmeSource = fs.readFileSync('README.md','utf8');
const provenanceSource = fs.readFileSync('RELEASE_PROVENANCE.txt','utf8');
const buildStatusSource = fs.readFileSync('BUILD_STATUS.md','utf8');
if (!readmeSource.includes(`Current delivery candidate: **${pkg.version}**`)) { bad++; console.error('release metadata regression: README delivery candidate is stale'); }
if (!provenanceMatchesVersion(provenanceSource, pkg.version)) { bad++; console.error('release metadata regression: provenance version is stale'); }
if (!buildStatusSource.includes(`Web QA Assistant ${pkg.version}`)) { bad++; console.error('release metadata regression: build status version is stale'); }

for (const p of ['activeTab', 'scripting', 'sidePanel', 'storage']) {
  if (!manifest.permissions.includes(p)) {
    bad++;
    console.error('missing permission', p);
  }
}

if (manifest.permissions.includes('tabs') || manifest.permissions.includes('debugger')) {
  bad++;
  console.error('unexpected sensitive permission');
}


const backgroundSource = fs.readFileSync('apps/extension/background.js', 'utf8');
const localScanStart = backgroundSource.indexOf('async function localScan');
const localScanEnd = backgroundSource.indexOf('async function addLinkAudit', localScanStart);
const localScanSource = backgroundSource.slice(localScanStart, localScanEnd);
if (/const\s+report\s*=\s*await\s+chrome\.tabs\.sendMessage/.test(localScanSource) &&
    /report\s*=\s*await\s+contextualize\(report\)/.test(localScanSource)) {
  bad++;
  console.error('runtime regression: localScan declares report const and later reassigns it');
}


const browserRulesSource = fs.readFileSync('packages/rules/browser-rules.js', 'utf8');
if (/ruleId:'navigation\.link-timeout'/.test(browserRulesSource)) {
  bad++;
  console.error('trust regression: timeout-only link observations must stay in coverage, not findings');
}
if (!/method:'GET'/.test(browserRulesSource) || !/verificationState:'confirmed-failure'/.test(browserRulesSource)) {
  bad++;
  console.error('link verifier regression: staged GET verification is missing');
}


const forbiddenRuntime = [
  'apps/extension/connected.js',
  'https://preflight.msschermer.us',
  'PREFLIGHT_URL',
  'PREFLIGHT_PATH'
];
const runtimeFiles = ['apps/extension/background.js','apps/extension/manifest.json','packages/connectors/connectors.js','packages/frank/evidence.js','packages/frank/plan.js','docker-compose.yml','.env.example'];
for (const token of forbiddenRuntime.slice(1)) {
  for (const file of runtimeFiles) {
    if (!fs.existsSync(file)) continue;
    if (fs.readFileSync(file, 'utf8').includes(token)) {
      bad++;
      console.error(`legacy Preflight dependency remains in ${file}: ${token}`);
    }
  }
}
if (fs.existsSync('apps/extension/connected.js')) {
  bad++;
  console.error('legacy direct connector bundle still exists in apps/extension/connected.js');
}
const requiredHosts = [
  'https://assistant.msschermer.us/*',
  'http://localhost:3000/*',
  'http://localhost:8787/*',
  'http://127.0.0.1:3000/*',
  'http://127.0.0.1:8787/*'
];
if (JSON.stringify(manifest.host_permissions) !== JSON.stringify(requiredHosts)) {
  bad++;
  console.error('extension host permissions should be limited to the assistant gateway and localhost development endpoints');
}
if (!fs.existsSync('packages/ui/tokens.css')) {
  bad++;
  console.error('shared UI design tokens are missing');
}
if (!fs.existsSync('.github/workflows/ci.yml') || !fs.existsSync('.github/workflows/release.yml')) {
  bad++;
  console.error('GitHub CI/release workflows are missing');
}

// This is a portfolio repository, so no real client site may appear in source,
// tests, docs or fixtures. An allowlist is used rather than a blocklist: naming
// the clients we want to exclude would itself put them in the repo, and a
// blocklist only ever catches the sites someone already thought of.
//
// Test fixtures use example.com / example.org (RFC 2606). Infrastructure hosts
// this project genuinely depends on are listed below.
const ALLOWED_HOSTS = new Set([
  'example.com', 'example.org', 'example.net', 'localhost', 'invalid',
  'msschermer.us', 'assistant.msschermer.us', 'meta-state.msschermer.us',
  'psi.msschermer.us', 'wcag-translator.msschermer.us', 'preflight.msschermer.us',
  'github.com', 'raw.githubusercontent.com', 'api.openai.com', 'openai.com',
  'cdnjs.cloudflare.com', 'schema.org', 'www.w3.org', 'w3.org', 'developer.mozilla.org',
  'dequeuniversity.com', 'deque.com', 'registry.npmjs.org', 'npmjs.com', 'docs.docker.com',
  'fonts.googleapis.com', 'fonts.gstatic.com',
  // Platform suffixes used in environment-classification fixtures.
  'vercel.app', 'netlify.app', 'pages.dev', 'bigscoots-staging.com',
  // RFC 2606 reserved second-level examples.
  'example.co.uk'
]);
const HOST_PATTERN = /https?:\/\/([a-z0-9.-]+\.[a-z]{2,})/gi;
function allowedHost(host) {
  const h = host.toLowerCase().replace(/^www\./, '');
  if (ALLOWED_HOSTS.has(h)) return true;
  // Any subdomain of an allowed apex is fine (e.g. staging.example.com).
  return [...ALLOWED_HOSTS].some(allowed => h.endsWith(`.${allowed}`));
}
function scanForClientData(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (['node_modules', '.git', 'dist', 'qa-runs', '.autoqa'].includes(e.name)) continue;
      scanForClientData(full);
      continue;
    }
    if (!/\.(js|mjs|json|md|css|html|yml|yaml|txt)$/.test(e.name)) continue;
    if (path.resolve(full) === path.resolve('scripts/check.mjs')) continue;
    if (['package-lock.json', 'RELEASE_PROVENANCE.txt'].includes(e.name)) continue;
    const source = fs.readFileSync(full, 'utf8');
    const seen = new Set();
    for (const match of source.matchAll(HOST_PATTERN)) {
      const host = match[1];
      if (allowedHost(host) || seen.has(host)) continue;
      seen.add(host);
      bad++;
      console.error(`possible client data in ${path.relative(process.cwd(), full)}: ${host}. Use example.com in fixtures, or add the host to ALLOWED_HOSTS if it is infrastructure.`);
    }
  }
}
scanForClientData(process.cwd());

// Test fixtures must remain synthetic. URLs are handled above; this second gate
// catches accidental copy/paste of plausible real-person/business identity into
// fixture markup or test names without storing a blocklist of real clients.
const TEST_FIXTURE_ALLOWED_IDENTITIES = new Set(['Sample Workspace','Verified Status','Privacy Policy','Contact Us']);
const PERSON_TEXT_PATTERN = />\s*([A-Z][a-z]{2,}\s+[A-Z][a-z]{2,})\s*</g;
function scanSyntheticFixtureIdentity(dir='tests') {
  if (!fs.existsSync(dir)) return;
  for (const e of fs.readdirSync(dir,{withFileTypes:true})) {
    const full=path.join(dir,e.name);
    if(e.isDirectory()){scanSyntheticFixtureIdentity(full);continue;}
    if(!/\.(js|html|json|md)$/.test(e.name))continue;
    const source=fs.readFileSync(full,'utf8');
    for(const match of source.matchAll(PERSON_TEXT_PATTERN)){
      const value=match[1];
      if(TEST_FIXTURE_ALLOWED_IDENTITIES.has(value))continue;
      if(/^(Missing Label|Broken Link|Slow Lcp|Open Graph|Largest Contentful|Time To|Internal Link|Heading Levels|Meta Refresh|Character Encoding)$/.test(value))continue;
      bad++;console.error(`non-synthetic-looking person/business text in test fixture ${path.relative(process.cwd(),full)}: replace with an Example identity`);
    }
  }
}
scanSyntheticFixtureIdentity();
scanSyntheticFixtureIdentity('fixtures');

// --- 1.5.x product invariants -------------------------------------------------

// The image-purpose classifier must be injected before browser-rules, otherwise
// semantic context silently degrades and Frank falls back to the old fork.
if (!/files:\['vendor\/axe\.min\.js','image-purpose\.js','target-integrity\.browser\.js','browser-rules\.js','content\.js'\]/.test(backgroundSource)) {
  bad++;
  console.error('injection order regression: target-integrity.browser.js and image-purpose.js must load before browser-rules.js');
}

// Renderer Docker images must include every local packages/* runtime dependency.
const rendererSource = fs.readFileSync('services/renderer/server.js', 'utf8');
const rendererDockerSource = fs.readFileSync('services/renderer/Dockerfile', 'utf8');
const rendererPackageRefs = new Set();
for (const m of rendererSource.matchAll(/\.\.\/\.\.\/packages\/([^/'"\s]+)/g)) rendererPackageRefs.add(m[1]);
const rendererDockerPackages = new Set();
for (const m of rendererDockerSource.matchAll(/^COPY\s+packages\/(\S+)/gm)) rendererDockerPackages.add(m[1].replace(/\/\.\//g, '').split('/')[0]);
for (const pkg of rendererPackageRefs) {
  if (!rendererDockerPackages.has(pkg)) {
    bad++;
    console.error(`renderer docker packaging regression: services/renderer/Dockerfile must COPY packages/${pkg} (referenced by services/renderer/server.js)`);
  }
}

// Screenshot capture was evaluated and rejected: it would require broad host
// permissions and would send page pixels past the AI evidence contract.
const screenshotApis = /captureVisibleTab|chrome\.tabs\.captureVisible|getDisplayMedia|html2canvas/;
for (const file of ['apps/extension/background.js', 'apps/extension/content.js', 'apps/extension/sidepanel.js']) {
  if (fs.existsSync(file) && screenshotApis.test(fs.readFileSync(file, 'utf8'))) {
    bad++;
    console.error(`privacy regression: page capture API used in ${file}. Semantic DOM context is the supported path.`);
  }
}

// Integration health must not equate reachability with availability.
const connectorsSource = fs.readFileSync('packages/connectors/connectors.js', 'utf8');
if (/res\.ok \|\| res\.status < 500 \? 'available'/.test(connectorsSource)) {
  bad++;
  console.error("trust regression: integration health reports non-2xx responses as 'available'");
}
if (!/'not-found'/.test(connectorsSource) || !/'unauthorized'/.test(connectorsSource)) {
  bad++;
  console.error('integration health must distinguish not-found and unauthorized from unavailable');
}

// The composer is what stops one scanner owning the brief.
const correlateSource = fs.readFileSync('packages/findings/correlate.js', 'utf8');
if (!/composeAttention/.test(correlateSource)) {
  bad++;
  console.error('brief regression: deterministicBrief must compose across impact classes');
}
for (const file of ['packages/findings/impact.js', 'packages/findings/compose.js', 'packages/rules/image-purpose.js']) {
  if (!fs.existsSync(file)) {
    bad++;
    console.error(`missing required module: ${file}`);
  }
}

// An axe diagnostic is not a remediation. Letting it stand in as one is the
// rule-first behaviour this release removes.
const guidanceSource = fs.readFileSync('packages/frank/guidance.js', 'utf8');
if (!/function imageAdvice/.test(guidanceSource)) {
  bad++;
  console.error('guidance regression: purpose-aware image advice is missing');
}
if (/remediation:summary\|\|'If the image conveys/.test(guidanceSource)) {
  bad++;
  console.error('guidance regression: axe failureSummary is standing in as the image remediation');
}

if (!/descriptor:\{siblingText:/.test(browserRulesSource)) { bad++; console.error('semantic regression: image-purpose adjacent text is not propagated into runtime semantics'); }
if (/getEntriesByType\(['"]largest-contentful-paint['"]\)/.test(browserRulesSource) || !/PerformanceObserver/.test(browserRulesSource)) { bad++; console.error('performance regression: LCP must use buffered PerformanceObserver'); }
if (!/transferIsLowerBound/.test(browserRulesSource)) { bad++; console.error('performance regression: transfer size coverage must be labelled as a lower bound when incomplete'); }
const evidenceContractSource=fs.readFileSync('packages/ai/evidence-contract.js','utf8');
if (/finding:\s*\{\s*\.\.\.graph\.finding/.test(evidenceContractSource) || !/findingFieldsAllowlisted:\s*true/.test(evidenceContractSource)) { bad++; console.error('privacy regression: AI finding payload must use an explicit field allowlist'); }
if (!/performance\.browser\.ttfb/.test(guidanceSource) || !/performance\.browser\.weight/.test(guidanceSource) || !/performance\.browser\.lcp/.test(guidanceSource)) { bad++; console.error('guidance regression: browser performance findings need metric-specific advice'); }

// Frank reliability: a model failure must be surfaced by the API rather than
// silently converted into a plan that looks connected. The deterministic plan
// remains an explicit fallback owned by the API/UI boundary.
const aiSource = fs.readFileSync('packages/ai/ai.js', 'utf8');
const frankStart = aiSource.indexOf('export async function frankWalkthrough');
const frankEnd = aiSource.indexOf('export { aiEvidenceEnvelope }', frankStart);
const frankWalkthroughSource = aiSource.slice(frankStart, frankEnd);
if (frankStart < 0 || /catch\s*\{/.test(frankWalkthroughSource) || /deterministicFrankPlan/.test(frankWalkthroughSource)) {
  bad++;
  console.error('Frank reliability regression: frankWalkthrough must throw model/contract failures instead of silently returning deterministic guidance');
}
if (!/export async function probeAiHealth/.test(aiSource)) {
  bad++;
  console.error('Frank reliability regression: operational model health probe is missing');
}
const apiSource = fs.readFileSync('services/api/server.js', 'utf8');
if (!/app\.post\(['"]\/api\/install\/register['"]/.test(apiSource) || !/PUBLIC_EXTENSION_ACCESS_ENABLED/.test(apiSource)) {
  bad++;
  console.error('managed-access regression: installation registration must remain explicit and server-gated');
}
if (!/probeAiHealth\(\{ force:/.test(apiSource)) {
  bad++;
  console.error('Frank reliability regression: integration health must validate model operation, not merely API-key presence');
}
if (/ASSISTANT_ACCESS_TOKEN/.test(backgroundSource)) {
  bad++;
  console.error('managed-access regression: never bundle the shared assistant access token into extension runtime source');
}
if (!/\/api\/install\/register/.test(backgroundSource)) {
  bad++;
  console.error('managed-access regression: extension must support managed registration without bundling a shared secret');
}
const planSource = fs.readFileSync('packages/frank/plan.js', 'utf8');
for (const file of ['packages/frank/plan.js', 'apps/extension/content.js']) {
  if (fs.readFileSync(file, 'utf8').includes('This is the evidence behind the finding')) {
    bad++;
    console.error(`Frank UX regression: generic evidence filler text returned in ${file}`);
  }
}
if (!/contrast-ratio/.test(planSource) || !/contrast-required/.test(planSource) || !/foreground-color/.test(planSource) || !/background-color/.test(planSource)) {
  bad++;
  console.error('Frank guidance regression: contrast walkthrough must retain observed ratio, requirement, and color evidence');
}



// --- 1.6.0 Frank lifecycle / focus-mode / cost-control invariants ----------------
const panelSource = fs.readFileSync('apps/extension/sidepanel.js', 'utf8');
const panelHtmlSource = fs.readFileSync('apps/extension/sidepanel.html', 'utf8');
const localAiPath = 'apps/extension/local-ai.js';
const localAiSource = fs.existsSync(localAiPath) ? fs.readFileSync(localAiPath, 'utf8') : '';
const composeSource = fs.readFileSync('docker-compose.yml', 'utf8');
const envExampleSource = fs.readFileSync('.env.example', 'utf8');

if (!fs.existsSync(localAiPath)) {
  bad++;
  console.error('on-device Frank regression: apps/extension/local-ai.js is missing');
}
if (/\bfetch\s*\(|XMLHttpRequest|WebSocket|api\.openai|ANTHROPIC|OPENAI_API_KEY/i.test(localAiSource)) {
  bad++;
  console.error('privacy/cost regression: local-ai.js must not call network/model-provider APIs or contain cloud credentials');
}
if (!/(?:LanguageModel|languageModel)\.availability/.test(localAiSource) || !/(?:LanguageModel|languageModel)\.create/.test(localAiSource)) {
  bad++;
  console.error('on-device Frank regression: Chrome LanguageModel availability/create path is missing');
}
if (!/responseConstraint/.test(localAiSource) || !/omitResponseConstraintInput:\s*true/.test(localAiSource)) {
  bad++;
  console.error('on-device Frank regression: structured Prompt API output contract is missing');
}
const frankUiStart = panelSource.indexOf('async function startFrank');
const frankUiPrepare = panelSource.indexOf("type: 'PREPARE_FRANK'", frankUiStart);
const frankUiLocalStart = panelSource.indexOf('localFrankRuntime.activateFromGesture', frankUiStart);
if (frankUiStart < 0 || frankUiLocalStart < frankUiStart || frankUiPrepare < 0 || frankUiLocalStart > frankUiPrepare) {
  bad++;
  console.error('on-device Frank regression: model activation must begin directly from the Ask Frank user gesture before awaited preparation');
}
if (!/class LocalFrankRuntime/.test(localAiSource) || !/cloneTask\s*\(/.test(localAiSource) || /resolveLocalFrankSession/.test(panelSource)) {
  bad++;
  console.error('on-device Frank regression: persistent readiness manager + cloned finding sessions are required');
}
if (!/Use verified guidance now/.test(panelSource) || !/Preparing Frank on this device/.test(panelSource)) {
  bad++;
  console.error('Frank readiness UX regression: preparing state must remain visible and allow deterministic guidance without rescanning');
}
const rescanStart160 = panelSource.indexOf('async function rescan');
const rescanEnd160 = panelSource.indexOf('async function updateWatch', rescanStart160);
const rescanSource160 = rescanStart160 >= 0 ? panelSource.slice(rescanStart160, rescanEnd160 >= 0 ? rescanEnd160 : undefined) : '';
if (/prewarmIfAvailable|activateFromGesture|cloneTask|LanguageModel/.test(rescanSource160)) {
  bad++;
  console.error('Frank lifecycle regression: Rescan must not prepare or recover the on-device model');
}
if (!/LOCAL_AI_REMEDIATION_DRIFT/.test(localAiSource) || !/LOCAL_AI_UNSUPPORTED_HIGH_RISK_ACTION/.test(localAiSource)) {
  bad++;
  console.error('Frank adversarial regression: remediation-drift and high-risk action guards are required');
}
if (!/target-size/.test(guidanceSource) || !/vertical padding/.test(guidanceSource) || !/spacing exception/.test(guidanceSource)) {
  bad++;
  console.error('1.6.1 guidance regression: target-size must have rule-specific interpretation and remediation');
}
if (!/target-height/.test(planSource) || !/target-minimum/.test(planSource) || !/target-spacing-required/.test(planSource)) {
  bad++;
  console.error('1.6.1 evidence regression: target-size measurements must drive Frank step evidence');
}
if (!/LOCAL_AI_TARGET_UNSUPPORTED_MODALITY/.test(localAiSource) || !/LOCAL_AI_MISSED_TARGET_MINIMUM/.test(localAiSource)) {
  bad++;
  console.error('1.6.1 target-size AI guardrails are missing');
}
if (!/Observed by/.test(panelSource) || !/Reference context/.test(panelSource) || !/Automated · Axe/.test(panelSource)) {
  bad++;
  console.error('1.6.1 evidence-ledger source/verification semantics are missing');
}
const highRiskGuardStart = localAiSource.indexOf('const verifiedGuidanceText');
const highRiskGuardEnd = localAiSource.indexOf('if (deterministicPlan)', highRiskGuardStart);
const highRiskGuardSource = highRiskGuardStart >= 0
  ? localAiSource.slice(highRiskGuardStart, highRiskGuardEnd >= 0 ? highRiskGuardEnd : undefined)
  : '';
if (
  highRiskGuardStart < 0 ||
  !/LOCAL_AI_UNSUPPORTED_HIGH_RISK_ACTION/.test(highRiskGuardSource) ||
  !/verifiedGuidanceText\.includes\(match\[0\]\.toLowerCase\(\)\)/.test(highRiskGuardSource) ||
  /evidenceText\.includes/.test(highRiskGuardSource)
) {
  bad++;
  console.error('Frank prompt-injection regression: high-risk actions must be authorized only by verified deterministic guidance, never untrusted page evidence');
}
if (!/type="module"\s+src="sidepanel\.js"/.test(panelHtmlSource)) {
  bad++;
  console.error('on-device Frank regression: sidepanel must load as an ES module');
}
if (!/id="cloud-ai-fallback"/.test(panelHtmlSource) || !/optional · metered/.test(panelHtmlSource) || !/cloudAiFallback:false/.test(backgroundSource)) {
  bad++;
  console.error('cost-control regression: cloud AI must remain explicit, labelled metered, and off by default');
}
if (!/EXTENSION_CLOUD_AI_ENABLED=false/.test(envExampleSource) || !/EXTENSION_CLOUD_AI_ENABLED:\s*\$\{EXTENSION_CLOUD_AI_ENABLED:-false\}/.test(composeSource)) {
  bad++;
  console.error('cost-control regression: server cloud AI must default off in env and compose');
}

// Public Caddy routing depends on web-qa-api joining the shared external network
// with a stable alias. Renderer and egress-proxy must stay off that network.
if (!/portfolio_web:\s*\r?\n\s*external:\s*true\s*\r?\n\s*name:\s*portfolio-infra_web/.test(composeSource)) {
  bad++;
  console.error('docker networking regression: docker-compose.yml must declare external portfolio_web -> portfolio-infra_web');
}
const apiComposeBlock = composeSource.slice(composeSource.indexOf('  web-qa-api:'), composeSource.indexOf('\n  renderer:'));
if (!/portfolio_web/.test(apiComposeBlock)) {
  bad++;
  console.error('docker networking regression: web-qa-api must join portfolio_web for shared Caddy routing');
}
if (!/aliases:\s*\r?\n\s*- web-qa-api/.test(apiComposeBlock)) {
  bad++;
  console.error('docker networking regression: web-qa-api must expose stable alias web-qa-api on portfolio_web');
}
for (const service of ['renderer', 'egress-proxy']) {
  const start = composeSource.indexOf(`  ${service}:`);
  const end = composeSource.indexOf('\n  ', start + 1);
  const block = start >= 0 ? composeSource.slice(start, end > start ? end : undefined) : '';
  if (/portfolio_web|portfolio-infra_web/.test(block)) {
    bad++;
    console.error(`docker networking regression: ${service} must not join portfolio_web`);
  }
}

if (!/await enrich\(req\.body, req\.webQaRequestId, \{ allowAi: false \}\)/.test(apiSource)) {
  bad++;
  console.error('cost-control regression: routine extension context enrichment must explicitly disable metered AI');
}
const contextStart = apiSource.indexOf("app.post('/api/context'");
const contextEnd = apiSource.indexOf("app.post('/api/brief'", contextStart);
if (contextStart >= 0 && /consumeManagedAiQuota|frankWalkthrough|probeAiHealth/.test(apiSource.slice(contextStart, contextEnd))) {
  bad++;
  console.error('cost-control regression: routine /api/context must not consume AI quota or invoke model APIs');
}
for (const route of ['/api/brief', '/api/frank/plan']) {
  const idx = apiSource.indexOf(`app.post('${route}'`);
  const next = apiSource.indexOf('app.post(', idx + 1);
  const block = idx >= 0 ? apiSource.slice(idx, next >= 0 ? next : undefined) : '';
  if (idx < 0 || !/extensionCloudAiEnabled\(\)/.test(block) || !/CLOUD_AI_DISABLED/.test(block)) {
    bad++;
    console.error(`cost-control regression: ${route} must be server-gated behind EXTENSION_CLOUD_AI_ENABLED`);
  }
}
if (!/local-ai\.js/.test(fs.readFileSync('scripts/build-extension.mjs','utf8'))) {
  bad++;
  console.error('build regression: local-ai.js is not copied into the extension distribution');
}
const extensionBuildSource = fs.readFileSync('scripts/build-extension.mjs','utf8');
const axeCacheIndex = extensionBuildSource.indexOf('const axeBytes=');
const distRemoveIndex = extensionBuildSource.indexOf('fs.rmSync(out');
if (axeCacheIndex < 0 || distRemoveIndex <= axeCacheIndex || !/vendoredAxe/.test(extensionBuildSource) || !/writeFileSync\(path\.join\(out,'vendor\/axe\.min\.js'\),axeBytes\)/.test(extensionBuildSource)) {
  bad++;
  console.error('build regression: release-source rebuilds must preserve the vendored axe runtime before clearing dist');
}
if (/Standard guidance/.test(panelHtmlSource) || /This is the evidence behind the finding/.test(panelSource + localAiSource)) {
  bad++;
  console.error('Frank UX regression: generic/filler guidance labels have returned');
}

// 1.6 focus-mode contract: sidebar is evidence; the page card is Frank's reasoning.
const contentSource = fs.readFileSync('apps/extension/content.js', 'utf8');
if (!(/Frank · AI review/.test(contentSource) || /On-device reasoning/.test(contentSource)) || !(/Verified scan guidance/.test(contentSource) || /Verified guidance/.test(contentSource)) || /Evidence-grounded guidance/.test(contentSource)) {
  bad++;
  console.error('1.6.1 Frank focus card must disclose the actual reasoning mode');
}
if (!/step\.headline/.test(contentSource) || !/step\.body/.test(contentSource) || !/aria-live/.test(contentSource)) {
  bad++;
  console.error('Frank focus regression: the page overlay must render the reasoning headline/body with an announced live region');
}
if (!/id=\"frank-ledger-title\"/.test(panelHtmlSource) || !/Evidence ledger/.test(panelHtmlSource) || !/id=\"frank-facts\"/.test(panelHtmlSource)) {
  bad++;
  console.error('Frank focus regression: deterministic facts must remain in the sidebar evidence ledger');
}
if (/id=\"frank-step-body\"/.test(panelHtmlSource) || /id=\"frank-step-headline\"/.test(panelHtmlSource)) {
  bad++;
  console.error('Frank focus regression: generated narrative must not be duplicated in the evidence sidebar');
}
const deterministicPlanStart = planSource.indexOf('export function deterministicFrankPlan');
const deterministicPlanEnd = planSource.indexOf('export function validateFrankPlan', deterministicPlanStart);
const deterministicPlanBlock = deterministicPlanStart >= 0 ? planSource.slice(deterministicPlanStart, deterministicPlanEnd >= 0 ? deterministicPlanEnd : undefined) : '';
if (!/steps\.push\(step\('read','interpretation'/.test(deterministicPlanBlock) || /This is the affected element/.test(deterministicPlanBlock)) {
  bad++;
  console.error('Frank focus regression: deterministic walkthroughs must begin with interpretation, not a standalone locate step');
}

const distManifestPath = 'dist/extension/manifest.json';
if (fs.existsSync(distManifestPath)) {
  const distManifest = JSON.parse(fs.readFileSync(distManifestPath, 'utf8'));
  if (distManifest.version !== manifest.version) {
    bad++;
    console.error(`stale extension build: dist is ${distManifest.version}, source is ${manifest.version}. Run npm run build:extension.`);
  }
  for (const name of ['confidence.js', 'compose.js', 'impact.js', 'image-purpose.js', 'local-ai.js', 'scan-lifecycle.js', 'link-probe-control.js', 'link-status-cache.js', 'guidance-composition.js', 'review-state.js', 'published-coverage.js']) {
    if (!fs.existsSync(`dist/extension/${name}`)) {
      bad++;
      console.error(`stale extension build: ${name} is missing from dist/extension.`);
    }
  }
  const distPanel = fs.readFileSync('dist/extension/sidepanel.html', 'utf8');
  if (!/Ask Frank/.test(distPanel) || />Explain</.test(distPanel) || !/id="ledger"/.test(distPanel)) {
    bad++;
    console.error('stale extension UI detected in dist/extension. Run npm run build:extension.');
  }
}



// --- 1.7.0 cross-discipline workspace / support invariants -------------------
const presentationPath = 'packages/presentation/present.js';
const bugReportPath = 'packages/support/bug-report.js';
const impactSource170 = fs.readFileSync('packages/findings/impact.js', 'utf8');
const buildExtensionSource170 = fs.readFileSync('scripts/build-extension.mjs', 'utf8');
if (!fs.existsSync(presentationPath) || !fs.existsSync(bugReportPath)) {
  bad++;
  console.error('1.7 product regression: presentation and Report bug modules are required');
}
if (!/security:\s*\{\s*id:\s*['"]security['"]/.test(impactSource170) || !/\[SIGNALS\.SECURITY\]:\s*['"]security['"]/.test(impactSource170)) {
  bad++;
  console.error('1.7 QA-area regression: security must remain a dedicated impact class');
}
for (const heading of ['Page assessment','QA areas','Recommended order','Workspace tools','Report a bug','Technical evidence']) {
  if (!panelHtmlSource.includes(heading)) {
    bad++;
    console.error(`1.7 workspace regression: missing product surface "${heading}"`);
  }
}
if (!panelHtmlSource.includes('Nothing is sent automatically.')) {
  bad++;
  console.error('1.7 support regression: Report bug must clearly state that reports are not sent automatically');
}
if (!/presentation\.js/.test(buildExtensionSource170) || !/bug-report\.js/.test(buildExtensionSource170)) {
  bad++;
  console.error('1.7 build regression: presentation/Report bug runtime modules are not packaged');
}
if (!/RuntimeTrace/.test(panelSource) || !/buildBugReport/.test(panelSource) || !/setLocalAiTraceSink/.test(panelSource)) {
  bad++;
  console.error('1.7 support regression: runtime trace and local-AI diagnostics are not connected to Report bug');
}
const reportBugHandlerStart = panelSource.indexOf("$('#report-bug').onclick");
const reportBugHandlerEnd = panelSource.indexOf("$('#scan').onclick", reportBugHandlerStart);
const reportBugHandlerSource = reportBugHandlerStart >= 0 ? panelSource.slice(reportBugHandlerStart, reportBugHandlerEnd >= 0 ? reportBugHandlerEnd : undefined) : '';
if (reportBugHandlerStart < 0 || /fetch\s*\(|gatewayPost|\/api\//.test(reportBugHandlerSource)) {
  bad++;
  console.error('1.7 privacy regression: Report bug must generate/export locally and must not send a support payload automatically');
}
if (!/TRACE_KEYS/.test(fs.readFileSync(bugReportPath, 'utf8')) || !/includeContext/.test(fs.readFileSync(bugReportPath, 'utf8'))) {
  bad++;
  console.error('1.7 privacy regression: Report bug requires a bounded operational trace and explicit context opt-in');
}
if (!/requireRemediationFamily/.test(localAiSource) || !/performance\.browser\.lcp/.test(localAiSource) || !/broken-link/.test(localAiSource) || !/blank-opener/.test(localAiSource)) {
  bad++;
  console.error('1.7 Frank regression: cross-discipline on-device remediation validation is missing');
}
for (const builtModule of ['presentation.js','bug-report.js']) {
  if (fs.existsSync('dist/extension') && !fs.existsSync(`dist/extension/${builtModule}`)) {
    bad++;
    console.error(`1.7 stale extension build: ${builtModule} is missing from dist/extension`);
  }
}


// Validate the built extension's relative ES-module import graph. Chrome reports a
// vague "service worker registration failed / unknown error fetching script" when
// a transitive module is missing, so catch it here before Chrome ever sees it.
function validateRelativeImports(entryPath) {
  const seen = new Set();
  const stack = [entryPath];
  while (stack.length) {
    const current = stack.pop();
    const abs = path.resolve(current);
    if (seen.has(abs)) continue;
    seen.add(abs);
    if (!fs.existsSync(abs)) {
      bad++;
      console.error(`missing extension module: ${current}`);
      continue;
    }
    const source = fs.readFileSync(abs, 'utf8');
    const specs = [...source.matchAll(/(?:import|export)\s+(?:[^'\"]*?\s+from\s+)?['\"](\.[^'\"]+)['\"]/g)].map(m => m[1]);
    for (const spec of specs) {
      let target = path.resolve(path.dirname(abs), spec);
      if (!path.extname(target)) target += '.js';
      if (!fs.existsSync(target)) {
        bad++;
        console.error(`unresolved extension import: ${path.relative(process.cwd(), abs)} -> ${spec}`);
      } else {
        stack.push(target);
      }
    }
  }
}

if (fs.existsSync('dist/extension/background.js')) {
  validateRelativeImports('dist/extension/background.js');
}
if (fs.existsSync('dist/extension/sidepanel.js')) {
  validateRelativeImports('dist/extension/sidepanel.js');
}

console.log(`Checked ${files.length} JavaScript files`);
process.exitCode = bad ? 1 : 0;
