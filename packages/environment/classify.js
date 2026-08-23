export const ENVIRONMENT_TYPES=['production','staging','preview','local','unknown'];

const COMMON_SECOND_LEVEL=new Set(['co.uk','org.uk','gov.uk','ac.uk','com.au','net.au','org.au','co.nz','com.br','com.mx','co.jp','co.in','com.sg','com.tr','com.cn']);
const STAGE_TOKEN=/^(stage|staging|stg|dev|development|test|testing|qa|uat|sandbox|preprod|pre-prod|demo)(?:[.-]|$)/i;
const STAGE_LABEL=/(^|\.)(stage|staging|stg|dev|development|test|testing|qa|uat|sandbox|preprod|pre-prod)(\.|$)/i;
const PREVIEW_LABEL=/(^|\.)(preview|pr-\d+|deploy-preview-\d+|branch-[a-z0-9-]+)(\.|$)/i;
const PREVIEW_SUFFIXES=['vercel.app','netlify.app','pages.dev','web.app','firebaseapp.com','onrender.com','surge.sh'];
const STAGING_SUFFIXES=['wpenginepowered.com','pantheonsite.io','flywheelsites.com'];

function hostOf(value){
  const raw=String(value||'').trim();
  if(!raw)return'';
  try{return new URL(raw.includes('://')?raw:`https://${raw}`).hostname.toLowerCase().replace(/\.$/,'')}
  catch{return raw.toLowerCase().replace(/\.$/,'')}
}
function privateIpv4(host){
  if(/^127\./.test(host)||/^10\./.test(host)||/^192\.168\./.test(host)||/^169\.254\./.test(host))return true;
  const m=/^172\.(\d+)\./.exec(host);
  return !!(m&&Number(m[1])>=16&&Number(m[1])<=31);
}
function isIpv4(host){return /^\d{1,3}(?:\.\d{1,3}){3}$/.test(host)}
function isIpv6(host){return host.includes(':')}
function labels(host){return host.split('.').filter(Boolean)}
function clamp(n,min=0,max=1){return Math.max(min,Math.min(max,n))}
function confidenceLabel(confidence,source){
  if(source==='user')return'confirmed';
  return confidence>=.98?'certain':confidence>=.88?'high':confidence>=.68?'medium':'low';
}
export function registrableDomain(host){
  const h=hostOf(host);
  if(!h||isIpv4(h)||isIpv6(h)||h==='localhost')return h;
  const parts=labels(h);
  if(parts.length<=2)return h;
  const last2=parts.slice(-2).join('.');
  if(COMMON_SECOND_LEVEL.has(last2)&&parts.length>=3)return parts.slice(-3).join('.');
  return last2;
}
export function sameSiteFamily(a,b){
  const ah=hostOf(a),bh=hostOf(b);
  if(!ah||!bh)return false;
  return registrableDomain(ah)===registrableDomain(bh);
}
export function isLocalEnvironmentHost(host){
  const h=hostOf(host);
  return h==='localhost'||h==='::1'||h.endsWith('.localhost')||h.endsWith('.local')||h.endsWith('.test')||h.endsWith('.internal')||privateIpv4(h);
}
function isApexOrWww(host){
  const h=hostOf(host);
  if(!h||isIpv4(h)||isIpv6(h))return false;
  const root=registrableDomain(h);
  return h===root||h===`www.${root}`;
}
function canonicalRelationship(host,canonical){
  const ch=hostOf(canonical);
  if(!host||!ch)return'none';
  if(host===ch)return'same-host';
  if(sameSiteFamily(host,ch))return'same-site';
  return'cross-site';
}
export function classifyEnvironment(page={},options={}){
  const url=page.url||page.finalUrl||'';
  const host=hostOf(url||page.hostname);
  const parsed=(()=>{try{return new URL(url)}catch{return null}})();
  const origin=parsed?.origin||'';
  const pathname=parsed?.pathname||'/';
  const override=String(options.override||'').toLowerCase();
  const canonical=options.canonical||page.canonical||'';
  const relationship=canonicalRelationship(host,canonical);
  if(ENVIRONMENT_TYPES.includes(override)&&override!=='unknown'){
    return {type:override,confidence:1,confidenceLabel:'confirmed',source:'user',origin,pathname,hostname:host,registrableDomain:registrableDomain(host),canonicalRelationship:relationship,signals:['user override']};
  }
  if(isLocalEnvironmentHost(host)){
    return {type:'local',confidence:1,confidenceLabel:'certain',source:'inferred',origin,pathname,hostname:host,registrableDomain:registrableDomain(host),canonicalRelationship:relationship,signals:['local or private host']};
  }

  const signals=[];
  let type='unknown',confidence=.46;

  if(STAGE_TOKEN.test(host)||STAGE_LABEL.test(host)||STAGING_SUFFIXES.some(s=>host===s||host.endsWith('.'+s))){
    type='staging';confidence=.96;signals.push('staging hostname pattern');
  }else if(PREVIEW_SUFFIXES.some(s=>host===s||host.endsWith('.'+s))||PREVIEW_LABEL.test(host)){
    type='preview';confidence=.92;signals.push('preview or deployment hostname');
  }else if(isApexOrWww(host)){
    type='production';confidence=.88;signals.push('apex or www public business domain');
  }else if(host){
    type='unknown';confidence=.55;signals.push('public subdomain without a strong environment marker');
  }

  if(canonical){
    if(relationship==='same-host'){
      signals.push('canonical matches current host');
      if(type==='production')confidence+=.06;
      else if(type==='unknown')confidence+=.05;
    }else if(relationship==='same-site'){
      signals.push('canonical stays within the same site family');
      if(type==='staging'||type==='preview')confidence+=.02;
      if(type==='unknown')confidence=.58;
    }else if(relationship==='cross-site'){
      signals.push('canonical points to a different site family');
      if(type==='production')confidence-=.08;
      if(type==='unknown')confidence=.5;
    }
  }
  if(options.monitored===true){
    signals.push('host is explicitly monitored');
    if(type==='production')confidence+=.07;
    else if(type==='unknown'){type='production';confidence=.82}
  }

  confidence=clamp(confidence);
  const source='inferred';
  return {type,confidence,confidenceLabel:confidenceLabel(confidence,source),source,origin,pathname,hostname:host,registrableDomain:registrableDomain(host),canonicalRelationship:relationship,signals};
}
export function environmentLabel(env){
  const type=String(env?.type||'unknown');
  return type.charAt(0).toUpperCase()+type.slice(1);
}
