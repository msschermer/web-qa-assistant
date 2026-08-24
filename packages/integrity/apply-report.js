import {
  assessTargetIntegrity,
  adjustCoverageForTargetIntegrity,
  suppressFindingsForTargetIntegrity,
  targetIntegrityBlocksAudit,
  targetIntegrityBrief,
  targetIntegrityLimitsAudit,
  targetIntegrityReached
} from './target-integrity.js';

export function assessReportTargetIntegrity(report = {}, options = {}) {
  const page = report.page || {};
  const html = options.html || page.documentHtmlSample || '';
  if (page.targetIntegrity?.state && !html) return page.targetIntegrity;
  return assessTargetIntegrity({
    requestedUrl: options.requestedUrl || page.requestedUrl || page.url,
    finalUrl: page.finalUrl || page.url,
    title: page.title,
    httpStatus: page.httpStatus,
    linkCount: page.linkCount,
    interactiveCount: page.interactiveCount,
    html: options.html || page.documentHtmlSample || '',
    bodyText: options.bodyText || ''
  });
}

export function attachTargetIntegrity(report = {}, options = {}) {
  if (!report?.page) return report;
  const integrity = assessReportTargetIntegrity(report, options);
  return {
    ...report,
    page: {
      ...report.page,
      targetIntegrity: integrity,
      requestedUrl: options.requestedUrl || report.page.requestedUrl || report.page.url
    }
  };
}

export function finalizeBlockedTargetReport(report = {}, findings = []) {
  const integrity = report.page?.targetIntegrity;
  const coverage = adjustCoverageForTargetIntegrity(report.coverage || {}, report.linkAudit || null, integrity);
  if (!targetIntegrityLimitsAudit(integrity)) {
    return { ...report, coverage, findings };
  }
  return {
    ...report,
    findings: suppressFindingsForTargetIntegrity(findings, integrity),
    linkAudit: targetIntegrityBlocksAudit(integrity) ? {
      checked: 0,
      verifiedHealthy: 0,
      confirmedIssues: 0,
      inconclusive: 0,
      incompleteChecks: [],
      reachedLimit: false,
      skippedReason: 'target-not-reached'
    } : report.linkAudit,
    coverage,
    priorityBrief: targetIntegrityBrief(integrity),
    priorityMode: 'deterministic',
    targetIntegrityBlocked: true
  };
}

export function applyTargetIntegrityReport(report = {}, options = {}) {
  const attached = attachTargetIntegrity(report, options);
  return finalizeBlockedTargetReport(attached, attached.findings || []);
}

export { targetIntegrityBrief, targetIntegrityReached, assessTargetIntegrity };
