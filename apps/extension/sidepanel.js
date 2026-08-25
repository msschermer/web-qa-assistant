import { localFrankRuntime, localFrankWalkthrough, probeLocalAi, setLocalAiTraceSink, localAiDiagnostics } from './local-ai.js';
import { presentFinding, presentArea, QA_AREA_ORDER } from './presentation.js';
import { RuntimeTrace, buildBugReport, bugReportPrivacySummary } from './bug-report.js';
const RELEASE_VERSION = '1.7.4';
const runtimeTrace = new RuntimeTrace();
setLocalAiTraceSink((type,data)=>runtimeTrace.record(`local-ai:${type}`,data));

let report = null, filter = 'all', tab = null, scanInFlight = false, frank = null, lastFrank = null,
    showAllChecks = false, lastDiagnostic = null, lastScanAttempt = null, siteSession = null, classFilter = '', cloudAiFallback = false, frankReturnFocus = null, frankRequestSeq = 0, pendingFrankCancel = null;

const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function send(msg, timeoutMs = 25000) {
  return new Promise(resolve => {
    let settled = false;
    const timer = setTimeout(() => { if (settled) return; settled = true; resolve({ ok: false, error: 'The extension action timed out.' }); }, timeoutMs);
    chrome.runtime.sendMessage(msg, response => {
      if (settled) return;
      settled = true; clearTimeout(timer);
      const runtimeError = chrome.runtime.lastError?.message;
      resolve(response || { ok: false, error: runtimeError || 'No response from the extension service worker.' });
    });
  });
}

function notice(message = '', kind = '') { const el = $('#notice'); el.textContent = message; el.dataset.kind = kind; }
function connectionVerificationNotice(result) {
  if (!result) return notice('Connection settings saved, but verification could not complete.', 'warn');
  if (!result.ok) return notice(`Connection settings saved, but verification failed${result.error ? `: ${result.error}` : '.'}`, 'warn');
  if (!result.reachable) return notice('Connection settings saved, but the gateway could not be reached.', 'warn');
  if (result.auth === 'required') return notice('Connection settings saved, but an access key is required.', 'warn');
  if (result.auth === 'rejected') return notice('Connection settings saved, but the access key was rejected.', 'warn');
  const problems = Array.isArray(result.problems) ? result.problems.length : 0;
  if (problems) return notice(`Connection settings saved. Gateway verified; ${problems} integration${problems === 1 ? '' : 's'} need attention.`, 'warn');
  notice('Connection settings saved and verified.', 'ok');
}
function clearDiagnostic() {
  lastDiagnostic = null; const box = $('#diagnostic'); if (!box) return;
  box.hidden = true; box.open = false;
  for (const id of ['#diagnostic-id', '#diagnostic-operation', '#diagnostic-version', '#diagnostic-message']) $(id).textContent = '';
}
function showFailure(response, fallback = 'The extension could not complete this action.') {
  notice(response?.error || fallback, 'error');
  const d = response?.diagnostic; if (!d) return;
  lastDiagnostic = d;
  $('#diagnostic-id').textContent = d.id || 'Unavailable';
  $('#diagnostic-operation').textContent = d.operation || 'Unknown';
  $('#diagnostic-version').textContent = d.version || '';
  $('#diagnostic-message').textContent = d.technicalMessage || 'No technical message was returned.';
  $('#diagnostic').hidden = false;
}
function actionState(card, message, kind = 'ok', { persistent = false, actionLabel = '', onAction = null } = {}) {
  if (!card?.querySelector) {
    notice(message, kind === 'error' ? 'error' : kind === 'warn' ? 'warn' : 'ok');
    return;
  }
  const el = card.querySelector('.action-state');
  if (!el) {
    notice(message, kind === 'error' ? 'error' : kind === 'warn' ? 'warn' : 'ok');
    return;
  }
  el.replaceChildren(); el.dataset.kind = kind; el.hidden = false;
  const text = document.createElement('span'); text.textContent = message; el.appendChild(text);
  if (actionLabel && typeof onAction === 'function') {
    const button = document.createElement('button'); button.type = 'button'; button.className = 'btn btn-text action-inline'; button.textContent = actionLabel; button.onclick = onAction; el.appendChild(button);
  }
  clearTimeout(el._hideTimer);
  if (!persistent) el._hideTimer = setTimeout(() => { el.hidden = true; }, 5000);
}
function frankAction(message, kind = 'ok') {
  const el = $('#frank-action-state');
  el.textContent = message; el.dataset.kind = kind; el.hidden = false;
  clearTimeout(el._hideTimer); el._hideTimer = setTimeout(() => { el.hidden = true; }, 5000);
}


function frankReadinessLabel(state = {}) {
  if (state.status === 'ready') return { text: 'Frank ready', tone: 'ok', title: 'Chrome on-device reasoning is ready.' };
  if (state.status === 'downloading') return { text: state.progress != null ? `Frank preparing ${Math.round(state.progress * 100)}%` : 'Frank preparing', tone: 'info', title: state.message };
  if (state.status === 'warming') return { text: 'Frank warming', tone: 'info', title: state.message };
  if (state.status === 'downloadable') return { text: 'Frank setup on first use', tone: 'info', title: state.message };
  if (state.status === 'unavailable') return { text: 'Verified guidance', tone: 'warn', title: state.message };
  if (state.status === 'error') return { text: 'Frank needs retry', tone: 'warn', title: state.message };
  return { text: 'Checking Frank', tone: 'info', title: state.message || 'Checking Chrome on-device AI availability.' };
}
function renderFrankReadiness(state = localFrankRuntime.snapshot()) {
  runtimeTrace.record('frank-readiness', { status: state.status, progress: state.progress, code: state.code });
  const chip = $('#frank-readiness');
  if (chip) {
    const label = frankReadinessLabel(state);
    chip.textContent = label.text; chip.dataset.tone = label.tone; chip.title = label.title || '';
    chip.dataset.state = state.status || 'checking';
  }
  document.body.dataset.frankReadiness = state.status || 'checking';
}
localFrankRuntime.subscribe(renderFrankReadiness);
addEventListener('pagehide', () => localFrankRuntime.destroy(), { once: true });

function currentRequest(requestId, pageUrl, tabId) {
  return requestId === frankRequestSeq && report?.page?.url === pageUrl && tab?.id === tabId;
}
async function currentTabStillMatches(pageUrl, tabId) {
  const active = await send({ type: 'GET_ACTIVE' }, 5000);
  return Boolean(active.ok && active.tab?.id === tabId && active.tab?.url === pageUrl);
}

const CLASS_TONE = { availability: 'critical', discoverability: 'warn', accessibility: 'warn', performance: 'warn', security: 'critical', implementation: 'info', coverage: 'muted' };
const LEDGER_ORDER = QA_AREA_ORDER;

function findingById(id) { return (report?.findings || []).find(f => f.id === id) || null; }
function materialFindings() { return (report?.findings || []).filter(f => f.lifecycle !== 'ignored' && f.frankVisible !== false && f.category !== 'context' && f.confidence !== 'inconclusive'); }
function incompleteCoverage() {
  const statuses = Object.values(report?.coverage || {}).filter(v => /partial|unavailable/i.test(String(v))).length;
  return statuses + Number(report?.linkAudit?.inconclusive || 0);
}
function targetBlocked() {
  return Boolean(report?.targetIntegrityBlocked || report?.page?.targetIntegrity === 'blocked' || report?.priorityMode === 'target-integrity');
}
function judgment() {
  if (targetBlocked()) return { state: 'blocker', title: 'Page could not be reached' };
  const groups = report?.attention?.materialGroupCount || 0;
  const blockers = materialFindings().filter(f => f.frankPriority === 'blocker').length;
  if (blockers) return { state: 'blocker', title: `${groups} issue${groups === 1 ? '' : 's'} need attention` };
  if (groups) return { state: 'attention', title: `${groups} issue${groups === 1 ? '' : 's'} worth addressing` };
  if (incompleteCoverage()) return { state: 'incomplete', title: 'No confirmed problems found' };
  return { state: 'healthy', title: 'No priority issues found' };
}

