/**
 * Bounded, sanitized review evidence for Cursor MCP / acceptance reviewers.
 * Builds from a gateway (or extension) scan report. Does not persist raw DOM,
 * documentHtmlSample, incomplete URL inventories, or unsanitized axe nodes.
 */
import {
  reviewFinding,
  safePerformance,
  sanitizeMarkup,
  sanitizeText,
  sanitizeUrl
} from './evidence-contract.js';
import { composeAttention, composedBrief } from '../findings/compose.js';
import { applyFindingPolicy } from '../findings/policy.js';
import { resolvePerformanceCoverage } from '../findings/coverage.js';
import { materialityScore } from '../findings/impact.js';
import { QA_AREA_META, presentFinding } from '../presentation/present.js';
import {
  TARGET_STATES,
  targetIntegrityBrief,
  targetIntegrityReached
} from '../integrity/target-integrity.js';
import { buildEvidenceGraph } from '../frank/evidence.js';
import { deterministicFrankPlan, validateFrankPlan } from '../frank/plan.js';

export const REVIEW_BUNDLE_CONTRACT_VERSION = 1;

/** Stable provenance labels for acceptance reviewers (not inventable findings). */
export const REVIEW_PROVENANCE = Object.freeze({
  webqa_evidence: 'gateway_api_scan',
  attention_priority: 'mcp_local_recompose',
  frank_deterministic: 'mcp_local_packages_frank',
  browser_observation: 'not_in_artifact',
  reviewer_inference: 'not_in_artifact'
});

export function buildReviewProvenance(report = {}) {
  const gatewayHadAttention = Boolean(report.attention?.groups?.length);
  return {
    labels: { ...REVIEW_PROVENANCE },
    scanEvidence: {
      source: REVIEW_PROVENANCE.webqa_evidence,
      note: 'Sanitized findings, coverage, targetIntegrity, link aggregates, and lab performance derive from gateway /api/scan (or an equivalent scan report).'
    },
    attention: {
      source: REVIEW_PROVENANCE.attention_priority,
      method: 'packages/findings/policy.js#applyFindingPolicy + packages/findings/compose.js#composeAttention',
      gatewayProvided: gatewayHadAttention,
      note: 'Recommended Order is recomposed locally: applyFindingPolicy then composeAttention. Gateway /api/scan does not return attention.'
    },
    priority: {
      source: REVIEW_PROVENANCE.attention_priority,
      method: 'packages/findings/compose.js#composedBrief',
      gatewayBriefPresent: Boolean(report.priorityBrief),
      note: 'priority.brief and ordering are recomposed locally from local policy + composeAttention. Do not treat them as verbatim /api/scan priorityBrief.'
    },
    frank: {
      source: REVIEW_PROVENANCE.frank_deterministic,
      includedInBundle: false,
      method: 'packages/frank deterministicFrankPlan via webqa_frank_plan',
      note: 'Frank plans are not returned by /api/scan. Generate on demand with webqa_frank_plan (production deterministic planner; no cloud AI; no Chrome Prompt API).'
    },
    browser_observation: {
      source: REVIEW_PROVENANCE.browser_observation,
      note: 'Cursor Browser observations are never stored in this artifact and must not be promoted into WebQA findings.'
    },
    reviewer_inference: {
      source: REVIEW_PROVENANCE.reviewer_inference,
      note: 'Reviewer judgment is outside this artifact.'
    }
  };
}

export const REVIEW_BOUNDS = Object.freeze({
  maxGroups: 12,
  maxFindingsDetail: 24,
  maxIndexFindings: 80,
  maxConfirmedLinks: 20,
  maxSignals: 12,
  maxEvidencePreview: 28,
  maxPlanSteps: 8,
  maxArtifactChars: 900_000,
  maxIndexResponseChars: 120_000
});

function areaLabel(impactClass) {
  return QA_AREA_META[impactClass]?.label || impactClass || '';
}

function findingId(f = {}) {
  return String(f.id || f.fingerprint || f.ruleId || '');
}

function sanitizeEnvironment(env) {
  if (!env || typeof env !== 'object') return { type: typeof env === 'string' ? sanitizeText(env, 40) : 'unknown', confidence: 0 };
  return {
    type: sanitizeText(env.type, 40),
    confidence: Number(env.confidence || 0),
    confidenceLabel: sanitizeText(env.confidenceLabel, 40)
  };
}

