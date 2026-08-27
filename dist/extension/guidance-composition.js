/**
 * Structured remediation composition. One builder owns primaryAction;
 * the renderer emits each sentence once.
 */

export function structuredRemediation({
  primaryAction = '',
  alternatives = [],
  constraints = [],
  verification = []
} = {}) {
  return {
    primaryAction: String(primaryAction || '').trim(),
    alternatives: (alternatives || []).map(x => String(x || '').trim()).filter(Boolean),
    constraints: (constraints || []).map(x => String(x || '').trim()).filter(Boolean),
    verification: (verification || []).map(x => String(x || '').trim()).filter(Boolean)
  };
}

function sentences(text) {
  return String(text || '')
    .replace(/\s+/g, ' ')
    .trim()
    .split(/(?<=[.!?])\s+/)
    .map(s => s.trim())
    .filter(Boolean);
}

export function collapseAdjacentDuplicateSentences(text) {
  const parts = sentences(text);
  const out = [];
  for (const part of parts) {
    if (out.length && out[out.length - 1] === part) continue;
    out.push(part);
  }
  return out.join(' ');
}

export function renderStructuredRemediation(structured = {}, { includePrimaryInBody = false } = {}) {
  const primary = String(structured.primaryAction || '').trim();
  const bits = [];
  if (includePrimaryInBody && primary) bits.push(primary);
  for (const row of structured.alternatives || []) bits.push(row);
  for (const row of structured.constraints || []) bits.push(row);
  const body = collapseAdjacentDuplicateSentences(bits.join(' '));
  const recommendation = primary;
  const remediation = includePrimaryInBody
    ? collapseAdjacentDuplicateSentences([primary, body].filter(Boolean).join(' '))
    : body;
  return {
    recommendation,
    remediation,
    structured,
    guidanceComposition: {
      adapter: 'structured-remediation',
      structuredRemediationUsed: true
    }
  };
}

export function composeFixStepBody(guidance = {}) {
  const structured = guidance.structuredRemediation;
  if (structured && (structured.primaryAction || (structured.alternatives || []).length)) {
    const rendered = renderStructuredRemediation(structured, { includePrimaryInBody: true });
    return collapseAdjacentDuplicateSentences(rendered.remediation);
  }
  const primary = String(guidance.recommendation || '').trim();
  const rest = String(guidance.remediation || '').trim();
  if (!primary) return collapseAdjacentDuplicateSentences(rest);
  if (!rest) return collapseAdjacentDuplicateSentences(primary);
  if (rest === primary) return collapseAdjacentDuplicateSentences(primary);
  if (rest.startsWith(primary)) return collapseAdjacentDuplicateSentences(rest);
  return collapseAdjacentDuplicateSentences(`${primary} ${rest}`);
}
