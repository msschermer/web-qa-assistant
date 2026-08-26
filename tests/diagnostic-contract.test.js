import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildBugReport,
  diagnosticIndex,
  selectDiagnosticSection,
  isDiagnosticV2,
  isReportBugArtifact,
  hardenReportBugArtifact,
  DIAGNOSTIC_CAPS,
  DIAGNOSTIC_KIND
} from '../packages/support/bug-report.js';
import { explainCoverageReasons, COVERAGE_REASON } from '../packages/findings/coverage.js';
import { sanitizeUrl, sanitizeUrlOriginPath } from '../packages/ai/evidence-contract.js';

function reachedReport(overrides = {}) {
  return {
    scanId: 'scan-reached',
    scannedAt: '2026-08-25T12:00:00.000Z',
    page: {
      url: 'https://example.com/checkout?email=person@example.com&token=secret#private',
      title: 'Checkout',
      targetIntegrity: { state: 'reached' },
      environment: { type: 'production' }
    },
    environment: { type: 'production' },
    coverage: { browser: 'complete', links: 'complete', axe: 'complete', performance: 'current-page', runtime: 'not applicable' },
    findings: [{
      id: 'f1',
      ruleId: 'runtime.script-failed',
      title: 'Script failed to load',
      impactClass: 'implementation',
      category: 'fix',
      severity: 'high',
      confidence: 'confirmed',
      targetability: 'document',
      resourceUrl: 'https://example.com/assets/app.js?cache=abc',
      selector: '#secret-script'
    }, {
      id: 'f2',
      ruleId: 'navigation.link-review-external',
      title: 'External link returned a forbidden response',
      impactClass: 'coverage',
      category: 'review',
      confidence: 'inconclusive',
      selector: '#x'
    }],
    attention: {
      materialGroupCount: 1,
      groups: [{ leadId: 'f1', impactClass: 'implementation', size: 1, title: 'Script failed to load', targetability: 'document' }],
      worthChecking: [{ key: 'wc1', title: 'Worth a look', lens: 'runtime', scope: 'page', size: 1 }]
    },
    browserPerformance: { available: true, largestContentfulPaintMs: 3200, ttfbMs: 180, transferBytes: 120000, measuredTransferCount: 12, resourceCount: 20 },
    linkAudit: { checked: 10, verifiedHealthy: 8, confirmedIssues: 0, inconclusive: 1, privilegedProbe: 'gateway' },
    pageDiagnostics: { errors: [{ kind: 'page_error', message: 'TypeError: boom https://example.com/x?token=leak', source: 'https://example.com/assets/app.js?v=1#frag', line: 123 }] },
    diagnostics: { failedResources: [{ initiator: 'script', status: 404, source: 'https://example.com/assets/app.js?token=1', sameOrigin: true }] },
    connectedMode: 'gateway',
    ...overrides
  };
}

