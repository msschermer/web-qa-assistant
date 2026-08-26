/**
 * Compact dogfood / internal-beta evaluation projection.
 * Records reliability and recommendation-quality signals without expanding crawl scope.
 */
import { classifyEnvironment } from '../environment/classify.js';
import { composeReportAttention, correlate, deterministicBrief } from './correlate.js';
import { applyFindingPolicy } from './policy.js';
import { buildCoverageAccounting } from './coverage.js';
import { buildEvidenceLedger } from './evidence-ledger.js';
import { resultReadyFromReport } from './scan-lifecycle.js';

export const BENCHMARK_EVAL_VERSION = 1;

const ROOT_CAUSES = Object.freeze({
  FATAL_SCAN: 'fatal-scan',
  RESULT_NOT_READY: 'result-not-ready',
  ACCOUNTING_INVALID: 'accounting-invalid',
  FRANK_LEDGER_INCOMPLETE: 'frank-ledger-incomplete',
  RECOMMENDATION_QUALITY: 'recommendation-quality',
  TIMING_BUDGET: 'timing-budget'
});

function clip(value, n = 240) {
  const s = String(value ?? '').replace(/\s+/g, ' ').trim();
  if (!n) return '';
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
}

function compactAttention(attention = {}) {
  return {
    groups: (attention.groups || []).map((g) => ({
      key: g.key,
      impactClass: g.impactClass,
      title: g.title,
      size: g.size,
      instanceCount: g.instanceCount,
      ruleId: g.lead?.ruleId || g.ruleId || ''
    })),
    materialGroupCount: Number(attention.materialGroupCount || 0),
    materialFindingCount: Number(attention.materialFindingCount || 0),
    allGroupCount: Number((attention.allGroups || []).length || attention.materialGroupCount || 0),
    representedClasses: [...(attention.representedClasses || [])],
    classCounts: { ...(attention.classCounts || {}) },
    uiLimit: 8
  };
}

export function finalizeBenchmarkReport(raw = {}) {
  const correlated = correlate(raw, {});
  const environment = classifyEnvironment(raw.page || {}, {
    canonical: raw.page?.canonical,
    monitored: false
  });
  const findings = applyFindingPolicy(correlated, environment);
  const report = {
    ...raw,
    findings,
    environment,
    page: { ...(raw.page || {}), environment }
  };
  const attention = composeReportAttention(findings, { limit: 8 });
  const brief = deterministicBrief(findings, {
    coverage: report.coverage,
    linkAudit: report.linkAudit,
    targetIntegrity: report.page?.targetIntegrity
  });
  const coverage = { ...(report.coverage || {}), ai: 'deterministic' };
  return {
    ...report,
    coverage,
    attention: compactAttention(attention),
    evidenceLedger: buildEvidenceLedger(
      { ...report, coverage },
      { uiLimit: 8, composition: attention, findings }
    ),
    priorityBrief: typeof brief === 'string' ? brief : String(brief?.text || ''),
    priorityMode: 'deterministic'
  };
}

function inventoryCounts(report = {}) {
  const inv = report.page?.inventory || {};
  return {
    links: Number(inv.links || 0),
    uniqueLinks: Number(inv.uniqueLinks || 0),
    images: Number(inv.images || 0),
    iframes: Number(inv.iframes || 0),
    sameOriginFrames: Number(inv.sameOriginFrames || 0),
    crossOriginFrames: Number(inv.crossOriginFrames || 0),
    forms: Number(inv.forms || 0),
    buttons: Number(inv.buttons || 0),
    disclosures: Number(inv.disclosures || 0),
    headings: Number(inv.headings || 0),
    landmarks: Number(inv.landmarks || 0),
    interactiveCandidates: Number(inv.interactiveCandidates || 0)
  };
}

