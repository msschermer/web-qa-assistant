import test from 'node:test';
import assert from 'node:assert/strict';
import { labPerformanceReady, resolvePerformanceCoverage } from '../packages/findings/coverage.js';
import { applyFindingPolicy } from '../packages/findings/policy.js';
import { composeAttention } from '../packages/findings/compose.js';
import { guidanceFor } from '../packages/frank/guidance.js';
import { deterministicFrankPlan } from '../packages/frank/plan.js';
import { buildEvidenceGraph } from '../packages/frank/evidence.js';

test('lab performance coverage wins over connector not-monitored', () => {
  const lab = { available: true, largestContentfulPaintMs: 1200, ttfbMs: 40, transferBytes: 1000 };
  assert.equal(labPerformanceReady(lab), true);
  assert.equal(
    resolvePerformanceCoverage({ performance: 'current-page' }, lab, { status: 'complete', data: { monitored: false } }),
    'current-page'
  );
});

test('missing lab metrics become partial instead of pretending current-page is complete', () => {
  assert.equal(
    resolvePerformanceCoverage({}, { available: true }, { status: 'complete', data: { monitored: false } }),
    'partial'
  );
});

test('connector not-monitored remains when no lab evidence exists', () => {
  assert.equal(
    resolvePerformanceCoverage({}, null, { status: 'complete', data: { monitored: false } }),
    'not monitored'
  );
});

test('uncertain image-alt is material but not a blocker', () => {
  const row = applyFindingPolicy([{
    ruleId: 'axe.image-alt',
    title: 'Images must have alternative text',
    detail: 'missing alt',
    category: 'fix',
    severity: 'critical',
    confidence: 'confirmed',
    axe: { impact: 'critical' },
    semantics: { imagePurpose: { purpose: 'uncertain', confidence: 'low', signals: ['rendered at 10×10px'] } },
    count: 33
  }], { type: 'production' })[0];
  assert.equal(row.frankVisible, true);
  assert.equal(row.frankPriority, 'medium');
  assert.equal(row.severity, 'medium');
  assert.match(row.policyReason, /unresolved/i);
});

test('informative image-alt with low classifier confidence stays high materiality', () => {
  const row = applyFindingPolicy([{
    ruleId: 'axe.image-alt',
    title: 'Images must have alternative text',
    detail: 'missing alt',
    category: 'fix',
    severity: 'critical',
    confidence: 'confirmed',
    axe: { impact: 'critical' },
    semantics: { imagePurpose: { purpose: 'informative', confidence: 'low' } }
  }], { type: 'production' })[0];
  assert.equal(row.frankVisible, true);
  assert.equal(row.frankPriority, 'blocker');
});

test('sticky impactClass from older artifacts is recomputed on policy re-apply', () => {
  const row = applyFindingPolicy([{
    ruleId: 'navigation.link-404',
    title: 'Internal link points to a missing page',
    detail: '404',
    category: 'fix',
    severity: 'high',
    confidence: 'confirmed',
    impactClass: 'accessibility',
    link: { status: 404, prominence: 'navigation', url: 'https://example.com/missing' }
  }], { type: 'production' })[0];
  assert.equal(row.impactClass, 'availability');
});

test('confirmed informative image-alt remains high materiality', () => {
  const row = applyFindingPolicy([{
    ruleId: 'axe.image-alt',
    title: 'Images must have alternative text',
    detail: 'missing alt',
    category: 'fix',
    severity: 'critical',
    confidence: 'confirmed',
    axe: { impact: 'critical' },
    semantics: { imagePurpose: { purpose: 'informative', confidence: 'high' } }
  }], { type: 'production' })[0];
  assert.equal(row.frankVisible, true);
  assert.equal(row.frankPriority, 'blocker');
});

test('blank-opener is visible low-priority security and can enter Recommended Order', () => {
  const rows = applyFindingPolicy([
    { ruleId: 'security.blank-opener', title: 'New-tab link can retain opener access', detail: 'missing noopener', category: 'review', severity: 'low', confidence: 'confirmed' },
    { ruleId: 'axe.color-contrast', title: 'Contrast', detail: 'low', category: 'fix', severity: 'high', confidence: 'confirmed', axe: { impact: 'serious' } }
  ], { type: 'production' });
  const opener = rows.find(f => f.ruleId === 'security.blank-opener');
  assert.equal(opener.frankVisible, true);
  assert.equal(opener.frankPriority, 'low');
  assert.equal(opener.impactClass, 'security');
  const composition = composeAttention(rows);
  assert.ok(composition.representedClasses.includes('security'));
});

