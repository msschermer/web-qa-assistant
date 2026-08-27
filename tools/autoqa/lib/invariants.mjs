/**
 * Deterministic AutoQA invariants (Layer A).
 * Hard failures require no AI judgment.
 */

export function evaluateInvariants(report = {}, options = {}) {
  const hardFailures = [];
  const warnings = [];
  const la = report.linkAudit || {};
  const coverage = report.coverage || {};
  const frankReview = report.frankReview || options.frankReview || {};
  const guidanceSource = report.guidanceSource || options.guidanceSource;

  const eligible = Number(la.eligible ?? la.discovered ?? 0);
  const attempted = Number(la.attempted ?? la.checked ?? 0);
  const unprobed = Number(la.unprobed ?? 0);
  const skipped = Number(la.explicitlySkipped ?? 0);
  if (eligible > 0) {
    const sum = attempted + unprobed + skipped;
    // Allow small accounting slack only when scannerAborted/degraded flagged.
    if (sum !== eligible && !la.scannerAborted && !la.degraded) {
      hardFailures.push({
        id: 'link-accounting-reconcile',
        detail: `eligible=${eligible} attempted+unprobed+skipped=${sum}`
      });
    }
  }

  const healthy = Number(la.verifiedHealthy ?? 0);
  const broken = Number(la.confirmedIssues ?? 0);
  const inconclusive = Number(la.inconclusive ?? 0);
  if (attempted > 0 && healthy + broken + inconclusive > attempted + 2) {
    hardFailures.push({
      id: 'link-terminal-reconcile',
      detail: `healthy+broken+inconclusive exceeds attempted (${healthy}+${broken}+${inconclusive} > ${attempted})`
    });
  }

  if (coverage.links === 'partial' && unprobed === 0 && !la.probeBudgetPreventedCoverage && !la.reachedLimit) {
    warnings.push({
      id: 'suspicious-partial-links',
      detail: 'coverage.links is partial but unprobed is 0'
    });
  }

  if (frankReview.modelReadiness === 'ready' && frankReview.completed !== true && guidanceSource === 'frank-model') {
    hardFailures.push({
      id: 'readiness-vs-review',
      detail: 'guidanceSource frank-model without completed frankReview'
    });
  }

  if (guidanceSource === 'frank-model' && frankReview.completed === true && frankReview.source && frankReview.source !== 'frank-model') {
    hardFailures.push({
      id: 'guidance-source-mismatch',
      detail: `guidanceSource=${guidanceSource} frankReview.source=${frankReview.source}`
    });
  }

  const findings = report.findings || [];
  for (const f of findings.slice(0, 200)) {
    if (f.confidence === 'confirmed' && /unavailable|not-checked|unable/i.test(String(f.detail || ''))) {
      warnings.push({
        id: 'confirmed-from-unavailable-language',
        ruleId: f.ruleId,
        detail: 'confirmed finding detail mentions unavailable evidence'
      });
    }
  }

  const published = report.publishedCoverage || report.environment?.publishedCoverage;
  const indexability = report.environment?.indexability || report.page?.indexability;
  if (published?.status === 'unavailable' && indexability?.assessment === 'indexable' && /published/i.test(String(indexability?.reason || ''))) {
    hardFailures.push({
      id: 'published-unavailable-vs-indexable',
      detail: 'indexability claims published indexable while publishedCoverage unavailable'
    });
  }

  const groupsOmitted = Number(report.attention?.groupsOmitted ?? 0);
  if (groupsOmitted > 0 && options.expectNoOmittedGroups) {
    hardFailures.push({
      id: 'groups-omitted',
      detail: `groupsOmitted=${groupsOmitted}`
    });
  }

  if (options.highlight) {
    const h = options.highlight;
    if (h.claimedSuccess && (h.targetStatus === 'stale' || h.fingerprintMatch === false)) {
      hardFailures.push({
        id: 'stale-highlight-success',
        detail: 'Highlight claimed success with stale/mismatched target'
      });
    }
  }

  if (options.orphanOverlay === true) {
    hardFailures.push({
      id: 'orphan-webqa-overlay',
      detail: 'Residual Web QA page overlay detected after walkthrough end'
    });
  }

  return {
    ok: hardFailures.length === 0,
    hardFailures,
    warnings,
    checkedAt: new Date().toISOString()
  };
}
