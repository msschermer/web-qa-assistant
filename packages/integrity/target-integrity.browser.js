(() => {
/**
 * Deterministic target-integrity classification for WebQA scans.
 * Detects when the renderer received a challenge/interstitial instead of the
 * requested page. Vendor/CDN presence alone must not trigger a mismatch.
 */

const TARGET_STATES = {
  REACHED: 'reached',
  PROBABLE_INTERSTITIAL: 'probable_interstitial',
  BLOCKED: 'blocked',
  INCONCLUSIVE: 'inconclusive'
};

const CHALLENGE_TITLE_PATTERNS = [
  /^attention required!?\s*\|\s*cloudflare/i,
  /^just a moment\.{3}$/i,
  /^checking your browser/i,
  /^please wait\.{3}$/i,
  /^robot check/i,
  /^security check/i,
  /^ddos protection by/i,
  /^please complete the security check/i,
  /^one more step/i,
  /^verify you are human/i
];

function norm(value) {
  return String(value ?? '').trim();
}

function hostnameOf(url) {
  try {
    return new URL(url).hostname.replace(/^www\./i, '').toLowerCase();
  } catch {
    return '';
  }
}

function collectDomSignals(source = {}) {
  const html = norm(source.html).slice(0, 80000);
  const bodyText = norm(source.bodyText).slice(0, 12000);
  const signals = [];

  if (/cdn-cgi\/challenge-platform/i.test(html)) signals.push('cloudflare-challenge-platform');
  if (/\bcf-challenge\b/i.test(html) || /\bcf-turnstile\b/i.test(html)) signals.push('cloudflare-challenge-widget');
  if (/challenge-form/i.test(html) && /cloudflare/i.test(html)) signals.push('cloudflare-challenge-form');
  if (/\bid=["']challenge-form["']/i.test(html)) signals.push('challenge-form-id');
  if (/(hcaptcha|g-recaptcha|recaptcha)/i.test(html) && /verify you are human|security check|robot/i.test(bodyText)) {
    signals.push('captcha-ui');
  }
  if (/akamai/i.test(html) && /access denied/i.test(bodyText)) signals.push('akamai-access-denied');
  if (/datadome/i.test(html)) signals.push('datadome-marker');
  if (/please enable cookies/i.test(bodyText) && bodyText.length < 2500 && !/<article/i.test(html)) {
    signals.push('cookie-wall');
  }
  if (/cf-browser-verification/i.test(html)) signals.push('cloudflare-browser-verification');

  return [...new Set(signals)];
}

function titleChallengeSignal(title) {
  const value = norm(title);
  if (!value) return null;
  for (const pattern of CHALLENGE_TITLE_PATTERNS) {
    if (pattern.test(value)) return 'challenge-title';
  }
  return null;
}

function hasChallengeClassSignal(domSignals = []) {
  return domSignals.some(s =>
    s.startsWith('cloudflare-challenge') || s === 'captcha-ui' || s === 'challenge-form-id' || s === 'cloudflare-browser-verification'
  );
}

function isThinInterstitial(linkCount, interactiveCount, title = '') {
  return linkCount < 4 && interactiveCount < 8 && norm(title).length < 80;
}

function challengeSignalWeight(signal, { domSignals, titleSignal, linkCount, interactiveCount, title = '' }) {
  const challengeSignals = domSignals.filter(s =>
    s.startsWith('cloudflare-challenge') || s === 'challenge-form-id' || s === 'captcha-ui' || s === 'cloudflare-browser-verification'
  );
  if (challengeSignals.length === 1 && !titleSignal && !isThinInterstitial(linkCount, interactiveCount, title)) return 1;
  return signal.startsWith('cloudflare-challenge') || signal === 'challenge-form-id' || signal === 'captcha-ui' ? 3 : 2;
}

function scoreSignals({ titleSignal, domSignals, httpStatus, linkCount, interactiveCount, hostMismatch, title = '' }) {
  let score = 0;
  if (titleSignal) score += 3;
  for (const signal of domSignals) {
    if (signal.startsWith('cloudflare-challenge') || signal === 'challenge-form-id' || signal === 'captcha-ui' || signal === 'cloudflare-browser-verification') {
      score += challengeSignalWeight(signal, { domSignals, titleSignal, linkCount, interactiveCount, title });
    } else if (signal === 'cookie-wall') score += 1;
    else score += 2;
  }
  if ((httpStatus === 403 || httpStatus === 451) && hasChallengeClassSignal(domSignals)) score += 2;
  if (httpStatus === 503 && (titleSignal || domSignals.length)) score += 1;
  if (hostMismatch) score += 1;
  if (isThinInterstitial(linkCount, interactiveCount, title) && (titleSignal || domSignals.length >= 2)) score += 1;
  return score;
}

function assessTargetIntegrity(input = {}) {
  const requestedUrl = norm(input.requestedUrl || input.finalUrl);
  const finalUrl = norm(input.finalUrl || input.requestedUrl);
  const title = norm(input.title);
  const httpStatus = Number.isFinite(Number(input.httpStatus)) ? Number(input.httpStatus) : null;
  const linkCount = Math.max(0, Number(input.linkCount) || 0);
  const interactiveCount = Math.max(0, Number(input.interactiveCount) || 0);
  const domSignals = [...new Set([...(input.domSignals || []), ...collectDomSignals(input)])];
  const titleSignal = titleChallengeSignal(title);
  const signals = [...new Set([...(titleSignal ? [titleSignal] : []), ...domSignals])];
  const requestedHost = hostnameOf(requestedUrl);
  const finalHost = hostnameOf(finalUrl);
  const hostMismatch = Boolean(requestedHost && finalHost && requestedHost !== finalHost);
  const score = scoreSignals({ titleSignal, domSignals, httpStatus, linkCount, interactiveCount, hostMismatch, title });

  const base = {
    state: TARGET_STATES.REACHED,
    confidence: 'high',
    score,
    signals,
    requestedUrl: requestedUrl || finalUrl,
    finalUrl: finalUrl || requestedUrl,
    httpStatus,
    renderedTitle: title,
    requestedHost,
    finalHost
  };

  const strongChallenge = Boolean(titleSignal && hasChallengeClassSignal(domSignals));
  const challengeDom = hasChallengeClassSignal(domSignals);
  const thinInterstitial = isThinInterstitial(linkCount, interactiveCount, title);

  if ((httpStatus === 403 || httpStatus === 451) && !challengeDom) {
    return { ...base, state: TARGET_STATES.BLOCKED, confidence: 'high' };
  }
  if (score >= 5 || strongChallenge || (challengeDom && score >= 3 && thinInterstitial)) {
    return { ...base, state: TARGET_STATES.PROBABLE_INTERSTITIAL, confidence: strongChallenge ? 'high' : score >= 6 ? 'high' : 'medium' };
  }
  if ((httpStatus === 403 || httpStatus === 451) && challengeDom && score >= 3) {
    return { ...base, state: TARGET_STATES.BLOCKED, confidence: 'high' };
  }
  if (score >= 2) {
    return { ...base, state: TARGET_STATES.INCONCLUSIVE, confidence: 'low' };
  }
  return base;
}

function targetIntegrityReached(integrity) {
  return !integrity || integrity.state === TARGET_STATES.REACHED;
}

function targetIntegrityLimitsAudit(integrity) {
  return Boolean(integrity && integrity.state !== TARGET_STATES.REACHED);
}

function targetIntegrityBlocksAudit(integrity) {
  if (!integrity) return false;
  return integrity.state === TARGET_STATES.PROBABLE_INTERSTITIAL || integrity.state === TARGET_STATES.BLOCKED;
}

const PAGE_DERIVED_RULE_PREFIXES = [
  'seo.',
  'correlation.',
  'structure.',
  'a11y.',
  'axe.',
  'navigation.link',
  'performance.',
  'social.',
  'schema.',
  'web.',
  'security.'
];

function isPageDerivedFinding(finding = {}) {
  const ruleId = String(finding.ruleId || '');
  return PAGE_DERIVED_RULE_PREFIXES.some(prefix => ruleId.startsWith(prefix));
}

function suppressFindingsForTargetIntegrity(findings = [], integrity) {
  if (targetIntegrityReached(integrity)) return findings;
  if (!targetIntegrityLimitsAudit(integrity)) return findings;
  return findings.filter(f => !isPageDerivedFinding(f));
}

function adjustCoverageForTargetIntegrity(coverage = {}, linkAudit = null, integrity) {
  const next = { ...coverage };
  if (targetIntegrityReached(integrity)) {
    if (next.links === 'complete' && Number(linkAudit?.checked || 0) === 0) {
      next.links = 'none_checked';
    }
    return next;
  }
  if (!targetIntegrityLimitsAudit(integrity)) return next;

  if (targetIntegrityBlocksAudit(integrity)) {
    next.browser = integrity.state === TARGET_STATES.BLOCKED ? 'blocked' : 'substituted';
    next.links = 'not_applicable';
    next.axe = 'not_applicable';
    next.performance = next.performance === 'current-page' ? 'not_applicable' : next.performance;
  } else {
    next.browser = 'inconclusive';
    next.links = 'inconclusive';
    next.axe = 'inconclusive';
    if (next.performance === 'current-page') next.performance = 'inconclusive';
  }
  next.target = integrity.state;
  return next;
}

function targetIntegrityBrief(integrity) {
  if (!integrity || targetIntegrityReached(integrity)) return '';
  if (integrity.state === TARGET_STATES.PROBABLE_INTERSTITIAL) {
    return 'WebQA could not confirm it reached the requested page. The renderer likely received a challenge or security interstitial instead, so page QA conclusions about the target site were withheld.';
  }
  if (integrity.state === TARGET_STATES.BLOCKED) {
    return 'WebQA could not reach the requested page because access was blocked. Page QA conclusions about the target site were withheld.';
  }
  if (integrity.state === TARGET_STATES.INCONCLUSIVE) {
    return 'WebQA could not confidently confirm the requested page was reached. Treat page QA conclusions as incomplete until target integrity is verified.';
  }
  return 'WebQA could not confirm target integrity for the requested page, so page QA conclusions were withheld.';
}

globalThis.WebQATargetIntegrity = { TARGET_STATES, collectDomSignals, assessTargetIntegrity, targetIntegrityReached, targetIntegrityBlocksAudit, suppressFindingsForTargetIntegrity, adjustCoverageForTargetIntegrity, targetIntegrityBrief, isPageDerivedFinding };
})();
