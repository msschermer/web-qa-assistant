globalThis.__WEBQA_BUILD_REVISION__="82e01fbe34fb";
import { localFrankRuntime, localFrankWalkthrough, probeLocalAi, setLocalAiTraceSink, localAiDiagnostics } from './local-ai.js';
import { presentFinding, presentArea, QA_AREA_ORDER } from './presentation.js';
import { RuntimeTrace, buildBugReport, bugReportPrivacySummary } from './bug-report.js';
import { limitedCoverageLabels as coverageLimitationLabels, isStaleBuildRevision, scopeCoverageNotes, buildCoverageAccounting } from './coverage.js';
import { SCAN_PHASE, resultReadyFromReport, scanProgressCopy, shouldRevealResults, emptyResultReady } from './scan-lifecycle.js';
import { formatInstanceCountLabel, shouldShowHighlightNav } from './compose.js';
const RELEASE_VERSION = '1.7.5';
const DEVELOPMENT_TARGET = '1.7.5';
function currentBuildRevision() {
  return String(globalThis.__WEBQA_BUILD_REVISION__ || '').trim();
}
function stampReportIdentity(next) {
  if (!next || typeof next !== 'object') return next;
  next.buildRevision = currentBuildRevision() || next.buildRevision || '';
  next.developmentTarget = DEVELOPMENT_TARGET;
  next.webqaVersion = RELEASE_VERSION;
  return next;
}
function limitedCoverageLabels(nextReport = report) {
  return coverageLimitationLabels(nextReport || {});
}
/** Historical monitor availability from monitor evidence — not from lab-owned coverage strings. */
function historicalMonitorAvailable(nextReport = report) {
  if (!nextReport) return false;
  const ctx = nextReport.context?.performance?.data
    || nextReport.context?.services?.performance?.data
    || nextReport.context?.performance
    || nextReport.performanceMonitor;
  if (ctx?.monitored === true || ctx?.available === true) return true;
  if ((nextReport.findings || []).some(f => /^performance\.(mobile|desktop)(-|$)/.test(String(f.ruleId || '')))) return true;
  // Without lab override, connector-complete coverage still means historical monitor.
  const cov = String(nextReport.coverage?.performance || '').trim();
  if (/^complete$/i.test(cov)) return true;
  return false;
}
const runtimeTrace = new RuntimeTrace();
setLocalAiTraceSink((type,data)=>runtimeTrace.record(`local-ai:${type}`,data));

let report = null, filter = 'all', tab = null, scanInFlight = false, frank = null, lastFrank = null,
    showAllChecks = false, lastDiagnostic = null, lastScanAttempt = null, siteSession = null, classFilter = '', cloudAiFallback = false, frankReturnFocus = null, frankRequestSeq = 0, pendingFrankCancel = null,
    scanPhase = SCAN_PHASE.IDLE, resultFlags = emptyResultReady(), staleResult = false;

const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const NOTICE_LABELS = { ok: 'Done', warn: 'Attention', error: 'Error' };

function notice(message, kind = 'info') {
  // Errors go to the assertive region so a failure is not announced with the
  // same urgency as "Scanning current page…". Both regions exist from first
  // paint; only their content changes.
  const target = $(kind === 'error' ? '#alert' : '#notice');
  const other = $(kind === 'error' ? '#notice' : '#alert');
  if (other) { other.textContent = ''; delete other.dataset.kind; }
  if (!target) return;
  const text = String(message || '');
  if (!text) { target.textContent = ''; delete target.dataset.kind; return; }
  const label = NOTICE_LABELS[kind] || '';
  target.innerHTML = (label ? `<b class="notice-label">${esc(label)}</b>` : '') + esc(text);
  if (kind && kind !== 'info') target.dataset.kind = kind;
  else delete target.dataset.kind;
}

let pendingAborts = [];

// Resolve every abortable in-flight send. The page may still finish its own
// requests; we stop waiting on them and record nothing from the run.
function abortPendingSends() {
  const list = pendingAborts;
  pendingAborts = [];
  for (const abort of list) abort();
}

function send(msg, timeoutMs = 25000, { abortable = false } = {}) {
  return new Promise(resolve => {
    let settled = false;
    const finish = value => { if (settled) return; settled = true; clearTimeout(timer); resolve(value); };
    const timer = setTimeout(() => finish({ ok: false, error: 'The extension action timed out.' }), timeoutMs);
    if (abortable) pendingAborts.push(() => finish({ ok: false, aborted: true, error: 'Scan stopped.' }));
    chrome.runtime.sendMessage(msg, response => {
      const runtimeError = chrome.runtime.lastError?.message;
      finish(response || { ok: false, error: runtimeError || 'No response from the extension service worker.' });
    });
  });
}

function applyScanProgress(msg = {}) {
  if (!scanInFlight) return;
  if (scanPhase === SCAN_PHASE.READY || scanPhase === SCAN_PHASE.FAILED) return;
  if (msg.phase === SCAN_PHASE.CORRELATING || msg.phase === SCAN_PHASE.FRANK_ANALYZING) {
    if (String(report?.coverage?.links || '') === 'pending' && scanPhase !== SCAN_PHASE.CORRELATING && scanPhase !== SCAN_PHASE.FRANK_ANALYZING) {
      return;
    }
  }
  if (msg.phase) scanPhase = msg.phase;
  const copy = scanProgressCopy(scanPhase, msg);
  notice(copy);
  const overview = $('#frank-overview');
  if (overview && overview.dataset.state === 'loading') {
    $('#judgment-title').textContent = copy;
    const brief = $('#brief');
    if (brief) brief.textContent = 'Results stay hidden until the scan finishes and scan guidance is composed.';
  }
}

chrome.runtime.onMessage.addListener((msg) => {
  if (msg?.type === 'SCAN_PROGRESS') applyScanProgress(msg);
});

function lockResultsUi() {
  document.body.dataset.scanning = 'true';
  delete document.body.dataset.resultReady;
  const newCount = $('#new-count');
  if (newCount) newCount.textContent = '';
}

function revealResultsUi() {
  document.body.dataset.resultReady = 'true';
  delete document.body.dataset.scanning;
}
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
  if (state.status === 'ready') return { text: 'On-device AI ready', tone: 'ok', title: 'Chrome on-device reasoning is ready.' };
  if (state.status === 'downloading') return { text: state.progress != null ? `Preparing on-device AI ${Math.round(state.progress * 100)}%` : 'Preparing on-device AI', tone: 'info', title: state.message };
  if (state.status === 'warming') return { text: 'On-device AI warming', tone: 'info', title: state.message };
  if (state.status === 'downloadable') return { text: 'On-device AI setup on first use', tone: 'info', title: state.message };
  if (state.status === 'unavailable') return { text: 'On-device AI unavailable', tone: 'warn', title: state.message };
  if (state.status === 'error') return { text: 'On-device AI needs retry', tone: 'warn', title: state.message };
  return { text: 'Checking on-device AI', tone: 'info', title: state.message || 'Checking Chrome on-device AI availability.' };
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
  // Only genuinely degraded areas — not expected scope limitations or inconclusive probes.
  return buildCoverageAccounting(report || {}).degradedAreas.length;
}
function targetBlocked() {
  return Boolean(report?.targetIntegrityBlocked || report?.page?.targetIntegrity === 'blocked' || report?.priorityMode === 'target-integrity');
}
function judgment() {
  if (targetBlocked()) return { state: 'unreachable', title: 'Page could not be reached' };
  const groups = report?.attention?.materialGroupCount || 0;
  // A confirmed broken link is exactly as urgent as a 'blocker'-severity finding
  // even when its own severity is only 'high' (a 404, not a 5xx) — visitors
  // cannot reach it either way, so it must not read as merely "worth addressing".
  const blockers = materialFindings().filter(f => f.frankPriority === 'blocker' || (f.impactClass === 'availability' && f.confidence === 'confirmed')).length;
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
    const toneWord = { critical: 'needs fixing', warn: 'needs review', ok: 'healthy', muted: 'informational' }[String(item.tone || 'muted')] || '';
    cell.setAttribute('aria-label', `${item.label}: ${item.count}${toneWord ? `, ${toneWord}` : ''}${item.lead ? ', first in recommended order' : ''}`);
    cell.onclick = () => { classFilter = classFilter === id ? '' : id; render(); };
    box.appendChild(cell);
  }
}

