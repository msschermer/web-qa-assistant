/**
 * The exported client report: one self-contained HTML file for one site audit.
 *
 * This is the artifact that leaves the building. A consultant walks a client
 * through the Site Audit screen and then sends them this, so it is held to one
 * rule above all others: it must not contradict the screen. It reads the same
 * discipline taxonomy (packages/findings/disciplines.js), the same priority
 * lens (packages/findings/priority.js), the same fix sentences
 * (packages/findings/rule-guidance.js) and the same palette
 * (packages/ui/tokens.css) that the overlay does. Every earlier divergence
 * between the two came from a private copy of one of those four.
 *
 * It is the dark instrument document, not the category's white sheet of
 * tables — same world as the console it was exported from. It carries a print
 * stylesheet because a client-facing document gets printed, and light text on
 * a background the browser strips is not a document.
 *
 * Nothing in it is generated: the ranking is a deterministic sort and the
 * guidance is a static lookup. There is no model in this path, because the one
 * thing a client must be able to trust about a recommendation is that it was
 * not invented for them.
 */

import fs from 'node:fs';
import { guidanceForRule } from '../findings/rule-guidance.js';
import { disciplineOf, disciplineLabel, DISCIPLINE_ORDER } from '../findings/disciplines.js';
import { orderByLumenPriority, byScannerSeverity, isEstablished } from '../findings/priority.js';

/** The palette has one definition. This document cannot link the compiled
 * stylesheet, so it inlines tokens.css rather than keeping a copy that drifts.
 */
