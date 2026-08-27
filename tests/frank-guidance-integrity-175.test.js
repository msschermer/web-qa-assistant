import test from 'node:test';
import assert from 'node:assert/strict';
import { buildBugReport } from '../packages/support/bug-report.js';
import { emptyFrankReview, frankReviewFromSession, scanGuidanceSource } from '../packages/frank/review-state.js';
import { buildPublishedCoverage } from '../packages/environment/published-coverage.js';
import { buildIndexControl, indexControlNoticeCopy } from '../packages/environment/index-control.js';
import { guidanceFor } from '../packages/frank/guidance.js';
import { buildEvidenceGraph } from '../packages/frank/evidence.js';
import { deterministicFrankPlan } from '../packages/frank/plan.js';
import { composeFixStepBody, collapseAdjacentDuplicateSentences } from '../packages/findings/guidance-composition.js';
import { mergeLocalFrankGuidance } from '../apps/extension/local-ai.js';
import { linkInTextRemediation, linkInTextEvidence } from '../packages/findings/link-in-text.js';
import { explainCoverageReasons } from '../packages/findings/coverage.js';

function linkFinding() {
  return {
    id: 'axe.link-in-text-block:1',
    ruleId: 'axe.link-in-text-block',
    title: 'Links must be distinguishable without relying on color',
    detail: 'Element has insufficient contrast between the link text and surrounding text',
    category: 'review',
    severity: 'medium',
    confidence: 'confirmed',
    selector: 'p a',
    targetType: 'visual',
    targetId: 'target_link',
    sources: ['axe'],
    linkInText: { persistentNonColorIndicator: false },
    axe: {
      impact: 'moderate',
      failureSummary: 'Element has insufficient color contrast of 1.4 between the link and surrounding text.',
      checks: {
        any: [{ id: 'link-in-text-block', data: { contrastRatio: 1.4 } }],
        all: [],
        none: []
      }
    }
  };
}

test('36 ready model + successful review reports frank-model', () => {
  const review = frankReviewFromSession({
    modelReadiness: 'ready',
    requested: true,
    started: true,
    completed: true,
    source: 'frank-model',
    plan: { mode: 'ai', guidanceSource: 'frank-model' }
  });
  assert.equal(review.source, 'frank-model');
  assert.equal(scanGuidanceSource({ frankReview: review, hasVisibleGuidance: true }), 'frank-model');
});

test('36 ready model + failed review falls back to deterministic', () => {
  const review = frankReviewFromSession({
    modelReadiness: 'ready',
    requested: true,
    started: true,
    completed: false,
    failed: true,
    source: 'deterministic',
    failureReason: 'LOCAL_AI_UNAVAILABLE'
  });
  assert.equal(review.source, 'deterministic');
  assert.equal(review.failureReason, 'LOCAL_AI_UNAVAILABLE');
  assert.equal(scanGuidanceSource({ frankReview: review, hasVisibleGuidance: true }), 'deterministic');
});

test('36 downloading model still uses deterministic visible guidance', () => {
  const review = emptyFrankReview({ modelReadiness: 'downloading', reason: 'not-requested' });
  assert.equal(review.source, 'none');
  assert.equal(scanGuidanceSource({
    frankReview: review,
    hasVisibleGuidance: true,
    coverageAi: 'deterministic'
  }), 'deterministic');
});

test('36 ready model without a requested review is not frank-model', () => {
  const review = emptyFrankReview({ modelReadiness: 'ready', reason: 'not-requested' });
  assert.equal(review.requested, false);
  assert.equal(review.source, 'none');
  const artifact = buildBugReport({
    version: '1.7.5',
    readiness: { status: 'ready' },
    report: {
      priorityBrief: 'Fix the inline link contrast first.',
      priorityMode: 'deterministic',
      coverage: { ai: 'deterministic', published: 'unavailable', links: 'complete' },
      frankReview: review
    }
  });
  assert.equal(artifact.guidance.source, 'deterministic');
  assert.notEqual(artifact.guidance.source, 'unavailable');
  assert.equal(artifact.frankReview.source, 'none');
  assert.equal(artifact.frankReview.requested, false);
  assert.equal(artifact.environment.modelReadiness, 'ready');
});

test('36 AI priority brief without Ask Frank is not frank-model', () => {
  const review = emptyFrankReview({ modelReadiness: 'ready', reason: 'not-requested' });
  assert.equal(scanGuidanceSource({
    frankReview: review,
    hasVisibleGuidance: true,
    priorityMode: 'ai',
    coverageAi: 'complete'
  }), 'deterministic');
  const artifact = buildBugReport({
    version: '1.7.5',
    readiness: { status: 'ready' },
    report: {
      priorityBrief: 'Cloud-ranked brief.',
      priorityMode: 'ai',
      coverage: { ai: 'complete' },
      frankReview: review
    }
  });
  assert.equal(artifact.guidance.source, 'deterministic');
  assert.equal(artifact.frankReview.source, 'none');
});

