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
