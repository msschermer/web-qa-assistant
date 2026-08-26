// Performance coverage must distinguish lab evidence from historical monitoring.
// A connector that is "not monitored" must not erase current-page lab measurements.
// Coverage classification separates complete, expected scope limits, and genuine degradation.

export function labPerformanceReady(browserPerformance = null) {
  if (!browserPerformance || browserPerformance.available !== true) return false;
  return Number.isFinite(browserPerformance.largestContentfulPaintMs)
    || Number.isFinite(browserPerformance.ttfbMs)
    || Number.isFinite(browserPerformance.transferBytes);
}

export function resolvePerformanceCoverage(baseCoverage = {}, browserPerformance = null, connectorResult = null) {
  if (labPerformanceReady(browserPerformance)) return 'current-page';
  if (browserPerformance?.available === true) return 'partial';
  if (!connectorResult) return baseCoverage.performance || 'unavailable';
  if (connectorResult.status === 'not_applicable') return 'not applicable';
  if (connectorResult.status !== 'complete') return connectorResult.status || 'unavailable';
  if (connectorResult.data?.monitored === false) return 'not monitored';
  return 'complete';
}

export const COVERAGE_CLASS = {
  COMPLETE: 'complete',
  SCOPE_LIMITED: 'scope-limited',
  DEGRADED: 'degraded'
};

export const COVERAGE_REASON = {
  TARGET_BLOCKED: 'target-blocked',
  TARGET_SUBSTITUTED: 'target-substituted',
  TARGET_INCONCLUSIVE: 'target-inconclusive',
  RENDERER_TIMEOUT: 'renderer-timeout',
  PROBE_BUDGET_EXHAUSTED: 'probe-budget-exhausted',
  LINK_AUDIT_UNAVAILABLE: 'link-audit-unavailable',
  NONE_CHECKED: 'none-checked',
  LAB_PARTIAL: 'lab-partial',
  CONNECTOR_UNAVAILABLE: 'connector-unavailable',
  AXE_UNAVAILABLE: 'axe-unavailable',
  RUNTIME_EXTENSION_LIMIT: 'runtime-not-captured-in-extension',
  RUNTIME_EXTENSION_PARTIAL: 'runtime-partial-in-extension',
  RUNTIME_SCOPE_POST_INJECTION: 'runtime-scope-post-injection',
  ENRICHMENT_FAILED: 'enrichment-failed',
  NOT_APPLICABLE: 'not-applicable',
  INTERACTION_SAFETY_SCOPE: 'interaction-safety-scope',
  INTERACTION_RESTORATION_FAILED: 'interaction-restoration-failed',
  FRAME_BUDGET_EXCEEDED: 'frame-budget-exceeded',
  CROSS_ORIGIN_FRAMES: 'cross-origin-frames-not-inspectable'
};

/** Reasons that represent expected product/environment boundaries — not scanner failure. */
const SCOPE_LIMITED_REASONS = new Set([
  COVERAGE_REASON.RUNTIME_EXTENSION_LIMIT,
  COVERAGE_REASON.RUNTIME_EXTENSION_PARTIAL,
  COVERAGE_REASON.RUNTIME_SCOPE_POST_INJECTION,
  COVERAGE_REASON.CONNECTOR_UNAVAILABLE,
  COVERAGE_REASON.NOT_APPLICABLE,
  COVERAGE_REASON.INTERACTION_SAFETY_SCOPE,
  COVERAGE_REASON.CROSS_ORIGIN_FRAMES
]);

/** Reasons that represent genuine incomplete or failed collection. */
const DEGRADED_REASONS = new Set([
  COVERAGE_REASON.PROBE_BUDGET_EXHAUSTED,
  COVERAGE_REASON.LINK_AUDIT_UNAVAILABLE,
  COVERAGE_REASON.LAB_PARTIAL,
  COVERAGE_REASON.AXE_UNAVAILABLE,
  COVERAGE_REASON.ENRICHMENT_FAILED,
  COVERAGE_REASON.RENDERER_TIMEOUT,
  COVERAGE_REASON.TARGET_BLOCKED,
  COVERAGE_REASON.TARGET_SUBSTITUTED,
  COVERAGE_REASON.TARGET_INCONCLUSIVE,
  COVERAGE_REASON.INTERACTION_RESTORATION_FAILED,
  COVERAGE_REASON.FRAME_BUDGET_EXCEEDED
]);

export function classifyCoverageReason(reason = '') {
  const code = String(reason || '').trim();
  if (!code || code === COVERAGE_REASON.NONE_CHECKED) return COVERAGE_CLASS.COMPLETE;
  if (DEGRADED_REASONS.has(code)) return COVERAGE_CLASS.DEGRADED;
  if (SCOPE_LIMITED_REASONS.has(code)) return COVERAGE_CLASS.SCOPE_LIMITED;
  // Unknown codes default to degraded so new failure modes stay visible.
  return COVERAGE_CLASS.DEGRADED;
}

/**
 * scannerTimeout is a designed terminal state for a completed attempt, not a
 * scanner abort. Only scannerBudgetAborted (and explicit scanner execution
 * failures) count as scannerAborted.
 */
export const SCANNER_ABORT_CAUSE_KEYS = Object.freeze(['scannerBudgetAborted']);

export function emptyInconclusiveByCause(total = 0) {
  return {
    total: Number(total || 0),
    scannerBudgetAborted: 0,
    scannerTimeout: 0,
    remoteBlocked: 0,
    rateLimited: 0,
    corsOrOpaque: 0,
    networkFailure: 0,
    unsupportedProbe: 0,
    ambiguousResponse: 0,
    other: Number(total || 0)
  };
}

export function normalizeInconclusiveByCause(raw = null, fallbackTotal = 0) {
  if (!raw || typeof raw !== 'object') return emptyInconclusiveByCause(fallbackTotal);
  const rateLimited = Number(raw.rateLimited || 0);
  const remoteBlocked = Number(raw.remoteBlocked || 0);
  const byCause = {
    total: Number(raw.total ?? fallbackTotal),
    scannerBudgetAborted: Number(raw.scannerBudgetAborted || 0),
    scannerTimeout: Number(raw.scannerTimeout || 0),
    remoteBlocked,
    rateLimited,
    corsOrOpaque: Number(raw.corsOrOpaque || 0),
    networkFailure: Number(raw.networkFailure || 0),
    unsupportedProbe: Number(raw.unsupportedProbe || 0),
    ambiguousResponse: Number(raw.ambiguousResponse || 0),
    other: Number(raw.other || 0)
  };
  const sum = inconclusiveCauseSum(byCause);
  const total = Number(byCause.total || fallbackTotal);
  if (total > sum) byCause.other += (total - sum);
  if (total && byCause.total !== total) byCause.total = total;
  return byCause;
}

