import test from 'node:test';
import assert from 'node:assert/strict';
import { buildFindingReviewContext } from '../packages/frank/review-context.js';
import { buildEvidenceGraph } from '../packages/frank/evidence.js';
import { composeAttention } from '../packages/findings/compose.js';
import { classifyEnvironment } from '../packages/environment/classify.js';

function imageFinding(i, extra = {}) {
  return {
    id: `performance.browser.image-oversized:${i}`,
    ruleId: 'performance.browser.image-oversized',
    title: 'Image is substantially oversized for its display size',
    detail: 'oversized',
    category: 'review',
    severity: 'medium',
    confidence: 'confirmed',
    selector: `img#img-${i}`,
    targetId: `target_${i}`,
    targetType: 'visual',
    count: 1,
    rootCauseKey: 'images-oversized',
    resourceUrl: `https://www.example.com/huge-${i}.jpg`,
    imageMetrics: {
      intrinsicWidth: 3840,
      intrinsicHeight: 2160,
      renderedWidth: 150,
      renderedHeight: 84,
      devicePixelRatio: 1,
      requiredPhysicalWidth: 150,
      requiredPhysicalHeight: 84,
      widthOversizeRatio: 25.6,
      heightOversizeRatio: 25.71,
      pixelAreaOversizeRatio: 658,
      magnitude: 'severe',
      srcsetPresent: false,
      sizesPresent: false,
      pictureElement: false,
      selectedSource: `https://www.example.com/huge-${i}.jpg`,
      currentSrc: `https://www.example.com/huge-${i}.jpg`
    },
    ...extra
  };
}

test('oversized-image review adapter includes exact measurements and does not invent bytes', () => {
  const finding = imageFinding(0);
  const ctx = buildFindingReviewContext(finding, { instances: [finding], selectedInstanceId: finding.id, groupCount: 1 });
  assert.equal(ctx.adapter, 'performance.browser.image-oversized');
  assert.equal(ctx.selectedInstance.naturalWidth, 3840);
  assert.equal(ctx.selectedInstance.naturalHeight, 2160);
  assert.equal(ctx.selectedInstance.renderedWidth, 150);
  assert.equal(ctx.selectedInstance.renderedHeight, 84);
  assert.equal(ctx.selectedInstance.dpr, 1);
  assert.equal(ctx.selectedInstance.srcsetPresent, false);
  assert.equal(ctx.selectedInstance.sizesPresent, false);
  assert.equal(ctx.selectedInstance.pictureElement, false);
  assert.equal(ctx.selectedInstance.transferBytes, undefined);
  assert.equal(ctx.measurements.natural, '3840×2160');
});

test('grouped oversized images keep UI grouping while Frank receives all six compact instances', () => {
  const findings = Array.from({ length: 6 }, (_, i) => imageFinding(i));
  const attention = composeAttention(findings);
  const group = attention.groups.find(g => g.lead.rootCauseKey === 'images-oversized');
  assert.equal(group.size, 6);
  assert.match(group.title, /6 images are substantially oversized/);
  const selected = findings[3];
  const ctx = buildFindingReviewContext(selected, {
    instances: findings,
    selectedInstanceId: selected.id,
    groupCount: 6,
    groupTitle: group.title
  });
  assert.equal(ctx.instances.length, 6);
  assert.equal(ctx.groupSummary.count, 6);
  assert.equal(ctx.selectedInstance.instanceNumber, 4);
  assert.equal(ctx.selectedInstance.findingId, selected.id);
  const graph = buildEvidenceGraph({
    finding: selected,
    page: { url: 'https://www.example.com/', hostname: 'www.example.com' },
    environment: { type: 'production', source: 'auto', confidenceLabel: 'high', signals: [] },
    instances: findings,
    selectedInstanceId: selected.id,
    groupCount: 6
  });
  assert.equal(graph.reviewContext.instances.length, 6);
  assert.equal(graph.reviewContext.selectedInstanceNumber, 4);
  assert.ok(graph.evidence.some(e => e.kind === 'review-instances'));
  assert.ok(graph.finding.imageMetrics.intrinsicWidth === 3840);
});

test('discoverability adapter receives environment and indexability facts', () => {
  const env = classifyEnvironment({ url: 'https://example.bigscoots-staging.com/' }, {
    indexability: { blocked: true, publishedBlocked: true, renderedBlocked: true, mismatch: false }
  });
  const finding = { id: 'seo.noindex:1', ruleId: 'seo.noindex', title: 'Page requests noindex', detail: 'noindex', confidence: 'confirmed' };
  const ctx = buildFindingReviewContext(finding, { environment: env });
  assert.equal(ctx.adapter, 'discoverability.environment');
  assert.equal(ctx.environment.kind, 'staging');
  assert.equal(ctx.indexability.blocked, true);
  assert.equal(ctx.stagingExpected, true);
});