function linkCompletion(accounting = null, report = {}) {
  const links = accounting?.links || {};
  return {
    status: String(report.coverage?.links || ''),
    discovered: Number(links.discovered || report.linkAudit?.discovered || 0),
    eligible: Number(links.eligible || 0),
    attempted: Number(links.attempted || 0),
    verifiedHealthy: Number(links.verifiedHealthy || 0),
    confirmedIssues: Number(links.confirmedBroken ?? links.confirmedIssues ?? 0),
    inconclusive: Number(links.inconclusive || 0),
    unprobed: Number(links.unprobed || 0),
    explicitlySkipped: Number(links.explicitlySkipped || 0),
    scannerAborted: Number(links.scannerAborted || 0),
    pending: Math.max(0, Number(links.eligible || 0) - Number(links.attempted || 0) - Number(links.unprobed || 0) - Number(links.explicitlySkipped || 0)),
    accountingOk: links.accountingOk !== false,
    probeBudgetPreventedCoverage: Boolean(links.probeBudgetPreventedCoverage)
  };
}

function frameCompletion(accounting = null, report = {}) {
  const frames = accounting?.iframes || {};
  const embed = report.page?.embeddedCoverage || {};
  return {
    disclosures: String(
      report.interactionCoverage?.iframeDisclosures
      || report.coverage?.iframeDisclosures
      || embed.iframeDisclosures
      || ''
    ),
    framesDiscovered: Number(frames.framesDiscovered || 0),
    sameOriginEligible: Number(frames.sameOriginEligible || 0),
    sameOriginChecked: Number(frames.sameOriginChecked || 0),
    sameOriginUnprobed: Number(frames.sameOriginUnprobed || 0),
    crossOriginNotInspectable: Number(frames.crossOriginNotInspectable || 0),
    accountingOk: frames.accountingOk !== false,
    frameBudgetPreventedCoverage: Boolean(frames.frameBudgetPreventedCoverage)
  };
}

function frankRepresentation(report = {}) {
  const ledger = report.evidenceLedger || {};
  const attention = report.attention || {};
  const uiClasses = [...new Set((attention.groups || []).map((g) => g.impactClass).filter(Boolean))];
  const ledgerClasses = [...(ledger.representedClasses || attention.representedClasses || [])];
  const ledgerGroupCount = Array.isArray(ledger.groups) ? ledger.groups.length : 0;
  const allGroupCount = Number(
    attention.allGroupCount
    ?? ledger.materialGroupCount
    ?? attention.materialGroupCount
    ?? ledgerGroupCount
  );
  const declaredOmitted = Number(ledger.groupsOmitted ?? ledger.compression?.groupsOmitted ?? 0);
  return {
    groupsOmitted: Math.max(0, allGroupCount - ledgerGroupCount, declaredOmitted),
    truncated: Boolean(ledger.truncated) || allGroupCount > ledgerGroupCount,
    detailTier: ledger.compression?.detailTier || '',
    uiShown: Number(ledger.uiShown ?? attention.groups?.length ?? 0),
    uiLimit: Number(ledger.uiLimit || attention.uiLimit || 8),
    materialGroupCount: Number(ledger.materialGroupCount ?? attention.materialGroupCount ?? ledgerGroupCount),
    materialFindingCount: Number(ledger.materialFindingCount ?? attention.materialFindingCount ?? 0),
    ledgerGroupCount,
    allGroupCount,
    uiClasses,
    ledgerClasses,
    classCounts: { ...(ledger.classCounts || attention.classCounts || {}) }
  };
}

function scanComplete(report, fatal) {
  if (fatal || !report) return false;
  const links = String(report.coverage?.links || '');
  if (!Array.isArray(report.findings) || !report.linkAudit || !links || links === 'pending' || /unavailable/i.test(links)) {
    return false;
  }
  const uniqueInventory = Number(report.page?.inventory?.uniqueLinks || 0);
  const attempted = Number(report.linkAudit?.attempted ?? report.linkAudit?.checked ?? 0);
  if (/none[_ -]?checked/i.test(links) && uniqueInventory > 0 && attempted === 0) return false;
  return true;
}

