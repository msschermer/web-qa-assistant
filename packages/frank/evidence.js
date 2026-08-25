import { signalForFinding, SIGNALS } from './signals.js';

function text(value){return String(value??'').trim()}
function clip(value,max=900){const s=text(value).replace(/\s+/g,' ');return s.length>max?s.slice(0,max-1)+'…':s}
function safeLinkUrl(value){
  try{
    const url=new URL(String(value||''));
    for(const key of [...url.searchParams.keys()]){
      if(/(token|secret|password|passwd|authorization|auth|session|cookie|jwt|key|credential|nonce|csrf|xsrf)/i.test(key))url.searchParams.set(key,'[redacted]');
      else url.searchParams.set(key,'[value]');
    }
    url.hash='';
    return url.toString();
  }catch{return clip(value,600)}
}
function hash(input){let h=2166136261;for(let i=0;i<input.length;i++){h^=input.charCodeAt(i);h=Math.imul(h,16777619)}return(h>>>0).toString(36)}
function contrastRatioText(value){const raw=String(value??'').trim();if(!raw)return'';return raw.includes(':')?raw:`${raw}:1`}
function push(list,{source,kind,label,value,scope='finding',confidence='deterministic',targetId=''}){
  if(value===undefined||value===null||value==='')return;
  const normalized=typeof value==='string'?clip(value):value;
  const id=`ev_${hash(`${source}|${kind}|${scope}|${JSON.stringify(normalized)}`)}`;
  if(!list.some(x=>x.id===id))list.push({id,source,kind,label,value:normalized,scope,confidence,targetId});
}
function serviceData(context,key){return context?.services?.[key]?.data||context?.[key]?.data||context?.[key]||null}
function metaPage(meta){return meta?.snapshot?.pageMeta||meta?.report?.snapshot?.pageMeta||null}
function metaFetch(meta){return meta?.snapshot?.fetch||meta?.report?.snapshot?.fetch||null}
function metaRelevant(signal){return [SIGNALS.NOINDEX,SIGNALS.ROBOTS,SIGNALS.CANONICAL,SIGNALS.REDIRECT,SIGNALS.TITLE,SIGNALS.DESCRIPTION,SIGNALS.SCHEMA].includes(signal)}
function performanceRelevant(signal){return signal===SIGNALS.PERFORMANCE_MOBILE||signal===SIGNALS.PERFORMANCE_DESKTOP}
function axeChecks(axe){return ['any','all','none'].flatMap(bucket=>(axe?.checks?.[bucket]||[]))}
function contrastFacts(axe){
  for(const check of axeChecks(axe)){
    const d=check?.data;if(!d||typeof d!=='object')continue;
    if(d.contrastRatio!=null||d.expectedContrastRatio!=null||d.fgColor||d.bgColor)return d;
  }
  return null;
}
function targetSizeFacts(axe){
  const diagnostic=String(axe?.failureSummary||'');
  const size=diagnostic.match(/insufficient size\s*\((\d+(?:\.\d+)?)px by (\d+(?:\.\d+)?)px, should be at least (\d+(?:\.\d+)?)px by (\d+(?:\.\d+)?)px\)/i);
  const spacing=diagnostic.match(/clickable space has a diameter of (\d+(?:\.\d+)?)px instead of at least (\d+(?:\.\d+)?)px/i);
  if(!size&&!spacing)return null;
  return{
    width:size?.[1]||'',height:size?.[2]||'',minimumWidth:size?.[3]||'',minimumHeight:size?.[4]||'',
    spacingDiameter:spacing?.[1]||'',spacingMinimum:spacing?.[2]||''
  };
}
export function targetIdForFinding(finding){return finding?.targetType==='visual'&&finding?.targetId?finding.targetId:''}

