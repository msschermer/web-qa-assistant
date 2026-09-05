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
  const SAME_ORIGIN_IFRAME_HARD_CEILING=32;
  const SAME_ORIGIN_IFRAME_MAX_DEPTH=3;
  const LINK_PROBE_HARD_CEILING=500;
  const LINK_PROBE_CONCURRENCY=16;
  const LINK_PROBE_TARGET_ORIGIN_CONCURRENCY=6;
  const LINK_PROBE_TARGET_ORIGIN_CEILING=16;
  const LINK_PROBE_TARGET_WITH_EXTERNAL_CEILING=12;
  const LINK_PROBE_EXTERNAL_PER_HOST_CONCURRENCY=2;
  const LINK_PROBE_EXTERNAL_GLOBAL=4;
  const LINK_PROBE_PER_HOST_CONCURRENCY=LINK_PROBE_EXTERNAL_PER_HOST_CONCURRENCY;
  const LINK_PROBE_TIMEOUT_MS=2500;
  const LINK_PROBE_TARGET_TIMEOUT_MS=4000;
  const LINK_PROBE_RETRY_TIMEOUT_MS=5000;
  const LINK_PROBE_EMERGENCY_MS=120000;
  const LINK_PROBE_HEALTHY_WINDOW=4;
  const LINK_CACHE_TTL_HEALTHY_INTERNAL_MS=8*60*1000;
  const LINK_CACHE_TTL_HEALTHY_EXTERNAL_MS=3*60*1000;
  const LINK_CACHE_TTL_BROKEN_MS=90*1000;
  const LINK_CACHE_TTL_REDIRECT_MS=2*60*1000;
  const LINK_CACHE_MAX_ENTRIES=400;
  const SAFE_INTERACTION_BUDGET=6;
  const SAFE_INTERACTION_PER_FRAME=2;
  const INTERACTION_SETTLE_MAX_MS=120;
  const INTERACTION_SETTLE_EXTENDED_MS=280;
  const INTERACTION_SETTLE_STEP_MS=16;
  const INTERACTION_TOTAL_BUDGET_MS=900;
  let lastResolutionStage='';
  const linkVerificationCache=new Map();
  let lastInteractionCoverage=null;
  let lastPreparedInteractionFindings=null;
  let interactionsPrepared=false;

  function text(value){return String(value??'').trim()}
  function nowMs(){try{if(typeof performance!=='undefined'&&performance.now)return performance.now()}catch{}return Date.now()}
  function attr(el,name){return text(el?.getAttribute?.(name))}
  function clip(value,n=420){const s=text(value).replace(/\s+/g,' ');return s.length>n?s.slice(0,n-1)+'…':s}
  function sanitizeResourceUrl(raw,n=220){
    const value=String(raw||'').trim();
    if(!value)return'';
    try{
      const u=new URL(value);
      u.username='';u.password='';
      u.search='';u.hash='';
      return clip(u.toString(),n);
    }
    catch{return clip(value.split(/[?#]/)[0]||value,n)}
  }
  function sanitizeHttpUrl(raw,n=220){
    const value=String(raw||'').trim();
    if(!value)return'';
    try{
      const u=new URL(value,location.href);
      if(!/^https?:$/.test(u.protocol))return'';
      u.username='';u.password='';
      u.search='';u.hash='';
      return clip(u.toString(),n);
    }catch{return''}
  }
  function robotsIndexState(content){
    const text=String(content||'').toLowerCase();
    if(/\bnoindex\b/.test(text))return'noindex';
    if(/\bindex\b/.test(text))return'index';
    return'';
  }
  function isInertHref(raw){
    const h=String(raw||'').trim().toLowerCase().replace(/\s+/g,'');
    if(h==='')return true;
    return /^javascript:(?:void(?:\(0?\))?;?|void0;?|;)$/.test(h);
  }
  function hash(input){let h=2166136261;for(let i=0;i<input.length;i++){h^=input.charCodeAt(i);h=Math.imul(h,16777619)}return(h>>>0).toString(36)}
  let lastFrameRecords=null;
  let lastScanId='';
  function collectFrameRecords(){
    const records=[];
    const seenDocs=new Set();
    const seenFrames=new Set();
    const walk=(doc,depth)=>{
      if(!doc||seenDocs.has(doc)||depth>SAME_ORIGIN_IFRAME_MAX_DEPTH)return;
      seenDocs.add(doc);
      let frames=[];
      try{frames=[...doc.querySelectorAll('iframe')]}catch{return}
      for(const frame of frames){
        if(seenFrames.has(frame))continue;
        seenFrames.add(frame);
        let child=null;
        try{child=frame.contentDocument}catch{child=null}
        const src=attr(frame,'src');
        const srcdoc=attr(frame,'srcdoc');
        let sameOrigin=false;
        try{
          if(srcdoc||!src)sameOrigin=true;
          else{
            const base=doc.defaultView?.location?.href||location.href;
            const u=new URL(src,base);
            sameOrigin=u.protocol==='about:'||u.origin===location.origin;
          }
        }catch{sameOrigin=Boolean(child)}
        // URL origin is authoritative. A test environment may leak contentDocument
        // for a cross-origin src; never inspect those interiors.
        const accessible=sameOrigin&&Boolean(child);
        records.push({frame,doc:accessible?child:null,sameOrigin,accessible,depth,src,srcdoc});
        if(accessible&&child)walk(child,depth+1);
      }
    };
    try{walk(document,0)}catch{}
    lastFrameRecords=records;
    return records;
  }
  function hostIframeFor(el){
    if(!el||!el.ownerDocument||el.ownerDocument===document)return null;
    const records=lastFrameRecords||collectFrameRecords();
    const mapped=records.find(r=>r.doc===el.ownerDocument);
    if(mapped)return mapped.frame;
    try{
      return[...document.querySelectorAll('iframe')].find(frame=>{
        try{return frame.contentDocument===el.ownerDocument}catch{return false}
      })||null;
    }catch{return null}
  }
  function frameContextFor(el){
    const host=hostIframeFor(el);
    if(!host)return null;
    const src=sanitizeHttpUrl(attr(host,'src'))||sanitizeResourceUrl(attr(host,'src'));
    return{
      embeddedContext:'same-origin-iframe',
      frameSelector:selectorFor(host),
      frameSrc:src,
      spotlightSafe:false,
      parentUrl:sanitizeHttpUrl(location.href)||location.origin
    };
  }
  function selectorFor(el){
    if(!el||el.nodeType!==1)return'';
    const host=hostIframeFor(el);
    const local=(()=>{
      if(el.id)return`#${CSS.escape(el.id)}`;
      const parts=[];let node=el;
      while(node&&node.nodeType===1&&parts.length<6){
        let part=node.localName;if(!part)break;
        const classes=[...(node.classList||[])].filter(Boolean).slice(0,2);
        if(classes.length)part+='.'+classes.map(c=>CSS.escape(c)).join('.');
        const parent=node.parentElement;
        if(parent){const same=[...parent.children].filter(x=>x.localName===node.localName);if(same.length>1)part+=`:nth-of-type(${same.indexOf(node)+1})`}
        parts.unshift(part);node=parent;
      }
      return parts.join(' > ');
    })();
    if(host){
      const frameSel=selectorFor(host);
      return frameSel?`${frameSel} >> ${local}`:local;
    }
    return local;
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
  function resolveFramePath(selector){
    const parts=String(selector||'').split(' >> ').map(s=>s.trim()).filter(Boolean);
    if(parts.length<2)return null;
    let root=document;
    for(let i=0;i<parts.length-1;i++){
      let frame=null;
      try{frame=root.querySelector(parts[i])}catch{return null}
      if(!frame||String(frame.localName||'').toLowerCase()!=='iframe')return null;
      try{root=frame.contentDocument}catch{return null}
      if(!root)return null;
    }
    try{return root.querySelector(parts[parts.length-1])||null}catch{return null}
  }
  function queryInRoot(root,selector){
    if(!root||!selector)return null;
    try{return root.querySelector(selector)}catch{return null}
  }
  function presentationForElement(el){
    if(!el)return'page';
    const tag=(el.localName||'').toLowerCase();
    if(el.ownerDocument&&el.ownerDocument!==document){
      // Same-origin iframe images can be highlighted in the framed document.
      if(['img','image','video'].includes(tag))return'visual';
      return'document';
    }
    if(document.head?.contains(el)||['META','LINK','TITLE','SCRIPT','STYLE'].includes(el.tagName))return'document';
    return document.body?.contains(el)?'visual':'page';
  }
  // A structural description that survives a re-render, so an element can be
  // recognised again even when its generated classes or DOM position changed.
  function fingerprintUrl(raw){
    const value=String(raw||'').trim();
    if(!value||/^(javascript|data|vbscript|file|blob):/i.test(value))return '';
    if(/^https?:/i.test(value))return sanitizeHttpUrl(value)||'';
    if(/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(value))return '';
    return value.split(/[?#]/)[0].slice(0,300);
  }
  function describeTarget(el){
    const currentSrc=fingerprintUrl(el.currentSrc||'')||fingerprintUrl(attr(el,'src'));
    return{
      tag:(el.localName||'').toLowerCase(),
      elId:el.id||'',
      classes:[...(el.classList||[])].filter(Boolean).slice(0,6),
      role:attr(el,'role'),
      ariaLabel:attr(el,'aria-label'),
      name:attr(el,'name'),
      alt:attr(el,'alt'),
      type:attr(el,'type'),
      src:fingerprintUrl(attr(el,'src')),
      currentSrc:String(currentSrc||'').slice(0,300),
      href:fingerprintUrl(attr(el,'href')),
      text:clip(el.textContent,120)
    };
  }
  function scoreCandidate(el,d){
    if(!el||el.nodeType!==1||(el.localName||'').toLowerCase()!==d.tag)return 0;
    let score=0;
    if(d.elId&&el.id===d.elId)score+=6;
    if(d.currentSrc&&sanitizeResourceUrl(el.currentSrc||'').slice(0,300)===d.currentSrc)score+=6;
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
    const framed=resolveFramePath(selector);
    if(framed)return framed;
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
  /**
   * Many themes duplicate the same link (a desktop nav item and its hidden
   * mobile-menu twin, most often) — sharing one URL/fragment/href means they
   * land in the same finding group, and DOM order alone decides which one
   * becomes "the" element to highlight. If that pick is the hidden duplicate,
   * highlighting resolves fine (the element exists) but its bounding rect is
   * zero-sized or off the visible page, so the ring renders pinned to a
   * corner and scrollIntoView has nothing meaningful to scroll to. Prefer
   * whichever candidate is actually rendered on screen right now.
   */
  function isRenderedOnScreen(el){
    if(!el||typeof el.getBoundingClientRect!=='function')return false;
    let rect;
    try{rect=el.getBoundingClientRect()}catch{return false}
    if(!rect||rect.width<1||rect.height<1)return false;
    try{
      const style=getComputedStyle(el);
      if(style.display==='none'||style.visibility==='hidden'||(style.opacity!==''&&Number(style.opacity)===0))return false;
    }catch{}
    return true;
  }
  function pickVisibleAnchor(anchors){
    if(!Array.isArray(anchors)||!anchors.length)return anchors?.[0]||null;
    return anchors.find(isRenderedOnScreen)||anchors[0];
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
      ['frame-path',()=>resolveFramePath(selector)],
      ['relaxed-selector',()=>relaxedSelectorMatch(selector.includes(' >> ')?selector.split(' >> ').pop():selector)],
      ['fingerprint',()=>fingerprintResolve(targetId)]
    ]:[
      ['selector',()=>resolveSelector(selector)],
      ['frame-path',()=>resolveFramePath(selector)],
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
      :selectorMatches>1?'The recorded selector now matches several elements, so the walkthrough will not guess which one it was.'
      :'The element was on the page when it was scanned and is not there now. It was most likely re-rendered, lazily removed, or behind a state change.';
    return{found:false,via:'unresolved',visible:false,tag:d?.tag||'',selector,selectorMatches,reason,
      described:d?{text:d.text,alt:d.alt,href:d.href,src:d.src,classes:d.classes.join(' ')}:null};
  }
  const STALE_TARGET_REASON='The affected element changed after the scan. Recheck this issue to refresh its target.';
  function elementMatchesFingerprint(el,d){
    if(!el||!d?.tag)return false;
    if((el.localName||'').toLowerCase()!==d.tag)return false;
    return scoreCandidate(el,d)>=4;
  }
  function validateResolvedTarget(targetId,selector='',expected={}){
    const el=resolveTarget(targetId,selector);
    if(!el?.isConnected)return{found:false,targetStatus:'stale',reason:STALE_TARGET_REASON,el:null};
    const d=targetFingerprints.get(targetId);
    const tag=(el.localName||'').toLowerCase();
    if(expected.elementType&&tag!==String(expected.elementType).toLowerCase()){
      return{found:false,targetStatus:'stale',reason:STALE_TARGET_REASON,el:null};
    }
    if(/image-oversized/.test(String(expected.ruleId||''))&&tag!=='img'&&tag!=='image'){
      return{found:false,targetStatus:'stale',reason:STALE_TARGET_REASON,el:null};
    }
    if(d?.tag&&!elementMatchesFingerprint(el,d)){
      return{found:false,targetStatus:'stale',reason:STALE_TARGET_REASON,el:null};
    }
    if(d?.tag&&tag!==d.tag)return{found:false,targetStatus:'stale',reason:STALE_TARGET_REASON,el:null};
    return{found:true,targetStatus:'valid',reason:'',el,tag};
  }
  function finding({ruleId,title,detail,category='review',severity='medium',selector='',element=null,targetType='',evidence='',sources=['browser'],wcag=[],helpUrl='',count=1,confidence='confirmed',verification=null,extra={}}){
    const resolved=element||resolveSelector(selector);
    const frameCtx=resolved?frameContextFor(resolved):null;
    const finalSelector=selector||selectorFor(resolved);
    const presentation=targetType||presentationForElement(resolved);
    const fingerprint=hash(`${ruleId}|${finalSelector}|${clip(evidence,220)}`);
    const tag=(resolved?.localName||'').toLowerCase();
    const iframeVisual=Boolean(frameCtx&&['img','image','video'].includes(tag)&&presentation==='visual');
    const targetId=presentation==='visual'&&resolved&&(!frameCtx||iframeVisual)?registerTarget(resolved,`${ruleId}|${fingerprint}`):'';
    const rect=(()=>{try{const r=resolved?.getBoundingClientRect?.();if(!r)return null;return{x:Math.round(r.x),y:Math.round(r.y),width:Math.round(r.width),height:Math.round(r.height)}}catch{return null}})();
    const described=resolved?describeTarget(resolved):null;
    const target={
      instanceId:targetId||`inst_${fingerprint}`,
      scanId:lastScanId,
      ruleId,
      framePath:frameCtx?.embeddedContext||'top-document',
      elementType:tag,
      stableLocator:finalSelector,
      fallbackLocator:resolved?.id?`#${CSS.escape(resolved.id)}`:'',
      targetFingerprint:described,
      boundingRectAtScan:rect,
      status:targetId?'valid':(presentation==='visual'?'unavailable':'none'),
      confidence:targetId?'high':'none'
    };
    const merged={...(frameCtx||{}),...extra,target,instanceId:target.instanceId};
    return {id:`${ruleId}:${fingerprint}`,ruleId,title,detail,category,severity,selector:finalSelector,targetId,targetType:presentation,evidence:clip(evidence,520),sources,wcag,helpUrl,count,fingerprint,confidence,verification:verification||{state:confidence,method:'deterministic browser observation',attempts:1,evidence:[]},...merged};
  }
  function headingSkip(headings){let previous=null;for(const h of headings){const level=Number(h.tagName.slice(1));if(previous&&level>previous+1)return h;previous=level}return null}
  function schemaState(){
    const blocks=[...document.querySelectorAll('script[type="application/ld+json"]')],types=new Set(),errors=[];
    const visit=value=>{if(!value||typeof value!=='object')return;if(Array.isArray(value))return value.forEach(visit);if(value['@type'])(Array.isArray(value['@type'])?value['@type']:[value['@type']]).forEach(t=>types.add(String(t)));Object.values(value).forEach(visit)};
    blocks.forEach((block,index)=>{try{visit(JSON.parse(block.textContent||'null'))}catch(error){errors.push({index,message:error.message,selector:selectorFor(block),element:block})}});
    return{blockCount:blocks.length,types:[...types],errors};
  }
  function pageInventory(){
    const frames=lastFrameRecords||collectFrameRecords();
    const accessibleDocs=frames.filter(r=>r.accessible&&r.doc).map(r=>r.doc);
    const countIn=(sel)=>{
      let n=0;
      try{n+=document.querySelectorAll(sel).length}catch{}
      for(const doc of accessibleDocs){
        try{n+=doc.querySelectorAll(sel).length}catch{}
      }
      return n;
    };
    return{
      links:countIn('a[href]'),
      uniqueLinks:(()=>{
        const seen=new Set();
        for(const a of collectLinkAnchors()){
          const classified=classifyLink(a);
          if(classified?.url)seen.add(classified.url);
        }
        return seen.size;
      })(),
      linkOccurrences:countIn('a[href]'),
      images:countIn('img'),
      iframes:frames.length,
      sameOriginFrames:frames.filter(r=>r.accessible).length,
      crossOriginFrames:frames.filter(r=>!r.accessible).length,
      forms:countIn('form'),
      buttons:countIn('button,[role="button"]'),
      disclosures:countIn('button[aria-expanded],[role="button"][aria-expanded]'),
      headings:countIn('h1,h2,h3,h4,h5,h6'),
      landmarks:countIn('nav,header,footer,main,aside,[role="navigation"],[role="banner"],[role="contentinfo"],[role="main"]'),
      resources:(()=>{try{return(performance.getEntriesByType?.('resource')||[]).length}catch{return 0}})(),
      interactiveCandidates:countIn('a,button,input,select,textarea,[role="button"],[tabindex]')
    };
  }
  function pageSummary(){
    const canonicalEl=document.querySelector('link[rel~="canonical"]'),descEl=document.querySelector('meta[name="description" i]'),robotsEl=document.querySelector('meta[name="robots" i]'),viewportEl=document.querySelector('meta[name="viewport" i]'),generatorEl=document.querySelector('meta[name="generator" i]'),h1s=[...document.querySelectorAll('h1')],schema=schemaState();
    let canonical='';try{canonical=canonicalEl?.href||''}catch{}
    const resourceHints=[...document.querySelectorAll('script[src],link[href],img[src]')].slice(0,80).map(el=>attr(el,'src')||attr(el,'href')).filter(Boolean);
    const formActions=[...document.forms].slice(0,8).map(form=>{try{return new URL(form.getAttribute('action')||location.href,location.href).href}catch{return''}}).filter(Boolean);
    const embedHosts=[...document.querySelectorAll('iframe[src]')].slice(0,8).map(el=>{try{return new URL(el.src,location.href).hostname}catch{return''}}).filter(Boolean);
    return{url:location.href,origin:location.origin,hostname:location.hostname,pathname:location.pathname,title:document.title||'',description:attr(descEl,'content'),canonical,robots:attr(robotsEl,'content'),lang:attr(document.documentElement,'lang'),viewport:attr(viewportEl,'content'),generator:attr(generatorEl,'content'),resourceHints,formActions,embedHosts,h1s:h1s.map(h=>clip(h.textContent,160)),schemaTypes:schema.types,schemaBlockCount:schema.blockCount,formCount:document.forms.length,imageCount:document.images.length,linkCount:document.links.length,interactiveCount:document.querySelectorAll('a,button,input,select,textarea,[role="button"],[tabindex]').length,embeddedCoverage:collectEmbeddedCoverage(),httpStatus:Number(globalThis.__WEBQA_HTTP_STATUS__)||null};
  }

  function run(){
    clearTargetMarkers();targetRegistry.clear();targetFingerprints.clear();
    lastEmbeddedInspection=null;lastFrameRecords=null;
    lastScanId=`scan_${Date.now().toString(36)}_${Math.random().toString(36).slice(2,8)}`;
    try{globalThis.__WEBQA_SCAN_PHASE__='initial-scan'}catch{}
    const runStarted=typeof performance!=='undefined'&&performance.now?performance.now():Date.now();
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
    for(const[id,els]of ids)if(els.length>1){
      let referencedBy='';
      try{
        if(document.querySelector(`label[for="${CSS.escape(id)}"]`))referencedBy='label[for]';
        else if(document.querySelector(`a[href="#${CSS.escape(id)}"]`))referencedBy='fragment link';
      }catch{}
      const refNote=referencedBy?` A ${referencedBy} points at this id, so the wrong element may receive the reference.`:'';
      findings.push(finding({ruleId:'web.duplicate-id',title:'Duplicate element ID',detail:`The id "${id}" appears ${els.length} times. Duplicate IDs can break labels, ARIA references, fragment links, and scripts.${refNote}`,category:'fix',severity:'medium',element:els[1],evidence:id,count:els.length}));
    }

    document.querySelectorAll('form[action]').forEach(form=>{const raw=attr(form,'action');if(!raw)return;try{const target=new URL(raw,location.href);if(location.protocol==='https:'&&target.protocol==='http:')findings.push(finding({ruleId:'security.insecure-form-action',title:'Secure page submits a form over HTTP',detail:'A form on this HTTPS page points to an insecure HTTP action.',category:'fix',severity:'critical',element:form,evidence:target.href}))}catch{}});
    document.querySelectorAll('a[target="_blank"]').forEach(a=>{const rel=attr(a,'rel').toLowerCase();if(!rel.includes('noopener')&&!rel.includes('noreferrer'))findings.push(finding({ruleId:'security.blank-opener',title:'New-tab link can retain opener access',detail:'A target=_blank link does not declare noopener or noreferrer.',category:'review',severity:'low',element:a,evidence:snippet(a)}))});

    const ogTitle=document.querySelector('meta[property="og:title"]'),ogDesc=document.querySelector('meta[property="og:description"]');
    if(!ogTitle||!ogDesc)findings.push(finding({ruleId:'social.og-incomplete',title:'Open Graph metadata is incomplete',confidence:'inferred',detail:'One or more core Open Graph title/description fields were not observed. Review sharing metadata if social previews matter for this page.',category:'context',severity:'info',targetType:'document',evidence:`og:title=${!!ogTitle}; og:description=${!!ogDesc}`}));

    findings.push(...mixedContentFindings());
    findings.push(...inertLinkFindings());
    findings.push(...formQualityFindings());
    findings.push(...hreflangFindings());
    findings.push(...robotsGooglebotFindings());
    findings.push(...overflowFindings());
    findings.push(...resourceFailureFindings());
    const brokenImageUrls=new Set(findings.filter(f=>f.ruleId==='web.image-broken').map(f=>f.extra?.resourceUrl||f.evidence||'').filter(Boolean));
    findings.push(...runtimeErrorFindings());
    findings.push(...visibleErrorFindings());
    findings.push(...pageDiagnosticRuntimeFindings());

    const tPerf=nowMs();
    const browserPerformance=performanceSignals();
    findings.push(...performanceFindings(browserPerformance));
    findings.push(...imageResourceFindings(browserPerformance,brokenImageUrls));
    const performanceMs=Math.round(nowMs()-tPerf);
    findings.push(...fragmentFindings());
    findings.push(...malformedLinkFindings());
    const tFrame=nowMs();
    findings.push(...embeddedFindings());
    const frameInspectionMs=Math.round(nowMs()-tFrame);
    page.embeddedCoverage=collectEmbeddedCoverage();
    page.inventory=pageInventory();
    const tIx=nowMs();
    findings.push(...interactionFindings());
    if(interactionsPrepared){
      findings.push(...(lastPreparedInteractionFindings||[]));
      interactionsPrepared=false;
    }else{
      findings.push(...safeInteractionFindings());
    }
    const interactionMs=Math.round(nowMs()-tIx);
    findings.push(...soft404Findings(page));
    findings.push(...schemaSemanticFindings(schemaState()));

    findings.sort((a,b)=>(CATEGORY_RANK[b.category]-CATEGORY_RANK[a.category])||(SEVERITY_RANK[b.severity]-SEVERITY_RANK[a.severity]));
    const pageDiagBound = Boolean(globalThis.__WEBQA_PAGE_DIAG_BOUND__ || globalThis.__WEBQA_PAGE_DIAGNOSTICS__ || globalThis.__WEBQA_RUNTIME_ERRORS__);
    const runtimeSource = globalThis.__WEBQA_RUNTIME_ERRORS__?.source;
    let runtimeStatus = 'not applicable';
    let coverageScope = {};
    if (runtimeSource === 'renderer') runtimeStatus = 'renderer';
    else if (pageDiagBound) {
      // Extension observation succeeded within its normal post-injection window.
      runtimeStatus = 'complete';
      coverageScope = { runtime: 'post-injection-extension' };
    }
    const coverageMeta={
      browser:'complete',links:'pending',axe:'pending',published:'pending',
      performance:browserPerformance.available?'current-page':'pending',wcag:'pending',ai:'pending',
      runtime:runtimeStatus
    };
    const failedResourceDiag=diagnosticFailedResources();
    const scanTimings={
      discoveryMs:Math.max(0,Math.round(nowMs()-runStarted)-performanceMs-frameInspectionMs-interactionMs),
      axeMs:0,
      linkProbeMs:0,
      frameInspectionMs,
      interactionMs,
      performanceMs,
      correlationMs:0,
      totalMs:Math.round(nowMs()-runStarted)
    };
    return{
      scannedAt:new Date().toISOString(),page,findings,browserPerformance,scanTimings,
      diagnostics:{
        failedResources:failedResourceDiag.items,
        resourceAnomalies:failedResourceDiag.items,
        observedResourceFailureEvents:failedResourceDiag.observedFailureEvents,
        observedResourceAnomalyEvents:failedResourceDiag.observedFailureEvents,
        deduplicatedFailedResources:failedResourceDiag.items.length,
        deduplicatedResourceAnomalies:failedResourceDiag.items.length,
        confirmedResourceFailures:failedResourceDiag.confirmedCount,
        inconclusiveResourceObservations:failedResourceDiag.inconclusiveCount
      },
      pageDiagnostics:{errors:(globalThis.__WEBQA_PAGE_DIAGNOSTICS__?.errors||globalThis.__WEBQA_RUNTIME_ERRORS__?.samples||[]).slice(0,20)},
      coverage:coverageMeta,
      coverageScope,
      interactionCoverage:lastInteractionCoverage,
      psi:{enabled:false,attempted:false,completed:false,unavailableReason:'deferred-native-lab-sufficient'}
    };
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
  let latestLcp=null,lcpObserver=null,latestCls=0,clsObserver=null;
  function initLcpObserver(){
    if(lcpObserver||typeof PerformanceObserver==='undefined')return;
    try{
      lcpObserver=new PerformanceObserver(list=>{const entries=list.getEntries?.()||[];if(entries.length)latestLcp=entries[entries.length-1]});
      lcpObserver.observe({type:'largest-contentful-paint',buffered:true});
    }catch{lcpObserver=null}
  }
  function initClsObserver(){
    if(clsObserver||typeof PerformanceObserver==='undefined')return;
    try{
      clsObserver=new PerformanceObserver(list=>{
        for(const entry of list.getEntries?.()||[]){
          if(entry?.hadRecentInput)continue;
          latestCls+=Number(entry.value)||0;
        }
      });
      clsObserver.observe({type:'layout-shift',buffered:true});
    }catch{clsObserver=null}
  }
  initLcpObserver();
  initClsObserver();
  async function preparePerformanceSignals(){
    initLcpObserver();
    initClsObserver();
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
            loadTime:Number.isFinite(Number(lcp.loadTime))?Math.round(lcp.loadTime):undefined,
            renderTime:Number.isFinite(Number(lcp.renderTime))?Math.round(lcp.renderTime):undefined,
            intrinsic:el.naturalWidth?{width:Number(el.naturalWidth)||0,height:Number(el.naturalHeight)||0}:null,
            rendered:{width:Math.round(rect.width||0),height:Math.round(rect.height||0)}
          };
        }catch{}
      }
      const knownResources=resources.filter(r=>(Number(r.transferSize)||0)>0);
      const imageEntries=resources.filter(r=>{
        const type=String(r.initiatorType||'');
        const name=String(r.name||'');
        return type==='img'||/\.(avif|webp|jpe?g|png|gif|svg)(\?|#|$)/i.test(name);
      }).slice(0,40);
      const imageTimings=imageEntries.map(r=>{
        const transferSize=Number(r.transferSize);
        const decodedBodySize=Number(r.decodedBodySize);
        const durationMs=Math.round(Number(r.duration)||0);
        const transferObservable=Number.isFinite(transferSize)&&transferSize>0;
        return{
          name:sanitizeResourceUrl(r.name),
          initiatorType:r.initiatorType||'img',
          durationMs,
          responseEnd:Math.round(Number(r.responseEnd)||0),
          transferSize:transferObservable?transferSize:undefined,
          transferSizeObservable:transferObservable,
          decodedBodySize:Number.isFinite(decodedBodySize)&&decodedBodySize>0?decodedBodySize:undefined,
          timingVisible:durationMs>0||Number(r.responseEnd)>0,
          sameOrigin:(()=>{try{return new URL(r.name,location.href).origin===location.origin}catch{return false}})()
        };
      });
      return{
        available:true,
        measurement:'lab',
        note:'Measured in the inspecting browser on this machine and network. Treat as a directional signal, not a field score.',
        ttfbMs:Math.round(nav.responseStart-nav.requestStart),
        domContentLoadedMs:(()=>{
          const end=Number(nav.domContentLoadedEventEnd);
          if(!Number.isFinite(end)||end<=0)return null;
          return Math.round(end-(Number(nav.startTime)||0));
        })(),
        pageLoadMs:(()=>{
          const end=Number(nav.loadEventEnd);
          if(!Number.isFinite(end)||end<=0)return null;
          return Math.round(end-(Number(nav.startTime)||0));
        })(),
        loadMs:(()=>{
          const end=Number(nav.loadEventEnd);
          if(!Number.isFinite(end)||end<=0)return null;
          return Math.round(end-(Number(nav.startTime)||0));
        })(),
        firstContentfulPaintMs:fcp?Math.round(fcp.startTime):null,
        largestContentfulPaintMs:lcp?Math.round(lcp.startTime):null,
        lcpElement,
        transferBytes,
        transferIsLowerBound:unknownTransferCount>0,
        measuredTransferCount,
        unknownTransferCount,
        resourceCount:resources.length,
        resourceMix:byType,
        cumulativeLayoutShift:Math.round(latestCls*1000)/1000,
        heaviest:knownResources.slice().sort((a,b)=>(Number(b.transferSize)||0)-(Number(a.transferSize)||0)).slice(0,5).map(r=>({name:sanitizeResourceUrl(r.name),type:r.initiatorType||'other',bytes:Number(r.transferSize)||0,durationMs:Math.round(r.duration||0)})),
        imageTimings
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
      out.push(finding({ruleId:'performance.browser.ttfb',title:'Server response was slow in this browser',confidence:'inferred',detail:`Time to first byte was ${signals.ttfbMs}ms in this lab navigation. That is a diagnostic observation about initial response timing, not proof of a backend defect or a full-page performance failure.`,category:'review',severity:'medium',targetType:'page',evidence:`ttfb=${signals.ttfbMs}ms`,extra:{performanceObservation:signals,scope:'network',domain:'performance'}}));
    if(Number.isFinite(signals.transferBytes)&&signals.transferBytes>6000000){
      const qualifier=signals.transferIsLowerBound?'At least ':'Approximately ';
      const coverage=signals.transferIsLowerBound?` ${signals.unknownTransferCount} transfer size${signals.unknownTransferCount===1?' was':'s were'} unavailable because cached or cross-origin resources may not expose transfer size.`:'';
      out.push(finding({ruleId:'performance.browser.weight',title:'Page transfers an unusually large measurable payload',confidence:'confirmed',detail:`${qualifier}${(signals.transferBytes/1048576).toFixed(1)}MB of measurable transfer was observed across the document and ${signals.resourceCount} resource requests.${coverage}`,category:'review',severity:'medium',targetType:'page',evidence:`known-transfer=${signals.transferBytes} bytes; measured=${signals.measuredTransferCount}; unknown=${signals.unknownTransferCount}`,extra:{performanceObservation:signals}}));
    }
    if(Number.isFinite(signals.cumulativeLayoutShift)&&signals.cumulativeLayoutShift>0.25){
      out.push(finding({ruleId:'performance.browser.cls',title:'Layout shift is high in this browser',confidence:'inferred',detail:`Cumulative layout shift was ${signals.cumulativeLayoutShift.toFixed(3)} in this lab observation. This is a current-page measurement in the inspecting browser, not a field Core Web Vitals score.`,category:'review',severity:'medium',targetType:'page',evidence:`cls=${signals.cumulativeLayoutShift}`,extra:{performanceObservation:signals}}));
    }
    return out;
  }

  function mixedContentFindings(){
    if(location.protocol!=='https:')return[];
    const groups=new Map();
    const collect=(el,attrName,active)=>{
      const raw=attr(el,attrName);if(!raw)return;
      let parsed;try{parsed=new URL(raw,location.href)}catch{return}
      if(parsed.protocol!=='http:')return;
      const url=sanitizeHttpUrl(parsed.href);if(!url)return;
      const key=`${active?'active':'passive'}|${url}`;
      if(!groups.has(key))groups.set(key,{url,active,attrName,els:[]});
      groups.get(key).els.push(el);
    };
    document.querySelectorAll('script[src]').forEach(el=>collect(el,'src',true));
    document.querySelectorAll('link[rel~="stylesheet"][href]').forEach(el=>collect(el,'href',true));
    document.querySelectorAll('iframe[src]').forEach(el=>collect(el,'src',true));
    document.querySelectorAll('img[src],audio[src],video[src],source[src]').forEach(el=>collect(el,'src',false));
    document.querySelectorAll('video[poster]').forEach(el=>collect(el,'poster',false));
    const out=[];
    for(const row of groups.values()){
      const first=row.els[0];
      const inHead=document.head?.contains(first);
      const tinyImg=!row.active&&first.tagName==='IMG'&&Number(first.width||first.getAttribute?.('width')||0)<=2&&Number(first.height||first.getAttribute?.('height')||0)<=2;
      out.push(finding({
        ruleId:row.active?'security.mixed-content':'security.mixed-content-passive',
        title:row.active?'HTTPS page requests an insecure active resource':'HTTPS page requests an insecure image or media resource',
        detail:row.active
          ?`Markup on this HTTPS page points ${first.tagName.toLowerCase()} at ${row.url}. Browsers typically block or restrict active mixed content.`
          :`Markup on this HTTPS page points ${first.tagName.toLowerCase()} at ${row.url}. This is mixed content in the markup; the browser may upgrade, block, or load it.`,
        category:'fix',
        severity:row.active?'high':(tinyImg?'low':'medium'),
        confidence:'confirmed',
        element:inHead?null:first,
        targetType:inHead||!first?'document':'visual',
        count:row.els.length,
        evidence:row.url,
        extra:{resourceUrl:row.url}
      }));
    }
    return out;
  }
  function inertLinkFindings(){
    const groups=new Map();
    for(const a of document.querySelectorAll('a[href]')){
      const raw=attr(a,'href');
      if(!isInertHref(raw))continue;
      const roles=attr(a,'role').toLowerCase().split(/\s+/).filter(Boolean);
      if(roles.some(r=>r==='button'||r==='menuitem'||r==='tab'))continue;
      const key=raw.trim()===''?'empty-href':'javascript-void';
      if(!groups.has(key))groups.set(key,[]);
      groups.get(key).push(a);
    }
    const out=[];
    for(const[kind,anchors]of groups){
      const first=pickVisibleAnchor(anchors);
      out.push(finding({
        ruleId:'ux.inert-link',
        title:kind==='empty-href'?'Link href does not declare a destination':'Link href does not declare a navigation destination',
        detail:kind==='empty-href'
          ? `${anchors.length===1?'A link uses':'Links use'} an empty href, so native navigation stays on the current document rather than an explicit destination. This scan did not verify click or keyboard handlers and does not treat the control as broken.`
          : `${anchors.length===1?'A link uses':'Links use'} a javascript:void href, so native link navigation will not occur. This scan did not verify click or keyboard handlers and does not treat the control as broken.`,
        category:'review',severity:'low',confidence:'inferred',element:first,count:anchors.length,
        evidence:kind,extra:{worthChecking:true}
      }));
    }
    return out;
  }
  function formHasSubmitter(form){
    if(form.querySelector('button,input[type="submit" i],input[type="image" i],input[type="button" i],input[type="reset" i]'))return true;
    const id=form.id;
    if(!id)return false;
    try{
      const sel=`button[form="${CSS.escape(id)}"],input[type="submit" i][form="${CSS.escape(id)}"],input[type="image" i][form="${CSS.escape(id)}"],input[type="button" i][form="${CSS.escape(id)}"],input[type="reset" i][form="${CSS.escape(id)}"]`;
      return !!document.querySelector(sel);
    }catch{return false}
  }
  function formQualityFindings(){
    const out=[];
    document.querySelectorAll('form form').forEach(inner=>{
      out.push(finding({
        ruleId:'web.nested-form',
        title:'A form is nested inside another form',
        detail:'The live DOM contains a form inside a form. Nested forms are invalid HTML and browsers may ignore the inner form or attach controls to the outer form.',
        category:'fix',severity:'medium',confidence:'confirmed',element:inner,evidence:'nested-form'
      }));
    });
    document.querySelectorAll('form').forEach(form=>{
      const actionRaw=attr(form,'action');
      if(!actionRaw)return;
      let action;try{action=new URL(actionRaw,location.href)}catch{return}
      if(!/^https?:$/.test(action.protocol))return;
      if(formHasSubmitter(form))return;
      const fields=[...form.querySelectorAll('input,select,textarea')].filter(el=>{
        const type=attr(el,'type').toLowerCase();
        return type!=='hidden'&&type!=='submit'&&type!=='button'&&type!=='image'&&type!=='reset';
      });
      if(fields.length<=1)return;
      out.push(finding({
        ruleId:'ux.form-no-submit',
        title:'HTML form has an action but no submit control',
        detail:`A form posts to ${sanitizeHttpUrl(action.href)||'an HTTP(S) action'} and has ${fields.length} visible fields, but no native submit control or button was observed. Scripted submit was not verified, so this is not treated as a confirmed broken form.`,
        category:'review',severity:'low',confidence:'inferred',targetType:'document',
        evidence:sanitizeHttpUrl(action.href),extra:{worthChecking:true,resourceUrl:sanitizeHttpUrl(action.href)}
      }));
    });
    document.querySelectorAll('input[type="hidden" i][required],input[type="hidden" i][aria-required="true" i]').forEach(input=>{
      const name=attr(input,'name').slice(0,80);
      out.push(finding({
        ruleId:'ux.hidden-required',
        title:'A hidden input is marked required',
        detail:`A type=hidden input${name?` named "${name}"`:''} is marked required. HTML constraint validation typically ignores required on type=hidden, so this is invalid or confusing markup rather than a confirmed submit blocker.`,
        category:'review',severity:'medium',confidence:'inferred',targetType:'document',
        evidence:name?`type=hidden; required; name=${name}`:'type=hidden; required'
      }));
    });
    document.querySelectorAll('form input, form select, form textarea').forEach(field=>{
      const type=attr(field,'type').toLowerCase();
      if(type==='hidden'||type==='submit'||type==='button'||type==='image'||type==='reset')return;
      const name=attr(field,'name');
      const labelled=field.id&&document.querySelector(`label[for="${CSS.escape(field.id)}"]`);
      const aria=attr(field,'aria-label')||attr(field,'aria-labelledby');
      const placeholder=attr(field,'placeholder');
      if(!labelled&&!aria&&placeholder){
        out.push(finding({
          ruleId:'ux.placeholder-only-label',
          title:'Form control relies on placeholder text alone',
          detail:'A visible form control uses placeholder text without an associated label or aria-label. Placeholders disappear on input and are weak accessible names.',
          category:'review',severity:'medium',confidence:'inferred',element:field,
          evidence:`placeholder=${clip(placeholder,80)}`,extra:{worthChecking:true}
        }));
      }
      if(!name&&field.closest('form[action]')){
        const rect=field.getBoundingClientRect?.();
        if(rect&&rect.width>0&&rect.height>0){
          out.push(finding({
            ruleId:'ux.form-control-missing-name',
            title:'Submittable control has no name attribute',
            detail:'A visible form control inside a form with an HTTP(S) action has no name attribute, so submitted data may omit this field.',
            category:'review',severity:'low',confidence:'inferred',element:field,
            evidence:`type=${type||field.localName}`,extra:{worthChecking:true}
          }));
        }
      }
    });
    document.querySelectorAll('input[autocomplete]').forEach(input=>{
      const type=attr(input,'type').toLowerCase()||'text';
      const auto=attr(input,'autocomplete').toLowerCase();
      const tokens=auto.split(/\s+/);
      const wantsEmail=tokens.includes('email');
      const wantsTel=tokens.some(t=>t==='tel'||t.startsWith('tel-'));
      if(!wantsEmail&&!wantsTel)return;
      if(wantsEmail&&type==='email')return;
      if(wantsTel&&type==='tel')return;
      if(type!=='text'&&type!=='search'&&type!=='')return;
      out.push(finding({
        ruleId:'ux.input-type-mismatch',
        title:wantsEmail?'Email autocomplete is on a non-email input':'Telephone autocomplete is on a non-tel input',
        detail:wantsEmail
          ?`An input declares autocomplete="email" but uses type="${type||'text'}". Use type="email" so browsers can offer email validation and the matching keyboard.`
          :`An input declares telephone autocomplete but uses type="${type||'text'}". Use type="tel" so browsers can offer a telephone keyboard.`,
        category:'review',severity:'low',confidence:'inferred',element:input,
        evidence:`type=${type||'text'}; autocomplete=${auto}`,extra:{worthChecking:true}
      }));
    });
    return out;
  }
  function hreflangFindings(){
    const out=[],seen=new Set();
    for(const link of document.querySelectorAll('link[rel~="alternate"][hreflang]')){
      const lang=attr(link,'hreflang');
      const href=attr(link,'href');
      if(lang.toLowerCase()!=='x-default'){
        try{new Intl.Locale(lang)}catch{
          const key=`lang:${lang}`;if(seen.has(key))continue;seen.add(key);
          out.push(finding({ruleId:'seo.hreflang-invalid',title:'hreflang language tag is invalid',detail:`An alternate link uses hreflang="${clip(lang,80)}", which is not a valid BCP 47 language tag or x-default.`,category:'fix',severity:'medium',confidence:'confirmed',element:link,targetType:'document',evidence:`lang=${clip(lang,80)}`}));
          continue;
        }
      }
      if(!href){
        const key='empty';if(seen.has(key))continue;seen.add(key);
        out.push(finding({ruleId:'seo.hreflang-invalid',title:'hreflang href is empty',detail:'An alternate hreflang link has no href, so the language annotation cannot identify a URL.',category:'fix',severity:'medium',confidence:'confirmed',element:link,targetType:'document',evidence:'empty-href'}));
        continue;
      }
      try{
        const u=new URL(href,location.href);
        if(!/^https?:$/.test(u.protocol)){
          const key=`scheme:${u.protocol}`;if(seen.has(key))continue;seen.add(key);
          out.push(finding({ruleId:'seo.hreflang-invalid',title:'hreflang URL uses an unsupported scheme',detail:`hreflang "${lang}" points to a non-HTTP URL. Alternate URLs should resolve to HTTP or HTTPS.`,category:'fix',severity:'medium',confidence:'confirmed',element:link,targetType:'document',evidence:`scheme=${u.protocol||'unsupported'}`}));
        }
      }catch{
        const key=`parse:${href}`;if(seen.has(key))continue;seen.add(key);
        out.push(finding({ruleId:'seo.hreflang-invalid',title:'hreflang URL is invalid',detail:`hreflang "${clip(lang,80)}" href could not be parsed as a URL.`,category:'fix',severity:'medium',confidence:'confirmed',element:link,targetType:'document',evidence:'unparseable-href'}));
      }
    }
    const targets=new Map();
    for(const link of document.querySelectorAll('link[rel~="alternate"][hreflang][href]')){
      let resolved='';try{resolved=new URL(attr(link,'href'),location.href).href.split('#')[0]}catch{continue}
      const list=targets.get(resolved)||[];list.push(link);targets.set(resolved,list);
    }
    for(const[resolved,links]of targets){
      if(links.length<2)continue;
      const langs=[...new Set(links.map(l=>attr(l,'hreflang').toLowerCase()).filter(l=>l&&l!=='x-default'))];
      if(langs.length<2)continue;
      out.push(finding({
        ruleId:'seo.hreflang-duplicate-target',
        title:'Multiple hreflang tags point to the same URL',
        detail:`Alternate hreflang links reuse ${sanitizeHttpUrl(resolved)||'the same URL'} for more than one language tag. Search engines expect distinct URLs per language variant.`,
        category:'review',severity:'medium',confidence:'inferred',element:links[1],targetType:'document',
        evidence:`target=${sanitizeHttpUrl(resolved)||resolved}; langs=${langs.slice(0,4).join(',')}`,extra:{worthChecking:true}
      }));
    }
    return out;
  }
  function robotsGooglebotFindings(){
    const robotsEl=document.querySelector('meta[name="robots" i]');
    const googleEl=document.querySelector('meta[name="googlebot" i]');
    if(!robotsEl||!googleEl)return[];
    const robots=robotsIndexState(attr(robotsEl,'content'));
    const google=robotsIndexState(attr(googleEl,'content'));
    if(!robots||!google||robots===google)return[];
    return[finding({
      ruleId:'seo.robots-googlebot-conflict',
      title:'robots and googlebot indexing directives disagree',
      detail:`Meta robots is "${robots}" while googlebot is "${google}". That can be an intentional Google-only override, so confirm the indexing intent before changing it.`,
      category:'review',severity:'low',confidence:'inferred',element:googleEl,targetType:'document',
      evidence:`robots=${attr(robotsEl,'content')}; googlebot=${attr(googleEl,'content')}`,extra:{worthChecking:true}
    })];
  }
  function overflowFindings(){
    const viewportWidth=Number(globalThis.innerWidth||0);
    if(viewportWidth<200)return[];
    const root=document.scrollingElement||document.documentElement;
    const scrollWidth=Math.max(Number(root?.scrollWidth)||0,Number(document.documentElement?.scrollWidth)||0,Number(document.body?.scrollWidth)||0);
    const overflowPx=Math.round(scrollWidth-viewportWidth);
    if(overflowPx<16)return[];
    return[finding({
      ruleId:'web.horizontal-overflow',
      title:'Page content overflows the scanned viewport',
      detail:`At the scanned viewport width of ${viewportWidth}px, document scroll width is ${scrollWidth}px (${overflowPx}px of horizontal overflow). This is an observation at the current width, not proof of a mobile-only defect.`,
      category:'review',severity:'low',confidence:'inferred',targetType:'page',
      evidence:`viewport=${viewportWidth}; scrollWidth=${scrollWidth}; overflow=${overflowPx}`,
      extra:{worthChecking:true,overflowMetrics:{viewportWidth,scrollWidth,overflowPx}}
    })];
  }
  function classifyResourceRole(url,initiator=''){
    const path=(()=>{try{return new URL(url).pathname||''}catch{return String(url||'')}})();
    const init=String(initiator||'');
    if(init==='script'||/\.m?js$/i.test(path))return'script';
    if(/\.css$/i.test(path))return'stylesheet';
    if(init==='font'||/\.(woff2?|ttf|otf|eot)$/i.test(path))return'font';
    if(init==='img'||/\.(png|jpe?g|gif|webp|avif|svg)$/i.test(path))return'image';
    if(init==='css'||init==='link'){
      try{
        const cleaned=sanitizeHttpUrl(url);
        if(cleaned&&[...document.querySelectorAll('link[rel~="stylesheet"]')].some(node=>sanitizeHttpUrl(attr(node,'href'))===cleaned))return'stylesheet';
      }catch{}
      return'';
    }
    return'';
  }
  function registrableDomain(hostname){
    const host=String(hostname||'').toLowerCase().replace(/\.$/, '');
    const parts=host.split('.').filter(Boolean);
    if(parts.length<=1)return host||'';
    // Bounded multi-part public suffixes (not a full PSL). Prefer under-calling ownership.
    const MULTI=[
      'co.uk','org.uk','ac.uk','gov.uk','co.jp','com.au','net.au','org.au','co.nz','com.br','com.mx','co.in','com.sg','com.hk','co.kr','com.tr','com.ar','co.za'
    ];
    const last2=parts.slice(-2).join('.');
    const last3=parts.length>=3?parts.slice(-3).join('.'):'';
    if(MULTI.includes(last2)&&parts.length>=3)return parts.slice(-3).join('.');
    if(MULTI.includes(last3)&&parts.length>=4)return parts.slice(-4).join('.');
    return last2;
  }
  function classifyResourceParty(url){
    let parsed;try{parsed=new URL(url,location.href)}catch{return{party:'unknown',originClass:'unknown',ownership:'unknown',noise:true}}
    const host=parsed.hostname.toLowerCase();
    const path=parsed.pathname.toLowerCase();
    const sameOrigin=parsed.origin===location.origin;
    const pageReg=registrableDomain(location.hostname);
    const hostReg=registrableDomain(host);
    // Consent / CMP infrastructure — diagnostic-only unless visibly user-blocking (handled elsewhere).
    const consent=/\b(onetrust|cookielaw|cookiebot|trustarc|evidon|quantcast\.|sp-prod\.net|sourcepoint|didomi|usercentrics|ketchcdn|osano)\b/i.test(host)
      ||/\/(consent|cookie-consent|cmp|otBanner|otSDKStub)\b/i.test(path);
    if(consent)return{party:'third-party',originClass:'third-party-background',ownership:'third-party-background',noise:true,roleHint:'consent'};
    const tracking=/\b(google-analytics|googletagmanager|gtag|doubleclick|facebook\.net|connect\.facebook|hotjar|segment\.|mixpanel|amplitude|newrelic|nr-data|sentry\.io|clarity\.ms|adservice|adsystem|scorecardresearch|quantserve|taboola|outbrain|criteo|adsrvr|adnxs|rubiconproject|pubmatic|openx|moatads|amazon-adsystem)\b/i.test(host)
      ||/\/(collect|pixel|beacon|analytics|gtm\.js|fbevents)\b/i.test(path)
      ||/\.(gif|png)$/i.test(path)&&/\/(pixel|track|beacon|collect)\b/i.test(path);
    if(tracking)return{party:'third-party',originClass:'third-party-background',ownership:'third-party-background',noise:true,roleHint:'analytics'};
    const ads=/\b(\/ads?\/|\/adserver|googlesyndication|pagead|doubleclick|adservice)\b/i.test(`${host}${path}`);
    if(ads)return{party:'third-party',originClass:'third-party-background',ownership:'third-party-background',noise:true,roleHint:'ads'};
    const mediaSdk=/\b(jwplayer|brightcove|theoplayer|bitmovin|mux\.com|akamaihd\.net\/i\/|hls\.js)\b/i.test(host+path);
    if(mediaSdk)return{party:'third-party',originClass:'third-party-visible',ownership:'third-party-visible',noise:false,roleHint:'media'};
    const loginSocial=/\b(accounts\.google|login\.microsoftonline|appleid\.apple|auth0\.com|okta\.com|oauth|sso\.)\b/i.test(host)
      ||/\/(oauth|authorize|signin|login)\b/i.test(path)&&!sameOrigin;
    if(loginSocial)return{party:'third-party',originClass:'third-party-visible',ownership:'third-party-visible',noise:false,roleHint:'auth'};
    const infraVisible=/\b(fonts\.googleapis|fonts\.gstatic|ajax\.googleapis|cdn\.jsdelivr|unpkg\.com|cdnjs\.cloudflare)\b/i.test(host);
    if(infraVisible)return{party:'third-party',originClass:'third-party-visible',ownership:'third-party-visible',noise:false,roleHint:'infrastructure'};
    const embed=/youtube\.com|youtube-nocookie\.com|youtu\.be|player\.vimeo\.com|vimeo\.com|maps\.google|google\.com\/maps|openstreetmap|js\.stripe\.com|checkout\.stripe|calendly\.com|typeform\.com|formstack|hubspot|intercom\.io|drift\.com|zendesk|twitter\.com|platform\.twitter|instagram\.com|tiktok\.com|linkedin\.com/i.test(host)
      ||(!sameOrigin&&/\/embed\//i.test(path));
    if(embed)return{party:'third-party',originClass:'third-party-visible',ownership:'third-party-visible',noise:false,roleHint:'embed'};
    if(sameOrigin)return{party:'first-party',originClass:'same-origin',ownership:'same-origin',noise:false};
    // Probable first-party: asset-style host on the same registrable domain (conservative).
    // Sibling hosts without CDN/asset markers are NOT promoted to confirmed first-party.
    const relatedDomain=pageReg&&hostReg&&pageReg===hostReg&&host!==location.hostname.toLowerCase();
    const assetSub=/^(cdn|static|assets|media|img|images|fonts|files|content|res|resource)[-.]/i.test(host)
      ||/\.(cdn|static|assets|media)\./i.test(host)
      ||/cdn|static|assets|media|img|fonts/i.test(host);
    const MULTI_TENANT=['github.io','herokuapp.com','netlify.app','vercel.app','pages.dev','azurewebsites.net','cloudfront.net'];
    if(MULTI_TENANT.includes(pageReg)||MULTI_TENANT.includes(hostReg)){
      return{party:'unknown',originClass:'related-host',ownership:'related-host',noise:false};
    }
    if(relatedDomain&&assetSub){
      return{party:'first-party',originClass:'probable-first-party',ownership:'probable-first-party',noise:false};
    }
    if(relatedDomain){
      return{party:'unknown',originClass:'related-host',ownership:'related-host',noise:false};
    }
    // Generic public CDN hosts without site relationship stay unknown/third-party — do not claim first-party.
    if(/\b(cloudfront\.net|akamaized\.net|fastly\.net|azureedge\.net|stackpathcdn)\b/i.test(host)){
      return{party:'unknown',originClass:'unknown',ownership:'unknown',noise:false,roleHint:'cdn'};
    }
    return{party:'third-party',originClass:'third-party-visible',ownership:'third-party-visible',noise:false};
  }
  function visibleDependencyFor(url,kind){
    if(!url||!kind)return false;
    try{
      if(kind==='script')return[...document.querySelectorAll('script[src]')].some(n=>sanitizeHttpUrl(attr(n,'src'))===url);
      if(kind==='stylesheet')return[...document.querySelectorAll('link[rel~="stylesheet"]')].some(n=>sanitizeHttpUrl(attr(n,'href'))===url);
      if(kind==='font')return[...document.querySelectorAll('link[rel="preload"][as="font"],link[href*=".woff"],style')].length>0;
      if(kind==='image')return[...document.querySelectorAll('img[src],img[srcset]')].some(n=>sanitizeHttpUrl(attr(n,'src'))===url||String(attr(n,'srcset')).includes(new URL(url).pathname));
    }catch{}
    return false;
  }
  function resourceFailureFindings(){
    const out=[];
    let resources=[];
    try{resources=performance.getEntriesByType('resource')||[]}catch{return out}
    const failed=new Map();
    let crossOriginEmitted=0;
    const pageDiagErrors=globalThis.__WEBQA_PAGE_DIAGNOSTICS__?.errors||[];
    for(const entry of resources){
      const rawStatus=entry.responseStatus;
      const status=Number(rawStatus);
      const opaque=!Number.isFinite(status)||status===0;
      const httpFail=Number.isFinite(status)&&status>=400;
      if(!opaque&&!httpFail)continue;
      let parsed;try{parsed=new URL(entry.name)}catch{continue}
      const url=sanitizeHttpUrl(entry.name);if(!url)continue;
      const kind=classifyResourceRole(entry.name,entry.initiatorType);
      if(!kind)continue;
      const party=classifyResourceParty(entry.name);
      if(!failed.has(url))failed.set(url,{url,kind,status:opaque?0:status,opaque,sameOrigin:parsed.origin===location.origin,party});
    }
    // Supplement with page-diagnostic resource failures that lack Performance status.
    for(const row of pageDiagErrors){
      if(String(row?.kind||'')!=='resource_failure'&&String(row?.type||'')!=='error')continue;
      const url=sanitizeHttpUrl(row.source||row.url||'');
      if(!url||failed.has(url))continue;
      let parsed=null;try{parsed=new URL(url)}catch{continue}
      const kind=classifyResourceRole(url,row.initiator||row.role||'')||'';
      if(!kind)continue;
      const party=classifyResourceParty(url);
      failed.set(url,{url,kind,status:Number(row.status)||0,opaque:!Number(row.status),sameOrigin:parsed.origin===location.origin,party,fromPageDiag:true});
    }
    for(const row of failed.values()){
      const visible=visibleDependencyFor(row.url,row.kind);
      const isEmbed=row.party.roleHint==='embed'||row.party.originClass==='third-party-visible'&&row.kind==='iframe';
      const ownership=row.party.ownership||row.party.originClass;
      if(row.opaque){
        // Opaque/missing status: never auto-confirm HTTP failure. Need visible page impact.
        if(row.party.noise)continue;
        if(row.kind==='image'&&visible){
          // Broken image is handled by imageResourceFindings; keep diagnostic-only here.
          continue;
        }
        if(!visible)continue;
        if(crossOriginEmitted>=4)continue;
        out.push(finding({
          ruleId:'runtime.resource-status-inconclusive',
          title:'Resource failure status could not be confirmed',
          detail:`A ${row.kind} resource (${row.url}) showed an opaque or missing response status. Browser APIs did not expose a reliable HTTP status, so this is not treated as a confirmed HTTP failure.`,
          category:'review',severity:'low',confidence:'inferred',targetType:'document',
          evidence:`opaque-status; ${row.url}; ownership=${ownership}`,
          extra:{
            worthChecking:true,resourceUrl:row.url,originClass:ownership,party:row.party.party,
            resourceRole:row.kind,visibleDependency:visible,resourceDisposition:'inconclusive',failureClass:'inconclusive'
          }
        }));
        crossOriginEmitted++;
        continue;
      }
      if(row.sameOrigin||ownership==='probable-first-party'){
        const selector=row.kind==='script'?'script[src]':row.kind==='stylesheet'?'link[rel~="stylesheet"]':row.kind==='font'?'link[rel="preload"][as="font"],link[href*=".woff"]':row.kind==='image'?'img[src]':null;
        let el=null;
        if(selector){
          try{
            el=[...document.querySelectorAll(selector)].find(node=>{
              const attrName=row.kind==='script'||row.kind==='image'?'src':'href';
              const nodeUrl=sanitizeHttpUrl(attr(node,attrName)||attr(node,'src'));
              return nodeUrl===row.url;
            })||null;
          }catch{}
        }
        const inHead=el&&document.head?.contains(el);
        const ruleId=row.kind==='script'?'runtime.script-failed':row.kind==='stylesheet'?'web.stylesheet-failed':row.kind==='font'?'runtime.font-failed':row.kind==='image'?'web.image-broken':'runtime.resource-failed';
        const title=row.kind==='script'?'Script failed to load':row.kind==='stylesheet'?'Stylesheet failed to load':row.kind==='font'?'Font failed to load':row.kind==='image'?'Image resource failed to load':'Resource failed to load';
        const ownershipNote=ownership==='probable-first-party'?' (probable first-party CDN/asset host)':'';
        out.push(finding({
          ruleId,title,
          detail:`A ${ownership==='same-origin'||row.sameOrigin?'same-origin':'probable first-party'} ${row.kind} request for ${row.url} completed with HTTP ${row.status}${ownershipNote}. Restore the asset or remove the unused reference.`,
          category:'fix',severity:row.kind==='font'?'medium':'high',confidence:'confirmed',
          element:inHead?null:el,targetType:inHead||!el?'document':'visual',
          evidence:`http-${row.status} ${row.url}`,
          extra:{resourceUrl:row.url,originClass:ownership,party:row.party.party,resourceRole:row.kind,visibleDependency:true,resourceDisposition:'confirmed',failureClass:'confirmed-failure'}
        }));
        continue;
      }
      // Related host without asset markers: Worth Checking only (do not confirm as first-party).
      if(ownership==='related-host'){
        if(row.party.noise||crossOriginEmitted>=4||!visible)continue;
        out.push(finding({
          ruleId:'runtime.resource-failed-cross-origin',
          title:'Related-host resource failed to load',
          detail:`A resource on a related host (${row.url}) completed with HTTP ${row.status}. The host shares a registrable domain with this page but is not classified as a first-party asset CDN, so impact is Worth Checking rather than a confirmed first-party defect.`,
          category:'review',severity:'low',confidence:'inferred',targetType:'document',
          evidence:`http-${row.status} ${row.url}; origin=related-host`,
          extra:{
            worthChecking:true,resourceUrl:row.url,originClass:ownership,party:row.party.party,
            resourceRole:row.kind,visibleDependency:visible,resourceDisposition:'worthChecking',failureClass:'probable-failure'
          }
        }));
        crossOriginEmitted++;
        continue;
      }
      // Cross-origin / third-party: diagnostics always; findings only for non-noise with known role and visible dependency (or embed).
      if(row.party.noise)continue;
      if(crossOriginEmitted>=4)continue;
      if(!visible&&!(row.party.roleHint==='embed'))continue;
      const ruleId=row.party.roleHint==='embed'?'ux.embed-resource-failed':'runtime.resource-failed-cross-origin';
      out.push(finding({
        ruleId,
        title:row.party.roleHint==='embed'?'Embedded third-party resource failed to load':'Cross-origin resource failed to load',
        detail:row.party.roleHint==='embed'
          ?`A third-party embed-related ${row.kind} request for ${row.url} completed with HTTP ${row.status}. Impact depends on whether the visible embed depends on this asset; treat as Worth Checking rather than a confirmed page defect.`
          :`A cross-origin ${row.kind} request for ${row.url} completed with HTTP ${row.status}. This may affect page features when the asset is required, but cross-origin failures are often blocked by privacy tools or expected CDN conditions. Confirm impact before treating it as a defect.`,
        category:'review',severity:'low',confidence:'inferred',targetType:'document',
        evidence:`http-${row.status} ${row.url}; origin=${ownership}`,
        extra:{
          worthChecking:true,resourceUrl:row.url,originClass:ownership,party:row.party.party,
          resourceRole:row.kind,visibleDependency:visible,resourceDisposition:'worthChecking',failureClass:'probable-failure'
        }
      }));
      crossOriginEmitted++;
    }
    return out;
  }
  function diagnosticFailedResources(){
    const items=[];
    const seen=new Set();
    let observedFailureEvents=0;
    let confirmedCount=0;
    let inconclusiveCount=0;
    let resources=[];
    try{resources=performance.getEntriesByType('resource')||[]}catch{return{items,observedFailureEvents:0,confirmedCount:0,inconclusiveCount:0}}
    for(const entry of resources){
      const status=Number(entry.responseStatus);
      const opaque=!Number.isFinite(status)||status===0;
      if(!opaque&&status<400)continue;
      observedFailureEvents++;
      const url=sanitizeHttpUrl(entry.name);if(!url)continue;
      let parsed=null;try{parsed=new URL(entry.name)}catch{}
      const party=classifyResourceParty(entry.name);
      const kind=classifyResourceRole(entry.name,entry.initiatorType)||String(entry.initiatorType||'other').slice(0,40);
      const ownership=party.ownership||party.originClass;
      const key=`${url}|${opaque?0:status}|${kind}`;
      if(seen.has(key))continue;
      seen.add(key);
      if(items.length>=25)continue;
      let disposition='worthChecking';
      let failureClass='probable-failure';
      if(opaque){disposition='inconclusive';failureClass='inconclusive'}
      else if(party.noise){disposition='diagnosticOnly';failureClass='diagnostic'}
      else if(parsed&&(parsed.origin===location.origin||ownership==='probable-first-party')){disposition='confirmed';failureClass='confirmed-failure'}
      if(disposition==='confirmed')confirmedCount++;
      else if(disposition==='inconclusive')inconclusiveCount++;
      // Keep failedResources export name for compatibility; kind reflects evidence strength.
      const evidenceKind=disposition==='confirmed'?'resource_failure':'resource_anomaly';
      items.push({
        kind:evidenceKind,initiator:kind,status:opaque?0:status,source:url,
        sameOrigin:parsed?parsed.origin===location.origin:false,
        originClass:ownership,party:party.party,noise:Boolean(party.noise),
        disposition,failureClass,opaque:opaque||undefined,
        roleHint:party.roleHint||undefined,
        evidenceClass:disposition==='confirmed'?'confirmed-failure':'observation'
      });
    }
    return{items,observedFailureEvents,confirmedCount,inconclusiveCount};
  }
  function visibleErrorFindings(){
    const ERROR_TEXT=/\b(error|invalid|failed|failure|exception|unable to|something went wrong|an error occurred|request failed)\b/i;
    const SEMANTIC=/(^|[\s_-])(error|invalid|failed|failure|exception|alert|toast|banner|notification|status)([\s_-]|$)/i;
    const out=[];
    const seen=new Set();
    const candidates=[];
    const pushCandidate=(el,signals)=>{
      if(!el||el.nodeType!==1||seen.has(el))return;
      if(el.closest?.('[data-web-qa-ui],[data-webqa-ui],[data-web-qa-highlight],[data-webqa-overlay]'))return;
      seen.add(el);
      candidates.push({el,signals});
    };
    try{
      document.querySelectorAll('[role="alert"], [aria-live="assertive"], [aria-live="polite"]').forEach(el=>{
        pushCandidate(el,['aria-live-or-alert']);
      });
      document.querySelectorAll('[class*="error" i], [class*="toast" i], [class*="alert" i], [id*="error" i], [class*="invalid" i], [class*="failure" i]').forEach(el=>{
        pushCandidate(el,['semantic-class']);
      });
      document.querySelectorAll('[aria-invalid="true"]').forEach(el=>{
        const described=(()=>{
          const ids=String(el.getAttribute('aria-describedby')||'').split(/\s+/).filter(Boolean);
          for(const id of ids){
            try{const node=document.getElementById(id);if(node)return node}catch{}
          }
          return el.closest?.('.error,.invalid,[class*="error" i],[class*="invalid" i]')||null;
        })();
        if(described)pushCandidate(described,['aria-invalid-related']);
      });
    }catch{}
    for(const {el,signals} of candidates.slice(0,40)){
      let visible=false;
      let fixed=false;
      try{
        const style=getComputedStyle(el);
        if(style.display==='none'||style.visibility==='hidden'||Number(style.opacity)===0)continue;
        const rect=el.getBoundingClientRect();
        if(rect.width<8||rect.height<8)continue;
        if(rect.bottom<0||rect.top>innerHeight||rect.right<0||rect.left>innerWidth)continue;
        visible=true;
        fixed=/fixed|sticky/i.test(style.position);
      }catch{continue}
      const text=clip(String(el.textContent||'').replace(/\s+/g,' ').trim(),180);
      if(!text||text.length<4)continue;
      // Ignore long article/body copy: require short notification-like text.
      if(text.length>220)continue;
      if(/^(h1|h2|h3|article|main|section)$/i.test(el.localName||'')&&!signals.includes('aria-live-or-alert'))continue;
      const role=String(el.getAttribute?.('role')||'').toLowerCase();
      const live=String(el.getAttribute?.('aria-live')||'').toLowerCase();
      const classId=`${el.className||''} ${el.id||''}`;
      const semanticHit=SEMANTIC.test(classId)||SEMANTIC.test(role);
      const textHit=ERROR_TEXT.test(text);
      const signalSet=new Set(signals);
      if(role==='alert'||live==='assertive')signalSet.add('aria-live-or-alert');
      if(fixed)signalSet.add('fixed-or-sticky');
      if(semanticHit)signalSet.add('semantic-class');
      if(textHit)signalSet.add('error-like-text');
      if(signalSet.has('aria-invalid-related'))signalSet.add('form-validation');
      // Require corroboration: text alone is never enough.
      const strength=[...signalSet];
      const confirmed=
        (signalSet.has('aria-live-or-alert')&&visible&&textHit)
        ||(signalSet.has('fixed-or-sticky')&&signalSet.has('semantic-class')&&textHit)
        ||(signalSet.has('form-validation')&&textHit&&visible)
        ||(signalSet.has('semantic-class')&&signalSet.has('error-like-text')&&(role==='status'||role==='alert'||fixed));
      if(!confirmed)continue;
      const party=(()=>{
        try{
          const src=el.closest?.('[src],[data-src]')?.getAttribute?.('src')||'';
          if(src){
            const u=new URL(src,location.href);
            if(u.origin!==location.origin)return{originClass:'third-party',host:u.hostname};
          }
        }catch{}
        if(/\b(cookie|chat|intercom|zendesk|hubspot|grecaptcha|stripe)\b/i.test(classId))return{originClass:'third-party-probable',host:''};
        return{originClass:'page',host:location.hostname};
      })();
      const firstObservedPhase=globalThis.__WEBQA_SCAN_PHASE__||'during-scan';
      out.push(finding({
        ruleId:'runtime.visible-error',
        title:'Visible error message detected',
        detail:`The page is displaying an error message to users: "${text}". This was visible during the scan and should be reviewed before launch.${party.originClass.startsWith('third-party')?' The message appears associated with a third-party widget.':''}`,
        category:'fix',
        severity:'high',
        confidence:'confirmed',
        element:el,
        evidence:`visible-error; text=${text}; signals=${strength.join(',')}`,
        extra:{
          scope:'element',
          domain:'runtime',
          visibleError:{
            messageExcerpt:text,
            visibility:'visible',
            role:role||live||'',
            classId:clip(classId,120),
            positioning:fixed?'fixed-or-sticky':'static-or-relative',
            originClass:party.originClass,
            firstObservedPhase,
            signals:strength.slice(0,8)
          }
        }
      }));
      if(out.length>=5)break;
    }
    return out;
  }
  function runtimeErrorFindings(){
    const bucket=globalThis.__WEBQA_RUNTIME_ERRORS__;
    const count=Math.max(0,Math.min(20,Number(bucket?.count||0)));
    if(!count)return[];
    return[finding({
      ruleId:'runtime.uncaught-error',
      title:'Uncaught script error observed during this session',
      detail:`${count} uncaught script error${count===1?' was':'s were'} observed during this renderer session. The error text is untrusted runtime output and is not treated as instructions. This scan does not identify the throwing statement or claim a specific feature is broken.`,
      category:'review',severity:'low',confidence:'inferred',targetType:'page',
      evidence:`uncaught-error; count=${count}`,extra:{worthChecking:true,runtimeErrorCount:count}
    })];
  }

  function isSkipLinkAnchor(a){
    if(!a||a.localName!=='a')return false;
    const raw=attr(a,'href');
    if(!raw||!raw.startsWith('#'))return false;
    const cls=String(a.className||'');
    if(/\bskip-link\b/i.test(cls))return true;
    return/\bskip[- ]?link\b/i.test(cls)||/\bskip\b/i.test(cls);
  }
  function effectiveDevicePixelRatio(){
    try{
      const dpr=Number(globalThis.devicePixelRatio||window.devicePixelRatio||1);
      if(!Number.isFinite(dpr)||dpr<=0)return 1;
      return Math.min(4,Math.max(1,dpr));
    }catch{return 1}
  }
  function transferBytesForUrl(url){
    if(!url)return undefined;
    try{
      const resources=performance.getEntriesByType('resource')||[];
      for(const entry of resources){
        if(sanitizeHttpUrl(entry.name)!==url&&sanitizeResourceUrl(entry.name)!==url)continue;
        const bytes=Number(entry.transferSize);
        if(Number.isFinite(bytes)&&bytes>0)return bytes;
      }
    }catch{}
    return undefined;
  }
  function assessImageDelivery(img,{lcpUrl=''}={}){
    if(!img||img.nodeType!==1)return null;
    if(String(img.localName||'').toLowerCase()==='svg')return null;
    if(!img.complete)return null;
    const nw=Number(img.naturalWidth)||0,nh=Number(img.naturalHeight)||0;
    const rect=img.getBoundingClientRect?.()||{width:0,height:0};
    const rw=Math.round(rect.width||img.clientWidth||0);
    const rh=Math.round(rect.height||img.clientHeight||0);
    if(nw<2||nh<2||rw<40||rh<40)return null;
    const selectedSource=sanitizeResourceUrl(img.currentSrc||img.src||'');
    const httpSrc=sanitizeHttpUrl(img.currentSrc||img.src||'')||selectedSource;
    if(!selectedSource||selectedSource.startsWith('data:'))return null;
    if(/\.svg(\?|#|$)/i.test(selectedSource))return null;
    const dpr=effectiveDevicePixelRatio();
    const requiredPhysicalWidth=Math.max(1,Math.round(rw*dpr));
    const requiredPhysicalHeight=Math.max(1,Math.round(rh*dpr));
    const widthOversizeRatio=nw/requiredPhysicalWidth;
    const heightOversizeRatio=nh/requiredPhysicalHeight;
    const pixelAreaOversizeRatio=(nw*nh)/(requiredPhysicalWidth*requiredPhysicalHeight);
    // Conservative floors: both axes must overshoot, or area must be clearly excessive.
    let magnitude='appropriate';
    if((widthOversizeRatio>=3&&heightOversizeRatio>=3)||pixelAreaOversizeRatio>=9)magnitude='severe';
    else if((widthOversizeRatio>=2&&heightOversizeRatio>=2)||pixelAreaOversizeRatio>=4)magnitude='meaningful';
    else if((widthOversizeRatio>=1.4&&heightOversizeRatio>=1.4)||pixelAreaOversizeRatio>=2)magnitude='mild';
    else return null;
    const srcset=attr(img,'srcset');
    const sizes=attr(img,'sizes');
    const inPicture=Boolean(img.closest?.('picture'));
    const responsiveSourcePresent=Boolean(srcset||inPicture);
    const transferBytes=transferBytesForUrl(httpSrc)||transferBytesForUrl(selectedSource);
    const isLcpResource=Boolean(lcpUrl&&(lcpUrl===httpSrc||lcpUrl===selectedSource||sanitizeResourceUrl(lcpUrl)===selectedSource));
    return{
      intrinsicWidth:nw,
      intrinsicHeight:nh,
      renderedWidth:rw,
      renderedHeight:rh,
      devicePixelRatio:Math.round(dpr*100)/100,
      requiredPhysicalWidth,
      requiredPhysicalHeight,
      widthOversizeRatio:Math.round(widthOversizeRatio*100)/100,
      heightOversizeRatio:Math.round(heightOversizeRatio*100)/100,
      pixelAreaOversizeRatio:Math.round(pixelAreaOversizeRatio*100)/100,
      transferBytes:Number.isFinite(transferBytes)?transferBytes:undefined,
      responsiveSourcePresent,
      srcsetPresent:Boolean(srcset),
      sizesPresent:Boolean(sizes),
      pictureElement:inPicture,
      inPicture,
      currentSrc:selectedSource,
      src:sanitizeResourceUrl(img.getAttribute?.('src')||img.src||''),
      selectedSource,
      isLcpResource,
      magnitude,
      observationConfidence:'confirmed',
      impactConfidence:(isLcpResource||Number.isFinite(transferBytes))?'inferred':'inferred'
    };
  }
  function imageDeliveryDetail(m){
    const need=`~${m.requiredPhysicalWidth}×${m.requiredPhysicalHeight} needed at ${m.devicePixelRatio}× DPR`;
    const shown=`${m.intrinsicWidth}×${m.intrinsicHeight} source · displayed ${m.renderedWidth}×${m.renderedHeight} · ${need}`;
    const transfer=Number.isFinite(m.transferBytes)?` · ${(m.transferBytes/1024).toFixed(0)} KB transfer`:'';
    const responsive=m.responsiveSourcePresent
      ?' Responsive markup is present; the currently selected candidate is still larger than the DPR-adjusted display need.'
      :' No srcset/picture candidate set was observed for this image.';
    const lcp=m.isLcpResource?' This is also the current LCP image.':'';
    return`${shown}${transfer}.${responsive}${lcp}`;
  }
  function imageResourceFindings(signals,skipBrokenUrls=new Set()){
    const out=[];
    const lcpUrl=sanitizeResourceUrl(signals?.lcpElement?.url||'');
    // Broken / unloaded images where the browser completed decode with zero natural size.
    [...document.images].slice(0,80).forEach(img=>{
      if(!img.complete)return;
      const src=sanitizeResourceUrl(img.currentSrc||img.src||'');
      const httpSrc=sanitizeHttpUrl(img.currentSrc||img.src||'')||src;
      if(!src||src.startsWith('data:'))return;
      if(skipBrokenUrls.has(src)||skipBrokenUrls.has(httpSrc))return;
      if(Number(img.naturalWidth)===0&&Number(img.naturalHeight)===0){
        out.push(finding({ruleId:'web.image-broken',title:'Image failed to load',detail:'An image element completed loading with naturalWidth 0, which usually means the resource is missing or undecodable.',category:'fix',severity:'medium',element:img,evidence:src,extra:{resourceUrl:src}}));
      }
    });
    const oversized=[];
    const images=[];
    const pushImages=(root)=>{
      try{images.push(...(root.images||root.querySelectorAll?.('img')||[]))}catch{}
    };
    pushImages(document);
    for(const rec of (lastFrameRecords||collectFrameRecords())){
      if(rec.accessible&&rec.doc)pushImages(rec.doc);
    }
    [...images].slice(0,80).forEach(img=>{
      const assessment=assessImageDelivery(img,{lcpUrl});
      if(!assessment)return;
      const src=assessment.selectedSource;
      const httpSrc=sanitizeHttpUrl(src)||src;
      if(skipBrokenUrls.has(src)||skipBrokenUrls.has(httpSrc))return;
      oversized.push({img,assessment});
    });
    for(const {img,assessment:m} of oversized){
      if(m.magnitude==='mild'){
        out.push(finding({
          ruleId:'performance.browser.image-oversized',
          title:'Image source is mildly larger than display need',
          detail:imageDeliveryDetail(m),
          category:'review',severity:'low',confidence:'confirmed',element:img,
          evidence:`intrinsic=${m.intrinsicWidth}x${m.intrinsicHeight}; rendered=${m.renderedWidth}x${m.renderedHeight}; dpr=${m.devicePixelRatio}; need=${m.requiredPhysicalWidth}x${m.requiredPhysicalHeight}; magnitude=mild`,
          extra:{
            worthChecking:true,frankVisible:false,resourceUrl:m.selectedSource,
            imageMetrics:m,fixOwner:'frontend/content/CMS',
            rootCauseKey:'images-oversized-mild'
          }
        }));
        continue;
      }
      if(m.isLcpResource){
        const lcpMs=Number(signals?.largestContentfulPaintMs);
        const slow=Number.isFinite(lcpMs)&&lcpMs>4000;
        out.push(finding({
          ruleId:'performance.browser.lcp-image-oversized',
          title:slow?'LCP image is substantially oversized for its display':'Current LCP image is substantially oversized',
          detail:`${imageDeliveryDetail(m)}${slow?` Lab LCP was ${(lcpMs/1000).toFixed(1)}s.`:''}`,
          category:'review',severity:m.magnitude==='severe'||slow?'high':'medium',confidence:'confirmed',
          element:img,selector:selectorFor(img),
          evidence:`lcp=${Number.isFinite(lcpMs)?lcpMs:'observed'}; intrinsic=${m.intrinsicWidth}x${m.intrinsicHeight}; rendered=${m.renderedWidth}x${m.renderedHeight}; dpr=${m.devicePixelRatio}; need=${m.requiredPhysicalWidth}x${m.requiredPhysicalHeight}; magnitude=${m.magnitude}`,
          extra:{
            worthChecking:false,resourceUrl:m.selectedSource,imageMetrics:m,
            performanceObservation:signals||undefined,
            fixOwner:'frontend/template/CMS',
            rootCauseKey:m.selectedSource?`lcp-resource:${hash(m.selectedSource)}`:'lcp-resource:unknown'
          }
        }));
        continue;
      }
      out.push(finding({
        ruleId:'performance.browser.image-oversized',
        title:m.magnitude==='severe'?'Image is severely oversized for its display size':'Image is substantially oversized for its display size',
        detail:imageDeliveryDetail(m),
        category:'review',severity:m.magnitude==='severe'?'high':'medium',confidence:'confirmed',element:img,
        evidence:`intrinsic=${m.intrinsicWidth}x${m.intrinsicHeight}; rendered=${m.renderedWidth}x${m.renderedHeight}; dpr=${m.devicePixelRatio}; need=${m.requiredPhysicalWidth}x${m.requiredPhysicalHeight}; magnitude=${m.magnitude}`,
        extra:{
          resourceUrl:m.selectedSource,imageMetrics:m,fixOwner:'frontend/content/CMS',
          rootCauseKey:'images-oversized'
        }
      }));
    }
    return out;
  }

  function resolveFragmentTarget(id){
    if(!id)return false;
    try{
      if(document.getElementById(id))return true;
      if(document.querySelector(`[name="${CSS.escape(id)}"]`))return true;
    }catch{}
    for(const root of shadowRoots()){
      try{
        if(root.getElementById?.(id))return true;
        if(root.querySelector(`[name="${CSS.escape(id)}"]`))return true;
      }catch{}
    }
    for(const frame of document.querySelectorAll('iframe')){
      try{
        const doc=frame.contentDocument;
        if(!doc)continue;
        if(doc.getElementById(id)||doc.querySelector(`[name="${CSS.escape(id)}"]`))return true;
      }catch{}
    }
    return false;
  }
  let lastEmbeddedInspection=null;
  function collectEmbeddedCoverage(){
    const records=lastFrameRecords||collectFrameRecords();
    const accessible=records.filter(r=>r.accessible);
    const sameOriginEligible=records.filter(r=>r.sameOrigin).length;
    const crossOrigin=records.filter(r=>!r.sameOrigin).length;
    const sameOriginChecked=lastEmbeddedInspection
      ? Number(lastEmbeddedInspection.checked||0)
      : 0;
    const sameOriginUnprobed=Math.max(0,sameOriginEligible-sameOriginChecked);
    const frameBudgetReached=sameOriginEligible>SAME_ORIGIN_IFRAME_HARD_CEILING||lastEmbeddedInspection?.deadlineStopped===true;
    const frameBudgetPreventedCoverage=sameOriginUnprobed>0;
    const openShadowRoots=shadowRoots().length;
    return{
      iframeCount:records.length,
      framesDiscovered:records.length,
      sameOriginIframes:sameOriginEligible,
      accessibleSameOriginIframes:accessible.length,
      sameOriginEligible,
      sameOriginAttempted:sameOriginChecked,
      sameOriginFramesChecked:sameOriginChecked,
      sameOriginUnprobed,
      crossOriginIframes:crossOrigin,
      crossOriginFramesNotInspectable:crossOrigin,
      frameBudgetReached,
      frameBudgetExceeded:frameBudgetPreventedCoverage,
      frameBudgetPreventedCoverage,
      accountingOk:sameOriginEligible===sameOriginChecked+sameOriginUnprobed,
      openShadowRoots,
      closedShadowRoots:'not observable',
      fragmentTargets:'top-document, open shadow roots, and same-origin iframe documents when accessible',
      maxDepth:SAME_ORIGIN_IFRAME_MAX_DEPTH,
      hardCeiling:SAME_ORIGIN_IFRAME_HARD_CEILING
    };
  }
  function pageDiagnosticRuntimeFindings(){
    const out=[];
    const diag=globalThis.__WEBQA_PAGE_DIAGNOSTICS__?.errors||[];
    const renderer=globalThis.__WEBQA_RUNTIME_ERRORS__;
    const pageErrors=diag.filter(e=>e.kind==='page_error');
    const rejections=diag.filter(e=>e.kind==='unhandled_rejection');
    const errorCount=Math.max(Number(renderer?.count||0),pageErrors.length);
    if(errorCount&&!renderer?.count){
      globalThis.__WEBQA_RUNTIME_ERRORS__={count:errorCount,samples:pageErrors.slice(0,20).map(e=>({kind:'page_error',message:e.message,source:e.source,line:e.line})),source:'extension'};
      out.push(...runtimeErrorFindings());
    }
    if(rejections.length){
      const dedup=new Set();
      for(const row of rejections){
        const key=clip(row.message,120);
        if(dedup.has(key))continue;
        dedup.add(key);
        out.push(finding({
          ruleId:'runtime.unhandled-rejection',
          title:'Unhandled promise rejection observed',
          detail:'An unhandled promise rejection was captured during this session. The message is untrusted runtime output and is not treated as instructions. Verify whether a script failed to catch an async error.',
          category:'review',severity:'low',confidence:'inferred',targetType:'page',
          evidence:`unhandled-rejection; message=${key}`,extra:{worthChecking:true}
        }));
        if(out.length>=5)break;
      }
    }
    return out;
  }
  function soft404Findings(page){
    const status=Number(page.httpStatus);
    if(Number.isFinite(status)&&status!==200)return[];
    const title=String(page.title||document.title||'').toLowerCase();
    const h1=String((page.h1s&&page.h1s[0])||document.querySelector('h1')?.textContent||'').toLowerCase();
    const bodyText=clip(document.body?.innerText||'',1200).toLowerCase();
    const notFoundRx=/\b(404|not found|page not found|page cannot be found|doesn't exist|does not exist|no longer available)\b/i;
    let lexical=0;
    if(notFoundRx.test(title))lexical++;
    if(notFoundRx.test(h1))lexical++;
    if(notFoundRx.test(bodyText.slice(0,400)))lexical++;
    if(lexical<1)return[];
    let signals=lexical;
    const words=(bodyText.match(/\S+/g)||[]).length;
    if(words>0&&words<80)signals++;
    if(Number(page.linkCount||document.links.length)<4)signals++;
    if(Number(page.interactiveCount||0)<3)signals++;
    const required=Number.isFinite(status)&&status===200?3:4;
    if(signals<required)return[];
    return[finding({
      ruleId:'seo.soft-404-probable',
      title:'Page content resembles a not-found response',
      detail:`The document appears to load successfully${Number.isFinite(status)?` (HTTP ${status})`:''}, but ${signals} independent signals suggest an error or empty-shell page (title/H1/body wording, sparse content, or very few links). This is a probable soft 404, not a confirmed HTTP 404. Verify with server logs, the intended URL, and whether the route should return a real 404 status.`,
      category:'review',severity:'medium',confidence:'inferred',targetType:'document',
      evidence:`soft-404-signals=${signals}; title=${clip(page.title||'',80)}`,extra:{worthChecking:true,soft404Signals:signals}
    })];
  }
  function formFindingsInDocument(doc,{frame=null,budget=4}={}){
    const out=[];
    if(!doc)return out;
    const push=(row)=>{if(out.length<budget)out.push(row)};
    try{
      doc.querySelectorAll('form form').forEach(inner=>{
        push(finding({
          ruleId:'web.nested-form',
          title:'A form is nested inside another form',
          detail:frame
            ?'Inside an embedded same-origin document, a form is nested inside another form. Nested forms are invalid HTML.'
            :'The live DOM contains a form inside a form. Nested forms are invalid HTML and browsers may ignore the inner form or attach controls to the outer form.',
          category:'fix',severity:'medium',confidence:'confirmed',element:inner,evidence:'nested-form'
        }));
      });
      doc.querySelectorAll('form').forEach(form=>{
        const actionRaw=attr(form,'action');
        if(!actionRaw)return;
        let action;try{action=new URL(actionRaw,doc.defaultView?.location?.href||location.href)}catch{return}
        if(!/^https?:$/.test(action.protocol))return;
        if(formHasSubmitter(form))return;
        const fields=[...form.querySelectorAll('input,select,textarea')].filter(el=>{
          const type=attr(el,'type').toLowerCase();
          return type!=='hidden'&&type!=='submit'&&type!=='button'&&type!=='image'&&type!=='reset';
        });
        if(fields.length<=1)return;
        push(finding({
          ruleId:'ux.form-no-submit',
          title:'HTML form has an action but no submit control',
          detail:frame
            ?`Inside an embedded same-origin document, a form posts to ${sanitizeHttpUrl(action.href)||'an HTTP(S) action'} with ${fields.length} visible fields and no native submit control.`
            :`A form posts to ${sanitizeHttpUrl(action.href)||'an HTTP(S) action'} and has ${fields.length} visible fields, but no native submit control or button was observed. Scripted submit was not verified, so this is not treated as a confirmed broken form.`,
          category:'review',severity:'low',confidence:'inferred',targetType:'document',
          evidence:sanitizeHttpUrl(action.href),
          extra:{worthChecking:true,resourceUrl:sanitizeHttpUrl(action.href),...(frame?{embeddedContext:'same-origin-iframe',frameSelector:selectorFor(frame),spotlightSafe:false}:{})}
        }));
      });
      doc.querySelectorAll('input[type="hidden" i][required],input[type="hidden" i][aria-required="true" i]').forEach(input=>{
        const name=attr(input,'name').slice(0,80);
        push(finding({
          ruleId:'ux.hidden-required',
          title:'A hidden input is marked required',
          detail:`A type=hidden input${name?` named "${name}"`:''}${frame?' inside an embedded same-origin document':''} is marked required.`,
          category:'review',severity:'medium',confidence:'inferred',targetType:'document',
          evidence:name?`type=hidden; required; name=${name}`:'type=hidden; required',
          extra:frame?{embeddedContext:'same-origin-iframe',frameSelector:selectorFor(frame),spotlightSafe:false}:{}
        }));
      });
      doc.querySelectorAll('form input, form select, form textarea').forEach(field=>{
        const type=attr(field,'type').toLowerCase();
        if(type==='hidden'||type==='submit'||type==='button'||type==='image'||type==='reset')return;
        const name=attr(field,'name');
        const labelled=field.id&&doc.querySelector(`label[for="${CSS.escape(field.id)}"]`);
        const aria=attr(field,'aria-label')||attr(field,'aria-labelledby');
        const placeholder=attr(field,'placeholder');
        if(!labelled&&!aria&&placeholder){
          push(finding({
            ruleId:'ux.placeholder-only-label',
            title:'Form control relies on placeholder text alone',
            detail:frame
              ?'Inside an embedded same-origin document, a form control uses placeholder text without an associated label or aria-label.'
              :'A visible form control uses placeholder text without an associated label or aria-label. Placeholders disappear on input and are weak accessible names.',
            category:'review',severity:'medium',confidence:'inferred',element:field,
            evidence:`placeholder=${clip(placeholder,80)}`,extra:{worthChecking:true}
          }));
        }
        if(!name&&field.closest('form[action]')){
          const rect=field.getBoundingClientRect?.();
          if(rect&&rect.width>0&&rect.height>0){
            push(finding({
              ruleId:'ux.form-control-missing-name',
              title:'Submittable control has no name attribute',
              detail:frame
                ?'Inside an embedded same-origin document, a visible form control inside a form with an action has no name attribute.'
                :'A visible form control inside a form with an HTTP(S) action has no name attribute, so submitted data may omit this field.',
              category:'review',severity:'low',confidence:'inferred',element:field,
              evidence:`type=${type||field.localName}`,extra:{worthChecking:true}
            }));
          }
        }
      });
    }catch{}
    return out;
  }
  function frameExtras(frame,frameSel){
    return{embeddedContext:'same-origin-iframe',frameSelector:frameSel,spotlightSafe:false};
  }
  function inspectSameOriginFrameDocument(doc,frame){
    const out=[];
    if(!doc||!frame)return out;
    const frameSel=selectorFor(frame);
    const extra=frameExtras(frame,frameSel);
    const lang=attr(doc.documentElement,'lang');
    if(!lang){
      out.push(finding({
        ruleId:'a11y.lang-missing',
        title:'Embedded document language is missing',
        detail:'Inside an embedded same-origin document, the root html element has no lang attribute.',
        category:'fix',severity:'medium',confidence:'confirmed',element:doc.documentElement,targetType:'document',
        evidence:'iframe-html-lang-missing',wcag:['3.1.1'],extra
      }));
    }else{
      try{new Intl.Locale(lang)}catch{
        out.push(finding({
          ruleId:'a11y.lang-invalid',
          title:'Embedded document language is not a valid language tag',
          detail:`Inside an embedded same-origin document, html lang="${clip(lang,40)}" is not a valid BCP 47 language tag.`,
          category:'fix',severity:'medium',confidence:'confirmed',element:doc.documentElement,targetType:'document',
          evidence:lang,wcag:['3.1.1'],extra
        }));
      }
    }
    if(!text(doc.title)){
      out.push(finding({
        ruleId:'web.iframe-title-missing',
        title:'Embedded document has no title',
        detail:'Inside an embedded same-origin document, the document title is empty. This affects assistive technology context for the framed experience.',
        category:'review',severity:'low',confidence:'inferred',targetType:'document',
        evidence:'iframe-document-title-empty',extra:{worthChecking:true,...extra}
      }));
    }
    out.push(...formFindingsInDocument(doc,{frame,budget:8}));
    const headings=[...doc.querySelectorAll('h1,h2,h3,h4,h5,h6')];
    const h1s=headings.filter(h=>h.tagName==='H1');
    if(!h1s.length){
      out.push(finding({
        ruleId:'structure.h1-missing',
        title:'Embedded document has no H1 heading',
        confidence:'inferred',
        detail:'Inside an embedded same-origin document, no H1 heading was observed.',
        category:'review',severity:'low',targetType:'document',extra:{worthChecking:true,...extra}
      }));
    }
    const broken=[...doc.querySelectorAll('img[src]')].filter(img=>img.complete&&Number(img.naturalWidth)===0&&Number(img.naturalHeight)===0).slice(0,8);
    for(const img of broken){
      out.push(finding({
        ruleId:'web.image-broken',
        title:'Image failed to load inside same-origin iframe',
        detail:'Inside an embedded same-origin document, an image completed loading with naturalWidth 0.',
        category:'fix',severity:'medium',confidence:'confirmed',element:img,targetType:'document',
        evidence:sanitizeResourceUrl(img.currentSrc||img.src||''),
        extra:{resourceUrl:sanitizeResourceUrl(img.currentSrc||img.src||''),...extra}
      }));
    }
    for(const a of doc.querySelectorAll('a[target="_blank"]')){
      const rel=attr(a,'rel').toLowerCase();
      if(!rel.includes('noopener')&&!rel.includes('noreferrer')){
        out.push(finding({
          ruleId:'security.blank-opener',
          title:'New-tab link can retain opener access',
          detail:'Inside an embedded same-origin document, a target=_blank link does not declare noopener or noreferrer.',
          category:'review',severity:'low',element:a,evidence:snippet(a),extra
        }));
      }
    }
    for(const btn of doc.querySelectorAll('button[aria-expanded], [role="button"][aria-expanded]')){
      const expanded=attr(btn,'aria-expanded');
      const panelId=attr(btn,'aria-controls');
      if(!panelId||expanded!=='false')continue;
      let present=false;
      try{present=!!(doc.getElementById(panelId)||doc.querySelector(`[name="${CSS.escape(panelId)}"]`))}catch{}
      if(present)continue;
      out.push(finding({
        ruleId:'ux.disclosure-target-missing',
        title:'Collapsed control points at a missing panel',
        detail:'Inside an embedded same-origin document, a disclosure control is collapsed but its aria-controls target was not found.',
        category:'review',severity:'medium',confidence:'inferred',element:btn,targetType:'document',
        evidence:`aria-controls=${panelId}`,extra:{worthChecking:true,...extra}
      }));
    }
    return out;
  }
  function embeddedFindings(){
    const out=[];
    const records=collectFrameRecords();
    let framesInspected=0;
    const started=typeof performance!=='undefined'&&performance.now?performance.now():Date.now();
    const deadline=started+15000;
    for(const rec of records){
      const frame=rec.frame;
      const src=rec.src||attr(frame,'src');
      const srcdoc=rec.srcdoc||attr(frame,'srcdoc');
      let parsed=null;
      if(src){try{parsed=new URL(src,location.href)}catch{parsed=null}}
      const title=attr(frame,'title');
      const meaningful=srcdoc||(parsed&&(parsed.pathname.length>1||parsed.search));
      if(meaningful&&!title.trim()&&Number(frame.clientWidth||0)>=120&&Number(frame.clientHeight||0)>=80){
        const party=src?classifyResourceParty(src):{originClass:'same-origin',party:'first-party'};
        out.push(finding({
          ruleId:'ux.iframe-missing-title',
          title:'Embedded frame has no title',
          detail:'A visible iframe lacks a title attribute. Accessible names help screen-reader users understand embedded content.',
          category:'review',severity:'low',confidence:'inferred',element:frame,
          evidence:sanitizeHttpUrl(parsed?.href)||src||'srcdoc',
          extra:{worthChecking:true,originClass:party.originClass,party:party.party,embedRole:party.roleHint||'iframe'}
        }));
      }
      if(!rec.accessible||!rec.doc)continue;
      const now=typeof performance!=='undefined'&&performance.now?performance.now():Date.now();
      if(framesInspected>=SAME_ORIGIN_IFRAME_HARD_CEILING||now>deadline)continue;
      framesInspected++;
      out.push(...inspectSameOriginFrameDocument(rec.doc,frame));
    }
    const now=typeof performance!=='undefined'&&performance.now?performance.now():Date.now();
    lastEmbeddedInspection={
      checked:framesInspected,
      eligible:records.filter(r=>r.sameOrigin).length,
      deadlineStopped:now>deadline&&records.filter(r=>r.sameOrigin).length>framesInspected
    };
    return out;
  }
  const UNSAFE_INTERACTION_RE=/\b(buy|purchase|checkout|pay|payment|delete|remove|logout|log[\s-]?out|sign[\s-]?out|sign[\s-]?in|signin|log[\s-]?in|login|auth|authenticate|unsubscribe|submit|send|contact|apply|book|reserve|download|install|share|tweet|post|add[\s-]?to[\s-]?cart|place[\s-]?order|donate|subscribe|register|create[\s-]?account|upload|confirm|accept|password|billing|credit[\s-]?card)\b/i;
  function interactionNow(){
    if(typeof globalThis.__WEBQA_NOW__==='function')try{return Number(globalThis.__WEBQA_NOW__())||0}catch{}
    try{return performance.now()}catch{return Date.now()}
  }
  async function interactionSleep(ms){
    if(typeof globalThis.__WEBQA_INTERACTION_TICK__==='function'){
      try{await globalThis.__WEBQA_INTERACTION_TICK__(ms);return}catch{}
    }
    await new Promise(r=>setTimeout(r,ms));
  }
  function settleDurationBucket(ms){
    const n=Math.max(0,Number(ms)||0);
    if(n<=0)return'immediate';
    if(n<=16)return'0-16ms';
    if(n<=50)return'17-50ms';
    if(n<=120)return'51-120ms';
    return'>120ms';
  }
  function hasHighRiskInteractionSemantics(el){
    const label=`${attr(el,'aria-label')} ${clip(el.textContent,80)} ${String(el.className||'')} ${attr(el,'id')} ${attr(el,'name')} ${attr(el,'data-action')}`.toLowerCase();
    return UNSAFE_INTERACTION_RE.test(label);
  }
  function isUnsafeInteractionTarget(el){
    if(!el||el.nodeType!==1)return true;
    if(el.closest?.('form'))return true;
    try{if(el.form)return true}catch{}
    if(attr(el,'form'))return true;
    if(attr(el,'formaction'))return true;
    if(el.matches?.('a[href]:not([href^="#"]),a[download],input,select,textarea,button[type="submit"],button[type="image"],button[type="reset"],input[type="submit"],input[type="image"],input[type="reset"]'))return true;
    if(/^(submit|image|reset)$/i.test(attr(el,'type')))return true;
    if(hasHighRiskInteractionSemantics(el))return true;
    return false;
  }
  function isKnownSafeDisclosureControl(el,doc){
    if(!el||el.nodeType!==1)return false;
    const tag=el.localName;
    const role=attr(el,'role');
    if(tag!=='button'&&role!=='button')return false;
    if(attr(el,'type').toLowerCase()==='submit')return false;
    if(el.closest?.('form'))return false;
    if(isUnsafeInteractionTarget(el))return false;
    const expanded=attr(el,'aria-expanded');
    if(expanded!=='true'&&expanded!=='false')return false;
    const panelId=attr(el,'aria-controls').split(/\s+/).filter(Boolean)[0];
    if(!panelId)return false;
    const root=doc||document;
    try{
      if(!(root.getElementById(panelId)||root.querySelector(`[name="${CSS.escape(panelId)}"]`)))return false;
    }catch{return false}
    return true;
  }
  function isKnownSafeTabControl(el,doc){
    if(!el||el.nodeType!==1)return false;
    if(attr(el,'role')!=='tab')return false;
    if(el.closest?.('form')||isUnsafeInteractionTarget(el))return false;
    if(hasHighRiskInteractionSemantics(el))return false;
    const panelId=attr(el,'aria-controls').split(/\s+/).filter(Boolean)[0];
    if(!panelId)return false;
    const root=doc||document;
    let panel=null;
    try{panel=root.getElementById(panelId)}catch{return false}
    if(!panel)return false;
    const panelRole=attr(panel,'role');
    if(panelRole&&panelRole!=='tabpanel')return false;
    return true;
  }
  function isKnownSafeMenuControl(el,doc){
    if(!el||el.nodeType!==1)return false;
    const tag=el.localName;
    const role=attr(el,'role');
    if(tag!=='button'&&role!=='button')return false;
    if(el.closest?.('form')||isUnsafeInteractionTarget(el)||hasHighRiskInteractionSemantics(el))return false;
    if(attr(el,'type').toLowerCase()==='submit')return false;
    const expanded=attr(el,'aria-expanded');
    if(expanded!=='true'&&expanded!=='false')return false;
    const menuId=attr(el,'aria-controls').split(/\s+/).filter(Boolean)[0];
    if(!menuId)return false;
    const root=doc||document;
    let menu=null;
    try{menu=root.getElementById(menuId)}catch{return false}
    if(!menu)return false;
    const menuRole=attr(menu,'role');
    if(menuRole!=='menu'&&menuRole!=='listbox')return false;
    // Must not contain navigational links that leave the document.
    try{
      if(menu.querySelector('a[href]:not([href^="#"]),form,button[type="submit"]'))return false;
    }catch{}
    return true;
  }
  function isMenuToggleCandidate(el,doc){
    if(!el||el.nodeType!==1)return false;
    const menuId=attr(el,'aria-controls').split(/\s+/).filter(Boolean)[0];
    if(!menuId)return false;
    const root=doc||document;
    let menu=null;
    try{menu=root.getElementById(menuId)}catch{return false}
    if(!menu)return false;
    const menuRole=attr(menu,'role');
    return menuRole==='menu'||menuRole==='listbox';
  }
  function isKnownSafeSkipLink(el,doc){
    if(!isSkipLinkAnchor(el))return false;
    if(isUnsafeInteractionTarget(el))return false;
    const raw=attr(el,'href');
    if(!raw||!raw.startsWith('#')||raw==='#')return false;
    let id='';try{id=decodeURIComponent(raw.slice(1))}catch{id=raw.slice(1)}
    if(!id)return false;
    const root=doc||document;
    try{return !!(root.getElementById(id)||root.querySelector(`[name="${CSS.escape(id)}"]`))}catch{return false}
  }
  function panelVisibility(doc,panelId){
    if(!doc||!panelId)return{found:false,visible:false,hiddenAttr:false,display:'',visibility:''};
    let el=null;
    try{el=doc.getElementById(panelId)||doc.querySelector(`[name="${CSS.escape(panelId)}"]`)}catch{return{found:false,visible:false,hiddenAttr:false,display:'',visibility:''}}
    if(!el)return{found:false,visible:false,hiddenAttr:false,display:'',visibility:''};
    try{
      const view=doc.defaultView||window;
      const style=view?.getComputedStyle?.(el)||getComputedStyle(el);
      const rect=el.getBoundingClientRect?.()||{width:0,height:0};
      const hiddenAttr=attr(el,'hidden')!=='';
      const hidden=style.display==='none'||style.visibility==='hidden'||(style.opacity!==''&&Number(style.opacity)===0)||hiddenAttr||attr(el,'aria-hidden')==='true';
      return{
        found:true,
        visible:!hidden&&(rect.width>0||rect.height>0||attr(el,'aria-hidden')!=='true'),
        hiddenAttr,
        display:String(style.display||''),
        visibility:String(style.visibility||'')
      };
    }catch{return{found:true,visible:true,hiddenAttr:false,display:'',visibility:''}}
  }
  function captureFocus(doc){
    try{
      const ae=doc?.activeElement;
      if(!ae||ae===doc.body||ae===doc.documentElement)return{selector:'',tag:''};
      return{selector:selectorFor(ae),tag:ae.localName||''};
    }catch{return{selector:'',tag:''}}
  }
  async function settleUntil(predicate,{maxMs=INTERACTION_SETTLE_MAX_MS,stepMs=INTERACTION_SETTLE_STEP_MS}={}){
    const start=interactionNow();
    if(predicate())return{settled:true,durationMs:0,immediate:true};
    await Promise.resolve();
    await Promise.resolve();
    if(predicate())return{settled:true,durationMs:Math.max(0,interactionNow()-start),immediate:false};
    // Prefer injectable tick over rAF so deterministic tests cannot deadlock on fake clocks.
    if(typeof globalThis.__WEBQA_INTERACTION_TICK__==='function'){
      await interactionSleep(Math.min(stepMs,16));
    }else if(typeof requestAnimationFrame==='function'){
      await new Promise(r=>{try{requestAnimationFrame(()=>r())}catch{r()}});
    }else{
      await interactionSleep(Math.min(stepMs,16));
    }
    if(predicate())return{settled:true,durationMs:Math.max(0,interactionNow()-start),immediate:false};
    while(interactionNow()-start<maxMs){
      await interactionSleep(stepMs);
      if(predicate())return{settled:true,durationMs:Math.max(0,interactionNow()-start),immediate:false};
    }
    return{settled:false,durationMs:Math.max(0,interactionNow()-start),immediate:false};
  }
  function restorePanelState(doc,panelId,before){
    let panel=null;
    try{panel=doc.getElementById(panelId)||doc.querySelector(`[name="${CSS.escape(panelId)}"]`)}catch{return false}
    if(!panel||!before)return false;
    try{
      if(before.visible===false){
        panel.setAttribute('hidden','');
        if(attr(panel,'aria-hidden')==='false')panel.setAttribute('aria-hidden','true');
      }else{
        panel.removeAttribute('hidden');
        if(attr(panel,'aria-hidden')==='true')panel.removeAttribute('aria-hidden');
      }
      return true;
    }catch{return false}
  }
  function activateElement(el){
    try{
      if(typeof el.click==='function')el.click();
      else el.dispatchEvent(new MouseEvent('click',{bubbles:true,cancelable:true,view:el.ownerDocument?.defaultView||window}));
      return true;
    }catch{
      return false;
    }
  }
  async function verifyDisclosureInDocument(btn,{doc,frameSelector='',embeddedContext='',budgetRef}={}){
    const panelId=attr(btn,'aria-controls').split(/\s+/).filter(Boolean)[0];
    const initialExpanded=attr(btn,'aria-expanded');
    const before=panelVisibility(doc,panelId);
    const focusBefore=captureFocus(doc);
    const expectedExpanded=initialExpanded==='false'?'true':'false';
    const observation={
      interactionType:'disclosure-toggle',
      context:embeddedContext||'top-document',
      frameSelector:frameSelector||undefined,
      initialState:{ariaExpanded:initialExpanded,panelVisible:before.visible,focus:focusBefore.selector||undefined},
      expectedState:{ariaExpanded:expectedExpanded},
      observedState:{},
      outcome:'inconclusive',
      settled:false,
      settleDurationBucket:'immediate',
      restored:false,
      failureReason:'',
      confidence:'inferred'
    };
    if(initialExpanded!=='false'&&initialExpanded!=='true'){
      observation.outcome='not-applicable';
      observation.failureReason='invalid-aria-expanded';
      return{finding:null,observation,stopFurther:false};
    }
    if(budgetRef&&budgetRef.remainingMs<=0){
      observation.outcome='inconclusive';
      observation.failureReason='interaction-time-budget';
      return{finding:null,observation,stopFurther:false};
    }
    const clickOk=activateElement(btn);
    const expectChange=()=>{
      const expanded=attr(btn,'aria-expanded');
      const after=panelVisibility(doc,panelId);
      return expanded===expectedExpanded
        ||(initialExpanded==='false'&&after.visible&&!before.visible)
        ||(initialExpanded==='true'&&!after.visible&&before.visible);
    };
    let settle;
    try{
      settle=await settleUntil(expectChange);
    }catch{
      observation.outcome='inconclusive';
      observation.failureReason='handler-threw';
      observation.observedState={clickDispatched:clickOk};
      // Best-effort restore after throw.
      try{
        if(attr(btn,'aria-expanded')!==initialExpanded)btn.setAttribute('aria-expanded',initialExpanded);
        restorePanelState(doc,panelId,before);
      }catch{}
      observation.restored=attr(btn,'aria-expanded')===initialExpanded&&panelVisibility(doc,panelId).visible===before.visible;
      return{finding:null,observation,stopFurther:!observation.restored};
    }
    const afterExpanded=attr(btn,'aria-expanded');
    const after=panelVisibility(doc,panelId);
    const changed=expectChange();
    observation.settled=settle.settled||changed;
    observation.settleDurationBucket=settleDurationBucket(settle.durationMs);
    observation.observedState={ariaExpanded:afterExpanded,panelVisible:after.visible,clickDispatched:clickOk};
    if(budgetRef)budgetRef.remainingMs-=settle.durationMs;

    // Restore: re-click only for immediate/sync changes. Delayed handlers can race a second
    // click and re-open after attribute force — prefer attribute/panel restore for async paths.
    let restored=false;
    try{
      if(changed&&settle.immediate&&attr(btn,'aria-expanded')!==initialExpanded)activateElement(btn);
      await settleUntil(()=>attr(btn,'aria-expanded')===initialExpanded,{maxMs:80,stepMs:16});
      if(attr(btn,'aria-expanded')!==initialExpanded)btn.setAttribute('aria-expanded',initialExpanded);
      restorePanelState(doc,panelId,before);
      await Promise.resolve();
      if(attr(btn,'aria-expanded')!==initialExpanded)btn.setAttribute('aria-expanded',initialExpanded);
      restorePanelState(doc,panelId,before);
      const restoredVis=panelVisibility(doc,panelId);
      restored=attr(btn,'aria-expanded')===initialExpanded&&restoredVis.visible===before.visible;
    }catch{restored=false}
    observation.restored=restored;
    observation.restoredState={ariaExpanded:attr(btn,'aria-expanded'),panelVisible:panelVisibility(doc,panelId).visible,restored};

    if(!clickOk){
      observation.outcome='inconclusive';
      observation.failureReason='click-dispatch-failed';
      observation.confidence='inferred';
      return{finding:null,observation,stopFurther:!restored};
    }
    if(changed){
      observation.outcome='passed';
      observation.confidence='confirmed';
      observation.failureReason='';
      return{finding:null,observation,stopFurther:!restored};
    }
    // Unexpected but plausible: expanded flipped wrong way, or unrelated visibility flip.
    const unexpected=afterExpanded!==initialExpanded&&afterExpanded!==expectedExpanded;
    if(unexpected||(!before.found&&after.found)){
      observation.outcome='inconclusive';
      observation.failureReason='unexpected-state-change';
      return{finding:null,observation,stopFurther:!restored};
    }
    if(settle.settled===false&&afterExpanded===initialExpanded&&after.visible===before.visible){
      // Extended settle tier: slow UI may still change without becoming a confirmed failure.
      if(budgetRef&&budgetRef.remainingMs>0){
        const extended=await settleUntil(expectChange,{maxMs:Math.min(INTERACTION_SETTLE_EXTENDED_MS,budgetRef.remainingMs),stepMs:INTERACTION_SETTLE_STEP_MS});
        budgetRef.remainingMs-=extended.durationMs;
        if(expectChange()){
          observation.settled=true;
          observation.settleDurationBucket=settleDurationBucket(settle.durationMs+extended.durationMs);
          observation.observedState={ariaExpanded:attr(btn,'aria-expanded'),panelVisible:panelVisibility(doc,panelId).visible,clickDispatched:clickOk};
          // Fall through to restore path as a pass — re-enter by setting changed semantics.
          const afterPassExpanded=attr(btn,'aria-expanded');
          const afterPass=panelVisibility(doc,panelId);
          observation.outcome='passed';
          observation.confidence='confirmed';
          observation.failureReason='';
          let restoredPass=false;
          try{
            if(settle.immediate===false){ /* async: attribute restore only */ }
            else if(attr(btn,'aria-expanded')!==initialExpanded)activateElement(btn);
            await settleUntil(()=>attr(btn,'aria-expanded')===initialExpanded,{maxMs:80,stepMs:16});
            if(attr(btn,'aria-expanded')!==initialExpanded)btn.setAttribute('aria-expanded',initialExpanded);
            restorePanelState(doc,panelId,before);
            await Promise.resolve();
            if(attr(btn,'aria-expanded')!==initialExpanded)btn.setAttribute('aria-expanded',initialExpanded);
            restorePanelState(doc,panelId,before);
            restoredPass=attr(btn,'aria-expanded')===initialExpanded&&panelVisibility(doc,panelId).visible===before.visible;
          }catch{restoredPass=false}
          observation.restored=restoredPass;
          observation.restoredState={ariaExpanded:attr(btn,'aria-expanded'),panelVisible:panelVisibility(doc,panelId).visible,restored:restoredPass};
          observation.observedState={ariaExpanded:afterPassExpanded,panelVisible:afterPass.visible,clickDispatched:clickOk};
          return{finding:null,observation,stopFurther:!restoredPass};
        }
      }
      // Still no change after extended window → inconclusive (may be slow UI or inert control).
      observation.outcome='inconclusive';
      observation.failureReason='no-state-change-after-extended-settle';
      observation.confidence='inferred';
      observation.settleDurationBucket=settleDurationBucket(INTERACTION_SETTLE_MAX_MS+INTERACTION_SETTLE_EXTENDED_MS);
      const extra={
        worthChecking:true,
        interactionObservation:observation,
        embeddedContext:embeddedContext||undefined,
        frameSelector:frameSelector||undefined,
        spotlightSafe:embeddedContext?false:undefined
      };
      return{
        finding:finding({
          ruleId:'ux.disclosure-toggle-failed',
          title:'Disclosure control did not change state when activated',
          detail:embeddedContext
            ?`Inside an embedded same-origin document, a safe local disclosure control was activated. Expected aria-expanded to become "${expectedExpanded}" (or the controlled panel visibility to change) within the bounded verification window, including a short extended settle for delayed UI. No qualifying state change was observed. This may be a slow animation or an inert control; it does not identify the exact JavaScript root cause.`
            :`A safe local disclosure control was activated in a non-destructive check. Expected aria-expanded to become "${expectedExpanded}" (or the controlled panel visibility to change) within the bounded verification window, including a short extended settle for delayed UI. No qualifying state change was observed. This may be a slow animation or an inert control; it does not identify the exact JavaScript root cause.`,
          category:'review',severity:'medium',confidence:'inferred',element:embeddedContext?null:btn,
          evidence:`interaction=disclosure-toggle; initial=${initialExpanded}; observed=${afterExpanded}; settled=${observation.settleDurationBucket}; restored=${restored}${embeddedContext?'; context=iframe':''}`,
          extra
        }),
        observation,
        stopFurther:!restored
      };
    }
    observation.outcome='inconclusive';
    observation.failureReason='settle-inconclusive';
    return{finding:null,observation,stopFurther:!restored};
  }
  async function verifyMenuInDocument(btn,{doc,frameSelector='',embeddedContext='',budgetRef}={}){
    const menuId=attr(btn,'aria-controls').split(/\s+/).filter(Boolean)[0];
    const initialExpanded=attr(btn,'aria-expanded');
    const before=panelVisibility(doc,menuId);
    const focusBefore=captureFocus(doc);
    const expectedExpanded=initialExpanded==='false'?'true':'false';
    const observation={
      interactionType:'menu-toggle',
      context:embeddedContext||'top-document',
      frameSelector:frameSelector||undefined,
      initialState:{ariaExpanded:initialExpanded,menuVisible:before.visible,focus:focusBefore.selector||undefined},
      expectedState:{ariaExpanded:expectedExpanded},
      observedState:{},
      outcome:'inconclusive',
      settled:false,
      settleDurationBucket:'immediate',
      restored:false,
      failureReason:'',
      confidence:'inferred'
    };
    if(initialExpanded!=='false'&&initialExpanded!=='true'){
      observation.outcome='not-applicable';
      observation.failureReason='invalid-aria-expanded';
      return{finding:null,observation,stopFurther:false};
    }
    if(budgetRef&&budgetRef.remainingMs<=0){
      observation.outcome='inconclusive';
      observation.failureReason='interaction-time-budget';
      return{finding:null,observation,stopFurther:false};
    }
    // Toggle only — never activate menu items / links inside the menu.
    const clickOk=activateElement(btn);
    const expectChange=()=>{
      const expanded=attr(btn,'aria-expanded');
      const after=panelVisibility(doc,menuId);
      return expanded===expectedExpanded
        ||(initialExpanded==='false'&&after.visible&&!before.visible)
        ||(initialExpanded==='true'&&!after.visible&&before.visible);
    };
    let settle;
    try{settle=await settleUntil(expectChange)}catch{
      observation.outcome='inconclusive';
      observation.failureReason='handler-threw';
      try{
        if(attr(btn,'aria-expanded')!==initialExpanded)btn.setAttribute('aria-expanded',initialExpanded);
        restorePanelState(doc,menuId,before);
      }catch{}
      observation.restored=attr(btn,'aria-expanded')===initialExpanded&&panelVisibility(doc,menuId).visible===before.visible;
      return{finding:null,observation,stopFurther:!observation.restored};
    }
    const afterExpanded=attr(btn,'aria-expanded');
    const after=panelVisibility(doc,menuId);
    const changed=expectChange();
    observation.settled=settle.settled||changed;
    observation.settleDurationBucket=settleDurationBucket(settle.durationMs);
    observation.observedState={ariaExpanded:afterExpanded,menuVisible:after.visible,clickDispatched:clickOk};
    if(budgetRef)budgetRef.remainingMs-=settle.durationMs;
    let restored=false;
    try{
      if(changed&&settle.immediate&&attr(btn,'aria-expanded')!==initialExpanded)activateElement(btn);
      await settleUntil(()=>attr(btn,'aria-expanded')===initialExpanded,{maxMs:80,stepMs:16});
      if(attr(btn,'aria-expanded')!==initialExpanded)btn.setAttribute('aria-expanded',initialExpanded);
      restorePanelState(doc,menuId,before);
      await Promise.resolve();
      if(attr(btn,'aria-expanded')!==initialExpanded)btn.setAttribute('aria-expanded',initialExpanded);
      restorePanelState(doc,menuId,before);
      restored=attr(btn,'aria-expanded')===initialExpanded&&panelVisibility(doc,menuId).visible===before.visible;
    }catch{restored=false}
    observation.restored=restored;
    observation.restoredState={ariaExpanded:attr(btn,'aria-expanded'),menuVisible:panelVisibility(doc,menuId).visible,restored};
    if(!clickOk){
      observation.outcome='inconclusive';
      observation.failureReason='click-dispatch-failed';
      return{finding:null,observation,stopFurther:!restored};
    }
    if(changed){
      observation.outcome='passed';
      observation.confidence='confirmed';
      observation.failureReason='';
      return{finding:null,observation,stopFurther:!restored};
    }
    if(settle.settled===false&&afterExpanded===initialExpanded&&after.visible===before.visible){
      if(budgetRef&&budgetRef.remainingMs>0){
        const extended=await settleUntil(expectChange,{maxMs:Math.min(INTERACTION_SETTLE_EXTENDED_MS,budgetRef.remainingMs),stepMs:INTERACTION_SETTLE_STEP_MS});
        budgetRef.remainingMs-=extended.durationMs;
        if(expectChange()){
          observation.settled=true;
          observation.settleDurationBucket=settleDurationBucket(settle.durationMs+extended.durationMs);
          observation.outcome='passed';
          observation.confidence='confirmed';
          try{
            if(attr(btn,'aria-expanded')!==initialExpanded)btn.setAttribute('aria-expanded',initialExpanded);
            restorePanelState(doc,menuId,before);
            restored=attr(btn,'aria-expanded')===initialExpanded&&panelVisibility(doc,menuId).visible===before.visible;
          }catch{restored=false}
          observation.restored=restored;
          observation.observedState={ariaExpanded:attr(btn,'aria-expanded'),menuVisible:panelVisibility(doc,menuId).visible,clickDispatched:clickOk};
          return{finding:null,observation,stopFurther:!restored};
        }
      }
      observation.outcome='inconclusive';
      observation.failureReason='no-state-change-after-extended-settle';
      observation.confidence='inferred';
      return{
        finding:finding({
          ruleId:'ux.menu-toggle-failed',
          title:'Menu control did not change state when activated',
          detail:'A known-safe local menu toggle was activated. Expected aria-expanded (or menu visibility) to change within the bounded verification window, including a short extended settle for delayed UI. No qualifying state change was observed. Menu items inside the menu were not activated. This does not identify the exact JavaScript root cause.',
          category:'review',severity:'medium',confidence:'inferred',element:embeddedContext?null:btn,
          evidence:`interaction=menu-toggle; initial=${initialExpanded}; observed=${afterExpanded}; settled=${observation.settleDurationBucket}; restored=${restored}`,
          extra:{worthChecking:true,interactionObservation:observation,embeddedContext:embeddedContext||undefined,frameSelector:frameSelector||undefined,spotlightSafe:embeddedContext?false:undefined}
        }),
        observation,
        stopFurther:!restored
      };
    }
    observation.outcome='inconclusive';
    observation.failureReason='settle-inconclusive';
    return{finding:null,observation,stopFurther:!restored};
  }
  async function verifyTabInDocument(tab,{doc,frameSelector='',embeddedContext='',budgetRef}={}){
    const panelId=attr(tab,'aria-controls').split(/\s+/).filter(Boolean)[0];
    const initialSelected=attr(tab,'aria-selected');
    if(initialSelected==='true'){
      return{finding:null,observation:{interactionType:'tab',outcome:'not-applicable',failureReason:'already-selected',context:embeddedContext||'top-document',restored:true},stopFurther:false};
    }
    const beforePanel=panelVisibility(doc,panelId);
    const tablist=tab.closest?.('[role="tablist"]')||doc;
    const priorSelected=[...tablist.querySelectorAll('[role="tab"]')].find(t=>t!==tab&&attr(t,'aria-selected')==='true')||null;
    const observation={
      interactionType:'tab',
      context:embeddedContext||'top-document',
      frameSelector:frameSelector||undefined,
      initialState:{ariaSelected:initialSelected||'false',panelVisible:beforePanel.visible},
      expectedState:{ariaSelected:'true'},
      observedState:{},
      outcome:'inconclusive',
      settled:false,
      settleDurationBucket:'immediate',
      restored:true,
      failureReason:'',
      confidence:'inferred'
    };
    if(budgetRef&&budgetRef.remainingMs<=0){
      observation.failureReason='interaction-time-budget';
      return{finding:null,observation,stopFurther:false};
    }
    // Without a known prior selected tab, skip — we cannot restore selection safely.
    if(!priorSelected){
      observation.outcome='skipped-unsafe';
      observation.failureReason='no-restorable-prior-tab';
      return{finding:null,observation,stopFurther:false};
    }
    const clickOk=activateElement(tab);
    const expect=()=>attr(tab,'aria-selected')==='true'||(panelVisibility(doc,panelId).visible&&!beforePanel.visible);
    let settle;
    try{settle=await settleUntil(expect)}catch{
      observation.outcome='inconclusive';
      observation.failureReason='handler-threw';
      try{activateElement(priorSelected)}catch{}
      return{finding:null,observation,stopFurther:false};
    }
    const afterSelected=attr(tab,'aria-selected');
    const afterPanel=panelVisibility(doc,panelId);
    const changed=expect();
    observation.settled=settle.settled||changed;
    observation.settleDurationBucket=settleDurationBucket(settle.durationMs);
    observation.observedState={ariaSelected:afterSelected,panelVisible:afterPanel.visible,clickDispatched:clickOk};
    if(budgetRef)budgetRef.remainingMs-=settle.durationMs;
    try{
      activateElement(priorSelected);
      await settleUntil(()=>attr(priorSelected,'aria-selected')==='true',{maxMs:80});
      observation.restored=attr(priorSelected,'aria-selected')==='true';
    }catch{observation.restored=false}
    if(changed&&afterSelected==='true'){
      observation.outcome=observation.restored?'passed':'inconclusive';
      observation.confidence='confirmed';
      if(!observation.restored)observation.failureReason='tab-restore-unproven';
      return{finding:null,observation,stopFurther:!observation.restored};
    }
    observation.outcome=clickOk?'failed':'inconclusive';
    observation.failureReason=clickOk?'no-state-change-after-settle':'click-dispatch-failed';
    // Coverage only for tab failures in this batch — avoid RO spam while restore contract matures.
    return{finding:null,observation,stopFurther:!observation.restored};
  }
  async function verifySkipLinkInDocument(a,{doc,frameSelector='',embeddedContext='',budgetRef}={}){
    const raw=attr(a,'href');
    let id='';try{id=decodeURIComponent(raw.slice(1))}catch{id=raw.slice(1)}
    const focusBefore=captureFocus(doc);
    const hrefBefore=String(doc.defaultView?.location?.href||location.href||'');
    const observation={
      interactionType:'skip-link',
      context:embeddedContext||'top-document',
      frameSelector:frameSelector||undefined,
      initialState:{focus:focusBefore.selector||undefined,href:`#${id}`},
      expectedState:{focusOnTarget:true},
      observedState:{},
      outcome:'inconclusive',
      settled:false,
      settleDurationBucket:'immediate',
      restored:false,
      failureReason:'',
      confidence:'inferred'
    };
    if(budgetRef&&budgetRef.remainingMs<=0){
      observation.failureReason='interaction-time-budget';
      return{finding:null,observation,stopFurther:false};
    }
    let target=null;
    try{target=doc.getElementById(id)||doc.querySelector(`[name="${CSS.escape(id)}"]`)}catch{}
    if(!target){
      observation.outcome='not-applicable';
      observation.failureReason='target-missing';
      observation.restored=true;
      return{finding:null,observation,stopFurther:false};
    }
    const clickOk=activateElement(a);
    const expect=()=>{
      const ae=doc.activeElement;
      return ae===target||(target.contains?.(ae));
    };
    let settle;
    try{settle=await settleUntil(expect,{maxMs:80})}catch{
      observation.failureReason='handler-threw';
      observation.restored=true;
      return{finding:null,observation,stopFurther:false};
    }
    const moved=expect();
    observation.settled=settle.settled||moved;
    observation.settleDurationBucket=settleDurationBucket(settle.durationMs);
    observation.observedState={clickDispatched:clickOk,focusMoved:moved};
    if(budgetRef)budgetRef.remainingMs-=settle.durationMs;
    try{
      if(focusBefore.selector){
        const prev=doc.querySelector(focusBefore.selector);
        if(prev&&typeof prev.focus==='function')prev.focus();
        else if(typeof doc.body?.focus==='function')doc.body.focus();
      }else if(typeof doc.body?.focus==='function')doc.body.focus();
      const hrefAfter=String(doc.defaultView?.location?.href||location.href||'');
      if(hrefAfter!==hrefBefore){
        try{
          const view=doc.defaultView||window;
          if(typeof view.history?.replaceState==='function'){
            const u=new URL(hrefBefore);
            view.history.replaceState(view.history.state,'',`${u.pathname}${u.search}${u.hash}`);
          }
        }catch{}
      }
      const hrefRestored=String(doc.defaultView?.location?.href||location.href||'')===hrefBefore
        || String(doc.defaultView?.location?.hash||'')===(new URL(hrefBefore).hash||'');
      const focusRestored=captureFocus(doc);
      observation.restored=Boolean(hrefRestored)&&(focusBefore.selector
        ?(focusRestored.selector===focusBefore.selector||!focusRestored.selector)
        :true);
      if(!observation.restored)observation.failureReason=observation.failureReason||'skip-link-state-unproven';
    }catch{observation.restored=false;observation.failureReason=observation.failureReason||'focus-restore-failed'}
    if(!observation.restored){
      observation.outcome='inconclusive';
      observation.failureReason=observation.failureReason||'skip-link-state-unproven';
      return{finding:null,observation,stopFurther:true};
    }
    if(moved){
      observation.outcome='passed';
      observation.confidence='confirmed';
    }else{
      observation.outcome='inconclusive';
      observation.failureReason='focus-not-observed';
    }
    return{finding:null,observation,stopFurther:!observation.restored};
  }
  function emptyInteractionCoverage(){
    return{
      candidates:0,eligible:0,safelyTested:0,tested:0,skippedUnsafe:0,skippedIneligible:0,skippedSafetyPolicy:0,
      passed:0,failed:0,inconclusive:0,notApplicable:0,restorationFailures:0,
      partialReason:'',topDocumentOnly:true,iframeDisclosures:'none',
      contexts:{top:0,iframe:0},
      sideEffectLimitation:'allowlisted-activation-may-run-page-handlers'
    };
  }
  async function safeInteractionFindingsAsync(){
    const out=[];
    const coverage=emptyInteractionCoverage();
    lastInteractionCoverage=coverage;
    const budgetRef={remainingMs:INTERACTION_TOTAL_BUDGET_MS};
    let stopAll=false;

    function noteObservation(obs){
      if(!obs)return;
      // Accounting invariant: tested == passed + failed + inconclusive.
      // not-applicable and skipped-unsafe/safety-policy are not tested activations.
      if(obs.outcome==='not-applicable'||obs.outcome==='skipped-unsafe'||obs.outcome==='skipped-safety-policy'){
        if(coverage.tested>0)coverage.tested--;
        if(coverage.safelyTested>0)coverage.safelyTested--;
        if(coverage.eligible>0)coverage.eligible--;
        if(obs.outcome==='not-applicable')coverage.notApplicable++;
        else if(obs.outcome==='skipped-safety-policy')coverage.skippedSafetyPolicy++;
        else coverage.skippedUnsafe++;
        return;
      }
      if(obs.outcome==='passed')coverage.passed++;
      else if(obs.outcome==='failed')coverage.failed++;
      else if(obs.outcome==='inconclusive')coverage.inconclusive++;
      else coverage.inconclusive++;
      if(obs.restored===false&&(obs.outcome==='passed'||obs.outcome==='failed'||obs.outcome==='inconclusive')){
        coverage.restorationFailures++;
      }
    }

    async function runDisclosureList(list,ctx){
      let used=0;
      for(const btn of list){
        if(stopAll)break;
        coverage.candidates++;
        if(!isKnownSafeDisclosureControl(btn,ctx.doc)){
          if(isUnsafeInteractionTarget(btn)||hasHighRiskInteractionSemantics(btn))coverage.skippedUnsafe++;
          else coverage.skippedIneligible++;
          continue;
        }
        coverage.eligible++;
        if(stopAll||budgetRef.remainingMs<=0||coverage.safelyTested>=SAFE_INTERACTION_BUDGET||(ctx.frameLimit!=null&&used>=ctx.frameLimit)){
          coverage.partialReason=coverage.partialReason||(coverage.safelyTested>=SAFE_INTERACTION_BUDGET?'interaction-budget-exceeded':'interaction-time-budget');
          continue;
        }
        coverage.safelyTested++;
        coverage.tested++;
        used++;
        if(ctx.embeddedContext)coverage.contexts.iframe++;
        else coverage.contexts.top++;
        const result=await verifyDisclosureInDocument(btn,{
          doc:ctx.doc,
          frameSelector:ctx.frameSelector||'',
          embeddedContext:ctx.embeddedContext||'',
          budgetRef
        });
        noteObservation(result.observation);
        if(result.finding)out.push(result.finding);
        if(result.stopFurther){
          coverage.partialReason=coverage.partialReason||'restoration-unproven';
          stopAll=true;
          out.push(finding({
            ruleId:'ux.interaction-restoration-unproven',
            title:'Interaction testing stopped after restoration could not be verified',
            detail:'WebQA stopped further interaction testing after it could not verify restoration of the original page state. The page should not remain visibly modified, but subsequent controls were not activated.',
            category:'review',severity:'low',confidence:'inferred',targetType:'document',
            evidence:`restoration-unproven; context=${ctx.embeddedContext||'top-document'}`,
            extra:{worthChecking:true,interactionObservation:result.observation,embeddedContext:ctx.embeddedContext||undefined,frameSelector:ctx.frameSelector||undefined,spotlightSafe:ctx.embeddedContext?false:undefined}
          }));
          break;
        }
      }
    }

    // Top document disclosures (exclude menu toggles — menus use a dedicated safe path)
    const topDisclosures=[...document.querySelectorAll('button[aria-expanded][aria-controls], [role="button"][aria-expanded][aria-controls]')]
      .filter(el=>!isMenuToggleCandidate(el,document));
    await runDisclosureList(topDisclosures,{doc:document,embeddedContext:'',frameSelector:''});

    // Safe menu toggles only (toggle control; never activate menu items). Ambiguous menus are skipped.
    if(!stopAll&&coverage.safelyTested<SAFE_INTERACTION_BUDGET){
      const menuCandidates=[...document.querySelectorAll('button[aria-expanded][aria-controls], [role="button"][aria-expanded][aria-controls]')]
        .filter(el=>isMenuToggleCandidate(el,document))
        .slice(0,4);
      for(const btn of menuCandidates){
        if(stopAll||coverage.safelyTested>=SAFE_INTERACTION_BUDGET)break;
        coverage.candidates++;
        if(!isKnownSafeMenuControl(btn,document)){
          if(isUnsafeInteractionTarget(btn)||hasHighRiskInteractionSemantics(btn))coverage.skippedUnsafe++;
          else coverage.skippedIneligible++;
          continue;
        }
        coverage.eligible++;
        coverage.safelyTested++;
        coverage.tested++;
        coverage.contexts.top++;
        const result=await verifyMenuInDocument(btn,{doc:document,budgetRef});
        noteObservation(result.observation);
        if(result.finding)out.push(result.finding);
        if(result.stopFurther){
          coverage.partialReason=coverage.partialReason||'restoration-unproven';
          stopAll=true;
          break;
        }
      }
    }

    // Top document tabs (coverage-oriented; limited)
    if(!stopAll&&coverage.safelyTested<SAFE_INTERACTION_BUDGET){
      const tabs=[...document.querySelectorAll('[role="tab"][aria-controls]')].slice(0,3);
      for(const tab of tabs){
        if(stopAll||coverage.safelyTested>=SAFE_INTERACTION_BUDGET)break;
        coverage.candidates++;
        if(!isKnownSafeTabControl(tab,document)){
          if(isUnsafeInteractionTarget(tab)||hasHighRiskInteractionSemantics(tab))coverage.skippedUnsafe++;
          else coverage.skippedIneligible++;
          continue;
        }
        coverage.eligible++;
        coverage.safelyTested++;
        coverage.tested++;
        coverage.contexts.top++;
        const result=await verifyTabInDocument(tab,{doc:document,budgetRef});
        noteObservation(result.observation);
        if(result.stopFurther){
          coverage.partialReason=coverage.partialReason||'restoration-unproven';
          stopAll=true;
          break;
        }
      }
    }

    // Skip links (top document only, max 1)
    if(!stopAll&&coverage.safelyTested<SAFE_INTERACTION_BUDGET){
      const skips=[...document.querySelectorAll('a[href^="#"]')].filter(isSkipLinkAnchor).slice(0,1);
      for(const a of skips){
        coverage.candidates++;
        if(!isKnownSafeSkipLink(a,document)){
          coverage.skippedIneligible++;
          continue;
        }
        coverage.eligible++;
        coverage.safelyTested++;
        coverage.tested++;
        const result=await verifySkipLinkInDocument(a,{doc:document,budgetRef});
        noteObservation(result.observation);
        if(result.stopFurther){
          coverage.partialReason=coverage.partialReason||'restoration-unproven';
          stopAll=true;
        }
      }
    }

    // Same-origin iframe disclosures (nested accessible frames included)
    let framesUsed=0;
    let iframeInteractionsUnprobed=0;
    const frameRecords=(lastFrameRecords||collectFrameRecords()).filter(r=>r.accessible&&r.doc);
    let iframeEligible=0;
    let iframeTested=0;
    let iframeDisclosuresPresent=false;
    for(let fi=0;fi<frameRecords.length;fi++){
      const rec=frameRecords[fi];
      const frame=rec.frame;
      if(stopAll)break;
      if(coverage.safelyTested>=SAFE_INTERACTION_BUDGET){
        coverage.partialReason=coverage.partialReason||'interaction-budget-exceeded';
        break;
      }
      if(framesUsed>=SAME_ORIGIN_IFRAME_HARD_CEILING){
        for(let rj=fi;rj<frameRecords.length;rj++){
          const restDoc=frameRecords[rj].doc;
          if(!restDoc)continue;
          const remaining=[...restDoc.querySelectorAll('button[aria-expanded][aria-controls], [role="button"][aria-expanded][aria-controls]')]
            .filter(el=>!isMenuToggleCandidate(el,restDoc));
          if(remaining.some(el=>isKnownSafeDisclosureControl(el,restDoc)))iframeInteractionsUnprobed++;
        }
        if(iframeInteractionsUnprobed>0){
          coverage.partialReason=coverage.partialReason||'frame-budget-exceeded';
          coverage.iframeInteractionsUnprobed=iframeInteractionsUnprobed;
        }
        break;
      }
      const doc=rec.doc;
      if(!frame.isConnected)continue;
      framesUsed++;
      coverage.topDocumentOnly=false;
      const frameSel=selectorFor(frame);
      const disclosures=[...doc.querySelectorAll('button[aria-expanded][aria-controls], [role="button"][aria-expanded][aria-controls]')]
        .filter(el=>!isMenuToggleCandidate(el,doc));
      if(disclosures.length)iframeDisclosuresPresent=true;
      const eligibleHere=disclosures.filter(el=>isKnownSafeDisclosureControl(el,doc)).length;
      iframeEligible+=eligibleHere;
      const testedBefore=coverage.safelyTested;
      await runDisclosureList(disclosures,{
        doc,
        embeddedContext:'same-origin-iframe',
        frameSelector:frameSel,
        frameLimit:SAFE_INTERACTION_PER_FRAME
      });
      iframeTested+=Math.max(0,coverage.safelyTested-testedBefore);
      try{
        if(frame.contentDocument!==doc){
          coverage.partialReason=coverage.partialReason||'frame-replaced';
          stopAll=true;
          break;
        }
      }catch{
        coverage.partialReason=coverage.partialReason||'frame-unloaded';
        stopAll=true;
        break;
      }
    }
    if(iframeTested>0)coverage.iframeDisclosures='tested';
    else if(iframeEligible>0)coverage.iframeDisclosures='present-not-tested';
    else if(iframeDisclosuresPresent)coverage.iframeDisclosures='present-not-eligible';
    else coverage.iframeDisclosures='none';
    if(iframeInteractionsUnprobed>0)coverage.iframeInteractionsUnprobed=iframeInteractionsUnprobed;

    if(!coverage.partialReason){
      if(coverage.restorationFailures)coverage.partialReason='restoration-unproven';
      else if(coverage.skippedSafetyPolicy&&!coverage.safelyTested)coverage.partialReason='no-safe-reversible-candidates';
      else if(!coverage.safelyTested)coverage.partialReason=coverage.candidates?'no-safe-reversible-candidates':'no-disclosure-candidates';
      else if(!coverage.topDocumentOnly)coverage.partialReason='top-and-iframe-disclosures';
      else coverage.partialReason='top-document-interactions';
    }
    return out;
  }
  function safeInteractionFindings(){
    // Sync fallback when prepareSafeInteractions was not awaited: immediate-only path for legacy callers.
    if(interactionsPrepared&&Array.isArray(lastPreparedInteractionFindings)){
      return lastPreparedInteractionFindings;
    }
    const out=[];
    const coverage=emptyInteractionCoverage();
    lastInteractionCoverage=coverage;
    const candidates=[];
    const allDisclosure=[...document.querySelectorAll('button[aria-expanded][aria-controls], [role="button"][aria-expanded][aria-controls]')];
    for(const btn of allDisclosure){
      coverage.candidates++;
      if(!isKnownSafeDisclosureControl(btn,document)){
        if(isUnsafeInteractionTarget(btn)||hasHighRiskInteractionSemantics(btn))coverage.skippedUnsafe++;
        else coverage.skippedIneligible++;
        continue;
      }
      candidates.push(btn);
      coverage.eligible++;
      if(candidates.length>=SAFE_INTERACTION_BUDGET)break;
    }
    if(allDisclosure.length>SAFE_INTERACTION_BUDGET)coverage.partialReason='interaction-budget-exceeded';
    for(const btn of candidates){
      const panelId=attr(btn,'aria-controls').split(/\s+/).filter(Boolean)[0];
      const initialExpanded=attr(btn,'aria-expanded');
      const before=panelVisibility(document,panelId);
      const expectedExpanded=initialExpanded==='false'?'true':'false';
      coverage.safelyTested++;
      coverage.tested++;
      let clickOk=false;
      try{clickOk=activateElement(btn)}catch{clickOk=false}
      const afterExpanded=attr(btn,'aria-expanded');
      const after=panelVisibility(document,panelId);
      const changed=afterExpanded===expectedExpanded||(initialExpanded==='false'&&after.visible&&!before.visible)||(initialExpanded==='true'&&!after.visible&&before.visible);
      let restored=false;
      try{
        if(changed&&attr(btn,'aria-expanded')!==initialExpanded)activateElement(btn);
        if(attr(btn,'aria-expanded')!==initialExpanded)btn.setAttribute('aria-expanded',initialExpanded);
        restorePanelState(document,panelId,before);
        const restoredVis=panelVisibility(document,panelId);
        restored=attr(btn,'aria-expanded')===initialExpanded&&restoredVis.visible===before.visible;
      }catch{restored=false}
      if(!restored)coverage.restorationFailures++;
      const observation={
        interactionType:'disclosure-toggle',
        context:'top-document',
        initialState:{ariaExpanded:initialExpanded,panelVisible:before.visible},
        expectedState:{ariaExpanded:expectedExpanded},
        observedState:{ariaExpanded:afterExpanded,panelVisible:after.visible,clickDispatched:clickOk},
        restoredState:{ariaExpanded:attr(btn,'aria-expanded'),panelVisible:panelVisibility(document,panelId).visible,restored},
        outcome:changed?'passed':(clickOk?'failed':'inconclusive'),
        settled:changed,
        settleDurationBucket:'immediate',
        restored,
        confidence:changed?'confirmed':'inferred',
        failureReason:changed?'':(!clickOk?'click-dispatch-failed':'no-state-change')
      };
      if(changed){coverage.passed++;continue}
      coverage.failed++;
      out.push(finding({
        ruleId:'ux.disclosure-toggle-failed',
        title:'Disclosure control did not change state when activated',
        detail:`A safe local disclosure control was activated in a non-destructive check. Expected aria-expanded to become "${expectedExpanded}" (or the controlled panel visibility to change), but no qualifying state change was observed. This does not identify the exact JavaScript root cause.`,
        category:'review',severity:'medium',confidence:'inferred',element:btn,
        evidence:`interaction=disclosure-toggle; initial=${initialExpanded}; observed=${afterExpanded}; restored=${restored}`,
        extra:{worthChecking:true,interactionObservation:observation}
      }));
    }
    if(!coverage.partialReason){
      if(coverage.safelyTested)coverage.partialReason='top-document-disclosures-only';
      else coverage.partialReason=coverage.candidates?'no-safe-reversible-candidates':'no-disclosure-candidates';
    }
    coverage.iframeDisclosures='static-only-sync-fallback';
    return out;
  }
  async function prepareSafeInteractions(){
    interactionsPrepared=false;
    lastPreparedInteractionFindings=null;
    try{
      lastPreparedInteractionFindings=await safeInteractionFindingsAsync();
      interactionsPrepared=true;
    }catch{
      lastPreparedInteractionFindings=[];
      interactionsPrepared=true;
      if(!lastInteractionCoverage)lastInteractionCoverage=emptyInteractionCoverage();
      lastInteractionCoverage.partialReason=lastInteractionCoverage.partialReason||'interaction-prepare-failed';
    }
  }
  function interactionFindings(){
    const out=[],seen=new Set();
    for(const el of document.querySelectorAll('[aria-controls]')){
      if(attr(el,'aria-expanded')!=='')continue;
      const controls=attr(el,'aria-controls').split(/\s+/).filter(Boolean)[0];
      if(!controls||seen.has(`${controls}|${selectorFor(el)}`))continue;
      seen.add(`${controls}|${selectorFor(el)}`);
      if(resolveFragmentTarget(controls))continue;
      out.push(finding({
        ruleId:'ux.controls-target-missing',
        title:'Control references a missing panel or region',
        detail:`An element declares aria-controls="${controls}", but no matching id was found in the top document, open shadow roots, or accessible same-origin iframe documents.`,
        category:'review',severity:'medium',confidence:'inferred',element:el,
        evidence:`aria-controls=${controls}`,extra:{worthChecking:true}
      }));
    }
    for(const btn of document.querySelectorAll('button[aria-expanded], [role="button"][aria-expanded]')){
      const expanded=attr(btn,'aria-expanded');
      const controls=attr(btn,'aria-controls');
      const panelId=controls||'';
      if(!panelId||expanded!=='false')continue;
      if(resolveFragmentTarget(panelId))continue;
      const key=selectorFor(btn);if(seen.has(key))continue;seen.add(key);
      out.push(finding({
        ruleId:'ux.disclosure-target-missing',
        title:'Collapsed control points at a missing panel',
        detail:'A disclosure control is collapsed (aria-expanded=false) but its aria-controls target was not found. Accordion and menu toggles may be broken for keyboard and assistive-tech users if the panel id is wrong.',
        category:'review',severity:'medium',confidence:'inferred',element:btn,
        evidence:`aria-controls=${panelId}`,extra:{worthChecking:true}
      }));
    }
    for(const a of document.querySelectorAll('a[href^="#"].skip-link, a.skip-link[href^="#"], a[class*="skip" i][href^="#"]')){
      const raw=attr(a,'href');
      if(!raw||raw==='#')continue;
      let id='';try{id=decodeURIComponent(raw.slice(1))}catch{id=raw.slice(1)}
      if(!id||resolveFragmentTarget(id))continue;
      out.push(finding({
        ruleId:'navigation.skip-link-target-missing',
        title:'Skip link target is missing',
        detail:`A skip link points to #${id}, but no matching target exists in observable document, shadow, or same-origin iframe contexts.`,
        category:'fix',severity:'medium',confidence:'confirmed',element:a,evidence:`#${id}`
      }));
    }
    return out;
  }
  function schemaSemanticFindings(schema){
    const out=[];
    for(const block of document.querySelectorAll('script[type="application/ld+json"]')){
      let data;try{data=JSON.parse(block.textContent||'null')}catch{continue}
      const items=Array.isArray(data)?data:(data?.['@graph']||[data]);
      items.forEach((item,index)=>{
        if(!item||typeof item!=='object')return;
        const type=item['@type'];
        if(type)return;
        out.push(finding({
          ruleId:'schema.jsonld-missing-type',
          title:'JSON-LD item lacks an @type',
          detail:`Structured data block ${index+1} contains an object without @type, so consumers cannot classify the entity.`,
          category:'review',severity:'low',confidence:'inferred',element:block,targetType:'document',
          evidence:'missing-@type',extra:{worthChecking:true}
        }));
      });
    }
    return out.slice(0,3);
  }

  function fragmentFindings(){
    const groups=new Map();
    for(const a of document.querySelectorAll('a[href^="#"]')){
      const raw=attr(a,'href');
      if(!raw||raw==='#'||/^#top$/i.test(raw))continue;
      if(isSkipLinkAnchor(a))continue;
      let id='';
      try{id=decodeURIComponent(raw.slice(1))}catch{id=raw.slice(1)}
      if(!id||/^\/?$/.test(id))continue;
      let exists=false;
      try{exists=resolveFragmentTarget(id)}catch{exists=!!document.getElementById(id)}
      if(exists)continue;
      if(!groups.has(id))groups.set(id,[]);
      groups.get(id).push(a);
    }
    const out=[];
    for(const[id,anchors]of groups){
      const first=pickVisibleAnchor(anchors),ctx=linkContext(first);
      const sources=anchors.slice(0,12).map(a=>({...linkContext(a),selector:selectorFor(a)}));
      out.push(finding({ruleId:'navigation.fragment-missing',title:'In-page link points to a missing fragment',detail:`${ctx.text?`"${ctx.text}" `:''}points to #${id}, but no matching id or name exists in the document.`,category:'fix',severity:'medium',element:first,count:anchors.length,confidence:'confirmed',evidence:`#${id}`,extra:{link:{url:`#${id}`,internal:true,fragment:id,status:0,occurrences:anchors.length,sources,...ctx},verification:{state:'confirmed',method:'deterministic DOM fragment resolution',attempts:1,evidence:[`no element with id or name "${id}"`]}}}));
    }
    return out;
  }

  function malformedLinkFindings(){
    const out=[],seen=new Set();
    for(const a of document.querySelectorAll('a[href]')){
      const raw=attr(a,'href');
      if(!raw||raw.startsWith('#')||/^(mailto:|tel:|sms:|javascript:|data:)/i.test(raw))continue;
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
      if(i<path.length-1){
        if(el.shadowRoot){root=el.shadowRoot;continue}
        if(el.localName==='iframe'){
          try{
            if(el.contentDocument){root=el.contentDocument;continue}
          }catch{return null}
          return null;
        }
        return null;
      }
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
        extra:(()=>{
          const axe={impact:rule.impact||'',failureSummary:first.failureSummary||'',message:first.message||'',tags:rule.tags||[],incomplete,checks:checkDetails(first),targetPath:path};
          const base={axe,semantics:semanticContextFor(resolved,rule.id)};
          if(String(rule.id||'')==='link-in-text-block'){
            try{
              const hints=resolved?(()=>{
                const style=getComputedStyle(resolved);
                const line=String(style.textDecorationLine||style.textDecoration||'');
                return{textDecorationLine:line,persistentNonColorIndicator:/underline/i.test(line)};
              })():null;
              base.linkInTextHints=hints||undefined;
              // Keep underline/contrast hints on the finding; presentation merges axe check contrast.
              let contrastRatio=null;
              for(const bucket of ['any','all','none']){
                for(const row of (axe.checks?.[bucket]||[])){
                  const cr=Number(row?.data?.contrastRatio??row?.data?.contrast);
                  if(Number.isFinite(cr))contrastRatio=cr;
                }
              }
              if(!Number.isFinite(contrastRatio)){
                const m=String(axe.failureSummary||'').match(/([\d.]+)\s*:\s*1/);
                if(m)contrastRatio=Number(m[1]);
              }
              base.linkInText={
                persistentNonColorIndicator:hints?hints.persistentNonColorIndicator:undefined,
                textDecorationLine:hints?.textDecorationLine||undefined,
                linkSurroundingContrast:Number.isFinite(contrastRatio)?contrastRatio:undefined,
                requiredAlternativeContrast:3
              };
            }catch{}
          }
          return base;
        })()
      });
    };
    (results.violations||[]).forEach(r=>out.push(convert(r,false)));
    (results.incomplete||[]).forEach(r=>out.push(convert(r,true)));
    return out;
  }

  function classifyLink(anchor){
    if(!anchor||anchor?.hasAttribute?.('download'))return null;
    const raw=anchor?.getAttribute?.('href')||'';
      if(!raw||raw.startsWith('#')||/^(mailto:|tel:|sms:|javascript:|data:)/i.test(raw))return null;
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
  function cacheTtlMs(result,internal){
    const state=String(result?.verificationState||'');
    const cause=String(result?.cause||'');
    if(state==='inconclusive'||state==='unprobed')return 0;
    if(['scanner-timeout','scanner-cancelled','scanner-budget-aborted'].includes(cause))return 0;
    if(state==='confirmed-failure')return LINK_CACHE_TTL_BROKEN_MS;
    if(result?.result?.redirected)return LINK_CACHE_TTL_REDIRECT_MS;
    if(state==='healthy')return internal?LINK_CACHE_TTL_HEALTHY_INTERNAL_MS:LINK_CACHE_TTL_HEALTHY_EXTERNAL_MS;
    return 0;
  }
  function pruneLinkCache(){
    const ts=Date.now();
    for(const[key,hit]of linkVerificationCache){
      if(!hit||!Number.isFinite(Number(hit.expiresAt))||ts>hit.expiresAt)linkVerificationCache.delete(key);
    }
    while(linkVerificationCache.size>LINK_CACHE_MAX_ENTRIES){
      const oldest=linkVerificationCache.keys().next().value;
      linkVerificationCache.delete(oldest);
    }
  }
  function cachedLinkResult(url,{bypass=false,internal}={}){
    if(bypass)return null;
    const hit=linkVerificationCache.get(url);
    if(!hit)return null;
    if(!Number.isFinite(Number(hit.expiresAt))||Date.now()>hit.expiresAt){linkVerificationCache.delete(url);return null}
    if(typeof internal==='boolean'&&Boolean(hit.internal)!==internal)return null;
    const ageMs=Math.max(0,Date.now()-Number(hit.verifiedAt||0));
    return{...hit.result,cached:true,cacheHit:true,verifiedAt:hit.verifiedAt,ageMs};
  }
  function cacheLinkResult(url,result,{internal=true}={}){
    const ttl=cacheTtlMs(result,internal);
    if(!ttl)return;
    const verifiedAt=Date.now();
    const stored={result:{...result,cached:false},expiresAt:verifiedAt+ttl,verifiedAt,internal:!!internal};
    linkVerificationCache.set(url,stored);
    const finalUrl=result.result?.finalUrl;
    if(finalUrl&&finalUrl!==url&&result.verificationState==='healthy'){
      linkVerificationCache.set(finalUrl,stored);
    }
    pruneLinkCache();
  }
  function hydrateLinkCache(entries=[]){
    const ts=Date.now();
    for(const row of (Array.isArray(entries)?entries:[]).slice(0,LINK_CACHE_MAX_ENTRIES)){
      const key=String(row?.url||'');
      if(!key||!row?.result)continue;
      try{if(!/^https?:$/i.test(new URL(key).protocol))continue}catch{continue}
      const expiresAt=Number(row.expiresAt);
      if(!Number.isFinite(expiresAt)||expiresAt<=ts)continue;
      const internal=row.internal!==false;
      if(cacheTtlMs(row.result,internal)<=0)continue;
      linkVerificationCache.set(key,{result:{...row.result,cached:false},expiresAt,verifiedAt:Number(row.verifiedAt)||ts,internal});
    }
    pruneLinkCache();
  }
  function exportLinkCache({pageUrl=''}={}){
    pruneLinkCache();
    let pageOrigin='';
    try{pageOrigin=pageUrl?new URL(pageUrl).origin:''}catch{pageOrigin=''}
    return[...linkVerificationCache.entries()].flatMap(([url,row])=>{
      if(pageOrigin&&row.internal!==false){
        try{if(new URL(url).origin!==pageOrigin)return[]}catch{return[]}
      }
      return[{url,result:row.result,verifiedAt:row.verifiedAt,expiresAt:row.expiresAt,internal:row.internal}];
    });
  }
  function observeProtocol(url){
    try{
      const entries=performance.getEntriesByName(url,'resource')||[];
      const last=entries[entries.length-1];
      return String(last?.nextHopProtocol||'');
    }catch{return ''}
  }
  async function cancelBody(res){
    try{if(res?.body?.cancel)await res.body.cancel()}catch{}
  }
  async function probeOnce(url,{timeoutMs=3500,internal=true,method='GET'}={}){
    const controller=new AbortController(),started=performance.now();
    const timer=setTimeout(()=>controller.abort('probe-timeout'),timeoutMs);
    const verb=String(method||'GET').toUpperCase()==='HEAD'?'HEAD':'GET';
    try{
      const res=await fetch(url,{method:verb,redirect:'follow',credentials:internal?'same-origin':'omit',cache:'no-cache',keepalive:true,signal:controller.signal,headers:{'Accept':'text/html,application/xhtml+xml,application/json;q=0.8,*/*;q=0.5'}});
      await cancelBody(res);
      return{state:'complete',status:res.status,finalUrl:res.url||url,redirected:res.redirected,durationMs:Math.round(performance.now()-started),method:verb,protocol:observeProtocol(res.url||url)};
    }catch(error){
      const message=error?.message||'request failed';
      const aborted=error?.name==='AbortError';
      const reason=String(controller.signal?.reason||error?.cause||'');
      let state='unavailable';
      if(aborted){
        state=(reason==='probe-cancelled'||reason==='scanner-cancelled')?'cancelled':'timeout';
      }else if(/redirect/i.test(message))state='redirect-error';
      return{state,status:0,error:message,errorName:error?.name||'',abortReason:aborted?(reason||'abort'):'',finalUrl:url,durationMs:Math.round(performance.now()-started),method:verb};
    }finally{clearTimeout(timer)}
  }
  function headNeedsGet(result){
    if(!result||result.state!=='complete')return true;
    const status=Number(result.status||0);
    if([405,501,400,403,401,429].includes(status))return true;
    if(status===0)return true;
    return false;
  }
  async function probeUrl(url,{timeoutMs=3500,internal=true,preferHead=true}={}){
    if(preferHead){
      const head=await probeOnce(url,{timeoutMs,internal,method:'HEAD'});
      if(head.state==='complete'&&!headNeedsGet(head)){
        const status=Number(head.status||0);
        // Confirm missing/server-error over GET so mishandled HEAD cannot become a false broken link.
        if(status===404||status===410||status>=500){
          const get=await probeOnce(url,{timeoutMs,internal,method:'GET'});
          get.priorMethod='HEAD';
          return get;
        }
        return head;
      }
      const get=await probeOnce(url,{timeoutMs,internal,method:'GET'});
      get.priorMethod='HEAD';
      get.headStatus=head.status||0;
      get.headState=head.state;
      return get;
    }
    return probeOnce(url,{timeoutMs,internal,method:'GET'});
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
  function hostOfUrl(url){
    try{return new URL(url).host}catch{return ''}
  }
  function emptyHostProbeState(){
    return{state:'healthy',inFlight:0,consecutive429:0,consecutive403:0,consecutiveTimeout:0,inferCause:'',originClass:'external'};
  }
  function originOfUrl(url){
    try{return new URL(url).origin}catch{return ''}
  }
  function emptyOriginBucket(){
    return{eligible:0,attempted:0,healthy:0,broken:0,inconclusive:0,unprobed:0};
  }
  function percentile(values,p){
    if(!values.length)return 0;
    const sorted=[...values].sort((a,b)=>a-b);
    const idx=Math.min(sorted.length-1,Math.max(0,Math.ceil(p*sorted.length)-1));
    return Math.round(sorted[idx]||0);
  }
  function average(values){
    if(!values.length)return 0;
    return Math.round(values.reduce((s,n)=>s+n,0)/values.length);
  }
  function compactHostDiagnostics(hosts,limit=8){
    const rows=[...hosts.values()].map(row=>{
      const durations=row.durations||[];
      const problems=(row.timeouts||0)+(row.status429||0)+(row.status5xx||0)+(row.networkFailures||0);
      return{
        host:row.host,
        originClass:row.originClass||'external',
        jobs:row.jobs||0,
        completed:row.completed||0,
        timeouts:row.timeouts||0,
        '429s':row.status429||0,
        '5xx':row.status5xx||0,
        networkFailures:row.networkFailures||0,
        averageDurationMs:average(durations),
        p95DurationMs:percentile(durations,.95),
        maxDurationMs:durations.length?Math.round(Math.max(...durations)):0,
        maxConcurrencyObserved:row.maxConcurrencyObserved||0,
        _score:problems*1000+Math.max(...durations,0)
      };
    }).sort((a,b)=>b._score-a._score).slice(0,limit);
    return rows.map(({_score,...rest})=>rest);
  }
  async function runPrimaryVerificationQueue(entries,{
    globalConcurrency=LINK_PROBE_CONCURRENCY,
    perHostConcurrency=LINK_PROBE_EXTERNAL_PER_HOST_CONCURRENCY,
    targetOriginConcurrency=LINK_PROBE_TARGET_ORIGIN_CONCURRENCY,
    externalPerHostConcurrency=LINK_PROBE_EXTERNAL_PER_HOST_CONCURRENCY,
    timeoutMs=LINK_PROBE_TIMEOUT_MS,
    retryTimeoutMs=LINK_PROBE_RETRY_TIMEOUT_MS,
    emergencyMs=LINK_PROBE_EMERGENCY_MS,
    targetOrigin='',
    onProgress=null
  }={}){
    const n=entries.length;
    const results=new Array(n);
    const claimed=new Uint8Array(n);
    let pendingCount=n;
    let globalInFlight=0;
    let maxGlobalInFlight=0;
    let maxPerHostInFlight=0;
    let maxTargetOriginInFlight=0;
    let maxExternalPerHostInFlight=0;
    let completed=0;
    let emergencyFired=false;
    const pageOrigin=targetOrigin||(()=>{try{return location.origin}catch{return ''}})();
    const totalCeiling=Math.max(2,Math.min(LINK_PROBE_CONCURRENCY,Number(globalConcurrency)||LINK_PROBE_CONCURRENCY));
    const externalCap=Math.max(1,Number(externalPerHostConcurrency||perHostConcurrency||LINK_PROBE_EXTERNAL_PER_HOST_CONCURRENCY));
    const targetStart=Math.max(externalCap,Number(targetOriginConcurrency||LINK_PROBE_TARGET_ORIGIN_CONCURRENCY));
    let targetCap=Math.min(targetStart,totalCeiling);
    const emergencyAt=performance.now()+Number(emergencyMs||LINK_PROBE_EMERGENCY_MS);
    const hosts=new Map();
    const hostDiag=new Map();
    const targetDurations=[];
    let consecutiveTarget429=0,consecutiveTarget5xx=0,consecutiveTargetNet=0;
    let waiters=[];
    function hostState(host){
      if(!hosts.has(host))hosts.set(host,emptyHostProbeState());
      return hosts.get(host);
    }
    function diag(host,originClass){
      if(!hostDiag.has(host))hostDiag.set(host,{host,originClass,jobs:0,completed:0,timeouts:0,status429:0,status5xx:0,networkFailures:0,durations:[],maxConcurrencyObserved:0});
      return hostDiag.get(host);
    }
    function notify(){
      const q=waiters;waiters=[];
      for(const resolve of q)resolve();
    }
    function waitForSlot(){
      return new Promise(resolve=>{waiters.push(resolve)});
    }
    function emitProgress(){
      onProgress?.({queued:n,completed,attempted:completed+globalInFlight,inFlight:globalInFlight,pending:pendingCount});
    }
    function relatedHostName(a,b){
      const al=String(a||'').split('.').filter(Boolean);
      const bl=String(b||'').split('.').filter(Boolean);
      if(al.length<2||bl.length<2)return false;
      return al.slice(-2).join('.')===bl.slice(-2).join('.');
    }
    function originClassFor(url){
      try{
        const u=new URL(url);
        if(pageOrigin&&u.origin===pageOrigin)return'target';
        const pageHost=pageOrigin?new URL(pageOrigin).hostname:'';
        if(pageHost&&relatedHostName(u.hostname,pageHost))return'related';
        return'external';
      }catch{return'external'}
    }
    function hostCap(originClass){
      return originClass==='target'?Math.max(2,effectiveTargetCap()):externalCap;
    }
    function remainingExternalJobs(phaseClaimed){
      let left=0;
      for(let i=0;i<n;i++){
        if(phaseClaimed[i])continue;
        if(originClassFor(entries[i].url)!=='target')left++;
      }
      return left;
    }
    function effectiveTargetCap(){
      const withExternal=remainingExternal>0?LINK_PROBE_TARGET_WITH_EXTERNAL_CEILING:LINK_PROBE_TARGET_ORIGIN_CEILING;
      return Math.max(2,Math.min(targetCap,withExternal,LINK_PROBE_TARGET_ORIGIN_CEILING));
    }
    function queuePriority(job){
      const oc=originClassFor(job.url);
      if(oc==='target'){
        try{
          const u=new URL(job.url);
          if(u.pathname===location.pathname&&u.search===location.search)return 3;
        }catch{}
        return 1;
      }
      if(oc==='related')return 2;
      return 4;
    }
    entries.sort((a,b)=>queuePriority(a)-queuePriority(b));
    const claimOrder=[];
    const methodCounts={HEAD:0,GET:0};
    const protocolCounts={h2:0,h3:0,http1:0,other:0};
    let cacheHits=0,cacheMisses=0,primaryAttemptCount=0,refinementCount=0;
    let targetBusyMs=0,targetPoolStarted=0;
    let remainingExternal=entries.filter(e=>originClassFor(e.url)!=='target').length;
    function noteMethod(result){
      const attempts=result?.attempts?.length?result.attempts:[result?.result].filter(Boolean);
      for(const row of attempts){
        const m=String(row?.method||'GET').toUpperCase();
        if(m==='HEAD')methodCounts.HEAD++;
        else methodCounts.GET++;
        const proto=String(row?.protocol||'').toLowerCase();
        if(proto==='h3'||proto==='http/3')protocolCounts.h3++;
        else if(proto==='h2'||proto==='http/2')protocolCounts.h2++;
        else if(proto==='http/1.1'||proto==='http/1.0')protocolCounts.http1++;
        else if(proto)protocolCounts.other++;
      }
    }
    function nextTargetStep(cap){
      const steps=[6,8,10,12];
      const found=steps.find(s=>s>cap);
      if(found!=null)return Math.min(found,LINK_PROBE_TARGET_ORIGIN_CEILING);
      return Math.min(cap+2,LINK_PROBE_TARGET_ORIGIN_CEILING);
    }
    let targetHealthyStreak=0;
    function adaptTarget(verified,originClass){
      if(originClass!=='target')return;
      const status=Number(verified?.result?.status||0);
      const state=String(verified?.result?.state||'');
      const duration=Number(verified?.result?.durationMs||0);
      const cause=String(verified?.cause||'');
      if(status===429||cause==='rate-limited'){
        consecutiveTarget429++;
        if(consecutiveTarget429>=2){targetCap=Math.max(2,Math.floor(targetCap/2));targetHealthyStreak=0}
      }else consecutiveTarget429=0;
      if(status>=500){
        consecutiveTarget5xx++;
        if(consecutiveTarget5xx>=2){targetCap=Math.max(2,Math.floor(targetCap/2));targetHealthyStreak=0}
      }else consecutiveTarget5xx=0;
      if(state==='unavailable'||cause==='network-failure'||/reset|econnreset/i.test(String(verified?.result?.error||''))){
        consecutiveTargetNet++;
        if(consecutiveTargetNet>=3){targetCap=Math.max(2,Math.floor(targetCap/2));targetHealthyStreak=0}
      }else consecutiveTargetNet=0;
      if(duration>0){
        targetDurations.push(duration);
        if(targetDurations.length>=8){
          const baseline=average(targetDurations.slice(0,6));
          const recent=average(targetDurations.slice(-6));
          if(baseline>0&&recent>baseline*2.2&&recent>1800){targetCap=Math.max(2,Math.floor(targetCap/2));targetHealthyStreak=0}
        }
      }
      const healthy=status>=200&&status<400&&state!=='timeout'&&state!=='unavailable';
      if(healthy){
        targetHealthyStreak++;
        if(targetHealthyStreak>=LINK_PROBE_HEALTHY_WINDOW&&targetCap<LINK_PROBE_TARGET_ORIGIN_CEILING){
          targetCap=Math.min(nextTargetStep(targetCap),totalCeiling,LINK_PROBE_TARGET_ORIGIN_CEILING);
          targetHealthyStreak=0;
        }
      }else if(status>0||state==='timeout')targetHealthyStreak=0;
    }
    function shouldRefine(verified){
      if(!verified)return false;
      const state=String(verified.verificationState||'');
      if(state==='healthy'||state==='confirmed-failure'||state==='unprobed')return false;
      const status=Number(verified.result?.status||0);
      const cause=String(verified.cause||'');
      if([401,403,429].includes(status)||cause==='rate-limited'||cause==='remote-blocked')return false;
      return state==='inconclusive';
    }
    function noteHostOutcome(host,verified){
      const hs=hostState(host);
      const status=Number(verified?.result?.status||0);
      const cause=String(verified?.cause||'');
      if(status===429||cause==='rate-limited'){
        hs.consecutive429++;
        if(hs.consecutive429>=3){hs.state='throttled';hs.inferCause='rate-limited'}
      }else hs.consecutive429=0;
      if([401,403].includes(status)||cause==='remote-blocked'){
        hs.consecutive403++;
        if(hs.consecutive403>=3){hs.state='remote-blocked';hs.inferCause='remote-blocked'}
      }else hs.consecutive403=0;
      if(verified?.result?.state==='timeout'||cause==='scanner-timeout'){
        hs.consecutiveTimeout++;
        if(hs.consecutiveTimeout>=4&&hs.state==='healthy'){hs.state='throttled';hs.inferCause='scanner-timeout'}
      }else hs.consecutiveTimeout=0;
    }
    function recordDiag(host,originClass,verified){
      const row=diag(host,originClass);
      row.completed++;
      const status=Number(verified?.result?.status||0);
      const state=String(verified?.result?.state||'');
      const duration=Number(verified?.result?.durationMs||0);
      if(duration>0)row.durations.push(duration);
      if(state==='timeout'||verified?.cause==='scanner-timeout')row.timeouts++;
      if(status===429)row.status429++;
      if(status>=500)row.status5xx++;
      if(verified?.cause==='network-failure'||state==='unavailable')row.networkFailures++;
    }
    function claimJob(phaseClaimed,poolKind){
      if(!pendingCount)return null;
      if(globalInFlight>=totalCeiling)return null;
      let blockedByHost=false;
      for(let i=0;i<n;i++){
        if(phaseClaimed[i])continue;
        const job=entries[i];
        const originClass=originClassFor(job.url);
        const isTarget=originClass==='target';
        if(poolKind==='target'&&!isTarget)continue;
        if(poolKind==='external'&&isTarget)continue;
        const host=hostOfUrl(job.url);
        const hs=hostState(host);
        hs.originClass=originClass;
        if(hs.state==='throttled'||hs.state==='remote-blocked'){
          phaseClaimed[i]=1;pendingCount--;
          claimOrder.push(originClass);
          return{index:i,job,host,hs,originClass,inferred:true};
        }
        if(poolKind==='external'){
          const externalInFlight=[...hosts.values()].filter(h=>h.originClass!=='target').reduce((s,h)=>s+h.inFlight,0);
          if(externalInFlight>=LINK_PROBE_EXTERNAL_GLOBAL){blockedByHost=true;continue}
        }else if(hs.inFlight>=effectiveTargetCap()){blockedByHost=true;continue}
        if(!isTarget&&hs.inFlight>=externalCap){blockedByHost=true;continue}
        phaseClaimed[i]=1;pendingCount--;
        claimOrder.push(originClass);
        return{index:i,job,host,hs,originClass,inferred:false};
      }
      return blockedByHost?null:null;
    }
    function probeTimeoutFor(originClass){
      if(originClass!=='target')return timeoutMs;
      if(Number(timeoutMs)>0&&Number(timeoutMs)<LINK_PROBE_TIMEOUT_MS)return Number(timeoutMs);
      return Math.max(timeoutMs,LINK_PROBE_TARGET_TIMEOUT_MS);
    }
    async function verifyPrimary(job,originClass){
      const cached=cachedLinkResult(job.url,{internal:job.internal!==false});
      if(cached){cacheHits++;return cached}
      cacheMisses++;
      primaryAttemptCount++;
      const first=await probeUrl(job.url,{timeoutMs:probeTimeoutFor(originClass),internal:job.internal!==false});
      if(probeClass(first)==='healthy'){
        const verified={verificationState:'healthy',confidence:'confirmed',result:first,attempts:[first]};
        cacheLinkResult(job.url,verified,{internal:job.internal!==false});
        return verified;
      }
      const status=Number(first?.status||0);
      if([401,403,429].includes(status)){
        return{verificationState:'inconclusive',confidence:'inconclusive',result:first,attempts:[first],cause:status===429?'rate-limited':'remote-blocked'};
      }
      return{verificationState:'inconclusive',confidence:'inconclusive',result:first,attempts:[first],cause:inconclusiveCause({},{...first},{internal:job.internal!==false})};
    }
    async function verifyRefinement(job,originClass,prior){
      refinementCount++;
      const first=prior?.result||await probeUrl(job.url,{timeoutMs:probeTimeoutFor(originClass),internal:job.internal!==false});
      const verified=await verifyLink(job.url,first,{
        retryTimeoutMs,
        thirdTimeoutMs:retryTimeoutMs,
        degraded:false,
        internal:job.internal!==false
      });
      cacheLinkResult(job.url,verified,{internal:job.internal!==false});
      return verified;
    }
    async function runPool(phaseClaimed,poolKind,phase,workerCount){
      async function worker(){
        while(pendingCount>0||globalInFlight>0){
          if(performance.now()>=emergencyAt){emergencyFired=true;notify();break}
          const claimedJob=claimJob(phaseClaimed,poolKind);
          if(!claimedJob){
            if(!pendingCount)break;
            const wait=waitForSlot();
            const timeout=new Promise(resolve=>setTimeout(resolve,16));
            await Promise.race([wait,timeout]);
            continue;
          }
          const {index,job,host,hs,originClass,inferred}=claimedJob;
          const stats=diag(host,originClass);
          stats.jobs++;
          if(inferred){
            const cause=hs.state==='remote-blocked'?'remote-blocked':hs.inferCause||(hs.state==='throttled'?'rate-limited':'scanner-timeout');
            results[index]={
              verificationState:'inconclusive',
              confidence:'inconclusive',
              result:{state:'host-throttled',status:0,finalUrl:job.url,durationMs:0},
              attempts:[],
              cause,
              hostInferred:true,
              originClass
            };
            stats.completed++;
            completed++;
            if(originClass!=='target')remainingExternal=Math.max(0,remainingExternal-1);
            emitProgress();
            notify();
            continue;
          }
          const busyStarted=performance.now();
          hs.inFlight++;
          globalInFlight++;
          maxGlobalInFlight=Math.max(maxGlobalInFlight,globalInFlight);
          maxPerHostInFlight=Math.max(maxPerHostInFlight,hs.inFlight);
          stats.maxConcurrencyObserved=Math.max(stats.maxConcurrencyObserved,hs.inFlight);
          if(originClass==='target')maxTargetOriginInFlight=Math.max(maxTargetOriginInFlight,hs.inFlight);
          else maxExternalPerHostInFlight=Math.max(maxExternalPerHostInFlight,hs.inFlight);
          emitProgress();
          try{
            const verified=phase==='refinement'
              ?await verifyRefinement(job,originClass,results[index])
              :await verifyPrimary(job,originClass);
            verified.originClass=originClass;
            results[index]=verified;
            noteMethod(verified);
            noteHostOutcome(host,verified);
            recordDiag(host,originClass,verified);
            adaptTarget(verified,originClass);
          }catch{
            results[index]={
              verificationState:'inconclusive',
              confidence:'inconclusive',
              result:{state:'unavailable',status:0,finalUrl:job.url,durationMs:0,error:'probe-failed'},
              attempts:[],
              cause:'network-failure',
              originClass
            };
            recordDiag(host,originClass,results[index]);
          }finally{
            if(originClass==='target')targetBusyMs+=performance.now()-busyStarted;
            if(originClass!=='target')remainingExternal=Math.max(0,remainingExternal-1);
            hs.inFlight--;
            globalInFlight--;
            if(phase==='primary')completed++;
            emitProgress();
            notify();
          }
        }
      }
      const count=Math.min(Math.max(1,workerCount),Math.max(1,n));
      if(n)await Promise.all(Array.from({length:count},()=>worker()));
    }
    async function runPhase(phase){
      const phaseClaimed=new Uint8Array(n);
      pendingCount=0;
      for(let i=0;i<n;i++){
        if(phase==='primary'){
          phaseClaimed[i]=0;
          pendingCount++;
        }else if(shouldRefine(results[i])){
          phaseClaimed[i]=0;
          pendingCount++;
        }else phaseClaimed[i]=1;
      }
      if(!pendingCount)return;
      remainingExternal=0;
      for(let i=0;i<n;i++){
        if(!phaseClaimed[i]&&originClassFor(entries[i].url)!=='target')remainingExternal++;
      }
      const targetWorkers=Math.min(LINK_PROBE_TARGET_ORIGIN_CEILING,totalCeiling,n);
      const externalWorkers=Math.min(LINK_PROBE_EXTERNAL_GLOBAL,totalCeiling,n);
      await Promise.all([
        runPool(phaseClaimed,'target',phase,targetWorkers),
        runPool(phaseClaimed,'external',phase,externalWorkers)
      ]);
    }
    const primaryStarted=performance.now();
    targetPoolStarted=primaryStarted;
    if(n)await runPhase('primary');
    const primaryMs=Math.round(performance.now()-primaryStarted);
    const refineStarted=performance.now();
    if(n&&!emergencyFired)await runPhase('refinement');
    const refinementMs=Math.round(performance.now()-refineStarted);
    for(let i=0;i<n;i++){
      if(results[i])continue;
      results[i]={
        verificationState:'unprobed',
        confidence:'unprobed',
        result:null,
        attempts:[],
        budgetExhausted:true,
        cause:'scanner-budget-aborted',
        originClass:originClassFor(entries[i]?.url)
      };
    }
    const targetPoolMs=Math.max(1,Math.round(performance.now()-targetPoolStarted));
    return{
      results,
      metrics:{
        maxGlobalInFlight,
        maxPerHostInFlight,
        maxTargetOriginInFlight,
        maxExternalPerHostInFlight,
        targetOriginConcurrencyStart:targetStart,
        targetOriginConcurrencyEnd:targetCap,
        targetOriginConcurrencyPeak:maxTargetOriginInFlight,
        externalPerHostConcurrency:externalCap,
        externalGlobalConcurrency:LINK_PROBE_EXTERNAL_GLOBAL,
        emergencyFired,
        completed:results.filter(r=>r&&r.verificationState!=='unprobed').length,
        pendingAtEnd:results.filter(r=>r?.verificationState==='unprobed').length,
        completion:emergencyFired?'emergency':'queue-empty',
        terminationReason:emergencyFired?'emergency-deadline':'queue-drained',
        claimOrder:claimOrder.slice(0,160),
        hostDiagnostics:compactHostDiagnostics(hostDiag),
        primaryAttemptCount,
        refinementCount,
        cacheHits,
        cacheMisses,
        methods:methodCounts,
        protocols:protocolCounts,
        primaryMs,
        refinementMs,
        targetIdleWorkerMs:Math.max(0,Math.round((targetPoolMs*Math.max(1,maxTargetOriginInFlight))-targetBusyMs)),
        averageTargetWorkers:maxTargetOriginInFlight?Math.round((targetBusyMs/targetPoolMs)*10)/10:0
      }
    };
  }
  async function verifyLink(url,first,{retryTimeoutMs=7000,thirdTimeoutMs=8000,degraded=false,internal=true}={}){
    const attempts=[first];
    const firstClass=probeClass(first);
    if(firstClass==='healthy')return{verificationState:'healthy',confidence:'confirmed',result:first,attempts};
    const firstStatus=Number(first?.status||0);
    if([401,403,429].includes(firstStatus)){
      return{verificationState:'inconclusive',confidence:'inconclusive',result:first,attempts,cause:firstStatus===429?'rate-limited':'remote-blocked'};
    }
    // External timeout/opaque failures rarely gain evidence from a same-origin browser retry.
    if(!internal&&(first.state==='timeout'||first.state==='cancelled'||first.state==='unavailable'||firstStatus===0)){
      const isCorsLike=first.errorName==='TypeError'||/cors|opaque|failed to fetch|typeerror/i.test(String(first.error||''));
      const cause=first.state==='timeout'?'scanner-timeout':first.state==='cancelled'?'scanner-cancelled':isCorsLike?'cors-or-opaque':'network-failure';
      return{verificationState:'inconclusive',confidence:'inconclusive',result:first,attempts,cause};
    }
    const second=await probeUrl(url,{timeoutMs:degraded?Math.max(retryTimeoutMs,8000):retryTimeoutMs,internal,preferHead:false});
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
      const third=await probeUrl(url,{timeoutMs:thirdTimeoutMs,internal,preferHead:false});
      attempts.push(third);
      const thirdClass=probeClass(third);
      if(thirdClass==='healthy')return{verificationState:'healthy',confidence:'confirmed',result:third,attempts};
      if(thirdClass===oneFailure[0]){
        return{verificationState:'confirmed-failure',confidence:'confirmed',failureClass:thirdClass,result:third,attempts};
      }
    }
    const last=attempts[attempts.length-1];
    return{verificationState:'inconclusive',confidence:'inconclusive',result:last,attempts,cause:inconclusiveCause({},{...last},{internal})};
  }
  function invalidateCachedLink(url){
    const hit=linkVerificationCache.get(url);
    linkVerificationCache.delete(url);
    const finalUrl=hit?.result?.result?.finalUrl;
    if(finalUrl)linkVerificationCache.delete(finalUrl);
  }
  async function recheckLink(url,{timeoutMs=4500,retryTimeoutMs=8000}={}){
    let internal=true;try{internal=new URL(url).origin===location.origin}catch{}
    invalidateCachedLink(url);
    const first=await probeUrl(url,{timeoutMs,internal,preferHead:true});
    const result=await verifyLink(url,first,{retryTimeoutMs,thirdTimeoutMs:retryTimeoutMs,degraded:false,internal});
    cacheLinkResult(url,result,{internal});
    return {
      url,
      verificationState:result.verificationState,
      confidence:result.confidence,
      failureClass:result.failureClass||'',
      status:result.result?.status||0,
      finalUrl:result.result?.finalUrl||url,
      cacheBypass:true,
      attempts:(result.attempts||[]).map((a,index)=>({attempt:index+1,state:a.state,status:a.status||0,durationMs:a.durationMs||0,finalUrl:a.finalUrl||url,method:a.method||'GET'}))
    };
  }

  function inconclusiveCause(verified={},result={},{internal=true}={}){
    if(verified.budgetExhausted||result.state==='budget-exhausted')return'scanner-budget-aborted';
    if(result.state==='cancelled')return'scanner-cancelled';
    if(result.state==='timeout')return'scanner-timeout';
    const status=Number(result.status||0);
    if(status===429)return'rate-limited';
    if([401,403].includes(status))return'remote-blocked';
    const err=String(result.error||'');
    if(!internal&&(result.state==='unavailable'||status===0)){
      // A structured error name is a more reliable CORS/opaque signal than message
      // text, which varies by browser build/locale and can silently fall through
      // to the generic network-failure bucket, hiding the real cause in diagnostics.
      if(result.errorName==='TypeError'||/failed to fetch|networkerror|cors|opaque|typeerror/i.test(err))return'cors-or-opaque';
      return'network-failure';
    }
    if(result.state==='unavailable'||status===0)return'network-failure';
    if(/not supported|unsupported/i.test(err))return'unsupported-probe';
    if(status>0)return'ambiguous-response';
    return'other';
  }

  function collectLinkAnchors(){
    const anchors=[];
    const pushDoc=(doc)=>{
      if(!doc)return;
      try{anchors.push(...doc.querySelectorAll('a[href]'))}catch{}
    };
    pushDoc(document);
    for(const rec of (lastFrameRecords||collectFrameRecords())){
      if(rec.accessible&&rec.doc)pushDoc(rec.doc);
    }
    return anchors;
  }

  async function auditLinks({
    limit=LINK_PROBE_HARD_CEILING,
    concurrency=LINK_PROBE_CONCURRENCY,
    perHostConcurrency=LINK_PROBE_EXTERNAL_PER_HOST_CONCURRENCY,
    targetOriginConcurrency=LINK_PROBE_TARGET_ORIGIN_CONCURRENCY,
    externalPerHostConcurrency=LINK_PROBE_EXTERNAL_PER_HOST_CONCURRENCY,
    timeoutMs=LINK_PROBE_TIMEOUT_MS,
    retryTimeoutMs=LINK_PROBE_RETRY_TIMEOUT_MS,
    budgetMs,
    emergencyMs,
    onProgress=null,
    cacheSeed=null
  }={}){
    if(Array.isArray(cacheSeed)&&cacheSeed.length)hydrateLinkCache(cacheSeed);
    const allGroups=new Map();
    for(const a of collectLinkAnchors()){
      const classified=classifyLink(a);if(!classified)continue;
      const {url,internal}=classified;
      if(!allGroups.has(url))allGroups.set(url,{url,internal,anchors:[],frames:new Set()});
      const group=allGroups.get(url);
      group.anchors.push(a);
      const frameCtx=frameContextFor(a);
      group.frames.add(frameCtx?.embeddedContext||'top-document');
    }
    const discovered=allGroups.size;
    const reachedLimit=discovered>limit;
    const entries=[...allGroups.values()].slice(0,limit);
    const unprobedByLimit=Math.max(0,discovered-entries.length);
    const emergencyDeadline=Number(emergencyMs??budgetMs??LINK_PROBE_EMERGENCY_MS);
    const startedAt=performance.now();
    const pageOrigin=(()=>{try{return location.origin}catch{return ''}})();
    const queued=await runPrimaryVerificationQueue(entries,{
      globalConcurrency:concurrency,
      perHostConcurrency:externalPerHostConcurrency||perHostConcurrency,
      targetOriginConcurrency,
      externalPerHostConcurrency:externalPerHostConcurrency||perHostConcurrency,
      timeoutMs,
      retryTimeoutMs,
      emergencyMs:emergencyDeadline,
      targetOrigin:pageOrigin,
      onProgress
    });
    const verificationResults=queued.results;
    const qm=queued.metrics||{};
    const primaryLinkMs=Number(qm.primaryMs)||Math.round(performance.now()-startedAt);
    const refinementLinkMs=Number(qm.refinementMs)||0;

    const findings=[],incompleteChecks=[],externalCandidates=[],unprobedChecks=[];
    let healthy=0,confirmedIssues=0,cachedCount=0,inconclusiveCount=0,scannerAborted=0;
    const inconclusiveByCause={
      total:0,
      scannerBudgetAborted:0,
      scannerTimeout:0,
      scannerCancelled:0,
      remoteBlocked:0,
      rateLimited:0,
      corsOrOpaque:0,
      networkFailure:0,
      unsupportedProbe:0,
      ambiguousResponse:0,
      other:0
    };
    const causeKey=cause=>{
      if(cause==='scanner-budget-aborted')return'scannerBudgetAborted';
      if(cause==='scanner-timeout')return'scannerTimeout';
      if(cause==='scanner-cancelled')return'scannerCancelled';
      if(cause==='remote-blocked')return'remoteBlocked';
      if(cause==='rate-limited')return'rateLimited';
      if(cause==='cors-or-opaque')return'corsOrOpaque';
      if(cause==='network-failure')return'networkFailure';
      if(cause==='unsupported-probe')return'unsupportedProbe';
      if(cause==='ambiguous-response')return'ambiguousResponse';
      return'other';
    };
    const linksByOriginClass={targetOrigin:emptyOriginBucket(),related:emptyOriginBucket(),external:emptyOriginBucket()};
    const originBucket=url=>{
      const oc=(()=>{try{
        const u=new URL(url);
        if(u.origin===pageOrigin)return'targetOrigin';
        const pageHost=pageOrigin?new URL(pageOrigin).hostname:'';
        const host=u.hostname;
        const a=host.split('.').filter(Boolean);
        const b=String(pageHost||'').split('.').filter(Boolean);
        if(a.length>=2&&b.length>=2&&a.slice(-2).join('.')===b.slice(-2).join('.'))return'related';
        return'external';
      }catch{return'external'}})();
      return oc;
    };
    const destinations=entries.map(entry=>({
      url:entry.url,
      internal:!!entry.internal,
      originClass:originBucket(entry.url)==='targetOrigin'?'target':originBucket(entry.url)
    })).slice(0,240);
    entries.forEach((entry,i)=>{
      const verified=verificationResults[i]||{verificationState:'inconclusive',confidence:'inconclusive',attempts:[]};
      const bucket=linksByOriginClass[originBucket(entry.url)];
      bucket.eligible++;
      if(verified.cached)cachedCount++;
      if(verified.verificationState==='unprobed'){
        bucket.unprobed++;
        let path='';try{path=new URL(entry.url).pathname}catch{path=entry.url}
        unprobedChecks.push({kind:entry.internal?'internal-link':'external-link',url:entry.url,path,text:'',reason:'probe-budget-exhausted',cause:'scanner-budget-aborted',status:0,attempts:[]});
        return;
      }
      bucket.attempted++;
      const first=pickVisibleAnchor(entry.anchors),ctx=linkContext(first);
      const sources=entry.anchors.slice(0,12).map(a=>({...linkContext(a),selector:selectorFor(a),scope:frameContextFor(a)?.embeddedContext||'top-document'}));
      const result=verified.result||verified.attempts?.[verified.attempts.length-1]||{status:0,state:'unavailable',finalUrl:entry.url};
      const attemptEvidence=(verified.attempts||[]).map((a,index)=>({attempt:index+1,state:a.state,status:a.status||0,durationMs:a.durationMs||0,finalUrl:a.finalUrl||entry.url,errorClass:a.errorName||''}));
      const method=entry.internal?'same-origin browser GET with independent retry':'cross-origin GET with independent retry';
      const extra={link:{url:entry.url,internal:!!entry.internal,sourceUrl:location.href,status:result.status||0,state:result.state||'unknown',finalUrl:result.finalUrl||entry.url,redirected:!!result.redirected,occurrences:entry.anchors.length,sources,scope:[...entry.frames][0]||'top-document',frames:[...entry.frames],...ctx},verification:{state:verified.verificationState,method,attempts:attemptEvidence.length,evidence:attemptEvidence}};
      if(verified.verificationState==='healthy'){healthy++;bucket.healthy++;return}
      if(verified.verificationState==='inconclusive'){
        inconclusiveCount++;
        bucket.inconclusive++;
        const cause=verified.cause||inconclusiveCause(verified,result,{internal:entry.internal!==false});
        inconclusiveByCause.total++;
        inconclusiveByCause[causeKey(cause)]++;
        if(cause==='scanner-budget-aborted')scannerAborted++;
        const kind=entry.internal?'internal-link':'external-link';
        let path='';try{path=new URL(entry.url).pathname}catch{path=entry.url}
        const inconclusiveReason=result.status?`http-${result.status}`:(result.state&&result.state!=='complete'?result.state:'unavailable');
        incompleteChecks.push({kind,url:entry.url,path,text:ctx.text||'',reason:inconclusiveReason,cause,status:result.status||0,attempts:attemptEvidence,prominence:ctx.prominence||'',location:ctx.location||''});
        const reviewStatus=Number(result.status||0);
        if([401,403,429].includes(reviewStatus)){
          const dest=entry.internal?path:entry.url;
          const label=reviewStatus===429?'rate-limited':reviewStatus===401?'unauthorized':'forbidden';
          findings.push(finding({
            ruleId:entry.internal?'navigation.link-review':'navigation.link-review-external',
            title:entry.internal?`Internal link returned a ${label} response`:`External link returned a ${label} response`,
            detail:`${ctx.text?`"${ctx.text}" `:''}points to ${dest}. Independent requests received HTTP ${reviewStatus}. This is not treated as a broken link.`,
            category:'review',severity:'low',element:first,evidence:`http-${reviewStatus} ${entry.url}`,count:entry.anchors.length,
            confidence:'inconclusive',verification:{...extra.verification,state:'inconclusive'},extra
          }));
        }
        // Host inference from in-page timeouts/CORS reflects page-context limits, not the
        // destination. The gateway probes from a different vantage, so those links still
        // deserve escalation. Only hosts that explicitly signalled 401/403/429 stay excluded,
        // since hammering a host that already told us to back off gains no new evidence.
        const escalatableInference=!verified.hostInferred||!['remote-blocked','rate-limited'].includes(verified.cause);
        if(!entry.internal&&escalatableInference&&(result.state==='unavailable'||result.status===0||result.state==='timeout')){
          externalCandidates.push({url:entry.url,text:ctx.text||'',occurrences:entry.anchors.length,sources,prominence:ctx.prominence||'',location:ctx.location||'',selector:selectorFor(first)});
        }
        return;
      }
      confirmedIssues++;
      bucket.broken++;
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
    const attempted=healthy+confirmedIssues+inconclusiveCount;
    const unprobed=unprobedByLimit+unprobedChecks.length;
    const eligible=discovered;
    const explicitlySkipped=0;
    const probeBudgetPreventedCoverage=unprobed>0||scannerAborted>0;
    const coverageState=probeBudgetPreventedCoverage?'partial':'complete';
    const emptyRefinement={eligible:0,queued:0,attempted:0,resolvedHealthy:0,resolvedBroken:0,stillInconclusive:0,notAttempted:0,budgetAborted:0,truncated:false};
    const originCounts={targetOrigin:linksByOriginClass.targetOrigin.eligible,related:linksByOriginClass.related.eligible,external:linksByOriginClass.external.eligible};
    const perOrigin=(qm.hostDiagnostics||[]).slice(0,8).map(row=>({
      host:row.host,
      originClass:row.originClass,
      p50DurationMs:row.averageDurationMs||0,
      p95DurationMs:row.p95DurationMs||0,
      maxDurationMs:row.maxDurationMs||row.p95DurationMs||0,
      maxConcurrencyObserved:row.maxConcurrencyObserved||0
    }));
    return{
      findings,
      discovered,eligible,attempted,checked:attempted,verifiedHealthy:healthy,confirmedIssues,
      inconclusive:inconclusiveCount,unprobed,explicitlySkipped,scannerAborted,
      inconclusiveByCause,
      incompleteChecks,unprobedChecks,externalCandidates,limit,reachedLimit,cached:cachedCount,
      budgetExhausted:probeBudgetPreventedCoverage,
      probeBudgetReached:reachedLimit||unprobed>0||queued.metrics.emergencyFired,
      probeBudgetPreventedCoverage,
      status:coverageState,
      queueMetrics:queued.metrics,
      linksByOriginClass,
      destinations,
      hostDiagnostics:queued.metrics.hostDiagnostics||[],
      queueTerminationReason:queued.metrics.terminationReason||queued.metrics.completion||'',
      primaryLinkMs,
      refinementLinkMs,
      cacheExport:exportLinkCache(),
      linkExecution:{
        uniqueUrls:discovered,
        targetOriginUrls:originCounts.targetOrigin,
        relatedHostUrls:originCounts.related,
        externalUrls:originCounts.external,
        primaryAttemptCount:Number(qm.primaryAttemptCount||attempted),
        refinementCount:Number(qm.refinementCount||0),
        gatewayFallbackCount:0,
        cacheHits:Number(qm.cacheHits||cachedCount||0),
        cacheMisses:Number(qm.cacheMisses||0),
        methods:qm.methods||{HEAD:0,GET:0},
        protocols:qm.protocols||undefined,
        targetConcurrency:{start:qm.targetOriginConcurrencyStart,peak:qm.maxTargetOriginInFlight,final:qm.targetOriginConcurrencyEnd},
        externalPeakConcurrency:qm.maxExternalPerHostInFlight,
        primaryMs:primaryLinkMs,
        refinementMs:refinementLinkMs,
        queueTerminationReason:qm.terminationReason||qm.completion||'',
        perOrigin
      },
      refinement:{
        ...emptyRefinement,
        eligible:Number(qm.refinementCount||0),
        queued:Number(qm.refinementCount||0),
        attempted:Number(qm.refinementCount||0)
      }
    };
  }
  function applyExternalProbeResults(candidates=[], probeRows=[]){
    const byUrl=new Map((probeRows||[]).map(r=>[String(r.url||''),r]));
    const findings=[],incompleteChecks=[],resolvedUrls=new Set();
    for(const candidate of candidates||[]){
      const row=byUrl.get(candidate.url);
      if(!row)continue;
      const status=Number(row.status||0);
      const method=String(row.method||'GET').toUpperCase()==='HEAD'?'HEAD':'GET';
      const attemptsCount=Math.max(1,Number(row.attempts||1));
      let liveAnchors=[...document.querySelectorAll('a[href]')].filter(a=>{
        try{const c=classifyLink(a);return c&&c.url===candidate.url}catch{return false}
      });
      if(!liveAnchors.length){
        liveAnchors=[{nodeType:1,localName:'a',tagName:'A',id:'',classList:{length:0},parentElement:null,innerText:candidate.text||'',className:'',getAttribute(name){return name==='href'?candidate.url:null},hasAttribute(){return false},closest(){return null},getBoundingClientRect(){return{x:0,y:0,width:0,height:0}}}];
      }
      const first=pickVisibleAnchor(liveAnchors),ctx={text:candidate.text||'',location:candidate.location||'body',prominence:candidate.prominence||'normal',...linkContext(first)};
      const sources=candidate.sources||[{...ctx,selector:candidate.selector||selectorFor(first)}];
      const attempt={attempt:attemptsCount,state:status?'complete':'unavailable',status,method,durationMs:Number(row.durationMs||0),finalUrl:row.finalUrl||candidate.url};
      const confirmationOk=(status===404||status===410||status>=500)?(method==='GET'&&attemptsCount>=2):true;
      const extra={link:{url:candidate.url,internal:false,sourceUrl:location.href,status,state:status?'complete':'unavailable',finalUrl:row.finalUrl||candidate.url,redirected:!!row.redirected,occurrences:Number(candidate.occurrences||liveAnchors.length||1),sources,...ctx},verification:{state:'confirmed',method:method==='HEAD'?'privileged external HEAD':'privileged external GET',attempts:attemptsCount,evidence:[attempt]}};
      if((status===404||status===410)&&confirmationOk){
        findings.push(finding({ruleId:`navigation.link-${status===410?410:404}-external`,title:'External link points to a missing page',detail:`${ctx.text?`"${ctx.text}" `:''}points to ${candidate.url}. Privileged GET requests confirmed HTTP ${status}.`,category:'fix',severity:'high',element:first,evidence:`confirmed ${status} ${candidate.url}`,count:Number(candidate.occurrences||liveAnchors.length||1),confidence:'confirmed',verification:{...extra.verification,method:'privileged external GET'},extra}));
        resolvedUrls.add(candidate.url);continue;
      }
      if(status>=500&&confirmationOk){
        findings.push(finding({ruleId:'navigation.link-5xx-external',title:'External link points to a server error',detail:`${ctx.text?`"${ctx.text}" `:''}points to ${candidate.url}. Privileged GET requests confirmed a server error.`,category:'fix',severity:'critical',element:first,evidence:`confirmed ${status} ${candidate.url}`,count:Number(candidate.occurrences||1),confidence:'confirmed',verification:{...extra.verification,method:'privileged external GET'},extra}));
        resolvedUrls.add(candidate.url);continue;
      }
      if(status>=200&&status<400){resolvedUrls.add(candidate.url);continue}
      // No TLS-specific cause here on purpose, unlike safe-probe.js's Node-side
      // pinnedFetch (which reads error.cause.code and can emit a dedicated
      // navigation.link-insecure-external finding). This branch runs entirely
      // in the page's own browser context, where fetch() collapses every TLS
      // failure into the same generic TypeError as a CORS failure — the
      // browser deliberately does not expose certificate error codes to page
      // JS. There is no client-side signal to branch on, so falling through
      // to 'cors-or-opaque'/'network-failure' is the correct, honest outcome,
      // not a gap to mirror the server-side branch into.
      incompleteChecks.push({kind:'external-link',url:candidate.url,path:candidate.url,text:candidate.text||'',reason:status?`http-${status}`:(row.error||'unavailable'),cause:status===429?'rate-limited':[401,403].includes(status)?'remote-blocked':(!status&&/cors|opaque|failed to fetch/i.test(String(row.error||'')))?'cors-or-opaque':(!status?'network-failure':'ambiguous-response'),status,attempts:[attempt],prominence:candidate.prominence||'',location:candidate.location||''});
      if([401,403,429].includes(status)){
        const label=status===429?'rate-limited':status===401?'unauthorized':'forbidden';
        findings.push(finding({
          ruleId:'navigation.link-review-external',
          title:`External link returned a ${label} response`,
          detail:`${ctx.text?`"${ctx.text}" `:''}points to ${candidate.url}. Privileged GET received HTTP ${status}. This is not treated as a broken link.`,
          category:'review',severity:'low',element:first,evidence:`http-${status} ${candidate.url}`,count:Number(candidate.occurrences||liveAnchors.length||1),
          confidence:'inconclusive',verification:{...extra.verification,state:'inconclusive'},extra
        }));
      }
      resolvedUrls.add(candidate.url);
    }
    return{findings,incompleteChecks,resolvedUrls:[...resolvedUrls]};
  }

  /**
   * Gateway-confirmed external link findings (safe-probe.js, running in Node
   * with no DOM) can only carry a plain CSS selector captured at escalation
   * time — for a plain body-text link with no class or id, selectorFor()
   * degrades to just "a", which matches every link on the page. Once the
   * gateway's result is back, the page is still right here, so re-resolve the
   * matching anchor by its actual URL (unambiguous) and register a real
   * targetId + fingerprint for it, the same way every other finding type
   * already gets one. Highlight then has a specific element to point at
   * instead of "the first <a> tag anywhere".
   */
  function reconcileGatewayLinkTargets(findings=[]){
    const patches=[];
    for(const f of findings||[]){
      if(!f||f.targetId||f.targetType!=='visual'||!f.link?.url||f.link?.internal)continue;
      let el=null;
      try{
        const matches=[...document.querySelectorAll('a[href]')].filter(a=>{
          try{return classifyLink(a)?.url===f.link.url}catch{return false}
        });
        el=pickVisibleAnchor(matches);
      }catch{el=null}
      if(!el)continue;
      const targetId=registerTarget(el,`${f.ruleId}|${f.fingerprint||f.id}`);
      if(!targetId)continue;
      patches.push({id:f.id,targetId,selector:selectorFor(el)});
    }
    return patches;
  }

  function merge(local,axeResults,linkResult={findings:[],checked:0}){
    const findings=[...local.findings,...axeFindings(axeResults),...(linkResult.findings||[])],seen=new Map();
    for(const f of findings){const key=`${f.ruleId}|${f.selector}|${f.evidence}`;if(!seen.has(key))seen.set(key,f)}
    const unprobed=Number(linkResult.unprobed||0);
    const attempted=Number(linkResult.attempted ?? linkResult.checked ?? 0);
    const scannerAborted=Number(linkResult.scannerAborted||0);
    const probeBudgetPreventedCoverage=linkResult.probeBudgetPreventedCoverage===true
      || unprobed>0
      || scannerAborted>0;
    const discoveredKnown = linkResult.discovered != null && linkResult.discovered !== '';
    const linksStatus=linkResult.status==='unavailable'?'unavailable'
      :probeBudgetPreventedCoverage?'partial'
      :attempted===0&&discoveredKnown&&Number(linkResult.discovered||0)===0?'none_checked'
      :discoveredKnown||attempted>0?'complete'
      :'unavailable';
    const diagBound=Boolean(globalThis.__WEBQA_PAGE_DIAG_BOUND__||globalThis.__WEBQA_PAGE_DIAGNOSTICS__||globalThis.__WEBQA_RUNTIME_ERRORS__);
    const bucket=globalThis.__WEBQA_RUNTIME_ERRORS__;
    let runtimeStatus=local.coverage?.runtime||'not applicable';
    let coverageScope={...(local.coverageScope||{})};
    if(bucket?.source==='renderer')runtimeStatus='renderer';
    else if(diagBound||bucket){
      runtimeStatus='complete';
      coverageScope={...coverageScope,runtime:'post-injection-extension'};
    }
    const linkAudit={
      discovered:Number(linkResult.discovered ?? linkResult.checked ?? 0),
      eligible:Number(linkResult.eligible ?? linkResult.discovered ?? linkResult.checked ?? 0),
      attempted,
      checked:attempted,
      verifiedHealthy:linkResult.verifiedHealthy||0,
      confirmedIssues:linkResult.confirmedIssues||0,
      inconclusive:linkResult.inconclusive||0,
      unprobed,
      explicitlySkipped:Number(linkResult.explicitlySkipped||0),
      scannerAborted,
      inconclusiveByCause:linkResult.inconclusiveByCause||undefined,
      incompleteChecks:linkResult.incompleteChecks||[],
      unprobedChecks:linkResult.unprobedChecks||[],
      reachedLimit:!!linkResult.reachedLimit,
      degraded:!!linkResult.degraded,
      cached:linkResult.cached||0,
      budgetExhausted:probeBudgetPreventedCoverage,
      probeBudgetReached:!!linkResult.probeBudgetReached||!!linkResult.reachedLimit||unprobed>0,
      probeBudgetPreventedCoverage,
      privilegedFallback:linkResult.privilegedFallback,
      refinement:linkResult.refinement,
      queueMetrics:linkResult.queueMetrics,
      linksByOriginClass:linkResult.linksByOriginClass,
      destinations:linkResult.destinations||[],
      hostDiagnostics:linkResult.hostDiagnostics,
      queueTerminationReason:linkResult.queueTerminationReason||linkResult.queueMetrics?.terminationReason,
      primaryLinkMs:Number(linkResult.primaryLinkMs||0)||undefined,
      refinementLinkMs:Number(linkResult.refinementLinkMs||0)||undefined,
      linkExecution:linkResult.linkExecution||undefined
    };
    const scanTimings={
      ...(local.scanTimings||{}),
      linkProbeMs:Number(linkResult.primaryLinkMs||0)+Number(linkResult.refinementLinkMs||0)||Number(local.scanTimings?.linkProbeMs||0)
    };
    return{...local,browserPerformance:local.browserPerformance||null,findings:[...seen.values()],linkAudit,coverage:{...local.coverage,links:linksStatus,axe:axeResults?'complete':'unavailable',runtime:runtimeStatus},coverageScope,scanTimings,diagnostics:local.diagnostics||null,pageDiagnostics:local.pageDiagnostics||null};
  }

  function recordRuntimeErrors(payload){
    const count=Math.max(0,Math.min(20,Number(payload?.count||0)));
    const samples=Array.isArray(payload?.samples)?payload.samples.slice(0,20).map(s=>({
      kind:'page_error',
      message:clip(s?.message,240),
      source:sanitizeResourceUrl(s?.source||'',220),
      line:Number(s?.line)||0
    })):[];
    globalThis.__WEBQA_RUNTIME_ERRORS__={count,samples,source:'renderer'};
  }

  globalThis.WebQARules={run,axeFindings,resolvedTargetState,validateResolvedTarget,auditLinks,recheckLink,applyExternalProbeResults,reconcileGatewayLinkTargets,merge,recordRuntimeErrors,hydrateLinkCache,exportLinkCache,clearLinkCache(){linkVerificationCache.clear()},selectorFor,resolveTarget,performanceSignals,preparePerformanceSignals,prepareSafeInteractions,semanticContextFor,targetContextFor(targetId,selector='',ruleId=''){
    const validated=validateResolvedTarget(targetId,selector,{ruleId});
    if(!validated.found)return {found:false,targetStatus:validated.targetStatus,reason:validated.reason};
    const el=validated.el;
    const style=getComputedStyle(el),rect=el.getBoundingClientRect();
    return{found:true,targetStatus:'valid',tag:el.tagName.toLowerCase(),selector:selector||selectorFor(el),markup:clip(cleanMarkup(el.outerHTML),1400),text:clip(el.innerText||el.textContent,500),semantics:semanticContextFor(el,ruleId),rect:{x:Math.round(rect.x),y:Math.round(rect.y),width:Math.round(rect.width),height:Math.round(rect.height)},styles:{color:style.color,backgroundColor:style.backgroundColor,fontSize:style.fontSize,fontWeight:style.fontWeight,lineHeight:style.lineHeight,display:style.display,position:style.position}};
  }};
})();