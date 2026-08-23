import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

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
if (!provenanceSource.startsWith(`Web QA Assistant ${pkg.version}\n`)) { bad++; console.error('release metadata regression: provenance version is stale'); }
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
const requiredHosts = ['https://assistant.msschermer.us/*','http://localhost:3000/*','http://localhost:8787/*'];
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
  'vercel.app', 'netlify.app', 'pages.dev',
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
      if (['node_modules', '.git', 'dist'].includes(e.name)) continue;
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

// --- 1.5.1 product invariants -------------------------------------------------

// The image-purpose classifier must be injected before browser-rules, otherwise
// semantic context silently degrades and Frank falls back to the old fork.
if (!/files:\['vendor\/axe\.min\.js','image-purpose\.js','browser-rules\.js','content\.js'\]/.test(backgroundSource)) {
  bad++;
  console.error('injection order regression: image-purpose.js must load before browser-rules.js');
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

// The overlay must not duplicate the side panel's remediation surface.
const contentSource = fs.readFileSync('apps/extension/content.js', 'utf8');
if (/shadow\.querySelector\('h2'\)\.textContent = step\.headline/.test(contentSource) && /shadow\.querySelector\('p'\)\.textContent = step\.body/.test(contentSource)) {
  bad++;
  console.error('UX regression: the page overlay is duplicating the side-panel remediation card');
}

const distManifestPath = 'dist/extension/manifest.json';
if (fs.existsSync(distManifestPath)) {
  const distManifest = JSON.parse(fs.readFileSync(distManifestPath, 'utf8'));
  if (distManifest.version !== manifest.version) {
    bad++;
    console.error(`stale extension build: dist is ${distManifest.version}, source is ${manifest.version}. Run npm run build:extension.`);
  }
  for (const name of ['confidence.js', 'compose.js', 'impact.js', 'image-purpose.js']) {
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

console.log(`Checked ${files.length} JavaScript files`);
process.exitCode = bad ? 1 : 0;
