import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  BENCHMARK_EVAL_VERSION,
  ROOT_CAUSES,
  aggregateBenchmark,
  classifyFailureRootCause,
  finalizeBenchmarkReport,
  resolveCorpusPages,
  summarizeBenchmarkPage
} from '../packages/findings/benchmark-eval.js';
import { resultReadyFromReport } from '../packages/findings/scan-lifecycle.js';

const corpus = JSON.parse(fs.readFileSync('fixtures/benchmark-corpus/corpus.json', 'utf8'));

function baseReport(overrides = {}) {
  return {
    findings: [
      {
        id: 'nav.broken:1',
        ruleId: 'navigation.link-broken',
        title: 'Broken current-page link',
        category: 'fix',
        severity: 'high',
        confidence: 'confirmed',
        impactClass: 'navigation',
        selector: 'a.dead',
        evidence: 'HTTP 404'
      },
      {
        id: 'axe.button:1',
        ruleId: 'axe.button-name',
        title: 'Buttons must have discernible text',
        category: 'fix',
        severity: 'critical',
        confidence: 'confirmed',
        impactClass: 'accessibility',
        selector: 'button',
        evidence: 'empty name'
      }
    ],
    coverage: { links: 'complete', browser: 'complete', axe: 'complete', performance: 'current-page' },
    linkAudit: {
      discovered: 4,
      eligible: 4,
      attempted: 4,
      checked: 4,
      verifiedHealthy: 3,
      confirmedIssues: 1,
      inconclusive: 0,
      unprobed: 0,
      explicitlySkipped: 0,
      scannerAborted: 0,
      inconclusiveByCause: {},
      privilegedFallback: { eligible: 0, attempted: 0, notAttempted: 0, stillInconclusive: 0, truncated: false },
      refinement: { eligible: 0, attempted: 0, notAttempted: 0, stillInconclusive: 0, truncated: false, resolvedHealthy: 0, resolvedBroken: 0, budgetAborted: 0 }
    },
    page: {
      url: 'http://127.0.0.1/corpus/news-hub.html',
      inventory: { links: 8, uniqueLinks: 8, images: 0, iframes: 0, forms: 1, buttons: 2, headings: 2 },
      embeddedCoverage: {
        framesDiscovered: 0,
        sameOriginEligible: 0,
        sameOriginAttempted: 0,
        sameOriginFramesChecked: 0,
        sameOriginUnprobed: 0,
        crossOriginFramesNotInspectable: 0
      }
    },
    interactionCoverage: {
      candidates: 2,
      eligible: 1,
      tested: 1,
      passed: 1,
      failed: 0,
      inconclusive: 0,
      skippedUnsafe: 0,
      skippedIneligible: 1,
      skippedSafetyPolicy: 0,
      notApplicable: 0
    },
    scanTimings: { discoveryMs: 40, frameInspectionMs: 5, interactionMs: 12, totalMs: 80 },
    ...overrides
  };
}

test('corpus has 12 local pages and optional live controls within the 10–15 page window', () => {
  const local = resolveCorpusPages(corpus, { origin: 'http://127.0.0.1:9', includeLive: false });
  const all = resolveCorpusPages(corpus, { origin: 'http://127.0.0.1:9', includeLive: true });
  assert.equal(local.length, 12);
  assert.ok(all.length >= 12 && all.length <= 15);
  assert.ok(local.every((p) => p.url.startsWith('http://127.0.0.1:9/')));
  assert.ok(all.some((p) => p.id === 'example-com' && p.live));
  assert.equal(local.some((p) => p.live), false);
});

test('finalizeBenchmarkReport attaches ledger, attention, and a Frank brief', () => {
  const finalized = finalizeBenchmarkReport(baseReport());
  assert.equal(typeof finalized.priorityBrief, 'string');
  assert.ok(finalized.priorityBrief.length > 0);
  assert.ok(finalized.evidenceLedger);
  assert.equal(finalized.evidenceLedger.groupsOmitted, 0);
  assert.ok(Array.isArray(finalized.attention.groups));
  assert.equal(resultReadyFromReport(finalized), true);
});

