const SENSITIVE_NAME = /(token|secret|password|passwd|authorization|auth|session|cookie|jwt|key|credential|nonce|csrf|xsrf)/i;
const ALLOWED_ATTRS = new Set(['id','class','role','type','name','href','src','alt','title','for','lang','rel','target','action','method','aria-label','aria-labelledby','aria-describedby','aria-hidden','aria-expanded','aria-controls','aria-current','aria-required','aria-invalid','tabindex']);

function clip(value, max) {
  const s = String(value ?? '');
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

export function sanitizeUrl(value) {
  try {
    const url = new URL(String(value));
    for (const key of [...url.searchParams.keys()]) {
      if (SENSITIVE_NAME.test(key)) url.searchParams.set(key, '[redacted]');
      else url.searchParams.set(key, '[value]');
    }
    url.hash = '';
    return url.toString();
  } catch { return clip(value, 600); }
}

export function sanitizeSelector(value) {
  return clip(String(value || '').replace(/\[value(?:[*^$|~]?=)[^\]]+\]/gi, '[value]'), 700);
}

export function sanitizeMarkup(markup) {
  let source = clip(markup, 3000);
  source = source.replace(/<!--([\s\S]*?)-->/g, '');
  source = source.replace(/\s(?:value|checked|selected)=("[^"]*"|'[^']*'|[^\s>]+)/gi, '');
  source = source.replace(/\s(data-[\w:-]+)=("[^"]*"|'[^']*'|[^\s>]+)/gi, '');
  source = source.replace(/\s([\w:-]+)=("[^"]*"|'[^']*'|[^\s>]+)/g, (full, name, raw) => {
    const lower = String(name).toLowerCase();
    if (SENSITIVE_NAME.test(lower) || !ALLOWED_ATTRS.has(lower)) return '';
    if (lower === 'href' || lower === 'src' || lower === 'action') {
      const unquoted = String(raw).replace(/^['"]|['"]$/g, '');
      const safe = sanitizeUrl(unquoted).replace(/"/g, '&quot;');
      return ` ${name}="${safe}"`;
    }
    return full;
  });
  return clip(source.replace(/\s{2,}/g, ' '), 1800);
}

export function sanitizeText(value, max = 500) {
  const withSafeUrls = String(value ?? '').replace(/https?:\/\/[^\s<>\"']+/gi, raw => {
    const match = raw.match(/^(.*?)([),.;]+)?$/);
    const url = match?.[1] || raw, trailing = match?.[2] || '';
    return `${sanitizeUrl(url)}${trailing}`;
  });
  const s = withSafeUrls.replace(/\b(?:Bearer\s+)?[A-Za-z0-9_-]{28,}\b/g, '[redacted]').replace(/\s+/g, ' ').trim();
  return clip(s, max);
}

function sanitizeStructured(value, depth = 0) {
  if (depth > 5) return '[truncated]';
  if (Array.isArray(value)) return value.slice(0, 30).map(v => sanitizeStructured(v, depth + 1));
  if (!value || typeof value !== 'object') return typeof value === 'string' ? sanitizeText(value, 900) : value;
  return Object.fromEntries(Object.entries(value).slice(0, 50).map(([key, raw]) => {
    if (SENSITIVE_NAME.test(key)) return [key, '[redacted]'];
    if (/^(?:url|href|src|action|finalUrl|sourceUrl)$/i.test(key)) return [key, sanitizeUrl(raw)];
    if (key === 'selector') return [key, sanitizeSelector(raw)];
    if (key === 'markup') return [key, sanitizeMarkup(raw)];
    return [key, sanitizeStructured(raw, depth + 1)];
  }));
}

export function safeImagePurpose(value = {}) {
  const d = value.descriptor || {};
  return {
    purpose: sanitizeText(value.purpose, 40), confidence: sanitizeText(value.confidence, 40),
    rationale: sanitizeText(value.rationale, 420), signals: (value.signals || []).slice(0, 6).map(x => sanitizeText(x, 180)),
    recommendedAlt: value.recommendedAlt == null ? null : sanitizeText(value.recommendedAlt, 240),
    nearbyText: sanitizeText(value.nearbyText || d.siblingText, 160)
  };
}
export function safeSemantics(value = {}) {
  if (!value || typeof value !== 'object') return null;
  const naming = value.naming || {};
  return {
    naming: {
      role: sanitizeText(naming.role, 60), ariaLabel: sanitizeText(naming.ariaLabel, 180), ariaLabelledByText: sanitizeText(naming.ariaLabelledByText, 240),
      ariaDescribedBy: sanitizeText(naming.ariaDescribedBy, 180), titleAttr: sanitizeText(naming.titleAttr, 180), labelText: sanitizeText(naming.labelText, 240),
      ownText: sanitizeText(naming.ownText, 240), interactiveAncestor: sanitizeText(naming.interactiveAncestor, 60), parentTag: sanitizeText(naming.parentTag, 60),
      parentClass: sanitizeText(naming.parentClass, 180), inLandmark: sanitizeText(naming.inLandmark, 80)
    },
    imagePurpose: value.imagePurpose ? safeImagePurpose(value.imagePurpose) : null
  };
}

export function safeAxe(value = {}) {
  if (!value || typeof value !== 'object') return null;
  const safeChecks = bucket => (value.checks?.[bucket] || []).slice(0, 6).map(check => ({
    id: sanitizeText(check.id, 100),
    impact: sanitizeText(check.impact, 40),
    message: sanitizeText(check.message, 360),
    data: sanitizeStructured(check.data)
  }));
  return {
    impact: sanitizeText(value.impact, 40),
    failureSummary: sanitizeText(value.failureSummary, 700),
    message: sanitizeText(value.message, 360),
    incomplete: Boolean(value.incomplete),
    checks: { any: safeChecks('any'), all: safeChecks('all'), none: safeChecks('none') }
  };
}
export function safeLink(value = {}) {
  if (!value || typeof value !== 'object') return null;
  return {
    url: sanitizeUrl(value.url || ''), status: Number(value.status || 0), state: sanitizeText(value.state, 60),
    verificationState: sanitizeText(value.verificationState, 60), occurrences: Number(value.occurrences || 0),
    prominence: sanitizeText(value.prominence, 80), location: sanitizeText(value.location, 100), text: sanitizeText(value.text, 180)
  };
}

export function safePerformance(value = {}) {
  if (!value || typeof value !== 'object') return null;
  return {
    available: Boolean(value.available), measurement: sanitizeText(value.measurement, 40), note: sanitizeText(value.note, 320),
    ttfbMs: Number.isFinite(Number(value.ttfbMs)) ? Number(value.ttfbMs) : null,
    domContentLoadedMs: Number.isFinite(Number(value.domContentLoadedMs)) ? Number(value.domContentLoadedMs) : null,
    loadMs: Number.isFinite(Number(value.loadMs)) ? Number(value.loadMs) : null,
    firstContentfulPaintMs: Number.isFinite(Number(value.firstContentfulPaintMs)) ? Number(value.firstContentfulPaintMs) : null,
    largestContentfulPaintMs: Number.isFinite(Number(value.largestContentfulPaintMs)) ? Number(value.largestContentfulPaintMs) : null,
    transferBytes: Number(value.transferBytes || 0), resourceCount: Number(value.resourceCount || 0), measuredTransferCount: Number(value.measuredTransferCount || 0),
    unknownTransferCount: Number(value.unknownTransferCount || 0), transferIsLowerBound: Boolean(value.transferIsLowerBound),
    resourceMix: sanitizeStructured(value.resourceMix || {}),
    lcpElement: value.lcpElement ? { tag: sanitizeText(value.lcpElement.tag, 40), selector: sanitizeSelector(value.lcpElement.selector), url: sanitizeUrl(value.lcpElement.url || ''), size: Number(value.lcpElement.size || 0) } : null,
    heaviest: (value.heaviest || []).slice(0, 5).map(row => ({ type: sanitizeText(row.type, 60), bytes: Number(row.bytes || 0), durationMs: Number(row.durationMs || 0), name: sanitizeUrl(row.name || '') }))
  };
}

function safeEvidenceValue(evidence) {
  if (evidence?.value == null) return evidence?.value;
  if (evidence.kind === 'url' || evidence.kind === 'link-url' || evidence.kind === 'canonical' || evidence.kind === 'redirect-chain') return sanitizeUrl(evidence.value);
  if (evidence.kind === 'markup' || (evidence.kind === 'evidence' && String(evidence.value || '').trim().startsWith('<'))) return sanitizeMarkup(evidence.value);
  if (evidence.kind === 'selector') return sanitizeSelector(evidence.value);
  if (typeof evidence.value === 'string') return sanitizeText(evidence.value, 900);
  if (typeof evidence.value === 'number' || typeof evidence.value === 'boolean' || evidence.value == null) return evidence.value;
  return sanitizeStructured(evidence.value);
}

export function aiEvidenceEnvelope(graph = {}) {
  const f = graph.finding || {};
  const evidence = (graph.evidence || []).slice(0, 28).map(e => ({
    id: sanitizeText(e.id, 180), source: sanitizeText(e.source, 80), kind: sanitizeText(e.kind, 80), label: sanitizeText(e.label, 120), value: safeEvidenceValue(e), scope: sanitizeText(e.scope, 80), targetId: sanitizeText(e.targetId, 180)
  }));
  const targets = Object.fromEntries(Object.entries(graph.targets || {}).slice(0, 20).map(([id, target]) => [sanitizeText(id, 180), {
    selector: sanitizeSelector(target.selector),
    context: target.context ? {
      tag: sanitizeText(target.context.tag, 40),
      markup: sanitizeMarkup(target.context.markup),
      text: sanitizeText(target.context.text, 400),
      styles: Object.fromEntries(Object.entries(target.context.styles || {}).filter(([key]) => ['color','backgroundColor','fontSize','fontWeight','lineHeight','display','position'].includes(key)).map(([key, value]) => [key, sanitizeText(value, 80)]))
    } : null
  }]));
  return {
    contractVersion: 2,
    rules: {
      wholeDomAllowed: false,
      formValuesAllowed: false,
      cookiesAllowed: false,
      queryValuesRetained: false,
      arbitraryDataAttributesAllowed: false,
      findingFieldsAllowlisted: true
    },
    finding: {
      id: sanitizeText(f.id, 180), ruleId: sanitizeText(f.ruleId, 180), title: sanitizeText(f.title, 180), detail: sanitizeText(f.detail, 800),
      category: sanitizeText(f.category, 40), severity: sanitizeText(f.severity, 40), confidence: sanitizeText(f.confidence, 40), signal: sanitizeText(f.signal, 120),
      frankPriority: sanitizeText(f.frankPriority, 40), policyReason: sanitizeText(f.policyReason, 260), impactClass: sanitizeText(f.impactClass, 80),
      selector: sanitizeSelector(f.selector), targetId: sanitizeText(f.targetId, 180), targetType: sanitizeText(f.targetType, 40),
      sources: (f.sources || []).slice(0, 12).map(x => sanitizeText(x, 80)), wcag: (f.wcag || []).slice(0, 12).map(x => sanitizeText(x, 40)),
      verification: f.verification ? { state: sanitizeText(f.verification.state, 60), method: sanitizeText(f.verification.method, 160), attempts: Number(f.verification.attempts || 0) } : null,
      semantics: safeSemantics(f.semantics), performanceObservation: safePerformance(f.performanceObservation),
      axe: safeAxe(f.axe), link: safeLink(f.link), wcagExplanation: sanitizeText(f.wcagExplanation, 700)
    },
    page: { url: sanitizeUrl(graph.page?.url), hostname: sanitizeText(graph.page?.hostname, 255), title: sanitizeText(graph.page?.title, 240) },
    environment: sanitizeStructured(graph.environment || null),
    coverage: sanitizeStructured(graph.coverage || {}),
    sources: (graph.sources || []).slice(0, 20).map(x => sanitizeText(x, 80)),
    evidence,
    targets
  };
}


function safeVerification(value = {}) {
  return value && typeof value === 'object' ? {
    state: sanitizeText(value.state, 40),
    method: sanitizeText(value.method, 180),
    attempts: Number(value.attempts || 0),
    evidence: Array.isArray(value.evidence) ? value.evidence.slice(0, 5).map(item => sanitizeText(typeof item === 'string' ? item : JSON.stringify(item), 320)) : []
  } : null;
}

/** Structured verification evidence for reviewer/Frank fidelity (still privacy-bounded). */
export function reviewVerification(value = {}) {
  if (!value || typeof value !== 'object') return null;
  return {
    state: sanitizeText(value.state, 40),
    method: sanitizeText(value.method, 180),
    attempts: Number(value.attempts || 0),
    evidence: Array.isArray(value.evidence) ? value.evidence.slice(0, 5).map(item => {
      if (item && typeof item === 'object') {
        return {
          attempt: Number(item.attempt || 0),
          state: sanitizeText(item.state, 60),
          status: item.status != null ? Number(item.status) : null,
          durationMs: item.durationMs != null ? Number(item.durationMs) : null,
          finalUrl: item.finalUrl ? sanitizeUrl(item.finalUrl) : undefined
        };
      }
      return sanitizeText(typeof item === 'string' ? item : JSON.stringify(item), 320);
    }) : []
  };
}

/**
 * Allowlisted finding projection for MCP review / deterministic Frank.
 * Keeps semantics, axe checks, link, and lab performance — never raw nodes/DOM.
 */
export function reviewFinding(f = {}) {
  return {
    id: sanitizeText(f.id || f.fingerprint, 180),
    fingerprint: sanitizeText(f.fingerprint, 180),
    ruleId: sanitizeText(f.ruleId, 180),
    title: sanitizeText(f.title, 180),
    detail: sanitizeText(f.detail, 700),
    category: sanitizeText(f.category, 40),
    severity: sanitizeText(f.severity, 40),
    confidence: sanitizeText(f.confidence, 40),
    signal: sanitizeText(f.signal, 120),
    frankPriority: sanitizeText(f.frankPriority, 40),
    frankVisible: f.frankVisible !== false,
    policyReason: sanitizeText(f.policyReason, 260),
    impactClass: sanitizeText(f.impactClass, 80),
    selector: sanitizeSelector(f.selector),
    targetId: sanitizeText(f.targetId, 180),
    targetType: sanitizeText(f.targetType, 40),
    evidence: safeEvidenceValue({ kind: 'evidence', value: f.evidence }),
    sources: [...(f.sources || [])].slice(0, 12).map(x => sanitizeText(x, 80)),
    wcag: [...(f.wcag || [])].slice(0, 12).map(x => sanitizeText(x, 40)),
    count: Number(f.count || 1),
    verification: reviewVerification(f.verification),
    link: f.link ? safeLink(f.link) : undefined,
    axe: f.axe ? safeAxe(f.axe) : undefined,
    semantics: f.semantics ? safeSemantics(f.semantics) : undefined,
    performanceObservation: f.performanceObservation ? safePerformance(f.performanceObservation) : undefined,
    wcagExplanation: sanitizeText(f.wcagExplanation, 700)
  };
}

function gatewayFinding(f = {}) {
  return {
    id: sanitizeText(f.id, 180), fingerprint: sanitizeText(f.fingerprint, 180), ruleId: sanitizeText(f.ruleId, 180),
    title: sanitizeText(f.title, 180), detail: sanitizeText(f.detail, 700), category: f.category, severity: f.severity,
    confidence: f.confidence, signal: sanitizeText(f.signal, 120), frankPriority: f.frankPriority, frankVisible: f.frankVisible,
    policyReason: sanitizeText(f.policyReason, 260), selector: sanitizeSelector(f.selector), targetId: sanitizeText(f.targetId, 180),
    targetType: f.targetType, evidence: safeEvidenceValue({ kind: 'evidence', value: f.evidence }), sources: [...(f.sources || [])].slice(0, 12),
    wcag: [...(f.wcag || [])].slice(0, 12), verification: safeVerification(f.verification),
    link: f.link ? safeLink(f.link) : undefined,
    axe: f.axe ? safeAxe(f.axe) : undefined,
    wcagExplanation: sanitizeText(f.wcagExplanation, 700)
  };
}

// Minimal report sent from the extension to the assistant gateway for connected context.
// It intentionally excludes axe node payloads, target markup, raw DOM context and incomplete URL lists.
export function gatewayContextEnvelope(report = {}) {
  const page = report.page || {};
  return {
    scannedAt: report.scannedAt,
    page: {
      url: sanitizeUrl(page.url), finalUrl: page.finalUrl ? sanitizeUrl(page.finalUrl) : undefined,
      origin: page.origin ? sanitizeUrl(page.origin) : undefined, hostname: sanitizeText(page.hostname, 255), pathname: sanitizeText(page.pathname, 600),
      title: sanitizeText(page.title, 240), description: sanitizeText(page.description, 500), canonical: page.canonical ? sanitizeUrl(page.canonical) : '',
      robots: sanitizeText(page.robots, 240), lang: sanitizeText(page.lang, 40), h1s: (page.h1s || []).slice(0, 8).map(x => sanitizeText(x, 180)),
      schemaTypes: (page.schemaTypes || []).slice(0, 20).map(x => sanitizeText(x, 100)), schemaBlockCount: Number(page.schemaBlockCount || 0),
      formCount: Number(page.formCount || 0), imageCount: Number(page.imageCount || 0), linkCount: Number(page.linkCount || 0), interactiveCount: Number(page.interactiveCount || 0)
    },
    environment: report.environment || page.environment || null,
    findings: (report.findings || []).slice(0, 120).map(gatewayFinding),
    coverage: { ...(report.coverage || {}) },
    linkAudit: report.linkAudit ? {
      checked: Number(report.linkAudit.checked || 0), verifiedHealthy: Number(report.linkAudit.verifiedHealthy || 0),
      confirmedIssues: Number(report.linkAudit.confirmedIssues || 0), inconclusive: Number(report.linkAudit.inconclusive || 0),
      limit: Number(report.linkAudit.limit || 0), reachedLimit: Boolean(report.linkAudit.reachedLimit), degraded: Boolean(report.linkAudit.degraded), cached: Number(report.linkAudit.cached || 0)
    } : null
  };
}

// Graph-like payload sent to the gateway for Frank. IDs are preserved so a returned plan
// can still be validated against the richer local graph, while values are sanitized first.
export function gatewayFrankGraph(graph = {}) {
  const envelope = aiEvidenceEnvelope(graph);
  return {
    version: graph.version,
    findingId: graph.findingId,
    finding: envelope.finding,
    page: envelope.page,
    environment: envelope.environment,
    coverage: envelope.coverage,
    sources: envelope.sources,
    evidence: envelope.evidence,
    targets: envelope.targets
  };
}