// Grouped view. When Show all checks is on we fall back to the ungrouped list so
// nothing is hidden behind a group lead.
function visibleGroups() {
  if (showAllChecks) {
    return (report?.findings || [])
      .filter(f => f.lifecycle !== 'ignored' && (filter === 'all' || f.category === filter))
      .map(f => ({ key: f.id, impactClass: f.impactClass || 'implementation', title: f.title, size: 1, instanceCount: Number(f.count || 1), lead: f, instances: [f], selectors: [f.selector].filter(Boolean) }));
  }
  const groups = report?.attention?.groups || [];
  return groups
    .filter(g => !classFilter || g.impactClass === classFilter)
    .map(g => ({ ...g, lead: findingById(g.leadId), instances: (g.instanceIds || []).map(findingById).filter(Boolean) }))
    .filter(g => g.lead);
}

function renderLedger() {
  const box = $('#ledger'); box.innerHTML = '';
  const section = document.querySelector('.qa-section');
  const counts = report?.attention?.classCounts || {};
  const leadClass = (report?.attention?.groups || [])[0]?.impactClass || '';
  const present = LEDGER_ORDER.filter(id => counts[id]);
  if (!present.length) {
    if (section) section.hidden = true;
    return;
  }
  if (section) section.hidden = false;
  for (const id of present) {
    const item = presentArea(id, counts[id], { lead: id === leadClass, active: classFilter === id });
    const cell = document.createElement('button');
    cell.type = 'button'; cell.className = 'ledger-cell'; cell.dataset.lead = String(item.lead); cell.dataset.tone = item.tone;
    cell.setAttribute('aria-pressed', String(item.active)); cell.title = item.description;
    cell.innerHTML = `<span class="ledger-dot" aria-hidden="true"></span><span class="ledger-label">${esc(item.label)}</span><span class="ledger-count">${esc(item.count)}</span>`;
    cell.setAttribute('aria-label', `${item.label}: ${item.count}${item.lead ? ', first in recommended order' : ''}`);
    cell.onclick = () => { classFilter = classFilter === id ? '' : id; render(); };
    box.appendChild(cell);
  }
}

function coverage() {
  const box = $('#coverage'); box.innerHTML = '';
  let complete = 0, total = 0;
  for (const [key, value] of Object.entries(report.coverage || {})) {
    total++;
    if (/complete|deterministic|local-only|current-page|not monitored|not applicable/i.test(String(value))) complete++;
    box.insertAdjacentHTML('beforeend', `<span>${esc(key)}</span><b data-status="${esc(String(value).toLowerCase().replace(/\s+/g, '-'))}">${esc(value)}</b>`);
  }
  const links = report.linkAudit;
  if (links) box.insertAdjacentHTML('beforeend', `<span>internal URLs checked</span><b>${esc(links.checked || 0)}</b><span>verified healthy</span><b>${esc(links.verifiedHealthy || 0)}</b><span>confirmed link issues</span><b>${esc(links.confirmedIssues || 0)}</b><span>incomplete verification</span><b data-status="${links.inconclusive ? 'partial' : 'complete'}">${esc(links.inconclusive || 0)}</b>`);
  const perf = report.browserPerformance;
  if (perf?.available) box.insertAdjacentHTML('beforeend', `<span>this page, in this browser</span><b>${esc(perf.largestContentfulPaintMs != null ? `LCP ${(perf.largestContentfulPaintMs / 1000).toFixed(1)}s` : `TTFB ${perf.ttfbMs}ms`)}</b>`);
  $('#coverage-summary').textContent = `${complete}/${total} available`;

  const notes = $('#coverage-notes'); notes.innerHTML = '';
  if (perf?.available) notes.insertAdjacentHTML('beforeend', `<b>Current-page performance is a lab measurement.</b><span>Measured on this machine and network, so it shows direction rather than a field score. Monitored history is the source for regression claims.</span>`);
  if (String(report.coverage?.runtime) === 'not applicable') notes.insertAdjacentHTML('beforeend', `<b>Uncaught script errors are renderer-only.</b><span>Extension scans do not collect this family, so runtime coverage is not applicable rather than incomplete.</span>`);
  if (String(report.coverage?.runtime) === 'renderer') notes.insertAdjacentHTML('beforeend', `<b>Renderer runtime coverage is count-only.</b><span>Uncaught errors are recorded as a count. Error text is untrusted and is not treated as instructions.</span>`);
  if (links?.inconclusive) {
    notes.insertAdjacentHTML('beforeend', `<b>${esc(links.inconclusive)} destination${links.inconclusive === 1 ? '' : 's'} could not be independently verified.</b><span>These were not counted as broken links.</span>`);
    const rows = (links.incompleteChecks || []).slice(0, 8);
    if (rows.length) {
      const ul = document.createElement('ul');
      for (const row of rows) { const li = document.createElement('li'); li.textContent = `${row.path || row.url}${row.reason ? ` (${row.reason})` : ''}`; ul.appendChild(li); }
      notes.appendChild(ul);
    }
  }
}

function renderSession() {
  const wrap = $('#session-pages'); wrap.innerHTML = '';
  const pages = Object.values(siteSession?.pages || {}).sort((a, b) => new Date(b.lastScan) - new Date(a.lastScan));
  const issues = pages.reduce((n, p) => n + Number(p.materialCount || 0), 0);
  $('#session-summary').textContent = pages.length ? `${pages.length} page${pages.length === 1 ? '' : 's'} · ${issues} open` : 'No session yet';
  for (const page of pages.slice(0, 12)) {
    const row = document.createElement('div');
    row.className = 'session-row';
    row.innerHTML = `<div><b>${esc(new URL(page.url).pathname || '/')}</b><small>${esc(page.environment || 'unknown')} · ${esc(new Date(page.lastScan).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }))}</small></div><span>${esc(page.materialCount || 0)} issue${Number(page.materialCount || 0) === 1 ? '' : 's'}</span>`;
    wrap.appendChild(row);
  }
}

function renderResolved() {
  const items = report?.lifecycle?.resolved || [], panel = $('#resolved-panel'), wrap = $('#resolved-items');
  panel.hidden = !items.length; wrap.innerHTML = '';
  $('#resolved-count').textContent = items.length || '';
  for (const f of items.slice(0, 8)) {
    const row = document.createElement('div');
    row.className = 'resolved-item';
    row.innerHTML = `<b>${esc(f.title || f.ruleId)}</b><p>${esc(f.detail || 'No longer reproduced in the current scan.')}</p>`;
    wrap.appendChild(row);
  }
}

function markdown() {
  const groups = visibleGroups();
  const lines = [`# Web QA report`, '', report.page.url, '', `Environment: ${report.environment?.type || 'unknown'} (${report.environment?.confidenceLabel || 'unconfirmed'})`, '', '## Frank', report.priorityBrief || '', ''];
  const counts = report?.attention?.classCounts || {};
  const labels = report?.attention?.classLabels || {};
  const ledger = LEDGER_ORDER.filter(id => counts[id]).map(id => `${labels[id] || id}: ${counts[id]}`);
  if (ledger.length) lines.push('## Issues by area', ledger.join(' · '), '');
  for (const g of groups) {
    const f = g.lead;
    lines.push(`### ${labels[g.impactClass] || g.impactClass}: ${g.title}`, f.detail, `Confidence: ${f.confidence || 'confirmed'}`);
    if (g.instanceCount > 1) lines.push(`Instances: ${g.instanceCount}`, ...(g.selectors || []).slice(0, 12).map(s => `- \`${s}\``));
    lines.push(`Sources: ${(f.sources || []).join(', ')}`, '');
  }
  return lines.join('\n');
}

function issueText(g) {
  const f = g.lead;
  return [
    `Web QA issue: ${g.title}`,
    `Page: ${report.page.url}`,
    `Area: ${report.attention?.classLabels?.[g.impactClass] || g.impactClass}`,
    `Environment: ${report.environment?.type || 'unknown'}`,
    `Priority: ${f.frankPriority || f.category}`,
    `Confidence: ${f.confidence || 'confirmed'}`,
    `Problem: ${f.detail}`,
    g.instanceCount > 1 ? `Instances: ${g.instanceCount}` : '',
    ...(g.instanceCount > 1 ? (g.selectors || []).slice(0, 12).map(s => `  - ${s}`) : []),
    f.link?.url ? `Destination: ${f.link.url}` : '',
    f.verification?.method ? `Verification: ${f.verification.method} (${f.verification.attempts || 1} attempts)` : '',
    f.evidence ? `Evidence: ${typeof f.evidence === 'string' ? f.evidence : JSON.stringify(f.evidence)}` : '',
    `Sources: ${(f.sources || []).join(', ')}`,
    f.selector ? `Selector: ${f.selector}` : '',
    `Acceptance: Rescan or use Recheck and confirm the finding no longer reproduces.`
  ].filter(Boolean).join('\n');
}

