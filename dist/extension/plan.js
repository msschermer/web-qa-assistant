import { targetIdForFinding } from './evidence.js';
import { guidanceFor } from './guidance.js';
import { sanitizeMarkupSnippet } from './correlation.js';

export const FRANK_STEP_TYPES=['spotlight','evidence','interpretation','comparison','trend','impact','remediation','verification','summary'];
export const FRANK_PREVIEW_PROPERTIES=['color','background-color','font-size','line-height','outline','border-color'];
export const FRANK_PLAN_SCHEMA={type:'object',additionalProperties:false,required:['version','title','summary','mode','findingId','sources','assessment','steps'],properties:{version:{type:'integer',enum:[3]},title:{type:'string',minLength:1,maxLength:120},summary:{type:'string',minLength:1,maxLength:360},mode:{type:'string',enum:['ai','deterministic']},findingId:{type:'string'},sources:{type:'array',items:{type:'string'},maxItems:12},assessment:{type:'object',additionalProperties:false,required:['status','statement','limitations'],properties:{status:{type:'string',enum:['verified','review','context']},statement:{type:'string',minLength:1,maxLength:320},limitations:{type:'string',maxLength:320}}},steps:{type:'array',minItems:3,maxItems:8,items:{type:'object',additionalProperties:false,required:['id','type','headline','body','targetId','evidenceRefs','sourceLabels','code','metrics','preview'],properties:{id:{type:'string'},type:{type:'string',enum:FRANK_STEP_TYPES},headline:{type:'string',minLength:1,maxLength:110},body:{type:'string',minLength:1,maxLength:620},targetId:{type:'string'},evidenceRefs:{type:'array',items:{type:'string'},maxItems:10},sourceLabels:{type:'array',items:{type:'string'},maxItems:8},code:{type:'string',maxLength:1400},metrics:{type:'array',maxItems:8,items:{type:'object',additionalProperties:false,required:['label','value'],properties:{label:{type:'string',maxLength:80},value:{type:'string',maxLength:180}}}},preview:{type:'object',additionalProperties:false,required:['enabled','property','value'],properties:{enabled:{type:'boolean'},property:{type:'string'},value:{type:'string',maxLength:120}}}}}}}};
function sourceLabel(value){return String(value||'').replace(/(^|[-_])(\w)/g,(_,p,c)=>`${p?' ':''}${c.toUpperCase()}`).trim()}
function evidenceBy(graph,fn){return(graph.evidence||[]).filter(fn)}
function refs(items){return items.map(x=>x.id)}
function labels(items){return[...new Set(items.map(x=>sourceLabel(x.source)))]}
function step(id,type,headline,body,{targetId='',evidence=[],code='',metrics=[],preview=null}={}){return{id,type,headline,body,targetId,evidenceRefs:refs(evidence),sourceLabels:labels(evidence),code:String(code||''),metrics:metrics.map(x=>({label:String(x.label),value:String(x.value)})),preview:preview||{enabled:false,property:'',value:''}}}
function safeCode(graph){
  const snippet=graph.finding?.markupSnippet||evidenceBy(graph,e=>e.kind==='markup-snippet')[0]?.value;
  if(typeof snippet==='string'&&snippet.trim())return sanitizeMarkupSnippet(snippet);
  const markup=evidenceBy(graph,e=>e.kind==='markup'||(e.kind==='evidence'&&String(e.value||'').trim().startsWith('<')))[0]?.value;
  if(typeof markup==='string'&&markup.trim())return sanitizeMarkupSnippet(markup);
  return'';
}
function comparisonMetrics(graph){return evidenceBy(graph,e=>['canonical','title','description','robots'].includes(e.kind)).slice(0,4).map(e=>({label:e.label,value:e.value}))}
function trendMetrics(graph){return evidenceBy(graph,e=>e.source==='performance-monitor'&&['mobile-score','desktop-score','threshold','mobile-change','desktop-change'].includes(e.kind)).slice(0,6).map(e=>({label:e.label,value:e.value}))}
function issueMetrics(graph){return evidenceBy(graph,e=>['link-url','http-status','link-occurrences','link-location','link-prominence','environment','confidence'].includes(e.kind)).slice(0,8).map(e=>({label:e.label,value:e.value}))}
function assessmentFor(f){
  const purpose=f.semantics?.imagePurpose||null;
  if(purpose?.purpose==='uncertain'){
    return{status:'review',statement:'The accessibility violation is confirmed, but the correct remediation depends on unresolved image purpose.',limitations:'Confirm whether the image is informative or decorative before choosing alt text.'};
  }
  const c=String(f.confidence||'confirmed');
  if(c==='confirmed'||c==='corroborated')return{status:'verified',statement:'Verified by the available deterministic evidence.',limitations:''};
  if(c==='inferred')return{status:'review',statement:'Observed, but implementation intent is not proven.',limitations:'Confirm intent before changing production behavior.'};
  return{status:'context',statement:'Context only; this is not a verified defect.',limitations:'Frank should not present inconclusive evidence as an issue.'};
}
const INTERPRETATION_KINDS=new Set(['finding','rule','text','naming.aria-label','image-purpose','image-purpose-confidence','nearby-text','interactive-ancestor','element-size','target-width','target-height','target-minimum','target-spacing','target-spacing-required','contrast-ratio','contrast-required','foreground-color','background-color','font-size','font-weight','link-url','http-status','robots','canonical','measurement-type','lcp','ttfb','transfer','lcp-element','redirect-chain']);
const IMPACT_KINDS=new Set(['finding','rule','wcag','impact','target-minimum','target-spacing-required','contrast-required','confidence','link-prominence','http-status','robots','canonical','measurement-type','lcp','ttfb','transfer','mobile-change','desktop-change']);
const REMEDIATION_KINDS=new Set(['rule','text','naming.aria-label','element-size','target-width','target-height','target-minimum','target-spacing','target-spacing-required','contrast-ratio','contrast-required','foreground-color','background-color','failure-summary','link-url','http-status','canonical','robots','measurement-type','lcp','ttfb','transfer','lcp-element','heaviest-resource','redirect-chain','image-purpose','image-purpose-confidence','nearby-text','image-purpose-signal']);
const VERIFICATION_KINDS=new Set(['rule','wcag','target-width','target-height','target-minimum','target-spacing','target-spacing-required','contrast-ratio','contrast-required','http-status','link-url','verification-method','robots','canonical','lcp','ttfb','transfer','mobile-score','desktop-score','last-checked','image-purpose','image-purpose-confidence']);
function stepEvidence(graph,type){
  const set=type==='interpretation'?INTERPRETATION_KINDS:type==='impact'?IMPACT_KINDS:type==='remediation'?REMEDIATION_KINDS:VERIFICATION_KINDS;
  const selected=evidenceBy(graph,e=>set.has(e.kind));
  return (selected.length?selected:graph.evidence.filter(e=>!['verification-attempts'].includes(e.kind))).slice(0,10);
}
function interpretationMetrics(graph){return evidenceBy(graph,e=>['element-size','target-width','target-height','target-minimum','target-spacing','target-spacing-required','contrast-ratio','contrast-required','foreground-color','background-color','font-size','font-weight','http-status','robots','canonical','lcp','ttfb','transfer'].includes(e.kind)).slice(0,8).map(e=>({label:e.label,value:String(e.value)}))}
// Verification must survive trimming: it is the step that tells an engineer the
// change actually worked, so required steps are kept and optional ones are cut
// from the middle instead of truncating the tail.
const REQUIRED_STEP_IDS=['read','fix','verify'];
function trimSteps(steps,max=8){
  if(steps.length<=max)return steps;
  const required=new Set(REQUIRED_STEP_IDS);
  const keep=new Set(steps.filter(s=>required.has(s.id)));
  for(const s of steps){if(keep.size>=max)break;keep.add(s)}
  return steps.filter(s=>keep.has(s)).slice(0,max);
}
export function deterministicFrankPlan(graph){const f=graph.finding,targetId=targetIdForFinding(f),targetText=evidenceBy(graph,e=>e.kind==='text')[0]?.value||'',g=guidanceFor({...f,targetText},graph.environment||{}),steps=[];
  const presentation=String(f.targetability||'');
  const markupMode=presentation==='markup';
  const documentMode=markupMode||presentation==='document'||presentation==='none'||f.targetType==='historical';
  const unresolvedSpotlight=!targetId&&(presentation==='spotlight'||presentation==='multiple-elements'||f.targetType==='visual');
  const readHeadline=markupMode?'Page configuration':documentMode?'What this finding means':targetId?'What is happening here':'What this finding means';
  const readBody=markupMode
    ? `${g.interpretation} No on-page spotlight is required; the relevant markup is shown below.`
    : documentMode
      ? `${g.interpretation} This is a document-level observation, so Frank does not fake a visual highlight.`
      : unresolvedSpotlight
        ? `${g.interpretation} The recorded element could not be re-anchored on the live page, so Frank will not guess a spotlight.`
        : g.interpretation;
  const stepTarget=documentMode||unresolvedSpotlight||markupMode?'':targetId;
  steps.push(step('read','interpretation',readHeadline,readBody,{targetId:stepTarget,evidence:stepEvidence(graph,'interpretation'),metrics:interpretationMetrics(graph),code:markupMode?safeCode(graph):''}));
  const comparisons=comparisonMetrics(graph);if(comparisons.length>=2)steps.push(step('compare','comparison','The observation points disagree','Browser and connected published-state values were gathered independently. The disagreement is the evidence.',{evidence:evidenceBy(graph,e=>['browser','meta-state'].includes(e.source)),metrics:comparisons}));const trends=trendMetrics(graph);if(trends.length&&f.targetType!=='historical')steps.push(step('trend','trend','History changes the priority','Performance Monitor adds recent history so a current value can be separated from a sustained regression.',{evidence:evidenceBy(graph,e=>e.source==='performance-monitor'),metrics:trends}));
  steps.push(step('impact','impact','Why this matters here',g.impact,{targetId:stepTarget,evidence:stepEvidence(graph,'impact')}));
  steps.push(step('fix','remediation','What I would change',[g.recommendation,g.remediation].filter(Boolean).filter((x,i,a)=>a.indexOf(x)===i).join(' '),{targetId:stepTarget,evidence:stepEvidence(graph,'remediation'),code:safeCode(graph)}));
  if(g.alternatives)steps.push(step('alternatives','evidence','What I ruled out',g.alternatives,{targetId:stepTarget,evidence:graph.evidence.slice(0,4)}));
  steps.push(step('verify','verification','Verify the correction',g.verify,{targetId:stepTarget,evidence:stepEvidence(graph,'verification')}));
  const sourceText=graph.sources.map(sourceLabel).join(', ')||'the current scan';
  return{version:3,title:f.title,summary:`Frank is using ${sourceText}. Environment: ${graph.environment?.type||'unknown'} (${graph.environment?.confidenceLabel||'unconfirmed'}).`,mode:'deterministic',findingId:graph.findingId,sources:graph.sources,assessment:assessmentFor(f),steps:trimSteps(steps)}}
export function validateFrankPlan(plan,graph){if(!plan||plan.version!==3||!plan.assessment||!Array.isArray(plan.steps)||plan.steps.length<3||plan.steps.length>8)return false;const validTargets=new Set(Object.keys(graph.targets||{})),validEvidence=new Set((graph.evidence||[]).map(e=>e.id));let hasVerification=false;for(const s of plan.steps){if(!FRANK_STEP_TYPES.includes(s.type)||!s.headline||!s.body)return false;if(s.targetId&&!validTargets.has(s.targetId))return false;if((s.evidenceRefs||[]).some(id=>!validEvidence.has(id)))return false;if(s.preview?.enabled&&(!s.targetId||!FRANK_PREVIEW_PROPERTIES.includes(s.preview.property)||!s.preview.value))return false;if(s.type==='verification')hasVerification=true}return hasVerification}
