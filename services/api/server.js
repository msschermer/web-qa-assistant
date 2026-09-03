import express from 'express';
import helmet from 'helmet';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { allContext, integrationHealth, TOOL_REGISTRY } from '../../packages/connectors/connectors.js';
import { correlate, deterministicBrief, finalizeCorrelatedFindings, composeReportAttention } from '../../packages/findings/correlate.js';
import { priorityBrief, frankWalkthrough, probeAiHealth, aiFailureInfo } from '../../packages/ai/ai.js';
import { buildEvidenceGraph, evidenceHash } from '../../packages/frank/evidence.js';
import { deterministicFrankPlan, validateFrankPlan } from '../../packages/frank/plan.js';
import { attachEnvironmentContext, launchIntegrityFindings, publishedIndexSignalsFromContext } from '../../packages/environment/classify.js';
import { buildPublishedCoverage } from '../../packages/environment/published-coverage.js';
import { emptyFrankReview, scanGuidanceSource } from '../../packages/frank/review-state.js';
import { buildPerformanceAssessment } from '../../packages/findings/performance-assessment.js';
import { applyFindingPolicy, presentationPolicySummary } from '../../packages/findings/policy.js';
import { resolvePerformanceCoverage, applyPrivilegedProbeAccounting, reconcilePerformanceCoverage } from '../../packages/findings/coverage.js';
import { buildEvidenceLedger } from '../../packages/findings/evidence-ledger.js';
import { applyTargetIntegrityReport, attachTargetIntegrity, finalizeBlockedTargetReport } from '../../packages/integrity/apply-report.js';
import { targetIntegrityLimitsAudit, targetIntegrityBlocksAudit } from '../../packages/integrity/target-integrity.js';
import { issueInstallationToken, verifyInstallationToken } from '../../packages/auth/install-access.js';
import { probeExternalCandidates, mapExternalProbeRows } from '../../packages/security/safe-probe.js';
import { openAuditStore, newAuditId, normalizeAuditUrl } from '../../packages/crawl/store.js';
import { runAudit, isCrawlableStartUrl, planCrawlConfig } from '../../packages/crawl/crawler.js';
import { renderAuditReportHtml } from '../../packages/crawl/report.js';
import { buildAuditDebugBundle } from '../../packages/crawl/debug-report.js';

const app = express();
const port = Number(process.env.PORT || 3000);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const frankCache = new Map();
const FRANK_CACHE_MS = Number(process.env.FRANK_CACHE_MS || 30 * 60 * 1000);
const RELEASE_VERSION = '1.7.5';
function publicAiEnabled(){return /^(1|true|yes)$/i.test(String(process.env.PUBLIC_AI_ENABLED||''))}
function extensionCloudAiEnabled(){return /^(1|true|yes)$/i.test(String(process.env.EXTENSION_CLOUD_AI_ENABLED||''))}
function publicExtensionAccessEnabled(){return /^(1|true|yes)$/i.test(String(process.env.PUBLIC_EXTENSION_ACCESS_ENABLED||''))}
function installationSecret(){return String(process.env.INSTALL_TOKEN_SECRET||process.env.ASSISTANT_ACCESS_TOKEN||'')}
function revokedInstallationIds(){return String(process.env.REVOKED_INSTALLATION_IDS||'').split(',').map(x=>x.trim()).filter(Boolean)}
function sharedTokenMatches(actual,expected){const a=Buffer.from(String(actual||'')),b=Buffer.from(String(expected||''));return Boolean(expected)&&a.length===b.length&&crypto.timingSafeEqual(a,b)}
function installationAuth(actual){return verifyInstallationToken(actual,{secret:installationSecret(),revokedInstallationIds:revokedInstallationIds()})}

app.disable('x-powered-by');
app.use(helmet({ contentSecurityPolicy: false, crossOriginEmbedderPolicy: false }));
app.use((req, res, next) => {
  const requestId = String(req.headers['x-web-qa-request-id'] || '').slice(0, 120) || `WQA-${crypto.randomUUID()}`;
  req.webQaRequestId = requestId;
  res.setHeader('X-Web-QA-Request-ID', requestId);
  next();
});
app.use((req, res, next) => {
  const allowed = String(process.env.ALLOWED_ORIGINS || '*').split(',').map(x => x.trim()).filter(Boolean);
  const origin = String(req.headers.origin || '');
  if (allowed.includes('*')) res.setHeader('Access-Control-Allow-Origin', '*');
  else if (origin && allowed.includes(origin)) { res.setHeader('Access-Control-Allow-Origin', origin); res.setHeader('Vary', 'Origin'); }
  res.setHeader('Access-Control-Allow-Headers', 'content-type,x-web-qa-key,x-web-qa-request-id');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});
app.use(express.json({ limit: '700kb' }));

const buckets = new Map();
const managedDailyBuckets = new Map();
app.use('/api', (req, res, next) => {
  const credential = String(req.headers['x-web-qa-key'] || '');
  const identity = credential ? `token:${crypto.createHash('sha256').update(credential).digest('hex').slice(0, 18)}` : `ip:${req.ip || 'unknown'}`;
  const now = Date.now(), b = buckets.get(identity) || { n: 0, at: now };
  if (now - b.at > 60000) { b.n = 0; b.at = now; }
  b.n++; buckets.set(identity, b);
  const limit = req.path === '/install/register' ? 8 : req.path.startsWith('/frank/') ? 40 : 90;
  if (b.n > limit) return res.status(429).json({ ok: false, error: 'Rate limit exceeded', requestId: req.webQaRequestId });
  next();
});

