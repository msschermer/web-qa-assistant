import { deterministicBrief, finalizeCorrelatedFindings, composeReportAttention } from './correlate.js';
import { buildEvidenceGraph } from './frank-evidence.js';
import { deterministicFrankPlan, validateFrankPlan } from './frank-plan.js';
import { attachEnvironmentContext, launchIntegrityFindings, publishedIndexSignalsFromContext, publishedIndexSignalsFromFindings, mergePublishedIndexSignals, reconcileIndexControlWithFindings, buildIndexControl, environmentNotice } from './environment.js';
import { applyFindingPolicy, presentationPolicySummary } from './policy.js';
import { attachTargetIntegrity, finalizeBlockedTargetReport } from './apply-report.js';
import { IMPACT_CLASSES } from './impact.js';
import { gatewayContextEnvelope, gatewayFrankGraph } from './evidence-contract.js';
import { explainCoverageReasons, resolvePerformanceCoverage, reconcilePerformanceCoverage, finalizeLinkAudit, mergeGatewayLinkAudit, preserveScannerAborted, normalizePrivilegedFallback, applyPrivilegedProbeAccounting } from './coverage.js';
import { buildEvidenceLedger } from './evidence-ledger.js';
import { buildPerformanceAssessment } from './performance-assessment.js';
import { createLinkStatusCache } from './link-status-cache.js';
import { buildPublishedCoverage } from './published-coverage.js';
import { emptyFrankReview, scanGuidanceSource } from './review-state.js';

const LIVE_API = 'https://assistant.msschermer.us';
const LOCAL_APIS = ['http://localhost:3000', 'http://localhost:8787'];
const GATEWAY_TIMEOUT_MS = 10000;
const FRANK_TIMEOUT_MS = 16000;
const dirtyTimers = new Map();
const workspaceHot = new Map();
const RELEASE_VERSION = '1.7.5';
const WORKSPACE_SESSION_KEY = 'qaWorkspaceByTab';
const LINK_CACHE_SESSION_KEY = 'qaLinkStatusCache';
const linkStatusCache = createLinkStatusCache();

async function readWorkspaceStore() {
  try {
    if (!chrome.storage?.session) return {};
    const data = await chrome.storage.session.get({ [WORKSPACE_SESSION_KEY]: {} });
    return data[WORKSPACE_SESSION_KEY] || {};
  } catch { return {}; }
}
async function writeWorkspaceStore(store) {
  if (!chrome.storage?.session) return { ok: false, error: 'Session storage is unavailable.' };
  try {
    await chrome.storage.session.set({ [WORKSPACE_SESSION_KEY]: store });
    return { ok: true };
  } catch (error) {
    return { ok: false, error: String(error?.message || error || 'Could not save workspace snapshot.') };
  }
}
async function persistLinkCache() {
  try {
    if (!chrome.storage?.session) return;
    await chrome.storage.session.set({ [LINK_CACHE_SESSION_KEY]: linkStatusCache.exportEntries() });
  } catch {}
}
async function restoreLinkCache() {
  try {
    if (!chrome.storage?.session) return;
    const data = await chrome.storage.session.get({ [LINK_CACHE_SESSION_KEY]: [] });
    linkStatusCache.hydrate(data[LINK_CACHE_SESSION_KEY] || []);
  } catch {}
}
restoreLinkCache();
function workspaceKey(tabId) { return String(tabId || ''); }
async function saveWorkspaceSnapshot(workspace) {
  const tabId = workspaceKey(workspace?.tabId);
  if (!tabId || !workspace?.report || !workspace?.pageUrl) throw new Error('A tab, page URL, and scan report are required to keep the QA workspace.');
  const entry = {
    tabId: Number(workspace.tabId),
    windowId: Number(workspace.windowId) || 0,
    pageUrl: String(workspace.pageUrl),
    report: workspace.report,
    buildRevision: String(workspace.buildRevision || workspace.report?.buildRevision || ''),
    classFilter: workspace.classFilter || '',
    showAllChecks: Boolean(workspace.showAllChecks),
    filter: workspace.filter || 'all',
    findingId: workspace.findingId || '',
    stepIndex: Number(workspace.stepIndex) || 0,
    frankFocus: Boolean(workspace.frankFocus),
    pendingReturn: Boolean(workspace.pendingReturn),
    savedAt: new Date().toISOString()
  };
  workspaceHot.set(tabId, entry);
  const store = await readWorkspaceStore();
  store[tabId] = entry;
  const written = await writeWorkspaceStore(store);
  if (!written.ok) {
    workspaceHot.delete(tabId);
    throw Object.assign(new Error(written.error || 'Workspace snapshot could not be saved.'), { code: 'WORKSPACE_SNAPSHOT_FAILED' });
  }
  return { saved: true, frankFocus: entry.frankFocus };
}
async function getWorkspaceSnapshot(tabId) {
  const key = workspaceKey(tabId);
  if (!key) return { workspace: null };
  if (workspaceHot.has(key)) return { workspace: workspaceHot.get(key) };
  const store = await readWorkspaceStore();
  const entry = store[key] || null;
  if (entry) workspaceHot.set(key, entry);
  return { workspace: entry };
}
async function patchWorkspaceSnapshot(tabId, patch = {}) {
  const current = (await getWorkspaceSnapshot(tabId)).workspace;
  if (!current) return { patched: false };
  return saveWorkspaceSnapshot({
    ...current,
    ...patch,
    tabId: current.tabId,
    pageUrl: patch.pageUrl || current.pageUrl,
    report: patch.report !== undefined ? patch.report : current.report,
    buildRevision: patch.buildRevision !== undefined
      ? String(patch.buildRevision || '')
      : String(current.buildRevision || current.report?.buildRevision || '')
  });
}
async function clearWorkspaceSnapshot(tabId) {
  const key = workspaceKey(tabId);
  if (!key) return { cleared: false };
  workspaceHot.delete(key);
  const store = await readWorkspaceStore();
  if (store[key]) {
    delete store[key];
    await writeWorkspaceStore(store);
  }
  return { cleared: true };
}

/** Presentation-only: promote bounded step evidence into coach metrics when a step has none. Does not change plan logic. */
function withCoachMetrics(plan, graph) {
  const byId = Object.fromEntries((graph?.evidence || []).map(e => [e.id, e]));
  const skip = /^(rule|selector|finding|verification-attempts|verification-evidence|signal|url|environment)$/i;
  const steps = (plan?.steps || []).map(step => {
    const existing = Array.isArray(step.metrics) ? step.metrics.filter(m => m?.label && m?.value !== '') : [];
    if (existing.length >= 4) return step;
    const added = [];
    for (const id of step.evidenceRefs || []) {
      const e = byId[id];
      if (!e || e.value == null || e.value === '') continue;
      if (skip.test(String(e.kind || ''))) continue;
      const label = String(e.label || e.kind || 'Evidence').slice(0, 48);
      const value = typeof e.value === 'object' ? JSON.stringify(e.value).slice(0, 96) : String(e.value).slice(0, 120);
      if (!label || !value) continue;
      if (existing.some(m => m.label === label) || added.some(m => m.label === label)) continue;
      added.push({ label, value });
      if (existing.length + added.length >= 6) break;
    }
    return added.length ? { ...step, metrics: [...existing, ...added] } : step;
  });
  return { ...plan, steps };
}

