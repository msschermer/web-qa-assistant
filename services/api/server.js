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
import { classifyEnvironment } from '../../packages/environment/classify.js';
import { applyFindingPolicy } from '../../packages/findings/policy.js';
import { resolvePerformanceCoverage, applyPrivilegedProbeAccounting, reconcilePerformanceCoverage } from '../../packages/findings/coverage.js';
import { buildEvidenceLedger } from '../../packages/findings/evidence-ledger.js';
import { applyTargetIntegrityReport, attachTargetIntegrity, finalizeBlockedTargetReport } from '../../packages/integrity/apply-report.js';
import { targetIntegrityLimitsAudit, targetIntegrityBlocksAudit } from '../../packages/integrity/target-integrity.js';
import { issueInstallationToken, verifyInstallationToken } from '../../packages/auth/install-access.js';
import { probeExternalCandidates, mapExternalProbeRows } from '../../packages/security/safe-probe.js';

const app = express();
const port = Number(process.env.PORT || 3000);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const frankCache = new Map();
const FRANK_CACHE_MS = Number(process.env.FRANK_CACHE_MS || 30 * 60 * 1000);
const RELEASE_VERSION = '1.7.4';
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

  const rows = await probeExternalCandidates(candidates, { maxCandidates: 80, concurrency: 6, totalBudgetMs: 20000 });
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
  const environment = classifyEnvironment(base.page || {}, { canonical: base.page?.canonical, monitored: context.performance?.data?.monitored === true });
  const policyFindings = applyFindingPolicy(correlated, environment);
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
  return {
    ok: true,
    requestId,
    report: {
      ...finalized,
      environment,
      page: { ...finalized.page, environment },
      findings: finalized.findings,
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
    : { status: extensionCloudAiEnabled() ? 'not-probed' : 'disabled', operational: false, configured: Boolean(process.env.OPENAI_API_KEY), model: process.env.OPENAI_MODEL || 'gpt-5.6-terra', message: extensionCloudAiEnabled() ? 'Cloud AI fallback is enabled but was not probed.' : 'Cloud AI fallback is disabled. Frank prefers Chrome built-in AI on the user device.' };
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
  if (!validGraph(graph)) return res.status(400).json({ ok: false, error: 'A valid Frank evidence graph is required.', requestId: req.webQaRequestId });
  if (privateLike(graph.page?.hostname)) return res.status(400).json({ ok: false, error: 'Private page evidence must stay local.', requestId: req.webQaRequestId });
  if (!consumeManagedAiQuota(req, res)) return;
  const key = `${evidenceHash(graph)}:${process.env.OPENAI_MODEL || 'gpt-5.6-terra'}:frank-v3`;
  const cached = frankCache.get(key);
  if (cached && Date.now() - cached.at < FRANK_CACHE_MS) return res.json({ ok: true, requestId: req.webQaRequestId, plan: cached.plan, reasoning: cached.reasoning, cached: true });
  try {
    const plan = await frankWalkthrough(graph);
    if (!validateFrankPlan(plan, graph)) throw new Error('Frank generated an invalid walkthrough plan.');
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
    if (!validateFrankPlan(plan, graph)) throw new Error('Frank generated an invalid walkthrough plan.');
    res.json({ ok: true, requestId: req.webQaRequestId, graph, plan, reasoning });
  } catch (e) { res.status(502).json({ ok: false, error: e.message, requestId: req.webQaRequestId }); }
});
app.post('/api/frank/snapshot', async (req, res) => {
  const url = String(req.body?.url || '').trim(), selector = String(req.body?.selector || '').trim().slice(0, 1200);
  if (!/^https?:\/\//i.test(url)) return res.status(400).json({ ok: false, error: 'Enter a public HTTP or HTTPS URL.', requestId: req.webQaRequestId });
  try { res.json({ ...(await rendererPost('/snapshot', { url, selector }, 16000, req.webQaRequestId)), requestId: req.webQaRequestId }); }
  catch (e) { res.status(e.name === 'AbortError' ? 504 : (e.status || 502)).json({ ok: false, error: e.name === 'AbortError' ? 'Frank snapshot timed out.' : e.message, requestId: req.webQaRequestId }); }
});
app.post('/api/scan', async (req, res) => {
  const url = String(req.body?.url || '').trim();
  if (!/^https?:\/\//i.test(url)) return res.status(400).json({ ok: false, error: 'Enter a public HTTP or HTTPS URL.', requestId: req.webQaRequestId });
  try { const data = await rendererPost('/scan', { url }, Number(process.env.SCAN_TIMEOUT_MS || 30000), req.webQaRequestId); res.json(await enrich(data.report, req.webQaRequestId, { allowAi: publicAiEnabled() })); }
  catch (e) { res.status(e.name === 'AbortError' ? 504 : (e.status || 502)).json({ ok: false, error: e.name === 'AbortError' ? 'Public scan timed out.' : e.message, requestId: req.webQaRequestId }); }
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
