import test from 'node:test';
import assert from 'node:assert/strict';
import {
  applyPrivilegedProbeAccounting,
  buildCoverageAccounting,
  mergeGatewayLinkAudit,
  reconcilePerformanceCoverage,
  finalizeLinkAudit,
  COVERAGE_REASON
} from '../packages/findings/coverage.js';
import { buildBugReport } from '../packages/support/bug-report.js';

function nascarProbeCompleted() {
  const incompleteChecks = Array.from({ length: 9 }, (_, i) => ({
    kind: 'external-link',
    url: `https://cdn.example.net/asset-${i}`,
    reason: i % 3 === 0 ? 'unavailable' : 'timeout',
    cause: i % 3 === 0 ? 'network-failure' : 'cors-or-opaque',
    status: 0,
    attempts: [{ attempt: 1, state: 'unavailable', status: 0 }]
  }));
  return {
    discovered: 36,
    eligible: 36,
    attempted: 36,
    checked: 36,
    verifiedHealthy: 27,
    confirmedIssues: 0,
    inconclusive: 9,
    unprobed: 0,
    explicitlySkipped: 0,
    scannerAborted: 0,
    inconclusiveByCause: {
      total: 9,
      scannerBudgetAborted: 0,
      scannerTimeout: 0,
      remoteBlocked: 0,
      rateLimited: 0,
      corsOrOpaque: 6,
      networkFailure: 3,
      unsupportedProbe: 0,
      ambiguousResponse: 0,
      other: 0
    },
    incompleteChecks,
    unprobedChecks: [],
    probeBudgetReached: true,
    probeBudgetPreventedCoverage: false,
    budgetExhausted: false,
    reachedLimit: false,
    status: 'complete'
  };
}

function corruptedGatewayReport(localAudit) {
  // Historical bug: later merge treated incompleteChecks.length (or a subset)
  // as scannerAborted and flipped coverage to probe-budget-exhausted.
  return {
    coverage: {
      browser: 'complete',
      links: 'partial',
      axe: 'complete',
      runtime: 'complete'
    },
    coverageReasons: { links: COVERAGE_REASON.PROBE_BUDGET_EXHAUSTED },
    findings: [],
    linkAudit: {
      ...localAudit,
      privilegedProbe: 'gateway',
      scannerAborted: 3,
      probeBudgetPreventedCoverage: true,
      budgetExhausted: true,
      coverage: 'partial'
    }
  };
}

test('NASCAR merge causality: probe-complete counts survive gateway, server, diagnostic, and accounting', () => {
  const localAudit = nascarProbeCompleted();
  const local = {
    coverage: { browser: 'complete', links: 'complete', axe: 'complete', runtime: 'complete' },
    linkAudit: localAudit,
    findings: [],
    page: { url: 'https://www.example.com/' },
    browserPerformance: { available: true, largestContentfulPaintMs: 1800, ttfbMs: 90, transferBytes: 80000 }
  };

  const remote = corruptedGatewayReport(localAudit);
  const mergedLinks = mergeGatewayLinkAudit(local, remote);
  assert.equal(mergedLinks.linkAudit.scannerAborted, 0, 'gateway merge must not adopt inferred scannerAborted');
  assert.equal(mergedLinks.linkAudit.probeBudgetPreventedCoverage, false);
  assert.equal(mergedLinks.coverageLinks, 'complete');
  assert.equal(mergedLinks.linkAudit.unprobed, 0);
  assert.equal(mergedLinks.linkAudit.inconclusiveByCause.scannerBudgetAborted, 0);

  const afterPrivileged = applyPrivilegedProbeAccounting(local, {
    applied: {
      findings: [],
      incompleteChecks: localAudit.incompleteChecks,
      resolvedUrls: []
    },
    truncated: true,
    candidateTotal: 9,
    candidatesProbed: 9
  });
  assert.equal(afterPrivileged.linkAudit.scannerAborted, 0);
  assert.equal(afterPrivileged.linkAudit.probeBudgetPreventedCoverage, false);
  assert.equal(afterPrivileged.coverage.links, 'complete');
  assert.equal(afterPrivileged.linkAudit.unprobed, 0);

  const stalePartial = {
    ...afterPrivileged,
    coverage: { ...afterPrivileged.coverage, links: 'partial' },
    coverageReasons: { links: COVERAGE_REASON.PROBE_BUDGET_EXHAUSTED }
  };
  const reconciled = reconcilePerformanceCoverage(stalePartial);
  assert.equal(reconciled.coverage.links, 'complete');
  assert.equal(reconciled.linkAudit.scannerAborted, 0);
  assert.equal(reconciled.linkAudit.probeBudgetPreventedCoverage, false);

  const accounting = buildCoverageAccounting(reconciled);
  assert.equal(accounting.links.scannerAborted, 0);
  assert.equal(accounting.links.probeBudgetPreventedCoverage, false);
  assert.equal(accounting.links.coverage || undefined, undefined);
  assert.equal(accounting.degradedAreas.includes('links'), false);
  assert.equal(accounting.links.scannerAborted, accounting.links.inconclusiveByCause.scannerBudgetAborted);

  const artifact = buildBugReport({
    version: '1.7.5',
    report: reconciled,
    lastScanAttempt: { ok: true, scanId: 'nascar-merge' }
  });
  assert.equal(artifact.links.scannerAborted, 0);
  assert.equal(artifact.links.probeBudgetPreventedCoverage, false);
  assert.equal(artifact.links.coverage, 'complete');
  assert.equal(artifact.links.unprobed, 0);
  assert.equal(artifact.coverageAccounting.degradedAreas.includes('links'), false);
  const probeEvt = artifact.timeline.items.find((e) => e.type === 'link_probe_completed');
  assert.equal(probeEvt.data.scannerAborted, 0);
  assert.equal(probeEvt.data.probeBudgetPreventedCoverage, false);
  assert.equal(probeEvt.data.coverage, 'complete');
  assert.equal(probeEvt.data.unprobed, 0);
  const degradedEvt = artifact.timeline.items.find((e) => e.type === 'coverage_degraded');
  assert.ok(!degradedEvt || !(degradedEvt.data.areas || []).includes('links'));
});

