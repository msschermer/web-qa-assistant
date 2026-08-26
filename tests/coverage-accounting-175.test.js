import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  buildCoverageAccounting,
  classifyCoverageReason,
  limitedCoverageLabels,
  scopeCoverageNotes,
  explainCoverageReasons,
  formatLinkCoverageLabel,
  COVERAGE_CLASS,
  COVERAGE_REASON
} from '../packages/findings/coverage.js';
import { buildBugReport } from '../packages/support/bug-report.js';

function reproductionReport(overrides = {}) {
  return {
    page: {
      url: 'https://example.com/',
      embeddedCoverage: {
        sameOriginFramesChecked: 0,
        crossOriginFramesNotInspectable: 2,
        crossOriginIframes: 2,
        frameBudgetExceeded: false
      }
    },
    coverage: {
      browser: 'complete',
      links: 'partial',
      axe: 'complete',
      published: 'complete',
      performance: 'current-page',
      wcag: 'complete',
      ai: 'deterministic',
      runtime: 'complete'
    },
    coverageScope: { runtime: 'post-injection-extension' },
    coverageReasons: {
      links: COVERAGE_REASON.PROBE_BUDGET_EXHAUSTED,
      runtime: COVERAGE_REASON.RUNTIME_SCOPE_POST_INJECTION
    },
    linkAudit: {
      discovered: 48,
      eligible: 48,
      attempted: 36,
      checked: 36,
      verifiedHealthy: 30,
      confirmedIssues: 0,
      inconclusive: 6,
      unprobed: 12,
      explicitlySkipped: 0,
      reachedLimit: true,
      budgetExhausted: true
    },
    interactionCoverage: {
      candidates: 1,
      eligible: 0,
      safelyTested: 0,
      tested: 0,
      skippedUnsafe: 0,
      skippedIneligible: 1,
      skippedSafetyPolicy: 0,
      passed: 0,
      failed: 0,
      inconclusive: 0,
      notApplicable: 0,
      restorationFailures: 0,
      partialReason: 'no-safe-reversible-candidates',
      accountingOk: true
    },
    browserPerformance: {
      available: true,
      largestContentfulPaintMs: 2100,
      ttfbMs: 120,
      transferBytes: 90000
    },
    findings: [],
    ...overrides
  };
}

test('runtime: normal extension observation is scope-limited, not degraded', () => {
  const report = {
    coverage: { browser: 'complete', runtime: 'complete', axe: 'complete' },
    coverageScope: { runtime: 'post-injection-extension' },
    coverageReasons: explainCoverageReasons({
      coverage: { browser: 'complete', runtime: 'complete', axe: 'complete' },
      coverageScope: { runtime: 'post-injection-extension' }
    })
  };
  const accounting = buildCoverageAccounting(report);
  assert.ok(accounting.scopeLimitedAreas.includes('runtime'));
  assert.equal(accounting.degradedAreas.includes('runtime'), false);
  assert.equal(limitedCoverageLabels(report).length, 0);
  assert.ok(scopeCoverageNotes(report).some(n => /post-injection|extension injection/i.test(n)));
});

test('runtime: legacy extension-partial status is scope-limited, not degraded', () => {
  const report = {
    coverage: { runtime: 'extension-partial', browser: 'complete' },
    coverageReasons: { runtime: COVERAGE_REASON.RUNTIME_EXTENSION_PARTIAL }
  };
  const accounting = buildCoverageAccounting(report);
  assert.ok(accounting.scopeLimitedAreas.includes('runtime'));
  assert.equal(accounting.degradedAreas.includes('runtime'), false);
  assert.equal(limitedCoverageLabels(report).some(l => /runtime/i.test(l)), false);
});

test('runtime: collector/timeout failure is degraded', () => {
  const report = {
    coverage: { runtime: 'unavailable', browser: 'complete' },
    coverageReasons: { runtime: COVERAGE_REASON.ENRICHMENT_FAILED }
  };
  assert.equal(classifyCoverageReason(COVERAGE_REASON.ENRICHMENT_FAILED), COVERAGE_CLASS.DEGRADED);
  const accounting = buildCoverageAccounting(report);
  assert.ok(accounting.degradedAreas.includes('runtime'));
  assert.ok(limitedCoverageLabels(report).some(l => /runtime/i.test(l)));
});

