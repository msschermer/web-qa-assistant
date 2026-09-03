/**
 * A single, self-contained HTML report for one site audit — one file with
 * tabbed sections instead of three separate CSV downloads that have to be
 * cross-referenced by hand. Everything in it is data the crawl (or the
 * optional render pass) already collected; the "top priorities" ranking is
 * a deterministic sort plus a small static guidance lookup, never a model
 * call — this is exactly the kind of thing the system can already determine
 * reliably itself, so an LLM has no business being in the loop for it.
 */

import { guidanceForRule } from '../findings/rule-guidance.js';

const SEVERITY_RANK = { critical: 4, high: 3, medium: 2, low: 1, info: 0 };



function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function bucketOf(ruleId) {
  if (/^navigation\.link-/.test(ruleId)) return 'links';
  if (/^schema\./.test(ruleId)) return 'schema';
  if (/^(seo|structure)\./.test(ruleId)) return 'seo';
  if (/^(axe|a11y)\./.test(ruleId)) return 'a11y';
  if (/^performance\./.test(ruleId)) return 'performance';
  return 'other';
}

function table(headers, rows) {
  if (!rows.length) return '<p class="empty">Nothing to show here.</p>';
  return `<table><thead><tr>${headers.map((h) => `<th>${esc(h)}</th>`).join('')}</tr></thead><tbody>${
    rows.map((r) => `<tr>${r.map((c) => `<td>${c}</td>`).join('')}</tr>`).join('')
  }</tbody></table>`;
}

/**
 * @param {object} audit - the hydrated audit row (site_origin, start_url, created_at, stats...)
 * @param {object[]} urls - all audit_urls rows
 * @param {object[]} links - all audit_links rows
 * @param {object[]} findings - all audit_findings rows
 * @param {object[]} findingGroups - findingsByRule() output
 */
const CONDITION_WORD = { ok: 'Observed', attention: 'Needs attention', unknown: 'Not established' };

/** The factual state readout, rendered for the client-facing artifact. Composed
 * by the crawl (packages/crawl/audit-summary.js) so the exported report and the
 * overlay state the same things from the same evidence. No score, by design. */
function conditionsHtml(summary) {
  const rows = summary?.rows || [];
  if (!rows.length) return '';
  const body = rows.map((r) => `<tr class="cond cond-${esc(r.state)}">
      <td class="cond-state">${esc(CONDITION_WORD[r.state] || r.state)}</td>
      <td class="cond-label">${esc(r.label)}</td>
      <td><b>${esc(r.headline)}</b>${(r.evidence || []).map((e) => `<span class="cond-ev">${esc(e)}</span>`).join('')}</td>
      <td class="cond-conf">${esc(r.confidence)}</td>
    </tr>`).join('');
  const coverage = (summary.coverage || []).length
    ? `<h3>Coverage limits</h3><ul class="cond-coverage">${summary.coverage.map((c) => `<li>${esc(c)}</li>`).join('')}</ul>`
    : '';
  return `<h2>Site conditions</h2>
    <table class="conditions"><thead><tr><th>State</th><th>Item</th><th>What was observed</th><th>Confidence</th></tr></thead><tbody>${body}</tbody></table>
    <p class="cond-note">Each line states what this audit observed and the confidence that observation supports. There is deliberately no score: a single number would hide the evidence behind it.</p>
    ${coverage}`;
}

