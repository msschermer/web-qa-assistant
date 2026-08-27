import { sanitizeUrlOriginPath } from './evidence-contract.js';
import { explainCoverageReasons, buildCoverageAccounting, classifyCoverageReason, COVERAGE_CLASS } from './coverage.js';
import { compactFrankPageLedger } from './evidence-ledger.js';
import { scanGuidanceSource } from './review-state.js';

export const BUG_REPORT_SCHEMA_V1 = 'web-qa-assistant-bug-report/v1';
export const BUG_REPORT_SCHEMA_V2 = 'web-qa-assistant-bug-report/v2';
export const DIAGNOSTIC_KIND = 'report-bug-diagnostic';
export const DIAGNOSTIC_SECTIONS = Object.freeze([
  'index', 'scan', 'environment', 'coverage', 'findings', 'performance',
  'links', 'pageDiagnostics', 'webqaDiagnostics', 'frank', 'timeline'
]);
export const DIAGNOSTIC_CAPS = Object.freeze({
  timeline: 80,
  pageErrors: 25,
  webqaErrors: 25,
  failedResources: 25,
  findings: 40,
  links: 20,
  evidence: 24,
  string: 420,
  artifactBytes: 400_000
});

const DROP_KEY = /(cookie|password|secret|credential|authorization|api[-_]?key|access[-_]?key|token|form[-_]?value|raw[-_]?dom|html|selector|localstorage|sessionstorage)/i;
const PAGE_TEXT_KEY = /(page[-_]?text|target[-_]?text|model[-_]?output|prompt|completion)/i;
const SAFE_CONTEXT_KINDS = new Set(['contrast-ratio','contrast-required','foreground-color','background-color','font-size','font-weight','target-width','target-height','target-minimum','target-spacing','target-spacing-required','http-status','link-occurrences','environment','confidence','verification-method','mobile-score','desktop-score','threshold','mobile-change','desktop-change','lcp','ttfb','transfer-bytes','transfer-count']);
const TRACE_KEYS = new Set(['status','progress','code','fromUserGesture','priorStatus','name','ruleId','impactClass','confidence','provider','mode','stepCount','hasTab','findingCount','materialGroupCount','representedClasses','connectedMode','includeContext','reachable','auth','problems','scanId','stage','kind','recoverable','coverageImpact','seq','operation','diagnosticId','durationMs','area','reason','initiator']);
const TRACE_IGNORE = /^(frank-readiness|local-ai:readiness)$/;
const HIGH_SIGNAL_TRACE = new Set([
  'scan-start','scan_started','scan-complete','scan_completed','scan-enrichment-failed','scan-failed',
  'sidepanel-render-failed','hydration-stale-build','gateway-test-start','gateway-test-complete','frank-request','frank-reasoning','frank-started',
  'frank_review_requested','frank_review_started','frank_review_completed','frank_review_fallback',
  'local-ai:session-create-failed','local-ai:prompt-rejected','local-ai:prompt-accepted','local-ai:prompt-start'
]);
const PAGE_ERROR_RULES = new Set(['runtime.uncaught-error', 'runtime.visible-error']);
const RESOURCE_RULES = new Set([
  'runtime.script-failed','web.stylesheet-failed','web.image-broken','runtime.font-failed','runtime.resource-failed',
  'runtime.resource-failed-cross-origin','ux.embed-resource-failed'
]);
const CANNED_FALLBACK = {
  LOCAL_AI_REMEDIATION_DRIFT: 'The on-device remediation changed the type of fix instead of improving the verified recommendation.',
  LOCAL_AI_UNAVAILABLE: 'On-device reasoning was not available, so verified guidance was used.',
  LOCAL_AI_THIN_GUIDANCE: 'The on-device response was too generic to trust.',
  LOCAL_AI_GENERIC_GUIDANCE: 'The on-device response was too generic to improve the verified guidance.',
  LOCAL_AI_INVALID_JSON: 'The on-device model did not return the expected structured guidance.',
  LOCAL_AI_FAILED: 'On-device reasoning did not complete.',
  USER_CHOSE_VERIFIED: 'Verified guidance was used by request.',
  INVALID_GATEWAY_PLAN: 'The cloud fallback returned a walkthrough that did not pass local validation.',
  GATEWAY_FRANK_FAILED: 'Cloud reasoning could not be reached.',
  PRIVATE_PAGE: 'Cloud AI is disabled for private pages.'
};