test('37 published coverage records complete vs unavailable with reason', () => {
  const complete = buildPublishedCoverage({
    coverage: { published: 'complete' },
    connectedMode: 'gateway',
    attempted: true,
    latencyMs: 120
  });
  assert.equal(complete.status, 'complete');
  assert.equal(complete.attempted, true);

  const timeout = buildPublishedCoverage({
    coverage: { published: 'unavailable' },
    connectedMode: 'gateway',
    enrichmentError: 'meta-state timed out',
    attempted: true,
    latencyMs: 8000
  });
  assert.equal(timeout.status, 'unavailable');
  assert.match(timeout.reason, /timed out/i);

  const missing = buildPublishedCoverage({
    coverage: { published: 'unavailable' },
    connectedMode: 'gateway',
    attempted: true,
    context: { meta: { status: 'complete' } }
  });
  assert.equal(missing.status, 'unavailable');
  assert.equal(missing.reason, 'published-snapshot-missing');

  const reasons = explainCoverageReasons({ coverage: { published: 'unavailable' } });
  assert.equal(reasons.published, 'connector-unavailable');
});

test('37 rendered-only index notice names checked vs unavailable sources', () => {
  const control = buildIndexControl({ page: { robots: 'index,follow' } });
  assert.ok(control.checkedScope.checked.includes('rendered robots'));
  assert.ok(control.checkedScope.unavailable.includes('published HTML'));
  assert.ok(control.checkedScope.unavailable.includes('HTTP X-Robots-Tag'));
  const notice = indexControlNoticeCopy(control, { type: 'staging' });
  assert.match(notice.body, /Checked:/);
  assert.match(notice.body, /Not checked in this scan:/);
  assert.doesNotMatch(notice.body, /published response confirmed indexable/i);
});

test('37 Frank preserves published-coverage uncertainty on noindex', () => {
  const g = guidanceFor(
    { ruleId: 'seo.noindex', title: 'noindex', detail: 'noindex' },
    { type: 'production', publishedCoverage: { status: 'unavailable', reason: 'meta-state-missing' } }
  );
  assert.match(g.interpretation, /published-response checks were unavailable/);
  assert.match(g.interpretation, /published HTML was not retrieved/);
  assert.doesNotMatch(g.interpretation, /meta-state-missing/);
  assert.match(g.interpretation, /noindex \(or equivalent\) directive/);
  assert.doesNotMatch(g.verify, /confirm Browser, Meta State/);
  assert.match(g.verify, /do not require Meta State/i);
});

test('37 canonical and robots unpublished coverage do not invent an index directive', () => {
  const canonical = guidanceFor(
    { ruleId: 'seo.canonical-missing', title: 'canonical missing', detail: 'missing' },
    { type: 'production', publishedCoverage: { status: 'unavailable', reason: 'meta-state-missing' } }
  );
  assert.match(canonical.interpretation, /canonical observation is from the rendered page/);
  assert.doesNotMatch(canonical.interpretation, /index directive/);
  const robots = guidanceFor(
    { ruleId: 'seo.robots-block-all', title: 'robots block all', detail: 'Disallow: /' },
    { type: 'production', publishedCoverage: { status: 'unavailable', reason: 'meta-state-missing' } }
  );
  assert.match(robots.interpretation, /robots observation is from the sources Web QA checked/);
  assert.doesNotMatch(robots.interpretation, /index directive/);
  assert.doesNotMatch(robots.verify, /rescan with Meta State/);
  assert.match(robots.verify, /do not require Meta State/i);
});

test('38 link-in-text remediation does not duplicate the primary sentence', () => {
  const evidence = linkInTextEvidence(linkFinding());
  const rem = linkInTextRemediation(evidence);
  const composed = composeFixStepBody(rem);
  const needle = /The simplest fix is to add a persistent underline\./g;
  assert.equal([...String(rem.recommendation).matchAll(needle)].length, 1);
  assert.equal([...String(rem.remediation).matchAll(needle)].length, 0);
  assert.equal([...composed.matchAll(needle)].length, 1);
  assert.equal(collapseAdjacentDuplicateSentences(`${rem.recommendation} ${rem.recommendation}`), rem.recommendation);

  const finding = linkFinding();
  const graph = buildEvidenceGraph({
    finding,
    page: { url: 'https://example.com/page', hostname: 'example.com' },
    environment: { type: 'production', confidence: 0.9, confidenceLabel: 'high' },
    coverage: { axe: 'complete' },
    targetContext: { found: true, tag: 'a', selector: 'p a', markup: '<a href="/">Learn more</a>', text: 'Learn more' }
  });
  const plan = deterministicFrankPlan(graph);
  const joined = plan.steps.map(s => s.body).join(' ');
  assert.equal([...joined.matchAll(needle)].length, 1);
  const byId = Object.fromEntries(plan.steps.map(s => [s.id, s.body]));
  assert.doesNotMatch(byId.read, /simplest fix is to add a persistent underline/i);
  assert.match(byId.fix, /simplest fix is to add a persistent underline/i);
  assert.doesNotMatch(byId.impact, /simplest fix is to add a persistent underline/i);
  assert.doesNotMatch(byId.verify, /simplest fix is to add a persistent underline/i);
  const g = guidanceFor(finding);
  assert.equal(g.guidanceComposition.adapter, 'structured-remediation');
});

test('38 on-device merge collapses duplicate adjacent remediation sentences', () => {
  const sentence = 'The simplest fix is to add a persistent underline.';
  const merged = mergeLocalFrankGuidance(
    { mode: 'deterministic', steps: [{ id: 'fix', type: 'remediation', body: sentence }] },
    { summary: 'Fix the link.', interpretation: 'The link is hard to see.', impact: 'People can miss it.', remediation: `${sentence} ${sentence}`, verification: 'Rescan.' }
  );
  assert.equal(merged.mode, 'ai');
  assert.equal([...merged.steps[0].body.matchAll(/The simplest fix is to add a persistent underline\./g)].length, 1);
});
