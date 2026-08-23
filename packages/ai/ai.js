import { deterministicBrief } from '../findings/correlate.js';
import { composeAttention } from '../findings/compose.js';
import { deterministicFrankPlan, FRANK_PLAN_SCHEMA, validateFrankPlan } from '../frank/plan.js';
import { aiEvidenceEnvelope, sanitizeText, sanitizeUrl } from './evidence-contract.js';

function outputText(response){
  if(typeof response?.output_text==='string')return response.output_text;
  for(const item of response?.output||[])for(const c of item.content||[])if(c.type==='output_text'&&c.text)return c.text;
  return '';
}
function model(){return process.env.OPENAI_MODEL||'gpt-5.6-terra'}
async function responses(body){
  if(!process.env.OPENAI_API_KEY)return null;
  const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),Number(process.env.OPENAI_TIMEOUT_MS||12000));
  try{
    const res=await fetch('https://api.openai.com/v1/responses',{method:'POST',signal:controller.signal,headers:{'content-type':'application/json','authorization':`Bearer ${process.env.OPENAI_API_KEY}`},body:JSON.stringify(body)});
    const text=await res.text();let data={};try{data=text?JSON.parse(text):{}}catch{}
    if(!res.ok)throw new Error(data?.error?.message||`OpenAI HTTP ${res.status}`);
    return data;
  }finally{clearTimeout(timer)}
}
async function openaiText(input,selectedModel=model()){
  const response=await responses({model:selectedModel,input});
  return response?outputText(response):'';
}
async function openaiJson(input,name,schema){
  const response=await responses({model:model(),input,text:{format:{type:'json_schema',name,strict:true,schema}}});
  if(!response)return null;
  const raw=outputText(response);if(!raw)return null;
  try{return JSON.parse(raw)}catch{return null}
}
function safeFinding(f){return{title:sanitizeText(f.title,160),detail:sanitizeText(f.detail,450),category:f.category,severity:f.severity,impactClass:f.impactClass||'',instanceCount:Number(f.instanceCount||f.count||1),confidence:f.confidence||'confirmed',verification:f.verification?{state:f.verification.state,method:sanitizeText(f.verification.method,160),attempts:Number(f.verification.attempts||0)}:null,sources:f.sources,wcag:f.wcag,signal:f.signal||'',url:f.link?.url?sanitizeUrl(f.link.url):undefined,status:f.link?.status}}

export async function priorityBrief(findings,coverage,environment={},linkAudit=null){
  const fallback=deterministicBrief(findings,{coverage,linkAudit});
  if(!process.env.OPENAI_API_KEY)return{text:fallback,mode:'deterministic'};
  try{
    const composition=composeAttention(findings,{limit:8});
    const top=composition.groups.map(g=>safeFinding({...g.lead,title:g.title,impactClass:g.impactClass,instanceCount:g.instanceCount}));
    const text=await openaiText(`You are Frank, a senior web implementation QA assistant. You are summarizing VERIFIED QA output, not deciding whether issues exist. Use only the structured findings below. Never invent a finding or turn incomplete coverage into a defect. Write 2-3 concise sentences that answer: what needs attention, what is most important, and whether coverage materially limits confidence. If there are no material findings, say that plainly. Treat FIX as actionable, REVIEW as requiring human intent, CONTEXT as informational.\n\nThe findings have already been grouped and balanced across impact classes (availability, discoverability, accessibility, performance, implementation). Read across those classes rather than leading with whichever class has the most rows. A single confirmed availability or discoverability problem normally outranks several accessibility advisories. Where a group covers several instances of one rule, describe it as one recurring problem with a count, not as separate issues.\n\nEnvironment: ${JSON.stringify(environment)}\nCoverage: ${JSON.stringify(coverage)}\nLink coverage: ${JSON.stringify(linkAudit)}\nGrouped findings: ${JSON.stringify(top)}`,process.env.OPENAI_BRIEF_MODEL||model());
    return{text:text||fallback,mode:text?'ai':'deterministic'};
  }catch{return{text:fallback,mode:'deterministic'}}
}

export async function frankWalkthrough(graph){
  const fallback=deterministicFrankPlan(graph);
  if(!process.env.OPENAI_API_KEY)return fallback;
  const envelope=aiEvidenceEnvelope(graph);
  const prompt=`You are Frank, a senior web engineering assistant guiding a developer through one QA finding. The deterministic QA engine has already decided whether the observation qualifies as a finding. Your job is to explain the verified evidence, clarify impact, propose a safe next action, and explain how to verify the result.\n\nHard rules:\n- Use ONLY the supplied AI Evidence Contract. Never infer facts from information that is absent.\n- Never decide that a new defect exists. Never upgrade confidence or severity.\n- CONFIRMED/CORROBORATED may be described as verified. INFERRED must use review language. INCONCLUSIVE must not be described as a defect.\n- Every factual step must cite evidenceRefs that exist in the contract.\n- targetId may only be an exact supplied target key. If none exists, use an empty string and do not fake a spotlight.\n- The assessment must distinguish verified issue vs review vs context and state limitations when intent or causality is unknown.\n- Respect environment classification and deterministic policy. Do not call expected staging behavior a defect.\n- Prefer 4-6 steps with the sequence: evidence/location, impact, remediation, verification. Add comparison/trend only when supported.\n- Remediation must be concrete. If evidence is insufficient for a precise implementation fix, say what is missing instead of inventing a fix.\n- Lead with interpretation. Before recommending anything, state what the element is doing on this page, using the semantics evidence (image-purpose, nearby-text, naming.*, interactive-ancestor, element-size).\n- Do NOT present a choice between two remediations when the evidence settles it. If image-purpose is decorative with medium or high confidence, recommend alt=\"\" directly and say why the adjacent text already carries the meaning. If it is functional, recommend naming the action. Only present branches when image-purpose is uncertain or absent.\n- Never recommend removing or emptying a text alternative unless the evidence positively supports a decorative purpose. When in doubt, keep the content-bearing option.\n- Browser performance evidence is a lab observation from one machine and network. Never describe it as a field score or a confirmed regression on its own; a regression claim needs performance-monitor history.\n- Preview is CSS-only and only when an exact visual target exists. Never generate JavaScript.\n- Keep the voice concise, calm and technical.\n\nAI Evidence Contract:\n${JSON.stringify(envelope)}`;
  try{
    const candidate=await openaiJson(prompt,'frank_walkthrough_v3',FRANK_PLAN_SCHEMA);
    if(candidate){
      candidate.mode='ai';candidate.findingId=graph.findingId;
      candidate.sources=[...new Set((candidate.sources||[]).filter(x=>graph.sources.includes(x)))];
      if(validateFrankPlan(candidate,graph))return candidate;
    }
  }catch{}
  return fallback;
}

export { aiEvidenceEnvelope } from './evidence-contract.js';
