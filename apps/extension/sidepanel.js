import { beginLocalFrankSession, localFrankWalkthrough, probeLocalAi, resolveLocalFrankSession } from './local-ai.js';
let report = null, filter = 'all', tab = null, scanInFlight = false, frank = null,
    showAllChecks = false, lastDiagnostic = null, siteSession = null, classFilter = '', cloudAiFallback = false, frankReturnFocus = null;

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
function actionState(card, message, kind = 'ok') {
  const el = card.querySelector('.action-state');
  el.textContent = message; el.dataset.kind = kind; el.hidden = false;
  clearTimeout(el._hideTimer); el._hideTimer = setTimeout(() => { el.hidden = true; }, 5000);
}
function frankAction(message, kind = 'ok') {
  const el = $('#frank-action-state');
  el.textContent = message; el.dataset.kind = kind; el.hidden = false;
  clearTimeout(el._hideTimer); el._hideTimer = setTimeout(() => { el.hidden = true; }, 5000);
}

const CLASS_TONE = { availability: 'critical', discoverability: 'warn', accessibility: 'info', performance: 'warn', implementation: 'info', coverage: 'info' };
const LEDGER_ORDER = ['availability', 'discoverability', 'accessibility', 'performance', 'implementation'];

function findingById(id) { return (report?.findings || []).find(f => f.id === id) || null; }
function materialFindings() { return (report?.findings || []).filter(f => f.lifecycle !== 'ignored' && f.frankVisible !== false && f.category !== 'context' && f.confidence !== 'inconclusive'); }
function incompleteCoverage() {
  const statuses = Object.values(report?.coverage || {}).filter(v => /partial|unavailable/i.test(String(v))).length;
  return statuses + Number(report?.linkAudit?.inconclusive || 0);
}
function judgment() {
  const groups = report?.attention?.materialGroupCount || 0;
  const blockers = materialFindings().filter(f => f.frankPriority === 'blocker').length;
  if (blockers) return { state: 'blocker', title: `${groups} issue${groups === 1 ? '' : 's'} need attention` };
  if (groups) return { state: 'attention', title: `${groups} issue${groups === 1 ? '' : 's'} worth addressing` };
  if (incompleteCoverage()) return { state: 'incomplete', title: 'No confirmed problems found' };
  return { state: 'healthy', title: 'Nothing material found' };
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
  const counts = report?.attention?.classCounts || {};
  const labels = report?.attention?.classLabels || {};
  const present = LEDGER_ORDER.filter(id => counts[id]);
  if (!present.length) return;
  const leadClass = (report?.attention?.groups || [])[0]?.impactClass || '';
  for (const id of present) {
    const cell = document.createElement('button');
    cell.type = 'button';
    cell.className = 'ledger-cell';
    cell.dataset.lead = String(id === leadClass);
    cell.setAttribute('aria-pressed', String(classFilter === id));
    cell.innerHTML = `<b>${esc(counts[id])}</b><span>${esc(labels[id] || id)}</span>`;
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
  $('#frank-overview').dataset.state = j.state;
  $('#judgment-title').textContent = j.title;
  $('#brief').textContent = report.priorityBrief || '';
  const groups = report.attention?.materialGroupCount || 0;
  const findings = report.attention?.materialFindingCount || 0;
  $('#material-count').textContent = groups === findings
    ? `${groups} material finding${groups === 1 ? '' : 's'}`
    : `${groups} grouped from ${findings} findings`;
  $('#coverage-state').textContent = incompleteCoverage() ? `${incompleteCoverage()} coverage gap${incompleteCoverage() === 1 ? '' : 's'}` : 'Primary coverage available';
  const mode = report.priorityMode === 'ai' ? 'ai' : 'deterministic';
  $('#reasoning-mode').textContent = mode === 'ai' ? 'Cloud-enhanced summary' : 'Evidence summary';
  $('#reasoning-mode').dataset.mode = mode;
}

function render() {
  if (!report) return;
  $('#summary').hidden = false;
  $('#host').textContent = report.page.hostname || report.page.url;
  const env = report.environment || report.page?.environment || { type: 'unknown', confidenceLabel: 'low', source: 'inferred' };
  $('#environment').value = env.source === 'user' ? env.type : 'auto';
  const envChip = $('#environment-state');
  envChip.textContent = env.source === 'user' ? env.type : `${env.type} · ${env.confidenceLabel || 'low'}`;
  envChip.dataset.tone = /high|certain/i.test(env.confidenceLabel || '') ? 'ok' : 'info';
  envChip.title = (env.signals || []).join(' · ') || 'Environment context';
  const quiet = report.findings.filter(f => f.lifecycle !== 'ignored' && f.frankVisible === false).length;
  $('#show-all').textContent = showAllChecks ? 'Show Frank only' : `Show all checks${quiet ? ` (${quiet})` : ''}`;

  renderOverviewOnly();
  renderLedger();
  coverage();
  renderResolved();
  renderSession();

  const wrap = $('#findings'); wrap.innerHTML = '';
  const labels = report.attention?.classLabels || {};
  for (const g of visibleGroups()) {
    const f = g.lead;
    const node = $('#card').content.cloneNode(true), card = node.querySelector('.finding');
    card.dataset.tone = f.frankPriority === 'blocker' || f.severity === 'critical' ? 'critical' : f.category === 'fix' ? 'warn' : 'info';

    const classChip = card.querySelector('.chip-class');
    classChip.textContent = labels[g.impactClass] || g.impactClass;
    classChip.dataset.tone = CLASS_TONE[g.impactClass] || 'info';

    const confidenceChip = card.querySelector('.chip-confidence');
    confidenceChip.textContent = f.confidence && f.confidence !== 'inconclusive' ? f.confidence : '';
    confidenceChip.dataset.tone = /confirmed|corroborated/.test(f.confidence || '') ? 'ok' : 'warn';

    const instanceChip = card.querySelector('.chip-instances');
    instanceChip.hidden = g.instanceCount < 2;
    instanceChip.textContent = `${g.instanceCount} instances`;

    card.querySelector('h2').textContent = g.title;
    card.querySelector('.detail').textContent = f.detail;
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
    card.querySelector('.ask-frank').onclick = () => startFrank(f, card);
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
      notice(`Ignored ${f.title} on this site.`);
    };
    wrap.appendChild(node);
  }

  if (!wrap.children.length) {
    const empty = document.createElement('div');
    empty.className = 'empty-findings';
    empty.innerHTML = classFilter ? '<b>Nothing in this area.</b>Select the area again to clear the filter.'
      : showAllChecks ? '<b>No findings in this filter.</b>The current scan did not return matching observations.'
      : incompleteCoverage() ? '<b>No confirmed issues in the current evidence.</b>Some checks were incomplete. That uncertainty is recorded in Scan coverage rather than turned into defects.'
      : '<b>Nothing material needs your attention.</b>Use Show all checks to inspect lower-priority observations.';
    wrap.appendChild(empty);
  }
}

