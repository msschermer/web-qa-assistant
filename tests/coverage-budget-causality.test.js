import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildCoverageAccounting,
  limitedCoverageLabels,
  explainCoverageReasons,
  COVERAGE_REASON
} from '../packages/findings/coverage.js';
import { buildBugReport } from '../packages/support/bug-report.js';

function nascarLikeLinks({ scannerAborted = 0, causes = null } = {}) {
  const inconclusiveByCause = causes || {
    total: 8,
    scannerBudgetAborted: scannerAborted,
    scannerTimeout: 0,
    remoteBlocked: 2,
    rateLimited: 0,
    corsOrOpaque: 0,
    networkFailure: 4,
    unsupportedProbe: 0,
    ambiguousResponse: 2,
    other: 0
  };
  return {
    discovered: 36,
    eligible: 36,
    attempted: 36,
    checked: 36,
    verifiedHealthy: 28,
    confirmedIssues: 0,
    inconclusive: 8,
    unprobed: 0,
    explicitlySkipped: 0,
    scannerAborted,
    inconclusiveByCause,
    probeBudgetReached: true,
    probeBudgetPreventedCoverage: scannerAborted > 0,
    budgetExhausted: scannerAborted > 0,
    incompleteChecks: Array.from({ length: 8 }, (_, i) => ({
      kind: 'external-link',
      url: `https://example.com/u${i}`,
      reason: i < scannerAborted ? 'budget-exhausted' : 'unavailable',
      cause: i < scannerAborted ? 'scanner-budget-aborted' : 'network-failure',
      status: 0,
      attempts: [{ attempt: 1, state: 'unavailable', status: 0 }]
    }))
  };
}

test('NASCAR-like: all eligible attempted + remote inconclusive → links NOT degraded', () => {
  const report = {
    coverage: { browser: 'complete', links: 'partial', axe: 'complete', runtime: 'complete' },
    coverageReasons: { links: COVERAGE_REASON.PROBE_BUDGET_EXHAUSTED },
    coverageScope: { runtime: 'post-injection-extension' },
    linkAudit: nascarLikeLinks({ scannerAborted: 0 }),
    page: {
      embeddedCoverage: {
        framesDiscovered: 8,
        sameOriginEligible: 3,
        sameOriginAttempted: 3,
        sameOriginFramesChecked: 3,
        sameOriginUnprobed: 0,
        crossOriginFramesNotInspectable: 5,
        frameBudgetReached: true,
        frameBudgetExceeded: false,
        frameBudgetPreventedCoverage: false
      }
    },
    interactionCoverage: {
      candidates: 5,
      eligible: 3,
      tested: 3,
      passed: 2,
      failed: 0,
      inconclusive: 1,
      skippedUnsafe: 0,
      skippedIneligible: 2,
      skippedSafetyPolicy: 0,
      notApplicable: 0,
      restorationFailures: 0,
      partialReason: 'frame-budget-exceeded',
      iframeInteractionsUnprobed: 0
    }
  };
  const accounting = buildCoverageAccounting(report);
  assert.equal(accounting.degradedAreas.includes('links'), false);
  assert.equal(accounting.degradedAreas.includes('iframes'), false);
  assert.equal(accounting.degradedAreas.includes('interactions'), false);
  assert.deepEqual(accounting.degradedAreas, []);
  assert.equal(limitedCoverageLabels(report).length, 0);
  assert.equal(accounting.links.probeBudgetReached, true);
  assert.equal(accounting.links.probeBudgetPreventedCoverage, false);
  assert.equal(accounting.iframes.frameBudgetReached, true);
  assert.equal(accounting.iframes.frameBudgetPreventedCoverage, false);
});

test('NASCAR-like: scanner-aborted inconclusive → links degraded', () => {
  const report = {
    coverage: { browser: 'complete', links: 'partial' },
    linkAudit: nascarLikeLinks({ scannerAborted: 3 })
  };
  const accounting = buildCoverageAccounting(report);
  assert.ok(accounting.degradedAreas.includes('links'));
  assert.equal(accounting.links.scannerAborted, 3);
  assert.equal(accounting.links.probeBudgetPreventedCoverage, true);
  assert.match(limitedCoverageLabels(report)[0], /checked 36 of 36|checked all 36/i);
});

test('iframe: budget reached after all same-origin checked → NOT degraded', () => {
  const accounting = buildCoverageAccounting({
    coverage: { browser: 'complete' },
    page: {
      embeddedCoverage: {
        sameOriginEligible: 3,
        sameOriginFramesChecked: 3,
        sameOriginUnprobed: 0,
        crossOriginFramesNotInspectable: 5,
        frameBudgetReached: true,
        frameBudgetExceeded: true, // legacy flag alone must not degrade
        frameBudgetPreventedCoverage: false
      }
    }
  });
  assert.equal(accounting.degradedAreas.includes('iframes'), false);
  assert.ok(accounting.scopeLimitedAreas.includes('iframes'));
});

