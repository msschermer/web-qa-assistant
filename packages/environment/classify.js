import {
  hostOf,
  registrableDomain,
  sameSiteFamily,
  isLocalEnvironmentHost,
  isApexOrWww,
  knownSuffixMatch,
  labelTokens,
  KNOWN_STAGING_SUFFIXES,
  PREVIEW_SUFFIXES,
  STAGE_LABEL_TOKEN,
  DEV_LABEL_TOKEN,
  TEST_LABEL_TOKEN,
  PREVIEW_LABEL
} from './hosts.js';
import {
  buildIndexControl,
  indexabilityState,
  indexControlNoticeCopy,
  publishedIndexSignalsFromContext,
  publishedIndexSignalsFromFindings,
  mergePublishedIndexSignals,
  reconcileIndexControlWithFindings
} from './index-control.js';
import { buildCanonicalContext, buildLaunchReadiness, launchIntegrityFindings } from './launch-readiness.js';

export const ENVIRONMENT_TYPES=['production','staging','development','preview','local','unknown'];
export const NON_PRODUCTION_ENVIRONMENTS=['staging','preview','local','development'];
export { hostOf, registrableDomain, sameSiteFamily, isLocalEnvironmentHost };
export {
  buildIndexControl,
  indexabilityState,
  publishedIndexSignalsFromContext,
  publishedIndexSignalsFromFindings,
  mergePublishedIndexSignals,
  reconcileIndexControlWithFindings
};
export { buildCanonicalContext, buildLaunchReadiness, launchIntegrityFindings };

function clamp(n,min=0,max=1){return Math.max(min,Math.min(max,n))}
function confidenceLabel(confidence,source){
  if(source==='manual'||source==='user')return'confirmed';
  return confidence>=.98?'certain':confidence>=.88?'high':confidence>=.68?'medium':'low';
}
function labels(host){return String(host||'').split('.').filter(Boolean)}
function canonicalRelationship(host,canonical){
  const ch=hostOf(canonical);
  if(!host||!ch)return'none';
  if(host===ch)return'same-host';
  if(sameSiteFamily(host,ch))return'same-site';
  return'cross-site';
}
export function isNonProductionEnvironment(env){
  return NON_PRODUCTION_ENVIRONMENTS.includes(String(env?.type||env||''));
}

function tokenKind(host){
  const tokens=labelTokens(host);
  const dnsLabels=labels(host);
  const stagingDns=dnsLabels.some(l=>STAGE_LABEL_TOKEN.test(l));
  const stagingHyphen=tokens.some(t=>STAGE_LABEL_TOKEN.test(t));
  const devDns=dnsLabels.some(l=>DEV_LABEL_TOKEN.test(l));
  const devHyphen=tokens.some(t=>DEV_LABEL_TOKEN.test(t));
  const testToken=tokens.some(t=>TEST_LABEL_TOKEN.test(t));
  if(stagingDns)return{kind:'staging',weight:.96,signal:'hostname-label:staging'};
  if(stagingHyphen)return{kind:'staging',weight:.9,signal:'hostname-token:staging'};
  if(devDns)return{kind:'development',weight:.92,signal:'hostname-label:development'};
  if(devHyphen)return{kind:'development',weight:.78,signal:'hostname-token:development'};
  if(testToken)return{kind:'staging',weight:.72,signal:'hostname-token:test'};
  return null;
}