test('iframes: cross-origin only is scope-limited, not degraded', () => {
  const report = {
    coverage: { browser: 'complete', runtime: 'complete' },
    coverageScope: { runtime: 'post-injection-extension' },
    page: {
      embeddedCoverage: {
        sameOriginFramesChecked: 0,
        crossOriginFramesNotInspectable: 2,
        frameBudgetExceeded: false
      }
    }
  };
  const accounting = buildCoverageAccounting(report);
  assert.ok(accounting.scopeLimitedAreas.includes('iframes'));
  assert.equal(accounting.degradedAreas.includes('iframes'), false);
  assert.equal(accounting.degradedAreas.includes('runtime'), false);
});

test('iframes: same-origin frame budget exceeded is degraded', () => {
  const report = {
    coverage: { browser: 'complete' },
    page: {
      embeddedCoverage: {
        sameOriginFramesChecked: 3,
        accessibleSameOriginIframes: 5,
        sameOriginEligible: 5,
        sameOriginUnprobed: 2,
        crossOriginFramesNotInspectable: 0,
        frameBudgetExceeded: true,
        frameBudgetPreventedCoverage: true
      }
    }
  };
  const accounting = buildCoverageAccounting(report);
  assert.ok(accounting.degradedAreas.includes('iframes'));
  assert.ok(limitedCoverageLabels(report).some(l => /frame/i.test(l)));
});

test('interactions: deliberate safety skip is scope-limited', () => {
  const report = {
    coverage: { browser: 'complete' },
    interactionCoverage: {
      candidates: 1,
      eligible: 0,
      tested: 0,
      skippedIneligible: 1,
      skippedUnsafe: 0,
      skippedSafetyPolicy: 0,
      passed: 0,
      failed: 0,
      inconclusive: 0,
      notApplicable: 0,
      restorationFailures: 0,
      partialReason: 'no-safe-reversible-candidates'
    }
  };
  const accounting = buildCoverageAccounting(report);
  assert.ok(accounting.scopeLimitedAreas.includes('interactions'));
  assert.equal(accounting.degradedAreas.includes('interactions'), false);
});

test('interactions: restoration failure is degraded', () => {
  const report = {
    coverage: { browser: 'complete' },
    interactionCoverage: {
      candidates: 2,
      eligible: 2,
      tested: 1,
      passed: 0,
      failed: 0,
      inconclusive: 1,
      skippedUnsafe: 0,
      skippedIneligible: 0,
      skippedSafetyPolicy: 0,
      notApplicable: 0,
      restorationFailures: 1,
      partialReason: 'restoration-unproven'
    }
  };
  const accounting = buildCoverageAccounting(report);
  assert.ok(accounting.degradedAreas.includes('interactions'));
});

test('interactions: accounting reconciles tested outcomes', () => {
  const report = {
    coverage: { browser: 'complete' },
    interactionCoverage: {
      candidates: 4,
      eligible: 2,
      tested: 2,
      passed: 1,
      failed: 1,
      inconclusive: 0,
      skippedUnsafe: 1,
      skippedIneligible: 1,
      skippedSafetyPolicy: 0,
      notApplicable: 0,
      restorationFailures: 0,
      partialReason: 'top-document-interactions'
    }
  };
  const accounting = buildCoverageAccounting(report);
  assert.equal(accounting.interactions.accountingOk, true);
  assert.equal(accounting.interactions.tested, 2);
});

test('links: all attempted and healthy is complete', () => {
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
      explicitlySkipped: 0
    }
  };
  const accounting = buildCoverageAccounting(report);
  assert.equal(accounting.degradedAreas.includes('links'), false);
  assert.equal(accounting.links.accountingOk, true);
});

