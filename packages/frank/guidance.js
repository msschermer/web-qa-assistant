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
      remediation:`Make the smallest foreground or background token change that brings this exact pair to the required ratio.${concrete} Recheck other states that reuse the same colors.`,
      verify:'Rerun the accessibility scan on the same element and confirm the color-contrast rule no longer appears. Also check hover, focus, disabled, and other component states.'
    };
  }
  if(/target-size/.test(id)){
    const diagnostic=String(f.axe?.failureSummary||'');
    const size=diagnostic.match(/insufficient size\s*\((\d+(?:\.\d+)?)px by (\d+(?:\.\d+)?)px, should be at least (\d+(?:\.\d+)?)px by (\d+(?:\.\d+)?)px\)/i);
    const spacing=diagnostic.match(/clickable space has a diameter of (\d+(?:\.\d+)?)px instead of at least (\d+(?:\.\d+)?)px/i);
    const label=String(f.targetText||f.semantics?.naming?.ariaLabel||'').trim();
    const target=label?`The highlighted “${label.slice(0,80)}” target`:'The highlighted interactive target';
    const width=size?.[1]||'',height=size?.[2]||'',minimum=Math.max(Number(size?.[3]||0),Number(size?.[4]||0))||24;
    const spacingObserved=spacing?.[1]||'',spacingRequired=spacing?.[2]||String(minimum);
    const measurement=width&&height?` It measures ${width}px by ${height}px; the minimum target-size check is ${minimum}px by ${minimum}px.`:'';
    const spacingText=spacingObserved?` Axe also measured only ${spacingObserved}px of safe clickable spacing where at least ${spacingRequired}px is required for the spacing exception.`:'';
    const heightFix=height&&Number(height)<minimum?` Increase the active height from ${height}px to at least ${minimum}px, preferably with vertical padding or a minimum hit-area height rather than by enlarging the text.`:`Ensure the active area can contain at least ${minimum}px by ${minimum}px.`;
    return{
      interpretation:`${target} is too small or too tightly spaced for the target-size requirement.${measurement}${spacingText}`.trim(),
      impact:'Small or tightly packed pointer targets are easier to miss or activate accidentally, especially for touch, mouse, or stylus users with reduced fine-motor precision or tremors.',
      recommendation:`Make the clickable area meet the ${minimum}px target-size requirement, or provide enough separation to satisfy the spacing exception.`,
      remediation:`${heightFix} If the visual size must stay smaller, increase separation from neighboring interactive targets so a ${spacingRequired}px-diameter safe area around this target does not intersect another target.`,
      verify:`Rerun axe on this target and confirm the target-size rule no longer fails. Verify either that the active area meets ${minimum}px by ${minimum}px or that the spacing exception now passes without overlapping nearby targets.`
    };
  }
  if(/label|button-name|link-name|aria.*name|input.*name/.test(id))return{
    interpretation:'The highlighted control does not expose a reliable accessible name that identifies its purpose.',
    impact:'An interactive control without a reliable accessible name can be ambiguous or unusable to screen-reader and voice-control users.',
    recommendation:'Give the control one clear programmatic name that matches its visible purpose.',
    remediation:summary||'Use visible label text where possible, or an appropriate aria-label/aria-labelledby relationship when visible text is not available. Avoid adding a second competing name source.',
    verify:'Rerun axe, then inspect the control accessibility tree or use a screen reader to confirm the intended accessible name is announced.'
  };
  if(/image-alt|role-img|input-image|object-alt|area-alt/.test(id))return imageAdvice(f);
  if(/focus|keyboard|tabindex/.test(id))return{
    interpretation:summary?`The highlighted element failed a keyboard or focus requirement: ${summary}`:'The highlighted element does not meet the verified keyboard or focus requirement.',
    impact:'A keyboard or focus failure can prevent users who do not use a pointer from reaching, understanding, or operating the control reliably.',
    recommendation:'Restore predictable keyboard access and a clear focus state without changing unrelated interactions.',
    remediation:summary||'Make the smallest markup or focus-management change that satisfies this rule, then confirm the element remains reachable and operable in the expected keyboard order.',
    verify:'Repeat the interaction with the keyboard only, then rerun axe and confirm this exact rule no longer fails.'
  };
  if(/aria-|role|duplicate-id/.test(id))return{
    interpretation:summary?`The element exposes an invalid or conflicting accessibility-semantic state: ${summary}`:'The element exposes accessibility semantics that do not satisfy the verified ARIA requirement.',
    impact:'Invalid or conflicting accessibility semantics can cause assistive technology to announce the wrong role, state, relationship, or name.',
    recommendation:'Correct the semantic attribute or relationship at the affected element instead of adding compensating ARIA elsewhere.',
    remediation:summary||'Fix the specific ARIA role, attribute, value, or referenced relationship identified by axe. Prefer native HTML semantics when they provide the required behavior.',
    verify:'Inspect the accessibility tree after the change, then rerun axe and confirm the same ARIA rule no longer fails.'
  };
  if(/heading|landmark|region|bypass|html-has-lang|html-lang|valid-lang/.test(id))return{
    interpretation:summary?`The page structure does not meet this verified accessibility requirement: ${summary}`:'The page structure does not meet the verified accessibility requirement represented by this rule.',
    impact:'Document structure and language metadata help assistive technology understand page organization and provide efficient navigation.',
    recommendation:'Correct the affected structural or document-level semantic without reshaping unrelated page content.',
    remediation:summary||'Apply the specific structural correction identified by axe at the affected document element, heading, or landmark.',
    verify:'Rerun axe and perform a quick structure check with headings/landmarks or document language exposed in the accessibility tree, as applicable.'
  };
  const title=String(f.title||'this accessibility rule').trim();
  return{
    interpretation:summary?`The highlighted element fails “${title}.” Axe reports: ${summary}`:`The highlighted element fails the verified “${title}” accessibility rule.`,
    impact:'This is a verified accessibility failure, but the available rule evidence does not justify guessing at a specific affected user group or interaction beyond what the rule establishes.',
    recommendation:'Correct the specific failing condition on this element, using the rule diagnostic as the boundary for the change.',
    remediation:summary||`Apply the smallest correction that satisfies “${title}” on the affected element. Do not change unrelated page code simply because it is nearby.`,
    verify:`Rerun axe after the change and confirm “${title}” no longer fails for this element. Add a manual check only when the rule itself depends on interaction or intent.`
  };
}
const DEFAULT_INTERPRETATION='The verified evidence identifies a specific issue on this page; review the highlighted target and the measurements attached to this finding.';
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
function rawGuidanceFor(f,environment={type:'unknown'}){
  const id=String(f.ruleId||'');
  if(/noindex-self-canonical|canonical-path-conflict/.test(id))return{interpretation:'Conflicting discoverability signals need review. The page emits more than one indexing/consolidation cue, and intent cannot be inferred safely from the scan alone.',impact:'Search engines may consolidate or suppress the page differently than editors expect.',recommendation:'Decide the intended indexing and preferred-URL state, then make every publishing layer agree.',remediation:'Choose one intended outcome (indexable self-canonical, noindex, or consolidate elsewhere) and align robots meta, X-Robots-Tag, and canonical declarations. Do not change production indexing based only on this review finding.',verify:'Rescan and confirm Browser and published-state evidence agree on one intentional policy.'};
  if(/noindex/.test(id)){
    if(['staging','preview','local'].includes(environment.type))return{impact:'Index blocking is normally appropriate for this non-production environment.',remediation:'No production fix is recommended here. Keep the environment out of search indexes unless your deployment policy says otherwise.',verify:'Before or after publishing to production, scan the production URL and confirm no unintended noindex directive remains.'};
    return{interpretation:'This production page is publishing a noindex directive, which explicitly tells supporting search engines not to include the page in their index.',impact:'A noindex directive can prevent a production page from being included in search results.',recommendation:'Remove the noindex directive if this page is intended to be discoverable in search.',remediation:'Remove noindex from the source that publishes it. Check both the HTML robots meta tag and X-Robots-Tag response headers, then confirm templates or SEO plugins are not re-adding it.',verify:'Rescan the production URL and confirm Browser, Meta State, and response-header evidence no longer contain noindex.'};
  }
  if(/link-review/.test(id)){
    const external=/external/.test(id)||f.link?.internal===false;
    const status=Number(f.link?.status||0);
    const label=f.link?.text?`"${f.link.text}"`:(external?'An external link':'An internal link');
    const statusNote=status?` Independent requests received HTTP ${status}.`:' The destination could not be fully verified.';
    const kind=status===429?'rate limiting or temporary throttling':status===403||status===401?'access control, auth, or bot filtering':'an incomplete verification outcome';
    return{
      interpretation:`${label} was checked, but the result is inconclusive.${statusNote} Web QA Assistant is not treating this as a confirmed broken link.`,
      impact:`Visitors may still reach the destination, or they may hit ${kind}. Without a confirmed missing-page or server-error response, Frank cannot claim the link is broken.`,
      recommendation:'Review the destination manually and confirm whether the response is intentional before changing navigation.',
      remediation:`Do not rewrite the link solely because of HTTP ${status||'an inconclusive status'}. Confirm whether the destination should be public, requires sign-in, is intentionally restricted, or needs a different healthy URL. Fix or replace the link only after that review.`,
      verify:'Open the destination in a normal browser session (including signed-in state if relevant). If it should be publicly reachable and still fails as missing or server-error, rescan; only confirmed missing/server-error outcomes become broken-link findings.'
    };
  }
  if(/broken-link|link-404|link-410/.test(id)){
    const external=/external/.test(id)||f.link?.internal===false;
    const label=f.link?.text?`"${f.link.text}"`:(external?'The affected external link':'The affected internal link');
    const location=f.link?.location?` in the ${f.link.location}`:'';
    const occurrences=Number(f.link?.occurrences||f.occurrences||1);
    const occurrenceNote=occurrences>1?` This destination is referenced ${occurrences} times on the current page, so update every occurrence or fix the shared component/template that generates them.`:'';
    const prominence=f.link?.prominence==='navigation'||f.link?.prominence==='cta'?` It appears in ${f.link.prominence==='cta'?'a primary call-to-action':'primary navigation'}, which raises user impact.`:'';
    return{interpretation:`${label}${location} points to a ${external?'external':'internal'} destination that was independently confirmed missing.${occurrenceNote}${prominence}`,impact:`${label}${location} sends visitors${external?'': ' and crawlers'} to a missing destination instead of the intended content.`,recommendation:'Repair the navigation path at its source or restore/redirect the destination when that URL is still the intended route.',remediation:`Update the link to the correct live destination, restore the missing page if it should exist, or add an appropriate server redirect when the content permanently moved.${occurrenceNote}`,verify:'Open the corrected link from the source page, confirm the destination returns a successful response without an unintended redirect chain, then rescan the source page. Frank should verify the destination successfully before the finding disappears.'};
  }
  if(/fragment-missing/.test(id)){
    const label=f.link?.text?`"${f.link.text}"`:'An in-page link';
    return{interpretation:`${label} targets ${f.link?.url||f.evidence||'a fragment'}, but no matching id or name exists in the document.`,impact:'Broken in-page links interrupt navigation and skip-to-section patterns without requiring a network request to diagnose.',recommendation:'Add the missing id/name destination or correct the href fragment.',remediation:'Either introduce an element with the matching id (or name) or update the link href to a fragment that exists. Prefer stable ids used by the page structure rather than ephemeral generated ids.',verify:'Click the link and confirm it scrolls/focuses the intended section, then rescan.'};
  }
  if(/link-malformed/.test(id))return{interpretation:'The href could not be parsed as a URL, so the browser cannot navigate to a reliable destination.',impact:'Malformed hrefs break navigation for everyone who activates the link.',recommendation:'Replace the href with a valid absolute or root-relative URL.',remediation:'Correct the href at the template or CMS field that emits it. Prefer absolute https URLs or root-relative paths; avoid concatenated fragments that leave schemes incomplete.',verify:'Inspect the rendered href, activate the link, and rescan.'};
  if(/viewport-fixed/.test(id))return{interpretation:`Viewport metadata uses a fixed pixel width${f.evidence?` (${String(f.evidence).slice(0,80)})`:''} instead of device-width.`,impact:'Mobile browsers may render a desktop-scale layout that requires horizontal scrolling and pinch-zoom workarounds.',recommendation:'Prefer width=device-width, initial-scale=1 unless the application has a deliberate fixed-layout contract.',remediation:'Update the viewport meta to a responsive declaration such as width=device-width, initial-scale=1. If a fixed width is intentional for a specialized app shell, document that exception.',verify:'Reload at a narrow viewport and confirm the layout uses the device width without forced horizontal scrolling, then rescan.'};
  if(/link-5xx/.test(id)){
    const external=/external/.test(id)||f.link?.internal===false;
    const where=external?'external':'internal';
    return{interpretation:`The ${where} destination returned a repeatable server error rather than a usable page.`,impact:`The linked ${where} destination is returning a server error, so visitors cannot reliably reach it.`,recommendation:'Fix the destination error first, or point the source link to a healthy route if the failing URL is obsolete.',remediation:'Resolve the server/application error on the destination first. If the URL is obsolete, update the source link to a healthy destination rather than leaving navigation pointed at a failing endpoint.',verify:'Confirm the destination returns a successful response repeatedly, then rescan the source page.'};
  }
  if(/link-redirect-error/.test(id))return{impact:'The internal destination could not complete its redirect sequence on repeated browser requests. Visitors and crawlers may be trapped in a loop or encounter an invalid redirect chain.',remediation:'Inspect the redirect rules for the destination and every intermediate URL. Remove loops, circular www/non-www or HTTP/HTTPS rules, and conflicting application/server redirects so the URL reaches one intended final destination.',verify:'Open the destination directly in a fresh browser navigation, confirm it reaches the intended page without a loop, then rescan the source page and verify Frank can complete the redirect.'};
  if(/canonical-mismatch/.test(id))return{interpretation:'The canonical URL seen in the published page and the rendered browser state do not agree.',impact:'Different canonical values can give crawlers conflicting URL-consolidation signals.',recommendation:'Choose one intended canonical URL and make every publishing layer emit it consistently.',remediation:'Choose the intended canonical URL and make the initial published HTML and rendered browser state emit the same absolute canonical.',verify:'Rescan and confirm Browser and Meta State report the same canonical URL.'};
  if(/canonical-missing/.test(id))return{interpretation:'No canonical URL was observed for this page.',impact:'Without an explicit canonical, crawlers must infer the preferred URL when duplicate or parameterized variants exist.',recommendation:'Publish one absolute preferred URL when this page should self-canonicalize.',remediation:'If this page should self-canonicalize, publish one absolute canonical URL in the document head. If your platform intentionally omits canonicals, confirm that strategy before changing it.',verify:'Rescan and confirm the intended canonical appears exactly once and resolves to the preferred URL.'};
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
  if(/duplicate-id/.test(id))return{interpretation:'The same element id appears more than once in the rendered document.',impact:'Duplicate IDs can cause labels, ARIA references, fragment links, CSS selectors, and scripts to resolve to the wrong element.',remediation:'Give each duplicated ID a unique value, then update every for, aria-labelledby, aria-describedby, fragment link, CSS selector, and script reference that points to the renamed ID.',verify:'Rescan and confirm the duplicate-ID finding is gone, then test any form labels or scripted interactions that referenced the changed ID.'};
  if(/insecure-form-action/.test(id))return{impact:'A secure page submitting data to HTTP can expose form data in transit and creates mixed-security behavior.',remediation:'Change the form action to a trusted HTTPS endpoint and verify any proxy, CRM, or intake integration accepts HTTPS at that destination.',verify:'Submit a safe test entry and confirm the browser sends the request over HTTPS with the expected success response.'};
  if(/viewport-zoom-restricted/.test(id))return{impact:'Restricting zoom can make content harder to use for people who rely on magnification.',remediation:'Remove user-scalable=no and avoid a maximum-scale setting that prevents meaningful zoom. Let the browser handle user magnification.',verify:'Reload the page on mobile or responsive emulation and confirm pinch/browser zoom works, then rerun the accessibility scan.'};
  if(/viewport-missing/.test(id))return{interpretation:'The rendered document does not declare viewport metadata.',impact:'Without viewport metadata, responsive layouts may render at an unintended virtual width on mobile devices.',remediation:'Add a standard viewport declaration such as width=device-width, initial-scale=1 unless the application has a deliberate alternative.',verify:'Reload at mobile widths and confirm the layout uses the device width, then rescan.'};
  if(/a11y\.lang-missing/.test(id)){
    const inFrame=f.embeddedContext==='same-origin-iframe';
    return{
      interpretation:inFrame?'Inside an embedded same-origin document, the root html element has no lang attribute declaring the document language.':'The root html element has no lang attribute declaring the page language.',
      impact:'Assistive technology may use the wrong pronunciation rules when the document language is not declared.',
      remediation:inFrame?'Set a valid BCP 47 language code on the framed document html element. Do not edit parent-page markup for this finding.':'Set a valid BCP 47 language code on the root html element, such as lang="en" or the appropriate language for the page.',
      verify:'Rescan and confirm the framed or top-level html element exposes the intended valid language.',
      limitations:inFrame?'This target lives inside a same-origin iframe; spotlight may be unavailable.':undefined
    };
  }
  if(/a11y\.lang-invalid/.test(id)){
    const inFrame=f.embeddedContext==='same-origin-iframe';
    return{
      impact:'An invalid language tag can prevent user agents from determining the document language reliably.',
      remediation:inFrame?'Replace the framed document html lang value with a valid BCP 47 language tag. Do not edit parent-page markup for this finding.':'Replace the current html lang value with a valid BCP 47 language tag that matches the primary page language.',
      verify:'Rescan and confirm the language value validates and matches the content.',
      limitations:inFrame?'This target lives inside a same-origin iframe; spotlight may be unavailable.':undefined
    };
  }
  if(/seo\.hreflang-duplicate-target/.test(id))return{interpretation:'Multiple hreflang language tags point to the same URL.',impact:'Language alternates normally map distinct locales to distinct URLs; reuse can confuse crawlers.',recommendation:'Assign each language variant its own URL or remove incorrect alternates.',remediation:'Review the hreflang set and ensure each language tag points to the correct localized URL.',verify:'Rescan and confirm each hreflang href resolves to the intended locale page.'};
  if(/hreflang/.test(id))return{interpretation:'An existing hreflang alternate is empty, uses a non-HTTP URL, or has a language tag that is not valid BCP 47 (x-default is allowed).',impact:'Invalid hreflang annotations can be ignored by search engines and weaken language targeting.',recommendation:'Publish valid HTTP(S) alternate URLs with real language tags or x-default.',remediation:'Correct or remove the failing hreflang link. Use a valid BCP 47 tag or x-default and an absolute or resolvable HTTP(S) href. This finding does not claim the language cluster is incomplete.',verify:'Reload and rescan; confirm remaining hreflang links parse and use HTTP(S) URLs.',limitations:'Absence of hreflang on a monolingual page is not reported.'};
  if(/h1-missing/.test(id))return{impact:'A missing primary heading can make the page hierarchy less clear to users and assistive technology.',remediation:'Add a meaningful primary page heading when the document has a clear main topic. Do not add an H1 solely to satisfy a checker if the page pattern legitimately has no page-level heading.',verify:'Review the heading outline and confirm the page hierarchy is understandable, then rescan.'};
  if(/h1-multiple/.test(id))return{impact:'Multiple H1 elements can be valid in HTML, so this is a structural review rather than an automatic defect.',remediation:'Review whether each H1 truly represents an independent top-level section. If one is the page title and others are subordinate, change the subordinate headings to the appropriate levels.',verify:'Review the resulting heading outline rather than relying only on the H1 count.'};
  if(/heading-skip/.test(id))return{interpretation:'The rendered heading outline jumps over a level at the affected heading.',impact:'Skipped heading levels can make document structure harder to understand for screen-reader users and people navigating by headings.',recommendation:"Use the heading level that matches this section's structural depth.",remediation:'Adjust the affected heading and, if necessary, surrounding headings so levels progress according to content hierarchy. Choose levels for structure, not visual size.',verify:'Inspect the full heading outline and confirm the hierarchy makes sense, then rescan.'};
  if(/blank-opener/.test(id))return{interpretation:'A link opens a new browsing context without explicitly severing opener access.',impact:'Older or embedded browser contexts can expose the originating window to the opened page, and explicit rel protection makes the security intent clear.',recommendation:'Add rel="noopener" or rel="noreferrer" to the affected target="_blank" link.',remediation:'Add rel="noopener" to preserve the referrer while preventing opener access, or rel="noreferrer" if referrer suppression is also intended.',verify:'Inspect the rendered link and confirm the rel token is present, then rescan.'};
  if(/charset-missing/.test(id))return{interpretation:'No rendered meta charset declaration was observed; the HTTP response may still declare the encoding.',impact:'Ambiguous character encoding can cause incorrect text interpretation in edge cases.',recommendation:'Confirm UTF-8 is declared reliably, preferably in the HTTP Content-Type header and early in the document head.',remediation:'If the response does not already declare UTF-8, add the appropriate response header and/or an early <meta charset="utf-8"> declaration.',verify:'Check the response Content-Type and rendered head, then rescan.'};
  if(/meta-refresh/.test(id))return{interpretation:'The page uses client-side meta refresh for timed navigation or reload.',impact:'Meta refresh can interrupt reading, create unexpected navigation, and complicate accessibility and analytics.',recommendation:'Replace meta refresh with an appropriate server redirect or deliberate application navigation when possible.',remediation:'For a permanent or temporary destination change, use an HTTP 3xx redirect. For application behavior, trigger navigation explicitly and give users control rather than relying on timed refresh.',verify:'Reload the page and confirm the meta refresh is gone and the replacement navigation behaves as intended.'};
  if(/og-incomplete/.test(id))return{interpretation:'One or more core Open Graph title or description fields were not observed.',impact:'Shared links may receive incomplete or platform-generated social previews.',recommendation:'Add the missing Open Graph fields if social sharing is important for this page.',remediation:'Publish an og:title and og:description that accurately represent the page. Keep them aligned with the page content rather than copying unrelated marketing text.',verify:'Rescan and use a social-preview debugger or platform validator to confirm the intended fields are published.'};
  if(id.startsWith('axe.'))return axeAdvice(f);
  if(id==='performance.browser.ttfb')return{interpretation:`This browser observed a time to first byte of ${f.performanceObservation?.ttfbMs??'an elevated'}ms. That isolates the delay to navigation/server response before front-end rendering work.`,impact:'Slow server response delays every later rendering milestone on this navigation.',recommendation:'Investigate origin, application, cache, CDN, and redirect latency before optimizing front-end assets.',remediation:'Check cache status and CDN/origin timing, backend work performed before the response begins, database/API latency, and unnecessary redirect hops. Do not blame JavaScript or image rendering for TTFB without separate evidence.',verify:'Repeat the same navigation under comparable conditions and confirm TTFB improves; compare with monitored history or field data when available.'};
  if(id==='performance.browser.lcp')return{interpretation:`This browser observed LCP at ${f.performanceObservation?.largestContentfulPaintMs!=null?(f.performanceObservation.largestContentfulPaintMs/1000).toFixed(1)+'s':'a slow point'}. The browser identified the element responsible for that paint in the evidence record. This is a current lab observation, not a field score.`,impact:'A slow largest contentful paint can make the page feel visually incomplete for users.',recommendation:'Investigate the observed LCP element and the work required before it can render.',remediation:'Use the observed LCP element in Technical evidence as the starting point. If it is an image, inspect request priority, dimensions, compression, format, preload behavior, and delayed discovery. If it is text, inspect blocking fonts, CSS, server response, and render-blocking work. Avoid unrelated performance changes that are not connected to the observed element.',verify:'Repeat the navigation under comparable conditions, confirm LCP improves, and compare with monitored field/history data when available.'};
  if(id==='performance.browser.lcp-heavy-image'||id==='performance.browser.lcp-image-oversized'){
    const p=f.performanceObservation||{};
    const el=p.lcpElement||{};
    return{interpretation:`Largest contentful paint was slow in this lab observation${p.largestContentfulPaintMs!=null?` (${(p.largestContentfulPaintMs/1000).toFixed(1)}s)`:''}, and the LCP resource evidence points to an image/asset that is heavy or oversized for its rendered box.`,impact:'Oversized LCP images delay the primary visual paint and waste transfer on mobile networks.',recommendation:'Resize/compress/serve an appropriately sized modern asset for the LCP image before tuning secondary details.',remediation:`Compress and resize the LCP image and serve an appropriately sized asset (modern format, matching rendered dimensions, sensible quality).${el.selector?` Start with ${el.selector}.`:''}${el.url?` Resource: ${el.url}.`:''}`,verify:'Repeat the navigation under comparable conditions and confirm LCP improves without layout regression. This remains a lab observation, not field Core Web Vitals unless field data is present.'};
  }
  if(id==='performance.browser.image-oversized')return{interpretation:'An image’s intrinsic dimensions are substantially larger than its rendered box on this page.',impact:'Oversized images increase transfer and decode cost without improving visual quality at the displayed size.',recommendation:'Serve an image sized for its rendered dimensions (and density needs).',remediation:'Resize/compress the source asset or use responsive images (srcset/sizes) so the browser downloads an appropriately sized candidate.',verify:'Confirm the rendered image still looks sharp at target viewports while transfer size drops, then rescan.'};
  if(id==='web.image-broken')return{interpretation:f.embeddedContext==='same-origin-iframe'?'Inside an embedded same-origin document, an image element finished loading with naturalWidth 0.':'An image element finished loading with naturalWidth 0, which usually means the resource is missing or undecodable.',impact:'Broken images create visible gaps and can remove meaningful content.',recommendation:'Restore the image resource or remove the unused img element.',remediation:f.embeddedContext==='same-origin-iframe'?'Fix the image inside the framed document (not the parent page markup). Confirm the src resolves in that iframe document.':'Confirm the src resolves, fix the path or CDN object, or remove the image if it is obsolete.',verify:'Reload and confirm the image paints with non-zero natural dimensions, then rescan.',limitations:f.spotlightSafe===false?'This target lives inside a same-origin iframe; Frank will not pretend it is parent-page markup and may not spotlight it safely.':undefined};
  if(id==='performance.browser.weight-dominant-resource')return{interpretation:'Lab transfer weight is elevated and one resource accounts for a large share of measured bytes.',impact:'A single heavy asset can dominate first-load cost even when other optimizations look fine.',recommendation:'Inspect compression, caching, and whether that dominant asset is required for first view.',remediation:'Start with the dominant resource in evidence. Compress, defer, or split it before broad page retunes.',verify:'Repeat the navigation under comparable conditions and confirm measured transfer drops without regressing critical content.',limitations:'This is a current-page lab observation, not field Core Web Vitals.'};
  if(/security\.mixed-content-passive/.test(id))return{interpretation:`Markup on this HTTPS page points an image or media element at ${f.resourceUrl||'an HTTP URL'}. This scan observed the scheme in markup; it does not claim the request was blocked or upgraded.`,impact:'Passive mixed content can leak the page URL on the network and may be blocked or warned in some browsers.',recommendation:'Serve the asset over HTTPS or remove the insecure reference.',remediation:'Change the src/poster URL to HTTPS on the same trusted host, or remove the unused media element. Do not add a mixed-content probe or new network check to “confirm” it.',verify:'Inspect the rendered markup and confirm the resource URL is HTTPS, then rescan.'};
  if(/security\.mixed-content/.test(id))return{interpretation:`Markup on this HTTPS page requests an active HTTP resource (${f.resourceUrl||'see evidence'}). Browsers typically block or restrict active mixed content such as scripts, stylesheets, and frames.`,impact:'Blocked or mixed scripts, styles, or frames can leave the page incomplete or behave inconsistently.',recommendation:'Point the resource at a trusted HTTPS URL.',remediation:'Update the script, stylesheet, or iframe URL to HTTPS. If the resource is obsolete, remove the tag instead of leaving an HTTP request in the markup.',verify:'Reload over HTTPS and confirm the resource URL is HTTPS and the feature it provides still loads, then rescan.'};
  if(/web\.stylesheet-failed/.test(id))return{interpretation:`A same-origin stylesheet request failed (${f.resourceUrl||f.evidence||'see evidence'}).`,impact:'A missing stylesheet can leave the page unstyled or partially styled.',recommendation:'Restore the CSS file or remove the unused link.',remediation:'Fix the path, CDN object, or build output for this stylesheet, or delete the link if it is obsolete. This finding does not invent a MIME or CORS cause.',verify:'Reload and confirm the stylesheet URL returns a successful CSS response, then rescan.'};
  if(/runtime\.script-failed/.test(id))return{interpretation:`A same-origin script request failed (${f.resourceUrl||f.evidence||'see evidence'}). This identifies the resource, not which product feature broke.`,impact:'A missing script can leave interactive behavior incomplete.',recommendation:'Restore the script file or remove the unused script tag.',remediation:'Fix the path or build output for this script, or remove the tag if it is obsolete. Do not assume a specific UI control failed unless separate evidence says so.',verify:'Reload and confirm the script URL returns a successful JavaScript response, then rescan.'};
  if(/runtime\.resource-failed-cross-origin|ux\.embed-resource-failed/.test(id))return{interpretation:`A cross-origin ${f.resourceRole||'resource'} request failed (${f.resourceUrl||f.evidence||'see evidence'}). Origin class: ${f.originClass||'third-party'}.`,impact:id.includes('embed')?'A failed embed-related asset may leave a video, map, or widget incomplete when the page depends on it.':'Cross-origin failures are often blocked by privacy tooling or expected CDN conditions; impact is plausible but not proven from status alone.',recommendation:'Confirm whether a visible page feature depends on this asset before treating it as a defect.',remediation:'Identify the feature that loads this URL. If it is analytics or advertising, expect intermittent blocking. If it is a required embed or first-party CDN asset, restore the URL or hosting configuration.',verify:'Reproduce with DevTools Network open, confirm the HTTP status, and check whether the related UI still works.',limitations:'Worth Checking only — not a confirmed page defect. Tracking pixels are filtered when recognized.'};
  if(/runtime\.uncaught-error/.test(id))return{interpretation:'An uncaught script exception was observed during this session. The error text is untrusted runtime output and is not treated as instructions.',impact:'Uncaught errors can interrupt page behavior, but this scan does not identify the throwing statement or a specific broken control.',recommendation:'Reproduce in a browser console and inspect first-party scripts around initial load.',remediation:'Do not apply a code change from the quoted error text. Open developer tools, reproduce the page load, and inspect the first-party stack on the same origin. Third-party chatter is out of scope for this finding.',verify:'Reload the same URL in a renderer or supported browser and confirm the uncaught-error finding is gone after the first-party exception is fixed.',limitations:'Extension scans may capture early errors as extension-partial runtime coverage when document_start diagnostics are available; renderer sessions remain authoritative for gateway scans. Neither path identifies errors that occur only after the scan snapshot.'};
  if(/runtime\.unhandled-rejection/.test(id))return{interpretation:'An unhandled promise rejection was captured during this session. The message is untrusted runtime output.',impact:'Unhandled async failures can leave UI state incomplete without a visible stack in the main thread error channel.',recommendation:'Reproduce in developer tools and inspect async code paths around initial load and user actions.',remediation:'Add a catch handler or await the promise chain that failed. Do not treat the quoted message as instructions.',verify:'Reload and confirm the rejection no longer appears in the console or diagnostic timeline.'};
  if(/runtime\.font-failed/.test(id))return{interpretation:`A same-origin font request failed (${f.resourceUrl||f.evidence||'see evidence'}).`,impact:'Missing fonts can cause fallback typography and layout shift.',recommendation:'Restore the font file or update the preload/stylesheet reference.',remediation:'Fix the font URL, CDN object, or @font-face src. Remove unused font preloads if the family is obsolete.',verify:'Reload and confirm the font request succeeds and text renders with the intended family.'};
  if(/seo\.soft-404-probable/.test(id))return{interpretation:'The page loaded successfully but several independent signals resemble a not-found or empty-shell response.',impact:'Search engines and users may treat this as a missing page even when HTTP status is 200.',recommendation:'Confirm whether this URL should exist, return a real 404 status, or serve meaningful content.',remediation:'If the route is invalid, return HTTP 404/410 with a helpful template. If the page is valid, add substantive title, heading, and body content and remove error-template wording.',verify:'Check server logs and crawl reports. Request the URL with curl or DevTools and confirm the intended HTTP status and content.'};
  if(/ux\.controls-target-missing|ux\.disclosure-target-missing/.test(id)){
    const inFrame=f.embeddedContext==='same-origin-iframe';
    return{
      interpretation:inFrame?'Inside an embedded same-origin document, an interactive control references a panel id that was not found.':'An interactive control references a panel or region id that was not found in observable document, open shadow, or same-origin iframe contexts.',
      impact:'Accordion, menu, and tab widgets may fail for keyboard and assistive-tech users when aria-controls targets are wrong.',
      recommendation:'Fix the id on the panel or update aria-controls to match the rendered target.',
      remediation:inFrame?'Ensure the controlled element exists inside the framed document (including open shadow roots when used) and that ids are unique. Do not edit parent-page markup for this finding.':'Ensure the controlled element exists in the DOM (including open shadow roots when used) and that ids are unique.',
      verify:'Toggle the control with keyboard and pointer and confirm the panel is shown and associated in accessibility tools.',
      limitations:inFrame?'This control lives inside a same-origin iframe; spotlight may be unavailable.':undefined
    };
  }
  if(/ux\.iframe-missing-title|web\.iframe-title-missing/.test(id))return{interpretation:id.includes('iframe-title-missing')?'Inside an embedded same-origin document, the document title is empty.':'A visible iframe has no title attribute.',impact:'Screen-reader users may not know what the embedded frame contains.',recommendation:id.includes('iframe-title-missing')?'Set a concise document title inside the framed experience.':'Add a concise title describing the embedded content.',remediation:id.includes('iframe-title-missing')?'Update the iframe document <title>, not only the parent page.':'Set title on the iframe to match the embedded experience (for example “Payment form” or “Map”).',verify:'Rescan and confirm the iframe or framed document exposes a meaningful title.',limitations:'Worth Checking observation — confirm whether the embed is user-facing before prioritizing it as a defect.'};
  if(/ux\.disclosure-toggle-failed/.test(id)){
    const obs=f.interactionObservation||{};
    const inFrame=f.embeddedContext==='same-origin-iframe'||obs.context==='same-origin-iframe';
    const settle=obs.settleDurationBucket&&obs.settleDurationBucket!=='immediate';
    const expected=obs.expectedState?.ariaExpanded||'a state change';
    return{
      interpretation:inFrame
        ?(settle
          ?`This control is inside a same-origin embedded document. It was safely activated under WebQA’s allowlist, but the expected panel state did not appear during the bounded verification window (initial aria-expanded "${obs.initialState?.ariaExpanded||'unknown'}"; expected "${expected}", observed "${obs.observedState?.ariaExpanded||'unchanged'}").`
          :`This control is inside a same-origin embedded document. An allowlisted local disclosure was activated and the expected panel state did not change (initial aria-expanded "${obs.initialState?.ariaExpanded||'unknown'}"; expected "${expected}", observed "${obs.observedState?.ariaExpanded||'no change'}").`)
        :(settle
          ?`This control was safely activated under WebQA’s allowlist, but the expected panel state did not appear during the bounded verification window. Initial aria-expanded was "${obs.initialState?.ariaExpanded||'unknown'}"; expected "${expected}", observed "${obs.observedState?.ariaExpanded||'no change'}".`
          :`An allowlisted local disclosure control was activated. Initial aria-expanded was "${obs.initialState?.ariaExpanded||'unknown'}"; expected "${expected}", observed "${obs.observedState?.ariaExpanded||'no change'}".`),
      impact:'Users may be unable to open or close accordion/menu panels even when the markup looks structurally complete. If the control only updates after a longer delay or animation, this may be a verification-window limit rather than a broken control.',
      recommendation:'Reproduce the toggle manually and inspect the click/keyboard handler for that control.',
      remediation:'Do not assume a specific script file is at fault unless separate runtime evidence points there. Verify the listener updates aria-expanded and panel visibility, then restore the prior collapsed/expanded state after testing.',
      verify:'Activate the control with pointer and keyboard, confirm aria-expanded and panel visibility change, then confirm the control can return to its prior state.',
      limitations:inFrame
        ?'Allowlisted activation is not a guarantee of zero side effects — page handlers may still run. This control lives inside a same-origin iframe; spotlight may be unavailable. Forms, navigation, purchases, downloads, and third-party widgets are never activated. Co-occurring script failures are correlated only as Worth Checking, not as proven causation.'
        :'Allowlisted activation is not a guarantee of zero side effects — page handlers may still run (analytics, fetches, preference writes). Forms, navigation, purchases, downloads, and third-party widgets are never activated. Co-occurring script failures are correlated only as Worth Checking, not as proven causation.'
    };
  }
  if(/ux\.interaction-restoration-unproven/.test(id)){
    const obs=f.interactionObservation||{};
    const inFrame=f.embeddedContext==='same-origin-iframe'||obs.context==='same-origin-iframe';
    return{
      interpretation:inFrame
        ?'Inside a same-origin embedded document, WebQA stopped interaction testing after it could not verify restoration of the original framed state.'
        :'WebQA stopped interaction testing after it could not verify restoration of the original page state.',
      impact:'Further interactive checks were skipped to avoid leaving or compounding an altered page state. This is a scan-safety stop, not proof that a specific user-facing toggle is broken.',
      recommendation:'Manually confirm the last tested control returns to its prior expanded/collapsed (or selected) state, then rescan.',
      remediation:'Inspect the control that was activated last. Ensure toggling is reversible and that aria-expanded / panel visibility can return to the starting state. Do not treat this as proof that application logic is broken.',
      verify:'Activate the control, confirm the intended state change, restore it manually, and rescan to resume interaction coverage.',
      limitations:inFrame
        ?'This stop occurred inside a same-origin iframe; spotlight may be unavailable. WebQA refuses to continue activating dependent controls when restoration cannot be proven.'
        :'WebQA refuses to continue activating dependent controls when restoration cannot be proven.'
    };
  }
  if(/runtime\.resource-status-inconclusive/.test(id)){
    const url=f.resourceUrl||'';
    const role=f.resourceRole||'resource';
    return{
      interpretation:url
        ?`A ${role} resource (${url}) showed an opaque or missing response status, so HTTP failure is not confirmed from browser APIs alone.`
        :`A ${role} showed an opaque or missing response status, so HTTP failure is not confirmed from browser APIs alone.`,
      impact:'Impact is uncertain until DevTools Network confirms the final status for this asset.',
      recommendation:'A visible markup dependency was already associated with this asset. Confirm its Network status and whether the dependent feature still works.',
      remediation:'Do not treat opaque or missing status as a confirmed HTTP error. Opaque responses are common for cross-origin assets that hide HTTP status; restore the asset only when the visible dependency is actually broken.',
      verify:'In DevTools Network, confirm the final HTTP status for this URL and whether the page feature still works.',
      limitations:'Opaque responses are common for cross-origin assets; this observation alone is not a defect.'
    };
  }
  if(/navigation\.skip-link-target-missing/.test(id))return{interpretation:'A skip link points to a fragment id that is not present in observable contexts.',impact:'Keyboard users relying on skip navigation may land nowhere.',recommendation:'Add the missing target id on main content or fix the skip link href.',remediation:'Ensure the skip target id exists once in the document or an accessible same-origin iframe.',verify:'Activate the skip link with keyboard and confirm focus moves to the intended region.'};
  if(/schema\.jsonld-missing-type/.test(id))return{interpretation:'A JSON-LD object lacks @type, so structured-data consumers cannot classify the entity.',impact:'Rich-result eligibility may be reduced for that block.',recommendation:'Add the appropriate schema.org @type for the entity being described.',remediation:'Update the JSON-LD block with a valid @type and required properties for that type.',verify:'Validate the JSON-LD with a structured-data testing tool after publishing.'};
  if(/ux\.placeholder-only-label|ux\.form-control-missing-name/.test(id)){
    const inFrame=f.embeddedContext==='same-origin-iframe';
    return{
      interpretation:inFrame
        ?(id.includes('placeholder')?'Inside an embedded same-origin document, a form control uses placeholder text without an associated label or aria-label.':'Inside an embedded same-origin document, a visible form control in a submittable form lacks a name attribute.')
        :(id.includes('placeholder')?'A visible form control uses placeholder text without an associated label or aria-label.':'A visible form control in a submittable form lacks a name attribute.'),
      impact:id.includes('placeholder')?'Placeholders are weak accessible names and disappear while typing.':'Unnamed controls may be omitted from submitted form data.',
      recommendation:id.includes('placeholder')?'Add a visible label or aria-label that persists while the field is focused.':'Add a name attribute when the field should submit with the form.',
      remediation:inFrame
        ?(id.includes('placeholder')?'Fix the framed document markup: associate a label or aria-label with the control inside the iframe.':'Fix the framed document markup: set name on the control inside the iframe.')
        :(id.includes('placeholder')?'Associate a label element or aria-label with the control; use placeholder only as hint text.':'Set name on the input/select/textarea or remove it from the submittable form if it is not meant to submit.'),
      verify:'Inspect the form in DevTools and confirm labels/names are present, then submit a safe test entry if appropriate.',
      limitations:inFrame?'This control lives inside a same-origin iframe; do not edit parent-page markup for it. Spotlight may be unavailable.':undefined
    };
  }
  if(/ux\.inert-link/.test(id))return{interpretation:'The highlighted link href is empty or javascript:void. Empty href stays on the current document; javascript:void does not declare a navigation destination. This scan did not verify click or keyboard handlers and is not treating the control as broken.',impact:'If the href was supposed to navigate to another URL, users who activate the link as a link will not reach that destination. If a script already handles the control, this can still be valid.',recommendation:'If navigation is intended, use a real URL. If an action is intended, prefer a button. If a handler already exists, this finding does not disprove it.',remediation:'Web QA Assistant is not treating this as a confirmed broken control. Replace javascript:void or empty href with a real destination when the control is a link, or use a button when it is an action. Leave it unchanged when a verified handler already implements the intended behavior.',verify:'Activate the control with pointer and keyboard. If it should navigate, confirm a real URL loads. If it should run an action, confirm that action still runs, then rescan.'};
  if(/web\.nested-form/.test(id))return{interpretation:'The live DOM contains a form nested inside another form.',impact:'Nested forms are invalid HTML. Browsers may ignore the inner form and attach controls to the outer form, which can submit the wrong fields.',recommendation:'Keep a single form around the related controls, or split into sibling forms.',remediation:'Un-nest the inner form in the template or script that built this DOM. Move the inner controls into the outer form or into a separate sibling form. Do not claim which submit “loses data” without watching a submit.',verify:'Inspect the live DOM and confirm no form is a descendant of another form, then rescan.'};
  if(/ux\.form-no-submit/.test(id))return{interpretation:'An HTML form has an HTTP(S) action and multiple fields, but no native submit control or button was observed. Scripted submit and implicit Enter submission were not verified, so this is not treated as a confirmed broken form.',impact:'If a visible submit control was intended, users may not find a way to send the form without relying on implicit or scripted submit.',recommendation:'Add a clearly named submit control when the form is meant to be submitted as HTML.',remediation:'Web QA Assistant is not treating this as a confirmed unsubmittable form. If a visible submit is intended, add a submit button or input type=submit. If JavaScript already submits the form, this finding does not disprove that path.',verify:'Confirm there is a visible submit control or a deliberately scripted submit path, then rescan.'};
  if(/ux\.hidden-required/.test(id))return{interpretation:'A type=hidden input is marked required. This is a snapshot of attributes; the field may be revealed later, but it is currently hidden.',impact:'HTML constraint validation typically ignores required on type=hidden, so this is not a confirmed native submit blocker. It is still invalid or confusing markup and can mislead custom validation.',recommendation:'Keep required only on controls the user can complete, or show and label the field before submit.',remediation:'Either remove required while the input remains type=hidden, or reveal and label the field before submit. Do not inspect or copy the hidden value. Do not treat this as proof that native submit is blocked.',verify:'Confirm the hidden input is no longer required, or that it becomes a visible labeled control before submit, then rescan.'};
  if(/ux\.input-type-mismatch/.test(id))return{interpretation:'An input declares email or telephone autocomplete but does not use the matching input type.',impact:'Users may get the wrong keyboard and weaker client-side format hints.',recommendation:'Use type="email" or type="tel" to match the autocomplete token.',remediation:'Change the input type to email or tel to match autocomplete, or remove the autocomplete token if the field is not actually an email or telephone value.',verify:'Inspect the input, confirm type and autocomplete agree, then rescan.'};
  if(/seo\.robots-googlebot-conflict/.test(id))return{interpretation:'The robots meta indexing token disagrees with the googlebot meta indexing token. A Google-only override can be intentional.',impact:'Crawlers that honor these directives may index the page differently than a generic robots token suggests.',recommendation:'Confirm whether Google should follow a different indexing rule, then make the tokens agree if the split is accidental.',remediation:'If the split is unintended, align name=robots and name=googlebot so both allow indexing or both request noindex. If Google should be an exception, document that override and leave it. Do not claim the page is deindexed.',verify:'Rescan and confirm the two tokens match the intended indexing policy.'};
  if(/correlation\.viewport-overflow/.test(id))return{interpretation:`Viewport metadata is missing or fixed, and horizontal overflow was also observed at the scanned width${f.overflowMetrics?.overflowPx!=null?` (${f.overflowMetrics.overflowPx}px at ${f.overflowMetrics.viewportWidth}px)`:''}. That coincidence suggests starting with a responsive viewport; it does not prove the viewport is the sole cause.`,impact:'Users at this width may need sideways scrolling, and a fixed/missing viewport often contributes to a desktop-scale layout.',recommendation:'Restore width=device-width, initial-scale=1, then check whether a wide child still overflows.',remediation:'Update the viewport meta to width=device-width, initial-scale=1. After that, inspect wide tables, 100vw boxes, and fixed-width shells. Do not use overflow-x:hidden as the underlying fix.',verify:'Reload at the same viewport width, confirm the viewport markup is responsive, and confirm whether horizontal overflow remains. If overflow remains, treat that as a separate layout issue.'};
  if(/web\.horizontal-overflow/.test(id))return{interpretation:`Horizontal overflow was observed at the scanned viewport width${f.overflowMetrics?.overflowPx!=null?` (${f.overflowMetrics.overflowPx}px at ${f.overflowMetrics.viewportWidth}px)`:''}. This is not proof of a mobile-only defect.`,impact:'Users at this width may need sideways scrolling to reach content or controls.',recommendation:'Inspect which box exceeds the viewport instead of hiding overflow.',remediation:'Identify the overflowing descendant (wide table, fixed pixel width, 100vw including scrollbar) and constrain it. Do not use overflow-x:hidden as the underlying diagnosis.',verify:'Reload at the same viewport width and confirm document scrollWidth no longer exceeds the viewport by 16px or more, then rescan.'};
  if(id==='performance.browser.cls')return{interpretation:`This browser observed cumulative layout shift of ${f.performanceObservation?.cumulativeLayoutShift??'an elevated value'} on this machine and network. This is a lab observation, not a field score or Core Web Vitals result.`,impact:'Unstable layout can make the page feel jumpy and can cause accidental clicks, but this session does not identify the shifting node as a confirmed root cause.',recommendation:'Inspect late-injected banners, images without dimensions, and font swap in this lab session.',remediation:'Investigate layout-shift sources in this browser session (images without width/height, injected banners, web-font swap). Do not treat this as field Core Web Vitals or a historical regression without monitored field/history evidence.',verify:'Repeat the navigation under comparable conditions and confirm the lab CLS value decreases; compare with monitored field/history data only when that evidence is present.'};
  if(id==='performance.browser.weight'){const p=f.performanceObservation||{},qualifier=p.transferIsLowerBound?'at least ':'';return{interpretation:`The browser measured ${qualifier}${p.transferBytes!=null?(p.transferBytes/1048576).toFixed(1)+'MB':'a large payload'} of transfer. ${p.unknownTransferCount||0} entries had unknown transfer size, so this is${p.transferIsLowerBound?' a lower bound':' the measurable total for this observation'}.`,impact:'Large transfer payloads can increase load time and data use, especially on slower networks.',recommendation:'Start with the largest measurable resources and resource types rather than optimizing the page indiscriminately.',remediation:'Review the heaviest images, scripts, fonts, and other assets in the evidence. Compress or resize oversized media, remove unnecessary code, split or defer noncritical bundles, and reduce duplicate third-party payloads where the evidence supports it.',verify:'Repeat the navigation with comparable cache/network conditions and confirm known transfer decreases without breaking page behavior.'};}
  if(id.startsWith('performance.'))return{interpretation:'This performance signal is contextual evidence rather than proof of a single code defect.',impact:'A sustained performance regression can indicate a real user-facing change.',recommendation:'Compare this observation with monitored history before assigning a root cause.',remediation:'Profile the relevant performance dimension and investigate changes around the regression window rather than changing code based on one score alone.',verify:'Run another controlled scan after the suspected cause is addressed and compare with monitored field/history data when available.'};
  return{impact:'This finding is supported by the current scan, but it does not yet have enough rule-specific context for Frank to claim a precise implementation impact.',remediation:'Review the evidence and source tool before changing code. Frank should not prescribe a generic implementation change when the available evidence does not identify one safely.',verify:'Rescan after any intentional change and confirm the original evidence no longer reproduces.'};
}

function platformRemediationNote(f){
  const platform=f.remediationContext?.platform||'';
  const confidence=f.remediationContext?.platformConfidence||'';
  if(platform!=='wordpress'||confidence!=='high')return'';
  if(/lcp|image-oversized|weight|image-broken/i.test(String(f.ruleId||''))){
    return' WordPress implementation context: use the site’s existing image optimization pipeline when one is already present; otherwise evaluate established media tools such as Smush, ShortPixel, or Imagify only as implementation options—not as the underlying fix.';
  }
  if(/uncaught-error|script-failed|inert-link|performance\.browser\.cls/.test(String(f.ruleId||'')))return'';
  return' WordPress implementation context: apply the change in the theme/template, block, or SEO plugin layer that emits this markup rather than patching a single rendered page.';
}

export function guidanceFor(f,environment={type:'unknown'}){
  const normalized=normalizeGuidance(rawGuidanceFor(f,environment));
  const note=platformRemediationNote(f);
  if(note){
    normalized.remediation=`${normalized.remediation||''}${note}`.trim();
  }
  return normalized;
}
