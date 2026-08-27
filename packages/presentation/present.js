import { guidanceFor } from '../frank/guidance.js';
import { linkInTextEvidence, linkInTextTitle, linkInTextDiagnosis } from '../findings/link-in-text.js';

export const QA_AREA_META = Object.freeze({
  availability:{label:'Navigation',short:'Navigation',description:'Links, destinations, forms and routes that affect whether people can complete the journey.',tone:'critical'},
  discoverability:{label:'Discoverability',short:'SEO',description:'Indexing, canonical and metadata signals that affect how the page is found and consolidated.',tone:'warn'},
  performance:{label:'Performance',short:'Performance',description:'Measured browser and monitoring signals that affect how quickly the page responds and renders.',tone:'warn'},
  accessibility:{label:'Accessibility',short:'Accessibility',description:'Barriers that affect assistive technology, keyboard, pointer, vision or document understanding.',tone:'info'},
  security:{label:'Security',short:'Security',description:'Browser-facing implementation patterns that can create avoidable security or privacy risk.',tone:'critical'},
  implementation:{label:'Web quality',short:'Web quality',description:'Markup, document and configuration problems that reduce implementation quality or resilience.',tone:'info'},
  coverage:{label:'Coverage',short:'Coverage',description:'Checks that could not be completed well enough to support a defect claim.',tone:'muted'}
});

export const QA_AREA_ORDER=['availability','discoverability','performance','accessibility','security','implementation','coverage'];

function clip(value,max=220){const s=String(value??'').replace(/\s+/g,' ').trim();return s.length>max?`${s.slice(0,max-1)}…`:s}
function pathname(value){try{const u=new URL(value);return `${u.pathname}${u.search? '…':''}`||'/'}catch{return clip(value,90)}}
function ruleTitle(f){return clip(f.title||String(f.ruleId||'').replace(/[._-]+/g,' ')||'QA finding',120)}
function priorityLabel(f){if(f.frankPriority==='blocker'||f.severity==='critical')return'Fix first';if(f.frankPriority==='high'||f.severity==='high')return'High priority';if(f.frankPriority==='low'||f.severity==='low')return'Lower priority';return'Recommended'}
function confidenceLabel(f){if(f.confidence==='corroborated')return'Corroborated';if(f.confidence==='confirmed')return'Confirmed';if(f.confidence==='observed')return'Observed';if(f.confidence==='inferred')return'Inferred';if(f.confidence==='inconclusive')return'Unable to verify';if(f.confidence==='needs-review')return'Needs review';return''}

function friendlyTitle(f){
  const id=String(f.ruleId||'');
  if(/broken-link|link-404|link-410/.test(id))return'Broken internal link';
  if(/link-5xx/.test(id))return'Linked page is returning a server error';
  if(/link-redirect-error/.test(id))return'Internal link has a redirect problem';
  if(/noindex/.test(id))return'A noindex directive was detected';
  if(/canonical-cross-host|canonical-mismatch/.test(id))return'Canonical URL conflicts with this page';
  if(/canonical-missing/.test(id))return'Canonical URL is missing';
  if(/canonical-multiple/.test(id))return'Multiple canonical URLs are published';
  if(/title-multiple/.test(id))return'Multiple page titles are published';
  if(/description-missing/.test(id))return'Meta description is missing';
  if(id==='performance.browser.lcp')return'Largest contentful paint is slow in this browser';
  if(id==='performance.browser.ttfb')return'First byte was slow in this browser';
  if(id==='performance.browser.weight')return'Page transfer is heavy in this browser';
  if(id==='performance.browser.cls')return'Layout shift is high in this browser';
  if(id==='performance.browser.lcp-image-oversized')return'LCP image is substantially oversized';
  if(id==='performance.browser.image-oversized'){
    const n=Number(f.count||f.occurrences||1);
    const mild=f.imageMetrics?.magnitude==='mild';
    if(mild)return n>1?`${n} images are mildly larger than display need`:'Image source is mildly larger than display need';
    return n>1?`${n} images are substantially oversized for their display size`:'Image is substantially oversized for its display size';
  }
  if(/performance\./.test(id))return'Performance needs review';
  if(/blank-opener/.test(id))return'New-tab link should explicitly block opener access';
  if(/meta-refresh/.test(id))return'Page uses timed meta refresh';
  if(/charset-missing/.test(id))return'Character encoding is not clearly declared';
  if(/target-size/.test(id))return'Clickable target is too small or tightly spaced';
  if(/color-contrast/.test(id))return'Text contrast is below the required level';
  if(/link-in-text-block/.test(id)){
    const evidence=linkInTextEvidence(f, f.linkInTextHints || f.linkInText);
    return linkInTextTitle(evidence);
  }
  if(/(?:label|button-name|link-name|aria.*name|input.*name)/.test(id))return'Interactive control needs an accessible name';
  if(/image-alt|role-img|input-image|object-alt|area-alt/.test(id))return'Image text alternative needs attention';
  if(/focus|keyboard|tabindex/.test(id))return'Keyboard or focus behavior needs attention';
  if(/^axe\./.test(id))return ruleTitle(f);
  return ruleTitle(f);
}

