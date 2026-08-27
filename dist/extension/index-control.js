const ASSESSMENTS=['noindex-detected','crawl-restricted','conflicting-signals','no-blocking-control-detected','unable-to-determine'];

function clip(value,max=240){
  const s=String(value??'').replace(/\s+/g,' ').trim();
  return s.length>max?`${s.slice(0,max-1)}…`:s;
}
function hasToken(raw,token){
  return new RegExp(`\\b${token}\\b`,'i').test(String(raw||''));
}
function robotsField(raw,{checked=false}={}){
  const text=clip(raw||'');
  const present=Boolean(text);
  return{
    checked:checked||present,
    source:present?'observed':'not-observed',
    raw:text,
    noindex:hasToken(text,'noindex')||hasToken(text,'none'),
    nofollow:hasToken(text,'nofollow'),
    indexAdvertised:hasToken(text,'index')&&!hasToken(text,'noindex')
  };
}

export function publishedIndexSignalsFromContext(context={},report={}){
  const meta=context?.meta
    ||context?.services?.metaState
    ||report?.context?.services?.metaState
    ||report?.context?.meta
    ||null;
  const p=meta?.data?.snapshot?.pageMeta
    ||meta?.snapshot?.pageMeta
    ||context?.meta?.data?.snapshot?.pageMeta
    ||context?.meta?.snapshot?.pageMeta
    ||report?.context?.services?.metaState?.data?.snapshot?.pageMeta
    ||report?.context?.meta?.data?.snapshot?.pageMeta
    ||null;
  const robotsTxt=meta?.data?.snapshot?.robotsTxt
    ||meta?.snapshot?.robotsTxt
    ||context?.meta?.data?.snapshot?.robotsTxt
    ||context?.meta?.snapshot?.robotsTxt
    ||report?.context?.services?.metaState?.data?.snapshot?.robotsTxt
    ||null;
  const publishedRobots=p?[...(p.robots?.meta||[]),...(p.robots?.googlebot||[]),...(p.robots?.bingbot||[])].map(x=>x.content).filter(Boolean).join(', '):'';
  const xRobotsTag=p?.robots?.header?String(p.robots.header):'';
  return{
    publishedRobots,
    xRobotsTag,
    robotsTxt,
    publishedKnown:Boolean(p),
    xRobotsKnown:Boolean(p),
    robotsTxtKnown:robotsTxt!=null
  };
}

/**
 * Recover published index signals from confirmed correlation findings when Meta State
 * context was dropped during extension re-contextualization.
 */
export function publishedIndexSignalsFromFindings(findings=[]){
  let publishedRobots='';
  let xRobotsTag='';
  let publishedKnown=false;
  let xRobotsKnown=false;
  for(const f of findings||[]){
    const id=String(f.ruleId||'');
    const evidence=String(f.evidence||'');
    if(id==='seo.noindex-published'){
      publishedKnown=true;
      if(/\bnoindex\b/i.test(evidence))publishedRobots=publishedRobots||clip(evidence,240);
      else publishedRobots=publishedRobots||'noindex';
    }
    if(id==='correlation.robots-mismatch'){
      publishedKnown=true;
      const m=evidence.match(/published=([^;]*)/i);
      if(m?.[1]?.trim())publishedRobots=publishedRobots||clip(m[1].trim(),240);
    }
    if(/x-robots-tag|xrobotstag/i.test(evidence)&&/\bnoindex\b/i.test(evidence)){
      xRobotsKnown=true;
      xRobotsTag=xRobotsTag||'noindex';
    }
  }
  return{
    publishedRobots,
    xRobotsTag,
    robotsTxt:null,
    publishedKnown,
    xRobotsKnown,
    robotsTxtKnown:false,
    source:'findings'
  };
}

export function mergePublishedIndexSignals(...rows){
  const out={
    publishedRobots:'',
    xRobotsTag:'',
    robotsTxt:null,
    publishedKnown:false,
    xRobotsKnown:false,
    robotsTxtKnown:false,
    sources:[]
  };
  for(const row of rows){
    if(!row)continue;
    if(row.publishedRobots&&!out.publishedRobots)out.publishedRobots=row.publishedRobots;
    if(row.xRobotsTag&&!out.xRobotsTag)out.xRobotsTag=row.xRobotsTag;
    if(row.robotsTxt!=null&&out.robotsTxt==null)out.robotsTxt=row.robotsTxt;
    out.publishedKnown=out.publishedKnown||row.publishedKnown===true||Boolean(row.publishedRobots);
    out.xRobotsKnown=out.xRobotsKnown||row.xRobotsKnown===true||Boolean(row.xRobotsTag);
    out.robotsTxtKnown=out.robotsTxtKnown||row.robotsTxtKnown===true||row.robotsTxt!=null;
    if(row.source)out.sources.push(row.source);
  }
  return out;
}