function consumeManagedAiQuota(req, res) {
  if (req.webQaAuth?.type !== 'installation') return true;
  const limit = Math.max(1, Number(process.env.INSTALL_AI_DAILY_LIMIT || 200));
  const day = new Date().toISOString().slice(0, 10), key = `${day}:${req.webQaAuth.installationId}`;
  const used = Number(managedDailyBuckets.get(key) || 0);
  if (used >= limit) { res.status(429).json({ ok: false, code: 'INSTALL_DAILY_LIMIT', error: 'This installation reached its connected reasoning allowance for today.', requestId: req.webQaRequestId }); return false; }
  managedDailyBuckets.set(key, used + 1);
  if (managedDailyBuckets.size > 5000) for (const k of managedDailyBuckets.keys()) if (!k.startsWith(day + ':')) managedDailyBuckets.delete(k);
  return true;
}

function requireExtensionKey(req, res, next) {
  const expected = String(process.env.ASSISTANT_ACCESS_TOKEN || '');
  const managedEnabled = publicExtensionAccessEnabled();
  if (!expected && !managedEnabled) return next();
  const actual = String(req.headers['x-web-qa-key'] || '');
  if (!actual) return res.status(401).json({ ok: false, code: 'ACCESS_REQUIRED', error: 'Assistant access is required.', requestId: req.webQaRequestId });
  if (sharedTokenMatches(actual, expected)) { req.webQaAuth = { type: 'shared' }; return next(); }
  if (managedEnabled) {
    const managed = installationAuth(actual);
    if (managed.ok) { req.webQaAuth = { type: 'installation', installationId: managed.installationId }; return next(); }
  }
  return res.status(401).json({ ok: false, code: 'ACCESS_REJECTED', error: 'Assistant access was not accepted.', requestId: req.webQaRequestId });
}

