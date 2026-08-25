/**
 * Cross-discipline correlation helpers.
 * Extends findings with inspectable metadata; does not invent a second ranking brain.
 * Page-derived strings remain untrusted data.
 */

import { impactClassFor } from './impact.js';
import { signalForFinding } from './signals.js';

export const CORRELATION_LENSES = Object.freeze([
  'accessibility', 'ux', 'seo', 'performance', 'development', 'security'
]);

export const TARGETABILITY = Object.freeze({
  spotlight: 'spotlight',
  markup: 'markup',
  document: 'document',
  multiple: 'multiple-elements',
  none: 'none'
});

export const FIX_OWNERS = Object.freeze([
  'developer', 'content', 'seo', 'design', 'infrastructure', 'analytics', 'mixed'
]);

const LENS_BY_CLASS = {
  availability: ['ux', 'development'],
  discoverability: ['seo'],
  accessibility: ['accessibility', 'ux'],
  performance: ['performance', 'development', 'ux'],
  security: ['security', 'development'],
  implementation: ['development'],
  coverage: ['development']
};

function hash(input) {
  let h = 2166136261;
  const text = String(input || '');
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(36);
}

export function sanitizeMarkupSnippet(html = '', { max = 280 } = {}) {
  let text = String(html || '');
  text = text.replace(/<script[\s\S]*?<\/script>/gi, '');
  text = text.replace(/\son\w+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '');
  text = text.replace(/(href|src|action|content|data-[\w-]+)\s*=\s*("([^"]*)"|'([^']*)')/gi, (_, attr, _q, d, s) => {
    const raw = d ?? s ?? '';
    try {
      if (/^https?:\/\//i.test(raw) || raw.startsWith('/') || raw.startsWith('#')) {
        const base = 'https://example.invalid';
        const u = new URL(raw, base);
        u.search = '';
        u.hash = u.hash && attr.toLowerCase() === 'href' && raw.startsWith('#') ? u.hash : '';
        const cleaned = raw.startsWith('#') ? `#${u.hash.slice(1).split('?')[0]}` : (u.origin === base ? `${u.pathname}` : `${u.origin}${u.pathname}`);
        return `${attr}="${cleaned.slice(0, 120)}"`;
      }
    } catch {}
    if (/token|key|secret|auth|password|session/i.test(raw)) return `${attr}="[redacted]"`;
    return `${attr}="${String(raw).slice(0, 120)}"`;
  });
  text = text.replace(/\s+/g, ' ').trim();
  return text.slice(0, max);
}

export function targetabilityFor(finding = {}) {
  if (finding.targetability && Object.values(TARGETABILITY).includes(finding.targetability)) {
    return finding.targetability;
  }
  const type = String(finding.targetType || '');
  const rule = String(finding.ruleId || '');
  if (/viewport|canonical|robots|charset|meta-refresh|noindex|title-missing|description-missing|jsonld|canonical-path-conflict|noindex-self-canonical/i.test(rule)) {
    return TARGETABILITY.markup;
  }
  if (/ttfb|weight|transfer|robots-block|canonical-mismatch|title-mismatch|robots-mismatch/i.test(rule)) {
    return TARGETABILITY.document;
  }
  // Slow LCP with a resolved element stays spotlightable; bare LCP without selector is document.
  if (/performance\.browser\.lcp$/i.test(rule)) {
    return finding.selector ? TARGETABILITY.spotlight : TARGETABILITY.document;
  }
  if (type === 'document' || type === 'page' || type === 'historical') {
    return type === 'historical' ? TARGETABILITY.none : TARGETABILITY.document;
  }
  if (Number(finding.count || 1) > 1 && !finding.link?.url) return TARGETABILITY.multiple;
  if (type === 'visual' || finding.selector) return TARGETABILITY.spotlight;
  return TARGETABILITY.none;
}

