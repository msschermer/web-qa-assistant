// Purpose-aware image guidance. The deterministic classifier decides what the
// image is for; this only turns that verdict into an implementation instruction.
// When the classifier says "uncertain" the fork is correct and is kept.
function imageAdvice(f){
  const p=f.semantics?.imagePurpose||f.imagePurpose||null;
  const purpose=String(p?.purpose||'uncertain');
  const nearby=String(p?.nearbyText||p?.descriptor?.siblingText||'').trim();
  const rationale=String(p?.rationale||'');
  const base={
    impact:'Images without an appropriate text alternative can lose meaning for screen-reader users, or add noise when they repeat what is already written.',
    verify:'Rerun the accessibility scan and confirm the rule no longer fails, then check the accessibility tree exposes the intended name.'
  };
  if(purpose==='decorative'&&p?.confidence!=='low')return{
    ...base,
    interpretation:nearby?`This image reinforces the adjacent text "${nearby}" and does not appear to carry information of its own.`:(rationale||'The available evidence points to a presentational image rather than content.'),
    recommendation:'Set alt="" on this image so assistive technology skips it.',
    remediation:'Set alt="" on this image so assistive technology skips it. Do not write descriptive text here, because the adjacent visible text already communicates the meaning and announcing both would repeat content.',
    alternatives:'A descriptive alt would be correct only if this image conveys something the surrounding text does not. The evidence does not support that here.',
    verify:'Confirm the image is ignored in the accessibility tree while the adjacent text remains exposed, then rerun the scan.'
  };
  if(purpose==='functional')return{
    ...base,
    interpretation:'This image is the entire accessible name of an interactive control, so it names an action rather than a picture.',
    recommendation:'Give the control a name that describes what it does.',
    remediation:'Set alt to the destination or action, not a description of the artwork. For a logo linking home, "Home" or the site name is right; for an icon button, name the action it performs.',
    alternatives:'An empty alt would leave the control unnamed, so it is not an option here.',
    verify:'Tab to the control and confirm a screen reader announces the intended action, then rerun the scan.'
  };
  if(purpose==='complex')return{
    ...base,
    interpretation:'This image appears to carry structured information that a short alternative cannot fully replace.',
    recommendation:'Provide a short alt plus a longer description nearby.',
    remediation:'Add a concise alt naming what the image shows, then provide the underlying detail in adjacent text, a caption, or a linked long description so the information is available without the image.',
    alternatives:'A single short alt is acceptable only if the surrounding copy already states the data the image shows.',
    verify:'Confirm the essential information is reachable as text, then rerun the scan.'
  };
  if(purpose==='informative')return{
    ...base,
    interpretation:rationale||'This image is presented at content scale with no adjacent text equivalent, so it likely carries meaning of its own.',
    recommendation:'Add concise alt text describing what the image communicates.',
    remediation:'Add alt text that conveys the same essential information the image provides in this context. Describe purpose rather than appearance, and keep it short.',
    alternatives:'An empty alt would be correct only if the meaning is already stated in nearby text.',
    verify:'Confirm the alt reads sensibly when substituted for the image, then rerun the scan.'
  };
  return{
    ...base,
    interpretation:'The available evidence does not settle whether this image carries information of its own, so the correct alt depends on intent.',
    recommendation:'Decide whether this image adds meaning, then apply the matching alt.',
    remediation:'If the image conveys something the surrounding text does not, add concise alt text describing that meaning. If it only reinforces adjacent text or is purely visual, set alt="" so assistive technology skips it.',
    alternatives:'Frank is presenting both branches because the page evidence genuinely supports either one.',
    verify:'Rerun the accessibility scan and confirm the rule no longer fails for this element.'
  };
}
function contrastFactsFromFinding(f){
  for(const bucket of ['any','all','none'])for(const check of f.axe?.checks?.[bucket]||[]){
    const d=check?.data;if(d&&typeof d==='object'&&(d.contrastRatio!=null||d.expectedContrastRatio!=null||d.fgColor||d.bgColor))return d;
  }
  return null;
}
function contrastRatio(value){
  const text=String(value??'').trim();
  if(!text)return'';
  return /:1$/.test(text)?text:`${text}:1`;
}
function hexRgb(value){const m=String(value||'').trim().match(/^#([0-9a-f]{6})$/i);if(!m)return null;return[0,2,4].map(i=>parseInt(m[1].slice(i,i+2),16))}
function rgbHex(rgb){return'#'+rgb.map(v=>Math.max(0,Math.min(255,Math.round(v))).toString(16).padStart(2,'0')).join('')}
function luminance(rgb){const c=rgb.map(v=>{const n=v/255;return n<=.04045?n/12.92:Math.pow((n+.055)/1.055,2.4)});return .2126*c[0]+.7152*c[1]+.0722*c[2]}
function ratioFor(a,b){const l1=luminance(a),l2=luminance(b),hi=Math.max(l1,l2),lo=Math.min(l1,l2);return(hi+.05)/(lo+.05)}
function nearestPassingForeground(fgValue,bgValue,requiredValue){const fg=hexRgb(fgValue),bg=hexRgb(bgValue),required=parseFloat(String(requiredValue||'').replace(':1',''));if(!fg||!bg||!Number.isFinite(required)||required<=1||ratioFor(fg,bg)>=required)return'';const candidates=[];for(const target of [[0,0,0],[255,255,255]]){if(ratioFor(target,bg)<required)continue;let low=0,high=1;for(let i=0;i<24;i++){const mid=(low+high)/2,mix=fg.map((v,j)=>v+(target[j]-v)*mid);if(ratioFor(mix,bg)>=required)high=mid;else low=mid}let rgb=fg.map((v,j)=>Math.max(0,Math.min(255,Math.round(v+(target[j]-v)*high))));for(let i=0;i<256&&ratioFor(rgb,bg)<required;i++)rgb=rgb.map((v,j)=>v===target[j]?v:v+Math.sign(target[j]-v));if(ratioFor(rgb,bg)<required)continue;const distance=rgb.reduce((sum,v,j)=>sum+(v-fg[j])**2,0);candidates.push({hex:rgbHex(rgb),distance})}return candidates.sort((a,b)=>a.distance-b.distance)[0]?.hex||''}
function axeAdvice(f){
  const id=String(f.ruleId||'');
  const summary=String(f.axe?.failureSummary||'').replace(/^Fix (?:any|all) of the following:\s*/i,'').trim();
  if(/color-contrast/.test(id)){
    const c=contrastFactsFromFinding(f)||{},text=String(f.targetText||'').trim(),label=text?`The affected text "${text.slice(0,80)}"`:'The affected text';
    const observed=c.contrastRatio!=null?contrastRatio(c.contrastRatio):'below the required threshold',required=c.expectedContrastRatio!=null?contrastRatio(c.expectedContrastRatio):'the applicable WCAG threshold';
    const colors=c.fgColor&&c.bgColor?` The computed foreground is ${c.fgColor} against ${c.bgColor}.`:'';
    const passing=c.fgColor&&c.bgColor&&c.expectedContrastRatio!=null?nearestPassingForeground(c.fgColor,c.bgColor,c.expectedContrastRatio):'';
    const concrete=passing?` A nearby passing foreground is ${passing} against the current background; use that as a starting point or choose the equivalent approved design token.`:'';
    return{
      interpretation:`${label} has an observed contrast ratio of ${observed}; this check requires ${required}.${colors}`,
      impact:'Insufficient text contrast can make content difficult to read for people with low vision and in low-contrast viewing conditions.',
      recommendation:`Increase the contrast between this text and its background while preserving the component state and visual hierarchy.${concrete}`,
      remediation:summary||`Make the smallest foreground or background token change that brings this exact pair to the required ratio.${concrete} Recheck other states that reuse the same colors.`,
      verify:'Rerun the accessibility scan on the same element and confirm the color-contrast rule no longer appears. Also check hover, focus, disabled, and other component states.'
    };
  }
  if(/label|button-name|link-name|aria.*name|input.*name/.test(id))return{
    impact:'An interactive control without a reliable accessible name can be ambiguous or unusable to screen-reader and voice-control users.',
    remediation:summary||'Give the affected control a programmatically determinable accessible name using visible label text where possible, or an appropriate aria-label/aria-labelledby relationship when visible text is not available.',
    verify:'Rerun axe, then inspect the control accessibility tree or use a screen reader to confirm the intended accessible name is announced.'
  };
  if(/image-alt|role-img|input-image|object-alt|area-alt/.test(id))return imageAdvice(f);
  return{
    impact:'This is a deterministic accessibility finding from axe. The impact depends on the affected component and rule, but it can create a barrier for assistive-technology, keyboard, or low-vision users.',
    remediation:summary||`Apply the correction described by the ${f.title||'axe'} rule to the affected markup or styling. Use the exact failing element and diagnostic evidence rather than changing unrelated page code.`,
    verify:'Rerun axe after the change and confirm this exact rule no longer fails for the affected element. Perform a quick manual interaction check when the rule concerns semantics or keyboard behavior.'
  };
}
const DEFAULT_INTERPRETATION='Frank is reporting the verified finding as the deterministic engine classified it.';
function normalizeGuidance(g){
  if(!g)return null;
  return{
    interpretation:g.interpretation||DEFAULT_INTERPRETATION,
    impact:g.impact||'',
    recommendation:g.recommendation||g.remediation||'',
    remediation:g.remediation||'',
    alternatives:g.alternatives||'',
    verify:g.verify||'',
    limitations:g.limitations||''
  };
}
export function guidanceFor(f,environment={type:'unknown'}){return normalizeGuidance(rawGuidanceFor(f,environment))}
function rawGuidanceFor(f,environment={type:'unknown'}){
  const id=String(f.ruleId||'');
  if(/noindex/.test(id)){
    if(['staging','preview','local'].includes(environment.type))return{impact:'Index blocking is normally appropriate for this non-production environment.',remediation:'No production fix is recommended here. Keep the environment out of search indexes unless your deployment policy says otherwise.',verify:'Before or after publishing to production, scan the production URL and confirm no unintended noindex directive remains.'};
    return{impact:'A noindex directive can prevent a production page from being included in search results.',remediation:'Remove noindex from the source that publishes it. Check both the HTML robots meta tag and X-Robots-Tag response headers, then confirm templates or SEO plugins are not re-adding it.',verify:'Rescan the production URL and confirm Browser, Meta State, and response-header evidence no longer contain noindex.'};
  }
  if(/broken-link|link-404|link-410/.test(id)){
    const label=f.link?.text?`"${f.link.text}"`:'The affected internal link';
    const location=f.link?.location?` in the ${f.link.location}`:'';
    const occurrences=Number(f.link?.occurrences||1);
    const occurrenceNote=occurrences>1?` This destination is referenced ${occurrences} times on the current page, so update every occurrence or fix the shared component/template that generates them.`:'';
    return{impact:`${label}${location} sends visitors and crawlers to a missing destination instead of the intended content.`,remediation:`Update the link to the correct live destination, restore the missing page if it should exist, or add an appropriate server redirect when the content permanently moved.${occurrenceNote}`,verify:'Open the corrected link from the source page, confirm the destination returns a successful response without an unintended redirect chain, then rescan the source page. Frank should verify the destination successfully before the finding disappears.'};
  }
  if(/link-5xx/.test(id))return{impact:'The linked internal destination is returning a server error, so visitors cannot reliably reach it.',remediation:'Resolve the server/application error on the destination first. If the URL is obsolete, update the source link to a healthy destination rather than leaving navigation pointed at a failing endpoint.',verify:'Confirm the destination returns a successful response repeatedly, then rescan the source page.'};
  if(/link-redirect-error/.test(id))return{impact:'The internal destination could not complete its redirect sequence on repeated browser requests. Visitors and crawlers may be trapped in a loop or encounter an invalid redirect chain.',remediation:'Inspect the redirect rules for the destination and every intermediate URL. Remove loops, circular www/non-www or HTTP/HTTPS rules, and conflicting application/server redirects so the URL reaches one intended final destination.',verify:'Open the destination directly in a fresh browser navigation, confirm it reaches the intended page without a loop, then rescan the source page and verify Frank can complete the redirect.'};
  if(/canonical-mismatch/.test(id))return{impact:'Different canonical values can give crawlers conflicting URL-consolidation signals.',remediation:'Choose the intended canonical URL and make the initial published HTML and rendered browser state emit the same absolute canonical.',verify:'Rescan and confirm Browser and Meta State report the same canonical URL.'};
  if(/canonical-missing/.test(id))return{impact:'Without an explicit canonical, crawlers must infer the preferred URL when duplicate or parameterized variants exist.',remediation:'If this page should self-canonicalize, publish one absolute canonical URL in the document head. If your platform intentionally omits canonicals, confirm that strategy before changing it.',verify:'Rescan and confirm the intended canonical appears exactly once and resolves to the preferred URL.'};
  if(/canonical-multiple/.test(id))return{impact:'Multiple canonical declarations can make the preferred-URL signal ambiguous.',remediation:'Keep one canonical declaration for the intended preferred URL and remove duplicate or conflicting canonical tags generated by themes, plugins, or application code.',verify:'Rescan and confirm exactly one canonical is present and matches the intended URL.'};
  if(/canonical-invalid/.test(id))return{interpretation:'The canonical declaration cannot be used as a normal HTTP(S) preferred URL in its current form.',impact:'An invalid canonical can be ignored by crawlers and weakens URL-consolidation signals.',recommendation:'Publish one valid absolute HTTP or HTTPS canonical URL.',remediation:'Correct the canonical href at its publishing source. Use the intended absolute HTTP(S) URL and remove malformed, unsupported-scheme, or unparsable values.',verify:'Reload and rescan the page, then confirm the canonical parses successfully and resolves to the intended preferred URL.'};
  if(/canonical-cross-host/.test(id))return{interpretation:'The rendered canonical points to a different hostname. That can be intentional for syndicated or consolidated content, so this remains a review finding.',impact:'An unintended cross-host canonical can tell crawlers to consolidate this page into a different site.',recommendation:'Confirm the destination host is intentional before changing anything.',remediation:'If the cross-host canonical is unintended, replace it with the preferred URL on this site. If it is intentional, document the consolidation strategy and leave it in place.',verify:'Rescan and confirm the canonical host matches the intended consolidation strategy.'};
  if(/canonical-fragment/.test(id))return{interpretation:'The canonical includes an in-page fragment even though canonicalization normally identifies the document URL.',impact:'Fragments are not useful canonical targets and can create a noisy or ignored preferred-URL signal.',recommendation:'Remove the fragment from the canonical URL.',remediation:'Publish the canonical as the intended document URL without the #fragment portion.',verify:'Rescan and confirm the canonical contains no fragment and still points to the intended document.'};
  if(/title-missing/.test(id))return{impact:'A missing document title weakens browser, search-result, and assistive-technology context.',recommendation:'Publish one descriptive document title.',remediation:'Add a single title element that identifies the page purpose and distinguishes it from other pages on the site.',verify:'Reload and rescan; confirm exactly one meaningful title is present.'};
  if(/title-multiple/.test(id))return{impact:'Multiple title elements can cause inconsistent document naming across user agents and crawlers.',recommendation:'Keep one intended document title.',remediation:'Remove duplicate title output from the theme, SEO layer, or application template so the rendered head contains one title element.',verify:'Reload and rescan; confirm exactly one title remains.'};
  if(/title-short/.test(id))return{interpretation:'The title is unusually short, which is an optimization review rather than a deterministic defect.',impact:'An underspecified title can provide weak context in search results, browser tabs, and shared links.',recommendation:'Review whether the title clearly identifies this page without adding filler for length alone.',remediation:'If the title is vague, revise it to state the page topic and relevant differentiator naturally. Do not pad it only to satisfy a character target.',verify:'Review the rendered title for clarity and uniqueness, then rescan.'};
  if(/description-missing/.test(id))return{interpretation:'No meta description was observed. Search engines may still generate their own snippet, so this is optimization context rather than proof of a ranking problem.',impact:'A missing description removes one opportunity to provide a deliberate search-result summary.',recommendation:'Add a useful description when this page benefits from a controlled summary.',remediation:'Publish one concise meta description that accurately summarizes the page and gives searchers a reason to click. Avoid boilerplate duplication.',verify:'Reload and rescan; confirm one intended description is present.'};
  if(/description-multiple/.test(id))return{impact:'Multiple descriptions can make the intended search snippet signal ambiguous.',recommendation:'Keep one intended meta description.',remediation:'Remove duplicate description tags generated by overlapping templates, plugins, or application code.',verify:'Reload and rescan; confirm exactly one description remains.'};
  if(/robots-block-all/.test(id)){
    if(['staging','preview','local'].includes(environment.type))return{impact:'Blocking crawlers is normally appropriate for this non-production environment.',remediation:'No production fix is recommended on this host. Keep the environment blocked unless your deployment policy says otherwise.',verify:'Scan the real production hostname separately and confirm its robots.txt does not inherit the staging Disallow: / rule.'};
    return{impact:'A global Disallow: / rule can prevent compliant crawlers from crawling the production site.',remediation:'Remove or narrow the global Disallow rule in the production robots.txt. Make sure the production deployment is not inheriting a staging robots file or environment variable.',verify:'Fetch robots.txt from the production hostname and confirm the global block is gone, then rescan with Meta State and Frank.'};
  }
  if(/robots-mismatch|robots-conflict/.test(id))return{impact:'Conflicting indexing directives make crawler behavior unpredictable and can hide content unintentionally.',remediation:'Resolve the directives at their publishing sources so HTML robots metadata and response headers agree on the intended indexing state.',verify:'Rescan and confirm Browser and published-state evidence report one consistent robots policy.'};
  if(/jsonld-invalid/.test(id))return{impact:'Invalid JSON-LD cannot be reliably parsed by consumers of structured data.',remediation:'Correct the JSON syntax in the exact failing JSON-LD block. Validate commas, quoting, braces, and generated values before changing the schema semantics.',verify:'Rescan and confirm the JSON-LD parses successfully, then validate the resulting schema entity separately.'};
  if(/duplicate-id/.test(id))return{impact:'Duplicate IDs can cause labels, ARIA references, fragment links, CSS selectors, and scripts to resolve to the wrong element.',remediation:'Give each duplicated ID a unique value, then update every for, aria-labelledby, aria-describedby, fragment link, CSS selector, and script reference that points to the renamed ID.',verify:'Rescan and confirm the duplicate-ID finding is gone, then test any form labels or scripted interactions that referenced the changed ID.'};
  if(/insecure-form-action/.test(id))return{impact:'A secure page submitting data to HTTP can expose form data in transit and creates mixed-security behavior.',remediation:'Change the form action to a trusted HTTPS endpoint and verify any proxy, CRM, or intake integration accepts HTTPS at that destination.',verify:'Submit a safe test entry and confirm the browser sends the request over HTTPS with the expected success response.'};
  if(/viewport-zoom-restricted/.test(id))return{impact:'Restricting zoom can make content harder to use for people who rely on magnification.',remediation:'Remove user-scalable=no and avoid a maximum-scale setting that prevents meaningful zoom. Let the browser handle user magnification.',verify:'Reload the page on mobile or responsive emulation and confirm pinch/browser zoom works, then rerun the accessibility scan.'};
  if(/viewport-missing/.test(id))return{impact:'Without viewport metadata, responsive layouts may render at an unintended virtual width on mobile devices.',remediation:'Add a standard viewport declaration such as width=device-width, initial-scale=1 unless the application has a deliberate alternative.',verify:'Reload at mobile widths and confirm the layout uses the device width, then rescan.'};
  if(/lang-missing/.test(id))return{impact:'Assistive technology may use the wrong pronunciation rules when the document language is not declared.',remediation:'Set a valid BCP 47 language code on the root html element, such as lang="en" or the appropriate language for the page.',verify:'Rescan and confirm the root html element exposes the intended valid language.'};
  if(/lang-invalid/.test(id))return{impact:'An invalid language tag can prevent user agents from determining the page language reliably.',remediation:'Replace the current html lang value with a valid BCP 47 language tag that matches the primary page language.',verify:'Rescan and confirm the language value validates and matches the content.'};
  if(/h1-missing/.test(id))return{impact:'A missing primary heading can make the page hierarchy less clear to users and assistive technology.',remediation:'Add a meaningful primary page heading when the document has a clear main topic. Do not add an H1 solely to satisfy a checker if the page pattern legitimately has no page-level heading.',verify:'Review the heading outline and confirm the page hierarchy is understandable, then rescan.'};
  if(/h1-multiple/.test(id))return{impact:'Multiple H1 elements can be valid in HTML, so this is a structural review rather than an automatic defect.',remediation:'Review whether each H1 truly represents an independent top-level section. If one is the page title and others are subordinate, change the subordinate headings to the appropriate levels.',verify:'Review the resulting heading outline rather than relying only on the H1 count.'};
  if(/heading-skip/.test(id))return{interpretation:'The rendered heading outline jumps over a level at the affected heading.',impact:'Skipped heading levels can make document structure harder to understand for screen-reader users and people navigating by headings.',recommendation:"Use the heading level that matches this section's structural depth.",remediation:'Adjust the affected heading and, if necessary, surrounding headings so levels progress according to content hierarchy. Choose levels for structure, not visual size.',verify:'Inspect the full heading outline and confirm the hierarchy makes sense, then rescan.'};
  if(/blank-opener/.test(id))return{interpretation:'A link opens a new browsing context without explicitly severing opener access.',impact:'Older or embedded browser contexts can expose the originating window to the opened page, and explicit rel protection makes the security intent clear.',recommendation:'Add rel="noopener" or rel="noreferrer" to the affected target="_blank" link.',remediation:'Add rel="noopener" to preserve the referrer while preventing opener access, or rel="noreferrer" if referrer suppression is also intended.',verify:'Inspect the rendered link and confirm the rel token is present, then rescan.'};
  if(/charset-missing/.test(id))return{interpretation:'No rendered meta charset declaration was observed; the HTTP response may still declare the encoding.',impact:'Ambiguous character encoding can cause incorrect text interpretation in edge cases.',recommendation:'Confirm UTF-8 is declared reliably, preferably in the HTTP Content-Type header and early in the document head.',remediation:'If the response does not already declare UTF-8, add the appropriate response header and/or an early <meta charset="utf-8"> declaration.',verify:'Check the response Content-Type and rendered head, then rescan.'};
  if(/meta-refresh/.test(id))return{interpretation:'The page uses client-side meta refresh for timed navigation or reload.',impact:'Meta refresh can interrupt reading, create unexpected navigation, and complicate accessibility and analytics.',recommendation:'Replace meta refresh with an appropriate server redirect or deliberate application navigation when possible.',remediation:'For a permanent or temporary destination change, use an HTTP 3xx redirect. For application behavior, trigger navigation explicitly and give users control rather than relying on timed refresh.',verify:'Reload the page and confirm the meta refresh is gone and the replacement navigation behaves as intended.'};
  if(/og-incomplete/.test(id))return{interpretation:'One or more core Open Graph title or description fields were not observed.',impact:'Shared links may receive incomplete or platform-generated social previews.',recommendation:'Add the missing Open Graph fields if social sharing is important for this page.',remediation:'Publish an og:title and og:description that accurately represent the page. Keep them aligned with the page content rather than copying unrelated marketing text.',verify:'Rescan and use a social-preview debugger or platform validator to confirm the intended fields are published.'};
  if(id.startsWith('axe.'))return axeAdvice(f);
  if(id==='performance.browser.ttfb')return{interpretation:`This browser observed a time to first byte of ${f.performanceObservation?.ttfbMs??'an elevated'}ms. That isolates the delay to navigation/server response before front-end rendering work.`,impact:'Slow server response delays every later rendering milestone on this navigation.',recommendation:'Investigate origin, application, cache, CDN, and redirect latency before optimizing front-end assets.',remediation:'Check cache status and CDN/origin timing, backend work performed before the response begins, database/API latency, and unnecessary redirect hops. Do not blame JavaScript or image rendering for TTFB without separate evidence.',verify:'Repeat the same navigation under comparable conditions and confirm TTFB improves; compare with monitored history or field data when available.'};
  if(id==='performance.browser.lcp')return{interpretation:`This browser observed LCP at ${f.performanceObservation?.largestContentfulPaintMs!=null?(f.performanceObservation.largestContentfulPaintMs/1000).toFixed(1)+'s':'a slow point'}${f.performanceObservation?.lcpElement?.selector?` on ${f.performanceObservation.lcpElement.selector}`:''}. This is a current lab observation, not a field score.`,impact:'A slow largest contentful paint can make the page feel visually incomplete for users.',recommendation:'Investigate the observed LCP element and the work required before it can render.',remediation:'If the LCP element is an image, inspect its request priority, dimensions, compression, format, preload behavior, and whether CSS/JS delays discovery. If it is text, inspect blocking fonts, CSS, server response, and render-blocking work. Use the observed element rather than applying generic performance changes.',verify:'Repeat the navigation under comparable conditions, confirm LCP improves, and compare with monitored field/history data when available.'};
  if(id==='performance.browser.weight'){const p=f.performanceObservation||{},qualifier=p.transferIsLowerBound?'at least ':'';return{interpretation:`The browser measured ${qualifier}${p.transferBytes!=null?(p.transferBytes/1048576).toFixed(1)+'MB':'a large payload'} of transfer. ${p.unknownTransferCount||0} entries had unknown transfer size, so this is${p.transferIsLowerBound?' a lower bound':' the measurable total for this observation'}.`,impact:'Large transfer payloads can increase load time and data use, especially on slower networks.',recommendation:'Start with the largest measurable resources and resource types rather than optimizing the page indiscriminately.',remediation:'Review the heaviest images, scripts, fonts, and other assets in the evidence. Compress or resize oversized media, remove unnecessary code, split or defer noncritical bundles, and reduce duplicate third-party payloads where the evidence supports it.',verify:'Repeat the navigation with comparable cache/network conditions and confirm known transfer decreases without breaking page behavior.'};}
  if(id.startsWith('performance.'))return{interpretation:'This performance signal is contextual evidence rather than proof of a single code defect.',impact:'A sustained performance regression can indicate a real user-facing change.',recommendation:'Compare this observation with monitored history before assigning a root cause.',remediation:'Profile the relevant performance dimension and investigate changes around the regression window rather than changing code based on one score alone.',verify:'Run another controlled scan after the suspected cause is addressed and compare with monitored field/history data when available.'};
  return{impact:'This finding is supported by the current scan, but it does not yet have enough rule-specific context for Frank to claim a precise implementation impact.',remediation:'Review the evidence and source tool before changing code. Frank should not prescribe a generic implementation change when the available evidence does not identify one safely.',verify:'Rescan after any intentional change and confirm the original evidence no longer reproduces.'};
}
