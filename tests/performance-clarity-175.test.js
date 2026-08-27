import test from 'node:test';
import assert from 'node:assert/strict';
import { buildPerformanceAssessment } from '../packages/findings/performance-assessment.js';
import { applyFindingPolicy } from '../packages/findings/policy.js';
import { guidanceFor } from '../packages/frank/guidance.js';
import { deterministicFrankPlan } from '../packages/frank/plan.js';
import { buildEvidenceGraph } from '../packages/frank/evidence.js';
import { gatewayFrankGraph } from '../packages/ai/evidence-contract.js';
import {
  attachEnvironmentContext,
  publishedIndexSignalsFromFindings,
  reconcileIndexControlWithFindings,
  buildIndexControl
} from '../packages/environment/classify.js';

function lab(signals = {}) {
  return {
    available: true,
    measurement: 'lab',
    ttfbMs: signals.ttfbMs,
    firstContentfulPaintMs: signals.fcpMs,
    largestContentfulPaintMs: signals.lcpMs,
    cumulativeLayoutShift: signals.cls,
    lcpElement: signals.lcpElement || null,
    resourceMix: signals.resourceMix || { img: signals.imgCount || 0 },
    heaviest: signals.heaviest || [],
    imageTimings: signals.imageTimings || []
  };
}

test('performance A: healthy when LCP/CLS/FCP good and TTFB good', () => {
  const a = buildPerformanceAssessment({
    browserPerformance: lab({ lcpMs: 2200, cls: 0.05, fcpMs: 1500, ttfbMs: 600 })
  });
  assert.equal(a.status, 'healthy');
  assert.equal(a.metrics.inp.measured, false);
  assert.equal(a.metrics.inp.reasonIfUnavailable, 'no-interaction-sample');
});

test('performance B: mostly-healthy with slow TTFB diagnostic only', () => {
  const a = buildPerformanceAssessment({
    browserPerformance: lab({ lcpMs: 2416, cls: 0.054, fcpMs: 1600, ttfbMs: 2086 }),
    environment: { type: 'staging' }
  });
  assert.equal(a.status, 'mostly-healthy');
  assert.equal(a.ttfbPresentation, 'diagnostic');
  assert.ok(a.diagnosticObservations.some(x => x.id === 'ttfb'));
  assert.ok(!a.actionableIssues.some(x => x.id === 'ttfb'));
  assert.match(a.summary, /mostly healthy|Server response was slow/i);
});

test('performance C: poor LCP is actionable even with good TTFB', () => {
  const a = buildPerformanceAssessment({
    browserPerformance: lab({ lcpMs: 5200, cls: 0.05, fcpMs: 1400, ttfbMs: 400 })
  });
  assert.equal(a.status, 'poor');
  assert.ok(a.actionableIssues.some(x => x.id === 'lcp'));
});

test('performance D: slow FCP+LCP+TTFB elevates TTFB to supporting actionable', () => {
  const a = buildPerformanceAssessment({
    browserPerformance: lab({ lcpMs: 4500, cls: 0.12, fcpMs: 2500, ttfbMs: 2100 })
  });
  assert.ok(['needs-attention', 'poor'].includes(a.status));
  assert.equal(a.ttfbPresentation, 'recommended');
  assert.ok(a.actionableIssues.some(x => x.id === 'ttfb'));
});

test('performance E/F: INP unavailable and missing FCP not inferred', () => {
  const a = buildPerformanceAssessment({
    browserPerformance: lab({ lcpMs: 2000, cls: 0.04, ttfbMs: 500 })
  });
  assert.equal(a.metrics.fcp.measured, false);
  assert.equal(a.metrics.inp.measured, false);
  assert.notEqual(a.metrics.fcp.rating, 'good');
});

