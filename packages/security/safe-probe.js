/**
 * Safe external destination probing for gateway/renderer (Node).
 * Sync host policy can be mirrored in the extension SW; DNS + hop follow stay server-side.
 * Page-derived URL strings remain untrusted data.
 */
import dns from 'node:dns/promises';
import net from 'node:net';
import { sanitizeUrl } from '../ai/evidence-contract.js';

export const PROBE_DEFAULTS = Object.freeze({
  timeoutMs: 4500,
  maxRedirects: 5,
  maxCandidates: 12,
  concurrency: 4,
  maxBodyBytes: 8192,
  totalBudgetMs: 18000
});

function normalizeHost(host) {
  return String(host || '').toLowerCase().replace(/^\[|\]$/g, '');
}

export function isPrivateIpAddress(ip) {
  const raw = normalizeHost(ip);
  if (!raw) return true;
  if (net.isIPv4(raw)) {
    const p = raw.split('.').map(Number);
    const [a, b] = p;
    if (a === 0 || a === 10 || a === 127 || a >= 224) return true;
    if (a === 169 && b === 254) return true; // link-local / metadata
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
    if (a === 198 && (b === 18 || b === 19)) return true; // benchmarking
    return false;
  }
  if (net.isIPv6(raw)) {
    const h = raw.toLowerCase();
    if (h === '::1' || h === '::') return true;
    if (h.startsWith('fc') || h.startsWith('fd')) return true; // ULA
    if (h.startsWith('fe80:')) return true; // link-local
    if (h.startsWith('ff')) return true; // multicast
    // IPv4-mapped
    const mapped = h.match(/^:?:ffff:(\d+\.\d+\.\d+\.\d+)$/i) || h.match(/^:?:ffff:([0-9a-f:.]+)$/i);
    if (mapped && net.isIPv4(mapped[1])) return isPrivateIpAddress(mapped[1]);
    return false;
  }
  return true;
}

export function isPrivateProbeHost(host) {
  const h = normalizeHost(host);
  if (!h) return true;
  if (h === 'localhost' || h.endsWith('.localhost') || h.endsWith('.local') || h.endsWith('.internal')) return true;
  if (net.isIP(h)) return isPrivateIpAddress(h);
  if (/^127\./.test(h) || /^10\./.test(h) || /^192\.168\./.test(h) || /^169\.254\./.test(h) || /^0\.0\.0\.0$/.test(h)) return true;
  const m = /^172\.(\d+)\./.exec(h);
  if (m && Number(m[1]) >= 16 && Number(m[1]) <= 31) return true;
  const c = /^100\.(\d+)\./.exec(h);
  if (c && Number(c[1]) >= 64 && Number(c[1]) <= 127) return true;
  return false;
}

/** Sync URL gate (no DNS). Strips fragment. Keeps query for the actual request. */
export function sanitizeProbeUrl(raw) {
  try {
    const u = new URL(String(raw || ''));
    if (!/^https?:$/.test(u.protocol)) return null;
    if (u.username || u.password) return null;
    if (isPrivateProbeHost(u.hostname)) return null;
    u.hash = '';
    return u.toString();
  } catch {
    return null;
  }
}

export function evidenceUrl(raw) {
  return sanitizeUrl(raw);
}

export async function assertPublicProbeDestination(raw, options = {}) {
  const url = sanitizeProbeUrl(raw);
  if (!url) return { ok: false, error: 'destination-not-allowed', url: null };
  let parsed;
  try { parsed = new URL(url); } catch { return { ok: false, error: 'destination-not-allowed', url: null }; }
  if (net.isIP(parsed.hostname)) {
    if (isPrivateIpAddress(parsed.hostname)) return { ok: false, error: 'destination-not-allowed', url: null };
    return { ok: true, url, addresses: [parsed.hostname] };
  }
  try {
    const lookup = options.lookup || ((hostname, opts) => dns.lookup(hostname, opts));
    const records = await lookup(parsed.hostname, { all: true, verbatim: true });
    if (!records.length) return { ok: false, error: 'dns-failed', url: null };
    for (const row of records) {
      if (isPrivateIpAddress(row.address)) return { ok: false, error: 'destination-not-allowed', url: null };
    }
    return { ok: true, url, addresses: records.map((r) => r.address) };
  } catch {
    return { ok: false, error: 'dns-failed', url: null };
  }
}

function redirectLocation(res, currentUrl) {
  const loc = res.headers.get('location');
  if (!loc) return null;
  try { return new URL(loc, currentUrl).toString(); } catch { return null; }
}