export function classifyFailureRootCause(code = '') {
  switch (String(code)) {
    case 'fatal_error':
    case 'scan_http_error':
      return ROOT_CAUSES.FATAL_SCAN;
    case 'timeout':
      return ROOT_CAUSES.TIMING_BUDGET;
    case 'result_not_ready':
    case 'scan_incomplete':
      return ROOT_CAUSES.RESULT_NOT_READY;
    case 'accounting_invalid':
      return ROOT_CAUSES.ACCOUNTING_INVALID;
    case 'frank_groups_omitted':
    case 'frank_truncated':
    case 'frank_ui_exceeds_ledger':
      return ROOT_CAUSES.FRANK_LEDGER_INCOMPLETE;
    case 'recommendation_skew':
    case 'recommendation_empty':
      return ROOT_CAUSES.RECOMMENDATION_QUALITY;
    default:
      return ROOT_CAUSES.FATAL_SCAN;
  }
}

export function summarizeBenchmarkPage(report = null, meta = {}) {
  const fatal = meta.fatal ? {
    message: clip(meta.fatal.message || meta.fatal, 240),
    code: meta.fatal.code || 'fatal_error'
  } : null;
  const accounting = report ? buildCoverageAccounting(report) : null;
  const ready = resultReadyFromReport(report, { fatal: Boolean(fatal) });
  const frank = frankRepresentation(report || {});
  const complete = scanComplete(report, fatal);
  const failures = [];

  if (fatal) {
    failures.push({
      code: fatal.code === 'timeout' ? 'timeout' : 'fatal_error',
      detail: fatal.message
    });
  }
  if (!complete) {
    failures.push({
      code: 'scan_incomplete',
      detail: fatal ? 'Scan did not produce a complete report.' : 'Findings, link audit, or link coverage is missing or still pending.'
    });
  }
  if (!ready) {
    failures.push({
      code: 'result_not_ready',
      detail: 'Atomic result-ready flags are incomplete (collection, primary verification, ledger, correlation, or Frank brief).'
    });
  }
  if (accounting && accounting.accountingOk === false) {
    const bad = [];
    if (accounting.links?.accountingOk === false) bad.push('links');
    if (accounting.iframes?.accountingOk === false) bad.push('iframes');
    if (accounting.interactions?.accountingOk === false) bad.push('interactions');
    failures.push({
      code: 'accounting_invalid',
      detail: `Coverage accounting failed for ${bad.join(', ') || 'unknown area'}.`
    });
  }
  if (frank.groupsOmitted > 0) {
    failures.push({
      code: 'frank_groups_omitted',
      detail: `Frank ledger omitted ${frank.groupsOmitted} material groups.`
    });
  }
  if (frank.truncated) {
    failures.push({
      code: 'frank_truncated',
      detail: 'Frank ledger marked truncated.'
    });
  }
  if (frank.uiShown > frank.materialGroupCount && frank.materialGroupCount >= 0) {
    failures.push({
      code: 'frank_ui_exceeds_ledger',
      detail: `UI showed ${frank.uiShown} groups while the ledger has ${frank.materialGroupCount}.`
    });
  }
  if (frank.materialGroupCount > 0 && frank.uiShown === 0) {
    failures.push({
      code: 'recommendation_empty',
      detail: 'Material groups exist but Recommended Order is empty.'
    });
  }
  if (frank.ledgerClasses.length >= 3 && frank.uiClasses.length === 1 && frank.uiShown >= 3) {
    failures.push({
      code: 'recommendation_skew',
      detail: `Recommended Order is only ${frank.uiClasses[0]} while the ledger represents ${frank.ledgerClasses.join(', ')}.`
    });
  }

  const elapsedMs = Number(meta.elapsedMs || 0);
  const maxMs = Number(meta.maxElapsedMs || 0);
  if (!fatal && maxMs > 0 && elapsedMs > maxMs) {
    failures.push({
      code: 'timeout',
      detail: `Scan finished in ${elapsedMs}ms, above the ${maxMs}ms evaluation budget.`
    });
  }

  const uniqueFailures = [];
  const seen = new Set();
  for (const row of failures) {
    if (seen.has(row.code)) continue;
    seen.add(row.code);
    uniqueFailures.push({ ...row, rootCause: classifyFailureRootCause(row.code) });
  }

  return {
    evalVersion: BENCHMARK_EVAL_VERSION,
    id: meta.id || '',
    profile: meta.profile || '',
    url: meta.url || report?.page?.url || report?.page?.requestedUrl || '',
    live: Boolean(meta.live),
    scanComplete: complete,
    resultReady: ready,
    accountingOk: accounting ? accounting.accountingOk !== false : false,
    degradedAreas: accounting?.degradedAreas || [],
    scopeLimitedAreas: accounting?.scopeLimitedAreas || [],
    inventory: inventoryCounts(report || {}),
    links: linkCompletion(accounting, report || {}),
    frames: frameCompletion(accounting, report || {}),
    scanTimings: {
      elapsedMs,
      discoveryMs: Number(report?.scanTimings?.discoveryMs || 0),
      axeMs: Number(report?.scanTimings?.axeMs || 0),
      linkProbeMs: Number(report?.scanTimings?.linkProbeMs || report?.linkAudit?.primaryLinkMs || 0),
      frameInspectionMs: Number(report?.scanTimings?.frameInspectionMs || 0),
      interactionMs: Number(report?.scanTimings?.interactionMs || 0),
      performanceMs: Number(report?.scanTimings?.performanceMs || 0),
      totalMs: Number(report?.scanTimings?.totalMs || 0)
    },
    frank,
    findingCount: Array.isArray(report?.findings) ? report.findings.length : 0,
    priorityBrief: clip(report?.priorityBrief || '', 280),
    targetIntegrity: report?.page?.targetIntegrity?.state || report?.targetIntegrity?.state || '',
    fatal,
    failures: uniqueFailures
  };
}

