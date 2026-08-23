/*
 * Deterministic image-purpose classification.
 *
 * This runs in the page as a plain script (no module syntax) because the content
 * script bundle is injected with chrome.scripting.executeScript, not as a module.
 * It is exercised in Node tests via node:vm against the exact shipped source.
 *
 * Design rule: this classifier is deliberately conservative. Telling an engineer
 * to set alt="" on a genuinely informative image is an accessibility regression
 * caused by our own tool, which is worse than presenting a decorative/informative
 * choice. So a confident verdict requires corroborating signals and the absence
 * of any contradicting signal. Otherwise the answer is "uncertain" and Frank
 * keeps the fork.
 */
(() => {
  const ICON_HINT = /(^|[-_/.])(icon|ico|glyph|bullet|chevron|arrow|caret|divider|spacer|ornament|flourish|swirl|shape|badge|checkmark|check|tick|star|dot)([-_/.]|$)/i;
  const DECOR_HINT = /(^|[-_/.])(decor|decoration|decorative|background|bg|overlay|texture|pattern|hero-bg|watermark)([-_/.]|$)/i;
  const COMPLEX_HINT = /(^|[-_/.])(chart|graph|diagram|infographic|map|plot|figure|schematic|flow)([-_/.]|$)/i;
  const LOGO_HINT = /(^|[-_/.])(logo|wordmark|brandmark)([-_/.]|$)/i;
  const TRIVIAL_TEXT = /^[\s\u00a0.,:;·•|/–—-]*$/;

  function text(value) { return String(value ?? '').replace(/\s+/g, ' ').trim(); }

  function haystack(el) {
    let src = '';
    try { src = el.getAttribute('src') || el.getAttribute('data-src') || ''; } catch { src = ''; }
    const cls = String(el.className?.baseVal ?? el.className ?? '');
    return `${src} ${cls} ${el.id || ''}`;
  }

  function interactiveAncestor(el) {
    return el.closest?.('a[href],button,[role="button"],[role="link"],summary,label[for]') || null;
  }

  // "Sole content" means the interactive element exposes no other text or image.
  function isSoleContentOf(el, ancestor) {
    if (!ancestor) return false;
    const label = text(ancestor.innerText || ancestor.textContent || '');
    if (!TRIVIAL_TEXT.test(label)) return false;
    const media = ancestor.querySelectorAll('img,svg,picture,canvas');
    return media.length <= 1;
  }

  // Visible text in the nearest labelling container that is not the image itself.
  function siblingText(el) {
    let node = el.parentElement;
    for (let depth = 0; node && depth < 3; depth++, node = node.parentElement) {
      const clone = node.cloneNode(true);
      clone.querySelectorAll?.('img,svg,picture,canvas,script,style').forEach(x => x.remove());
      const value = text(clone.innerText || clone.textContent || '');
      if (value && !TRIVIAL_TEXT.test(value) && value.length <= 120) return value;
      if (value && value.length > 120) return '';
    }
    return '';
  }

  function dimensions(el) {
    let rect = { width: 0, height: 0 };
    try { rect = el.getBoundingClientRect(); } catch {}
    const width = Math.round(rect.width || Number(el.getAttribute?.('width')) || el.naturalWidth || 0);
    const height = Math.round(rect.height || Number(el.getAttribute?.('height')) || el.naturalHeight || 0);
    return { width, height };
  }

  function describe(el) {
    const hay = haystack(el);
    const ancestor = interactiveAncestor(el);
    const { width, height } = dimensions(el);
    let role = '';
    try { role = String(el.getAttribute('role') || '').toLowerCase(); } catch {}
    let ariaHidden = '';
    try { ariaHidden = String(el.getAttribute('aria-hidden') || '').toLowerCase(); } catch {}
    return {
      tag: String(el.tagName || '').toLowerCase(),
      role,
      ariaHidden: ariaHidden === 'true',
      hasAriaLabel: Boolean(el.getAttribute?.('aria-label') || el.getAttribute?.('aria-labelledby')),
      hasDescribedBy: Boolean(el.getAttribute?.('aria-describedby') || el.getAttribute?.('longdesc')),
      iconHint: ICON_HINT.test(hay),
      decorHint: DECOR_HINT.test(hay),
      complexHint: COMPLEX_HINT.test(hay),
      logoHint: LOGO_HINT.test(hay),
      width,
      height,
      small: Boolean(width && height && width <= 64 && height <= 64),
      large: Boolean(width >= 200 && height >= 150),
      interactive: Boolean(ancestor),
      interactiveTag: ancestor ? String(ancestor.tagName || '').toLowerCase() : '',
      soleContentOfInteractive: isSoleContentOf(el, ancestor),
      siblingText: siblingText(el),
      inFigure: Boolean(el.closest?.('figure')),
      hasFigcaption: Boolean(el.closest?.('figure')?.querySelector?.('figcaption')),
      inContentRegion: Boolean(el.closest?.('main,article,[role="main"]'))
    };
  }

  /*
   * Returns { purpose, confidence, rationale, signals, recommendedAlt }
   * purpose: decorative | informative | functional | complex | uncertain
   */
  function classifyDescriptor(d) {
    const signals = [];

    if (d.ariaHidden || d.role === 'presentation' || d.role === 'none') {
      signals.push('element is already hidden from the accessibility tree');
      return verdict('decorative', 'high', 'The element is already marked presentational, so an empty alt keeps the markup internally consistent.', signals, '');
    }

    // Functional beats everything else: an image that IS the control must name the action.
    if (d.interactive && d.soleContentOfInteractive) {
      signals.push(`image is the only content of a ${d.interactiveTag || 'control'}`);
      return verdict('functional', 'high', 'The image is the entire accessible name of an interactive control, so alt must describe the destination or action rather than the picture.', signals, null);
    }
    if (d.interactive) {
      signals.push(`image sits inside a ${d.interactiveTag || 'control'} that already has its own text`);
      if (d.iconHint || d.small) {
        signals.push('icon-sized image alongside existing control text');
        return verdict('decorative', 'medium', 'The surrounding control already exposes its own text, so this image does not need to repeat it.', signals, '');
      }
      return verdict('uncertain', 'low', 'The image is inside an interactive element that has other text. Whether it adds meaning depends on intent.', signals, null);
    }

    if (d.complexHint || (d.inFigure && d.hasFigcaption)) {
      if (d.complexHint) signals.push('name or class suggests a chart, diagram or map');
      if (d.inFigure && d.hasFigcaption) signals.push('image is a figure with a caption');
      return verdict('complex', 'medium', 'The image appears to carry structured information that a short alt cannot fully replace.', signals, null);
    }

    // Explicit description hooks mean somebody deliberately treated this as content.
    if (d.hasDescribedBy) {
      signals.push('element has an explicit long-description relationship');
      return verdict('informative', 'medium', 'The markup already treats this image as carrying information.', signals, null);
    }

    const decorative = [];
    if (d.iconHint) decorative.push('file name or class identifies this as an icon');
    if (d.decorHint) decorative.push('file name or class identifies this as decoration');
    if (d.small) decorative.push(`rendered at ${d.width}\u00d7${d.height}px, consistent with an icon`);
    if (d.siblingText) decorative.push(`adjacent visible text reads "${d.siblingText}"`);

    const informative = [];
    if (d.large) informative.push(`rendered at ${d.width}\u00d7${d.height}px, larger than a typical icon`);
    if (d.logoHint && !d.siblingText) informative.push('appears to be a logo with no adjacent text equivalent');
    if (d.inContentRegion && d.large) informative.push('sits in the main content region at content size');

    // A confident decorative verdict needs corroboration and no contradiction.
    if (decorative.length >= 2 && !informative.length) {
      const redundant = Boolean(d.siblingText);
      return verdict(
        'decorative',
        redundant && (d.iconHint || d.small) ? 'high' : 'medium',
        redundant
          ? `The adjacent text already communicates this, so announcing the image as well would repeat content.`
          : 'The available signals all point to presentation rather than content.',
        decorative,
        ''
      );
    }
    if (informative.length && !decorative.length) {
      return verdict('informative', 'medium', 'The image is presented at content scale with no adjacent text equivalent, so it likely carries meaning of its own.', informative, null);
    }

    return verdict('uncertain', 'low', 'The available evidence does not settle whether this image carries information.', [...decorative, ...informative], null);
  }

  function verdict(purpose, confidence, rationale, signals, recommendedAlt) {
    return { purpose, confidence, rationale, signals: signals.slice(0, 6), recommendedAlt };
  }

  function classifyImage(el) {
    if (!el || el.nodeType !== 1) return verdict('uncertain', 'low', 'No element was resolved for this finding.', [], null);
    const descriptor = describe(el);
    return { ...classifyDescriptor(descriptor), descriptor };
  }

  globalThis.WebQAImagePurpose = { classifyImage, classifyDescriptor, describe };
})();
