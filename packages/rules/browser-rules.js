(() => {
  const CATEGORY_RANK={fix:3,review:2,context:1};
  const SEVERITY_RANK={critical:5,high:4,medium:3,low:2,info:1};
  const targetRegistry=new Map();
  // A stable on-page marker plus a structural fingerprint. The live element map
  // alone was not enough: it is cleared on every scan and holds nothing after a
  // re-render, which is why Frank used to lose the element it was pointing at.
  const TARGET_ATTR='data-web-qa-target';
  const targetFingerprints=new Map();
  const SHADOW_ROOT_BUDGET=80;
  let lastResolutionStage='';
  const linkVerificationCache=new Map();

  function text(value){return String(value??'').trim()}
  function attr(el,name){return text(el?.getAttribute?.(name))}
  function clip(value,n=420){const s=text(value).replace(/\s+/g,' ');return s.length>n?s.slice(0,n-1)+'…':s}
  function sanitizeResourceUrl(raw,n=220){
    const value=String(raw||'').trim();
    if(!value)return'';
    try{const u=new URL(value);u.search='';u.hash='';return clip(u.toString(),n)}
    catch{return clip(value.split(/[?#]/)[0]||value,n)}
  }
  function hash(input){let h=2166136261;for(let i=0;i<input.length;i++){h^=input.charCodeAt(i);h=Math.imul(h,16777619)}return(h>>>0).toString(36)}
  function selectorFor(el){
    if(!el||el.nodeType!==1)return'';
    if(el.id)return`#${CSS.escape(el.id)}`;
    const parts=[];let node=el;
    while(node&&node.nodeType===1&&parts.length<6){
      let part=node.localName;if(!part)break;
      const classes=[...node.classList].filter(Boolean).slice(0,2);
      if(classes.length)part+='.'+classes.map(c=>CSS.escape(c)).join('.');
      const parent=node.parentElement;
      if(parent){const same=[...parent.children].filter(x=>x.localName===node.localName);if(same.length>1)part+=`:nth-of-type(${same.indexOf(node)+1})`}
      parts.unshift(part);node=parent;
    }
    return parts.join(' > ');
  }
  // The marker is an internal implementation detail, so it never reaches
  // evidence, Frank, or a copied snippet.
  function cleanMarkup(html){return String(html??'').replace(new RegExp(`\\s${TARGET_ATTR}="[^"]*"`,'g'),'')}
  function snippet(el){return el?clip(cleanMarkup(el.outerHTML||'')||el.textContent||'',520):''}
  function shadowRoots(){
    const roots=[];
    const walk=root=>{
      if(roots.length>=SHADOW_ROOT_BUDGET)return;
      let hosts=[];
      try{hosts=root.querySelectorAll('*')}catch{return}
      for(const host of hosts){
        if(!host.shadowRoot)continue;
        roots.push(host.shadowRoot);
        if(roots.length>=SHADOW_ROOT_BUDGET)return;
        walk(host.shadowRoot);
      }
    };
    try{walk(document)}catch{}
    return roots;
  }
  // Open shadow roots are common on component-driven sites, and a plain
  // document.querySelector silently returns null for anything inside one.
  function deepQuery(selector){
    if(!selector)return null;
    try{const direct=document.querySelector(selector);if(direct)return direct}catch{return null}
    for(const root of shadowRoots()){
      try{const hit=root.querySelector(selector);if(hit)return hit}catch{}
    }
    return null;
  }
  function uniqueMatch(selector){
    if(!selector)return null;
    try{const nodes=document.querySelectorAll(selector);if(nodes.length===1)return nodes[0]}catch{return null}
    return null;
  }
  function resolveSelector(selector){return deepQuery(selector)}
  function presentationForElement(el){
    if(!el)return'page';
    if(document.head?.contains(el)||['META','LINK','TITLE','SCRIPT','STYLE'].includes(el.tagName))return'document';
    return document.body?.contains(el)?'visual':'page';
  }
  // A structural description that survives a re-render, so an element can be
  // recognised again even when its generated classes or DOM position changed.
  function describeTarget(el){
    return{
      tag:(el.localName||'').toLowerCase(),
      elId:el.id||'',
      classes:[...(el.classList||[])].filter(Boolean).slice(0,6),
      role:attr(el,'role'),
      ariaLabel:attr(el,'aria-label'),
      name:attr(el,'name'),
      alt:attr(el,'alt'),
      type:attr(el,'type'),
      src:attr(el,'src').slice(0,300),
      href:attr(el,'href').slice(0,300),
      text:clip(el.textContent,120)
    };
  }
  function scoreCandidate(el,d){
    if(!el||el.nodeType!==1||(el.localName||'').toLowerCase()!==d.tag)return 0;
    let score=0;
    if(d.elId&&el.id===d.elId)score+=6;
    if(d.src&&attr(el,'src').slice(0,300)===d.src)score+=5;
    if(d.href&&attr(el,'href').slice(0,300)===d.href)score+=4;
    if(d.alt&&attr(el,'alt')===d.alt)score+=3;
    if(d.ariaLabel&&attr(el,'aria-label')===d.ariaLabel)score+=3;
    if(d.name&&attr(el,'name')===d.name)score+=2;
    if(d.type&&attr(el,'type')===d.type)score+=1;
    if(d.role&&attr(el,'role')===d.role)score+=1;
    if(d.classes.length){
      const present=new Set([...(el.classList||[])]);
      score+=Math.min(3,d.classes.filter(c=>present.has(c)).length);
    }
    if(d.text&&clip(el.textContent,120)===d.text)score+=3;
    return score;
  }
  // A recorded selector often matches several elements after a page changes.
  // Taking the first match blindly is how Frank ended up highlighting the wrong
  // row; the fingerprint picks between them when it can, and only falls back to
  // the first match when it genuinely cannot tell them apart.
  function selectorCandidate(selector,targetId){
    if(!selector)return null;
    let nodes=[];
    try{nodes=[...document.querySelectorAll(selector)]}catch{nodes=[]}
    if(!nodes.length)return deepQuery(selector);
    if(nodes.length===1)return nodes[0];
    // Several matches and no way to tell them apart. Highlighting the first is
    // a coin flip, and a confident wrong highlight sends someone to edit the
    // wrong element, so this hands off to the rest of the chain instead.
    return bestCandidate(nodes,targetFingerprints.get(targetId));
  }
  function bestCandidate(nodes,d){
    if(!d)return null;
    let best=null,bestScore=0,tied=false;
    for(const el of nodes){
      const score=scoreCandidate(el,d);
      if(score>bestScore){best=el;bestScore=score;tied=false}
      else if(score===bestScore&&score>0)tied=true;
    }
    return bestScore>0&&!tied?best:null;
  }
  function fingerprintResolve(targetId){
    const d=targetFingerprints.get(targetId);
    if(!d?.tag)return null;
    let nodes=[];
    try{nodes=[...document.getElementsByTagName(d.tag)].slice(0,800)}catch{return null}
    let best=null,bestScore=0,tied=false;
    for(const el of nodes){
      const score=scoreCandidate(el,d);
      if(score>bestScore){best=el;bestScore=score;tied=false}
      else if(score===bestScore&&score>0)tied=true;
    }
    // An ambiguous match is worse than no match: pointing confidently at the
    // wrong element is the failure mode this whole path exists to avoid.
    return bestScore>=5&&!tied?best:null;
  }
  // The generated path is capped at six ancestors and leans on class names, so
  // a wrapper change breaks the whole selector. Dropping leading segments
  // recovers the element whenever the shortened path is still unambiguous.
  function relaxedSelectorMatch(selector){
    const parts=String(selector||'').split(' > ').filter(Boolean);
    if(parts.length<2)return null;
    for(let i=1;i<parts.length;i++){
      const hit=uniqueMatch(parts.slice(i).join(' > '));
      if(hit)return hit;
    }
    const stripped=parts.map(p=>p.replace(/:nth-of-type\(\d+\)/g,'')).filter(Boolean);
    for(let i=0;i<stripped.length;i++){
      const hit=uniqueMatch(stripped.slice(i).join(' > '));
      if(hit)return hit;
    }
    return null;
  }
  function registerTarget(el,seed){
    if(!el||el.nodeType!==1)return'';
    const targetId=`target_${hash(`${seed}|${selectorFor(el)}|${el.tagName}`)}`;
    targetRegistry.set(targetId,el);
    targetFingerprints.set(targetId,describeTarget(el));
    return targetId;
  }
  function clearTargetMarkers(){
    try{document.querySelectorAll(`[${TARGET_ATTR}]`).forEach(el=>el.removeAttribute(TARGET_ATTR))}catch{}
  }
  // Ordered from most to least certain. Each stage that succeeds refreshes the
  // live map so repeated lookups during a walkthrough stay cheap.
  function resolveTarget(targetId,selector=''){
    const cached=targetId?targetRegistry.get(targetId):null;
    if(cached?.isConnected){lastResolutionStage='live-reference';return cached}
    const stages=targetId?[
      ['selector',()=>selectorCandidate(selector,targetId)],
      ['relaxed-selector',()=>relaxedSelectorMatch(selector)],
      ['fingerprint',()=>fingerprintResolve(targetId)]
    ]:[
      ['selector',()=>resolveSelector(selector)],
      ['relaxed-selector',()=>relaxedSelectorMatch(selector)]
    ];
    lastResolutionStage='';
    for(const [name,stage] of stages){
      let el=null;
      try{el=stage()}catch{el=null}
      if(el?.isConnected)lastResolutionStage=name;
      if(el?.isConnected){
        if(targetId){
          targetRegistry.set(targetId,el);
          if(!targetFingerprints.has(targetId))targetFingerprints.set(targetId,describeTarget(el));
        }
        return el;
      }
    }
    lastResolutionStage='unresolved';
    return null;
  }
  // Frank needs to explain an unresolved target, not just fail quietly. This
  // reports what was looked for and what the page currently offers instead.
  function resolvedTargetState(targetId,selector=''){
    const el=resolveTarget(targetId,selector);
    if(el){
      const rect=el.getBoundingClientRect();
      const style=getComputedStyle(el);
      const offscreen=rect.width<1||rect.height<1;
      const invisible=style.display==='none'||style.visibility==='hidden'||(style.opacity!==''&&Number(style.opacity)===0);
      return{found:true,via:lastResolutionStage,visible:!offscreen&&!invisible,tag:el.tagName.toLowerCase(),selector:selector||selectorFor(el),
        reason:invisible?'The element is present but hidden by its current styles.':offscreen?'The element is present but currently has no rendered size.':''};
    }
    const d=targetFingerprints.get(targetId)||null;
    let selectorMatches=0;
    try{selectorMatches=selector?document.querySelectorAll(selector).length:0}catch{selectorMatches=0}
    const reason=!selector&&!targetId?'This finding is not tied to a single page element.'
      :selectorMatches>1?'The recorded selector now matches several elements, so Frank will not guess which one it was.'
      :'The element was on the page when it was scanned and is not there now. It was most likely re-rendered, lazily removed, or behind a state change.';
    return{found:false,via:'unresolved',visible:false,tag:d?.tag||'',selector,selectorMatches,reason,
      described:d?{text:d.text,alt:d.alt,href:d.href,src:d.src,classes:d.classes.join(' ')}:null};
  }
  function finding({ruleId,title,detail,category='review',severity='medium',selector='',element=null,targetType='',evidence='',sources=['browser'],wcag=[],helpUrl='',count=1,confidence='confirmed',verification=null,extra={}}){
    const resolved=element||resolveSelector(selector);
    const finalSelector=selector||selectorFor(resolved);
    const presentation=targetType||presentationForElement(resolved);
    const fingerprint=hash(`${ruleId}|${finalSelector}|${clip(evidence,220)}`);
    const targetId=presentation==='visual'&&resolved?registerTarget(resolved,`${ruleId}|${fingerprint}`):'';
    return {id:`${ruleId}:${fingerprint}`,ruleId,title,detail,category,severity,selector:finalSelector,targetId,targetType:presentation,evidence:clip(evidence,520),sources,wcag,helpUrl,count,fingerprint,confidence,verification:verification||{state:confidence,method:'deterministic browser observation',attempts:1,evidence:[]},...extra};
  }
  function headingSkip(headings){let previous=null;for(const h of headings){const level=Number(h.tagName.slice(1));if(previous&&level>previous+1)return h;previous=level}return null}
  function schemaState(){
    const blocks=[...document.querySelectorAll('script[type="application/ld+json"]')],types=new Set(),errors=[];
    const visit=value=>{if(!value||typeof value!=='object')return;if(Array.isArray(value))return value.forEach(visit);if(value['@type'])(Array.isArray(value['@type'])?value['@type']:[value['@type']]).forEach(t=>types.add(String(t)));Object.values(value).forEach(visit)};
    blocks.forEach((block,index)=>{try{visit(JSON.parse(block.textContent||'null'))}catch(error){errors.push({index,message:error.message,selector:selectorFor(block),element:block})}});
    return{blockCount:blocks.length,types:[...types],errors};
  }
  function pageSummary(){
    const canonicalEl=document.querySelector('link[rel~="canonical"]'),descEl=document.querySelector('meta[name="description" i]'),robotsEl=document.querySelector('meta[name="robots" i]'),viewportEl=document.querySelector('meta[name="viewport" i]'),generatorEl=document.querySelector('meta[name="generator" i]'),h1s=[...document.querySelectorAll('h1')],schema=schemaState();
    let canonical='';try{canonical=canonicalEl?.href||''}catch{}
    const resourceHints=[...document.querySelectorAll('script[src],link[href],img[src]')].slice(0,80).map(el=>attr(el,'src')||attr(el,'href')).filter(Boolean);
    return{url:location.href,origin:location.origin,hostname:location.hostname,pathname:location.pathname,title:document.title||'',description:attr(descEl,'content'),canonical,robots:attr(robotsEl,'content'),lang:attr(document.documentElement,'lang'),viewport:attr(viewportEl,'content'),generator:attr(generatorEl,'content'),resourceHints,h1s:h1s.map(h=>clip(h.textContent,160)),schemaTypes:schema.types,schemaBlockCount:schema.blockCount,formCount:document.forms.length,imageCount:document.images.length,linkCount:document.links.length,interactiveCount:document.querySelectorAll('a,button,input,select,textarea,[role="button"],[tabindex]').length};
  }

  function run(){
    clearTargetMarkers();targetRegistry.clear();targetFingerprints.clear();
    const findings=[],page=pageSummary(),titleEl=document.querySelector('title'),descEl=document.querySelector('meta[name="description" i]'),canonicalEl=document.querySelector('link[rel~="canonical"]'),robotsEl=document.querySelector('meta[name="robots" i]'),viewportEl=document.querySelector('meta[name="viewport" i]'),headings=[...document.querySelectorAll('h1,h2,h3,h4,h5,h6')],h1s=headings.filter(h=>h.tagName==='H1');

    if(!text(document.title))findings.push(finding({ruleId:'seo.title-missing',title:'Page title is missing',detail:'The rendered document has no usable title.',category:'fix',severity:'high',selector:'head > title',element:titleEl,targetType:'document',evidence:snippet(titleEl)}));
    else{
      if(document.title.length<10)findings.push(finding({ruleId:'seo.title-short',title:'Page title is unusually short',confidence:'inferred',detail:`Rendered title is ${document.title.length} characters. Review whether it communicates the page purpose clearly.`,severity:'low',evidence:document.title,targetType:'document'}));
      if(document.title.length>70)findings.push(finding({ruleId:'seo.title-long',title:'Review page title length',confidence:'inferred',detail:`Rendered title is ${document.title.length} characters. Display length varies by search surface, so treat this as optimization context rather than a defect.`,category:'context',severity:'info',evidence:document.title,targetType:'document'}));
    }
    if(!page.description)findings.push(finding({ruleId:'seo.description-missing',title:'Meta description is missing',detail:'No rendered meta description was observed.',category:'review',severity:'medium',targetType:'document'}));
    else if(page.description.length>180)findings.push(finding({ruleId:'seo.description-long',title:'Review meta description length',confidence:'inferred',detail:`Rendered description is ${page.description.length} characters. Search surfaces choose snippets dynamically, so treat this as optimization context rather than a defect.`,category:'context',severity:'info',evidence:page.description,targetType:'document'}));

    const titleEls=[...document.querySelectorAll('title')],descEls=[...document.querySelectorAll('meta[name="description" i]')],canonicalEls=[...document.querySelectorAll('link[rel~="canonical"]')];
    if(titleEls.length>1)findings.push(finding({ruleId:'seo.title-multiple',title:'Multiple title elements are present',detail:`${titleEls.length} title elements were observed. Keep one intended document title.`,category:'fix',severity:'medium',element:titleEls[1],targetType:'document',count:titleEls.length,evidence:snippet(titleEls[1])}));
    if(descEls.length>1)findings.push(finding({ruleId:'seo.description-multiple',title:'Multiple meta descriptions are present',detail:`${descEls.length} description meta tags were observed. Keep a single intended description.`,category:'fix',severity:'medium',element:descEls[1],targetType:'document',count:descEls.length,evidence:snippet(descEls[1])}));
    if(canonicalEls.length>1)findings.push(finding({ruleId:'seo.canonical-multiple',title:'Multiple canonicals are declared',detail:`${canonicalEls.length} canonical links were observed. Conflicting canonical declarations can make preferred-URL signals ambiguous.`,category:'fix',severity:'high',element:canonicalEls[1],targetType:'document',count:canonicalEls.length,evidence:snippet(canonicalEls[1])}));
    if(!canonicalEl)findings.push(finding({ruleId:'seo.canonical-missing',title:'Canonical is not declared',detail:'No rendered canonical link was observed. Confirm whether this page should self-canonicalize.',category:'review',severity:'medium',targetType:'document'}));
    else{
      try{
        const c=new URL(page.canonical,location.href);
        if(!/^https?:$/.test(c.protocol))findings.push(finding({ruleId:'seo.canonical-invalid',title:'Canonical uses an unsupported scheme',detail:'Canonical URLs should resolve to an HTTP or HTTPS URL.',category:'fix',severity:'high',element:canonicalEl,targetType:'document',evidence:snippet(canonicalEl)}));
        if(c.hostname!==location.hostname)findings.push(finding({ruleId:'seo.canonical-cross-host',title:'Canonical points to another host',confidence:'inferred',detail:`Rendered canonical points to ${c.hostname}. Confirm this cross-host canonical is intentional.`,category:'review',severity:'medium',element:canonicalEl,targetType:'document',evidence:page.canonical}));
        if(c.hash)findings.push(finding({ruleId:'seo.canonical-fragment',title:'Canonical contains a URL fragment',confidence:'inferred',detail:'Canonical URLs generally identify the document URL rather than an in-page fragment. Review this declaration.',category:'review',severity:'medium',element:canonicalEl,targetType:'document',evidence:page.canonical}));
      }catch{findings.push(finding({ruleId:'seo.canonical-invalid',title:'Canonical URL is invalid',detail:'The rendered canonical could not be parsed as a URL.',category:'fix',severity:'high',element:canonicalEl,targetType:'document',evidence:attr(canonicalEl,'href')}))}
    }
    if(robotsEl&&/\bnoindex\b/i.test(page.robots))findings.push(finding({ruleId:'seo.noindex',title:'Page requests noindex',detail:'The rendered robots directive contains noindex.',category:'context',severity:'info',element:robotsEl,targetType:'document',evidence:page.robots}));
    if(/\bindex\b/i.test(page.robots)&&/\bnoindex\b/i.test(page.robots))findings.push(finding({ruleId:'seo.robots-conflict',title:'Robots directives conflict',detail:'Both index and noindex were observed in the rendered robots directive.',category:'fix',severity:'high',element:robotsEl,targetType:'document',evidence:page.robots}));

    if(!page.lang)findings.push(finding({ruleId:'a11y.lang-missing',title:'Document language is missing',detail:'The root html element has no lang attribute.',category:'fix',severity:'medium',element:document.documentElement,targetType:'page',evidence:snippet(document.documentElement).slice(0,200),wcag:['3.1.1']}));
    else{try{new Intl.Locale(page.lang)}catch{findings.push(finding({ruleId:'a11y.lang-invalid',title:'Document language is not a valid language tag',detail:`The html lang value "${page.lang}" could not be parsed as a valid BCP 47 language tag.`,category:'fix',severity:'medium',element:document.documentElement,targetType:'page',evidence:page.lang,wcag:['3.1.1']}))}}
    if(!viewportEl)findings.push(finding({ruleId:'web.viewport-missing',title:'Viewport metadata is missing',detail:'No viewport meta tag was observed in the rendered document.',category:'fix',severity:'medium',targetType:'document',evidence:'',extra:{markupSnippet:''}}));
    else if(/user-scalable\s*=\s*no/i.test(page.viewport)||/maximum-scale\s*=\s*1(?:\.0+)?(?:,|$)/i.test(page.viewport))findings.push(finding({ruleId:'a11y.viewport-zoom-restricted',title:'Viewport appears to restrict zoom',detail:'The viewport configuration may prevent or severely limit user zoom.',category:'review',severity:'medium',element:viewportEl,targetType:'document',evidence:snippet(viewportEl)||page.viewport,wcag:['1.4.4']}));
    else if(/\bwidth\s*=\s*(\d+)/i.test(page.viewport)&&!/device-width/i.test(page.viewport)){
      const widthMatch=/width\s*=\s*(\d+)/i.exec(page.viewport);
      findings.push(finding({ruleId:'web.viewport-fixed',title:'Viewport uses a fixed pixel width',detail:`Viewport is fixed to ${widthMatch?.[1]||'a pixel width'}px instead of device-width. Mobile browsers may render a desktop-scale layout that requires horizontal scrolling.`,category:'review',severity:'medium',element:viewportEl,targetType:'document',evidence:snippet(viewportEl)||page.viewport}));
    }
    const refresh=document.querySelector('meta[http-equiv="refresh" i]');if(refresh)findings.push(finding({ruleId:'web.meta-refresh',title:'Page uses a meta refresh',detail:'Meta refresh can create unexpected navigation and accessibility issues.',category:'review',severity:'medium',element:refresh,targetType:'document',evidence:attr(refresh,'content')}));
    if(!document.querySelector('meta[charset],meta[http-equiv="content-type" i]'))findings.push(finding({ruleId:'web.charset-missing',title:'Character encoding declaration was not observed',detail:'No rendered meta charset or equivalent content-type declaration was found. Confirm encoding is declared reliably in the HTTP response.',category:'review',severity:'low',targetType:'document'}));
    if(!h1s.length)findings.push(finding({ruleId:'structure.h1-missing',title:'No H1 heading is present',confidence:'inferred',detail:'The rendered page has no H1. Review the document heading structure.',category:'review',severity:'medium',targetType:'page'}));
    if(h1s.length>1)findings.push(finding({ruleId:'structure.h1-multiple',title:'Multiple H1 headings are present',confidence:'inferred',detail:`${h1s.length} H1 elements were observed. This can be valid, but review the page hierarchy.`,category:'review',severity:'low',element:h1s[1],count:h1s.length,evidence:h1s.map(h=>clip(h.textContent,100)).join(' | ')}));
    const skipped=headingSkip(headings);if(skipped)findings.push(finding({ruleId:'structure.heading-skip',title:'Heading levels skip a level',confidence:'inferred',detail:'The rendered heading hierarchy jumps more than one level at this element.',category:'review',severity:'low',element:skipped,evidence:snippet(skipped)}));

    const schema=schemaState();schema.errors.forEach(err=>findings.push(finding({ruleId:'schema.jsonld-invalid',title:'JSON-LD could not be parsed',detail:`Structured data block ${err.index+1} contains invalid JSON: ${err.message}`,category:'fix',severity:'high',element:err.element,targetType:'document',evidence:'Invalid JSON-LD block'})));

    const ids=new Map();document.querySelectorAll('[id]').forEach(el=>{const id=el.id;if(!id)return;const list=ids.get(id)||[];list.push(el);ids.set(id,list)});
    for(const[id,els]of ids)if(els.length>1)findings.push(finding({ruleId:'web.duplicate-id',title:'Duplicate element ID',detail:`The id "${id}" appears ${els.length} times. Duplicate IDs can break labels, ARIA references, fragment links, and scripts.`,category:'fix',severity:'medium',element:els[1],evidence:id,count:els.length}));

    document.querySelectorAll('form[action]').forEach(form=>{const raw=attr(form,'action');if(!raw)return;try{const target=new URL(raw,location.href);if(location.protocol==='https:'&&target.protocol==='http:')findings.push(finding({ruleId:'security.insecure-form-action',title:'Secure page submits a form over HTTP',detail:'A form on this HTTPS page points to an insecure HTTP action.',category:'fix',severity:'critical',element:form,evidence:target.href}))}catch{}});
    document.querySelectorAll('a[target="_blank"]').forEach(a=>{const rel=attr(a,'rel').toLowerCase();if(!rel.includes('noopener')&&!rel.includes('noreferrer'))findings.push(finding({ruleId:'security.blank-opener',title:'New-tab link can retain opener access',detail:'A target=_blank link does not declare noopener or noreferrer.',category:'review',severity:'low',element:a,evidence:snippet(a)}))});

    const ogTitle=document.querySelector('meta[property="og:title"]'),ogDesc=document.querySelector('meta[property="og:description"]');
    if(!ogTitle||!ogDesc)findings.push(finding({ruleId:'social.og-incomplete',title:'Open Graph metadata is incomplete',confidence:'inferred',detail:'One or more core Open Graph title/description fields were not observed. Review sharing metadata if social previews matter for this page.',category:'context',severity:'info',targetType:'document',evidence:`og:title=${!!ogTitle}; og:description=${!!ogDesc}`}));

    const browserPerformance=performanceSignals();
    findings.push(...performanceFindings(browserPerformance));
    findings.push(...imageResourceFindings(browserPerformance));
    findings.push(...fragmentFindings());
    findings.push(...malformedLinkFindings());

    findings.sort((a,b)=>(CATEGORY_RANK[b.category]-CATEGORY_RANK[a.category])||(SEVERITY_RANK[b.severity]-SEVERITY_RANK[a.severity]));
    return{scannedAt:new Date().toISOString(),page,findings,browserPerformance,coverage:{browser:'complete',links:'pending',axe:'pending',published:'pending',performance:browserPerformance.available?'current-page':'pending',wcag:'pending',ai:'pending'}};
  }

  // Semantic context is what lets Frank reason about the correct implementation
  // rather than only restating the failed rule. It is deterministic DOM evidence,
  // gathered locally, and never includes form values or arbitrary data attributes.
  function accessibleNameContext(el){
    if(!el||el.nodeType!==1)return null;
    const labelledby=attr(el,'aria-labelledby'),described=attr(el,'aria-describedby');
    const labelTexts=labelledby.split(/\s+/).filter(Boolean).map(id=>{const t=document.getElementById(id);return t?clip(t.innerText||t.textContent,120):''}).filter(Boolean);
    const nearestLabel=el.id?document.querySelector(`label[for="${CSS.escape(el.id)}"]`):el.closest?.('label');
    return{
      role:attr(el,'role'),
      ariaLabel:attr(el,'aria-label'),
      ariaLabelledByText:labelTexts.join(' '),
      ariaDescribedBy:described,
      titleAttr:attr(el,'title'),
      labelText:nearestLabel?clip(nearestLabel.innerText||nearestLabel.textContent,120):'',
      ownText:clip(el.innerText||el.textContent||'',160),
      interactiveAncestor:(()=>{const a=el.closest?.('a[href],button,[role="button"],[role="link"]');return a?a.tagName.toLowerCase():''})(),
      parentTag:el.parentElement?el.parentElement.tagName.toLowerCase():'',
      parentClass:clip(String(el.parentElement?.className||''),120),
      inLandmark:(()=>{const l=el.closest?.('nav,header,footer,main,aside,[role="navigation"],[role="banner"],[role="contentinfo"],[role="main"]');return l?(attr(l,'role')||l.tagName.toLowerCase()):''})()
    };
  }
  function semanticContextFor(el,ruleId=''){
    if(!el||el.nodeType!==1)return null;
    const context={naming:accessibleNameContext(el)};
    const isImage=/image-alt|role-img|input-image|object-alt|area-alt/.test(String(ruleId))||['IMG','SVG','PICTURE'].includes(el.tagName);
    if(isImage&&globalThis.WebQAImagePurpose){
      try{const purpose=globalThis.WebQAImagePurpose.classifyImage(el);context.imagePurpose={purpose:purpose.purpose,confidence:purpose.confidence,rationale:purpose.rationale,signals:purpose.signals,recommendedAlt:purpose.recommendedAlt,descriptor:{siblingText:clip(purpose.descriptor?.siblingText||'',120)}}}catch{}
    }
    return context;
  }

  // Current-page performance. This is a lab observation from the inspecting
  // browser, not field data, and it is labelled that way everywhere it surfaces.
  // LCP is captured with a buffered PerformanceObserver because browsers do not
  // expose largest-contentful-paint through performance.getEntriesByType().
  let latestLcp=null,lcpObserver=null;
  function initLcpObserver(){
    if(lcpObserver||typeof PerformanceObserver==='undefined')return;
    try{
      lcpObserver=new PerformanceObserver(list=>{const entries=list.getEntries?.()||[];if(entries.length)latestLcp=entries[entries.length-1]});
      lcpObserver.observe({type:'largest-contentful-paint',buffered:true});
    }catch{lcpObserver=null}
  }
  initLcpObserver();
  async function preparePerformanceSignals(){
    initLcpObserver();
    // Give the buffered observer callback one task to publish an already-recorded LCP.
    await new Promise(resolve=>setTimeout(resolve,0));
    return performanceSignals();
  }
  function performanceSignals(){
    try{
      const nav=performance.getEntriesByType('navigation')[0];
      if(!nav)return{available:false,reason:'navigation timing unavailable'};
      const resources=performance.getEntriesByType('resource')||[];
      const transferEntries=[nav,...resources];
      const transferBytes=transferEntries.reduce((n,r)=>n+(Number(r.transferSize)||0),0);
      const measuredTransferCount=transferEntries.filter(r=>(Number(r.transferSize)||0)>0).length;
      const unknownTransferCount=Math.max(0,transferEntries.length-measuredTransferCount);
      const byType=resources.reduce((acc,r)=>{const k=r.initiatorType||'other';acc[k]=(acc[k]||0)+1;return acc},{});
      const paint=performance.getEntriesByType('paint')||[];
      const fcp=paint.find(p=>p.name==='first-contentful-paint');
      const lcp=latestLcp;
      let lcpElement=null;
      if(lcp?.element){
        try{
          const el=lcp.element;
          const rect=el.getBoundingClientRect?.()||{width:0,height:0};
          lcpElement={
            tag:String(el.tagName||'').toLowerCase(),
            selector:selectorFor(el),
            url:sanitizeResourceUrl(lcp.url||el.currentSrc||el.src||''),
            size:Number(lcp.size||0),
            intrinsic:el.naturalWidth?{width:Number(el.naturalWidth)||0,height:Number(el.naturalHeight)||0}:null,
            rendered:{width:Math.round(rect.width||0),height:Math.round(rect.height||0)}
          };
        }catch{}
      }
      const knownResources=resources.filter(r=>(Number(r.transferSize)||0)>0);
      return{
        available:true,
        measurement:'lab',
        note:'Measured in the inspecting browser on this machine and network. Treat as a directional signal, not a field score.',
        ttfbMs:Math.round(nav.responseStart-nav.requestStart),
        domContentLoadedMs:Math.round(nav.domContentLoadedEventEnd),
        loadMs:Math.round(nav.loadEventEnd||nav.duration||0),
        firstContentfulPaintMs:fcp?Math.round(fcp.startTime):null,
        largestContentfulPaintMs:lcp?Math.round(lcp.startTime):null,
        lcpElement,
        transferBytes,
        transferIsLowerBound:unknownTransferCount>0,
        measuredTransferCount,
        unknownTransferCount,
        resourceCount:resources.length,
        resourceMix:byType,
        heaviest:knownResources.slice().sort((a,b)=>(Number(b.transferSize)||0)-(Number(a.transferSize)||0)).slice(0,5).map(r=>({name:sanitizeResourceUrl(r.name),type:r.initiatorType||'other',bytes:Number(r.transferSize)||0,durationMs:Math.round(r.duration||0)}))
      };
    }catch(error){return{available:false,reason:String(error?.message||error)}}
  }
  // Thresholds are intentionally loose. A lab measurement should only raise a
  // finding when it is bad enough that machine and network variance cannot
  // reasonably explain it.
  function performanceFindings(signals){
    if(!signals?.available)return[];
    const out=[];
    if(Number.isFinite(signals.largestContentfulPaintMs)&&signals.largestContentfulPaintMs>4000){
      const elementNote=signals.lcpElement?.selector?` The observed LCP element was ${signals.lcpElement.selector}.`:'';
      out.push(finding({ruleId:'performance.browser.lcp',title:'Largest contentful paint is slow in this browser',confidence:'inferred',detail:`Largest contentful paint was observed at ${(signals.largestContentfulPaintMs/1000).toFixed(1)}s on this machine and network.${elementNote} This is a lab observation, not a field score.`,category:'review',severity:'medium',selector:signals.lcpElement?.selector||'',element:null,targetType:signals.lcpElement?.selector?'visual':'page',evidence:`lcp=${signals.largestContentfulPaintMs}ms`,extra:{performanceObservation:signals,resourceUrl:signals.lcpElement?.url||''}}));
    }
    if(Number.isFinite(signals.ttfbMs)&&signals.ttfbMs>1800)
      out.push(finding({ruleId:'performance.browser.ttfb',title:'Server response time is slow in this browser',confidence:'inferred',detail:`Time to first byte was ${signals.ttfbMs}ms. That points at server or origin response time rather than front-end assets.`,category:'review',severity:'medium',targetType:'page',evidence:`ttfb=${signals.ttfbMs}ms`,extra:{performanceObservation:signals}}));
    if(Number.isFinite(signals.transferBytes)&&signals.transferBytes>6000000){
      const qualifier=signals.transferIsLowerBound?'At least ':'Approximately ';
      const coverage=signals.transferIsLowerBound?` ${signals.unknownTransferCount} transfer size${signals.unknownTransferCount===1?' was':'s were'} unavailable because cached or cross-origin resources may not expose transfer size.`:'';
      out.push(finding({ruleId:'performance.browser.weight',title:'Page transfers an unusually large measurable payload',confidence:'confirmed',detail:`${qualifier}${(signals.transferBytes/1048576).toFixed(1)}MB of measurable transfer was observed across the document and ${signals.resourceCount} resource requests.${coverage}`,category:'review',severity:'medium',targetType:'page',evidence:`known-transfer=${signals.transferBytes} bytes; measured=${signals.measuredTransferCount}; unknown=${signals.unknownTransferCount}`,extra:{performanceObservation:signals}}));
    }
    return out;
  }

  function imageResourceFindings(signals){
    const out=[];
    // Broken / unloaded images where the browser completed decode with zero natural size.
    [...document.images].slice(0,80).forEach(img=>{
      if(!img.complete)return;
      const src=sanitizeResourceUrl(img.currentSrc||img.src||'');
      if(!src||src.startsWith('data:'))return;
      if(Number(img.naturalWidth)===0&&Number(img.naturalHeight)===0){
        out.push(finding({ruleId:'web.image-broken',title:'Image failed to load',detail:'An image element completed loading with naturalWidth 0, which usually means the resource is missing or undecodable.',category:'fix',severity:'medium',element:img,evidence:src,extra:{resourceUrl:src}}));
      }
    });
    // Intrinsic vs rendered oversize — only when the image is meaningfully displayed.
    [...document.images].slice(0,60).forEach(img=>{
      const nw=Number(img.naturalWidth)||0,nh=Number(img.naturalHeight)||0;
      const rw=Math.round(img.clientWidth||0),rh=Math.round(img.clientHeight||0);
      if(nw<2||nh<2||rw<40||rh<40)return;
      if(nw>=rw*2.5&&nh>=rh*2.5&&(nw*nh)>=350000){
        const src=sanitizeResourceUrl(img.currentSrc||img.src||'');
        out.push(finding({ruleId:'performance.browser.image-oversized',title:'Image is much larger than its rendered size',detail:`This image is ${nw}×${nh} intrinsically but renders at about ${rw}×${rh}. Serving an appropriately sized asset reduces transfer and decode work.`,category:'review',severity:'medium',element:img,confidence:'inferred',evidence:`intrinsic=${nw}x${nh}; rendered=${rw}x${rh}; src=${src}`,extra:{resourceUrl:src,imageMetrics:{intrinsic:{width:nw,height:nh},rendered:{width:rw,height:rh}}}}));
      }
    });
    // Correlate slow LCP with oversized LCP image dimensions when both are present.
    if(signals?.available&&Number.isFinite(signals.largestContentfulPaintMs)&&signals.largestContentfulPaintMs>4000){
      const el=signals.lcpElement;
      if(el?.intrinsic?.width&&el?.rendered?.width&&el.intrinsic.width>=el.rendered.width*2.5){
        out.push(finding({ruleId:'performance.browser.lcp-image-oversized',title:'LCP image is oversized for its display size',detail:`LCP was ${(signals.largestContentfulPaintMs/1000).toFixed(1)}s and the LCP image is ${el.intrinsic.width}×${el.intrinsic.height} while rendering near ${el.rendered.width}×${el.rendered.height}. Resize/compress/serve an appropriately sized modern asset.`,category:'review',severity:'medium',selector:el.selector||'',confidence:'inferred',evidence:`lcp=${signals.largestContentfulPaintMs}ms; intrinsic=${el.intrinsic.width}x${el.intrinsic.height}; rendered=${el.rendered.width}x${el.rendered.height}; resource=${el.url||''}`,extra:{resourceUrl:el.url||'',performanceObservation:signals,rootCauseKey:el.url?`lcp-resource:${hash(el.url)}`:undefined}}));
      }
    }
    return out;
  }

  function fragmentFindings(){
    const groups=new Map();
    for(const a of document.querySelectorAll('a[href^="#"]')){
      const raw=attr(a,'href');
      if(!raw||raw==='#'||/^#top$/i.test(raw))continue;
      let id='';
      try{id=decodeURIComponent(raw.slice(1))}catch{id=raw.slice(1)}
      if(!id||/^\/?$/.test(id))continue;
      let exists=false;
      try{exists=!!(document.getElementById(id)||document.querySelector(`[name="${CSS.escape(id)}"]`))}catch{exists=!!document.getElementById(id)}
      if(exists)continue;
      if(!groups.has(id))groups.set(id,[]);
      groups.get(id).push(a);
    }
    const out=[];
    for(const[id,anchors]of groups){
      const first=anchors[0],ctx=linkContext(first);
      const sources=anchors.slice(0,12).map(a=>({...linkContext(a),selector:selectorFor(a)}));
      out.push(finding({ruleId:'navigation.fragment-missing',title:'In-page link points to a missing fragment',detail:`${ctx.text?`"${ctx.text}" `:''}points to #${id}, but no matching id or name exists in the document.`,category:'fix',severity:'medium',element:first,count:anchors.length,confidence:'confirmed',evidence:`#${id}`,extra:{link:{url:`#${id}`,internal:true,fragment:id,status:0,occurrences:anchors.length,sources,...ctx},verification:{state:'confirmed',method:'deterministic DOM fragment resolution',attempts:1,evidence:[`no element with id or name "${id}"`]}}}));
    }
    return out;
  }

  function malformedLinkFindings(){
    const out=[],seen=new Set();
    for(const a of document.querySelectorAll('a[href]')){
      const raw=attr(a,'href');
      if(!raw||raw.startsWith('#')||/^(mailto:|tel:|javascript:|data:)/i.test(raw))continue;
      let ok=true;try{new URL(raw,location.href)}catch{ok=false}
      if(ok)continue;
      const key=clip(raw,180);if(seen.has(key))continue;seen.add(key);
      const ctx=linkContext(a);
      out.push(finding({ruleId:'navigation.link-malformed',title:'Link href is malformed',detail:`${ctx.text?`"${ctx.text}" `:''}uses an href that could not be parsed as a URL.`,category:'fix',severity:'medium',element:a,confidence:'confirmed',evidence:key,extra:{link:{url:key,internal:false,malformed:true,occurrences:1,sources:[{...ctx,selector:selectorFor(a)}],...ctx},verification:{state:'confirmed',method:'URL parse',attempts:1,evidence:[key]}}}));
    }
    return out;
  }

  function axeTargetPath(node){
    const raw=node?.target;
    if(!Array.isArray(raw))return[];
    return raw.flatMap(x=>Array.isArray(x)?x:[x]).map(String).filter(Boolean);
  }
  function resolveAxePath(path){
    if(!path.length)return null;
    let root=document,el=null;
    for(let i=0;i<path.length;i++){
      try{el=root.querySelector(path[i])}catch{return null}
      if(!el)return null;
      if(i<path.length-1){if(!el.shadowRoot)return null;root=el.shadowRoot}
    }
    return el;
  }
  function checkDetails(node){
    const normalize=rows=>(rows||[]).map(x=>({id:x.id||'',impact:x.impact||'',message:x.message||'',data:x.data??null,relatedNodes:(x.relatedNodes||[]).slice(0,4).map(r=>({html:clip(r.html||'',320),target:r.target||[]}))}));
    return{any:normalize(node?.any),all:normalize(node?.all),none:normalize(node?.none)};
  }
  function axeFindings(results){
    if(!results)return[];
    const out=[],impactSeverity={critical:'critical',serious:'high',moderate:'medium',minor:'low',null:'low',undefined:'low'};
    const categoryFor=impact=>(impact==='critical'||impact==='serious')?'fix':'review';
    const convert=(rule,incomplete=false)=>{
      const nodes=rule.nodes||[],first=nodes[0]||{},path=axeTargetPath(first),resolved=resolveAxePath(path),selector=path.join(' >>> ');
      const wcag=(rule.tags||[]).map(t=>{const m=/^wcag(\d)(\d)(\d)$/.exec(t);return m?`${m[1]}.${m[2]}.${m[3]}`:null}).filter(Boolean);
      return finding({
        ruleId:`axe.${rule.id}${incomplete?'.review':''}`,
        title:incomplete?`Manual review: ${rule.help||rule.id}`:(rule.help||rule.id),
        detail:incomplete?`Axe could not determine this result automatically for the affected element. Manual review is required. ${rule.description||''}`:(rule.description||rule.help||rule.id),
        category:incomplete?'review':categoryFor(rule.impact),
        severity:incomplete?'low':(impactSeverity[String(rule.impact)]||'medium'),
        selector,element:resolved,targetType:resolved?'visual':'page',evidence:first.html||'',sources:['axe'],wcag,helpUrl:rule.helpUrl||'',count:nodes.length||1,
        confidence:incomplete?'inconclusive':'confirmed',
        verification:{state:incomplete?'inconclusive':'confirmed',method:incomplete?'axe manual-review result':'axe automated violation',attempts:1,evidence:[first.failureSummary||rule.description||'']},
        extra:{axe:{impact:rule.impact||'',failureSummary:first.failureSummary||'',message:first.message||'',tags:rule.tags||[],incomplete,checks:checkDetails(first),targetPath:path},semantics:semanticContextFor(resolved,rule.id)}
      });
    };
    (results.violations||[]).forEach(r=>out.push(convert(r,false)));
    (results.incomplete||[]).forEach(r=>out.push(convert(r,true)));
    return out;
  }

  function classifyLink(anchor){
    if(!anchor||anchor?.hasAttribute?.('download'))return null;
    const raw=anchor?.getAttribute?.('href')||'';
    if(!raw||raw.startsWith('#')||/^(mailto:|tel:|javascript:|data:)/i.test(raw))return null;
    try{
      const u=new URL(raw,location.href);
      if(!/^https?:$/.test(u.protocol))return null;
      if(/\/(?:logout|log-out|signout|sign-out)(?:\/|$|\?)/i.test(u.pathname))return null;
      u.hash='';
      return{url:u.href,internal:u.origin===location.origin};
    }catch{return null}
  }
  function linkContext(anchor){
    const textValue=clip(anchor?.innerText||anchor?.getAttribute?.('aria-label')||anchor?.getAttribute?.('title')||'',160);
    const inNav=!!anchor?.closest?.('nav,[role="navigation"]');
    const inHeader=!!anchor?.closest?.('header');
    const inMain=!!anchor?.closest?.('main,[role="main"]');
    const inFooter=!!anchor?.closest?.('footer');
    const classText=String(anchor?.className||'');
    const cta=/\b(btn|button|cta|primary|contact|consult|schedule|book|call)\b/i.test(`${classText} ${textValue}`);
    const prominence=inNav||inHeader?'navigation':cta?'cta':inMain?'primary':inFooter?'footer':'normal';
    return{text:textValue,location:inNav?'navigation':inHeader?'header':inMain?'main':inFooter?'footer':'body',prominence};
  }
  function cachedLinkResult(url){
    const hit=linkVerificationCache.get(url);
    if(!hit)return null;
    if(Date.now()>hit.expiresAt){linkVerificationCache.delete(url);return null}
    return {...hit.result,cached:true};
  }
  function cacheLinkResult(url,result){
    const ttl=result.verificationState==='healthy'?60000:result.verificationState==='confirmed-failure'?30000:10000;
    linkVerificationCache.set(url,{result:{...result,cached:false},expiresAt:Date.now()+ttl});
  }
  async function probeUrl(url,{timeoutMs=3500,internal=true}={}){
    const controller=new AbortController(),started=performance.now();
    const timer=setTimeout(()=>controller.abort(),timeoutMs);
    try{
      const res=await fetch(url,{method:'GET',redirect:'follow',credentials:internal?'same-origin':'omit',cache:'no-store',signal:controller.signal,headers:{'Accept':'text/html,application/xhtml+xml,application/json;q=0.8,*/*;q=0.5'}});
      return{state:'complete',status:res.status,finalUrl:res.url||url,redirected:res.redirected,durationMs:Math.round(performance.now()-started)};
    }catch(error){
      const message=error?.message||'request failed';
      const state=error?.name==='AbortError'?'timeout':/redirect/i.test(message)?'redirect-error':'unavailable';
      return{state,status:0,error:message,finalUrl:url,durationMs:Math.round(performance.now()-started)};
    }finally{clearTimeout(timer)}
  }
  function probeClass(result){
    if(!result||result.state!=='complete')return'inconclusive';
    if(result.status===404||result.status===410)return'missing';
    if(result.status>=500)return'server-error';
    if(result.status>=200&&result.status<400)return'healthy';
    if([401,403,408,409,425,429].includes(result.status))return'inconclusive';
    if(result.status>=400)return'inconclusive';
    return'inconclusive';
  }
  async function runQueue(entries,{concurrency,timeoutMs,deadlineAt=Infinity}){
    const out=new Array(entries.length);let cursor=0;
    async function worker(){
      while(cursor<entries.length){
        const i=cursor++;
        const remaining=deadlineAt-performance.now();
        if(remaining<500){
          out[i]={state:'budget-exhausted',status:0,error:'link audit time budget exhausted',finalUrl:entries[i].url,durationMs:0};
          continue;
        }
        out[i]=await probeUrl(entries[i].url,{timeoutMs:Math.max(500,Math.min(timeoutMs,remaining)),internal:entries[i].internal!==false});
      }
    }
    await Promise.all(Array.from({length:Math.min(concurrency,entries.length)},()=>worker()));
    return out;
  }
  async function verifyLink(url,first,{retryTimeoutMs=7000,thirdTimeoutMs=8000,degraded=false,internal=true}={}){
    const attempts=[first];
    const firstClass=probeClass(first);
    if(firstClass==='healthy')return{verificationState:'healthy',confidence:'confirmed',result:first,attempts};
    const second=await probeUrl(url,{timeoutMs:degraded?Math.max(retryTimeoutMs,8000):retryTimeoutMs,internal});
    attempts.push(second);
    const secondClass=probeClass(second);
    if(secondClass==='healthy')return{verificationState:'healthy',confidence:'confirmed',result:second,attempts};
    if((firstClass==='missing'&&secondClass==='missing')||(firstClass==='server-error'&&secondClass==='server-error')){
      return{verificationState:'confirmed-failure',confidence:'confirmed',failureClass:secondClass,result:second,attempts};
    }
    if(firstClass==='redirect-error'&&secondClass==='redirect-error'){
      return{verificationState:'confirmed-failure',confidence:'confirmed',failureClass:'redirect-error',result:second,attempts};
    }
    const oneFailure=[firstClass,secondClass].filter(x=>x==='missing'||x==='server-error'||x==='redirect-error');
    const oneInconclusive=[firstClass,secondClass].some(x=>x==='inconclusive');
    if(oneFailure.length===1&&oneInconclusive){
      const third=await probeUrl(url,{timeoutMs:thirdTimeoutMs,internal});
      attempts.push(third);
      const thirdClass=probeClass(third);
      if(thirdClass==='healthy')return{verificationState:'healthy',confidence:'confirmed',result:third,attempts};
      if(thirdClass===oneFailure[0]){
        return{verificationState:'confirmed-failure',confidence:'confirmed',failureClass:thirdClass,result:third,attempts};
      }
    }
    return{verificationState:'inconclusive',confidence:'inconclusive',result:attempts[attempts.length-1],attempts};
  }
  async function recheckLink(url,{timeoutMs=4500,retryTimeoutMs=8000}={}){
    let internal=true;try{internal=new URL(url).origin===location.origin}catch{}
    const first=await probeUrl(url,{timeoutMs,internal});
    const result=await verifyLink(url,first,{retryTimeoutMs,thirdTimeoutMs:retryTimeoutMs,degraded:false,internal});
    cacheLinkResult(url,result);
    return {
      url,
      verificationState:result.verificationState,
      confidence:result.confidence,
      failureClass:result.failureClass||'',
      status:result.result?.status||0,
      finalUrl:result.result?.finalUrl||url,
      attempts:(result.attempts||[]).map((a,index)=>({attempt:index+1,state:a.state,status:a.status||0,durationMs:a.durationMs||0,finalUrl:a.finalUrl||url}))
    };
  }

  async function auditLinks({limit=36,concurrency=6,timeoutMs=3000,retryTimeoutMs=7000,budgetMs=15000}={}){
    const groups=new Map();
    for(const a of document.querySelectorAll('a[href]')){
      const classified=classifyLink(a);if(!classified)continue;
      const {url,internal}=classified;
      if(!groups.has(url))groups.set(url,{url,internal,anchors:[]});
      groups.get(url).anchors.push(a);
      if(groups.size>=limit)break;
    }
    const entries=[...groups.values()];
    const deadlineAt=performance.now()+budgetMs;
    const firstResults=new Array(entries.length);
    const uncached=[];
    entries.forEach((entry,i)=>{
      const cached=cachedLinkResult(entry.url);
      if(cached)firstResults[i]=cached;
      else uncached.push({index:i,url:entry.url,internal:entry.internal});
    });
    if(uncached.length){
      const probed=await runQueue(uncached,{concurrency,timeoutMs,deadlineAt});
      uncached.forEach((entry,i)=>firstResults[entry.index]=probed[i]);
    }

    const initialInconclusive=firstResults.filter(r=>!r?.verificationState&&probeClass(r)==='inconclusive').length;
    const degraded=entries.length>=4&&initialInconclusive/Math.max(1,entries.length)>=.25;
    const verificationResults=new Array(entries.length);
    const pending=[];
    entries.forEach((entry,i)=>{
      const first=firstResults[i];
      if(first?.verificationState)verificationResults[i]=first;
      else if(probeClass(first)==='healthy'){
        verificationResults[i]={verificationState:'healthy',confidence:'confirmed',result:first,attempts:[first]};
        cacheLinkResult(entry.url,verificationResults[i]);
      } else pending.push({index:i,url:entry.url,first,internal:entry.internal});
    });

    let pendingCursor=0;
    const retryConcurrency=degraded?1:2;
    async function retryWorker(){
      while(pendingCursor<pending.length){
        const item=pending[pendingCursor++];
        const remaining=deadlineAt-performance.now();
        if(remaining<700){
          verificationResults[item.index]={verificationState:'inconclusive',confidence:'inconclusive',result:item.first,attempts:[item.first],budgetExhausted:true};
          continue;
        }
        const effectiveRetry=Math.max(700,Math.min(retryTimeoutMs,remaining));
        const verified=await verifyLink(item.url,item.first,{retryTimeoutMs:effectiveRetry,thirdTimeoutMs:Math.max(700,Math.min(8000,deadlineAt-performance.now())),degraded,internal:item.internal!==false});
        verificationResults[item.index]=verified;
        cacheLinkResult(item.url,verified);
      }
    }
    await Promise.all(Array.from({length:Math.min(retryConcurrency,pending.length)},()=>retryWorker()));

    const findings=[],incompleteChecks=[],externalCandidates=[];
    let healthy=0,confirmedIssues=0,cachedCount=0;
    entries.forEach((entry,i)=>{
      const verified=verificationResults[i]||{verificationState:'inconclusive',confidence:'inconclusive',attempts:[]};
      if(verified.cached)cachedCount++;
      const first=entry.anchors[0],ctx=linkContext(first);
      const sources=entry.anchors.slice(0,12).map(a=>({...linkContext(a),selector:selectorFor(a)}));
      const result=verified.result||verified.attempts?.[verified.attempts.length-1]||{status:0,state:'unavailable',finalUrl:entry.url};
      const attemptEvidence=(verified.attempts||[]).map((a,index)=>({attempt:index+1,state:a.state,status:a.status||0,durationMs:a.durationMs||0,finalUrl:a.finalUrl||entry.url}));
      const method=entry.internal?'same-origin browser GET with independent retry':'cross-origin GET with independent retry';
      const extra={link:{url:entry.url,internal:!!entry.internal,sourceUrl:location.href,status:result.status||0,state:result.state||'unknown',finalUrl:result.finalUrl||entry.url,redirected:!!result.redirected,occurrences:entry.anchors.length,sources,...ctx},verification:{state:verified.verificationState,method,attempts:attemptEvidence.length,evidence:attemptEvidence}};
      if(verified.verificationState==='healthy'){healthy++;return}
      if(verified.verificationState==='inconclusive'){
        const kind=entry.internal?'internal-link':'external-link';
        let path='';try{path=new URL(entry.url).pathname}catch{path=entry.url}
        // Prefer HTTP status over probe-transport state so 403/429 never surface as reason "complete".
        const inconclusiveReason=result.status?`http-${result.status}`:(result.state&&result.state!=='complete'?result.state:'unavailable');
        incompleteChecks.push({kind,url:entry.url,path,text:ctx.text||'',reason:inconclusiveReason,status:result.status||0,attempts:attemptEvidence,prominence:ctx.prominence||'',location:ctx.location||''});
        if(!entry.internal&&(result.state==='unavailable'||result.status===0||result.state==='timeout')){
          externalCandidates.push({url:entry.url,text:ctx.text||'',occurrences:entry.anchors.length,sources,prominence:ctx.prominence||'',location:ctx.location||'',selector:selectorFor(first)});
        }
        return;
      }
      confirmedIssues++;
      if(verified.failureClass==='missing'){
        const status=result.status===410?410:404;
        const ruleId=entry.internal?`navigation.link-${status}`:`navigation.link-${status}-external`;
        const title=entry.internal?'Internal link points to a missing page':'External link points to a missing page';
        const dest=entry.internal?new URL(entry.url).pathname:entry.url;
        findings.push(finding({ruleId,title,detail:`${ctx.text?`"${ctx.text}" `:''}points to ${dest}. Independent requests confirmed the destination returns HTTP ${result.status}.`,category:'fix',severity:'high',element:first,evidence:`confirmed ${result.status} ${entry.url}`,count:entry.anchors.length,confidence:'confirmed',verification:extra.verification,extra}));
      }else if(verified.failureClass==='server-error'){
        findings.push(finding({ruleId:entry.internal?'navigation.link-5xx':'navigation.link-5xx-external',title:entry.internal?'Internal link points to a server error':'External link points to a server error',detail:`${ctx.text?`"${ctx.text}" `:''}points to ${entry.internal?new URL(entry.url).pathname:entry.url}. Independent requests confirmed a server error at the destination.`,category:'fix',severity:'critical',element:first,evidence:`confirmed ${result.status} ${entry.url}`,count:entry.anchors.length,confidence:'confirmed',verification:extra.verification,extra}));
      }else if(verified.failureClass==='redirect-error'){
        findings.push(finding({ruleId:entry.internal?'navigation.link-redirect-error':'navigation.link-redirect-error-external',title:entry.internal?'Internal link has a confirmed redirect failure':'External link has a confirmed redirect failure',detail:`${ctx.text?`"${ctx.text}" `:''}points to ${entry.internal?new URL(entry.url).pathname:entry.url}, and repeated requests could not complete its redirect sequence.`,category:'fix',severity:'high',element:first,evidence:`confirmed redirect failure ${entry.url}`,count:entry.anchors.length,confidence:'confirmed',verification:extra.verification,extra}));
      }
    });
    const coverageState=incompleteChecks.length?'partial':'complete';
    return{
      findings,checked:entries.length,verifiedHealthy:healthy,confirmedIssues,inconclusive:incompleteChecks.length,
      incompleteChecks,externalCandidates,limit,reachedLimit:groups.size>=limit,degraded,cached:cachedCount,budgetExhausted:incompleteChecks.some(x=>x.reason==='budget-exhausted'),status:coverageState
    };
  }

  function applyExternalProbeResults(candidates=[], probeRows=[]){
    const byUrl=new Map((probeRows||[]).map(r=>[String(r.url||''),r]));
    const findings=[],incompleteChecks=[],resolvedUrls=new Set();
    for(const candidate of candidates||[]){
      const row=byUrl.get(candidate.url);
      if(!row)continue;
      const status=Number(row.status||0);
      let liveAnchors=[...document.querySelectorAll('a[href]')].filter(a=>{
        try{const c=classifyLink(a);return c&&c.url===candidate.url}catch{return false}
      });
      if(!liveAnchors.length){
        liveAnchors=[{nodeType:1,localName:'a',tagName:'A',id:'',classList:{length:0},parentElement:null,innerText:candidate.text||'',className:'',getAttribute(name){return name==='href'?candidate.url:null},hasAttribute(){return false},closest(){return null},getBoundingClientRect(){return{x:0,y:0,width:0,height:0}}}];
      }
      const first=liveAnchors[0],ctx={text:candidate.text||'',location:candidate.location||'body',prominence:candidate.prominence||'normal',...linkContext(first)};
      const sources=candidate.sources||[{...ctx,selector:candidate.selector||selectorFor(first)}];
      const attempt={attempt:1,state:status?'complete':'unavailable',status,durationMs:Number(row.durationMs||0),finalUrl:row.finalUrl||candidate.url};
      const extra={link:{url:candidate.url,internal:false,sourceUrl:location.href,status,state:status?'complete':'unavailable',finalUrl:row.finalUrl||candidate.url,redirected:!!row.redirected,occurrences:Number(candidate.occurrences||liveAnchors.length||1),sources,...ctx},verification:{state:'confirmed',method:'privileged external GET',attempts:1,evidence:[attempt]}};
      if(status===404||status===410){
        findings.push(finding({ruleId:`navigation.link-${status===410?410:404}-external`,title:'External link points to a missing page',detail:`${ctx.text?`"${ctx.text}" `:''}points to ${candidate.url}. A privileged request confirmed HTTP ${status}.`,category:'fix',severity:'high',element:first,evidence:`confirmed ${status} ${candidate.url}`,count:Number(candidate.occurrences||liveAnchors.length||1),confidence:'confirmed',verification:extra.verification,extra}));
        resolvedUrls.add(candidate.url);continue;
      }
      if(status>=500){
        findings.push(finding({ruleId:'navigation.link-5xx-external',title:'External link points to a server error',detail:`${ctx.text?`"${ctx.text}" `:''}points to ${candidate.url}. A privileged request confirmed a server error.`,category:'fix',severity:'critical',element:first,evidence:`confirmed ${status} ${candidate.url}`,count:Number(candidate.occurrences||1),confidence:'confirmed',verification:extra.verification,extra}));
        resolvedUrls.add(candidate.url);continue;
      }
      if(status>=200&&status<400){resolvedUrls.add(candidate.url);continue}
      incompleteChecks.push({kind:'external-link',url:candidate.url,path:candidate.url,text:candidate.text||'',reason:status?`http-${status}`:(row.error||'unavailable'),status,attempts:[attempt],prominence:candidate.prominence||'',location:candidate.location||''});
      resolvedUrls.add(candidate.url);
    }
    return{findings,incompleteChecks,resolvedUrls:[...resolvedUrls]};
  }

  function merge(local,axeResults,linkResult={findings:[],checked:0}){
    const findings=[...local.findings,...axeFindings(axeResults),...(linkResult.findings||[])],seen=new Map();
    for(const f of findings){const key=`${f.ruleId}|${f.selector}|${f.evidence}`;if(!seen.has(key))seen.set(key,f)}
    const linksStatus=linkResult.status==='partial'?'partial':linkResult.status==='unavailable'?'unavailable':Number(linkResult.checked||0)===0?'none_checked':'complete';
    return{...local,browserPerformance:local.browserPerformance||null,findings:[...seen.values()],linkAudit:{checked:linkResult.checked||0,verifiedHealthy:linkResult.verifiedHealthy||0,confirmedIssues:linkResult.confirmedIssues||0,inconclusive:linkResult.inconclusive||0,incompleteChecks:linkResult.incompleteChecks||[],reachedLimit:!!linkResult.reachedLimit,degraded:!!linkResult.degraded,cached:linkResult.cached||0},coverage:{...local.coverage,links:linksStatus,axe:axeResults?'complete':'unavailable'}};
  }

  globalThis.WebQARules={run,axeFindings,resolvedTargetState,auditLinks,recheckLink,applyExternalProbeResults,merge,selectorFor,resolveTarget,performanceSignals,preparePerformanceSignals,semanticContextFor,targetContextFor(targetId,selector='',ruleId=''){
    const el=resolveTarget(targetId,selector);if(!el)return null;
    const style=getComputedStyle(el),rect=el.getBoundingClientRect();
    return{found:true,tag:el.tagName.toLowerCase(),selector:selector||selectorFor(el),markup:clip(cleanMarkup(el.outerHTML),1400),text:clip(el.innerText||el.textContent,500),semantics:semanticContextFor(el,ruleId),rect:{x:Math.round(rect.x),y:Math.round(rect.y),width:Math.round(rect.width),height:Math.round(rect.height)},styles:{color:style.color,backgroundColor:style.backgroundColor,fontSize:style.fontSize,fontWeight:style.fontWeight,lineHeight:style.lineHeight,display:style.display,position:style.position}};
  }};
})();