export function scannerAbortedFromCauses(byCause = {}) {
  return SCANNER_ABORT_CAUSE_KEYS.reduce((n, key) => n + Number(byCause?.[key] || 0), 0);
}

/**
 * Privileged GET/HEAD fallback (gateway or SW) is a second-chance path for
 * already-attempted external inconclusives. It is not page-level unprobed work
 * and must not change attempted/unprobed/scannerAborted.
 */
export function emptyPrivilegedFallback() {
  return {
    mode: 'none',
    eligible: 0,
    attempted: 0,
    notAttempted: 0,
    truncated: false,
    resolved: 0,
    stillInconclusive: 0
  };
}

export function emptyLinkRefinement() {
  return {
    eligible: 0,
    queued: 0,
    attempted: 0,
    resolvedHealthy: 0,
    resolvedBroken: 0,
    stillInconclusive: 0,
    notAttempted: 0,
    budgetAborted: 0,
    truncated: false
  };
}

export function inconclusiveCauseKey(cause = '') {
  const c = String(cause || '').trim();
  if (c === 'scanner-budget-aborted' || c === 'scannerBudgetAborted') return 'scannerBudgetAborted';
  if (c === 'scanner-timeout' || c === 'scannerTimeout') return 'scannerTimeout';
  if (c === 'remote-blocked' || c === 'remoteBlocked') return 'remoteBlocked';
  if (c === 'rate-limited' || c === 'rateLimited') return 'rateLimited';
  if (c === 'cors-or-opaque' || c === 'corsOrOpaque') return 'corsOrOpaque';
  if (c === 'network-failure' || c === 'networkFailure') return 'networkFailure';
  if (c === 'unsupported-probe' || c === 'unsupportedProbe') return 'unsupportedProbe';
  if (c === 'ambiguous-response' || c === 'ambiguousResponse') return 'ambiguousResponse';
  return 'other';
}

export function dedupeIncompleteChecks(rows = []) {
  const byKey = new Map();
  for (const row of Array.isArray(rows) ? rows : []) {
    if (!row || row.reason === 'candidate-budget' || row.reason === 'probe-budget-exhausted') continue;
    const key = `${String(row.kind || '')}|${String(row.url || row.path || '')}`;
    byKey.set(key, row);
  }
  return [...byKey.values()];
}

export function rebuildInconclusiveByCause(checks = []) {
  const byCause = emptyInconclusiveByCause(0);
  for (const row of Array.isArray(checks) ? checks : []) {
    const key = inconclusiveCauseKey(row?.cause);
    byCause[key] += 1;
    byCause.total += 1;
  }
  return byCause;
}

export function inconclusiveCauseSum(byCause = {}) {
  return Number(byCause.scannerBudgetAborted || 0)
    + Number(byCause.scannerTimeout || 0)
    + Number(byCause.remoteBlocked || 0)
    + Number(byCause.rateLimited || 0)
    + Number(byCause.corsOrOpaque || 0)
    + Number(byCause.networkFailure || 0)
    + Number(byCause.unsupportedProbe || 0)
    + Number(byCause.ambiguousResponse || 0)
    + Number(byCause.other || 0);
}

export function normalizePrivilegedFallback(raw = null, extras = {}) {
  const src = raw && typeof raw === 'object' ? raw : {};
  const eligible = Number(extras.eligible ?? src.eligible ?? 0);
  const attempted = Number(extras.attempted ?? src.attempted ?? 0);
  const notAttempted = Math.max(0, eligible - attempted);
  let mode = String(extras.mode || src.mode || 'none');
  if (eligible > 0 && attempted === 0 && (mode === 'none' || !mode)) mode = 'queued';
  if (eligible === 0) mode = mode === 'gateway' || mode === 'service-worker' ? mode : 'none';
  return {
    mode,
    eligible,
    attempted,
    notAttempted,
    truncated: extras.truncated === true || src.truncated === true || notAttempted > 0,
    resolved: Number(extras.resolved ?? src.resolved ?? 0),
    stillInconclusive: Number(extras.stillInconclusive ?? src.stillInconclusive ?? 0)
  };
}

export function normalizeLinkRefinement(raw = null, extras = {}) {
  const src = raw && typeof raw === 'object' ? raw : {};
  const fallback = normalizePrivilegedFallback(src.privilegedFallback || src, extras);
  const eligible = Number(extras.eligible ?? src.eligible ?? fallback.eligible ?? 0);
  const attempted = Number(extras.attempted ?? src.attempted ?? fallback.attempted ?? 0);
  const notAttempted = Math.max(0, eligible - attempted);
  return {
    eligible,
    queued: Number(extras.queued ?? src.queued ?? eligible),
    attempted,
    resolvedHealthy: Number(extras.resolvedHealthy ?? src.resolvedHealthy ?? 0),
    resolvedBroken: Number(extras.resolvedBroken ?? src.resolvedBroken ?? 0),
    stillInconclusive: Number(extras.stillInconclusive ?? src.stillInconclusive ?? fallback.stillInconclusive ?? 0),
    notAttempted,
    budgetAborted: Number(extras.budgetAborted ?? src.budgetAborted ?? 0),
    truncated: extras.truncated === true || src.truncated === true || notAttempted > 0,
    privilegedFallback: fallback
  };
}

/**
 * Link coverage is execution completeness, not evidence certainty.
 * Inconclusive remote results do not make coverage partial.
 */
export function linkCoverageStatus({
  unavailable = false,
  unprobed = 0,
  scannerAborted = 0,
  attempted = 0,
  discovered = 0,
  eligible = 0
} = {}) {
  if (unavailable) return 'unavailable';
  if (Number(unprobed) > 0 || Number(scannerAborted) > 0) return 'partial';
  const inventory = Number(eligible || discovered || 0);
  if (Number(attempted) === 0 && inventory === 0) return 'none_checked';
  return 'complete';
}

export function probeBudgetPreventedFromCounts({ unprobed = 0, scannerAborted = 0 } = {}) {
  return Number(unprobed) > 0 || Number(scannerAborted) > 0;
}

/**
 * Keep the probe-time abort count authoritative. Later stages must not add
 * inferred aborts from incompleteChecks.length, unresolved remotes, or CORS.
 */
export function preserveScannerAborted(prior = 0, patch = undefined) {
  if (patch === undefined || patch === null) return Number(prior || 0);
  return Number(patch || 0);
}

/**
 * Rebuild linkAudit + coverage.links from execution counts.
 * Never treat incompleteChecks.length as scannerAborted or as partial coverage.
 */
