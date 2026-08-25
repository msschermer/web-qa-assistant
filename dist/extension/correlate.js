import { signalForFinding } from './signals.js';
import { normalizeConfidence } from './confidence.js';
import { composeAttention, composedBrief } from './compose.js';
import {
  applyLocalDiscoverabilityCorrelations,
  applyPerformanceCorrelations,
  attachCorrelationMetadata,
  composeWorthChecking,
  detectPlatform
} from './correlation.js';

const rank={fix:3,review:2,context:1};
const severity={critical:5,high:4,medium:3,low:2,info:1};
function norm(v){return String(v??'').trim()}
function hash(input){let h=2166136261;for(let i=0;i<input.length;i++){h^=input.charCodeAt(i);h=Math.imul(h,16777619)}return(h>>>0).toString(36)}
function mk(ruleId,title,detail,category='review',severityLevel='medium',sources=['connected'],extra={}){
  const selector=extra.selector||'',evidence=extra.evidence||'',fingerprint=hash(`${ruleId}|${selector}|${evidence}`);
  const defaultConfidence=sources.length>1?'corroborated':category==='review'?'inferred':'confirmed';
  const confidence=normalizeConfidence(extra.confidence,defaultConfidence);
  const f={id:`${ruleId}:${fingerprint}`,ruleId,title,detail,category,severity:severityLevel,sources,selector,targetId:extra.targetId||'',targetType:extra.targetType||'page',evidence,wcag:extra.wcag||[],helpUrl:extra.helpUrl||'',count:extra.count||1,fingerprint,confidence,verification:extra.verification||{state:confidence,method:sources.length>1?'cross-tool comparison':'connected-tool observation',attempts:1,evidence:evidence?[evidence]:[]},...extra};
  f.signal=f.signal||signalForFinding(f);return f;
}
function canonicalFromMeta(meta){return meta?.snapshot?.pageMeta?.canonical?.resolved||meta?.report?.snapshot?.pageMeta?.canonical?.resolved||''}
function titleFromMeta(meta){return meta?.snapshot?.pageMeta?.title?.value||meta?.report?.snapshot?.pageMeta?.title?.value||''}
function robotsFromMeta(meta){
  const p=meta?.snapshot?.pageMeta||meta?.report?.snapshot?.pageMeta;if(!p)return'';
  return [...(p.robots?.meta||[]),...(p.robots?.googlebot||[]),...(p.robots?.bingbot||[])].map(x=>x.content).filter(Boolean).concat(p.robots?.header?[p.robots.header]:[]).join(', ');
}
function dedupe(findings){
  const out=new Map();
  for(const f0 of findings){
    const f={...f0};const key=`${f.ruleId}|${f.selector||''}|${f.evidence||f.title}`,fingerprint=f.fingerprint||hash(key);
    const defaultConfidence=f.category==='review'?'inferred':'confirmed';
    const confidence=normalizeConfidence(f.confidence,defaultConfidence);
    const normalized={...f,id:f.id||`${f.ruleId}:${fingerprint}`,fingerprint,targetId:f.targetId||'',targetType:f.targetType||'page',signal:f.signal||signalForFinding(f),sources:[...new Set(f.sources||[])],confidence,verification:f.verification||{state:confidence,method:'normalized connected finding',attempts:1,evidence:[]}};
    const existing=out.get(key);
    if(!existing)out.set(key,normalized);else existing.sources=[...new Set([...(existing.sources||[]),...(normalized.sources||[])])];
  }
  return [...out.values()].sort((a,b)=>(rank[b.category]-rank[a.category])||(severity[b.severity]-severity[a.severity]));
}
export function correlate(local,context={}){
  const findings=[...(local.findings||[])],localPage=local.page||{},meta=context.meta?.data;
  if(meta){
    const publishedCanonical=canonicalFromMeta(meta),publishedTitle=titleFromMeta(meta),publishedRobots=robotsFromMeta(meta);
    if(publishedCanonical&&localPage.canonical&&publishedCanonical!==localPage.canonical)findings.push(mk('correlation.canonical-mismatch','Rendered and published canonicals disagree',`Browser canonical is ${localPage.canonical}; published inspection reports ${publishedCanonical}.`,'fix','high',['browser','meta-state'],{evidence:`browser=${localPage.canonical}; published=${publishedCanonical}`,targetType:'document'}));
    if(publishedTitle&&localPage.title&&norm(publishedTitle)!==norm(localPage.title))findings.push(mk('correlation.title-mismatch','Rendered and published titles differ','JavaScript or another runtime change appears to alter the title after the initial published document. Review whether crawlers and users receive the intended state.','review','medium',['browser','meta-state'],{evidence:`browser=${localPage.title}; published=${publishedTitle}`,targetType:'document'}));
    if(publishedRobots&&localPage.robots&&norm(publishedRobots).toLowerCase()!==norm(localPage.robots).toLowerCase())findings.push(mk('correlation.robots-mismatch','Rendered and published robots directives differ','The browser and published-state inspection disagree about robots directives. Resolve the conflict before relying on indexing behavior.','fix','high',['browser','meta-state'],{evidence:`browser=${localPage.robots}; published=${publishedRobots}`,targetType:'document'}));
    if(/\bnoindex\b/i.test(publishedRobots)&&!/\bnoindex\b/i.test(localPage.robots||''))findings.push(mk('seo.noindex-published','Published response requests noindex','Published-state inspection found a noindex directive that is not visible in the rendered robots meta value. Check response headers and crawler-specific directives.','fix','high',['meta-state'],{evidence:publishedRobots,targetType:'document'}));
    const robotsTxt=meta?.snapshot?.robotsTxt||meta?.report?.snapshot?.robotsTxt;
    if(robotsTxt?.globalDisallowAll)findings.push(mk('seo.robots-block-all','robots.txt blocks all crawling','The published robots.txt contains a global Disallow: / rule.','fix','critical',['meta-state'],{evidence:robotsTxt.url||'Disallow: /',targetType:'document'}));
  }
  const perf=context.performance?.data;
  if(perf?.monitored){
    const t=perf.threshold??70;
    if(Number.isFinite(perf.mobile)&&perf.mobile<t)findings.push(mk('performance.mobile-below-target','Mobile performance is below target',`Latest completed mobile score is ${perf.mobile}, below the configured target of ${t}.`,'context','info',['performance-monitor'],{evidence:`${perf.mobile}/${t}`,performance:perf,targetType:'historical'}));
    if(Number.isFinite(perf.desktop)&&perf.desktop<t)findings.push(mk('performance.desktop-below-target','Desktop performance is below target',`Latest completed desktop score is ${perf.desktop}, below the configured target of ${t}.`,'context','info',['performance-monitor'],{evidence:`${perf.desktop}/${t}`,performance:perf,targetType:'historical'}));
    if(Number.isFinite(perf.mobileChange)&&Math.abs(perf.mobileChange)>=10)findings.push(mk('performance.mobile-trend','Mobile performance changed materially',`Mobile moved ${perf.mobileChange>0?'+':''}${perf.mobileChange} points across recent successful scans.`,'context','info',['performance-monitor'],{evidence:String(perf.mobileChange),performance:perf,targetType:'historical'}));
  }
  const wcagMap=context.wcag?.data?.mapping||{};
  for(const f of findings){
    if(f.ruleId?.startsWith('axe.')){
      const key=f.ruleId.replace(/^axe\./,'').replace(/\.review$/,'');
      if(wcagMap[key]){f.wcag=[...new Set([...(f.wcag||[]),...(wcagMap[key].criteria||[])])];f.wcagExplanation=wcagMap[key].summary||'';f.sources=[...new Set([...(f.sources||[]),'wcag-translator'])]}
    }
  }
  return finalizeCorrelatedFindings(dedupe(findings), local);
}