/**
 * Enforce invariants between final findings and indexControl before presentation.
 */
export function reconcileIndexControlWithFindings(indexControl={},findings=[]){
  const next={...(indexControl||{})};
  const hasNoindexPublished=(findings||[]).some(f=>f.ruleId==='seo.noindex-published');
  const hasMismatch=(findings||[]).some(f=>f.ruleId==='correlation.robots-mismatch');
  if(hasNoindexPublished){
    const pub={...(next.publishedMetaRobots||{})};
    pub.checked=true;
    pub.noindex=true;
    if(!pub.raw)pub.raw='noindex';
    if(!pub.source||pub.source==='not-observed')pub.source='finding:seo.noindex-published';
    next.publishedMetaRobots=pub;
    next.noindexDetected=true;
    if(next.assessment==='no-blocking-control-detected'||!next.assessment){
      next.assessment=next.conflictingSignals?'conflicting-signals':'noindex-detected';
    }
  }
  if(hasMismatch){
    next.conflictingSignals=true;
    if(next.assessment==='no-blocking-control-detected')next.assessment='conflicting-signals';
    const pub={...(next.publishedMetaRobots||{})};
    if(!pub.checked){
      pub.checked=true;
      if(!pub.source||pub.source==='not-observed')pub.source='finding:correlation.robots-mismatch';
      next.publishedMetaRobots=pub;
    }
  }
  next.finalizationStage='post-correlation';
  return next;
}

export function buildIndexControl({
  page={},
  publishedRobots='',
  xRobotsTag='',
  robotsTxt=null,
  publishedKnown,
  xRobotsKnown,
  robotsTxtKnown,
  renderedKnown,
  authentication=null
}={}){
  const renderedRaw=String(page?.robots||'');
  const publishedRaw=String(publishedRobots||page?.publishedRobots||'');
  const headerRaw=String(xRobotsTag||page?.xRobotsTag||'');
  const renderedChecked=renderedKnown!==false;
  const publishedChecked=publishedKnown===true||Boolean(publishedRaw);
  const headerChecked=xRobotsKnown===true||Boolean(headerRaw);
  const robotsTxtRecord=robotsTxt&&typeof robotsTxt==='object'?robotsTxt:null;
  const robotsTxtChecked=robotsTxtKnown===true||robotsTxtRecord!=null;
  const crawlAllowed=robotsTxtRecord
    ?(robotsTxtRecord.globalDisallowAll===true?false:robotsTxtRecord.crawlAllowed!==false)
    :undefined;
  const metaRobots=robotsField(renderedRaw,{checked:renderedChecked});
  const publishedMetaRobots=robotsField(publishedRaw,{checked:publishedChecked});
  const xRobots=robotsField(headerRaw,{checked:headerChecked});
  const noindexSignals=[
    metaRobots.checked&&metaRobots.noindex,
    publishedMetaRobots.checked&&publishedMetaRobots.noindex,
    xRobots.checked&&xRobots.noindex
  ].filter(Boolean).length;
  const indexSignals=[
    metaRobots.checked&&metaRobots.indexAdvertised,
    publishedMetaRobots.checked&&publishedMetaRobots.indexAdvertised,
    xRobots.checked&&xRobots.indexAdvertised
  ].filter(Boolean).length;
  const anyNoindex=noindexSignals>0;
  const anyIndex=indexSignals>0;
  const conflicting=anyNoindex&&anyIndex;
  const crawlRestricted=robotsTxtChecked&&crawlAllowed===false;
  let assessment='no-blocking-control-detected';
  let evidenceConfidence='observed';
  if(conflicting){
    assessment='conflicting-signals';
    evidenceConfidence='corroborated';
  }else if(anyNoindex){
    assessment='noindex-detected';
    evidenceConfidence=noindexSignals>1?'corroborated':'confirmed';
  }else if(crawlRestricted){
    assessment='crawl-restricted';
    evidenceConfidence='confirmed';
  }else if(!renderedChecked&&!publishedChecked&&!headerChecked&&!robotsTxtChecked){
    assessment='unable-to-determine';
    evidenceConfidence='unable-to-verify';
  }else{
    assessment='no-blocking-control-detected';
    evidenceConfidence='observed';
  }

  return{
    metaRobots,
    publishedMetaRobots,
    xRobotsTag:xRobots,
    robotsTxt:{
      checked:robotsTxtChecked,
      crawlAllowed:crawlAllowed===undefined?null:crawlAllowed,
      matchedRule:robotsTxtRecord?.matchedRule||(robotsTxtRecord?.globalDisallowAll?'Disallow: /':''),
      source:robotsTxtRecord?.url||''
    },
    checkedScope:{
      checked:[
        renderedChecked?'rendered robots':null,
        publishedChecked?'published HTML':null,
        headerChecked?'HTTP X-Robots-Tag':null,
        robotsTxtChecked?'robots.txt':null
      ].filter(Boolean),
      unavailable:[
        renderedChecked?null:'rendered robots',
        publishedChecked?null:'published HTML',
        headerChecked?null:'HTTP X-Robots-Tag',
        robotsTxtChecked?null:'robots.txt'
      ].filter(Boolean)
    },
    authentication:{
      detected:Boolean(authentication?.detected),
      type:authentication?.type||''
    },
    assessment,
    evidenceConfidence,
    noindexDetected:anyNoindex,
    crawlRestricted,
    conflictingSignals:conflicting
  };
}