function coverage() {
  const box = $('#coverage'); box.innerHTML = '';
  let complete = 0, total = 0;
  for (const [key, value] of Object.entries(report.coverage || {})) {
    total++;
    // Accounted statuses that mean we measured something (not "not monitored" / "not applicable").
    if (/complete|deterministic|local-only|current-page|renderer|extension-partial|none[_-]?checked/i.test(String(value))) complete++;
    // Human rows below supersede these machine keys for the main coverage story.
    if (/^(performance|runtime|links|axe|browser)$/i.test(key)) continue;
    box.insertAdjacentHTML('beforeend', `<span>${esc(key)}</span><b data-status="${esc(String(value).toLowerCase().replace(/\s+/g, '-'))}">${esc(value)}</b>`);
  }
  const links = report.linkAudit;
  if (links) {
    const linkCov = String(report.coverage?.links || '');
    const attempted = Number(links.attempted ?? links.checked ?? 0);
    const eligible = Number(links.eligible ?? links.discovered ?? attempted);
    const unprobed = Number(links.unprobed || 0);
    const scannerAborted = Number(links.scannerAborted || 0);
    const linkDegraded = unprobed > 0 || scannerAborted > 0 || /unavailable/i.test(linkCov);
    const noEligible = attempted === 0 && eligible === 0 && unprobed === 0;
    const linkLine = noEligible
      ? 'No probeable HTTP links on this page'
      : (eligible > attempted || unprobed > 0
        ? `${attempted} of ${eligible} eligible checked · ${links.verifiedHealthy || 0} healthy · ${links.confirmedIssues || 0} broken · ${links.inconclusive || 0} inconclusive · ${unprobed} unprobed`
        : `${attempted} checked · ${links.verifiedHealthy || 0} healthy · ${links.confirmedIssues || 0} broken · ${links.inconclusive || 0} inconclusive`);
    box.insertAdjacentHTML('beforeend', `<span>Links</span><b data-status="${linkDegraded ? 'partial' : 'complete'}">${esc(linkLine)}</b>`);
  }
  const perf = report.browserPerformance;
  if (perf?.available) box.insertAdjacentHTML('beforeend', `<span>this page, in this browser</span><b>${esc(perf.largestContentfulPaintMs != null ? `LCP ${(perf.largestContentfulPaintMs / 1000).toFixed(1)}s` : `TTFB ${perf.ttfbMs}ms`)}</b>`);

  const ix = report.interactionCoverage;
  if (ix && (ix.candidates > 0 || ix.safelyTested > 0 || ix.skippedUnsafe > 0 || ix.skippedIneligible > 0 || ix.skippedSafetyPolicy > 0)) {
    const tested = Number(ix.safelyTested || ix.tested || 0);
    const eligible = Number(ix.eligible ?? 0);
    const passed = Number(ix.passed || 0);
    const needReview = Number(ix.inconclusive || 0) + Number(ix.failed || 0);
    const skipped = Number(ix.skippedUnsafe || 0) + Number(ix.skippedIneligible || 0) + Number(ix.skippedSafetyPolicy || 0);
    const line = `${tested} of ${eligible || tested} safely tested · ${passed} passed · ${needReview} need review · ${skipped} skipped for safety`;
    const ixDegraded = Boolean(
      ix.restorationFailures
      || /restoration-unproven|prepare-failed/i.test(String(ix.partialReason || ''))
    );
    box.insertAdjacentHTML('beforeend', `<span>Interactions</span><b data-status="${ixDegraded ? 'partial' : 'complete'}">${esc(line)}</b>`);
  }
  const embed = report.page?.embeddedCoverage;
  if (embed && (embed.sameOriginFramesChecked > 0 || embed.crossOriginFramesNotInspectable > 0 || embed.crossOriginIframes > 0 || embed.frameBudgetExceeded)) {
    const so = Number(embed.sameOriginFramesChecked || 0);
    const xo = Number(embed.crossOriginFramesNotInspectable || embed.crossOriginIframes || 0);
    const embedDegraded = embed.frameBudgetPreventedCoverage === true
      || Number(embed.sameOriginUnprobed || 0) > 0;
    box.insertAdjacentHTML('beforeend', `<span>Embedded content</span><b data-status="${embedDegraded ? 'partial' : 'complete'}">${esc(`${so} same-origin checked · ${xo} cross-origin not inspectable`)}</b>`);
  }
  const perfCov = String(report.coverage?.performance || '');
  if (perf?.available || /current-page|partial|not monitored|unavailable|local-only|complete/i.test(perfCov)) {
    const labLine = perf?.available
      ? 'Current-page lab observations available'
      : (/partial/i.test(perfCov) ? 'Current-page lab observations partial' : 'Current-page lab observations unavailable');
    // Historical monitor from monitor evidence — never infer from lab-owned coverage.performance === current-page.
    const histAvailable = historicalMonitorAvailable(report);
    const histLine = histAvailable ? 'Historical monitor available' : 'Historical monitor unavailable';
    // Lab row status only — historical monitor absence is scope metadata, not degradation.
    const labDegraded = !perf?.available || (/partial|unavailable|pending/i.test(perfCov) && !/current-page/i.test(perfCov));
    const rowStatus = labDegraded ? 'partial' : 'complete';
    box.insertAdjacentHTML('beforeend', `<span>Performance</span><b data-status="${rowStatus}">${esc(`${labLine} · ${histLine}`)}</b>`);
  }
  const runtime = String(report.coverage?.runtime || '');
  const runtimeScope = String(report.coverageScope?.runtime || '');
  if (runtime) {
    const runtimeLine = /renderer/i.test(runtime)
      ? 'Renderer session capture'
      : (/not applicable/i.test(runtime)
        ? 'Not applicable'
        : (runtimeScope === 'post-injection-extension' || /extension-partial/i.test(runtime)
          ? 'Complete (post-injection scope)'
          : (/partial|unavailable/i.test(runtime) ? runtime : 'Complete')));
    const runtimeDegraded = /partial|unavailable/i.test(runtime) && !/extension-partial/i.test(runtime);
    box.insertAdjacentHTML('beforeend', `<span>Runtime</span><b data-status="${runtimeDegraded ? 'partial' : 'complete'}">${esc(runtimeLine)}</b>`);
  }

  $('#coverage-summary').textContent = `${complete}/${total} accounted`;

  const notes = $('#coverage-notes'); notes.innerHTML = '';
  if (perf?.available) notes.insertAdjacentHTML('beforeend', `<b>Current-page performance is a lab measurement.</b><span>Measured on this machine and network, so it shows direction rather than a field score. Monitored history is the source for regression claims.</span>`);
  for (const note of scopeCoverageNotes(report)) {
    notes.insertAdjacentHTML('beforeend', `<b>Coverage scope.</b><span>${esc(note)}</span>`);
  }
  if (String(report.coverage?.runtime) === 'renderer') notes.insertAdjacentHTML('beforeend', `<b>Renderer runtime coverage is count-only.</b><span>Uncaught errors are recorded as a count. Error text is untrusted and is not treated as instructions.</span>`);
  if (ix && ix.safelyTested > 0) {
    const eligible = Number(ix.eligible ?? 0);
    const tested = Number(ix.safelyTested || 0);
    const sideFx = ix.sideEffectLimitation
      ? ' Allowlisted activation may still run page handlers (fetch, analytics, navigation).'
      : ' Allowlisted clicks can still run page handlers.';
    if (eligible > tested) notes.insertAdjacentHTML('beforeend', `<b>Lumen safely tested ${esc(tested)} of ${esc(eligible)} eligible controls.</b><span>Skipped or budget-limited controls are coverage limits, not proof that remaining controls work.${sideFx}</span>`);
    else notes.insertAdjacentHTML('beforeend', `<b>Lumen safely tested ${esc(tested)} eligible control${tested === 1 ? '' : 's'}.</b><span>Forms, navigation, purchases, and high-risk actions are never activated.${sideFx}</span>`);
  }
  if (ix?.restorationFailures) notes.insertAdjacentHTML('beforeend', `<b>Interaction testing stopped after restoration could not be verified.</b><span>Later controls were not activated to avoid leaving the page in an altered state.</span>`);
  if (links?.inconclusive) {
    notes.insertAdjacentHTML('beforeend', `<b>${esc(links.inconclusive)} destination${links.inconclusive === 1 ? '' : 's'} could not be independently verified.</b><span>These were not counted as broken links.</span>`);
    const rows = (links.incompleteChecks || []).slice(0, 8);
    if (rows.length) {
      const ul = document.createElement('ul');
      for (const row of rows) { const li = document.createElement('li'); li.textContent = `${row.path || row.url}${row.reason ? ` (${row.reason})` : ''}`; ul.appendChild(li); }
      notes.appendChild(ul);
    }
  }
  if (Number(links?.unprobed || 0) > 0) {
    notes.insertAdjacentHTML('beforeend', `<b>${esc(links.unprobed)} eligible link${links.unprobed === 1 ? '' : 's'} were not probed.</b><span>The probe budget or candidate limit was reached before every eligible destination could be attempted.</span>`);
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

// Coverage as the panel currently shows it. Exporting findings without the
// limitations that qualify them reads as a complete audit when it is not.
function coverageExportLines() {
  const rows = [...($('#coverage')?.children || [])];
  const pairs = [];
  for (let i = 0; i < rows.length - 1; i += 2) {
    if (rows[i].tagName === 'SPAN' && rows[i + 1].tagName === 'B') {
      pairs.push([rows[i].textContent.trim(), rows[i + 1].textContent.trim()]);
    }
  }
  const notes = [];
  let current = null;
  for (const node of [...($('#coverage-notes')?.children || [])]) {
    if (node.tagName === 'B') { current = { title: node.textContent.trim(), detail: '', items: [] }; notes.push(current); }
    else if (node.tagName === 'SPAN' && current) current.detail = node.textContent.trim();
    else if (node.tagName === 'UL' && current) current.items = [...node.children].map(li => li.textContent.trim());
  }
  const summary = ($('#coverage-summary')?.textContent || '').trim();
  if (!pairs.length && !notes.length && !summary) return [];

  const lines = ['## Coverage and limitations', ''];
  if (summary) lines.push(`Accounted: ${summary}`, '');
  for (const [label, value] of pairs) lines.push(`- ${label}: ${value}`);
  if (pairs.length) lines.push('');
  for (const note of notes) {
    lines.push(`**${note.title}** ${note.detail}`.trim());
    for (const item of note.items) lines.push(`- ${item}`);
    lines.push('');
  }
  return lines;
}

function markdown() {
  const groups = visibleGroups();
  const scannedAt = report.scannedAt ? new Date(report.scannedAt) : null;
  const scannedLine = scannedAt && !Number.isNaN(scannedAt.getTime())
    ? `Scanned: ${scannedAt.toLocaleString()}`
    : 'Scanned: time not recorded';
  const lines = [`# Lumen report`, '', report.page.url, '', scannedLine, `Environment: ${report.environment?.type || 'unknown'} (${report.environment?.confidenceLabel || 'unconfirmed'})`, '', '## Assessment', report.priorityBrief || '', ''];
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
  lines.push(...coverageExportLines());
  return lines.join('\n');
}

function issueText(g) {
  const f = g.lead;
  return [
    `Lumen issue: ${g.title}`,
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
    `Acceptance: Start a new scan or use Recheck and confirm the finding no longer reproduces.`
  ].filter(Boolean).join('\n');
}

function findingContext(f) {
  const parts = [];
  if (f.link?.text) parts.push(`“${f.link.text}”`);
  if (f.link?.location) parts.push(f.link.location);
  if (f.link?.prominence && f.link.prominence !== 'normal') parts.push(f.link.prominence);
  if (f.imageMetrics?.isLcpResource) parts.push('current LCP image');
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

function renderPerformanceCard() {
  const section = $('#performance-card');
  const assessment = report?.performanceAssessment || report?.environment?.performanceAssessment;
  if (!section) return;
  if (!assessment || assessment.status === 'insufficient-data') {
    section.hidden = true;
    return;
  }
  section.hidden = false;
  const statusLabel = ({
    healthy: 'Healthy',
    'mostly-healthy': 'Mostly healthy',
    'needs-attention': 'Needs attention',
    poor: 'Poor',
    'insufficient-data': 'Insufficient data'
  })[assessment.status] || 'Insufficient data';
  const statusEl = $('#performance-status');
  statusEl.textContent = statusLabel;
  statusEl.dataset.tone = assessment.status || '';
  const metrics = $('#performance-metrics');
  metrics.innerHTML = '';
  const m = assessment.metrics || {};
  const ratingText = (r) => ({ good: 'Good', 'needs-attention': 'Needs attention', elevated: 'Elevated', poor: 'Poor', slow: 'Slow' })[r] || r;
  const primary = [];
  if (m.lcp?.measured) primary.push(['LCP', `${(m.lcp.valueMs / 1000).toFixed(2)}s`, m.lcp.rating]);
  if (m.fcp?.measured) primary.push(['FCP', `${(m.fcp.valueMs / 1000).toFixed(2)}s`, m.fcp.rating]);
  if (m.cls?.measured) primary.push(['CLS', String(m.cls.value), m.cls.rating]);
  if (m.pageLoad?.measured) primary.push(['Page load', `${(m.pageLoad.valueMs / 1000).toFixed(2)}s`, '']);
  for (const [key, value, rating] of primary) {
    const ratingCell = rating
      ? `<dd class="rating" data-tone="${esc(rating)}">${esc(ratingText(rating))}</dd>`
      : '<dd class="rating" data-tone="diagnostic"></dd>';
    metrics.insertAdjacentHTML('beforeend', `<dt>${esc(key)}</dt><dd>${esc(value)}</dd>${ratingCell}`);
  }
  const diagWrap = $('#performance-diagnostics');
  const diagMetrics = $('#performance-diagnostic-metrics');
  if (diagWrap && diagMetrics) {
    diagMetrics.innerHTML = '';
    // Show Diagnostics only when TTFB is elevated/slow — a "good" TTFB under
    // "Diagnostics" reads as a problem signal.
    const showTtfbDiag = m.ttfb?.measured && m.ttfb.rating && m.ttfb.rating !== 'good' && m.ttfb.rating !== 'unavailable';
    if (showTtfbDiag) {
      diagWrap.hidden = false;
      const tone = m.ttfb.rating === 'slow' ? 'slow' : m.ttfb.rating;
      diagMetrics.insertAdjacentHTML('beforeend',
        `<dt>Server response (TTFB)</dt><dd>${esc(`${(m.ttfb.valueMs / 1000).toFixed(2)}s`)}</dd><dd class="rating" data-tone="${esc(tone)}">${esc(ratingText(tone))}</dd>`);
    } else {
      diagWrap.hidden = true;
    }
  }
  let images = 'No image-delivery issue was detected in the measurements available to this scan.';
  if (assessment.imageDelivery?.assessment === 'issues-detected') {
    images = assessment.imageDelivery.oversizedCount
      ? `${assessment.imageDelivery.oversizedCount} oversized image${assessment.imageDelivery.oversizedCount === 1 ? '' : 's'} detected`
      : 'Image delivery issues detected';
  } else if (assessment.imageDelivery?.assessment === 'not-enough-data' || assessment.imageDelivery?.assessment === 'incomplete') {
    images = 'Not enough image-delivery timing evidence was available.';
  }
  $('#performance-images').textContent = `Images · ${images}`;
  $('#performance-blurb').textContent = assessment.summary || '';
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
  const scannedAt = report.scannedAt ? new Date(report.scannedAt) : null;
  const scanTime = $('#scan-time');
  if (scanTime) {
    scanTime.textContent = scannedAt && !Number.isNaN(scannedAt.getTime())
      ? `Scanned ${scannedAt.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`
      : '';
  }
  const staleFlag = $('#stale-flag');
  if (staleFlag) staleFlag.hidden = !staleResult;
  const mode = blocked ? 'integrity' : report.priorityMode === 'ai' ? 'ai' : 'deterministic';
  $('#reasoning-mode').textContent = blocked ? 'Coverage limited' : mode === 'ai' ? 'Cloud reasoning' : 'Evidence-backed assessment';
  $('#reasoning-mode').dataset.mode = mode;
}

function render() {
  if (!report) return;
  if (scanInFlight && !shouldRevealResults({
    phase: scanPhase,
    flags: resultFlags
  })) {
    return;
  }
  try {
    renderUnsafe();
  } catch (error) {
    runtimeTrace.record('sidepanel-render-failed', {
      stage: 'result-render',
      code: 'SIDEPANEL_RENDER_FAILED',
      operation: 'RENDER',
      recoverable: true,
      coverageImpact: 'none'
    });
    notice('Scan evidence is available, but the results panel hit a display error. Try New scan, or use Report Bug.', 'warn');
    try {
      document.body.dataset.hasReport = 'true';
      $('#summary').hidden = false;
      $('#idle-state').hidden = true;
      if (report?.page) $('#host').textContent = report.page.hostname || report.page.url || '';
      renderOverviewOnly();
    } catch {}
  }
}

function renderUnsafe() {
  document.body.dataset.hasReport = 'true';
  $('#summary').hidden = false;
  $('#idle-state').hidden = true;
  $('#host').textContent = report.page.hostname || report.page.url;
  const env = report.environment || report.page?.environment || { type: 'unknown', confidenceLabel: 'low', source: 'auto' };
  const envManual = env.source === 'manual' || env.source === 'user';
  $('#environment').value = envManual ? (env.type === 'development' ? 'development' : env.type) : 'auto';
  const envChip = $('#environment-state');
  envChip.textContent = envManual ? env.type : `${env.type} · ${env.confidenceLabel || 'low'}`;
  envChip.dataset.tone = /high|certain|confirmed/i.test(env.confidenceLabel || '') ? 'ok' : 'info';
  envChip.title = (env.signals || []).join(' · ') || 'Environment context';
  const envNotice = env.notice || null;
  const noticeEl = $('#environment-notice');
  if (envNotice && envNotice.kind !== 'production-index-blocked') {
    noticeEl.hidden = false;
    noticeEl.dataset.tone = envNotice.tone || 'info';
    noticeEl.replaceChildren();
    const kicker = document.createElement('span');
    kicker.className = 'env-kicker';
    kicker.textContent = envNotice.kicker || '';
    const title = document.createElement('strong');
    title.textContent = envNotice.title || '';
    const body = document.createElement('p');
    body.textContent = envNotice.body || '';
    noticeEl.append(kicker, title, body);
    if (envNotice.extra) {
      const extra = document.createElement('p');
      extra.className = 'env-extra';
      extra.textContent = envNotice.extra;
      noticeEl.append(extra);
    }
    const launchItems = (env.launchReadiness?.items || []).slice(0, 6);
    if (launchItems.length) {
      const list = document.createElement('ul');
      list.className = 'launch-readiness';
      for (const item of launchItems) {
        const li = document.createElement('li');
        const cat = document.createElement('span');
        cat.className = 'launch-cat';
        cat.textContent = item.category || '';
        li.append(cat, document.createTextNode(` ${item.title || ''}`));
        list.append(li);
      }
      noticeEl.append(list);
    }
  } else {
    noticeEl.hidden = true;
    noticeEl.replaceChildren();
    delete noticeEl.dataset.tone;
  }
  const quiet = report.findings.filter(f => f.lifecycle !== 'ignored' && f.frankVisible === false).length;
  const showAll = $('#show-all');
  showAll.textContent = showAllChecks ? 'Recommended only' : `Show all checks${quiet ? ` (${quiet})` : ''}`;
  showAll.setAttribute('aria-pressed', String(showAllChecks));

  renderPerformanceCard();
  renderOverviewOnly();
  renderLedger();
  coverage();
  renderResolved();
  renderSession();

  const wrap = $('#findings'); wrap.innerHTML = '';
  const shownGroups = visibleGroups();
  const status = $('#findings-status');
  if (status) {
    const total = Number(report.attention?.materialGroupCount || shownGroups.length);
    status.textContent = shownGroups.length === total
      ? `Showing ${shownGroups.length} finding${shownGroups.length === 1 ? '' : 's'}.`
      : `Showing ${shownGroups.length} of ${total} findings.`;
  }
  for (const g of shownGroups) {
    const f = g.lead;
    const presentation = presentFinding({ ...f, impactClass: g.impactClass }, env);
    const node = $('#card').content.cloneNode(true), card = node.querySelector('.finding');
    card.dataset.tone = f.frankPriority === 'blocker' || f.severity === 'critical' || f.severity === 'high' ? 'critical' : f.category === 'fix' ? 'warn' : 'info';
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
    const instanceCount = Number(g.instanceCount || 1);
    instanceChip.hidden = instanceCount < 2;
    instanceChip.textContent = formatInstanceCountLabel(instanceCount);

    const groupedTitle = g.size > 1 && /image-oversized|blank-opener|color-contrast|link-in-text-block/.test(String(f.ruleId || ''));
    card.querySelector('h3').textContent = groupedTitle
      ? (g.title || presentation.title)
      : (g.size > 1 ? `${presentation.title} (${formatInstanceCountLabel(instanceCount)})` : presentation.title);
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
    const groupRows = g.instances || [f];
    if (g.instanceCount > 1 && groupRows.length) {
      instances.hidden = false;
      card.querySelector('.instances-label').textContent = `Show ${groupRows.length} affected element${groupRows.length === 1 ? '' : 's'}`;
      const list = card.querySelector('.instance-list');
      list.innerHTML = '';
      groupRows.forEach((row, i) => {
        const li = document.createElement('li');
        li.className = 'instance-row';
        const code = document.createElement('code');
        code.textContent = row.selector || row.target?.stableLocator || `(instance ${i + 1})`;
        li.appendChild(code);
        // Gateway-confirmed external link findings (safe-probe.js) never carry a
        // pre-registered targetId — there's no live DOM at probe time, only a
        // CSS selector captured when the candidate was queued. resolveTarget()
        // already falls back to plain selector resolution when targetId is
        // empty, so requiring targetId here was hiding Highlight for exactly
        // the broken-link findings most worth pointing at.
        const canHighlight = row?.targetType === 'visual' && (row?.targetId || row?.selector) && row?.target?.status !== 'stale';
        if (canHighlight) {
          const btn = document.createElement('button');
          btn.type = 'button';
          btn.className = 'instance-highlight btn btn-quiet';
          btn.textContent = 'Highlight';
          btn.onclick = async () => {
            card.dataset.highlightIndex = String(i);
            await spotlightFinding(card, row, groupRows, i);
          };
          li.appendChild(btn);
        }
        const frankBtn = document.createElement('button');
        frankBtn.type = 'button';
        frankBtn.className = 'instance-frank btn btn-text';
        frankBtn.textContent = 'Walk through';
        frankBtn.onclick = () => startFrank(row, card, frankBtn, { instances: groupRows, selectedInstanceId: row.id, groupTitle: g.title });
        li.appendChild(frankBtn);
        list.appendChild(li);
      });
    }

    const highlight = card.querySelector('.highlight');
    const highlightNav = card.querySelector('.highlight-nav');
    const highlightables = groupRows.filter(row => row?.targetType === 'visual' && (row?.targetId || row?.selector) && row?.target?.status !== 'stale');
    const highlightLead = highlightables[0] || null;
    highlight.hidden = !highlightLead;
    if (highlightNav) highlightNav.hidden = !shouldShowHighlightNav(highlightables.length);
    const setHighlightIndex = (idx) => {
      const n = highlightables.length || 1;
      const next = ((idx % n) + n) % n;
      card.dataset.highlightIndex = String(next);
      const label = card.querySelector('.highlight-index');
      if (label) label.textContent = highlightables.length > 1 ? `${next + 1} of ${highlightables.length}` : '';
      return next;
    };
    setHighlightIndex(Number(card.dataset.highlightIndex || 0));
    highlight.onclick = async () => {
      const idx = setHighlightIndex(Number(card.dataset.highlightIndex || 0));
      await spotlightFinding(card, highlightables[idx] || f, highlightables, idx);
    };
    card.querySelector('.highlight-prev')?.addEventListener('click', async () => {
      const idx = setHighlightIndex(Number(card.dataset.highlightIndex || 0) - 1);
      await spotlightFinding(card, highlightables[idx] || f, highlightables, idx);
    });
    card.querySelector('.highlight-next')?.addEventListener('click', async () => {
      const idx = setHighlightIndex(Number(card.dataset.highlightIndex || 0) + 1);
      await spotlightFinding(card, highlightables[idx] || f, highlightables, idx);
    });
    const askFrank = card.querySelector('.ask-frank');
    askFrank.onclick = () => startFrank(f, card, askFrank, { instances: groupRows, selectedInstanceId: f.id, groupTitle: g.title });
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
      : targetBlocked() ? '<b>No page findings to prioritize.</b> The page could not be reached, so page QA never ran. This is a coverage limit, not a clean result.'
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
  $('#frank-progress-bar').style.transform = `scaleX(${progressPct / 100})`;
  const track = $('#frank-progress-track');
  if (track) { track.setAttribute('aria-valuenow', String(progressPct)); track.setAttribute('aria-valuetext', `Step ${frank.index + 1} of ${total}`); }
  const STEP_ROLE = { spotlight: 'Locate', evidence: 'Checks', interpretation: 'Interpret', comparison: 'Compare', trend: 'History', impact: 'Impact', remediation: 'Fix', verification: 'Verify', summary: 'Summary' };
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

async function spotlightFinding(card, target, rows = [], idx = 0) {
  if (!target?.targetId && !target?.selector) {
    actionState(card, 'The affected element changed after the scan. Recheck this issue to refresh its target.', 'error');
    return false;
  }
  const r = await send({ type: 'HIGHLIGHT', targetId: target.targetId, selector: target.selector, ruleId: target.ruleId, tabId: tab?.id }, 8000);
  const ok = r.ok && r.found;
  const stale = r.targetStatus === 'stale' || (!ok && r.reason);
  const multi = rows.length > 1 ? ` ${idx + 1} of ${rows.length}.` : '';
  actionState(
    card,
    ok ? `Highlighted the exact affected element.${multi}` : (stale ? (r.reason || 'The affected element changed after the scan. Recheck this issue to refresh its target.') : (r.error || 'The element is no longer present.')),
    ok ? 'ok' : 'error'
  );
  return ok;
}

async function startFrank(finding, card, triggerButton = null, extra = {}) {
  if (!report || !tab?.id) return actionState(card, 'Run a current scan before starting a walkthrough.', 'error');
  pendingFrankCancel?.();
  const button = triggerButton || card?.querySelector?.('.ask-frank') || null;
  const requestId = ++frankRequestSeq, pageUrl = report.page?.url || tab.url, tabId = tab.id;
  runtimeTrace.record('frank_review_requested', { ruleId: finding.ruleId, impactClass: finding.impactClass, confidence: finding.confidence });
  if (report) {
    report.frankReview = {
      ...(report.frankReview || {}),
      modelReadiness: localFrankRuntime.snapshot()?.status || report.frankReview?.modelReadiness || 'unavailable',
      requested: true,
      started: false,
      completed: false,
      source: 'none',
      reason: 'requested'
    };
  }
  frankReturnFocus = button;
  if (button) { button.disabled = true; button.textContent = button.classList.contains('linkish') ? 'Preparing…' : 'Preparing guide'; }

  let cancelled = false, cancelResolve, verifiedResolve;
  const cancelPromise = new Promise(resolve => { cancelResolve = resolve; });
  const verifiedChoice = new Promise(resolve => { verifiedResolve = resolve; });
  const resetButton = () => {
    if (!button) return;
    button.disabled = false;
    button.textContent = button.classList.contains('linkish') ? (finding.title || finding.ruleId || 'Walk through') : 'Walk through';
  };
  const cancelThisRequest = () => {
    if (cancelled) return;
    cancelled = true; cancelResolve({ type: 'cancelled' });
    resetButton();
    if (card?.isConnected) actionState(card, 'Walkthrough preparation was cancelled because the page or selected finding changed.', 'warn');
    else notice('Walkthrough preparation was cancelled because the page or selected finding changed.', 'warn');
  };
  pendingFrankCancel = cancelThisRequest;

  const showPreparing = state => {
    if (cancelled || !currentRequest(requestId, pageUrl, tabId)) return;
    const pct = state.progress != null ? ` · ${Math.round(state.progress * 100)}%` : '';
    const message = state.status === 'downloading'
      ? `Preparing on-device AI${pct}. You can keep reviewing the scan; this finding will open automatically when on-device AI is ready.`
      : 'Loading on-device AI. You can keep reviewing the scan; this finding will open automatically when on-device AI is ready.';
    actionState(card, message, 'ok', {
      persistent: true,
      actionLabel: 'Use verified guidance now',
      onAction: () => verifiedResolve({ type: 'verified' })
    });
  };
  const unsubscribe = localFrankRuntime.subscribe(state => {
    if (['downloading', 'warming', 'downloadable'].includes(state.status)) showPreparing(state);
    else if (state.status === 'ready' && !cancelled && currentRequest(requestId, pageUrl, tabId)) actionState(card, 'On-device AI is ready. Building an evidence-grounded explanation…', 'ok', { persistent: true });
  });

  // This call is deliberately synchronous with the Walk through click so Chrome
  // can use the user activation to trigger first-use model preparation.
  const readinessPromise = localFrankRuntime.activateFromGesture();
  showPreparing(localFrankRuntime.snapshot());

  const preparedPromise = send({ type: 'PREPARE_FRANK', finding, report, tabId, instances: extra.instances || [], selectedInstanceId: extra.selectedInstanceId || finding.id, groupTitle: extra.groupTitle || finding.title }, 24000);
  const prepared = await Promise.race([preparedPromise, cancelPromise]);
  if (prepared?.type === 'cancelled' || cancelled || !currentRequest(requestId, pageUrl, tabId)) {
    unsubscribe(); if (pendingFrankCancel === cancelThisRequest) pendingFrankCancel = null; return;
  }
  if (!prepared.ok || !prepared.plan || !prepared.graph) {
    unsubscribe(); resetButton(); frankReturnFocus = null;
    if (pendingFrankCancel === cancelThisRequest) pendingFrankCancel = null;
    actionState(card, prepared.error || 'Could not prepare this finding for a walkthrough.', 'error');
    if (prepared.diagnostic) showFailure(prepared, 'Could not prepare this finding for a walkthrough.');
    return;
  }

  runtimeTrace.record('frank_review_started', { ruleId: finding.ruleId });
  if (report?.frankReview) report.frankReview.started = true;

  let plan = prepared.plan;
  let reasoning = { status: 'fallback', mode: 'deterministic', provider: 'deterministic', code: 'LOCAL_AI_UNAVAILABLE', message: 'Using verified deterministic guidance.' };
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
    reasoning = { status: 'fallback', mode: 'deterministic', provider: 'deterministic', code: 'USER_CHOSE_VERIFIED', message: 'You chose verified guidance while Chrome continues preparing on-device AI in the background.' };
  } else if (readiness?.result?.ok && localFrankRuntime.snapshot().status === 'ready') {
    let taskSession = null;
    try {
      taskSession = await localFrankRuntime.cloneTask();
      plan = await localFrankWalkthrough({ session: taskSession, graph: prepared.graph, deterministicPlan: prepared.plan });
      reasoning = { status: 'operational', mode: 'ai', provider: 'chrome-built-in', model: 'Chrome built-in model', location: 'device', message: 'On-device reasoning improved the verified guidance with an isolated session. Page evidence stayed on this device.' };
      runtimeTrace.record('frank-reasoning', { status: reasoning.status, provider: reasoning.provider, mode: reasoning.mode });
    } catch (error) {
      reasoning = { status: 'fallback', mode: 'deterministic', provider: 'chrome-built-in', code: error?.code || 'LOCAL_AI_FAILED', message: String(error?.message || 'On-device reasoning did not pass evidence checks.').slice(0, 240) };
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
    unsubscribe(); cancelThisRequest(); actionState(card, 'The inspected page changed while the walkthrough was preparing. Walk through the current scan instead.', 'warn'); return;
  }

  const source = plan.guidanceSource || (plan.mode === 'ai' ? 'frank-model' : 'deterministic');
  if (source === 'frank-model') runtimeTrace.record('frank_review_completed', { source, ruleId: finding.ruleId });
  else runtimeTrace.record('frank_review_fallback', { source, ruleId: finding.ruleId, code: reasoning?.code || '' });
  if (report) {
    report.frankReview = {
      modelReadiness: localFrankRuntime.snapshot()?.status || 'unavailable',
      requested: true,
      started: true,
      completed: true,
      failed: source !== 'frank-model' && Boolean(reasoning?.code && reasoning.code !== 'USER_CHOSE_VERIFIED'),
      skipped: reasoning?.code === 'USER_CHOSE_VERIFIED',
      source,
      reason: source === 'frank-model' ? 'model-review' : (reasoning?.code || 'deterministic-fallback'),
      failureReason: source === 'frank-model' ? '' : String(reasoning?.message || '').slice(0, 240),
      completedAt: new Date().toISOString()
    };
  }

  const started = await send({ type: 'FRANK_START_PLAN', plan, graph: prepared.graph, reasoning, tabId: prepared.tabId || tabId }, 9000);
  unsubscribe(); resetButton();
  if (pendingFrankCancel === cancelThisRequest) pendingFrankCancel = null;
  if (!started.ok) {
    frankReturnFocus = null;
    actionState(card, started.error || 'Could not start the walkthrough.', 'error');
    if (started.diagnostic) showFailure(started, 'Could not start the walkthrough.');
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
      buildRevision: currentBuildRevision(),
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
    const aiOperationalFail = frank.plan.mode === 'ai' && frank.plan.guidanceSource === 'frank-model' && frank.reasoning?.status === 'operational';
    const onDeviceFail = aiOperationalFail && frank.reasoning?.provider === 'chrome-built-in';
    const downloading = /downloading|warming|downloadable/i.test(String(document.body.dataset.frankReadiness || ''));
    $('#frank-mode').textContent = onDeviceFail ? 'On-device reasoning' : aiOperationalFail ? 'Cloud reasoning' : 'Evidence-backed guidance';
    $('#frank-mode').dataset.mode = aiOperationalFail ? 'ai' : 'deterministic';
    if (downloading && !aiOperationalFail) {
      notice('On-device AI is downloading. Evidence-backed guidance is shown in the meantime.', 'info');
    }
    renderFrankStep(0);
    notice('Walkthrough opened here in the side panel: the page workspace could not be saved, so the page takeover was skipped. The evidence and steps are the same.', 'warn');
    return;
  }

  frank = { plan, graph: prepared.graph, tabId: prepared.tabId || tabId, index: 0, finding, reasoning, planValid: true };
  lastFrank = frank;
  const aiOperational = frank.plan.mode === 'ai' && frank.plan.guidanceSource === 'frank-model' && frank.reasoning?.status === 'operational';
  const onDevice = aiOperational && frank.reasoning?.provider === 'chrome-built-in';
  // Cost-control / mode notice is recorded in the runtime trace; the panel closes immediately after.
  if (onDevice) runtimeTrace.record('frank-focus-mode', { message: 'No metered AI request was used' });
  else if (aiOperational) runtimeTrace.record('frank-focus-mode', { message: 'Optional metered cloud fallback' });
  else runtimeTrace.record('frank-focus-mode', { message: 'Verified guidance', guidanceSource: frank.plan.guidanceSource || 'deterministic' });
  // Preferred UX: coach owns the page; close the global side panel to restore horizontal space.
  try { window.close(); } catch {}
  if (windowId) send({ type: 'CLOSE_SIDE_PANEL', windowId, tabId: tab?.id }, 3000).catch(() => {});
}

async function gotoFrank(index) {
  if (!frank) return;
  const next = Math.max(0, Math.min(frank.plan.steps.length - 1, index));
  const r = await send({ type: 'FRANK_GOTO', tabId: frank.tabId, index: next }, 8000);
  if (!r.ok) return frankAction(r.error || 'Could not move the walkthrough to that step.', 'error');
  renderFrankStep(next);
}
async function endFrank() {
  if (!frank) return;
  await send({ type: 'FRANK_END', tabId: frank.tabId }, 5000);
  leaveFrankLocal();
  notice('Walkthrough closed.');
}

async function loadSession() {
  if (!report?.page?.url) return;
  const r = await send({ type: 'GET_SITE_SESSION', pageUrl: report.page.url }, 6000);
  siteSession = r.ok ? r.session : null;
  renderSession();
}

// Chrome only grants activeTab for the tab that was active at the moment the
// user invoked the extension via its toolbar icon — switching tabs while the
// side panel stays open does not extend that grant to the newly active tab.
// A scan attempt on a tab Chrome hasn't (re-)granted access to fails with one
// of these messages (see background.js's ensureInjected/localScan/failurePayload).
function isPageAccessError(r) {
  return /page access expired|cannot access|missing host permission|activetab/i.test(String(r?.diagnostic?.technicalMessage || r?.error || ''));
}
// The one legitimate way to let "New scan" work after switching tabs without
// requiring the toolbar-icon dance every time: ask for permission on just this
// origin (same mechanism as "Watch this site"), scoped and one-time per site.
async function requestScanPermission(url) {
  if (!url) return false;
  let u; try { u = new URL(url); } catch { return false; }
  if (!/^https?:$/.test(u.protocol)) return false;
  const pattern = `${u.protocol}//${u.host}/*`;
  if (await chrome.permissions.contains({ origins: [pattern] }).catch(() => false)) return true;
  notice('You switched pages — requesting permission to scan this site…');
  try { return await chrome.permissions.request({ origins: [pattern] }); } catch { return false; }
}

async function rescan() {
  if (scanInFlight) return;
  // A cached tab reference from a previous scan must never be trusted here —
  // if the user switched tabs or navigated since the last scan, "New scan"
  // has to target whatever page is actually active right now, not whatever
  // was scanned before. Without this refresh, SCAN_TAB below would silently
  // re-scan the stale tab, and only closing/reopening the panel (which re-runs
  // restoreWorkspaceOrRescan) would pick up the real active tab.
  const active = await send({ type: 'GET_ACTIVE' }, 5000).catch(() => null);
  if (active?.ok && active.tab?.id) tab = { id: active.tab.id, windowId: active.tab.windowId, url: active.tab.url };
  const scanId = `scan-${Date.now().toString(36)}`;
  const scanMode = tab?.id ? 'current-tab' : 'active-tab';
  runtimeTrace.clear();
  lastScanAttempt = { scanId, ok: false, mode: scanMode, at: new Date().toISOString() };
  lastFrank = null;
  runtimeTrace.record('scan-start', { hasTab: Boolean(tab?.id), mode: scanMode, scanId });
  pendingFrankCancel?.(); pendingFrankCancel = null; frankRequestSeq++;
  if (frank) await endFrank();
  scanInFlight = true; classFilter = '';
  scanPhase = SCAN_PHASE.DISCOVERING;
  resultFlags = emptyResultReady();
  const button = $('#scan'); button.disabled = true; button.textContent = 'Scanning';
  const stopButton = $('#stop-scan');
  const scanHadFocus = document.activeElement === button;
  if (stopButton) {
    stopButton.hidden = false;
    stopButton.disabled = false;
    if (scanHadFocus) stopButton.focus();
  }
  staleResult = false;
  lockResultsUi();
  $('#idle-state').hidden = true;
  $('#summary').hidden = false;
  const qaSection = document.querySelector('.qa-section');
  if (qaSection) qaSection.hidden = true;
  $('#ledger').innerHTML = '';
  $('#findings').innerHTML = '<div class="empty-findings"><b>Scan in progress.</b> Findings appear when verified evidence is ready.</div>';
  const overview = $('#frank-overview');
  if (overview) {
    overview.dataset.state = 'loading';
    $('#judgment-title').textContent = 'Scanning current page…';
    $('#brief').textContent = 'Results stay hidden until the scan finishes and scan guidance is composed.';
    $('#material-count').textContent = '';
    $('#coverage-state').textContent = '';
  }
  clearDiagnostic(); notice('Scanning current page…');
  try {
    let r = await send(tab?.id ? { type: 'SCAN_TAB', tabId: tab.id } : { type: 'SCAN_ACTIVE' }, 45000, { abortable: true });
    if (!r.ok && isPageAccessError(r) && (await requestScanPermission(tab?.url))) {
      notice('Permission granted. Scanning…');
      r = await send(tab?.id ? { type: 'SCAN_TAB', tabId: tab.id } : { type: 'SCAN_ACTIVE' }, 45000, { abortable: true });
    }
    if (r.aborted) { restoreAfterStop(); return; }
    if (!r.ok) {
      lastScanAttempt = { ...lastScanAttempt, ok: false, operation: r.diagnostic?.operation || 'SCAN', code: r.diagnostic?.id || '' };
      runtimeTrace.record('scan-failed', { scanId, diagnosticId: r.diagnostic?.id || '', operation: r.diagnostic?.operation || 'SCAN' });
      scanPhase = SCAN_PHASE.FAILED;
      showFailure(r, 'The page scan could not complete.');
      return;
    }
    tab = r.tab;
    const collected = stampReportIdentity(r.report);
    collected.scanId = scanId;
    lastScanAttempt = { scanId, ok: true, mode: scanMode, at: new Date().toISOString() };
    resultFlags.scanCollectionComplete = true;
    applyScanProgress({ phase: SCAN_PHASE.VERIFYING_LINKS });
    const scanned = new Date(collected.scannedAt || Date.now()).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    const enriched = await send({ type: 'ENRICH', report: collected, tabId: tab?.id }, 120000, { abortable: true });
    if (enriched.aborted) { restoreAfterStop(); return; }
    if (enriched.ok) {
      report = stampReportIdentity(enriched.report);
      resultFlags = {
        scanCollectionComplete: true,
        primaryVerificationComplete: String(report.coverage?.links || '') !== 'pending' && Boolean(report.linkAudit),
        evidenceLedgerReady: Boolean(report.evidenceLedger),
        correlationComplete: Boolean(report.attention),
        frankInitialReviewComplete: typeof report.priorityBrief === 'string' && report.priorityBrief.length > 0
      };
      scanPhase = SCAN_PHASE.READY;
      runtimeTrace.record('scan-complete', { findingCount: Number(report.findings?.length||0), materialGroupCount: Number(report.attention?.materialGroupCount||0), representedClasses: report.attention?.representedClasses||[], connectedMode: report.connectedMode||'unknown', scanId, resultReady: resultReadyFromReport(report) });
      const changed = [report.lifecycle?.newCount ? `${report.lifecycle.newCount} new` : '', report.lifecycle?.resolvedCount ? `${report.lifecycle.resolvedCount} resolved` : ''].filter(Boolean).join(' · ') || 'No changes';
      $('#new-count').textContent = changed;
      if (!resultReadyFromReport(report)) {
        scanPhase = SCAN_PHASE.FAILED;
        showFailure({ error: 'The scan finished collecting evidence, but the final review was not ready to show.' }, 'The scan could not finish.');
        return;
      }
      revealResultsUi();
      render();
      await loadSession();
      const limited = limitedCoverageLabels(report);
      if (report.connectedMode === 'auth-required') {
        const connection = $('#connection-settings'); if (connection) connection.open = true;
        notice('Browser QA completed locally. The assistant gateway requires an access key. Enter it under Connection settings to restore connected services.', 'warn');
      } else if (report.connectedMode === 'auth-rejected') {
        const connection = $('#connection-settings'); if (connection) connection.open = true;
        notice('Browser QA completed locally. The saved assistant access key was rejected. Verify the key under Connection settings to restore connected services.', 'warn');
      } else if (report.connectedMode === 'unavailable') notice('Browser QA completed. The assistant gateway could not be reached. Browser QA remains available with local evidence and verified guidance.', 'warn');
      else if (limited.length) notice(`Scan complete. Limited coverage in ${limited.length} area${limited.length === 1 ? '' : 's'}: ${limited.slice(0, 4).join('; ')}.`, 'warn');
      else notice(`Scan complete at ${scanned}.`, 'ok');
      if (tab?.id && report?.page?.url) {
        await send({
          type: 'SAVE_WORKSPACE_SNAPSHOT',
          workspace: {
            tabId: tab.id,
            windowId: tab.windowId,
            pageUrl: report.page.url || tab.url,
            report,
            buildRevision: currentBuildRevision(),
            classFilter,
            showAllChecks,
            filter,
            findingId: '',
            frankFocus: false,
            pendingReturn: false
          }
        }, 4000).catch(() => {});
      }
    } else {
      runtimeTrace.record('scan-enrichment-failed', { scanId, diagnosticId: enriched?.diagnostic?.id || '', operation: enriched?.diagnostic?.operation || 'ENRICH', code: enriched?.diagnostic?.id || '' });
      scanPhase = SCAN_PHASE.FAILED;
      showFailure(enriched, report
        ? 'This scan could not finish. Showing your last complete results.'
        : 'This scan could not finish. Nothing to show yet.');
      if (report && resultReadyFromReport(report)) {
        resultFlags = {
          scanCollectionComplete: true,
          primaryVerificationComplete: true,
          evidenceLedgerReady: Boolean(report.evidenceLedger),
          correlationComplete: Boolean(report.attention),
          frankInitialReviewComplete: Boolean(report.priorityBrief)
        };
        scanPhase = SCAN_PHASE.READY;
        staleResult = true;
        revealResultsUi();
        render();
      }
    }
    await updateWatch();
  } finally {
    scanInFlight = false;
    pendingAborts = [];
    const returnFocus = stopButton && (document.activeElement === stopButton || document.activeElement === document.body);
    if (stopButton) stopButton.hidden = true;
    if (returnFocus && scanHadFocus) button.focus();
    if (document.body.dataset.resultReady !== 'true') delete document.body.dataset.scanning;
    button.disabled = false;
    button.textContent = report && document.body.dataset.resultReady === 'true' ? 'New scan' : (report ? 'Scan page' : 'Scan page');
    if (document.body.dataset.resultReady === 'true') button.textContent = 'New scan';
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
    loadBriefAiSettings(r.settings || {});
    if (r.tab?.id && !tab) tab = r.tab;
  }
}

/* ---------------- events ---------------- */
$('#copy-diagnostic').onclick = async () => {
  if (!lastDiagnostic) return;
  const text = [`Lumen ${lastDiagnostic.version || ''}`.trim(), `Diagnostic: ${lastDiagnostic.id || 'Unavailable'}`, `Operation: ${lastDiagnostic.operation || 'Unknown'}`, `Time: ${lastDiagnostic.timestamp || ''}`, `Technical message: ${lastDiagnostic.technicalMessage || ''}`, lastDiagnostic.stack ? `Stack:\n${lastDiagnostic.stack}` : ''].filter(Boolean).join('\n');
  try { await navigator.clipboard.writeText(text); notice('Diagnostics copied.', 'ok'); }
  catch { notice('Clipboard access was not available.', 'error'); }
};

function currentBugArtifact() {
  const includeContext = $('#bug-include-context')?.checked === true;
  const diagnostic = lastDiagnostic ? { id: lastDiagnostic.id, operation: lastDiagnostic.operation, timestamp: lastDiagnostic.timestamp } : null;
  return buildBugReport({
    version: RELEASE_VERSION,
    buildRevision: String(globalThis.__WEBQA_BUILD_REVISION__ || ''),
    developmentTarget: '1.7.5',
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

// Stopping abandons the run. Anything the page has already started may still
// finish on its own; nothing from this run is recorded either way.
function restoreAfterStop() {
  scanPhase = SCAN_PHASE.FAILED;
  if (report && resultReadyFromReport(report)) {
    scanPhase = SCAN_PHASE.READY;
    staleResult = true;
    revealResultsUi();
    render();
    notice('Scan stopped. Showing your last complete results.', 'warn');
  } else {
    notice('Scan stopped. Nothing from this run was recorded.', 'warn');
  }
}

$('#stop-scan').onclick = () => {
  const stopButton = $('#stop-scan');
  if (stopButton) stopButton.disabled = true;
  abortPendingSends();
};
$('#scan-site').onclick = async () => {
  const button = $('#scan-site');
  button.disabled = true;
  try {
    const r = await send({ type: 'SITE_AUDIT_OPEN' }, 10000);
    if (!r.ok) { notice(r.error || 'Could not open the site audit workspace.', 'error'); return; }
    // The audit workspace is a full-page overlay on the inspected tab, in the
    // same spirit as Frank's Walkthrough — the side panel gets out of the way
    // rather than fighting it for space.
    const windowInfo = await chrome.windows.getCurrent().catch(() => null);
    try { window.close(); } catch {}
    if (windowInfo?.id) send({ type: 'CLOSE_SIDE_PANEL', windowId: windowInfo.id, tabId: r.tabId }, 3000).catch(() => {});
  } finally {
    button.disabled = false;
  }
};
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
    localRow.innerHTML = `<b>On-device AI</b><span>${esc(localAi.status || 'unavailable')}</span>`;
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
  const stored = String(workspace.buildRevision || workspace.report?.buildRevision || '').trim();
  if (isStaleBuildRevision(currentBuildRevision(), stored)) {
    notice('Extension updated. Refreshing this page assessment…', 'warn');
    return false;
  }
  report = workspace.report;
  classFilter = workspace.classFilter || '';
  showAllChecks = Boolean(workspace.showAllChecks);
  filter = workspace.filter || 'all';
  if (workspace.tabId) tab = { ...(tab || {}), id: workspace.tabId, windowId: workspace.windowId || tab?.windowId, url: workspace.pageUrl || tab?.url };
  leaveFrankLocal();
  scanPhase = SCAN_PHASE.READY;
  resultFlags = {
    scanCollectionComplete: true,
    primaryVerificationComplete: true,
    evidenceLedgerReady: Boolean(report.evidenceLedger),
    correlationComplete: Boolean(report.attention),
    frankInitialReviewComplete: Boolean(report.priorityBrief)
  };
  revealResultsUi();
  render();
  focusFindingCard(workspace.findingId || '');
  notice(fromFrankFocus ? 'Returned to findings with your previous scan.' : 'Restored your previous scan.', 'ok');
  return true;
}

// Opening the panel (or clicking the toolbar icon while it's already open)
// must never start a scan on its own — only the "Scan page" / "New scan"
// button click does that. This restores a still-valid previous result for
// the current page when one exists, and otherwise leaves the idle state up
// with nothing running until the user explicitly asks for one.
const IDLE_AREA_LABELS = {
  availability: 'Availability', discoverability: 'Discoverability', performance: 'Performance',
  accessibility: 'Accessibility', security: 'Security', implementation: 'Web quality', coverage: 'Coverage'
};

// What each discipline actually inspects on a single page. Stated so the idle
// sheet carries the scope of the survey rather than seven bare nouns.
const IDLE_AREA_SCOPE = {
  availability: 'Links, fragments and resources that fail to resolve',
  discoverability: 'Titles, descriptions, canonicals and robots directives',
  performance: 'Lab timings measured in this browser, on this network',
  accessibility: 'axe-core rules plus browser checks against the live DOM',
  security: 'Response headers, mixed content and clickjacking exposure',
  implementation: 'Markup, structured data and console errors',
  coverage: 'What could not be reached, probed or verified'
};

/** The idle panel used to be three paragraphs over an empty column. It now
 * states what page is under review and what a scan actually covers — both
 * known before any scan runs, so nothing here is speculative. */
function renderIdleContext() {
  const block = $('#idle-page');
  let parsed = null;
  try { parsed = tab?.url ? new URL(tab.url) : null; } catch { parsed = null; }
  if (parsed && /^https?:$/.test(parsed.protocol)) {
    $('#idle-page-host').textContent = parsed.hostname;
    $('#idle-page-path').textContent = parsed.pathname === '/' ? '/' : parsed.pathname;
    const secure = parsed.protocol === 'https:';
    const scheme = $('#idle-page-scheme');
    scheme.textContent = secure ? 'HTTPS' : 'Not secure (HTTP)';
    scheme.className = `idle-scheme ${secure ? 'ok' : 'warn'}`;
    block.hidden = false;
  } else {
    block.hidden = true;
  }
  const areas = $('#idle-areas');
  if (areas && !areas.childElementCount) {
    for (const area of LEDGER_ORDER) {
      const li = document.createElement('li');
      const name = document.createElement('b');
      name.textContent = IDLE_AREA_LABELS[area] || area;
      const scope = document.createElement('span');
      scope.textContent = IDLE_AREA_SCOPE[area] || '';
      li.append(name, scope);
      areas.appendChild(li);
    }
  }
}

const sameDocument = (a, b) => {
  try {
    const x = new URL(a), y = new URL(b);
    return x.origin === y.origin && x.pathname === y.pathname && x.search === y.search;
  } catch { return false; }
};

async function refreshIdleHistory() {
  const block = $('#idle-history');
  if (!block) return;
  block.hidden = true;
  if (!tab?.url) return;
  let session = null;
  try {
    const r = await send({ type: 'GET_SITE_SESSION', pageUrl: tab.url }, 5000);
    session = r?.ok === false ? null : (r?.session || null);
  } catch { session = null; }
  const pages = Object.values(session?.pages || {})
    .filter(p => p?.url && p.lastScan)
    .sort((a, b) => new Date(b.lastScan) - new Date(a.lastScan));
  if (!pages.length) return;

  const time = value => new Date(value).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  const plural = (n, word) => `${n} ${word}${Number(n) === 1 ? '' : 's'}`;

  const thisPage = pages.find(p => sameDocument(p.url, tab.url));
  const others = pages.filter(p => p !== thisPage);
  const last = $('#idle-last');
  if (last) {
    last.innerHTML = thisPage
      ? `<b>This page</b> was scanned at ${esc(time(thisPage.lastScan))}: ${esc(plural(Number(thisPage.materialCount || 0), 'issue'))}.`
      : `<b>This page</b> has not been scanned yet.`;
  }

  const rows = $('#idle-history-rows');
  if (rows) {
    rows.innerHTML = '';
    for (const page of others.slice(0, 4)) {
      const row = document.createElement('div');
      row.className = 'idle-history-row';
      let path = page.url;
      try { const u = new URL(page.url); path = (u.pathname || '/') + (u.search || ''); } catch {}
      row.innerHTML = `<b>${esc(path)}</b><span>${esc(time(page.lastScan))} · ${esc(plural(Number(page.materialCount || 0), 'issue'))}</span>`;
      rows.appendChild(row);
    }
    rows.hidden = others.length === 0;
  }

  const more = $('#idle-history-more');
  if (more) {
    const openTotal = pages.reduce((n, p) => n + Number(p.materialCount || 0), 0);
    const hidden = Math.max(0, others.length - 4);
    more.textContent = hidden
      ? `${plural(hidden, 'more page')} on this site · ${plural(openTotal, 'issue')} open in this session`
      : (others.length ? `${plural(openTotal, 'issue')} open across ${plural(pages.length, 'page')} in this session` : '');
  }
  block.hidden = false;
}

function showIdleState() {
  delete document.body.dataset.hasReport;
  delete document.body.dataset.resultReady;
  delete document.body.dataset.scanning;
  $('#summary').hidden = true;
  $('#idle-state').hidden = false;
  renderIdleContext();
  refreshIdleHistory();
  const button = $('#scan');
  button.disabled = false;
  button.textContent = 'Scan page';
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
      const stored = String(workspace.buildRevision || workspace.report?.buildRevision || '').trim();
      if (isStaleBuildRevision(currentBuildRevision(), stored)) {
        await send({ type: 'CLEAR_WORKSPACE_SNAPSHOT', tabId: useTabId }, 4000).catch(() => {});
        runtimeTrace.record('hydration-stale-build', {
          stage: 'hydration',
          code: 'STALE_BUILD_REVISION',
          operation: 'RESTORE_WORKSPACE',
          recoverable: true,
          coverageImpact: 'none'
        });
        notice('Extension updated. Click Scan page to refresh this assessment.', 'warn');
        showIdleState();
        return { restored: false, staleBuild: true };
      }
      const fromFrank = Boolean(workspace.frankFocus || workspace.pendingReturn);
      if (workspace.frankFocus && useTabId) await send({ type: 'FRANK_END', tabId: useTabId }, 4000).catch(() => {});
      if (!applyWorkspaceSnapshot(workspace, { fromFrankFocus: fromFrank })) {
        await send({ type: 'CLEAR_WORKSPACE_SNAPSHOT', tabId: useTabId }, 4000).catch(() => {});
        showIdleState();
        return { restored: false, staleBuild: true };
      }
      await send({ type: 'PATCH_WORKSPACE_SNAPSHOT', tabId: useTabId, patch: { frankFocus: false, pendingReturn: false } }, 4000).catch(() => {});
      await loadSession();
      await updateWatch();
      return { restored: true };
    }
  }
  showIdleState();
  return { restored: false };
}

chrome.runtime.onMessage.addListener(msg => {
  if (msg?.type === 'ACTION_INVOKED') {
    if (msg.tabId) tab = { ...(tab || {}), id: msg.tabId, windowId: msg.windowId || tab?.windowId, url: msg.pageUrl || tab?.url };
    restoreWorkspaceOrRescan({ tabId: msg.tabId, pageUrl: msg.pageUrl || '', preferRestore: true });
  }
  if (msg?.type === 'FRANK_STEP_CHANGED' && frank) renderFrankStep(msg.index);
  if (msg?.type === 'FRANK_CLOSED' && frank) { leaveFrankLocal(); notice('Walkthrough closed.'); }
  if (msg?.type === 'OPEN_REPORT_BUG') {
    runtimeTrace.record('report-bug-opened', { fromFrank: true });
    $('#bug-include-context').checked = false;
    $('#bug-note').value = '';
    refreshBugPrivacyCopy();
    $('#bug-dialog')?.showModal();
  }
});

loadSettings().finally(() => restoreWorkspaceOrRescan({ preferRestore: true }));

/**
 * Brief wording settings.
 *
 * Bring-your-own AI exists because the people who audit client sites are
 * often the people least able to send client evidence to a vendor they did
 * not choose. The envelope that leaves the browser is already stripped of
 * URLs, hosts, titles and markup, and the request goes from this browser
 * straight to their endpoint — it does not pass through Lumen's servers.
 *
 * The host permission is requested at save time rather than mid-audit, so
 * the Chrome prompt appears while the operator is looking at the field they
 * just filled in.
 */
/**
 * The writing settings.
 *
 * Built from what can actually answer rather than from a fixed list. The
 * previous screen offered "On-device only" as its default on machines where
 * Chrome reports the built-in model unavailable and cannot be made to report
 * anything else, so the feature looked broken while every part of it worked.
 * An option that cannot answer is now shown as unavailable, with the reason,
 * and the line under the picker names whoever will actually be asked.
 */
async function loadBriefAiSettings(settings) {
  const url = $("#byo-ai-url"); if (url) url.value = settings.byoAiBaseUrl || "";
  const model = $("#byo-ai-model"); if (model) model.value = settings.byoAiModel || "";
  const key = $("#byo-ai-key"); if (key) key.value = settings.byoAiKey || "";
  await renderBriefAiProviders(String(settings.briefAiProvider || "byo"));
}

/** Chrome's built-in model can only be probed from a document, so the panel
 * asks here and tells the worker what it found. */
async function localModelAvailable() {
  try {
    if (typeof LanguageModel === "undefined" || !LanguageModel?.availability) return false;
    const status = await LanguageModel.availability({
      expectedInputs: [{ type: "text", languages: ["en"] }],
      expectedOutputs: [{ type: "text", languages: ["en"] }]
    });
    return status === "available" || status === "downloadable" || status === "downloading";
  } catch { return false; }
}

async function renderBriefAiProviders(selected) {
  const select = $("#brief-ai-provider");
  const resolvedLine = $("#brief-ai-resolved");
  if (!select) return;
  const localAvailable = await localModelAvailable();
  const state = await send({ type: "BRIEF_AI_SETTINGS", localAvailable }, 6000).catch(() => null);
  const providers = state?.providers || {};
  const want = selected || state?.provider || "byo";
  select.innerHTML = "";
  for (const id of ["byo", "on-device", "gateway", "off"]) {
    const info = id === "off"
      ? { label: "No model, Lumen writes everything", ready: true, note: "Every word comes from Lumen itself." }
      : providers[id];
    if (!info) continue;
    const option = document.createElement("option");
    option.value = id;
    option.textContent = info.ready ? info.label : info.label + " (unavailable)";
    option.disabled = !info.ready && id !== want;
    option.title = info.note || "";
    if (id === want) option.selected = true;
    select.appendChild(option);
  }
  const presets = $("#byo-ai-presets");
  const row = $("#byo-ai-preset-row");
  if (presets && row && !presets.childElementCount) {
    for (const preset of state?.presets || []) {
      const option = document.createElement("option");
      option.value = preset.baseUrl;
      option.label = preset.label;
      presets.appendChild(option);
      // A button rather than only a datalist entry: the point is to remove the
      // typing, and that includes the model name and the key expectation.
      const button = document.createElement("button");
      button.type = "button";
      button.className = "btn btn-quiet";
      button.textContent = preset.label;
      button.title = preset.note;
      button.addEventListener("click", () => {
        $("#byo-ai-url").value = preset.baseUrl;
        $("#byo-ai-model").value = preset.model;
        if (!preset.needsKey) $("#byo-ai-key").value = "";
        const status = $("#brief-ai-status");
        if (status) status.textContent = preset.note;
      });
      row.appendChild(button);
    }
  }
  if (resolvedLine) {
    const r = state?.resolved;
    resolvedLine.textContent = !r ? ""
      : r.ready
        ? (r.substituted ? r.reason : "Ready. " + (r.reason || ""))
        : "No model will be asked. " + (r.reason || "");
  }
}

async function testBriefAiEndpoint() {
  const status = $("#brief-ai-status");
  const button = $("#test-brief-ai");
  if (button) { button.disabled = true; button.textContent = "Testing…"; }
  if (status) status.textContent = "Asking the endpoint for one word…";
  try {
    const result = await send({
      type: "BRIEF_AI_TEST",
      byoAiBaseUrl: ($("#byo-ai-url")?.value || "").trim(),
      byoAiModel: ($("#byo-ai-model")?.value || "").trim(),
      byoAiKey: $("#byo-ai-key")?.value || ""
    }, 20000).catch((error) => ({ ok: false, message: String(error?.message || error) }));
    if (status) {
      status.textContent = result?.ok
        ? `${result.origin} answered in ${result.latencyMs} ms as ${result.model}. Save to use it.`
        : (result?.message || "The endpoint did not answer.") + (result?.code ? ` (${result.code})` : "");
    }
  } finally {
    if (button) { button.disabled = false; button.textContent = "Test endpoint"; }
  }
}

async function saveBriefAiSettings() {
  const status = $("#brief-ai-status");
  const provider = $("#brief-ai-provider")?.value || "byo";
  const byoAiBaseUrl = ($("#byo-ai-url")?.value || "").trim();
  const byoAiModel = ($("#byo-ai-model")?.value || "").trim();
  const byoAiKey = $("#byo-ai-key")?.value || "";

  if (provider === "byo") {
    const check = await send({ type: "BRIEF_AI_CHECK_ENDPOINT", byoAiBaseUrl }, 5000).catch(() => null);
    if (!check?.ok) {
      if (status) status.textContent = check?.message || "That endpoint cannot be used.";
      return;
    }
    if (!byoAiModel) {
      if (status) status.textContent = "Set the model name your endpoint serves.";
      return;
    }
    // Chrome only allows a permission request from a user gesture, which is
    // why this happens on the save click rather than on the first audit.
    let granted = await chrome.permissions.contains({ origins: [check.pattern] }).catch(() => false);
    if (!granted) granted = await chrome.permissions.request({ origins: [check.pattern] }).catch(() => false);
    if (!granted) {
      if (status) status.textContent = "Lumen needs permission to reach " + check.origin + ". Nothing was saved.";
      return;
    }
  }

  const saved = await send({ type: "SAVE_BRIEF_AI_SETTINGS", briefAiProvider: provider, byoAiBaseUrl, byoAiModel, byoAiKey }, 8000).catch(() => null);
  if (status) status.textContent = saved?.ok ? "Saved." : "Could not save those settings.";
  if (saved?.ok) await renderBriefAiProviders(provider);
}

$("#save-brief-ai")?.addEventListener("click", saveBriefAiSettings);
$("#test-brief-ai")?.addEventListener("click", testBriefAiEndpoint);