async function fetchHop(url, method, timeoutMs, maxBodyBytes, fetchImpl = fetch) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetchImpl(url, {
      method,
      redirect: 'manual',
      credentials: 'omit',
      cache: 'no-store',
      signal: controller.signal,
      headers: {
        'accept': '*/*',
        // Intentionally omit Authorization, Cookie, and Referer.
      }
    });
    if (method === 'GET' && res.body) {
      try {
        const reader = res.body.getReader();
        let seen = 0;
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          seen += value?.byteLength || 0;
          if (seen >= maxBodyBytes) {
            await reader.cancel().catch(() => {});
            break;
          }
        }
      } catch {
        try { await res.body.cancel(); } catch {}
      }
    }
    return res;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Probe one destination with DNS+SSRF on every hop.
 * HEAD first; GET fallback when HEAD is rejected/ambiguous.
 */
export async function probeExternalDestination(raw, options = {}) {
  const timeoutMs = Number(options.timeoutMs || PROBE_DEFAULTS.timeoutMs);
  const maxRedirects = Number(options.maxRedirects || PROBE_DEFAULTS.maxRedirects);
  const maxBodyBytes = Number(options.maxBodyBytes || PROBE_DEFAULTS.maxBodyBytes);
  const started = Date.now();
  let current = String(raw || '');
  let redirected = false;
  let usedGet = false;

  for (let hop = 0; hop <= maxRedirects; hop++) {
    const gate = await assertPublicProbeDestination(current, options);
    if (!gate.ok) {
      return {
        url: String(raw || ''),
        status: 0,
        error: gate.error || 'destination-not-allowed',
        finalUrl: evidenceUrl(current),
        redirected,
        durationMs: Date.now() - started,
        method: usedGet ? 'GET' : 'HEAD'
      };
    }

    let res;
    try {
      res = await fetchHop(gate.url, usedGet ? 'GET' : 'HEAD', timeoutMs, maxBodyBytes, options.fetch || fetch);
    } catch (error) {
      const msg = String(error?.name === 'AbortError' ? 'timeout' : (error?.message || error));
      return {
        url: String(raw || ''),
        status: 0,
        error: /abort|timeout/i.test(msg) ? 'timeout' : msg,
        finalUrl: evidenceUrl(gate.url),
        redirected,
        durationMs: Date.now() - started,
        method: usedGet ? 'GET' : 'HEAD'
      };
    }

    const status = Number(res.status || 0);
    if ([301, 302, 303, 307, 308].includes(status)) {
      const next = redirectLocation(res, gate.url);
      if (!next) {
        return {
          url: String(raw || ''),
          status,
          error: 'redirect-missing-location',
          finalUrl: evidenceUrl(gate.url),
          redirected: true,
          durationMs: Date.now() - started,
          method: usedGet ? 'GET' : 'HEAD'
        };
      }
      redirected = true;
      current = next;
      if ([302, 303].includes(status)) usedGet = true; // historical POST→GET; for HEAD continue with GET on 303
      continue;
    }

    // HEAD often unsupported — fall back once to GET on same URL.
    if (!usedGet && (status === 405 || status === 501)) {
      usedGet = true;
      hop -= 1;
      continue;
    }

    return {
      url: String(raw || ''),
      status,
      finalUrl: evidenceUrl(gate.url),
      redirected,
      durationMs: Date.now() - started,
      method: usedGet ? 'GET' : 'HEAD'
    };
  }

  return {
    url: String(raw || ''),
    status: 0,
    error: 'redirect-limit',
    finalUrl: evidenceUrl(current),
    redirected: true,
    durationMs: Date.now() - started,
    method: usedGet ? 'GET' : 'HEAD'
  };
}

function candidateKey(url) {
  try {
    const u = new URL(String(url || ''));
    u.hash = '';
    return u.toString();
  } catch {
    return String(url || '');
  }
}

/**
 * Deduped, budgeted probe of external candidates.
 * Returns rows aligned to original candidate URLs (duplicates share one network result).
 */
