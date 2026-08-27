import { signalForFinding, SIGNALS } from './signals.js';
import { normalizeConfidence } from './confidence.js';
import { impactClassFor } from './impact.js';

const scoreRank={blocker:5,high:4,medium:3,low:2,quiet:1};
const UTILITY_PATH=/(^|\/)(thank-you|thanks|confirmation|confirmed|success|login|log-in|signin|sign-in|account|my-account|cart|checkout|search|wp-admin|admin)(\/|$)/i;
const LOW_VALUE_PATH=/(^|\/)(privacy(?:-policy)?|terms(?:-of-service)?|cookie(?:-policy)?)(\/|$)/i;

function isNonProduction(env){
  return ['staging','preview','local','development'].includes(env);
}
function shouldQuietNonProductionIndexing(environment){
  const type=environment?.type||environment;
  if(!isNonProduction(type))return false;
  const source=String(environment?.source||'');
  if(source==='manual'||source==='user'||!source)return true;
  if(/high|certain|confirmed/i.test(String(environment?.confidenceLabel||'')))return true;
  return (environment?.signals||[]).some(s=>/^known-host:/.test(String(s)));
}
function clone(f){return {...f,sources:[...(f.sources||[])],wcag:[...(f.wcag||[])],verification:f.verification?{...f.verification,evidence:[...(f.verification.evidence||[])]}:undefined,worthChecking:Boolean(f.worthChecking),supersededBy:f.supersededBy||''}}
function set(out,{visible=true,priority='medium',category,severity,title,detail,reason,disposition}={}){
  out.frankVisible=visible;out.frankPriority=priority;out.policyReason=reason||'';
  if(category)out.category=category;if(severity)out.severity=severity;if(title)out.title=title;if(detail)out.detail=detail;
  out.presentationDisposition=disposition||(visible===false?'suppressed-from-recommended-order':'recommended');
  out.presentationReason=reason||'';
  return out;
}
function pathnameOf(f){
  try{return new URL(f.pageUrl||f.url||f.link?.sourceUrl||'https://x.invalid/').pathname||'/'}
  catch{return'/'}
}
function publishedCoverageIncomplete(environment){
  const pc=environment?.publishedCoverage||environment?.environment?.publishedCoverage;
  const status=String(pc?.status||'');
  return Boolean(status)&&status!=='complete';
}
function productionNoindexPolicy(f,environment){
  const path=environment?.pathname||pathnameOf(f);
  const renderedOnly=publishedCoverageIncomplete(environment);
  if(UTILITY_PATH.test(path))return set(f,{visible:false,priority:'quiet',category:'context',severity:'info',title:'Noindex on a utility page',detail:renderedOnly?'This production URL shows noindex in the rendered document, but the path looks like a utility or transactional page where indexing is commonly intentional.':'This production URL publishes noindex, but the path looks like a utility or transactional page where indexing is commonly intentional.',reason:'likely intentional noindex on utility path'});
  if(LOW_VALUE_PATH.test(path))return set(f,{visible:true,priority:'low',category:'review',severity:'low',title:'Review noindex on this production page',detail:renderedOnly?'This production page shows noindex in the rendered document. The path looks like policy content, so confirm the indexing intent before changing it.':'This production page publishes noindex. The path looks like policy content, so confirm the indexing intent before changing it.',reason:'production noindex on low-search-value path'});
  if(path==='/'||/^\/[^/]+\/?$/.test(path)){
    if(renderedOnly)return set(f,{visible:true,priority:'high',category:'review',severity:'high',title:'Production page shows noindex in the rendered document',detail:'This production homepage or primary page shows a noindex (or equivalent) directive in the rendered document. Published-response checks were unavailable, so this is a high-priority review rather than a confirmed published noindex.',reason:'rendered noindex on primary production page; published coverage incomplete'});
    return set(f,{visible:true,priority:'blocker',category:'fix',severity:'critical',title:'Production page requests noindex',detail:'This production page publishes a noindex directive. On a homepage or primary top-level page, that is a high-risk indexing problem unless intentionally configured.',reason:'indexing restriction on primary production page'});
  }
  if(renderedOnly)return set(f,{visible:true,priority:'high',category:'review',severity:'high',title:'Production page shows noindex in the rendered document',detail:'This production page shows a noindex (or equivalent) directive in the rendered document. Published-response checks were unavailable, so confirm whether the published response also excludes the page from search.',reason:'rendered noindex on production content page; published coverage incomplete'});
  return set(f,{visible:true,priority:'high',category:'fix',severity:'high',title:'Production page requests noindex',detail:'This production page publishes a noindex directive. Confirm this page is intentionally excluded from search before leaving the directive in place.',reason:'indexing restriction on production content page'});
}
function linkProminence(f){
  const p=f.link?.prominence||'normal';
  return p==='primary'||p==='navigation'||p==='cta';
}
function imagePurpose(f){
  return f.semantics?.imagePurpose||f.imagePurpose||null;
}
function isUncertainImageAlt(f){
  if(!/^axe\.image-alt/.test(String(f.ruleId||''))||f.axe?.incomplete)return false;
  const purpose=imagePurpose(f);
  // Only demote when purpose is unresolved. Do not demote informative/functional
  // images merely because classifier confidence is low.
  return purpose?.purpose==='uncertain';
}
function visibleByRule(rows,ruleId){
  return rows.filter(f=>f.ruleId===ruleId&&f.frankVisible!==false);
}
// Cross-tool duplicates inflate Recommended Order without adding a second problem.
// Keep the clearer browser rule and quiet the overlapping axe twin; evidence stays in full results.
function suppressAttentionDuplicates(rows){
  const quiet=(list,reason)=>{for(const f of list)set(f,{visible:false,priority:'quiet',reason})};
  if(visibleByRule(rows,'seo.title-missing').length&&visibleByRule(rows,'axe.document-title').length){
    quiet(visibleByRule(rows,'axe.document-title'),'duplicate of seo.title-missing; retained in full results');
  }
  if(visibleByRule(rows,'a11y.lang-missing').length&&visibleByRule(rows,'axe.html-has-lang').length){
    quiet(visibleByRule(rows,'axe.html-has-lang'),'duplicate of a11y.lang-missing; retained in full results');
  }
  if(visibleByRule(rows,'web.duplicate-id').length){
    quiet(visibleByRule(rows,'axe.duplicate-id').concat(visibleByRule(rows,'axe.duplicate-id-active'),visibleByRule(rows,'axe.duplicate-id-aria')),'duplicate of web.duplicate-id; retained in full results');
  }
  return rows;
}