function validReport(body) { return body && body.page && /^https?:\/\//.test(body.page.url || '') && Array.isArray(body.findings); }
function validGraph(graph) { return graph && graph.version === 3 && graph.finding && Array.isArray(graph.evidence) && graph.page; }
function privateLike(host) {
  const h = String(host || '').toLowerCase();
  return h === 'localhost' || h.endsWith('.local') || h.endsWith('.internal') || /^127\./.test(h) || /^10\./.test(h) || /^192\.168\./.test(h) || /^169\.254\./.test(h) || /^172\.(1[6-9]|2\d|3[01])\./.test(h);
}
function coverageStatus(result, kind) {
  if (!result) return 'unavailable';
  if (result.status === 'not_applicable') return 'not applicable';
  if (result.status !== 'complete') return result.status || 'unavailable';
  if (kind === 'performance' && result.data?.monitored === false) return 'not monitored';
  return 'complete';
}

async function applyServerExternalLinkProbes(report) {
  if (!report || targetIntegrityBlocksAudit(report.page?.targetIntegrity)) return report;
  const fromField = Array.isArray(report.externalLinkCandidates) ? report.externalLinkCandidates : [];
  const fromIncomplete = (report.linkAudit?.incompleteChecks || [])
    .filter((c) => c?.kind === 'external-link' && (!c.status || Number(c.status) === 0))
    .map((c) => ({
      url: c.url,
      text: c.text || '',
      occurrences: 1,
      prominence: c.prominence || '',
      location: c.location || '',
      selector: '',
      sources: []
    }));
  const seen = new Set();
  const allCandidates = [];
  for (const row of [...fromField, ...fromIncomplete]) {
    const key = String(row?.url || '');
    if (!key || seen.has(key)) continue;
    seen.add(key);
    allCandidates.push(row);
  }
  const candidateTotal = Math.max(Number(report.externalLinkCandidateTotal || 0), allCandidates.length);
  const candidates = allCandidates.slice(0, 80);
  if (!candidates.length) return report;

  // Concurrency has to cover maxCandidates within the budget, or trailing destinations are
  // returned budget-exhausted and stay inconclusive even when they are plainly broken.
  const rows = await probeExternalCandidates(candidates, { maxCandidates: 80, concurrency: 12, totalBudgetMs: 20000 });
  const applied = mapExternalProbeRows(candidates, rows);
  const truncated = candidateTotal > candidates.length;
  return applyPrivilegedProbeAccounting(report, {
    applied,
    truncated,
    candidateTotal,
    candidatesProbed: candidates.length
  });
}

async function enrich(local, requestId = '', { allowAi = true } = {}) {
  let withLinks = local;
  try { withLinks = await applyServerExternalLinkProbes(local); } catch { withLinks = local; }
  const base = attachTargetIntegrity(withLinks, {
    requestedUrl: withLinks.page?.requestedUrl || withLinks.page?.url,
    html: withLinks.page?.documentHtmlSample || ''
  });
  const context = await allContext(base, { requestId });
  const correlated = correlate(base, context);
  const published = publishedIndexSignalsFromContext(context, base);
  const environment = attachEnvironmentContext(base.page || {}, {
    canonical: base.page?.canonical,
    monitored: context.performance?.data?.monitored === true,
    destinations: base.linkAudit?.destinations || [],
    findings: correlated,
    ...published
  });
  const performanceAssessment = buildPerformanceAssessment({
    browserPerformance: base.browserPerformance,
    findings: correlated,
    environment
  });
  environment.performanceAssessment = performanceAssessment;
  const leakage = launchIntegrityFindings({
    page: base.page || {},
    environment,
    canonical: environment.canonicalContext,
    destinations: base.linkAudit?.destinations || []
  });
  const policyFindings = applyFindingPolicy([...correlated, ...leakage], environment);
  environment.presentationPolicy = presentationPolicySummary(policyFindings);
  const coverage = {
    ...base.coverage,
    published: coverageStatus(context.meta, 'published'),
    performance: resolvePerformanceCoverage(base.coverage, base.browserPerformance, context.performance),
    wcag: coverageStatus(context.wcag, 'wcag')
  };
  const finalized = finalizeBlockedTargetReport({ ...base, coverage }, policyFindings);
  const attention = composeReportAttention(finalized.findings || [], { limit: 8 });
  const briefContext = {
    coverage: finalized.coverage,
    linkAudit: finalized.linkAudit || null,
    targetIntegrity: finalized.page?.targetIntegrity || null
  };
  const brief = finalized.targetIntegrityBlocked || targetIntegrityLimitsAudit(finalized.page?.targetIntegrity)
    ? { text: finalized.priorityBrief || deterministicBrief(finalized.findings, briefContext), mode: 'deterministic', reason: 'target-integrity' }
    : allowAi
      ? await priorityBrief(finalized.findings, finalized.coverage, environment, finalized.linkAudit || null)
      : { text: deterministicBrief(finalized.findings, briefContext), mode: 'deterministic' };
  coverage.ai = brief.mode === 'ai' ? 'complete' : 'deterministic';
  const publishedCoverage = buildPublishedCoverage({
    context,
    report: finalized,
    coverage,
    connectedMode: 'gateway',
    attempted: true
  });
  environment.publishedCoverage = publishedCoverage;
  const frankReview = emptyFrankReview({ reason: 'not-requested' });
  const guidanceSource = scanGuidanceSource({
    frankReview,
    hasVisibleGuidance: true,
    priorityMode: brief.mode,
    coverageAi: coverage.ai
  });
  return {
    ok: true,
    requestId,
    report: {
      ...finalized,
      environment,
      publishedCoverage,
      frankReview,
      guidanceSource,
      page: { ...finalized.page, environment },
      findings: finalized.findings,
      performanceAssessment,
      attention: {
        groups: attention.groups.map(g => ({
          key: g.key, impactClass: g.impactClass, title: g.title, size: g.size, instanceCount: g.instanceCount,
          score: g.score, leadId: g.lead.id, selectors: g.selectors, instanceIds: g.instances.map(x => x.id),
          rootCauseKey: g.lead.rootCauseKey || g.key, targetability: g.lead.targetability || '', lenses: g.lead.lenses || []
        })),
        allGroups: (attention.allGroups || []).map(g => ({
          key: g.key, impactClass: g.impactClass, title: g.title, size: g.size, instanceCount: g.instanceCount,
          score: g.score, leadId: g.lead?.id, targetability: g.lead?.targetability || '', confidence: g.lead?.confidence || '',
          ruleId: g.lead?.ruleId || ''
        })),
        worthChecking: (attention.worthChecking || []).map(w => ({
          key: w.key, title: w.title, scope: w.scope, lens: w.lens, fixOwner: w.fixOwner,
          size: w.size, instanceCount: w.instanceCount, findingIds: w.findings.map(f => f.id)
        })),
        classCounts: attention.classCounts,
        materialGroupCount: attention.materialGroupCount,
        materialFindingCount: attention.materialFindingCount,
        representedClasses: attention.representedClasses
      },
      evidenceLedger: buildEvidenceLedger({ ...finalized, coverage: { ...finalized.coverage, ai: coverage.ai } }, { uiLimit: 8, composition: attention, findings: finalized.findings }),
      coverage: { ...finalized.coverage, ai: coverage.ai },
      context: {
        performance: context.performance?.data || null,
        routing: context.routing || null,
        services: { metaState: context.meta, performance: context.performance, wcag: context.wcag }
      },
      priorityBrief: brief.text,
      priorityMode: brief.mode,
      priorityReason: brief.reason || null,
      connectedMode: 'gateway'
    }
  };
}

async function rendererPost(pathname, payload, timeoutMs = Number(process.env.SCAN_TIMEOUT_MS || 30000), requestId = '') {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const renderer = (process.env.RENDERER_URL || 'http://localhost:8790').replace(/\/$/, '');
    const rr = await fetch(renderer + pathname, { method: 'POST', signal: controller.signal, headers: { 'content-type': 'application/json', 'x-renderer-token': process.env.RENDERER_TOKEN || 'dev-token', ...(requestId ? { 'x-web-qa-request-id': requestId } : {}) }, body: JSON.stringify(payload) });
    const text = await rr.text(); let data = {};
    try { data = text ? JSON.parse(text) : {}; } catch { throw new Error(`Renderer returned invalid JSON (HTTP ${rr.status})`); }
    if (!rr.ok || !data.ok) throw Object.assign(new Error(data.error || `Renderer HTTP ${rr.status}`), { status: rr.status });
    return data;
  } finally { clearTimeout(timer); }
}