function sanitizeTargetIntegrity(integrity) {
  if (!integrity || typeof integrity !== 'object') {
    return { state: TARGET_STATES.REACHED, confidence: '', score: null, signals: [], pageQaWithheld: false };
  }
  const state = sanitizeText(integrity.state, 40) || TARGET_STATES.REACHED;
  const reached = state === TARGET_STATES.REACHED;
  return {
    state,
    confidence: sanitizeText(integrity.confidence, 40),
    score: integrity.score != null ? Number(integrity.score) : null,
    signals: [...(integrity.signals || [])].slice(0, REVIEW_BOUNDS.maxSignals).map(s => sanitizeText(s, 80)),
    httpStatus: integrity.httpStatus != null ? Number(integrity.httpStatus) : null,
    requestedUrl: integrity.requestedUrl ? sanitizeUrl(integrity.requestedUrl) : undefined,
    finalUrl: integrity.finalUrl ? sanitizeUrl(integrity.finalUrl) : undefined,
    requestedHost: sanitizeText(integrity.requestedHost, 255),
    finalHost: sanitizeText(integrity.finalHost, 255),
    pageQaWithheld: !reached,
    note: reached
      ? ''
      : 'Page QA conclusions about the requested site were withheld because target integrity was not confirmed as reached.'
    // renderedTitle intentionally omitted — can carry challenge/interstitial page text
  };
}

function coverageSnapshot(coverage = {}) {
  const out = {};
  for (const [key, value] of Object.entries(coverage || {}).slice(0, 24)) {
    out[sanitizeText(key, 40)] = sanitizeText(value, 80);
  }
  return out;
}

function sanitizeEvidenceValue(value) {
  if (value == null || typeof value === 'number' || typeof value === 'boolean') return value;
  if (typeof value === 'string') return sanitizeText(value, 900);
  if (Array.isArray(value)) return value.slice(0, 12).map(sanitizeEvidenceValue);
  if (typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).slice(0, 20).map(([k, v]) => {
        if (/url|href|src|finalUrl|name$/i.test(k) && typeof v === 'string') return [k, sanitizeUrl(v)];
        return [k, sanitizeEvidenceValue(v)];
      })
    );
  }
  return sanitizeText(String(value), 200);
}

function evidencePreview(finding) {
  const graph = buildEvidenceGraph({
    finding,
    page: { url: '', hostname: '', title: '' },
    coverage: {},
    environment: { type: 'unknown' },
    targetContext: null
  });
  return (graph.evidence || []).slice(0, REVIEW_BOUNDS.maxEvidencePreview).map(e => ({
    id: sanitizeText(e.id, 180),
    source: sanitizeText(e.source, 80),
    kind: sanitizeText(e.kind, 80),
    label: sanitizeText(e.label, 120),
    value: sanitizeEvidenceValue(e.value),
    scope: sanitizeText(e.scope, 80)
  }));
}

function pickDetailFindings(composition, findingsById, material, maxDetail) {
  const orderedIds = [];
  const seen = new Set();
  const push = (id) => {
    if (!id || seen.has(id) || orderedIds.length >= maxDetail) return;
    seen.add(id);
    orderedIds.push(id);
  };
  for (const g of composition.groups || []) push(findingId(g.lead));
  for (const g of composition.allGroups || []) {
    push(findingId(g.lead));
    for (const inst of g.instances || []) push(findingId(inst));
  }
  for (const f of material || []) push(findingId(f));
  return orderedIds.slice(0, maxDetail).map(id => findingsById.get(id)).filter(Boolean);
}

function confirmedBrokenLinks(findings = []) {
  return findings
    .filter(f => f.link?.url && /broken-link|link-404|link-410|link-5xx/i.test(String(f.ruleId || '')) && f.confidence !== 'inconclusive')
    .slice(0, REVIEW_BOUNDS.maxConfirmedLinks)
    .map(f => ({
      findingId: findingId(f),
      url: sanitizeUrl(f.link.url),
      status: Number(f.link.status || 0),
      text: sanitizeText(f.link.text, 180),
      prominence: sanitizeText(f.link.prominence, 80),
      verification: f.verification ? {
        state: sanitizeText(f.verification.state, 40),
        method: sanitizeText(f.verification.method, 180),
        attempts: Number(f.verification.attempts || 0)
      } : null
    }));
}

function labPerformance(report = {}) {
  const fromFinding = (report.findings || []).find(f => f.performanceObservation?.available)?.performanceObservation;
  const raw = report.browserPerformance?.available ? report.browserPerformance : fromFinding;
  if (!raw?.available) return null;
  return safePerformance(raw);
}

/**
 * Build a bounded sanitized review bundle from a scan report.
 */
