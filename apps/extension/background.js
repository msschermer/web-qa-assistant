import { deterministicBrief } from './correlate.js';
import { buildEvidenceGraph } from './frank-evidence.js';
import { deterministicFrankPlan, validateFrankPlan } from './frank-plan.js';
import { classifyEnvironment } from './environment.js';
import { applyFindingPolicy } from './policy.js';
import { composeAttention } from './compose.js';
import { IMPACT_CLASSES } from './impact.js';
import { gatewayContextEnvelope, gatewayFrankGraph } from './evidence-contract.js';

const LIVE_API = 'https://assistant.msschermer.us';
const LOCAL_APIS = ['http://localhost:3000', 'http://localhost:8787'];
const GATEWAY_TIMEOUT_MS = 10000;
const FRANK_TIMEOUT_MS = 16000;
const dirtyTimers = new Map();
const RELEASE_VERSION = '1.5.1';

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
chrome.action.onClicked.addListener(tab=>{if(!tab?.windowId)return;chrome.sidePanel.open({windowId:tab.windowId}).catch(()=>{});chrome.runtime.sendMessage({type:'ACTION_INVOKED',tabId:tab.id}).catch(()=>{})});

async function settings(){return chrome.storage.local.get({apiBase:'',apiKey:'',watchedOrigins:[],scanState:{},siteSessions:{},ignoredRulesByOrigin:{},environmentOverridesByOrigin:{}})}
async function ensureInjected(tabId){try{await chrome.tabs.sendMessage(tabId,{type:'PING'});return}catch{}await chrome.scripting.executeScript({target:{tabId},files:['vendor/axe.min.js','image-purpose.js','browser-rules.js','content.js']})}
async function activeTab(){return(await chrome.tabs.query({active:true,currentWindow:true}))[0]}
function pageKey(url){const u=new URL(url);return u.origin+u.pathname}
function isPrivateHost(host){const h=String(host||'').toLowerCase();if(h==='localhost'||h.endsWith('.local')||h.endsWith('.internal'))return true;if(/^127\./.test(h)||/^10\./.test(h)||/^192\.168\./.test(h)||/^169\.254\./.test(h))return true;const m=/^172\.(\d+)\./.exec(h);return!!(m&&Number(m[1])>=16&&Number(m[1])<=31)}
async function contextualize(report,context=null){
  if(!report?.page?.url)return report;const s=await settings(),origin=new URL(report.page.url).origin,override=s.environmentOverridesByOrigin?.[origin]||'',monitored=context?.performance?.data?.monitored===true||context?.performance?.monitored===true;
  const environment=classifyEnvironment(report.page,{override,canonical:report.page.canonical,monitored});environment.pathname=new URL(report.page.url).pathname;
  const findings=applyFindingPolicy(report.findings||[],environment);
  // Attention is composed once here so every surface (panel, brief, markdown
  // export) reads the same grouped, cross-discipline view.
  const attention=composeAttention(findings,{limit:8});
  return{...report,environment,page:{...report.page,environment},findings,attention:{groups:attention.groups.map(g=>({key:g.key,impactClass:g.impactClass,title:g.title,size:g.size,instanceCount:g.instanceCount,score:g.score,leadId:g.lead.id,selectors:g.selectors,instanceIds:g.instances.map(x=>x.id)})),classCounts:attention.classCounts,materialGroupCount:attention.materialGroupCount,materialFindingCount:attention.materialFindingCount,representedClasses:attention.representedClasses,classLabels:Object.fromEntries(Object.entries(IMPACT_CLASSES).map(([k,v])=>[k,v.label]))}};
}
function mergeGatewayReport(local,remote){
  if(!remote)return local;const byId=new Map((local.findings||[]).map(f=>[f.id||f.fingerprint,f]));
  const findings=(remote.findings||[]).map(r=>{const l=byId.get(r.id||r.fingerprint);if(!l)return r;return{...r,selector:l.selector||r.selector,targetId:l.targetId||r.targetId,targetType:l.targetType||r.targetType,evidence:l.evidence??r.evidence,axe:l.axe,link:l.link||r.link,verification:r.verification||l.verification};});
  return{...local,...remote,page:{...(remote.page||{}),...(local.page||{}),environment:remote.page?.environment||local.page?.environment},findings,linkAudit:local.linkAudit||remote.linkAudit};
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
async function addLinkAudit(report,tabId){
  if(['complete','partial'].includes(report?.coverage?.links)&&report?.linkAudit)return report;if(!tabId)return report;
  try{const result=await chrome.tabs.sendMessage(tabId,{type:'AUDIT_LINKS'}),linkFindings=Array.isArray(result?.findings)?result.findings:[],incompleteChecks=Array.isArray(result?.incompleteChecks)?result.incompleteChecks:[],status=result?.status==='unavailable'?'unavailable':incompleteChecks.length?'partial':'complete';return{...report,findings:[...(report.findings||[]),...linkFindings],linkAudit:{checked:Number(result?.checked||0),verifiedHealthy:Number(result?.verifiedHealthy||0),confirmedIssues:Number(result?.confirmedIssues||linkFindings.length),inconclusive:Number(result?.inconclusive||incompleteChecks.length),incompleteChecks,limit:Number(result?.limit||0),reachedLimit:Boolean(result?.reachedLimit),degraded:Boolean(result?.degraded),cached:Number(result?.cached||0)},coverage:{...report.coverage,links:status}}}catch{return{...report,linkAudit:{checked:0,verifiedHealthy:0,confirmedIssues:0,inconclusive:0,incompleteChecks:[]},coverage:{...report.coverage,links:'unavailable'}}}
}

async function fetchJson(url,options={},timeoutMs=GATEWAY_TIMEOUT_MS){const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),timeoutMs);try{const response=await fetch(url,{...options,signal:controller.signal}),text=await response.text();if(!text.trim())throw new Error(`empty response (HTTP ${response.status})`);let data;try{data=JSON.parse(text)}catch{throw new Error(`invalid JSON response (HTTP ${response.status})`)}if(!response.ok)throw Object.assign(new Error(data?.error||`HTTP ${response.status}`),{status:response.status});return data}finally{clearTimeout(timer)}}
async function gatewayCandidates(){const s=await settings();if(s.apiBase)return[s.apiBase.replace(/\/$/,'')];return[...new Set([...LOCAL_APIS,LIVE_API].map(v=>v.replace(/\/$/,'')))]}
async function gatewayPost(path,payload,timeoutMs=GATEWAY_TIMEOUT_MS,operation='GATEWAY'){
  const s=await settings(),errors=[],rid=requestId(operation);
  for(const root of await gatewayCandidates())try{const data=await fetchJson(root+path,{method:'POST',headers:{'content-type':'application/json','x-web-qa-request-id':rid,...(s.apiKey?{'x-web-qa-key':s.apiKey}:{})},body:JSON.stringify(payload)},timeoutMs);return{...data,gateway:root,requestId:data.requestId||rid}}catch(error){errors.push(`${root}: ${error?.name==='AbortError'?'timeout':error.message}`);if([401,403].includes(Number(error?.status||0))){error.gateway=root;throw error}}
  throw new Error(errors.join(' | ')||'No assistant gateway is available.');
}
// Reachability and authorisation are different failures with different fixes, so
// they are reported separately. /api/health is public by design; only
// /api/health/integrations proves the access key is accepted.
async function testGateway(overrides={}){
  const stored=await settings(),apiBase=overrides.apiBase!==undefined?String(overrides.apiBase||'').trim():stored.apiBase,apiKey=overrides.apiKey!==undefined?String(overrides.apiKey||'').trim():stored.apiKey,root=(apiBase||LIVE_API).replace(/\/$/,''),rid=requestId('HEALTH');
  const headers={'x-web-qa-request-id':rid,...(apiKey?{'x-web-qa-key':apiKey}:{})};
  let health=null,reachable=false,reachError='';
  try{health=await fetchJson(root+'/api/health',{headers},7000);reachable=true}
  catch(error){reachError=String(error?.message||error)}
  if(!reachable)return{gateway:root,reachable:false,auth:'unknown',health:null,integrations:null,summary:`Gateway did not respond: ${reachError}`,requestId:rid};
  let integrations=null,auth='open',authError='';
  try{integrations=await fetchJson(root+'/api/health/integrations',{headers},9000);auth=apiKey?'accepted':'open'}
  catch(error){
    const status=Number(error?.status||0);
    if(status===401)auth=apiKey?'rejected':'required';
    else{auth='unknown';authError=String(error?.message||error)}
  }
  const rows=Object.values(integrations?.integrations||{});
  const available=rows.filter(x=>x?.status==='available').length;
  const problems=rows.filter(x=>x&&x.status!=='available').map(x=>`${x.label}: ${x.status}`);
  const summary=auth==='rejected'?'Gateway is reachable, but the access key was rejected. Check the key value.'
    :auth==='required'?'Gateway is reachable, but it is protected and no access key is saved.'
    :auth==='unknown'&&authError?`Gateway is reachable. Integration health could not be read: ${authError}`
    :`Gateway reachable, v${health?.version||'unknown'}, ${health?.aiConfigured?'AI configured':'standard guidance'}${rows.length?`, ${available}/${rows.length} integrations available`:''}.`;
  return{gateway:root,reachable:true,auth,health,integrations,available,integrationCount:rows.length,problems,summary,requestId:health?.requestId||rid};
}
function localOnlyCoverage(report){return{...report.coverage,published:'local-only',performance:'local-only',wcag:'local-only',ai:'local-only'}}
async function enrich(report,tabId=null){
  report=await addLinkAudit(report,tabId);report=await contextualize(report);
  if(isPrivateHost(report.page?.hostname||'')){const coverage=localOnlyCoverage(report);return{...report,coverage,priorityBrief:'Local inspection complete. Frank is using browser and accessibility evidence only; connected services are intentionally disabled for this private environment.',priorityMode:'deterministic',connectedMode:'local-only',context:{performance:null,services:{}}}}
  try{
    const result=await gatewayPost('/api/context',gatewayContextEnvelope(report),22000,'CONTEXT');
    if(result?.report){const merged=mergeGatewayReport(report,result.report),contextual=await contextualize(merged,result.report.context?.services?.performance);return{...contextual,aiGateway:result.gateway,requestId:result.requestId,connectedMode:'gateway'}}
  }catch(error){
    const s=await settings(),status=Number(error?.status||0),connectedMode=status===401?(s.apiKey?'auth-rejected':'auth-required'):status===403?'auth-rejected':'unavailable';
    const coverage={...report.coverage,published:'unavailable',performance:'unavailable',wcag:'unavailable',ai:'deterministic'};
    const connectedError=connectedMode==='auth-required'?'The assistant gateway requires an access key.':connectedMode==='auth-rejected'?'The saved assistant access key was rejected.':String(error?.message||error);
    return{...report,coverage,priorityBrief:deterministicBrief(report.findings,{coverage,linkAudit:report.linkAudit}),priorityMode:'deterministic',connectedMode,connectedError,context:{performance:null,services:{}}};
  }
  return report;
}
async function targetContext(tabId,targetId,selector,ruleId=''){if(!tabId||(!targetId&&!selector))return null;try{const result=await chrome.tabs.sendMessage(tabId,{type:'TARGET_CONTEXT',targetId,selector,ruleId});return result?.found?result:null}catch{return null}}
async function askFrank({finding,report,tabId}){
  if(!finding||!report?.page)throw new Error('Frank needs a current finding and scan report.');const inspectedTabId=tabId||(await activeTab())?.id;if(!inspectedTabId)throw new Error('The inspected browser tab is no longer available.');try{await chrome.tabs.sendMessage(inspectedTabId,{type:'PING'})}catch{await ensureInjected(inspectedTabId)}
  let sourceReport=report;if(!isPrivateHost(report.page.hostname||'')&&(!report.context?.services||Object.keys(report.context.services).length===0)){try{sourceReport=await enrich(report,inspectedTabId)}catch{}}
  const target=finding.targetType==='visual'?await targetContext(inspectedTabId,finding.targetId,finding.selector,finding.ruleId):null,latestFinding=sourceReport.findings?.find(x=>x.id===finding.id)||finding;
  const graph=buildEvidenceGraph({finding:latestFinding,page:sourceReport.page,coverage:sourceReport.coverage,context:sourceReport.context||{},targetContext:target,environment:sourceReport.environment||sourceReport.page?.environment});let plan=deterministicFrankPlan(graph),gateway='';
  if(!isPrivateHost(sourceReport.page.hostname||''))try{const result=await gatewayPost('/api/frank/plan',{graph:gatewayFrankGraph(graph)},FRANK_TIMEOUT_MS,'FRANK');if(result?.plan&&validateFrankPlan(result.plan,graph)){plan=result.plan;gateway=result.gateway||''}}catch{}
  const start=await chrome.tabs.sendMessage(inspectedTabId,{type:'FRANK_START',plan,targets:graph.targets});if(!start?.started)throw new Error('Frank could not start on the inspected page.');return{plan,graph,tabId:inspectedTabId,gateway,aiMode:plan.mode};
}
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