export function classifyEnvironment(page={},options={}){
  const url=page.url||page.finalUrl||'';
  const host=hostOf(url||page.hostname);
  const parsed=(()=>{try{return new URL(url)}catch{return null}})();
  const origin=parsed?.origin||'';
  const pathname=parsed?.pathname||'/';
  const overrideRaw=String(options.override||'').toLowerCase();
  const override=overrideRaw==='dev'?'development':overrideRaw;
  const canonical=options.canonical||page.canonical||'';
  const relationship=canonicalRelationship(host,canonical);
  const indexability=options.indexability||indexabilityState(page,options.publishedRobots||'',options.indexControlExtras||{});
  const base={origin,pathname,hostname:host,registrableDomain:registrableDomain(host),canonicalRelationship:relationship,indexability};

  if(ENVIRONMENT_TYPES.includes(override)&&override!=='unknown'){
    const signals=['user-override'];
    if(indexability.blocked)signals.push(indexability.publishedBlocked?'published-noindex':'rendered-noindex');
    return {type:override,kind:override,confidence:1,confidenceLabel:'confirmed',source:'manual',signals,...base};
  }
  if(isLocalEnvironmentHost(host)){
    const signals=['local-or-private-host'];
    if(indexability.blocked)signals.push(indexability.publishedBlocked?'published-noindex':'rendered-noindex');
    return {type:'local',kind:'local',confidence:1,confidenceLabel:'certain',source:'auto',signals,...base};
  }

  const signals=[];
  let type='unknown',confidence=.46;

  const knownStaging=knownSuffixMatch(host,KNOWN_STAGING_SUFFIXES);
  const knownPreview=knownSuffixMatch(host,PREVIEW_SUFFIXES);
  const tokens=tokenKind(host);

  if(knownStaging){
    type='staging';confidence=.97;signals.push(`known-host:${knownStaging}`);
  }else if(tokens?.kind==='staging'){
    type='staging';confidence=tokens.weight;signals.push(tokens.signal);
  }else if(knownPreview||PREVIEW_LABEL.test(host)){
    type='preview';confidence=.92;signals.push(knownPreview?`known-host:${knownPreview}`:'preview-or-deployment-hostname');
  }else if(tokens?.kind==='development'){
    type='development';confidence=tokens.weight;signals.push(tokens.signal);
  }else if(isApexOrWww(host)){
    type='production';confidence=.88;signals.push('apex-or-www-public-domain');
  }else if(host){
    type='unknown';confidence=.55;signals.push('public-subdomain-without-strong-marker');
  }

  if(canonical){
    if(relationship==='same-host'){
      signals.push('canonical-matches-current-host');
      if(type==='production')confidence+=.06;
      else if(type==='unknown')confidence+=.05;
    }else if(relationship==='same-site'){
      signals.push('canonical-same-site-family');
      if(type==='staging'||type==='preview'||type==='development')confidence+=.02;
      if(type==='unknown')confidence=.58;
    }else if(relationship==='cross-site'){
      signals.push('canonical-cross-site');
      if(type==='production')confidence-=.08;
      if(type==='unknown')confidence=.5;
    }
  }
  if(options.monitored===true){
    signals.push('host-is-explicitly-monitored');
    if(type==='production')confidence+=.07;
    else if(type==='unknown'){type='production';confidence=.82}
  }

  if(indexability.blocked){
    if(isNonProductionEnvironment({type})){
      signals.push(indexability.publishedBlocked?'published-noindex':'rendered-noindex');
      confidence=clamp(confidence+.02);
    }else{
      signals.push(indexability.publishedBlocked?'published-noindex':'rendered-noindex');
    }
  }

  confidence=clamp(confidence);
  const source='auto';
  return {type,kind:type,confidence,confidenceLabel:confidenceLabel(confidence,source),source,signals,...base};
}

function controlFrom(control={}){
  if(control&&control.assessment)return control;
  if(control?.mismatch)return{assessment:'conflicting-signals'};
  if(control?.blocked||control?.noindexDetected)return{assessment:'noindex-detected'};
  if(control?.crawlRestricted)return{assessment:'crawl-restricted'};
  return{assessment:'no-blocking-control-detected'};
}

