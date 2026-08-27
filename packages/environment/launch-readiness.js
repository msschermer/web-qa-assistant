import {
  classifyHostRelationship,
  hostLooksStaging,
  hostOf,
  isApexOrWww
} from './hosts.js';

function isNonProductionEnvironment(env){
  return ['staging','preview','local','development'].includes(String(env?.type||env||''));
}

function clip(value,max=220){
  const s=String(value??'').replace(/\s+/g,' ').trim();
  return s.length>max?`${s.slice(0,max-1)}…`:s;
}
function indexScopeDetail(indexControl={}){
  const scope=indexControl.checkedScope||{};
  const checked=(scope.checked||[]).join(', ')||'none';
  const unavailable=(scope.unavailable||[]).join(', ')||'none';
  return `Checked: ${checked}. Not checked in this scan: ${unavailable}. Confirm that exposing this URL to search engines is intentional.`;
}
function hash(input){
  let h=2166136261;
  for(let i=0;i<input.length;i++){h^=input.charCodeAt(i);h=Math.imul(h,16777619)}
  return(h>>>0).toString(36);
}

export function buildCanonicalContext({page={},environment={},canonicalCount}={}){
  const href=String(page.canonical||'').trim();
  const count=Number(canonicalCount||page.canonicalCount||(href?1:0));
  if(count>1){
    const host=hostOf(href);
    return{
      observed:true,
      href,
      normalizedHost:host,
      relationshipToCurrentHost:relationshipLabel(href,page,environment),
      assessment:'multiple'
    };
  }
  if(!href){
    return{observed:false,href:'',normalizedHost:'',relationshipToCurrentHost:'unknown',assessment:'missing'};
  }
  let parsed;
  try{parsed=new URL(href,page.url||undefined)}
  catch{
    return{observed:true,href,normalizedHost:'',relationshipToCurrentHost:'unknown',assessment:'unable-to-determine'};
  }
  return{
    observed:true,
    href:parsed.href,
    normalizedHost:hostOf(parsed.hostname),
    relationshipToCurrentHost:relationshipLabel(parsed.href,page,environment),
    assessment:'observed'
  };
}

function relationshipLabel(href,page,environment){
  const rel=classifyHostRelationship(href,{pageUrl:page.url,environmentType:environment.type});
  if(rel.class==='target-origin')return'same-host';
  if(rel.class==='production-host')return'related-production-host';
  if(rel.class==='staging-host')return'related-staging-host';
  if(rel.class==='same-site'){
    const dest=hostOf(href);
    if(isNonProductionEnvironment(environment)&&isApexOrWww(dest)&&!hostLooksStaging(dest))return'related-production-host';
    if(environment.type==='production'&&hostLooksStaging(dest))return'related-staging-host';
    return dest===hostOf(page.url)?'same-host':'unknown';
  }
  if(isNonProductionEnvironment(environment)&&isApexOrWww(hostOf(href))&&!hostLooksStaging(hostOf(href))){
    return'related-production-host';
  }
  if(rel.class==='third-party')return'external';
  return'unknown';
}

function observeAnalytics(page={}){
  const blob=[...(page.resourceHints||[]),page.generator||''].join(' ');
  const checked=Array.isArray(page.resourceHints);
  const gtm=[...new Set((blob.match(/GTM-[A-Z0-9]+/gi)||[]).map(s=>s.toUpperCase()))];
  const ga4=[...new Set(blob.match(/\bG-[A-Z0-9]{6,}\b/g)||[])];
  const tags=[];
  if(gtm.length)tags.push({type:'gtm',ids:gtm.slice(0,4)});
  if(ga4.length)tags.push({type:'ga4',ids:ga4.slice(0,4)});
  if(/connect\.facebook\.net|facebook\.net\/.+fbevents/i.test(blob))tags.push({type:'meta-pixel',ids:[]});
  if(/cdn\.callrail\.com|js\.callrail\.com/i.test(blob))tags.push({type:'callrail',ids:[]});
  if(/t\.calltrackingmetrics\.com|calltrackingmetrics/i.test(blob))tags.push({type:'ctm',ids:[]});
  return{checked,tags};
}

function observeForms(page={}){
  const actions=[...(page.formActions||[])].filter(Boolean).slice(0,8);
  const embeds=[...(page.embedHosts||[])].filter(Boolean).slice(0,8);
  return{
    formHosts:[...new Set(actions.map(href=>{try{return new URL(href).hostname}catch{return''}}).filter(Boolean))],
    embedHosts:[...new Set(embeds)]
  };
}

