/**
 * Scan lifecycle and atomic result reveal.
 * Findings stay locked until the full current-page pipeline is ready.
 */

export const SCAN_PHASE = Object.freeze({
  IDLE: 'IDLE',
  DISCOVERING: 'DISCOVERING',
  CHECKING: 'CHECKING',
  VERIFYING_LINKS: 'VERIFYING_LINKS',
  INSPECTING_FRAMES: 'INSPECTING_FRAMES',
  CORRELATING: 'CORRELATING',
  FRANK_ANALYZING: 'FRANK_ANALYZING',
  READY: 'READY',
  FAILED: 'FAILED'
});

export function emptyResultReady() {
  return {
    scanCollectionComplete: false,
    primaryVerificationComplete: false,
    evidenceLedgerReady: false,
    correlationComplete: false,
    frankInitialReviewComplete: false
  };
}

export function resultReady(flags = {}) {
  return Boolean(
    flags.scanCollectionComplete
    && flags.primaryVerificationComplete
    && flags.evidenceLedgerReady
    && flags.correlationComplete
    && flags.frankInitialReviewComplete
  );
}

export function resultReadyFromReport(report = null, { fatal = false } = {}) {
  if (fatal || !report) return false;
  const links = String(report.coverage?.links || '');
  const primaryVerificationComplete = links !== 'pending'
    && Boolean(report.linkAudit)
    && (links === 'complete' || links === 'partial' || links === 'unavailable' || links === 'none_checked');
  return resultReady({
    scanCollectionComplete: Array.isArray(report.findings),
    primaryVerificationComplete,
    evidenceLedgerReady: Boolean(report.evidenceLedger),
    correlationComplete: Boolean(report.attention),
    frankInitialReviewComplete: typeof report.priorityBrief === 'string' && report.priorityBrief.length > 0
  });
}

export function scanProgressCopy(phase = SCAN_PHASE.IDLE, metrics = {}) {
  const queued = Number(metrics.queued || metrics.eligible || 0);
  const completed = Number(metrics.completed || metrics.attempted || 0);
  switch (phase) {
    case SCAN_PHASE.DISCOVERING:
      return 'Scanning current page…';
    case SCAN_PHASE.CHECKING:
      return 'Checking accessibility, structure, and page behavior…';
    case SCAN_PHASE.INSPECTING_FRAMES:
      return 'Inspecting embedded content…';
    case SCAN_PHASE.VERIFYING_LINKS:
      if (queued > 0) return `Checking ${Math.min(completed, queued)} of ${queued} links…`;
      return 'Verifying links…';
    case SCAN_PHASE.CORRELATING:
      return 'Correlating findings…';
    case SCAN_PHASE.FRANK_ANALYZING:
      return 'Frank is reviewing the scan…';
    case SCAN_PHASE.READY:
      return 'Scan complete.';
    case SCAN_PHASE.FAILED:
      return 'Scan could not finish.';
    default:
      return 'Scanning current page…';
  }
}

export function shouldRevealResults({ phase = SCAN_PHASE.IDLE, flags = {}, fatal = false } = {}) {
  if (fatal || phase === SCAN_PHASE.FAILED) return false;
  if (phase === SCAN_PHASE.READY) return resultReady(flags);
  return false;
}
