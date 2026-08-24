import { deterministicBrief } from '../findings/correlate.js';
import { composeAttention } from '../findings/compose.js';
import { FRANK_PLAN_SCHEMA, validateFrankPlan } from '../frank/plan.js';
import { aiEvidenceEnvelope, sanitizeText, sanitizeUrl } from './evidence-contract.js';

function outputText(response){
  if(typeof response?.output_text==='string')return response.output_text;
  for(const item of response?.output||[])for(const c of item.content||[])if(c.type==='output_text'&&c.text)return c.text;
  return '';
}
function model(){return process.env.OPENAI_MODEL||'gpt-5.6-terra'}

export class AiRuntimeError extends Error {
  constructor(code,message,{status=0,cause=null}={}){super(message);this.name='AiRuntimeError';this.code=code;this.status=status;if(cause)this.cause=cause}
}
function runtimeError(code,message,options={}){return new AiRuntimeError(code,message,options)}
export function aiFailureInfo(error){
  const code=String(error?.code||'AI_UNKNOWN_ERROR');
  const safeMessages={
    AI_NOT_CONFIGURED:'Connected reasoning is not configured on the gateway.',
    AI_TIMEOUT:'Connected reasoning timed out before a valid response was returned.',
    AI_EMPTY_OUTPUT:'Connected reasoning returned no usable output.',
    AI_INVALID_JSON:'Connected reasoning returned an invalid structured response.',
    AI_INVALID_PLAN:'Connected reasoning returned a walkthrough that failed the evidence contract.',
    AI_HTTP_ERROR:'The model provider rejected or failed the connected reasoning request.',
    AI_NETWORK_ERROR:'The gateway could not reach the model provider.'
  };
  return{status:'failed',code,message:safeMessages[code]||sanitizeText(error?.message||'Connected reasoning failed.',220),httpStatus:Number(error?.status||0)};
}

async function responses(body,{timeoutMs=Number(process.env.OPENAI_TIMEOUT_MS||12000)}={}){
  if(!process.env.OPENAI_API_KEY)throw runtimeError('AI_NOT_CONFIGURED','OpenAI API key is not configured.');
  const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),timeoutMs);
  try{
    let res;
    try{
      res=await fetch('https://api.openai.com/v1/responses',{method:'POST',signal:controller.signal,headers:{'content-type':'application/json','authorization':`Bearer ${process.env.OPENAI_API_KEY}`},body:JSON.stringify(body)});
    }catch(error){
      if(error?.name==='AbortError')throw runtimeError('AI_TIMEOUT','OpenAI request timed out.',{cause:error});
      throw runtimeError('AI_NETWORK_ERROR',String(error?.message||error||'OpenAI network error'),{cause:error});
    }
    const text=await res.text();let data={};try{data=text?JSON.parse(text):{}}catch{}
    if(!res.ok)throw runtimeError('AI_HTTP_ERROR',data?.error?.message||`OpenAI HTTP ${res.status}`,{status:res.status});
    if(data?.status==='failed')throw runtimeError('AI_HTTP_ERROR',data?.error?.message||'OpenAI response failed.');
    return data;
  }finally{clearTimeout(timer)}
}
async function openaiText(input,selectedModel=model(),extra={},requestOptions={}){
  const response=await responses({model:selectedModel,input,...extra},requestOptions);
  const text=outputText(response);
  if(!text)throw runtimeError('AI_EMPTY_OUTPUT','OpenAI returned no output text.');
  return text;
}
async function openaiJson(input,name,schema){
  const response=await responses({model:model(),input,text:{format:{type:'json_schema',name,strict:true,schema}}});
  const raw=outputText(response);if(!raw)throw runtimeError('AI_EMPTY_OUTPUT','OpenAI returned no structured output.');
  try{return JSON.parse(raw)}catch{throw runtimeError('AI_INVALID_JSON','OpenAI returned invalid JSON for the structured walkthrough.');}
}
function safeFinding(f){return{title:sanitizeText(f.title,160),detail:sanitizeText(f.detail,450),category:f.category,severity:f.severity,impactClass:f.impactClass||'',instanceCount:Number(f.instanceCount||f.count||1),confidence:f.confidence||'confirmed',verification:f.verification?{state:f.verification.state,method:sanitizeText(f.verification.method,160),attempts:Number(f.verification.attempts||0)}:null,sources:f.sources,wcag:f.wcag,signal:f.signal||'',url:f.link?.url?sanitizeUrl(f.link.url):undefined,status:f.link?.status}}

let healthCache={at:0,value:null};
export function __resetAiHealthCacheForTests(){healthCache={at:0,value:null}}
export async function probeAiHealth({force=false}={}){
  const ttl=Number(process.env.OPENAI_HEALTH_CACHE_MS||5*60*1000),now=Date.now();
  if(!force&&healthCache.value&&now-healthCache.at<ttl)return healthCache.value;
  if(!process.env.OPENAI_API_KEY){const value={status:'not-configured',operational:false,model:model(),checkedAt:new Date(now).toISOString()};healthCache={at:now,value};return value}
  const started=Date.now();
  try{
    const text=await openaiText('Return exactly: OK',process.env.OPENAI_HEALTH_MODEL||model(),{max_output_tokens:128,store:false},{timeoutMs:Number(process.env.OPENAI_HEALTH_TIMEOUT_MS||6000)});
    const value={status:/\bOK\b/i.test(text)?'operational':'operational',operational:true,model:process.env.OPENAI_HEALTH_MODEL||model(),latencyMs:Date.now()-started,checkedAt:new Date().toISOString()};
    healthCache={at:Date.now(),value};return value;
  }catch(error){
    const failure=aiFailureInfo(error),value={...failure,operational:false,model:process.env.OPENAI_HEALTH_MODEL||model(),latencyMs:Date.now()-started,checkedAt:new Date().toISOString()};
    healthCache={at:Date.now(),value};return value;
  }
}