function findingContext(f) {
  const parts = [];
  if (f.link?.text) parts.push(`“${f.link.text}”`);
  if (f.link?.location) parts.push(f.link.location);
  if (f.link?.prominence && f.link.prominence !== 'normal') parts.push(f.link.prominence);
  if (f.verification?.attempts > 1) parts.push(`${f.verification.attempts} verification attempts`);
  return parts.join(' · ');
}

async function recheck(f, card) {
  const button = card?.querySelector?.('.recheck') || $('#frank-recheck');
  button.disabled = true;
  if (card) actionState(card, 'Rechecking only this issue…'); else frankAction('Rechecking this issue…');
  const r = await send({ type: 'RECHECK_FINDING', finding: f, tabId: tab?.id || frank?.tabId }, 22000);
  button.disabled = false;
  if (!r.ok) { const msg = r.error || 'Recheck could not complete.'; return card ? actionState(card, msg, 'error') : frankAction(msg, 'error'); }
  const kind = r.state === 'resolved' ? 'ok' : r.state === 'still-present' ? 'error' : 'warn';
  if (card) actionState(card, r.message, kind); else frankAction(r.message, kind);
  if (r.state === 'resolved') {
    if (card) { card.dataset.state = 'resolved'; button.hidden = true; }
    if (report) { report.findings = report.findings.filter(x => x.id !== f.id); renderOverviewOnly(); }
  }
}

function renderOverviewOnly() {
  if (!report) return;
  const j = judgment();
  const blocked = targetBlocked();
  $('#frank-overview').dataset.state = j.state;
  $('#judgment-title').textContent = j.title;
  $('#brief').textContent = report.priorityBrief || '';
  const groups = report.attention?.materialGroupCount || 0;
  const findings = report.attention?.materialFindingCount || 0;
  $('#material-count').textContent = blocked
    ? 'Page QA withheld'
    : groups === findings
      ? `${groups} prioritized issue${groups === 1 ? '' : 's'}`
      : `${groups} prioritized issue${groups === 1 ? '' : 's'} · ${findings} checks grouped`;
  $('#coverage-state').textContent = blocked
    ? 'Coverage: blocked'
    : incompleteCoverage() ? `${incompleteCoverage()} coverage gap${incompleteCoverage() === 1 ? '' : 's'}` : 'Primary coverage available';
  const mode = blocked ? 'integrity' : report.priorityMode === 'ai' ? 'ai' : 'deterministic';
  $('#reasoning-mode').textContent = blocked ? 'Target integrity' : mode === 'ai' ? 'Cloud-enhanced assessment' : 'Evidence-backed assessment';
  $('#reasoning-mode').dataset.mode = mode;
}

function render() {
  if (!report) return;
  document.body.dataset.hasReport = 'true';
  $('#summary').hidden = false;
  $('#idle-state').hidden = true;
  $('#host').textContent = report.page.hostname || report.page.url;
  const env = report.environment || report.page?.environment || { type: 'unknown', confidenceLabel: 'low', source: 'inferred' };
  $('#environment').value = env.source === 'user' ? env.type : 'auto';
  const envChip = $('#environment-state');
  envChip.textContent = env.source === 'user' ? env.type : `${env.type} · ${env.confidenceLabel || 'low'}`;
  envChip.dataset.tone = /high|certain/i.test(env.confidenceLabel || '') ? 'ok' : 'info';
  envChip.title = (env.signals || []).join(' · ') || 'Environment context';
  const quiet = report.findings.filter(f => f.lifecycle !== 'ignored' && f.frankVisible === false).length;
  $('#show-all').textContent = showAllChecks ? 'Recommended only' : `Show all checks${quiet ? ` (${quiet})` : ''}`;

  renderOverviewOnly();
  renderLedger();
  coverage();
  renderResolved();
  renderSession();

  const wrap = $('#findings'); wrap.innerHTML = '';
  for (const g of visibleGroups()) {
    const f = g.lead;
    const presentation = presentFinding({ ...f, impactClass: g.impactClass }, env);
    const node = $('#card').content.cloneNode(true), card = node.querySelector('.finding');
    card.dataset.tone = f.frankPriority === 'blocker' || f.severity === 'critical' ? 'critical' : f.category === 'fix' ? 'warn' : 'info';
    card.dataset.findingId = f.id || '';

    const classChip = card.querySelector('.chip-class');
    classChip.textContent = presentation.areaLabel;
    classChip.dataset.tone = CLASS_TONE[g.impactClass] || presentation.tone || 'info';
    classChip.title = presentation.areaDescription;

    const priorityChip = card.querySelector('.chip-priority');
    priorityChip.textContent = presentation.priorityLabel;
    priorityChip.dataset.tone = /first|high/i.test(presentation.priorityLabel) ? 'critical' : 'muted';

    const confidenceChip = card.querySelector('.chip-confidence');
    confidenceChip.textContent = presentation.confidenceLabel;
    confidenceChip.dataset.tone = /confirmed|corroborated/.test(f.confidence || '') ? 'ok' : 'warn';

    const instanceChip = card.querySelector('.chip-instances');
    instanceChip.hidden = g.instanceCount < 2;
    instanceChip.textContent = `${g.instanceCount} instances`;

    card.querySelector('h3').textContent = g.size > 1 ? `${presentation.title} (${g.instanceCount} instances)` : presentation.title;
    card.querySelector('.detail').textContent = presentation.summary;
    const next = card.querySelector('.finding-next');
    const nextCopy = next.querySelector('p');
    nextCopy.textContent = presentation.nextAction; next.hidden = !presentation.nextAction;
    card.querySelector('.finding-context').textContent = findingContext(f);
    card.querySelector('.rule-id').textContent = f.ruleId || '';
    card.querySelector('.technical-sources').textContent = (f.sources || []).join(', ');
    const sel = card.querySelector('.selector');
    sel.textContent = f.selector || '';
    card.querySelector('.selector-label').hidden = sel.hidden = !f.selector;
    const ev = card.querySelector('.evidence-value');
    ev.textContent = typeof f.evidence === 'string' ? f.evidence : JSON.stringify(f.evidence || '');
    card.querySelector('.evidence-label').hidden = ev.hidden = !f.evidence;

    const instances = card.querySelector('.instances');
    if (g.instanceCount > 1 && (g.selectors || []).length) {
      instances.hidden = false;
      card.querySelector('.instances-label').textContent = `Show ${g.selectors.length} affected element${g.selectors.length === 1 ? '' : 's'}`;
      const list = card.querySelector('.instance-list');
      for (const selector of g.selectors) { const li = document.createElement('li'); li.textContent = selector; list.appendChild(li); }
    }

    const highlight = card.querySelector('.highlight');
    highlight.hidden = f.targetType !== 'visual' || !f.targetId;
    highlight.onclick = async () => {
      highlight.disabled = true;
      const r = await send({ type: 'HIGHLIGHT', targetId: f.targetId, selector: f.selector, tabId: tab?.id }, 8000);
      actionState(card, r.ok && r.found ? 'Highlighted on page.' : r.error || 'The element is no longer present.', r.ok && r.found ? 'ok' : 'error');
      highlight.disabled = false;
    };
    const askFrank = card.querySelector('.ask-frank');
    askFrank.onclick = () => startFrank(f, card);
    askFrank.addEventListener('pointerenter', () => { localFrankRuntime.prewarmIfAvailable().catch(() => {}); }, { once: true });
    askFrank.addEventListener('focus', () => { localFrankRuntime.prewarmIfAvailable().catch(() => {}); }, { once: true });
    const recheckButton = card.querySelector('.recheck');
    recheckButton.hidden = f.confidence === 'inconclusive' || f.category === 'context';
    recheckButton.onclick = () => recheck(f, card);
    card.querySelector('.copy').onclick = async () => {
      try { await navigator.clipboard.writeText(issueText(g)); actionState(card, 'Issue handoff copied.'); }
      catch { actionState(card, 'Clipboard access was not available.', 'error'); }
    };
    card.querySelector('.ignore').onclick = async () => {
      const r = await send({ type: 'IGNORE_RULE', ruleId: f.ruleId, pageUrl: report.page.url }, 8000);
      if (!r.ok) return actionState(card, r.error || 'Could not ignore this rule.', 'error');
      report.findings = report.findings.map(x => x.ruleId === f.ruleId ? { ...x, lifecycle: 'ignored' } : x);
      render();
      notice(`Ignored ${presentation.title} on this site.`);
    };
    wrap.appendChild(node);
  }

  if (!classFilter && !showAllChecks) renderWorthChecking(wrap);

  if (!wrap.children.length) {
    const empty = document.createElement('div');
    empty.className = 'empty-findings';
    empty.innerHTML = classFilter ? '<b>Nothing in this area.</b> Select the area again to clear the filter.'
      : showAllChecks ? '<b>No findings in this filter.</b> The current scan did not return matching observations.'
      : targetBlocked() ? '<b>No page findings to prioritize.</b> Target integrity blocked the scan before page QA ran.'
      : incompleteCoverage() ? '<b>No confirmed issues in the current evidence.</b> Some checks were incomplete. That uncertainty is recorded in Scan coverage rather than turned into defects.'
      : '<b>No priority issues need attention.</b> Use Show all checks to inspect lower-priority observations.';
    wrap.appendChild(empty);
  }
}