const TOKENS_CSS = fs.readFileSync(new URL('../ui/tokens.css', import.meta.url), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .trim();

function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function plural(n, word) {
  return `${n} ${word}${Number(n) === 1 ? '' : 's'}`;
}

/** `widths` fixes the column grid so that stacked tables — one per discipline —
 * line up down the page instead of each sizing itself to its own longest cell,
 * which is what made the sections read as separate documents. */
function table(headers, rows, emptyText = 'Nothing to show here.', widths = null) {
  if (!rows.length) return `<p class="empty">${esc(emptyText)}</p>`;
  const cols = widths ? `<colgroup>${widths.map((w) => `<col style="width:${w}">`).join('')}</colgroup>` : '';
  return `<div class="scroll"><table${widths ? ' class="fixed"' : ''}>${cols}<thead><tr>${headers.map((h) => `<th>${esc(h)}</th>`).join('')}</tr></thead><tbody>${
    rows.map((r) => `<tr>${r.map((c) => `<td>${c}</td>`).join('')}</tr>`).join('')
  }</tbody></table></div>`;
}

function label(group) {
  return String(group.title || '').trim() || group.rule_id;
}

function sevPill(severity) {
  return `<span class="pill pill-${esc(severity || 'info')}">${esc(severity || 'info')}</span>`;
}

function evidenceDot(confidence) {
  const kind = isEstablished({ confidence }) ? 'established' : 'early';
  return `<span class="ev ev-${kind}">${esc(confidence || 'inferred')}</span>`;
}

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
    <div class="scroll"><table class="conditions"><thead><tr><th>State</th><th>Item</th><th>What was observed</th><th>Confidence</th></tr></thead><tbody>${body}</tbody></table></div>
    <p class="cond-note">Each line states what this audit observed and the confidence that observation supports. There is deliberately no score: a single number would hide the evidence behind it.</p>
    ${coverage}`;
}

/** Severity spread across the issue patterns, as one rail. The ramp is fills
 * only — a bar, never text on a tint. */
function severityRail(groups) {
  const order = ['critical', 'high', 'medium', 'low', 'info'];
  const counts = new Map(order.map((s) => [s, 0]));
  for (const g of groups) counts.set(g.severity, (counts.get(g.severity) || 0) + Number(g.instances || 0));
  const total = [...counts.values()].reduce((a, b) => a + b, 0);
  if (!total) return '';
  const present = order.filter((s) => counts.get(s) > 0);
  return `<div class="rail">${present.map((s) =>
    `<span class="rail-seg rail-${s}" style="flex:${counts.get(s)}"></span>`).join('')}</div>
    <ul class="rail-key">${present.map((s) =>
    `<li><i class="rail-${s}"></i>${esc(s)} <b>${counts.get(s)}</b></li>`).join('')}</ul>`;
}

/** Patterns per discipline, in reading order. Availability first: a confirmed
 * functional failure outranks an optimisation warning, and no discipline is
 * promoted for being easy to detect. */
function groupsByDiscipline(findingGroups) {
  const byDiscipline = new Map();
  for (const g of findingGroups) {
    const d = disciplineOf(g.rule_id);
    if (!byDiscipline.has(d)) byDiscipline.set(d, []);
    byDiscipline.get(d).push(g);
  }
  return DISCIPLINE_ORDER
    .filter((d) => byDiscipline.has(d))
    .map((d) => [d, byDiscipline.get(d).sort(byScannerSeverity)]);
}

export function renderAuditReportHtml({ audit, urls, links, findings, findingGroups }) {
  const counts = audit.urlCounts || {};
  const fetched = Number(counts.fetched || 0);
  const discovered = Object.values(counts).reduce((sum, n) => sum + Number(n || 0), 0);
  const neverFetched = Math.max(0, discovered - fetched);
  const observations = findings.length;
  const patterns = findingGroups.length;

  const brokenLinks = links.filter((l) => l.status === 'broken' || l.status === 'blocked');
  const renderedFindings = findings.filter((f) => f.collection_method === 'rendered');
  const renderPassRan = renderedFindings.length > 0 || urls.some((u) => u.rendered);

  const topPriorities = orderByLumenPriority(findingGroups).slice(0, 8);
  const disciplines = groupsByDiscipline(findingGroups);

  const scopeBanner = neverFetched > 0
    ? `<p class="scope"><b>Partial crawl</b> — ${plural(fetched, 'page')} of ${discovered} discovered were fetched. ${neverFetched} never fetched. Every count in this report describes those ${fetched} pages, not the whole site.</p>`
    : fetched > 0
      ? `<p class="scope scope-full"><b>Complete crawl</b> — every one of the ${plural(discovered, 'page')} discovered from this start URL was fetched.</p>`
      : '';

  const findingRow = (f) => [
    `<span class="u">${esc(f.url)}</span>`,
    `<span class="issue">${esc(String(f.title || '').trim() || f.rule_id)}</span><span class="rule">${esc(f.rule_id)}</span>`,
    sevPill(f.severity),
    evidenceDot(f.confidence),
    esc(f.collection_method)
  ];
  const findingHeaders = ['URL', 'Issue', 'Severity', 'Evidence', 'Source'];
  const linkRow = (l) => [
    `<span class="u">${esc(l.source_url)}</span>`,
    `<span class="u">${esc(l.target_url)}</span>`,
    esc(l.anchor_text || '—'),
    `<span class="pill pill-status-${esc(l.status)}">${esc(l.status)}</span>`,
    esc(l.http_status || '')
  ];
  const linkHeaders = ['Source', 'Target', 'Anchor text', 'Status', 'HTTP'];
  const urlRow = (u) => {
    let schemaTypes = '—';
    try { const parsed = JSON.parse(u.schema_types || '[]'); if (parsed.length) schemaTypes = esc(parsed.join(', ')); } catch {}
    return [
      `<span class="u">${esc(u.url)}</span>`,
      esc(u.http_status || u.status),
      esc(u.title || ''),
      esc(u.canonical || ''),
      u.indexable ? 'Yes' : 'No',
      esc(u.word_count ?? '—'),
      schemaTypes,
      u.rendered ? 'Yes' : 'No'
    ];
  };
  const urlHeaders = ['URL', 'Status', 'Title', 'Canonical', 'Indexable', 'Words', 'Schema', 'Rendered'];

  const statStrip = `<dl class="stats">
      <div><dt>Observations</dt><dd>${observations}</dd></div>
      <div><dt>Issue patterns</dt><dd>${patterns}</dd></div>
      <div><dt>Pages crawled</dt><dd>${fetched}</dd><dd class="sub">${neverFetched > 0 ? `of ${discovered} discovered` : 'all discovered'}</dd></div>
      <div><dt>Broken or blocked links</dt><dd>${brokenLinks.length}</dd></div>
    </dl>`;

  const prioritiesHtml = topPriorities.length
    ? `<ol class="priorities">${topPriorities.map((g, i) => `
        <li>
          <span class="p-rank">${String(i + 1).padStart(2, '0')}</span>
          <div class="p-body">
            <p class="p-top">${sevPill(g.severity)}<b>${esc(label(g))}</b>${evidenceDot(g.confidence)}</p>
            <p class="p-scope">${esc(disciplineLabel(disciplineOf(g.rule_id)))} · ${plural(g.instances, 'instance')} across ${plural(g.affected_urls, 'page')} · <span class="rule-inline">${esc(g.rule_id)}</span></p>
            <p class="p-guidance">${esc(guidanceForRule(g.rule_id))}</p>
          </div>
        </li>`).join('')}</ol>`
    : '<p class="empty">No findings recorded.</p>';

  const findingsSections = patterns
    ? disciplines.map(([discipline, groups]) => `
        <h3 class="d-head">${esc(disciplineLabel(discipline))} <span class="d-count">${plural(groups.length, 'pattern')}</span></h3>
        ${table(['Issue', 'Severity', 'Affected', 'Instances', 'Evidence', 'Recommended next move'], groups.map((g) => [
          `<span class="issue">${esc(label(g))}</span><span class="rule">${esc(g.rule_id)}</span>`,
          sevPill(g.severity),
          plural(g.affected_urls, 'page'),
          String(g.instances),
          evidenceDot(g.confidence),
          `<span class="guide">${esc(guidanceForRule(g.rule_id))}</span>`
        ]), 'Nothing to show here.', ['26%', '9%', '9%', '8%', '11%', '37%'])}`).join('')
    : '<p class="empty">No findings recorded.</p>';

  const browserSection = renderPassRan
    ? `<h2>Browser checks</h2>
       <p class="lede">Collected by loading each page in a real browser — accessibility, runtime behaviour and performance facts the static crawl cannot see.</p>
       ${table(findingHeaders, renderedFindings.map(findingRow), 'The render pass ran and recorded no findings on these pages.')}`
    : `<h2>Browser checks</h2>
       <div class="notrun"><b>Not run for this audit.</b>
       <span>Accessibility, runtime and performance evidence requires loading each page in a real browser. It was not collected here, so this report makes no claim either way about those areas — an empty section is not a clean bill of health.</span></div>`;

  const sections = [
    { id: 'overview', label: 'Overview', group: '', content: `
        <h2>Overview</h2>
        ${statStrip}
        ${severityRail(findingGroups)}
        ${conditionsHtml(audit?.stats?.auditSummary)}
        <h2>What to fix first</h2>
        <p class="lede">Ordered by Lumen: a confirmed availability failure leads, then the scanner's own severity, then how many pages carry it. Severity and evidence labels are exactly as recorded — this ordering does not change them.</p>
        ${prioritiesHtml}` },
    { id: 'findings', label: 'Findings', count: patterns, group: '', content: `
        <h2>Findings</h2>
        <p class="lede">${observations} observation${observations === 1 ? '' : 's'} grouped into ${plural(patterns, 'issue pattern')}, by discipline. Availability leads because a confirmed broken destination is a functional failure, not a suggestion.</p>
        ${findingsSections}` },
    { id: 'pages', label: 'Pages', count: urls.length, group: 'Explore', content: `
        <h2>Pages</h2>
        <p class="lede">Every URL this crawl discovered, and what was read from the ones it fetched. A row with no title or word count was discovered but never fetched — the page limit stopped the crawl before it got there.</p>
        ${table(urlHeaders, urls.map(urlRow), 'No pages were crawled.')}` },
    { id: 'links', label: 'Links', count: links.length, group: 'Explore', content: `
        <h2>Broken and blocked links</h2>
        ${table(linkHeaders, brokenLinks.map(linkRow), 'Every link checked resolved.')}
        <h3>All checked links</h3>
        ${table(linkHeaders, links.map(linkRow), 'No links were checked.')}` },
    { id: 'browser', label: 'Browser checks', group: 'Validate', content: browserSection }
  ];

  const navGroups = [];
  for (const section of sections) {
    const last = navGroups[navGroups.length - 1];
    if (last && last.label === section.group) last.items.push(section);
    else navGroups.push({ label: section.group, items: [section] });
  }

  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Site audit — ${esc(audit.site_origin)}</title><style>
    ${TOKENS_CSS}
    :root{color-scheme:dark;--r-mono:ui-monospace,SFMono-Regular,'SF Mono',Menlo,Consolas,monospace}
    *{box-sizing:border-box}
    /* The flex column keeps the footer at the foot of the window rather than
       halfway up it when a short section — Browser checks, say — is open. */
    body{margin:0;min-height:100vh;display:flex;flex-direction:column;background:var(--wqa-canvas);color:var(--wqa-ink);
      font:14px/1.55 'Inter',system-ui,-apple-system,'Segoe UI',Roboto,'Helvetica Neue',sans-serif;
      -webkit-font-smoothing:antialiased}
    header{display:flex;align-items:baseline;gap:12px;flex-wrap:wrap;padding:20px 28px;border-bottom:1px solid var(--wqa-line);background:var(--wqa-surface)}
    .mark{display:inline-flex;align-items:center;justify-content:center;width:24px;height:24px;border-radius:8px;background:var(--wqa-brand);color:#fff;font-weight:700;font-size:12px;align-self:center}
    header h1{margin:0;font-size:18px;font-weight:650;letter-spacing:-.02em}
    header .prov{margin:0;margin-left:auto;font-size:12px;color:var(--wqa-ink-faint);font-family:var(--r-mono)}
    .scope{margin:0;padding:12px 28px;font-size:13px;line-height:1.5;color:var(--wqa-ink-soft);background:var(--wqa-brand-soft);border-bottom:1px solid var(--wqa-brand-line)}
    .scope b{color:var(--wqa-ink)}
    .scope-full{background:var(--wqa-surface);border-bottom-color:var(--wqa-line)}

    .shell{flex:1 0 auto;display:grid;grid-template-columns:200px minmax(0,1fr);align-items:stretch}
    nav{position:sticky;top:0;align-self:start;padding:20px 12px 40px;background:var(--wqa-canvas)}
    .nav-label{margin:16px 8px 6px;font-size:11px;font-weight:650;letter-spacing:.11em;text-transform:uppercase;color:var(--wqa-ink-faint)}
    nav button{display:flex;align-items:center;gap:8px;width:100%;padding:8px 10px;margin-bottom:2px;border:0;border-radius:var(--wqa-r-sm);background:transparent;color:var(--wqa-ink-soft);font:inherit;font-size:13px;font-weight:600;text-align:left;cursor:pointer}
    nav button:hover{background:var(--wqa-sunken);color:var(--wqa-ink)}
    nav button.active{background:var(--wqa-brand-soft);color:var(--wqa-ink)}
    nav .n{margin-left:auto;font-size:11px;font-weight:600;color:var(--wqa-ink-faint);font-variant-numeric:tabular-nums}
    main{padding:24px 28px 56px;min-width:0;border-left:1px solid var(--wqa-line)}
    section{display:none}
    section.active{display:block}
    h2{margin:0 0 6px;font-size:19px;font-weight:650;letter-spacing:-.02em}
    h2+.lede{margin-top:0}
    h2:not(:first-child){margin-top:32px}
    h3{margin:26px 0 8px;font-size:14px;font-weight:650;letter-spacing:-.01em}
    .lede{margin:0 0 16px;max-width:74ch;font-size:13px;line-height:1.55;color:var(--wqa-ink-soft)}
    .empty{margin:0 0 20px;font-size:13px;color:var(--wqa-ink-faint)}

    .stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:1px;margin:14px 0 20px;padding:0;background:var(--wqa-line);border:1px solid var(--wqa-line);border-radius:var(--wqa-r-sm);overflow:hidden}
    .stats>div{padding:13px 15px;background:var(--wqa-surface)}
    .stats dt{font-size:11px;font-weight:650;letter-spacing:.09em;text-transform:uppercase;color:var(--wqa-ink-faint)}
    .stats dd{margin:5px 0 0;font-size:26px;font-weight:650;letter-spacing:-.03em;font-variant-numeric:tabular-nums}
    .stats dd.sub{margin-top:1px;font-size:11.5px;font-weight:500;letter-spacing:0;color:var(--wqa-ink-faint)}

    .rail{display:flex;height:6px;gap:2px;margin:0 0 9px;border-radius:99px;overflow:hidden}
    .rail-seg{display:block;min-width:3px}
    .rail-key{display:flex;flex-wrap:wrap;gap:14px;margin:0 0 24px;padding:0;list-style:none;font-size:11.5px;color:var(--wqa-ink-faint)}
    .rail-key li{display:flex;align-items:center;gap:6px}
    .rail-key i{width:8px;height:8px;border-radius:2px}
    .rail-key b{color:var(--wqa-ink);font-variant-numeric:tabular-nums}
    .rail-critical{background:var(--wqa-sev-critical)}
    .rail-high{background:var(--wqa-sev-high)}
    .rail-medium{background:var(--wqa-sev-medium)}
    .rail-low{background:var(--wqa-sev-low)}
    .rail-info{background:var(--wqa-sev-info)}

    .scroll{overflow-x:auto;margin:0 0 20px;border:1px solid var(--wqa-line);border-radius:var(--wqa-r-sm)}
    table{width:100%;border-collapse:collapse;font-size:12.5px}
    table.fixed{table-layout:fixed;min-width:820px}
    th{position:sticky;top:0;z-index:1;text-align:left;padding:8px 11px;background:var(--wqa-sunken);color:var(--wqa-ink-faint);font-size:11px;font-weight:650;letter-spacing:.08em;text-transform:uppercase;border-bottom:1px solid var(--wqa-line);white-space:nowrap}
    td{padding:9px 11px;border-bottom:1px solid var(--wqa-line);vertical-align:top;color:var(--wqa-ink-soft);max-width:380px;overflow-wrap:anywhere}
    tbody tr:last-child td{border-bottom:0}
    tbody tr:hover td{background:var(--wqa-sunken)}
    .u{font-family:var(--r-mono);font-size:11.5px;color:var(--wqa-ink-soft)}
    .issue{display:block;font-size:13px;font-weight:600;color:var(--wqa-ink)}
    .rule{display:block;margin-top:2px;font-family:var(--r-mono);font-size:11px;color:var(--wqa-ink-faint)}
    .guide{color:var(--wqa-ink-soft)}

    .conditions td{color:var(--wqa-ink-soft)}
    .cond-state{white-space:nowrap;font-weight:600;color:var(--wqa-ink-faint)}
    .cond-attention .cond-state{color:var(--wqa-critical)}
    .cond-label{white-space:nowrap;font-weight:600;color:var(--wqa-ink)}
    .cond-ev{display:block;margin-top:3px;font-size:11.5px;line-height:1.5}
    .cond-conf{white-space:nowrap;font-family:var(--r-mono);font-size:11px;color:var(--wqa-ink-faint)}
    .cond-note{margin:-8px 0 22px;max-width:74ch;font-size:11.5px;line-height:1.55;color:var(--wqa-ink-faint)}
    .cond-coverage{margin:0 0 22px;padding-left:18px;max-width:74ch;font-size:12.5px;line-height:1.6;color:var(--wqa-ink-soft)}

    .priorities{list-style:none;margin:0;padding:0;border:1px solid var(--wqa-line);border-radius:var(--wqa-r-sm);overflow:hidden}
    .priorities li{display:flex;gap:14px;padding:13px 15px;background:var(--wqa-surface);border-bottom:1px solid var(--wqa-line)}
    .priorities li:last-child{border-bottom:0}
    .p-rank{flex:0 0 auto;font-family:var(--r-mono);font-size:11px;font-weight:650;color:var(--wqa-brand-text);padding-top:3px}
    .p-body{min-width:0}
    .p-top{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin:0 0 4px;font-size:13.5px;color:var(--wqa-ink)}
    .p-scope{margin:0 0 5px;font-size:12px;color:var(--wqa-ink-faint)}
    .rule-inline{font-family:var(--r-mono);font-size:11px}
    .p-guidance{margin:0;font-size:13px;color:var(--wqa-ink-soft);max-width:74ch}

    .d-head{display:flex;align-items:baseline;gap:9px}
    .d-count{font-size:11.5px;font-weight:500;color:var(--wqa-ink-faint)}

    /* Severity badges are the console's, exactly: a semantic wash with its own
       text colour, and the sealed ramp only as a hairline tint or — for
       critical alone — a solid fill under white. The ramp is not text. */
    .pill{display:inline-flex;align-items:center;border-radius:99px;padding:2px 9px;font-size:11.5px;font-weight:600;text-transform:capitalize;white-space:nowrap;border:1px solid transparent;color:var(--wqa-ink-faint)}
    .pill-critical,.pill-status-broken{background:var(--wqa-sev-critical);color:#fff}
    .pill-high{background:var(--wqa-critical-soft);color:var(--wqa-critical);border-color:color-mix(in srgb,var(--wqa-sev-high) 40%,transparent)}
    .pill-medium,.pill-low,.pill-status-blocked{background:var(--wqa-warn-soft);color:var(--wqa-warn);border-color:color-mix(in srgb,var(--wqa-sev-medium) 40%,transparent)}
    .pill-info,.pill-status-inconclusive{background:var(--wqa-info-soft);color:var(--wqa-ink-faint);border-color:var(--wqa-line-strong)}
    .pill-status-healthy{background:var(--wqa-ok-soft);color:var(--wqa-ok);border-color:color-mix(in srgb,var(--wqa-ok) 40%,transparent)}
    .ev{display:inline-flex;align-items:center;gap:5px;font-size:11.5px;white-space:nowrap;color:var(--wqa-ink-faint)}
    .ev::before{content:'';width:6px;height:6px;border-radius:99px;background:currentColor}
    .ev-established{color:var(--wqa-ok)}
    .ev-early{color:var(--wqa-warn)}

    .notrun{display:block;padding:14px 16px;border:1px solid var(--wqa-line-strong);border-radius:var(--wqa-r-sm);background:var(--wqa-surface);max-width:74ch}
    .notrun b{display:block;margin-bottom:4px;color:var(--wqa-ink)}
    .notrun span{font-size:13px;line-height:1.6;color:var(--wqa-ink-soft)}

    footer{padding:16px 28px;border-top:1px solid var(--wqa-line);font-size:11.5px;color:var(--wqa-ink-faint)}

    @media(max-width:820px){
      .shell{grid-template-columns:minmax(0,1fr)}
      nav{position:static;border-bottom:1px solid var(--wqa-line);display:flex;flex-wrap:wrap;gap:4px;padding:10px 16px}
      nav button{width:auto;margin-bottom:0}
      nav .n{margin-left:6px}
      .nav-label{display:none}
      main{padding:20px 16px 44px;border-left:0}
    }

    /* A client-facing document gets printed. Browsers strip backgrounds, so the
       document inverts to ink on paper and every section is shown at once —
       tabs are a screen affordance, not a document one. Paper needs its own
       inks: the dark washes are unreadable once the ground is white, so
       severity keeps its meaning here as an outline plus its colour on white,
       not as a fill nobody will print. */
    @media print{
      /* The whole document inverts by redefining the palette, not by patching
         class after class — every rule here already reads a token, so one
         override converts the page and nothing is left as light ink on white.
         This is the paper half of the same world: identical structure, type
         and severity meanings, different ground. */
      :root{
        --wqa-canvas:#FFFFFF;--wqa-surface:#FFFFFF;--wqa-surface-raised:#FFFFFF;--wqa-sunken:#F9FAFB;
        --wqa-ink:#101828;--wqa-ink-soft:#475467;--wqa-ink-faint:#667085;
        --wqa-line:#EAECF0;--wqa-line-strong:#D0D5DD;
        --wqa-brand-soft:#F4F3FF;--wqa-brand-line:#D9D6FE;--wqa-brand-text:#5925DC;
        --wqa-critical:#B42318;--wqa-critical-soft:#FEF3F2;
        --wqa-warn:#B54708;--wqa-warn-soft:#FFFAEB;
        --wqa-ok:#067647;--wqa-ok-soft:#ECFDF3;
        --wqa-info:#5925DC;--wqa-info-soft:#F4F3FF;
      }
      body{background:#FFFFFF}
      nav{display:none}
      .shell{display:block}
      section{display:block !important;break-before:page}
      section:first-of-type{break-before:auto}
      .scroll{overflow-x:visible}
      table.fixed{min-width:0}
      tbody tr{break-inside:avoid}
      .priorities li,.notrun{break-inside:avoid}
      h2,h3{break-after:avoid}
      /* Severity is carried by fills the browser would otherwise drop. */
      .pill,.rail-seg,.rail-key i,.mark,.ev::before{-webkit-print-color-adjust:exact;print-color-adjust:exact}
      a{color:inherit}
    }
  </style></head><body>
    <header>
      <span class="mark">L</span>
      <h1>Site audit — ${esc(audit.site_origin)}</h1>
      <p class="prov">${esc(audit.start_url)} · ${esc(new Date().toISOString().replace('T', ' ').slice(0, 16))} UTC · ${esc(audit.status)}</p>
    </header>
    ${scopeBanner}
    <div class="shell">
      <nav>${navGroups.map((group) => `
        ${group.label ? `<p class="nav-label">${esc(group.label)}</p>` : ''}
        ${group.items.map((s, i) => `<button type="button" data-tab="${s.id}" class="${s.id === 'overview' ? 'active' : ''}">${esc(s.label)}${typeof s.count === 'number' ? `<span class="n">${s.count}</span>` : ''}</button>`).join('')}`).join('')}
      </nav>
      <main>${sections.map((s) => `<section id="tab-${s.id}" class="${s.id === 'overview' ? 'active' : ''}">${s.content}</section>`).join('')}</main>
    </div>
    <footer>Generated by Lumen. A point-in-time snapshot of this audit — reopen it in the extension for live status. Nothing in this report was generated by a language model: the ordering is a deterministic sort and the recommendations are a fixed lookup.</footer>
    <script>
      document.querySelectorAll('nav button').forEach(function(btn){
        btn.addEventListener('click', function(){
          document.querySelectorAll('nav button').forEach(function(b){ b.classList.toggle('active', b === btn); });
          document.querySelectorAll('main section').forEach(function(s){ s.classList.toggle('active', s.id === 'tab-' + btn.dataset.tab); });
          window.scrollTo(0, 0);
        });
      });
    </script>
  </body></html>`;
}