export function aggregateBenchmark(rows = [], { buildRevision = '', startedAt = '', finishedAt = '' } = {}) {
  const byCause = {};
  for (const cause of Object.values(ROOT_CAUSES)) byCause[cause] = [];
  let failedPages = 0;
  for (const row of rows) {
    if (row.failures?.length) failedPages += 1;
    for (const failure of row.failures || []) {
      const cause = failure.rootCause || classifyFailureRootCause(failure.code);
      (byCause[cause] || (byCause[cause] = [])).push({
        id: row.id,
        url: row.url,
        code: failure.code,
        detail: failure.detail
      });
    }
  }
  return {
    evalVersion: BENCHMARK_EVAL_VERSION,
    buildRevision,
    startedAt,
    finishedAt,
    pageCount: rows.length,
    failedPageCount: failedPages,
    passedPageCount: rows.length - failedPages,
    failuresByRootCause: byCause,
    pages: rows
  };
}

export function resolveCorpusPages(corpus = {}, { origin = '', includeLive = false } = {}) {
  const pages = Array.isArray(corpus.pages) ? corpus.pages : [];
  const base = String(origin || '').replace(/\/$/, '');
  return pages
    .filter((page) => includeLive || !page.live)
    .map((page) => {
      const live = Boolean(page.live);
      const url = live
        ? String(page.url || '')
        : `${base}${page.path || page.url || ''}`;
      return {
        id: String(page.id || ''),
        profile: String(page.profile || ''),
        live,
        url,
        maxElapsedMs: Number(page.maxElapsedMs || corpus.defaultMaxElapsedMs || 180000)
      };
    })
    .filter((page) => /^https?:\/\//i.test(page.url));
}

export { ROOT_CAUSES };
