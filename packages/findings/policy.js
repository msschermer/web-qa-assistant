import { signalForFinding, SIGNALS } from './signals.js';
import { normalizeConfidence } from './confidence.js';
import { impactClassFor } from './impact.js';

const scoreRank={blocker:5,high:4,medium:3,low:2,quiet:1};
const UTILITY_PATH=/(^|\/)(thank-you|thanks|confirmation|confirmed|success|login|log-in|signin|sign-in|account|my-account|cart|checkout|search|wp-admin|admin)(\/|$)/i;
const LOW_VALUE_PATH=/(^|\/)(privacy(?:-policy)?|terms(?:-of-service)?|cookie(?:-policy)?)(\/|$)/i;

function clone(f){return {...f,sources:[...(f.sources||[])],wcag:[...(f.wcag||[])],verification:f.verification?{...f.verification,evidence:[...(f.verification.evidence||[])]}:undefined}}
function set(out,{visible=true,priority='medium',category,severity,title,detail,reason}={}){
  out.frankVisible=visible;out.frankPriority=priority;out.policyReason=reason||'';
  if(category)out.category=category;if(severity)out.severity=severity;if(title)out.title=title;if(detail)out.detail=detail;
  return out;
}
function pathnameOf(f){
  try{return new URL(f.pageUrl||f.url||f.link?.sourceUrl||'https://x.invalid/').pathname||'/'}
  catch{return'/'}
}
function productionNoindexPolicy(f,environment){
  const path=environment?.pathname||pathnameOf(f);
  if(UTILITY_PATH.test(path))return set(f,{visible:false,priority:'quiet',category:'context',severity:'info',title:'Noindex on a utility page',detail:'This production URL publishes noindex, but the path looks like a utility or transactional page where indexing is commonly intentional.',reason:'likely intentional noindex on utility path'});
  if(LOW_VALUE_PATH.test(path))return set(f,{visible:true,priority:'low',category:'review',severity:'low',title:'Review noindex on this production page',detail:'This production page publishes noindex. The path looks like policy content, so confirm the indexing intent before changing it.',reason:'production noindex on low-search-value path'});
  if(path==='/'||/^\/[^/]+\/?$/.test(path))return set(f,{visible:true,priority:'blocker',category:'fix',severity:'critical',title:'Production page requests noindex',detail:'This production page publishes a noindex directive. On a homepage or primary top-level page, that is a high-risk indexing problem unless intentionally configured.',reason:'indexing restriction on primary production page'});
  return set(f,{visible:true,priority:'high',category:'fix',severity:'high',title:'Production page requests noindex',detail:'This production page publishes a noindex directive. Confirm this page is intentionally excluded from search before leaving the directive in place.',reason:'indexing restriction on production content page'});
}
function linkProminence(f){
  const p=f.link?.prominence||'normal';
  return p==='primary'||p==='navigation'||p==='cta';
}
export function applyFindingPolicy(findings=[],environment={type:'unknown'}){
  const env=environment?.type||'unknown';
  return findings.map(original=>{
    const f=clone(original);const signal=f.signal||signalForFinding(f);f.signal=signal;
    f.confidence=normalizeConfidence(f.confidence,'confirmed');
    f.verification=f.verification||{state:f.confidence,method:'normalized finding evidence',attempts:1,evidence:[]};
    f.frankVisible=true;f.frankPriority=f.category==='fix'?'high':f.category==='review'?'medium':'low';

    if(f.confidence==='inconclusive'){
      return set(f,{visible:false,priority:'quiet',category:'review',severity:'low',reason:'available evidence is inconclusive; retained as coverage rather than a confirmed issue'});
    }
    if(f.confidence==='inferred'&&f.severity==='low'){
      return set(f,{visible:false,priority:'quiet',reason:'low-severity inferred observation remains available in the full scan but does not enter Frank by default'});
    }

    if(signal===SIGNALS.NOINDEX){
      if(['staging','preview','local'].includes(env))return set(f,{visible:false,priority:'quiet',category:'context',severity:'info',reason:`noindex is expected on ${env} environments`});
      if(env==='production')return productionNoindexPolicy(f,environment);
      return set(f,{visible:true,priority:'medium',category:'review',severity:'medium',reason:'environment is not confirmed'});
    }

    if(signal===SIGNALS.ROBOTS&&/robots-block-all/.test(f.ruleId||'')){
      if(['staging','preview','local'].includes(env))return set(f,{visible:false,priority:'quiet',category:'context',severity:'info',reason:`crawl blocking is expected on ${env} environments`});
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

    if(signal===SIGNALS.CANONICAL&&['staging','preview'].includes(env)&&/cross-host|mismatch/.test(f.ruleId||'')){
      if(environment?.canonicalRelationship==='same-site')return set(f,{visible:false,priority:'quiet',category:'context',severity:'info',reason:'same-site production canonical can be expected on staging or preview'});
      return set(f,{visible:true,priority:'medium',category:'review',severity:'medium',reason:'cross-site canonical is not automatically safe on a non-production host'});
    }

    if(/seo\.title-(long|short)|seo\.description-(long|missing|multiple)|seo\.canonical-missing|social\.og-incomplete|security\.blank-opener|web\.charset-missing|structure\.(heading-skip|h1-missing|h1-multiple)/.test(f.ruleId||'')){
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
  }).map(f=>({...f,impactClass:impactClassFor(f)})).sort((a,b)=>(scoreRank[b.frankPriority]||0)-(scoreRank[a.frankPriority]||0));
}
export function frankFindings(findings=[]){return findings.filter(f=>f.frankVisible!==false)}