function diagnosticHash(input){let h=2166136261;for(let i=0;i<input.length;i++){h^=input.charCodeAt(i);h=Math.imul(h,16777619)}return(h>>>0).toString(36).toUpperCase()}
function requestId(operation='REQ'){return `WQA-${operation}-${Date.now().toString(36).toUpperCase()}-${Math.random().toString(36).slice(2,7).toUpperCase()}`}
function failurePayload(error, operation='UNKNOWN'){
  const raw=String(error?.message||error||'Unknown extension error'),stack=typeof error?.stack==='string'?error.stack.slice(0,5000):'',id=`WQA-${diagnosticHash(`${operation}|${raw}|${stack.split('\n')[1]||''}`)}`;
  let message='The extension could not complete this action.';
  if(/Page access expired|Cannot access|Missing host permission|activeTab/i.test(raw))message='Page access expired. Click the Web QA Assistant toolbar icon on this page, then try again.';
  else if(/cannot be inspected|normal HTTP or HTTPS/i.test(raw))message='This browser page cannot be inspected. Open a normal HTTP or HTTPS page.';
  else if(/timed out|timeout/i.test(raw))message='The action timed out before it completed.';
  else if(/no longer available|No active browser tab/i.test(raw))message='The inspected browser tab is no longer available.';
  return{error:message,diagnostic:{id,operation,technicalMessage:raw,stack,version:RELEASE_VERSION,timestamp:new Date().toISOString()}};
}

chrome.sidePanel.setPanelBehavior({openPanelOnActionClick:false}).catch(()=>{});
chrome.runtime.onInstalled.addListener(()=>chrome.sidePanel.setPanelBehavior({openPanelOnActionClick:false}).catch(()=>{}));
chrome.runtime.onStartup.addListener(()=>chrome.sidePanel.setPanelBehavior({openPanelOnActionClick:false}).catch(()=>{}));
chrome.action.onClicked.addListener(tab=>{if(!tab?.windowId)return;chrome.sidePanel.open({windowId:tab.windowId}).catch(()=>{});chrome.runtime.sendMessage({type:'ACTION_INVOKED',tabId:tab.id,windowId:tab.windowId,pageUrl:tab.url||''}).catch(()=>{})});

function emitScanProgress(phase, extra = {}) {
  chrome.runtime.sendMessage({ type: 'SCAN_PROGRESS', phase, source: 'background', ...extra }).catch(() => {});
}