test('diagnostic contract: reached scan is v2 allowlisted projection', () => {
  const artifact = buildBugReport({
    version: '1.7.3',
    report: reachedReport(),
    includeContext: false,
    lastScanAttempt: { scanId: 'scan-reached', ok: true, mode: 'current-tab' }
  });
  assert.equal(isDiagnosticV2(artifact), true);
  assert.equal(artifact.kind, DIAGNOSTIC_KIND);
  assert.equal(artifact.scan.scanStatus, 'reached');
  assert.equal(artifact.scan.sanitizedUrl, 'https://example.com/checkout');
  assert.equal(artifact.findings.recommendedOrder.items[0].leadRuleId, 'runtime.script-failed');
  assert.equal(artifact.findings.recommendedOrder.items[0].title, undefined);
  assert.equal(artifact.performance.lcpMs, 3200);
  assert.equal(artifact.links.inconclusive, 1);
  assert.equal(artifact.pageDiagnostics.pageErrors.items[0].kind, 'page_error');
  assert.equal(artifact.pageDiagnostics.pageErrors.items[0].message, undefined);
  assert.equal(artifact.pageDiagnostics.failedResources.items[0].kind, 'resource_failure');
  assert.equal(artifact.pageDiagnostics.failedResources.total, 1);
  assert.equal(artifact.pageDiagnostics.expectedInconclusive.total, 1);
  assert.match(artifact.pageDiagnostics.notes.failedResources, /empty-is-not-proof/);
  const text = JSON.stringify(artifact);
  assert.doesNotMatch(text, /person@example\.com|token=secret|#private|token=leak|#frag|\?v=1|#secret-script|cache=abc/);
  assert.ok(artifact.timeline.items.some(e => e.type === 'scan_completed' || e.type === 'target_reached' || e.type === 'correlation_completed'));
});

test('diagnostic contract: blocked target records coverage reasons without pretending a clean pass', () => {
  const report = {
    scanId: 'scan-block',
    page: { url: 'https://example.com/app', targetIntegrity: { state: 'blocked' } },
    coverage: { browser: 'blocked', links: 'not_applicable', axe: 'not_applicable', performance: 'not_applicable' },
    findings: [],
    targetIntegrityBlocked: true
  };
  report.coverageReasons = explainCoverageReasons(report);
  const artifact = buildBugReport({ report, lastScanAttempt: { scanId: 'scan-block', ok: true } });
  assert.equal(artifact.scan.scanStatus, 'blocked');
  assert.equal(artifact.coverageReasons.links, COVERAGE_REASON.TARGET_BLOCKED);
  assert.ok(artifact.timeline.items.some(e => e.type === 'target_blocked'));
});

test('diagnostic contract: partial coverage explains probe budget', () => {
  const report = reachedReport({
    coverage: { browser: 'complete', links: 'partial', axe: 'complete', performance: 'partial' },
    linkAudit: { checked: 36, verifiedHealthy: 20, confirmedIssues: 0, inconclusive: 12, reachedLimit: true }
  });
  report.coverageReasons = explainCoverageReasons(report);
  const artifact = buildBugReport({ report });
  assert.equal(artifact.coverageReasons.links, COVERAGE_REASON.PROBE_BUDGET_EXHAUSTED);
  assert.equal(artifact.coverageReasons.performance, COVERAGE_REASON.LAB_PARTIAL);
});

test('diagnostic contract: page JS error and failed resource stay classified separately from WebQA errors', () => {
  const artifact = buildBugReport({
    report: reachedReport(),
    includeContext: true,
    lastDiagnostic: { id: 'WQA-TIMEOUT', operation: 'ENRICH', timestamp: '2026-08-25T12:01:00.000Z' }
  });
  assert.equal(artifact.pageDiagnostics.pageErrors.items[0].kind, 'page_error');
  assert.match(artifact.pageDiagnostics.pageErrors.items[0].message, /TypeError/);
  assert.doesNotMatch(artifact.pageDiagnostics.pageErrors.items[0].message, /token=leak/);
  assert.equal(artifact.pageDiagnostics.failedResources.items[0].kind, 'resource_failure');
  assert.equal(artifact.webqaDiagnostics.items[0].kind, 'webqa_error');
  assert.equal(artifact.webqaDiagnostics.items[0].stage, 'gateway');
  assert.equal(artifact.webqaDiagnostics.items[0].code, 'WQA-TIMEOUT');
  assert.equal(JSON.stringify(artifact).includes('technicalMessage'), false);
  assert.equal(JSON.stringify(artifact).includes('"stack"'), false);
});

test('diagnostic contract: Frank fallback exposes family check without prompts or rootCauseKey selectors', () => {
  const frank = {
    finding: { ruleId: 'seo.noindex', targetability: 'markup', selector: '#main nav.secret' },
    reasoning: { status: 'fallback', provider: 'chrome-built-in', mode: 'deterministic', code: 'LOCAL_AI_REMEDIATION_DRIFT', message: 'ignored https://x?token=1' },
    plan: { mode: 'deterministic', steps: [{ type: 'interpretation', body: 'secret body' }] },
    planValid: true
  };
  const artifact = buildBugReport({ frank, localAi: { status: 'rejected', code: 'LOCAL_AI_REMEDIATION_DRIFT', candidate: { remediation: 'compress images' } }, includeContext: false });
  assert.equal(artifact.frank.fallbackCode, 'LOCAL_AI_REMEDIATION_DRIFT');
  assert.equal(artifact.frank.familyCheck.familyId, 'seo-index');
  assert.equal(artifact.frank.familyCheck.matched, false);
  assert.equal(artifact.frank.planMode, 'deterministic');
  assert.equal(artifact.frank.reasoning.provider, 'chrome-built-in');
  assert.equal(artifact.frank.optIn, undefined);
  const text = JSON.stringify(artifact);
  assert.doesNotMatch(text, /secret body|compress images|#main nav|token=1|SYSTEM_PROMPT|chain-of-thought/);
});

test('diagnostic contract: failed rescan keeps mismatch instead of looking like a clean empty audit', () => {
  const artifact = buildBugReport({
    report: reachedReport(),
    lastScanAttempt: { scanId: 'scan-new', ok: false, operation: 'SCAN_TAB', code: 'WQA-FAIL' },
    lastDiagnostic: { id: 'WQA-FAIL', operation: 'SCAN_TAB', timestamp: '2026-08-25T12:02:00.000Z' }
  });
  assert.equal(artifact.scan.mismatch, true);
  assert.equal(artifact.scan.scanStatus, 'stale-report');
  assert.ok(artifact.findings.findingCount >= 1);
  assert.ok(artifact.webqaDiagnostics.items.some(e => e.kind === 'webqa_error'));
});

test('privacy: query, fragment, userinfo, tokens, form-like keys, filesystem paths, and HTML are excluded', () => {
  const artifact = buildBugReport({
    includeContext: true,
    userNote: 'See https://user:pass@example.com/api/submit?email=x&token=y#private and C:\\Users\\mike\\secrets.env and /Users/mike/token',
    report: {
      page: { url: 'https://user:pass@example.com/api/submit?email=x&token=y#private' },
      findings: [{ ruleId: 'ux.form-no-submit', title: 'Form has no submit control', selector: '#password', cookie: 'sid=abc', html: '<html><input value="hunter2"></html>' }],
      pageDiagnostics: { errors: [{ message: 'Authorization: Bearer supersecrettokenvalue0001', source: 'https://example.com/app.js?session=abc' }] }
    },
    frank: { finding: { ruleId: 'ux.form-no-submit', selector: '#password' }, plan: { steps: [{ type: 'remediation', headline: 'Fix', body: 'Do not read localStorage or cookies' }] } }
  });
  const text = JSON.stringify(artifact);
  assert.doesNotMatch(text, /user:pass|email=x|token=y|#private|hunter2|sid=abc|supersecrettokenvalue0001|session=abc|C:\\\\Users\\\\mike|\/Users\/mike\/token|<html>/);
  assert.equal(artifact.scan.sanitizedUrl, 'https://example.com/api/submit');
  assert.doesNotMatch(JSON.stringify(artifact.scan), /selector|#password/);
});

test('bounding: huge error, resource, and timeline lists truncate with metadata', () => {
  const errors = Array.from({ length: 80 }, (_, i) => ({ kind: 'page_error', message: `Error ${i}`, source: `https://example.com/a${i}.js` }));
  const resources = Array.from({ length: 80 }, (_, i) => ({ initiator: 'script', status: 404, source: `https://example.com/r${i}.js` }));
  const trace = Array.from({ length: 200 }, (_, i) => ({ at: `t${i}`, type: 'scan-enrichment-failed', data: { findingCount: i } }));
  // One deferred completion plus many high-signal failure rows force timeline truncation.
  trace.push({ at: 't-end', type: 'scan-complete', data: { findingCount: 1 } });
  const artifact = buildBugReport({
    report: reachedReport({ pageDiagnostics: { errors }, diagnostics: { failedResources: resources } }),
    trace
  });
  assert.equal(artifact.pageDiagnostics.pageErrors.truncated, true);
  assert.equal(artifact.pageDiagnostics.pageErrors.shown, DIAGNOSTIC_CAPS.pageErrors);
  assert.equal(artifact.pageDiagnostics.pageErrors.total, 80);
  assert.equal(artifact.pageDiagnostics.failedResources.truncated, true);
  assert.equal(artifact.timeline.truncated, true);
  assert.equal(artifact.timeline.items[artifact.timeline.items.length - 1].type, 'scan_completed');
  assert.ok(artifact.bounds.bytes <= DIAGNOSTIC_CAPS.artifactBytes);
  const hardened = hardenReportBugArtifact(artifact);
  assert.equal(hardened.timeline.items.length, artifact.timeline.shown);
  assert.equal(hardened.timeline.truncated, true);
});

test('shared URL sanitizer strips userinfo and query values', () => {
  const safe = sanitizeUrl('https://user:pass@example.com/contact?utm_source=google&token=supersecret#section');
  assert.doesNotMatch(safe, /user:pass|supersecret|#section/);
  assert.match(safe, /example\.com\/contact/);
  assert.equal(sanitizeUrlOriginPath('https://user:pass@example.com/api/submit?email=x#private'), 'https://example.com/api/submit');
});

test('privacy: non-http URL schemes and query-like titles are excluded', () => {
  const artifact = buildBugReport({
    includeContext: true,
    report: {
      page: { url: 'https://example.com/app', title: 'Checkout ?token=secret' },
      diagnostics: { failedResources: [
        { source: 'file:///C:/Users/mike/secret.js', initiator: 'script', status: 404 },
        { source: 'data:text/javascript,alert(1)', initiator: 'script', status: 404 },
        { source: 'javascript:alert(1)', initiator: 'script', status: 404 }
      ] }
    }
  });
  const text = JSON.stringify(artifact);
  assert.doesNotMatch(text, /token=secret|file:\/\/\/|data:text\/javascript|javascript:alert/);
  assert.equal(artifact.scan.pageTitle, 'Checkout');
});

test('section reader has no full dump and rejects unknown sections', () => {
  const artifact = buildBugReport({ report: reachedReport() });
  const index = selectDiagnosticSection(artifact, 'index');
  assert.equal(index.kind, DIAGNOSTIC_KIND);
  assert.equal(index.scanStatus, 'reached');
  assert.ok(selectDiagnosticSection(artifact, 'coverage').reasons);
  assert.ok(selectDiagnosticSection(artifact, 'timeline').items);
  assert.throws(() => selectDiagnosticSection(artifact, 'full'), /Unknown diagnostic section/);
  assert.ok(diagnosticIndex(artifact).note);
  assert.equal(isReportBugArtifact({ kind: 'api-scan' }), false);
  assert.equal(isReportBugArtifact({ schema: 'web-qa-assistant-bug-report/v1' }), true);
});

test('hardened MCP read path preserves timeline coverage_degraded area names', () => {
  const report = reachedReport({
    coverage: { browser: 'complete', links: 'partial', axe: 'complete', performance: 'current-page', runtime: 'not applicable' }
  });
  report.coverageReasons = explainCoverageReasons(report);
  const artifact = buildBugReport({ report });
  const hardened = hardenReportBugArtifact(artifact);
  const timeline = selectDiagnosticSection(hardened, 'timeline');
  const degraded = timeline.items.find(e => e.type === 'coverage_degraded');
  assert.ok(degraded, 'expected coverage_degraded timeline event');
  assert.deepEqual(degraded.data.areas, ['links', 'runtime']);
  assert.doesNotMatch(JSON.stringify(degraded.data), /\[truncated\]/);
});