app.get('/api/health', (req, res) => res.json({ ok: true, service: 'web-qa-assistant', version: RELEASE_VERSION, frank: true, aiConfigured: Boolean(process.env.OPENAI_API_KEY), model: process.env.OPENAI_MODEL || 'gpt-5.6-terra', publicAiEnabled: publicAiEnabled(), extensionCloudAiEnabled: extensionCloudAiEnabled(), preferredFrankAi: 'chrome-built-in', managedExtensionAccess: publicExtensionAccessEnabled(), requestId: req.webQaRequestId }));
app.post('/api/install/register', async (req, res) => {
  if (!publicExtensionAccessEnabled()) return res.status(403).json({ ok: false, code: 'MANAGED_ACCESS_DISABLED', error: 'Managed installation access is not enabled on this gateway.', requestId: req.webQaRequestId });
  const installationId = String(req.body?.installationId || '');
  try {
    const issued = issueInstallationToken({ installationId, secret: installationSecret(), ttlMs: Number(process.env.INSTALL_TOKEN_TTL_MS || 30 * 24 * 60 * 60 * 1000) });
    res.json({ ok: true, requestId: req.webQaRequestId, access: 'managed-installation', token: issued.token, expiresAt: issued.expiresAt });
  } catch (error) { res.status(400).json({ ok: false, code: 'INSTALL_REGISTRATION_FAILED', error: error.message, requestId: req.webQaRequestId }); }
});
app.get('/api/health/integrations', requireExtensionKey, async (req, res) => {
  const health = await integrationHealth({ requestId: req.webQaRequestId });
  const cloudRequested = extensionCloudAiEnabled() && String(req.query?.cloud || '') === '1';
  const openai = cloudRequested
    ? await probeAiHealth({ force: true })
    : { status: extensionCloudAiEnabled() ? 'not-probed' : 'disabled', operational: false, configured: Boolean(process.env.OPENAI_API_KEY), model: process.env.OPENAI_MODEL || 'gpt-5.6-terra', message: extensionCloudAiEnabled() ? 'Cloud AI fallback is enabled but was not probed.' : 'Cloud AI fallback is disabled. On-device AI is preferred on this device.' };
  res.json({ ok: true, requestId: req.webQaRequestId, integrations: health, openai, extensionCloudAiEnabled: extensionCloudAiEnabled(), preferredFrankAi: 'chrome-built-in', renderer: { status: 'configured', url: process.env.RENDERER_URL || 'http://localhost:8790' }, tools: TOOL_REGISTRY, access: req.webQaAuth?.type || 'open' });
});
app.get('/api/config', (req, res) => res.json({ extensionStoreUrl: process.env.EXTENSION_STORE_URL || '', sourceUrl: 'https://github.com/msschermer/web-qa-assistant', frank: true, version: RELEASE_VERSION }));

// Extension-only gateway routes. If ASSISTANT_ACCESS_TOKEN is configured, the extension must supply it.
app.post('/api/context', requireExtensionKey, async (req, res) => {
  if (!validReport(req.body)) return res.status(400).json({ ok: false, error: 'Invalid local report', requestId: req.webQaRequestId });
  if (privateLike(req.body.page?.hostname)) return res.status(400).json({ ok: false, error: 'Private page evidence must stay local.', requestId: req.webQaRequestId });
  // Context enrichment uses deterministic correlation only. Normal extension scans
  // must not incur a cloud-model charge simply because OPENAI_API_KEY exists.
  try { res.json(await enrich(req.body, req.webQaRequestId, { allowAi: false })); } catch (e) { res.status(502).json({ ok: false, error: e.message, requestId: req.webQaRequestId }); }
});
app.post('/api/brief', requireExtensionKey, async (req, res) => {
  if (!extensionCloudAiEnabled()) return res.status(403).json({ ok: false, code: 'CLOUD_AI_DISABLED', error: 'Metered cloud AI is disabled for extension users.', requestId: req.webQaRequestId });
  const findings = Array.isArray(req.body?.findings) ? req.body.findings : null;
  if (!findings) return res.status(400).json({ ok: false, error: 'Findings required', requestId: req.webQaRequestId });
  if (!consumeManagedAiQuota(req, res)) return;
  try { res.json({ ok: true, requestId: req.webQaRequestId, brief: await priorityBrief(findings, req.body?.coverage || {}, req.body?.environment || {}, req.body?.linkAudit || null) }); } catch (e) { res.status(502).json({ ok: false, error: e.message, requestId: req.webQaRequestId }); }
});
app.post('/api/frank/plan', requireExtensionKey, async (req, res) => {
  if (!extensionCloudAiEnabled()) return res.status(403).json({ ok: false, code: 'CLOUD_AI_DISABLED', error: 'Metered cloud AI fallback is disabled for extension users.', requestId: req.webQaRequestId });
  const graph = req.body?.graph;
  if (!validGraph(graph)) return res.status(400).json({ ok: false, error: 'A valid evidence graph is required.', requestId: req.webQaRequestId });
  if (privateLike(graph.page?.hostname)) return res.status(400).json({ ok: false, error: 'Private page evidence must stay local.', requestId: req.webQaRequestId });
  if (!consumeManagedAiQuota(req, res)) return;
  const key = `${evidenceHash(graph)}:${process.env.OPENAI_MODEL || 'gpt-5.6-terra'}:frank-v3`;
  const cached = frankCache.get(key);
  if (cached && Date.now() - cached.at < FRANK_CACHE_MS) return res.json({ ok: true, requestId: req.webQaRequestId, plan: cached.plan, reasoning: cached.reasoning, cached: true });
  try {
    const plan = await frankWalkthrough(graph);
    if (!validateFrankPlan(plan, graph)) throw new Error('The walkthrough plan failed validation.');
    const reasoning = { status: 'operational', mode: 'ai', model: process.env.OPENAI_MODEL || 'gpt-5.6-terra' };
    frankCache.set(key, { at: Date.now(), plan, reasoning });
    if (frankCache.size > 250) [...frankCache.entries()].sort((a, b) => a[1].at - b[1].at).slice(0, 50).forEach(([k]) => frankCache.delete(k));
    res.json({ ok: true, requestId: req.webQaRequestId, plan, reasoning, cached: false });
  } catch (error) {
    const plan = deterministicFrankPlan(graph);
    const failure = aiFailureInfo(error);
    res.json({ ok: true, requestId: req.webQaRequestId, plan, fallback: true, reasoning: { ...failure, mode: 'deterministic' }, cached: false });
  }
});