test('summarizeBenchmarkPage records completion, accounting, inventory, and Frank representation', () => {
  const finalized = finalizeBenchmarkReport(baseReport());
  const row = summarizeBenchmarkPage(finalized, {
    id: 'news-hub',
    url: 'http://127.0.0.1/corpus/news-hub.html',
    elapsedMs: 1200
  });
  assert.equal(row.evalVersion, BENCHMARK_EVAL_VERSION);
  assert.equal(row.scanComplete, true);
  assert.equal(row.resultReady, true);
  assert.equal(row.accountingOk, true);
  assert.equal(row.inventory.links, 8);
  assert.equal(row.links.attempted, 4);
  assert.equal(row.links.confirmedIssues, 1);
  assert.equal(row.links.pending, 0);
  assert.equal(row.frank.groupsOmitted, 0);
  assert.equal(row.failures.length, 0);
});

test('summarizeBenchmarkPage reads iframe disclosure status and confirmedBroken', () => {
  const finalized = finalizeBenchmarkReport(baseReport({
    interactionCoverage: {
      candidates: 2,
      eligible: 1,
      tested: 1,
      passed: 1,
      failed: 0,
      inconclusive: 0,
      skippedUnsafe: 0,
      skippedIneligible: 1,
      skippedSafetyPolicy: 0,
      notApplicable: 0,
      iframeDisclosures: 'tested'
    },
    linkAudit: {
      discovered: 4,
      eligible: 4,
      attempted: 4,
      checked: 4,
      verifiedHealthy: 3,
      confirmedIssues: 1,
      inconclusive: 0,
      unprobed: 0,
      explicitlySkipped: 0,
      scannerAborted: 0,
      inconclusiveByCause: {},
      primaryLinkMs: 88,
      privilegedFallback: { eligible: 0, attempted: 0, notAttempted: 0, stillInconclusive: 0, truncated: false },
      refinement: { eligible: 0, attempted: 0, notAttempted: 0, stillInconclusive: 0, truncated: false, resolvedHealthy: 0, resolvedBroken: 0, budgetAborted: 0 }
    }
  }));
  const row = summarizeBenchmarkPage(finalized, { id: 'frames' });
  assert.equal(row.frames.disclosures, 'tested');
  assert.equal(row.links.confirmedIssues, 1);
  assert.equal(row.scanTimings.linkProbeMs, 88);
});

test('inventory vs none_checked empty audit is scan-incomplete', () => {
  const row = summarizeBenchmarkPage({
    findings: [],
    coverage: { links: 'none_checked' },
    linkAudit: {
      discovered: 0, eligible: 0, attempted: 0, checked: 0,
      verifiedHealthy: 0, confirmedIssues: 0, inconclusive: 0, unprobed: 0, explicitlySkipped: 0
    },
    page: { inventory: { links: 90, uniqueLinks: 90 } },
    attention: { groups: [], materialGroupCount: 0, allGroupCount: 0 },
    evidenceLedger: { groups: [], groupsOmitted: 0, uiShown: 0, materialGroupCount: 0 },
    priorityBrief: 'Quiet page.'
  }, { id: 'skipped-audit' });
  assert.equal(row.scanComplete, false);
  assert.ok(row.failures.some((f) => f.code === 'scan_incomplete'));
});

test('independent ledger group count detects omitted groups even when the flag is zero', () => {
  const finalized = finalizeBenchmarkReport(baseReport());
  finalized.attention = { ...finalized.attention, allGroupCount: 11 };
  finalized.evidenceLedger = {
    ...finalized.evidenceLedger,
    groups: (finalized.evidenceLedger.groups || []).slice(0, 1),
    groupsOmitted: 0,
    truncated: false,
    materialGroupCount: 11
  };
  const row = summarizeBenchmarkPage(finalized, { id: 'omitted' });
  assert.ok(row.frank.groupsOmitted > 0);
  assert.ok(row.failures.some((f) => f.code === 'frank_groups_omitted'));
});