chrome.runtime.onMessage.addListener((msg,sender,send)=>{
  // Return to QA must call sidePanel.open synchronously to preserve the content-script user gesture.
  if(msg?.type==='RETURN_TO_QA'){
    const tabId=msg.tabId||sender.tab?.id;
    const windowId=msg.windowId||sender.tab?.windowId;
    if(!windowId){send({ok:false,error:'Frank could not identify the browser window to reopen QA.'});return false}
    let openPromise;
    try{openPromise=chrome.sidePanel.open({windowId})}
    catch(error){openPromise=Promise.reject(error)}
    (async()=>{
      let opened=false,openError='';
      try{await openPromise;opened=true}
      catch(error){openError=String(error?.message||error||'Could not reopen the side panel.')}
      try{
        if(tabId)await patchWorkspaceSnapshot(tabId,{frankFocus:true,pendingReturn:true,findingId:msg.findingId||'',stepIndex:Number(msg.stepIndex)||0});
        if(tabId)await frankMessage(tabId,{type:'FRANK_END'});
      }catch{}
      if(opened)send({ok:true,opened:true});
      else send({ok:false,opened:false,endedCoach:true,error:openError||'Could not reopen the side panel. Use the Web QA Assistant toolbar icon.'});
    })();
    return true;
  }

  (async()=>{
  if(msg.type==='SCAN_PROGRESS'){
    if(sender.tab && msg.source!=='background'){
      chrome.runtime.sendMessage({ ...msg, source: 'content' }).catch(()=>{});
    }
    return { ok: true };
  }
  if(msg.type==='SCAN_ACTIVE'){emitScanProgress('DISCOVERING');const current=await activeTab(),report=await localScan(current);return{tab:{id:current.id,windowId:current.windowId,url:report.page.url},report}}
  if(msg.type==='SCAN_TAB'){emitScanProgress('DISCOVERING');const report=await scanExistingTab(msg.tabId);const current=await chrome.tabs.get(msg.tabId).catch(()=>null);return{tab:{id:msg.tabId,windowId:current?.windowId,url:report.page.url},report}}
  if(msg.type==='ENRICH'){
    emitScanProgress('VERIFYING_LINKS');
    const enriched=await enrich(msg.report,msg.tabId||null);
    if(msg.tabId&&enriched?.page?.url){
      try{await updateState({id:msg.tabId,url:enriched.page.url},enriched)}
      catch(error){console.error(`[Web QA Assistant ${RELEASE_VERSION}] updateState after ENRICH failed`,error)}
    }
    return{report:enriched}
  }
  if(msg.type==='LINK_CACHE_SNAPSHOT'){
    const pageUrl=String(msg.pageUrl||sender.tab?.url||'');
    return{entries:linkStatusCache.exportEntries({pageUrl})};
  }
  if(msg.type==='LINK_CACHE_MERGE'){
    const entries=Array.isArray(msg.entries)?msg.entries.slice(0,400):[];
    linkStatusCache.hydrate(entries);
    persistLinkCache().catch(()=>{});
    return{ok:true,size:linkStatusCache.size};
  }
  if(msg.type==='LINK_CACHE_INVALIDATE'){
    if(msg.url)linkStatusCache.invalidate(msg.url);
    persistLinkCache().catch(()=>{});
    return{ok:true};
  }
  if(msg.type==='PREPARE_FRANK')return prepareFrank(msg);
  if(msg.type==='CLOUD_FRANK_PLAN')return cloudFrankPlan(msg);
  if(msg.type==='FRANK_START_PLAN')return startFrankPlan(msg);
  if(msg.type==='ASK_FRANK')return askFrank(msg);
  if(msg.type==='RECHECK_FINDING')return recheckFinding(msg);
  if(msg.type==='FRANK_GOTO')return frankMessage(msg.tabId,{type:'FRANK_GOTO',index:msg.index});
  if(msg.type==='FRANK_END')return frankMessage(msg.tabId,{type:'FRANK_END'});
  if(msg.type==='FRANK_PREVIEW')return frankMessage(msg.tabId,{type:'FRANK_PREVIEW',targetId:msg.targetId,preview:msg.preview});
  if(msg.type==='FRANK_RESET_PREVIEW')return frankMessage(msg.tabId,{type:'FRANK_RESET_PREVIEW'});
  if(msg.type==='HIGHLIGHT'){const tabId=msg.tabId||(await activeTab())?.id;if(!tabId)throw new Error('No inspected browser tab was found.');try{await chrome.tabs.sendMessage(tabId,{type:'PING'})}catch{try{await ensureInjected(tabId)}catch{throw new Error('Page access expired. Click the toolbar icon on this page and try Highlight again.')}}return chrome.tabs.sendMessage(tabId,{type:'HIGHLIGHT',targetId:msg.targetId,selector:msg.selector,ruleId:msg.ruleId})}
  if(msg.type==='GET_ACTIVE'){const s=await settings();return{tab:await activeTab(),settings:{apiBase:s.apiBase,apiKey:s.apiKey,cloudAiFallback:Boolean(s.cloudAiFallback),managedAccess:Boolean(s.installToken),managedAccessExpiresAt:Number(s.installTokenExpiresAt||0)}}}
  if(msg.type==='SAVE_WORKSPACE_SNAPSHOT')return saveWorkspaceSnapshot(msg.workspace||msg);
  if(msg.type==='GET_WORKSPACE_SNAPSHOT')return getWorkspaceSnapshot(msg.tabId);
  if(msg.type==='PATCH_WORKSPACE_SNAPSHOT')return patchWorkspaceSnapshot(msg.tabId,msg.patch||{});
  if(msg.type==='CLEAR_WORKSPACE_SNAPSHOT')return clearWorkspaceSnapshot(msg.tabId);
  if(msg.type==='CLOSE_SIDE_PANEL'){
    const windowId=msg.windowId||sender.tab?.windowId;
    if(!windowId)throw new Error('No browser window was available to close the side panel.');
    if(typeof chrome.sidePanel.close!=='function')return{closed:false,unsupported:true};
    await chrome.sidePanel.close({windowId});
    return{closed:true};
  }
  if(msg.type==='GET_SITE_SESSION'){const s=await settings(),url=msg.pageUrl||(await activeTab())?.url;if(!url)return{session:null};return{session:s.siteSessions[new URL(url).origin]||null}}
  if(msg.type==='CLEAR_SITE_SESSION'){const s=await settings(),url=msg.pageUrl||(await activeTab())?.url;if(url){delete s.siteSessions[new URL(url).origin];await chrome.storage.local.set({siteSessions:s.siteSessions})}return{cleared:true}}
  if(msg.type==='SAVE_GATEWAY_SETTINGS'){const apiBase=String(msg.apiBase||'').trim().replace(/\/$/,''),apiKey=String(msg.apiKey||'').trim(),cloudAiFallback=Boolean(msg.cloudAiFallback);if(apiBase&&!/^https?:\/\//i.test(apiBase))throw new Error('Gateway URL must use HTTP or HTTPS.');await chrome.storage.local.set({apiBase,apiKey,cloudAiFallback});return{saved:true}}
  if(msg.type==='TEST_GATEWAY')return testGateway({apiBase:msg.apiBase,apiKey:msg.apiKey,cloudAiFallback:Boolean(msg.cloudAiFallback)});
  if(msg.type==='IGNORE_RULE'){const current=await activeTab(),s=await settings(),url=msg.pageUrl||current?.url;if(!url)throw new Error('Page context is unavailable.');const origin=new URL(url).origin,list=s.ignoredRulesByOrigin[origin]||[];s.ignoredRulesByOrigin[origin]=[...new Set([...list,msg.ruleId])];await chrome.storage.local.set({ignoredRulesByOrigin:s.ignoredRulesByOrigin});return{ignored:true}}
  if(msg.type==='SET_ENVIRONMENT'){const url=msg.pageUrl||(await activeTab())?.url;if(!url)throw new Error('Page context is unavailable.');const origin=new URL(url).origin,allowed=new Set(['production','staging','preview','local','development','auto']);if(!allowed.has(msg.environment))throw new Error('Unsupported environment value.');const s=await settings();if(msg.environment==='auto')delete s.environmentOverridesByOrigin[origin];else s.environmentOverridesByOrigin[origin]=msg.environment;await chrome.storage.local.set({environmentOverridesByOrigin:s.environmentOverridesByOrigin});return{saved:true}}
  if(msg.type==='WATCH_DIRTY'&&sender.tab){const s=await settings(),origin=new URL(sender.tab.url).origin;if(s.watchedOrigins.includes(origin))scheduleWatched(sender.tab);return{scheduled:true}}
  if(msg.type==='OPEN_REPORT_BUG_FROM_FRANK'){
    const windowId=msg.windowId||sender.tab?.windowId;
    if(windowId)await chrome.sidePanel.open({windowId}).catch(()=>{});
    chrome.runtime.sendMessage({type:'OPEN_REPORT_BUG'}).catch(()=>{});
    return{opened:true};
  }
  return null;
})().then(x=>send({ok:true,...x})).catch(error=>{console.error(`[Web QA Assistant ${RELEASE_VERSION}] ${msg?.type||'UNKNOWN'} failed`,error);send({ok:false,...failurePayload(error,msg?.type||'UNKNOWN')})});return true});

chrome.tabs.onRemoved.addListener(tabId=>{clearWorkspaceSnapshot(tabId).catch(()=>{})});
chrome.tabs.onUpdated.addListener(async(tabId,change,updatedTab)=>{
  if(change.url){
    const snap=(await getWorkspaceSnapshot(tabId)).workspace;
    if(snap?.pageUrl&&snap.pageUrl!==change.url)await clearWorkspaceSnapshot(tabId).catch(()=>{});
  }
  if(change.status!=='complete'||!/^https?:/i.test(updatedTab.url||''))return;const s=await settings();let origin;try{origin=new URL(updatedTab.url).origin}catch{return}if(s.watchedOrigins.includes(origin))await scanWatched(updatedTab);
});

async function settings(){return chrome.storage.local.get({apiBase:'',apiKey:'',cloudAiFallback:false,installationId:'',installToken:'',installTokenExpiresAt:0,watchedOrigins:[],scanState:{},siteSessions:{},ignoredRulesByOrigin:{},environmentOverridesByOrigin:{}})}
async function ensureInjected(tabId){
  try{await chrome.tabs.sendMessage(tabId,{type:'PING'});return}catch{}
  try{
    await chrome.scripting.executeScript({target:{tabId},files:['page-diagnostics.js'],injectImmediately:true,world:'ISOLATED'});
  }catch{}
  await chrome.scripting.executeScript({target:{tabId},files:['vendor/axe.min.js','image-purpose.js','target-integrity.browser.js','browser-rules.js','content.js']});
}
try{
  chrome.scripting.registerContentScripts([{
    id:'webqa-page-diagnostics',
    matches:['http://*/*','https://*/*'],
    js:['page-diagnostics.js'],
    runAt:'DOCUMENT_START',
    persistAcrossSessions:true
  }]).catch(()=>{});
}catch{}
async function activeTab(){return(await chrome.tabs.query({active:true,currentWindow:true}))[0]}
function pageKey(url){const u=new URL(url);return u.origin+u.pathname}
function isPrivateHost(host){const h=String(host||'').toLowerCase();if(h==='localhost'||h.endsWith('.local')||h.endsWith('.internal'))return true;if(/^127\./.test(h)||/^10\./.test(h)||/^192\.168\./.test(h)||/^169\.254\./.test(h))return true;const m=/^172\.(\d+)\./.exec(h);return!!(m&&Number(m[1])>=16&&Number(m[1])<=31)}
function sanitizeExternalProbeUrl(raw){
  try{
    const u=new URL(String(raw||''));
    if(!/^https?:$/.test(u.protocol))return null;
    if(u.username||u.password)return null;
    if(isPrivateHost(u.hostname)||u.hostname.endsWith('.localhost'))return null;
    u.hash='';
    return u.toString();
  }catch{return null}
}
async function contextualize(report,context=null){
  if(!report?.page?.url)return report;const s=await settings(),origin=new URL(report.page.url).origin,override=s.environmentOverridesByOrigin?.[origin]||'',monitored=context?.performance?.data?.monitored===true||context?.performance?.monitored===true||context?.services?.performance?.data?.monitored===true||report?.context?.performance?.monitored===true;
  const published=mergePublishedIndexSignals(
    publishedIndexSignalsFromContext(context,report),
    publishedIndexSignalsFromFindings(report.findings||[])
  );
  const environment=attachEnvironmentContext(report.page,{
    override,
    canonical:report.page.canonical,
    monitored,
    destinations:report.linkAudit?.destinations||[],
    findings:report.findings||[],
    ...published
  });
  const attached=attachTargetIntegrity(report);
  const leakage=launchIntegrityFindings({page:report.page,environment,canonical:environment.canonicalContext,destinations:report.linkAudit?.destinations||[]});
  const correlated=finalizeCorrelatedFindings([...(attached.findings||[]),...leakage],attached);
  // Rebuild authoritative index control after correlation/leakage findings exist.
  const publishedFinal=mergePublishedIndexSignals(published,publishedIndexSignalsFromFindings(correlated));
  environment.indexControl=reconcileIndexControlWithFindings(
    buildIndexControl({page:report.page,...publishedFinal}),
    correlated
  );
  if(environment.indexability){
    environment.indexability.blocked=environment.indexControl.noindexDetected===true;
    environment.indexability.publishedBlocked=environment.indexControl.publishedMetaRobots?.noindex===true||environment.indexControl.xRobotsTag?.noindex===true;
    environment.indexability.renderedBlocked=environment.indexControl.metaRobots?.noindex===true;
    environment.indexability.mismatch=environment.indexControl.conflictingSignals===true;
    environment.indexability.assessment=environment.indexControl.assessment;
    environment.indexability.publishedKnown=environment.indexControl.publishedMetaRobots?.checked===true;
  }
  environment.notice=environmentNotice(environment,environment.indexControl);
  environment.publishedCoverage=buildPublishedCoverage({
    context:report.context||context||{},
    report,
    coverage:report.coverage||{},
    connectedMode:report.connectedMode||'',
    enrichmentError:report.connectedError||'',
    latencyMs:report.publishedCoverage?.latencyMs
  });
  if(!report.frankReview){
    report.frankReview=emptyFrankReview({
      modelReadiness:report.environment?.modelReadiness||'unavailable',
      reason:'not-requested'
    });
  }
  const performanceAssessment=buildPerformanceAssessment({
    browserPerformance:attached.browserPerformance||report.browserPerformance,
    findings:correlated,
    environment
  });
  environment.performanceAssessment=performanceAssessment;
  const policyFindings=applyFindingPolicy(correlated,environment);
  environment.presentationPolicy=presentationPolicySummary(policyFindings);
  const finalized=finalizeBlockedTargetReport({...attached,page:{...attached.page,platform:attached.page?.platform||null}},policyFindings);
  const findings=finalized.findings;
  // Attention is composed once here so every surface (panel, brief, markdown
  // export) reads the same grouped, cross-discipline view.
  const tCorr=(typeof performance!=='undefined'&&performance.now)?performance.now():Date.now();
  const announce=String(report.coverage?.links||'')!=='pending';
  if(announce)emitScanProgress('CORRELATING');
  const attention=composeReportAttention(findings,{limit:8});
  const next={...finalized,environment,page:{...finalized.page,environment},findings,performanceAssessment,attention:{groups:attention.groups.map(g=>({key:g.key,impactClass:g.impactClass,title:g.title,size:g.size,instanceCount:g.instanceCount,score:g.score,leadId:g.lead.id,selectors:g.selectors,instanceIds:g.instances.map(x=>x.id),rootCauseKey:g.lead.rootCauseKey||g.key,targetability:g.lead.targetability||'',lenses:g.lead.lenses||[]})),allGroups:(attention.allGroups||[]).map(g=>({key:g.key,impactClass:g.impactClass,title:g.title,size:g.size,instanceCount:g.instanceCount,score:g.score,leadId:g.lead?.id,targetability:g.lead?.targetability||'',confidence:g.lead?.confidence||'',ruleId:g.lead?.ruleId||''})),worthChecking:(attention.worthChecking||[]).map(w=>({key:w.key,title:w.title,scope:w.scope,lens:w.lens,fixOwner:w.fixOwner,size:w.size,instanceCount:w.instanceCount,findingIds:w.findings.map(f=>f.id)})),classCounts:attention.classCounts,materialGroupCount:attention.materialGroupCount,materialFindingCount:attention.materialFindingCount,representedClasses:attention.representedClasses,classLabels:Object.fromEntries(Object.entries(IMPACT_CLASSES).map(([k,v])=>[k,v.label]))},priorityBrief:finalized.priorityBrief||report.priorityBrief||null,targetIntegrityBlocked:finalized.targetIntegrityBlocked||false};
  next.coverageReasons=explainCoverageReasons(next);
  const reconciled=reconcilePerformanceCoverage(next);
  const tFrank=(typeof performance!=='undefined'&&performance.now)?performance.now():Date.now();
  if(announce)emitScanProgress('FRANK_ANALYZING');
  reconciled.evidenceLedger=buildEvidenceLedger(reconciled,{uiLimit:8,composition:attention,findings});
  if(!reconciled.priorityBrief)reconciled.priorityBrief=deterministicBrief(findings,{coverage:reconciled.coverage,linkAudit:reconciled.linkAudit,targetIntegrity:reconciled.page?.targetIntegrity});
  const frankReviewMs=Math.round(((typeof performance!=='undefined'&&performance.now)?performance.now():Date.now())-tFrank);
  const corrMs=Math.round(((typeof performance!=='undefined'&&performance.now)?performance.now():Date.now())-tCorr);
  reconciled.scanTimings={...(reconciled.scanTimings||{}),correlationMs:corrMs,frankReviewMs,totalMs:Number(reconciled.scanTimings?.totalMs||0)+corrMs};
  return reconciled;
}
function mergeGatewayReport(local,remote){
  if(!remote)return local;
  const browserPerformance = local.browserPerformance?.available
    ? local.browserPerformance
    : (remote.browserPerformance || local.browserPerformance);
  if(remote.linkAudit?.privilegedProbe==='gateway'){
    const mergedLinks=mergeGatewayLinkAudit(local,remote);
    return reconcilePerformanceCoverage({
      ...local,
      ...remote,
      page:{...(remote.page||{}),...(local.page||{}),environment:remote.page?.environment||local.page?.environment},
      findings:remote.findings||local.findings,
      linkAudit:mergedLinks.linkAudit,
      browserPerformance,
      coverage:{...(local.coverage||{}),...(remote.coverage||{}),links:mergedLinks.coverageLinks}
    });
  }
  const byId=new Map((local.findings||[]).map(f=>[f.id||f.fingerprint,f]));
  const findings=(remote.findings||[]).map(r=>{const l=byId.get(r.id||r.fingerprint);if(!l)return r;return{...r,selector:l.selector||r.selector,targetId:l.targetId||r.targetId,targetType:l.targetType||r.targetType,evidence:l.evidence??r.evidence,axe:l.axe,link:l.link||r.link,verification:r.verification||l.verification,embeddedContext:l.embeddedContext||r.embeddedContext,frameSelector:l.frameSelector||r.frameSelector,spotlightSafe:l.spotlightSafe??r.spotlightSafe,extra:{...(r.extra||{}),...(l.extra||{})}};});
  return reconcilePerformanceCoverage({
    ...local,
    ...remote,
    page:{...(remote.page||{}),...(local.page||{}),environment:remote.page?.environment||local.page?.environment},
    findings,
    linkAudit:local.linkAudit||remote.linkAudit,
    browserPerformance
  });
}
function snapshotFinding(f){return{fingerprint:f.fingerprint,ruleId:f.ruleId,title:f.title,detail:f.detail,category:f.category,severity:f.severity,confidence:f.confidence,selector:f.selector||'',sources:f.sources||[]}}
async function updateState(tab,report){
  const s=await settings(),key=pageKey(tab.url),u=new URL(tab.url),origin=u.origin,old=s.scanState[key]||{current:[],records:{}},ignored=s.ignoredRulesByOrigin[origin]||[];
  const actionable=report.findings.filter(f=>f.frankVisible!==false&&f.category!=='context'&&!ignored.includes(f.ruleId));
  const current=actionable.map(f=>f.fingerprint),fresh=current.filter(x=>!(old.current||[]).includes(x)),resolved=(old.current||[]).filter(x=>!current.includes(x)),oldRecords=old.records||{};
  const resolvedItems=resolved.map(fp=>oldRecords[fp]).filter(Boolean);
  report.findings=report.findings.map(f=>({...f,lifecycle:ignored.includes(f.ruleId)?'ignored':fresh.includes(f.fingerprint)?'new':'known'}));
  report.lifecycle={newCount:fresh.length,resolvedCount:resolved.length,ignoredRuleCount:ignored.length,resolved:resolvedItems};
  s.scanState[key]={current,records:Object.fromEntries(actionable.map(f=>[f.fingerprint,snapshotFinding(f)])),lastScan:new Date().toISOString()};
  const session=s.siteSessions[origin]||{origin,startedAt:new Date().toISOString(),pages:{}};
  session.updatedAt=new Date().toISOString();
  session.pages[u.pathname]={url:report.page.url,title:report.page.title||'',lastScan:session.updatedAt,materialCount:actionable.length,fixCount:actionable.filter(f=>f.category==='fix').length,reviewCount:actionable.filter(f=>f.category==='review').length,resolvedCount:resolved.length,environment:report.environment?.type||'unknown'};
  const pageRows=Object.entries(session.pages).sort((a,b)=>new Date(b[1].lastScan)-new Date(a[1].lastScan)).slice(0,50);session.pages=Object.fromEntries(pageRows);s.siteSessions[origin]=session;
  await chrome.storage.local.set({scanState:s.scanState,siteSessions:s.siteSessions});
  await chrome.action.setBadgeText({tabId:tab.id,text:fresh.length?String(Math.min(99,fresh.length)):''});await chrome.action.setBadgeBackgroundColor({tabId:tab.id,color:'#B3261E'});
}

async function scanExistingTab(tabId){if(!tabId)throw new Error('The inspected tab is no longer available.');let report;try{await chrome.tabs.sendMessage(tabId,{type:'PING'});report=await chrome.tabs.sendMessage(tabId,{type:'SCAN'})}catch{try{await ensureInjected(tabId);report=await chrome.tabs.sendMessage(tabId,{type:'SCAN'})}catch{throw new Error('This tab navigated or page access expired. Click the toolbar icon on the current page, or enable Watch this site for persistent rescans.')}}if(!report?.page?.url||!/^https?:/i.test(report.page.url))throw new Error('This browser page cannot be inspected. Open a normal HTTP or HTTPS page.');return contextualize(report)}
async function localScan(tab){if(!tab?.id)throw new Error('No active browser tab was found.');if(tab.url&&!/^https?:/i.test(tab.url))throw new Error('This browser page cannot be inspected. Open a normal HTTP or HTTPS page.');try{await ensureInjected(tab.id)}catch(error){const message=String(error?.message||error||'');if(/Cannot access|Missing host permission|activeTab|chrome:\/\/|edge:\/\/|about:/i.test(message))throw new Error('Page access expired. Click the toolbar icon on this page, then use Rescan normally.');throw error}let report=await chrome.tabs.sendMessage(tab.id,{type:'SCAN'});if(!report?.page?.url||!/^https?:/i.test(report.page.url))throw new Error('This browser page cannot be inspected. Open a normal HTTP or HTTPS page.');return contextualize(report)}
async function addLinkAudit(report,tabId,{privilegedExternal=true}={}){
  if(['complete','partial'].includes(report?.coverage?.links)&&report?.linkAudit&&!report?.externalLinkCandidates?.length)return report;if(!tabId)return report;
  try{
    const result=await chrome.tabs.sendMessage(tabId,{type:'AUDIT_LINKS'});
    let linkFindings=Array.isArray(result?.findings)?result.findings:[];
    const externalCandidateTotal=Array.isArray(result?.externalCandidates)?result.externalCandidates.length:0;
    const GATEWAY_EXTERNAL_CANDIDATE_CAP=80;
    const externalCandidates=Array.isArray(result?.externalCandidates)?result.externalCandidates.slice(0,GATEWAY_EXTERNAL_CANDIDATE_CAP):[];
    // Connected scans: leave external confirmation to the gateway (no broad host permission prompts).
    // Local-only / private pages: optional SW fetch only when host permission already exists — never request wildcards.
    const refinementStarted=Date.now();
    let applied={findings:[],incompleteChecks:[],resolvedUrls:[]};
    let probeRows=[];
    if(privilegedExternal&&externalCandidates.length){
      probeRows=new Array(externalCandidates.length);
      let cursor=0;
      const worker=async()=>{
        while(cursor<externalCandidates.length){
          const index=cursor++;
          const candidate=externalCandidates[index];
          const started=Date.now();
          const probeUrl=sanitizeExternalProbeUrl(candidate.url);
          if(!probeUrl){probeRows[index]={url:candidate.url,status:0,error:'destination-not-allowed',durationMs:0,method:'GET',attempts:0};continue}
          try{
            const first=await fetch(probeUrl,{method:'GET',redirect:'follow',credentials:'omit',cache:'no-store',signal:AbortSignal.timeout(4500)});
            const status=first.status;
            if(status===404||status===410||status>=500){
              const second=await fetch(probeUrl,{method:'GET',redirect:'follow',credentials:'omit',cache:'no-store',signal:AbortSignal.timeout(4500)});
              if(second.status!==status){
                probeRows[index]={url:candidate.url,status:0,error:'inconclusive-mismatch',finalUrl:first.url||probeUrl,redirected:Boolean(first.redirected),durationMs:Date.now()-started,method:'GET',attempts:2};
                continue;
              }
              probeRows[index]={url:candidate.url,status,finalUrl:second.url||first.url||probeUrl,redirected:Boolean(first.redirected||second.redirected),durationMs:Date.now()-started,method:'GET',attempts:2};
              continue;
            }
            probeRows[index]={url:candidate.url,status,finalUrl:first.url||probeUrl,redirected:Boolean(first.redirected),durationMs:Date.now()-started,method:'GET',attempts:1};
          }catch(error){
            probeRows[index]={url:candidate.url,status:0,error:String(error?.message||error),durationMs:Date.now()-started,method:'GET',attempts:1};
          }
        }
      };
      await Promise.all(Array.from({length:Math.min(4,externalCandidates.length)},()=>worker()));
      try{
        applied=await chrome.tabs.sendMessage(tabId,{type:'APPLY_EXTERNAL_LINK_PROBES',candidates:externalCandidates,rows:probeRows})||applied;
        if(Array.isArray(applied?.findings)&&applied.findings.length)linkFindings=[...linkFindings,...applied.findings];
      }catch{}
    }
    const refinementLinkMs=privilegedExternal&&externalCandidates.length?Date.now()-refinementStarted:0;
    const privilegedFallback=normalizePrivilegedFallback(null,{
      mode:privilegedExternal?(externalCandidates.length?'service-worker':(externalCandidateTotal?'queued':'none')):(externalCandidateTotal?'queued':'none'),
      eligible:externalCandidateTotal,
      attempted:privilegedExternal?((probeRows||[]).filter(row=>Number(row.attempts||0)>0).length):0,
      truncated:externalCandidateTotal>externalCandidates.length,
      resolved:Array.isArray(applied?.resolvedUrls)?applied.resolvedUrls.length:0,
      stillInconclusive:Array.isArray(applied?.incompleteChecks)?applied.incompleteChecks.length:Number(result?.inconclusive||0)
    });
    let next={
      ...report,
      findings:[...(report.findings||[]),...linkFindings],
      externalLinkCandidates:externalCandidates,
      externalLinkCandidateTotal:externalCandidateTotal,
      linkAudit:{
        discovered:Number(result?.discovered||0),
        eligible:Number(result?.eligible??result?.discovered??0),
        attempted:Number(result?.attempted??result?.checked??0),
        checked:Number(result?.attempted??result?.checked??0),
        verifiedHealthy:Number(result?.verifiedHealthy||0),
        confirmedIssues:Number(result?.confirmedIssues||0),
        inconclusive:Number(result?.inconclusive||0),
        unprobed:Number(result?.unprobed||0),
        explicitlySkipped:Number(result?.explicitlySkipped||0),
        scannerAborted:preserveScannerAborted(result?.scannerAborted),
        inconclusiveByCause:result?.inconclusiveByCause||undefined,
        incompleteChecks:Array.isArray(result?.incompleteChecks)?result.incompleteChecks:[],
        unprobedChecks:[...(result?.unprobedChecks||[])],
        limit:Number(result?.limit||0),
        reachedLimit:Boolean(result?.reachedLimit),
        cached:Number(result?.cached||0),
        probeBudgetReached:Boolean(result?.probeBudgetReached),
        probeBudgetPreventedCoverage:Boolean(result?.probeBudgetPreventedCoverage),
        queueMetrics:result?.queueMetrics||undefined,
        linksByOriginClass:result?.linksByOriginClass||undefined,
        hostDiagnostics:result?.hostDiagnostics||result?.queueMetrics?.hostDiagnostics||undefined,
        queueTerminationReason:result?.queueTerminationReason||result?.queueMetrics?.terminationReason||undefined,
        privilegedFallback,
        refinement:result?.refinement,
        linkExecution:result?.linkExecution||undefined
      }
    };
    if(privilegedExternal&&externalCandidates.length){
      const probedCount=(probeRows||[]).filter(row=>Number(row.attempts||0)>0&&String(row.error||'')!=='budget-exhausted').length;
      next=applyPrivilegedProbeAccounting(next,{
        applied,
        truncated:externalCandidateTotal>externalCandidates.length||probedCount<externalCandidates.length,
        candidateTotal:externalCandidateTotal,
        candidatesProbed:probedCount
      });
    }else{
      const finalized=finalizeLinkAudit(next.linkAudit,{unavailable:result?.status==='unavailable',privilegedFallback});
      next={...next,linkAudit:finalized.linkAudit,coverage:{...report.coverage,links:finalized.coverageStatus}};
    }
    const primaryLinkMs=Number(result?.primaryLinkMs||0);
    const inPageRefinementMs=Number(result?.refinementLinkMs||result?.linkExecution?.refinementMs||0);
    const inPageLinkMs=Number(result?.linkProbeMs||0)|| (primaryLinkMs+inPageRefinementMs);
    return{
      ...next,
      scanTimings:{
        ...(report.scanTimings||{}),
        linkProbeMs:inPageLinkMs+refinementLinkMs,
        primaryLinkMs:primaryLinkMs||inPageLinkMs,
        refinementLinkMs:inPageRefinementMs+refinementLinkMs,
        totalMs:Number(report.scanTimings?.totalMs||0)+inPageLinkMs+refinementLinkMs
      }
    };
  }catch{return{...report,linkAudit:{discovered:0,eligible:0,attempted:0,checked:0,verifiedHealthy:0,confirmedIssues:0,inconclusive:0,unprobed:0,explicitlySkipped:0,scannerAborted:0,incompleteChecks:[],unprobedChecks:[],probeBudgetReached:false,probeBudgetPreventedCoverage:false},coverage:{...report.coverage,links:'unavailable'}}}
}

async function fetchJson(url,options={},timeoutMs=GATEWAY_TIMEOUT_MS){const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),timeoutMs);try{const response=await fetch(url,{...options,signal:controller.signal}),text=await response.text();if(!text.trim())throw new Error(`empty response (HTTP ${response.status})`);let data;try{data=JSON.parse(text)}catch{throw new Error(`invalid JSON response (HTTP ${response.status})`)}if(!response.ok)throw Object.assign(new Error(data?.error||`HTTP ${response.status}`),{status:response.status,code:data?.code||''});return data}finally{clearTimeout(timer)}}
async function gatewayCandidates(){const s=await settings();if(s.apiBase)return[s.apiBase.replace(/\/$/,'')];return[...new Set([...LOCAL_APIS,LIVE_API].map(v=>v.replace(/\/$/,'')))]}
async function ensureInstallationId(){const s=await settings();if(s.installationId)return s.installationId;const id=(globalThis.crypto?.randomUUID?.()||`wqa_${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}`).replace(/[^A-Za-z0-9_-]/g,'_');await chrome.storage.local.set({installationId:id});return id}
async function registerManagedAccess(root){
  const installationId=await ensureInstallationId(),rid=requestId('REGISTER');
  const data=await fetchJson(root+'/api/install/register',{method:'POST',headers:{'content-type':'application/json','x-web-qa-request-id':rid},body:JSON.stringify({installationId,extensionVersion:RELEASE_VERSION})},8000);
  if(!data?.token)throw Object.assign(new Error('Gateway did not return a managed installation token.'),{code:'MANAGED_ACCESS_INVALID'});
  await chrome.storage.local.set({installToken:data.token,installTokenExpiresAt:Number(data.expiresAt||0)});
  return data.token;
}
async function gatewayCredential(root,{refresh=false}={}){
  const s=await settings();if(s.apiKey)return{token:s.apiKey,type:'shared'};
  const currentValid=s.installToken&&!refresh&&Number(s.installTokenExpiresAt||0)>Date.now()+60000;if(currentValid)return{token:s.installToken,type:'managed'};
  if(refresh||s.installToken)await chrome.storage.local.set({installToken:'',installTokenExpiresAt:0});
  try{return{token:await registerManagedAccess(root),type:'managed'}}catch{return{token:'',type:'none'}}
}
async function gatewayPost(path,payload,timeoutMs=GATEWAY_TIMEOUT_MS,operation='GATEWAY'){
  const errors=[],rid=requestId(operation);
  for(const root of await gatewayCandidates()){
    let credential=await gatewayCredential(root);
    for(let attempt=0;attempt<2;attempt++)try{
      const data=await fetchJson(root+path,{method:'POST',headers:{'content-type':'application/json','x-web-qa-request-id':rid,...(credential.token?{'x-web-qa-key':credential.token}:{})},body:JSON.stringify(payload)},timeoutMs);
      return{...data,gateway:root,requestId:data.requestId||rid,accessMode:credential.type};
    }catch(error){
      const status=Number(error?.status||0);
      if(status===401&&credential.type==='managed'&&attempt===0){credential=await gatewayCredential(root,{refresh:true});if(credential.token)continue}
      errors.push(`${root}: ${error?.name==='AbortError'?'timeout':error.message}`);
      if([401,403].includes(status)){error.gateway=root;throw error}
      break;
    }
  }
  throw new Error(errors.join(' | ')||'No assistant gateway is available.');
}
// Reachability and authorisation are different failures with different fixes, so
// they are reported separately. /api/health is public by design; only
// /api/health/integrations proves the access key is accepted.
async function testGateway(overrides={}){
  const stored=await settings(),apiBase=overrides.apiBase!==undefined?String(overrides.apiBase||'').trim():stored.apiBase,manualKey=overrides.apiKey!==undefined?String(overrides.apiKey||'').trim():stored.apiKey,root=(apiBase||LIVE_API).replace(/\/$/,''),rid=requestId('HEALTH');
  let credential={token:manualKey,type:manualKey?'shared':'none'};
  if(!manualKey)credential=await gatewayCredential(root);
  const headers={'x-web-qa-request-id':rid,...(credential.token?{'x-web-qa-key':credential.token}:{})};
  let health=null,reachable=false,reachError='';
  try{health=await fetchJson(root+'/api/health',{headers},7000);reachable=true}
  catch(error){reachError=String(error?.message||error)}
  if(!reachable)return{gateway:root,reachable:false,auth:'unknown',health:null,integrations:null,summary:`Gateway did not respond: ${reachError}`,requestId:rid};
  let integrations=null,auth=credential.type==='managed'?'managed':credential.type==='shared'?'accepted':'open',authError='';
  try{integrations=await fetchJson(root+`/api/health/integrations${overrides.cloudAiFallback?'?cloud=1':''}`,{headers},10000)}
  catch(error){
    const status=Number(error?.status||0);
    if(status===401&&credential.type==='managed'){
      credential=await gatewayCredential(root,{refresh:true});
      if(credential.token)try{integrations=await fetchJson(root+`/api/health/integrations${overrides.cloudAiFallback?'?cloud=1':''}`,{headers:{'x-web-qa-request-id':rid,'x-web-qa-key':credential.token}},10000);auth='managed'}catch(retry){authError=String(retry?.message||retry);auth='rejected'}
      else auth='required';
    }else if(status===401)auth=manualKey?'rejected':'required';
    else{auth='unknown';authError=String(error?.message||error)}
  }
  const rows=Object.values(integrations?.integrations||{}),available=rows.filter(x=>x?.status==='available').length,problems=rows.filter(x=>x&&x.status!=='available').map(x=>`${x.label}: ${x.status}`);
  const accessLabel=auth==='managed'?'managed installation access':auth==='accepted'?'developer access key':'open access';
  const summary=auth==='rejected'?'Gateway is reachable, but assistant access was rejected.'
    :auth==='required'?'Gateway is reachable, but assistant access could not be established automatically. A developer access key may be required.'
    :auth==='unknown'&&authError?`Gateway is reachable. Integration health could not be read: ${authError}`
    :`Gateway reachable, v${health?.version||'unknown'}, ${accessLabel}${rows.length?`, ${available}/${rows.length} integrations available`:''}.`;
  return{gateway:root,reachable:true,auth,health,integrations,available,integrationCount:rows.length,problems,summary,requestId:health?.requestId||rid};
}