test('links: unprobed from budget are not inconclusive', () => {
  const report = {
    coverage: { links: 'partial', browser: 'complete' },
    coverageReasons: { links: COVERAGE_REASON.PROBE_BUDGET_EXHAUSTED },
    linkAudit: {
      discovered: 48,
      eligible: 48,
      attempted: 36,
      checked: 36,
      verifiedHealthy: 30,
      confirmedIssues: 0,
      inconclusive: 6,
      unprobed: 12,
      explicitlySkipped: 0
    }
  };
  assert.equal(report.linkAudit.attempted, report.linkAudit.verifiedHealthy + report.linkAudit.confirmedIssues + report.linkAudit.inconclusive);
  assert.equal(report.linkAudit.eligible, report.linkAudit.attempted + report.linkAudit.unprobed);
  const label = formatLinkCoverageLabel(report);
  assert.match(label, /checked 36 of 48 eligible links/i);
  assert.match(label, /6 checks were inconclusive/i);
  const labels = limitedCoverageLabels(report);
  assert.equal(labels.length, 1);
  assert.match(labels[0], /checked 36 of 48/i);
});

test('links: attempted inconclusive alone does not invent unprobed', () => {
  const report = {
    coverage: { links: 'complete', browser: 'complete' },
    linkAudit: {
      discovered: 5,
      eligible: 5,
      attempted: 5,
      checked: 5,
      verifiedHealthy: 3,
      confirmedIssues: 0,
      inconclusive: 2,
      unprobed: 0,
      explicitlySkipped: 0
    }
  };
  const accounting = buildCoverageAccounting(report);
  assert.equal(accounting.degradedAreas.includes('links'), false);
  assert.equal(accounting.links.unprobed, 0);
  assert.equal(accounting.links.inconclusive, 2);
});

test('coverage summary: only scope limitations → no Limited coverage warning', () => {
  const report = {
    coverage: {
      browser: 'complete',
      links: 'complete',
      axe: 'complete',
      published: 'complete',
      performance: 'current-page',
      runtime: 'complete'
    },
    coverageScope: { runtime: 'post-injection-extension' },
    coverageReasons: { runtime: COVERAGE_REASON.RUNTIME_SCOPE_POST_INJECTION },
    page: { embeddedCoverage: { crossOriginFramesNotInspectable: 2, frameBudgetExceeded: false } },
    interactionCoverage: {
      candidates: 1,
      eligible: 0,
      tested: 0,
      skippedIneligible: 1,
      passed: 0,
      failed: 0,
      inconclusive: 0,
      skippedUnsafe: 0,
      skippedSafetyPolicy: 0,
      notApplicable: 0,
      restorationFailures: 0,
      partialReason: 'no-safe-reversible-candidates'
    },
    linkAudit: {
      discovered: 4, eligible: 4, attempted: 4, checked: 4,
      verifiedHealthy: 4, confirmedIssues: 0, inconclusive: 0, unprobed: 0, explicitlySkipped: 0
    }
  };
  assert.deepEqual(limitedCoverageLabels(report), []);
  const accounting = buildCoverageAccounting(report);
  assert.deepEqual(accounting.degradedAreas, []);
  assert.ok(accounting.scopeLimitedAreas.includes('runtime'));
  assert.ok(accounting.scopeLimitedAreas.includes('iframes'));
  assert.ok(accounting.scopeLimitedAreas.includes('interactions'));
});

test('coverage summary: one degraded area plus scope limitations', () => {
  const report = reproductionReport();
  const labels = limitedCoverageLabels(report);
  assert.equal(labels.length, 1);
  assert.match(labels[0], /checked 36 of 48 eligible links/i);
  const accounting = buildCoverageAccounting(report);
  assert.deepEqual(accounting.degradedAreas, ['links']);
  assert.ok(accounting.scopeLimitedAreas.includes('runtime'));
  assert.ok(accounting.scopeLimitedAreas.includes('iframes'));
  assert.ok(accounting.scopeLimitedAreas.includes('interactions'));
});

test('coverage summary: multiple degraded areas keep correct count', () => {
  const report = {
    coverage: {
      browser: 'complete',
      links: 'partial',
      axe: 'unavailable',
      runtime: 'unavailable'
    },
    coverageReasons: {
      links: COVERAGE_REASON.PROBE_BUDGET_EXHAUSTED,
      axe: COVERAGE_REASON.AXE_UNAVAILABLE,
      runtime: COVERAGE_REASON.ENRICHMENT_FAILED
    },
    linkAudit: {
      discovered: 10, eligible: 10, attempted: 4, checked: 4,
      verifiedHealthy: 4, confirmedIssues: 0, inconclusive: 0, unprobed: 6, explicitlySkipped: 0
    }
  };
  const labels = limitedCoverageLabels(report);
  assert.equal(labels.length, 3);
});