test('image delivery: oversized counts as issue; opaque timing is not called fast', () => {
  const oversizedFinding = {
    ruleId: 'performance.browser.image-oversized',
    imageMetrics: { magnitude: 'meaningful', srcsetPresent: false, responsiveSourcePresent: false }
  };
  const withIssue = buildPerformanceAssessment({
    browserPerformance: lab({ lcpMs: 2000, cls: 0.04, fcpMs: 1200, ttfbMs: 400, imgCount: 3 }),
    findings: [oversizedFinding]
  });
  assert.equal(withIssue.imageDelivery.assessment, 'issues-detected');
  assert.equal(withIssue.imageDelivery.oversizedCount, 1);

  const opaque = buildPerformanceAssessment({
    browserPerformance: lab({
      lcpMs: 2000, cls: 0.04, fcpMs: 1200, ttfbMs: 400, imgCount: 2,
      imageTimings: [{ name: 'https://cdn.example.com/x.jpg', durationMs: 0, transferSize: 0, transferSizeObservable: false, timingVisible: false }]
    })
  });
  assert.notEqual(opaque.imageDelivery.assessment, 'healthy-observed');
  assert.doesNotMatch(JSON.stringify(opaque.imageDelivery), /"fast"/i);
});

test('LCP image context is retained in assessment metrics', () => {
  const a = buildPerformanceAssessment({
    browserPerformance: lab({
      lcpMs: 2600, cls: 0.04, fcpMs: 1400, ttfbMs: 500,
      lcpElement: { tag: 'img', selector: 'img.hero', url: 'https://example.com/hero.jpg' }
    })
  });
  assert.equal(a.metrics.lcp.elementType, 'img');
  assert.equal(a.metrics.lcp.resourceUrl, 'https://example.com/hero.jpg');
});

test('TTFB guidance has no markup/SEO-plugin remediation', () => {
  const g = guidanceFor({
    ruleId: 'performance.browser.ttfb',
    performanceObservation: { ttfbMs: 2090 },
    remediationContext: { platform: 'wordpress', platformConfidence: 'high' }
  });
  const text = `${g.interpretation} ${g.remediation} ${g.verify}`;
  assert.doesNotMatch(text, /markup|SEO plugin layer|emits this markup|patching a single rendered page/i);
  assert.match(g.interpretation, /Server response \(TTFB\) was 2090ms/i);
});

test('document-level performance plan copy is navigation-aware', () => {
  const graph = buildEvidenceGraph({
    finding: {
      id: 'f1',
      ruleId: 'performance.browser.ttfb',
      title: 'Slow TTFB',
      detail: 'TTFB slow',
      category: 'review',
      severity: 'medium',
      confidence: 'inferred',
      targetType: 'page',
      targetability: 'document',
      performanceObservation: { ttfbMs: 2090, largestContentfulPaintMs: 2416, firstContentfulPaintMs: 1600, cumulativeLayoutShift: 0.054 }
    },
    page: { url: 'https://example.com/', hostname: 'example.com', title: 'Example' },
    environment: { type: 'staging', confidenceLabel: 'high' },
    coverage: { browser: 'complete' },
    performanceAssessment: buildPerformanceAssessment({
      browserPerformance: lab({ lcpMs: 2416, cls: 0.054, fcpMs: 1600, ttfbMs: 2090 }),
      environment: { type: 'staging' }
    })
  });
  const plan = deterministicFrankPlan(graph);
  assert.equal(plan.guidanceSource, 'deterministic');
  assert.match(plan.steps[0].headline + plan.steps[0].body, /performance|navigation/i);
  assert.doesNotMatch(plan.steps[0].body, /page-level markup/i);
});