test('incomplete pipeline is result-not-ready, not a silent pass', () => {
  const row = summarizeBenchmarkPage({
    findings: [],
    coverage: { links: 'pending' }
  }, { id: 'broken' });
  assert.equal(row.scanComplete, false);
  assert.equal(row.resultReady, false);
  assert.ok(row.failures.some((f) => f.code === 'result_not_ready'));
  assert.ok(row.failures.some((f) => f.rootCause === ROOT_CAUSES.RESULT_NOT_READY));
});

test('accounting mismatch is grouped as accounting-invalid', () => {
  const finalized = finalizeBenchmarkReport(baseReport({
    linkAudit: {
      discovered: 4,
      eligible: 4,
      attempted: 2,
      checked: 2,
      verifiedHealthy: 3,
      confirmedIssues: 1,
      inconclusive: 0,
      unprobed: 0,
      explicitlySkipped: 0,
      scannerAborted: 0,
      inconclusiveByCause: {},
      privilegedFallback: { eligible: 0, attempted: 0, notAttempted: 0, stillInconclusive: 0, truncated: false },
      refinement: { eligible: 0, attempted: 0, notAttempted: 0, stillInconclusive: 0, truncated: false, resolvedHealthy: 0, resolvedBroken: 0, budgetAborted: 0 }
    }
  }));
  const row = summarizeBenchmarkPage(finalized, { id: 'acct' });
  assert.equal(row.accountingOk, false);
  assert.ok(row.failures.some((f) => f.code === 'accounting_invalid'));
  assert.equal(classifyFailureRootCause('accounting_invalid'), ROOT_CAUSES.ACCOUNTING_INVALID);
});

test('omitted Frank groups are a ledger completeness failure', () => {
  const finalized = finalizeBenchmarkReport(baseReport());
  finalized.evidenceLedger = { ...finalized.evidenceLedger, groupsOmitted: 4, truncated: true };
  const row = summarizeBenchmarkPage(finalized, { id: 'frank' });
  assert.ok(row.failures.some((f) => f.code === 'frank_groups_omitted'));
  assert.ok(row.failures.some((f) => f.rootCause === ROOT_CAUSES.FRANK_LEDGER_INCOMPLETE));
});

test('aggregateBenchmark groups failures by root cause', () => {
  const summary = aggregateBenchmark([
    summarizeBenchmarkPage(null, { id: 'a', fatal: { message: 'boom', code: 'fatal_error' } }),
    summarizeBenchmarkPage(finalizeBenchmarkReport(baseReport()), { id: 'b', elapsedMs: 50 })
  ], { buildRevision: 'b7c15d01ddde' });
  assert.equal(summary.pageCount, 2);
  assert.equal(summary.failedPageCount, 1);
  assert.equal(summary.buildRevision, 'b7c15d01ddde');
  assert.ok(summary.failuresByRootCause[ROOT_CAUSES.FATAL_SCAN].length >= 1);
  assert.equal(summary.failuresByRootCause[ROOT_CAUSES.ACCOUNTING_INVALID].length, 0);
});

test('fixture HTML files exist for every local corpus path', () => {
  const local = resolveCorpusPages(corpus, { origin: 'http://127.0.0.1:9', includeLive: false });
  for (const page of local) {
    const rel = page.url.replace('http://127.0.0.1:9', '');
    const file = rel.startsWith('/qa-matrix/')
      ? `fixtures/qa-matrix/${rel.slice('/qa-matrix/'.length)}`
      : `fixtures/benchmark-corpus/${rel.slice('/corpus/'.length)}`;
    assert.equal(fs.existsSync(file), true, file);
  }
});