export async function probeExternalCandidates(candidates = [], options = {}) {
  const maxCandidates = Number(options.maxCandidates || PROBE_DEFAULTS.maxCandidates);
  const concurrency = Math.max(1, Number(options.concurrency || PROBE_DEFAULTS.concurrency));
  const totalBudgetMs = Number(options.totalBudgetMs || PROBE_DEFAULTS.totalBudgetMs);
  const startedAll = Date.now();
  const list = (Array.isArray(candidates) ? candidates : []).slice(0, maxCandidates);
  const byKey = new Map();
  for (const c of list) {
    const key = candidateKey(c?.url);
    if (!byKey.has(key)) byKey.set(key, []);
    byKey.get(key).push(c);
  }

  const uniqueUrls = [...byKey.keys()];
  const resultByKey = new Map();
  let cursor = 0;

  async function worker() {
    while (cursor < uniqueUrls.length) {
      if (Date.now() - startedAll > totalBudgetMs) {
        const url = uniqueUrls[cursor++];
        resultByKey.set(url, {
          url,
          status: 0,
          error: 'budget-exhausted',
          finalUrl: evidenceUrl(url),
          redirected: false,
          durationMs: 0,
          method: 'HEAD'
        });
        continue;
      }
      const url = uniqueUrls[cursor++];
      const row = await probeExternalDestination(url, options);
      resultByKey.set(url, { ...row, url });
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, uniqueUrls.length || 1) }, () => worker()));

  // One row per original candidate (preserve occurrence identity upstream).
  return list.map((c) => {
    const key = candidateKey(c?.url);
    const row = resultByKey.get(key) || { url: c?.url, status: 0, error: 'unavailable', durationMs: 0 };
    return { ...row, url: c.url };
  });
}

/**
 * Pure mapping from privileged probe rows → findings / incompleteChecks
 * (no DOM). Mirrors browser-rules applyExternalProbeResults classification.
 */
export function mapExternalProbeRows(candidates = [], probeRows = []) {
  const byUrl = new Map((probeRows || []).map((r) => [String(r.url || ''), r]));
  const findings = [];
  const incompleteChecks = [];
  const resolvedUrls = new Set();

  for (const candidate of candidates || []) {
    const row = byUrl.get(candidate.url);
    if (!row) continue;
    const status = Number(row.status || 0);
    const text = candidate.text || '';
    const occurrences = Number(candidate.occurrences || 1);
    const attempt = {
      attempt: 1,
      state: status ? 'complete' : 'unavailable',
      status,
      durationMs: Number(row.durationMs || 0),
      finalUrl: row.finalUrl || candidate.url
    };
    const link = {
      url: candidate.url,
      internal: false,
      status,
      state: status ? 'complete' : (row.error || 'unavailable'),
      finalUrl: row.finalUrl || candidate.url,
      redirected: Boolean(row.redirected),
      occurrences,
      sources: candidate.sources || [],
      text,
      prominence: candidate.prominence || '',
      location: candidate.location || ''
    };
    const verification = {
      state: 'confirmed',
      method: 'privileged external GET',
      attempts: 1,
      evidence: [attempt]
    };

    if (status === 404 || status === 410) {
      findings.push({
        id: `navigation.link-${status}-external:${hash(candidate.url)}`,
        ruleId: `navigation.link-${status === 410 ? 410 : 404}-external`,
        title: 'External link points to a missing page',
        detail: `${text ? `"${text}" ` : ''}points to ${evidenceUrl(candidate.url)}. A privileged request confirmed HTTP ${status}.`,
        category: 'fix',
        severity: 'high',
        confidence: 'confirmed',
        evidence: `confirmed ${status} ${evidenceUrl(candidate.url)}`,
        count: occurrences,
        selector: candidate.selector || '',
        targetType: 'visual',
        sources: ['browser'],
        link,
        verification,
        fingerprint: hash(`ext-${status}|${candidate.url}|${occurrences}`)
      });
      resolvedUrls.add(candidate.url);
      continue;
    }
    if (status >= 500) {
      findings.push({
        id: `navigation.link-5xx-external:${hash(candidate.url)}`,
        ruleId: 'navigation.link-5xx-external',
        title: 'External link points to a server error',
        detail: `${text ? `"${text}" ` : ''}points to ${evidenceUrl(candidate.url)}. A privileged request confirmed a server error.`,
        category: 'fix',
        severity: 'critical',
        confidence: 'confirmed',
        evidence: `confirmed ${status} ${evidenceUrl(candidate.url)}`,
        count: occurrences,
        selector: candidate.selector || '',
        targetType: 'visual',
        sources: ['browser'],
        link,
        verification,
        fingerprint: hash(`ext-5xx|${candidate.url}|${status}`)
      });
      resolvedUrls.add(candidate.url);
      continue;
    }
    if (status >= 200 && status < 400) {
      resolvedUrls.add(candidate.url);
      continue;
    }
    incompleteChecks.push({
      kind: 'external-link',
      url: candidate.url,
      path: candidate.url,
      text,
      reason: status ? `http-${status}` : (row.error || 'unavailable'),
      status,
      attempts: [attempt],
      prominence: candidate.prominence || '',
      location: candidate.location || ''
    });
    resolvedUrls.add(candidate.url);
  }

  return { findings, incompleteChecks, resolvedUrls: [...resolvedUrls] };
}

function hash(input) {
  let h = 2166136261;
  const text = String(input || '');
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(36);
}
