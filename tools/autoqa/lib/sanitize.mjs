import { redactText } from '../../../packages/support/bug-report.js';

export function sanitizeUrl(value = '') {
  try {
    const u = new URL(String(value));
    if (!/^https?:$/i.test(u.protocol)) return '';
    return `${u.origin}${u.pathname}`;
  } catch {
    return '';
  }
}

export function sanitizeText(value, max = 400) {
  return redactText(value, max);
}

export function compactRunSummary({
  url,
  browser,
  scanCompleted,
  scanDurationMs,
  coverage,
  links,
  frank,
  evaluation,
  hardFailures = [],
  warnings = []
} = {}) {
  return {
    url: sanitizeUrl(url) || String(url || '').slice(0, 200),
    browser: browser || undefined,
    scanCompleted: Boolean(scanCompleted),
    scanDurationMs: Number(scanDurationMs) || 0,
    coverageAccountingOk: coverage?.accountingOk !== false,
    coverage: coverage || undefined,
    links: links || undefined,
    frank: frank || undefined,
    evaluation: {
      hardFailures: hardFailures.slice(0, 40),
      warnings: warnings.slice(0, 40),
      ...(evaluation || {})
    },
    capturedAt: new Date().toISOString()
  };
}