test('iframe: one same-origin unprobed → degraded', () => {
  const accounting = buildCoverageAccounting({
    coverage: { browser: 'complete' },
    page: {
      embeddedCoverage: {
        sameOriginEligible: 4,
        sameOriginFramesChecked: 3,
        sameOriginUnprobed: 1,
        crossOriginFramesNotInspectable: 5,
        frameBudgetReached: true,
        frameBudgetExceeded: true,
        frameBudgetPreventedCoverage: true
      }
    }
  });
  assert.ok(accounting.degradedAreas.includes('iframes'));
  assert.equal(accounting.reasons.iframes, COVERAGE_REASON.FRAME_BUDGET_EXCEEDED);
});

test('interactions: frame-budget flag without unprobed iframe interactions → not degraded', () => {
  const accounting = buildCoverageAccounting({
    coverage: { browser: 'complete' },
    interactionCoverage: {
      candidates: 5,
      eligible: 3,
      tested: 3,
      passed: 2,
      failed: 0,
      inconclusive: 1,
      skippedIneligible: 2,
      skippedUnsafe: 0,
      skippedSafetyPolicy: 0,
      notApplicable: 0,
      restorationFailures: 0,
      partialReason: 'frame-budget-exceeded',
      iframeInteractionsUnprobed: 0
    }
  });
  assert.equal(accounting.degradedAreas.includes('interactions'), false);
});

test('interactions: frame budget left iframe interactions unprobed → degraded', () => {
  const accounting = buildCoverageAccounting({
    coverage: { browser: 'complete' },
    interactionCoverage: {
      candidates: 5,
      eligible: 3,
      tested: 3,
      passed: 3,
      failed: 0,
      inconclusive: 0,
      skippedIneligible: 2,
      skippedUnsafe: 0,
      skippedSafetyPolicy: 0,
      notApplicable: 0,
      restorationFailures: 0,
      partialReason: 'frame-budget-exceeded',
      iframeInteractionsUnprobed: 2
    }
  });
  assert.ok(accounting.degradedAreas.includes('interactions'));
});

test('telemetry probeBudgetReached alone does not degrade', () => {
  const report = {
    coverage: { links: 'complete', browser: 'complete' },
    linkAudit: {
      discovered: 10,
      eligible: 10,
      attempted: 10,
      checked: 10,
      verifiedHealthy: 10,
      confirmedIssues: 0,
      inconclusive: 0,
      unprobed: 0,
      scannerAborted: 0,
      probeBudgetReached: true,
      probeBudgetPreventedCoverage: false
    }
  };
  assert.deepEqual(buildCoverageAccounting(report).degradedAreas, []);
  assert.equal(explainCoverageReasons(report).links, undefined);
});

test('diagnostics project causal link and iframe fields for NASCAR-like remote case', () => {
  const artifact = buildBugReport({
    version: '1.7.4',
    report: {
      page: {
        url: 'https://example.com/',
        embeddedCoverage: {
          framesDiscovered: 8,
          sameOriginEligible: 3,
          sameOriginFramesChecked: 3,
          sameOriginUnprobed: 0,
          crossOriginFramesNotInspectable: 5,
          frameBudgetReached: true,
          frameBudgetExceeded: false,
          frameBudgetPreventedCoverage: false
        }
      },
      coverage: { browser: 'complete', links: 'complete', axe: 'complete', runtime: 'complete' },
      coverageScope: { runtime: 'post-injection-extension' },
      linkAudit: nascarLikeLinks({ scannerAborted: 0 }),
      findings: [],
      interactionCoverage: {
        candidates: 5, eligible: 3, tested: 3, passed: 2, inconclusive: 1,
        skippedIneligible: 2, skippedUnsafe: 0, skippedSafetyPolicy: 0,
        notApplicable: 0, restorationFailures: 0, partialReason: 'top-document-interactions',
        iframeInteractionsUnprobed: 0
      }
    },
    lastScanAttempt: { ok: true, scanId: 's1' }
  });
  assert.deepEqual(artifact.coverageAccounting.degradedAreas, []);
  assert.equal(artifact.links.unprobed, 0);
  assert.equal(artifact.links.probeBudgetReached, true);
  assert.equal(artifact.links.probeBudgetPreventedCoverage, false);
  assert.equal(artifact.links.reason, undefined);
  assert.equal(artifact.pageDiagnostics.iframeCoverage.sameOriginUnprobed, 0);
  assert.equal(artifact.pageDiagnostics.iframeCoverage.frameBudgetPreventedCoverage, false);
  const linkEvt = artifact.timeline.items.find(e => e.type === 'link_probe_completed');
  assert.equal(linkEvt.data.probeBudgetPreventedCoverage, false);
  assert.equal(linkEvt.data.unprobed, 0);
});

test('unprobed eligible links remain degraded', () => {
  const report = {
    coverage: { links: 'partial', browser: 'complete' },
    linkAudit: {
      discovered: 48,
      eligible: 48,
      attempted: 36,
      checked: 36,
      verifiedHealthy: 30,
      confirmedIssues: 0,
      inconclusive: 6,
      unprobed: 12,
      scannerAborted: 0,
      probeBudgetReached: true,
      probeBudgetPreventedCoverage: true
    }
  };
  const accounting = buildCoverageAccounting(report);
  assert.deepEqual(accounting.degradedAreas, ['links']);
  assert.match(limitedCoverageLabels(report)[0], /checked 36 of 48/i);
});
