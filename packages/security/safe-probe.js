/**
 * Safe external destination probing for gateway/renderer (Node).
 * Sync host policy can be mirrored in the extension SW; DNS + hop follow stay server-side.
 * Page-derived URL strings remain untrusted data.
 */
import dns from 'node:dns/promises';
import net from 'node:net';
import { Agent, fetch as undiciFetch } from 'undici';
import { sanitizeUrl } from '../ai/evidence-contract.js';

/**
 * A browser refuses to show the response at all here — it interstitials the
 * visitor with a security warning instead. That's a confirmed, actionable fact
 * about the destination (distinct from "we couldn't tell"), so it must not be
 * silently absorbed into the generic network-failure/inconclusive bucket. It
 * also must never be worked around by disabling TLS verification: an
 * unreachable-behind-a-bad-certificate destination is exactly the case where
 * blindly trusting the connection would be the wrong fix.
 */
const TLS_ERROR_CODE_PATTERN = /^(CERT_|DEPTH_|SELF_SIGNED|UNABLE_TO_(GET|VERIFY)|ERR_TLS_|HOSTNAME_MISMATCH$)/;
export function isTlsErrorCode(code = '') {
  return TLS_ERROR_CODE_PATTERN.test(String(code || ''));
}

export const PROBE_DEFAULTS = Object.freeze({
  timeoutMs: 4500,
  maxRedirects: 5,
  maxCandidates: 80,
  concurrency: 4,
  perHostConcurrency: 2,
  maxBodyBytes: 8192,
  totalBudgetMs: 18000
});

function normalizeHost(host) {
  return String(host || '').toLowerCase().replace(/^\[|\]$/g, '');
}

function ipv4MappedFromHex(h) {
  const m = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/i.exec(h);
  if (!m) return null;
  const hi = parseInt(m[1], 16);
  const lo = parseInt(m[2], 16);
  if (!Number.isFinite(hi) || !Number.isFinite(lo)) return null;
  return `${(hi >> 8) & 255}.${hi & 255}.${(lo >> 8) & 255}.${lo & 255}`;
}

export function isPrivateIpAddress(ip) {
  const raw = normalizeHost(ip);
  if (!raw) return true;
  if (net.isIPv4(raw)) {
    const p = raw.split('.').map(Number);
    const [a, b] = p;
    if (a === 0 || a === 10 || a === 127 || a >= 224) return true;
    if (a === 169 && b === 254) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 100 && b >= 64 && b <= 127) return true;
    if (a === 198 && (b === 18 || b === 19)) return true;
    return false;
  }
  if (net.isIPv6(raw)) {
    const h = raw.toLowerCase();
    if (h === '::1' || h === '::') return true;
    if (h.startsWith('fc') || h.startsWith('fd')) return true;
    if (h.startsWith('fe80:')) return true;
    if (h.startsWith('ff')) return true;
    const dotted = h.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/i);
    if (dotted) return isPrivateIpAddress(dotted[1]);
    const fromHex = ipv4MappedFromHex(h);
    if (fromHex) return isPrivateIpAddress(fromHex);
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
  try {
    const next = new URL(loc, currentUrl);
    if (!/^https?:$/i.test(next.protocol)) return null;
    if (next.username || next.password) return null;
    return next.toString();
  } catch { return null; }
}

/**
 * Node's connect layer calls back into a custom `lookup` with {all:true}
 * whenever it uses dual-stack/Happy-Eyeballs connection logic (its default
 * since Node 18+), and then expects an array of {address,family} records, not
 * the legacy 3-argument (err, address, family) shape. Answering with the
 * legacy shape regardless of `options.all` makes Node treat the pinned IP
 * string as an addresses array and fail every single external probe
 * instantly with ERR_INVALID_IP_ADDRESS ("Invalid IP address: undefined") —
 * surfacing only as an opaque, generic "fetch failed". Exported standalone so
 * this exact contract can be pinned by a test without a live network call.
 */
export function pinnedLookup(pick, family) {
  return (_host, options, callback) => {
    if (!pick || isPrivateIpAddress(pick)) {
      callback(new Error('destination-not-allowed'));
      return;
    }
    if (options && options.all) callback(null, [{ address: pick, family }]);
    else callback(null, pick, family);
  };
}

