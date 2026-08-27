import { isNonProductionEnvironment } from '../environment/classify.js';

function clip(value,max=220){
  const s=String(value??'').replace(/\s+/g,' ').trim();
  return s.length>max?`${s.slice(0,max-1)}…`:s;
}
function num(value){
  const n=Number(value);
  return Number.isFinite(n)?n:undefined;
}
function compactIndexControl(environment={},evidence={}){
  const control=environment.indexControl||evidence.indexControl||{};
  const indexability=environment.indexability||evidence.indexability||{};
  return{
    assessment:control.assessment||indexability.assessment||'',
    evidenceConfidence:control.evidenceConfidence||indexability.evidenceConfidence||'',
    metaRobots:control.metaRobots||null,
    publishedMetaRobots:control.publishedMetaRobots||null,
    xRobotsTag:control.xRobotsTag||null,
    robotsTxt:control.robotsTxt||null,
    noindexDetected:control.noindexDetected===true||indexability.blocked===true,
    crawlRestricted:control.crawlRestricted===true||indexability.crawlRestricted===true,
    conflictingSignals:control.conflictingSignals===true||indexability.mismatch===true
  };
}
function compactEnvironment(environment={}){
  return{
    type:environment.type||environment.kind||'unknown',
    kind:environment.type||environment.kind||'unknown',
    confidence:environment.confidence,
    confidenceLabel:environment.confidenceLabel||'',
    source:environment.source||'auto',
    signals:[...(environment.signals||[])].slice(0,8)
  };
}

function compactImageInstance(finding={},index=0){
  const m=finding.imageMetrics||{};
  const target=finding.target||{};
  const src=clip(finding.resourceUrl||m.selectedSource||m.currentSrc||'',180);
  return{
    instanceNumber:index+1,
    findingId:finding.id||'',
    instanceId:finding.instanceId||finding.targetId||finding.id||'',
    elementType:target.elementType||'',
    framePath:finding.embeddedContext||target.framePath||'',
    currentSrc:src,
    src:clip(m.src||target.src||'',180),
    naturalWidth:num(m.intrinsicWidth),
    naturalHeight:num(m.intrinsicHeight),
    renderedWidth:num(m.renderedWidth),
    renderedHeight:num(m.renderedHeight),
    dpr:num(m.devicePixelRatio),
    requiredPhysicalWidth:num(m.requiredPhysicalWidth),
    requiredPhysicalHeight:num(m.requiredPhysicalHeight),
    oversizeRatio:num(m.pixelAreaOversizeRatio||m.widthOversizeRatio),
    widthOversizeRatio:num(m.widthOversizeRatio),
    heightOversizeRatio:num(m.heightOversizeRatio),
    magnitude:m.magnitude||'',
    visible:target.visible,
    srcsetPresent:Boolean(m.srcsetPresent||m.responsiveSourcePresent),
    sizesPresent:Boolean(m.sizesPresent),
    pictureElement:Boolean(m.inPicture||m.pictureElement),
    transferBytes:Number.isFinite(Number(m.transferBytes))?Number(m.transferBytes):undefined,
    targetStatus:target.status||finding.targetStatus||''
  };
}

function imageOversizedAdapter(finding,evidence={}){
  const instances=(evidence.instances||[]).map((row,i)=>compactImageInstance(row,i));
  const selectedId=evidence.selectedInstanceId||finding.instanceId||finding.id;
  const selectedIndex=instances.findIndex(row=>row.findingId===selectedId||row.instanceId===selectedId);
  const selected=selectedIndex>=0?instances[selectedIndex]:compactImageInstance(finding,Math.max(0,selectedIndex));
  const groupCount=Math.max(instances.length,Number(evidence.groupCount||finding.count||1));
  return{
    adapter:'performance.browser.image-oversized',
    ruleFamily:'performance.image-oversized',
    groupSummary:{
      count:groupCount,
      ruleId:finding.ruleId||'performance.browser.image-oversized',
      title:evidence.groupTitle||finding.title||''
    },
    instances:instances.length?instances:[selected],
    selectedInstance:selected,
    selectedInstanceNumber:selected.instanceNumber,
    measurements:{
      natural:`${selected.naturalWidth||'?'}×${selected.naturalHeight||'?'}`,
      rendered:`${selected.renderedWidth||'?'}×${selected.renderedHeight||'?'}`,
      dpr:selected.dpr,
      required:`${selected.requiredPhysicalWidth||'?'}×${selected.requiredPhysicalHeight||'?'}`,
      srcsetPresent:selected.srcsetPresent,
      sizesPresent:selected.sizesPresent,
      pictureElement:selected.pictureElement,
      transferBytes:selected.transferBytes
    }
  };
}