export function buildReviewBundle(report = {}, {
  requestId = '',
  gateway = '',
  requestedUrl = '',
  maxGroups = REVIEW_BOUNDS.maxGroups,
  maxFindingsDetail = REVIEW_BOUNDS.maxFindingsDetail
} = {}) {
  const page = report.page || {};
  const integrity = page.targetIntegrity || report.targetIntegrity || null;
  const environment = report.environment || page.environment || { type: 'unknown' };
  const pageQaWithheld = !targetIntegrityReached(integrity);
  const rawFindings = Array.isArray(report.findings) ? report.findings : [];
  // Review bundle is stricter than production suppress prefixes: when the page was
  // not reached, do not surface any residual findings as auditable site QA.
  // Re-apply local policy so MCP review reflects current product rules even when
  // the gateway artifact was produced by an older deploy.
  const findings = pageQaWithheld ? [] : applyFindingPolicy(rawFindings, environment);
  const findingsById = new Map();
  for (const f of findings) {
    const id = findingId(f);
    if (id) findingsById.set(id, f);
  }

  const composition = composeAttention(findings, { limit: maxGroups });
  const classLabels = Object.fromEntries(
    Object.keys(QA_AREA_META).map(id => [id, QA_AREA_META[id].label])
  );

  const material = findings.filter(f => f.frankVisible !== false && f.category !== 'context' && f.confidence !== 'inconclusive');
  const detailRaw = pickDetailFindings(composition, findingsById, material, maxFindingsDetail);
  const detailIds = new Set(detailRaw.map(findingId));
  const index = material
    .slice()
    .sort((a, b) => materialityScore(b) - materialityScore(a))
    .slice(0, REVIEW_BOUNDS.maxIndexFindings)
    .map(f => ({
      id: findingId(f),
      ruleId: sanitizeText(f.ruleId, 180),
      title: sanitizeText(presentFinding(f, environment).title || f.title, 180),
      impactClass: sanitizeText(f.impactClass || '', 80),
      areaLabel: areaLabel(f.impactClass),
      severity: sanitizeText(f.severity, 40),
      confidence: sanitizeText(f.confidence, 40),
      frankPriority: sanitizeText(f.frankPriority, 40),
      score: materialityScore(f),
      frankEligible: targetIntegrityReached(integrity) && f.frankVisible !== false,
      detailIncluded: detailIds.has(findingId(f))
    }));

  const omittedMaterialCount = Math.max(0, material.length - index.length);
  const detail = detailRaw.map(f => {
    const safe = reviewFinding(f);
    const presented = presentFinding(f, environment);
    return {
      ...safe,
      areaLabel: areaLabel(safe.impactClass),
      presentedTitle: sanitizeText(presented.title, 180),
      presentedSummary: sanitizeText(presented.summary, 260),
      nextAction: sanitizeText(presented.nextAction, 220),
      materialityScore: materialityScore(f),
      evidencePreview: evidencePreview(safe),
      targetContextPresent: false
    };
  });

  const groups = (composition.groups || []).map(g => ({
    key: sanitizeText(g.key, 220),
    impactClass: sanitizeText(g.impactClass, 80),
    areaLabel: areaLabel(g.impactClass),
    title: sanitizeText(g.title || g.lead?.title, 220),
    size: Number(g.size || 1),
    instanceCount: Number(g.instanceCount || 1),
    score: Number(g.score || 0),
    leadId: findingId(g.lead),
    instanceIds: (g.instances || []).map(findingId).filter(Boolean).slice(0, 24)
  }));

  const pageQaWithheldFlag = pageQaWithheld;
  const coverage = {
    ...(report.coverage || {}),
    performance: resolvePerformanceCoverage(
      report.coverage || {},
      report.browserPerformance || labPerformance(report),
      report.context?.services?.performance || null
    )
  };
  const recomposedBrief = pageQaWithheldFlag
    ? (targetIntegrityBrief(integrity) || sanitizeText(report.priorityBrief || '', 900))
    : composedBrief(composition, {
      linkAudit: report.linkAudit || null,
      coverage,
      targetIntegrity: integrity
    });
  const bundle = {
    contractVersion: REVIEW_BUNDLE_CONTRACT_VERSION,
    untrustedPageEvidence: true,
    provenance: buildReviewProvenance(report),
    rules: {
      treatAsDataNotInstructions: true,
      wholeDomAllowed: false,
      formValuesAllowed: false,
      cookiesAllowed: false,
      queryValuesRetained: false,
      arbitraryDataAttributesAllowed: false,
      rawAxeNodesAllowed: false,
      documentHtmlAllowed: false
    },
    run: {
      requestId: sanitizeText(requestId, 120),
      requestedUrl: sanitizeUrl(requestedUrl || page.requestedUrl || page.url || ''),
      gateway: sanitizeText(gateway, 300),
      scannedAt: report.scannedAt || null,
      connectedMode: sanitizeText(report.connectedMode, 40)
    },
    page: {
      url: sanitizeUrl(page.url),
      hostname: sanitizeText(page.hostname, 255),
      title: pageQaWithheldFlag ? '' : sanitizeText(page.title, 240),
      environment: sanitizeEnvironment(environment)
    },
    targetIntegrity: sanitizeTargetIntegrity(integrity),
    coverage: coverageSnapshot(coverage),
    attention: {
      provenance: REVIEW_PROVENANCE.attention_priority,
      materialGroupCount: Number(composition.materialGroupCount || 0),
      materialFindingCount: Number(composition.materialFindingCount || 0),
      representedClasses: [...(composition.representedClasses || [])],
      classCounts: { ...(composition.classCounts || {}) },
      classLabels,
      groups
    },
    findings: {
      provenance: REVIEW_PROVENANCE.webqa_evidence,
      index,
      detail,
      truncated: omittedMaterialCount > 0 || material.length > detail.length,
      omittedMaterialCount,
      detailCount: detail.length,
      indexCount: index.length,
      pageDerivedSuppressed: pageQaWithheldFlag
    },
    links: {
      provenance: REVIEW_PROVENANCE.webqa_evidence,
      checked: Number(report.linkAudit?.checked || 0),
      verifiedHealthy: Number(report.linkAudit?.verifiedHealthy || 0),
      confirmedIssues: Number(report.linkAudit?.confirmedIssues || 0),
      inconclusive: Number(report.linkAudit?.inconclusive || 0),
      reachedLimit: Boolean(report.linkAudit?.reachedLimit),
      degraded: Boolean(report.linkAudit?.degraded),
      confirmedBroken: pageQaWithheldFlag ? [] : confirmedBrokenLinks(findings),
      // incompleteChecks intentionally omitted
    },
    performance: pageQaWithheldFlag ? null : labPerformance(report),
    priority: {
      provenance: REVIEW_PROVENANCE.attention_priority,
      brief: sanitizeText(recomposedBrief || report.priorityBrief || '', 900),
      mode: sanitizeText(pageQaWithheldFlag ? 'target-integrity' : (report.priorityMode || 'deterministic'), 40),
      reason: sanitizeText(report.priorityReason || (pageQaWithheldFlag ? 'target-integrity' : ''), 320),
      ordering: groups.map(g => ({ leadId: g.leadId, areaLabel: g.areaLabel, title: g.title, score: g.score })),
      gatewayBriefRetained: false
    },
    frank: {
      provenance: REVIEW_PROVENANCE.frank_deterministic,
      eligible: !pageQaWithheldFlag,
      withholdReason: pageQaWithheldFlag
        ? 'Target integrity did not confirm the requested page was reached; page-fix Frank recommendations are withheld.'
        : '',
      targetContextPresent: false,
      rewrite: 'none',
      mode: 'deterministic',
      planIncluded: false
    }
  };

  const serialized = JSON.stringify(bundle);
  if (serialized.length > REVIEW_BOUNDS.maxArtifactChars) {
    bundle.findings.detail = bundle.findings.detail.slice(0, Math.max(6, Math.floor(bundle.findings.detail.length / 2)));
    bundle.findings.truncated = true;
    bundle.findings.omittedMaterialCount = Math.max(
      bundle.findings.omittedMaterialCount,
      material.length - bundle.findings.detail.length
    );
    bundle.sizeLimited = true;
  }
  return bundle;
}

