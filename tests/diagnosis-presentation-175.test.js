import test from 'node:test';
import assert from 'node:assert/strict';
import { presentFinding } from '../packages/presentation/present.js';
import { guidanceFor } from '../packages/frank/guidance.js';
import { linkInTextEvidence, linkInTextTitle, linkInTextDiagnosis } from '../packages/findings/link-in-text.js';
import { buildPerformanceAssessment, performanceAssessmentPresentation } from '../packages/findings/performance-assessment.js';
import { groupFindings, formatInstanceCountLabel, shouldShowHighlightNav } from '../packages/findings/compose.js';

function linkFinding({ contrastRatio, underline = false, failureSummary = '', help } = {}) {
  return {
    ruleId: 'axe.link-in-text-block',
    title: help || 'Links must be distinguishable without relying on color',
    detail: 'Element has insufficient contrast between the link text and surrounding text',
    category: 'review',
    severity: 'medium',
    confidence: 'confirmed',
    linkInText: underline === true || underline === false
      ? { persistentNonColorIndicator: underline }
      : undefined,
    axe: {
      impact: 'moderate',
      failureSummary: failureSummary || (contrastRatio != null
        ? `Element has insufficient color contrast of ${contrastRatio} between the link and surrounding text.`
        : 'Link is not distinguishable from surrounding text'),
      checks: {
        any: [{
          id: 'link-in-text-block',
          message: 'The link has insufficient color contrast from the surrounding text',
          data: contrastRatio != null ? { contrastRatio, message: 'link vs surrounding text' } : { message: 'link vs surrounding text' }
        }],
        all: [],
        none: []
      }
    }
  };
}

test('axe.link-in-text-block without underline + 1.4:1 uses concrete diagnosis, not Axe help title', () => {
  const f = linkFinding({ contrastRatio: 1.4, underline: false });
  const presented = presentFinding(f);
  assert.equal(presented.title, 'Inline link is difficult to distinguish from surrounding text');
  assert.doesNotMatch(presented.title, /Links must be distinguishable without relying on color/i);
  assert.match(presented.technicalTitle, /Links must be distinguishable without relying on color/i);
  assert.match(presented.summary, /not underlined/i);
  assert.match(presented.summary, /1\.4\s*:\s*1/i);
  assert.doesNotMatch(presented.summary, /underline and color changes are mandatory/i);
  const g = guidanceFor(f);
  assert.match(g.recommendation, /simplest fix is to add a persistent underline/i);
  assert.match(g.remediation, /3:1/i);
  assert.match(g.remediation, /hover\/focus/i);
});

test('underline present → do not claim missing underline', () => {
  const f = linkFinding({ contrastRatio: 1.4, underline: true });
  const evidence = linkInTextEvidence(f);
  assert.equal(evidence.persistentNonColorIndicator, true);
  assert.match(linkInTextDiagnosis(evidence), /underline.*present|non-color indicator is present/i);
  assert.doesNotMatch(linkInTextDiagnosis(evidence), /is not underlined/i);
  const g = guidanceFor(f);
  assert.doesNotMatch(g.interpretation, /is not underlined/i);
  assert.match(g.remediation, /underline \(or equivalent\) is already present|non-color indicator is already present|do not claim the underline is missing/i);
});

test('>=3:1 link/text difference does not falsely claim insufficient color distinction', () => {
  const f = linkFinding({ contrastRatio: 3.2, underline: false });
  const evidence = linkInTextEvidence(f);
  assert.equal(evidence.insufficientColorDistinction, false);
  assert.equal(evidence.colorDistinctionAdequate, true);
  assert.doesNotMatch(linkInTextDiagnosis(evidence), /not visually distinct enough because it relies primarily on color/i);
  assert.match(linkInTextDiagnosis(evidence), /3:1 alternative threshold|meets the 3:1/i);
});