/**
 * Attach cross-discipline correlation metadata and local (browser-only) issue
 * correlations. Safe to call from extension contextualize and gateway enrich.
 */
export function finalizeCorrelatedFindings(findings=[], local={}){
  const page=local.page||{};
  let next=applyLocalDiscoverabilityCorrelations(findings, page);
  next=applyPerformanceCorrelations(next, local.browserPerformance||page.browserPerformance||null);
  const platform=detectPlatform(page, page.documentHtmlSample||'');
  next=attachCorrelationMetadata(next, {platform});
  if(platform?.id){
    page.platform=platform;
  }
  return next;
}

export function composeReportAttention(findings=[], {limit=8}={}){
  const attention=composeAttention(findings,{limit});
  return {
    ...attention,
    worthChecking: composeWorthChecking(findings, attention.groups).map(w=>({
      ...w,
      findingIds: w.findings.map(f=>f.id)
    }))
  };
}
// The brief is composed across impact classes so a single noisy scanner cannot
// occupy it. Grouping happens first, so six instances of one rule read as one
// problem and leave room for links, indexing and performance.
export function deterministicBrief(findings, context={}){
  const composition=composeAttention(findings);
  return composedBrief(composition,{linkAudit:context?.linkAudit||null,coverage:context?.coverage||{},targetIntegrity:context?.targetIntegrity||context?.page?.targetIntegrity||null});
}
export { composeAttention, composedBrief } from './compose.js';
export {
  attachCorrelationMetadata,
  composeWorthChecking,
  detectPlatform,
  sanitizeMarkupSnippet,
  TARGETABILITY
} from './correlation.js';