export function finalizeLinkAudit(audit = {}, extras = {}) {
  const unavailable = extras.unavailable === true || audit.status === 'unavailable';
  const attempted = Number(audit.attempted ?? audit.checked ?? 0);
  const unprobed = Number(audit.unprobed || 0);
  const explicitlySkipped = Number(audit.explicitlySkipped || 0);
  const discovered = Number(audit.discovered ?? Math.max(attempted + unprobed + explicitlySkipped, attempted));
  const eligible = Number(audit.eligible ?? Math.max(discovered - explicitlySkipped, attempted + unprobed));
  const incompleteChecks = Array.isArray(audit.incompleteChecks) ? audit.incompleteChecks : [];
  const inconclusive = Number(audit.inconclusive ?? incompleteChecks.length ?? 0);
  const byCause = incompleteChecks.length === inconclusive && incompleteChecks.length > 0
    ? rebuildInconclusiveByCause(incompleteChecks)
    : normalizeInconclusiveByCause(audit.inconclusiveByCause, inconclusive);
  if (byCause.total !== inconclusive) byCause.total = inconclusive;
  const verifiedHealthy = Number(audit.verifiedHealthy || 0);
  const confirmedIssues = Number(audit.confirmedIssues ?? audit.confirmedBroken ?? 0);
  const scannerAborted = Number(audit.scannerAborted ?? 0);
  const expectedAborted = scannerAbortedFromCauses(byCause);
  const abortOk = scannerAborted === expectedAborted;
  const attemptedOk = attempted === verifiedHealthy + confirmedIssues + inconclusive;
  const eligibleOk = eligible === attempted + unprobed + explicitlySkipped;
  const causesOk = inconclusiveCauseSum(byCause) === inconclusive;
  const privilegedFallback = normalizePrivilegedFallback(
    extras.privilegedFallback || audit.privilegedFallback,
    extras.privilegedFallback || {}
  );
  const fallbackOk = privilegedFallback.eligible === privilegedFallback.attempted + privilegedFallback.notAttempted;
  const refinement = normalizeLinkRefinement(
    extras.refinement || audit.refinement,
    extras.refinement || {
      eligible: privilegedFallback.eligible,
      attempted: privilegedFallback.attempted,
      notAttempted: privilegedFallback.notAttempted,
      stillInconclusive: privilegedFallback.stillInconclusive,
      truncated: privilegedFallback.truncated,
      resolvedHealthy: Number(audit.refinement?.resolvedHealthy || 0),
      resolvedBroken: Number(audit.refinement?.resolvedBroken || 0),
      budgetAborted: Number(audit.refinement?.budgetAborted || 0)
    }
  );
  const refinementOk = refinement.eligible === refinement.attempted + refinement.notAttempted;
  const probeBudgetPreventedCoverage = probeBudgetPreventedFromCounts({ unprobed, scannerAborted });
  const coverage = linkCoverageStatus({
    unavailable,
    unprobed,
    scannerAborted,
    attempted,
    discovered,
    eligible
  });
  const probeBudgetReached = audit.probeBudgetReached === true
    || audit.reachedLimit === true
    || unprobed > 0;
  return {
    linkAudit: {
      ...audit,
      discovered,
      eligible,
      attempted,
      checked: attempted,
      verifiedHealthy,
      confirmedIssues,
      inconclusive,
      unprobed,
      explicitlySkipped,
      scannerAborted,
      inconclusiveByCause: byCause,
      incompleteChecks,
      unprobedChecks: Array.isArray(audit.unprobedChecks) ? audit.unprobedChecks : [],
      budgetExhausted: probeBudgetPreventedCoverage,
      probeBudgetReached,
      probeBudgetPreventedCoverage,
      privilegedFallback,
      refinement,
      gatewayTruncatedInconclusive: privilegedFallback.notAttempted,
      accountingOk: abortOk && attemptedOk && eligibleOk && causesOk && fallbackOk && refinementOk
    },
    coverageStatus: coverage
  };
}

/**
 * Gateway / SW privileged re-probes may resolve or reclassify inconclusive
 * externals. They must not invent scanner aborts or convert already-attempted
 * inconclusive rows into unprobed budget exhaustion.
 */
export function applyPrivilegedProbeAccounting(report = {}, {
  applied = { findings: [], incompleteChecks: [], resolvedUrls: [] },
  truncated = false,
  candidateTotal = 0,
  candidatesProbed = 0
} = {}) {
  const prior = report.linkAudit || {};
  const resolved = new Set(applied.resolvedUrls || []);
  const incompleteChecks = dedupeIncompleteChecks([
    ...(prior.incompleteChecks || []).filter((c) => !(c.kind === 'external-link' && resolved.has(c.url))),
    ...(applied.incompleteChecks || [])
  ]);
  const findings = [...(report.findings || []), ...(applied.findings || [])];
  const confirmedFromApplied = (applied.findings || []).filter((f) => f.confidence === 'confirmed').length;
  const newlyHealthy = Math.max(0, resolved.size - confirmedFromApplied - (applied.incompleteChecks || []).length);
  const attempted = Number(prior.attempted ?? prior.checked ?? 0);
  const verifiedHealthy = Number(prior.verifiedHealthy || 0) + newlyHealthy;
  const confirmedIssues = Math.max(
    Number(prior.confirmedIssues || 0),
    findings.filter((f) => /navigation\.link-(404|410|5xx)/.test(String(f.ruleId || '')) && f.confidence === 'confirmed').length
  );
  const inconclusive = Math.max(0, attempted - verifiedHealthy - confirmedIssues);
  const unprobed = Number(prior.unprobed || 0);
  const scannerAborted = preserveScannerAborted(prior.scannerAborted);
  const notAttempted = Math.max(0, Number(candidateTotal || 0) - Number(candidatesProbed || 0));
  const privilegedFallback = normalizePrivilegedFallback(prior.privilegedFallback, {
    mode: 'gateway',
    eligible: Number(candidateTotal || 0),
    attempted: Number(candidatesProbed || 0),
    notAttempted,
    truncated: truncated === true || notAttempted > 0,
    resolved: resolved.size,
    stillInconclusive: Number((applied.incompleteChecks || []).length)
  });
  const refinement = normalizeLinkRefinement(prior.refinement, {
    eligible: privilegedFallback.eligible,
    queued: privilegedFallback.eligible,
    attempted: privilegedFallback.attempted,
    resolvedHealthy: newlyHealthy,
    resolvedBroken: confirmedFromApplied,
    stillInconclusive: privilegedFallback.stillInconclusive,
    notAttempted: privilegedFallback.notAttempted,
    budgetAborted: 0,
    truncated: privilegedFallback.truncated
  });
  const finalized = finalizeLinkAudit({
    ...prior,
    verifiedHealthy,
    confirmedIssues,
    inconclusive,
    incompleteChecks,
    attempted,
    checked: attempted,
    unprobed,
    scannerAborted,
    privilegedProbe: 'gateway',
    reachedLimit: Boolean(prior.reachedLimit),
    privilegedFallback,
    refinement
  });
  return {
    ...report,
    findings,
    externalLinkCandidates: undefined,
    externalLinkCandidateTotal: undefined,
    linkAudit: {
      ...finalized.linkAudit,
      privilegedProbe: 'gateway',
      privilegedFallback,
      gatewayTruncatedInconclusive: privilegedFallback.notAttempted
    },
    coverage: { ...(report.coverage || {}), links: finalized.coverageStatus }
  };
}