function pinnedFetch(addresses, hostname) {
  const pick = normalizeHost((addresses || [])[0] || '');
  const family = net.isIPv6(pick) ? 6 : 4;
  const agent = new Agent({ connect: { lookup: pinnedLookup(pick, family) } });
  return (url, init = {}) => undiciFetch(url, {
    ...init,
    dispatcher: agent,
    headers: { ...(init.headers || {}), host: hostname }
  });
}

async function fetchHop(url, method, timeoutMs, maxBodyBytes, fetchImpl) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetchImpl(url, {
      method,
      redirect: 'manual',
      credentials: 'omit',
      cache: 'no-store',
      signal: controller.signal,
      // A single, low-volume "is this link still reachable" check is what a
      // browser does when a person clicks it — not a crawl of the
      // destination's structure — so a browser-realistic header set here
      // (rather than an honest bot UA, which is right for the site being
      // audited itself) cuts down on false "broken" results from sites whose
      // bot-protection blocks anything that doesn't look like a browser. It
      // does not, and cannot, get past protection keyed on IP reputation or
      // TLS fingerprint (Yelp-style aggressive WAFs) — those still need a
      // human to confirm manually, which is exactly why a 403/401/429 here
      // is reported as "blocked", never as a confirmed broken link.
      headers: {
        accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
        'accept-language': 'en-US,en;q=0.9',
        'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
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

function isRedirect(status) {
  return [301, 302, 303, 307, 308].includes(status);
}

function isMissingOrServerError(status) {
  return status === 404 || status === 410 || status >= 500;
}

/**
 * Probe one destination with DNS+SSRF on every hop (addresses pinned for connect).
 * HEAD is preflight only. Broken/5xx require agreeing dual GET.
 */
export async function probeExternalDestination(raw, options = {}) {
  const timeoutMs = Number(options.timeoutMs || PROBE_DEFAULTS.timeoutMs);
  const maxRedirects = Number(options.maxRedirects || PROBE_DEFAULTS.maxRedirects);
  const maxBodyBytes = Number(options.maxBodyBytes || PROBE_DEFAULTS.maxBodyBytes);
  const started = Date.now();
  let current = String(raw || '');
  let redirected = false;
  let method = 'HEAD';
  // Every hop is a real decision (gate check + at least a network attempt or an
  // explicit safety refusal), so these destinations must still be attempts>=1 —
  // otherwise mapExternalProbeRows silently drops them instead of reporting why.
  const visited = new Set([current]);

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
        method,
        attempts: 1
      };
    }

    const hostname = new URL(gate.url).hostname;
    const fetchImpl = options.fetch || pinnedFetch(gate.addresses, hostname);

    let headStatus = 0;
    try {
      const headRes = await fetchHop(gate.url, 'HEAD', timeoutMs, maxBodyBytes, fetchImpl);
      headStatus = Number(headRes.status || 0);
      if (isRedirect(headStatus)) {
        const next = redirectLocation(headRes, gate.url);
        if (!next) {
          return {
            url: String(raw || ''),
            status: headStatus,
            error: 'redirect-missing-location',
            finalUrl: evidenceUrl(gate.url),
            redirected: true,
            durationMs: Date.now() - started,
            method: 'HEAD',
            attempts: 1
          };
        }
        if (visited.has(next)) {
          return {
            url: String(raw || ''),
            status: headStatus,
            error: 'redirect-loop',
            finalUrl: evidenceUrl(next),
            redirected: true,
            durationMs: Date.now() - started,
            method: 'HEAD',
            attempts: 1
          };
        }
        visited.add(next);
        redirected = true;
        current = next;
        continue;
      }
    } catch (error) {
      headStatus = 0;
      const msg = String(error?.message || error);
      if (/destination-not-allowed/i.test(msg)) {
        return {
          url: String(raw || ''),
          status: 0,
          error: 'destination-not-allowed',
          finalUrl: evidenceUrl(gate.url),
          redirected,
          durationMs: Date.now() - started,
          method: 'HEAD',
          attempts: 1
        };
      }
    }

    // HEAD 2xx is a cheap healthy signal — never confirm broken from HEAD alone.
    if (headStatus >= 200 && headStatus < 400) {
      return {
        url: String(raw || ''),
        status: headStatus,
        finalUrl: evidenceUrl(gate.url),
        redirected,
        durationMs: Date.now() - started,
        method: 'HEAD',
        attempts: 1
      };
    }

    method = 'GET';
    let first;
    try {
      first = await fetchHop(gate.url, 'GET', timeoutMs, maxBodyBytes, fetchImpl);
    } catch (error) {
      const msg = String(error?.name === 'AbortError' ? 'timeout' : (error?.message || error));
      // undici wraps every low-level failure in a generic "fetch failed" TypeError;
      // the actual reason (ENOTFOUND, ECONNREFUSED, ECONNRESET, certificate error...)
      // lives on error.cause and was previously discarded, leaving diagnostics with
      // no way to tell a real DNS/connection failure from a code defect.
      const causeCode = error?.cause?.code ? String(error.cause.code) : '';
      return {
        url: String(raw || ''),
        status: 0,
        error: /abort|timeout/i.test(msg) ? 'timeout' : (/destination-not-allowed/i.test(msg) ? 'destination-not-allowed' : msg),
        errorCode: causeCode || undefined,
        finalUrl: evidenceUrl(gate.url),
        redirected,
        durationMs: Date.now() - started,
        method: 'GET',
        attempts: 1
      };
    }

    const status = Number(first.status || 0);
    if (isRedirect(status)) {
      const next = redirectLocation(first, gate.url);
      if (!next) {
        return {
          url: String(raw || ''),
          status,
          error: 'redirect-missing-location',
          finalUrl: evidenceUrl(gate.url),
          redirected: true,
          durationMs: Date.now() - started,
          method: 'GET',
          attempts: 1
        };
      }
      if (visited.has(next)) {
        return {
          url: String(raw || ''),
          status,
          error: 'redirect-loop',
          finalUrl: evidenceUrl(next),
          redirected: true,
          durationMs: Date.now() - started,
          method: 'GET',
          attempts: 1
        };
      }
      visited.add(next);
      redirected = true;
      current = next;
      continue;
    }

    if (isMissingOrServerError(status)) {
      let secondStatus = 0;
      try {
        const second = await fetchHop(gate.url, 'GET', timeoutMs, maxBodyBytes, fetchImpl);
        secondStatus = Number(second.status || 0);
      } catch {
        return {
          url: String(raw || ''),
          status: 0,
          error: 'inconclusive-mismatch',
          finalUrl: evidenceUrl(gate.url),
          redirected,
          durationMs: Date.now() - started,
          method: 'GET',
          attempts: 2
        };
      }
      if (secondStatus !== status) {
        return {
          url: String(raw || ''),
          status: 0,
          error: 'inconclusive-mismatch',
          finalUrl: evidenceUrl(gate.url),
          redirected,
          durationMs: Date.now() - started,
          method: 'GET',
          attempts: 2
        };
      }
      return {
        url: String(raw || ''),
        status,
        finalUrl: evidenceUrl(gate.url),
        redirected,
        durationMs: Date.now() - started,
        method: 'GET',
        attempts: 2
      };
    }

    return {
      url: String(raw || ''),
      status,
      finalUrl: evidenceUrl(gate.url),
      redirected,
      durationMs: Date.now() - started,
      method: 'GET',
      attempts: headStatus ? 2 : 1
    };
  }

  return {
    url: String(raw || ''),
    status: 0,
    error: 'redirect-limit',
    finalUrl: evidenceUrl(current),
    redirected: true,
    durationMs: Date.now() - started,
    method,
    attempts: 1
  };
}

