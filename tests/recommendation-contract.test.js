import test from 'node:test';
import assert from 'node:assert/strict';
import { guidanceFor } from '../packages/frank/guidance.js';
import { deterministicFrankPlan, validateFrankPlan, FRANK_STEP_TYPES } from '../packages/frank/plan.js';
import { buildEvidenceGraph } from '../packages/frank/evidence.js';

function imageFinding(imagePurpose) {
  return {
    id: 'axe.image-alt:1', ruleId: 'axe.image-alt', title: 'Images must have alternative text',
    detail: 'An image has no alt attribute.', category: 'fix', severity: 'high', confidence: 'confirmed',
    selector: 'img.check-icon', targetId: 'target_abc', targetType: 'visual', sources: ['axe'], wcag: ['1.1.1'],
    axe: { impact: 'critical', failureSummary: 'Fix any of the following: Element does not have an alt attribute' },
    semantics: imagePurpose ? { imagePurpose, naming: { role: '', ariaLabel: '', parentTag: 'div', parentClass: 'verified-badge', interactiveAncestor: '' } } : null
  };
}
const DECORATIVE = {
  purpose: 'decorative', confidence: 'high',
  rationale: 'The adjacent text already communicates this.',
  signals: ['file name or class identifies this as an icon', 'adjacent visible text reads "Verified"'],
  recommendedAlt: '', descriptor: { siblingText: 'Verified' }
};

test('a resolved decorative image produces one recommendation, not a fork', () => {
  const g = guidanceFor(imageFinding(DECORATIVE));
  assert.match(g.interpretation, /Verified/);
  assert.match(g.recommendation, /alt=""/);
  assert.doesNotMatch(g.recommendation, /\bor\b.*decorative/i);
  // The old build said "add alt text OR use empty alt". That fork is the defect.
  assert.doesNotMatch(g.remediation, /Add concise alternative text for meaningful images/);
  assert.ok(g.alternatives.length > 0, 'the rejected branch is still explained, just not offered as a choice');
});

test('an unresolved image keeps the fork, because the evidence genuinely allows both', () => {
  const g = guidanceFor(imageFinding({ purpose: 'uncertain', confidence: 'low', signals: [], recommendedAlt: null }));
  assert.match(g.interpretation, /does not settle/i);
  assert.match(g.remediation, /If the image conveys/i);
  assert.match(g.remediation, /alt=""/);
});

test('a functional image is never told to use an empty alt', () => {
  const g = guidanceFor(imageFinding({ purpose: 'functional', confidence: 'high', signals: [], recommendedAlt: null }));
  assert.match(g.recommendation, /describes what it does/i);
  assert.doesNotMatch(g.recommendation, /alt=""/);
  assert.match(g.alternatives, /not an option/i);
});

test('an image finding with no semantic context degrades to the fork rather than guessing', () => {
  const g = guidanceFor(imageFinding(null));
  assert.match(g.remediation, /If the image conveys/i);
});

test('every guidance result carries the full recommendation contract', () => {
  for (const finding of [
    imageFinding(DECORATIVE),
    { ruleId: 'navigation.link-404', link: { text: 'Contact', location: 'navigation', occurrences: 2 } },
    { ruleId: 'seo.noindex' },
    { ruleId: 'performance.browser.lcp' },
    { ruleId: 'something.unmapped' }
  ]) {
    const g = guidanceFor(finding, { type: 'production' });
    for (const key of ['interpretation', 'impact', 'recommendation', 'remediation', 'verify']) {
      assert.ok(typeof g[key] === 'string', `${finding.ruleId} is missing ${key}`);
    }
    assert.ok(g.interpretation.length > 0, `${finding.ruleId} has an empty interpretation`);
  }
});

test('the deterministic plan leads with interpretation and always ends verifiable', () => {
  const graph = buildEvidenceGraph({
    finding: imageFinding(DECORATIVE),
    page: { url: 'https://example.com/', hostname: 'example.com' },
    environment: { type: 'production', confidenceLabel: 'high' },
    targetContext: { found: true, tag: 'img', markup: '<img class="check-icon">', text: '', rect: { width: 32, height: 32 }, styles: {} }
  });
  const plan = deterministicFrankPlan(graph);
  assert.ok(FRANK_STEP_TYPES.includes('interpretation'));
  const types = plan.steps.map(s => s.type);
  assert.ok(types.includes('interpretation'), 'Frank must say what the element is doing before recommending a change');
  assert.ok(types.indexOf('interpretation') < types.indexOf('remediation'));
  assert.equal(types.at(-1), 'verification');
  assert.ok(plan.steps.length <= 8);
  assert.ok(validateFrankPlan(plan, graph));
});

test('semantic evidence reaches the graph so the recommendation is auditable', () => {
  const graph = buildEvidenceGraph({
    finding: imageFinding(DECORATIVE),
    page: { url: 'https://example.com/', hostname: 'example.com' },
    environment: { type: 'production' },
    targetContext: { found: true, tag: 'img', markup: '<img class="check-icon">', text: '', rect: { width: 32, height: 32 }, styles: {} }
  });
  const kinds = graph.evidence.map(e => e.kind);
  assert.ok(kinds.includes('image-purpose'));
  assert.ok(kinds.includes('nearby-text'));
  const purpose = graph.evidence.find(e => e.kind === 'image-purpose');
  assert.equal(purpose.value, 'decorative');
  assert.equal(purpose.source, 'browser', 'the purpose verdict is deterministic browser evidence, not an AI claim');
});

test('browser performance evidence is labelled as a lab observation', () => {
  const graph = buildEvidenceGraph({
    finding: {
      id: 'p', ruleId: 'performance.browser.lcp', title: 'Slow LCP', detail: 'LCP 5.2s',
      category: 'review', confidence: 'inferred', sources: ['browser-performance'],
      performanceObservation: { available: true, ttfbMs: 400, largestContentfulPaintMs: 5200, transferBytes: 2097152, resourceCount: 80, heaviest: [] }
    },
    page: { url: 'https://example.com/', hostname: 'example.com' },
    environment: { type: 'production' }
  });
  const measurement = graph.evidence.find(e => e.kind === 'measurement-type');
  assert.ok(measurement, 'performance evidence must state how it was measured');
  assert.match(String(measurement.value), /lab observation/i);
});