export function applyFindingPolicy(findings=[],environment={type:'unknown'}){
  const env=environment?.type||'unknown';
  const mapped=findings.map(original=>{
    const f=clone(original);const signal=f.signal||signalForFinding(f);f.signal=signal;
    f.confidence=normalizeConfidence(f.confidence,'confirmed');
    f.verification=f.verification||{state:f.confidence,method:'normalized finding evidence',attempts:1,evidence:[]};
    const requestedQuiet=original.frankVisible===false;
    f.frankVisible=true;f.frankPriority=f.category==='fix'?'high':f.category==='review'?'medium':'low';

    if(f.confidence==='inconclusive'){
      return set(f,{visible:false,priority:'quiet',category:'review',severity:'low',reason:'available evidence is inconclusive; retained as coverage rather than a confirmed issue'});
    }
    if(f.confidence==='inferred'&&f.severity==='low'){
      return set(f,{visible:false,priority:'quiet',reason:'low-severity inferred observation remains available in the full scan but does not enter Frank by default'});
    }

    if(signal===SIGNALS.NOINDEX){
      if(shouldQuietNonProductionIndexing(environment))return set(f,{visible:false,priority:'quiet',category:'context',severity:'info',disposition:'environment-context',reason:`noindex is expected on ${env} environments`});
      if(env==='production')return productionNoindexPolicy(f,environment);
      return set(f,{visible:true,priority:'medium',category:'review',severity:'medium',reason:'environment is not confirmed'});
    }

    if(signal===SIGNALS.ROBOTS&&/robots-mismatch|robots-conflict/.test(f.ruleId||'')){
      if(shouldQuietNonProductionIndexing(environment))return set(f,{visible:false,priority:'quiet',category:'context',severity:'info',disposition:'environment-context',reason:`indexing-directive mismatch is retained as an environment fact on ${env}, not an ordinary Recommended Order defect`});
      if(env==='production')return set(f,{visible:true,priority:'high',category:'fix',severity:'high',reason:'production indexing directives disagree'});
      return set(f,{visible:true,priority:'medium',category:'review',severity:'medium',reason:'environment is not confirmed'});
    }

    if(signal===SIGNALS.ROBOTS&&/robots-block-all/.test(f.ruleId||'')){
      if(shouldQuietNonProductionIndexing(environment))return set(f,{visible:false,priority:'quiet',category:'context',severity:'info',disposition:'environment-context',reason:`crawl blocking is expected on ${env} environments`});
      if(env==='production')return set(f,{visible:true,priority:'blocker',category:'fix',severity:'critical',reason:'production robots.txt blocks crawling'});
      return set(f,{visible:true,priority:'high',category:'review',severity:'high',reason:'environment is not confirmed'});
    }

    if(signal===SIGNALS.BROKEN_LINK){
      const status=Number(f.link?.status||0),prominent=linkProminence(f);
      if(status>=500)return set(f,{visible:true,priority:'blocker',category:'fix',severity:'critical',reason:'internal destination returned a server error'});
      if(status===404||status===410){
        if(env==='production'&&prominent)return set(f,{visible:true,priority:'blocker',category:'fix',severity:'critical',reason:'prominent production navigation points to a missing page'});
        return set(f,{visible:true,priority:'high',category:'fix',severity:'high',reason:'confirmed broken internal navigation'});
      }
      return set(f,{visible:true,priority:'high',category:'fix',severity:'high'});
    }

    if(signal===SIGNALS.LINK_REVIEW){
      return set(f,{visible:false,priority:'quiet',category:'review',severity:'low',reason:'link checker could not verify the destination; this is not a confirmed defect'});
    }

    if(signal===SIGNALS.CANONICAL&&env==='production'&&/cross-host/.test(f.ruleId||'')&&environment?.canonicalContext?.relationshipToCurrentHost==='related-staging-host'){
      return set(f,{visible:true,priority:'high',category:'fix',severity:'high',reason:'production canonical points at a staging host'});
    }

    if(signal===SIGNALS.CANONICAL&&['staging','preview'].includes(env)&&/cross-host|mismatch/.test(f.ruleId||'')){
      if(environment?.canonicalRelationship==='same-site'||environment?.canonicalContext?.relationshipToCurrentHost==='related-production-host'){
        return set(f,{visible:false,priority:'quiet',category:'context',severity:'info',disposition:'launch-check',reason:'same-site production canonical can be expected on staging or preview'});
      }
      return set(f,{visible:true,priority:'medium',category:'review',severity:'medium',reason:'cross-site canonical is not automatically safe on a non-production host'});
    }

    if(/launch\.host-leakage-staging/.test(f.ruleId||'')){
      return set(f,{visible:true,priority:'high',category:'fix',severity:'high',reason:'production page links to a staging host'});
    }
    if(/launch\.host-mix/.test(f.ruleId||'')){
      return set(f,{visible:true,priority:'medium',category:'review',severity:'medium',disposition:'launch-check',reason:'equivalent routes split across staging and production hosts'});
    }

    if(f.supersededBy){
      f.worthChecking=false;
      return set(f,{visible:false,priority:'quiet',reason:`represented by ${f.supersededBy}`});
    }

    if(requestedQuiet||(f.rootCauseKey==='images-oversized-mild')||(f.imageMetrics?.magnitude==='mild'&&/image-oversized/.test(f.ruleId||''))){
      f.worthChecking=f.worthChecking!==false;
      return set(f,{visible:false,priority:'quiet',category:f.category||'review',severity:f.severity||'low',reason:'mild or scanner-quiet observation retained outside Recommended Order'});
    }

    if(/^(ux\.inert-link|ux\.form-no-submit|ux\.input-type-mismatch|seo\.robots-googlebot-conflict|runtime\.uncaught-error|security\.mixed-content-passive|web\.horizontal-overflow|runtime\.resource-failed-cross-origin|ux\.embed-resource-failed|ux\.iframe-missing-title|web\.iframe-title-missing|ux\.disclosure-toggle-failed|ux\.menu-toggle-failed|ux\.controls-target-missing|ux\.disclosure-target-missing|ux\.interaction-restoration-unproven|runtime\.resource-status-inconclusive)$/.test(f.ruleId||'')){
      f.worthChecking=true;
      return set(f,{visible:false,priority:'quiet',category:'review',severity:'low',reason:'review observation retained in Worth Checking rather than Recommended Order'});
    }

    if(/security\.blank-opener/.test(f.ruleId||'')){
      return set(f,{visible:true,priority:'low',category:'review',severity:'low',reason:'confirmed missing opener isolation on target=_blank; grouped in Recommended Order without blocker weight'});
    }

    if(/performance\.browser\.ttfb/.test(f.ruleId||'')){
      const pa=environment.performanceAssessment;
      const obs=f.performanceObservation||{};
      const ttfb=Number(obs.ttfbMs);
      const lcp=Number(obs.largestContentfulPaintMs);
      const fcp=Number(obs.firstContentfulPaintMs);
      const severe=Number.isFinite(ttfb)&&ttfb>3000;
      const corroborated=pa?.ttfbPresentation==='recommended'
        || severe
        || (Number.isFinite(ttfb)&&ttfb>1800&&((Number.isFinite(lcp)&&lcp>2500)||(Number.isFinite(fcp)&&fcp>1800)));
      if(!corroborated){
        return set(f,{
          visible:false,
          priority:'quiet',
          category:'context',
          severity:'info',
          disposition:'diagnostic-observation',
          reason:'TTFB is retained as a diagnostic lab observation unless corroborated by slow FCP/LCP, severe delay, or other supporting evidence'
        });
      }
      if(isNonProduction(env)){
        return set(f,{
          visible:true,
          priority:'low',
          category:'review',
          severity:'low',
          reason:'slow TTFB corroborated on a non-production host; treat production impact as uncertain'
        });
      }
      return set(f,{visible:true,priority:'medium',category:'review',severity:'medium',reason:'TTFB corroborated by slow visual metrics or severe delay'});
    }

    if(/runtime\.visible-error|ux\.visible-error/.test(f.ruleId||'')){
      return set(f,{visible:true,priority:'high',category:'fix',severity:'high',reason:'confirmed visible user-facing error state'});
    }

    if(isUncertainImageAlt(f)){
      return set(f,{visible:true,priority:'medium',category:'review',severity:'medium',reason:'image purpose is unresolved; keep visible without blocker materiality'});
    }

    if(/seo\.title-(long|short)|seo\.description-(long|missing|multiple)|seo\.canonical-missing|social\.og-incomplete|web\.charset-missing|structure\.(heading-skip|h1-missing|h1-multiple)/.test(f.ruleId||'')){
      return set(f,{visible:false,priority:'quiet',reason:'low materiality or optimization context'});
    }
    if(/axe\..*\.review$/.test(f.ruleId||'')||f.axe?.incomplete){
      return set(f,{visible:false,priority:'quiet',category:'review',severity:'low',reason:'manual-review result, not a confirmed violation'});
    }
    if((f.ruleId||'').startsWith('axe.')&&['minor'].includes(String(f.axe?.impact||''))){
      return set(f,{visible:false,priority:'quiet',reason:'minor accessibility issue remains available in full results'});
    }
    if(signal===SIGNALS.PERFORMANCE_MOBILE||signal===SIGNALS.PERFORMANCE_DESKTOP){
      const change=Number(f.performance?.mobileChange ?? f.performance?.desktopChange ?? 0);
      const score=Number(signal===SIGNALS.PERFORMANCE_MOBILE?f.performance?.mobile:f.performance?.desktop);
      if(Number.isFinite(change)&&change<=-15)return set(f,{visible:true,priority:'medium',category:'review',severity:'medium',reason:'material historical regression'});
      if(Number.isFinite(score)&&score<50)return set(f,{visible:true,priority:'medium',category:'review',severity:'medium',reason:'very low monitored performance'});
      return set(f,{visible:false,priority:'quiet',category:'context',severity:'info',reason:'performance context without a material regression'});
    }
    if(f.severity==='critical')f.frankPriority='blocker';
    else if(f.severity==='high'||f.category==='fix')f.frankPriority='high';
    else if(f.severity==='medium')f.frankPriority='medium';
    else if(f.category==='context')f.frankPriority='quiet';

    return f;
  }).map(f=>{
    // Drop sticky impactClass from older gateway artifacts so local re-apply
    // recomputes class from the current signal/rule mapping.
    const {impactClass:_ignored,...rest}=f;
    return {...rest,impactClass:impactClassFor(rest)};
  });
  return suppressAttentionDuplicates(mapped).sort((a,b)=>(scoreRank[b.frankPriority]||0)-(scoreRank[a.frankPriority]||0));
}
export function frankFindings(findings=[]){return findings.filter(f=>f.frankVisible!==false)}
export function presentationPolicySummary(findings=[]){
  const items=findings.filter(f=>f.presentationDisposition&&f.presentationDisposition!=='recommended').slice(0,24).map(f=>({
    ruleId:f.ruleId||'',
    disposition:f.presentationDisposition,
    reason:f.presentationReason||f.policyReason||''
  }));
  return{reclassifiedFindingCount:items.length,items};
}
