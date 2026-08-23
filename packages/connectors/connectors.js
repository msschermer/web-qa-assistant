import { signalForFinding } from '../findings/signals.js';

const TIMEOUT_MS = Number(process.env.CONNECTOR_TIMEOUT_MS || 5000);

function base(value) { return String(value || '').replace(/\/$/, ''); }
function hostname(url) {
  try { return new URL(url).hostname.replace(/^www\./, '').toLowerCase(); }
  catch { return ''; }
}

async function request(url, options = {}, { requestId = '', timeoutMs = TIMEOUT_MS } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      ...options,
      signal: controller.signal,
      headers: {
        'content-type': 'application/json',
        ...(requestId ? { 'x-web-qa-request-id': requestId } : {}),
        ...(options.headers || {})
      }
    });
    const text = await res.text();
    if (!text.trim()) throw new Error(`empty response (HTTP ${res.status})`);
    let data;
    try { data = JSON.parse(text); }
    catch { throw new Error(`invalid JSON response (HTTP ${res.status})`); }
    if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`);
    return data;
  } finally {
    clearTimeout(timer);
  }
}

async function safe(name, fn) {
  const startedAt = Date.now();
  try {
    return { status: 'complete', data: await fn(), latencyMs: Date.now() - startedAt };
  } catch (error) {
    const reason = error?.name === 'AbortError' ? 'timeout' : (error?.message || 'unavailable');
    return { status: 'unavailable', error: `${name}: ${reason}`, latencyMs: Date.now() - startedAt };
  }
}

export async function metaState(url, options = {}) {
  return safe('Meta State Validator', () => request(`${base(process.env.META_STATE_URL || 'https://meta-state.msschermer.us')}${process.env.META_STATE_PATH || '/api/inspect'}`, {
    method: 'POST', body: JSON.stringify({ url })
  }, options));
}

function historyRows(value) {
  if (Array.isArray(value)) return value;
  if (Array.isArray(value?.history)) return value.history;
  if (Array.isArray(value?.data)) return value.data;
  return [];
}
function successful(history, strategy) {
  return history.filter(x => x?.strategy === strategy && Number.isFinite(x?.score)).sort((a, b) => new Date(a.checkedAt || 0) - new Date(b.checkedAt || 0));
}

export async function performance(url, options = {}) {
  return safe('Performance Monitor', async () => {
    const root = base(process.env.PERFORMANCE_MONITOR_URL || 'https://psi.msschermer.us');
    const data = await request(`${root}/api/data`, { method: 'GET' }, options);
    const host = hostname(url);
    const site = (data.sites || []).find(s => hostname(s.url) === host);
    if (!site) return { monitored: false, hostname: host, threshold: data.threshold ?? 70 };
    let history = [];
    try { history = historyRows(await request(`${root}/api/sites/${site.id}/history`, { method: 'GET' }, options)); } catch {}
    const mobile = successful(history, 'mobile'), desktop = successful(history, 'desktop');
    const delta = rows => rows.length > 1 ? rows.at(-1).score - rows.at(-2).score : null;
    return {
      monitored: true, siteId: site.id, label: site.label, url: site.url, threshold: data.threshold ?? 70,
      mobile: site.mobile, desktop: site.desktop, mobileStatus: site.mobileStatus, desktopStatus: site.desktopStatus,
      lastChecked: site.lastChecked, mobileChange: delta(mobile), desktopChange: delta(desktop), latestScan: data.latestScan || null
    };
  });
}

function criteriaFrom(value) {
  const found = new Set();
  const visit = x => {
    if (!x) return;
    if (typeof x === 'string') { (x.match(/\b[1-4]\.\d+\.\d+\b/g) || []).forEach(v => found.add(v)); return; }
    if (Array.isArray(x)) return x.forEach(visit);
    if (typeof x === 'object') for (const [key, val] of Object.entries(x)) if (/criterion|criteria|success/i.test(key)) visit(val);
  };
  visit(value); return [...found];
}
function summaryFrom(value) {
  if (!value || typeof value !== 'object') return '';
  for (const key of ['summary', 'explanation', 'matchExplanation', 'detail', 'description']) if (typeof value[key] === 'string' && value[key].trim()) return value[key].trim();
  return '';
}
function entryList(data) {
  if (Array.isArray(data)) return data;
  for (const key of ['results', 'matches', 'translations', 'items']) if (Array.isArray(data?.[key])) return data[key];
  return [];
}
function entryInput(entry) { return String(entry?.input || entry?.query || entry?.ruleId || entry?.rule || entry?.term || entry?.sourceText || '').trim(); }

export async function wcag(findings, options = {}) {
  const rules = [...new Set((findings || []).filter(f => f.ruleId?.startsWith('axe.') && f.confidence !== 'inconclusive').map(f => f.ruleId.replace(/^axe\./, '').replace(/\.review$/, '')))];
  if (!rules.length) return { status: 'not_applicable', data: { mapping: {} }, latencyMs: 0 };
  return safe('WCAG Translator', async () => {
    const root = base(process.env.WCAG_TRANSLATOR_URL || 'https://wcag-translator.msschermer.us');
    const path = process.env.WCAG_TRANSLATOR_PATH || '/v1/translate';
    const mapping = {};
    const batch = await request(root + path, { method: 'POST', body: JSON.stringify({ query: rules.join(', '), version: '2.2' }) }, options);
    for (const entry of entryList(batch)) {
      const input = entryInput(entry), key = rules.find(rule => input === rule || input.includes(rule));
      if (key) mapping[key] = { criteria: criteriaFrom(entry), summary: summaryFrom(entry) };
    }
    const missing = rules.filter(rule => !mapping[rule]).slice(0, 8);
    await Promise.all(missing.map(async rule => {
      try {
        const one = await request(root + path, { method: 'POST', body: JSON.stringify({ query: rule, version: '2.2' }) }, options);
        mapping[rule] = { criteria: criteriaFrom(one), summary: summaryFrom(one) };
      } catch {}
    }));
    return { mapping };
  });
}

export const TOOL_REGISTRY = Object.freeze({
  metaState: { label: 'Meta State', capability: 'published-state', signals: ['indexing', 'canonical', 'redirect', 'metadata', 'schema'], baseline: true },
  performance: { label: 'Performance Monitor', capability: 'performance-history', signals: ['performance'], baseline: true },
  wcag: { label: 'WCAG Translator', capability: 'accessibility-standards', signals: ['a11y'], baseline: false }
});

export function plannedTools(local = {}) {
  const families = new Set((local.findings || []).map(f => signalForFinding(f).split('.')[0]));
  return Object.entries(TOOL_REGISTRY).filter(([, tool]) => tool.baseline || tool.signals.some(s => families.has(s))).map(([id]) => id);
}

export async function allContext(local, options = {}) {
  const url = local.page?.url;
  const planned = plannedTools(local);
  const tasks = {
    metaState: planned.includes('metaState') ? metaState(url, options) : Promise.resolve({ status: 'not_applicable', data: null, latencyMs: 0 }),
    performance: planned.includes('performance') ? performance(url, options) : Promise.resolve({ status: 'not_applicable', data: null, latencyMs: 0 }),
    wcag: planned.includes('wcag') ? wcag(local.findings, options) : Promise.resolve({ status: 'not_applicable', data: { mapping: {} }, latencyMs: 0 })
  };
  const [meta, perf, wc] = await Promise.all([tasks.metaState, tasks.performance, tasks.wcag]);
  return { meta, performance: perf, wcag: wc, routing: { planned, registry: TOOL_REGISTRY } };
}

async function probe(label, url, options = {}, requestOptions = {}) {
  const startedAt = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Number(options.timeoutMs || TIMEOUT_MS));
  try {
    const method = String(requestOptions.method || 'GET').toUpperCase();
    const headers = {
      ...(requestOptions.body !== undefined ? { 'content-type': 'application/json' } : {}),
      ...(options.requestId ? { 'x-web-qa-request-id': options.requestId } : {}),
      ...(requestOptions.headers || {})
    };
    const res = await fetch(url, {
      method,
      signal: controller.signal,
      headers,
      ...(requestOptions.body !== undefined ? { body: JSON.stringify(requestOptions.body) } : {})
    });
    // "Available" means the same capability endpoint used during a real scan
    // accepted its real request contract. Host reachability alone is not enough.
    const code = res.status;
    let status;
    if (res.ok) status = 'available';
    else if (code === 401 || code === 403) status = 'unauthorized';
    else if (code === 404 || code === 410) status = 'not-found';
    else if (code >= 500) status = 'degraded';
    else status = 'degraded';
    return {
      label, status, httpStatus: code, latencyMs: Date.now() - startedAt, reachable: true,
      detail: status === 'available' ? 'Capability probe succeeded.' :
        status === 'unauthorized' ? 'Capability endpoint responded but rejected the request. Check the integration access token or service policy.' :
        status === 'not-found' ? 'Capability endpoint does not exist at the configured path. Check the integration URL/path.' :
        `Capability endpoint responded with HTTP ${code}.`
    };
  } catch (error) {
    return {
      label, status: 'unavailable', reachable: false,
      error: error?.name === 'AbortError' ? 'timeout' : String(error?.message || error),
      detail: 'Capability endpoint could not be reached.',
      latencyMs: Date.now() - startedAt
    };
  } finally { clearTimeout(timer); }
}

export async function integrationHealth(options = {}) {
  const metaRoot = base(process.env.META_STATE_URL || 'https://meta-state.msschermer.us');
  const metaPath = process.env.META_STATE_HEALTH_PATH || process.env.META_STATE_PATH || '/api/inspect';
  const perfRoot = base(process.env.PERFORMANCE_MONITOR_URL || 'https://psi.msschermer.us');
  const perfPath = process.env.PERFORMANCE_MONITOR_HEALTH_PATH || '/api/data';
  const wcagRoot = base(process.env.WCAG_TRANSLATOR_URL || 'https://wcag-translator.msschermer.us');
  const wcagPath = process.env.WCAG_TRANSLATOR_HEALTH_PATH || process.env.WCAG_TRANSLATOR_PATH || '/v1/translate';
  const rows = await Promise.all([
    probe('Meta State', `${metaRoot}${metaPath}`, options, { method: 'POST', body: { url: 'https://example.com/' } }),
    probe('Performance Monitor', `${perfRoot}${perfPath}`, options, { method: 'GET' }),
    probe('WCAG Translator', `${wcagRoot}${wcagPath}`, options, { method: 'POST', body: { query: 'alt', version: '2.2' } })
  ]);
  return Object.fromEntries(rows.map(row => [row.label, row]));
}