export function lensesFor(finding = {}) {
  if (Array.isArray(finding.lenses) && finding.lenses.length) {
    return [...new Set(finding.lenses.filter(l => CORRELATION_LENSES.includes(l)))];
  }
  const impact = impactClassFor(finding);
  const lenses = [...(LENS_BY_CLASS[impact] || ['development'])];
  if (finding.link?.prominence === 'navigation' || finding.link?.prominence === 'cta') {
    if (!lenses.includes('ux')) lenses.unshift('ux');
  }
  if (/performance\.browser\.lcp|image-oversized|lcp-image/i.test(String(finding.ruleId || ''))) {
    for (const l of ['performance', 'ux', 'development']) if (!lenses.includes(l)) lenses.push(l);
  }
  return lenses;
}

export function fixOwnerFor(finding = {}) {
  if (finding.fixOwner && FIX_OWNERS.includes(finding.fixOwner)) return finding.fixOwner;
  const rule = String(finding.ruleId || '');
  if (/noindex|canonical|robots|title|description|schema/i.test(rule)) return 'seo';
  if (/link-|fragment/i.test(rule)) return 'developer';
  if (/ttfb/i.test(rule)) return 'infrastructure';
  if (/axe\.|a11y\./i.test(rule)) return 'mixed';
  if (/performance|image-oversized|weight/i.test(rule)) return 'developer';
  if (/security/i.test(rule)) return 'developer';
  return 'developer';
}

export function rootCauseKeyFor(finding = {}) {
  if (finding.rootCauseKey) return String(finding.rootCauseKey);
  const rule = String(finding.ruleId || '').replace(/\.review$/, '');
  if (finding.link?.url) return `dest:${hash(finding.link.url)}`;
  if (finding.performanceObservation?.lcpElement?.url) {
    return `lcp-resource:${hash(finding.performanceObservation.lcpElement.url)}`;
  }
  if (finding.resourceUrl) return `resource:${rule}|${hash(finding.resourceUrl)}`;
  if (/web\.duplicate-id/.test(rule) && finding.evidence) return `dup-id:${hash(finding.evidence)}`;
  if (/viewport|charset|canonical-missing|title-missing|lang-missing|noindex$/.test(rule)) return `doc:${rule}`;
  return `rule:${rule}|${finding.selector || finding.id || finding.fingerprint || hash(finding.evidence || finding.title || '')}`;
}

export function scopeFor(finding = {}) {
  if (finding.scope) return finding.scope;
  const t = targetabilityFor(finding);
  if (t === TARGETABILITY.markup) return 'markup';
  if (t === TARGETABILITY.document || t === TARGETABILITY.none) return 'document';
  if (t === TARGETABILITY.multiple) return 'template/component';
  return 'element';
}

/**
 * Attach inspectable correlation metadata without changing detection outcomes.
 */
export function attachCorrelationMetadata(findings = [], { platform = null } = {}) {
  return findings.map(f => {
    const next = { ...f };
    next.signal = next.signal || signalForFinding(next);
    next.impactClass = impactClassFor(next);
    next.targetability = targetabilityFor(next);
    next.lenses = lensesFor(next);
    next.fixOwner = fixOwnerFor(next);
    next.rootCauseKey = rootCauseKeyFor(next);
    next.scope = scopeFor(next);
    next.occurrences = Math.max(1, Number(next.count || next.link?.occurrences || 1));
    if (platform?.id && platform.confidence === 'high') {
      next.remediationContext = {
        ...(next.remediationContext || {}),
        platform: platform.id,
        platformConfidence: platform.confidence,
        platformSignals: platform.signals || []
      };
    }
    if (next.targetability === TARGETABILITY.markup && next.evidence && /<[^>]+>/.test(String(next.evidence))) {
      next.markupSnippet = sanitizeMarkupSnippet(next.evidence);
    }
    return next;
  });
}

/**
 * Local (browser-only) discoverability contradictions — review language, not automatic "wrong".
 */