function probeHostOf(url) {
  try {
    return normalizeHost(new URL(String(url || '')).hostname);
  } catch {
    return String(url || '');
  }
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
  // Raising global concurrency must not let every worker pile onto one struggling host.
  const perHostConcurrency = Math.max(1, Number(options.perHostConcurrency || PROBE_DEFAULTS.perHostConcurrency));
  const hostInFlight = new Map();
  const pending = uniqueUrls.map((url) => ({ url, host: probeHostOf(url), taken: false }));
  let remaining = pending.length;

  function budgetExhausted(url) {
    resultByKey.set(url, {
      url,
      status: 0,
      error: 'budget-exhausted',
      finalUrl: evidenceUrl(url),
      redirected: false,
      durationMs: 0,
      method: 'GET',
      attempts: 0
    });
  }

  function claim() {
    for (const item of pending) {
      if (item.taken) continue;
      if ((hostInFlight.get(item.host) || 0) >= perHostConcurrency) continue;
      item.taken = true;
      remaining--;
      hostInFlight.set(item.host, (hostInFlight.get(item.host) || 0) + 1);
      return item;
    }
    return null;
  }

  function drainRemainingAsExhausted() {
    for (const item of pending) {
      if (item.taken) continue;
      item.taken = true;
      remaining--;
      budgetExhausted(item.url);
    }
  }

  async function worker() {
    while (remaining > 0) {
      if (Date.now() - startedAll > totalBudgetMs) {
        drainRemainingAsExhausted();
        return;
      }
      const item = claim();
      if (!item) {
        // Every remaining URL belongs to a host already at its cap; yield and retry.
        await new Promise((resolve) => setTimeout(resolve, 25));
        continue;
      }
      try {
        const row = await probeExternalDestination(item.url, options);
        resultByKey.set(item.url, { ...row, url: item.url });
      } finally {
        hostInFlight.set(item.host, Math.max(0, (hostInFlight.get(item.host) || 1) - 1));
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, uniqueUrls.length || 1) }, () => worker()));
  // A budget cutoff mid-flight can leave late URLs unclaimed by any worker.
  for (const item of pending) if (!resultByKey.has(item.url)) budgetExhausted(item.url);

  return list.map((c) => {
    const key = candidateKey(c?.url);
    const row = resultByKey.get(key) || { url: c?.url, status: 0, error: 'unavailable', durationMs: 0, method: 'GET', attempts: 0 };
    return { ...row, url: c.url };
  });
}

