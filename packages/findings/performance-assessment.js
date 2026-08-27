/**
 * Current-page lab performance assessment.
 * UX metrics (LCP/FCP/CLS/INP) drive status; TTFB and page load are diagnostics.
 */

function num(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function rateMs(valueMs, good, needs) {
  if (!Number.isFinite(valueMs)) return { measured: false, valueMs: null, rating: 'unavailable' };
  const rating = valueMs <= good ? 'good' : valueMs <= needs ? 'needs-attention' : 'poor';
  return { measured: true, valueMs: Math.round(valueMs), rating };
}

function rateCls(value) {
  if (!Number.isFinite(value)) return { measured: false, value: null, rating: 'unavailable' };
  const rating = value <= 0.1 ? 'good' : value <= 0.25 ? 'needs-attention' : 'poor';
  return { measured: true, value: Math.round(value * 1000) / 1000, rating };
}

function rateTtfb(valueMs) {
  if (!Number.isFinite(valueMs)) return { measured: false, valueMs: null, rating: 'unavailable', role: 'diagnostic' };
  const rating = valueMs <= 800 ? 'good' : valueMs <= 1800 ? 'elevated' : 'slow';
  return { measured: true, valueMs: Math.round(valueMs), rating, role: 'diagnostic' };
}

function formatSeconds(ms) {
  if (!Number.isFinite(ms)) return '';
  const s = ms / 1000;
  return `${s >= 10 ? s.toFixed(1) : s.toFixed(2)}s`;
}

function formatCls(value) {
  if (!Number.isFinite(value)) return '';
  return String(Math.round(value * 1000) / 1000);
}

function ratingLabel(rating) {
  if (rating === 'good') return 'Good';
  if (rating === 'needs-attention' || rating === 'elevated') return 'Needs attention';
  if (rating === 'poor' || rating === 'slow') return 'Slow';
  return 'Unavailable';
}

function collectImageDelivery(findings = [], signals = {}) {
  const oversized = findings.filter(f => /image-oversized/.test(String(f.ruleId || '')) && f.imageMetrics?.magnitude !== 'mild');
  const mild = findings.filter(f => /image-oversized/.test(String(f.ruleId || '')) && f.imageMetrics?.magnitude === 'mild');
  const lcpImage = oversized.find(f => /lcp-image-oversized/.test(String(f.ruleId || ''))) || null;
  const heaviest = Array.isArray(signals.heaviest) ? signals.heaviest.filter(r => /img|image|css|other/i.test(String(r.type || '')) || /\.(avif|webp|jpe?g|png|gif|svg)(\?|$)/i.test(String(r.name || ''))) : [];
  const timed = Array.isArray(signals.imageTimings) ? signals.imageTimings.filter(r => r.timingVisible) : [];
  const slowTimed = (timed.length ? timed : heaviest)
    .filter(r => Number(r.durationMs) >= 1500)
    .slice(0, 8)
    .map(r => ({
      url: String(r.name || r.url || '').slice(0, 220),
      durationMs: Number(r.durationMs) || 0,
      transferBytes: Number.isFinite(Number(r.bytes || r.transferSize)) && Number(r.bytes || r.transferSize) > 0 ? Number(r.bytes || r.transferSize) : undefined,
      timingVisible: r.timingVisible !== false
    }));
  const visibleImages = Number(signals.resourceMix?.img || 0);
  const timedCount = timed.length || heaviest.length;
  let assessment = 'not-enough-data';
  if (oversized.length || slowTimed.length || lcpImage) assessment = 'issues-detected';
  else if (timedCount > 0 || visibleImages === 0) assessment = 'healthy-observed';
  else assessment = 'incomplete';
  return {
    assessment,
    oversizedCount: oversized.length,
    mildOversizedCount: mild.length,
    responsiveIssueCount: oversized.filter(f => f.imageMetrics && !f.imageMetrics.srcsetPresent && !f.imageMetrics.responsiveSourcePresent).length,
    lcpImageIssue: Boolean(lcpImage),
    lcpImage: lcpImage ? {
      url: String(lcpImage.resourceUrl || lcpImage.imageMetrics?.selectedSource || '').slice(0, 220),
      magnitude: lcpImage.imageMetrics?.magnitude || ''
    } : null,
    slowTimedImages: slowTimed,
    timingCoverage: {
      measured: timedCount,
      totalVisibleImages: visibleImages || null
    }
  };
}

function buildSpecificSummary({ status, fcp, lcp, cls, ttfb, pageLoad }) {
  if (status === 'insufficient-data') {
    return 'Current-page performance could not be measured in this browser run.';
  }

  if (status === 'healthy') {
    return ttfb.rating === 'slow'
      ? 'Visual performance looked healthy in this lab run. Server response (TTFB) was slow as a diagnostic observation.'
      : 'Visual performance looked healthy in this lab run.';
  }

  if (status === 'mostly-healthy' && fcp.rating === 'good' && lcp.rating === 'good' && cls.rating === 'good' && ttfb.rating === 'slow') {
    return 'Visual performance was mostly healthy in this run. Server response was slow, but LCP and layout stability were within healthy ranges.';
  }

  // Concrete mixed diagnosis preferred over generic boilerplate.
  if ((fcp.rating === 'needs-attention' || fcp.rating === 'poor')
    && lcp.rating === 'good'
    && cls.rating === 'good') {
    const lead = fcp.rating === 'poor'
      ? 'First content appeared slowly in this run.'
      : 'First content appeared slower than ideal in this run.';
    if (ttfb.rating === 'slow') {
      return `${lead} LCP and layout stability were good. Server response was also slow.`;
    }
    return `${lead} LCP and layout stability were good.`;
  }

  const parts = [];
  if (fcp.rating === 'needs-attention' || fcp.rating === 'poor') {
    parts.push(fcp.rating === 'poor'
      ? 'First content appeared slowly in this run.'
      : 'First content appeared slower than ideal in this run.');
  }
  if (lcp.rating === 'needs-attention' || lcp.rating === 'poor') {
    parts.push(lcp.rating === 'poor'
      ? 'Largest contentful paint was poor in this lab run.'
      : 'Largest contentful paint needed attention in this lab run.');
  }
  if (cls.rating === 'needs-attention' || cls.rating === 'poor') {
    parts.push(cls.rating === 'poor'
      ? 'Layout stability was poor.'
      : 'Layout stability needed attention.');
  }
  const goodBits = [];
  if (lcp.rating === 'good') goodBits.push('LCP');
  if (cls.rating === 'good') goodBits.push('layout stability');
  if (goodBits.length && parts.length) {
    parts.push(`${goodBits.join(' and ')} ${goodBits.length > 1 ? 'were' : 'was'} good.`);
  }
  if (ttfb.rating === 'slow') parts.push(parts.length ? 'Server response was also slow.' : 'Server response (TTFB) was slow.');
  else if (ttfb.rating === 'elevated') parts.push('Server response (TTFB) was elevated.');
  if (pageLoad.measured && pageLoad.valueMs >= 8000 && (lcp.rating === 'good' || fcp.rating === 'good')) {
    parts.push('The load event completed much later than useful content appeared, which can reflect continuing third-party or late work.');
  }

  if (parts.length) return parts.join(' ');
  if (status === 'poor') return 'Page performance looked poor in this lab run.';
  if (status === 'mostly-healthy') return 'Visual performance was mostly healthy in this run.';
  return 'This page needs performance attention based on lab metrics in this run.';
}

/**
 * Build a compact current-page performance assessment from browser lab signals + findings.
 */
export function buildPerformanceAssessment({
  browserPerformance = null,
  findings = [],
  environment = null
} = {}) {
  const signals = browserPerformance?.available ? browserPerformance : null;
  if (!signals) {
    return {
      scope: 'current-page-lab',
      status: 'insufficient-data',
      metrics: {
        fcp: { measured: false, valueMs: null, rating: 'unavailable' },
        lcp: { measured: false, valueMs: null, rating: 'unavailable' },
        cls: { measured: false, value: null, rating: 'unavailable' },
        pageLoad: { measured: false, valueMs: null, role: 'diagnostic' },
        ttfb: { measured: false, valueMs: null, rating: 'unavailable', role: 'diagnostic' },
        inp: { measured: false, valueMs: null, rating: 'unavailable', reasonIfUnavailable: 'no-interaction-sample' }
      },
      imageDelivery: { assessment: 'not-enough-data', oversizedCount: 0, responsiveIssueCount: 0, lcpImageIssue: false, slowTimedImages: [], timingCoverage: { measured: 0, totalVisibleImages: null } },
      summary: 'Current-page performance could not be measured in this browser run.',
      actionableIssues: [],
      diagnosticObservations: []
    };
  }

  const fcp = rateMs(num(signals.firstContentfulPaintMs), 1800, 3000);
  const lcp = {
    ...rateMs(num(signals.largestContentfulPaintMs), 2500, 4000),
    elementTarget: signals.lcpElement?.selector || '',
    resourceUrl: signals.lcpElement?.url || '',
    elementType: signals.lcpElement?.tag || ''
  };
  const cls = rateCls(num(signals.cumulativeLayoutShift));
  const ttfb = rateTtfb(num(signals.ttfbMs));
  // Prefer pageLoadMs from loadEventEnd. Accept legacy loadMs only when it is a
  // positive finite value already collected the same way — never invent from duration.
  const pageLoadMs = num(signals.pageLoadMs);
  const legacyLoadMs = pageLoadMs == null ? num(signals.loadMs) : null;
  const resolvedPageLoad = pageLoadMs ?? legacyLoadMs;
  const pageLoad = Number.isFinite(resolvedPageLoad) && resolvedPageLoad > 0
    ? { measured: true, valueMs: Math.round(resolvedPageLoad), role: 'diagnostic' }
    : { measured: false, valueMs: null, role: 'diagnostic' };
  const inp = { measured: false, valueMs: null, rating: 'unavailable', reasonIfUnavailable: 'no-interaction-sample' };
  const imageDelivery = collectImageDelivery(findings, signals);

  // Status is driven by UX metrics only. TTFB / page-load never force "poor" alone.
  const uxRatings = [fcp.rating, lcp.rating, cls.rating].filter(r => r !== 'unavailable');
  const poorUx = uxRatings.filter(r => r === 'poor').length;
  const needsUx = uxRatings.filter(r => r === 'needs-attention').length;
  const goodUx = uxRatings.filter(r => r === 'good').length;

  let status = 'insufficient-data';
  if (!uxRatings.length) status = 'insufficient-data';
  else if (poorUx >= 1) status = 'poor';
  else if (needsUx >= 2) status = 'needs-attention';
  else if (needsUx === 1) status = 'mostly-healthy';
  else if (goodUx === uxRatings.length && ttfb.rating === 'slow') status = 'mostly-healthy';
  else if (goodUx === uxRatings.length) status = 'healthy';
  else status = 'needs-attention';

  const actionableIssues = [];
  const diagnosticObservations = [];

  if (lcp.measured && lcp.rating !== 'good') {
    actionableIssues.push({
      id: 'lcp',
      severity: lcp.rating === 'poor' ? 'high' : 'medium',
      title: `LCP ${formatSeconds(lcp.valueMs)} (${ratingLabel(lcp.rating)})`,
      detail: lcp.elementType === 'img' || /img|image|picture/i.test(lcp.elementType)
        ? 'The largest visible content in this run was an image.'
        : 'Largest contentful paint exceeded the good lab threshold.'
    });
  }
  if (fcp.measured && fcp.rating !== 'good') {
    actionableIssues.push({
      id: 'fcp',
      severity: fcp.rating === 'poor' ? 'medium' : 'low',
      title: `FCP ${formatSeconds(fcp.valueMs)} (${ratingLabel(fcp.rating)})`,
      detail: 'First contentful paint was slower than the good lab threshold.'
    });
  }
  if (cls.measured && cls.rating !== 'good') {
    actionableIssues.push({
      id: 'cls',
      severity: cls.rating === 'poor' ? 'high' : 'medium',
      title: `CLS ${formatCls(cls.value)} (${ratingLabel(cls.rating)})`,
      detail: 'Layout shift exceeded the good lab threshold.'
    });
  }
  if (imageDelivery.assessment === 'issues-detected') {
    actionableIssues.push({
      id: 'image-delivery',
      severity: imageDelivery.lcpImageIssue ? 'high' : 'medium',
      title: imageDelivery.oversizedCount
        ? `${imageDelivery.oversizedCount} oversized image${imageDelivery.oversizedCount === 1 ? '' : 's'} detected`
        : 'Image delivery issues detected',
      detail: imageDelivery.lcpImageIssue ? 'An oversized image is associated with LCP.' : 'Image delivery issues were observed in this run.'
    });
  }

  const ttfbSevere = ttfb.measured && ttfb.valueMs > 3000;
  const ttfbCorroborated = ttfb.rating === 'slow' && (
    ttfbSevere
    || (fcp.rating === 'needs-attention' || fcp.rating === 'poor')
    || (lcp.rating === 'needs-attention' || lcp.rating === 'poor')
  );
  if (ttfb.measured && ttfb.rating !== 'good') {
    const row = {
      id: 'ttfb',
      severity: ttfbCorroborated ? 'medium' : 'low',
      title: `Server response (TTFB) ${formatSeconds(ttfb.valueMs)} (${ratingLabel(ttfb.rating)})`,
      detail: 'Server response (TTFB) was slow in this lab run.',
      recommendedOrder: ttfbCorroborated,
      stagingAware: ['staging', 'preview', 'local', 'development'].includes(String(environment?.type || ''))
    };
    if (ttfbCorroborated) actionableIssues.push(row);
    else diagnosticObservations.push(row);
  }

  if (pageLoad.measured && pageLoad.valueMs >= 8000) {
    diagnosticObservations.push({
      id: 'page-load',
      severity: 'low',
      title: `Page load ${formatSeconds(pageLoad.valueMs)}`,
      detail: 'Navigation load-event timing is a diagnostic observation, not a Core Web Vitals rating.',
      recommendedOrder: false
    });
  }

  const summary = buildSpecificSummary({ status, fcp, lcp, cls, ttfb, pageLoad });

  return {
    scope: 'current-page-lab',
    status,
    metrics: { fcp, lcp, cls, pageLoad, ttfb, inp },
    imageDelivery,
    summary,
    actionableIssues,
    diagnosticObservations,
    ttfbPresentation: ttfbCorroborated ? 'recommended' : 'diagnostic'
  };
}

export function performanceAssessmentPresentation(assessment = {}) {
  const m = assessment.metrics || {};
  const rows = [];
  if (m.lcp?.measured) rows.push({ key: 'LCP', value: formatSeconds(m.lcp.valueMs), rating: ratingLabel(m.lcp.rating), tone: m.lcp.rating });
  if (m.fcp?.measured) rows.push({ key: 'FCP', value: formatSeconds(m.fcp.valueMs), rating: ratingLabel(m.fcp.rating), tone: m.fcp.rating });
  if (m.cls?.measured) rows.push({ key: 'CLS', value: formatCls(m.cls.value), rating: ratingLabel(m.cls.rating), tone: m.cls.rating });
  if (m.pageLoad?.measured) rows.push({ key: 'Page load', value: formatSeconds(m.pageLoad.valueMs), rating: '', tone: 'diagnostic', diagnostic: true, unrated: true });
  const diagnostics = [];
  if (m.ttfb?.measured && m.ttfb.rating && m.ttfb.rating !== 'good' && m.ttfb.rating !== 'unavailable') {
    diagnostics.push({
      key: 'Server response (TTFB)',
      value: formatSeconds(m.ttfb.valueMs),
      rating: ratingLabel(m.ttfb.rating),
      tone: m.ttfb.rating === 'slow' ? 'poor' : m.ttfb.rating,
      diagnostic: true
    });
  }
  const statusLabel = ({
    healthy: 'Healthy',
    'mostly-healthy': 'Mostly healthy',
    'needs-attention': 'Needs attention',
    poor: 'Poor',
    'insufficient-data': 'Insufficient data'
  })[assessment.status] || 'Insufficient data';
  let images = 'No image-delivery issue was detected in the measurements available to this scan.';
  if (assessment.imageDelivery?.assessment === 'issues-detected') {
    images = assessment.imageDelivery.oversizedCount
      ? `${assessment.imageDelivery.oversizedCount} oversized image${assessment.imageDelivery.oversizedCount === 1 ? '' : 's'} detected`
      : 'Image delivery issues detected';
  } else if (assessment.imageDelivery?.assessment === 'not-enough-data' || assessment.imageDelivery?.assessment === 'incomplete') {
    images = 'Not enough image-delivery timing evidence was available.';
  }
  return { statusLabel, rows, diagnostics, summary: assessment.summary || '', images };
}

export { rateMs, rateCls, rateTtfb, formatSeconds };