export function applyLocalDiscoverabilityCorrelations(findings = [], page = {}) {
  const out = [...findings];
  const has = id => out.some(f => f.ruleId === id);
  const robots = String(page.robots || '');
  const canonical = String(page.canonical || '');
  let canonicalUrl = null;
  try { if (canonical) canonicalUrl = new URL(canonical, page.url || 'https://example.invalid'); } catch {}
  let pageUrl = null;
  try { if (page.url) pageUrl = new URL(page.url); } catch {}

  if (canonicalUrl && pageUrl && canonicalUrl.origin === pageUrl.origin) {
    const a = canonicalUrl.pathname.replace(/\/$/, '') || '/';
    const b = pageUrl.pathname.replace(/\/$/, '') || '/';
    if (a !== b && !has('correlation.canonical-path-conflict')) {
      out.push({
        id: `correlation.canonical-path-conflict:${hash(a + b)}`,
        ruleId: 'correlation.canonical-path-conflict',
        title: 'Canonical path differs from the current URL',
        detail: 'Conflicting discoverability signals need review: the rendered canonical path does not match the current page path. Confirm whether this page should consolidate to another URL.',
        category: 'review',
        severity: 'medium',
        confidence: 'inferred',
        targetType: 'document',
        targetability: TARGETABILITY.markup,
        scope: 'markup',
        sources: ['browser'],
        evidence: `current=${pageUrl.pathname}; canonical=${canonicalUrl.pathname}`,
        fingerprint: hash(`canonical-path|${a}|${b}`),
        verification: { state: 'inferred', method: 'deterministic URL comparison', attempts: 1, evidence: [] },
        count: 1
      });
    }
  }

  if (/\bnoindex\b/i.test(robots) && canonicalUrl && pageUrl && canonicalUrl.href.split('#')[0] === pageUrl.href.split('#')[0] && !has('correlation.noindex-self-canonical')) {
    out.push({
      id: `correlation.noindex-self-canonical:${hash(robots)}`,
      ruleId: 'correlation.noindex-self-canonical',
      title: 'noindex appears with a self-canonical',
      detail: 'Conflicting discoverability signals need review: the page both self-canonicalizes and requests noindex. Confirm the intended indexing state.',
      category: 'review',
      severity: 'medium',
      confidence: 'inferred',
      targetType: 'document',
      targetability: TARGETABILITY.markup,
      scope: 'markup',
      sources: ['browser'],
      evidence: `robots=${robots}; canonical=${canonical}`,
      fingerprint: hash(`noindex-self|${robots}|${canonical}`),
      verification: { state: 'inferred', method: 'deterministic meta comparison', attempts: 1, evidence: [] },
      count: 1
    });
  }

  return out;
}

/**
 * Correlate lab performance observations into more actionable findings when evidence supports it.
 * Does not change LCP/TTFB thresholds.
 */
export function applyPerformanceCorrelations(findings = [], browserPerformance = null) {
  if (!browserPerformance?.available) return findings;
  const out = [...findings];
  const lcpFinding = out.find(f => f.ruleId === 'performance.browser.lcp');
  const lcpEl = browserPerformance.lcpElement;
  if (lcpFinding && lcpEl?.url) {
    const heaviest = (browserPerformance.heaviest || []).find(h => h.name && lcpEl.url && h.name.split('?')[0] === lcpEl.url.split('?')[0]);
    const bytes = Number(heaviest?.bytes || 0);
    if (bytes >= 500000 && !out.some(f => f.ruleId === 'performance.browser.lcp-heavy-image')) {
      out.push({
        id: `performance.browser.lcp-heavy-image:${hash(lcpEl.url)}`,
        ruleId: 'performance.browser.lcp-heavy-image',
        title: 'Large LCP resource observed with slow paint',
        detail: `Largest contentful paint was ${(browserPerformance.largestContentfulPaintMs / 1000).toFixed(1)}s and the LCP resource transferred about ${(bytes / 1048576).toFixed(2)}MB in this lab observation. That coincidence suggests inspecting resize/compress/serve of an appropriately sized asset; it does not by itself prove this resource is the sole cause.`,
        category: 'review',
        severity: 'medium',
        confidence: 'inferred',
        targetType: lcpEl.selector ? 'visual' : 'page',
        selector: lcpEl.selector || '',
        sources: ['browser'],
        evidence: `lcp=${browserPerformance.largestContentfulPaintMs}ms; resource=${lcpEl.url}; bytes=${bytes}`,
        resourceUrl: lcpEl.url,
        performanceObservation: browserPerformance,
        fingerprint: hash(`lcp-heavy|${lcpEl.url}|${bytes}`),
        verification: { state: 'inferred', method: 'lab performance correlation', attempts: 1, evidence: [] },
        count: 1,
        rootCauseKey: `lcp-resource:${hash(lcpEl.url)}`
      });
    }
    // Tie the base LCP finding to the same root cause when a resource URL exists.
    lcpFinding.rootCauseKey = `lcp-resource:${hash(lcpEl.url)}`;
    lcpFinding.resourceUrl = lcpEl.url;
    if (lcpEl.selector) lcpFinding.selector = lcpFinding.selector || lcpEl.selector;
  }
  return out;
}