export function environmentNotice(environment={},control=environment?.indexControl||environment?.indexability||{}){
  const type=String(environment?.type||'unknown');
  const indexControl=controlFrom(control);
  if(isNonProductionEnvironment(environment)){
    return indexControlNoticeCopy(indexControl,environment);
  }
  if(type==='production'&&(indexControl.assessment==='noindex-detected'||indexControl.assessment==='conflicting-signals')){
    return{
      kind:'production-index-blocked',
      tone:'critical',
      kicker:indexControl.assessment==='conflicting-signals'?'INDEXING SIGNALS DISAGREE':'NOINDEX DIRECTIVE DETECTED',
      title:indexControl.assessment==='conflicting-signals'
        ?'This production page has inconsistent indexing signals.'
        :'This production page publishes a noindex directive.',
      body:indexControl.assessment==='conflicting-signals'
        ?'Treat disagreeing robots/index directives as a high-priority discoverability problem until they converge.'
        :'Treat this as a high-priority discoverability problem unless the page is intentionally excluded from search.',
      extra:indexControl.assessment==='conflicting-signals'?'One checked source indicates noindex while another advertises index. Resolve them before relying on crawl behavior.':''
    };
  }
  if(indexControl.assessment==='noindex-detected'||indexControl.assessment==='conflicting-signals'){
    return{
      kind:'unknown-index-blocked',
      tone:'warn',
      kicker:'ENVIRONMENT NOT ESTABLISHED',
      title:'A noindex directive was detected, but this host could not be classified as staging or production.',
      body:'Do not assume this is a staging site. Treat the indexing observation as a real issue until the environment is confirmed.',
      extra:''
    };
  }
  return null;
}

export function attachEnvironmentContext(page={},options={}){
  const extras={
    publishedRobots:options.publishedRobots||'',
    xRobotsTag:options.xRobotsTag||'',
    robotsTxt:options.robotsTxt||null,
    publishedKnown:options.publishedKnown,
    xRobotsKnown:options.xRobotsKnown,
    robotsTxtKnown:options.robotsTxtKnown,
    renderedKnown:options.renderedKnown,
    authentication:options.authentication||null
  };
  let indexControl=options.indexControl||buildIndexControl({page,...extras});
  if(options.findings?.length){
    indexControl=reconcileIndexControlWithFindings(indexControl,options.findings);
  }else{
    indexControl={...indexControl,finalizationStage:indexControl.finalizationStage||'environment-attach'};
  }
  const indexability=indexabilityState(page,extras.publishedRobots||indexControl.publishedMetaRobots?.raw||'',{
    ...extras,
    publishedRobots:extras.publishedRobots||indexControl.publishedMetaRobots?.raw||'',
    publishedKnown:extras.publishedKnown===true||indexControl.publishedMetaRobots?.checked===true,
    xRobotsTag:extras.xRobotsTag||indexControl.xRobotsTag?.raw||'',
    xRobotsKnown:extras.xRobotsKnown===true||indexControl.xRobotsTag?.checked===true
  });
  if(indexControl.noindexDetected)indexability.blocked=true;
  if(indexControl.publishedMetaRobots?.noindex)indexability.publishedBlocked=true;
  if(indexControl.conflictingSignals)indexability.mismatch=true;
  if(indexControl.assessment)indexability.assessment=indexControl.assessment;
  const environment=classifyEnvironment(page,{
    override:options.override,
    canonical:options.canonical||page.canonical,
    monitored:options.monitored,
    indexability,
    publishedRobots:extras.publishedRobots||indexControl.publishedMetaRobots?.raw||''
  });
  environment.pathname=options.pathname||(()=>{try{return new URL(page.url).pathname}catch{return'/'}})();
  environment.indexControl=indexControl;
  environment.indexability=indexability;
  environment.canonicalContext=buildCanonicalContext({page,environment,canonicalCount:options.canonicalCount});
  environment.launchReadiness=buildLaunchReadiness({
    page,
    environment,
    indexControl,
    canonical:environment.canonicalContext,
    destinations:options.destinations||[],
    findings:options.findings||[]
  });
  environment.notice=environmentNotice(environment,indexControl);
  return environment;
}

export function environmentLabel(env){
  const type=String(env?.type||'unknown');
  return type.charAt(0).toUpperCase()+type.slice(1);
}
