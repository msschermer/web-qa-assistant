const COMMON_SECOND_LEVEL=new Set(['co.uk','org.uk','gov.uk','ac.uk','com.au','net.au','org.au','co.nz','com.br','com.mx','co.jp','co.in','com.sg','com.tr','com.cn']);
const STAGE_LABEL_TOKEN=/^(stage|staging|stg|sandbox|uat|preprod|pre-prod|demo)$/i;
const DEV_LABEL_TOKEN=/^(dev|development)$/i;
const TEST_LABEL_TOKEN=/^(test|testing|qa)$/i;
const PREVIEW_LABEL=/(^|\.)(preview|pr-\d+|deploy-preview-\d+|branch-[a-z0-9-]+)(\.|$)/i;
export const PREVIEW_SUFFIXES=['vercel.app','netlify.app','pages.dev','web.app','firebaseapp.com','onrender.com','surge.sh'];
export const KNOWN_STAGING_SUFFIXES=[
  'bigscoots-staging.com',
  'wpenginepowered.com',
  'pantheonsite.io',
  'flywheelsites.com'
];

export function hostOf(value){
  const raw=String(value||'').trim();
  if(!raw)return'';
  try{return new URL(raw.includes('://')?raw:`https://${raw}`).hostname.toLowerCase().replace(/\.$/,'')}
  catch{return raw.toLowerCase().replace(/\.$/,'')}
}
export function originOf(value){
  try{return new URL(String(value||'').includes('://')?value:`https://${value}`).origin}catch{return''}
}
function privateIpv4(host){
  if(/^127\./.test(host)||/^10\./.test(host)||/^192\.168\./.test(host)||/^169\.254\./.test(host))return true;
  const m=/^172\.(\d+)\./.exec(host);
  return !!(m&&Number(m[1])>=16&&Number(m[1])<=31);
}
function isIpv4(host){return /^\d{1,3}(?:\.\d{1,3}){3}$/.test(host)}
function isIpv6(host){return host.includes(':')}
function labels(host){return String(host||'').split('.').filter(Boolean)}
export function labelTokens(host){
  return labels(host).flatMap(part=>part.split(/[-_]/).filter(Boolean));
}
export function knownSuffixMatch(host,suffixes){
  const h=hostOf(host);
  for(const suffix of suffixes){
    if(h===suffix||h.endsWith('.'+suffix))return suffix;
  }
  return '';
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
export function isApexOrWww(host){
  const h=hostOf(host);
  if(!h||isIpv4(h)||isIpv6(h))return false;
  const root=registrableDomain(h);
  return h===root||h===`www.${root}`;
}
export function hostLooksStaging(host){
  const h=hostOf(host);
  if(!h)return false;
  if(knownSuffixMatch(h,KNOWN_STAGING_SUFFIXES))return true;
  const dns=labels(h);
  if(dns.some(l=>STAGE_LABEL_TOKEN.test(l)))return true;
  if(labelTokens(h).some(t=>STAGE_LABEL_TOKEN.test(t)))return true;
  if(labelTokens(h).some(t=>TEST_LABEL_TOKEN.test(t)))return true;
  return false;
}
export function hostLooksPreview(host){
  const h=hostOf(host);
  return Boolean(h&&(knownSuffixMatch(h,PREVIEW_SUFFIXES)||PREVIEW_LABEL.test(h)));
}
export function hostLooksDevelopment(host){
  const h=hostOf(host);
  if(!h)return false;
  if(isLocalEnvironmentHost(h))return true;
  const dns=labels(h);
  if(dns.some(l=>DEV_LABEL_TOKEN.test(l)))return true;
  return labelTokens(h).some(t=>DEV_LABEL_TOKEN.test(t));
}

export const ORIGIN_CLASSES=['target-origin','same-site','production-host','staging-host','third-party','unknown'];

export function classifyHostRelationship(url,{pageUrl='',pageHost='',environmentType='',productionHost='',stagingHost=''}={}){
  const dest=hostOf(url);
  const page=hostOf(pageUrl||pageHost);
  if(!dest)return{class:'unknown',host:'',reason:'unparseable'};
  if(!page)return{class:'unknown',host:dest,reason:'no-page-host'};
  const destOrigin=originOf(url);
  const pageOrigin=originOf(pageUrl)||(page?`https://${page}`:'');
  if(destOrigin&&pageOrigin&&destOrigin===pageOrigin)return{class:'target-origin',host:dest,reason:'same-origin'};
  if(dest===page)return{class:'target-origin',host:dest,reason:'same-host'};
  const prod=hostOf(productionHost);
  const stage=hostOf(stagingHost);
  if(prod&&(dest===prod||sameSiteFamily(dest,prod))&&!hostLooksStaging(dest)&&!hostLooksPreview(dest)){
    return{class:'production-host',host:dest,reason:'related-production-host'};
  }
  if(stage&&(dest===stage||sameSiteFamily(dest,stage))&&hostLooksStaging(dest)){
    return{class:'staging-host',host:dest,reason:'related-staging-host'};
  }
  if(sameSiteFamily(dest,page)){
    if(environmentType==='production'&&hostLooksStaging(dest))return{class:'staging-host',host:dest,reason:'same-site-staging-host'};
    if(environmentType&&environmentType!=='production'&&!hostLooksStaging(dest)&&!hostLooksPreview(dest)&&!hostLooksDevelopment(dest)&&isApexOrWww(dest)){
      return{class:'production-host',host:dest,reason:'same-site-production-host'};
    }
    if(hostLooksStaging(dest))return{class:'staging-host',host:dest,reason:'same-site-staging-token'};
    return{class:'same-site',host:dest,reason:'same-registrable-domain'};
  }
  if(hostLooksStaging(dest))return{class:'staging-host',host:dest,reason:'known-or-token-staging'};
  return{class:'third-party',host:dest,reason:'different-site'};
}

export function queueOriginClass(url,pageOrigin=''){
  try{
    const u=new URL(String(url||''));
    if(pageOrigin&&u.origin===pageOrigin)return'target';
    const pageHost=pageOrigin?new URL(pageOrigin).hostname:'';
    if(pageHost&&sameSiteFamily(u.hostname,pageHost))return'related';
    return'external';
  }catch{return'external'}
}

export { STAGE_LABEL_TOKEN, DEV_LABEL_TOKEN, TEST_LABEL_TOKEN, PREVIEW_LABEL };