export async function priorityBrief(findings,coverage,environment={},linkAudit=null){
  const fallback=deterministicBrief(findings,{coverage,linkAudit});
  if(!process.env.OPENAI_API_KEY)return{text:fallback,mode:'deterministic',reason:aiFailureInfo(runtimeError('AI_NOT_CONFIGURED','OpenAI API key is not configured.'))};
  try{
    const composition=composeAttention(findings,{limit:8});
    const top=composition.groups.map(g=>safeFinding({...g.lead,title:g.title,impactClass:g.impactClass,instanceCount:g.instanceCount}));
    const text=await openaiText(`You are Frank, a senior web implementation QA assistant. You are summarizing VERIFIED QA output, not deciding whether issues exist. Use only the structured findings below. Never invent a finding or turn incomplete coverage into a defect. Write 2-3 concise sentences that answer: what needs attention, what is most important, and whether coverage materially limits confidence. If there are no material findings, say that plainly. Treat FIX as actionable, REVIEW as requiring human intent, CONTEXT as informational.\n\nThe findings have already been grouped and balanced across impact classes (availability, discoverability, accessibility, performance, implementation). Read across those classes rather than leading with whichever class has the most rows. A single confirmed availability or discoverability problem normally outranks several accessibility advisories. Where a group covers several instances of one rule, describe it as one recurring problem with a count, not as separate issues.\n\nEnvironment: ${JSON.stringify(environment)}\nCoverage: ${JSON.stringify(coverage)}\nLink coverage: ${JSON.stringify(linkAudit)}\nGrouped findings: ${JSON.stringify(top)}`,process.env.OPENAI_BRIEF_MODEL||model());
    return{text,mode:'ai',reason:null};
  }catch(error){return{text:fallback,mode:'deterministic',reason:aiFailureInfo(error)}}
}

export async function frankWalkthrough(graph){
  if(!process.env.OPENAI_API_KEY)throw runtimeError('AI_NOT_CONFIGURED','OpenAI API key is not configured.');
  const envelope=aiEvidenceEnvelope(graph);
  const prompt=`You are Frank, a senior web engineering assistant guiding a developer through one QA finding. The deterministic QA engine has already decided whether the observation qualifies as a finding. Your job is to explain the verified evidence, clarify impact, propose a safe next action, and explain how to verify the result.\n\nHard rules:\n- Use ONLY the supplied AI Evidence Contract. Never infer facts from information that is absent.\n- Never decide that a new defect exists. Never upgrade confidence or severity.\n- CONFIRMED/CORROBORATED may be described as verified. INFERRED must use review language. INCONCLUSIVE must not be described as a defect.\n- Every factual step must cite evidenceRefs that exist in the contract.\n- targetId may only be an exact supplied target key. If none exists, use an empty string and do not fake a spotlight.\n- The assessment must distinguish verified issue vs review vs context and state limitations when intent or causality is unknown.\n- Respect environment classification and deterministic policy. Do not call expected staging behavior a defect.\n- Prefer 4-6 useful steps beginning with interpretation, then impact, remediation, and verification. Add comparison/trend only when supported. Spotlighting is presentation, not a standalone narration step; do not add a generic step that merely says evidence exists.\n- Remediation must be concrete. If evidence is insufficient for a precise implementation fix, say what is missing instead of inventing a fix.\n- Lead with interpretation. Before recommending anything, state what the element is doing on this page, using semantics, target text, computed style, and rule evidence when supplied.\n- For color contrast, quote observed and required contrast ratios and colors when they are present in evidence. Explain the affected text/component, then recommend the smallest safe color/background adjustment.\n- Do NOT present a choice between two remediations when the evidence settles it. If image-purpose is decorative with medium or high confidence, recommend alt="" directly and say why the adjacent text already carries the meaning. If it is functional, recommend naming the action. Only present branches when image-purpose is uncertain or absent.\n- Never recommend removing or emptying a text alternative unless the evidence positively supports a decorative purpose. When in doubt, keep the content-bearing option.\n- Browser performance evidence is a lab observation from one machine and network. Never describe it as a field score or a confirmed regression on its own; a regression claim needs performance-monitor history.\n- Preview is CSS-only and only when an exact visual target exists. Never generate JavaScript.\n- Keep the voice concise, calm and technical.\n\nAI Evidence Contract:\n${JSON.stringify(envelope)}`;
  const candidate=await openaiJson(prompt,'frank_walkthrough_v3',FRANK_PLAN_SCHEMA);
  candidate.mode='ai';candidate.findingId=graph.findingId;
  candidate.sources=[...new Set((candidate.sources||[]).filter(x=>graph.sources.includes(x)))];
  if(!validateFrankPlan(candidate,graph))throw runtimeError('AI_INVALID_PLAN','Frank generated a walkthrough that failed validation.');
  return candidate;
}

export { aiEvidenceEnvelope } from './evidence-contract.js';