export function buildEvidenceGraph({finding,page={},coverage={},context={},targetContext=null,environment=null}){
  const evidence=[],signal=finding.signal||signalForFinding(finding),requestedTargetId=targetIdForFinding(finding),targetId=requestedTargetId&&targetContext?.found?requestedTargetId:'',primarySource=(finding.sources||[])[0]||'browser';
  push(evidence,{source:primarySource,kind:'finding',label:finding.confidence==='inconclusive'?'Observed finding':'Verified finding',value:finding.detail,scope:'current-page',targetId,confidence:finding.confidence||'confirmed'});
  push(evidence,{source:primarySource,kind:'rule',label:'Rule',value:finding.ruleId,scope:'current-page',targetId});
  push(evidence,{source:primarySource,kind:'confidence',label:'Finding confidence',value:finding.confidence||'confirmed',scope:'verification',targetId});
  push(evidence,{source:primarySource,kind:'verification-method',label:'Verification method',value:finding.verification?.method,scope:'verification',targetId});
  push(evidence,{source:primarySource,kind:'verification-attempts',label:'Verification attempts',value:finding.verification?.attempts,scope:'verification',targetId});
  for(const item of (finding.verification?.evidence||[]).slice(0,5))push(evidence,{source:primarySource,kind:'verification-evidence',label:'Verification evidence',value:item,scope:'verification',targetId});
  push(evidence,{source:'browser',kind:'url',label:'Page URL',value:page.url,scope:'current-page'});
  push(evidence,{source:'browser',kind:'environment',label:'Environment',value:environment?.type||page.environment?.type,scope:'context'});
  push(evidence,{source:'browser',kind:'signal',label:'Signal',value:signal,scope:'context'});
  push(evidence,{source:'browser',kind:'selector',label:'Affected selector',value:finding.selector,scope:'current-page',targetId});
  push(evidence,{source:'browser',kind:'evidence',label:'Observed evidence',value:finding.evidence,scope:'current-page',targetId});
  if(finding.markupSnippet)push(evidence,{source:'browser',kind:'markup-snippet',label:'Relevant markup',value:finding.markupSnippet,scope:'current-page'});
  if(finding.targetability)push(evidence,{source:'browser',kind:'targetability',label:'Presentation mode',value:finding.targetability,scope:'context'});
  if(finding.rootCauseKey)push(evidence,{source:'browser',kind:'root-cause',label:'Root-cause key',value:finding.rootCauseKey,scope:'context'});
  if(Array.isArray(finding.lenses)&&finding.lenses.length)push(evidence,{source:'browser',kind:'lenses',label:'QA lenses',value:finding.lenses.join(', '),scope:'context'});
  if(finding.resourceUrl)push(evidence,{source:'browser',kind:'resource-url',label:'Related resource',value:finding.resourceUrl,scope:'current-page',targetId});
  if(finding.link){
    push(evidence,{source:'browser',kind:'link-url',label:'Link destination',value:safeLinkUrl(finding.link.url),scope:'current-page',targetId});
    push(evidence,{source:'browser',kind:'http-status',label:'Destination HTTP status',value:finding.link.status,scope:'current-page',targetId});
    push(evidence,{source:'browser',kind:'link-occurrences',label:'Occurrences on page',value:finding.link.occurrences,scope:'current-page',targetId});
    push(evidence,{source:'browser',kind:'link-text',label:'Link text',value:finding.link.text,scope:'current-page',targetId});
    push(evidence,{source:'browser',kind:'link-location',label:'Link location',value:finding.link.location,scope:'current-page',targetId});
    push(evidence,{source:'browser',kind:'link-prominence',label:'Link prominence',value:finding.link.prominence,scope:'current-page',targetId});
  }
  if(targetContext?.found){
    push(evidence,{source:'browser',kind:'markup',label:'Relevant markup',value:targetContext.markup,scope:'current-page',targetId});
    push(evidence,{source:'browser',kind:'text',label:'Element text',value:targetContext.text,scope:'current-page',targetId});
    if(targetContext.rect)push(evidence,{source:'browser',kind:'element-size',label:'Rendered size',value:`${targetContext.rect.width}\u00d7${targetContext.rect.height}px`,scope:'current-page',targetId});
    for(const [key,value] of Object.entries(targetContext.styles||{}))push(evidence,{source:'browser',kind:`style.${key}`,label:key.replace(/[A-Z]/g,m=>' '+m.toLowerCase()),value,scope:'computed-style',targetId});
  }
  // Semantic context is what lets Frank reason about intent instead of only the
  // failed rule. All of it is deterministic DOM observation.
  const semantics=finding.semantics||targetContext?.semantics||null;
  if(semantics?.naming){
    const n=semantics.naming;
    push(evidence,{source:'browser',kind:'naming.role',label:'Explicit role',value:n.role,scope:'semantics',targetId});
    push(evidence,{source:'browser',kind:'naming.aria-label',label:'aria-label',value:n.ariaLabel,scope:'semantics',targetId});
    push(evidence,{source:'browser',kind:'naming.labelled-by',label:'Text from aria-labelledby',value:n.ariaLabelledByText,scope:'semantics',targetId});
    push(evidence,{source:'browser',kind:'naming.label',label:'Associated label text',value:n.labelText,scope:'semantics',targetId});
    push(evidence,{source:'browser',kind:'interactive-ancestor',label:'Interactive ancestor',value:n.interactiveAncestor,scope:'semantics',targetId});
    push(evidence,{source:'browser',kind:'naming.parent',label:'Parent container',value:n.parentClass?`${n.parentTag}.${n.parentClass}`:n.parentTag,scope:'semantics',targetId});
    push(evidence,{source:'browser',kind:'naming.landmark',label:'Containing landmark',value:n.inLandmark,scope:'semantics',targetId});
  }
  if(semantics?.imagePurpose){
    const ip=semantics.imagePurpose;
    push(evidence,{source:'browser',kind:'image-purpose',label:'Likely image purpose',value:ip.purpose,scope:'semantics',targetId,confidence:ip.confidence||'deterministic'});
    push(evidence,{source:'browser',kind:'image-purpose-confidence',label:'Purpose confidence',value:ip.confidence,scope:'semantics',targetId});
    for(const signal of (ip.signals||[]).slice(0,4))push(evidence,{source:'browser',kind:'image-purpose-signal',label:'Purpose signal',value:signal,scope:'semantics',targetId});
    const nearby=ip.nearbyText||ip.descriptor?.siblingText;if(nearby)push(evidence,{source:'browser',kind:'nearby-text',label:'Adjacent visible text',value:nearby,scope:'semantics',targetId});
  }
  const browserPerf=finding.performanceObservation||null;
  if(browserPerf?.available){
    push(evidence,{source:'browser-performance',kind:'measurement-type',label:'Measurement type',value:'lab observation in the inspecting browser',scope:'current-page'});
    push(evidence,{source:'browser-performance',kind:'ttfb',label:'Time to first byte',value:browserPerf.ttfbMs!=null?`${browserPerf.ttfbMs}ms`:'',scope:'current-page'});
    push(evidence,{source:'browser-performance',kind:'lcp',label:'Largest contentful paint',value:browserPerf.largestContentfulPaintMs!=null?`${browserPerf.largestContentfulPaintMs}ms`:'',scope:'current-page'});
    push(evidence,{source:'browser-performance',kind:'transfer',label:browserPerf.transferIsLowerBound?'Known transfer lower bound':'Measured transfer',value:browserPerf.transferBytes?`${(browserPerf.transferBytes/1048576).toFixed(2)}MB; ${browserPerf.measuredTransferCount||0} measured entries; ${browserPerf.unknownTransferCount||0} unknown`:'',scope:'current-page'});
  if(browserPerf.lcpElement?.selector)push(evidence,{source:'browser-performance',kind:'lcp-element',label:'Observed LCP element',value:{selector:browserPerf.lcpElement.selector,tag:browserPerf.lcpElement.tag,url:browserPerf.lcpElement.url||'',size:browserPerf.lcpElement.size||0,intrinsic:browserPerf.lcpElement.intrinsic||null,rendered:browserPerf.lcpElement.rendered||null},scope:'current-page'});
    for(const row of (browserPerf.heaviest||[]).slice(0,3))push(evidence,{source:'browser-performance',kind:'heaviest-resource',label:`Heaviest ${row.type}`,value:{bytes:row.bytes,type:row.type,url:row.name,durationMs:row.durationMs},scope:'current-page'});
  }
  for(const criterion of finding.wcag||[])push(evidence,{source:(finding.sources||[]).includes('wcag-translator')?'wcag-translator':'axe',kind:'wcag',label:'WCAG criterion',value:criterion,scope:'standard',targetId});
  push(evidence,{source:'wcag-translator',kind:'guidance',label:'WCAG guidance',value:finding.wcagExplanation,scope:'standard',targetId});
  if(finding.axe){
    push(evidence,{source:'axe',kind:'impact',label:'axe impact',value:finding.axe.impact||finding.severity,scope:'current-page',targetId});
    push(evidence,{source:'axe',kind:'failure-summary',label:'axe diagnostic',value:finding.axe.failureSummary,scope:'current-page',targetId});
    for(const bucket of ['any','all','none'])for(const check of finding.axe.checks?.[bucket]||[])push(evidence,{source:'axe',kind:`check.${bucket}`,label:check.id||`${bucket} check`,value:check.data!=null?{message:check.message||'',data:check.data}:(check.message||''),scope:'current-page',targetId});
    const targetSize=targetSizeFacts(finding.axe);
    if(targetSize){
      push(evidence,{source:'axe',kind:'target-width',label:'Target width',value:targetSize.width?`${targetSize.width}px`:'',scope:'current-page',targetId});
      push(evidence,{source:'axe',kind:'target-height',label:'Target height',value:targetSize.height?`${targetSize.height}px`:'',scope:'current-page',targetId});
      const minimum=targetSize.minimumHeight||targetSize.minimumWidth;
      push(evidence,{source:'axe',kind:'target-minimum',label:'Minimum target size',value:minimum?`${minimum}px × ${minimum}px`:'',scope:'standard',targetId});
      push(evidence,{source:'axe',kind:'target-spacing',label:'Safe clickable spacing',value:targetSize.spacingDiameter?`${targetSize.spacingDiameter}px`:'',scope:'current-page',targetId});
      push(evidence,{source:'axe',kind:'target-spacing-required',label:'Required spacing diameter',value:targetSize.spacingMinimum?`${targetSize.spacingMinimum}px`:'',scope:'standard',targetId});
    }
    const contrast=contrastFacts(finding.axe);
    if(contrast){
      push(evidence,{source:'axe',kind:'contrast-ratio',label:'Observed contrast ratio',value:contrastRatioText(contrast.contrastRatio),scope:'current-page',targetId});
      push(evidence,{source:'axe',kind:'contrast-required',label:'Required contrast ratio',value:contrastRatioText(contrast.expectedContrastRatio),scope:'standard',targetId});
      push(evidence,{source:'axe',kind:'foreground-color',label:'Foreground color',value:contrast.fgColor,scope:'computed-style',targetId});
      push(evidence,{source:'axe',kind:'background-color',label:'Background color',value:contrast.bgColor,scope:'computed-style',targetId});
      push(evidence,{source:'axe',kind:'font-size',label:'Text size',value:contrast.fontSize,scope:'computed-style',targetId});
      push(evidence,{source:'axe',kind:'font-weight',label:'Font weight',value:contrast.fontWeight,scope:'computed-style',targetId});
    }
  }
  const meta=serviceData(context,'metaState')||serviceData(context,'meta'),mp=metaPage(meta),mf=metaFetch(meta);
  if(metaRelevant(signal)&&mp){
    if(signal===SIGNALS.CANONICAL)push(evidence,{source:'meta-state',kind:'canonical',label:'Published canonical',value:mp.canonical?.resolved,scope:'published'});
    if(signal===SIGNALS.TITLE)push(evidence,{source:'meta-state',kind:'title',label:'Published title',value:mp.title?.value,scope:'published'});
    if(signal===SIGNALS.DESCRIPTION)push(evidence,{source:'meta-state',kind:'description',label:'Published description',value:mp.description?.value,scope:'published'});
    if(signal===SIGNALS.NOINDEX||signal===SIGNALS.ROBOTS){const robots=[...(mp.robots?.meta||[]),...(mp.robots?.googlebot||[]),...(mp.robots?.bingbot||[])].map(x=>x.content).filter(Boolean).join(', ');push(evidence,{source:'meta-state',kind:'robots',label:'Published robots directives',value:robots||mp.robots?.header,scope:'published'});}
    if(signal===SIGNALS.SCHEMA)push(evidence,{source:'meta-state',kind:'schema-types',label:'Published schema types',value:(meta?.snapshot?.schema?.types||meta?.report?.snapshot?.schema?.types||[]).join(', '),scope:'published'});
  }
  if(metaRelevant(signal)&&mf){push(evidence,{source:'meta-state',kind:'http-status',label:'Page HTTP status',value:mf.status,scope:'published'});if(signal===SIGNALS.REDIRECT)push(evidence,{source:'meta-state',kind:'redirect-chain',label:'Redirect chain',value:(mf.redirectChain||[]).map(x=>`${x.status} ${x.url}`).join(' > '),scope:'published'});}
  const perf=serviceData(context,'performance')||context?.performance;
  if(performanceRelevant(signal)&&perf?.monitored){
    push(evidence,{source:'performance-monitor',kind:'mobile-score',label:'Latest mobile score',value:perf.mobile,scope:'history'});push(evidence,{source:'performance-monitor',kind:'desktop-score',label:'Latest desktop score',value:perf.desktop,scope:'history'});push(evidence,{source:'performance-monitor',kind:'threshold',label:'Configured target',value:perf.threshold,scope:'history'});push(evidence,{source:'performance-monitor',kind:'mobile-change',label:'Recent mobile change',value:perf.mobileChange,scope:'history'});push(evidence,{source:'performance-monitor',kind:'desktop-change',label:'Recent desktop change',value:perf.desktopChange,scope:'history'});push(evidence,{source:'performance-monitor',kind:'last-checked',label:'Last checked',value:perf.lastChecked,scope:'history'});
  }
  const sources=[...new Set(evidence.map(e=>e.source))],targets={};
  if(targetId&&targetContext?.found)targets[targetId]={selector:finding.selector,context:targetContext};
  return{version:3,findingId:finding.id||finding.fingerprint||finding.ruleId,finding:{id:finding.id,ruleId:finding.ruleId,title:finding.title,detail:finding.detail,category:finding.category,severity:finding.severity,confidence:finding.confidence||'confirmed',verification:finding.verification||null,selector:finding.selector||'',targetId,targetType:finding.targetType==='visual'&&!targetId?'page':(finding.targetType||'page'),targetability:finding.targetability||'',scope:finding.scope||'',rootCauseKey:finding.rootCauseKey||'',lenses:[...(finding.lenses||[])],fixOwner:finding.fixOwner||'',markupSnippet:finding.markupSnippet||'',signal,frankPriority:finding.frankPriority||'',policyReason:finding.policyReason||'',impactClass:finding.impactClass||'',semantics:semantics||null,performanceObservation:browserPerf||null,axe:finding.axe||null,link:finding.link||null,wcagExplanation:finding.wcagExplanation||'',sources:[...(finding.sources||[])],wcag:[...(finding.wcag||[])],remediationContext:finding.remediationContext||null},page:{url:page.url||'',hostname:page.hostname||'',title:page.title||''},environment:environment||page.environment||{type:'unknown',confidence:0},coverage:{...coverage},targets,evidence,sources};
}
export function evidenceHash(graph){return hash(JSON.stringify({finding:graph.finding,evidence:graph.evidence,coverage:graph.coverage,environment:graph.environment}))}