test('performance card labels Server response (TTFB) and shows Page load only when measured', () => {
  const withLoad = buildPerformanceAssessment({
    browserPerformance: {
      available: true,
      firstContentfulPaintMs: 2300,
      largestContentfulPaintMs: 2340,
      cumulativeLayoutShift: 0.054,
      ttfbMs: 2010,
      pageLoadMs: 4820
    }
  });
  assert.equal(withLoad.metrics.pageLoad.measured, true);
  assert.equal(withLoad.metrics.pageLoad.valueMs, 4820);
  assert.match(withLoad.summary, /First content appeared slower than ideal/i);
  assert.match(withLoad.summary, /LCP and layout stability were good/i);
  assert.match(withLoad.summary, /Server response was also slow/i);
  assert.doesNotMatch(withLoad.summary, /This page needs performance attention based on lab metrics/i);
  const presented = performanceAssessmentPresentation(withLoad);
  assert.ok(presented.rows.some(r => r.key === 'Page load' && r.unrated === true));
  assert.ok(presented.diagnostics.some(r => r.key === 'Server response (TTFB)'));
  assert.ok(!presented.rows.some(r => r.key === 'Response'));
  assert.ok(!presented.diagnostics.some(r => r.key === 'Response'));

  const noLoad = buildPerformanceAssessment({
    browserPerformance: {
      available: true,
      firstContentfulPaintMs: 1500,
      largestContentfulPaintMs: 2200,
      cumulativeLayoutShift: 0.05,
      ttfbMs: 600
      // pageLoadMs omitted
    }
  });
  assert.equal(noLoad.metrics.pageLoad.measured, false);
  const presentedNoLoad = performanceAssessmentPresentation(noLoad);
  assert.ok(!presentedNoLoad.rows.some(r => r.key === 'Page load'));
  // Healthy TTFB stays out of the Diagnostics band so "Diagnostics" means attention.
  assert.ok(!presentedNoLoad.diagnostics.some(r => r.key === 'Server response (TTFB)'));
});

test('TTFB alone does not make overall performance poor', () => {
  const a = buildPerformanceAssessment({
    browserPerformance: {
      available: true,
      firstContentfulPaintMs: 1500,
      largestContentfulPaintMs: 2200,
      cumulativeLayoutShift: 0.05,
      ttfbMs: 2500,
      pageLoadMs: 4000
    }
  });
  assert.equal(a.status, 'mostly-healthy');
  assert.notEqual(a.status, 'poor');
});

test('1 instance uses singular grammar; multi keeps navigation wording', () => {
  assert.equal(formatInstanceCountLabel(1), '1 instance');
  assert.doesNotMatch(formatInstanceCountLabel(1), /1 instances/);
  assert.equal(formatInstanceCountLabel(3), '3 instances');
  assert.equal(shouldShowHighlightNav(1), false);
  assert.equal(shouldShowHighlightNav(0), false);
  assert.equal(shouldShowHighlightNav(2), true);

  const one = groupFindings([{
    id: 'a',
    ruleId: 'security.blank-opener',
    title: 'New-tab link',
    detail: 'x',
    category: 'review',
    severity: 'low',
    frankVisible: true,
    frankPriority: 'low',
    count: 1
  }]);
  assert.equal(one[0].title, 'New-tab link');
  assert.doesNotMatch(one[0].title, /1 instances/);

  const many = groupFindings([
    { id: 'a', ruleId: 'web.nested-form', title: 'Nested form', detail: 'x', category: 'review', severity: 'medium', frankVisible: true, frankPriority: 'medium', count: 1 },
    { id: 'b', ruleId: 'web.nested-form', title: 'Nested form', detail: 'y', category: 'review', severity: 'medium', frankVisible: true, frankPriority: 'medium', count: 1 }
  ]);
  assert.match(many[0].title, /2 instances/);
  assert.doesNotMatch(many[0].title, /2 instance[^s]/);
  assert.equal(shouldShowHighlightNav(many[0].size), true);
});

test('link-in-text title helper stays evidence-derived', () => {
  assert.equal(
    linkInTextTitle(linkInTextEvidence(linkFinding({ contrastRatio: 1.4, underline: false }))),
    'Inline link is difficult to distinguish from surrounding text'
  );
});