export function renderAuditReportHtml({ audit, urls, links, findings, findingGroups }) {
  const conditionsBlock = conditionsHtml(audit?.stats?.auditSummary);
  const topPriorities = [...findingGroups]
    .sort((a, b) => (SEVERITY_RANK[b.severity] ?? -1) - (SEVERITY_RANK[a.severity] ?? -1) || b.affected_urls - a.affected_urls)
    .slice(0, 10);

  const brokenLinks = links.filter((l) => l.status === 'broken' || l.status === 'blocked');
  const findingsByBucket = { links: [], schema: [], seo: [], a11y: [], performance: [], other: [] };
  for (const f of findings) findingsByBucket[bucketOf(f.rule_id)].push(f);

  const schemaCoverage = urls.filter((u) => u.status === 'fetched');
  const schemaMissingCount = schemaCoverage.filter((u) => !u.schema_types).length;

  const findingRow = (f) => [esc(f.url), esc(f.rule_id), `<span class="pill pill-${esc(f.category)}">${esc(f.category)}</span>`, esc(f.severity), esc(f.confidence), esc(f.collection_method)];
  const findingHeaders = ['URL', 'Rule', 'Category', 'Severity', 'Confidence', 'Source'];
  const linkRow = (l) => [esc(l.source_url), esc(l.target_url), esc(l.anchor_text || '—'), `<span class="pill pill-status-${esc(l.status)}">${esc(l.status)}</span>`, esc(l.http_status || '')];
  const linkHeaders = ['Source', 'Target', 'Anchor text', 'Status', 'HTTP'];
  const urlRow = (u) => {
    let schemaTypes = '—';
    try { const parsed = JSON.parse(u.schema_types || '[]'); if (parsed.length) schemaTypes = esc(parsed.join(', ')); } catch {}
    return [esc(u.url), esc(u.http_status || u.status), esc(u.title || ''), esc(u.canonical || ''), u.indexable ? 'Yes' : 'No', esc(u.word_count ?? '—'), schemaTypes, u.rendered ? 'Yes' : 'No'];
  };
  const urlHeaders = ['URL', 'Status', 'Title', 'Canonical', 'Indexable', 'Words', 'Schema', 'Rendered'];

  const tabs = [
    {
      id: 'overview', label: 'Overview', content: `
        ${conditionsBlock}
        <h2>Summary</h2>
        <div class="stat-grid">
          <div><dt>Pages crawled</dt><dd>${esc(audit.urlCounts?.fetched || 0)}</dd></div>
          <div><dt>Broken/blocked links</dt><dd>${brokenLinks.length}</dd></div>
          <div><dt>Findings</dt><dd>${findings.length}</dd></div>
          <div><dt>Pages missing schema</dt><dd>${schemaMissingCount} of ${schemaCoverage.length}</dd></div>
        </div>
        <h2>Top priorities</h2>
        <p class="lede">Ranked by severity, then how many pages are affected — not by an AI guess, by what this audit actually measured.</p>
        ${topPriorities.length ? `<ol class="priorities">${topPriorities.map((g) => `
          <li>
            <div class="p-top"><span class="pill pill-${esc(g.severity)}">${esc(g.severity || g.category)}</span><strong>${esc(g.rule_id)}</strong></div>
            <p class="p-scope">${g.instances} instance${g.instances === 1 ? '' : 's'} across ${g.affected_urls} page${g.affected_urls === 1 ? '' : 's'}</p>
            <p class="p-guidance">${esc(guidanceForRule(g.rule_id))}</p>
          </li>`).join('')}</ol>` : '<p class="empty">No findings recorded.</p>'}
      `
    },
    { id: 'links', label: `Broken Links (${brokenLinks.length})`, content: `<h2>Broken and blocked links</h2>${table(linkHeaders, brokenLinks.map(linkRow))}` },
    { id: 'schema', label: `Schema (${findingsByBucket.schema.length})`, content: `<h2>Structured data findings</h2>${table(findingHeaders, findingsByBucket.schema.map(findingRow))}<h3>Schema types detected per page</h3>${table(['URL', 'Types'], schemaCoverage.map((u) => { let t = '—'; try { const p = JSON.parse(u.schema_types || '[]'); if (p.length) t = esc(p.join(', ')); } catch {} return [esc(u.url), t]; }))}` },
    { id: 'seo', label: `SEO (${findingsByBucket.seo.length})`, content: `<h2>SEO and structure findings</h2>${table(findingHeaders, findingsByBucket.seo.map(findingRow))}` },
    { id: 'a11y', label: `Accessibility (${findingsByBucket.a11y.length})`, content: `<h2>Accessibility findings</h2><p class="lede">Only present if the render pass has been run — the static crawl cannot see these.</p>${table(findingHeaders, findingsByBucket.a11y.map(findingRow))}` },
    { id: 'performance', label: `Performance (${findingsByBucket.performance.length})`, content: `<h2>Performance findings</h2><p class="lede">Only present if the render pass has been run — the static crawl cannot see these.</p>${table(findingHeaders, findingsByBucket.performance.map(findingRow))}` },
    { id: 'urls', label: `All URLs (${urls.length})`, content: `<h2>All crawled URLs</h2>${table(urlHeaders, urls.map(urlRow))}` },
    { id: 'links-all', label: `All Links (${links.length})`, content: `<h2>All checked links</h2>${table(linkHeaders, links.map(linkRow))}` },
    { id: 'findings-all', label: `All Findings (${findings.length})`, content: `<h2>All findings</h2>${table(findingHeaders, findings.map(findingRow))}` }
  ];

  return `<!doctype html><html><head><meta charset="utf-8"><title>Site audit report — ${esc(audit.site_origin)}</title><style>
    :root{--brand:#4F46E5;--ink:#101828;--ink-soft:#475467;--ink-faint:#667085;--line:#EAECF0;--line-strong:#D0D5DD;--sunken:#F9FAFB;--sheet:#FFFFFF;--board:#F6F7F9;--ok:#067647;--warn:#B54708;--crit:#B42318;
      --draw:'Inter',system-ui,-apple-system,'Segoe UI',Roboto,'Helvetica Neue',sans-serif;
      --mono:ui-monospace,SFMono-Regular,'SF Mono',Menlo,Consolas,monospace;}
    *{box-sizing:border-box}
    body{font-family:'Inter',system-ui,-apple-system,'Segoe UI',Roboto,'Helvetica Neue',sans-serif;color:var(--ink);margin:0;background:var(--board)}
    header{padding:0 28px;height:60px;display:flex;flex-direction:column;justify-content:center;background:var(--sheet);color:var(--ink);border-bottom:1px solid var(--line)}
    header h1{margin:0;font-size:17px;font-weight:650;letter-spacing:-.01em}
    header p{margin:3px 0 0;color:var(--ink-faint);font-size:12.5px}
    nav{display:flex;gap:0;padding:0 24px;border-bottom:1px solid var(--line);overflow-x:auto;background:var(--sheet)}
    nav button{border:0;background:transparent;padding:11px 14px;font-size:13px;font-weight:600;letter-spacing:0;text-transform:none;color:var(--ink-faint);cursor:pointer;white-space:nowrap;border-bottom:2px solid transparent;margin-bottom:-1px}
    nav button.active{color:var(--brand);border-color:var(--brand)}
    main{padding:24px 28px 44px;max-width:none;background:var(--board);min-height:70vh}
    section{display:none}
    section.active{display:block}
    h2{font-size:19px;font-weight:650;letter-spacing:-.015em;text-transform:none;margin:0 0 12px;padding:0;border:0}
    h3{font-size:14px;font-weight:600;letter-spacing:0;text-transform:none;color:var(--ink);margin:24px 0 10px;padding:0;border:0}
    .lede{color:var(--ink-soft);font-size:13px;margin:0 0 16px}
    .stat-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:14px;margin:0 0 24px;border:0;background:transparent}
    .stat-grid>div{background:var(--sheet);border:1px solid var(--line);border-radius:8px;padding:14px 16px;box-shadow:0 1px 2px rgba(16,24,40,.06)}
    .stat-grid dt{font-size:12.5px;font-weight:500;color:var(--ink-faint);text-transform:none;letter-spacing:0;margin:0}
    .stat-grid dd{margin:6px 0 0;font-size:24px;font-weight:650;letter-spacing:-.02em;font-variant-numeric:tabular-nums}
    .conditions{width:100%;border-collapse:collapse;font-size:12.5px;margin:0 0 6px;border:1px solid var(--line-strong)}
    .conditions th{text-align:left;font-family:var(--draw);font-size:10px;letter-spacing:.13em;text-transform:uppercase;color:var(--ink-faint);padding:7px 9px;border-bottom:2px solid var(--ink);background:var(--sunken)}
    .conditions td{padding:7px 9px;border-bottom:1px solid var(--line);vertical-align:top}
    .conditions tbody tr:nth-child(even){background:var(--sunken)}
    .cond-state{font-size:12px;font-weight:600;letter-spacing:0;text-transform:none;color:var(--ink-faint);white-space:nowrap}
    .cond-attention .cond-state{color:var(--crit)}
    .cond-label{font-size:13px;font-weight:600;letter-spacing:0;text-transform:none;white-space:nowrap}
    .cond-ev{display:block;margin-top:3px;font-size:11.5px;line-height:1.5;color:var(--ink-soft)}
    .cond-conf{font-family:var(--mono);font-size:11px;color:var(--ink-faint);white-space:nowrap}
    .cond-note{margin:0 0 18px;font-size:11.5px;line-height:1.5;color:var(--ink-faint)}
    .cond-coverage{margin:0 0 20px;padding-left:18px;font-size:12px;line-height:1.55;color:var(--ink-soft)}
    .priorities{list-style:none;margin:0;padding:0;display:block;border:1px solid var(--line-strong);border-top:2px solid var(--ink);}
    .priorities li{border:0;border-bottom:1px solid var(--line);border-radius:0;padding:11px 14px;background:var(--sheet)}
    .priorities li:nth-child(even){background:var(--sunken)}
    .priorities li:last-child{border-bottom:0}
        .p-top{display:flex;align-items:center;gap:8px;margin-bottom:4px}
    .p-scope{margin:0 0 4px;font-size:12.5px;color:var(--ink-soft)}
    .p-guidance{margin:0;font-size:13px}
    table{width:100%;border-collapse:collapse;font-size:12.5px;margin-bottom:20px}
    th{text-align:left;font-size:11px;color:var(--ink-soft);text-transform:uppercase;letter-spacing:.03em;padding:6px 8px;border-bottom:1px solid var(--line);position:sticky;top:0;background:#fff}
    td{padding:6px 8px;border-bottom:1px solid var(--line);vertical-align:top;word-break:break-word;max-width:340px}
    .empty{color:var(--ink-soft);font-size:13px}
    .pill{display:inline-flex;border-radius:99px;padding:1px 8px;font-size:10.5px;font-weight:700;text-transform:uppercase}
    .pill-fix,.pill-critical,.pill-high,.pill-status-broken{background:#FEF3F2;color:var(--crit)}
    .pill-review,.pill-medium,.pill-low,.pill-status-blocked{background:#FEF6EE;color:var(--warn)}
    .pill-context,.pill-info,.pill-status-healthy{background:#ECFDF3;color:var(--ok)}
    .pill-status-inconclusive{background:var(--sunken);color:var(--ink-soft)}
    footer{padding:14px 28px;color:var(--ink-soft);font-size:11px;border-top:1px solid var(--line)}
  </style></head><body>
    <header><h1>Site audit report — ${esc(audit.site_origin)}</h1><p>Start URL ${esc(audit.start_url)} · Generated ${esc(new Date().toISOString())} · Status ${esc(audit.status)}</p></header>
    <nav>${tabs.map((t, i) => `<button type="button" data-tab="${t.id}" class="${i === 0 ? 'active' : ''}">${esc(t.label)}</button>`).join('')}</nav>
    <main>${tabs.map((t, i) => `<section id="tab-${t.id}" class="${i === 0 ? 'active' : ''}">${t.content}</section>`).join('')}</main>
    <footer>Generated by Lumen. Reflects a point-in-time snapshot of this audit — reopen the audit in the extension for live status.</footer>
    <script>
      document.querySelectorAll('nav button').forEach(function(btn){
        btn.addEventListener('click', function(){
          document.querySelectorAll('nav button').forEach(function(b){ b.classList.toggle('active', b === btn); });
          document.querySelectorAll('main section').forEach(function(s){ s.classList.toggle('active', s.id === 'tab-' + btn.dataset.tab); });
        });
      });
    </script>
  </body></html>`;
}
