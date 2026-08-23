(() => {
  const CATEGORY_RANK={fix:3,review:2,context:1};
  const SEVERITY_RANK={critical:5,high:4,medium:3,low:2,info:1};
  const targetRegistry=new Map();
  const linkVerificationCache=new Map();

  function text(value){return String(value??'').trim()}
  function attr(el,name){return text(el?.getAttribute?.(name))}
  function clip(value,n=420){const s=text(value).replace(/\s+/g,' ');return s.length>n?s.slice(0,n-1)+'…':s}
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
  function snippet(el){return el?clip(el.outerHTML||el.textContent||'',520):''}
  function resolveSelector(selector){if(!selector)return null;try{return document.querySelector(selector)}catch{return null}}
  function presentationForElement(el){
    if(!el)return'page';
    if(document.head?.contains(el)||['META','LINK','TITLE','SCRIPT','STYLE'].includes(el.tagName))return'document';
    return document.body?.contains(el)?'visual':'page';
  }
  function registerTarget(el,seed){
    if(!el||el.nodeType!==1)return'';
    const targetId=`target_${hash(`${seed}|${selectorFor(el)}|${el.tagName}`)}`;
    targetRegistry.set(targetId,el);
    return targetId;
  }
  function resolveTarget(targetId,selector=''){
    const el=targetId?targetRegistry.get(targetId):null;
    if(el?.isConnected)return el;
    return resolveSelector(selector);
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
    const canonicalEl=document.querySelector('link[rel~="canonical"]'),descEl=document.querySelector('meta[name="description" i]'),robotsEl=document.querySelector('meta[name="robots" i]'),viewportEl=document.querySelector('meta[name="viewport" i]'),h1s=[...document.querySelectorAll('h1')],schema=schemaState();
    let canonical='';try{canonical=canonicalEl?.href||''}catch{}
    return{url:location.href,origin:location.origin,hostname:location.hostname,pathname:location.pathname,title:document.title||'',description:attr(descEl,'content'),canonical,robots:attr(robotsEl,'content'),lang:attr(document.documentElement,'lang'),viewport:attr(viewportEl,'content'),h1s:h1s.map(h=>clip(h.textContent,160)),schemaTypes:schema.types,schemaBlockCount:schema.blockCount,formCount:document.forms.length,imageCount:document.images.length,linkCount:document.links.length,interactiveCount:document.querySelectorAll('a,button,input,select,textarea,[role="button"],[tabindex]').length};
  }

  function run(){
    targetRegistry.clear();
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
    if(!viewportEl)findings.push(finding({ruleId:'web.viewport-missing',title:'Viewport metadata is missing',detail:'No viewport meta tag was observed in the rendered document.',category:'fix',severity:'medium',targetType:'document'}));
    else if(/user-scalable\s*=\s*no/i.test(page.viewport)||/maximum-scale\s*=\s*1(?:\.0+)?(?:,|$)/i.test(page.viewport))findings.push(finding({ruleId:'a11y.viewport-zoom-restricted',title:'Viewport appears to restrict zoom',detail:'The viewport configuration may prevent or severely limit user zoom.',category:'review',severity:'medium',element:viewportEl,targetType:'document',evidence:page.viewport,wcag:['1.4.4']}));
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
        try{lcpElement={tag:String(lcp.element.tagName||'').toLowerCase(),selector:selectorFor(lcp.element),url:clip(lcp.url||lcp.element.currentSrc||lcp.element.src||'',220),size:Number(lcp.size||0)};}catch{}
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
        heaviest:knownResources.slice().sort((a,b)=>(Number(b.transferSize)||0)-(Number(a.transferSize)||0)).slice(0,5).map(r=>({name:clip(r.name,220),type:r.initiatorType||'other',bytes:Number(r.transferSize)||0,durationMs:Math.round(r.duration||0)}))
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
      out.push(finding({ruleId:'performance.browser.lcp',title:'Largest contentful paint is slow in this browser',confidence:'inferred',detail:`Largest contentful paint was observed at ${(signals.largestContentfulPaintMs/1000).toFixed(1)}s on this machine and network.${elementNote} This is a lab observation, not a field score.`,category:'review',severity:'medium',targetType:'page',evidence:`lcp=${signals.largestContentfulPaintMs}ms`,extra:{performanceObservation:signals}}));
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

  function safeLink(url,anchor){
    if(!url||anchor?.hasAttribute('download'))return null;
    const raw=anchor?.getAttribute('href')||'';
    if(!raw||raw.startsWith('#')||/^(mailto:|tel:|javascript:|data:)/i.test(raw))return null;
    try{
      const u=new URL(raw,location.href);
      if(!/^https?:$/.test(u.protocol)||u.origin!==location.origin)return null;
      if(/\/(?:logout|log-out|signout|sign-out)(?:\/|$|\?)/i.test(u.pathname))return null;
      u.hash='';
      return u.href;
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
  async function probeUrl(url,{timeoutMs=3500}={}){
    const controller=new AbortController(),started=performance.now();
    const timer=setTimeout(()=>controller.abort(),timeoutMs);
    try{
      const res=await fetch(url,{method:'GET',redirect:'follow',credentials:'same-origin',cache:'no-store',signal:controller.signal,headers:{'Accept':'text/html,application/xhtml+xml,application/json;q=0.8,*/*;q=0.5'}});
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
        out[i]=await probeUrl(entries[i].url,{timeoutMs:Math.max(500,Math.min(timeoutMs,remaining))});
      }
    }
    await Promise.all(Array.from({length:Math.min(concurrency,entries.length)},()=>worker()));
    return out;
  }
  async function verifyLink(url,first,{retryTimeoutMs=7000,thirdTimeoutMs=8000,degraded=false}={}){
    const attempts=[first];
    const firstClass=probeClass(first);
    if(firstClass==='healthy')return{verificationState:'healthy',confidence:'confirmed',result:first,attempts};
    const second=await probeUrl(url,{timeoutMs:degraded?Math.max(retryTimeoutMs,8000):retryTimeoutMs});
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
      const third=await probeUrl(url,{timeoutMs:thirdTimeoutMs});
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
    const first=await probeUrl(url,{timeoutMs});
    const result=await verifyLink(url,first,{retryTimeoutMs,thirdTimeoutMs:retryTimeoutMs,degraded:false});
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
      const url=safeLink(a.href,a);if(!url)continue;
      if(!groups.has(url))groups.set(url,[]);
      groups.get(url).push(a);
      if(groups.size>=limit)break;
    }
    const entries=[...groups.entries()].map(([url,anchors])=>({url,anchors}));
    const deadlineAt=performance.now()+budgetMs;
    const firstResults=new Array(entries.length);
    const uncached=[];
    entries.forEach((entry,i)=>{
      const cached=cachedLinkResult(entry.url);
      if(cached)firstResults[i]=cached;
      else uncached.push({index:i,url:entry.url});
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
      } else pending.push({index:i,url:entry.url,first});
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
        const verified=await verifyLink(item.url,item.first,{retryTimeoutMs:effectiveRetry,thirdTimeoutMs:Math.max(700,Math.min(8000,deadlineAt-performance.now())),degraded});
        verificationResults[item.index]=verified;
        cacheLinkResult(item.url,verified);
      }
    }
    await Promise.all(Array.from({length:Math.min(retryConcurrency,pending.length)},()=>retryWorker()));

    const findings=[],incompleteChecks=[];
    let healthy=0,confirmedIssues=0,cachedCount=0;
    entries.forEach((entry,i)=>{
      const {url,anchors}=entry,verified=verificationResults[i]||{verificationState:'inconclusive',confidence:'inconclusive',attempts:[]};
      if(verified.cached)cachedCount++;
      const first=anchors[0],ctx=linkContext(first);
      const sources=anchors.slice(0,12).map(a=>({...linkContext(a),selector:selectorFor(a)}));
      const result=verified.result||verified.attempts?.[verified.attempts.length-1]||{status:0,state:'unavailable',finalUrl:url};
      const attemptEvidence=(verified.attempts||[]).map((a,index)=>({attempt:index+1,state:a.state,status:a.status||0,durationMs:a.durationMs||0,finalUrl:a.finalUrl||url}));
      const extra={link:{url,sourceUrl:location.href,status:result.status||0,state:result.state||'unknown',finalUrl:result.finalUrl||url,redirected:!!result.redirected,occurrences:anchors.length,sources,...ctx},verification:{state:verified.verificationState,method:'same-origin browser GET with independent retry',attempts:attemptEvidence.length,evidence:attemptEvidence}};
      if(verified.verificationState==='healthy'){healthy++;return}
      if(verified.verificationState==='inconclusive'){
        incompleteChecks.push({kind:'internal-link',url,path:new URL(url).pathname,text:ctx.text||'',reason:result.state||'unavailable',attempts:attemptEvidence});
        return;
      }
      confirmedIssues++;
      if(verified.failureClass==='missing'){
        const status=result.status===410?410:404;
        findings.push(finding({ruleId:`navigation.link-${status}`,title:'Internal link points to a missing page',detail:`${ctx.text?`"${ctx.text}" `:''}points to ${new URL(url).pathname}. Independent browser requests confirmed the destination returns HTTP ${result.status}.`,category:'fix',severity:'high',element:first,evidence:`confirmed ${result.status} ${url}`,count:anchors.length,confidence:'confirmed',verification:extra.verification,extra}));
      }else if(verified.failureClass==='server-error'){
        findings.push(finding({ruleId:'navigation.link-5xx',title:'Internal link points to a server error',detail:`${ctx.text?`"${ctx.text}" `:''}points to ${new URL(url).pathname}. Independent browser requests confirmed a server error at the destination.`,category:'fix',severity:'critical',element:first,evidence:`confirmed ${result.status} ${url}`,count:anchors.length,confidence:'confirmed',verification:extra.verification,extra}));
      }else if(verified.failureClass==='redirect-error'){
        findings.push(finding({ruleId:'navigation.link-redirect-error',title:'Internal link has a confirmed redirect failure',detail:`${ctx.text?`"${ctx.text}" `:''}points to ${new URL(url).pathname}, and repeated browser requests could not complete its redirect sequence.`,category:'fix',severity:'high',element:first,evidence:`confirmed redirect failure ${url}`,count:anchors.length,confidence:'confirmed',verification:extra.verification,extra}));
      }
    });
    const coverageState=incompleteChecks.length?'partial':'complete';
    return{
      findings,checked:entries.length,verifiedHealthy:healthy,confirmedIssues,inconclusive:incompleteChecks.length,
      incompleteChecks,limit,reachedLimit:groups.size>=limit,degraded,cached:cachedCount,budgetExhausted:incompleteChecks.some(x=>x.reason==='budget-exhausted'),status:coverageState
    };
  }

  function merge(local,axeResults,linkResult={findings:[],checked:0}){
    const findings=[...local.findings,...axeFindings(axeResults),...(linkResult.findings||[])],seen=new Map();
    for(const f of findings){const key=`${f.ruleId}|${f.selector}|${f.evidence}`;if(!seen.has(key))seen.set(key,f)}
    return{...local,browserPerformance:local.browserPerformance||null,findings:[...seen.values()],linkAudit:{checked:linkResult.checked||0,verifiedHealthy:linkResult.verifiedHealthy||0,confirmedIssues:linkResult.confirmedIssues||0,inconclusive:linkResult.inconclusive||0,incompleteChecks:linkResult.incompleteChecks||[],reachedLimit:!!linkResult.reachedLimit,degraded:!!linkResult.degraded,cached:linkResult.cached||0},coverage:{...local.coverage,links:linkResult.status==='partial'?'partial':linkResult.status==='unavailable'?'unavailable':'complete',axe:axeResults?'complete':'unavailable'}};
  }

  globalThis.WebQARules={run,axeFindings,auditLinks,recheckLink,merge,selectorFor,resolveTarget,performanceSignals,preparePerformanceSignals,semanticContextFor,targetContextFor(targetId,selector='',ruleId=''){
    const el=resolveTarget(targetId,selector);if(!el)return null;
    const style=getComputedStyle(el),rect=el.getBoundingClientRect();
    return{found:true,tag:el.tagName.toLowerCase(),selector:selector||selectorFor(el),markup:clip(el.outerHTML,1400),text:clip(el.innerText||el.textContent,500),semantics:semanticContextFor(el,ruleId),rect:{x:Math.round(rect.x),y:Math.round(rect.y),width:Math.round(rect.width),height:Math.round(rect.height)},styles:{color:style.color,backgroundColor:style.backgroundColor,fontSize:style.fontSize,fontWeight:style.fontWeight,lineHeight:style.lineHeight,display:style.display,position:style.position}};
  }};
})();