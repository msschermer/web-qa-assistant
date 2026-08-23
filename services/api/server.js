import express from 'express';
import helmet from 'helmet';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { allContext, integrationHealth, TOOL_REGISTRY } from '../../packages/connectors/connectors.js';
import { correlate, deterministicBrief } from '../../packages/findings/correlate.js';
import { priorityBrief, frankWalkthrough } from '../../packages/ai/ai.js';
import { buildEvidenceGraph, evidenceHash } from '../../packages/frank/evidence.js';
import { deterministicFrankPlan, validateFrankPlan } from '../../packages/frank/plan.js';
import { classifyEnvironment } from '../../packages/environment/classify.js';
import { applyFindingPolicy } from '../../packages/findings/policy.js';

const app = express();
const port = Number(process.env.PORT || 3000);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const frankCache = new Map();
const FRANK_CACHE_MS = Number(process.env.FRANK_CACHE_MS || 30 * 60 * 1000);
const RELEASE_VERSION = '1.5.1';
function publicAiEnabled(){return /^(1|true|yes)$/i.test(String(process.env.PUBLIC_AI_ENABLED||''))}

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
app.use('/api', (req, res, next) => {
  const key = req.ip || 'unknown', now = Date.now(), b = buckets.get(key) || { n: 0, at: now };
  if (now - b.at > 60000) { b.n = 0; b.at = now; }
  b.n++; buckets.set(key, b);
  const limit = req.path.startsWith('/frank/') ? 40 : 90;
  if (b.n > limit) return res.status(429).json({ ok: false, error: 'Rate limit exceeded', requestId: req.webQaRequestId });
  next();
});