/* ---------------- Frank walkthrough ---------------- */
function evidenceForStep(step) {
  if (!frank?.graph?.evidence) return [];
  const ids = new Set(step.evidenceRefs || []);
  return frank.graph.evidence.filter(e => ids.has(e.id));
}
function targetSelector(step) { return step?.targetId ? frank?.graph?.targets?.[step.targetId]?.selector || '' : ''; }

function renderFrankStep(index) {
  if (!frank) return;
  const total = frank.plan.steps.length;
  frank.index = Math.max(0, Math.min(total - 1, Number(index) || 0));
  const step = frank.plan.steps[frank.index];
  $('#frank-step-count').textContent = `${frank.index + 1} of ${total}`;
  $('#frank-progress-bar').style.width = `${((frank.index + 1) / total) * 100}%`;
  $('#frank-step-type').textContent = step.type;
  $('#frank-step-headline').textContent = step.headline;
  $('#frank-step-body').textContent = step.body;
  const metrics = $('#frank-metrics'); metrics.innerHTML = '';
  metrics.hidden = !(step.metrics || []).length;
  for (const row of step.metrics || []) { const dt = document.createElement('dt'), dd = document.createElement('dd'); dt.textContent = row.label; dd.textContent = row.value; metrics.append(dt, dd); }
  const code = $('#frank-code'); code.textContent = step.code || ''; code.hidden = !step.code;
  const sources = $('#frank-sources'); sources.innerHTML = '';
  for (const source of step.sourceLabels || []) { const span = document.createElement('span'); span.textContent = source; sources.appendChild(span); }
  const evidence = $('#frank-evidence > div'); evidence.innerHTML = '';
  for (const item of evidenceForStep(step)) {
    const article = document.createElement('article'), b = document.createElement('b'), p = document.createElement('p');
    b.textContent = `${item.source} · ${item.label}`;
    p.textContent = typeof item.value === 'string' ? item.value : JSON.stringify(item.value);
    article.append(b, p); evidence.appendChild(article);
  }
  $('#frank-evidence').hidden = !evidence.children.length;
  $('#frank-back').disabled = frank.index === 0;
  $('#frank-next').textContent = frank.index === total - 1 ? 'Done' : 'Next';
  $('#frank-preview').hidden = !(step.preview || {}).enabled;
  $('#frank-reset').hidden = true;
  $('#frank-copy-selector').hidden = !targetSelector(step);
  $('#frank-recheck').hidden = step.type !== 'verification';
}

