import { signalForFinding, SIGNALS } from './signals.js';

// Impact classes describe what a finding threatens, not which tool produced it.
// The attention composer uses these so one noisy scanner cannot occupy the brief.
export const IMPACT_CLASSES = Object.freeze({
  availability: { id: 'availability', label: 'Availability', order: 1, description: 'Visitors cannot reach or complete something' },
  discoverability: { id: 'discoverability', label: 'Discoverability', order: 2, description: 'Crawlers cannot index or consolidate the page correctly' },
  accessibility: { id: 'accessibility', label: 'Accessibility', order: 3, description: 'Assistive technology, keyboard or low-vision users hit a barrier' },
  performance: { id: 'performance', label: 'Performance', order: 4, description: 'The page is measurably slower than expected' },
  security: { id: 'security', label: 'Security', order: 5, description: 'Browser-facing implementation creates avoidable security or privacy risk' },
  implementation: { id: 'implementation', label: 'Web quality', order: 6, description: 'Markup or configuration is wrong even if user impact is indirect' },
  coverage: { id: 'coverage', label: 'Coverage', order: 7, description: 'Something could not be verified' }
});

export const IMPACT_CLASS_IDS = Object.keys(IMPACT_CLASSES);

const SIGNAL_CLASS = {
  [SIGNALS.BROKEN_LINK]: 'availability',
  [SIGNALS.LINK_REVIEW]: 'coverage',
  [SIGNALS.FORM_ACTION]: 'availability',
  [SIGNALS.NOINDEX]: 'discoverability',
  [SIGNALS.ROBOTS]: 'discoverability',
  [SIGNALS.CANONICAL]: 'discoverability',
  [SIGNALS.REDIRECT]: 'discoverability',
  [SIGNALS.TITLE]: 'discoverability',
  [SIGNALS.DESCRIPTION]: 'discoverability',
  [SIGNALS.SCHEMA]: 'discoverability',
  [SIGNALS.A11Y_NAME]: 'accessibility',
  [SIGNALS.A11Y_CONTRAST]: 'accessibility',
  [SIGNALS.A11Y_STRUCTURE]: 'accessibility',
  [SIGNALS.A11Y_OTHER]: 'accessibility',
  [SIGNALS.PERFORMANCE_MOBILE]: 'performance',
  [SIGNALS.PERFORMANCE_DESKTOP]: 'performance',
  [SIGNALS.SECURITY]: 'security',
  [SIGNALS.PAGE_STRUCTURE]: 'implementation',
  [SIGNALS.SOCIAL]: 'implementation',
  [SIGNALS.OTHER]: 'implementation'
};

export function impactClassFor(finding = {}) {
  if (finding.impactClass && IMPACT_CLASSES[finding.impactClass]) return finding.impactClass;
  const signal = finding.signal || signalForFinding(finding);
  if (String(finding.confidence || '') === 'inconclusive') return 'coverage';
  if (/^performance\.browser\./.test(String(finding.ruleId || ''))) return 'performance';
  return SIGNAL_CLASS[signal] || 'implementation';
}

const PRIORITY_WEIGHT = { blocker: 100, high: 70, medium: 40, low: 18, quiet: 4 };
const SEVERITY_WEIGHT = { critical: 30, high: 22, medium: 12, low: 5, info: 1 };
const CONFIDENCE_WEIGHT = { confirmed: 1, corroborated: 1, inferred: 0.6, inconclusive: 0.2 };

// Materiality is deliberately class-blind. Ranking across classes happens in the
// composer so that a category cannot buy priority just by producing more rows.
export function materialityScore(finding = {}) {
  const priority = PRIORITY_WEIGHT[String(finding.frankPriority || 'medium')] ?? 40;
  const severity = SEVERITY_WEIGHT[String(finding.severity || 'medium')] ?? 12;
  const confidence = CONFIDENCE_WEIGHT[String(finding.confidence || 'confirmed')] ?? 1;
  const occurrences = Math.min(3, Math.log2(Math.max(1, Number(finding.count || finding.occurrences || 1))) * 1.5);
  const prominence = /^(navigation|cta|primary)$/.test(String(finding.link?.prominence || '')) ? 12 : 0;
  return Math.round((priority + severity + occurrences + prominence) * confidence);
}

export function classSummary(findings = []) {
  const counts = Object.fromEntries(IMPACT_CLASS_IDS.map(id => [id, 0]));
  for (const f of findings) counts[impactClassFor(f)] = (counts[impactClassFor(f)] || 0) + 1;
  return counts;
}