/**
 * Secondary review/inconclusive/context items grouped for "Worth checking further".
 * Confirmed material RO leads are excluded.
 */
export function composeWorthChecking(findings = [], attentionGroups = []) {
  const leadIds = new Set(attentionGroups.map(g => g.lead?.id).filter(Boolean));
  const leadKeys = new Set(attentionGroups.map(g => g.key).filter(Boolean));
  const secondary = findings.filter(f => {
    if (leadIds.has(f.id)) return false;
    if (leadKeys.has(f.rootCauseKey) || leadKeys.has(rootCauseKeyFor(f))) return false;
    // Policy-quieted rows stay in Show all checks / full results — not a second Frank lane.
    if (f.frankVisible === false) return false;
    if (f.category === 'context') return true;
    if (f.confidence === 'inconclusive') return true;
    if (f.category === 'review' && /^(low|info)$/i.test(String(f.severity || ''))) return true;
    if (f.frankPriority === 'quiet') return false;
    // Secondary markup/document reviews only when they did not already lead RO.
    if ((f.targetability === TARGETABILITY.markup || f.targetability === TARGETABILITY.document) && f.category === 'review' && /^(low|info)$/i.test(String(f.severity || ''))) {
      return true;
    }
    return false;
  });

  const buckets = new Map();
  for (const f of secondary) {
    const lens = (f.lenses && f.lenses[0]) || impactClassFor(f);
    const key = `${f.scope || scopeFor(f)}|${lens}|${f.fixOwner || fixOwnerFor(f)}`;
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key).push(f);
  }

  const groups = [];
  for (const [key, rows] of buckets) {
    const [scope, lens, owner] = key.split('|');
    groups.push({
      key,
      scope,
      lens,
      fixOwner: owner,
      title: worthCheckingTitle(scope, lens),
      size: rows.length,
      findings: rows.slice(0, 12),
      instanceCount: rows.reduce((n, r) => n + Math.max(1, Number(r.count || 1)), 0)
    });
  }
  return groups.sort((a, b) => b.instanceCount - a.instanceCount).slice(0, 8);
}

function worthCheckingTitle(scope, lens) {
  if (scope === 'markup' || scope === 'document') return 'Page configuration';
  if (lens === 'ux' || /availability|navigation/i.test(lens)) return 'Links & navigation';
  if (lens === 'performance') return 'Performance checks';
  if (lens === 'accessibility') return 'Accessibility reviews';
  if (lens === 'seo') return 'Discoverability reviews';
  return 'Developer checks';
}

export function detectPlatform(page = {}, htmlSample = '') {
  const hay = [
    page.url,
    page.generator,
    page.pathname,
    htmlSample,
    ...(page.resourceHints || [])
  ].map(x => String(x || '')).join('\n').toLowerCase();
  const signals = [];
  if (/\/wp-content\//.test(hay)) signals.push('wp-content');
  if (/\/wp-includes\//.test(hay)) signals.push('wp-includes');
  if (/wordpress/i.test(String(page.generator || ''))) signals.push('generator');
  if (/\/wp-json\b|wordpress(?:es)?_/.test(hay)) signals.push('wp-api');
  if (signals.length >= 2) return { id: 'wordpress', confidence: 'high', signals };
  if (signals.length === 1 && signals[0] === 'generator') return { id: 'wordpress', confidence: 'medium', signals };
  return { id: '', confidence: 'none', signals: [] };
}