/**
 * Merge a gateway-enriched report with the local probe result.
 * Incomplete remote checks are evidence uncertainty, not coverage failure.
 */
export function mergeGatewayLinkAudit(local = {}, remote = {}) {
  const localAudit = local.linkAudit || {};
  const remoteAudit = remote.linkAudit || {};
  if (remoteAudit.privilegedProbe !== 'gateway') {
    const audit = localAudit.attempted != null || localAudit.checked != null ? localAudit : remoteAudit;
    if (!audit || (audit.attempted == null && audit.checked == null && audit.discovered == null)) {
      return { linkAudit: audit, coverageLinks: remote.coverage?.links || local.coverage?.links };
    }
    const finalized = finalizeLinkAudit(audit, {
      unavailable: /unavailable/i.test(String(remote.coverage?.links || local.coverage?.links || ''))
    });
    return { linkAudit: finalized.linkAudit, coverageLinks: finalized.coverageStatus };
  }
  const probed = new Set((remote.findings || []).map((f) => f?.link?.url).filter(Boolean));
  const localExtra = (localAudit.incompleteChecks || []).filter((c) => {
    if (c?.kind !== 'external-link') return true;
    if (!c.url) return true;
    return !probed.has(c.url) && !(remoteAudit.incompleteChecks || []).some((r) => r.url === c.url);
  });
  const incompleteChecks = [...(remoteAudit.incompleteChecks || []), ...localExtra];
  // Probe-time execution counts stay local. Gateway may resolve inconclusive remotes
  // (healthy/broken) but must not invent scanner aborts or unprobed leftovers.
  const scannerAborted = preserveScannerAborted(localAudit.scannerAborted ?? remoteAudit.scannerAborted);
  const byCause = normalizeInconclusiveByCause(
    remoteAudit.inconclusiveByCause || localAudit.inconclusiveByCause,
    incompleteChecks.length
  );
  byCause.scannerBudgetAborted = Number(
    localAudit.inconclusiveByCause?.scannerBudgetAborted ?? scannerAborted
  );
  byCause.total = incompleteChecks.length;
  const finalized = finalizeLinkAudit({
    ...remoteAudit,
    incompleteChecks,
    inconclusive: incompleteChecks.length,
    scannerAborted,
    unprobed: Number(localAudit.unprobed ?? remoteAudit.unprobed ?? 0),
    attempted: Number(localAudit.attempted ?? localAudit.checked ?? remoteAudit.attempted ?? remoteAudit.checked ?? 0),
    discovered: Number(localAudit.discovered ?? remoteAudit.discovered ?? 0),
    eligible: Number(localAudit.eligible ?? remoteAudit.eligible ?? 0),
    verifiedHealthy: Math.max(Number(remoteAudit.verifiedHealthy || 0), Number(localAudit.verifiedHealthy || 0)),
    confirmedIssues: Math.max(Number(remoteAudit.confirmedIssues || 0), Number(localAudit.confirmedIssues || 0)),
    explicitlySkipped: Number(localAudit.explicitlySkipped ?? remoteAudit.explicitlySkipped ?? 0),
    inconclusiveByCause: byCause,
    unprobedChecks: localAudit.unprobedChecks || remoteAudit.unprobedChecks || [],
    probeBudgetReached: localAudit.probeBudgetReached === true || remoteAudit.probeBudgetReached === true,
    reachedLimit: Boolean(localAudit.reachedLimit || remoteAudit.reachedLimit),
    privilegedFallback: normalizePrivilegedFallback(
      remoteAudit.privilegedFallback || localAudit.privilegedFallback
    )
  });
  return { linkAudit: finalized.linkAudit, coverageLinks: finalized.coverageStatus };
}

function coverageValue(value) {
  return String(value ?? '').trim().toLowerCase().replace(/_/g, ' ');
}

function integrityState(report = {}) {
  const raw = report.page?.targetIntegrity;
  if (raw && typeof raw === 'object') return String(raw.state || '');
  return String(raw || report.targetIntegrity?.state || '');
}

function linkAccounting(report = {}) {
  const audit = report.linkAudit || {};
  const attempted = Number(
    audit.attempted
    ?? audit.checked
    ?? ((Number(audit.verifiedHealthy || 0) + Number(audit.confirmedIssues || audit.confirmedBroken || 0) + Number(audit.inconclusive || 0)))
  );
  const verifiedHealthy = Number(audit.verifiedHealthy || 0);
  const confirmedBroken = Number(audit.confirmedIssues ?? audit.confirmedBroken ?? 0);
  const inconclusive = Number(audit.inconclusive || 0);
  const unprobed = Number(audit.unprobed || 0);
  const explicitlySkipped = Number(audit.explicitlySkipped || 0);
  const discovered = Number(audit.discovered ?? Math.max(attempted + unprobed + explicitlySkipped, attempted));
  const eligible = Number(audit.eligible ?? Math.max(discovered - explicitlySkipped, attempted + unprobed));
  const byCause = normalizeInconclusiveByCause(audit.inconclusiveByCause, inconclusive);
  // Authoritative probe field. Do not infer aborts from incompleteChecks.length
  // or from remote/CORS/unresolved rows. scannerTimeout is a completed attempt.
  const scannerAborted = Number(audit.scannerAborted ?? 0);
  const expectedAborted = scannerAbortedFromCauses(byCause);
  const abortOk = scannerAborted === expectedAborted;
  const probeBudgetPreventedCoverage = probeBudgetPreventedFromCounts({ unprobed, scannerAborted });
  const probeBudgetReached = audit.probeBudgetReached === true
    || audit.reachedLimit === true
    || unprobed > 0;
  const attemptedOk = attempted === verifiedHealthy + confirmedBroken + inconclusive;
  const eligibleOk = eligible === attempted + unprobed + explicitlySkipped;
  const causesOk = inconclusiveCauseSum(byCause) === inconclusive;
  const privilegedFallback = normalizePrivilegedFallback(audit.privilegedFallback, {
    eligible: Number(audit.privilegedFallback?.eligible ?? 0),
    attempted: Number(audit.privilegedFallback?.attempted ?? 0),
    truncated: audit.privilegedFallback?.truncated === true
      || Number(audit.gatewayTruncatedInconclusive || 0) > 0
  });
  const fallbackOk = privilegedFallback.eligible === privilegedFallback.attempted + privilegedFallback.notAttempted;
  const refinement = normalizeLinkRefinement(audit.refinement, {
    eligible: Number(audit.refinement?.eligible ?? privilegedFallback.eligible),
    attempted: Number(audit.refinement?.attempted ?? privilegedFallback.attempted),
    stillInconclusive: Number(audit.refinement?.stillInconclusive ?? privilegedFallback.stillInconclusive),
    truncated: audit.refinement?.truncated === true || privilegedFallback.truncated
  });
  return {
    discovered,
    eligible,
    attempted,
    verifiedHealthy,
    confirmedBroken,
    inconclusive,
    unprobed,
    explicitlySkipped,
    scannerAborted,
    inconclusiveByCause: byCause,
    probeBudgetReached,
    probeBudgetPreventedCoverage,
    privilegedFallback,
    refinement,
    accountingOk: attemptedOk && eligibleOk && abortOk && causesOk && fallbackOk
      && (refinement.eligible === refinement.attempted + refinement.notAttempted)
  };
}