test('privileged re-probe does not turn truncated candidate leftover into unprobed/abort', () => {
  const localAudit = nascarProbeCompleted();
  const report = applyPrivilegedProbeAccounting({
    coverage: { links: 'complete', browser: 'complete' },
    linkAudit: localAudit,
    findings: []
  }, {
    applied: { findings: [], incompleteChecks: localAudit.incompleteChecks.slice(0, 9), resolvedUrls: [] },
    truncated: true,
    candidateTotal: 40,
    candidatesProbed: 9
  });
  assert.equal(report.linkAudit.scannerAborted, 0);
  assert.equal(report.linkAudit.unprobed, 0);
  assert.equal(report.linkAudit.probeBudgetPreventedCoverage, false);
  assert.equal(report.coverage.links, 'complete');
  const fallback = report.linkAudit.privilegedFallback;
  assert.equal(fallback.mode, 'gateway');
  assert.equal(fallback.eligible, 40);
  assert.equal(fallback.attempted, 9);
  assert.equal(fallback.notAttempted, 31);
  assert.equal(fallback.truncated, true);
  assert.equal(fallback.notAttempted, report.linkAudit.unprobed + 31);
  assert.equal(report.linkAudit.gatewayTruncatedInconclusive, 31);
  const accounting = buildCoverageAccounting(report);
  assert.equal(accounting.links.unprobed, 0);
  assert.equal(accounting.links.privilegedFallback.notAttempted, 31);
  assert.equal(accounting.links.probeBudgetPreventedCoverage, false);
  const artifact = buildBugReport({ report, version: '1.7.5' });
  assert.equal(artifact.links.unprobed, 0);
  assert.equal(artifact.links.coverage, 'complete');
  assert.equal(artifact.links.privilegedFallback.notAttempted, 31);
  assert.equal(artifact.links.privilegedFallback.eligible, 40);
});

test('finalizeLinkAudit never treats incompleteChecks.length as scannerAborted', () => {
  const audit = nascarProbeCompleted();
  audit.scannerAborted = 0;
  const finalized = finalizeLinkAudit(audit);
  assert.equal(finalized.linkAudit.scannerAborted, 0);
  assert.equal(finalized.coverageStatus, 'complete');
  assert.equal(finalized.linkAudit.incompleteChecks.length, 9);
});

test('privileged fallback cannot report eligible work with zero attempted and zero notAttempted', () => {
  const finalized = finalizeLinkAudit({
    discovered: 134,
    eligible: 134,
    attempted: 134,
    verifiedHealthy: 93,
    confirmedIssues: 0,
    inconclusive: 41,
    unprobed: 0,
    scannerAborted: 0,
    incompleteChecks: Array.from({ length: 41 }, (_, i) => ({
      kind: 'external-link',
      url: `https://cdn.example.net/x-${i}`,
      cause: 'network-failure'
    })),
    privilegedFallback: { mode: 'none', eligible: 27, attempted: 0, notAttempted: 0, stillInconclusive: 27 }
  });
  assert.equal(finalized.linkAudit.privilegedFallback.notAttempted, 27);
  assert.equal(finalized.linkAudit.privilegedFallback.eligible, finalized.linkAudit.privilegedFallback.attempted + finalized.linkAudit.privilegedFallback.notAttempted);
  assert.equal(finalized.linkAudit.attempted, finalized.linkAudit.verifiedHealthy + finalized.linkAudit.confirmedIssues + finalized.linkAudit.inconclusive);
  assert.equal(finalized.linkAudit.accountingOk, true);
});