function renderWorthChecking(wrap) {
  const groups = report?.attention?.worthChecking || [];
  if (!groups.length || targetBlocked()) return;
  const section = document.createElement('section');
  section.className = 'worth-checking';
  section.setAttribute('aria-label', 'Worth checking further');
  const heading = document.createElement('h2');
  heading.className = 'section-title';
  heading.textContent = 'Worth checking further';
  section.appendChild(heading);
  const intro = document.createElement('p');
  intro.className = 'muted';
  intro.textContent = 'Secondary or inconclusive related checks. Confirmed material issues stay in Recommended order above.';
  section.appendChild(intro);
  for (const g of groups.slice(0, 6)) {
    const block = document.createElement('div');
    block.className = 'worth-group';
    const title = document.createElement('h3');
    title.textContent = `${g.title}${g.instanceCount > 1 ? ` · ${g.instanceCount}` : ''}`;
    block.appendChild(title);
    const list = document.createElement('ul');
    for (const id of (g.findingIds || []).slice(0, 6)) {
      const f = (report.findings || []).find(x => x.id === id);
      if (!f) continue;
      const li = document.createElement('li');
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'linkish';
      button.textContent = f.title || f.ruleId;
      button.onclick = () => startFrank(f, null, button);
      li.appendChild(button);
      list.appendChild(li);
    }
    if (list.children.length) {
      block.appendChild(list);
      section.appendChild(block);
    }
  }
  if (section.querySelector('.worth-group')) wrap.appendChild(section);
}

/* ---------------- Frank walkthrough ---------------- */
function evidenceForStep(step) {
  if (!frank?.graph?.evidence) return [];
  const ids = new Set(step.evidenceRefs || []);
  return frank.graph.evidence.filter(e => ids.has(e.id));
}
function targetSelector(step) { return step?.targetId ? frank?.graph?.targets?.[step.targetId]?.selector || '' : ''; }
function evidenceValue(value) { return typeof value === 'string' ? value : JSON.stringify(value); }
function humanSource(value) {
  const key=String(value||'').toLowerCase();
  return ({'axe':'Axe','browser':'Browser','wcag-translator':'WCAG Translator','meta-state':'Meta State','performance-monitor':'Performance Monitor','browser-performance':'Browser performance'})[key] || String(value||'scanner').replace(/[-_]+/g,' ');
}
function addFact(dl, label, value, { mono = true } = {}) {
  if (value === undefined || value === null || value === '') return;
  const dt = document.createElement('dt'), dd = document.createElement('dd');
  dt.textContent = label; dd.textContent = String(value); if (!mono) dd.classList.add('human-value'); dl.append(dt, dd);
}
function evidenceRow(item, active = false) {
  const article = document.createElement('article'); article.className = 'evidence-row'; article.dataset.active = String(active);
  const top = document.createElement('div'), label = document.createElement('b'), source = document.createElement('span'), value = document.createElement('p');
  label.textContent = item.label || item.kind || 'Evidence'; source.textContent = humanSource(item.source); value.textContent = evidenceValue(item.value);
  top.append(label, source); article.append(top, value); return article;
}
function renderFrankEvidenceLedger() {
  if (!frank) return;
  const graph = frank.graph || {}, finding = graph.finding || {}, assessment = frank.plan?.assessment || {};
  $('#frank-title').textContent = finding.title || frank.plan?.title || 'Finding';
  $('#frank-finding-detail').textContent = finding.detail || '';
  $('#frank-assessment-status').textContent = assessment.status === 'verified' ? 'Verified finding' : assessment.status === 'context' ? 'Context only' : 'Review needed';
  $('#frank-assessment').dataset.status = assessment.status || 'review';
  $('#frank-assessment-limitations').textContent = assessment.limitations || '';
  $('#frank-assessment-limitations').hidden = !assessment.limitations;

  const facts = $('#frank-facts'); facts.innerHTML = '';
  addFact(facts, 'Rule', finding.ruleId);
  addFact(facts, 'Impact area', finding.impactClass || finding.category, { mono: false });
  addFact(facts, 'Confidence', finding.confidence, { mono: false });
  addFact(facts, 'Environment', graph.environment?.type || 'unknown', { mono: false });
  if (graph.environment?.confidenceLabel) addFact(facts, 'Environment confidence', graph.environment.confidenceLabel, { mono: false });
  addFact(facts, 'Target', finding.targetType, { mono: false });
  addFact(facts, 'Selector', finding.selector);
  const allEvidence = graph.evidence || [];
  const observedSources = [...new Set(allEvidence.filter(e => e.scope !== 'standard' && e.source !== 'wcag-translator').map(e => e.source))];
  const referenceSources = [...new Set(allEvidence.filter(e => e.scope === 'standard' || e.source === 'wcag-translator').map(e => e.source))];
  addFact(facts, 'Observed by', observedSources.map(humanSource).join(', '), { mono: false });
  addFact(facts, 'Reference context', referenceSources.map(humanSource).join(', '), { mono: false });
  const method = allEvidence.find(e => e.kind === 'verification-method')?.value;
  const verificationLabel = /axe automated violation/i.test(String(method||'')) ? 'Automated · Axe' : method;
  addFact(facts, 'Verification', verificationLabel, { mono: false });
  const attempts = Number(allEvidence.find(e => e.kind === 'verification-attempts')?.value || 0);
  if (attempts > 1) addFact(facts, 'Verification attempts', attempts);

  const record = $('#frank-evidence-record'); record.innerHTML = '';
  for (const item of graph.evidence || []) record.appendChild(evidenceRow(item, false));
  $('#frank-all-evidence').hidden = !(graph.evidence || []).length;
}

function renderFrankStep(index) {
  if (!frank) return;
  const total = frank.plan.steps.length;
  frank.index = Math.max(0, Math.min(total - 1, Number(index) || 0));
  const step = frank.plan.steps[frank.index];
  $('#frank-step-count').textContent = `Step ${frank.index + 1} of ${total}`;
  const progressPct = Math.round(((frank.index + 1) / total) * 100);
  $('#frank-progress-bar').style.width = `${progressPct}%`;
  const track = $('#frank-progress-track');
  if (track) { track.setAttribute('aria-valuenow', String(progressPct)); track.setAttribute('aria-valuetext', `Step ${frank.index + 1} of ${total}`); }
  const STEP_ROLE = { spotlight: 'Locate', evidence: 'Checks', interpretation: 'Meaning', comparison: 'Compare', trend: 'History', impact: 'Impact', remediation: 'Fix', verification: 'Verify', summary: 'Summary' };
  $('#frank-step-type').textContent = STEP_ROLE[step.type] || step.type;

  const current = $('#frank-current-evidence'); current.innerHTML = '';
  const used = evidenceForStep(step);
  if (used.length) for (const item of used) current.appendChild(evidenceRow(item, true));
  else {
    const empty = document.createElement('p'); empty.className = 'evidence-empty';
    empty.textContent = 'This step relies on the verified finding and does not add another measurement.'; current.appendChild(empty);
  }

  const activeIds = new Set(step.evidenceRefs || []);
  for (const row of $('#frank-evidence-record').querySelectorAll('.evidence-row')) row.dataset.active = 'false';
  const allEvidence = frank.graph?.evidence || [];
  [...$('#frank-evidence-record').children].forEach((row, i) => { row.dataset.active = String(activeIds.has(allEvidence[i]?.id)); });

  $('#frank-preview').hidden = !(step.preview || {}).enabled;
  $('#frank-reset').hidden = true;
  $('#frank-copy-selector').hidden = !targetSelector(step);
  $('#frank-recheck').hidden = step.type !== 'verification';
}