test('overlapping title and lang axe/browser pairs collapse to one attention lead each', () => {
  const rows = applyFindingPolicy([
    { ruleId: 'seo.title-missing', title: 'Page title is missing', detail: 'no title', category: 'fix', severity: 'high', confidence: 'confirmed' },
    { ruleId: 'axe.document-title', title: 'Documents must have title', detail: 'axe title', category: 'fix', severity: 'high', confidence: 'confirmed', axe: { impact: 'serious' } },
    { ruleId: 'a11y.lang-missing', title: 'Document language is missing', detail: 'no lang', category: 'fix', severity: 'medium', confidence: 'confirmed' },
    { ruleId: 'axe.html-has-lang', title: 'html must have lang', detail: 'axe lang', category: 'fix', severity: 'high', confidence: 'confirmed', axe: { impact: 'serious' } }
  ], { type: 'production' });
  assert.equal(rows.find(f => f.ruleId === 'seo.title-missing').frankVisible, true);
  assert.equal(rows.find(f => f.ruleId === 'axe.document-title').frankVisible, false);
  assert.equal(rows.find(f => f.ruleId === 'a11y.lang-missing').frankVisible, true);
  assert.equal(rows.find(f => f.ruleId === 'axe.html-has-lang').frankVisible, false);
  const composition = composeAttention(rows);
  assert.equal(composition.groups.filter(g => /title/i.test(g.title)).length, 1);
  assert.equal(composition.groups.filter(g => /lang/i.test(g.title)).length, 1);
});

test('contrast remediation stays free of raw axe failureSummary jargon', () => {
  const g = guidanceFor({
    ruleId: 'axe.color-contrast',
    title: 'contrast',
    axe: {
      failureSummary: 'Fix any of the following: Element has insufficient color contrast of 3.88 (foreground color: #41545d, background color: #a9b8bf, font size: 9.8pt (13px), font weight: bold). Expected contrast ratio of 4.5:1',
      checks: { any: [{ id: 'color-contrast', data: { fgColor: '#41545d', bgColor: '#a9b8bf', contrastRatio: 3.88, expectedContrastRatio: '4.5:1' } }], all: [], none: [] }
    }
  });
  assert.match(g.interpretation, /3\.88/);
  assert.doesNotMatch(g.remediation, /Fix any of the following/i);
  assert.doesNotMatch(g.remediation, /Expected contrast ratio of 4\.5:1/);
});

test('viewport and lang guidance include concrete interpretations', () => {
  assert.match(guidanceFor({ ruleId: 'web.viewport-missing' }).interpretation, /viewport/i);
  assert.doesNotMatch(guidanceFor({ ruleId: 'web.viewport-missing' }).interpretation, /verified evidence identifies a specific issue/i);
  assert.match(guidanceFor({ ruleId: 'a11y.lang-missing' }).interpretation, /lang/i);
});

test('uncertain image-alt Frank assessment preserves remediation uncertainty', () => {
  const finding = {
    id: 'axe.image-alt:x',
    ruleId: 'axe.image-alt',
    title: 'Images must have alternative text',
    detail: 'missing alt',
    category: 'review',
    severity: 'medium',
    confidence: 'confirmed',
    frankPriority: 'medium',
    sources: ['axe'],
    semantics: { imagePurpose: { purpose: 'uncertain', confidence: 'low', signals: ['rendered at 10×10px'], rationale: 'uncertain' } }
  };
  const graph = buildEvidenceGraph({
    finding,
    page: { url: 'https://example.com/', hostname: 'example.com', title: 'Example' },
    environment: { type: 'production', confidenceLabel: 'high' },
    coverage: { axe: 'complete' }
  });
  const plan = deterministicFrankPlan(graph);
  assert.equal(plan.assessment.status, 'review');
  assert.match(plan.assessment.statement, /unresolved image purpose/i);
});