/** Concise MCP summary derived from a review bundle (stable lead IDs). */
export function summarizeFromReview(review = {}, { maxFindings = 12 } = {}) {
  const groups = (review.attention?.groups || []).slice(0, maxFindings).map(g => {
    const lead = (review.findings?.detail || []).find(f => f.id === g.leadId)
      || (review.findings?.index || []).find(f => f.id === g.leadId)
      || {};
    return {
      area: g.areaLabel || review.attention?.classLabels?.[g.impactClass] || g.impactClass || '',
      impactClass: g.impactClass || '',
      title: g.title || lead.title || '',
      instanceCount: Number(g.instanceCount || 1),
      score: Number(g.score || 0),
      leadId: g.leadId || '',
      lead: {
        id: lead.id || g.leadId || '',
        ruleId: lead.ruleId || '',
        title: lead.presentedTitle || lead.title || '',
        detail: lead.presentedSummary || lead.detail || '',
        category: lead.category || '',
        severity: lead.severity || '',
        confidence: lead.confidence || '',
        impactClass: lead.impactClass || g.impactClass || '',
        targetType: lead.targetType || '',
        link: lead.link || null,
        verification: lead.verification ? {
          method: lead.verification.method || '',
          attempts: Number(lead.verification.attempts || 0),
          state: lead.verification.state || ''
        } : null,
        sources: Array.isArray(lead.sources) ? lead.sources.slice(0, 8) : []
      }
    };
  });
  return {
    page: {
      url: review.page?.url || '',
      hostname: review.page?.hostname || '',
      title: review.page?.title || '',
      environment: review.page?.environment?.type || 'unknown',
      targetIntegrity: review.targetIntegrity?.state || TARGET_STATES.REACHED
    },
    assessment: review.priority?.brief || '',
    priorityMode: review.priority?.mode || '',
    connectedMode: review.run?.connectedMode || '',
    coverage: review.coverage || {},
    attention: {
      materialGroupCount: Number(review.attention?.materialGroupCount || 0),
      materialFindingCount: Number(review.attention?.materialFindingCount || 0),
      representedClasses: review.attention?.representedClasses || [],
      classCounts: review.attention?.classCounts || {},
      classLabels: review.attention?.classLabels || {},
      groups
    },
    linkAudit: review.links ? {
      checked: Number(review.links.checked || 0),
      confirmedIssues: Number(review.links.confirmedIssues || 0),
      inconclusive: Number(review.links.inconclusive || 0),
      reachedLimit: Boolean(review.links.reachedLimit)
    } : null,
    frank: {
      eligible: Boolean(review.frank?.eligible),
      withholdReason: review.frank?.withholdReason || '',
      provenance: review.frank?.provenance || REVIEW_PROVENANCE.frank_deterministic,
      planIncluded: false
    },
    scannedAt: review.run?.scannedAt || null,
    untrustedPageEvidence: true,
    provenance: review.provenance || null
  };
}

