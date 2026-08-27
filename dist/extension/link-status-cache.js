import { cacheTtlMs, LINK_PROBE_POLICY } from './link-probe-control.js';

function nowMs() {
  return Date.now();
}

export function normalizeCacheKey(url = '') {
  try {
    const u = new URL(String(url));
    u.hash = '';
    return u.href;
  } catch {
    return String(url || '');
  }
}

export function createLinkStatusCache({
  maxEntries = LINK_PROBE_POLICY.maxCacheEntries,
  clock = nowMs
} = {}) {
  const store = new Map();

  function prune(ts) {
    for (const [key, row] of store) {
      if (!row || !Number.isFinite(Number(row.expiresAt)) || ts > row.expiresAt) store.delete(key);
    }
    while (store.size > maxEntries) {
      const oldest = store.keys().next().value;
      store.delete(oldest);
    }
  }

  return {
    get(url, { bypass = false, internal } = {}) {
      if (bypass) return null;
      const key = normalizeCacheKey(url);
      const hit = store.get(key);
      if (!hit) return { hit: false, miss: true };
      const ts = clock();
      if (!Number.isFinite(Number(hit.expiresAt)) || ts > hit.expiresAt) {
        store.delete(key);
        return { hit: false, miss: true, expired: true };
      }
      if (typeof internal === 'boolean' && Boolean(hit.internal) !== internal) {
        return { hit: false, miss: true, credentialMismatch: true };
      }
      const ageMs = Math.max(0, ts - Number(hit.verifiedAt || 0));
      return {
        hit: true,
        miss: false,
        ageMs,
        verifiedAt: hit.verifiedAt,
        result: { ...hit.result, cached: true, cacheHit: true, verifiedAt: hit.verifiedAt, ageMs }
      };
    },
    set(url, result, { internal = true } = {}) {
      const ttl = cacheTtlMs(result, { internal });
      if (!ttl || ttl <= 0) return false;
      const ts = clock();
      const key = normalizeCacheKey(url);
      const row = {
        result: { ...result, cached: false },
        verifiedAt: ts,
        expiresAt: ts + ttl,
        internal: Boolean(internal)
      };
      store.delete(key);
      store.set(key, row);
      const finalUrl = result?.result?.finalUrl;
      if (finalUrl && normalizeCacheKey(finalUrl) !== key && result.verificationState === 'healthy') {
        store.set(normalizeCacheKey(finalUrl), row);
      }
      prune(ts);
      return true;
    },
    invalidate(url) {
      const key = normalizeCacheKey(url);
      const hit = store.get(key);
      store.delete(key);
      const finalUrl = hit?.result?.result?.finalUrl;
      if (finalUrl) store.delete(normalizeCacheKey(finalUrl));
    },
    hydrate(entries = []) {
      const ts = clock();
      for (const row of (Array.isArray(entries) ? entries : []).slice(0, maxEntries)) {
        const key = normalizeCacheKey(row?.url || row?.key);
        if (!key || !row?.result) continue;
        try { if (!/^https?:$/i.test(new URL(key).protocol)) continue; } catch { continue; }
        const expiresAt = Number(row.expiresAt);
        if (!Number.isFinite(expiresAt) || expiresAt <= ts) continue;
        const internal = row.internal !== false;
        if (cacheTtlMs(row.result, { internal }) <= 0) continue;
        store.set(key, {
          result: { ...row.result, cached: false },
          verifiedAt: Number(row.verifiedAt) || ts,
          expiresAt,
          internal
        });
      }
      prune(ts);
    },
    exportEntries({ pageUrl = '' } = {}) {
      const ts = clock();
      prune(ts);
      let pageOrigin = '';
      try { pageOrigin = pageUrl ? new URL(pageUrl).origin : ''; } catch { pageOrigin = ''; }
      return [...store.entries()].slice(-maxEntries).flatMap(([url, row]) => {
        if (pageOrigin && row.internal !== false) {
          try { if (new URL(url).origin !== pageOrigin) return []; } catch { return []; }
        }
        return [{
          url,
          result: row.result,
          verifiedAt: row.verifiedAt,
          expiresAt: row.expiresAt,
          internal: row.internal
        }];
      });
    },
    get size() { return store.size; },
    clear() { store.clear(); }
  };
}
