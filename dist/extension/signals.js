export const SIGNALS={
  NOINDEX:'indexing.noindex',ROBOTS:'indexing.robots',CANONICAL:'canonical',
  REDIRECT:'redirect',BROKEN_LINK:'navigation.broken-link',LINK_REVIEW:'navigation.link-review',
  TITLE:'metadata.title',DESCRIPTION:'metadata.description',SCHEMA:'schema.invalid',
  A11Y_NAME:'a11y.name',A11Y_CONTRAST:'a11y.contrast',A11Y_STRUCTURE:'a11y.structure',A11Y_OTHER:'a11y.other',
  PERFORMANCE_MOBILE:'performance.mobile',PERFORMANCE_DESKTOP:'performance.desktop',
  FORM_ACTION:'form.action',FORM_STRUCTURE:'form.structure',SECURITY:'security',MIXED_CONTENT:'security.mixed-content',
  PAGE_STRUCTURE:'page.structure',SOCIAL:'social.metadata',RUNTIME:'runtime.error',UX_REVIEW:'ux.review',
  HREFLANG:'seo.hreflang',OVERFLOW:'layout.overflow',OTHER:'other'
};
export function signalForFinding(f={}){
  const id=String(f.ruleId||'').toLowerCase(), title=String(f.title||'').toLowerCase(), detail=String(f.detail||'').toLowerCase();
  const text=`${id} ${title} ${detail}`;
  if(/hreflang/.test(id))return SIGNALS.HREFLANG;
  if(/googlebot-conflict/.test(id))return SIGNALS.ROBOTS;
  if(/noindex/.test(text))return SIGNALS.NOINDEX;
  if(/robots/.test(text))return SIGNALS.ROBOTS;
  if(/canonical/.test(text))return SIGNALS.CANONICAL;
  if(/broken-link|link-404|link-410|fragment-missing|link-malformed/.test(text))return SIGNALS.BROKEN_LINK;
  if(/link-review|link.*timeout|could not be verified|external-link|http-403|http-429|forbidden response|rate-limited response|unauthorized response/.test(text))return SIGNALS.LINK_REVIEW;
  if(/redirect/.test(text))return SIGNALS.REDIRECT;
  if(/title/.test(id))return SIGNALS.TITLE;
  if(/description/.test(id))return SIGNALS.DESCRIPTION;
  if(/schema|jsonld/.test(id))return SIGNALS.SCHEMA;
  if(/color-contrast/.test(id))return SIGNALS.A11Y_CONTRAST;
  if(/label|button-name|link-name|image-alt|aria.*name|input.*name/.test(id))return SIGNALS.A11Y_NAME;
  if(id.startsWith('axe.')||id.startsWith('a11y.'))return /heading|landmark|region|list/.test(id)?SIGNALS.A11Y_STRUCTURE:SIGNALS.A11Y_OTHER;
  if(/performance\.mobile/.test(id))return SIGNALS.PERFORMANCE_MOBILE;
  if(/performance\.desktop/.test(id))return SIGNALS.PERFORMANCE_DESKTOP;
  if(/form-action/.test(id))return SIGNALS.FORM_ACTION;
  if(/nested-form|form-no-submit|hidden-required|input-type-mismatch/.test(id))return SIGNALS.FORM_STRUCTURE;
  if(/mixed-content/.test(id))return SIGNALS.MIXED_CONTENT;
  if(/inert-link/.test(id))return SIGNALS.UX_REVIEW;
  if(/uncaught-error|script-failed/.test(id))return SIGNALS.RUNTIME;
  if(/horizontal-overflow|viewport-overflow/.test(id))return SIGNALS.OVERFLOW;
  if(/security/.test(id))return SIGNALS.SECURITY;
  if(/h1|heading|duplicate-id|viewport|charset|meta-refresh|stylesheet-failed/.test(id))return SIGNALS.PAGE_STRUCTURE;
  if(/social|og-/.test(id))return SIGNALS.SOCIAL;
  return SIGNALS.OTHER;
}
export function signalFamily(signal=''){return String(signal).split('.')[0]||'other'}