function iframeAccounting(report = {}) {
  const embed = report.page?.embeddedCoverage || {};
  const framesDiscovered = Number(embed.framesDiscovered ?? embed.iframeCount ?? 0);
  const sameOriginChecked = Number(embed.sameOriginFramesChecked ?? embed.sameOriginAttempted ?? 0);
  const sameOriginAttempted = Number(embed.sameOriginAttempted ?? sameOriginChecked);
  // Prefer explicit eligible. Without it, do not invent unfinished work from a bare budget flag.
  const sameOriginEligible = Number(
    embed.sameOriginEligible
    ?? embed.accessibleSameOriginIframes
    ?? (Number.isFinite(Number(embed.sameOriginUnprobed))
      ? sameOriginChecked + Number(embed.sameOriginUnprobed)
      : sameOriginChecked)
  );
  const sameOriginUnprobed = Number(
    embed.sameOriginUnprobed
    ?? Math.max(0, sameOriginEligible - sameOriginChecked)
  );
  const crossOriginNotInspectable = Number(embed.crossOriginFramesNotInspectable ?? embed.crossOriginIframes ?? 0);
  const frameBudgetPreventedCoverage = embed.frameBudgetPreventedCoverage === true || sameOriginUnprobed > 0;
  const frameBudgetReached = embed.frameBudgetReached === true
    || embed.frameBudgetExceeded === true
    || frameBudgetPreventedCoverage;
  return {
    framesDiscovered,
    sameOriginEligible,
    sameOriginAttempted,
    sameOriginChecked,
    sameOriginUnprobed,
    crossOriginNotInspectable,
    frameBudgetReached,
    frameBudgetPreventedCoverage,
    accountingOk: sameOriginEligible === sameOriginChecked + sameOriginUnprobed
  };
}

function interactionAccounting(report = {}) {
  const ix = report.interactionCoverage || {};
  const tested = Number(ix.tested ?? ix.safelyTested ?? 0);
  const passed = Number(ix.passed || 0);
  const failed = Number(ix.failed || 0);
  const inconclusive = Number(ix.inconclusive || 0);
  const skippedUnsafe = Number(ix.skippedUnsafe || 0);
  const skippedIneligible = Number(ix.skippedIneligible || 0);
  const skippedSafetyPolicy = Number(ix.skippedSafetyPolicy || 0);
  const notApplicable = Number(ix.notApplicable || 0);
  const restorationFailures = Number(ix.restorationFailures || 0);
  const candidates = Number(ix.candidates || 0);
  // Prefer explicit eligible (including 0). Never coerce 0 → candidates.
  const eligible = Number(ix.eligible ?? 0);
  const testedOk = tested === passed + failed + inconclusive;
  const terminal = tested + skippedUnsafe + skippedIneligible + skippedSafetyPolicy + notApplicable;
  const candidatesOk = candidates === 0 || candidates === terminal || candidates === eligible + skippedUnsafe + skippedIneligible;
  return {
    candidates,
    eligible,
    tested,
    passed,
    failed,
    inconclusive,
    skippedUnsafe,
    skippedIneligible,
    skippedSafetyPolicy,
    notApplicable,
    restorationFailures,
    partialReason: String(ix.partialReason || ''),
    accountingOk: testedOk && candidatesOk
  };
}

/**
 * User-facing label for degraded link coverage when accounting is available.
 */
export function formatLinkCoverageLabel(report = {}) {
  const links = linkAccounting(report);
  if (links.eligible > 0 && links.unprobed === 0 && links.scannerAborted === 0) {
    let label = `checked all ${links.eligible} eligible links`;
    if (links.inconclusive > 0) label += `; ${links.inconclusive} could not be conclusively verified`;
    return label;
  }
  if (links.eligible > 0 && links.attempted >= 0) {
    let label = `checked ${links.attempted} of ${links.eligible} eligible links`;
    if (links.inconclusive > 0) label += `; ${links.inconclusive} check${links.inconclusive === 1 ? ' was' : 's were'} inconclusive`;
    return label;
  }
  return 'links partially checked';
}

/**
 * Degraded-only labels for the main scan banner.
 * Expected scope limitations must not appear here.
 */
export function limitedCoverageLabels(report = {}) {
  const accounting = buildCoverageAccounting(report);
  const labels = [];
  const seen = new Set();
  const push = (label) => {
    const key = String(label || '').toLowerCase();
    if (!key || seen.has(key)) return;
    seen.add(key);
    labels.push(label);
  };
  for (const area of accounting.degradedAreas) {
    const reason = accounting.reasons?.[area] || report.coverageReasons?.[area] || '';
    if (area === 'links') push(formatLinkCoverageLabel(report));
    else if (area === 'performance') push('current-page performance partial');
    else if (area === 'published') push('published-state unavailable');
    else if (area === 'axe') push('accessibility checks incomplete');
    else if (area === 'runtime') push('runtime observation incomplete');
    else if (area === 'interactions') push('interaction testing incomplete');
    else if (area === 'iframes') push('same-origin frame coverage incomplete');
    else if (area) push(`${area} limited`);
  }
  return labels;
}

/**
 * Secondary notes for expected scope limitations (detail view / diagnostics).
 */
