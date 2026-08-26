/**
 * Normalized current-page evidence for Frank.
 * UI Recommended Order stays a balanced subset; this ledger retains every
 * material group in compact form without raw DOM dumps.
 *
 * Adaptive compression never drops a material group. It only shortens titles,
 * evidence blurbs, and representative targets as group volume grows.
 */
import { composeAttention } from './compose.js';
import { buildCoverageAccounting } from './coverage.js';

function clip(value, n = 220) {
  const s = String(value ?? '').replace(/\s+/g, ' ').trim();
  if (!n) return '';
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
}

function instanceScope(finding = {}) {
  const extra = finding.extra || {};
  if (finding.embeddedContext) return finding.embeddedContext;
  if (extra.embeddedContext) return extra.embeddedContext;
  const linkFrames = extra.link?.frames || finding.link?.frames;
  if (Array.isArray(linkFrames) && linkFrames.length) {
    const unique = [...new Set(linkFrames.map((v) => String(v || 'top-document')))];
    if (unique.length > 1) return 'mixed';
    if (unique[0] && unique[0] !== 'top-document') return unique[0];
  }
  const linkScope = extra.link?.scope || finding.link?.scope;
  if (linkScope && linkScope !== 'top-document') return String(linkScope);
  if (finding.frameSelector || extra.frameSelector) return 'same-origin-iframe';
  if (/iframe-html-lang|iframe-document-title|context=iframe|same-origin-iframe/i.test(String(finding.evidence || finding.detail || ''))) {
    return 'same-origin-iframe';
  }
  if (String(finding.selector || '').includes(' >> ') || String(finding.selector || '').includes(' >>> ')) {
    return 'same-origin-iframe';
  }
  return 'top-document';
}

/** Detail budget by group volume. Groups are never omitted. */
export function ledgerDetailTier(groupCount = 0) {
  const n = Number(groupCount || 0);
  if (n <= 32) return 'rich';
  if (n <= 80) return 'standard';
  return 'compact';
}

function tierLimits(tier) {
  if (tier === 'rich') {
    return { title: 180, evidence: 220, frames: 8, selectors: 4, detailedEvidence: 360 };
  }
  if (tier === 'standard') {
    return { title: 120, evidence: 140, frames: 4, selectors: 2, detailedEvidence: 220 };
  }
  return { title: 80, evidence: 0, frames: 2, selectors: 0, detailedEvidence: 0 };
}

export function compactEvidenceGroup(group = {}, { detailed = false, tier = 'standard' } = {}) {
  const lead = group.lead || {};
  const instances = group.instances || [];
  const frames = [...new Set(instances.map(instanceScope))];
  const limits = tierLimits(tier);
  const row = {
    key: String(group.key || lead.ruleId || ''),
    ruleId: String(lead.ruleId || ''),
    impactClass: String(group.impactClass || lead.impactClass || ''),
    title: clip(group.title || lead.title, limits.title),
    confidence: String(lead.confidence || 'confirmed'),
    count: Number(group.instanceCount || group.size || 1),
    size: Number(group.size || 1),
    targetability: String(lead.targetability || group.targetability || ''),
    scope: frames.length <= 1 ? (frames[0] || 'top-document') : 'mixed'
  };
  if (frames.length && (tier !== 'compact' || row.scope !== 'top-document')) {
    row.frames = frames.slice(0, Math.max(1, limits.frames));
  }
  if (limits.evidence) {
    row.evidenceSummary = clip(lead.evidence || lead.detail, limits.evidence);
  }
  if (detailed && limits.selectors) {
    row.representativeSelectors = (group.selectors || []).filter(Boolean).slice(0, limits.selectors);
    row.representativeEvidence = clip(lead.detail || lead.evidence, limits.detailedEvidence);
  }
  return row;
}

function inconclusiveSummary(findings = []) {
  const buckets = new Map();
  for (const f of findings) {
    if (f?.confidence !== 'inconclusive' || f.frankVisible === false) continue;
    const key = String(f.ruleId || 'unknown');
    if (!buckets.has(key)) buckets.set(key, { ruleId: key, count: 0, impactClass: f.impactClass || '' });
    const row = buckets.get(key);
    row.count += Math.max(1, Number(f.count || 1));
  }
  return [...buckets.values()];
}

/**
 * Compact Frank-facing group list. Always includes every group; never slices a
 * knowledge ceiling. Detail fields may be omitted at the compact tier.
 */
export function compactFrankPageLedger(ledger = {}) {
  const groups = Array.isArray(ledger.groups) ? ledger.groups : [];
  const tier = ledger.compression?.detailTier || ledgerDetailTier(groups.length);
  const includeEvidence = tier === 'rich' || tier === 'standard';
  return {
    materialGroupCount: Number(ledger.materialGroupCount || groups.length || 0),
    uiShown: Number(ledger.uiShown || 0),
    representedClasses: ledger.representedClasses || [],
    classCounts: ledger.classCounts || {},
    groupsOmitted: 0,
    truncated: false,
    detailTier: tier,
    inventory: ledger.inventory || {},
    coverage: ledger.coverage || {},
    groups: groups.map((g) => {
      const row = {
        ruleId: clip(g.ruleId, 160),
        impactClass: clip(g.impactClass, 40),
        count: Number(g.count || 1),
        confidence: clip(g.confidence, 30),
        targetability: clip(g.targetability, 40),
        scope: clip(g.scope || 'top-document', 40)
      };
      if (g.title) row.title = clip(g.title, tier === 'compact' ? 80 : 120);
      if (includeEvidence && g.evidenceSummary) row.evidenceSummary = clip(g.evidenceSummary, 140);
      if (g.frames?.length && (row.scope === 'mixed' || row.scope === 'same-origin-iframe')) {
        row.frames = g.frames.slice(0, 4);
      }
      return row;
    })
  };
}

export function buildEvidenceLedger(report = {}, {
  uiLimit = 8,
  composition = null,
  findings = null
} = {}) {
  const rows = Array.isArray(findings) ? findings : (Array.isArray(report.findings) ? report.findings : []);
  const composed = composition || composeAttention(rows, { limit: uiLimit });
  const accounting = buildCoverageAccounting(report);
  const allGroups = composed.allGroups || [];
  const tier = ledgerDetailTier(allGroups.length);
  const detailedKeys = new Set((composed.groups || []).map((g) => g.key));
  const groups = allGroups.map((g) => compactEvidenceGroup(g, {
    detailed: detailedKeys.has(g.key) && tier !== 'compact',
    tier
  }));
  return {
    inventory: report.page?.inventory || {},
    coverage: {
      degradedAreas: accounting.degradedAreas,
      scopeLimitedAreas: accounting.scopeLimitedAreas,
      completeAreas: accounting.completeAreas,
      links: accounting.links,
      iframes: accounting.iframes,
      interactions: accounting.interactions
    },
    groups,
    uiShown: (composed.groups || []).length,
    uiLimit,
    materialGroupCount: groups.length,
    materialFindingCount: Number(composed.materialFindingCount || 0),
    representedClasses: [...(composed.representedClasses || [])],
    classCounts: { ...(composed.classCounts || {}) },
    inconclusive: inconclusiveSummary(rows),
    truncated: false,
    groupsOmitted: 0,
    compression: {
      strategy: 'adaptive-detail',
      detailTier: tier,
      groupsOmitted: 0,
      rawFindingCount: rows.length,
      groupCount: groups.length,
      detailedGroupCount: groups.filter((g) => Array.isArray(g.representativeSelectors)).length
    },
    timings: report.scanTimings || null
  };
}