export function presentFinding(finding={},environment={type:'unknown'}){
  const f=finding||{};
  const area=String(f.impactClass||'implementation');
  const meta=QA_AREA_META[area]||QA_AREA_META.implementation;
  const guidance=guidanceFor(f,environment)||{};
  const id=String(f.ruleId||'');
  let summary=clip(guidance.interpretation||f.detail||'',260);
  if(/broken-link|link-404|link-410/.test(id)&&f.link?.url){const text=clip(f.link?.text||'Internal link',70);summary=`${text} points to ${pathname(f.link.url)}, which returned a confirmed missing-page response.`}
  if(id==='performance.browser.lcp'&&f.performanceObservation?.largestContentfulPaintMs!=null)summary=`This browser observed LCP at ${(f.performanceObservation.largestContentfulPaintMs/1000).toFixed(1)}s. Treat it as a current lab observation, not a field regression.`;
  if(id==='performance.browser.cls'&&f.performanceObservation?.cumulativeLayoutShift!=null)summary=`This browser observed cumulative layout shift of ${f.performanceObservation.cumulativeLayoutShift}. Aggregate CLS only — no shift contributor was identified. Treat as a current lab observation, not a field Core Web Vitals score.`;
  if(id==='performance.browser.ttfb'&&f.performanceObservation?.ttfbMs!=null)summary=`This browser waited ${Math.round(f.performanceObservation.ttfbMs)}ms for the first byte before rendering work could begin.`;
  if(/link-in-text-block/.test(id)){
    const evidence=linkInTextEvidence(f, f.linkInTextHints || f.linkInText);
    summary=clip(linkInTextDiagnosis(evidence),280);
  }
  if(id==='performance.browser.image-oversized'||id==='performance.browser.lcp-image-oversized'){
    const m=f.imageMetrics||{};
    if(m.intrinsicWidth&&m.renderedWidth&&m.requiredPhysicalWidth){
      const transfer=Number.isFinite(m.transferBytes)?` · ${(m.transferBytes/1024).toFixed(0)} KB transfer`:'';
      const lcp=m.isLcpResource||id.includes('lcp-image')?' · current LCP image':'';
      summary=`Served ${m.intrinsicWidth}×${m.intrinsicHeight}, displayed ~${m.renderedWidth}×${m.renderedHeight}, ~${m.requiredPhysicalWidth}×${m.requiredPhysicalHeight} needed at ${m.devicePixelRatio}× DPR${transfer}${lcp}.`;
    }
  }
  if(id==='performance.browser.weight'&&f.performanceObservation?.transferBytes!=null){
    const p=f.performanceObservation;
    const qualifier=p.transferIsLowerBound?'at least ':'';
    summary=`This browser measured ${qualifier}${(p.transferBytes/1048576).toFixed(1)}MB transfer on this page load.`;
  }
  return{
    areaId:area,areaLabel:meta.label,areaDescription:meta.description,tone:meta.tone,
    title:friendlyTitle(f),summary:summary||clip(f.detail,260)||'A verified QA condition needs review.',
    nextAction:clip(guidance.recommendation||guidance.remediation||'',220),
    priorityLabel:priorityLabel(f),confidenceLabel:confidenceLabel(f),
    technicalTitle:ruleTitle(f),ruleId:id
  };
}

export function presentArea(id,count=0,{lead=false,active=false}={}){
  const meta=QA_AREA_META[id]||QA_AREA_META.implementation;
  return{...meta,id,count:Number(count||0),lead:Boolean(lead),active:Boolean(active)};
}