export function reviewBundleIndex(review = {}) {
  const index = {
    contractVersion: review.contractVersion,
    untrustedPageEvidence: true,
    provenance: review.provenance || buildReviewProvenance({}),
    rules: review.rules,
    run: review.run,
    page: review.page,
    targetIntegrity: {
      state: review.targetIntegrity?.state,
      confidence: review.targetIntegrity?.confidence,
      pageQaWithheld: Boolean(review.targetIntegrity?.pageQaWithheld),
      note: review.targetIntegrity?.note || ''
    },
    coverage: review.coverage,
    attention: {
      provenance: review.attention?.provenance || REVIEW_PROVENANCE.attention_priority,
      materialGroupCount: review.attention?.materialGroupCount,
      materialFindingCount: review.attention?.materialFindingCount,
      representedClasses: review.attention?.representedClasses,
      classCounts: review.attention?.classCounts,
      classLabels: review.attention?.classLabels,
      groups: (review.attention?.groups || []).map(g => ({
        leadId: g.leadId,
        areaLabel: g.areaLabel,
        impactClass: g.impactClass,
        title: g.title,
        score: g.score,
        instanceCount: g.instanceCount
      }))
    },
    findings: {
      provenance: review.findings?.provenance || REVIEW_PROVENANCE.webqa_evidence,
      index: review.findings?.index || [],
      truncated: Boolean(review.findings?.truncated),
      omittedMaterialCount: Number(review.findings?.omittedMaterialCount || 0),
      detailCount: Number(review.findings?.detailCount || 0),
      indexCount: Number(review.findings?.indexCount || 0)
      // detail intentionally omitted from default index
    },
    links: {
      provenance: review.links?.provenance || REVIEW_PROVENANCE.webqa_evidence,
      checked: review.links?.checked,
      confirmedIssues: review.links?.confirmedIssues,
      inconclusive: review.links?.inconclusive,
      confirmedBrokenCount: (review.links?.confirmedBroken || []).length
    },
    performance: review.performance ? {
      available: true,
      measurement: review.performance.measurement,
      largestContentfulPaintMs: review.performance.largestContentfulPaintMs,
      ttfbMs: review.performance.ttfbMs,
      transferBytes: review.performance.transferBytes
    } : null,
    priority: {
      provenance: review.priority?.provenance || REVIEW_PROVENANCE.attention_priority,
      brief: review.priority?.brief,
      mode: review.priority?.mode,
      ordering: review.priority?.ordering || [],
      gatewayBriefRetained: false
    },
    frank: review.frank,
    responseShape: 'compact_index',
    note: 'Default webqa_review_run returns this compact index only. Request section=findings|full|attention|… explicitly for drill-down.'
  };
  const serialized = JSON.stringify(index);
  if (serialized.length > REVIEW_BOUNDS.maxIndexResponseChars) {
    index.findings = {
      ...index.findings,
      index: (index.findings.index || []).slice(0, 24),
      truncated: true,
      responseTruncated: true
    };
    index.sizeLimited = true;
  }
  return index;
}