test('diagnostics: coverageAccounting classifies reproduction case', () => {
  const artifact = buildBugReport({
    version: '1.7.4',
    report: reproductionReport(),
    lastScanAttempt: { ok: true, scanId: 's1' }
  });
  assert.ok(artifact.coverageAccounting);
  assert.deepEqual(artifact.coverageAccounting.degradedAreas, ['links']);
  assert.ok(artifact.coverageAccounting.scopeLimitedAreas.includes('runtime'));
  assert.ok(artifact.coverageAccounting.scopeLimitedAreas.includes('iframes'));
  assert.ok(artifact.coverageAccounting.scopeLimitedAreas.includes('interactions'));
  assert.equal(artifact.links.attempted, 36);
  assert.equal(artifact.links.eligible, 48);
  assert.equal(artifact.links.unprobed, 12);
  assert.equal(artifact.links.inconclusive, 6);
  assert.equal(artifact.links.accountingOk, true);
  assert.equal(artifact.pageDiagnostics.interactionCoverage.eligible, 0);
  assert.notEqual(artifact.pageDiagnostics.interactionCoverage.eligible, artifact.pageDiagnostics.interactionCoverage.candidates);
});

test('resource evidence: inconclusive anomaly is not confirmed failure', () => {
  const artifact = buildBugReport({
    version: '1.7.4',
    report: {
      page: { url: 'https://example.com/' },
      coverage: { browser: 'complete' },
      findings: [],
      diagnostics: {
        failedResources: [{
          kind: 'resource_anomaly',
          initiator: 'script',
          status: 0,
          source: 'https://cdn.example.com/a.js',
          disposition: 'inconclusive',
          evidenceClass: 'observation'
        }],
        observedResourceFailureEvents: 3,
        deduplicatedFailedResources: 1,
        confirmedResourceFailures: 0,
        inconclusiveResourceObservations: 1
      }
    }
  });
  const row = artifact.pageDiagnostics.failedResources.items[0];
  assert.equal(row.disposition, 'inconclusive');
  assert.notEqual(row.kind, 'resource_failure');
  assert.equal(artifact.pageDiagnostics.resourceCounts.confirmedFailures, 0);
  assert.equal(artifact.pageDiagnostics.resourceCounts.inconclusiveObservations, 1);
});

test('performance with current-page lab and unavailable historical monitor is not degraded', () => {
  const accounting = buildCoverageAccounting({
    coverage: { browser: 'complete', performance: 'current-page', links: 'complete' },
    browserPerformance: {
      available: true,
      largestContentfulPaintMs: 2100,
      ttfbMs: 120,
      transferBytes: 90000
    },
    findings: []
  });
  assert.equal(accounting.degradedAreas.includes('performance'), false);
  assert.ok(accounting.completeAreas.includes('performance') || !accounting.scopeLimitedAreas.includes('performance'));
});

test('web app uses shared coverage accounting module', () => {
  const web = readFileSync(new URL('../apps/web/public/app.js', import.meta.url), 'utf8');
  const html = readFileSync(new URL('../apps/web/public/index.html', import.meta.url), 'utf8');
  assert.match(web, /buildCoverageAccounting/);
  assert.match(web, /\/assets\/coverage\.js/);
  assert.match(html, /type="module"/);
});

test('resource evidence: confirmed failure keeps failure kind', () => {
  const artifact = buildBugReport({
    version: '1.7.4',
    report: {
      page: { url: 'https://example.com/' },
      coverage: { browser: 'complete' },
      findings: [],
      diagnostics: {
        failedResources: [{
          kind: 'resource_failure',
          initiator: 'script',
          status: 404,
          source: 'https://example.com/missing.js',
          sameOrigin: true,
          disposition: 'confirmed',
          evidenceClass: 'confirmed-failure'
        }],
        confirmedResourceFailures: 1,
        inconclusiveResourceObservations: 0
      }
    }
  });
  const row = artifact.pageDiagnostics.failedResources.items[0];
  assert.equal(row.disposition, 'confirmed');
  assert.equal(row.kind, 'resource_failure');
});