function classifyDest(url,page,environment,canonical){
  const productionHost=canonical?.relationshipToCurrentHost==='related-production-host'?canonical.normalizedHost:'';
  const stagingHost=canonical?.relationshipToCurrentHost==='related-staging-host'?canonical.normalizedHost:'';
  return classifyHostRelationship(url,{
    pageUrl:page.url,
    environmentType:environment.type,
    productionHost,
    stagingHost
  });
}

export function buildLaunchReadiness({
  page={},
  environment={},
  indexControl={},
  canonical=null,
  destinations=[],
  findings=[]
}={}){
  const items=[];
  const nonProd=isNonProductionEnvironment(environment);
  const canonicalContext=canonical||buildCanonicalContext({page,environment});
  const assessment=indexControl.assessment||'unable-to-determine';
  if(nonProd){
    if(assessment==='noindex-detected'){
      items.push({id:'index-noindex',category:'expected in staging',title:'A noindex directive was detected.',detail:'Consistent with a non-production environment. Confirm removal before launch.'});
    }else if(assessment==='crawl-restricted'){
      items.push({id:'index-robots-txt',category:'verify before launch',title:'robots.txt restricts crawling.',detail:'A crawl restriction is not the same as a noindex directive.'});
    }else if(assessment==='conflicting-signals'){
      items.push({id:'index-conflict',category:'inconsistent',title:'Indexing signals disagree.',detail:'One checked source indicates noindex while another advertises index.'});
    }else if(assessment==='unable-to-determine'){
      items.push({id:'index-unknown',category:'unable to determine',title:'Index-control state could not be determined.',detail:'Required robots or header sources were not available.'});
    }else if(assessment==='no-blocking-control-detected'){
      items.push({id:'index-open',category:'verify before launch',title:'No index-prevention control was detected in checked signals.',detail:indexScopeDetail(indexControl)});
    }
    if(canonicalContext.observed&&canonicalContext.relationshipToCurrentHost==='related-production-host'){
      items.push({id:'canonical-production',category:'expected in staging',title:'Canonical points to the production host.',detail:clip(canonicalContext.href,160)});
    }else if(canonicalContext.observed&&(canonicalContext.relationshipToCurrentHost==='related-staging-host'||(canonicalContext.relationshipToCurrentHost==='same-host'&&hostLooksStaging(canonicalContext.normalizedHost)))){
      items.push({id:'canonical-staging',category:'verify before launch',title:'Canonical currently points to the staging host. Confirm the intended production value before launch.',detail:clip(canonicalContext.href,160)});
    }else if(canonicalContext.assessment==='multiple'){
      items.push({id:'canonical-multiple',category:'inconsistent',title:'Multiple canonical declarations were observed.',detail:clip(canonicalContext.href,160)});
    }
  }

  const dests=Array.isArray(destinations)?destinations.slice(0,240):[];
  const stagingFromProd=[];
  const productionFromStaging=[];
  const byPath=new Map();
  for(const dest of dests){
    const url=dest.url||dest;
    const rel=classifyDest(url,page,environment,canonicalContext);
    let path='';
    try{path=new URL(url).pathname}catch{path=''}
    if(path){
      if(!byPath.has(path))byPath.set(path,{staging:[],production:[]});
      if(rel.class==='staging-host'||(rel.class==='target-origin'&&hostLooksStaging(hostOf(page.url))))byPath.get(path).staging.push(url);
      if(rel.class==='production-host'||(rel.class==='target-origin'&&environment.type==='production'))byPath.get(path).production.push(url);
    }
    if(environment.type==='production'&&rel.class==='staging-host')stagingFromProd.push({url,host:rel.host});
    if(nonProd&&rel.class==='production-host')productionFromStaging.push({url,host:rel.host});
  }
  if(stagingFromProd.length){
    const hosts=[...new Set(stagingFromProd.map(r=>r.host))];
    items.push({
      id:'leak-prod-to-staging',
      category:'actionable',
      title:`${stagingFromProd.length} internal link${stagingFromProd.length===1?'':'s'} point to a staging host from this production page.`,
      detail:hosts.slice(0,4).join(', '),
      count:stagingFromProd.length,
      instances:stagingFromProd.slice(0,24)
    });
  }
  if(productionFromStaging.length){
    items.push({
      id:'link-staging-to-production',
      category:'expected in staging',
      title:'This staging page links to a production host.',
      detail:'Often expected during development. Confirm the intended destination before launch if these should stay on staging.',
      count:productionFromStaging.length
    });
  }
  const mixed=[...byPath.entries()].filter(([,row])=>row.staging.length&&row.production.length).slice(0,12);
  if(mixed.length){
    items.push({
      id:'mixed-equivalent-routes',
      category:'verify before launch',
      title:'Equivalent internal destinations are split between staging and production hosts.',
      detail:`${mixed.length} path${mixed.length===1?'':'s'} appear on both environment hosts.`,
      count:mixed.length
    });
  }

  const analytics=observeAnalytics(page);
  if(nonProd&&analytics.checked){
    if(analytics.tags.length){
      items.push({
        id:'analytics-detected',
        category:'verify before launch',
        title:'Analytics tags were detected.',
        detail:analytics.tags.map(t=>t.type+(t.ids?.length?` ${t.ids.join(', ')}`:'')).join('; ')
      });
    }else{
      items.push({
        id:'analytics-none',
        category:'verify before launch',
        title:'No supported analytics tag was detected in the scanned page.',
        detail:'Only known GTM, GA4, Meta Pixel, CallRail, and CTM URL patterns were checked.'
      });
    }
  }
  const forms=observeForms(page);
  if(nonProd){
    for(const host of forms.formHosts.slice(0,4)){
      items.push({
        id:`form-host-${hash(host)}`,
        category:'verify before launch',
        title:`A form posts to ${host}.`,
        detail:'Observed form action host only. Integration correctness was not validated.'
      });
    }
    for(const host of forms.embedHosts.slice(0,4)){
      if(/leadconnectorhq|chat|widget|hubspot|calendly/i.test(host)){
        items.push({
          id:`embed-host-${hash(host)}`,
          category:'verify before launch',
          title:`An embed is loaded from ${host}.`,
          detail:'Observed iframe host only.'
        });
      }
    }
  }

  const checklist=[];
  if(nonProd){
    if(assessment==='noindex-detected')checklist.push('review/remove observed noindex directive');
    if(assessment==='crawl-restricted')checklist.push('confirm robots.txt crawl policy for production');
    if(assessment==='conflicting-signals')checklist.push('resolve disagreeing robots/index directives');
    if(canonicalContext.observed)checklist.push('verify canonical destination');
    if(stagingFromProd.length||mixed.length||(canonicalContext.relationshipToCurrentHost==='related-staging-host'))checklist.push('review staging-host internal links or canonical');
    if(analytics.checked)checklist.push(analytics.tags.length?'confirm production analytics identifiers':'confirm whether production analytics tags should be present');
    if(forms.formHosts.length)checklist.push('verify form endpoint');
  }

  return{
    items:items.slice(0,12),
    checklist,
    analytics,
    forms
  };
}