function enterFrank() {
  document.body.dataset.mode = 'frank';
  $('#scanner-view').hidden = true; $('#frank-view').hidden = false;
  $('#host').textContent = report?.page?.hostname || 'Guided investigation';
  requestAnimationFrame(() => { try { window.scrollTo({ top: 0, behavior: 'auto' }); $('#frank-ledger-title')?.focus?.({ preventScroll: true }); } catch {} });
}
function leaveFrankLocal() {
  const returnFocus = frankReturnFocus; frankReturnFocus = null;
  if (frank) lastFrank = frank;
  frank = null; document.body.dataset.mode = '';
  $('#scanner-view').hidden = false; $('#frank-view').hidden = true;
  $('#host').textContent = report?.page?.hostname || report?.page?.url || 'Current page';
  $('#frank-action-state').hidden = true;
  setTimeout(() => returnFocus?.isConnected && returnFocus.focus(), 0);
}

async function startFrank(finding, card, triggerButton = null) {
  if (!report || !tab?.id) return actionState(card, 'Run a current scan before asking Frank.', 'error');
  pendingFrankCancel?.();
  const button = triggerButton || card?.querySelector?.('.ask-frank') || null;
  const requestId = ++frankRequestSeq, pageUrl = report.page?.url || tab.url, tabId = tab.id;
  runtimeTrace.record('frank-request', { ruleId: finding.ruleId, impactClass: finding.impactClass, confidence: finding.confidence });
  frankReturnFocus = button;
  if (button) { button.disabled = true; button.textContent = button.classList.contains('linkish') ? 'Preparing…' : 'Preparing Frank'; }

  let cancelled = false, cancelResolve, verifiedResolve;
  const cancelPromise = new Promise(resolve => { cancelResolve = resolve; });
  const verifiedChoice = new Promise(resolve => { verifiedResolve = resolve; });
  const resetButton = () => {
    if (!button) return;
    button.disabled = false;
    button.textContent = button.classList.contains('linkish') ? (finding.title || finding.ruleId || 'Ask Frank') : 'Ask Frank';
  };
  const cancelThisRequest = () => {
    if (cancelled) return;
    cancelled = true; cancelResolve({ type: 'cancelled' });
    resetButton();
    if (card?.isConnected) actionState(card, 'Frank preparation was cancelled because the page or selected finding changed.', 'warn');
    else notice('Frank preparation was cancelled because the page or selected finding changed.', 'warn');
  };
  pendingFrankCancel = cancelThisRequest;

  const showPreparing = state => {
    if (cancelled || !currentRequest(requestId, pageUrl, tabId)) return;
    const pct = state.progress != null ? ` · ${Math.round(state.progress * 100)}%` : '';
    const message = state.status === 'downloading'
      ? `Preparing Frank on this device${pct}. You can keep reviewing the scan; this finding will open automatically when Frank is ready.`
      : 'Loading Frank on this device. You can keep reviewing the scan; this finding will open automatically when Frank is ready.';
    actionState(card, message, 'ok', {
      persistent: true,
      actionLabel: 'Use verified guidance now',
      onAction: () => verifiedResolve({ type: 'verified' })
    });
  };
  const unsubscribe = localFrankRuntime.subscribe(state => {
    if (['downloading', 'warming', 'downloadable'].includes(state.status)) showPreparing(state);
    else if (state.status === 'ready' && !cancelled && currentRequest(requestId, pageUrl, tabId)) actionState(card, 'Frank is ready. Building an evidence-grounded explanation…', 'ok', { persistent: true });
  });

  // This call is deliberately synchronous with the Ask Frank click so Chrome
  // can use the user activation to trigger first-use model preparation.
  const readinessPromise = localFrankRuntime.activateFromGesture();
  showPreparing(localFrankRuntime.snapshot());

  const preparedPromise = send({ type: 'PREPARE_FRANK', finding, report, tabId }, 24000);
  const prepared = await Promise.race([preparedPromise, cancelPromise]);
  if (prepared?.type === 'cancelled' || cancelled || !currentRequest(requestId, pageUrl, tabId)) {
    unsubscribe(); if (pendingFrankCancel === cancelThisRequest) pendingFrankCancel = null; return;
  }
  if (!prepared.ok || !prepared.plan || !prepared.graph) {
    unsubscribe(); resetButton(); frankReturnFocus = null;
    if (pendingFrankCancel === cancelThisRequest) pendingFrankCancel = null;
    actionState(card, prepared.error || 'Frank could not prepare this finding.', 'error');
    if (prepared.diagnostic) showFailure(prepared, 'Frank could not prepare this finding.');
    return;
  }

  let plan = prepared.plan;
  let reasoning = { status: 'fallback', mode: 'deterministic', provider: 'deterministic', code: 'LOCAL_AI_UNAVAILABLE', message: 'Frank is using verified deterministic guidance.' };
  let skipCloud = false;
  const readiness = await Promise.race([
    readinessPromise.then(result => ({ type: 'local', result })),
    verifiedChoice,
    cancelPromise
  ]);
  if (readiness?.type === 'cancelled' || cancelled || !currentRequest(requestId, pageUrl, tabId)) {
    unsubscribe(); if (pendingFrankCancel === cancelThisRequest) pendingFrankCancel = null; return;
  }
  unsubscribe();

  if (readiness?.type === 'verified') {
    skipCloud = true;
    reasoning = { status: 'fallback', mode: 'deterministic', provider: 'deterministic', code: 'USER_CHOSE_VERIFIED', message: 'You chose verified guidance while Chrome continues preparing Frank in the background.' };
  } else if (readiness?.result?.ok && localFrankRuntime.snapshot().status === 'ready') {
    let taskSession = null;
    try {
      taskSession = await localFrankRuntime.cloneTask();
      plan = await localFrankWalkthrough({ session: taskSession, graph: prepared.graph, deterministicPlan: prepared.plan });
      reasoning = { status: 'operational', mode: 'ai', provider: 'chrome-built-in', model: 'Chrome built-in model', location: 'device', message: 'Frank improved the verified guidance with an isolated on-device reasoning session. Page evidence stayed on this device.' };
      runtimeTrace.record('frank-reasoning', { status: reasoning.status, provider: reasoning.provider, mode: reasoning.mode });
    } catch (error) {
      reasoning = { status: 'fallback', mode: 'deterministic', provider: 'chrome-built-in', code: error?.code || 'LOCAL_AI_FAILED', message: String(error?.message || "On-device reasoning did not pass Frank's evidence checks.").slice(0, 240) };
      runtimeTrace.record('frank-reasoning', { status: reasoning.status, provider: reasoning.provider, mode: reasoning.mode, code: reasoning.code });
    } finally { try { taskSession?.destroy?.(); } catch {} }
  } else if (readiness?.result?.message) {
    reasoning = { status: 'fallback', mode: 'deterministic', provider: 'chrome-built-in', code: readiness.result.code || 'LOCAL_AI_UNAVAILABLE', message: readiness.result.message };
  }

  if (plan.mode !== 'ai' && cloudAiFallback && !skipCloud) {
    actionState(card, 'On-device reasoning unavailable. Trying the optional cloud fallback…', 'warn', { persistent: true });
    const cloud = await Promise.race([send({ type: 'CLOUD_FRANK_PLAN', graph: prepared.graph }, 22000), cancelPromise]);
    if (cloud?.type === 'cancelled' || cancelled || !currentRequest(requestId, pageUrl, tabId)) {
      unsubscribe(); if (pendingFrankCancel === cancelThisRequest) pendingFrankCancel = null; return;
    }
    if (cloud.ok && cloud.plan?.mode === 'ai') { plan = cloud.plan; reasoning = cloud.reasoning || { status: 'operational', mode: 'ai', provider: 'openai', location: 'cloud' }; }
    else if (cloud?.reasoning?.message) reasoning = { ...reasoning, message: `${reasoning.message} Cloud fallback: ${cloud.reasoning.message}`.slice(0, 240) };
  }

  if (!(await currentTabStillMatches(pageUrl, tabId))) {
    unsubscribe(); cancelThisRequest(); actionState(card, 'The inspected page changed while Frank was preparing. Ask Frank on the current scan instead.', 'warn'); return;
  }

  const started = await send({ type: 'FRANK_START_PLAN', plan, graph: prepared.graph, reasoning, tabId: prepared.tabId || tabId }, 9000);
  unsubscribe(); resetButton();
  if (pendingFrankCancel === cancelThisRequest) pendingFrankCancel = null;
  if (!started.ok) {
    frankReturnFocus = null;
    actionState(card, started.error || 'Frank could not start the walkthrough.', 'error');
    if (started.diagnostic) showFailure(started, 'Frank could not start the walkthrough.');
    return;
  }

  frank = { plan, graph: prepared.graph, tabId: prepared.tabId || tabId, index: 0, finding, reasoning, planValid: true };
  lastFrank = frank;
  runtimeTrace.record('frank-started', { mode: plan.mode, provider: reasoning.provider, status: reasoning.status, code: reasoning.code || '', stepCount: plan.steps?.length || 0 });

  const windowInfo = await chrome.windows.getCurrent().catch(() => null);
  const windowId = tab?.windowId || windowInfo?.id;
  const snapshot = await send({
    type: 'SAVE_WORKSPACE_SNAPSHOT',
    workspace: {
      tabId: prepared.tabId || tabId,
      windowId,
      pageUrl,
      report,
      classFilter,
      showAllChecks,
      filter,
      findingId: finding.id || '',
      stepIndex: 0,
      frankFocus: true
    }
  }, 8000);

  if (!snapshot.ok) {
    // Keep the side panel as the sole surface: tear down the page coach to avoid an orphaned overlay.
    await send({ type: 'FRANK_END', tabId: prepared.tabId || tabId }, 4000).catch(() => {});
    frank = { plan, graph: prepared.graph, tabId: prepared.tabId || tabId, index: 0, finding, reasoning, planValid: true };
  lastFrank = frank;
    enterFrank();
    renderFrankEvidenceLedger();
    const aiOperationalFail = frank.plan.mode === 'ai' && frank.reasoning?.status === 'operational';
    const onDeviceFail = aiOperationalFail && frank.reasoning?.provider === 'chrome-built-in';
    $('#frank-mode').textContent = onDeviceFail ? 'On-device reasoning' : aiOperationalFail ? 'Cloud reasoning' : 'Verified guidance';
    $('#frank-mode').dataset.mode = aiOperationalFail ? 'ai' : 'deterministic';
    renderFrankStep(0);
    notice(snapshot.error || 'Frank started in the side panel because the QA workspace could not be saved for focus mode.', 'warn');
    return;
  }

  frank = { plan, graph: prepared.graph, tabId: prepared.tabId || tabId, index: 0, finding, reasoning, planValid: true };
  lastFrank = frank;
  const aiOperational = frank.plan.mode === 'ai' && frank.reasoning?.status === 'operational';
  const onDevice = aiOperational && frank.reasoning?.provider === 'chrome-built-in';
  // Cost-control / mode notice is recorded in the runtime trace; the panel closes immediately after.
  if (onDevice) runtimeTrace.record('frank-focus-mode', { message: 'No metered AI request was used' });
  else if (aiOperational) runtimeTrace.record('frank-focus-mode', { message: 'Optional metered cloud fallback' });
  // Preferred UX: coach owns the page; close the global side panel to restore horizontal space.
  try { window.close(); } catch {}
  if (windowId) send({ type: 'CLOSE_SIDE_PANEL', windowId }, 3000).catch(() => {});
}

