/**
 * Evidence-derived presentation for axe.link-in-text-block.
 * Separates non-color indicators (e.g. underline) from link-vs-surrounding contrast.
 */
import { structuredRemediation, renderStructuredRemediation } from './guidance-composition.js';

function clip(value, max = 240) {
  const s = String(value ?? '').replace(/\s+/g, ' ').trim();
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

function num(value) {
  if (value == null || value === '') return null;
  const n = Number(String(value).replace(/:1$/i, ''));
  return Number.isFinite(n) ? n : null;
}

function axeCheckRows(axe = {}) {
  return ['any', 'all', 'none'].flatMap(bucket => axe?.checks?.[bucket] || []);
}

/**
 * Build structured evidence from axe check data and optional live-style hints.
 * Does not invent contrast or underline state when unknown.
 */
export function linkInTextEvidence(finding = {}, styleHints = null) {
  const axe = finding.axe || {};
  const summary = String(axe.failureSummary || finding.detail || '');
  const rows = axeCheckRows(axe);
  let contrastRatio = null;
  let message = '';
  if (finding.linkInText && Number.isFinite(Number(finding.linkInText.linkSurroundingContrast))) {
    contrastRatio = Number(finding.linkInText.linkSurroundingContrast);
  }
  for (const row of rows) {
    const data = row?.data && typeof row.data === 'object' ? row.data : null;
    if (data) {
      const cr = num(data.contrastRatio ?? data.contrast);
      if (cr != null) contrastRatio = cr;
      if (data.message) message = String(data.message);
    }
    if (!message && row?.message) message = String(row.message);
  }
  if (contrastRatio == null) {
    const m = summary.match(/contrast(?:\s+ratio)?\s+(?:of\s+)?([\d.]+)\s*(?::\s*1)?/i)
      || summary.match(/([\d.]+)\s*:\s*1/);
    if (m) contrastRatio = num(m[1]);
  }

  let persistentNonColorIndicator = null;
  if (styleHints && typeof styleHints === 'object') {
    if (styleHints.persistentNonColorIndicator === true || styleHints.persistentNonColorIndicator === false) {
      persistentNonColorIndicator = styleHints.persistentNonColorIndicator;
    } else if (typeof styleHints.textDecorationLine === 'string') {
      persistentNonColorIndicator = /underline/i.test(styleHints.textDecorationLine);
    }
  } else if (finding.linkInText && typeof finding.linkInText.persistentNonColorIndicator === 'boolean') {
    persistentNonColorIndicator = finding.linkInText.persistentNonColorIndicator;
  } else if (/not\s+underlined|no\s+underline|without\s+underline|lacks?\s+an?\s+underline/i.test(`${summary} ${message}`)) {
    persistentNonColorIndicator = false;
  } else if (/\bunderlined\b|has\s+an?\s+underline|text-decoration[^.;]*underline/i.test(`${summary} ${message}`)) {
    persistentNonColorIndicator = true;
  }

  const requiredAlternativeContrast = 3;
  const insufficientColorDistinction = contrastRatio != null && contrastRatio < requiredAlternativeContrast;
  const colorDistinctionAdequate = contrastRatio != null && contrastRatio >= requiredAlternativeContrast;

  return {
    ruleId: 'axe.link-in-text-block',
    persistentNonColorIndicator,
    linkSurroundingContrast: contrastRatio,
    requiredAlternativeContrast,
    insufficientColorDistinction,
    colorDistinctionAdequate,
    axeHelp: clip(finding.title || 'Links must be distinguishable without relying on color', 160),
    message: clip(message || summary, 280)
  };
}

export function linkInTextTitle(evidence = {}) {
  if (evidence.persistentNonColorIndicator === false && evidence.insufficientColorDistinction) {
    return 'Inline link is difficult to distinguish from surrounding text';
  }
  if (evidence.persistentNonColorIndicator === false) {
    return 'Inline link lacks a persistent non-color indicator';
  }
  if (evidence.insufficientColorDistinction) {
    return 'Inline link color is too close to surrounding text';
  }
  return 'Inline link is difficult to distinguish from surrounding text';
}

export function linkInTextDiagnosis(evidence = {}) {
  const parts = [];
  const ratio = evidence.linkSurroundingContrast;
  const ratioText = ratio != null ? `${Number(ratio.toFixed(2))}:1` : null;

  if (evidence.persistentNonColorIndicator === false && ratioText && evidence.insufficientColorDistinction) {
    parts.push(`This link is not underlined, and its color is only ${ratioText} different from the surrounding text.`);
    parts.push('Because it relies primarily on color, it is not visually distinct enough.');
  } else if (evidence.persistentNonColorIndicator === false && ratioText && evidence.colorDistinctionAdequate) {
    parts.push(`This link is not underlined. Its color differs from surrounding text by ${ratioText}, which meets the 3:1 alternative threshold, so do not treat color distinction alone as the failure.`);
    parts.push('Confirm whether another persistent non-color indicator is missing.');
  } else if (evidence.persistentNonColorIndicator === false) {
    parts.push('This link is not underlined and does not expose a persistent non-color indicator in the available evidence.');
  } else if (evidence.persistentNonColorIndicator === true && evidence.insufficientColorDistinction && ratioText) {
    parts.push(`A persistent underline (or equivalent non-color indicator) is present. Link color differs from surrounding text by only ${ratioText}.`);
    parts.push('Do not claim the underline is missing.');
  } else if (evidence.persistentNonColorIndicator === true) {
    parts.push('A persistent non-color indicator such as an underline is present on this link.');
    parts.push('Do not claim the underline is missing.');
  } else if (ratioText && evidence.insufficientColorDistinction) {
    parts.push(`This inline link’s color is only ${ratioText} different from the surrounding text (below the 3:1 alternative threshold when color is the primary distinction).`);
  } else {
    parts.push('This inline link is not visually distinct enough from surrounding text based on the accessibility check evidence.');
  }
  return parts.join(' ');
}

export function linkInTextRemediation(evidence = {}) {
  const structured = evidence.persistentNonColorIndicator === true
    ? structuredRemediation({
      primaryAction: 'Keep the persistent non-color indicator and strengthen link-vs-surrounding distinction only if color alone is still relied upon for recognition.',
      alternatives: evidence.insufficientColorDistinction
        ? ['Alternatively, use a link color at least 3:1 different from surrounding text and provide another visible cue on hover/focus.']
        : [],
      constraints: [
        'Keep ordinary text-vs-background contrast requirements separate from this link-vs-surrounding-text check.',
        'A persistent underline (or equivalent) is already present, so do not treat missing underline as the failure.'
      ]
    })
    : structuredRemediation({
      primaryAction: 'The simplest fix is to add a persistent underline.',
      alternatives: ['Alternatively, use a link color at least 3:1 different from surrounding text and provide another visible cue on hover/focus.'],
      constraints: ['Keep ordinary text-vs-background contrast requirements separate from link-vs-surrounding-text contrast.']
    });
  const rendered = renderStructuredRemediation(structured, { includePrimaryInBody: false });
  return {
    recommendation: rendered.recommendation,
    remediation: rendered.remediation,
    structuredRemediation: structured,
    guidanceComposition: rendered.guidanceComposition
  };
}

/**
 * Live style hints for an anchor element (browser or jsdom with getComputedStyle).
 */
export function linkInTextStyleHints(el, getComputedStyleFn = globalThis.getComputedStyle) {
  if (!el || typeof getComputedStyleFn !== 'function') return null;
  try {
    const style = getComputedStyleFn(el);
    const line = String(style.textDecorationLine || style.textDecoration || '');
    return {
      textDecorationLine: line,
      persistentNonColorIndicator: /underline/i.test(line)
    };
  } catch {
    return null;
  }
}