function discoverabilityAdapter(finding,evidence={}){
  const environment=evidence.environment||{};
  const indexability=environment.indexability||evidence.indexability||{};
  const indexControl=compactIndexControl(environment,evidence);
  const canonical=environment.canonicalContext||evidence.canonical||null;
  return{
    adapter:'discoverability.environment',
    ruleFamily:'discoverability',
    environment:compactEnvironment(environment),
    indexControl,
    indexability:{
      blocked:indexControl.noindexDetected,
      publishedBlocked:indexability.publishedBlocked===true,
      renderedBlocked:indexability.renderedBlocked===true,
      mismatch:indexControl.conflictingSignals,
      assessment:indexControl.assessment
    },
    canonical:canonical?{
      href:clip(canonical.href||'',180),
      relationshipToCurrentHost:canonical.relationshipToCurrentHost||'',
      assessment:canonical.assessment||''
    }:null,
    publishedCoverage:environment.publishedCoverage||evidence.publishedCoverage||null,
    launchReadiness:(environment.launchReadiness?.items||[]).slice(0,8),
    launchChecklist:(environment.launchReadiness?.checklist||[]).slice(0,8),
    stagingExpected:isNonProductionEnvironment(environment)&&indexControl.noindexDetected&&['seo.noindex','seo.noindex-published','seo.robots-block-all'].includes(String(finding.ruleId||'')),
    selectedInstance:null,
    instanceCount:1
  };
}

function linkOutcome(finding={}){
  const status=Number(finding.link?.status||finding.verification?.evidence?.[0]?.status||0);
  const state=String(finding.verification?.state||finding.confidence||'');
  const cause=String(finding.link?.cause||finding.verification?.cause||finding.extra?.verification?.cause||'');
  const id=String(finding.ruleId||'');
  if(/link-404|link-410|broken-link/.test(id)||finding.verification?.failureClass==='missing')return'confirmed-broken';
  if(/link-5xx/.test(id)||finding.verification?.failureClass==='server-error')return'confirmed-server-error';
  if(/redirect/.test(id))return'redirect';
  if(status===429||/rate-limited/.test(cause)||/rate-limited/.test(id))return'rate-limited';
  if(status===403||status===401||/remote-blocked|forbidden|unauthorized/.test(cause))return'remote-blocked';
  if(/timeout/.test(cause)||/timeout/.test(id)||finding.link?.state==='timeout')return'timeout';
  if(/cors|opaque/.test(cause))return'cors-opaque';
  if(/network/.test(cause))return'network-failure';
  if(state==='inconclusive'||finding.confidence==='inconclusive')return'unable-to-verify';
  return state||'observed';
}

function linkRelationship(finding={}){
  if(finding.link?.internal===true)return'target-origin';
  if(finding.link?.originClass==='related'||finding.link?.relationship==='related-host')return'related-host';
  if(finding.link?.internal===false)return'external';
  return finding.link?.relationship||'unknown';
}

function linkAdapter(finding,evidence={}){
  const instances=evidence.instances||[finding];
  const selected=instances.find(row=>row.id===(evidence.selectedInstanceId||finding.id))||finding;
  const outcome=linkOutcome(selected);
  return{
    adapter:'navigation.link-review',
    ruleFamily:'navigation.link',
    outcome,
    broken:outcome==='confirmed-broken'||outcome==='confirmed-server-error',
    url:clip(selected.link?.url||'',220),
    relationship:linkRelationship(selected),
    httpStatus:num(selected.link?.status),
    probeState:selected.link?.state||selected.verification?.state||'',
    primaryVerification:selected.verification?.state||'',
    redirectChain:(selected.link?.redirects||selected.verification?.redirects||[]).slice(0,8),
    inconclusiveCause:selected.link?.cause||selected.verification?.cause||'',
    occurrenceCount:Number(selected.link?.occurrences||selected.count||instances.length||1),
    representativeSources:(selected.link?.sources||[]).slice(0,8),
    frameContext:selected.embeddedContext||selected.link?.scope||'top-document',
    privilegedFallback:Boolean(selected.verification?.privileged||selected.link?.privilegedFallback),
    targetStatus:selected.target?.status||'',
    selectedInstance:{
      findingId:selected.id||'',
      url:clip(selected.link?.url||'',220),
      outcome,
      status:num(selected.link?.status)
    },
    instanceCount:instances.length
  };
}

function ttfbAdapter(finding,evidence={}){
  const environment=evidence.environment||{};
  const perf=finding.performanceObservation||evidence.performanceObservation||{};
  const assessment=evidence.performanceAssessment||environment.performanceAssessment||null;
  const ttfbMs=num(perf.ttfbMs);
  return{
    adapter:'performance.browser.ttfb',
    ruleFamily:'performance.ttfb',
    observedTtfbMs:ttfbMs,
    observationScope:'current-page lab observation',
    lcpMs:num(assessment?.metrics?.lcp?.valueMs ?? perf.largestContentfulPaintMs),
    fcpMs:num(assessment?.metrics?.fcp?.valueMs ?? perf.firstContentfulPaintMs),
    cls:num(assessment?.metrics?.cls?.value ?? perf.cumulativeLayoutShift),
    pageLoadMs:num(assessment?.metrics?.pageLoad?.valueMs ?? perf.pageLoadMs ?? perf.loadMs),
    transferCount:num(perf.measuredTransferCount),
    resourceCount:num(perf.resourceCount||perf.measuredTransferCount),
    imageDelivery:assessment?.imageDelivery?.assessment||undefined,
    lcpElement:perf.lcpElement?{
      tag:clip(perf.lcpElement.tag||'',40),
      selector:clip(perf.lcpElement.selector||'',120),
      url:clip(perf.lcpElement.url||'',180)
    }:undefined,
    performanceAssessment:assessment?{
      status:assessment.status,
      summary:clip(assessment.summary||'',240),
      ttfbPresentation:assessment.ttfbPresentation||'',
      imageDelivery:assessment.imageDelivery?.assessment||''
    }:undefined,
    environment:compactEnvironment(environment),
    nonProduction:isNonProductionEnvironment(environment),
    confidence:finding.confidence||'inferred',
    claims:{
      measuredSlowResponse:Number.isFinite(ttfbMs),
      confirmedBackendRootCause:false,
      pagePerformancePoor:assessment?.status==='poor'
    },
    selectedInstance:null,
    instanceCount:1
  };
}

