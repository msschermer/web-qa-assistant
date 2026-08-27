/**
 * Adaptive target-origin concurrency and reserved pool policy.
 * Browser rules implement the live queue; this module is the testable contract.
 */

export const LINK_PROBE_POLICY = Object.freeze({
  targetStart: 6,
  targetSteps: Object.freeze([6, 8, 10, 12]),
  targetCeiling: 16,
  targetWithExternalCeiling: 12,
  externalPerHost: 2,
  externalGlobal: 4,
  totalCeiling: 16,
  healthyWindow: 4,
  latencySampleWindow: 8,
  latencyDeteriorationRatio: 2.2,
  latencyDeteriorationFloorMs: 1800,
  ttlHealthyInternalMs: 8 * 60 * 1000,
  ttlHealthyExternalMs: 3 * 60 * 1000,
  ttlBrokenMs: 90 * 1000,
  ttlRedirectMs: 2 * 60 * 1000,
  ttlInconclusiveMs: 0,
  maxCacheEntries: 400
});

export function nextTargetStep(cap, ceiling = LINK_PROBE_POLICY.targetCeiling) {
  const n = Math.max(2, Number(cap) || LINK_PROBE_POLICY.targetStart);
  const steps = LINK_PROBE_POLICY.targetSteps;
  const next = steps.find(step => step > n);
  if (next != null) return Math.min(next, ceiling);
  return Math.min(n + 2, ceiling);
}

export function createTargetCapController({
  start = LINK_PROBE_POLICY.targetStart,
  ceiling = LINK_PROBE_POLICY.targetCeiling
} = {}) {
  let cap = Math.max(2, Math.min(ceiling, Number(start) || LINK_PROBE_POLICY.targetStart));
  const startCap = cap;
  let healthyStreak = 0;
  let consecutive429 = 0;
  let consecutive5xx = 0;
  let consecutiveNet = 0;
  const latencies = [];
  return {
    get cap() { return cap; },
    get start() { return startCap; },
    snapshot() {
      return { start: startCap, cap, ceiling, healthyStreak };
    },
    noteOutcome({ status = 0, state = '', durationMs = 0, cause = '' } = {}) {
      const code = Number(status) || 0;
      if (code === 429 || cause === 'rate-limited') {
        consecutive429 += 1;
        if (consecutive429 >= 2) {
          cap = Math.max(2, Math.floor(cap / 2));
          healthyStreak = 0;
        }
      } else consecutive429 = 0;

      if (code >= 500) {
        consecutive5xx += 1;
        if (consecutive5xx >= 2) {
          cap = Math.max(2, Math.floor(cap / 2));
          healthyStreak = 0;
        }
      } else consecutive5xx = 0;

      if (state === 'unavailable' || cause === 'network-failure' || /reset|econnreset/i.test(String(cause || ''))) {
        consecutiveNet += 1;
        if (consecutiveNet >= 3) {
          cap = Math.max(2, Math.floor(cap / 2));
          healthyStreak = 0;
        }
      } else consecutiveNet = 0;

      if (Number(durationMs) > 0) {
        latencies.push(Number(durationMs));
        if (latencies.length >= LINK_PROBE_POLICY.latencySampleWindow) {
          const baseline = average(latencies.slice(0, 6));
          const recent = average(latencies.slice(-6));
          if (baseline > 0 && recent > baseline * LINK_PROBE_POLICY.latencyDeteriorationRatio && recent > LINK_PROBE_POLICY.latencyDeteriorationFloorMs) {
            cap = Math.max(2, Math.floor(cap / 2));
            healthyStreak = 0;
          }
        }
      }

      const healthy = code >= 200 && code < 400 && state !== 'timeout' && state !== 'unavailable';
      if (healthy) {
        healthyStreak += 1;
        if (healthyStreak >= LINK_PROBE_POLICY.healthyWindow && cap < ceiling) {
          cap = nextTargetStep(cap, ceiling);
          healthyStreak = 0;
        }
      } else if (code > 0 || state === 'timeout') {
        healthyStreak = 0;
      }
      return cap;
    }
  };
}

export function poolCaps({
  targetCap = LINK_PROBE_POLICY.targetStart,
  remainingTarget = 0,
  remainingExternal = 0
} = {}) {
  const externalGlobal = Math.min(
    LINK_PROBE_POLICY.externalGlobal,
    Math.max(0, remainingExternal)
  );
  const targetCeiling = remainingExternal > 0
    ? Math.min(targetCap, LINK_PROBE_POLICY.targetWithExternalCeiling)
    : Math.min(targetCap, LINK_PROBE_POLICY.targetCeiling);
  const target = Math.min(targetCeiling, Math.max(0, remainingTarget));
  const total = Math.min(LINK_PROBE_POLICY.totalCeiling, target + externalGlobal);
  return {
    targetWorkers: target,
    externalWorkers: Math.min(externalGlobal, Math.max(0, total - target)),
    targetCap: targetCeiling,
    externalGlobal,
    totalCeiling: LINK_PROBE_POLICY.totalCeiling
  };
}

export function shouldRefine({ verificationState = '', cause = '', status = 0 } = {}) {
  if (verificationState === 'healthy' || verificationState === 'confirmed-failure' || verificationState === 'unprobed') return false;
  const code = Number(status) || 0;
  if ([401, 403, 429].includes(code)) return false;
  if (['rate-limited', 'remote-blocked'].includes(String(cause || ''))) return false;
  return verificationState === 'inconclusive';
}

export function cacheTtlMs(result = {}, { internal = true } = {}) {
  const state = String(result.verificationState || '');
  const cause = String(result.cause || '');
  if (state === 'inconclusive' || state === 'unprobed') return LINK_PROBE_POLICY.ttlInconclusiveMs;
  if (['scanner-timeout', 'scanner-cancelled', 'scanner-budget-aborted'].includes(cause)) return 0;
  if (state === 'confirmed-failure') return LINK_PROBE_POLICY.ttlBrokenMs;
  if (result.result?.redirected) return LINK_PROBE_POLICY.ttlRedirectMs;
  if (state === 'healthy') {
    return internal ? LINK_PROBE_POLICY.ttlHealthyInternalMs : LINK_PROBE_POLICY.ttlHealthyExternalMs;
  }
  return 0;
}

export function localOnlyHref(raw = '') {
  const href = String(raw || '').trim();
  if (!href) return true;
  if (href.startsWith('#')) return true;
  return /^(mailto:|tel:|sms:|javascript:|data:)/i.test(href);
}

function average(values) {
  if (!values.length) return 0;
  return values.reduce((s, n) => s + n, 0) / values.length;
}