export function scopeCoverageNotes(report = {}) {
  const notes = [];
  const scope = report.coverageScope || {};
  const runtimeStatus = coverageValue(report.coverage?.runtime);
  const runtimeReason = report.coverageReasons?.runtime || '';
  if (
    scope.runtime === 'post-injection-extension'
    || /post-injection|runtime-scope-post-injection|runtime-partial-in-extension/i.test(String(scope.runtime || '') + runtimeReason)
    || runtimeStatus === 'extension-partial'
  ) {
    notes.push('Runtime observation began after extension injection.');
  } else if (/not applicable|runtime-not-captured/i.test(runtimeStatus + runtimeReason)) {
    notes.push('Runtime error capture is not applicable in this scan mode.');
  }
  const embed = report.page?.embeddedCoverage || {};
  if (Number(embed.crossOriginFramesNotInspectable || embed.crossOriginIframes || 0) > 0) {
    const xo = Number(embed.crossOriginFramesNotInspectable || embed.crossOriginIframes || 0);
    notes.push(`${xo} cross-origin frame${xo === 1 ? '' : 's'} could not be inspected.`);
  }
  const links = linkAccounting(report);
  if (links.inconclusive > 0 && !links.probeBudgetPreventedCoverage) {
    notes.push(`${links.inconclusive} link check${links.inconclusive === 1 ? '' : 's'} could not be conclusively verified.`);
  } else if (links.unprobed > 0) {
    notes.push(`${links.unprobed} eligible link${links.unprobed === 1 ? '' : 's'} were not probed before the link-check budget expired.`);
  }
  const ix = interactionAccounting(report);
  if (ix.restorationFailures > 0) {
    notes.push('Interaction testing stopped after restoration could not be verified.');
  } else if (ix.skippedSafetyPolicy > 0) {
    notes.push(`${ix.skippedSafetyPolicy} interaction${ix.skippedSafetyPolicy === 1 ? ' was' : 's were'} not activated because safe restoration could not be guaranteed.`);
  } else if (
    ix.candidates > 0
    && ix.tested === 0
    && /no-safe-reversible|safety/i.test(ix.partialReason)
  ) {
    const n = Math.max(ix.skippedIneligible + ix.skippedUnsafe, ix.candidates, 1);
    notes.push(`${n} interaction${n === 1 ? ' was' : 's were'} not activated because safe restoration could not be guaranteed.`);
  } else if (ix.skippedUnsafe > 0 || ix.skippedIneligible > 0) {
    const skipped = ix.skippedUnsafe + ix.skippedIneligible;
    notes.push(`${skipped} interaction candidate${skipped === 1 ? ' was' : 's were'} skipped by safety policy.`);
  }
  if (report.coverageReasons?.performance && classifyCoverageReason(report.coverageReasons.performance) === COVERAGE_CLASS.SCOPE_LIMITED) {
    notes.push('Historical performance monitoring is unavailable for this page.');
  }
  return notes;
}

/** True when persisted scan identity does not match the running extension build. */
export function isStaleBuildRevision(currentBuildRevision = '', storedBuildRevision = '') {
  const current = String(currentBuildRevision || '').trim();
  const stored = String(storedBuildRevision || '').trim();
  if (!current) return false;
  return !stored || stored !== current;
}

/**
 * Enum reasons for non-complete coverage. Codes only — no WAF/page/network text.
 * Safe to attach to the scan report and copy into Report Bug.
 * Scope-limited reasons may still be recorded for diagnostics; banner uses classification.
 */
export function explainCoverageReasons(report = {}, extras = {}) {
  const coverage = report.coverage || {};
  const reasons = {};
  const state = integrityState(report);
  const blocked = Boolean(report.targetIntegrityBlocked) || state === 'blocked';
  const substituted = state === 'probable_interstitial';
  const inconclusiveTarget = state === 'inconclusive';
  const linkAudit = report.linkAudit || {};
  const links = linkAccounting(report);

  for (const [area, status] of Object.entries(coverage)) {
    const value = coverageValue(status);
    if (!value || value === 'complete' || value === 'current-page' || value === 'renderer' || value === 'deterministic') continue;

    if ((/not applicable/.test(value) || value === 'blocked' || value === 'substituted') && (blocked || substituted)) {
      reasons[area] = blocked ? COVERAGE_REASON.TARGET_BLOCKED : COVERAGE_REASON.TARGET_SUBSTITUTED;
      continue;
    }
    if (/inconclusive/.test(value) && inconclusiveTarget) {
      reasons[area] = COVERAGE_REASON.TARGET_INCONCLUSIVE;
      continue;
    }
    if (area === 'links') {
      if (/unavailable/.test(value)) reasons.links = COVERAGE_REASON.LINK_AUDIT_UNAVAILABLE;
      else if (/not applicable/.test(value)) reasons.links = COVERAGE_REASON.NOT_APPLICABLE;
      else if (links.probeBudgetPreventedCoverage || links.unprobed > 0 || links.scannerAborted > 0) {
        reasons.links = COVERAGE_REASON.PROBE_BUDGET_EXHAUSTED;
      } else if (/partial/.test(value)) {
        // Legacy partial without causal unfinished work — do not invent probe-budget degradation.
        // Leave unset; buildCoverageAccounting will treat as complete/scope from accounting.
      }
      continue;
    }
    if (area === 'performance') {
      if (extras.rendererTimeout) reasons.performance = COVERAGE_REASON.RENDERER_TIMEOUT;
      else if (/partial/.test(value)) reasons.performance = COVERAGE_REASON.LAB_PARTIAL;
      else if (/unavailable|not monitored|local-only/.test(value) && extras.enrichmentFailed) reasons.performance = COVERAGE_REASON.ENRICHMENT_FAILED;
      else if (/unavailable|not monitored/.test(value)) reasons.performance = COVERAGE_REASON.CONNECTOR_UNAVAILABLE;
      else if (/not applicable/.test(value)) reasons.performance = COVERAGE_REASON.NOT_APPLICABLE;
      continue;
    }
    if (area === 'axe' && /unavailable/.test(value)) reasons.axe = COVERAGE_REASON.AXE_UNAVAILABLE;
    if (area === 'runtime' && /not applicable/.test(value)) reasons.runtime = COVERAGE_REASON.RUNTIME_EXTENSION_LIMIT;
    // Legacy extension-partial status remains a scope reason for old artifacts.
    if (area === 'runtime' && /extension-partial/.test(value)) reasons.runtime = COVERAGE_REASON.RUNTIME_EXTENSION_PARTIAL;
    if (area === 'runtime' && /partial|unavailable/.test(value) && !/extension-partial/.test(value)) {
      reasons.runtime = extras.rendererTimeout ? COVERAGE_REASON.RENDERER_TIMEOUT : COVERAGE_REASON.ENRICHMENT_FAILED;
    }
    if (area === 'renderer' && /unavailable|timeout|partial/.test(value)) reasons.renderer = extras.rendererTimeout ? COVERAGE_REASON.RENDERER_TIMEOUT : COVERAGE_REASON.CONNECTOR_UNAVAILABLE;
    if (area === 'published' && /unavailable|local-only/.test(value) && extras.enrichmentFailed) reasons.published = COVERAGE_REASON.ENRICHMENT_FAILED;
    if (area === 'ai' && /unavailable|deterministic/.test(value) && extras.enrichmentFailed) reasons.ai = COVERAGE_REASON.ENRICHMENT_FAILED;
    if (area === 'wcag' && /unavailable/.test(value) && extras.enrichmentFailed) reasons.wcag = COVERAGE_REASON.ENRICHMENT_FAILED;
  }

  // Scope metadata for normal extension observation (status may already be complete).
  const scopeRuntime = report.coverageScope?.runtime;
  if (scopeRuntime === 'post-injection-extension' && !reasons.runtime) {
    reasons.runtime = COVERAGE_REASON.RUNTIME_SCOPE_POST_INJECTION;
  }

  return reasons;
}

