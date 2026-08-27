function clip(value, max = 180) {
  const s = String(value ?? '').replace(/\s+/g, ' ').trim();
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

export function metaStateRecord(context = {}, report = {}) {
  return context?.meta
    || context?.services?.metaState
    || report?.context?.services?.metaState
    || report?.context?.meta
    || null;
}

export function buildPublishedCoverage({
  context = {},
  report = {},
  coverage = {},
  connectedMode = '',
  enrichmentError = '',
  latencyMs = null,
  attempted = null
} = {}) {
  const status = String(coverage.published || report.coverage?.published || '');
  const meta = metaStateRecord(context, report);
  const mode = String(connectedMode || report.connectedMode || '');
  const didAttempt = attempted == null
    ? mode === 'gateway' || mode === 'unavailable' || mode === 'auth-required' || mode === 'auth-rejected' || Boolean(enrichmentError)
    : Boolean(attempted);
  const latency = Number.isFinite(Number(latencyMs)) ? Math.round(Number(latencyMs)) : null;

  if (status === 'complete') {
    return {
      status: 'complete',
      attempted: true,
      source: 'meta-state',
      reason: '',
      latencyMs: latency
    };
  }
  if (mode === 'local-only' || status === 'local-only') {
    return {
      status: 'unavailable',
      attempted: false,
      source: 'none',
      reason: 'local-only-private-page',
      latencyMs: latency
    };
  }
  if (enrichmentError) {
    return {
      status: 'unavailable',
      attempted: true,
      source: 'gateway',
      reason: clip(enrichmentError, 180),
      latencyMs: latency
    };
  }
  if (!didAttempt) {
    return {
      status: status || 'unavailable',
      attempted: false,
      source: 'none',
      reason: 'published-evidence-not-attempted',
      latencyMs: latency
    };
  }
  const metaStatus = String(meta?.status || '');
  if (!meta) {
    return {
      status: status || 'unavailable',
      attempted: true,
      source: 'meta-state',
      reason: 'meta-state-missing',
      latencyMs: latency
    };
  }
  if (metaStatus && metaStatus !== 'complete') {
    return {
      status: status || metaStatus || 'unavailable',
      attempted: true,
      source: 'meta-state',
      reason: clip(meta.reason || meta.error || meta.message || `meta-state-${metaStatus}`, 180),
      latencyMs: latency
    };
  }
  const snapshot = meta?.data?.snapshot || meta?.snapshot;
  if (!snapshot) {
    return {
      status: status || 'unavailable',
      attempted: true,
      source: 'meta-state',
      reason: 'published-snapshot-missing',
      latencyMs: latency
    };
  }
  return {
    status: status || 'unavailable',
    attempted: true,
    source: 'meta-state',
    reason: clip(status ? `published-coverage-${status}` : 'published-snapshot-incomplete', 180),
    latencyMs: latency
  };
}

export function publishedCoverageForFrank(publishedCoverage = {}) {
  const status = String(publishedCoverage.status || 'unavailable');
  if (status === 'complete') return { publishedCoverage: 'complete', reason: '' };
  return {
    publishedCoverage: status || 'unavailable',
    reason: String(publishedCoverage.reason || 'published-evidence-unavailable')
  };
}