async function gotoFrank(index) {
  if (!frank) return;
  const next = Math.max(0, Math.min(frank.plan.steps.length - 1, index));
  const r = await send({ type: 'FRANK_GOTO', tabId: frank.tabId, index: next }, 8000);
  if (!r.ok) return frankAction(r.error || 'Could not move Frank to that step.', 'error');
  renderFrankStep(next);
}
async function endFrank() {
  if (!frank) return;
  await send({ type: 'FRANK_END', tabId: frank.tabId }, 5000);
  leaveFrankLocal();
  notice('Frank session closed.');
}

async function loadSession() {
  if (!report?.page?.url) return;
  const r = await send({ type: 'GET_SITE_SESSION', pageUrl: report.page.url }, 6000);
  siteSession = r.ok ? r.session : null;
  renderSession();
}

async function rescan() {
  if (scanInFlight) return;
  const scanId = `scan-${Date.now().toString(36)}`;
  const scanMode = tab?.id ? 'current-tab' : 'active-tab';
  runtimeTrace.clear();
  lastScanAttempt = { scanId, ok: false, mode: scanMode, at: new Date().toISOString() };
  lastFrank = null;
  runtimeTrace.record('scan-start', { hasTab: Boolean(tab?.id), mode: scanMode, scanId });
  pendingFrankCancel?.(); pendingFrankCancel = null; frankRequestSeq++;
  if (frank) await endFrank();
  scanInFlight = true; classFilter = '';
  const button = $('#scan'); button.disabled = true; button.textContent = 'Scanning';
  document.body.dataset.scanning = 'true';
  $('#idle-state').hidden = true;
  $('#summary').hidden = false;
  const qaSection = document.querySelector('.qa-section');
  if (qaSection) qaSection.hidden = true;
  $('#ledger').innerHTML = '';
  $('#findings').innerHTML = '<div class="empty-findings"><b>Scan in progress.</b> Findings appear when verified evidence is ready.</div>';
  const overview = $('#frank-overview');
  if (overview) {
    overview.dataset.state = 'loading';
    $('#judgment-title').textContent = 'Inspecting this page…';
    $('#brief').textContent = 'Gathering verified evidence across QA areas…';
    $('#material-count').textContent = '';
    $('#coverage-state').textContent = '';
  }
  clearDiagnostic(); notice('Inspecting the current page…');
  try {
    const r = await send(tab?.id ? { type: 'SCAN_TAB', tabId: tab.id } : { type: 'SCAN_ACTIVE' }, 20000);
    if (!r.ok) {
      lastScanAttempt = { ...lastScanAttempt, ok: false, operation: r.diagnostic?.operation || 'SCAN', code: r.diagnostic?.id || '' };
      runtimeTrace.record('scan-failed', { scanId, diagnosticId: r.diagnostic?.id || '', operation: r.diagnostic?.operation || 'SCAN' });
      showFailure(r, 'The page scan could not complete.');
      return;
    }
    tab = r.tab; report = r.report;
    report.scanId = scanId;
    lastScanAttempt = { scanId, ok: true, mode: scanMode, at: new Date().toISOString() };
    $('#new-count').textContent = 'Local scan';
    report.priorityBrief = 'Local evidence is ready. Connected context is still running.';
    render();
    const scanned = new Date(report.scannedAt || Date.now()).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    notice('Local checks complete. Verifying published state, monitored performance and standards context…');
    const enriched = await send({ type: 'ENRICH', report, tabId: tab?.id }, 32000);
    if (enriched.ok) {
      report = enriched.report;
      runtimeTrace.record('scan-complete', { findingCount: Number(report.findings?.length||0), materialGroupCount: Number(report.attention?.materialGroupCount||0), representedClasses: report.attention?.representedClasses||[], connectedMode: report.connectedMode||'unknown', scanId });
      const changed = [report.lifecycle?.newCount ? `${report.lifecycle.newCount} new` : '', report.lifecycle?.resolvedCount ? `${report.lifecycle.resolvedCount} resolved` : ''].filter(Boolean).join(' · ') || 'No changes';
      $('#new-count').textContent = changed;
      render();
      await loadSession();
      const unavailable = Object.entries(report.coverage || {}).filter(([, v]) => /unavailable/i.test(String(v))).map(([k]) => k);
      if (report.connectedMode === 'auth-required') {
        const connection = $('#connection-settings'); if (connection) connection.open = true;
        notice('Browser QA completed locally. The assistant gateway requires an access key. Enter it under Connection settings to restore connected services.', 'warn');
      } else if (report.connectedMode === 'auth-rejected') {
        const connection = $('#connection-settings'); if (connection) connection.open = true;
        notice('Browser QA completed locally. The saved assistant access key was rejected. Verify the key under Connection settings to restore connected services.', 'warn');
      } else if (report.connectedMode === 'unavailable') notice('Browser QA completed. The assistant gateway could not be reached. Browser QA remains available with local evidence and verified guidance.', 'warn');
      else notice(unavailable.length ? `Scan complete with limited coverage: ${unavailable.join(', ')}.` : `Scan complete at ${scanned}.`, unavailable.length ? 'warn' : 'ok');
    } else {
      runtimeTrace.record('scan-enrichment-failed', { scanId, diagnosticId: enriched?.diagnostic?.id || '', operation: enriched?.diagnostic?.operation || 'ENRICH', code: enriched?.diagnostic?.id || '' });
      showFailure(enriched, 'Local scan completed, but connected context could not finish.');
    }
    await updateWatch();
  } finally {
    scanInFlight = false;
    delete document.body.dataset.scanning;
    button.disabled = false;
    button.textContent = report ? 'Rescan' : 'Scan page';
    if (!report) {
      if (lastDiagnostic) {
        $('#summary').hidden = false;
        $('#idle-state').hidden = true;
      } else {
        $('#summary').hidden = true;
        $('#idle-state').hidden = false;
      }
    }
  }
}