/**
 * Authoritative classification of coverage areas for UI, diagnostics, and Frank.
 * Interaction / iframe scope are included when present even though they are not
 * first-class keys on report.coverage.
 */
export function buildCoverageAccounting(report = {}) {
  const coverage = report.coverage || {};
  const reasons = { ...(report.coverageReasons || explainCoverageReasons(report)) };
  const degradedAreas = [];
  const scopeLimitedAreas = [];
  const completeAreas = [];
  const areaClasses = {};
  const areaReasons = {};

  const COMPLETE_STATUSES = /^(complete|current-page|renderer|deterministic|local-only)$/i;
  // Legacy extension-partial is scope, not degradation.
  const SCOPE_STATUSES = /^(extension-partial|not applicable|not monitored)$/i;
  const DEGRADED_STATUSES = /^(partial|unavailable|pending|blocked|substituted|inconclusive)$/i;

  for (const [area, status] of Object.entries(coverage)) {
    const value = coverageValue(status);
    const reason = reasons[area] || '';
    let cls = COVERAGE_CLASS.COMPLETE;
    if (reason) cls = classifyCoverageReason(reason);
    else if (COMPLETE_STATUSES.test(value)) cls = COVERAGE_CLASS.COMPLETE;
    else if (SCOPE_STATUSES.test(value)) cls = COVERAGE_CLASS.SCOPE_LIMITED;
    else if (DEGRADED_STATUSES.test(value)) cls = COVERAGE_CLASS.DEGRADED;
    else if (!value) cls = COVERAGE_CLASS.COMPLETE;
    else cls = COVERAGE_CLASS.SCOPE_LIMITED;

    // Lab-owned performance with historical connector reason → complete (lab).
    if (area === 'performance' && /current-page/i.test(value)) cls = COVERAGE_CLASS.COMPLETE;

    // Links: consequence-based. Partial status without unfinished/scanner-aborted work is not degraded.
    if (area === 'links') {
      const linksAcc = linkAccounting(report);
      if (linksAcc.probeBudgetPreventedCoverage) {
        cls = COVERAGE_CLASS.DEGRADED;
        areaReasons[area] = COVERAGE_REASON.PROBE_BUDGET_EXHAUSTED;
      } else if (/unavailable/i.test(value)) {
        cls = COVERAGE_CLASS.DEGRADED;
        areaReasons[area] = reasons.links || COVERAGE_REASON.LINK_AUDIT_UNAVAILABLE;
      } else if (/none checked/i.test(value)) {
        const uniqueInventory = Number(report.page?.inventory?.uniqueLinks ?? 0);
        if (linksAcc.eligible > 0 || uniqueInventory > 0) {
          cls = COVERAGE_CLASS.DEGRADED;
          areaReasons[area] = COVERAGE_REASON.LINK_AUDIT_UNAVAILABLE;
        } else {
          cls = COVERAGE_CLASS.COMPLETE;
          delete areaReasons[area];
        }
      } else {
        // complete and legacy partial without unfinished work.
        cls = COVERAGE_CLASS.COMPLETE;
        delete areaReasons[area];
      }
    }

    // Normal extension observation is successful collection within a known scope boundary.
    if (
      area === 'runtime'
      && (COMPLETE_STATUSES.test(value) || /extension-partial/.test(value))
      && (
        report.coverageScope?.runtime === 'post-injection-extension'
        || /extension-partial/.test(value)
        || reason === COVERAGE_REASON.RUNTIME_SCOPE_POST_INJECTION
        || reason === COVERAGE_REASON.RUNTIME_EXTENSION_PARTIAL
      )
    ) {
      cls = COVERAGE_CLASS.SCOPE_LIMITED;
      areaReasons[area] = reason
        || (report.coverageScope?.runtime === 'post-injection-extension'
          ? COVERAGE_REASON.RUNTIME_SCOPE_POST_INJECTION
          : COVERAGE_REASON.RUNTIME_EXTENSION_PARTIAL);
    }

    areaClasses[area] = cls;
    if (areaReasons[area] || reason) areaReasons[area] = areaReasons[area] || reason;
    if (cls === COVERAGE_CLASS.DEGRADED) degradedAreas.push(area);
    else if (cls === COVERAGE_CLASS.SCOPE_LIMITED) scopeLimitedAreas.push(area);
    else completeAreas.push(area);
  }

  // Synthetic areas from side-channel accounting.
  const frames = iframeAccounting(report);
  if (frames.frameBudgetPreventedCoverage) {
    if (!degradedAreas.includes('iframes')) degradedAreas.push('iframes');
    // Remove from other buckets if previously classified.
    const si = scopeLimitedAreas.indexOf('iframes'); if (si >= 0) scopeLimitedAreas.splice(si, 1);
    const ci = completeAreas.indexOf('iframes'); if (ci >= 0) completeAreas.splice(ci, 1);
    areaClasses.iframes = COVERAGE_CLASS.DEGRADED;
    areaReasons.iframes = COVERAGE_REASON.FRAME_BUDGET_EXCEEDED;
    reasons.iframes = COVERAGE_REASON.FRAME_BUDGET_EXCEEDED;
  } else if (frames.crossOriginNotInspectable > 0) {
    if (!scopeLimitedAreas.includes('iframes') && !degradedAreas.includes('iframes')) scopeLimitedAreas.push('iframes');
    const ci = completeAreas.indexOf('iframes'); if (ci >= 0) completeAreas.splice(ci, 1);
    areaClasses.iframes = COVERAGE_CLASS.SCOPE_LIMITED;
    areaReasons.iframes = COVERAGE_REASON.CROSS_ORIGIN_FRAMES;
  } else if (frames.sameOriginChecked > 0 || frames.framesDiscovered === 0) {
    if (!completeAreas.includes('iframes') && !scopeLimitedAreas.includes('iframes') && !degradedAreas.includes('iframes')) {
      completeAreas.push('iframes');
      areaClasses.iframes = COVERAGE_CLASS.COMPLETE;
    }
  }

  const ix = interactionAccounting(report);
  const ixReason = String(ix.partialReason || '');
  const iframeInteractionsUnprobed = Number(report.interactionCoverage?.iframeInteractionsUnprobed || 0);
  if (ix.restorationFailures > 0 || /restoration-unproven|prepare-failed/i.test(ixReason)) {
    if (!degradedAreas.includes('interactions')) degradedAreas.push('interactions');
    areaClasses.interactions = COVERAGE_CLASS.DEGRADED;
    areaReasons.interactions = COVERAGE_REASON.INTERACTION_RESTORATION_FAILED;
    reasons.interactions = COVERAGE_REASON.INTERACTION_RESTORATION_FAILED;
  } else if (iframeInteractionsUnprobed > 0 || (/frame-budget-exceeded/i.test(ixReason) && iframeInteractionsUnprobed > 0)) {
    if (!degradedAreas.includes('interactions')) degradedAreas.push('interactions');
    areaClasses.interactions = COVERAGE_CLASS.DEGRADED;
    areaReasons.interactions = COVERAGE_REASON.FRAME_BUDGET_EXCEEDED;
  } else if (/frame-budget-exceeded/i.test(ixReason) && iframeInteractionsUnprobed === 0) {
    // Budget flag without unfinished interaction work — ignore for degradation.
    if (ix.candidates > 0 || ix.tested > 0) {
      if (!completeAreas.includes('interactions') && !scopeLimitedAreas.includes('interactions') && !degradedAreas.includes('interactions')) {
        completeAreas.push('interactions');
        areaClasses.interactions = COVERAGE_CLASS.COMPLETE;
      }
    }
  } else if (
    ix.candidates > 0
    && (
      ix.skippedSafetyPolicy > 0
      || ix.skippedUnsafe > 0
      || ix.skippedIneligible > 0
      || /no-safe-reversible|no-disclosure|interaction-budget|interaction-time-budget|safety/i.test(ixReason)
      || (ix.tested === 0 && ix.eligible === 0)
    )
  ) {
    if (!scopeLimitedAreas.includes('interactions') && !degradedAreas.includes('interactions')) {
      scopeLimitedAreas.push('interactions');
    }
    areaClasses.interactions = COVERAGE_CLASS.SCOPE_LIMITED;
    areaReasons.interactions = COVERAGE_REASON.INTERACTION_SAFETY_SCOPE;
  } else if (ix.candidates > 0 || ix.tested > 0) {
    if (!completeAreas.includes('interactions') && !scopeLimitedAreas.includes('interactions') && !degradedAreas.includes('interactions')) {
      completeAreas.push('interactions');
      areaClasses.interactions = COVERAGE_CLASS.COMPLETE;
    }
  }

  const links = linkAccounting(report);
  // Ensure links classification matches consequence accounting even when coverageReasons pre-seeded.
  if (links.probeBudgetPreventedCoverage) {
    if (!degradedAreas.includes('links')) degradedAreas.push('links');
    const si = scopeLimitedAreas.indexOf('links'); if (si >= 0) scopeLimitedAreas.splice(si, 1);
    const ci = completeAreas.indexOf('links'); if (ci >= 0) completeAreas.splice(ci, 1);
    areaClasses.links = COVERAGE_CLASS.DEGRADED;
    areaReasons.links = COVERAGE_REASON.PROBE_BUDGET_EXHAUSTED;
  } else if (areaClasses.links === COVERAGE_CLASS.DEGRADED && /probe-budget|partial/i.test(String(areaReasons.links || reasons.links || ''))) {
    // Strip false probe-budget degradation.
    const di = degradedAreas.indexOf('links'); if (di >= 0) degradedAreas.splice(di, 1);
    if (!completeAreas.includes('links')) completeAreas.push('links');
    areaClasses.links = COVERAGE_CLASS.COMPLETE;
    delete areaReasons.links;
  }

  const accountingOk = links.accountingOk && ix.accountingOk && frames.accountingOk;

  return {
    degradedAreas,
    scopeLimitedAreas,
    completeAreas,
    areaClasses,
    reasons: areaReasons,
    links,
    interactions: {
      ...ix,
      iframeInteractionsUnprobed
    },
    iframes: frames,
    accountingOk
  };
}