export function getReviewFinding(review = {}, findingIdValue = '') {
  const id = String(findingIdValue || '');
  const detail = (review.findings?.detail || []).find(f => f.id === id || f.fingerprint === id);
  if (detail) return detail;
  const indexed = (review.findings?.index || []).find(f => f.id === id);
  if (!indexed) return null;
  return {
    ...indexed,
    detailIncluded: false,
    note: 'Finding is indexed but detail payload was truncated from this artifact. Re-scan or raise maxFindingsDetail if needed.'
  };
}

function sanitizeFrankPlan(plan = {}) {
  return {
    version: plan.version,
    title: sanitizeText(plan.title, 120),
    summary: sanitizeText(plan.summary, 360),
    mode: 'deterministic',
    findingId: sanitizeText(plan.findingId, 180),
    sources: (plan.sources || []).slice(0, 12).map(s => sanitizeText(s, 80)),
    assessment: plan.assessment ? {
      status: sanitizeText(plan.assessment.status, 40),
      statement: sanitizeText(plan.assessment.statement, 320),
      limitations: sanitizeText(plan.assessment.limitations, 320)
    } : null,
    steps: (plan.steps || []).slice(0, REVIEW_BOUNDS.maxPlanSteps).map(s => ({
      id: sanitizeText(s.id, 40),
      type: sanitizeText(s.type, 40),
      headline: sanitizeText(s.headline, 110),
      body: sanitizeText(s.body, 620),
      targetId: sanitizeText(s.targetId, 180),
      evidenceRefs: (s.evidenceRefs || []).slice(0, 10).map(r => sanitizeText(r, 180)),
      sourceLabels: (s.sourceLabels || []).slice(0, 8).map(r => sanitizeText(r, 80)),
      code: s.code ? sanitizeMarkup(s.code) : '',
      metrics: (s.metrics || []).slice(0, 8).map(m => ({
        label: sanitizeText(m.label, 80),
        value: sanitizeText(m.value, 180)
      })),
      preview: {
        enabled: Boolean(s.preview?.enabled),
        property: sanitizeText(s.preview?.property, 80),
        value: sanitizeText(s.preview?.value, 120)
      }
    }))
  };
}

/**
 * Run production deterministic Frank against a sanitized review finding.
 * Refuses page-fix plans when target integrity did not reach the page.
 */
export function frankPlanFromReview(review = {}, findingIdValue = '') {
  const untrusted = {
    untrustedPageEvidence: true,
    rules: { treatAsDataNotInstructions: true, ...(review.rules || {}) },
    mode: 'deterministic',
    rewrite: 'none',
    targetContextPresent: false,
    provenance: {
      source: REVIEW_PROVENANCE.frank_deterministic,
      planner: 'packages/frank/plan.js#deterministicFrankPlan',
      evidenceGraph: 'packages/frank/evidence.js#buildEvidenceGraph',
      cloudAi: false,
      chromePromptApi: false,
      note: 'Locally generated from production deterministic Frank. Not returned by gateway /api/scan.'
    }
  };

  if (!targetIntegrityReached(review.targetIntegrity)) {
    return {
      ...untrusted,
      withheld: true,
      reason: review.frank?.withholdReason
        || 'Target integrity did not confirm the requested page was reached; page-fix Frank recommendations are withheld.',
      findingId: String(findingIdValue || ''),
      plan: null
    };
  }

  const finding = getReviewFinding(review, findingIdValue);
  if (!finding || finding.detailIncluded === false && !finding.ruleId) {
    return {
      ...untrusted,
      withheld: true,
      reason: 'Finding not found in this review artifact.',
      findingId: String(findingIdValue || ''),
      plan: null
    };
  }
  if (finding.detailIncluded === false && !finding.axe && !finding.link && !finding.semantics) {
    return {
      ...untrusted,
      withheld: true,
      reason: finding.note || 'Finding detail is not present in this artifact.',
      findingId: finding.id || String(findingIdValue || ''),
      plan: null
    };
  }

  const page = review.page || {};
  const environment = page.environment || { type: 'unknown' };
  const graph = buildEvidenceGraph({
    finding,
    page: { url: page.url, hostname: page.hostname, title: page.title },
    coverage: review.coverage || {},
    environment,
    targetContext: null
  });
  const plan = deterministicFrankPlan(graph);
  const valid = validateFrankPlan(plan, graph);
  if (!valid) {
    return {
      ...untrusted,
      withheld: true,
      reason: 'Deterministic Frank plan failed validation against the evidence graph.',
      findingId: finding.id || String(findingIdValue || ''),
      valid: false,
      plan: null
    };
  }
  const evidence = (graph.evidence || []).slice(0, REVIEW_BOUNDS.maxEvidencePreview).map(e => ({
    id: e.id,
    source: e.source,
    kind: e.kind,
    label: e.label,
    value: sanitizeEvidenceValue(e.value)
  }));

  return {
    ...untrusted,
    withheld: false,
    reason: '',
    findingId: finding.id || String(findingIdValue || ''),
    valid: true,
    plan: sanitizeFrankPlan(plan),
    evidence,
    presentation: {
      title: sanitizeText(finding.presentedTitle || finding.title, 180),
      summary: sanitizeText(finding.presentedSummary || finding.detail, 260),
      nextAction: sanitizeText(finding.nextAction || '', 220)
    }
  };
}