// Public web-scanner routes. The server retains the API key; page evidence is still sanitized before OpenAI use.
app.post('/api/frank/start', async (req, res) => {
  const { finding, report, targetContext } = req.body || {};
  if (!finding?.title || !validReport(report)) return res.status(400).json({ ok: false, error: 'Finding and current report are required.', requestId: req.webQaRequestId });
  if (privateLike(report.page?.hostname)) return res.status(400).json({ ok: false, error: 'Private page evidence must stay local.', requestId: req.webQaRequestId });
  try {
    const graph = buildEvidenceGraph({ finding, page: report.page, coverage: report.coverage || {}, context: report.context || {}, targetContext: targetContext || null, environment: report.environment || report.page?.environment, evidenceLedger: report.evidenceLedger || null, linkAudit: report.linkAudit || null });
    let plan = deterministicFrankPlan(graph), reasoning = { status: 'disabled', mode: 'deterministic', message: 'Public connected reasoning is disabled.' };
    if (publicAiEnabled()) {
      try { plan = await frankWalkthrough(graph); reasoning = { status: 'operational', mode: 'ai', model: process.env.OPENAI_MODEL || 'gpt-5.6-terra' }; }
      catch (error) { reasoning = { ...aiFailureInfo(error), mode: 'deterministic' }; }
    }
    if (!validateFrankPlan(plan, graph)) throw new Error('The walkthrough plan failed validation.');
    res.json({ ok: true, requestId: req.webQaRequestId, graph, plan, reasoning });
  } catch (e) { res.status(502).json({ ok: false, error: e.message, requestId: req.webQaRequestId }); }
});
app.post('/api/frank/snapshot', async (req, res) => {
  const url = String(req.body?.url || '').trim(), selector = String(req.body?.selector || '').trim().slice(0, 1200);
  if (!/^https?:\/\//i.test(url)) return res.status(400).json({ ok: false, error: 'Enter a public HTTP or HTTPS URL.', requestId: req.webQaRequestId });
  try { res.json({ ...(await rendererPost('/snapshot', { url, selector }, 16000, req.webQaRequestId)), requestId: req.webQaRequestId }); }
  catch (e) { res.status(e.name === 'AbortError' ? 504 : (e.status || 502)).json({ ok: false, error: e.name === 'AbortError' ? 'Walkthrough snapshot timed out.' : e.message, requestId: req.webQaRequestId }); }
});
app.post('/api/scan', async (req, res) => {
  const url = String(req.body?.url || '').trim();
  if (!/^https?:\/\//i.test(url)) return res.status(400).json({ ok: false, error: 'Enter a public HTTP or HTTPS URL.', requestId: req.webQaRequestId });
  try { const data = await rendererPost('/scan', { url }, Number(process.env.SCAN_TIMEOUT_MS || 30000), req.webQaRequestId); res.json(await enrich(data.report, req.webQaRequestId, { allowAi: publicAiEnabled() })); }
  catch (e) { res.status(e.name === 'AbortError' ? 504 : (e.status || 502)).json({ ok: false, error: e.name === 'AbortError' ? 'Public scan timed out.' : e.message, requestId: req.webQaRequestId }); }
});

// --- Full-site audits ---------------------------------------------------
// Crawl execution and persistence live here, not in the extension: a
// multi-page audit must survive the side panel closing, the tab navigating
// away, or the extension's service worker being recycled. The extension only
// ever holds an audit id and reconnects by polling these routes.
const AUDIT_DB_PATH = process.env.AUDIT_DB_PATH || path.join(__dirname, '../../data/audits.db');
const auditStore = openAuditStore(AUDIT_DB_PATH);
const runningAudits = new Map(); // auditId -> { cancelled }
const MAX_CONCURRENT_AUDITS = Number(process.env.AUDIT_MAX_CONCURRENT || 2);
// Layered ON TOP OF, never instead of, the process-wide ceiling above: the
// global cap exists to bound total outbound fan-out from our infrastructure
// regardless of how many tenants are active, and a per-tenant cap alone
// would remove that ceiling entirely as tenant count grows. This one just
// stops a single tenant from consuming the ENTIRE global ceiling by
// themselves, leaving room for others.
const MAX_CONCURRENT_AUDITS_PER_OWNER = Number(process.env.AUDIT_MAX_CONCURRENT_PER_OWNER || 1);
auditStore.reconcileInterruptedAudits();
// Deliberately no renderer/Chromium call anywhere in the crawl path: runAudit's
// defaults (packages/crawl/crawler.js) do a plain HTTP fetch + jsdom parse per
// page, which is what keeps a large audit from being hundreds of headless-
// browser renders on our own infrastructure. /render-result below never
// renders anything here either — it only records a report the EXTENSION
// already produced by rendering that page in the user's own browser.

// The shared token has no per-caller identity, so it is one trust boundary,
// same as every other /api route. A managed installation is a distinct
// tenant and must never see, cancel, or export another installation's audit.
function auditOwnerFor(req) {
  return req.webQaAuth?.type === 'installation' ? `install:${req.webQaAuth.installationId}` : 'shared';
}
function getOwnedAudit(req, res) {
  const audit = auditStore.getAudit(req.params.id);
  if (!audit || audit.owner !== auditOwnerFor(req)) {
    res.status(404).json({ ok: false, error: 'Audit not found.', requestId: req.webQaRequestId });
    return null;
  }
  return audit;
}

function auditProgressPayload(audit) {
  return {
    id: audit.id,
    siteOrigin: audit.site_origin,
    startUrl: audit.start_url,
    config: audit.config,
    status: audit.status,
    phase: audit.phase,
    error: audit.error,
    createdAt: audit.created_at,
    startedAt: audit.started_at,
    completedAt: audit.completed_at,
    stats: audit.stats,
    urlCounts: auditStore.urlCountsByStatus(audit.id),
    linkCounts: auditStore.linkCountsByStatus(audit.id),
    findingsCount: auditStore.findingsCount(audit.id),
    // The static crawl (server-side, cheap) and the render pass (the user's
    // own browser, optional) are tracked separately on purpose — the UI needs
    // to show "crawl done, N pages still need a deeper render" as two facts,
    // not collapse them into one progress bar.
    renderProgress: auditStore.renderProgress(audit.id),
    recentUrls: auditStore.recentUrls(audit.id, 6)
  };
}

app.post('/api/audits', requireExtensionKey, async (req, res) => {
  const gate = isCrawlableStartUrl(req.body?.startUrl);
  if (!gate.ok) {
    return res.status(400).json({
      ok: false,
      error: gate.error === 'destination-not-allowed' ? 'That destination cannot be audited (private or unsupported host).' : 'Enter a public HTTP or HTTPS URL to audit.',
      requestId: req.webQaRequestId
    });
  }
  if (runningAudits.size >= MAX_CONCURRENT_AUDITS) {
    return res.status(429).json({ ok: false, code: 'AUDIT_CAPACITY', error: 'Too many audits are running right now. Try again shortly.', requestId: req.webQaRequestId });
  }
  const owner = auditOwnerFor(req);
  if (auditStore.countRunningAuditsByOwner(owner) >= MAX_CONCURRENT_AUDITS_PER_OWNER) {
    return res.status(429).json({ ok: false, code: 'AUDIT_CAPACITY_OWNER', error: 'You already have an audit running. Wait for it to finish before starting another.', requestId: req.webQaRequestId });
  }
  const config = planCrawlConfig(req.body || {});
  const siteOrigin = new URL(gate.url).origin;
  const id = auditStore.createAudit({ siteOrigin, startUrl: gate.url, config, owner });
  const control = { cancelled: false };
  runningAudits.set(id, control);
  auditStore.markRunning(id);
  (async () => {
    try {
      const result = await runAudit({
        auditId: id, startUrl: gate.url, config, store: auditStore,
        isCancelled: () => control.cancelled
      });
      auditStore.finishAudit(id, { status: result.cancelled ? 'cancelled' : 'complete', stats: result.stats });
    } catch (error) {
      auditStore.finishAudit(id, { status: 'failed', error: String(error?.message || error).slice(0, 500) });
    } finally {
      runningAudits.delete(id);
    }
  })();
  res.json({ ok: true, requestId: req.webQaRequestId, auditId: id, config });
});

app.get('/api/audits', requireExtensionKey, (req, res) => {
  const gate = isCrawlableStartUrl(req.query?.site || '');
  if (!gate.ok) return res.status(400).json({ ok: false, error: 'A valid site URL is required.', requestId: req.webQaRequestId });
  const audits = auditStore.listAudits(new URL(gate.url).origin, auditOwnerFor(req), Math.min(50, Number(req.query?.limit) || 20));
  res.json({ ok: true, requestId: req.webQaRequestId, audits: audits.map(auditProgressPayload) });
});

app.get('/api/audits/:id', requireExtensionKey, (req, res) => {
  const audit = getOwnedAudit(req, res);
  if (!audit) return;
  res.json({ ok: true, requestId: req.webQaRequestId, audit: auditProgressPayload(audit) });
});

app.post('/api/audits/:id/cancel', requireExtensionKey, (req, res) => {
  const audit = getOwnedAudit(req, res);
  if (!audit) return;
  const control = runningAudits.get(req.params.id);
  if (control) control.cancelled = true;
  else if (audit.status === 'running') auditStore.finishAudit(req.params.id, { status: 'cancelled', error: 'Cancelled (no active worker found).' });
  res.json({ ok: true, requestId: req.webQaRequestId, cancelling: Boolean(control) });
});

function paginationOf(req) {
  return { limit: Math.max(1, Math.min(500, Number(req.query?.limit) || 100)), offset: Math.max(0, Number(req.query?.offset) || 0) };
}
app.get('/api/audits/:id/urls', requireExtensionKey, (req, res) => {
  const audit = getOwnedAudit(req, res);
  if (!audit) return;
  // `status` accepts one crawl state or a comma-separated set, so the audit
  // UI can open just the pages behind a coverage-gap count. Unknown values are
  // dropped by the store, not rejected — a stale client asking for a status
  // this build no longer has should see the full list, not an error.
  const statuses = String(req.query?.status || '').trim() || null;
  // `depth` and `httpClass` let the report's crawl-depth and HTTP-status
  // charts open the rows behind a bar. Both are normalised in the store, so an
  // out-of-range depth or an unknown class widens the listing rather than
  // erroring — same contract as `status`.
  const depth = req.query?.depth === undefined ? null : req.query.depth;
  const httpClass = String(req.query?.httpClass || '').trim() || null;
  const indexable = String(req.query?.indexable || '').trim() || null;
  res.json({ ok: true, requestId: req.webQaRequestId, urls: auditStore.listUrls(req.params.id, { ...paginationOf(req), statuses, depth, httpClass, indexable }) });
});

// The distributions the report's discipline sections are drawn from: GROUP BY
// aggregates over columns audit_urls and audit_links already hold. Separate
// from /urls because it is a summary of every row, not a page of them — the
// point is that a 5,000-page audit's Content section costs one small response,
// not 50 pages of URL rows reduced in the client.
app.get('/api/audits/:id/distributions', requireExtensionKey, (req, res) => {
  const audit = getOwnedAudit(req, res);
  if (!audit) return;
  res.json({ ok: true, requestId: req.webQaRequestId, distributions: auditStore.auditDistributions(req.params.id) });
});
app.get('/api/audits/:id/links', requireExtensionKey, (req, res) => {
  const audit = getOwnedAudit(req, res);
  if (!audit) return;
  const status = String(req.query?.status || '').trim() || null;
  const sourceUrl = String(req.query?.sourceUrl || '').trim() || null;
  res.json({ ok: true, requestId: req.webQaRequestId, links: auditStore.listLinks(req.params.id, { ...paginationOf(req), status, sourceUrl }) });
});
app.get('/api/audits/:id/findings', requireExtensionKey, (req, res) => {
  const audit = getOwnedAudit(req, res);
  if (!audit) return;
  if (String(req.query?.groupByRule || '') === '1') {
    return res.json({ ok: true, requestId: req.webQaRequestId, groups: auditStore.findingsByRule(req.params.id) });
  }
  const url = String(req.query?.url || '').trim() || null;
  const ruleId = String(req.query?.ruleId || '').trim() || null;
  const confidence = String(req.query?.confidence || '').trim() || null;
  res.json({ ok: true, requestId: req.webQaRequestId, findings: auditStore.listFindings(req.params.id, { ...paginationOf(req), url, ruleId, confidence }) });
});

// The local render pass: the extension drives the user's own browser through
// the exact single-page scan pipeline "Scan Page" already uses, one crawled
// URL at a time, and submits each result here. Nothing renders on our server
// for this — see the comment above openAuditStore(). It is resumable by
// construction: every page is checkpointed the moment its result lands, so a
// closed panel or a killed service worker only means "click render again",
// never lost progress.
app.get('/api/audits/:id/render-queue', requireExtensionKey, (req, res) => {
  const audit = getOwnedAudit(req, res);
  if (!audit) return;
  const limit = Math.max(1, Math.min(20, Number(req.query?.limit) || 1));
  res.json({ ok: true, requestId: req.webQaRequestId, urls: auditStore.nextUrlsNeedingRender(req.params.id, limit).map((r) => r.url) });
});

app.post('/api/audits/:id/render-result', requireExtensionKey, async (req, res) => {
  const audit = getOwnedAudit(req, res);
  if (!audit) return;
  const report = req.body?.report;
  if (!validReport(report)) return res.status(400).json({ ok: false, error: 'Invalid page report.', requestId: req.webQaRequestId });
  const normalized = auditStore.raw.prepare('SELECT id FROM audit_urls WHERE audit_id = ? AND normalized_url = ?').get(req.params.id, normalizeAuditUrl(report.page.url));
  if (!normalized) return res.status(400).json({ ok: false, error: 'This URL is not part of this audit.', requestId: req.webQaRequestId });
  try {
    const findings = applyFindingPolicy(Array.isArray(report.findings) ? report.findings : [], { type: 'unknown' });
    // Once a page has actually been rendered, prefer its confirmed evidence
    // over the static tier's weaker, inferred equivalent for the SAME fact
    // — never keep both. Most rule IDs are shared verbatim across tiers
    // (see packages/crawl/scanners/*), so an exact rule-ID match already
    // covers most of this; a small alias map handles the few cases where
    // the rendered tier's own axe-core wrapping uses a different name for
    // the same fact the static tier checks under its own name.
    const incomingRuleIds = new Set(findings.map((f) => f.ruleId).filter(Boolean));
    const supersedeRuleIds = new Set(incomingRuleIds);
    for (const [axeRuleId, staticRuleId] of RENDERED_SUPERSEDES_STATIC_ALIASES) {
      if (incomingRuleIds.has(axeRuleId)) supersedeRuleIds.add(staticRuleId);
    }
    auditStore.supersedeStaticFindings(req.params.id, report.page.url, [...supersedeRuleIds]);
    auditStore.recordFindings(req.params.id, report.page.url, findings, { collectionMethod: 'rendered' });
    auditStore.markUrlRendered(req.params.id, report.page.url);
    res.json({ ok: true, requestId: req.webQaRequestId, renderProgress: auditStore.renderProgress(req.params.id) });
  } catch (error) {
    res.status(502).json({ ok: false, error: String(error?.message || error).slice(0, 300), requestId: req.webQaRequestId });
  }
});

// Excel/Sheets/Numbers all treat a leading =, +, - or @ as the start of a
// formula, so a crawled page title or anchor text containing one (e.g. a
// title of "=cmd|'/c calc'!A1") would execute in the analyst's spreadsheet
// the moment this export is opened. Prefixing with a tab keeps the cell as
// text everywhere without changing what a human reader sees.
function csvCell(value) {
  const s = String(value ?? '');
  const escaped = /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  return /^[=+\-@\t\r]/.test(escaped) ? `\t${escaped}` : escaped;
}
function toCsv(rows, columns) {
  const header = columns.map((c) => csvCell(c)).join(',');
  const body = rows.map((row) => columns.map((c) => csvCell(row[c])).join(',')).join('\n');
  return `${header}\n${body}\n`;
}
// [renderedRuleId, staticRuleId] — pairs that check the same fact but were
// named differently across tiers because the rendered ruleId comes from
// axe-core's own wrapping convention. See the render-result handler above.
const RENDERED_SUPERSEDES_STATIC_ALIASES = [
  ['axe.image-alt', 'structure.image-alt-missing']
];
const CSV_COLUMNS = {
  urls: ['url', 'status', 'http_status', 'final_url', 'redirected', 'title', 'meta_description', 'canonical', 'indexable', 'h1_count', 'word_count', 'schema_types', 'discovered_via', 'rendered', 'error', 'fetched_at'],
  links: ['source_url', 'target_url', 'internal', 'anchor_text', 'status', 'http_status', 'final_url', 'redirected', 'checked_at'],
  // Denormalized with the page's own title/status/word count inline — the
  // most common question when opening this file is "what page is this on
  // and what shape is that page in", and that shouldn't require a VLOOKUP
  // against urls.csv first.
  findings: ['url', 'page_title', 'page_status', 'page_word_count', 'rule_id', 'title', 'category', 'severity', 'confidence', 'impact_class', 'collection_method', 'count', 'fingerprint', 'created_at'],
  'urls-summary': ['url', 'status', 'http_status', 'title', 'word_count', 'findings_total', 'fix_count', 'review_count', 'context_count', 'critical_count', 'high_count', 'medium_count', 'low_count']
};

/** Every export dataset joins on the URL string as its key — the same value
 * appears verbatim in urls.csv's `url` column, links.csv's `source_url`/
 * `target_url` columns, and findings.csv's `url` column, so a spreadsheet
 * VLOOKUP/join across the flat files always has a stable key to use. */
function urlMetaMap(auditId) {
  const map = new Map();
  for (const row of auditStore.listUrls(auditId, { limit: 100000, offset: 0 })) map.set(row.url, row);
  return map;
}
function denormalizedFindingRows(auditId, rows) {
  const byUrl = urlMetaMap(auditId);
  return rows.map((f) => {
    const page = byUrl.get(f.url);
    return { ...f, page_title: page?.title || '', page_status: page?.http_status || page?.status || '', page_word_count: page?.word_count ?? '' };
  });
}
function urlsSummaryRows(auditId) {
  const byUrl = urlMetaMap(auditId);
  const counts = new Map();
  for (const url of byUrl.keys()) counts.set(url, { findings_total: 0, fix_count: 0, review_count: 0, context_count: 0, critical_count: 0, high_count: 0, medium_count: 0, low_count: 0 });
  for (const f of auditStore.listFindings(auditId, { limit: 100000, offset: 0 })) {
    const c = counts.get(f.url);
    if (!c) continue;
    c.findings_total++;
    if (f.category === 'fix') c.fix_count++;
    else if (f.category === 'review') c.review_count++;
    else if (f.category === 'context') c.context_count++;
    if (f.severity === 'critical') c.critical_count++;
    else if (f.severity === 'high') c.high_count++;
    else if (f.severity === 'medium') c.medium_count++;
    else if (f.severity === 'low') c.low_count++;
  }
  return [...byUrl.entries()].map(([url, page]) => ({ url, status: page.status, http_status: page.http_status, title: page.title || '', word_count: page.word_count ?? '', ...counts.get(url) }));
}
app.get('/api/audits/:id/report.html', requireExtensionKey, (req, res) => {
  const audit = getOwnedAudit(req, res);
  if (!audit) return;
  const cap = { limit: 20000, offset: 0 };
  const html = renderAuditReportHtml({
    audit: { ...audit, urlCounts: auditStore.urlCountsByStatus(req.params.id) },
    urls: auditStore.listUrls(req.params.id, cap),
    links: auditStore.listLinks(req.params.id, cap),
    findings: auditStore.listFindings(req.params.id, cap),
    findingGroups: auditStore.findingsByRule(req.params.id)
  });
  res.setHeader('content-type', 'text/html; charset=utf-8');
  res.setHeader('content-disposition', `attachment; filename="audit-${req.params.id}-report.html"`);
  res.send(html);
});

app.get('/api/audits/:id/debug.json', requireExtensionKey, (req, res) => {
  const audit = getOwnedAudit(req, res);
  if (!audit) return;
  const cap = { limit: 20000, offset: 0 };
  const bundle = buildAuditDebugBundle({
    audit: { ...audit, urlCounts: auditStore.urlCountsByStatus(req.params.id), linkCounts: auditStore.linkCountsByStatus(req.params.id) },
    urls: auditStore.listUrls(req.params.id, cap),
    links: auditStore.listLinks(req.params.id, cap),
    findings: auditStore.listFindings(req.params.id, cap),
    findingGroups: auditStore.findingsByRule(req.params.id)
  });
  res.setHeader('content-disposition', `attachment; filename="audit-${req.params.id}-debug.json"`);
  res.json(bundle);
});

app.get('/api/audits/:id/export.csv', requireExtensionKey, (req, res) => {
  const audit = getOwnedAudit(req, res);
  if (!audit) return;
  const dataset = String(req.query?.dataset || 'findings');
  if (!CSV_COLUMNS[dataset]) return res.status(400).json({ ok: false, error: 'dataset must be one of urls, links, findings, urls-summary.', requestId: req.webQaRequestId });
  const status = dataset === 'links' ? (String(req.query?.status || '').trim() || null) : null;
  const rows = dataset === 'urls' ? auditStore.listUrls(req.params.id, { limit: 50000, offset: 0 })
    : dataset === 'links' ? auditStore.listLinks(req.params.id, { limit: 50000, offset: 0, status })
      : dataset === 'urls-summary' ? urlsSummaryRows(req.params.id)
        : denormalizedFindingRows(req.params.id, auditStore.listFindings(req.params.id, { limit: 50000, offset: 0 }));
  res.setHeader('content-type', 'text/csv; charset=utf-8');
  res.setHeader('content-disposition', `attachment; filename="audit-${req.params.id}-${dataset}.csv"`);
  res.send(toCsv(rows, CSV_COLUMNS[dataset]));
});

app.use('/api', (req, res) => res.status(404).json({ ok: false, error: 'Unknown API route.', requestId: req.webQaRequestId }));
app.use((err, req, res, next) => {
  if (req.path?.startsWith('/api/')) {
    const status = err?.status || (err?.type === 'entity.parse.failed' ? 400 : 500);
    console.error(`[${req.webQaRequestId}] API error`, err);
    return res.status(status).json({ ok: false, error: status === 400 ? 'Invalid JSON request body.' : 'Unexpected API error.', requestId: req.webQaRequestId });
  }
  next(err);
});

app.use('/assets/ui', express.static(path.resolve(__dirname, '../../packages/ui'), { maxAge: '1h' }));
app.get('/assets/coverage.js', (_req, res) => {
  res.type('application/javascript').sendFile(path.resolve(__dirname, '../../packages/findings/coverage.js'));
});
const web = path.resolve(__dirname, '../../apps/web/public');
app.use(express.static(web, { extensions: ['html'], maxAge: '5m' }));
app.use((req, res) => res.sendFile(path.join(web, 'index.html')));
app.listen(port, () => console.log(`web-qa api ${RELEASE_VERSION} listening on ${port}`));