/**
 * After gateway merge, remote coverage may overwrite performance with "not monitored"
 * even when current-page lab evidence remains on the report. Re-apply the lab-first rule.
 */
export function reconcileLinkCoverage(report = {}) {
  if (!report || typeof report !== 'object' || !report.linkAudit) return report;
  const unavailable = /unavailable/i.test(String(report.coverage?.links || report.linkAudit.status || ''));
  const finalized = finalizeLinkAudit(report.linkAudit, { unavailable });
  return {
    ...report,
    linkAudit: finalized.linkAudit,
    coverage: { ...(report.coverage || {}), links: finalized.coverageStatus }
  };
}

export function reconcilePerformanceCoverage(report = {}) {
  if (!report || typeof report !== 'object') return report;
  const coverage = { ...(report.coverage || {}) };
  const prior = String(coverage.performance || '');
  let connectorResult = null;
  if (/^not monitored$/i.test(prior)) connectorResult = { status: 'complete', data: { monitored: false } };
  else if (/^complete$/i.test(prior)) connectorResult = { status: 'complete', data: { monitored: true } };
  else if (/^unavailable$/i.test(prior)) connectorResult = { status: 'unavailable' };
  else if (/^not applicable$/i.test(prior)) connectorResult = { status: 'not_applicable' };
  coverage.performance = resolvePerformanceCoverage(coverage, report.browserPerformance, connectorResult);
  const next = reconcileLinkCoverage({ ...report, coverage });
  // Rebuild reasons from reconciled coverage. When lab wins (current-page), do not
  // re-inject connector-unavailable — historical honesty lives in the Performance row /
  // historicalMonitor projection, not as a Limited-coverage degradation of lab success.
  next.coverageReasons = explainCoverageReasons(next, {
    enrichmentFailed: /enrichment/i.test(String(report.coverageReasons?.published || ''))
  });
  return next;
}