async function updateWatch() {
  const pageUrl = report?.page?.url || tab?.url;
  if (!pageUrl) return;
  let u; try { u = new URL(pageUrl); } catch { return; }
  const data = await chrome.storage.local.get({ watchedOrigins: [] });
  const watching = data.watchedOrigins.includes(u.origin);
  const watch = $('#watch'); const label = watch?.querySelector('b'); const detail = watch?.querySelector('small');
  if (label) label.textContent = watching ? 'Watching site' : 'Watch this site';
  if (detail) detail.textContent = watching ? 'Local site session is active' : 'Keep a local site session';
}
async function loadSettings() {
  const r = await send({ type: 'GET_ACTIVE' }, 5000);
  if (r.ok) {
    $('#gateway-url').value = r.settings?.apiBase || '';
    $('#gateway-key').value = r.settings?.apiKey || '';
    cloudAiFallback = Boolean(r.settings?.cloudAiFallback);
    const cloudToggle = $('#cloud-ai-fallback'); if (cloudToggle) cloudToggle.checked = cloudAiFallback;
    if (r.tab?.id && !tab) tab = r.tab;
  }
}

/* ---------------- events ---------------- */
$('#copy-diagnostic').onclick = async () => {
  if (!lastDiagnostic) return;
  const text = [`Web QA Assistant ${lastDiagnostic.version || ''}`.trim(), `Diagnostic: ${lastDiagnostic.id || 'Unavailable'}`, `Operation: ${lastDiagnostic.operation || 'Unknown'}`, `Time: ${lastDiagnostic.timestamp || ''}`, `Technical message: ${lastDiagnostic.technicalMessage || ''}`, lastDiagnostic.stack ? `Stack:\n${lastDiagnostic.stack}` : ''].filter(Boolean).join('\n');
  try { await navigator.clipboard.writeText(text); notice('Diagnostics copied.', 'ok'); }
  catch { notice('Clipboard access was not available.', 'error'); }
};

function currentBugArtifact() {
  const includeContext = $('#bug-include-context')?.checked === true;
  const diagnostic = lastDiagnostic ? { id: lastDiagnostic.id, operation: lastDiagnostic.operation, timestamp: lastDiagnostic.timestamp } : null;
  return buildBugReport({
    version: RELEASE_VERSION,
    trace: runtimeTrace.snapshot(),
    readiness: localFrankRuntime.snapshot(),
    report,
    frank: frank || lastFrank,
    localAi: localAiDiagnostics({ includeOutput: includeContext }),
    userNote: $('#bug-note')?.value || '',
    includeContext,
    userAgent: navigator.userAgent,
    lastDiagnostic: diagnostic,
    lastScanAttempt
  });
}
function refreshBugPrivacyCopy(){ const includeContext = $('#bug-include-context')?.checked === true; $('#bug-privacy-summary').textContent = bugReportPrivacySummary(includeContext); }
$('#report-bug').onclick = () => { runtimeTrace.record('report-bug-opened'); $('#bug-include-context').checked = false; $('#bug-note').value = ''; refreshBugPrivacyCopy(); $('#bug-dialog').showModal(); };
$('#bug-include-context').onchange = refreshBugPrivacyCopy;
$('#bug-copy').onclick = async () => { try { const artifact=currentBugArtifact(); await navigator.clipboard.writeText(JSON.stringify(artifact,null,2)); runtimeTrace.record('report-bug-copied',{includeContext:$('#bug-include-context').checked===true}); notice('Bug report copied. Nothing was sent automatically.','ok'); } catch { notice('Clipboard access was not available.','error'); } };
$('#bug-download').onclick = () => { const artifact=currentBugArtifact(),blob=new Blob([JSON.stringify(artifact,null,2)],{type:'application/json'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=`web-qa-assistant-bug-${new Date().toISOString().replace(/[:.]/g,'-')}.json`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);runtimeTrace.record('report-bug-downloaded',{includeContext:$('#bug-include-context').checked===true});notice('Bug report downloaded. Review it before sharing with support.','ok'); };

function bindHelpDots() {
  for (const btn of document.querySelectorAll('.help-dot[aria-controls]')) {
    btn.addEventListener('click', () => {
      const panel = document.getElementById(btn.getAttribute('aria-controls'));
      if (!panel) return;
      const open = panel.hidden;
      panel.hidden = !open;
      btn.setAttribute('aria-expanded', String(open));
    });
  }
}
bindHelpDots();
$('#scan').onclick = rescan;
$('#show-all').onclick = () => { showAllChecks = !showAllChecks; filter = 'all'; classFilter = ''; render(); };
$('#copy-md').onclick = async () => { if (!report) return; try { await navigator.clipboard.writeText(markdown()); notice('Report copied.', 'ok'); } catch { notice('Clipboard access was not available.', 'error'); } };
$('#copy-json').onclick = async () => { if (!report) return; try { await navigator.clipboard.writeText(JSON.stringify(report, null, 2)); notice('JSON report copied.', 'ok'); } catch { notice('Clipboard access was not available.', 'error'); } };
$('#watch').onclick = async () => {
  const pageUrl = report?.page?.url || tab?.url; if (!pageUrl) return;
  const u = new URL(pageUrl), pattern = `${u.protocol}//${u.host}/*`;
  const data = await chrome.storage.local.get({ watchedOrigins: [] });
  if (data.watchedOrigins.includes(u.origin)) {
    data.watchedOrigins = data.watchedOrigins.filter(x => x !== u.origin);
    await chrome.storage.local.set({ watchedOrigins: data.watchedOrigins });
    await chrome.permissions.remove({ origins: [pattern] });
    notice('Watch mode disabled for this site.');
  } else {
    const ok = await chrome.permissions.request({ origins: [pattern] });
    if (ok) {
      data.watchedOrigins = [...new Set([...data.watchedOrigins, u.origin])];
      await chrome.storage.local.set({ watchedOrigins: data.watchedOrigins });
      notice('Watch mode enabled for this site.', 'ok');
    } else notice('Site permission was not granted.', 'warn');
  }
  await updateWatch();
};
$('#environment').onchange = async () => {
  if (!report?.page?.url) return;
  const value = $('#environment').value;
  notice(`Updating environment context to ${value === 'auto' ? 'automatic inference' : value}…`);
  const r = await send({ type: 'SET_ENVIRONMENT', environment: value, pageUrl: report.page.url }, 8000);
  if (!r.ok) return notice(r.error || 'Could not update environment context.', 'error');
  showAllChecks = false;
  await rescan();
};
async function ensureGatewayPermission(raw) {
  const value = String(raw || '').trim(); if (!value) return true;
  let u; try { u = new URL(value); } catch { return false; }
  if (!/^https?:$/.test(u.protocol)) return false;
  const pattern = `${u.origin}/*`;
  if (await chrome.permissions.contains({ origins: [pattern] })) return true;
  return chrome.permissions.request({ origins: [pattern] });
}
async function runGatewayTest() {
  runtimeTrace.record('gateway-test-start');
  const apiBase = $('#gateway-url').value.trim(), apiKey = $('#gateway-key').value;
  const button = $('#test-gateway'), status = $('#gateway-status'), list = $('#gateway-integrations');
  if (apiBase && !(await ensureGatewayPermission(apiBase))) {
    status.textContent = 'Gateway permission was not granted.'; status.dataset.kind = 'error'; return null;
  }
  button.disabled = true; status.textContent = 'Checking gateway and integration health…'; status.dataset.kind = ''; list.innerHTML = '';
  try {
    // Test exactly what is visible in the form. Saving first is not required.
    const r = await send({ type: 'TEST_GATEWAY', apiBase, apiKey, cloudAiFallback: $('#cloud-ai-fallback')?.checked === true }, 13000);
    if (!r.ok) { status.textContent = r.error || 'Gateway check failed.'; status.dataset.kind = 'error'; return r; }
    status.textContent = r.summary;
    status.dataset.kind = !r.reachable ? 'error' : (r.auth === 'rejected' || r.auth === 'required' || (r.problems || []).length) ? 'warn' : 'ok';
    const localAi = await probeLocalAi();
    const localRow = document.createElement('div');
    localRow.className = 'integration-row';
    localRow.dataset.status = localAi.status === 'available' ? 'available' : localAi.status === 'unavailable' ? 'degraded' : 'not-applicable';
    localRow.innerHTML = `<b>On-device Frank</b><span>${esc(localAi.status || 'unavailable')}</span>`;
    localRow.title = localAi.message || '';
    list.appendChild(localRow);
    const ai = r.integrations?.openai;
    if (ai) {
      const el = document.createElement('div');
      const cloudEnabled = $('#cloud-ai-fallback')?.checked === true;
      el.className = 'integration-row'; el.dataset.status = ai.operational ? 'available' : ai.status === 'disabled' || !cloudEnabled ? 'not-applicable' : 'degraded';
      el.innerHTML = `<b>Cloud AI fallback</b><span>${esc(!cloudEnabled ? 'off in extension' : (ai.operational ? 'operational' : (ai.status || 'unavailable')))}${ai.latencyMs ? ` · ${esc(ai.latencyMs)}ms` : ''}</span>`;
      if (ai.message) el.title = ai.message;
      list.appendChild(el);
    }
    for (const row of Object.values(r.integrations?.integrations || {})) {
      const el = document.createElement('div');
      el.className = 'integration-row'; el.dataset.status = row.status;
      el.innerHTML = `<b>${esc(row.label)}</b><span>${esc(row.status)}${row.httpStatus ? ` · ${row.httpStatus}` : ''}</span>`;
      if (row.detail) el.title = row.detail;
      list.appendChild(el);
    }
    runtimeTrace.record('gateway-test-complete', { reachable: Boolean(r.reachable), auth: r.auth || '', problems: Number(r.problems?.length||0) });
    return r;
  } finally { button.disabled = false; }
}
$('#save-gateway').onclick = async () => {
  const apiBase = $('#gateway-url').value.trim();
  if (apiBase && !(await ensureGatewayPermission(apiBase))) {
    $('#gateway-status').textContent = 'Gateway permission was not granted.';
    $('#gateway-status').dataset.kind = 'error';
    return;
  }
  cloudAiFallback = $('#cloud-ai-fallback')?.checked === true;
  const r = await send({ type: 'SAVE_GATEWAY_SETTINGS', apiBase, apiKey: $('#gateway-key').value, cloudAiFallback }, 8000);
  if (!r.ok) {
    notice(r.error || 'Could not save connection settings.', 'error');
    $('#gateway-status').textContent = r.error || 'Could not save connection settings.';
    $('#gateway-status').dataset.kind = 'error';
    return;
  }
  notice('Connection settings saved. Verifying them now…', 'ok');
  const verification = await runGatewayTest();
  connectionVerificationNotice(verification);
};
$('#test-gateway').onclick = runGatewayTest;
$('#clear-session').onclick = async () => {
  if (!report?.page?.url) return;
  const r = await send({ type: 'CLEAR_SITE_SESSION', pageUrl: report.page.url }, 6000);
  if (r.ok) { siteSession = null; renderSession(); notice('Site session cleared.'); }
};
$('#frank-exit').onclick = endFrank;
$('#frank-preview').onclick = async () => {
  if (!frank) return;
  const step = frank.plan.steps[frank.index];
  const r = await send({ type: 'FRANK_PREVIEW', tabId: frank.tabId, targetId: step.targetId, preview: step.preview }, 7000);
  if (!r.ok) return frankAction(r.error || 'Preview could not be applied.', 'error');
  $('#frank-reset').hidden = false;
  frankAction('Temporary preview applied. Nothing was saved to the site.');
};
$('#frank-reset').onclick = async () => {
  if (!frank) return;
  const r = await send({ type: 'FRANK_RESET_PREVIEW', tabId: frank.tabId }, 5000);
  if (!r.ok) return frankAction(r.error || 'Could not reset the preview.', 'error');
  $('#frank-reset').hidden = true;
  frankAction('Preview reset.');
};
$('#frank-copy-selector').onclick = async () => {
  if (!frank) return;
  const selector = targetSelector(frank.plan.steps[frank.index]); if (!selector) return;
  try { await navigator.clipboard.writeText(selector); frankAction('Selector copied.'); }
  catch { frankAction('Clipboard access was not available.', 'error'); }
};
$('#frank-recheck').onclick = () => { if (frank?.finding) recheck(frank.finding, null); };

function focusFindingCard(findingId) {
  if (!findingId) return;
  const cards = [...document.querySelectorAll('#findings .finding')];
  const card = cards.find(node => node.dataset.findingId === findingId) || cards[0];
  if (!card) return;
  try { card.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); } catch { try { card.scrollIntoView(); } catch {} }
  const ask = card.querySelector('.ask-frank');
  setTimeout(() => ask?.focus?.(), 0);
}