/**
 * Re-project a stored review bundle through allowlisted builders so forged
 * qa-runs JSON cannot smuggle raw axe nodes, HTML, or unknown keys into MCP.
 */
export function hardenStoredReview(review = {}) {
  const detail = (review.findings?.detail || []).slice(0, REVIEW_BOUNDS.maxFindingsDetail).map(f => {
    const safe = reviewFinding(f);
    return {
      ...safe,
      areaLabel: sanitizeText(f.areaLabel || areaLabel(safe.impactClass), 80),
      presentedTitle: sanitizeText(f.presentedTitle || safe.title, 180),
      presentedSummary: sanitizeText(f.presentedSummary || safe.detail, 260),
      nextAction: sanitizeText(f.nextAction || '', 220),
      materialityScore: Number(f.materialityScore || 0),
      evidencePreview: Array.isArray(f.evidencePreview)
        ? f.evidencePreview.slice(0, REVIEW_BOUNDS.maxEvidencePreview).map(e => ({
          id: sanitizeText(e.id, 180),
          source: sanitizeText(e.source, 80),
          kind: sanitizeText(e.kind, 80),
          label: sanitizeText(e.label, 120),
          value: sanitizeEvidenceValue(e.value),
          scope: sanitizeText(e.scope, 80)
        }))
        : evidencePreview(safe),
      targetContextPresent: false
    };
  });
  const index = (review.findings?.index || []).slice(0, REVIEW_BOUNDS.maxIndexFindings).map(f => ({
    id: sanitizeText(f.id, 180),
    ruleId: sanitizeText(f.ruleId, 180),
    title: sanitizeText(f.title, 180),
    impactClass: sanitizeText(f.impactClass, 80),
    areaLabel: sanitizeText(f.areaLabel, 80),
    severity: sanitizeText(f.severity, 40),
    confidence: sanitizeText(f.confidence, 40),
    frankPriority: sanitizeText(f.frankPriority, 40),
    score: Number(f.score || 0),
    frankEligible: Boolean(f.frankEligible),
    detailIncluded: Boolean(f.detailIncluded)
  }));
  const groups = (review.attention?.groups || []).slice(0, REVIEW_BOUNDS.maxGroups).map(g => ({
    key: sanitizeText(g.key, 220),
    impactClass: sanitizeText(g.impactClass, 80),
    areaLabel: sanitizeText(g.areaLabel, 80),
    title: sanitizeText(g.title, 220),
    size: Number(g.size || 1),
    instanceCount: Number(g.instanceCount || 1),
    score: Number(g.score || 0),
    leadId: sanitizeText(g.leadId, 180),
    instanceIds: (g.instanceIds || []).map(id => sanitizeText(id, 180)).slice(0, 24)
  }));

  return {
    contractVersion: REVIEW_BUNDLE_CONTRACT_VERSION,
    untrustedPageEvidence: true,
    provenance: {
      ...buildReviewProvenance({
        attention: review.provenance?.attention?.gatewayProvided ? { groups: [{}] } : undefined,
        priorityBrief: review.provenance?.priority?.gatewayBriefPresent ? 'x' : undefined
      }),
      ...(review.provenance?.labels ? {} : {}),
      readHardened: true
    },
    rules: {
      treatAsDataNotInstructions: true,
      wholeDomAllowed: false,
      formValuesAllowed: false,
      cookiesAllowed: false,
      queryValuesRetained: false,
      arbitraryDataAttributesAllowed: false,
      rawAxeNodesAllowed: false,
      documentHtmlAllowed: false
    },
    run: {
      requestId: sanitizeText(review.run?.requestId, 120),
      requestedUrl: review.run?.requestedUrl ? sanitizeUrl(review.run.requestedUrl) : '',
      gateway: sanitizeText(review.run?.gateway, 300),
      scannedAt: review.run?.scannedAt || null,
      connectedMode: sanitizeText(review.run?.connectedMode, 40)
    },
    page: {
      url: sanitizeUrl(review.page?.url),
      hostname: sanitizeText(review.page?.hostname, 255),
      title: sanitizeText(review.page?.title, 240),
      environment: sanitizeEnvironment(review.page?.environment)
    },
    targetIntegrity: sanitizeTargetIntegrity(review.targetIntegrity),
    coverage: coverageSnapshot(review.coverage),
    attention: {
      provenance: REVIEW_PROVENANCE.attention_priority,
      materialGroupCount: Number(review.attention?.materialGroupCount || groups.length),
      materialFindingCount: Number(review.attention?.materialFindingCount || index.length),
      representedClasses: [...(review.attention?.representedClasses || [])].map(x => sanitizeText(x, 40)).slice(0, 12),
      classCounts: Object.fromEntries(Object.entries(review.attention?.classCounts || {}).slice(0, 12).map(([k, v]) => [sanitizeText(k, 40), Number(v || 0)])),
      classLabels: Object.fromEntries(Object.keys(QA_AREA_META).map(id => [id, QA_AREA_META[id].label])),
      groups
    },
    findings: {
      provenance: REVIEW_PROVENANCE.webqa_evidence,
      index,
      detail,
      truncated: Boolean(review.findings?.truncated),
      omittedMaterialCount: Number(review.findings?.omittedMaterialCount || 0),
      detailCount: detail.length,
      indexCount: index.length,
      pageDerivedSuppressed: Boolean(review.findings?.pageDerivedSuppressed)
    },
    links: {
      provenance: REVIEW_PROVENANCE.webqa_evidence,
      checked: Number(review.links?.checked || 0),
      verifiedHealthy: Number(review.links?.verifiedHealthy || 0),
      confirmedIssues: Number(review.links?.confirmedIssues || 0),
      inconclusive: Number(review.links?.inconclusive || 0),
      reachedLimit: Boolean(review.links?.reachedLimit),
      degraded: Boolean(review.links?.degraded),
      confirmedBroken: (review.links?.confirmedBroken || []).slice(0, REVIEW_BOUNDS.maxConfirmedLinks).map(row => ({
        findingId: sanitizeText(row.findingId, 180),
        url: sanitizeUrl(row.url),
        status: Number(row.status || 0),
        text: sanitizeText(row.text, 180),
        prominence: sanitizeText(row.prominence, 80),
        verification: row.verification ? {
          state: sanitizeText(row.verification.state, 40),
          method: sanitizeText(row.verification.method, 180),
          attempts: Number(row.verification.attempts || 0)
        } : null
      }))
    },
    performance: review.performance ? safePerformance(review.performance) : null,
    priority: {
      provenance: REVIEW_PROVENANCE.attention_priority,
      brief: sanitizeText(review.priority?.brief, 900),
      mode: sanitizeText(review.priority?.mode, 40),
      reason: sanitizeText(review.priority?.reason, 320),
      ordering: (review.priority?.ordering || groups).slice(0, REVIEW_BOUNDS.maxGroups).map(g => ({
        leadId: sanitizeText(g.leadId, 180),
        areaLabel: sanitizeText(g.areaLabel, 80),
        title: sanitizeText(g.title, 220),
        score: Number(g.score || 0)
      })),
      gatewayBriefRetained: false
    },
    frank: {
      provenance: REVIEW_PROVENANCE.frank_deterministic,
      eligible: Boolean(review.frank?.eligible) && targetIntegrityReached(review.targetIntegrity),
      withholdReason: sanitizeText(review.frank?.withholdReason, 320),
      targetContextPresent: false,
      rewrite: 'none',
      mode: 'deterministic',
      planIncluded: false
    }
  };
}