function enterFrank() {
  document.body.dataset.mode = 'frank';
  $('#scanner-view').hidden = true; $('#frank-view').hidden = false;
  $('#host').textContent = report?.page?.hostname || 'Guided investigation';
  setTimeout(() => $('#frank-title').focus(), 0);
}
function leaveFrankLocal() {
  const returnFocus = frankReturnFocus; frankReturnFocus = null;
  frank = null; document.body.dataset.mode = '';
  $('#scanner-view').hidden = false; $('#frank-view').hidden = true;
  $('#host').textContent = report?.page?.hostname || report?.page?.url || 'Current page';
  $('#frank-action-state').hidden = true;
  setTimeout(() => returnFocus?.isConnected && returnFocus.focus(), 0);
}

async function startFrank(finding, card) {
  if (!report || !tab?.id) return actionState(card, 'Run a current scan before asking Frank.', 'error');
  const button = card.querySelector('.ask-frank');
  frankReturnFocus = button;
  button.disabled = true; button.textContent = 'Starting Frank';
  actionState(card, 'Preparing on-device reasoning and gathering verified evidence.');

  // Start Chrome built-in AI directly from the click gesture. If the model has
  // not been downloaded yet, Chrome may require this user activation.
  const localSessionPromise = beginLocalFrankSession({
    onDownloadProgress: ratio => actionState(card, `Preparing on-device AI · ${Math.round(ratio * 100)}%`, 'ok')
  });

  const prepared = await send({ type: 'PREPARE_FRANK', finding, report, tabId: tab.id }, 24000);
  if (!prepared.ok || !prepared.plan || !prepared.graph) {
    button.disabled = false; button.textContent = 'Ask Frank';
    frankReturnFocus = null;
    Promise.resolve(localSessionPromise).then(result => { try { result?.session?.destroy?.(); } catch {} }).catch(() => {});
    actionState(card, prepared.error || 'Frank could not prepare this finding.', 'error');
    if (prepared.diagnostic) showFailure(prepared, 'Frank could not prepare this finding.');
    return;
  }

  let plan = prepared.plan;
  let reasoning = { status: 'fallback', mode: 'deterministic', provider: 'deterministic', code: 'LOCAL_AI_UNAVAILABLE', message: 'On-device reasoning was not available, so Frank kept the verified deterministic guidance.' };
  const local = await resolveLocalFrankSession(localSessionPromise);
  if (local.ok && local.session) {
    try {
      plan = await localFrankWalkthrough({ session: local.session, graph: prepared.graph, deterministicPlan: prepared.plan });
      reasoning = { status: 'operational', mode: 'ai', provider: 'chrome-built-in', model: 'Chrome built-in model', location: 'device', message: 'Frank improved the verified guidance with on-device reasoning. Page evidence stayed on this device.' };
    } catch (error) {
      reasoning = { status: 'fallback', mode: 'deterministic', provider: 'chrome-built-in', code: error?.code || 'LOCAL_AI_FAILED', message: String(error?.message || "On-device reasoning did not pass Frank's evidence checks.").slice(0, 240) };
    } finally { try { local.session.destroy?.(); } catch {} }
  } else if (local?.message) {
    reasoning = { status: 'fallback', mode: 'deterministic', provider: 'chrome-built-in', code: local.code || 'LOCAL_AI_UNAVAILABLE', message: local.message };
  }

  if (plan.mode !== 'ai' && cloudAiFallback) {
    actionState(card, 'On-device reasoning unavailable. Trying the optional cloud fallback…', 'warn');
    const cloud = await send({ type: 'CLOUD_FRANK_PLAN', graph: prepared.graph }, 22000);
    if (cloud.ok && cloud.plan?.mode === 'ai') { plan = cloud.plan; reasoning = cloud.reasoning || { status: 'operational', mode: 'ai', provider: 'openai', location: 'cloud' }; }
    else if (cloud?.reasoning?.message) reasoning = { ...reasoning, message: `${reasoning.message} Cloud fallback: ${cloud.reasoning.message}`.slice(0, 240) };
  }

  const started = await send({ type: 'FRANK_START_PLAN', plan, graph: prepared.graph, tabId: prepared.tabId || tab.id }, 9000);
  button.disabled = false; button.textContent = 'Ask Frank';
  if (!started.ok) {
    frankReturnFocus = null;
    actionState(card, started.error || 'Frank could not start the walkthrough.', 'error');
    if (started.diagnostic) showFailure(started, 'Frank could not start the walkthrough.');
    return;
  }

  frank = { plan, graph: prepared.graph, tabId: prepared.tabId || tab.id, index: 0, finding, reasoning };
  enterFrank();
  $('#frank-title').textContent = frank.plan.title;
  $('#frank-summary').textContent = frank.plan.summary;
  const aiOperational = frank.plan.mode === 'ai' && frank.reasoning?.status === 'operational';
  const onDevice = aiOperational && frank.reasoning?.provider === 'chrome-built-in';
  $('#frank-mode').textContent = onDevice ? 'On-device reasoning' : aiOperational ? 'Cloud reasoning' : 'Verified guidance';
  $('#frank-mode').dataset.mode = aiOperational ? 'ai' : 'deterministic';
  $('#frank-mode').title = onDevice ? 'Frank used Chrome built-in AI on this device. The finding evidence was not sent to an AI provider.' : aiOperational ? 'Frank used the optional cloud AI fallback.' : (frank.reasoning?.message || 'Frank is using deterministic evidence-grounded guidance.');
  const a = frank.plan.assessment || {};
  $('#frank-assessment-status').textContent = a.status || 'review';
  $('#frank-assessment-statement').textContent = a.statement || '';
  $('#frank-assessment-limitations').textContent = a.limitations || '';
  $('#frank-assessment-limitations').hidden = !a.limitations;
  renderFrankStep(0);
  if (onDevice) notice('Frank is reasoning on this device. No metered AI request was used.', 'ok');
  else if (aiOperational) notice('Frank is using the optional metered cloud fallback.', 'warn');
  else notice(`Frank is using verified deterministic guidance${frank.reasoning?.message ? `: ${frank.reasoning.message}` : '.'}`, 'warn');
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
  if (frank) await endFrank();
  scanInFlight = true; classFilter = '';
  const button = $('#scan'); button.disabled = true; button.textContent = 'Scanning';
  clearDiagnostic(); notice('Inspecting the current page…');
  try {
    const r = await send(tab?.id ? { type: 'SCAN_TAB', tabId: tab.id } : { type: 'SCAN_ACTIVE' }, 20000);
    if (!r.ok) { showFailure(r, 'The page scan could not complete.'); return; }
    tab = r.tab; report = r.report;
    $('#new-count').textContent = 'Local scan';
    report.priorityBrief = 'Local evidence is ready. Connected context is still running.';
    render();
    const scanned = new Date(report.scannedAt || Date.now()).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    notice('Local checks complete. Verifying published state, monitored performance and standards context…');
    const enriched = await send({ type: 'ENRICH', report, tabId: tab?.id }, 32000);
    if (enriched.ok) {
      report = enriched.report;
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
    } else showFailure(enriched, 'Local scan completed, but connected context could not finish.');
    await updateWatch();
  } finally { scanInFlight = false; button.disabled = false; button.textContent = 'Rescan'; }
}

async function updateWatch() {
  const pageUrl = report?.page?.url || tab?.url;
  if (!pageUrl) return;
  let u; try { u = new URL(pageUrl); } catch { return; }
  const data = await chrome.storage.local.get({ watchedOrigins: [] });
  $('#watch').textContent = data.watchedOrigins.includes(u.origin) ? 'Watching site' : 'Watch this site';
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
$('#frank-back').onclick = () => gotoFrank((frank?.index || 0) - 1);
$('#frank-next').onclick = () => { if (!frank) return; if (frank.index >= frank.plan.steps.length - 1) endFrank(); else gotoFrank(frank.index + 1); };
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

chrome.runtime.onMessage.addListener(msg => {
  if (msg?.type === 'ACTION_INVOKED') { if (msg.tabId) tab = { ...(tab || {}), id: msg.tabId }; rescan(); }
  if (msg?.type === 'FRANK_STEP_CHANGED' && frank) renderFrankStep(msg.index);
  if (msg?.type === 'FRANK_CLOSED' && frank) { leaveFrankLocal(); notice('Frank session closed.'); }
});

loadSettings().finally(rescan);
