/**
 * Separate model readiness from whether Frank actually reviewed this scan/finding.
 */

const READINESS = new Set(['unavailable', 'downloading', 'ready']);
const SOURCES = new Set(['frank-model', 'deterministic', 'none']);

export function emptyFrankReview({
  modelReadiness = 'unavailable',
  reason = 'not-requested'
} = {}) {
  const readiness = READINESS.has(modelReadiness) ? modelReadiness : 'unavailable';
  return {
    modelReadiness: readiness,
    requested: false,
    started: false,
    completed: false,
    failed: false,
    skipped: false,
    source: 'none',
    reason: String(reason || 'not-requested'),
    failureReason: '',
    startedAt: null,
    completedAt: null
  };
}

export function normalizeGuidanceSource(value, { visibleGuidance = false } = {}) {
  const raw = String(value || '').trim();
  if (SOURCES.has(raw)) {
    if (raw === 'none' && visibleGuidance) return 'deterministic';
    return raw;
  }
  if (raw === 'unavailable' || raw === '') {
    return visibleGuidance ? 'deterministic' : 'none';
  }
  if (raw === 'ai' || raw === 'frank-model') return 'frank-model';
  return 'deterministic';
}

export function frankReviewFromSession({
  modelReadiness = 'unavailable',
  requested = false,
  started = false,
  completed = false,
  failed = false,
  skipped = false,
  source = 'none',
  reason = '',
  failureReason = '',
  startedAt = null,
  completedAt = null,
  plan = null
} = {}) {
  const review = emptyFrankReview({ modelReadiness, reason: reason || (requested ? 'requested' : 'not-requested') });
  review.requested = Boolean(requested);
  review.started = Boolean(started);
  review.completed = Boolean(completed);
  review.failed = Boolean(failed);
  review.skipped = Boolean(skipped);
  review.failureReason = String(failureReason || '').slice(0, 240);
  review.startedAt = startedAt || null;
  review.completedAt = completedAt || null;
  if (plan?.guidanceSource === 'frank-model' || (plan?.mode === 'ai' && review.completed && !review.failed)) {
    review.source = 'frank-model';
  } else if (review.completed || review.failed || review.skipped || (review.requested && plan)) {
    review.source = 'deterministic';
  } else {
    review.source = 'none';
  }
  if (SOURCES.has(String(source))) review.source = source;
  if (review.source === 'frank-model' && !review.completed) review.source = 'deterministic';
  if (!review.requested && review.source === 'frank-model') review.source = 'none';
  return review;
}

export function scanGuidanceSource({
  frankReview = null,
  frank = null,
  priorityMode = '',
  coverageAi = '',
  hasVisibleGuidance = false
} = {}) {
  const review = frankReview || (frank ? frankReviewFromSession({
    requested: true,
    started: true,
    completed: Boolean(frank?.plan),
    source: frank?.plan?.guidanceSource,
    plan: frank?.plan,
    modelReadiness: frank?.modelReadiness || 'unavailable'
  }) : null);
  if (review?.source === 'frank-model') return 'frank-model';
  if (review?.source === 'deterministic') return 'deterministic';
  // Scan-level AI brief / coverage.ai=complete is ranking copy, not an Ask Frank review.
  if (hasVisibleGuidance || priorityMode === 'deterministic' || priorityMode === 'ai'
    || coverageAi === 'deterministic' || coverageAi === 'complete') {
    return 'deterministic';
  }
  if (review?.source === 'none') return hasVisibleGuidance ? 'deterministic' : 'none';
  return hasVisibleGuidance ? 'deterministic' : 'none';
}
