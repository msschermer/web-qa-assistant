// Performance coverage must distinguish lab evidence from historical monitoring.
// A connector that is "not monitored" must not erase current-page lab measurements.

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
  ENRICHMENT_FAILED: 'enrichment-failed',
  NOT_APPLICABLE: 'not-applicable'
};

function coverageValue(value) {
  return String(value ?? '').trim().toLowerCase().replace(/_/g, ' ');
}

function integrityState(report = {}) {
  const raw = report.page?.targetIntegrity;
  if (raw && typeof raw === 'object') return String(raw.state || '');
  return String(raw || report.targetIntegrity?.state || '');
}

/**
 * Enum reasons for non-complete coverage. Codes only — no WAF/page/network text.
 * Safe to attach to the scan report and copy into Report Bug.
 */
export function explainCoverageReasons(report = {}, extras = {}) {
  const coverage = report.coverage || {};
  const reasons = {};
  const state = integrityState(report);
  const blocked = Boolean(report.targetIntegrityBlocked) || state === 'blocked';
  const substituted = state === 'probable_interstitial';
  const inconclusiveTarget = state === 'inconclusive';
  const linkAudit = report.linkAudit || {};

  for (const [area, status] of Object.entries(coverage)) {
    const value = coverageValue(status);
    if (!value || value === 'complete' || value === 'current-page' || value === 'renderer') continue;

    if ((/not applicable/.test(value) || value === 'blocked' || value === 'substituted') && (blocked || substituted)) {
      reasons[area] = blocked ? COVERAGE_REASON.TARGET_BLOCKED : COVERAGE_REASON.TARGET_SUBSTITUTED;
      continue;
    }
    if (/inconclusive/.test(value) && inconclusiveTarget) {
      reasons[area] = COVERAGE_REASON.TARGET_INCONCLUSIVE;
      continue;
    }
    if (area === 'links') {
      if (/none checked/.test(value)) reasons.links = COVERAGE_REASON.NONE_CHECKED;
      else if (/partial/.test(value) && (linkAudit.reachedLimit || linkAudit.degraded)) reasons.links = COVERAGE_REASON.PROBE_BUDGET_EXHAUSTED;
      else if (/unavailable/.test(value)) reasons.links = COVERAGE_REASON.LINK_AUDIT_UNAVAILABLE;
      else if (/not applicable/.test(value)) reasons.links = COVERAGE_REASON.NOT_APPLICABLE;
      else if (/partial/.test(value)) reasons.links = COVERAGE_REASON.PROBE_BUDGET_EXHAUSTED;
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
    if (area === 'runtime' && /extension-partial/.test(value)) reasons.runtime = COVERAGE_REASON.RUNTIME_EXTENSION_LIMIT;
    if (area === 'renderer' && /unavailable|timeout|partial/.test(value)) reasons.renderer = extras.rendererTimeout ? COVERAGE_REASON.RENDERER_TIMEOUT : COVERAGE_REASON.CONNECTOR_UNAVAILABLE;
    if (area === 'published' && /unavailable|local-only/.test(value) && extras.enrichmentFailed) reasons.published = COVERAGE_REASON.ENRICHMENT_FAILED;
    if (area === 'ai' && /unavailable|deterministic/.test(value) && extras.enrichmentFailed) reasons.ai = COVERAGE_REASON.ENRICHMENT_FAILED;
  }
  return reasons;
}