function visibleErrorAdapter(finding,evidence={}){
  const ve=finding.visibleError||{};
  return{
    adapter:'runtime.visible-error',
    ruleFamily:'runtime.visible-error',
    visibleError:{
      messageExcerpt:clip(ve.messageExcerpt||'',180),
      visibility:ve.visibility||'',
      role:clip(ve.role||'',40),
      positioning:clip(ve.positioning||'',40),
      originClass:clip(ve.originClass||'',40),
      firstObservedPhase:clip(ve.firstObservedPhase||'',40),
      signals:(ve.signals||[]).slice(0,8)
    },
    targetStatus:finding.target?.status||'',
    frameContext:finding.embeddedContext||'top-document',
    relatedRuntimeEvidence:Number(evidence.runtimeErrorCount||finding.runtimeErrorCount||0)||undefined,
    claims:{
      visibleToUsers:true,
      confirmedRootCause:false,
      causedByWebQa:!ve.firstObservedPhase||ve.firstObservedPhase==='after-webqa-interaction'?false:false
    },
    selectedInstance:null,
    instanceCount:1
  };
}

const adapters={
  'performance.browser.image-oversized':imageOversizedAdapter,
  'performance.browser.lcp-image-oversized':imageOversizedAdapter,
  'performance.browser.ttfb':ttfbAdapter,
  'runtime.visible-error':visibleErrorAdapter,
  'seo.noindex':discoverabilityAdapter,
  'seo.noindex-published':discoverabilityAdapter,
  'correlation.robots-mismatch':discoverabilityAdapter,
  'seo.robots-block-all':discoverabilityAdapter,
  'seo.robots-conflict':discoverabilityAdapter,
  'seo.canonical-cross-host':discoverabilityAdapter,
  'seo.canonical-multiple':discoverabilityAdapter,
  'seo.canonical-missing':discoverabilityAdapter
};

export function reviewAdapterFor(ruleId=''){
  const id=String(ruleId||'');
  if(adapters[id])return adapters[id];
  if(/image-oversized/.test(id))return imageOversizedAdapter;
  if(/link-404|link-410|link-5xx|link-review|broken-link|link-timeout|link-redirect/.test(id))return linkAdapter;
  if(/ttfb/.test(id))return ttfbAdapter;
  if(/visible-error/.test(id))return visibleErrorAdapter;
  if(/noindex|robots-|canonical/.test(id))return discoverabilityAdapter;
  return null;
}

export function buildFindingReviewContext(finding={},evidence={}){
  const adapter=reviewAdapterFor(finding.ruleId);
  const environment=evidence.environment||{};
  const performanceAssessment=evidence.performanceAssessment||environment.performanceAssessment||null;
  const base={
    adapter:adapter?'rule-family':'generic',
    ruleFamily:String(finding.ruleId||'').split('.').slice(0,2).join('.')||'unknown',
    ruleId:finding.ruleId||'',
    groupCount:Number(evidence.groupCount||finding.count||1),
    instanceCount:Array.isArray(evidence.instances)?evidence.instances.length:Number(evidence.groupCount||1),
    selectedInstanceId:evidence.selectedInstanceId||finding.id||'',
    targetStatus:finding.target?.status||'',
    performanceAssessment:performanceAssessment?{
      status:performanceAssessment.status,
      summary:clip(performanceAssessment.summary||'',240),
      metrics:performanceAssessment.metrics||undefined,
      imageDelivery:performanceAssessment.imageDelivery||undefined,
      ttfbPresentation:performanceAssessment.ttfbPresentation||''
    }:undefined,
    environment:{
      ...compactEnvironment(environment),
      indexability:environment.indexability||evidence.indexability||null,
      indexControl:compactIndexControl(environment,evidence),
      canonical:environment.canonicalContext||evidence.canonical||null,
      launchReadiness:(environment.launchReadiness?.items||[]).slice(0,8),
      publishedCoverage:environment.publishedCoverage||evidence.publishedCoverage||null
    }
  };
  if(!adapter)return base;
  const extra=adapter(finding,{...evidence,performanceAssessment});
  return{...base,...extra,environment:{...base.environment,...(extra.environment||{})}};
}
