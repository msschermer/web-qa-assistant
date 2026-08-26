import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  SCAN_PHASE,
  emptyResultReady,
  resultReady,
  resultReadyFromReport,
  scanProgressCopy,
  shouldRevealResults
} from '../packages/findings/scan-lifecycle.js';

function completeFlags() {
  return {
    scanCollectionComplete: true,
    primaryVerificationComplete: true,
    evidenceLedgerReady: true,
    correlationComplete: true,
    frankInitialReviewComplete: true
  };
}

test('resultReady requires collection, primary verification, ledger, correlation, and Frank', () => {
  assert.equal(resultReady(emptyResultReady()), false);
  const flags = completeFlags();
  assert.equal(resultReady(flags), true);
  for (const key of Object.keys(flags)) {
    assert.equal(resultReady({ ...flags, [key]: false }), false, key);
  }
});

test('partial subsystem completion does not reveal findings', () => {
  assert.equal(shouldRevealResults({
    phase: SCAN_PHASE.VERIFYING_LINKS,
    flags: {
      scanCollectionComplete: true,
      primaryVerificationComplete: false,
      evidenceLedgerReady: false,
      correlationComplete: false,
      frankInitialReviewComplete: false
    }
  }), false);
  assert.equal(shouldRevealResults({
    phase: SCAN_PHASE.FRANK_ANALYZING,
    flags: {
      scanCollectionComplete: true,
      primaryVerificationComplete: true,
      evidenceLedgerReady: true,
      correlationComplete: true,
      frankInitialReviewComplete: false
    }
  }), false);
  assert.equal(shouldRevealResults({
    phase: SCAN_PHASE.READY,
    flags: completeFlags()
  }), true);
});

test('limited coverage still waits for Frank before reveal', () => {
  const report = {
    findings: [{ id: 'f1' }],
    coverage: { links: 'partial' },
    linkAudit: { attempted: 80, unprobed: 54, scannerAborted: 0 },
    evidenceLedger: { groups: [], groupsOmitted: 0 },
    attention: { groups: [], materialGroupCount: 1 },
    priorityBrief: ''
  };
  assert.equal(resultReadyFromReport(report), false);
  assert.equal(shouldRevealResults({
    phase: SCAN_PHASE.READY,
    flags: {
      scanCollectionComplete: true,
      primaryVerificationComplete: true,
      evidenceLedgerReady: true,
      correlationComplete: true,
      frankInitialReviewComplete: false
    }
  }), false);
  report.priorityBrief = 'Limited coverage. Primary link verification did not finish.';
  assert.equal(resultReadyFromReport(report), true);
});

test('deterministic Frank fallback counts as initial review completeness', () => {
  const report = {
    findings: [],
    coverage: { links: 'complete' },
    linkAudit: { attempted: 12, unprobed: 0 },
    evidenceLedger: { groups: [] },
    attention: { groups: [] },
    priorityBrief: 'No material issues were confirmed on this page.',
    priorityMode: 'deterministic'
  };
  assert.equal(resultReadyFromReport(report), true);
});

test('progress copy stays non-actionable and can include link queue counts', () => {
  assert.equal(scanProgressCopy(SCAN_PHASE.DISCOVERING), 'Scanning current page…');
  assert.equal(scanProgressCopy(SCAN_PHASE.VERIFYING_LINKS, { queued: 134, completed: 78 }), 'Checking 78 of 134 links…');
  assert.equal(scanProgressCopy(SCAN_PHASE.INSPECTING_FRAMES), 'Inspecting embedded content…');
  assert.equal(scanProgressCopy(SCAN_PHASE.CORRELATING), 'Correlating findings…');
  assert.equal(scanProgressCopy(SCAN_PHASE.FRANK_ANALYZING), 'Frank is reviewing the scan…');
  assert.doesNotMatch(scanProgressCopy(SCAN_PHASE.VERIFYING_LINKS, { queued: 134, completed: 78 }), /finding|issue|recommended/i);
});

test('side panel keeps results locked until resultReady and reveals them together', () => {
  const js = fs.readFileSync('apps/extension/sidepanel.js', 'utf8');
  const css = fs.readFileSync('apps/extension/sidepanel.css', 'utf8');
  const rescanStart = js.indexOf('async function rescan()');
  const rescanEnd = js.indexOf('async function updateWatch()', rescanStart);
  const rescan = js.slice(rescanStart, rescanEnd > 0 ? rescanEnd : undefined);
  assert.match(rescan, /lockResultsUi\(\)/);
  assert.match(rescan, /revealResultsUi\(\)/);
  assert.match(rescan, /frankInitialReviewComplete/);
  assert.match(rescan, /scanPhase = SCAN_PHASE\.READY/);
  assert.match(rescan, /const r = await send\(tab\?\.id \? \{ type: 'SCAN_TAB'/);
  assert.doesNotMatch(rescan.split("const enriched")[0], /\brender\(\)/);
  assert.match(css, /data-result-ready=true/);
  assert.match(css, /\.recommendations-section/);
  assert.match(js, /Results stay hidden until the scan and Frank/);
});

test('side panel render refuses to paint findings before readiness', () => {
  const js = fs.readFileSync('apps/extension/sidepanel.js', 'utf8');
  assert.match(js, /scanInFlight && !shouldRevealResults/);
  assert.match(js, /function notice\(/);
  assert.match(js, /dataset\.resultReady = 'true'/);
});