function clip(v, max = DIAGNOSTIC_CAPS.string) {
  const s = String(v ?? '').replace(/\s+/g, ' ').trim();
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

function diagnosticUrl(value) {
  const raw = String(value ?? '').trim();
  if (!raw) return '';
  if (/^(chrome-extension|moz-extension|safari-extension|file|data|javascript|blob):/i.test(raw)) return '';
  if (/^[A-Za-z]:\\/.test(raw) || /^\\\\/.test(raw) || /^\/(?:Users|home|root)\//.test(raw)) return '[path]';
  try {
    const url = new URL(raw);
    if (!/^https?:$/.test(url.protocol)) return '';
    return sanitizeUrlOriginPath(raw);
  } catch {
    return '';
  }
}

export function redactText(value, max = DIAGNOSTIC_CAPS.string) {
  let s = clip(value, max);
  s = s.replace(/https?:\/\/[^\s"'<>]+/gi, m => diagnosticUrl(m) || '[url]');
  s = s.replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, '[email]');
  s = s.replace(/\b(?:\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]\d{3}[-.\s]\d{4}\b/g, '[phone]');
  s = s.replace(/\bBearer\s+[A-Za-z0-9._~+/=-]{10,}\b/gi, 'Bearer [credential]');
  s = s.replace(/\b(?:sk|pk|key|token)[-_][A-Za-z0-9_-]{12,}\b/gi, '[credential]');
  s = s.replace(/\b(?:AIza[A-Za-z0-9_-]{20,}|ghp_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|xox[baprs]-[A-Za-z0-9-]{12,}|AKIA[A-Z0-9]{16})\b/g, '[credential]');
  s = s.replace(/\b[A-Za-z]:\\[^\s"'<>]+/g, '[path]');
  s = s.replace(/\/(?:Users|home|root)\/[^\s"'<>]+/g, '[path]');
  return s;
}

function sanitize(value, { includePageText = false, depth = 0, maxArray = 30 } = {}) {
  if (value == null || typeof value === 'boolean' || typeof value === 'number') return value;
  if (typeof value === 'string') return redactText(value);
  if (depth > 5) return '[truncated]';
  if (Array.isArray(value)) return value.slice(0, maxArray).map(v => sanitize(v, { includePageText, depth: depth + 1, maxArray }));
  if (typeof value === 'object') {
    const out = {};
    for (const [key, val] of Object.entries(value)) {
      if (DROP_KEY.test(key)) continue;
      if (!includePageText && PAGE_TEXT_KEY.test(key)) continue;
      out[key] = sanitize(val, { includePageText, depth: depth + 1, maxArray });
    }
    return out;
  }
  return redactText(value);
}

function sanitizeTraceData(data = {}) {
  const out = {};
  for (const [key, value] of Object.entries(data || {})) {
    if (!TRACE_KEYS.has(key)) continue;
    out[key] = sanitize(value);
  }
  return out;
}

export class RuntimeTrace {
  constructor({ limit = 180, clock = () => new Date().toISOString() } = {}) {
    this.limit = limit;
    this.clock = clock;
    this.events = [];
    this.seq = 0;
  }
  record(type, data = {}) {
    if (TRACE_IGNORE.test(String(type || ''))) return;
    this.seq += 1;
    this.events.push({ seq: this.seq, at: this.clock(), type: clip(type, 80), data: sanitizeTraceData(data) });
    if (this.events.length > this.limit) this.events.splice(0, this.events.length - this.limit);
  }
  snapshot() {
    return this.events.map(e => (globalThis.structuredClone ? globalThis.structuredClone(e) : JSON.parse(JSON.stringify(e))));
  }
  clear() { this.events = []; this.seq = 0; }
}

function chromeVersion(ua = '') {
  const m = String(ua).match(/(?:Chrome|Chromium)\/(\d+(?:\.\d+){0,3})/);
  return m?.[1] || 'unknown';
}

function boundList(items, cap) {
  const list = Array.isArray(items) ? items : [];
  const shown = Math.min(list.length, cap);
  return { items: list.slice(0, cap), shown, total: list.length, truncated: list.length > cap };
}

function boundListTail(items, cap) {
  const list = Array.isArray(items) ? items : [];
  const itemsOut = list.length > cap ? list.slice(list.length - cap) : list;
  return { items: itemsOut, shown: itemsOut.length, total: list.length, truncated: list.length > cap };
}

function asBound(section) {
  if (!section || typeof section !== 'object') return { shown: 0, total: 0, truncated: false };
  return { shown: Number(section.shown || 0), total: Number(section.total || 0), truncated: Boolean(section.truncated) };
}

function findingById(report, id) {
  return (report?.findings || []).find(f => f.id === id) || null;
}

export function remediationFamilyId(ruleId = '') {
  const id = String(ruleId || '');
  if (/color-contrast/.test(id)) return 'color-contrast';
  if (/target-size/.test(id)) return 'target-size';
  if (/(?:label|button-name|link-name|aria.*name|input.*name)/.test(id)) return 'accessible-name';
  if (/image-alt|role-img|input-image|object-alt|area-alt/.test(id)) return 'image-alt';
  if (/broken-link|link-404|link-410|link-5xx/.test(id)) return 'broken-link';
  if (/link-redirect-error/.test(id)) return 'redirect';
  if (/noindex|robots/.test(id)) return 'seo-index';
  if (/canonical/.test(id)) return 'canonical';
  if (id === 'performance.browser.lcp') return 'lcp';
  if (id === 'performance.browser.cls') return 'cls';
  if (id === 'performance.browser.ttfb') return 'ttfb';
  if (id === 'performance.browser.weight') return 'weight';
  if (/ux\.inert-link/.test(id)) return 'inert-link';
  if (/ux\.form-no-submit/.test(id)) return 'form-submit';
  if (/web\.horizontal-overflow|correlation\.viewport-overflow/.test(id)) return 'overflow';
  if (/runtime\.uncaught-error|runtime\.script-failed/.test(id)) return 'runtime-script';
  if (/blank-opener/.test(id)) return 'blank-opener';
  if (/meta-refresh/.test(id)) return 'meta-refresh';
  if (/charset/.test(id)) return 'charset';
  return 'generic';
}

function integrityState(report = {}) {
  const raw = report?.page?.targetIntegrity;
  if (raw && typeof raw === 'object') return clip(raw.state, 40);
  return clip(raw, 40);
}

function scanStatusFor({ report, lastScanAttempt, lastDiagnostic }) {
  if (!report) return lastDiagnostic ? 'failed' : 'none';
  const integrity = integrityState(report);
  if (report.targetIntegrityBlocked || integrity === 'blocked') return 'blocked';
  if (lastScanAttempt && lastScanAttempt.ok === false && lastScanAttempt.scanId && lastScanAttempt.scanId !== report.scanId) return 'stale-report';
  if (integrity === 'probable_interstitial' || integrity === 'inconclusive') return 'partial';
  return 'reached';
}

function extrasFromFailure(lastDiagnostic = null, lastScanAttempt = null) {
  const op = String(lastDiagnostic?.operation || '');
  const msg = String(lastDiagnostic?.id || '');
  const failed = lastScanAttempt?.ok === false || /ENRICH|CONTEXT/i.test(op);
  const timeout = /timeout/i.test(op) || /TIMEOUT/i.test(msg);
  return {
    enrichmentFailed: failed && /ENRICH|CONTEXT/i.test(op),
    rendererTimeout: timeout && /RENDER|PERF|SCAN/i.test(op)
  };
}

function projectFindingMeta(f = {}, includeContext = false) {
  const row = {
    ruleId: clip(f.ruleId, 160),
    impactClass: clip(f.impactClass, 50),
    category: clip(f.category, 40),
    severity: clip(f.severity, 30),
    confidence: clip(f.confidence, 30),
    targetability: clip(f.targetability, 40),
    scope: clip(f.scope, 40),
    frankPriority: clip(f.frankPriority, 30)
  };
  if (includeContext) row.title = redactText(f.title, 160);
  return row;
}

function projectFindings(report, includeContext) {
  if (!report) return { recommendedOrder: boundList([], 0), worthCheckingFurther: boundList([], 0), byArea: {} };
  const groups = report.attention?.groups || [];
  const recommended = groups.map(g => {
    const lead = findingById(report, g.leadId) || {};
    return {
      impactClass: clip(g.impactClass || lead.impactClass, 50),
      size: Number(g.size || 0),
      leadRuleId: clip(lead.ruleId, 160),
      confidence: clip(lead.confidence, 30),
      targetability: clip(g.targetability || lead.targetability, 40),
      ...(includeContext ? { title: redactText(g.title || lead.title, 160) } : {})
    };
  });
  const worth = (report.attention?.worthChecking || []).map(w => ({
    lens: clip(w.lens, 40),
    scope: clip(w.scope, 40),
    size: Number(w.size || 0),
    ...(includeContext ? { title: redactText(w.title, 160) } : {})
  }));
  const byArea = {};
  for (const f of report.findings || []) {
    const area = clip(f.impactClass || 'implementation', 50);
    byArea[area] = (byArea[area] || 0) + 1;
  }
  return {
    recommendedOrder: boundList(recommended, DIAGNOSTIC_CAPS.findings),
    worthCheckingFurther: boundList(worth, DIAGNOSTIC_CAPS.findings),
    byArea,
    findingCount: (report.findings || []).length,
    materialGroupCount: Number(report.attention?.materialGroupCount || 0),
    targets: (() => {
      const rows = report.findings || [];
      const visual = rows.filter(f => f.targetType === 'visual');
      const valid = visual.filter(f => f.targetId && f.target?.status !== 'stale').length;
      const stale = visual.filter(f => f.target?.status === 'stale' || (f.targetType === 'visual' && !f.targetId)).length;
      return { instanceCount: visual.length, validTargets: valid, staleTargets: stale };
    })()
  };
}

function projectPerformance(report) {
  const perf = report?.browserPerformance || report?.page?.browserPerformance || {};
  const labReady = perf.available === true && (
    Number.isFinite(perf.largestContentfulPaintMs)
    || Number.isFinite(perf.ttfbMs)
    || Number.isFinite(perf.transferBytes)
  );
  const labCoverage = labReady ? 'available' : (perf.available === true ? 'partial' : 'unavailable');
  const monitorReason = clip(report?.coverageReasons?.performance, 60);
  const ctxPerf = report?.context?.performance?.data
    || report?.context?.services?.performance?.data
    || report?.context?.performance
    || report?.performanceMonitor;
  const monitorFromEvidence = ctxPerf?.monitored === true
    || ctxPerf?.available === true
    || (Array.isArray(report?.findings) && report.findings.some(f => /^performance\.(mobile|desktop)(-|$)/.test(String(f.ruleId || ''))));
  const historical = monitorFromEvidence
    ? 'available'
    : (/connector|not monitored|enrichment|unavailable/i.test(String(report?.coverage?.performance || '') + String(monitorReason || ''))
      || String(report?.coverage?.performance || '') === 'not monitored'
      || String(report?.coverage?.performance || '') === 'current-page'
      || String(report?.coverage?.performance || '') === 'partial'
      || String(report?.coverage?.performance || '') === 'local-only'
      ? 'unavailable'
      : (String(report?.coverage?.performance || '') === 'complete' ? 'available' : 'unavailable'));
  return {
    observationScope: 'current-page-lab',
    available: perf.available === true,
    lab: {
      coverage: labCoverage,
      fcpMs: Number.isFinite(perf.firstContentfulPaintMs) ? perf.firstContentfulPaintMs : undefined,
      lcpMs: Number.isFinite(perf.largestContentfulPaintMs) ? perf.largestContentfulPaintMs : undefined,
      ttfbMs: Number.isFinite(perf.ttfbMs) ? perf.ttfbMs : undefined,
      pageLoadMs: Number.isFinite(perf.pageLoadMs) ? perf.pageLoadMs : (Number.isFinite(perf.loadMs) ? perf.loadMs : undefined),
      cls: Number.isFinite(perf.cumulativeLayoutShift) ? perf.cumulativeLayoutShift : undefined,
      transferBytes: Number.isFinite(perf.transferBytes) ? perf.transferBytes : undefined,
      transferCount: Number.isFinite(perf.measuredTransferCount) ? perf.measuredTransferCount : undefined,
      resourceCount: Number.isFinite(perf.resourceCount) ? perf.resourceCount : undefined
    },
    assessment: report?.performanceAssessment ? {
      status: clip(report.performanceAssessment.status, 40) || undefined,
      summary: clip(report.performanceAssessment.summary, 240) || undefined,
      ttfbPresentation: clip(report.performanceAssessment.ttfbPresentation, 40) || undefined,
      imageDelivery: report.performanceAssessment.imageDelivery ? {
        assessment: clip(report.performanceAssessment.imageDelivery.assessment, 40) || undefined,
        oversizedCount: Number(report.performanceAssessment.imageDelivery.oversizedCount || 0) || undefined,
        timingCoverage: report.performanceAssessment.imageDelivery.timingCoverage || undefined
      } : undefined,
      actionableIssueCount: Array.isArray(report.performanceAssessment.actionableIssues) ? report.performanceAssessment.actionableIssues.length : undefined,
      diagnosticObservationCount: Array.isArray(report.performanceAssessment.diagnosticObservations) ? report.performanceAssessment.diagnosticObservations.length : undefined
    } : undefined,
    historicalMonitor: {
      coverage: historical,
      reason: monitorReason || (historical === 'unavailable' ? 'connector-unavailable' : undefined)
    },
    // Legacy flat fields retained for older readers.
    lcpMs: Number.isFinite(perf.largestContentfulPaintMs) ? perf.largestContentfulPaintMs : undefined,
    ttfbMs: Number.isFinite(perf.ttfbMs) ? perf.ttfbMs : undefined,
    cls: Number.isFinite(perf.cumulativeLayoutShift) ? perf.cumulativeLayoutShift : undefined,
    transferBytes: Number.isFinite(perf.transferBytes) ? perf.transferBytes : undefined,
    transferCount: Number.isFinite(perf.measuredTransferCount) ? perf.measuredTransferCount : undefined,
    resourceCount: Number.isFinite(perf.resourceCount) ? perf.resourceCount : undefined,
    coverage: labReady ? 'current-page' : clip(report?.coverage?.performance, 40),
    reason: monitorReason
  };
}

function projectPublishedCoverage(pc) {
  if (!pc || typeof pc !== 'object') return undefined;
  return {
    status: clip(pc.status, 40) || undefined,
    attempted: pc.attempted === true,
    source: clip(pc.source, 48) || undefined,
    reason: redactText(pc.reason, 180) || undefined,
    latencyMs: Number.isFinite(Number(pc.latencyMs)) ? Number(pc.latencyMs) : undefined
  };
}

function projectLinkExecution(ex) {
  if (!ex || typeof ex !== 'object') return undefined;
  return {
    uniqueUrls: Number(ex.uniqueUrls || 0) || undefined,
    targetOriginUrls: Number(ex.targetOriginUrls || 0) || undefined,
    relatedHostUrls: Number(ex.relatedHostUrls || 0) || undefined,
    externalUrls: Number(ex.externalUrls || 0) || undefined,
    primaryAttemptCount: Number(ex.primaryAttemptCount || 0) || undefined,
    refinementCount: Number(ex.refinementCount || 0) || undefined,
    cacheHits: Number(ex.cacheHits || 0) || undefined,
    cacheMisses: Number(ex.cacheMisses || 0) || undefined,
    primaryMs: Number(ex.primaryMs || 0) || undefined,
    refinementMs: Number(ex.refinementMs || 0) || undefined,
    queueTerminationReason: clip(ex.queueTerminationReason, 40) || undefined,
    targetConcurrency: ex.targetConcurrency ? {
      start: Number(ex.targetConcurrency.start || 0) || undefined,
      peak: Number(ex.targetConcurrency.peak || 0) || undefined,
      final: Number(ex.targetConcurrency.final || 0) || undefined
    } : undefined,
    externalPeakConcurrency: Number(ex.externalPeakConcurrency || 0) || undefined,
    methods: ex.methods && typeof ex.methods === 'object' ? {
      HEAD: Number(ex.methods.HEAD || 0) || undefined,
      GET: Number(ex.methods.GET || 0) || undefined
    } : undefined,
    perOrigin: Array.isArray(ex.perOrigin) ? ex.perOrigin.slice(0, 24).map(row => ({
      host: clip(row?.host, 80) || undefined,
      originClass: clip(row?.originClass, 20) || undefined,
      attempted: Number(row?.attempted || 0) || undefined,
      healthy: Number(row?.healthy || 0) || undefined,
      inconclusive: Number(row?.inconclusive || 0) || undefined
    })) : undefined
  };
}

function projectLinks(report) {
  const accounting = buildCoverageAccounting(report || {}).links;
  const unavailable = /unavailable/i.test(String(report?.coverage?.links || ''));
  const coverage = unavailable
    ? 'unavailable'
    : (accounting.probeBudgetPreventedCoverage ? 'partial' : 'complete');
  return {
    discovered: accounting.discovered,
    eligible: accounting.eligible,
    attempted: accounting.attempted,
    checked: accounting.attempted,
    verifiedHealthy: accounting.verifiedHealthy,
    confirmedBroken: accounting.confirmedBroken,
    inconclusive: accounting.inconclusive,
    unprobed: accounting.unprobed,
    explicitlySkipped: accounting.explicitlySkipped,
    scannerAborted: accounting.scannerAborted,
    inconclusiveByCause: accounting.inconclusiveByCause,
    probeBudgetReached: accounting.probeBudgetReached === true,
    probeBudgetPreventedCoverage: accounting.probeBudgetPreventedCoverage === true,
    privilegedProbe: clip(report?.linkAudit?.privilegedProbe, 40) || undefined,
    privilegedFallback: accounting.privilegedFallback || undefined,
    refinement: accounting.refinement || undefined,
    originBreakdown: report?.linkAudit?.linksByOriginClass || accounting.linksByOriginClass || undefined,
    hostDiagnostics: Array.isArray(report?.linkAudit?.hostDiagnostics) ? report.linkAudit.hostDiagnostics.slice(0, 8).map(row => ({
      host: clip(row.host, 120),
      originClass: clip(row.originClass, 20),
      jobs: Number(row.jobs || 0),
      completed: Number(row.completed || 0),
      timeouts: Number(row.timeouts || 0),
      status429: Number(row['429s'] || row.status429 || 0),
      status5xx: Number(row['5xx'] || row.status5xx || 0),
      networkFailures: Number(row.networkFailures || 0),
      averageDurationMs: Number(row.averageDurationMs || 0) || undefined,
      p95DurationMs: Number(row.p95DurationMs || 0) || undefined,
      maxConcurrencyObserved: Number(row.maxConcurrencyObserved || 0) || undefined
    })) : undefined,
    queueTerminationReason: clip(report?.linkAudit?.queueTerminationReason || report?.linkAudit?.queueMetrics?.terminationReason, 40) || undefined,
    queueMetrics: report?.linkAudit?.queueMetrics ? {
      maxGlobalInFlight: Number(report.linkAudit.queueMetrics.maxGlobalInFlight || 0) || undefined,
      maxTargetOriginInFlight: Number(report.linkAudit.queueMetrics.maxTargetOriginInFlight || 0) || undefined,
      maxExternalPerHostInFlight: Number(report.linkAudit.queueMetrics.maxExternalPerHostInFlight || 0) || undefined,
      completion: clip(report.linkAudit.queueMetrics.completion, 40) || undefined,
      terminationReason: clip(report.linkAudit.queueMetrics.terminationReason, 40) || undefined,
      emergencyFired: report.linkAudit.queueMetrics.emergencyFired === true
    } : undefined,
    coverage,
    reason: accounting.probeBudgetPreventedCoverage
      ? (clip(report?.coverageReasons?.links, 60) || 'probe-budget-exhausted')
      : undefined,
    accountingOk: accounting.accountingOk === true
  };
}

function projectPageDiagnostics(report, includeContext) {
  const errors = [];
  const resources = [];
  const expectedInconclusive = [];
  const securityBlocks = [];

  for (const e of report?.pageDiagnostics?.errors || []) {
    const row = {
      kind: 'page_error',
      subtype: e.kind === 'unhandled_rejection' ? 'unhandled_rejection' : 'error',
      source: diagnosticUrl(e.source),
      line: Number(e.line) || undefined
    };
    if (includeContext && e.message) row.message = redactText(e.message, 240);
    errors.push(row);
  }
  const seenResources = new Set();
  const pushResource = (row) => {
    const key = row.source || `${row.ruleId || ''}|${row.status || ''}|${row.initiator || ''}`;
    if (seenResources.has(key)) return;
    seenResources.add(key);
    resources.push(row);
  };
  for (const f of report?.findings || []) {
    if (PAGE_ERROR_RULES.has(f.ruleId) && !errors.length) {
      errors.push({
        kind: 'page_error',
        ruleId: f.ruleId,
        count: Number(f.runtimeErrorCount || f.count || 1)
      });
    }
    if (RESOURCE_RULES.has(f.ruleId)) {
      pushResource({
        kind: 'resource_failure',
        ruleId: f.ruleId,
        source: diagnosticUrl(f.resourceUrl || ''),
        ...(includeContext ? { detail: redactText(f.title, 120) } : {})
      });
    }
    if (f.confidence === 'inconclusive' && /link-review/.test(String(f.ruleId || ''))) {
      expectedInconclusive.push({ kind: 'expected_inconclusive', ruleId: clip(f.ruleId, 160), confidence: 'inconclusive' });
    }
  }
  for (const row of report?.diagnostics?.failedResources || report?.pageDiagnostics?.failedResources || []) {
    const disposition = clip(row.disposition, 40) || undefined;
    pushResource({
      kind: disposition === 'confirmed' ? 'resource_failure' : (clip(row.kind, 40) || 'resource_anomaly'),
      initiator: clip(row.initiator, 40),
      status: Number(row.status) || undefined,
      source: diagnosticUrl(row.source || row.url),
      sameOrigin: row.sameOrigin === true,
      originClass: clip(row.originClass, 40) || undefined,
      party: clip(row.party, 40) || undefined,
      disposition,
      evidenceClass: clip(row.evidenceClass, 40) || (disposition === 'confirmed' ? 'confirmed-failure' : 'observation')
    });
  }
  const securityCount = (report?.linkAudit?.incompleteChecks || []).filter(c => /destination-not-allowed|not-allowed|private-destination/i.test(String(c.reason || ''))).length;
  if (securityCount) securityBlocks.push({ kind: 'security_block', reason: 'private-destination', count: securityCount });

  const errorBound = boundList(errors, DIAGNOSTIC_CAPS.pageErrors);
  const resourceBound = boundList(resources, DIAGNOSTIC_CAPS.failedResources);
  const embed = report?.page?.embeddedCoverage || {};
  const interaction = report?.interactionCoverage || {};
  const psi = report?.psi || {};
  const tested = Number(interaction.tested ?? interaction.safelyTested ?? 0);
  const passed = Number(interaction.passed || 0);
  const failed = Number(interaction.failed || 0);
  const inconclusiveIx = Number(interaction.inconclusive || 0);
  const skippedUnsafe = Number(interaction.skippedUnsafe || 0);
  const skippedIneligible = Number(interaction.skippedIneligible || 0);
  const skippedSafetyPolicy = Number(interaction.skippedSafetyPolicy || 0);
  const notApplicable = Number(interaction.notApplicable || 0);
  const candidates = Number(interaction.candidates || 0);
  const eligible = Number(interaction.eligible ?? 0);
  const confirmedResources = resources.filter(r => r.disposition === 'confirmed').length;
  const inconclusiveResources = resources.filter(r => r.disposition === 'inconclusive').length;
  return {
    pageErrors: errorBound,
    failedResources: resourceBound,
    resourceAnomalies: resourceBound,
    expectedInconclusive: boundList(expectedInconclusive, DIAGNOSTIC_CAPS.links),
    securityBlocks: boundList(securityBlocks, 8),
    coverageLimitation: report?.coverageReasons?.runtime
      || report?.coverageScope?.runtime
      ? {
        kind: 'coverage_limitation',
        reason: clip(report?.coverageReasons?.runtime || report?.coverageScope?.runtime, 80),
        class: classifyCoverageReason(report?.coverageReasons?.runtime || 'runtime-scope-post-injection')
      }
      : undefined,
    iframeCoverage: {
      framesDiscovered: Number(embed.framesDiscovered ?? embed.iframeCount ?? 0),
      sameOriginEligible: Number(embed.sameOriginEligible ?? embed.accessibleSameOriginIframes ?? embed.sameOriginFramesChecked ?? 0),
      sameOriginAttempted: Number(embed.sameOriginAttempted ?? embed.sameOriginFramesChecked ?? 0),
      sameOriginFramesChecked: Number(embed.sameOriginFramesChecked || 0),
      sameOriginUnprobed: Number(embed.sameOriginUnprobed ?? Math.max(0, Number(embed.sameOriginEligible ?? embed.accessibleSameOriginIframes ?? 0) - Number(embed.sameOriginFramesChecked || 0))),
      crossOriginFramesNotInspectable: Number(embed.crossOriginFramesNotInspectable || embed.crossOriginIframes || 0),
      frameBudgetReached: embed.frameBudgetReached === true || embed.frameBudgetExceeded === true,
      frameBudgetExceeded: embed.frameBudgetExceeded === true,
      frameBudgetPreventedCoverage: embed.frameBudgetPreventedCoverage === true
        || Number(embed.sameOriginUnprobed || 0) > 0,
      accountingOk: embed.accountingOk !== false
    },
    interactionCoverage: {
      candidates,
      eligible,
      safelyTested: Number(interaction.safelyTested ?? tested),
      tested,
      skippedUnsafe,
      skippedIneligible,
      skippedSafetyPolicy,
      passed,
      failed,
      inconclusive: inconclusiveIx,
      notApplicable,
      restorationFailures: Number(interaction.restorationFailures || 0),
      partialReason: clip(interaction.partialReason, 80) || undefined,
      iframeDisclosures: clip(interaction.iframeDisclosures, 40) || undefined,
      iframeInteractionsUnprobed: Number(interaction.iframeInteractionsUnprobed || 0),
      accountingOk: tested === passed + failed + inconclusiveIx
        && (candidates === 0 || candidates === tested + skippedUnsafe + skippedIneligible + skippedSafetyPolicy + notApplicable
          || candidates === eligible + skippedUnsafe + skippedIneligible),
      sideEffectLimitation: clip(interaction.sideEffectLimitation, 80) || undefined
    },
    resourceCounts: {
      observedFailureEvents: Number(report?.diagnostics?.observedResourceFailureEvents
        ?? report?.diagnostics?.observedResourceAnomalyEvents
        ?? (report?.diagnostics?.failedResources || []).length),
      deduplicatedFailedResources: Number(report?.diagnostics?.deduplicatedFailedResources
        ?? report?.diagnostics?.deduplicatedResourceAnomalies
        ?? (report?.diagnostics?.failedResources || []).length),
      observedAnomalyEvents: Number(report?.diagnostics?.observedResourceAnomalyEvents
        ?? report?.diagnostics?.observedResourceFailureEvents
        ?? (report?.diagnostics?.failedResources || []).length),
      deduplicatedAnomalies: Number(report?.diagnostics?.deduplicatedResourceAnomalies
        ?? report?.diagnostics?.deduplicatedFailedResources
        ?? (report?.diagnostics?.failedResources || []).length),
      confirmedFailures: Number(report?.diagnostics?.confirmedResourceFailures ?? confirmedResources),
      inconclusiveObservations: Number(report?.diagnostics?.inconclusiveResourceObservations ?? inconclusiveResources)
    },
    psi: {
      enabled: psi.enabled === true,
      attempted: psi.attempted === true,
      completed: psi.completed === true,
      unavailableReason: clip(psi.unavailableReason, 80) || undefined,
      evidenceClass: 'deferred'
    },
    notes: {
      pageErrors: report?.coverage?.runtime === 'renderer'
        ? 'renderer-pageerror-session'
        : 'post-injection-samples-only',
      failedResources: 'resource-timing-status-ge-400-or-opaque; disposition-required; empty-is-not-proof'
    }
  };
}

function stageForOperation(operation = '') {
  const op = String(operation || '');
  if (/SCAN|INJECT|CONTENT/i.test(op)) return 'content-script';
  if (/ENRICH|CONTEXT|GATEWAY/i.test(op)) return 'gateway';
  if (/RENDER|PERF/i.test(op)) return 'renderer';
  if (/LINK|AUDIT/i.test(op)) return 'link-probe';
  if (/FRANK|PREPARE/i.test(op)) return 'frank';
  if (/CORR/i.test(op)) return 'correlation';
  return 'service-worker';
}

function projectWebqaDiagnostics({ lastDiagnostic, report, lastScanAttempt, includeContext, trace = [] }) {
  const errors = [];
  if (lastDiagnostic?.id) {
    errors.push({
      kind: 'webqa_error',
      stage: stageForOperation(lastDiagnostic.operation),
      code: clip(lastDiagnostic.id, 80),
      operation: clip(lastDiagnostic.operation, 40),
      at: clip(lastDiagnostic.timestamp, 60),
      recoverable: true,
      coverageImpact: /ENRICH|CONTEXT/i.test(String(lastDiagnostic.operation || '')) ? 'enrichment' : 'scan'
    });
  }
  for (const row of trace || []) {
    if (row?.type !== 'sidepanel-render-failed' && row?.type !== 'hydration-stale-build') continue;
    errors.push({
      kind: 'webqa_error',
      stage: clip(row.data?.stage || (row.type === 'hydration-stale-build' ? 'hydration' : 'result-render'), 40),
      code: clip(row.data?.code || row.type, 80),
      operation: clip(row.data?.operation || row.type, 40),
      at: clip(row.at, 60),
      recoverable: row.data?.recoverable !== false,
      coverageImpact: clip(row.data?.coverageImpact || 'none', 40)
    });
  }
  if (report?.connectedMode === 'unavailable' || report?.connectedError) {
    errors.push({
      kind: 'webqa_error',
      stage: 'gateway',
      code: clip(report.connectedMode, 40) || 'gateway-unavailable',
      recoverable: true,
      coverageImpact: 'enrichment'
    });
  }
  if (lastScanAttempt?.ok === false && lastScanAttempt.code) {
    errors.push({
      kind: 'webqa_error',
      stage: 'service-worker',
      code: clip(lastScanAttempt.code, 80),
      operation: clip(lastScanAttempt.operation, 40),
      recoverable: true,
      coverageImpact: 'scan'
    });
  }
  void includeContext;
  return boundList(errors, DIAGNOSTIC_CAPS.webqaErrors);
}

function projectFrank({ frank, localAi, includeContext }) {
  if (!frank && !localAi) return null;
  const finding = frank?.finding || {};
  const plan = frank?.plan || {};
  const reasoning = frank?.reasoning || {};
  const graph = frank?.graph || {};
  const code = clip(reasoning.code || localAi?.code, 100);
  const familyId = remediationFamilyId(finding.ruleId);
  const out = {
    selectedRuleId: clip(finding.ruleId, 160),
    targetability: clip(finding.targetability, 40),
    reasoning: {
      status: clip(reasoning.status, 30),
      provider: clip(reasoning.provider, 50),
      mode: clip(reasoning.mode, 30)
    },
    planMode: clip(plan.mode, 20),
    planValid: typeof frank?.planValid === 'boolean' ? frank.planValid : undefined,
    evidenceRefs: (graph.evidence || []).slice(0, 12).map(e => clip(e.id || e.kind, 80)).filter(Boolean),
    currentStepType: clip(plan.steps?.[frank?.stepIndex || 0]?.type, 40) || undefined,
    fallbackCode: code || undefined,
    fallbackReason: CANNED_FALLBACK[code] || undefined,
    familyCheck: code === 'LOCAL_AI_REMEDIATION_DRIFT' ? {
      check: 'remediation-family',
      familyId,
      matched: false
    } : undefined,
    localAi: localAi ? { status: clip(localAi.status, 30), code: clip(localAi.code, 100) } : undefined,
    review: graph.reviewContext ? {
      adapter: clip(graph.reviewContext.adapter, 80),
      ruleFamily: clip(graph.reviewContext.ruleFamily, 80),
      instanceCount: Number(graph.reviewContext.instanceCount || graph.reviewContext.instances?.length || 0) || undefined,
      selectedInstance: Number(graph.reviewContext.selectedInstanceNumber || 0) || undefined
    } : undefined
  };
  if (includeContext && frank) out.optIn = safeFrankContext(frank);
  if (includeContext && localAi?.candidate) out.localAi = { ...out.localAi, candidate: sanitize(localAi.candidate, { includePageText: true }) };
  return out;
}

function mapTraceEvent(row = {}) {
  const t = String(row.type || '');
  if (t === 'scan-start' || t === 'scan_started') return 'scan_started';
  if (t === 'scan-complete' || t === 'scan_completed') return 'scan_completed';
  if (t === 'scan-enrichment-failed') return 'gateway_error';
  if (t === 'scan-failed') return 'webqa_error';
  if (t === 'frank-started' || t === 'frank-request') return 'frank_plan_created';
  if (t === 'local-ai:prompt-rejected') return 'frank_plan_created';
  if (t === 'gateway-test-complete') return row.data?.reachable === false ? 'gateway_error' : 'gateway_status';
  return t.replace(/:/g, '_').slice(0, 80);
}

function projectTimeline({ trace, report, lastDiagnostic }) {
  const events = [];
  let seq = 0;
  const push = (type, data, at) => {
    seq += 1;
    events.push({ seq, at: at || undefined, type, data: data || undefined });
  };
  // Trace start / failure only — scan_completed is emitted LAST after synthesized pipeline stages.
  let scanCompletedFromTrace = null;
  for (const row of trace || []) {
    if (!HIGH_SIGNAL_TRACE.has(row.type)) continue;
    const mapped = mapTraceEvent(row);
    if (mapped === 'scan_completed') {
      scanCompletedFromTrace = { data: row.data, at: row.at };
      continue;
    }
    push(mapped, row.data, row.at);
  }
  if (report) {
    const integrity = integrityState(report);
    if (report.targetIntegrityBlocked || integrity === 'blocked') push('target_blocked', { state: integrity });
    else if (integrity === 'reached' || !integrity) push('target_reached', { state: integrity || 'reached' });
    if (report.coverage?.axe === 'complete') push('axe_completed');
    if (report.linkAudit) {
      const links = buildCoverageAccounting(report).links;
      const unavailable = /unavailable/i.test(String(report.coverage?.links || ''));
      push('link_probe_completed', {
        coverage: unavailable ? 'unavailable' : (links.probeBudgetPreventedCoverage ? 'partial' : 'complete'),
        eligible: links.eligible,
        attempted: links.attempted,
        unprobed: links.unprobed,
        inconclusive: links.inconclusive,
        scannerAborted: links.scannerAborted,
        probeBudgetPreventedCoverage: links.probeBudgetPreventedCoverage === true
      });
    }
    if (report.browserPerformance?.available) {
      push('performance_collected', {
        coverage: 'current-page-lab',
        historicalMonitor: clip(report.coverage?.performance, 40) || undefined
      });
    }
    if (report.coverageReasons && Object.keys(report.coverageReasons).length) {
      const accounting = buildCoverageAccounting(report);
      if (accounting.degradedAreas.length) {
        push('coverage_degraded', { areas: accounting.degradedAreas.slice(0, 8) });
      }
      if (accounting.scopeLimitedAreas.length) {
        push('coverage_scope_limited', { areas: accounting.scopeLimitedAreas.slice(0, 8) });
      }
    }
    if (report.attention) push('correlation_completed', { materialGroupCount: Number(report.attention.materialGroupCount || 0) });
    if ((report.pageDiagnostics?.errors || []).length) push('page_error', { count: report.pageDiagnostics.errors.length });
    const deduped = Number(report.diagnostics?.deduplicatedFailedResources
      ?? (report.diagnostics?.failedResources || []).length);
    const observedEvents = Number(report.diagnostics?.observedResourceFailureEvents ?? deduped);
    if (deduped || observedEvents) {
      push('resource_failure', {
        deduplicatedFailedResources: deduped,
        observedFailureEvents: observedEvents
      });
    }
  }
  if (lastDiagnostic?.id) push('webqa_error', { operation: clip(lastDiagnostic.operation, 40), code: clip(lastDiagnostic.id, 80) }, lastDiagnostic.timestamp);
  if (scanCompletedFromTrace || report) {
    push('scan_completed', scanCompletedFromTrace?.data || {
      findingCount: Number(report?.findings?.length || 0),
      materialGroupCount: Number(report?.attention?.materialGroupCount || 0)
    }, scanCompletedFromTrace?.at);
  }
  return boundListTail(events, DIAGNOSTIC_CAPS.timeline);
}

function safeFindingContext(f = {}) {
  return {
    ruleId: clip(f.ruleId, 160),
    impactClass: clip(f.impactClass, 50),
    category: clip(f.category, 40),
    severity: clip(f.severity, 30),
    confidence: clip(f.confidence, 30),
    frankPriority: clip(f.frankPriority, 30),
    sources: (f.sources || []).slice(0, 12).map(v => clip(v, 50)),
    verification: { state: clip(f.verification?.state, 30), method: clip(f.verification?.method, 100), attempts: Number(f.verification?.attempts || 0) || undefined }
  };
}
function safeEvidence(graph = {}) {
  return (graph.evidence || []).filter(e => SAFE_CONTEXT_KINDS.has(String(e.kind || ''))).slice(0, DIAGNOSTIC_CAPS.evidence).map(e => ({
    source: clip(e.source, 60), kind: clip(e.kind, 80), label: clip(e.label, 100), value: sanitize(e.value)
  }));
}
function safeLocalAi(localAi = {}, includeContext = false) {
  const base = { status: clip(localAi.status, 30), code: clip(localAi.code, 100), at: clip(localAi.at, 60), durationMs: Number(localAi.durationMs || 0) || undefined };
  if (includeContext && localAi.candidate) base.candidate = sanitize(localAi.candidate, { includePageText: true });
  return base;
}
function safeFrankContext(frank = {}) {
  const p = frank?.plan || {}, r = frank?.reasoning || {};
  return {
    mode: clip(p.mode, 20),
    reasoning: { status: clip(r.status, 30), provider: clip(r.provider, 50), code: clip(r.code, 100), message: redactText(r.message, 240) },
    assessment: sanitize(p.assessment || {}),
    steps: (p.steps || []).slice(0, 8).map(s => ({
      type: clip(s.type, 40),
      headline: redactText(s.headline, 120),
      body: redactText(s.body, 520),
      evidenceRefs: (s.evidenceRefs || []).slice(0, 12).map(v => clip(v, 80))
    }))
  };
}

function shrinkArtifact(artifact) {
  let json = JSON.stringify(artifact);
  if (json.length <= DIAGNOSTIC_CAPS.artifactBytes) {
    artifact.bounds = {
      bytes: json.length,
      maxBytes: DIAGNOSTIC_CAPS.artifactBytes,
      truncated: Boolean(
        artifact.timeline?.truncated
        || artifact.findings?.recommendedOrder?.truncated
        || artifact.pageDiagnostics?.pageErrors?.truncated
        || artifact.pageDiagnostics?.failedResources?.truncated
        || artifact.webqaDiagnostics?.truncated
      )
    };
    return artifact;
  }
  if (artifact.timeline?.items) {
    artifact.timeline = boundList(artifact.timeline.items, 20);
  }
  if (artifact.findings?.recommendedOrder?.items) {
    artifact.findings.recommendedOrder = boundList(artifact.findings.recommendedOrder.items, 12);
  }
  if (artifact.pageDiagnostics?.pageErrors?.items) {
    artifact.pageDiagnostics.pageErrors = boundList(artifact.pageDiagnostics.pageErrors.items, 8);
  }
  json = JSON.stringify(artifact);
  artifact.bounds = { bytes: json.length, maxBytes: DIAGNOSTIC_CAPS.artifactBytes, truncated: true };
  return artifact;
}

export function isReportBugArtifact(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return false;
  if (data.kind === 'api-scan' || data.kind === 'repo-gates') return false;
  if (data.kind === DIAGNOSTIC_KIND && (data.schema === BUG_REPORT_SCHEMA_V2 || Number(data.reportVersion) === 2)) return true;
  if (data.schema === BUG_REPORT_SCHEMA_V1) return true;
  return false;
}

export function isDiagnosticV2(data) {
  return Boolean(data && data.kind === DIAGNOSTIC_KIND && (data.schema === BUG_REPORT_SCHEMA_V2 || Number(data.reportVersion) === 2));
}

export function diagnosticIndex(artifact = {}) {
  return {
    kind: artifact.kind || DIAGNOSTIC_KIND,
    schema: artifact.schema,
    reportVersion: artifact.reportVersion,
    webqaVersion: artifact.webqaVersion,
    createdAt: artifact.createdAt,
    includeContext: Boolean(artifact.includeContext),
    scanStatus: artifact.scan?.scanStatus || null,
    sanitizedUrl: artifact.scan?.sanitizedUrl || null,
    mismatch: Boolean(artifact.scan?.mismatch),
    untrustedPageEvidence: Boolean(artifact.untrustedPageEvidence),
    bounds: artifact.bounds || null,
    coverage: artifact.coverage || null,
    counts: {
      findings: artifact.findings?.findingCount || 0,
      pageErrors: artifact.pageDiagnostics?.pageErrors?.total || 0,
      webqaErrors: artifact.webqaDiagnostics?.total || 0,
      timeline: artifact.timeline?.total || 0
    },
    truncation: {
      timeline: asBound(artifact.timeline),
      pageErrors: asBound(artifact.pageDiagnostics?.pageErrors),
      webqaErrors: asBound(artifact.webqaDiagnostics),
      findings: asBound(artifact.findings?.recommendedOrder)
    },
    note: 'Newest exported diagnostic pointer only — not the page currently open. Use webqa_diagnostic_section for bounded sections. Do not treat this as a live scan of the current tab.'
  };
}

export function selectDiagnosticSection(artifact, section = 'index') {
  const key = String(section || 'index');
  if (!isDiagnosticV2(artifact)) {
    throw new Error('webqa_diagnostic_section requires a v2 report-bug-diagnostic artifact. Use webqa_read_report_bug for legacy v1 Report Bug files.');
  }
  if (key === 'index' || key === '' || key === 'default') return diagnosticIndex(artifact);
  if (!DIAGNOSTIC_SECTIONS.includes(key)) {
    throw new Error(`Unknown diagnostic section "${key}". Use ${DIAGNOSTIC_SECTIONS.join('|')}.`);
  }
  if (key === 'coverage') {
    return {
      coverage: artifact.coverage,
      reasons: artifact.coverageReasons || artifact.scan?.coverageReasons,
      coverageAccounting: artifact.coverageAccounting || undefined,
      scopeNotes: artifact.coverageAccounting?.scopeLimitedAreas || undefined
    };
  }
  return artifact[key];
}

export function hardenReportBugArtifact(data) {
  if (!isReportBugArtifact(data)) {
    throw new Error('Not a WebQA Report Bug diagnostic artifact (expected schema web-qa-assistant-bug-report/v1 or kind=report-bug-diagnostic).');
  }
  const maxArray = isDiagnosticV2(data) ? 500 : 30;
  return sanitize(data, { includePageText: Boolean(data.includeContext), maxArray });
}

export function buildBugReport({
  version = 'unknown',
  buildRevision = '',
  developmentTarget = '1.7.5',
  trace = [],
  readiness = {},
  report = null,
  frank = null,
  localAi = null,
  userNote = '',
  includeContext = false,
  userAgent = globalThis.navigator?.userAgent || '',
  lastDiagnostic = null,
  lastScanAttempt = null,
  createdAt = new Date().toISOString()
} = {}) {
  const extras = extrasFromFailure(lastDiagnostic, lastScanAttempt);
  const coverageReasons = report ? (report.coverageReasons || explainCoverageReasons(report, extras)) : {};
  const reportForProjection = report ? { ...report, coverageReasons } : null;
  const coverageAccounting = reportForProjection ? buildCoverageAccounting(reportForProjection) : null;
  const status = scanStatusFor({ report: reportForProjection, lastScanAttempt, lastDiagnostic });
  const mismatch = Boolean(
    lastScanAttempt?.scanId && reportForProjection?.scanId && lastScanAttempt.scanId !== reportForProjection.scanId
  );
  const findings = status === 'none' || status === 'failed' ? {
    recommendedOrder: boundList([], 0),
    worthCheckingFurther: boundList([], 0),
    byArea: {},
    findingCount: 0,
    materialGroupCount: 0,
    omittedBecause: status
  } : projectFindings(reportForProjection, includeContext);
  const frankProjected = projectFrank({ frank, localAi, includeContext });

  const artifact = {
    kind: DIAGNOSTIC_KIND,
    schema: BUG_REPORT_SCHEMA_V2,
    reportVersion: 2,
    webqaVersion: clip(version, 30),
    buildRevision: clip(buildRevision || reportForProjection?.buildRevision || globalThis.__WEBQA_BUILD_REVISION__ || '', 16) || undefined,
    developmentTarget: clip(developmentTarget, 20) || undefined,
    createdAt,
    generatedAt: createdAt,
    includeContext: Boolean(includeContext),
    untrustedPageEvidence: true,
    extension: {
      version: clip(version, 30),
      buildRevision: clip(buildRevision || reportForProjection?.buildRevision || globalThis.__WEBQA_BUILD_REVISION__ || '', 16) || undefined,
      developmentTarget: clip(developmentTarget, 20) || undefined
    },
    browser: { chromeVersion: chromeVersion(userAgent) },
    frankReadiness: sanitize({ status: readiness?.status, progress: readiness?.progress, code: readiness?.code }),
    scan: {
      scanId: clip(reportForProjection?.scanId || lastScanAttempt?.scanId, 80) || undefined,
      scanStatus: status,
      mismatch,
      sanitizedUrl: reportForProjection?.page?.url ? diagnosticUrl(reportForProjection.page.url) : undefined,
      targetIntegrity: integrityState(reportForProjection) || undefined,
      scannedAt: clip(reportForProjection?.scannedAt, 60) || undefined,
      environment: clip(reportForProjection?.environment?.type || reportForProjection?.page?.environment?.type, 30) || undefined,
      connectedMode: clip(reportForProjection?.connectedMode, 40) || undefined,
      titlePresent: Boolean(reportForProjection?.page?.title),
      ...(includeContext && reportForProjection?.page?.title ? { pageTitle: redactText(String(reportForProjection.page.title).replace(/\?[^\s]*/g, ''), 120) } : {}),
      coverage: reportForProjection?.coverage || undefined,
      coverageReasons,
      mode: clip(lastScanAttempt?.mode || (reportForProjection ? 'current-tab' : ''), 40) || undefined,
      buildRevision: clip(buildRevision || reportForProjection?.buildRevision || globalThis.__WEBQA_BUILD_REVISION__ || '', 16) || undefined
    },
    environment: {
      extensionVersion: clip(version, 30),
      buildRevision: clip(buildRevision || reportForProjection?.buildRevision || globalThis.__WEBQA_BUILD_REVISION__ || '', 16) || undefined,
      developmentTarget: clip(developmentTarget, 20) || undefined,
      extensionStatus: lastDiagnostic ? 'error' : 'ok',
      gateway: clip(reportForProjection?.connectedMode, 40) || undefined,
      renderer: clip(reportForProjection?.coverage?.renderer || reportForProjection?.coverage?.runtime, 40) || undefined,
      frankMode: clip(frank?.plan?.mode || reportForProjection?.frankReview?.source || '', 40) || undefined,
      guidanceSource: clip(scanGuidanceSource({
        frankReview: reportForProjection?.frankReview,
        frank,
        priorityMode: reportForProjection?.priorityMode,
        coverageAi: reportForProjection?.coverage?.ai,
        hasVisibleGuidance: Boolean(reportForProjection?.priorityBrief || frank?.plan)
      }), 40) || undefined,
      modelReadiness: clip(readiness?.status, 40) || undefined,
      chromeVersion: chromeVersion(userAgent),
      page: reportForProjection?.environment ? {
        kind: clip(reportForProjection.environment.type || reportForProjection.environment.kind, 30) || 'unknown',
        confidence: clip(reportForProjection.environment.confidenceLabel, 20) || undefined,
        source: clip(reportForProjection.environment.source, 20) || undefined,
        signals: Array.isArray(reportForProjection.environment.signals) ? reportForProjection.environment.signals.slice(0, 8).map(s => clip(s, 80)) : undefined,
        indexControl: reportForProjection.environment.indexControl ? {
          assessment: clip(reportForProjection.environment.indexControl.assessment, 40) || undefined,
          evidenceConfidence: clip(reportForProjection.environment.indexControl.evidenceConfidence, 30) || undefined,
          finalizationStage: clip(reportForProjection.environment.indexControl.finalizationStage, 40) || undefined,
          noindexDetected: reportForProjection.environment.indexControl.noindexDetected === true,
          crawlRestricted: reportForProjection.environment.indexControl.crawlRestricted === true,
          conflictingSignals: reportForProjection.environment.indexControl.conflictingSignals === true,
          metaRobots: reportForProjection.environment.indexControl.metaRobots ? {
            checked: reportForProjection.environment.indexControl.metaRobots.checked === true,
            noindex: reportForProjection.environment.indexControl.metaRobots.noindex === true,
            raw: clip(reportForProjection.environment.indexControl.metaRobots.raw, 120) || undefined
          } : undefined,
          publishedMetaRobots: reportForProjection.environment.indexControl.publishedMetaRobots ? {
            checked: reportForProjection.environment.indexControl.publishedMetaRobots.checked === true,
            noindex: reportForProjection.environment.indexControl.publishedMetaRobots.noindex === true,
            raw: clip(reportForProjection.environment.indexControl.publishedMetaRobots.raw, 120) || undefined
          } : undefined,
          xRobotsTag: reportForProjection.environment.indexControl.xRobotsTag ? {
            checked: reportForProjection.environment.indexControl.xRobotsTag.checked === true,
            noindex: reportForProjection.environment.indexControl.xRobotsTag.noindex === true,
            raw: clip(reportForProjection.environment.indexControl.xRobotsTag.raw, 120) || undefined
          } : undefined,
          robotsTxt: reportForProjection.environment.indexControl.robotsTxt ? {
            checked: reportForProjection.environment.indexControl.robotsTxt.checked === true,
            crawlAllowed: reportForProjection.environment.indexControl.robotsTxt.crawlAllowed,
            matchedRule: clip(reportForProjection.environment.indexControl.robotsTxt.matchedRule, 80) || undefined
          } : undefined,
          checkedScope: reportForProjection.environment.indexControl.checkedScope || undefined
        } : undefined,
        canonical: reportForProjection.environment.canonicalContext ? {
          observed: reportForProjection.environment.canonicalContext.observed === true,
          host: clip(reportForProjection.environment.canonicalContext.normalizedHost, 80) || undefined,
          relationship: clip(reportForProjection.environment.canonicalContext.relationshipToCurrentHost, 40) || undefined,
          assessment: clip(reportForProjection.environment.canonicalContext.assessment, 40) || undefined
        } : undefined,
        launchReadiness: reportForProjection.environment.launchReadiness ? {
          items: (reportForProjection.environment.launchReadiness.items || []).slice(0, 12).map(item => ({
            id: clip(item.id, 60),
            category: clip(item.category, 40),
            title: clip(item.title, 180)
          })),
          checklist: (reportForProjection.environment.launchReadiness.checklist || []).slice(0, 8).map(row => clip(row, 120))
        } : undefined,
        presentationPolicy: reportForProjection.environment.presentationPolicy || undefined,
        indexability: reportForProjection.environment.indexability ? {
          blocked: reportForProjection.environment.indexability.blocked === true,
          publishedBlocked: reportForProjection.environment.indexability.publishedBlocked === true,
          renderedBlocked: reportForProjection.environment.indexability.renderedBlocked === true,
          mismatch: reportForProjection.environment.indexability.mismatch === true,
          assessment: clip(reportForProjection.environment.indexability.assessment, 40) || undefined
        } : undefined,
        noticeKind: clip(reportForProjection.environment.notice?.kind, 40) || undefined
      } : undefined
    },
    coverage: reportForProjection?.coverage || undefined,
    coverageReasons,
    coverageAccounting: coverageAccounting ? {
      degradedAreas: coverageAccounting.degradedAreas,
      scopeLimitedAreas: coverageAccounting.scopeLimitedAreas,
      completeAreas: coverageAccounting.completeAreas,
      accountingOk: coverageAccounting.accountingOk === true,
      reasons: coverageAccounting.reasons,
      links: coverageAccounting.links,
      iframes: coverageAccounting.iframes,
      interactions: {
        candidates: coverageAccounting.interactions.candidates,
        eligible: coverageAccounting.interactions.eligible,
        tested: coverageAccounting.interactions.tested,
        skippedSafetyPolicy: coverageAccounting.interactions.skippedSafetyPolicy,
        restorationFailures: coverageAccounting.interactions.restorationFailures,
        iframeInteractionsUnprobed: coverageAccounting.interactions.iframeInteractionsUnprobed || 0,
        partialReason: coverageAccounting.interactions.partialReason || undefined,
        accountingOk: coverageAccounting.interactions.accountingOk === true
      }
    } : undefined,
    scanTimings: reportForProjection?.scanTimings ? {
      discoveryMs: Number(reportForProjection.scanTimings.discoveryMs || 0) || undefined,
      axeMs: Number(reportForProjection.scanTimings.axeMs || 0) || undefined,
      linkProbeMs: Number(reportForProjection.scanTimings.linkProbeMs || 0) || undefined,
      primaryLinkMs: Number(reportForProjection.scanTimings.primaryLinkMs || 0) || undefined,
      refinementLinkMs: Number(reportForProjection.scanTimings.refinementLinkMs || 0) || undefined,
      frameInspectionMs: Number(reportForProjection.scanTimings.frameInspectionMs || 0) || undefined,
      interactionMs: Number(reportForProjection.scanTimings.interactionMs || 0) || undefined,
      performanceMs: Number(reportForProjection.scanTimings.performanceMs || 0) || undefined,
      correlationMs: Number(reportForProjection.scanTimings.correlationMs || 0) || undefined,
      frankReviewMs: Number(reportForProjection.scanTimings.frankReviewMs || 0) || undefined,
      totalMs: Number(reportForProjection.scanTimings.totalMs || 0) || undefined
    } : undefined,
    inventory: reportForProjection?.page?.inventory || reportForProjection?.evidenceLedger?.inventory || undefined,
    evidenceLedger: reportForProjection?.evidenceLedger ? compactFrankPageLedger(reportForProjection.evidenceLedger) : undefined,
    findings,
    findingTargets: findings?.targets ? {
      valid: findings.targets.validTargets,
      stale: findings.targets.staleTargets,
      unavailable: Math.max(0, Number(findings.targets.instanceCount || 0) - Number(findings.targets.validTargets || 0) - Number(findings.targets.staleTargets || 0))
    } : undefined,
    performance: projectPerformance(reportForProjection),
    performanceAssessment: reportForProjection?.performanceAssessment ? {
      status: clip(reportForProjection.performanceAssessment.status, 40) || undefined,
      summary: clip(reportForProjection.performanceAssessment.summary, 240) || undefined,
      metrics: reportForProjection.performanceAssessment.metrics || undefined,
      imageDelivery: reportForProjection.performanceAssessment.imageDelivery || undefined,
      actionableIssues: (reportForProjection.performanceAssessment.actionableIssues || []).slice(0, 8).map(row => ({
        id: clip(row.id, 40),
        title: clip(row.title, 120),
        severity: clip(row.severity, 20)
      })),
      diagnosticObservations: (reportForProjection.performanceAssessment.diagnosticObservations || []).slice(0, 8).map(row => ({
        id: clip(row.id, 40),
        title: clip(row.title, 120)
      }))
    } : undefined,
    guidance: {
      source: clip(scanGuidanceSource({
        frankReview: reportForProjection?.frankReview,
        frank,
        priorityMode: reportForProjection?.priorityMode,
        coverageAi: reportForProjection?.coverage?.ai,
        hasVisibleGuidance: Boolean(reportForProjection?.priorityBrief || frank?.plan)
      }), 40),
      modelReadiness: clip(readiness?.status, 40) || undefined
    },
    frankReview: reportForProjection?.frankReview ? {
      modelReadiness: clip(reportForProjection.frankReview.modelReadiness || readiness?.status, 40) || undefined,
      requested: reportForProjection.frankReview.requested === true,
      started: reportForProjection.frankReview.started === true,
      completed: reportForProjection.frankReview.completed === true,
      source: clip(reportForProjection.frankReview.source, 40) || 'none',
      failureReason: clip(reportForProjection.frankReview.failureReason || reportForProjection.frankReview.reason, 180) || undefined
    } : {
      modelReadiness: clip(readiness?.status, 40) || undefined,
      requested: false,
      started: false,
      completed: false,
      source: 'none',
      failureReason: 'not-requested'
    },
    publishedCoverage: projectPublishedCoverage(reportForProjection?.publishedCoverage || reportForProjection?.environment?.publishedCoverage),
    linkExecution: projectLinkExecution(reportForProjection?.linkAudit?.linkExecution || reportForProjection?.linkExecution),
    guidanceComposition: frank?.plan?.steps ? {
      adapter: clip(frank?.finding?.guidanceComposition?.adapter || frank?.plan?.guidanceSource, 40) || undefined,
      structuredRemediationUsed: Boolean(frank?.finding?.structuredRemediation || frank?.finding?.guidanceComposition?.structuredRemediationUsed)
    } : undefined,
    visibleErrors: (() => {
      const rows = (reportForProjection?.findings || []).filter(f => /visible-error/.test(String(f.ruleId || ''))).slice(0, 8);
      if (!rows.length) return undefined;
      return {
        total: rows.length,
        items: rows.map(f => ({
          ...(includeContext ? { messageExcerpt: redactText(f.visibleError?.messageExcerpt || f.detail, 160) || undefined } : {}),
          targetStatus: clip(f.target?.status, 30) || undefined,
          visibility: clip(f.visibleError?.visibility, 30) || undefined,
          role: clip(f.visibleError?.role, 40) || undefined,
          originClass: clip(f.visibleError?.originClass, 40) || undefined,
          firstObservedPhase: clip(f.visibleError?.firstObservedPhase, 40) || undefined
        }))
      };
    })(),
    injectedUi: globalThis.__WEBQA_INJECTED_UI__ || undefined,
    links: projectLinks(reportForProjection),
    pageDiagnostics: projectPageDiagnostics(reportForProjection, includeContext),
    webqaDiagnostics: projectWebqaDiagnostics({ lastDiagnostic, report: reportForProjection, lastScanAttempt, includeContext, trace }),
    frank: frankProjected,
    timeline: projectTimeline({ trace, report: reportForProjection, lastDiagnostic })
  };

  if (userNote) artifact.userNote = redactText(userNote, 800);
  if (localAi) artifact.localAi = safeLocalAi(localAi, includeContext);
  if (includeContext) {
    artifact.context = {
      page: { environment: clip(reportForProjection?.environment?.type || reportForProjection?.page?.environment?.type || 'unknown', 30) },
      finding: frank?.finding ? safeFindingContext(frank.finding) : null,
      evidence: frank?.graph ? safeEvidence(frank.graph) : [],
      frank: frank ? safeFrankContext(frank) : null
    };
  }
  return shrinkArtifact(artifact);
}

export function bugReportPrivacySummary(includeContext = false) {
  if (includeContext) {
    return 'Includes bounded current-finding measurements, Frank wording, and a redacted page title. URLs are reduced to origin/path. Selectors, cookies, form values, query values and raw DOM are never included.';
  }
  return 'Includes scan origin/path, coverage codes, finding ruleIds, lab metrics, link counts, and runtime event codes. Finding titles, query values, cookies, form values, selectors, Frank wording and credentials are excluded.';
}