test('model path receives structured reviewContext including performance assessment', () => {
  const assessment = buildPerformanceAssessment({
    browserPerformance: lab({ lcpMs: 2416, cls: 0.054, fcpMs: 1600, ttfbMs: 2090 }),
    environment: { type: 'staging' }
  });
  const graph = buildEvidenceGraph({
    finding: {
      id: 'f1',
      ruleId: 'performance.browser.ttfb',
      title: 'Slow TTFB',
      detail: 'TTFB slow',
      category: 'review',
      severity: 'medium',
      confidence: 'inferred',
      targetType: 'page',
      performanceObservation: { ttfbMs: 2090, largestContentfulPaintMs: 2416, firstContentfulPaintMs: 1600, cumulativeLayoutShift: 0.054 }
    },
    page: { url: 'https://example.com/', hostname: 'example.com' },
    environment: { type: 'staging', confidenceLabel: 'high', performanceAssessment: assessment },
    coverage: {},
    performanceAssessment: assessment
  });
  assert.ok(graph.reviewContext?.performanceAssessment?.status);
  assert.equal(graph.reviewContext.observedTtfbMs, 2090);
  assert.ok(Number.isFinite(graph.reviewContext.lcpMs));
  const payload = gatewayFrankGraph(graph);
  assert.ok(payload.reviewContext);
  assert.ok(payload.performanceAssessment || payload.reviewContext.performanceAssessment);
});

test('TTFB policy keeps uncorroborated observation out of Recommended Order', () => {
  const environment = attachEnvironmentContext(
    { url: 'https://example.bigscoots-staging.com/', robots: 'index' },
    { publishedKnown: false }
  );
  environment.performanceAssessment = buildPerformanceAssessment({
    browserPerformance: lab({ lcpMs: 2416, cls: 0.054, fcpMs: 1600, ttfbMs: 2086 }),
    environment
  });
  const [row] = applyFindingPolicy([{
    ruleId: 'performance.browser.ttfb',
    title: 'Slow TTFB',
    detail: 'slow',
    category: 'review',
    severity: 'medium',
    confidence: 'inferred',
    performanceObservation: { ttfbMs: 2086, largestContentfulPaintMs: 2416, firstContentfulPaintMs: 1600 }
  }], environment);
  assert.equal(row.frankVisible, false);
  assert.equal(row.presentationDisposition, 'diagnostic-observation');
});

test('final indexControl agrees with published noindex + robots-mismatch findings', () => {
  const findings = [
    { ruleId: 'seo.noindex-published', evidence: 'noindex, nofollow' },
    { ruleId: 'correlation.robots-mismatch', evidence: 'browser=index, follow; published=noindex, nofollow' }
  ];
  const fromFindings = publishedIndexSignalsFromFindings(findings);
  assert.equal(fromFindings.publishedKnown, true);
  assert.match(fromFindings.publishedRobots, /noindex/i);
  const control = reconcileIndexControlWithFindings(
    buildIndexControl({ page: { url: 'https://example.bigscoots-staging.com/', robots: 'index, follow' }, publishedKnown: false }),
    findings
  );
  assert.equal(control.publishedMetaRobots.checked, true);
  assert.equal(control.publishedMetaRobots.noindex, true);
  assert.equal(control.conflictingSignals, true);
  assert.notEqual(control.assessment, 'no-blocking-control-detected');
  const env = attachEnvironmentContext(
    { url: 'https://example.bigscoots-staging.com/', robots: 'index, follow' },
    { findings, ...fromFindings }
  );
  assert.ok(env.notice);
  assert.notEqual(env.notice.kind, 'environment-no-blocking-control');
  assert.match(env.notice.title || env.notice.body || '', /inconsist|noindex|index/i);
});

test('visible-error guidance stays concise and non-causal', () => {
  const g = guidanceFor({
    ruleId: 'runtime.visible-error',
    visibleError: {
      messageExcerpt: 'Invalid domain',
      originClass: 'third-party',
      firstObservedPhase: 'initial-scan'
    }
  });
  assert.match(g.interpretation, /Invalid domain/);
  assert.match(g.interpretation, /third-party/i);
  assert.doesNotMatch(g.remediation, /caused by Web QA|definitely caused/i);
});