chrome.runtime.onMessage.addListener((msg,sender,send)=>{(async()=>{
  if(msg.type==='SCAN_ACTIVE'){const current=await activeTab(),report=await localScan(current);return{tab:{id:current.id,windowId:current.windowId,url:report.page.url},report}}
  if(msg.type==='SCAN_TAB'){const report=await scanExistingTab(msg.tabId);return{tab:{id:msg.tabId,url:report.page.url},report}}
  if(msg.type==='ENRICH'){const enriched=await enrich(msg.report,msg.tabId||null);if(msg.tabId&&enriched?.page?.url)await updateState({id:msg.tabId,url:enriched.page.url},enriched);return{report:enriched}}
  if(msg.type==='ASK_FRANK')return askFrank(msg);
  if(msg.type==='RECHECK_FINDING')return recheckFinding(msg);
  if(msg.type==='FRANK_GOTO')return frankMessage(msg.tabId,{type:'FRANK_GOTO',index:msg.index});
  if(msg.type==='FRANK_END')return frankMessage(msg.tabId,{type:'FRANK_END'});
  if(msg.type==='FRANK_PREVIEW')return frankMessage(msg.tabId,{type:'FRANK_PREVIEW',targetId:msg.targetId,preview:msg.preview});
  if(msg.type==='FRANK_RESET_PREVIEW')return frankMessage(msg.tabId,{type:'FRANK_RESET_PREVIEW'});
  if(msg.type==='HIGHLIGHT'){const tabId=msg.tabId||(await activeTab())?.id;if(!tabId)throw new Error('No inspected browser tab was found.');try{await chrome.tabs.sendMessage(tabId,{type:'PING'})}catch{try{await ensureInjected(tabId)}catch{throw new Error('Page access expired. Click the toolbar icon on this page and try Highlight again.')}}return chrome.tabs.sendMessage(tabId,{type:'HIGHLIGHT',targetId:msg.targetId,selector:msg.selector})}
  if(msg.type==='GET_ACTIVE')return{tab:await activeTab(),settings:await settings()};
  if(msg.type==='GET_SITE_SESSION'){const s=await settings(),url=msg.pageUrl||(await activeTab())?.url;if(!url)return{session:null};return{session:s.siteSessions[new URL(url).origin]||null}}
  if(msg.type==='CLEAR_SITE_SESSION'){const s=await settings(),url=msg.pageUrl||(await activeTab())?.url;if(url){delete s.siteSessions[new URL(url).origin];await chrome.storage.local.set({siteSessions:s.siteSessions})}return{cleared:true}}
  if(msg.type==='SAVE_GATEWAY_SETTINGS'){const apiBase=String(msg.apiBase||'').trim().replace(/\/$/,''),apiKey=String(msg.apiKey||'').trim();if(apiBase&&!/^https?:\/\//i.test(apiBase))throw new Error('Gateway URL must use HTTP or HTTPS.');await chrome.storage.local.set({apiBase,apiKey});return{saved:true}}
  if(msg.type==='TEST_GATEWAY')return testGateway({apiBase:msg.apiBase,apiKey:msg.apiKey});
  if(msg.type==='IGNORE_RULE'){const current=await activeTab(),s=await settings(),url=msg.pageUrl||current?.url;if(!url)throw new Error('Page context is unavailable.');const origin=new URL(url).origin,list=s.ignoredRulesByOrigin[origin]||[];s.ignoredRulesByOrigin[origin]=[...new Set([...list,msg.ruleId])];await chrome.storage.local.set({ignoredRulesByOrigin:s.ignoredRulesByOrigin});return{ignored:true}}
  if(msg.type==='SET_ENVIRONMENT'){const url=msg.pageUrl||(await activeTab())?.url;if(!url)throw new Error('Page context is unavailable.');const origin=new URL(url).origin,allowed=new Set(['production','staging','preview','local','auto']);if(!allowed.has(msg.environment))throw new Error('Unsupported environment value.');const s=await settings();if(msg.environment==='auto')delete s.environmentOverridesByOrigin[origin];else s.environmentOverridesByOrigin[origin]=msg.environment;await chrome.storage.local.set({environmentOverridesByOrigin:s.environmentOverridesByOrigin});return{saved:true}}
  if(msg.type==='WATCH_DIRTY'&&sender.tab){const s=await settings(),origin=new URL(sender.tab.url).origin;if(s.watchedOrigins.includes(origin))scheduleWatched(sender.tab);return{scheduled:true}}
  return null;
})().then(x=>send({ok:true,...x})).catch(error=>{console.error(`[Web QA Assistant ${RELEASE_VERSION}] ${msg?.type||'UNKNOWN'} failed`,error);send({ok:false,...failurePayload(error,msg?.type||'UNKNOWN')})});return true});

chrome.tabs.onUpdated.addListener(async(tabId,change,updatedTab)=>{if(change.status!=='complete'||!/^https?:/i.test(updatedTab.url||''))return;const s=await settings();let origin;try{origin=new URL(updatedTab.url).origin}catch{return}if(s.watchedOrigins.includes(origin))await scanWatched(updatedTab)});
