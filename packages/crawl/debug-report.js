/**
 * A raw, full-fidelity JSON dump of one audit — for handing to a developer
 * to diagnose a specific accuracy complaint ("this link isn't actually
 * broken", "schema shows missing on a page that has it"), not for reading.
 * Unlike report.js's polished HTML report, nothing here is summarized,
 * bucketed, or prose-ified: every stored row is included as-is (capped only
 * to keep the file a sane size), because the whole point is reproducing
 * exactly what the crawler saw and decided.
 */
const CAP = 3000;

export function buildAuditDebugBundle({ audit, urls, links, findings, findingGroups }) {
  return {
    schema: 'web-qa-assistant-audit-debug/v1',
    generatedAt: new Date().toISOString(),
    audit: {
      id: audit.id,
      siteOrigin: audit.site_origin,
      startUrl: audit.start_url,
      config: audit.config,
      status: audit.status,
      phase: audit.phase,
      error: audit.error,
      createdAt: audit.created_at,
      startedAt: audit.started_at,
      completedAt: audit.completed_at,
      stats: audit.stats,
      urlCounts: audit.urlCounts,
      linkCounts: audit.linkCounts,
      findingsCount: audit.findingsCount,
      renderProgress: audit.renderProgress
    },
    urlCount: urls.length,
    urls: urls.slice(0, CAP),
    urlsTruncated: urls.length > CAP,
    linkCount: links.length,
    links: links.slice(0, CAP),
    linksTruncated: links.length > CAP,
    findingCount: findings.length,
    findings: findings.slice(0, CAP).map((f) => ({ ...f, evidence: safeParse(f.evidence_json) })),
    findingsTruncated: findings.length > CAP,
    findingGroups
  };
}

function safeParse(text) {
  try { return JSON.parse(text || '{}'); } catch { return null; }
}