function requireExtensionKey(req, res, next) {
  const expected = String(process.env.ASSISTANT_ACCESS_TOKEN || '');
  if (!expected) return next();
  const actual = String(req.headers['x-web-qa-key'] || '');
  const a = Buffer.from(actual), b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return res.status(401).json({ ok: false, error: 'Assistant access key required.', requestId: req.webQaRequestId });
  next();
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

async function enrich(local, requestId = '', { allowAi = true } = {}) {
  const context = await allContext(local, { requestId });
  const correlated = correlate(local, context);
  const environment = classifyEnvironment(local.page || {}, { canonical: local.page?.canonical, monitored: context.performance?.data?.monitored === true });
  const findings = applyFindingPolicy(correlated, environment);
  const coverage = {
    ...local.coverage,
    published: coverageStatus(context.meta, 'published'),
    performance: coverageStatus(context.performance, 'performance'),
    wcag: coverageStatus(context.wcag, 'wcag')
  };
  const brief = allowAi ? await priorityBrief(findings, coverage, environment, local.linkAudit || null) : { text: deterministicBrief(findings,{ coverage, linkAudit: local.linkAudit || null }), mode: 'deterministic' };
  coverage.ai = brief.mode === 'ai' ? 'complete' : 'deterministic';
  return {
    ok: true,
    requestId,
    report: {
      ...local,
      environment,
      page: { ...local.page, environment },
      findings,
      coverage,
      context: {
        performance: context.performance?.data || null,
        routing: context.routing || null,
        services: { metaState: context.meta, performance: context.performance, wcag: context.wcag }
      },
      priorityBrief: brief.text,
      priorityMode: brief.mode,
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

app.get('/api/health', (req, res) => res.json({ ok: true, service: 'web-qa-assistant', version: RELEASE_VERSION, frank: true, aiConfigured: Boolean(process.env.OPENAI_API_KEY), model: process.env.OPENAI_MODEL || 'gpt-5.6-terra', publicAiEnabled: publicAiEnabled(), requestId: req.webQaRequestId }));
app.get('/api/health/integrations', requireExtensionKey, async (req, res) => {
  const health = await integrationHealth({ requestId: req.webQaRequestId });
  res.json({ ok: true, requestId: req.webQaRequestId, integrations: health, openai: { status: process.env.OPENAI_API_KEY ? 'configured' : 'not configured' }, renderer: { status: 'configured', url: process.env.RENDERER_URL || 'http://localhost:8790' }, tools: TOOL_REGISTRY });
});
app.get('/api/config', (req, res) => res.json({ extensionStoreUrl: process.env.EXTENSION_STORE_URL || '', sourceUrl: 'https://github.com/msschermer/web-qa-assistant', frank: true, version: RELEASE_VERSION }));

// Extension-only gateway routes. If ASSISTANT_ACCESS_TOKEN is configured, the extension must supply it.
app.post('/api/context', requireExtensionKey, async (req, res) => {
  if (!validReport(req.body)) return res.status(400).json({ ok: false, error: 'Invalid local report', requestId: req.webQaRequestId });
  if (privateLike(req.body.page?.hostname)) return res.status(400).json({ ok: false, error: 'Private page evidence must stay local.', requestId: req.webQaRequestId });
  try { res.json(await enrich(req.body, req.webQaRequestId)); } catch (e) { res.status(502).json({ ok: false, error: e.message, requestId: req.webQaRequestId }); }
});
app.post('/api/brief', requireExtensionKey, async (req, res) => {
  const findings = Array.isArray(req.body?.findings) ? req.body.findings : null;
  if (!findings) return res.status(400).json({ ok: false, error: 'Findings required', requestId: req.webQaRequestId });
  try { res.json({ ok: true, requestId: req.webQaRequestId, brief: await priorityBrief(findings, req.body?.coverage || {}, req.body?.environment || {}, req.body?.linkAudit || null) }); } catch (e) { res.status(502).json({ ok: false, error: e.message, requestId: req.webQaRequestId }); }
});
app.post('/api/frank/plan', requireExtensionKey, async (req, res) => {
  const graph = req.body?.graph;
  if (!validGraph(graph)) return res.status(400).json({ ok: false, error: 'A valid Frank evidence graph is required.', requestId: req.webQaRequestId });
  if (privateLike(graph.page?.hostname)) return res.status(400).json({ ok: false, error: 'Private page evidence must stay local.', requestId: req.webQaRequestId });
  const key = `${evidenceHash(graph)}:${process.env.OPENAI_MODEL || 'gpt-5.6-terra'}:frank-v3`;
  const cached = frankCache.get(key);
  if (cached && Date.now() - cached.at < FRANK_CACHE_MS) return res.json({ ok: true, requestId: req.webQaRequestId, plan: cached.plan, cached: true });
  try {
    const plan = await frankWalkthrough(graph);
    if (!validateFrankPlan(plan, graph)) throw new Error('Frank generated an invalid walkthrough plan.');
    frankCache.set(key, { at: Date.now(), plan });
    if (frankCache.size > 250) [...frankCache.entries()].sort((a, b) => a[1].at - b[1].at).slice(0, 50).forEach(([k]) => frankCache.delete(k));
    res.json({ ok: true, requestId: req.webQaRequestId, plan, cached: false });
  } catch (e) { res.status(502).json({ ok: false, error: e.message, requestId: req.webQaRequestId }); }
});

// Public web-scanner routes. The server retains the API key; page evidence is still sanitized before OpenAI use.
app.post('/api/frank/start', async (req, res) => {
  const { finding, report, targetContext } = req.body || {};
  if (!finding?.title || !validReport(report)) return res.status(400).json({ ok: false, error: 'Finding and current report are required.', requestId: req.webQaRequestId });
  if (privateLike(report.page?.hostname)) return res.status(400).json({ ok: false, error: 'Private page evidence must stay local.', requestId: req.webQaRequestId });
  try {
    const graph = buildEvidenceGraph({ finding, page: report.page, coverage: report.coverage || {}, context: report.context || {}, targetContext: targetContext || null, environment: report.environment || report.page?.environment });
    const plan = publicAiEnabled() ? await frankWalkthrough(graph) : deterministicFrankPlan(graph);
    if (!validateFrankPlan(plan, graph)) throw new Error('Frank generated an invalid walkthrough plan.');
    res.json({ ok: true, requestId: req.webQaRequestId, graph, plan });
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
const web = path.resolve(__dirname, '../../apps/web/public');
app.use(express.static(web, { extensions: ['html'], maxAge: '5m' }));
app.use((req, res) => res.sendFile(path.join(web, 'index.html')));
app.listen(port, () => console.log(`web-qa api ${RELEASE_VERSION} listening on ${port}`));