/**
 * Named causes for every disposition a gateway probe row can carry, kept
 * separate from the generic 'network-failure' bucket so a deliberate SSRF
 * refusal or a genuine redirect cycle isn't reported as an indistinguishable
 * network problem in diagnostics.
 */
export function causeForProbeRow(row = {}, status = 0) {
  if (status === 429) return 'rate-limited';
  if ([401, 403].includes(status)) return 'remote-blocked';
  const err = String(row.error || '');
  if (!status) {
    if (/destination-not-allowed|dns-failed/i.test(err)) return 'other';
    if (/redirect-loop|redirect-limit/i.test(err)) return 'other';
    if (/budget-exhausted/i.test(err)) return 'other';
    if (/cors|opaque|failed to fetch/i.test(err)) return 'cors-or-opaque';
    return 'network-failure';
  }
  return 'ambiguous-response';
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
    if (String(row.error || '') === 'budget-exhausted' || Number(row.attempts || 0) === 0) continue;
    const status = Number(row.status || 0);
    const text = candidate.text || '';
    const occurrences = Number(candidate.occurrences || 1);
    const method = String(row.method || 'GET').toUpperCase() === 'HEAD' ? 'HEAD' : 'GET';
    const attemptsCount = Math.max(1, Number(row.attempts || 1));
    const attempt = {
      attempt: attemptsCount,
      state: status ? 'complete' : 'unavailable',
      status,
      method,
      durationMs: Number(row.durationMs || 0),
      finalUrl: evidenceUrl(row.finalUrl || candidate.url),
      errorClass: row.errorCode || ''
    };
    const link = {
      url: evidenceUrl(candidate.url),
      internal: false,
      status,
      state: status ? 'complete' : (row.error || 'unavailable'),
      finalUrl: evidenceUrl(row.finalUrl || candidate.url),
      redirected: Boolean(row.redirected),
      occurrences,
      sources: candidate.sources || [],
      text,
      prominence: candidate.prominence || '',
      location: candidate.location || ''
    };
    const confirmationOk = (status === 404 || status === 410 || status >= 500)
      ? (method === 'GET' && attemptsCount >= 2)
      : true;
    const verification = {
      state: 'confirmed',
      method: method === 'HEAD' ? 'privileged external HEAD' : 'privileged external GET',
      attempts: attemptsCount,
      evidence: [attempt]
    };

    if ((status === 404 || status === 410) && confirmationOk) {
      findings.push({
        id: `navigation.link-${status}-external:${hash(candidate.url)}`,
        ruleId: `navigation.link-${status === 410 ? 410 : 404}-external`,
        title: 'External link points to a missing page',
        detail: `${text ? `"${text}" ` : ''}points to ${evidenceUrl(candidate.url)}. Privileged GET requests confirmed HTTP ${status}.`,
        category: 'fix',
        severity: 'high',
        confidence: 'confirmed',
        evidence: `confirmed ${status} ${evidenceUrl(candidate.url)}`,
        count: occurrences,
        selector: candidate.selector || '',
        targetType: 'visual',
        sources: ['browser'],
        link,
        verification: { ...verification, method: 'privileged external GET' },
        fingerprint: hash(`ext-${status}|${candidate.url}|${occurrences}`)
      });
      resolvedUrls.add(candidate.url);
      continue;
    }
    if (status >= 500 && confirmationOk) {
      findings.push({
        id: `navigation.link-5xx-external:${hash(candidate.url)}`,
        ruleId: 'navigation.link-5xx-external',
        title: 'External link points to a server error',
        detail: `${text ? `"${text}" ` : ''}points to ${evidenceUrl(candidate.url)}. Privileged GET requests confirmed a server error.`,
        category: 'fix',
        severity: 'critical',
        confidence: 'confirmed',
        evidence: `confirmed ${status} ${evidenceUrl(candidate.url)}`,
        count: occurrences,
        selector: candidate.selector || '',
        targetType: 'visual',
        sources: ['browser'],
        link,
        verification: { ...verification, method: 'privileged external GET' },
        fingerprint: hash(`ext-5xx|${candidate.url}|${status}`)
      });
      resolvedUrls.add(candidate.url);
      continue;
    }
    if (status >= 200 && status < 400) {
      resolvedUrls.add(candidate.url);
      continue;
    }
    if (!status && isTlsErrorCode(row.errorCode)) {
      findings.push({
        id: `navigation.link-insecure-external:${hash(candidate.url)}`,
        ruleId: 'navigation.link-insecure-external',
        title: 'External link points to a site with an invalid security certificate',
        detail: `${text ? `"${text}" ` : ''}points to ${evidenceUrl(candidate.url)}. The destination's TLS certificate failed validation (${row.errorCode}), so browsers show visitors a security warning before they can reach it.`,
        category: 'fix',
        severity: 'high',
        confidence: 'confirmed',
        evidence: `tls-error ${row.errorCode} ${evidenceUrl(candidate.url)}`,
        count: occurrences,
        selector: candidate.selector || '',
        targetType: 'visual',
        sources: ['browser'],
        link,
        verification: { ...verification, method: 'privileged external TLS handshake' },
        fingerprint: hash(`ext-tls|${candidate.url}|${row.errorCode}`)
      });
      resolvedUrls.add(candidate.url);
      continue;
    }
    incompleteChecks.push({
      kind: 'external-link',
      url: candidate.url,
      path: candidate.url,
      text,
      reason: status ? `http-${status}` : (row.error || 'unavailable'),
      cause: causeForProbeRow(row, status),
      status,
      attempts: [attempt],
      prominence: candidate.prominence || '',
      location: candidate.location || ''
    });
    if ([401, 403, 429].includes(status)) {
      const label = status === 429 ? 'rate-limited' : status === 401 ? 'unauthorized' : 'forbidden';
      findings.push({
        id: `navigation.link-review-external:${hash(candidate.url)}`,
        ruleId: 'navigation.link-review-external',
        title: `External link returned a ${label} response`,
        detail: `${text ? `"${text}" ` : ''}points to ${evidenceUrl(candidate.url)}. Privileged GET received HTTP ${status}. This is not treated as a broken link.`,
        category: 'review',
        severity: 'low',
        confidence: 'inconclusive',
        evidence: `http-${status} ${evidenceUrl(candidate.url)}`,
        count: occurrences,
        selector: candidate.selector || '',
        targetType: 'visual',
        sources: ['browser'],
        link,
        verification: { ...verification, state: 'inconclusive' },
        fingerprint: hash(`ext-review|${candidate.url}|${status}`)
      });
    }
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