function applyWorkspaceSnapshot(workspace, { fromFrankFocus = false } = {}) {
  if (!workspace?.report) return false;
  report = workspace.report;
  classFilter = workspace.classFilter || '';
  showAllChecks = Boolean(workspace.showAllChecks);
  filter = workspace.filter || 'all';
  if (workspace.tabId) tab = { ...(tab || {}), id: workspace.tabId, windowId: workspace.windowId || tab?.windowId, url: workspace.pageUrl || tab?.url };
  leaveFrankLocal();
  render();
  focusFindingCard(workspace.findingId || '');
  notice(fromFrankFocus ? 'Returned to QA with your previous scan.' : 'Restored your previous scan.', 'ok');
  return true;
}

async function restoreWorkspaceOrRescan({ tabId = null, pageUrl = '', preferRestore = true } = {}) {
  await loadSettings();
  await localFrankRuntime.probe().catch(() => {});
  localFrankRuntime.prewarmIfAvailable().catch(() => {});
  const active = await send({ type: 'GET_ACTIVE' }, 5000);
  if (active.ok && active.tab?.id) tab = { id: active.tab.id, windowId: active.tab.windowId, url: active.tab.url };
  const useTabId = tabId || tab?.id;
  const useUrl = pageUrl || tab?.url || '';
  if (preferRestore && useTabId) {
    const snap = await send({ type: 'GET_WORKSPACE_SNAPSHOT', tabId: useTabId }, 5000);
    const workspace = snap.ok ? snap.workspace : null;
    if (workspace?.report && (!useUrl || workspace.pageUrl === useUrl || (tab?.url && workspace.pageUrl === tab.url))) {
      const shouldRestore = Boolean(workspace.frankFocus || workspace.pendingReturn);
      if (!shouldRestore) {
        await rescan();
        return { restored: false };
      }
      const fromFrank = Boolean(workspace.frankFocus || workspace.pendingReturn);
      if (workspace.frankFocus && useTabId) await send({ type: 'FRANK_END', tabId: useTabId }, 4000).catch(() => {});
      applyWorkspaceSnapshot(workspace, { fromFrankFocus: fromFrank });
      await send({ type: 'PATCH_WORKSPACE_SNAPSHOT', tabId: useTabId, patch: { frankFocus: false, pendingReturn: false } }, 4000).catch(() => {});
      await loadSession();
      await updateWatch();
      return { restored: true };
    }
  }
  await rescan();
  return { restored: false };
}

chrome.runtime.onMessage.addListener(msg => {
  if (msg?.type === 'ACTION_INVOKED') {
    if (msg.tabId) tab = { ...(tab || {}), id: msg.tabId, windowId: msg.windowId || tab?.windowId, url: msg.pageUrl || tab?.url };
    restoreWorkspaceOrRescan({ tabId: msg.tabId, pageUrl: msg.pageUrl || '', preferRestore: true });
  }
  if (msg?.type === 'FRANK_STEP_CHANGED' && frank) renderFrankStep(msg.index);
  if (msg?.type === 'FRANK_CLOSED' && frank) { leaveFrankLocal(); notice('Frank session closed.'); }
  if (msg?.type === 'OPEN_REPORT_BUG') {
    runtimeTrace.record('report-bug-opened', { fromFrank: true });
    $('#bug-include-context').checked = false;
    $('#bug-note').value = '';
    refreshBugPrivacyCopy();
    $('#bug-dialog')?.showModal();
  }
});

loadSettings().finally(() => restoreWorkspaceOrRescan({ preferRestore: true }));