export function launchIntegrityFindings({page={},environment={},canonical=null,destinations=[]}={}){
  const readiness=buildLaunchReadiness({page,environment,canonical,destinations,indexControl:{}});
  const findings=[];
  const leak=readiness.items.find(item=>item.id==='leak-prod-to-staging');
  if(leak){
    findings.push({
      id:`launch.host-leakage-staging:${hash(leak.title)}`,
      ruleId:'launch.host-leakage-staging',
      title:leak.title,
      detail:leak.detail||'Production navigation points at a staging host.',
      category:'fix',
      severity:'high',
      confidence:'confirmed',
      sources:['browser'],
      targetType:'document',
      count:leak.count||1,
      evidence:leak.detail,
      instances:leak.instances||[],
      presentationHint:'recommended'
    });
  }
  const mixed=readiness.items.find(item=>item.id==='mixed-equivalent-routes');
  if(mixed&&environment.type==='production'){
    findings.push({
      id:`launch.host-mix:${hash(mixed.title)}`,
      ruleId:'launch.host-mix',
      title:mixed.title,
      detail:mixed.detail,
      category:'review',
      severity:'medium',
      confidence:'confirmed',
      sources:['browser'],
      targetType:'document',
      count:mixed.count||1,
      evidence:mixed.detail
    });
  }
  return findings;
}

export { observeAnalytics, observeForms };