function localOnlyCoverage(report){
  const base={...report.coverage,published:'local-only',wcag:'local-only',ai:'local-only'};
  // Preserve current-page lab evidence; connector absence must not erase it.
  base.performance=resolvePerformanceCoverage(base,report.browserPerformance,{status:'not_applicable'})==='current-page'
    ?'current-page'
    :resolvePerformanceCoverage(base,report.browserPerformance,null)==='current-page'
      ?'current-page'
      :'local-only';
  return base;
}
async function enrich(report,tabId=null){
  const privatePage=isPrivateHost(report.page?.hostname||'');
  // Connected public pages: content-script audit only; gateway performs privileged external probes.
  report=await addLinkAudit(report,tabId,{privilegedExternal:privatePage});report=await contextualize(report);
  if(privatePage){const coverage=localOnlyCoverage(report);const next={...report,coverage,priorityBrief:'Local inspection complete. Frank is using browser and accessibility evidence only; connected services are intentionally disabled for this private environment.',priorityMode:'deterministic',connectedMode:'local-only',context:{performance:null,services:{}}};next.publishedCoverage=buildPublishedCoverage({report:next,coverage,connectedMode:'local-only',attempted:false});next.frankReview=emptyFrankReview({reason:'not-requested'});next.guidanceSource=scanGuidanceSource({hasVisibleGuidance:true,priorityMode:'deterministic',coverageAi:coverage.ai,frankReview:next.frankReview});next.coverageReasons=explainCoverageReasons(next,{publishedReason:next.publishedCoverage.reason});return next}
  const publishedStarted=Date.now();
  try{
    const result=await gatewayPost('/api/context',gatewayContextEnvelope(report),22000,'CONTEXT');
    const latencyMs=Date.now()-publishedStarted;
    if(result?.report){
      const merged=mergeGatewayReport(report,result.report);
      const contextual=await contextualize(merged,result.report.context||result.report.context?.services||null);
      const next={...contextual,aiGateway:result.gateway,requestId:result.requestId,connectedMode:'gateway'};
      next.publishedCoverage=buildPublishedCoverage({
        context:next.context||result.report.context||{},
        report:next,
        coverage:next.coverage||{},
        connectedMode:'gateway',
        latencyMs,
        attempted:true
      });
      next.frankReview=emptyFrankReview({reason:'not-requested'});
      next.guidanceSource=scanGuidanceSource({hasVisibleGuidance:true,priorityMode:next.priorityMode||'deterministic',coverageAi:next.coverage?.ai,frankReview:next.frankReview});
      next.coverageReasons=explainCoverageReasons(next,{publishedReason:next.publishedCoverage.reason});
      return next;
    }
  }catch(error){
    const s=await settings(),status=Number(error?.status||0),connectedMode=status===401?((s.apiKey||s.installToken)?'auth-rejected':'auth-required'):status===403?'auth-rejected':'unavailable';
    const labPerf=resolvePerformanceCoverage(report.coverage||{},report.browserPerformance,null);
    const coverage={
      ...report.coverage,
      published:'unavailable',
      performance:labPerf==='current-page'||labPerf==='partial'?labPerf:'unavailable',
      wcag:'unavailable',
      ai:'deterministic'
    };
    const connectedError=connectedMode==='auth-required'?'The assistant gateway requires an access key.':connectedMode==='auth-rejected'?'The saved assistant access key was rejected.':String(error?.message||error);
    const next={...report,coverage,priorityBrief:deterministicBrief(report.findings,{coverage,linkAudit:report.linkAudit,targetIntegrity:report.page?.targetIntegrity}),priorityMode:'deterministic',connectedMode,connectedError,context:{performance:null,services:{}}};
    next.publishedCoverage=buildPublishedCoverage({report:next,coverage,connectedMode,enrichmentError:connectedError,latencyMs:Date.now()-publishedStarted,attempted:true});
    next.frankReview=emptyFrankReview({reason:'not-requested'});
    next.guidanceSource=scanGuidanceSource({hasVisibleGuidance:true,priorityMode:'deterministic',coverageAi:'deterministic',frankReview:next.frankReview});
    next.coverageReasons=explainCoverageReasons(next,{enrichmentFailed:true,rendererTimeout:/timed out|timeout/i.test(String(error?.message||'')),publishedReason:next.publishedCoverage.reason});
    return next;
  }
  return report;
}
async function targetContext(tabId,targetId,selector,ruleId=''){if(!tabId||(!targetId&&!selector))return null;try{const result=await chrome.tabs.sendMessage(tabId,{type:'TARGET_CONTEXT',targetId,selector,ruleId});return result?.found?result:null}catch{return null}}
async function prepareFrank({finding,report,tabId,instances=[],selectedInstanceId='',groupTitle=''}){
  if(!finding||!report?.page)throw new Error('Frank needs a current finding and scan report.');
  const inspectedTabId=tabId||(await activeTab())?.id;if(!inspectedTabId)throw new Error('The inspected browser tab is no longer available.');
  try{await chrome.tabs.sendMessage(inspectedTabId,{type:'PING'})}catch{await ensureInjected(inspectedTabId)}
  let sourceReport=report;
  if(!isPrivateHost(report.page.hostname||'')&&(!report.context?.services||Object.keys(report.context.services).length===0)){try{sourceReport=await enrich(report,inspectedTabId)}catch{}}
  const target=finding.targetType==='visual'?await targetContext(inspectedTabId,finding.targetId,finding.selector,finding.ruleId):null;
  const latestFinding=sourceReport.findings?.find(x=>x.id===finding.id)||finding;
  const groupInstances=instances.length
    ? instances
    : (sourceReport.findings||[]).filter(x=>x.rootCauseKey&&latestFinding.rootCauseKey&&x.rootCauseKey===latestFinding.rootCauseKey);
  const graph=buildEvidenceGraph({
    finding:latestFinding,
    page:sourceReport.page,
    coverage:sourceReport.coverage,
    context:sourceReport.context||{},
    targetContext:target,
    environment:sourceReport.environment||sourceReport.page?.environment,
    evidenceLedger:sourceReport.evidenceLedger||null,
    linkAudit:sourceReport.linkAudit||null,
    instances:groupInstances,
    selectedInstanceId:selectedInstanceId||finding.id,
    groupCount:groupInstances.length||Number(latestFinding.count||1),
    groupTitle:groupTitle||finding.title,
    performanceAssessment:sourceReport.performanceAssessment||sourceReport.environment?.performanceAssessment||null
  });
  const plan=deterministicFrankPlan(graph);
  return{plan,graph,tabId:inspectedTabId,reasoning:{status:'ready',mode:'deterministic',provider:'deterministic',message:'Verified deterministic guidance is ready for optional on-device improvement.'}};
}
async function cloudFrankPlan({graph}){
  if(!graph?.finding||!graph?.page)throw new Error('Frank needs a prepared evidence graph.');
  if(isPrivateHost(graph.page.hostname||''))return{plan:null,reasoning:{status:'disabled',mode:'deterministic',provider:'openai',code:'PRIVATE_PAGE',message:'Cloud AI is disabled for private pages.'}};
  try{
    const result=await gatewayPost('/api/frank/plan',{graph:gatewayFrankGraph(graph)},FRANK_TIMEOUT_MS,'FRANK');
    if(result?.plan&&validateFrankPlan(result.plan,graph))return{plan:result.plan,gateway:result.gateway||'',reasoning:result.reasoning||{status:result.plan.mode==='ai'?'operational':'fallback',mode:result.plan.mode,provider:'openai',message:result.plan.mode==='ai'?'Cloud reasoning completed.':'The gateway returned deterministic guidance.'}};
    return{plan:null,reasoning:{status:'fallback',mode:'deterministic',provider:'openai',code:'INVALID_GATEWAY_PLAN',message:'The cloud fallback returned a walkthrough that did not pass local validation.'}};
  }catch(error){return{plan:null,reasoning:{status:'fallback',mode:'deterministic',provider:'openai',code:error?.code||'GATEWAY_FRANK_FAILED',message:String(error?.message||'Cloud reasoning could not be reached.').slice(0,240)}}}
}
async function startFrankPlan({plan,graph,tabId,reasoning=null}){
  if(!plan||!graph||!validateFrankPlan(plan,graph))throw new Error('Frank refused to start an invalid walkthrough plan.');
  const inspectedTabId=tabId||(await activeTab())?.id;if(!inspectedTabId)throw new Error('The inspected browser tab is no longer available.');
  const coachPlan=withCoachMetrics(plan,graph);
  const start=await chrome.tabs.sendMessage(inspectedTabId,{type:'FRANK_START',plan:coachPlan,targets:graph.targets,reasoning});if(!start?.started)throw new Error('Frank could not start on the inspected page.');
  return{started:true,tabId:inspectedTabId};
}
// Backwards-compatible message for older side panels: deterministic only. New
// 1.6.0 panels use PREPARE_FRANK, run Chrome built-in AI locally, then call
// FRANK_START_PLAN with the locally validated plan.
async function askFrank(message){const prepared=await prepareFrank(message);await startFrankPlan({plan:prepared.plan,graph:prepared.graph,tabId:prepared.tabId,reasoning:prepared.reasoning});return prepared}
async function recheckFinding({finding,tabId}){
  if(!finding||!tabId)throw new Error('A current finding and inspected tab are required.');
  if(finding.link?.url){
    const result=await chrome.tabs.sendMessage(tabId,{type:'RECHECK_LINK',url:finding.link.url});
    if(result?.verificationState==='healthy')return{state:'resolved',message:`Resolved. ${new URL(finding.link.url).pathname} now responds successfully.`,result};
    if(result?.verificationState==='confirmed-failure')return{state:'still-present',message:`Still present. The destination remains a confirmed ${result.status||'failure'}.`,result};
    return{state:'inconclusive',message:'Recheck was inconclusive. Frank is not treating that as proof the issue remains.',result};
  }
  let current=await scanExistingTab(tabId);current=await enrich(current,tabId);
  const match=(current.findings||[]).find(x=>(x.id&&finding.id&&x.id===finding.id)||(x.ruleId===finding.ruleId&&(x.selector||'')===(finding.selector||'')));
  return match?{state:'still-present',message:'Still present in the current verified scan.',finding:match}:{state:'resolved',message:'Resolved. The current verified scan no longer reproduces this finding.'};
}
async function frankMessage(tabId,message){if(!tabId)throw new Error('The inspected browser tab is no longer available.');return chrome.tabs.sendMessage(tabId,message)}
async function scanWatched(tab){try{const local=await localScan(tab);await chrome.tabs.sendMessage(tab.id,{type:'ENABLE_WATCH'}).catch(()=>{});const report=await enrich(local,tab.id);await updateState({id:tab.id,url:report.page.url},report)}catch{}}
function scheduleWatched(tab){clearTimeout(dirtyTimers.get(tab.id));dirtyTimers.set(tab.id,setTimeout(()=>scanWatched(tab),900))}