export function indexabilityState(page={},publishedRobots='',extras={}){
  const control=buildIndexControl({page,publishedRobots,...extras});
  return{
    blocked:control.noindexDetected,
    renderedBlocked:control.metaRobots.noindex,
    publishedBlocked:control.publishedMetaRobots.noindex||control.xRobotsTag.noindex,
    mismatch:control.conflictingSignals||Boolean(control.publishedMetaRobots.raw&&control.metaRobots.raw&&control.publishedMetaRobots.raw.toLowerCase()!==control.metaRobots.raw.toLowerCase()),
    publishedKnown:control.publishedMetaRobots.checked,
    renderedKnown:control.metaRobots.checked,
    crawlRestricted:control.crawlRestricted,
    assessment:control.assessment,
    evidenceConfidence:control.evidenceConfidence
  };
}

export function indexControlNoticeCopy(control={},environment={}){
  const type=String(environment?.type||'unknown');
  const kicker=type==='staging'?'STAGING ENVIRONMENT':`${String(type).toUpperCase()} ENVIRONMENT`;
  const assessment=control.assessment||'unable-to-determine';
  if(assessment==='noindex-detected'){
    return{
      kind:'environment-noindex-detected',
      tone:'info',
      kicker,
      title:'A noindex directive was detected on this page.',
      body:type==='staging'
        ?'This is consistent with a staging environment. Before launch, confirm the indexing restriction is removed.'
        :`This is consistent with a ${type} environment. Before launch, confirm the indexing restriction is removed.`
    };
  }
  if(assessment==='crawl-restricted'){
    return{
      kind:'environment-crawl-restricted',
      tone:'info',
      kicker,
      title:'Crawling is restricted by robots.txt.',
      body:'This does not by itself guarantee that the URL cannot appear in search results. Confirm the intended launch configuration.'
    };
  }
  if(assessment==='conflicting-signals'){
    return{
      kind:'environment-index-conflict',
      tone:'warn',
      kicker,
      title:'Indexing signals are inconsistent.',
      body:'One checked source indicates noindex while another advertises indexability. Review the directives before launch.'
    };
  }
  if(assessment==='unable-to-determine'){
    return{
      kind:'environment-index-unknown',
      tone:'info',
      kicker,
      title:'Web QA could not determine the page’s index-control state from the available signals.',
      body:'Review indexing controls before launch.'
    };
  }
  return{
    kind:'environment-no-blocking-control',
    tone:'warn',
    kicker,
    title:'No index-prevention control was detected in the signals Web QA checked.',
      body:(()=>{
        const scope=control.checkedScope||{};
        const checked=(scope.checked||[]).join(', ')||'checked signals';
        const unavailable=(scope.unavailable||[]).length?` Not checked in this scan: ${(scope.unavailable||[]).join(', ')}.`:'';
        const base=type==='staging'
          ?'Confirm that exposing this staging URL to search engines is intentional.'
          :`Confirm that exposing this ${type} URL to search engines is intentional.`;
        return `${base} Checked: ${checked}.${unavailable}`;
      })()
  };
}

export { ASSESSMENTS as INDEX_CONTROL_ASSESSMENTS };
