const DROP_KEY=/(cookie|password|secret|credential|authorization|api[-_]?key|access[-_]?key|token|form[-_]?value|raw[-_]?dom|html|selector)/i;
const PAGE_TEXT_KEY=/(page[-_]?text|target[-_]?text|model[-_]?output|prompt|completion)/i;
const SAFE_CONTEXT_KINDS=new Set(['contrast-ratio','contrast-required','foreground-color','background-color','font-size','font-weight','target-width','target-height','target-minimum','target-spacing','target-spacing-required','http-status','link-occurrences','environment','confidence','verification-method','mobile-score','desktop-score','threshold','mobile-change','desktop-change','lcp','ttfb','transfer-bytes','transfer-count']);
function clip(v,max=420){const s=String(v??'').replace(/\s+/g,' ').trim();return s.length>max?`${s.slice(0,max-1)}…`:s}
function redactText(value,max=420){
  let s=clip(value,max);
  s=s.replace(/https?:\/\/[^\s"'<>]+/gi,m=>{try{const u=new URL(m);return `${u.origin}${u.pathname}`}catch{return'[url]'}});
  s=s.replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi,'[email]');
  s=s.replace(/\b(?:\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]\d{3}[-.\s]\d{4}\b/g,'[phone]');
  s=s.replace(/\bBearer\s+[A-Za-z0-9._~+\/=-]{10,}\b/gi,'Bearer [credential]');
  s=s.replace(/\b(?:sk|pk|key|token)[-_][A-Za-z0-9_-]{12,}\b/gi,'[credential]');
  s=s.replace(/\b(?:AIza[A-Za-z0-9_-]{20,}|ghp_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|xox[baprs]-[A-Za-z0-9-]{12,}|AKIA[A-Z0-9]{16})\b/g,'[credential]');
  return s;
}
function sanitize(value,{includePageText=false,depth=0}={}){
  if(depth>5)return'[truncated]';
  if(value==null||typeof value==='boolean'||typeof value==='number')return value;
  if(typeof value==='string')return redactText(value);
  if(Array.isArray(value))return value.slice(0,30).map(v=>sanitize(v,{includePageText,depth:depth+1}));
  if(typeof value==='object'){
    const out={};
    for(const [key,val] of Object.entries(value)){
      if(DROP_KEY.test(key))continue;
      if(!includePageText&&PAGE_TEXT_KEY.test(key))continue;
      out[key]=sanitize(val,{includePageText,depth:depth+1});
    }
    return out;
  }
  return redactText(value);
}
const TRACE_KEYS=new Set(['status','progress','code','fromUserGesture','priorStatus','name','ruleId','impactClass','confidence','provider','mode','stepCount','hasTab','findingCount','materialGroupCount','representedClasses','connectedMode','includeContext','reachable','auth','problems']);
function sanitizeTraceData(data={}){const out={};for(const [key,value] of Object.entries(data||{})){if(!TRACE_KEYS.has(key))continue;out[key]=sanitize(value)}return out}
export class RuntimeTrace{
  constructor({limit=180,clock=()=>new Date().toISOString()}={}){this.limit=limit;this.clock=clock;this.events=[]}
  record(type,data={}){this.events.push({at:this.clock(),type:clip(type,80),data:sanitizeTraceData(data)});if(this.events.length>this.limit)this.events.splice(0,this.events.length-this.limit)}
  snapshot(){return this.events.map(e=>globalThis.structuredClone?globalThis.structuredClone(e):JSON.parse(JSON.stringify(e)))}
  clear(){this.events=[]}
}
function chromeVersion(ua=''){const m=String(ua).match(/(?:Chrome|Chromium)\/(\d+(?:\.\d+){0,3})/);return m?.[1]||'unknown'}
function safeFindingContext(f={}){return{ruleId:clip(f.ruleId,160),impactClass:clip(f.impactClass,50),category:clip(f.category,40),severity:clip(f.severity,30),confidence:clip(f.confidence,30),frankPriority:clip(f.frankPriority,30),sources:(f.sources||[]).slice(0,12).map(v=>clip(v,50)),verification:{state:clip(f.verification?.state,30),method:clip(f.verification?.method,100),attempts:Number(f.verification?.attempts||0)||undefined}}}
function safeEvidence(graph={}){return(graph.evidence||[]).filter(e=>SAFE_CONTEXT_KINDS.has(String(e.kind||''))).slice(0,24).map(e=>({source:clip(e.source,60),kind:clip(e.kind,80),label:clip(e.label,100),value:sanitize(e.value)}))}
function safeLocalAi(localAi={},includeContext=false){const base={status:clip(localAi.status,30),code:clip(localAi.code,100),at:clip(localAi.at,60),durationMs:Number(localAi.durationMs||0)||undefined};if(includeContext&&localAi.candidate)base.candidate=sanitize(localAi.candidate,{includePageText:true});return base}
function safeFrankContext(frank={}){const p=frank.plan||{},r=frank.reasoning||{};return{mode:clip(p.mode,20),reasoning:{status:clip(r.status,30),provider:clip(r.provider,50),code:clip(r.code,100),message:redactText(r.message,240)},assessment:sanitize(p.assessment||{}),steps:(p.steps||[]).slice(0,8).map(s=>({type:clip(s.type,40),headline:redactText(s.headline,120),body:redactText(s.body,520),evidenceRefs:(s.evidenceRefs||[]).slice(0,12).map(v=>clip(v,80))}))}}
export function buildBugReport({version='unknown',trace=[],readiness={},report=null,frank=null,localAi=null,userNote='',includeContext=false,userAgent=globalThis.navigator?.userAgent||''}={}){
  const artifact={schema:'web-qa-assistant-bug-report/v1',generatedAt:new Date().toISOString(),extension:{version:clip(version,30)},browser:{chromeVersion:chromeVersion(userAgent)},frankReadiness:sanitize({status:readiness?.status,progress:readiness?.progress,code:readiness?.code}),trace:sanitize(trace)};
  if(userNote)artifact.userNote=redactText(userNote,800);
  if(localAi)artifact.localAi=safeLocalAi(localAi,includeContext);
  if(includeContext){artifact.context={page:{environment:clip(report?.environment?.type||report?.page?.environment?.type||'unknown',30)},finding:frank?.finding?safeFindingContext(frank.finding):null,evidence:frank?.graph?safeEvidence(frank.graph):[],frank:frank?safeFrankContext(frank):null};}
  return artifact;
}
export function bugReportPrivacySummary(includeContext=false){return includeContext?'Includes bounded current-finding measurements and Frank wording. URLs are reduced to origin/path and common credentials/contact values are redacted. Selectors, cookies, form values and raw DOM are never included.':'Includes extension/browser state, timing and runtime event codes only. Page content, selectors, Frank wording, cookies, form values and credentials are excluded.'}
