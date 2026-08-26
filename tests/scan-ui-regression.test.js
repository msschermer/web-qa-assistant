import test from 'node:test';
import assert from 'node:assert/strict';
import { reconcilePerformanceCoverage, limitedCoverageLabels, isStaleBuildRevision } from '../packages/findings/coverage.js';
import { buildBugReport } from '../packages/support/bug-report.js';

test('gateway not-monitored coverage cannot erase current-page lab evidence', () => {
  const reconciled = reconcilePerformanceCoverage({
    coverage: {
      browser: 'complete',
      links: 'partial',
      axe: 'complete',
      performance: 'not monitored',
      runtime: 'extension-partial'
    },
    coverageReasons: { performance: 'connector-unavailable', links: 'probe-budget-exhausted' },
    browserPerformance: {
      available: true,
      largestContentfulPaintMs: 312,
      ttfbMs: 68,
      transferBytes: 403456
    }
  });
  assert.equal(reconciled.coverage.performance, 'current-page');
  assert.equal(reconciled.coverageReasons.performance, 'connector-unavailable');
  const labels = limitedCoverageLabels(reconciled);
  assert.ok(labels.includes('historical performance unavailable'));
  assert.equal(labels.some(l => /current-page performance/i.test(l) && /fail/i.test(l)), false);
});

test('successful scan report is not marked failed when render diagnostic is present', () => {
  const artifact = buildBugReport({
    version: '1.7.4',
    buildRevision: 'a4746f47812c',
    report: {
      page: { url: 'https://www.example.com/', hostname: 'www.example.com', targetIntegrity: { state: 'reached' }, title: 'Example' },
      coverage: { browser: 'complete', performance: 'current-page', links: 'partial' },
      coverageReasons: { links: 'probe-budget-exhausted', performance: 'connector-unavailable' },
      browserPerformance: { available: true, largestContentfulPaintMs: 1200, ttfbMs: 90, transferBytes: 1000 },
      findings: [{ id: 'f1', ruleId: 'performance.browser.image-oversized', title: 'Image oversized', category: 'review', severity: 'medium', confidence: 'confirmed', frankVisible: true, impactClass: 'performance' }],
      attention: { groups: [], materialGroupCount: 1, materialFindingCount: 1, classCounts: { performance: 1 } },
      connectedMode: 'gateway',
      scanId: 'scan-ok'
    },
    lastScanAttempt: { scanId: 'scan-ok', ok: true, mode: 'current-tab' },
    lastDiagnostic: null,
    trace: [{
      type: 'sidepanel-render-failed',
      at: '2026-08-26T03:00:00.000Z',
      data: { stage: 'result-render', code: 'SIDEPANEL_RENDER_FAILED', operation: 'RENDER', recoverable: true, coverageImpact: 'none' }
    }]
  });
  assert.equal(artifact.scan.scanStatus, 'reached');
  assert.equal(artifact.environment.extensionStatus, 'ok');
  assert.equal(artifact.performance.lab.coverage, 'available');
  assert.equal(artifact.coverage.performance, 'current-page');
  assert.ok(artifact.webqaDiagnostics.items.some(e => e.code === 'SIDEPANEL_RENDER_FAILED' && e.stage === 'result-render'));
});

test('stale build hydration is recorded as recoverable diagnostic without failing the scan status', () => {
  assert.equal(isStaleBuildRevision('a4746f47812c', '84341d7cea3b'), true);
  const artifact = buildBugReport({
    version: '1.7.4',
    buildRevision: 'a4746f47812c',
    report: {
      page: { url: 'https://www.example.com/', hostname: 'www.example.com', targetIntegrity: { state: 'reached' } },
      coverage: { browser: 'complete', performance: 'current-page' },
      browserPerformance: { available: true, largestContentfulPaintMs: 900 },
      findings: [],
      attention: { groups: [], materialGroupCount: 0, materialFindingCount: 0, classCounts: {} },
      connectedMode: 'gateway',
      scanId: 'scan-2'
    },
    lastScanAttempt: { scanId: 'scan-2', ok: true },
    trace: [{
      type: 'hydration-stale-build',
      data: { stage: 'hydration', code: 'STALE_BUILD_REVISION', operation: 'RESTORE_WORKSPACE', recoverable: true, coverageImpact: 'none' }
    }]
  });
  assert.equal(artifact.scan.scanStatus, 'reached');
  assert.ok(artifact.webqaDiagnostics.items.some(e => e.code === 'STALE_BUILD_REVISION' && e.stage === 'hydration'));
});

test('completed scan cannot be classified failed solely because historical monitor is unavailable', () => {
  const artifact = buildBugReport({
    version: '1.7.4',
    report: {
      page: { url: 'https://www.example.com/', hostname: 'www.example.com', targetIntegrity: { state: 'reached' } },
      coverage: { browser: 'complete', links: 'partial', axe: 'complete', performance: 'current-page', published: 'complete', runtime: 'extension-partial' },
      coverageReasons: { links: 'probe-budget-exhausted', performance: 'connector-unavailable', runtime: 'runtime-partial-in-extension' },
      browserPerformance: { available: true, largestContentfulPaintMs: 312, ttfbMs: 68, transferBytes: 403456 },
      findings: [{ id: 'img', ruleId: 'performance.browser.image-oversized', category: 'review', severity: 'medium', confidence: 'confirmed', frankVisible: true }],
      attention: { groups: [], materialGroupCount: 1, materialFindingCount: 1, classCounts: { performance: 1 } },
      connectedMode: 'gateway'
    },
    lastScanAttempt: { ok: true, scanId: 'scan-n' },
    lastDiagnostic: null
  });
  assert.equal(artifact.scan.scanStatus, 'reached');
  assert.notEqual(artifact.scan.scanStatus, 'failed');
  assert.equal(artifact.environment.extensionStatus, 'ok');
  assert.equal(artifact.webqaDiagnostics.total, 0);
});
