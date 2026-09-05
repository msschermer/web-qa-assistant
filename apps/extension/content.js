if (!globalThis.__WEB_QA_CONTENT__) {
  globalThis.__WEB_QA_CONTENT__ = true;

  let observer = null;
  let dirtyTimer = null;
  let lastUrl = location.href;
  let frankSession = null;
  let simpleSpotlightHost = null;
  let simpleSpotlightShadow = null;
  let simpleSpotlightTimer = null;
  let simpleSpotlightFadeTimer = null;
  let simpleSpotlightFollow = null;
  let simpleSpotlightTarget = null;

  function prefersReducedMotion() {
    try { return matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { return false; }
  }

  const clip = (value, max = 1200) => {
    const s = String(value ?? '').replace(/\s+/g, ' ').trim();
    return s.length > max ? s.slice(0, max - 1) + '…' : s;
  };

  const PAGE_DIAG = globalThis.__WEBQA_PAGE_DIAGNOSTICS__ || (globalThis.__WEBQA_PAGE_DIAGNOSTICS__ = { errors: [] });
  function isExtensionNoise(source) {
    return /^(chrome-extension:|moz-extension:|safari-extension:)/i.test(String(source || ''));
  }
  function rememberRuntimeEvent(kind, payload) {
    if (PAGE_DIAG.errors.length >= 25) return;
    const source = String(payload.source || '');
    if (isExtensionNoise(source)) return;
    PAGE_DIAG.errors.push({
      kind,
      message: clip(payload.message, 240),
      source: clip(source.split(/[?#]/)[0], 220),
      line: Number(payload.line) || 0
    });
  }
  if (!globalThis.__WEBQA_PAGE_DIAG_BOUND__) {
    globalThis.__WEBQA_PAGE_DIAG_BOUND__ = true;
    addEventListener('error', event => {
      rememberRuntimeEvent('page_error', { message: event.message || '', source: event.filename || '', line: event.lineno || 0 });
    });
    addEventListener('unhandledrejection', event => {
      const reason = event.reason;
      const message = reason && typeof reason === 'object' ? (reason.message || String(reason)) : String(reason || 'unhandledrejection');
      rememberRuntimeEvent('unhandled_rejection', { message, source: '', line: 0 });
    });
  }

  async function scan() {
    const t0 = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
    const now = () => (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
    const progress = (phase, extra = {}) => {
      try { chrome.runtime.sendMessage({ type: 'SCAN_PROGRESS', phase, ...extra }).catch(() => {}); } catch {}
    };
    progress('DISCOVERING');
    try { await window.WebQARules.preparePerformanceSignals?.(); } catch {}
    const tIx = now();
    progress('CHECKING');
    try { await window.WebQARules.prepareSafeInteractions?.(); } catch {}
    const interactionPrepareMs = Math.round(now() - tIx);
    progress('INSPECTING_FRAMES');
    const local = window.WebQARules.run();
    let axeResults = null;
    const tAxe = now();
    progress('CHECKING');
    try {
      axeResults = await window.axe.run(document, {
        runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'] },
        iframes: true
      });
    } catch {}
    const axeMs = Math.round(now() - tAxe);
    const report = window.WebQARules.merge(local, axeResults, { findings: [], checked: 0 });
    report.page.requestedUrl = location.href;
    report.page.finalUrl = location.href;
    if (globalThis.WebQATargetIntegrity) {
      report.page.targetIntegrity = globalThis.WebQATargetIntegrity.assessTargetIntegrity({
        requestedUrl: location.href,
        finalUrl: location.href,
        title: report.page.title,
        linkCount: report.page.linkCount,
        interactiveCount: report.page.interactiveCount,
        domSignals: globalThis.WebQATargetIntegrity.collectDomSignals({
          html: document.documentElement?.innerHTML || '',
          bodyText: document.body?.innerText || ''
        })
      });
    }
    report.coverage.links = 'pending';
    report.scanTimings = {
      ...(report.scanTimings || {}),
      axeMs,
      interactionMs: Number(report.scanTimings?.interactionMs || 0) + interactionPrepareMs,
      totalMs: Math.round(now() - t0)
    };
    return report;
  }
  async function auditLinks() {
    const started = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
    try {
      chrome.runtime.sendMessage({ type: 'SCAN_PROGRESS', phase: 'VERIFYING_LINKS', queued: 0, completed: 0 }).catch(() => {});
    } catch {}
    try {
      let cacheSeed = [];
      try {
        const snap = await chrome.runtime.sendMessage({ type: 'LINK_CACHE_SNAPSHOT', pageUrl: location.href });
        cacheSeed = Array.isArray(snap?.entries) ? snap.entries : [];
      } catch {}
      const result = await window.WebQARules.auditLinks({
        limit: 500,
        concurrency: 16,
        targetOriginConcurrency: 6,
        externalPerHostConcurrency: 2,
        perHostConcurrency: 2,
        timeoutMs: 2500,
        retryTimeoutMs: 5000,
        emergencyMs: 120000,
        cacheSeed,
        onProgress: (metrics) => {
          try {
            chrome.runtime.sendMessage({
              type: 'SCAN_PROGRESS',
              phase: 'VERIFYING_LINKS',
              queued: metrics.queued,
              completed: metrics.completed,
              inFlight: metrics.inFlight,
              pending: metrics.pending
            }).catch(() => {});
          } catch {}
        }
      });
      result.linkProbeMs = Math.round(((typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now()) - started);
      result.primaryLinkMs = Number(result.primaryLinkMs || result.linkProbeMs || 0);
      try {
        if (result.cacheExport?.length) {
          await chrome.runtime.sendMessage({ type: 'LINK_CACHE_MERGE', entries: result.cacheExport });
        }
      } catch {}
      return result;
    } catch (error) {
      return {
        findings: [],
        checked: 0,
        verifiedHealthy: 0,
        confirmedIssues: 0,
        inconclusive: 0,
        incompleteChecks: [],
        status: 'unavailable',
        technicalMessage: String(error?.message || error || 'link audit failed')
      };
    }
  }

  const SIMPLE_SPOTLIGHT_CSS = `
    :host{all:initial}
    .ring{position:fixed;z-index:1;border-radius:10px;border:2px solid rgba(255,255,255,.95);
      box-shadow:0 0 0 4px rgba(225,67,86,.35),0 0 0 8px rgba(225,67,86,.16),0 0 26px 4px rgba(225,67,86,.35);
      pointer-events:none;opacity:0;transform:scale(.96);
      transition:opacity .22s ease,transform .22s ease,top .16s ease,left .16s ease,width .16s ease,height .16s ease}
    .ring.in{opacity:1;transform:scale(1)}
    .ring.pulse{animation:webqa-hl-pulse 900ms ease-out 2}
    @keyframes webqa-hl-pulse{
      0%{box-shadow:0 0 0 4px rgba(225,67,86,.6),0 0 0 8px rgba(225,67,86,.28),0 0 40px 6px rgba(225,67,86,.55)}
      70%{box-shadow:0 0 0 9px rgba(225,67,86,.1),0 0 0 15px rgba(225,67,86,.05),0 0 44px 6px rgba(225,67,86,.2)}
      100%{box-shadow:0 0 0 4px rgba(225,67,86,.35),0 0 0 8px rgba(225,67,86,.16),0 0 26px 4px rgba(225,67,86,.35)}
    }
    @media(prefers-reduced-motion:reduce){.ring{transition:opacity .12s linear}.ring.pulse{animation:none}}
  `;
  function ensureSimpleSpotlightHost() {
    if (simpleSpotlightHost?.isConnected) return simpleSpotlightShadow;
    simpleSpotlightHost = document.createElement('div');
    simpleSpotlightHost.setAttribute('data-webqa-ui', 'highlight');
    simpleSpotlightHost.setAttribute('data-webqa-highlight', '1');
    Object.assign(simpleSpotlightHost.style, { position: 'fixed', inset: '0', zIndex: '2147483646', pointerEvents: 'none' });
    simpleSpotlightShadow = simpleSpotlightHost.attachShadow({ mode: 'open' });
    simpleSpotlightShadow.innerHTML = `<style>${SIMPLE_SPOTLIGHT_CSS}</style><div class="ring"></div>`;
    document.documentElement.appendChild(simpleSpotlightHost);
    return simpleSpotlightShadow;
  }
  function positionSimpleRing(el, ring) {
    const rect = el.getBoundingClientRect();
    const pad = 4;
    const left = Math.max(2, rect.left - pad), top = Math.max(2, rect.top - pad);
    ring.style.left = `${left}px`;
    ring.style.top = `${top}px`;
    ring.style.width = `${Math.max(8, Math.min(innerWidth - left - 2, rect.width + pad * 2))}px`;
    ring.style.height = `${Math.max(8, Math.min(innerHeight - top - 2, rect.height + pad * 2))}px`;
  }
  function clearSimpleHighlight() {
    document.querySelectorAll('[data-web-qa-highlight]').forEach(el => {
      el.style.outline = el.dataset.webQaOldOutline || '';
      el.style.outlineOffset = el.dataset.webQaOldOutlineOffset || '';
      delete el.dataset.webQaOldOutline;
      delete el.dataset.webQaOldOutlineOffset;
      el.removeAttribute('data-web-qa-highlight');
    });
    clearTimeout(simpleSpotlightTimer); simpleSpotlightTimer = null;
    clearTimeout(simpleSpotlightFadeTimer); simpleSpotlightFadeTimer = null;
    if (simpleSpotlightFollow) {
      window.removeEventListener('scroll', simpleSpotlightFollow, true);
      window.removeEventListener('resize', simpleSpotlightFollow);
      simpleSpotlightFollow = null;
    }
    simpleSpotlightTarget = null;
    if (simpleSpotlightHost) { simpleSpotlightHost.remove(); simpleSpotlightHost = null; simpleSpotlightShadow = null; }
  }

  function injectedUiSnapshot() {
    const highlights = document.querySelectorAll('[data-web-qa-highlight],[data-webqa-highlight]').length;
    const overlays = document.querySelectorAll('[data-webqa-overlay],[data-webqa-ui="frank-overlay"]').length;
    const marked = document.querySelectorAll('[data-webqa-ui],[data-web-qa-ui]').length;
    return {
      created: marked + highlights,
      active: overlays + highlights,
      residualAfterCleanup: 0,
      highlightOverlays: highlights,
      coachOverlays: overlays
    };
  }

  function cleanupInjectedUi() {
    clearSimpleHighlight();
    const frank = document.getElementById('__web_qa_frank_root');
    if (frank) frank.remove();
    const residual = injectedUiSnapshot();
    residual.residualAfterCleanup = residual.active;
    try { globalThis.__WEBQA_INJECTED_UI__ = residual; } catch {}
    return residual;
  }

  function findTarget(targetId, selector = '', ruleId = '') {
    try {
      const validated = window.WebQARules.validateResolvedTarget?.(targetId, selector, { ruleId });
      if (validated) return validated;
      const el = window.WebQARules.resolveTarget(targetId, selector);
      return el ? { found: true, targetStatus: 'valid', el } : { found: false, targetStatus: 'stale', reason: 'The affected element changed after the scan. Recheck this issue to refresh its target.' };
    } catch {
      return { found: false, targetStatus: 'stale', reason: 'The affected element changed after the scan. Recheck this issue to refresh its target.' };
    }
  }
  function liveElement(targetId, selector = '', ruleId = '') {
    const validated = findTarget(targetId, selector, ruleId);
    return validated?.found ? validated.el : null;
  }

  function highlight(targetId, selector, ruleId = '') {
    clearSimpleHighlight();
    const validated = findTarget(targetId, selector, ruleId);
    if (!validated?.found || !validated.el) {
      return { found: false, targetStatus: validated?.targetStatus || 'stale', reason: validated?.reason || 'The affected element changed after the scan. Recheck this issue to refresh its target.' };
    }
    const el = validated.el;
    simpleSpotlightTarget = el;
    const shadow = ensureSimpleSpotlightHost();
    const ring = shadow.querySelector('.ring');
    positionSimpleRing(el, ring);
    el.scrollIntoView?.({ behavior: prefersReducedMotion() ? 'auto' : 'smooth', block: 'center', inline: 'nearest' });
    // A glow that snaps into place reads as a glitch; one frame of layout first,
    // then animate in, so the entrance itself is part of what makes this obvious.
    requestAnimationFrame(() => {
      positionSimpleRing(el, ring);
      ring.classList.add('in');
      if (!prefersReducedMotion()) ring.classList.add('pulse');
    });
    simpleSpotlightFollow = () => { if (simpleSpotlightTarget) positionSimpleRing(simpleSpotlightTarget, ring); };
    window.addEventListener('scroll', simpleSpotlightFollow, true);
    window.addEventListener('resize', simpleSpotlightFollow);
    simpleSpotlightTimer = setTimeout(() => {
      ring.classList.remove('in', 'pulse');
      simpleSpotlightFadeTimer = setTimeout(() => clearSimpleHighlight(), prefersReducedMotion() ? 20 : 240);
    }, 6000);
    return { found: true, targetStatus: 'valid', tag: (el.localName || '').toLowerCase() };
  }

  function targetContext(targetId, selector, ruleId) {
    try {
      return window.WebQARules.targetContextFor(targetId, selector, ruleId) || { found: false };
    } catch { return { found: false }; }
  }

  function dirty() {
    clearTimeout(dirtyTimer);
    dirtyTimer = setTimeout(() => {
      lastUrl = location.href;
      chrome.runtime.sendMessage({ type: 'WATCH_DIRTY', url: lastUrl }).catch(() => {});
    }, 750);
  }

  function enableWatch() {
    if (observer) return { watching: true };
    observer = new MutationObserver(records => {
      if (document.visibilityState === 'hidden' || frankSession) return;
      const relevant = records.some(r => r.type === 'childList' || ['href', 'content', 'rel', 'name', 'id', 'role', 'aria-label', 'aria-labelledby', 'alt', 'lang', 'action', 'target'].includes(r.attributeName));
      if (relevant) dirty();
    });
    observer.observe(document.documentElement, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ['href', 'content', 'rel', 'name', 'id', 'role', 'aria-label', 'aria-labelledby', 'alt', 'lang', 'action', 'target']
    });
    addEventListener('popstate', dirty);
    addEventListener('hashchange', dirty);
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible' && location.href !== lastUrl) dirty();
    });
    return { watching: true };
  }

  const STEP_LABELS = { spotlight: 'Locate', evidence: 'Checks', interpretation: 'Interpret', comparison: 'Comparison', trend: 'History', impact: 'Impact', remediation: 'Fix', verification: 'Verify', summary: 'Summary' };
  const STEP_SHORT = { spotlight: 'Locate', evidence: 'Checks', interpretation: 'Interpret', comparison: 'Compare', trend: 'History', impact: 'Impact', remediation: 'Fix', verification: 'Verify', summary: 'Summary' };
  const VERDICTS = { verified: 'Verified finding', review: 'Needs review', context: 'Context only' };

  /** The Frank coach stylesheet, injected at build time from
   * packages/ui/coach.css.
   *
   * Empty here on purpose. This function used to hold a full copy of that
   * sheet — 9KB the build overwrote on every run, so editing one had no
   * effect on what shipped and the two had already parted company by a rule.
   * One definition, in the file the build actually reads. */
  function frankCss() {
    return '';
  }

  /** The @font-face rules from packages/ui/fonts.css, injected at build time
   * with `__LUMEN_FONT_BASE__` still in them so the runtime can resolve the
   * extension's own URL. */
  function lumenFontFaceTemplate() {
    return '';
  }

  /**
   * Register Lumen's typeface with the host document.
   *
   * @font-face declared inside a shadow root is ignored by the browser — font
   * faces resolve against the document, not the shadow tree — so the one rule
   * both injected surfaces need is the one rule they cannot carry themselves.
   * This adds a single inert <style> to the host page: it declares faces and
   * matches no element, so nothing on the audited page changes appearance, and
   * it is removed again when the last Lumen root closes.
   *
   * The page's own CSP governs whether the files actually load. When it
   * refuses, the fallback stack in tokens.css carries the surface and nothing
   * breaks — which is why that stack is load-bearing rather than decoration.
   */
  function ensureLumenFontFaces() {
    try {
      if (document.getElementById('__web_qa_fonts')) return;
      const template = lumenFontFaceTemplate();
      if (!template) return;
      const style = document.createElement('style');
      style.id = '__web_qa_fonts';
      style.setAttribute('data-webqa-ui', 'fonts');
      style.textContent = template.replaceAll('__LUMEN_FONT_BASE__', chrome.runtime.getURL('fonts/'));
      (document.head || document.documentElement).appendChild(style);
    } catch {}
  }

  /** Lumen leaves no nodes behind: the face registration goes when the last
   * surface that needed it does. */
  function releaseLumenFontFaces() {
    if (document.getElementById('__web_qa_frank_root') || document.getElementById('__web_qa_site_audit_root')) return;
    document.getElementById('__web_qa_fonts')?.remove();
  }

  function createFrankRoot() {
    const old = document.getElementById('__web_qa_frank_root');
    if (old) old.remove();
    const host = document.createElement('div');
    host.id = '__web_qa_frank_root';
    host.setAttribute('data-webqa-ui', 'frank-overlay');
    host.setAttribute('data-webqa-overlay', 'frank');
    host.style.cssText = 'all:initial;position:fixed;inset:0;z-index:2147483647;pointer-events:auto;';
    ensureLumenFontFaces();
    document.documentElement.appendChild(host);
    const shadow = host.attachShadow({ mode: 'open' });
    shadow.innerHTML = `<style>${frankCss()}</style><div class="backdrop"></div><div class="spotlight" hidden></div><section class="coach" role="dialog" aria-modal="true" aria-labelledby="frank-coach-title" aria-describedby="frank-coach-body" tabindex="-1"><div class="accent"></div><div class="top"><span class="mark" aria-hidden="true"></span><span class="identity"><span class="name">Lumen</span><span class="device">Walkthrough</span></span><span class="verdict" hidden></span><span class="progress"></span></div><nav class="rail" aria-label="Walkthrough steps"></nav><div class="scroll"><div class="body" aria-live="polite" aria-atomic="true"><span class="eyebrow"></span><h2 id="frank-coach-title"></h2><p id="frank-coach-body"></p></div><section class="anchor" hidden aria-label="Element status"><span class="anchor-head"></span><p class="anchor-note"></p><code class="anchor-selector" hidden></code><div class="anchor-actions"></div></section><dl class="metrics" hidden></dl><figure class="code" hidden><figcaption class="code-head"><span>Observed markup</span><button type="button" class="mini copy-code">Copy</button></figcaption><pre></pre></figure><div class="sources" hidden></div><p class="state" hidden role="status" aria-live="polite"></p></div><div class="foot"><button type="button" class="nav back">Back</button><button type="button" class="nav ghost preview" hidden>Preview change</button><button type="button" class="nav ghost reset" hidden>Reset preview</button><button type="button" class="nav ghost report-bug">Report bug</button><button type="button" class="nav next">Next</button><button type="button" class="nav return-qa">Back to findings</button></div></section>`;
    return { host, shadow };
  }

  function reasoningLabel(plan, reasoning = {}, readiness = {}) {
    const source = plan?.guidanceSource || (plan?.mode === 'ai' ? 'frank-model' : 'deterministic');
    const ai = plan?.mode === 'ai' && reasoning?.status === 'operational' && source === 'frank-model';
    if (ai && reasoning.provider === 'chrome-built-in') return 'On-device reasoning';
    if (ai) return 'Cloud reasoning';
    if (readiness?.status === 'downloading' || readiness?.status === 'warming' || readiness?.status === 'downloadable') {
      return 'Verified guidance';
    }
    return 'Verified guidance';
  }

  function documentLevelHelper(finding = {}) {
    const rule = String(finding.ruleId || '');
    if (/ttfb|performance\.browser\.(cls|weight|lcp$)/i.test(rule)) {
      return {
        head: 'Page-level performance observation',
        note: 'This measurement applies to the navigation as a whole rather than one visible element, so there is nothing on the page to highlight.'
      };
    }
    if (/noindex|robots|canonical|title|description|hreflang|charset|meta-refresh|og-|schema|jsonld|viewport/i.test(rule)) {
      return {
        head: 'Document metadata',
        note: 'This finding concerns page-level metadata rather than a visible element.'
      };
    }
    if (/uncaught-error|resource-failed|script-failed|visible-error|mixed-content|weight/i.test(rule)) {
      return {
        head: 'Network / runtime observation',
        note: 'This observation comes from runtime or network evidence rather than one highlightable content element.'
      };
    }
    return {
      head: 'Document-level finding',
      note: 'This finding applies to the page as a whole rather than one visible element, so there is nothing on screen to spotlight.'
    };
  }

  function frankTarget(step) {
    if (!frankSession || !step?.targetId) return null;
    const target = frankSession.targets?.[step.targetId] || {};
    return liveElement(step.targetId, target.selector || '', target.ruleId || '');
  }
  function frankSelector(step) {
    if (!frankSession || !step?.targetId) return '';
    return frankSession.targets?.[step.targetId]?.selector || '';
  }
  function targetState(step) {
    if (!step?.targetId) {
      const helper = documentLevelHelper(frankSession?.plan?.finding || {});
      return { found: false, documentLevel: true, reason: helper.note, documentHead: helper.head };
    }
    try {
      const selector = frankSelector(step);
      const ruleId = frankSession.targets?.[step.targetId]?.ruleId || frankSession.plan?.finding?.ruleId || '';
      const validated = findTarget(step.targetId, selector, ruleId);
      if (!validated?.found) {
        return { found: false, documentLevel: false, visible: false, targetStatus: 'stale', reason: validated?.reason || 'The affected element changed after the scan. Recheck this issue to refresh its target.' };
      }
      const state = window.WebQARules.resolvedTargetState(step.targetId, selector);
      return { ...state, found: true, documentLevel: false };
    } catch {
      return { found: !!frankTarget(step), documentLevel: false, reason: '' };
    }
  }

  async function copyText(value) {
    try { await navigator.clipboard.writeText(value); return true; }
    catch {
      try {
        const area = document.createElement('textarea');
        area.value = value; area.style.cssText = 'position:fixed;opacity:0;pointer-events:none';
        document.body.appendChild(area); area.select();
        const ok = document.execCommand('copy'); area.remove(); return ok;
      } catch { return false; }
    }
  }
  function coachState(message, kind = 'ok') {
    if (!frankSession) return;
    const node = frankSession.shadow.querySelector('.state');
    node.textContent = message || '';
    node.dataset.kind = kind;
    node.hidden = !message;
  }

  function positionCoach(coach, rect) {
    const margin = 14, gap = 18;
    const width = Math.min(468, innerWidth - margin * 2);
    coach.style.width = `${Math.max(280, width)}px`;
    if (!rect) {
      // No element to sit beside, so the card becomes the subject: centred,
      // fully legible, and clear of the dimmed page behind it.
      coach.style.left = `${Math.round(Math.max(margin, (innerWidth - width) / 2))}px`;
      const centred = coach.getBoundingClientRect();
      const height = Math.min(centred.height || 300, innerHeight - margin * 2);
      coach.style.top = `${Math.round(Math.max(margin, (innerHeight - height) / 2))}px`;
      return;
    }
    coach.style.left = `${margin}px`; coach.style.top = `${margin}px`;
    const card = coach.getBoundingClientRect(), height = Math.min(card.height || 260, innerHeight - margin * 2);
    const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
    const positions = [
      { left: rect.right + gap, top: rect.top + rect.height / 2 - height / 2 },
      { left: rect.left - width - gap, top: rect.top + rect.height / 2 - height / 2 },
      { left: rect.left + rect.width / 2 - width / 2, top: rect.bottom + gap },
      { left: rect.left + rect.width / 2 - width / 2, top: rect.top - height - gap }
    ];
    const overlaps = p => !(p.left + width < rect.left - 8 || p.left > rect.right + 8 || p.top + height < rect.top - 8 || p.top > rect.bottom + 8);
    let chosen = positions.find(p => p.left >= margin && p.top >= margin && p.left + width <= innerWidth - margin && p.top + height <= innerHeight - margin && !overlaps(p));
    if (!chosen) {
      chosen = positions.map(p => ({ left: clamp(p.left, margin, innerWidth - width - margin), top: clamp(p.top, margin, innerHeight - height - margin) })).find(p => !overlaps(p));
    }
    chosen ||= { left: innerWidth - width - margin, top: margin };
    coach.style.left = `${Math.round(chosen.left)}px`;
    coach.style.top = `${Math.round(chosen.top)}px`;
  }

  function updateSpotlight() {
    if (!frankSession) return;
    const step = frankSession.plan.steps[frankSession.index];
    const el = frankTarget(step);
    const { shadow } = frankSession;
    const spotlight = shadow.querySelector('.spotlight');
    const backdrop = shadow.querySelector('.backdrop');
    const coach = shadow.querySelector('.coach');
    const rect = typeof el?.getBoundingClientRect === 'function' ? el.getBoundingClientRect() : null;
    if (!rect || rect.width < 1 || rect.height < 1) {
      spotlight.hidden = true;
      spotlight.classList.remove('pulse');
      frankSession.lastSpotlightEl = null;
      backdrop.hidden = false;
      backdrop.dataset.soft = 'true';
      coach.dataset.anchored = 'false';
      requestAnimationFrame(() => positionCoach(coach, null));
      return;
    }
    backdrop.hidden = true; backdrop.dataset.soft = 'false';
    spotlight.hidden = false;
    coach.dataset.anchored = 'true';
    const pad = 6, left = Math.max(2, rect.left - pad), top = Math.max(2, rect.top - pad);
    spotlight.style.left = `${left}px`; spotlight.style.top = `${top}px`;
    spotlight.style.width = `${Math.max(8, Math.min(innerWidth - left - 2, rect.width + pad * 2))}px`;
    spotlight.style.height = `${Math.max(8, Math.min(innerHeight - top - 2, rect.height + pad * 2))}px`;
    // Reposition runs constantly (scroll, resize, follow timers) — the pulse
    // should only fire when the walkthrough actually lands on a new element,
    // not every time that same element's box is recalculated.
    if (el !== frankSession.lastSpotlightEl) {
      frankSession.lastSpotlightEl = el;
      if (!prefersReducedMotion()) {
        spotlight.classList.remove('pulse');
        void spotlight.offsetWidth;
        spotlight.classList.add('pulse');
      }
    }
    requestAnimationFrame(() => positionCoach(coach, rect));
  }

  function stepLabel(step) { return STEP_LABELS[step?.type] || 'Guidance'; }

  function renderRail() {
    const { shadow, plan, index } = frankSession;
    const rail = shadow.querySelector('.rail');
    rail.replaceChildren();
    plan.steps.forEach((step, i) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.dataset.state = i === index ? 'current' : i < index ? 'done' : 'todo';
      button.dataset.role = step.type || '';
      button.title = step.headline || stepLabel(step);
      button.setAttribute('aria-label', `${STEP_SHORT[step.type] || stepLabel(step)}: ${step.headline || stepLabel(step)} (step ${i + 1} of ${plan.steps.length})`);
      if (i === index) button.setAttribute('aria-current', 'step');
      const bar = document.createElement('i'), label = document.createElement('b');
      label.textContent = STEP_SHORT[step.type] || stepLabel(step);
      button.append(bar, label);
      button.addEventListener('click', () => renderFrank(i, true));
      rail.appendChild(button);
    });
  }

  // Everything the plan carries for this step is worth showing: the walkthrough
  // is the only place a person sees the measurements and markup Frank reasoned
  // from, and hiding them was what made the card feel empty.
  function renderAnchor(step) {
    const { shadow } = frankSession;
    const anchor = shadow.querySelector('.anchor');
    const head = anchor.querySelector('.anchor-head');
    const note = anchor.querySelector('.anchor-note');
    const selectorNode = anchor.querySelector('.anchor-selector');
    const actions = anchor.querySelector('.anchor-actions');
    const state = targetState(step);
    const selector = frankSelector(step);
    actions.replaceChildren();
    selectorNode.hidden = !selector;
    selectorNode.textContent = selector;

    if (state.documentLevel) {
      const markupMode = /markup/i.test(String(frankSession?.plan?.finding?.targetability || ''));
      const helper = documentLevelHelper(frankSession?.plan?.finding || {});
      anchor.dataset.tone = 'document';
      head.textContent = markupMode ? 'Page configuration' : (state.documentHead || helper.head);
      note.textContent = markupMode
        ? (state.reason || 'This finding is about document markup rather than a single visible element. The relevant sanitized markup is shown below.')
        : (state.reason || helper.note);
    } else if (!step?.targetId && /spotlight|multiple/i.test(String(frankSession?.plan?.finding?.targetability || ''))) {
      anchor.dataset.tone = 'missing';
      head.textContent = 'Element not re-anchored';
      note.textContent = 'The recorded element could not be re-anchored on the live page, so a spotlight will not be guessed. The evidence below still stands.';
    } else if (state.found && state.visible !== false) {
      anchor.dataset.tone = 'located';
      head.textContent = `Highlighted on the page${state.tag ? ` · <${state.tag}>` : ''}`;
      note.textContent = 'The spotlight is on the real element. Scroll or resize and it follows.';
    } else if (state.found) {
      anchor.dataset.tone = 'missing';
      head.textContent = 'Element present but not visible';
      note.textContent = state.reason || 'The element exists in the DOM but is not currently rendered, so it cannot be spotlighted.';
    } else {
      anchor.dataset.tone = 'missing';
      head.textContent = 'Element not found right now';
      const described = state.described || {};
      const descriptors = [described.text && `text "${clip(described.text, 80)}"`, described.alt && `alt "${clip(described.alt, 60)}"`, described.href && `href ${clip(described.href, 70)}`, described.src && `src ${clip(described.src, 70)}`].filter(Boolean);
      note.textContent = `${state.reason || 'The element could not be located on the page.'}${descriptors.length ? ` It was recorded as ${descriptors.join(', ')}.` : ''} The evidence below still stands on its own.`;
      const retry = document.createElement('button');
      retry.type = 'button'; retry.className = 'mini'; retry.textContent = 'Look again';
      retry.addEventListener('click', () => {
        renderAnchor(step); updateSpotlight();
        coachState(frankTarget(step) ? 'Found it. The element is highlighted now.' : 'Still not on the page. Start a new scan if the page has changed since the scan.', frankTarget(step) ? 'ok' : 'error');
      });
      actions.appendChild(retry);
    }

    if (selector) {
      const copy = document.createElement('button');
      copy.type = 'button'; copy.className = 'mini'; copy.textContent = 'Copy selector';
      copy.addEventListener('click', async () => coachState(await copyText(selector) ? 'Selector copied.' : 'Clipboard was not available.', 'ok'));
      actions.appendChild(copy);
    }
    anchor.hidden = false;
  }

  function renderMetrics(step) {
    const list = frankSession.shadow.querySelector('.metrics');
    list.replaceChildren();
    const metrics = (step.metrics || []).filter(m => m?.label && m?.value !== '');
    for (const metric of metrics) {
      const wrap = document.createElement('div'), dt = document.createElement('dt'), dd = document.createElement('dd');
      wrap.className = 'metric';
      dt.textContent = metric.label; dd.textContent = String(metric.value);
      wrap.append(dt, dd); list.appendChild(wrap);
    }
    list.hidden = !metrics.length;
  }

  function renderCode(step) {
    const figure = frankSession.shadow.querySelector('.code');
    const code = String(step.code || '').trim();
    figure.querySelector('pre').textContent = code;
    figure.hidden = !code;
    const copy = figure.querySelector('.copy-code');
    copy.onclick = async () => coachState(await copyText(code) ? 'Markup copied.' : 'Clipboard was not available.', 'ok');
  }

  function renderSources(step) {
    const wrap = frankSession.shadow.querySelector('.sources');
    wrap.replaceChildren();
    const labels = [...new Set(step.sourceLabels || [])];
    for (const label of labels) {
      const chip = document.createElement('span'); chip.textContent = label; wrap.appendChild(chip);
    }
    const count = (step.evidenceRefs || []).length;
    if (count) {
      const note = document.createElement('em');
      note.textContent = `${count} supporting evidence ${count === 1 ? 'item' : 'items'} for this step`;
      wrap.appendChild(note);
    }
    wrap.hidden = !labels.length && !count;
  }

  function renderVerdict() {
    const badge = frankSession.shadow.querySelector('.verdict');
    const assessment = frankSession.plan?.assessment;
    const status = assessment?.status || '';
    badge.textContent = VERDICTS[status] || '';
    badge.dataset.status = status;
    badge.title = [assessment?.statement, assessment?.limitations].filter(Boolean).join(' ');
    badge.hidden = !VERDICTS[status];
  }

  function renderFrank(index, notify = false) {
    if (!frankSession) return { ok: false };
    const steps = frankSession.plan.steps;
    const nextIndex = Math.max(0, Math.min(steps.length - 1, Number(index) || 0));
    if (nextIndex !== frankSession.index) resetPreview();
    frankSession.index = nextIndex;
    const step = steps[frankSession.index], { shadow } = frankSession;
    shadow.querySelector('.eyebrow').textContent = stepLabel(step);
    shadow.querySelector('h2').textContent = step.headline || 'Walkthrough guidance';
    shadow.querySelector('p').textContent = step.body || '';
    shadow.querySelector('.progress').textContent = `${frankSession.index + 1} / ${steps.length}`;
    shadow.querySelector('.back').disabled = frankSession.index === 0;
    shadow.querySelector('.next').textContent = frankSession.index === steps.length - 1 ? 'Back to findings' : 'Next';
    shadow.querySelector('.return-qa').hidden = frankSession.index === steps.length - 1;
    coachState('');
    renderVerdict();
    renderRail();
    renderAnchor(step);
    renderMetrics(step);
    renderCode(step);
    renderSources(step);
    const preview = shadow.querySelector('.preview');
    preview.hidden = !(step.preview?.enabled && step.targetId);
    preview.onclick = () => {
      const result = previewFrank(step.targetId, step.preview);
      if (!result.ok) return coachState(result.error || 'Preview could not be applied.', 'error');
      shadow.querySelector('.reset').hidden = false;
      coachState('Temporary preview applied to the live page. Nothing was saved.', 'ok');
    };
    shadow.querySelector('.reset').onclick = () => {
      resetPreview();
      shadow.querySelector('.reset').hidden = true;
      coachState('Preview reset.', 'ok');
    };
    shadow.querySelector('.scroll').scrollTop = 0;
    const el = frankTarget(step);
    if (el) el.scrollIntoView?.({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'center', inline: 'nearest' });
    setTimeout(updateSpotlight, el ? 180 : 0);
    scheduleTargetRetry(step);
    if (notify) chrome.runtime.sendMessage({ type: 'FRANK_STEP_CHANGED', index: frankSession.index, stepId: step.id }).catch(() => {});
    return { ok: true, index: frankSession.index, stepId: step.id };
  }

  // Lazy sections, entrance animations and hydration all land after the step is
  // first drawn, so a single miss at render time is not treated as final.
  function scheduleTargetRetry(step) {
    if (!frankSession || !step?.targetId) return;
    clearTimeout(frankSession.retryTimer);
    let attempt = 0;
    const delays = [300, 800, 1600];
    const tick = () => {
      if (!frankSession || frankSession.plan.steps[frankSession.index] !== step) return;
      if (frankTarget(step)) { renderAnchor(step); updateSpotlight(); return; }
      if (attempt >= delays.length) return;
      frankSession.retryTimer = setTimeout(tick, delays[attempt++]);
    };
    frankSession.retryTimer = setTimeout(tick, delays[attempt++]);
  }

  function resetPreview() {
    if (!frankSession?.previewRestore) return;
    const { el, property, value, priority } = frankSession.previewRestore;
    if (el?.isConnected) el.style.setProperty(property, value, priority);
    frankSession.previewRestore = null;
  }

  function returnToQa() {
    if (!frankSession || frankSession.returning) return;
    frankSession.returning = true;
    const findingId = frankSession.plan?.findingId || '';
    const stepIndex = frankSession.index || 0;
    coachState('Returning to findings…', 'ok');
    // Synchronous sendMessage from the click/Escape path preserves the user gesture for sidePanel.open in the service worker.
    chrome.runtime.sendMessage({
      type: 'RETURN_TO_QA',
      findingId,
      stepIndex
    }, response => {
      const err = chrome.runtime.lastError;
      if (err || !response?.ok || !response?.opened) {
        frankSession.returning = false;
        coachState(response?.error || err?.message || 'Could not reopen findings. Keep this card, or use the Lumen toolbar icon.', 'error');
        return;
      }
      if (frankSession) endFrank(false);
    });
  }

  function endFrank(notify = true) {
    if (!frankSession) return { ended: true, injectedUi: cleanupInjectedUi() };
    resetPreview();
    clearTimeout(frankSession.retryTimer);
    clearTimeout(frankSession.reflowTimer);
    removeEventListener('scroll', updateSpotlight, true);
    removeEventListener('resize', onFrankViewportChange, true);
    document.removeEventListener('keydown', frankSession.keyHandler, true);
    const returnFocus = frankSession.returnFocus;
    frankSession.host.remove();
    releaseLumenFontFaces();
    frankSession = null;
    try { returnFocus?.focus?.({ preventScroll: true }); } catch {}
    const injectedUi = cleanupInjectedUi();
    if (notify) chrome.runtime.sendMessage({ type: 'FRANK_CLOSED' }).catch(() => {});
    return { ended: true, injectedUi };
  }

  function onFrankViewportChange() {
    if (!frankSession) return;
    updateSpotlight();
    clearTimeout(frankSession.reflowTimer);
    frankSession.reflowTimer = setTimeout(() => updateSpotlight(), 180);
  }

  function startFrank(plan, targets = {}, reasoning = {}, readiness = {}) {
    endFrank(false);
    const { host, shadow } = createFrankRoot();
    const returnFocus = document.activeElement;
    const keyHandler = event => {
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); returnToQa(); }
      else if (event.key === 'Tab') {
        const focusable = [...shadow.querySelectorAll('button:not(:disabled)')].filter(el => !el.hidden && el.getAttribute('aria-hidden') !== 'true' && !el.closest('[hidden]'));
        if (!focusable.length) return;
        const first = focusable[0], last = focusable[focusable.length - 1], active = shadow.activeElement;
        const outside = !focusable.includes(active);
        if (event.shiftKey && (active === first || outside)) { event.preventDefault(); event.stopPropagation(); last.focus(); }
        else if (!event.shiftKey && (active === last || outside)) { event.preventDefault(); event.stopPropagation(); first.focus(); }
      }
      else if (event.key === 'ArrowRight' && !event.target?.matches?.('input,textarea,select,[contenteditable=true]')) renderFrank((frankSession?.index || 0) + 1, true);
      else if (event.key === 'ArrowLeft' && !event.target?.matches?.('input,textarea,select,[contenteditable=true]')) renderFrank((frankSession?.index || 0) - 1, true);
    };
    frankSession = { plan, targets, reasoning, readiness, host, shadow, index: 0, keyHandler, previewRestore: null, returnFocus, retryTimer: null, reflowTimer: null, returning: false, tabId: null, windowId: null };
    shadow.querySelector('.device').textContent = reasoningLabel(plan, reasoning, readiness);
    shadow.querySelector('.return-qa').addEventListener('click', () => returnToQa());
    shadow.querySelector('.report-bug')?.addEventListener('click', () => {
      chrome.runtime.sendMessage({ type: 'OPEN_REPORT_BUG_FROM_FRANK', windowId: frankSession?.windowId }).catch(() => {});
    });
    shadow.querySelector('.back').addEventListener('click', () => renderFrank(frankSession.index - 1, true));
    shadow.querySelector('.next').addEventListener('click', () => {
      if (frankSession.index >= plan.steps.length - 1) returnToQa();
      else renderFrank(frankSession.index + 1, true);
    });
    addEventListener('scroll', updateSpotlight, true);
    addEventListener('resize', onFrankViewportChange, true);
    document.addEventListener('keydown', keyHandler, true);
    renderFrank(0, true);
    setTimeout(() => shadow.querySelector('.coach')?.focus(), 0);
    setTimeout(() => updateSpotlight(), 80);
    setTimeout(() => updateSpotlight(), 320);
    setTimeout(() => updateSpotlight(), 700);
    return { started: true, stepCount: plan.steps.length };
  }

  function previewFrank(targetId, preview) {
    if (!frankSession || !preview?.enabled) return { ok: false, error: 'No preview is available for this step.' };
    const allowed = new Set(['color', 'background-color', 'font-size', 'line-height', 'outline', 'border-color']);
    if (!allowed.has(preview.property) || !preview.value || preview.value.length > 120 || !CSS.supports(preview.property, preview.value)) return { ok: false, error: 'The suggested preview is not a safe supported CSS change.' };
    const selector = frankSession.targets?.[targetId]?.selector || '';
    const el = liveElement(targetId, selector);
    if (!el?.style) return { ok: false, error: 'The affected element is no longer present.' };
    resetPreview();
    frankSession.previewRestore = { el, property: preview.property, value: el.style.getPropertyValue(preview.property), priority: el.style.getPropertyPriority(preview.property) };
    el.style.setProperty(preview.property, preview.value, 'important');
    updateSpotlight();
    return { ok: true };
  }

  // --- Site Audit: full-page workspace ------------------------------------
  // Same conceptual foundation as Frank's Walkthrough (a shadow-DOM overlay
  // over the current page, dimmed backdrop, its own focused UI) but for a
  // fundamentally different workflow: configuring and watching a persistent,
  // server-side multi-page crawl rather than stepping through one finding.
  // The overlay only ever holds an audit id and polls the gateway for it, so
  // closing/reopening it (or the tab navigating) never loses audit progress.
  let siteAudit = null;

  /** The Lumen palette, injected at build time from packages/ui/tokens.css.
   *
   * Empty here on purpose. scripts/build-extension.mjs replaces this body the
   * same way it replaces frankCss(), because an overlay injected into a
   * third-party page under `:host{all:initial}` can never link the compiled
   * stylesheet. Before this existed the overlay kept a private copy of the
   * palette, and the copy had already drifted: two of the five severity steps
   * disagreed with the sealed ramp. */
  function lumenTokens() {
    return '';
  }

  function siteAuditCss() {
    return `
      :host{all:initial;
        /* Lumen Site Audit — the operator's console. Near-black grounds,
           violet as the single product voice, one sealed severity ramp, and
           structure carried by hairlines rather than shadow.

           all:initial means an unstyled size is the browser's 16px rather than
           the product's, so the body step is declared here and inherited. The
           Overview's coverage note rendered at 16px for exactly that reason.

           Every value below is an alias of packages/ui/tokens.css, which is
           injected directly above them. Nothing here may name a colour of its
           own: a second definition is how the ramp drifted the first time. */
        font-size:13px;
        ${lumenTokens()}

        --sa-backdrop:var(--wqa-backdrop);  /* the scrim over the audited page */
        --sa-canvas:var(--wqa-canvas);      /* app background behind panels */
        --sa-surface:var(--wqa-surface);    /* cards, tables, panels */
        --sa-subtle:var(--wqa-sunken);      /* table heads, inset rows, hover */
        --sa-nav:var(--wqa-surface);        /* side navigation */

        --sa-ink:var(--wqa-ink);            /* primary text */
        --sa-ink-soft:var(--wqa-ink-soft);  /* secondary text */
        --sa-ink-faint:var(--wqa-ink-faint);/* meta, labels, placeholders */
        --sa-line:var(--wqa-line);          /* hairline between rows */
        --sa-line-strong:var(--wqa-line-strong);

        /* One primary. Indigo carries the product's own voice: navigation,
           primary actions, focus, selection. It never means severity. */
        --sa-primary:var(--wqa-brand);
        --sa-primary-hover:var(--wqa-brand-strong);
        --sa-primary-soft:var(--wqa-brand-soft);
        --sa-primary-line:var(--wqa-brand-line);
        --sa-primary-text:var(--wqa-brand-text);
        --sa-surface-raised:var(--wqa-surface-raised);

        /* Semantic TEXT colours — safe on their own wash and on any ground.
           These are what a badge, a pill or an error message uses. */
        --sa-critical:var(--wqa-critical);
        --sa-critical-soft:var(--wqa-critical-soft);
        --sa-warn:var(--wqa-warn);
        --sa-warn-soft:var(--wqa-warn-soft);
        --sa-success:var(--wqa-ok);
        --sa-success-soft:var(--wqa-ok-soft);
        --sa-success-line:color-mix(in srgb,var(--wqa-ok) 40%,transparent);
        
        --sa-info-soft:var(--wqa-sunken);

        /* Severity ramp — FILLS ONLY: bars, rails, dots, legend swatches.
           Bright by design and not cleared for text on a tint, which is why
           the pair above exists and why nothing here may be used as a colour. */
        --sa-sev-critical:var(--wqa-sev-critical);
        --sa-sev-high:var(--wqa-sev-high);
        --sa-sev-medium:var(--wqa-sev-medium);
        --sa-sev-low:var(--wqa-sev-low);
        --sa-sev-info:var(--wqa-sev-info);

        --sa-radius:var(--wqa-r);
        --sa-radius-sm:var(--wqa-r-sm);
        --sa-shadow-sm:var(--wqa-shadow);
        --sa-shadow:var(--wqa-shadow-md);
        --sa-shadow-lg:var(--wqa-shadow-lg);

        --sa-sans:var(--wqa-sans);
        --sa-mono:var(--wqa-mono);
        --sa-hatch:var(--wqa-hatch)}
      /* all:initial on the host resets inherited type, so this reset is what
         actually puts Lumen's face on the overlay. scrollbar-width rides along
         because it is the one property in the palette's browser-chrome block
         that does not inherit, so it cannot travel with the tokens; thin drops
         the arrow buttons and the 15px rail. */
      *{box-sizing:border-box;font-family:var(--sa-sans);scrollbar-width:thin}
      [hidden]{display:none!important}
      /* Anchors get the product's voice rather than the browser's. Under
         :host{all:initial} an unstyled <a> still takes the UA link colours, and
         :visited paints a second one — so an ordinary list of URLs arrives in two
         colours neither of which is ours, distinguished by whether the operator
         happened to have opened that page before. --sa-primary-text is the primary
         as text; the fill is never the ink. */
      a{color:var(--sa-primary-text);text-decoration:none}
      a:hover{color:var(--sa-primary-hover);text-decoration:underline}
      a:focus-visible{outline:2px solid var(--sa-primary);outline-offset:2px;border-radius:2px}
      /* The scrim over the audited page. It was .72, which over a white site
         computed to a mid grey — and since the workspace is inset 24px, that grey
         ran the full height of the right edge at almost exactly a scrollbar's
         width, in almost exactly a scrollbar's tone. With both real scrollbars
         gone it was the only thing left at that edge and read as a stray rail.
         At .93 the page still comes through as shape and colour, which is the
         point of a translucent backdrop, but never as something that could be
         mistaken for chrome. The value is mixed from the palette rather than
         restated as a literal triple. */
      .backdrop{position:fixed;inset:0;background:color-mix(in srgb,var(--sa-backdrop) 93%,transparent);z-index:1;backdrop-filter:blur(2px)}

      /* The browser's own chrome — scrollbars, carets, checkboxes, selects —
         themed from the palette so it stops being the one light thing on a
         near-black surface. tokens.css declares the same three properties, but
         they cannot arrive that way here: the host element carries all:initial
         as an inline style, and an inline declaration outranks :host, so every
         inherited property reaching this tree is reset to the browser default.
         The workspace is the first element the inline style does not touch,
         which makes it the place the palette can take them back. */
      .workspace{position:fixed;inset:24px;z-index:2;background:var(--sa-canvas);border-radius:12px;box-shadow:var(--sa-shadow-lg);display:flex;flex-direction:column;overflow:hidden;color:var(--sa-ink);color-scheme:dark;accent-color:var(--sa-primary);scrollbar-color:var(--sa-ink-faint) transparent}

      /* Top bar ------------------------------------------------------------ */
      .head{display:flex;align-items:center;gap:12px;padding:0 16px;height:56px;background:var(--sa-surface);border-bottom:1px solid var(--sa-line);flex:0 0 auto}
      .mark{display:block;flex:0 0 auto;width:26px;height:26px;border-radius:8px;background:var(--sa-primary);position:relative}
      .mark::after{content:"";position:absolute;inset:8px;border-radius:50%;border:2px solid #fff}
      .identity{display:flex;align-items:baseline;gap:8px;margin-right:auto}
      .identity .name{font-size:15px;font-weight:650;letter-spacing:-.01em;color:var(--sa-ink)}
      .identity .device{font-size:12.5px;color:var(--sa-ink-faint)}
      .close{border:1px solid var(--sa-line-strong);background:var(--sa-surface);width:32px;height:32px;display:grid;place-items:center;color:var(--sa-ink-faint);cursor:pointer;border-radius:var(--sa-radius-sm)}
      .close .x{width:15px;height:15px;fill:none;stroke:currentColor;stroke-width:1.5;stroke-linecap:round}
      .close:hover{background:var(--sa-subtle);color:var(--sa-ink)}

      /* The foot note is a child of .body, so .body stacks; the view inside it
         is the row that carries nav and main. */
      .body{flex:1 1 auto;overflow:hidden;padding:0;display:flex;flex-direction:column;min-height:0}

      /* Views: side nav + scrolling main ----------------------------------- */
      .view{display:none;flex:1 1 auto;min-width:0}
      .view.active{display:flex;align-items:stretch;flex:1 1 auto;min-height:0}

      .sidenav{width:216px;flex:0 0 auto;background:var(--sa-nav);border-right:1px solid var(--sa-line);display:flex;flex-direction:column;padding:14px 12px;overflow:auto}

      .nav-site{padding:0 8px 12px;margin:0 0 12px;border-bottom:1px solid var(--sa-line)}
      .nav-site b{display:block;font-size:13px;font-weight:600;color:var(--sa-ink);overflow-wrap:anywhere}
      .nav-site span{display:block;margin-top:2px;font-size:11.5px;color:var(--sa-ink-faint);font-variant-numeric:tabular-nums}
      .tabs{display:flex;flex-direction:column;gap:2px;border:0;margin:0}
      .tab{display:flex;align-items:center;gap:8px;width:100%;border:0;background:transparent;padding:8px 10px;border-radius:var(--sa-radius-sm);font-size:13.5px;font-weight:500;color:var(--sa-ink-soft);cursor:pointer;text-align:left}
      .tab:hover{background:var(--sa-subtle);color:var(--sa-ink)}
      .tab:focus-visible{outline:2px solid var(--sa-primary);outline-offset:1px}
      .tab.active{background:var(--sa-primary-soft);color:var(--sa-primary-text);font-weight:600}
      .tab-label{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
      .nav-foot{margin-top:auto;padding-top:14px;display:flex;flex-direction:column;gap:8px}
      /* The sidebar scrolls, so a popover anchored inside it would be clipped
         by its own container. The menu is positioned against the viewport and
         placed from the button's rect when it opens. */
      .download{position:relative}
      .download-menu{position:fixed;z-index:40;width:308px;background:var(--sa-surface-raised);border:1px solid var(--sa-line-strong);border-radius:var(--sa-radius);box-shadow:var(--sa-shadow-lg);padding:13px 14px}
      .download-head{margin:0 0 5px;padding:0 4px;font-size:11px;font-weight:650;letter-spacing:.07em;text-transform:uppercase;color:var(--sa-ink-faint)}
      .download-opt{display:grid;grid-template-columns:15px minmax(0,1fr);gap:10px;align-items:start;padding:7px 4px;border-radius:var(--sa-radius-sm);cursor:pointer}
      .download-opt:hover{background:var(--sa-subtle)}
      .download-opt input{margin:2px 0 0;width:14px;height:14px;accent-color:var(--sa-primary)}
      .download-opt b{display:block;font-size:12.5px;font-weight:600;color:var(--sa-ink)}
      .download-opt em{display:block;margin-top:2px;font-style:normal;font-size:11.5px;line-height:1.45;color:var(--sa-ink-faint)}
      .download-what{margin:8px 0 11px;padding-top:9px;border-top:1px solid var(--sa-line);font-size:11.5px;line-height:1.45;color:var(--sa-ink-faint)}
      .download-actions{display:flex;flex-direction:column;gap:4px}
      .download-actions .link-btn{margin-left:0;text-align:left;padding:4px 2px}

      .main{flex:1 1 auto;min-width:0;overflow:auto;padding:20px 24px 28px;background:var(--sa-canvas)}
      .main-narrow{max-width:none;margin:0;width:100%;padding-left:max(24px,calc((100% - 960px) / 2));padding-right:max(24px,calc((100% - 960px) / 2))}

      /* A run in progress: full width, controls beside the title, and the
         activity feed taking whatever vertical space is left rather than
         stranding it. */
      .run-main{max-width:none;margin:0;width:100%;display:flex;flex-direction:column;min-height:0;padding-left:max(24px,calc((100% - 1280px) / 2));padding-right:max(24px,calc((100% - 1280px) / 2))}
      .run-head{align-items:center}
      .run-target{margin:4px 0 0;font-size:13.5px;color:var(--sa-ink-faint);font-family:var(--sa-mono);overflow-wrap:anywhere}
      .run-actions{margin-left:auto;display:flex;gap:10px;flex-wrap:wrap}
      /* Six counters read as one instrument row, not as a ragged wrap. */
      .stat-grid.run-stats{grid-template-columns:repeat(6,minmax(0,1fr));gap:12px;margin:0 0 16px}
      .stat-grid.run-stats>div{padding:12px 14px}
      .stat-grid.run-stats dd{font-size:22px}
      @media(max-width:1180px){.stat-grid.run-stats{grid-template-columns:repeat(3,minmax(0,1fr))}}
      @media(max-width:720px){.stat-grid.run-stats{grid-template-columns:repeat(2,minmax(0,1fr))}}
      /* The feed is the live part of this screen, so it gets the leftover height. */
      .page-head{display:flex;align-items:flex-start;gap:16px;flex-wrap:wrap;margin:0 0 18px}
      h2{margin:0;font-size:18px;font-weight:650;letter-spacing:-.02em;line-height:1.2}
      .results-summary{margin:6px 0 0;color:var(--sa-ink-soft);font-size:13.5px;line-height:1.55;max-width:82ch}

      /* Scope banner: sits outside the tab panels so it stays on screen on
         Findings, Pages and Links too — every count in all four sections is a
         count of the pages that were actually fetched. Hatched rail, not a
         severity colour: an unfinished survey is a coverage fact, not a
         defect, and the drawing convention for "outside the survey" is
         already the hatch (see .cov-unsurveyed). */
      .scope-banner{display:flex;align-items:stretch;gap:0;margin:0 0 16px;background:var(--sa-surface);border:1px solid var(--sa-line-strong);border-radius:var(--sa-radius);overflow:hidden;box-shadow:var(--sa-shadow-sm)}
      .scope-banner::before{content:"";flex:0 0 auto;width:6px;background:var(--sa-subtle);background-image:var(--sa-hatch)}
      .scope-text{margin:0;padding:11px 14px;font-size:13px;line-height:1.55;color:var(--sa-ink-soft)}
      .scope-text b{color:var(--sa-ink);font-weight:650;font-variant-numeric:tabular-nums}

      /* Cards --------------------------------------------------------------- */
      .card{background:var(--sa-surface);border:1px solid var(--sa-line);border-radius:var(--sa-radius);box-shadow:var(--sa-shadow-sm)}
      .card-head{display:flex;align-items:center;gap:10px;padding:12px 14px;border-bottom:1px solid var(--sa-line)}
      .card-head h3{margin:0;font-size:13.5px;font-weight:600;color:var(--sa-ink)}
      .feed-heading{margin:0 0 10px;font-size:13.5px;font-weight:600;color:var(--sa-ink);letter-spacing:0;text-transform:none;padding:0;border:0}

      /* Scan progress -------------------------------------------------------
         The screen an operator watches, so it answers "what is happening right
         now" before it answers anything else: phase, rate, and the URL in
         flight. Nothing here is a summary; summaries are the results view. */
      .panel-title{margin:0 0 14px;font-size:26px;font-weight:650;letter-spacing:-.025em}
      .run-identity h2{margin:0}
      .run-identity h2 .run-target{font-family:var(--sa-mono);font-size:13px;color:var(--sa-ink-soft);font-weight:600}
      .chip-row{display:flex;flex-wrap:wrap;gap:8px;margin:9px 0 0}
      .pulse-dot{width:7px;height:7px;border-radius:50%;background:currentColor;flex:0 0 auto;animation:sa-pulse 1.8s ease-in-out infinite}
      @keyframes sa-pulse{0%,100%{opacity:1;transform:scale(1)}50%{opacity:.35;transform:scale(.72)}}
      .icon-btn{width:38px;padding:0;justify-content:center}
      .stop-glyph{width:11px;height:11px;border-radius:2px;background:currentColor;display:block}
      .btn.quiet{background:var(--sa-primary-soft);border-color:var(--sa-primary-line);color:var(--sa-primary-text)}
      .btn.quiet:hover:not(:disabled){background:color-mix(in srgb,var(--sa-primary) 22%,transparent)}

      /* Phase stepper. A crawl waiting on the browser pass is not a stuck
         crawl, and the only way to tell from a single bar is to be told. */
      .stepper{list-style:none;display:grid;grid-auto-flow:column;grid-auto-columns:1fr;gap:0;margin:0 0 16px;padding:0}
      .step{display:flex;align-items:center;gap:10px;min-width:0}
      .step-mark{flex:0 0 auto;width:26px;height:26px;border-radius:50%;display:grid;place-items:center;font-size:11.5px;font-weight:650;border:1px solid var(--sa-line-strong);background:var(--sa-subtle);color:var(--sa-ink-faint)}
      .step[data-state=done] .step-mark{background:var(--sa-success-soft);border-color:color-mix(in srgb,var(--sa-success) 45%,transparent);color:var(--sa-success)}
      .step[data-state=active] .step-mark{background:var(--sa-primary);border-color:var(--sa-primary);color:#fff}
      .step-body{min-width:0}
      .step-name{display:block;font-size:13px;font-weight:600;color:var(--sa-ink-faint);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
      .step[data-state=done] .step-name,.step[data-state=active] .step-name{color:var(--sa-ink)}
      .step-note{display:block;margin-top:1px;font-size:11.5px;color:var(--sa-ink-faint);font-variant-numeric:tabular-nums;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
      .step-rule{flex:1 1 auto;height:1px;background:var(--sa-line);margin:0 12px;min-width:12px}
      .step[data-state=done] .step-rule{background:color-mix(in srgb,var(--sa-success) 40%,transparent)}

      .phase-card{background:var(--sa-surface);border:1px solid var(--sa-line);border-radius:var(--sa-radius);padding:15px 17px 16px;margin:0 0 14px}
      .phase-top{display:flex;align-items:center;gap:11px;margin:0 0 11px;flex-wrap:wrap}
      .phase-name{margin:0;font-size:15px;font-weight:650;color:var(--sa-ink)}
      .phase-count{margin-left:auto;font-size:12.5px;color:var(--sa-ink-soft);font-variant-numeric:tabular-nums}
      /* dt and dd are separate grid items, so each pair is wrapped rather than
         relying on auto-placement, which laid them out side by side. */
      .phase-metrics{display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:14px;margin:14px 0 0}
      .metric-pair{min-width:0}
      .phase-metrics dt{font-size:11px;font-weight:650;letter-spacing:.07em;text-transform:uppercase;color:var(--sa-ink-faint);margin:0 0 4px}
      .phase-metrics dd{margin:0;font-size:15px;font-weight:600;color:var(--sa-ink);font-variant-numeric:tabular-nums}
      .now-requesting{display:flex;align-items:baseline;gap:10px;margin:14px 0 0;padding:10px 12px;background:var(--sa-subtle);border:1px solid var(--sa-line);border-radius:var(--sa-radius-sm);min-width:0}
      .nr-label{flex:0 0 auto;font-size:11px;font-weight:650;letter-spacing:.07em;text-transform:uppercase;color:var(--sa-ink-faint)}
      .nr-url{font-family:var(--sa-mono);font-size:12.5px;color:var(--sa-ink-soft);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0}

      .budget-callout{display:flex;align-items:center;gap:13px;margin:0 0 14px;padding:13px 15px;border:1px solid var(--sa-primary-line);background:var(--sa-primary-soft);border-radius:var(--sa-radius)}
      .callout-mark{flex:0 0 auto;width:9px;height:9px;border-radius:50%;background:var(--sa-primary)}
      .budget-text{margin:0;flex:1 1 auto;font-size:13px;line-height:1.5;color:var(--sa-ink-soft)}
      .budget-text b{color:var(--sa-ink);font-variant-numeric:tabular-nums}
      .budget-callout .btn{flex:0 0 auto}
      .budget-error{margin:-6px 0 14px;font-size:12.5px;color:var(--sa-critical)}

      .run-columns{display:grid;grid-template-columns:minmax(0,1.35fr) minmax(0,1fr);gap:14px;margin:0 0 14px;align-items:start}
      .run-side{display:grid;gap:14px;align-content:start}
      .card-head{display:flex;align-items:center;gap:10px;margin:0 0 3px}
      .card-head .feed-heading{margin:0}
      .card-head .state-chip,.card-head .mix-total{margin-left:auto}
      .mix-total{font-size:12.5px;color:var(--sa-ink-faint);font-variant-numeric:tabular-nums}
      .panel-card>.hint{margin:0 0 11px}

      .recent-feed li{align-items:flex-start;gap:11px;padding:10px 0;border-bottom:1px solid var(--sa-line);background:transparent}
      .recent-feed li:last-child{border-bottom:0}
      .feed-mark{flex:0 0 auto;width:20px;height:20px;margin-top:1px;border-radius:50%;display:grid;place-items:center;font-size:11px;font-weight:700;background:var(--sa-subtle);color:var(--sa-ink-faint);border:1px solid var(--sa-line)}
      .feed-mark[data-kind=ok]{background:var(--sa-success-soft);border-color:color-mix(in srgb,var(--sa-success) 40%,transparent);color:var(--sa-success)}
      .feed-mark[data-kind=found]{background:var(--sa-primary-soft);border-color:var(--sa-primary-line);color:var(--sa-primary-text)}
      .feed-mark[data-kind=bad]{background:var(--sa-critical-soft);border-color:color-mix(in srgb,var(--sa-critical) 40%,transparent);color:var(--sa-critical)}
      .feed-body{flex:1 1 auto;min-width:0}
      .feed-title{display:block;font-size:13px;color:var(--sa-ink);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
      .feed-title code{font-family:var(--sa-mono);font-size:12.5px;color:var(--sa-ink)}
      .feed-note{display:block;margin-top:2px;font-size:11.5px;color:var(--sa-ink-faint);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
      .feed-age{flex:0 0 auto;font-size:11px;color:var(--sa-ink-faint);font-variant-numeric:tabular-nums;padding-top:2px}

      .signal-lead{margin:0 0 12px;padding:12px 13px;border:1px solid var(--sa-primary-line);background:var(--sa-primary-soft);border-radius:var(--sa-radius-sm)}
      .signal-lead b{display:block;margin-bottom:4px;font-size:13px;color:var(--sa-ink)}
      .signal-lead span{font-size:12.5px;line-height:1.5;color:var(--sa-ink-soft)}
      .signal-list{list-style:none;margin:0;padding:0;display:grid;gap:1px}
      .signal-list li{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:2px 10px;align-items:start;padding:9px 0;border-top:1px solid var(--sa-line)}
      .signal-list li:first-child{border-top:0}
      .signal-name{grid-area:1/1;font-size:13px;color:var(--sa-ink);overflow-wrap:anywhere}
      .signal-note{grid-area:2/1;font-size:11.5px;color:var(--sa-ink-faint)}
      .signal-badge{grid-area:1/2;justify-self:end}

      .mix-rows{list-style:none;margin:0;padding:0;display:grid;gap:9px}
      .mix-rows li{display:grid;grid-template-columns:64px minmax(0,1fr) 38px;gap:11px;align-items:center;font-size:12.5px;color:var(--sa-ink-soft)}
      .mix-track{height:7px;border-radius:999px;background:var(--sa-subtle);overflow:hidden}
      .mix-fill{height:100%;border-radius:999px}
      .mix-count{text-align:right;font-variant-numeric:tabular-nums;font-weight:600;color:var(--sa-ink)}

      .run-config{display:flex;align-items:center;gap:12px;margin:0;padding:11px 14px;border:1px solid var(--sa-line);border-radius:var(--sa-radius);background:var(--sa-surface);font-size:12.5px;color:var(--sa-ink-faint)}
      .run-config-facts{flex:1 1 auto;overflow-wrap:anywhere}
      .run-config .link-btn{margin-left:0}

      @media(max-width:1040px){
        .run-columns{grid-template-columns:minmax(0,1fr)}
        .stepper{grid-auto-flow:row;gap:10px}
        .step-rule{display:none}
      }

      /* Stat tiles ---------------------------------------------------------- */
      .stat-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:14px;margin:0 0 18px}
      .stat-grid>div{background:var(--sa-surface);border:1px solid var(--sa-line);border-radius:var(--sa-radius);box-shadow:var(--sa-shadow-sm);padding:14px 16px}
      .stat-grid dt{font-size:12.5px;font-weight:500;color:var(--sa-ink-faint);margin:0 0 6px;text-transform:none;letter-spacing:0}
      .stat-grid dd{margin:0;font-size:26px;font-weight:650;letter-spacing:-.02em;line-height:1.1;color:var(--sa-ink);font-variant-numeric:tabular-nums}
      .stat-sub{display:block;margin-top:5px;font-size:12.5px;line-height:1.4;color:var(--sa-ink-faint)}

      .sr-only{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap;border:0}

      /* Arriving from a tile means arriving at a pre-filtered list. Say which
         filter is on and how to leave it — an unexplained subset reads as a
         smaller site, which is the same mistake the scope banner exists to
         stop. */
      .scoped-note{display:flex;align-items:center;gap:10px;margin:0 0 12px;padding:8px 12px;background:var(--sa-primary-soft);border:1px solid var(--sa-primary-line);border-radius:var(--sa-radius);font-size:12.5px;color:var(--sa-ink-soft)}
      .scoped-note .scoped-text b{color:var(--sa-ink);font-weight:650;font-variant-numeric:tabular-nums}
      .scoped-note .link-btn{color:var(--sa-primary-text);flex:0 0 auto}

      /* A tile stating "178 pages not fully checked" has to be able to show
         those 178. The whole tile is the target, via an overlay button rather
         than a wrapping <button> — the tiles are dt/dd pairs inside a <dl>,
         and a button is not a valid child of a description list. The visible
         number stays the label; the button carries the accessible name. */
      .stat-tile{position:relative}
      .stat-open{position:absolute;inset:0;width:100%;border:0;background:transparent;padding:0;margin:0;cursor:pointer;border-radius:var(--sa-radius);font:inherit;color:inherit}
      .stat-open:focus-visible{outline:2px solid var(--sa-primary);outline-offset:1px}
      .stat-tile:has(.stat-open:not(:disabled)):hover{border-color:var(--sa-primary-line);box-shadow:var(--sa-shadow)}
      /* A tile whose count is zero has nothing behind it. It stays readable
         and stops advertising a drill-in that would open an empty list. */
      .stat-open:disabled{cursor:default}
      /* The affordance is the arrow, not a colour change: the number itself
         must keep reading as data. */
      .stat-tile:has(.stat-open:not(:disabled)) dt::after{content:' \\2192';color:var(--sa-ink-faint);font-weight:600}
      .stat-tile:has(.stat-open:not(:disabled)):hover dt::after{color:var(--sa-primary-text)}

      /* Grouped navigation --------------------------------------------------
         Twelve report sections need grouping or they read as a list of
         twenty. The groups also carry the one thing an operator has to know
         before trusting a section: where its evidence comes from. "Browser
         checks" is a separate group precisely because those two sections are
         the ones that can honestly be empty. */
      .nav-group{margin:0 0 14px}
      .nav-group:last-of-type{margin-bottom:0}
      .nav-group-label{font-size:11px;font-weight:650;letter-spacing:.09em;text-transform:uppercase;color:var(--sa-ink-faint);padding:0 10px;margin:0 0 6px}
      .nav-block{display:grid;gap:2px}

      /* A parent's scopes, revealed in place beneath it. The rail is what says
         these belong to the row above rather than being siblings of it. */
      .subnav{display:grid;gap:1px;margin:1px 0 5px 15px;padding-left:11px;border-left:1px solid var(--sa-line)}
      .subnav[hidden]{display:none}
      .subnav-item{display:flex;align-items:center;gap:8px;width:100%;min-height:28px;padding:0 8px;border:0;background:transparent;border-radius:var(--sa-radius-sm);color:var(--sa-ink-faint);font:inherit;font-size:12.5px;text-align:left;cursor:pointer}
      .subnav-item>span:first-child{flex:1 1 auto;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
      .subnav-count{flex:0 0 auto;font-size:11.5px;font-variant-numeric:tabular-nums;color:var(--sa-ink-faint)}
      .subnav-item:hover:not(:disabled){background:var(--sa-subtle);color:var(--sa-ink)}
      .subnav-item.active{color:var(--sa-primary-text);font-weight:600}
      .subnav-item.active .subnav-count{color:var(--sa-primary-text)}
      .subnav-item:disabled{opacity:.45;cursor:default}
      .subnav-item:focus-visible{outline:2px solid var(--sa-primary);outline-offset:-2px}

      /* The state chip is the answer to Sitebulb's score dial: the same
         glanceable per-section signal without inventing a number. Three
         states only, in the same words the Site conditions readout uses. */
      .tab-state{margin-left:auto;display:inline-flex;align-items:center;gap:6px;flex:0 0 auto}
      .tab-dot{width:7px;height:7px;border-radius:50%;background:var(--sa-line-strong);flex:0 0 auto}
      .tab-state[data-state=attention] .tab-dot{background:var(--sa-sev-high)}
      .tab-state[data-state=ok] .tab-dot{background:var(--sa-success)}
      .tab-state[data-state=unknown] .tab-dot{background:transparent;border:1.5px dashed var(--sa-ink-faint);width:9px;height:9px}
      .tab-num{font-size:11.5px;font-weight:600;color:var(--sa-ink-faint);font-variant-numeric:tabular-nums}
      .tab-state[data-state=attention] .tab-num{color:var(--sa-critical)}
      .tab.active .tab-num{color:var(--sa-primary-text)}

      /* Discipline section pages ------------------------------------------- */
      .section-head{margin:0 0 14px}
      .section-head h2{margin:0}
      .section-lede{margin:5px 0 0;font-size:13.5px;line-height:1.55;color:var(--sa-ink-soft);max-width:82ch}

      /* Every section states its own coverage before it states its findings.
         Three shapes, because "we checked and found nothing" and "we never
         checked" must never look alike. */
      .coverage-line{display:flex;align-items:flex-start;gap:10px;margin:0 0 16px;padding:10px 13px;border-radius:var(--sa-radius);font-size:12.5px;line-height:1.55;border:1px solid var(--sa-line);background:var(--sa-surface);color:var(--sa-ink-soft)}
      .coverage-line b{color:var(--sa-ink);font-variant-numeric:tabular-nums}
      .coverage-line .cl-mark{flex:0 0 auto;width:9px;height:9px;border-radius:50%;margin-top:5px;background:var(--sa-line-strong)}
      .coverage-line[data-state=ok] .cl-mark{background:var(--sa-success)}
      .coverage-line[data-state=attention] .cl-mark{background:var(--sa-sev-high)}
      .coverage-line[data-state=unknown]{border-style:dashed;border-color:var(--sa-line-strong);background-image:var(--sa-hatch)}
      .coverage-line[data-state=unknown] .cl-mark{background:transparent;border:1.5px dashed var(--sa-ink-faint)}
      .coverage-line .cl-action{margin-left:auto;flex:0 0 auto}

      .section-stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px;margin:0 0 16px}
      .section-stats>div{position:relative;background:var(--sa-surface);border:1px solid var(--sa-line);border-radius:var(--sa-radius);box-shadow:var(--sa-shadow-sm);padding:11px 13px}
      .section-stats dt{font-size:12.5px;font-weight:500;color:var(--sa-ink-faint);margin:0 0 5px}
      .section-stats dd{margin:0;font-size:22px;font-weight:650;letter-spacing:-.02em;line-height:1.1;color:var(--sa-ink);font-variant-numeric:tabular-nums}
      .section-stats .stat-sub{margin-top:3px;font-size:11.5px}


      /* Distributions -------------------------------------------------------
         One horizontal bar-row form for every distribution in the product:
         crawl depth, HTTP status, canonical, title/description length, word
         count, H1 count. A shared form means the operator learns to read it
         once, and it stays legible in a 320px panel where a column chart with
         an axis would not. */
      .dist{background:var(--sa-surface);border:1px solid var(--sa-line);border-radius:var(--sa-radius);box-shadow:var(--sa-shadow-sm);padding:13px 15px 14px;margin:0}
      .dist-head{display:flex;align-items:baseline;gap:10px;margin:0 0 3px}
      .dist-head h3{margin:0;font-size:13.5px;font-weight:600;color:var(--sa-ink)}
      .dist-total{margin-left:auto;font-size:11.5px;color:var(--sa-ink-faint);font-variant-numeric:tabular-nums}
      .dist-note{margin:0 0 10px;font-size:11.5px;line-height:1.5;color:var(--sa-ink-faint)}
      .dist-rows{list-style:none;margin:0;padding:0;display:grid;gap:1px}
      .dist-row{display:grid;grid-template-columns:minmax(88px,132px) minmax(0,1fr) 52px;align-items:center;gap:10px;width:100%;border:0;background:transparent;padding:5px 6px;border-radius:var(--sa-radius-sm);font:inherit;font-size:12.5px;color:var(--sa-ink-soft);text-align:left}
      button.dist-row{cursor:pointer}
      button.dist-row:hover{background:var(--sa-subtle);color:var(--sa-ink)}
      button.dist-row:focus-visible{outline:2px solid var(--sa-primary);outline-offset:-2px}
      .dist-label{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
      .dist-track{height:9px;border-radius:999px;background:var(--sa-info-soft);overflow:hidden;display:flex;min-width:24px}
      .dist-fill{height:100%;background:var(--sa-primary);border-radius:999px 0 0 999px}
      .dist-fill:last-child{border-radius:999px}
      .dist-fill.tone-gap{background-image:var(--sa-hatch);background-color:var(--sa-info-soft)}
      .dist-fill.tone-attention{background:var(--sa-sev-high)}
      .dist-fill.tone-warn{background:var(--sa-sev-medium)}
      .dist-fill.tone-ok{background:var(--sa-success)}
      .dist-fill.tone-quiet{background:var(--sa-line-strong)}
      .dist-count{text-align:right;font-variant-numeric:tabular-nums;font-weight:600;color:var(--sa-ink)}
      .dist-empty{margin:0;font-size:12.5px;color:var(--sa-ink-faint)}

      /* Two-column readouts for facts that are statements, not magnitudes:
         robots.txt, the sitemap record, response-header coverage. */
      .readout{list-style:none;margin:0;padding:0;display:grid;gap:0}
      .readout li{display:grid;grid-template-columns:minmax(120px,180px) minmax(0,1fr);gap:12px;padding:7px 0;border-top:1px solid var(--sa-line);font-size:12.5px;line-height:1.5}
      .readout li:first-child{border-top:0}
      .readout dt,.readout .ro-key{color:var(--sa-ink-faint)}
      .readout dd,.readout .ro-val{margin:0;color:var(--sa-ink);overflow-wrap:anywhere}
      .readout .ro-val b{font-variant-numeric:tabular-nums}

      .dup-table td.dup-value{font-size:12.5px;color:var(--sa-ink);overflow-wrap:anywhere}
      /* Distribution blocks pair up rather than tiling three-across: the
         sections that carry four of them then fill a 2x2 grid instead of
         stranding the fourth card beside two cards' worth of empty canvas,
         and a bar row gets the width to hold its label without truncating. */
      .section-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(430px,1fr));gap:14px;margin:0 0 16px;align-items:start}
      /* The crawl row carries three short cards — depth, status, coverage —
         which fit across where a discipline's four long ones would not. */
      .crawl-shape{grid-template-columns:repeat(auto-fit,minmax(290px,1fr));margin-bottom:18px}
      .section-findings{margin:18px 0 0}
      .section-findings h3{margin:0 0 4px;font-size:13.5px;font-weight:600;color:var(--sa-ink)}
      .section-findings .hint{margin:0 0 10px}

      /* Overview grid ------------------------------------------------------- */

      .panel-card{background:var(--sa-surface);border:1px solid var(--sa-line);border-radius:var(--sa-radius);box-shadow:var(--sa-shadow-sm);padding:14px 16px 16px}

      /* Overview -------------------------------------------------------------
         Identity, then one instrument strip, then the brief. The brief is the
         only element on this screen allowed to interpret, and it is fenced off
         visually for exactly that reason. */
      .ov-identity h2{margin:0;font-size:26px;font-weight:650;letter-spacing:-.025em}
      .ov-head{align-items:flex-start}

      /* One bordered strip with dividers rather than four floating cards:
         these are four readings of one run. */
      .summary-stats{grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:0;border:1px solid var(--sa-line);border-radius:var(--sa-radius);overflow:hidden;background:var(--sa-surface)}
      .summary-stats>div{border:0;border-right:1px solid var(--sa-line);border-radius:0;box-shadow:none;background:transparent;padding:13px 16px 14px}
      .summary-stats>div:last-child{border-right:0}
      .summary-stats dt{font-size:11px;font-weight:650;letter-spacing:.07em;text-transform:uppercase}
      .summary-stats dd{font-size:26px}
      .tile-track{height:4px;margin-top:9px;border-radius:999px;background:var(--sa-subtle);overflow:hidden}
      .tile-fill{display:block;height:100%;border-radius:999px;background:var(--sa-primary)}

      /* The brief. A violet rail and a tinted ground mark the one region that
         reads the evidence rather than reporting it. */
      .brief{margin:0 0 16px;border:1px solid var(--sa-primary-line);border-left:3px solid var(--sa-primary);border-radius:var(--sa-radius);background:linear-gradient(180deg,var(--sa-primary-soft),transparent 70%),var(--sa-surface);overflow:hidden}
      .brief-kicker{margin:0;padding:12px 16px 0;font-size:11px;font-weight:650;letter-spacing:.09em;text-transform:uppercase;color:var(--sa-primary-text)}
      .brief-kicker span{margin:0 5px;opacity:.6}
      .brief-body{display:grid;grid-template-columns:minmax(0,1.15fr) minmax(0,1fr);gap:0;align-items:stretch}
      .brief-lead{padding:10px 16px 16px;min-width:0}
      .brief-lead h3{margin:0 0 7px;font-size:18px;font-weight:650;color:var(--sa-ink)}
      .brief-summary{margin:0 0 10px;font-size:13.5px;line-height:1.6;color:var(--sa-ink-soft);max-width:64ch}
      .brief-scope{margin:0 0 12px;font-size:12.5px;color:var(--sa-ink-faint)}
      .brief-to-plan{margin:14px 0 0}
      .brief-list{list-style:none;margin:0;padding:0;display:grid;gap:4px;counter-reset:brief}
      .brief-item{display:grid;grid-template-columns:26px minmax(0,1fr) auto;gap:11px;align-items:center;width:100%;padding:9px 10px;border:1px solid transparent;border-radius:var(--sa-radius-sm);background:transparent;color:inherit;font:inherit;text-align:left;cursor:pointer}
      .brief-item:hover{background:var(--sa-subtle)}
      .brief-item.active{background:var(--sa-primary-soft);border-color:var(--sa-primary-line)}
      .brief-item:focus-visible{outline:2px solid var(--sa-primary);outline-offset:-2px}
      .brief-rank{display:grid;place-items:center;width:26px;height:26px;border-radius:var(--sa-radius-sm);background:var(--sa-subtle);color:var(--sa-ink-faint);font-size:11px;font-weight:650;font-variant-numeric:tabular-nums}
      .brief-item.active .brief-rank{background:var(--sa-primary);color:#fff}
      .brief-item-body{min-width:0}
      .brief-item-title{display:block;font-size:13.5px;font-weight:600;color:var(--sa-ink);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
      .brief-item-meta{display:flex;align-items:center;gap:8px;margin-top:3px;font-size:11.5px;color:var(--sa-ink-faint)}
      .brief-item-pages{display:grid;justify-items:end;font-size:11.5px;color:var(--sa-ink-faint);white-space:nowrap}
      .brief-item-pages b{font-size:13.5px;color:var(--sa-ink);font-variant-numeric:tabular-nums}

      .brief-detail{padding:16px;border-left:1px solid var(--sa-line);background:var(--sa-surface);min-width:0}
      /* align-items matters here: the three chips on this row are three
         different type sizes, so the row stretches all of them to the tallest.
         Without it a chip that does not centre its own text sits high in its
         pill, which is what happened to the confidence chip. */
      .brief-badges{display:flex;align-items:center;gap:8px;margin:0 0 10px;flex-wrap:wrap}
      .brief-detail h4{margin:0 0 8px;font-size:15px;font-weight:650;letter-spacing:-.015em;color:var(--sa-ink)}
      .brief-why{margin:0 0 13px;font-size:13px;line-height:1.6;color:var(--sa-ink-soft)}
      .evidence-box{padding:11px 13px;border:1px solid var(--sa-line);border-radius:var(--sa-radius-sm);background:var(--sa-subtle);margin:0 0 13px}
      .evidence-label{display:block;margin-bottom:8px;font-size:11px;font-weight:650;letter-spacing:.09em;text-transform:uppercase;color:var(--sa-ink-faint)}
      .evidence-facts{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px;margin:0}
      .evidence-facts dt{font-size:11px;color:var(--sa-ink-faint);margin:0 0 2px}
      .evidence-facts dd{margin:0;font-size:13.5px;font-weight:600;color:var(--sa-ink);font-variant-numeric:tabular-nums}
      .brief-detail .actions{margin-top:0}

      .ov-columns{display:grid;grid-template-columns:minmax(0,1.05fr) minmax(0,1fr);gap:14px;margin:0 0 16px;align-items:start}
      .ov-columns .conditions{margin:0}
      .ov-columns .conditions-list{margin:11px -16px 0}
      .ov-columns .conditions-note{padding:12px 0 0;margin:0;border-top:1px solid var(--sa-line)}
      .card-head .link-btn{margin-left:auto;padding:0}

      .deliver-main{flex-wrap:wrap}
      .deliver-main .deliver-data{padding:0;background:transparent;border:0;margin-left:auto}
      .deliver-more{border-top:1px solid var(--sa-line)}

      @media(max-width:1040px){
        .brief-body{grid-template-columns:minmax(0,1fr)}
        .brief-detail{border-left:0;border-top:1px solid var(--sa-line)}
        .ov-columns{grid-template-columns:minmax(0,1fr)}
      }

      /* Site conditions ----------------------------------------------------- */
      .conditions{margin:0 0 18px;background:var(--sa-surface);border:1px solid var(--sa-line);border-radius:var(--sa-radius);box-shadow:var(--sa-shadow-sm);overflow:hidden}
      .conditions>.feed-heading{padding:14px 16px 0;margin:0}
      .conditions-list{list-style:none;margin:10px 0 0;padding:0}
      /* The row is the toggle and the evidence it opens, nothing beside them:
         the document link moved inside the evidence, which is where the proof
         belongs and what freed the row of its second column. */
      .cond-row{border-top:1px solid var(--sa-line)}
      .cond-head{display:grid;grid-template-columns:22px 150px minmax(0,1fr) auto 12px;gap:12px;align-items:center;width:100%;text-align:left;border:0;background:transparent;padding:11px 16px;font:inherit;color:inherit;cursor:pointer}
      .cond-head:hover{background:var(--sa-subtle)}
      .cond-head:focus-visible{outline:2px solid var(--sa-primary);outline-offset:-2px}
      .cond-mark{width:18px;height:18px;border-radius:50%;display:block;background:var(--sa-info-soft);border:1px solid var(--sa-line-strong);position:relative}
      .cond-mark::after{content:"";position:absolute;inset:5px;border-radius:50%;background:var(--sa-ink-faint)}
      .cond-row[data-state=ok] .cond-mark{background:var(--sa-success-soft);border-color:var(--sa-success-line)}
      .cond-row[data-state=ok] .cond-mark::after{background:var(--sa-success)}
      .cond-row[data-state=attention] .cond-mark{background:var(--sa-critical-soft);border-color:color-mix(in srgb,var(--wqa-sev-high) 40%,transparent)}
      .cond-row[data-state=attention] .cond-mark::after{background:var(--sa-sev-high)}
      .cond-row[data-state=unknown] .cond-mark::after{background:transparent;border:2px dashed var(--sa-ink-faint);inset:3px}
      .cond-label{font-size:13px;font-weight:600;color:var(--sa-ink)}
      .cond-headline{font-size:13px;color:var(--sa-ink-soft)}
      /* The caret is the row's only promise that there is something under it,
         and it carries more weight now that the document link is behind it. */
      .cond-caret{width:12px;height:12px;fill:none;stroke:currentColor;stroke-width:1.5;stroke-linecap:round;stroke-linejoin:round;color:var(--sa-ink-faint);transition:transform .15s ease}
      .cond-head[aria-expanded=true] .cond-caret{transform:rotate(90deg)}
      .cond-evidence{margin:0;padding:0 16px 14px 50px;list-style:none}
      .cond-evidence li{font-size:12.5px;line-height:1.55;color:var(--sa-ink-soft);margin-bottom:4px}
      .cond-foot{display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin:8px 0 0}
      .conditions-note{margin:0;padding:0 16px 14px;font-size:12.5px;line-height:1.5;color:var(--sa-ink-faint)}

      /* The three published documents (robots.txt, sitemap, llms.txt) are rows
         in the conditions readout, and each offers the file itself as the last
         line of its evidence. */
      .cond-open{flex:0 0 auto;font-size:12px;color:var(--sa-primary-text);background:none;border:0;padding:0;cursor:pointer;text-decoration:underline;text-underline-offset:2px;font-family:inherit}
      .cond-open:hover{color:var(--sa-primary-hover)}
      .cond-open:focus-visible{outline:2px solid var(--sa-primary);outline-offset:1px}

      /* Severity and the ranked issues, one card. The legend sits on the
         heading line so the bar reads as a caption to the list beneath it
         rather than as a chart in its own panel. */
      .mix-card .severity-bar{margin:0 0 11px}
      .mix-card .severity-legend{display:flex;flex-wrap:wrap;gap:4px 14px;margin:0 0 12px;font-size:12.5px}
      .mix-card .top-issues{margin-top:2px}

      /* Findings ------------------------------------------------------------ */
      .findings-list{list-style:none;margin:0;padding:0;display:grid;gap:10px;counter-reset:keynote}
      .finding-row{background:var(--sa-surface);border:1px solid var(--sa-line);border-radius:var(--sa-radius);box-shadow:var(--sa-shadow-sm);overflow:hidden;counter-increment:keynote}
      .finding-row:hover{border-color:var(--sa-line-strong)}
      .f-toggle{display:block;width:100%;text-align:left;background:transparent;border:0;padding:12px 14px;font:inherit;color:inherit;cursor:pointer}
      .f-toggle:hover{background:var(--sa-subtle)}
      .f-toggle:focus-visible{outline:2px solid var(--sa-primary);outline-offset:-2px}
      .finding-row .f-top{display:grid;grid-template-columns:auto minmax(0,1fr) auto auto;align-items:center;gap:12px;margin-bottom:4px}
      .finding-row .f-top .pill{justify-self:start}
      .finding-row .f-title{min-width:0;overflow-wrap:anywhere}
      .finding-row .f-top::before{content:none}
      .finding-row .f-title{font-weight:600;font-size:13.5px;color:var(--sa-ink)}
      .finding-row .f-meta{display:flex;align-items:center;gap:10px;font-size:12.5px;color:var(--sa-ink-faint);padding-left:0}
      .f-chev{flex:0 0 auto;width:16px;text-align:right;color:var(--sa-ink-faint);font-size:15px;line-height:1;transition:transform .15s ease}
      .f-toggle[aria-expanded="true"] .f-chev{transform:rotate(90deg)}
      .finding-row .f-conf{flex:0 0 auto;width:112px;font-size:12.5px;color:var(--sa-ink-faint);display:flex;align-items:center;gap:6px;margin-left:auto}
      .finding-row.sev-critical{box-shadow:inset 3px 0 0 var(--sa-sev-critical),var(--sa-shadow-sm)}
      .finding-row.sev-high{box-shadow:inset 3px 0 0 var(--sa-sev-high),var(--sa-shadow-sm)}
      .finding-row.sev-medium{box-shadow:inset 3px 0 0 var(--sa-sev-medium),var(--sa-shadow-sm)}
      .finding-row.sev-low{box-shadow:inset 3px 0 0 var(--sa-sev-low),var(--sa-shadow-sm)}
      .finding-row.sev-info{box-shadow:inset 3px 0 0 var(--sa-line-strong),var(--sa-shadow-sm)}
      .empty-row{font-size:13px;color:var(--sa-ink-faint);padding:16px;background:var(--sa-surface);border:1px solid var(--sa-line);border-radius:var(--sa-radius)}


      .confidence-dot{display:inline-block;width:8px;height:8px;border-radius:50%;flex:0 0 auto}
      .confidence-dot.confirmed{background:var(--sa-success)}
      .confidence-dot.corroborated{background:transparent;box-shadow:inset 0 0 0 2px var(--sa-success)}
      .confidence-dot.inferred{background:var(--sa-sev-medium)}
      .confidence-dot.inconclusive{background:var(--sa-line-strong)}

      /* Findings -------------------------------------------------------------
         Patterns on the left, one inspected pattern on the right. The count an
         operator acts on is patterns, not observations, and the footer keeps
         the larger number visible so nothing looks quietly reduced. */
      .fx-head{align-items:flex-start;margin-bottom:14px}
      .fx-head .panel-title{margin:0}
      .fx-meta{margin:5px 0 0;font-size:12.5px;color:var(--sa-ink-faint)}
      .fx-stats{margin-bottom:12px}

      .fx-lenses{display:flex;align-items:center;gap:12px;margin:0 0 10px;flex-wrap:wrap}
      .lens-tabs{display:flex;gap:4px;flex-wrap:wrap}
      .lens{min-height:31px;padding:0 11px;border:1px solid transparent;border-radius:var(--sa-radius-sm);background:transparent;color:var(--sa-ink-faint);font:inherit;font-size:12.5px;font-weight:600;cursor:pointer}
      .lens:hover{background:var(--sa-subtle);color:var(--sa-ink)}
      .lens.active{background:var(--sa-primary-soft);border-color:var(--sa-primary-line);color:var(--sa-primary-text)}
      .lens:focus-visible{outline:2px solid var(--sa-primary);outline-offset:1px}
      .fx-lenses .filter-state{margin-left:auto}

      .lens-note{display:flex;align-items:center;gap:14px;margin:0 0 12px;padding:11px 14px;border:1px solid var(--sa-line);border-radius:var(--sa-radius);background:var(--sa-surface)}
      .lens-note-body{flex:1 1 auto;min-width:0}
      .lens-note-body b{display:block;font-size:13px;color:var(--sa-ink);margin-bottom:2px}
      .lens-note-body span{font-size:12.5px;line-height:1.5;color:var(--sa-ink-soft)}
      .lens-state{flex:0 0 auto}

      .fx-split{display:grid;grid-template-columns:minmax(0,1.15fr) minmax(0,1fr);gap:14px;align-items:start;margin:0 0 12px}
      .fx-list-card{padding:0;overflow:hidden}
      .fx-list-card .card-head{padding:13px 15px 11px;margin:0;border-bottom:1px solid var(--sa-line)}
      .fx-select-hint{margin:0}
      .fx-table{border:0;border-radius:0;background:transparent}
      .fx-table th{background:var(--sa-subtle)}
      .fx-row{cursor:pointer}
      .fx-row.selected{background:var(--sa-primary-soft)}
      .fx-row.selected td{color:var(--sa-ink)}
      .fx-row.selected td:first-child{box-shadow:inset 2px 0 0 var(--sa-primary)}
      .fx-issue{display:block;font-size:13px;font-weight:600;color:var(--sa-ink);overflow-wrap:anywhere}
      .fx-issue-meta{display:flex;align-items:center;gap:8px;margin-top:4px;font-size:11.5px;color:var(--sa-ink-faint)}
      .fx-pages-word{color:var(--sa-ink-faint);font-weight:400}
      .fx-list-card .pager{margin:0;padding:11px 15px;border-top:1px solid var(--sa-line)}

      .fx-detail{align-self:start}
      .fx-kicker{margin:0 0 5px;font-size:11px;font-weight:650;letter-spacing:.09em;text-transform:uppercase;color:var(--sa-primary-text)}
      .fx-detail-title{margin:0 0 10px;font-size:18px;font-weight:650;letter-spacing:-.015em;color:var(--sa-ink)}
      .fx-to-plan{margin:0 0 12px}
      .fx-tabs{display:flex;gap:2px;margin:12px 0 12px;border-bottom:1px solid var(--sa-line)}
      .fx-tab{padding:7px 11px;border:0;border-bottom:2px solid transparent;background:transparent;color:var(--sa-ink-faint);font:inherit;font-size:12.5px;font-weight:600;cursor:pointer;margin-bottom:-1px}
      .fx-tab:hover{color:var(--sa-ink)}
      .fx-tab.active{color:var(--sa-primary-text);border-bottom-color:var(--sa-primary)}
      .fx-tab:focus-visible{outline:2px solid var(--sa-primary);outline-offset:-2px}
      .fx-tab-body .evidence-label{margin-top:2px}
      .fx-instances{display:grid;gap:2px;max-height:280px;overflow:auto;padding:2px 0}

      .columns-wrap{position:relative}
      .columns-menu{position:absolute;z-index:6;right:0;top:calc(100% + 6px);width:230px;padding:9px;background:var(--sa-surface-raised,var(--sa-surface));border:1px solid var(--sa-line-strong);border-radius:var(--sa-radius);box-shadow:var(--sa-shadow-lg)}
      .columns-title{margin:0 0 7px;padding:0 4px;font-size:11px;font-weight:650;letter-spacing:.07em;text-transform:uppercase;color:var(--sa-ink-faint)}
      .columns-row{display:flex;align-items:center;gap:9px;padding:6px 4px;font-size:12.5px;color:var(--sa-ink-soft);cursor:pointer;border-radius:var(--sa-radius-sm)}
      .columns-row:hover{background:var(--sa-subtle)}

      .fx-foot{display:flex;align-items:center;gap:14px;margin:0;padding:11px 14px;border:1px solid var(--sa-line);border-radius:var(--sa-radius);background:var(--sa-surface);font-size:12.5px;color:var(--sa-ink-faint)}
      .fx-foot-text{flex:1 1 auto}
      .fx-foot .link-btn{margin-left:0}

      @media(max-width:1040px){
        .fx-split{grid-template-columns:minmax(0,1fr)}
      }

      /* Tables -------------------------------------------------------------- */
      .data-table{width:100%;border-collapse:collapse;font-size:13px;background:var(--sa-surface);border:1px solid var(--sa-line);border-radius:var(--sa-radius);overflow:hidden}
      .data-table th{text-align:left;font-size:12.5px;font-weight:600;color:var(--sa-ink-faint);text-transform:none;letter-spacing:0;padding:10px 12px;border-bottom:1px solid var(--sa-line);background:var(--sa-subtle)}
      .data-table td{padding:10px 12px;border-bottom:1px solid var(--sa-line);vertical-align:top;word-break:break-word;font-variant-numeric:tabular-nums;color:var(--sa-ink-soft)}
      .data-table tbody tr:hover:not(.detail-row){background:var(--sa-subtle)}
      .data-table tbody tr:nth-child(even):not(.detail-row){background:transparent}
      .data-table td.mono{font-family:var(--sa-mono);font-size:12.5px;color:var(--sa-ink)}
      .data-table th[data-sort]{cursor:pointer;user-select:none}
      .data-table th[data-sort]:hover{color:var(--sa-ink)}
      .data-table th.sorted-asc::after{content:' \\25B2'}
      .data-table th.sorted-desc::after{content:' \\25BC'}

      /* The status column sizes to its content instead of taking an equal
         share and squeezing the pill; the URL columns absorb the slack. */
      .data-table td.col-status,.data-table th.col-status{width:1%;white-space:nowrap}

      /* Pills ---------------------------------------------------------------
         One implementation of the chip-and-pill component DESIGN.md documents.
         There were nine — .badge, .status-pill, .signal-badge, .cond-state,
         .cond-confidence, .phase-badge, .render-state, .sheet-scale and
         .state-chip — each restating the radius, the padding and the type, and
         only three of them seating their own label. A pill is a box drawn round
         one line of text, and any flex or grid row can stretch it taller than
         that line, so the seating lives here, once, where no new pill can be
         born without it. line-height is declared for the same reason — inherited
         from a paragraph it made the confidence pill 3px taller than the same
         pill in a table cell, so it is pinned to the face's own metric here. scripts/check.mjs fails the build
         on a second
         implementation.

         Two sizes and one tone vocabulary. The tones are the words the side
         panel's own chip already uses — critical, warn, ok, muted — so the two
         surfaces name the same state the same way instead of each inventing a
         set. The classes that remain beside .pill (.status-pill, .render-state,
         .signal-badge and the rest) now carry only where a pill sits and what
         queries it, never what it looks like. */
      .pill{display:inline-flex;align-items:center;gap:6px;flex:0 0 auto;line-height:normal;border:1px solid transparent;border-radius:999px;padding:2px 9px;font-size:11.5px;font-weight:600;letter-spacing:0;text-transform:none;white-space:nowrap;word-break:normal;overflow-wrap:normal;background:var(--sa-subtle);color:var(--sa-ink-soft)}
      /* The roomier step: a chip that sits on a row of its own rather than
         inside a table cell or beside a heading. */
      .pill.roomy{gap:7px;padding:4px 11px;font-size:12.5px;font-weight:400}
      /* One lowercase word from the scanner's own vocabulary — "high",
         "confirmed" — rendered in the sentence case DESIGN.md asks badges for.
         Never on a multi-word label, where it would produce title case, and
         never on a technical literal such as "noindex". */
      .pill.cap{text-transform:capitalize}
      .pill[data-tone=ok]{background:var(--sa-success-soft);color:var(--sa-success);border-color:var(--sa-success-line)}
      .pill[data-tone=warn]{background:var(--sa-warn-soft);color:var(--sa-warn);border-color:color-mix(in srgb,var(--sa-warn) 40%,transparent)}
      .pill[data-tone=critical]{background:var(--sa-critical-soft);color:var(--sa-critical);border-color:color-mix(in srgb,var(--wqa-sev-high) 40%,transparent)}
      /* The top of the ramp is the one solid fill — how critical announces
         itself, and the only pill whose ground comes from the ramp. */
      /* White ink on the ramp value itself measures 4.09:1, under the 4.5 floor
         for text this size. The ramp is sealed and stays exactly as it is: the
         pill deepens its own ground from it instead, which is the Fill Is Not
         The Ink rule applied to the one place the fill has to carry ink. */
      .pill[data-tone=critical-solid]{background:color-mix(in srgb,var(--sa-sev-critical) 78%,var(--wqa-backdrop));color:#fff}
      .pill[data-tone=brand]{background:var(--sa-primary-soft);color:var(--sa-primary-text);border-color:var(--sa-primary-line)}
      .pill[data-tone=muted]{background:var(--sa-info-soft);color:var(--sa-ink-faint);border-color:var(--sa-line-strong)}
      .pill[data-tone=outline]{background:var(--sa-surface);border-color:var(--sa-line)}

      /* The inputs screen. Two columns: what the audit already holds, and the
         two things only the operator can answer. It replaced a button in an
         empty page — a screen with nothing on it reads as unfinished, and this
         one had plenty it could truthfully show. */
      .optimize-inputs{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:14px;margin:0 0 16px;align-items:start}
      @media(max-width:980px){.optimize-inputs{grid-template-columns:minmax(0,1fr)}}
      .optimize-input-card{border:1px solid var(--sa-line);border-radius:var(--sa-radius);background:var(--sa-surface);box-shadow:var(--sa-shadow-sm);padding:15px 17px}
      .optimize-input-card h3{margin:0 0 3px;font-size:13.5px;font-weight:600;color:var(--sa-ink)}
      .optimize-input-card>div>.hint{margin:0 0 13px;max-width:60ch}
      .optimize-input-card .field{margin:0 0 14px}
      .optimize-input-card .field:last-child{margin-bottom:0}
      .optimize-input-card select{width:100%;border:1px solid var(--sa-line-strong);border-radius:var(--sa-radius-sm);padding:8px 11px;font-size:13px;background:var(--sa-surface);color:var(--sa-ink);box-shadow:var(--sa-shadow-sm)}
      .optimize-input-card select:focus-visible{outline:2px solid var(--sa-primary);outline-offset:1px;border-color:var(--sa-primary)}
      .optimize-input-card .field>.hint{margin-top:5px}
      /* Counts the audit can defend, set as a ledger rather than as prose. */
      .optimize-facts{display:grid;grid-template-columns:auto minmax(0,1fr);gap:7px 16px;margin:0}
      .optimize-facts dt{font-size:12.5px;color:var(--sa-ink-faint)}
      .optimize-facts dd{margin:0;font-size:12.5px;color:var(--sa-ink);font-variant-numeric:tabular-nums;text-align:right}
      /* Absent evidence is stated, never blanked: not run is a fact. */
      .optimize-fact-absent{color:var(--sa-ink-faint)}
      .optimize-build-actions{margin-top:0;align-items:flex-start;gap:16px}
      .optimize-build-actions .hint{margin:0;max-width:74ch;flex:1 1 320px}

      .optimize-start{border:1px solid var(--sa-line);border-radius:var(--sa-radius);background:var(--sa-surface);box-shadow:var(--sa-shadow-sm);padding:18px 20px;max-width:74ch}
      .optimize-start b{display:block;margin-bottom:6px;font-size:15px;font-weight:650;letter-spacing:-.015em;color:var(--sa-ink)}
      .optimize-start .hint{margin:0 0 14px}
      .optimize-working{display:flex;align-items:center}
      /* Who wrote the words, above the words. */
      .optimize-provenance{display:flex;align-items:center;margin:0 0 8px;font-size:11px;font-weight:650;letter-spacing:.09em;text-transform:uppercase;color:var(--sa-ink-faint)}

      /* The working indicator -----------------------------------------------
         One primitive, used wherever the product is waiting on something it does
         not control. It exists because the alternative is a surface that looks
         finished while a request is still out: the deterministic brief is on
         screen either way, so without motion there is nothing to tell an
         operator that better wording may still arrive.

         Three dots on the product violet, sized to sit on a line of meta text.
         Reduced motion gets a static row rather than nothing — the state still
         has to be visible, it just stops moving. */
      .work-dot{display:inline-flex;align-items:center;gap:3px;margin-left:7px;vertical-align:middle}
      .work-dot::before,.work-dot::after,.work-dot>i{content:"";display:block;width:4px;height:4px;border-radius:50%;background:var(--sa-primary-text);opacity:.35;animation:sa-work 1.1s ease-in-out infinite}
      .work-dot::after{animation-delay:.18s}
      .work-dot>i{animation-delay:.36s}
      @keyframes sa-work{0%,100%{opacity:.28;transform:translateY(0)}50%{opacity:1;transform:translateY(-2px)}}
      @media(prefers-reduced-motion:reduce){
        .work-dot::before,.work-dot::after,.work-dot>i{animation:none;opacity:.7}
      }

      /* Optimize ------------------------------------------------------------
         The plan surface. It reuses the stat strip, pills, tables and card
         shells the rest of the console already has; what is declared here is
         only the sequence itself — the numbered steps, the priority cards and
         the rule chips that carry traceability back to Findings. */
      .optimize-focus{margin:0 0 12px;padding:9px 12px;border-radius:var(--sa-radius-sm);background:var(--sa-primary-soft);border:1px solid var(--sa-primary-line);font-size:12.5px;line-height:1.5;color:var(--sa-ink-soft);display:flex;align-items:center;gap:12px;flex-wrap:wrap}
      .optimize-focus .link-btn{margin-left:auto}
      .optimize-limits{display:flex;align-items:center;gap:16px;margin:0 0 18px;padding:12px 14px;border:1px solid var(--sa-line-strong);border-left:6px solid transparent;border-radius:var(--sa-radius);background-image:linear-gradient(var(--sa-surface),var(--sa-surface)),var(--sa-hatch);background-origin:padding-box,border-box;background-clip:padding-box,border-box}
      .optimize-limit-text{margin:0;font-size:13px;line-height:1.55;color:var(--sa-ink-soft);max-width:88ch}
      .optimize-limits .btn{margin-left:auto;flex:0 0 auto}
      .stat-grid.optimize-stats{grid-template-columns:repeat(4,minmax(0,1fr));margin:0 0 16px}
      @media(max-width:900px){.stat-grid.optimize-stats{grid-template-columns:repeat(2,minmax(0,1fr))}}
      /* A phrase, not a figure. At the strip display size a long label would set
         as a headline and read as a claim rather than as a reading to verify. */
      .stat-grid.optimize-stats dd.stat-word{font-size:15px;letter-spacing:-.01em;line-height:1.25}
      .optimize-why{margin:0 0 16px;padding:15px 17px}
      .optimize-headline{margin:0 0 6px;font-size:15px;font-weight:650;letter-spacing:-.015em;color:var(--sa-ink);max-width:74ch}
      .optimize-why .hint{margin:0;max-width:84ch}
      /* The phase map: when each body of work happens, and how much of it there
         is. Rows rather than cards, because four cards of heading-plus-text is
         the scaffold this screen already spends its cards on below, and the map
         has to read as one object the eye can run down. */
      .attack-list{list-style:none;margin:14px 0 0;padding:0;border:1px solid var(--sa-line);border-radius:var(--sa-radius-sm);background:var(--sa-canvas);overflow:hidden}
      .attack-row + .attack-row{border-top:1px solid var(--sa-line)}
      /* What happens now gets the ground, not a bar down its side: the eye
         should land on it before it reads a word. */
      .attack-row.lead{background:var(--sa-primary-soft)}
      .attack-open{display:grid;grid-template-columns:64px minmax(0,1fr) auto 12px;gap:14px;align-items:start;width:100%;text-align:left;border:0;background:transparent;padding:12px 14px;font:inherit;color:inherit;cursor:pointer}
      .attack-open:hover{background:var(--sa-subtle)}
      .attack-row.lead .attack-open:hover{background:color-mix(in srgb,var(--sa-primary-soft) 70%,var(--sa-subtle))}
      .attack-open:focus-visible{outline:2px solid var(--sa-primary);outline-offset:-2px}
      .attack-when{justify-content:center;width:100%;padding-left:0;padding-right:0;margin-top:1px}
      .attack-text{display:block;min-width:0}
      .attack-text b{display:block;font-size:13.5px;font-weight:650;letter-spacing:-.01em;color:var(--sa-ink)}
      .attack-summary{display:block;margin-top:2px;font-size:12.5px;line-height:1.5;color:var(--sa-ink-soft);max-width:78ch}
      .attack-tags{display:flex;flex-wrap:wrap;gap:6px;margin-top:7px}
      /* Quieter than a pill: these name the disciplines a phase touches, which
         is orientation rather than status, and pills in this product carry
         state. */
      .attack-tag{font-size:11px;letter-spacing:.01em;color:var(--sa-ink-faint);border:1px solid var(--sa-line-strong);border-radius:var(--sa-radius-sm);padding:2px 7px;white-space:nowrap}
      .attack-count{display:flex;flex-direction:column;align-items:flex-end;flex:0 0 auto;line-height:1.15}
      .attack-count b{font-size:19px;font-weight:650;color:var(--sa-ink);font-variant-numeric:tabular-nums}
      .attack-count span{font-size:11px;color:var(--sa-ink-faint)}
      .attack-caret{width:12px;height:12px;margin-top:5px;fill:none;stroke:currentColor;stroke-width:1.5;stroke-linecap:round;stroke-linejoin:round;color:var(--sa-line-strong);transition:color .15s ease,transform .15s ease}
      .attack-open:hover .attack-caret,.attack-open:focus-visible .attack-caret{color:var(--sa-ink-faint);transform:translateX(2px)}
      @media(prefers-reduced-motion:reduce){.attack-caret{transition:none}}
      @media(max-width:760px){
        .attack-open{grid-template-columns:58px minmax(0,1fr) 12px;row-gap:8px}
        .attack-count{grid-column:2;flex-direction:row;align-items:baseline;gap:6px}
      }
      .optimize-priority{border:1px solid var(--sa-line);border-radius:var(--sa-radius);background:var(--sa-surface);box-shadow:var(--sa-shadow-sm);padding:15px 17px;margin:0 0 14px}
      .optimize-priority-head{display:flex;align-items:flex-start;gap:14px;margin:0 0 10px}
      .optimize-priority-when{flex:0 0 auto;justify-content:center;min-width:56px;margin-top:2px}
      .optimize-priority-head h3{margin:0 0 3px;font-size:15px;font-weight:650;letter-spacing:-.015em;color:var(--sa-ink)}
      .optimize-priority-head .hint{margin:0;max-width:78ch}
      .optimize-priority-meta{margin-left:auto;display:flex;align-items:center;gap:8px;flex:0 0 auto;flex-wrap:wrap;justify-content:flex-end}
      .optimize-count{font-size:11.5px;color:var(--sa-ink-faint);font-variant-numeric:tabular-nums;white-space:nowrap}
      /* What a group unblocks is the reason it sits where it does; without it
         the sequence is an assertion. */
      .optimize-unblocks{margin:0 0 13px;padding:10px 12px;border:1px solid var(--sa-primary-line);background:var(--sa-primary-soft);border-radius:var(--sa-radius-sm);font-size:12.5px;line-height:1.55;color:var(--sa-ink-soft);max-width:88ch}
      .optimize-actions{list-style:none;margin:0;padding:0;display:grid;gap:10px}
      .optimize-actions>li{border-top:1px solid var(--sa-line);padding-top:11px}
      .optimize-action-head{display:flex;align-items:baseline;gap:12px;margin-bottom:3px}
      .optimize-action-head b{font-size:13.5px;font-weight:600;color:var(--sa-ink)}
      .optimize-action-head span{margin-left:auto;font-size:11.5px;color:var(--sa-ink-faint);white-space:nowrap;font-variant-numeric:tabular-nums}
      .optimize-actions .hint{margin:0 0 8px;max-width:84ch}
      .optimize-rules{display:flex;flex-wrap:wrap;gap:6px;margin:0 0 8px}
      /* Each rule behind an action, openable in Findings. This is the
         traceability the plan exists to keep. */
      .optimize-rule{display:inline-flex;align-items:center;gap:7px;border:1px solid var(--sa-line-strong);background:var(--sa-subtle);color:var(--sa-ink-soft);border-radius:var(--sa-radius-sm);padding:4px 9px;font-family:var(--sa-sans);font-size:12px;cursor:pointer;text-align:left}
      .optimize-rule:hover{border-color:var(--sa-primary-line);background:var(--sa-primary-soft);color:var(--sa-primary-text)}
      .optimize-rule:focus-visible{outline:2px solid var(--sa-primary);outline-offset:1px}
      .optimize-rule span{font-size:11px;color:var(--sa-ink-faint);font-variant-numeric:tabular-nums}
      .optimize-rule:hover span{color:var(--sa-primary-text)}
      .optimize-verify{margin:0;font-size:11.5px;line-height:1.5;color:var(--sa-ink-faint);max-width:84ch}
      /* A change is the row a plan is executed from: an id you can cite in a
         ticket, the thing on the page you edit, and what it says right now.
         Everything else — the instruction, the test, the pages — is behind the
         disclosure, because the reader scanning the plan is counting jobs, not
         reading them. */
      .change-list{list-style:none;margin:0;padding:0;border:1px solid var(--sa-line);border-radius:var(--sa-radius-sm);background:var(--sa-canvas);overflow:hidden}
      .change-list>li+li{border-top:1px solid var(--sa-line)}
      .change-head{display:grid;grid-template-columns:34px 68px minmax(120px,auto) minmax(0,1fr) auto 12px;gap:11px;align-items:center;width:100%;text-align:left;border:0;background:transparent;padding:8px 11px;font:inherit;color:inherit;cursor:pointer}
      /* The priority pill is fixed-width so a column of them reads as a column
         rather than as ragged text, which is what makes the list scannable. */
      .change-priority{justify-content:center;width:100%;padding-left:0;padding-right:0}
      .change-meta{display:flex;align-items:center;gap:9px;flex:0 0 auto;justify-content:flex-end}
      .change-category{font-size:11.5px;color:var(--sa-ink-faint);white-space:nowrap}
      .change-head:hover{background:var(--sa-subtle)}
      .change-head:focus-visible{outline:2px solid var(--sa-primary);outline-offset:-2px}
      .change-id{font-family:var(--sa-mono);font-size:11.5px;font-weight:600;color:var(--sa-ink-faint);font-variant-numeric:tabular-nums}
      .change-loc{font-size:12.5px;font-weight:600;color:var(--sa-ink)}
      /* The current value is quoted from the page, so it is set as the page's
         text and not as ours. It is one line: the full string is in the body. */
      .change-now{font-family:var(--sa-mono);font-size:11.5px;color:var(--sa-ink-soft);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0}
      .change-now.absent{font-family:var(--sa-sans);color:var(--sa-ink-faint);font-style:italic}
      .change-caret{width:12px;height:12px;fill:none;stroke:currentColor;stroke-width:1.5;stroke-linecap:round;stroke-linejoin:round;color:var(--sa-ink-faint);transition:transform .15s ease}
      .change-head[aria-expanded=true] .change-caret{transform:rotate(90deg)}
      .change-body{padding:2px 11px 13px 56px}
      .change-facts{display:grid;grid-template-columns:96px minmax(0,1fr);gap:5px 14px;margin:0 0 9px}
      .change-facts dt{font-size:11px;font-weight:600;letter-spacing:.02em;text-transform:uppercase;color:var(--sa-ink-faint);padding-top:1px}
      .change-facts dd{margin:0;font-size:12.5px;line-height:1.55;color:var(--sa-ink-soft);max-width:80ch}
      .change-facts dd.mono{font-family:var(--sa-mono);font-size:12px;color:var(--sa-ink);word-break:break-word}
      .change-more{margin:4px 0 0;font-size:11.5px;color:var(--sa-ink-faint)}
      /* The one control in the product that produces something the scan could
         not, and the one request that carries page text off the machine. It is
         drawn as an action rather than as a result, and its output is labelled
         as a draft for as long as it exists. */
      .draft{margin:10px 0 0;padding:10px 0 0;border-top:1px solid var(--sa-line)}
      .draft-row{display:flex;align-items:center;gap:11px;flex-wrap:wrap}
      .draft-btn{flex:0 0 auto}
      .draft-note{font-size:11.5px;line-height:1.45;color:var(--sa-ink-faint);max-width:52ch}
      .draft-out{margin:9px 0 0;padding:10px 12px;border:1px solid var(--sa-primary-line);border-radius:var(--sa-radius-sm);background:var(--sa-primary-soft)}
      .draft-label{display:inline-block;margin:0 0 5px;font-size:10.5px;font-weight:650;letter-spacing:.07em;text-transform:uppercase;color:var(--sa-primary-text)}
      .draft-value{margin:0;font-family:var(--sa-mono);font-size:12.5px;line-height:1.5;color:var(--sa-ink);word-break:break-word}
      .draft-meta{margin:6px 0 0;font-size:11px;color:var(--sa-ink-faint)}
      .draft-problem{margin:0;font-size:12px;line-height:1.5;color:var(--sa-ink-soft)}
      .draft-drop{margin-left:0;padding:2px 0;font-size:11.5px}
      /* Conclusions drawn across findings, which no single scanner could make.
         Drawn as proposals rather than results: a left rule and a quieter ground
         than a phase card, so they read as something to weigh rather than
         something already decided. */
      .structure{border:1px solid var(--sa-line);border-radius:var(--sa-radius);background:var(--sa-surface);padding:14px 16px;margin:0 0 14px}
      .structure-list{list-style:none;margin:11px 0 0;padding:0}
      .structure-list>li+li{margin-top:11px;padding-top:11px;border-top:1px solid var(--sa-line)}
      .structure-row{display:flex;align-items:center;gap:10px;flex-wrap:wrap}
      .structure-row b{font-size:13px;font-weight:650;color:var(--sa-ink)}
      .structure-count{font-size:12px;color:var(--sa-ink-faint);font-variant-numeric:tabular-nums}
      .structure-basis{margin:5px 0 0;font-size:12px;line-height:1.5;color:var(--sa-ink-soft);max-width:86ch}
      /* A heading, because two unlabelled cards floating above the phases give
         the reader nothing to place them by. */
      .reason-section{margin:0 0 11px}
      .reason-section h3{margin:0 0 3px;font-size:15px;font-weight:650;letter-spacing:-.015em;color:var(--sa-ink)}
      .reason-section .hint{margin:0;max-width:84ch}
      .reason-scope{margin-left:auto;font-size:11.5px;color:var(--sa-ink-faint);white-space:nowrap;font-variant-numeric:tabular-nums}
      /* Four pages, then a count. The first version gave the affected URLs more
         height than the question they were evidence for. */
      .reason-urls{max-height:none;overflow:visible}
      .reason-card{border:1px solid var(--sa-primary-line);border-radius:var(--sa-radius);background:var(--sa-surface);padding:13px 16px;margin:0 0 12px}
      .reason-card.question{border-color:color-mix(in srgb,var(--sa-warn) 45%,transparent)}
      .reason-head{display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin:0 0 7px}
      .reason-head h3{margin:0;font-size:14px;font-weight:650;letter-spacing:-.01em;color:var(--sa-ink)}
      .reason-body{margin:0 0 9px;font-size:12.5px;line-height:1.55;color:var(--sa-ink-soft);max-width:86ch}
      .reason-covers{display:flex;flex-wrap:wrap;gap:6px;margin:0 0 9px}
      .reason-caveat{margin:0;font-size:11.5px;line-height:1.5;color:var(--sa-ink-faint);max-width:86ch}
      .reason-settled{margin:7px 0 0;padding:8px 11px;border-radius:var(--sa-radius-sm);background:var(--sa-subtle);font-size:12px;line-height:1.5;color:var(--sa-ink-soft);max-width:86ch}
      .reason-card .url-list{margin:9px 0 0}
      .change-where{margin:9px 0 4px;font-size:11px;font-weight:600;letter-spacing:.02em;text-transform:uppercase;color:var(--sa-ink-faint)}
      /* The list is already capped at eight, so it needs no scroller of its own:
         a clipped ninth row inside a disclosure inside a modal is the third
         scrollbar this product spent a day removing. */
      .change-body .url-list{max-height:none;overflow:visible;margin:0}
      .change-body .optimize-rules{margin:0}
      /* The area's own count, stated where the changes are, so the phase total
         and the rows under it can be reconciled without adding them up. */
      .change-tally{font-size:11.5px;color:var(--sa-ink-faint);font-variant-numeric:tabular-nums;white-space:nowrap}
      .optimize-rationale{margin:0 0 9px;font-size:12.5px;line-height:1.55;color:var(--sa-ink-soft);max-width:84ch}
      .optimize-model{border:1px solid var(--sa-line);border-radius:var(--sa-radius);background:var(--sa-surface);padding:14px 16px;margin:0 0 12px}
      .optimize-model.unestablished{border-color:var(--sa-line-strong);border-left:6px solid transparent;background-image:linear-gradient(var(--sa-surface),var(--sa-surface)),var(--sa-hatch);background-origin:padding-box,border-box;background-clip:padding-box,border-box}
      .optimize-model .hint{margin:0;max-width:86ch}
      .optimize-model-evidence{margin-top:10px}
      .optimize-ruleids{font-family:var(--sa-mono);font-size:11px;color:var(--sa-ink-faint);overflow-wrap:anywhere}
      .optimize-excluded td{color:var(--sa-ink-faint)}

      /* Structured data ----------------------------------------------------
         The section reuses the table, pill and url-list components rather than
         growing its own: a fifth table style would be the same drift the pill
         consolidation just undid. Only what is genuinely new to this surface is
         declared here. */
      .schema-scope{margin:0 0 14px;max-width:84ch}
      .stat-grid.schema-stats{grid-template-columns:repeat(5,minmax(0,1fr));margin:0 0 16px}
      @media(max-width:1180px){.stat-grid.schema-stats{grid-template-columns:repeat(3,minmax(0,1fr))}}
      @media(max-width:720px){.stat-grid.schema-stats{grid-template-columns:repeat(2,minmax(0,1fr))}}
      .schema-conflicts{margin:0 0 16px;padding:14px 16px}
      .schema-conflicts .card-head{padding:0 0 8px}
      .schema-conflict-list{list-style:none;margin:10px 0 0;padding:0;display:grid;gap:12px}
      .schema-conflict{border:1px solid var(--sa-line);border-radius:var(--sa-radius-sm);background:var(--sa-subtle);padding:11px 13px}
      .schema-conflict-head{display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:4px}
      .schema-conflict-head b{font-size:13px;font-weight:600;color:var(--sa-ink)}
      .schema-conflict .hint{margin:0 0 8px}
      /* Each identity beside the number of pages asserting it: the shape of the
         disagreement is the evidence, so it is drawn rather than summarised. */
      .schema-variant{display:flex;align-items:baseline;justify-content:space-between;gap:12px;padding:4px 0;border-top:1px solid var(--sa-line)}
      .schema-variant code{font-family:var(--sa-mono);font-size:11.5px;color:var(--sa-ink-soft);overflow-wrap:anywhere}
      .schema-variant span{font-size:11.5px;color:var(--sa-ink-faint);white-space:nowrap;font-variant-numeric:tabular-nums}
      .schema-tabs{margin:0 0 12px}
      .schema-table td{vertical-align:top}
      .schema-table .col-num{width:1%;white-space:nowrap;text-align:right;font-variant-numeric:tabular-nums}
      /* The statement is the route to its own evidence, so it is a control
         rather than a label. */
      .schema-open{display:block;width:100%;text-align:left;background:none;border:0;padding:0;font:inherit;font-weight:600;color:var(--sa-ink);cursor:pointer}
      .schema-open:hover{color:var(--sa-primary-text);text-decoration:underline}
      .schema-open:focus-visible{outline:2px solid var(--sa-primary);outline-offset:2px;border-radius:2px}
      .schema-detail{display:block;margin-top:3px;font-size:12px;line-height:1.5;color:var(--sa-ink-soft);max-width:78ch}
      /* The affected pages sit under their finding rather than in a column, so
         one broken template reads as one job with a list, not as N rows. */
      .schema-urls td{padding-top:0;border-top:0}
      .schema-urls .url-list{max-height:160px;margin:0 0 8px}
      .schema-opportunities{list-style:none;margin:0;padding:0;display:grid;gap:12px}
      /* Hatched, not warned. An opportunity is an inference about markup the
         crawl did not see — that is the not-established state, and DESIGN.md
         draws it with the 45 degree hatch. A warn-coloured rail would have made
         correct markup read as a defect, which is the one thing this lens must
         never do. Same construction as the unrun render section. */
      .schema-opportunities li{border:1px solid var(--sa-line-strong);border-left:6px solid transparent;border-radius:var(--sa-radius-sm);padding:12px 14px;background-image:linear-gradient(var(--sa-surface),var(--sa-surface)),var(--sa-hatch);background-origin:padding-box,border-box;background-clip:padding-box,border-box}
      .schema-to-plan{margin-left:0;padding:6px 0 0}
      .schema-opportunity-note{margin:0 0 12px;max-width:84ch}
      .schema-empty{border:1px solid var(--sa-line);border-radius:var(--sa-radius);background:var(--sa-surface);padding:16px 18px}
      .schema-empty b{display:block;margin-bottom:4px;font-size:13.5px;font-weight:600;color:var(--sa-ink)}
      .schema-empty .hint{margin:0;max-width:80ch}

      /* Controls ------------------------------------------------------------ */
      .btn{display:inline-flex;align-items:center;justify-content:center;gap:7px;border:1px solid var(--sa-line-strong);border-radius:var(--sa-radius-sm);background:var(--sa-surface);color:var(--sa-ink);padding:8px 14px;font-family:var(--sa-sans);font-size:13.5px;font-weight:600;letter-spacing:0;text-transform:none;cursor:pointer;min-height:36px;box-shadow:var(--sa-shadow-sm);transition:background .12s ease,border-color .12s ease}
      .btn:hover:not(:disabled){background:var(--sa-subtle)}
      .btn:focus-visible{outline:2px solid var(--sa-primary);outline-offset:1px}
      .btn:disabled{opacity:.5;cursor:default}
      .btn.primary{background:var(--sa-primary);border-color:var(--sa-primary);color:#fff}
      .btn.primary:hover:not(:disabled){background:var(--sa-primary-hover);border-color:var(--sa-primary-hover)}
      .btn.danger{border-color:color-mix(in srgb,var(--wqa-critical) 45%,transparent);color:var(--sa-critical);background:var(--sa-surface)}
      .btn.danger:hover:not(:disabled){background:var(--sa-critical-soft)}
      .btn .departs{width:13px;height:13px;flex:0 0 auto;fill:none;stroke:currentColor;stroke-width:1.6;stroke-linecap:round;stroke-linejoin:round;opacity:.8}

      .chip{display:inline-flex;align-items:center;justify-content:center;border:1px solid var(--sa-line-strong);background:var(--sa-surface);border-radius:999px;padding:6px 13px;font-family:var(--sa-sans);font-size:12.5px;font-weight:500;letter-spacing:0;text-transform:none;color:var(--sa-ink-soft);cursor:pointer;min-height:32px;box-shadow:var(--sa-shadow-sm)}
      .chip:hover{background:var(--sa-subtle);color:var(--sa-ink)}
      .toolbar{display:flex;gap:10px;margin:0 0 12px;flex-wrap:wrap}
      .toolbar input[type="search"]{flex:1 1 260px;border:1px solid var(--sa-line-strong);border-radius:var(--sa-radius-sm);padding:9px 12px;font-size:13.5px;background:var(--sa-surface);color:var(--sa-ink);box-shadow:var(--sa-shadow-sm)}
      .toolbar input[type="search"]::placeholder{color:var(--sa-ink-faint)}
      .toolbar select{border:1px solid var(--sa-line-strong);border-radius:var(--sa-radius-sm);padding:9px 12px;font-size:13.5px;background:var(--sa-surface);color:var(--sa-ink);box-shadow:var(--sa-shadow-sm)}
      /* Link status filters carry their own counts. */
      .status-chip b{font-variant-numeric:tabular-nums;font-weight:650;color:var(--sa-ink)}
      /* A run of links from one page reads as a block, not the same URL
         restated on every row. */
      .links-table .link-same-source td:first-child{border-top:0}
      .links-table tbody tr:not(.link-same-source) td{border-top:1px solid var(--sa-line)}
      .links-source-head{width:34%}
      .col-group{font-size:12px;color:var(--sa-ink-soft);white-space:nowrap}
      .urls-table td:first-child{font-family:var(--sa-mono);font-size:12.5px}
      .toolbar input:focus-visible,.toolbar select:focus-visible,.field input:focus-visible,.field textarea:focus-visible{outline:2px solid var(--sa-primary);outline-offset:1px;border-color:var(--sa-primary)}
      .filter-state{font-size:12.5px;color:var(--sa-ink-faint);margin-left:auto;font-variant-numeric:tabular-nums}

      .field{display:block;margin:0 0 16px}
      .field>span:not(.hint){display:block;font-size:13px;font-weight:600;letter-spacing:0;text-transform:none;color:var(--sa-ink);margin-bottom:6px}
      .field>span.hint{display:block;font-weight:400;text-transform:none;letter-spacing:0}
      .field input,.field textarea{width:100%;border:1px solid var(--sa-line-strong);border-radius:var(--sa-radius-sm);padding:9px 12px;font-size:13.5px;color:var(--sa-ink);background:var(--sa-surface);box-shadow:var(--sa-shadow-sm)}
      .field input:disabled{background:var(--sa-subtle);color:var(--sa-ink-faint)}
      .row{display:flex;gap:16px;flex-wrap:wrap}
      .row .field{flex:1 1 200px}
      .hint{margin:4px 0 0;font-size:12.5px;line-height:1.5;color:var(--sa-ink-faint)}
      .hint-indent{margin:-2px 0 12px 26px}
      .check{display:flex;align-items:center;gap:9px;margin:0 0 6px;font-size:13.5px;color:var(--sa-ink)}
      .actions{display:flex;align-items:center;gap:10px;margin-top:18px;flex-wrap:wrap}
      .lede{margin:0 0 18px;color:var(--sa-ink-soft);font-size:13px;line-height:1.6;max-width:76ch}

      /* Setup: the form is the task, the explanation is reference. Side by
         side they fit one screen; stacked they did not, and the primary action
         sat below the fold on every window shorter than a laptop's. */
      .setup-columns{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,296px);gap:30px;align-items:start}
      .setup-aside{background:var(--sa-surface);border:1px solid var(--sa-line);border-radius:var(--sa-radius);box-shadow:var(--sa-shadow-sm);padding:13px 15px 15px}
      .setup-aside h3{margin:0 0 9px;font-size:13.5px;font-weight:600;letter-spacing:0;color:var(--sa-ink)}
      .setup-aside .lede{margin:0;max-width:none;font-size:12.5px;line-height:1.6}
      .setup-aside .lede+.lede{margin-top:12px;padding-top:12px;border-top:1px solid var(--sa-line)}
      @media(max-width:880px){.setup-columns{grid-template-columns:minmax(0,1fr);gap:18px}.setup-aside{order:-1}}
      .resume-banner{display:flex;align-items:center;gap:14px;justify-content:space-between;border:1px solid var(--sa-primary-line);background:var(--sa-primary-soft);border-radius:var(--sa-radius);padding:12px 14px;margin:0 0 18px}
      .resume-text{margin:0;font-size:13px;color:var(--sa-ink-soft)}
      .setup-error{color:var(--sa-critical);font-size:13px}

      .advanced{border:1px solid var(--sa-line);border-radius:var(--sa-radius);margin:6px 0 18px;overflow:hidden;background:var(--sa-surface);box-shadow:var(--sa-shadow-sm)}
      .advanced summary{cursor:pointer;padding:12px 14px;font-size:13.5px;font-weight:600;letter-spacing:0;text-transform:none;color:var(--sa-ink);list-style:none;display:flex;align-items:center;gap:8px;background:var(--sa-surface)}
      .advanced summary::-webkit-details-marker{display:none}
      .advanced summary::before{content:'\\25B8';display:inline-block;font-size:11px;color:var(--sa-ink-faint);transition:transform .15s ease}
      .advanced[open] summary::before{transform:rotate(90deg)}
      .advanced-body{padding:4px 14px 16px;border-top:1px solid var(--sa-line)}
      .advanced textarea{font-family:var(--sa-mono);font-size:12.5px;resize:vertical;min-height:60px}

      /* Progress ------------------------------------------------------------ */
      .progress-bar{height:8px;border-radius:999px;background:var(--sa-info-soft);overflow:hidden;margin-bottom:22px}
      .progress-fill{height:100%;background:var(--sa-primary);width:100%;transform:scaleX(.04);transform-origin:left center;transition:transform .3s ease;border-radius:999px}
      .recent-feed{list-style:none;margin:0;padding:0;background:var(--sa-surface);border:1px solid var(--sa-line);border-radius:var(--sa-radius);overflow:hidden;box-shadow:var(--sa-shadow-sm)}
      .recent-feed li{display:flex;align-items:center;gap:10px;font-size:12.5px;padding:9px 12px;border-bottom:1px solid var(--sa-line)}
      .recent-feed li:last-child{border-bottom:0}
      .recent-feed .url{flex:1 1 auto;font-family:var(--sa-mono);font-size:12.5px;color:var(--sa-ink-soft);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}

      /* Severity + breakdown ------------------------------------------------- */
      .severity-bar{display:flex;height:12px;border-radius:999px;overflow:hidden;background:var(--sa-info-soft);margin:0 0 12px}
      .severity-bar span{height:100%}
      .severity-legend{list-style:none;display:grid;gap:8px;margin:0;padding:0;font-size:13px;color:var(--sa-ink-soft)}
      .severity-legend li{display:flex;align-items:center;gap:8px;font-variant-numeric:tabular-nums}
      .severity-legend .sw{width:10px;height:10px;border-radius:12px;flex:0 0 auto}



      .top-issues{list-style:none;margin:0;padding:0;display:grid;gap:2px}
      .top-issues li{min-width:0}
      .ti-open{display:flex;align-items:center;gap:10px;width:100%;min-width:0;font:inherit;font-size:13px;text-align:left;border:0;background:transparent;padding:8px 10px;border-radius:var(--sa-radius-sm);color:var(--sa-ink-soft);cursor:pointer}
      .ti-open:hover{background:var(--sa-subtle)}
      .ti-open:focus-visible{outline:2px solid var(--sa-primary);outline-offset:-2px}
      /* min-width:0 is what actually lets the title shrink and ellipsis inside
         a flex row; without it the row grew and pushed the count off the card. */
      .top-issues .ti-rule{font-weight:500;flex:1 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--sa-ink)}
      .top-issues .ti-scope{flex:0 0 auto;color:var(--sa-ink-faint);font-size:12.5px;white-space:nowrap;font-variant-numeric:tabular-nums}

      /* Coverage ------------------------------------------------------------- */

      .cov-plan{display:flex;height:10px;border-radius:999px;overflow:hidden;margin:0 0 12px;background:var(--sa-info-soft)}
      .cov-surveyed{background:var(--sa-primary)}
      .cov-unsurveyed{background-image:var(--sa-hatch);flex:1 1 auto}
      /* Inside all:initial an unstyled size is the browser's 16px, not the
         product's. This block states coverage limits, so it reads at the body
         step like every other sentence on the screen. */
      .cov-note{display:grid;gap:8px;font-size:13px;line-height:1.55;color:var(--sa-ink-soft)}

      /* The render pass is where every accessibility, runtime-error and
         performance finding comes from. When it has not run, the audit is
         missing three whole disciplines — so the panel states which of the
         three coverage states it is in, in the same words the Site conditions
         readout uses, instead of reading as an optional extra tucked under the
         fold. */
      .render-section{border:1px solid var(--sa-primary-line);border-radius:var(--sa-radius);padding:16px;margin:0 0 18px;background:var(--sa-primary-soft)}
      .render-section h3{margin:0;font-size:13.5px;font-weight:600;letter-spacing:0;text-transform:none;color:var(--sa-ink)}
      .render-head{display:flex;align-items:center;gap:10px;margin:0 0 6px}
      .render-state{margin-left:auto}
      .render-status{margin:0 0 12px;font-size:13px;line-height:1.55;color:var(--sa-ink-soft);max-width:82ch}
      .render-section .actions{margin-top:0}
      /* Unrun is a coverage fact, not a defect: neutral surface with the same
         hatched rail the survey drawings use, never a severity colour. */
      .render-section[data-state=none]{background:var(--sa-surface);border-color:var(--sa-line-strong);border-left:6px solid transparent;background-image:linear-gradient(var(--sa-surface),var(--sa-surface)),var(--sa-hatch);background-origin:padding-box,border-box;background-clip:padding-box,border-box}
      .render-section[data-state=none] .render-state{background:var(--sa-subtle);color:var(--sa-ink);border:1px dashed var(--sa-line-strong)}
      .render-section[data-state=none] .render-progress-bar{display:none}
      .render-section[data-state=done]{background:var(--sa-success-soft);border-color:var(--sa-success-line)}
      .render-section[data-state=done] .render-state{background:var(--sa-surface);color:var(--sa-success)}
      .render-section[data-state=done] .render-progress-bar{display:none}
      .render-section[data-state=running] .render-state,.render-section[data-state=partial] .render-state{background:var(--sa-surface);color:var(--sa-primary-text)}

      .deliver{border:1px solid var(--sa-line);border-radius:var(--sa-radius);margin:0;overflow:hidden;background:var(--sa-surface);box-shadow:var(--sa-shadow-sm)}
      .deliver-main{display:flex;align-items:center;gap:18px;padding:16px}
      .deliver-copy{flex:1 1 auto}
      .deliver-copy h3{margin:0 0 3px;font-size:13.5px;font-weight:600;letter-spacing:0;text-transform:none;color:var(--sa-ink)}
      .deliver-copy .hint{margin:0;color:var(--sa-ink-faint)}
      .deliver-data{display:flex;align-items:center;gap:10px;flex-wrap:wrap;padding:12px 16px;background:var(--sa-subtle);border-top:1px solid var(--sa-line)}
      .deliver-label{font-size:12.5px;font-weight:600;text-transform:none;letter-spacing:0;color:var(--sa-ink-faint);margin-right:4px}
      .link-btn{background:none;border:0;padding:6px 2px;font:inherit;font-size:12.5px;color:var(--sa-ink-faint);text-decoration:underline;cursor:pointer;margin-left:auto}
      .link-btn:hover{color:var(--sa-ink)}

      .pager{display:flex;align-items:center;gap:12px;margin:14px 0 4px}
      .pager-label{font-size:12.5px;color:var(--sa-ink-faint);font-variant-numeric:tabular-nums}

      .section-index{display:flex;flex-wrap:wrap;gap:8px;margin:0 0 14px}
      .section-cut{display:flex;align-items:baseline;gap:8px;border:1px solid var(--sa-line-strong);background:var(--sa-surface);border-radius:999px;padding:6px 13px;cursor:pointer;font-family:var(--sa-sans);font-size:12.5px;color:var(--sa-ink-soft);min-height:32px;box-shadow:var(--sa-shadow-sm)}
      .section-cut:hover{background:var(--sa-subtle)}
      .section-cut:focus-visible{outline:2px solid var(--sa-primary);outline-offset:1px}
      .section-cut.active{background:var(--sa-primary-soft);border-color:var(--sa-primary-line);color:var(--sa-primary-text);box-shadow:none}
      .section-cut .sc-count{font-variant-numeric:tabular-nums;color:var(--sa-ink-faint);font-weight:600}
      .section-cut.active .sc-count{color:var(--sa-primary-text)}

      .history{margin:22px 0 0}
      .history-head{display:flex;align-items:baseline;justify-content:space-between;gap:14px;flex-wrap:wrap;margin:0 0 8px}
      .history-head h3{margin:0;font-size:13.5px;font-weight:650;letter-spacing:-.01em;color:var(--sa-ink)}
      .history-policy{margin:0;font-size:12px;color:var(--sa-ink-faint)}
      .history-when{font-weight:600;color:var(--sa-ink)}
      .history-meta{color:var(--sa-ink-soft)}
      /* The change against the previous audit is the reason to read this row at
         all: a count answers "what did it find", a delta answers "is this site
         getting better or worse", which is the question a second audit exists
         to settle. Direction is carried by a word as well as a colour. */
      .history-delta{font-weight:600;white-space:nowrap}
      .history-delta[data-dir="down"]{color:var(--sa-success)}
      .history-delta[data-dir="up"]{color:var(--sa-critical)}
      .history-delta[data-dir="same"]{color:var(--sa-ink-faint)}
      .history-running{color:var(--sa-warn);font-weight:600}
      .history-list{list-style:none;margin:16px 0 0;padding:0;background:var(--sa-surface);border:1px solid var(--sa-line);border-radius:var(--sa-radius);overflow:hidden}
      .history-list li{display:flex;align-items:center;justify-content:space-between;gap:10px;border-bottom:1px solid var(--sa-line);padding:11px 14px;font-size:13px;font-variant-numeric:tabular-nums}
      .history-list li:last-child{border-bottom:0}
      .history-list button{border:0;background:transparent;color:var(--sa-primary-text);font-weight:600;cursor:pointer;font-size:13px}

      .foot-note{margin:0;padding:10px 16px;border-top:1px solid var(--sa-line);background:var(--sa-surface);color:var(--sa-ink-faint);font-size:12.5px;flex:0 0 auto;font-family:var(--sa-sans)}

      .finding-detail{margin:0 14px 14px;padding-top:12px;border-top:1px solid var(--sa-line)}
      .finding-detail h4{margin:14px 0 5px;font-size:12.5px;font-weight:600;text-transform:none;letter-spacing:0;color:var(--sa-ink-faint)}
      .detail-basis,.detail-explain{margin:0 0 8px;font-size:13px;line-height:1.6;color:var(--sa-ink-soft);max-width:84ch}
      .detail-plan{margin:0 0 10px}
      .detail-rule{margin:0;font-size:12.5px;color:var(--sa-ink-faint)}
      .detail-rule code{font-family:var(--sa-mono);font-size:12.5px;color:var(--sa-ink-soft)}
      /* A list of affected URLs, built in two places: the finding detail and the
         findings inspector's Instances tab. These were scoped to .finding-detail,
         so the Instances tab rendered bare anchors in Chrome's own link colours —
         periwinkle for unvisited, purple for visited, which also put the operator's
         browsing history on screen as if it meant something about the audit. The
         rules carry no ancestor now: a component that only looks right inside one
         parent is a component that will be wrong in the second place it is used. */
      .url-list{max-height:220px;overflow:auto;border:1px solid var(--sa-line);border-radius:var(--sa-radius-sm);background:var(--sa-subtle);padding:6px 10px;margin:2px 0 4px}
      .url-item{display:block;font-family:var(--sa-mono);font-size:12.5px;color:var(--sa-primary-text);text-decoration:none;padding:3px 0;word-break:break-all}
      .url-item:hover{text-decoration:underline}
      .detail-empty{margin:2px 0 4px;font-size:12.5px;color:var(--sa-ink-faint)}
      .row-expand{cursor:pointer}
      .detail-row{background:var(--sa-subtle)}
      .detail-row td{padding:12px 14px}
      .detail-block{font-size:13px;color:var(--sa-ink-soft)}
      .detail-block h4{margin:0 0 5px;font-size:12.5px;font-weight:600;text-transform:none;letter-spacing:0;color:var(--sa-ink-faint)}
      .detail-block ul{margin:0 0 12px;padding-left:18px}
      .detail-block li{margin-bottom:3px}

      /* Narrow: the nav becomes a horizontal strip above the content. */
      @media(max-width:900px){
        .workspace{inset:10px}
        .body{flex-direction:column}
        .view.active{flex-direction:column}
        /* No right padding on the strip itself: the pinned actions below stick
           to the content edge, and a right padding here left the last button
           clipped by exactly that much. */
        .sidenav{width:auto;border-right:0;border-bottom:1px solid var(--sa-line);flex-direction:row;align-items:center;gap:10px;padding:10px 0 10px 12px;overflow-x:auto}
        .nav-site{border-bottom:0;border-right:1px solid var(--sa-line);padding:0 12px 0 0;margin:0 4px 0 0;flex:0 0 auto}
        /* Narrow: the groups collapse into one scrolling strip. Their labels
           go, but the separators stay, so the reading order that puts
           availability before accessibility survives the reflow. */
        .nav-group{display:flex;align-items:center;margin:0;flex:0 0 auto}
        .nav-group+.nav-group{padding-left:10px;margin-left:2px;border-left:1px solid var(--sa-line)}
        .nav-group-label{display:none}
        .tabs{flex-direction:row;gap:4px}
        .tab{width:auto;white-space:nowrap}
        .tab-state{margin-left:6px}
        /* Fourteen sections make the strip wider than the window, and the
           actions used to be the last flex item inside it — reachable only by
           scrolling past every section. Pinned to the visible right edge, they
           stay put while the sections scroll underneath. */
        .nav-foot{margin:0 0 0 auto;flex-direction:row;padding:0 12px 0 10px;flex:0 0 auto;position:sticky;right:0;background:var(--sa-nav);box-shadow:-10px 0 10px -8px rgba(0,0,0,.45)}
        .main{padding:16px 14px 22px}
        h2{font-size:18px}
        .cond-head{grid-template-columns:22px minmax(0,1fr) 12px;gap:8px 12px}
        .cond-headline,.cond-state{grid-column:2}
        .cond-state{justify-self:start}
        .cond-evidence{padding-left:16px}
      }
      @media(prefers-reduced-motion:reduce){.progress-fill,.f-chev,.cond-caret{transition:none}}
    `;
  }



  // --- Report sections ------------------------------------------------------
  // Lumen collected all of this already; until now it arrived as one
  // undifferentiated Findings list, which is why a product carrying eight
  // disciplines' worth of evidence read as four sections deep.
  //
  // The order is the standing prioritization rule made structural:
  // availability — a confirmed functional failure — leads, and accessibility
  // takes its turn alongside the rest rather than at the front, because being
  // the cheapest discipline to detect in volume is not a claim to precedence.
  /**
   * The report's navigation.
   *
   * Two top-level destinations, then two labelled groups. Overview and
   * Findings are where the audit is read; Explore is where the underlying
   * rows are interrogated; Validate is the one section whose evidence has to
   * be asked for, which is why it is separated and why it carries a state
   * rather than a count.
   *
   * The ten discipline sections this replaces are not lost: they became the
   * area filter on Findings, where a filter belongs, and their coverage
   * statements moved to Overview's site-systems readout. A discipline is a
   * lens on the findings, not a place.
   */
  const SITE_AUDIT_NAV_GROUPS = [
    { label: '', items: ['overview', 'findings'] },
    { label: 'Explore', items: ['urls', 'links', 'schema'] },
    { label: 'Validate', items: ['browser'] },
    // Optimize is its own destination rather than a tab inside Findings: it is
    // the one place that answers "what do we do, and in what order" rather than
    // "what is wrong", and burying that in a table is how a plan goes unread.
    { label: 'Optimize', items: ['optimize'] }
  ];

  const SITE_AUDIT_TAB_LABEL = {
    overview: 'Overview', findings: 'Findings', urls: 'Pages', links: 'Links', schema: 'Structured data', browser: 'Browser checks', optimize: 'Optimize'
  };

  /**
   * Sub-views, shown indented under whichever parent is open.
   *
   * Each one is a scope the store can actually answer, never a saved search:
   * a sub-view that cannot narrow the query behind it is a bookmark wearing
   * navigation's clothes.
   */
  const SITE_AUDIT_SUBVIEWS = {
    urls: [
      { id: 'all', label: 'All pages', scope: {} },
      { id: 'gaps', label: 'Not fully checked', scope: { statuses: 'queued,error,skipped' } },
      { id: 'noindex', label: 'noindex', scope: { indexable: 'no' } },
      { id: 'errors', label: 'Failed to fetch', scope: { statuses: 'error' } }
    ],
    links: [
      { id: 'all', label: 'All links', status: '' },
      { id: 'broken', label: 'Broken', status: 'broken' },
      { id: 'blocked', label: 'Blocked', status: 'blocked' },
      { id: 'inconclusive', label: 'Unverified', status: 'inconclusive' },
      { id: 'healthy', label: 'Healthy', status: 'healthy' }
    ]
  };

  /** Rule id to discipline. The list itself lives in
   * packages/findings/disciplines.js and is injected here at build time, the
   * same way the palette is: the overlay groups findings by discipline and so
   * does the exported client report, and while each kept its own copy they
   * disagreed about what a finding *was*. Patterns arrive as strings because
   * that is what survives the injection. */
  function lumenDisciplineRules() {
    return [
      ['availability', ['^navigation\\.link-', '^runtime\\.(resource-failed|resource-status|visible-error)', '^navigation\\.(fragment-missing|skip-link-target-missing)', '^ux\\.(inert-link|form-no-submit|controls-target-missing|disclosure-target-missing|disclosure-toggle-failed|menu-toggle-failed|interaction-restoration-unproven)']],
      ['duplicates', ['^seo\\.duplicate-', '^structure\\.duplicate-h1']],
      ['sitemaps', ['^seo\\.sitemap-']],
      ['international', ['^seo\\.hreflang-', '^a11y\\.lang-']],
      ['indexability', ['^seo\\.(canonical|noindex|robots|soft-404)', '^structure\\.orphan-page', '^navigation\\.redirect-chain-long', '^web\\.meta-refresh']],
      ['security', ['^security\\.']],
      ['performance', ['^performance\\.']],
      ['accessibility', ['^(axe|a11y)\\.']],
      ['content', ['^seo\\.(title|description|thin-content)', '^structure\\.(h1-|heading-skip|image-alt-missing)', '^content\\.', '^social\\.']],
      ['quality', ['.']]
    ];
  }

  const SITE_AUDIT_DISCIPLINE_RULES = lumenDisciplineRules()
    .map(([discipline, patterns]) => [discipline, patterns.map((p) => new RegExp(p))]);

  function disciplineOf(ruleId) {
    const id = String(ruleId || '');
    for (const [discipline, patterns] of SITE_AUDIT_DISCIPLINE_RULES) {
      if (patterns.some((re) => re.test(id))) return discipline;
    }
    return 'quality';
  }

  /**
   * What each discipline section says about itself.
   *
   * `evidence` is the load-bearing field: it names the collection tier the
   * section depends on, and disciplineState() uses it to decide whether an
   * empty section means "checked, found nothing" or "never checked". Those two
   * are different facts and this product exists not to conflate them.
   */
  const SITE_AUDIT_DISCIPLINE_META = {
    availability: {
      evidence: 'links',
      lede: 'Whether the things this site links to actually resolve. A confirmed broken link is a functional failure, not a suggestion, which is why this section leads the report.',
      findingsNote: 'Broken destinations, error responses and interaction failures found on the crawled pages.'
    },
    indexability: {
      evidence: 'static',
      lede: 'Whether a search engine can reach, index and consolidate these pages: canonicals, noindex, robots directives, and pages nothing links to.',
      findingsNote: 'Indexability findings across the crawled pages.'
    },
    content: {
      evidence: 'static',
      lede: 'Titles, meta descriptions, headings and body length across the crawled pages, measured from the static HTML response.',
      findingsNote: 'On-page content findings.'
    },
    duplicates: {
      evidence: 'static',
      lede: 'Pages that share a title, description or H1. Duplicates split ranking signals and make a search result ambiguous to the person reading it.',
      findingsNote: 'Duplicate-content findings raised by the cross-page pass.'
    },
    sitemaps: {
      evidence: 'signals',
      lede: 'What this site publishes about itself, and whether the crawl agrees with it: robots.txt, the XML sitemap, and the URLs each one implies.',
      findingsNote: 'Disagreements between the sitemap and what the crawl actually reached.'
    },
    security: {
      evidence: 'static',
      lede: 'Browser-facing security posture, taken from the HTTP responses themselves: response headers, mixed content and form destinations.',
      findingsNote: 'Security findings across the crawled pages.'
    },
    international: {
      evidence: 'static',
      lede: 'Language and regional targeting: hreflang alternates, and the document language each page declares.',
      findingsNote: 'International targeting findings.'
    },
    quality: {
      evidence: 'static',
      lede: 'Markup and configuration that is wrong even when the user impact is indirect: structured data, document metadata, analytics and interaction wiring.',
      findingsNote: 'Web-quality findings across the crawled pages.'
    },
    performance: {
      evidence: 'render',
      lede: 'Measured loading behaviour: largest contentful paint, layout shift, time to first byte, page weight. Every number here comes from opening the page in a real browser.',
      findingsNote: 'Performance findings from the pages checked in this browser.'
    },
    accessibility: {
      evidence: 'render',
      lede: 'Barriers for assistive technology, keyboard and low-vision users, found by running axe against the rendered page.',
      findingsNote: 'Accessibility findings from the pages checked in this browser.'
    }
  };

  const SITE_AUDIT_DISCIPLINE_IDS = Object.keys(SITE_AUDIT_DISCIPLINE_META);

  /** Area names as the Findings filter shows them. Availability first, by the
   * standing rule that a confirmed functional failure outranks the discipline
   * that is cheapest to detect in volume. */
  const SITE_AUDIT_AREA_LABEL = {
    availability: 'Availability', indexability: 'Indexability', content: 'Content',
    duplicates: 'Duplicates', sitemaps: 'Sitemaps', security: 'Security',
    international: 'International', quality: 'Web quality',
    performance: 'Performance', accessibility: 'Accessibility'
  };

  /** Each parent carries its own sub-nav, rendered but hidden until that
   * parent is the open one — so opening Pages reveals its scopes in place
   * rather than replacing the navigation the operator was reading. */
  function siteAuditNavMarkup() {
    return SITE_AUDIT_NAV_GROUPS.map((group) => `
            <div class="nav-group">
              ${group.label ? `<p class="nav-group-label">${group.label}</p>` : ''}
              <nav class="tabs"${group.label ? ` aria-label="${group.label}"` : ''}>
                ${group.items.map((id) => `<div class="nav-block">
                  <button type="button" class="tab${id === 'overview' ? ' active' : ''}" data-tab="${id}">
                    <span class="tab-label">${SITE_AUDIT_TAB_LABEL[id]}</span>
                    <span class="tab-state" hidden><span class="tab-dot" aria-hidden="true"></span><span class="tab-num"></span></span>
                  </button>
                  ${(SITE_AUDIT_SUBVIEWS[id] || []).length ? `<div class="subnav" data-for="${id}" hidden>${SITE_AUDIT_SUBVIEWS[id].map((v) => `<button type="button" class="subnav-item" data-tab="${id}" data-view="${v.id}">${v.label}</button>`).join('')}</div>` : ''}
                </div>`).join('')}
              </nav>
            </div>`).join('');
  }

  /**
   * The audited page must not scroll behind the Site Audit overlay.
   *
   * The overlay is a modal — `role="dialog" aria-modal="true"`, a backdrop, the
   * whole viewport — but the document underneath was still a live scroller, which
   * cost two things. Its scrollbar sat nine pixels to the right of the overlay's
   * own, so the right edge read as a pair of parallel bars, one of them the
   * browser's default light grey on a near-black surface and none of it ours to
   * theme: we style Lumen's surfaces, never the page being audited. And a wheel
   * gesture anywhere over the backdrop scrolled a page the operator could not see.
   *
   * So the page is locked for as long as the modal is open, the way Chrome's own
   * dialogs lock it. The width the scrollbar occupied is handed straight back as
   * padding, or the page reflows by that much the instant it locks and reflows
   * again on close — visible through a 72%-opacity backdrop. Both values are
   * captured from the inline style and restored exactly, because this is somebody
   * else's document and Lumen leaves it as it found it.
   */
  let siteAuditScrollLock = null;

  function lockAuditedPageScroll() {
    if (siteAuditScrollLock) return;
    try {
      const root = document.documentElement;
      const gutter = window.innerWidth - root.clientWidth;
      // Per axis, not the shorthand: a page that set only overflow-y reads an
      // empty style.overflow, so saving and restoring the shorthand would hand
      // the page back with its own overflow silently dropped.
      siteAuditScrollLock = { overflowX: root.style.overflowX, overflowY: root.style.overflowY, paddingRight: root.style.paddingRight };
      root.style.overflowX = 'hidden';
      root.style.overflowY = 'hidden';
      if (gutter > 0) root.style.paddingRight = `${gutter}px`;
    } catch { siteAuditScrollLock = null; }
  }

  function releaseAuditedPageScroll() {
    if (!siteAuditScrollLock) return;
    try {
      const root = document.documentElement;
      root.style.overflowX = siteAuditScrollLock.overflowX;
      root.style.overflowY = siteAuditScrollLock.overflowY;
      root.style.paddingRight = siteAuditScrollLock.paddingRight;
    } catch { /* the page may be gone; the lock goes with it */ }
    siteAuditScrollLock = null;
  }

  function createSiteAuditRoot() {
    const old = document.getElementById('__web_qa_site_audit_root');
    if (old) old.remove();
    const host = document.createElement('div');
    host.id = '__web_qa_site_audit_root';
    host.setAttribute('data-webqa-ui', 'site-audit-overlay');
    host.setAttribute('data-webqa-overlay', 'site-audit');
    host.style.cssText = 'all:initial;position:fixed;inset:0;z-index:2147483646;pointer-events:auto;';
    ensureLumenFontFaces();
    lockAuditedPageScroll();
    document.documentElement.appendChild(host);
    const shadow = host.attachShadow({ mode: 'open' });
    shadow.innerHTML = `<!--
      THESIS: An audit is an investigation in progress, not a report that appears at the end. This surface is the instrument a consultant leaves open on a second monitor while a crawl runs.
      OWN-WORLD: The operator's console — near-black grounds in five steps, violet as the single product voice, one sealed severity ramp, structure carried by hairlines a shade above the ground rather than by shadow. IBM Plex Sans and its own monospace sibling, self-hosted.
      STORY: The consultant sees what was surveyed, what was not, and what is broken, then hands the client a document that says the same things in the same order.
      FIRST VIEWPORT: Left navigation grouped into destinations — Overview and Findings, then Explore, then Validate; the main column opens on Overview with the scope of the crawl stated before any count that depends on it.
      FORM: The direction the operator pinned with six mockups, replacing the light category standard the previous world had taken as the standing exit.
      FINISH: unreviewed and undocumented is unfinished; DESIGN.md is written from the world that shipped, not from the one that was intended.
    --><style>${siteAuditCss()}</style><div class="backdrop"></div><section class="workspace" role="dialog" aria-modal="true" aria-labelledby="sa-title">
      <header class="head"><span class="mark" aria-hidden="true"></span><div class="identity"><span class="name">Lumen</span><span class="device">Site Audit</span></div><button type="button" class="close" aria-label="Close site audit"><svg class="x" viewBox="0 0 16 16" aria-hidden="true"><path d="M4.5 4.5l7 7M11.5 4.5l-7 7"/></svg></button></header>
      <div class="body">
        <div class="view view-setup active">
          <div class="main main-narrow">
          <div class="resume-banner" hidden>
            <p class="resume-text"></p>
            <button type="button" class="btn resume-btn">Resume</button>
          </div>
          <div class="page-head"><div><h2 id="sa-title">Audit this site</h2></div></div>
          <!-- Two columns, because the explanation is read once and the form is
               used every time. Stacked, they pushed the primary action below
               the fold on an ordinary window; beside each other, the whole
               configuration is in view and only opening Advanced options
               scrolls. -->
          <div class="setup-columns">
          <div class="setup-form">
          <label class="field"><span>Start URL</span><input type="url" class="start-url" /></label>
          <div class="row">
            <label class="field"><span>Max pages</span><input type="number" class="max-pages" min="1" max="300" value="40" /><span class="hint">Stops the crawl after this many pages, even if more are discovered. Up to 300.</span></label>
            <label class="field"><span>Concurrency</span><input type="number" class="concurrency" min="1" max="6" value="3" /><span class="hint">How many pages are fetched at once. Higher is faster but puts more simultaneous load on the target site.</span></label>
          </div>
          <label class="check"><input type="checkbox" class="include-subdomains" /><span>Include subdomains</span></label>
          <p class="hint hint-indent">Also crawl pages on subdomains of this site (e.g. blog.example.com), not just this exact host.</p>
          <label class="check"><input type="checkbox" class="respect-robots" checked /><span>Respect robots.txt</span></label>
          <p class="hint hint-indent">Skip pages this site's robots.txt asks crawlers not to visit. Turn off only if you specifically need to audit a disallowed section.</p>
          <details class="advanced">
            <summary>Advanced options</summary>
            <div class="advanced-body">
              <div class="row">
                <label class="field"><span>Max link depth</span><input type="number" class="max-depth" min="0" max="50" placeholder="No limit" /><span class="hint">Stop following links more than this many hops from the start URL. Leave blank for no limit.</span></label>
                <label class="field"><span>Delay between pages</span><input type="number" class="request-delay" min="0" max="5000" step="50" placeholder="0" /><span class="hint">Milliseconds to wait before each page fetch, a light rate limit if the target site is sensitive to burst traffic. 0 = off.</span></label>
              </div>
              <label class="field"><span>Only crawl paths containing</span><textarea class="include-patterns" placeholder="/blog/&#10;/products/"></textarea><span class="hint">One per line. If set, only URLs whose path contains at least one of these are crawled.</span></label>
              <label class="field"><span>Never crawl paths containing</span><textarea class="exclude-patterns" placeholder="/wp-admin/&#10;/tag/"></textarea><span class="hint">One per line. These are skipped even if linked from a crawled page.</span></label>
              <label class="check"><input type="checkbox" class="check-external-links" checked /><span>Check external links</span></label>
              <p class="hint hint-indent">Verify off-site links actually resolve. Turn off for a faster crawl, or if the target site's outbound links commonly trigger destination bot-protection.</p>
              <label class="check"><input type="checkbox" class="respect-nofollow" /><span>Don't follow rel="nofollow" links</span></label>
              <p class="hint hint-indent">Links are still recorded and link-checked either way; this only controls whether the crawler follows them to discover more pages.</p>
            </div>
          </details>
          <p class="setup-error" style="display:none"></p>
          <div class="actions">
            <button type="button" class="btn primary start-btn">Start audit</button>
          </div>
          <section class="history" hidden>
            <div class="history-head">
              <h3>Earlier audits of this site</h3>
              <p class="hint history-policy"></p>
            </div>
            <ul class="history-list"></ul>
          </section>
          </div>
          <aside class="setup-aside">
            <h3>How the audit runs</h3>
            <p class="lede">Crawls every page it can reach from this URL and checks it for broken links, missing SEO metadata, and heading structure. This step runs on the assistant server, not your computer. It is a plain page fetch rather than a full browser render, which is what keeps it fast and cheap at any site size. It keeps going even if you close this window.</p>
            <p class="lede">Deeper checks that need a real browser, such as accessibility (axe), JavaScript-dependent content and image or performance sizing, are a separate, optional step after the crawl finishes. That step runs in your own browser instead, one page at a time, so it costs your computer's resources rather than the server's.</p>
          </aside>
          </div>
          </div>
        </div>
        <div class="view view-progress">
          <div class="main run-main">
          <div class="page-head run-head">
            <div class="run-identity">
              <h2>Scanning <span class="run-target tb-project">&ndash;</span></h2>
              <div class="chip-row">
                <span class="pill roomy state-chip live" data-tone="brand"><span class="pulse-dot" aria-hidden="true"></span><span class="run-where">Running on gateway</span></span>
                <span class="pill roomy state-chip"><span class="stat-elapsed">Elapsed 0s</span></span>
                <span class="pill roomy state-chip">Progress saved continuously</span>
              </div>
            </div>
            <div class="run-actions">
              <button type="button" class="btn view-partial-btn">Continue in background</button>
              <button type="button" class="btn quiet pause-btn">Pause</button>
              <button type="button" class="btn icon-btn danger cancel-btn" title="Stop this audit"><span class="stop-glyph" aria-hidden="true"></span><span class="sr-only">Stop this audit</span></button>
            </div>
          </div>

          <!-- The four phases of an audit, so a crawl that looks stuck can be
               read as "waiting on the browser pass" rather than as broken. -->
          <ol class="stepper" aria-label="Audit phases"></ol>

          <section class="phase-card">
            <div class="phase-top">
              <span class="pill phase-badge" data-tone="brand">Phase 1 of 4</span>
              <h3 class="phase-name">Preparing</h3>
              <span class="phase-count"></span>
            </div>
            <div class="progress-bar"><div class="progress-fill"></div></div>
            <dl class="phase-metrics"></dl>
            <p class="now-requesting" hidden><span class="nr-label">Now requesting</span><span class="nr-url"></span></p>
          </section>

          <!-- Raising the budget reopens the frontier without refetching what
               is already done, so this is an offer rather than a warning. -->
          <section class="budget-callout" hidden>
            <span class="callout-mark" aria-hidden="true"></span>
            <p class="budget-text"></p>
            <button type="button" class="btn budget-btn"></button>
          </section>
          <p class="budget-error" role="status" hidden></p>

          <div class="run-columns">
            <section class="panel-card run-activity">
              <div class="card-head">
                <h3 class="feed-heading">Live activity</h3>
                <span class="pill roomy state-chip live" data-tone="brand"><span class="pulse-dot" aria-hidden="true"></span>Updating live</span>
              </div>
              <p class="hint">Requests, discoveries and independently confirmed destinations.</p>
              <ul class="recent-feed"></ul>
            </section>
            <div class="run-side">
              <section class="panel-card early-signals">
                <div class="card-head">
                  <h3 class="feed-heading">Lumen early signals</h3>
                  <span class="pill roomy state-chip" data-tone="warn">Organizing</span>
                </div>
                <p class="hint">Interpretation stays provisional until evidence collection ends.</p>
                <div class="signal-lead" hidden></div>
                <ul class="signal-list"></ul>
              </section>
              <section class="panel-card run-mix">
                <div class="card-head">
                  <h3 class="feed-heading">Findings so far</h3>
                  <span class="mix-total"></span>
                </div>
                <p class="hint">Provisional counts from completed requests only.</p>
                <ul class="mix-rows"></ul>
              </section>
            </div>
          </div>

          <p class="run-config"><span class="run-config-facts"></span><button type="button" class="link-btn run-config-btn">Adjust queued work</button></p>
          </div>
        </div>
        <div class="view view-results">
          <aside class="sidenav">
            <div class="nav-site"><b class="tb-project">&ndash;</b><span class="tb-scale">&ndash;</span></div>
            ${siteAuditNavMarkup()}
            <div class="nav-foot">
              <!-- Two deliverables, one file. The choice is here rather than in
                   a dialog because it is a two-checkbox decision, and a modal
                   for two checkboxes is a modal for nothing. -->
              <div class="download">
                <button type="button" class="btn primary report-btn" aria-expanded="false" aria-haspopup="true">Download</button>
                <div class="download-menu" hidden>
                  <p class="download-head">What should the file contain?</p>
                  <label class="download-opt"><input type="checkbox" class="dl-plan" checked><span><b>Action plan</b><em>Every change to make, sequenced, with what to edit and how to check it.</em></span></label>
                  <label class="download-opt"><input type="checkbox" class="dl-scan" checked><span><b>Scan results</b><em>The evidence behind it: findings, pages and links as recorded.</em></span></label>
                  <p class="download-what"></p>
                  <div class="download-actions">
                    <button type="button" class="btn primary dl-go">Download spreadsheet</button>
                    <button type="button" class="link-btn dl-html">Client report (HTML)</button>
                  </div>
                </div>
              </div>
              <button type="button" class="btn new-audit-btn">New audit</button>
              <span class="tb-date" hidden></span>
            </div>
          </aside>
          <div class="main">
          <!-- Each panel carries its own crumb and title, so the shared header
               that used to sit here said the same thing a second time. The
               provenance line stays, hidden, because loadAndPaintResults still
               writes the "could not be read" notice into it. -->
          <p class="results-summary sr-only"></p>
          <div class="scope-banner" role="status" hidden><p class="scope-text"></p></div>
          <div class="tab-panel overview-panel">
          <div class="page-head ov-head">
            <div class="ov-identity">
              <h2 class="ov-title">&ndash;</h2>
              <div class="chip-row ov-chips"></div>
            </div>
            <div class="run-actions">
              <button type="button" class="btn ov-settings-btn">Crawl settings</button>
              <button type="button" class="btn primary ov-continue-btn" hidden>Continue crawl</button>
            </div>
          </div>

          <!-- One strip, not four cards: these are four readings of the same
               run and belong on one instrument. -->
          <dl class="stat-grid summary-stats">
            <div class="stat-tile"><dt>Pages analysed</dt><dd class="sh-pages">0</dd><span class="stat-sub sh-pages-sub"></span><div class="tile-track"><span class="tile-fill"></span></div><button type="button" class="stat-open" data-open="crawled"><span class="sr-only">View the pages that were crawled</span></button></div>
            <div class="stat-tile"><dt>Findings</dt><dd class="sh-findings">0</dd><span class="stat-sub sh-findings-sub"></span><button type="button" class="stat-open" data-open="findings"><span class="sr-only">View all findings</span></button></div>
            <div class="stat-tile"><dt>Actionable</dt><dd class="sh-fix">0</dd><span class="stat-sub sh-fix-sub"></span><button type="button" class="stat-open" data-open="fix"><span class="sr-only">View the findings that need fixing</span></button></div>
            <div class="stat-tile"><dt>Never fetched</dt><dd class="sh-gaps">0</dd><span class="stat-sub sh-gaps-sub"></span><button type="button" class="stat-open" data-open="gaps"><span class="sr-only">View the pages the crawl never fetched</span></button></div>
          </dl>

          <!-- The brief. Composed deterministically from the findings, which is
               why the label says what it is grounded in. -->
          <section class="brief" hidden>
            <p class="brief-kicker">Lumen brief <span aria-hidden="true">·</span> <span class="brief-source">grounded in scan evidence</span><span class="work-dot" hidden aria-hidden="true"><i></i></span></p>
            <div class="brief-body">
              <div class="brief-lead">
                <h3>What needs attention</h3>
                <p class="brief-summary"></p>
                <p class="brief-scope"></p>
                <ol class="brief-list"></ol>
                <!-- The brief says what needs attention; the plan says what to do
                     about it. Overview routed to Findings, Pages, Links and Browser
                     checks and never to the surface the product exists for. -->
                <button type="button" class="btn primary brief-to-plan">Build the action plan</button>
              </div>
              <div class="brief-detail"></div>
            </div>
          </section>

          <section class="render-section" data-state="idle" hidden>
            <div class="render-head">
              <h3 class="render-title">Deeper checks in your browser</h3>
              <span class="pill render-state"></span>
            </div>
            <p class="render-status"></p>
            <div class="progress-bar render-progress-bar"><div class="progress-fill render-progress-fill"></div></div>
            <p class="render-error" style="display:none"></p>
            <div class="actions">
              <button type="button" class="btn primary render-start-btn">Render remaining pages</button>
              <button type="button" class="btn danger render-stop-btn" hidden>Stop rendering</button>
            </div>
          </section>

          <div class="ov-columns">
            <section class="panel-card conditions" hidden>
              <div class="card-head">
                <h3 class="feed-heading">Site systems</h3>
                <button type="button" class="link-btn conditions-all">View all conditions</button>
              </div>
              <p class="hint">Foundational conditions observed by the scanner. Each carries the evidence behind it.</p>
              <ul class="conditions-list"></ul>
              <p class="conditions-note">There is no score: a single number would hide the evidence a client is entitled to see.</p>
            </section>
            <section class="panel-card mix-card" hidden>
              <div class="card-head">
                <h3 class="feed-heading">Finding mix</h3>
                <button type="button" class="link-btn mix-open">Open findings</button>
              </div>
              <p class="hint mix-scope"></p>
              <div class="severity-bar" aria-hidden="true"></div>
              <ul class="severity-legend"></ul>
              <ul class="top-issues"></ul>
            </section>
          </div>

          <div class="section-grid crawl-shape"></div>

          <section class="deliver">
            <div class="deliver-main">
              <div class="deliver-copy">
                <h3>Share or continue the investigation</h3>
                <p class="hint">Export the evidence, or open a focused data view for deeper analysis.</p>
              </div>
              <div class="deliver-data">
                <button type="button" class="btn deliver-pages">Pages</button>
                <button type="button" class="btn deliver-links">Links</button>
                <button type="button" class="btn export-btn" data-dataset="findings">CSV</button>
                <button type="button" class="btn primary report-btn-2">Client report</button>
              </div>
            </div>
            <div class="deliver-data deliver-more">
              <span class="deliver-label">Raw data (CSV)</span>
              <button type="button" class="btn export-btn" data-dataset="urls-summary">Per-page summary</button>
              <button type="button" class="btn export-btn" data-dataset="urls">URLs</button>
              <button type="button" class="btn export-btn" data-dataset="links">Links</button>
              <button type="button" class="link-btn debug-btn" title="Raw audit data for troubleshooting an unexpected result">Debug report</button>
            </div>
          </section>
          </div>
          <div class="tab-panel findings-panel" hidden>
            <div class="page-head fx-head">
              <div>
                <h2 class="panel-title">Findings</h2>
                <p class="fx-meta"></p>
              </div>
              <div class="run-actions">
                <div class="columns-wrap">
                  <button type="button" class="btn columns-btn" aria-expanded="false">Columns</button>
                  <div class="columns-menu" hidden></div>
                </div>
                <button type="button" class="btn export-view-btn">Export view</button>
              </div>
            </div>

            <dl class="stat-grid summary-stats fx-stats">
              <div class="stat-tile"><dt>Observations</dt><dd class="fx-observations">0</dd><span class="stat-sub"></span></div>
              <div class="stat-tile"><dt>Issue patterns</dt><dd class="fx-patterns">0</dd><span class="stat-sub"></span></div>
              <div class="stat-tile"><dt>Need action</dt><dd class="fx-action">0</dd><span class="stat-sub">findings</span></div>
              <div class="stat-tile"><dt>Pages represented</dt><dd class="fx-pages">0</dd><span class="stat-sub fx-pages-sub"></span></div>
            </dl>

            <div class="toolbar">
              <input type="search" class="findings-search" placeholder="Search issue patterns, areas or evidence…" />
              <select class="findings-category" aria-label="Filter by severity"><option value="">All severities</option><option value="fix">Fix</option><option value="review">Review</option><option value="context">Context</option></select>
              <select class="findings-impact" aria-label="Filter by area"><option value="">All areas</option></select>
              <select class="findings-evidence" aria-label="Filter by evidence"><option value="">Any evidence</option><option value="confirmed">Confirmed</option><option value="corroborated">Corroborated</option><option value="inferred">Inferred</option><option value="inconclusive">Inconclusive</option></select>
              <select class="findings-sort" aria-label="Sort findings">
                <option value="severity">Sort: severity</option>
                <option value="pages">Sort: pages affected</option>
                <option value="instances">Sort: instances</option>
                <option value="area">Sort: area</option>
              </select>
            </div>

            <div class="fx-lenses">
              <nav class="lens-tabs" aria-label="Finding lenses">
                <button type="button" class="lens active" data-lens="priority">Lumen priority</button>
                <button type="button" class="lens" data-lens="all">All patterns</button>
                <button type="button" class="lens" data-lens="sitewide">Sitewide</button>
                <button type="button" class="lens" data-lens="unconfirmed">Needs confirmation</button>
              </nav>
              <span class="filter-state" role="status"></span>
            </div>

            <!-- The ordering is a lens over the scanner's own labels, and says
                 so rather than letting a rank be mistaken for a measurement. -->
            <section class="lens-note">
              <div class="lens-note-body">
                <b>Lumen priority is a lens, not a replacement for evidence</b>
                <span>Patterns are ordered by visitor impact, confidence and breadth. Severity and evidence labels stay exactly as the scanner recorded them.</span>
              </div>
              <span class="pill roomy state-chip lens-state">Priority order active</span>
            </section>

            <div class="fx-split">
              <section class="panel-card fx-list-card">
                <div class="card-head">
                  <h3 class="feed-heading">Issue patterns</h3>
                  <span class="hint fx-select-hint">Select a row to inspect</span>
                </div>
                <table class="data-table fx-table">
                  <thead><tr class="fx-head-row"></tr></thead>
                  <tbody class="fx-body"></tbody>
                </table>
                <div class="pager"><button type="button" class="btn pager-prev fx-prev">Prev</button><span class="pager-label fx-label"></span><button type="button" class="btn pager-next fx-next">Next</button></div>
              </section>
              <section class="panel-card fx-detail"></section>
            </div>

            <p class="fx-foot"><span class="fx-foot-text"></span><button type="button" class="link-btn fx-raw">Raw findings</button><button type="button" class="link-btn debug-btn-2">Debug report</button></p>
          </div>
          <div class="tab-panel urls-panel" hidden>
            <h2 class="panel-title">Pages</h2>
            <div class="toolbar">
              <input type="search" class="urls-search" placeholder="Filter by URL or title…" />
            </div>
            <div class="scoped-note" role="status" hidden><span class="scoped-text"></span><button type="button" class="link-btn scoped-clear">Show all pages</button></div>
            <nav class="section-index" aria-label="Site sections"></nav>
            <table class="data-table urls-table"><thead><tr><th data-sort="url">Page</th><th data-sort="status" class="col-status">Status</th><th data-sort="indexable" class="col-status">Indexable</th><th data-sort="title">Title</th><th data-sort="group">Group</th><th data-sort="word_count">Words</th><th data-sort="schema">Structured data</th></tr></thead><tbody class="urls-body"></tbody></table>
            <div class="pager"><button type="button" class="btn pager-prev urls-prev">Prev</button><span class="pager-label urls-label"></span><button type="button" class="btn pager-next urls-next">Next</button></div>
          </div>
          <div class="tab-panel links-panel" hidden>
            <h2 class="panel-title">Links</h2>
            <div class="toolbar">
              <input type="search" class="links-search" placeholder="Filter by source or target…" />
              <select class="links-status" hidden><option value="">All statuses</option><option value="broken">Broken</option><option value="blocked">Blocked</option><option value="inconclusive">Inconclusive</option><option value="healthy">Healthy</option></select>
            </div>
            <table class="data-table links-table"><thead><tr><th class="links-source-head">Source page</th><th>Links to</th><th>Anchor text</th><th class="col-status">Status</th></tr></thead><tbody class="links-body"></tbody></table>
            <div class="pager"><button type="button" class="btn pager-prev links-prev">Prev</button><span class="pager-label links-label"></span><button type="button" class="btn pager-next links-next">Next</button></div>
          </div>
          <div class="tab-panel optimize-panel" hidden>
            <div class="optimize-limits" hidden>
              <p class="optimize-limit-text"></p>
              <button type="button" class="btn optimize-complete">Complete evidence</button>
            </div>
            <div class="section-head">
              <h2>Optimize</h2>
              <p class="section-lede">The findings this audit recorded, clustered by what you would change to fix them and sequenced by what each group unblocks. Everything here is traceable back to the rules behind it.</p>
            </div>
            <div class="stat-grid optimize-stats"></div>
            <p class="optimize-focus" role="status" hidden></p>
            <section class="panel-card optimize-why"></section>
            <nav class="fx-tabs optimize-tabs" aria-label="Optimize views"></nav>
            <div class="optimize-body"></div>
          </div>
          <!-- Structured data. The section exists because the crawl now records
               the items themselves rather than a list of type names, so every
               number here is a count of something the audit is holding.

               The three lenses are deliberately separated and never mixed into
               one list: an error is a fault in an item we parsed, a conflict is
               two pages disagreeing about one entity, and an opportunity is an
               inference about markup we did not see. Only the first two are
               defects. Presenting the third beside them as "issues" is how a
               tool ends up telling a client their correct markup is broken. -->
          <div class="tab-panel schema-panel" hidden>
            <div class="section-head">
              <h2>Structured data</h2>
              <p class="section-lede">Every schema.org item the crawl parsed, what validation makes of it, and where the site disagrees with itself. Read from the served HTML, both JSON-LD and microdata, without running the page's JavaScript.</p>
            </div>
            <p class="schema-scope hint"></p>
            <div class="stat-grid schema-stats"></div>
            <section class="panel-card schema-conflicts" hidden>
              <div class="card-head"><h3 class="feed-heading">Entity conflicts</h3></div>
              <p class="hint">One entity, described more than one way. Confirmed: both descriptions were parsed from this site.</p>
              <ul class="schema-conflict-list"></ul>
            </section>
            <nav class="fx-tabs schema-tabs" aria-label="Structured data views"></nav>
            <div class="schema-body"></div>
          </div>
          <!-- One panel serves all ten discipline sections. Their shape is
               identical by design — heading, coverage statement, figures,
               distributions, then the findings scoped to that discipline — so
               an operator who has read one knows how to read the rest. -->
          <!-- The one section whose evidence has to be asked for. It carries a
               state rather than a count in the nav for the same reason. -->
          <div class="tab-panel browser-panel" hidden>
            <div class="section-head"><h2>Browser checks</h2><p class="section-lede">Accessibility, JavaScript behaviour and measured performance. This evidence exists only for pages opened in a real browser, which is a separate pass from the crawl and runs on this machine.</p></div>
            <div class="browser-host"></div>
            <div class="section-grid section-blocks browser-blocks"></div>
            <div class="section-findings">
              <h3 class="section-findings-title">Findings from the browser pass</h3>
              <p class="hint section-findings-note"></p>
              <ul class="findings-list browser-findings-list"></ul>
            </div>
          </div>
          <div class="tab-panel section-panel" hidden>
            <div class="section-head"><h2 class="section-title"></h2><p class="section-lede"></p></div>
            <div class="coverage-line" data-state="unknown"><span class="cl-mark" aria-hidden="true"></span><span class="cl-text"></span><button type="button" class="btn cl-action" hidden>Run browser checks</button></div>
            <dl class="section-stats"></dl>
            <div class="section-grid section-blocks"></div>
            <div class="section-findings">
              <h3 class="section-findings-title">Findings</h3>
              <p class="hint section-findings-note"></p>
              <ul class="findings-list section-findings-list"></ul>
            </div>
          </div>
        </div>
      </div>
      <p class="foot-note">Audit data is stored on the assistant gateway under this audit id. Reopen Site Audit on this site to reconnect.</p>
    </section>`;
    return { host, shadow };
  }

  function setSiteAuditView(view) {
    for (const el of siteAudit.shadow.querySelectorAll('.view')) el.classList.toggle('active', el.classList.contains(`view-${view}`));
    siteAudit.view = view;
  }

  function siteAuditRow(cells, { mono = [] } = {}) {
    const tr = document.createElement('tr');
    cells.forEach((text, i) => {
      const td = document.createElement('td');
      if (mono.includes(i)) td.className = 'mono';
      td.textContent = text == null ? '' : String(text);
      tr.appendChild(td);
    });
    return tr;
  }

  const SITE_AUDIT_PAGE_SIZE = 100;

  /** Same-site URLs read as paths — the origin repeats on every row and the
   * project host is already named once at the top of the report. External
   * URLs keep their host, because there the host is the information. */
  function shortUrl(url) {
    const origin = siteAudit?.siteOrigin || '';
    try {
      const u = new URL(url);
      if (origin && u.origin === origin) return (u.pathname + u.search) || '/';
      return u.host + (u.pathname === '/' ? '' : u.pathname);
    } catch { return url; }
  }

  async function openSiteAudit(startUrl) {
    const { host, shadow } = createSiteAuditRoot();
    let origin = startUrl;
    try { origin = new URL(startUrl).origin; } catch {}
    siteAudit = {
      host, shadow, auditId: null, pollTimer: null, startedAt: 0, view: 'setup', tab: 'overview', siteOrigin: origin, renderRunning: false,
      urlsOffset: 0, urlsSearch: '', urlsSort: { key: 'url', dir: 'asc' }, totalUrls: 0, expandedUrl: null,
      urlsStatus: '', urlsDepth: null, urlsHttpClass: '', urlsIndexable: '', urlCounts: {}, distributions: null, audit: null,
      linksOffset: 0, linksSearch: '', linksStatus: '', totalLinksByStatus: {}, urlsSection: '',
      findingsSearch: '', findingsCategory: '', findingsHideUnconfirmed: false, findingsImpactClass: '', expandedFindingKey: null, tabDefault: 'overview', findingsSort: 'severity'
    };
    shadow.querySelector('.start-url').value = `${origin}/`;
    paintTitleBlock(null);
    shadow.querySelector('.close').addEventListener('click', closeSiteAudit);
    shadow.querySelector('.start-btn').addEventListener('click', startSiteAudit);
    shadow.querySelector('.cancel-btn').addEventListener('click', cancelSiteAudit);
    shadow.querySelector('.pause-btn').addEventListener('click', togglePause);
    shadow.querySelector('.run-config-btn').addEventListener('click', () => setSiteAuditView('setup'));
    shadow.querySelector('.view-partial-btn').addEventListener('click', () => showSiteAuditResults());
    shadow.querySelector('.new-audit-btn').addEventListener('click', () => {
      stopPolling();
      // Filter state belonged to the finished audit; carrying it into the next
      // one silently hides findings the operator never chose to hide.
      siteAudit.findingsSearch = '';
      siteAudit.findingsCategory = '';
      siteAudit.findingsImpactClass = '';
      siteAudit.findingsHideUnconfirmed = false;
      siteAudit.linksStatus = '';
      siteAudit.urlsSearch = '';
      siteAudit.linksSearch = '';
      siteAudit.expandedFindingKey = null;
      siteAudit.expandedUrl = null;
      siteAudit.schema = null;
      siteAudit.schemaLens = 'validation';
      siteAudit.plan = null;
      siteAudit.planPhrasing = null;
      siteAudit.planBuilding = false;
      siteAudit.optimizeLens = 'priorities';
      setSiteAuditView('setup');
    });
    // Every summary tile opens the rows behind its number. A count with no way
    // through to its evidence is the thing this product exists not to ship.
    for (const btn of shadow.querySelectorAll('.stat-open')) {
      btn.addEventListener('click', () => openSummaryTile(btn.dataset.open));
    }
    shadow.querySelector('.scoped-clear').addEventListener('click', () => {
      siteAudit.urlsStatus = '';
      siteAudit.urlsDepth = null;
      siteAudit.urlsHttpClass = '';
      siteAudit.urlsIndexable = '';
      siteAudit.urlsOffset = 0;
      loadSiteAuditUrls();
    });
    shadow.querySelector('.render-start-btn').addEventListener('click', startRenderPass);
    shadow.querySelector('.render-stop-btn').addEventListener('click', stopRenderPass);
    wireDownloadMenu();
    shadow.querySelector('.report-btn-2')?.addEventListener('click', downloadFullReport);
    shadow.querySelector('.ov-settings-btn')?.addEventListener('click', () => setSiteAuditView('setup'));
    shadow.querySelector('.deliver-pages')?.addEventListener('click', () => switchSiteAuditTab('urls'));
    shadow.querySelector('.deliver-links')?.addEventListener('click', () => switchSiteAuditTab('links'));
    shadow.querySelector('.conditions-all')?.addEventListener('click', () => switchSiteAuditTab('browser'));
    shadow.querySelector('.mix-open')?.addEventListener('click', () => switchSiteAuditTab('findings'));
    shadow.querySelector('.brief-to-plan')?.addEventListener('click', () => switchSiteAuditTab('optimize'));
    shadow.querySelector('.debug-btn').addEventListener('click', downloadDebugReport);
    // Both quick filters now write their value into the visible control they
    // drive, so the operator can see (and undo) what was applied on their behalf.
    for (const tab of shadow.querySelectorAll('.tab')) tab.addEventListener('click', () => switchSiteAuditTab(tab.dataset.tab));
    for (const item of shadow.querySelectorAll('.subnav-item')) {
      item.addEventListener('click', () => switchSiteAuditTab(item.dataset.tab, item.dataset.view));
    }
    for (const btn of shadow.querySelectorAll('.export-btn')) btn.addEventListener('click', () => exportSiteAudit(btn.dataset.dataset));
    const onFindingsSearch = debounce((value) => { siteAudit.findingsSearch = value; siteAudit.fxOffset = 0; renderFindingsList(); }, 150);
    shadow.querySelector('.findings-search').addEventListener('input', (e) => onFindingsSearch(e.target.value));
    shadow.querySelector('.findings-category').addEventListener('change', (e) => { siteAudit.findingsCategory = e.target.value; siteAudit.fxOffset = 0; renderFindingsList(); });
    shadow.querySelector('.findings-impact').addEventListener('change', (e) => { siteAudit.findingsImpactClass = e.target.value; siteAudit.fxOffset = 0; renderFindingsList(); });
    shadow.querySelector('.findings-evidence').addEventListener('change', (e) => { siteAudit.findingsEvidence = e.target.value; siteAudit.fxOffset = 0; renderFindingsList(); });
    for (const lens of shadow.querySelectorAll('.lens')) {
      lens.addEventListener('click', () => { siteAudit.fxLens = lens.dataset.lens; siteAudit.fxOffset = 0; renderFindingsList(); });
    }
    shadow.querySelector('.fx-prev').addEventListener('click', () => { siteAudit.fxOffset = Math.max(0, (siteAudit.fxOffset || 0) - SITE_AUDIT_FX_PAGE); renderFindingsList(); });
    shadow.querySelector('.fx-next').addEventListener('click', () => { siteAudit.fxOffset = (siteAudit.fxOffset || 0) + SITE_AUDIT_FX_PAGE; renderFindingsList(); });
    shadow.querySelector('.export-view-btn').addEventListener('click', exportCurrentView);
    shadow.querySelector('.fx-raw').addEventListener('click', () => exportSiteAudit('findings'));
    shadow.querySelector('.debug-btn-2').addEventListener('click', downloadDebugReport);
    const columnsBtn = shadow.querySelector('.columns-btn');
    columnsBtn.addEventListener('click', () => {
      const menu = shadow.querySelector('.columns-menu');
      const open = menu.hidden;
      if (open) renderColumnsMenu();
      menu.hidden = !open;
      columnsBtn.setAttribute('aria-expanded', String(open));
    });    shadow.querySelector('.findings-sort').addEventListener('change', (e) => { siteAudit.findingsSort = e.target.value; siteAudit.fxOffset = 0; renderFindingsList(); });
    const onUrlsSearch = debounce((value) => { siteAudit.urlsSearch = value; renderUrlsTable(); }, 150);
    shadow.querySelector('.urls-search').addEventListener('input', (e) => onUrlsSearch(e.target.value));
    for (const th of shadow.querySelectorAll('.urls-panel th[data-sort]')) th.addEventListener('click', () => sortUrlsBy(th.dataset.sort));
    shadow.querySelector('.urls-prev').addEventListener('click', () => { siteAudit.urlsOffset = Math.max(0, siteAudit.urlsOffset - SITE_AUDIT_PAGE_SIZE); loadSiteAuditUrls(); });
    shadow.querySelector('.urls-next').addEventListener('click', () => { siteAudit.urlsOffset += SITE_AUDIT_PAGE_SIZE; loadSiteAuditUrls(); });
    const onLinksSearch = debounce((value) => { siteAudit.linksSearch = value; renderLinksTable(); }, 150);
    shadow.querySelector('.links-search').addEventListener('input', (e) => onLinksSearch(e.target.value));
    shadow.querySelector('.links-status').addEventListener('change', (e) => { siteAudit.linksStatus = e.target.value; siteAudit.linksOffset = 0; loadSiteAuditLinks(); });
    shadow.querySelector('.links-prev').addEventListener('click', () => { siteAudit.linksOffset = Math.max(0, siteAudit.linksOffset - SITE_AUDIT_PAGE_SIZE); loadSiteAuditLinks(); });
    shadow.querySelector('.links-next').addEventListener('click', () => { siteAudit.linksOffset += SITE_AUDIT_PAGE_SIZE; loadSiteAuditLinks(); });
    document.addEventListener('keydown', siteAuditEscHandler);
    await tryResumeSiteAudit(origin);
  }

  function debounce(fn, ms) {
    let timer;
    return (...args) => { clearTimeout(timer); timer = setTimeout(() => fn(...args), ms); };
  }

  // Closing the overlay used to be a dead end — reopening always landed back
  // on a blank setup form even though the audit was still running (or just
  // finished) on the server. But jumping straight into that old audit's
  // results automatically (what an earlier version of this did) is its own
  // bug: it looks exactly like a brand-new "Scan Site" click somehow
  // finishing instantly, which is confusing and looks like a broken scanner.
  // Opening Site Audit must never start or display work on its own — this
  // only ever offers a resume banner; the click is what actually acts on it.
  async function tryResumeSiteAudit(origin) {
    const r = await chrome.runtime.sendMessage({ type: 'SITE_AUDIT_LIST', site: origin }).catch(() => null);
    const audits = r?.audits || [];
    if (!siteAudit) return;
    // One request, both components. They used to be fetched separately and say
    // the same thing twice: the banner announced the last audit and the first
    // row of the list repeated it.
    renderSiteAuditHistory(audits, r?.retention || '');
    const mostRecent = audits[0];
    if (!mostRecent) return;
    const banner = siteAudit.shadow.querySelector('.resume-banner');
    const when = new Date(mostRecent.createdAt).toLocaleString();
    banner.querySelector('.resume-text').textContent = mostRecent.status === 'running'
      ? `An audit of this site is still running (started ${when}).`
      : `Last audit of this site: ${when} · ${mostRecent.status}, ${mostRecent.findingsCount} findings.`;
    banner.hidden = false;
    banner.querySelector('.resume-btn').onclick = () => {
      if (!siteAudit) return;
      siteAudit.auditId = mostRecent.id;
      if (mostRecent.status === 'running') {
        siteAudit.startedAt = Date.parse(mostRecent.startedAt || mostRecent.createdAt) || Date.now();
        setSiteAuditView('progress');
        beginPolling();
      } else {
        showSiteAuditResults();
      }
    };
  }
  function siteAuditEscHandler(event) {
    if (event.key === 'Escape' && siteAudit) closeSiteAudit();
  }
  function closeSiteAudit() {
    stopPolling();
    document.removeEventListener('keydown', siteAuditEscHandler);
    siteAudit?.host?.remove();
    siteAudit = null;
    releaseLumenFontFaces();
    releaseAuditedPageScroll();
  }
  function stopPolling() {
    if (siteAudit?.pollTimer) { clearInterval(siteAudit.pollTimer); siteAudit.pollTimer = null; }
  }

  /** "3 hours ago" rather than a locale timestamp. The question this screen
   * answers is whether the last audit is recent enough to open instead of
   * re-running, and a formatted date makes the reader do that subtraction. */
  function relativeWhen(iso) {
    const then = Date.parse(iso || '');
    if (!Number.isFinite(then)) return 'unknown time';
    const mins = Math.round((Date.now() - then) / 60000);
    if (mins < 1) return 'just now';
    if (mins < 60) return `${mins} minute${mins === 1 ? '' : 's'} ago`;
    const hours = Math.round(mins / 60);
    if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`;
    const days = Math.round(hours / 24);
    return `${days} day${days === 1 ? '' : 's'} ago`;
  }

  /**
   * The earlier-audits list.
   *
   * Shown with the screen rather than behind a "Past audits" button, because
   * the decision it supports — open the recent one or run a new one — is the
   * decision this screen exists for, and a control nobody clicks is a control
   * nobody reads.
   *
   * Each row carries the change against the audit before it. A finding count on
   * its own is what a crawler reports; the delta is the only thing here that
   * says whether the site is getting better, which is what a second audit was
   * run to find out. It is stated as a plain count difference, never as a rate
   * or a score, because two crawls of different scope are not comparable beyond
   * the direction of travel.
   */
  function renderSiteAuditHistory(audits, retentionNote) {
    const section = siteAudit.shadow.querySelector('.history');
    const list = section.querySelector('.history-list');
    list.innerHTML = '';
    const rows = (audits || []).slice(0, 5);
    if (!rows.length) { section.hidden = true; return; }
    section.hidden = false;
    section.querySelector('.history-policy').textContent = retentionNote || '';

    rows.forEach((audit, i) => {
      const li = document.createElement('li');
      const label = document.createElement('span');
      const when = document.createElement('span');
      when.className = 'history-when';
      when.textContent = relativeWhen(audit.createdAt);
      label.appendChild(when);

      const running = audit.status === 'running' || audit.status === 'queued';
      const meta = document.createElement('span');
      meta.className = running ? 'history-running' : 'history-meta';
      meta.textContent = running
        ? '  still running'
        : `  ${audit.findingsCount} finding${audit.findingsCount === 1 ? '' : 's'}${audit.status === 'complete' ? '' : ` · ${audit.status}`}`;
      label.appendChild(meta);

      // Compared against the next row down, which is the audit before this one.
      const previous = rows[i + 1];
      if (!running && previous && previous.status === 'complete' && audit.status === 'complete') {
        const diff = Number(audit.findingsCount) - Number(previous.findingsCount);
        const delta = document.createElement('span');
        delta.className = 'history-delta';
        delta.dataset.dir = diff === 0 ? 'same' : diff < 0 ? 'down' : 'up';
        delta.textContent = diff === 0
          ? '  no change'
          : `  ${Math.abs(diff)} ${diff < 0 ? 'fewer' : 'more'} than the audit before`;
        label.appendChild(delta);
      }

      const btn = document.createElement('button');
      btn.type = 'button';
      btn.textContent = running ? 'Resume' : 'Open';
      btn.addEventListener('click', () => {
        siteAudit.auditId = audit.id;
        if (running) {
          siteAudit.startedAt = Date.parse(audit.startedAt || audit.createdAt) || Date.now();
          setSiteAuditView('progress');
          beginPolling();
        } else {
          showSiteAuditResults();
        }
      });
      li.append(label, btn);
      list.appendChild(li);
    });
  }

  async function startSiteAudit() {
    const shadow = siteAudit.shadow;
    const errorEl = shadow.querySelector('.setup-error');
    errorEl.style.display = 'none';
    const startBtn = shadow.querySelector('.start-btn');
    startBtn.disabled = true;
    try {
      const parsePatterns = (selector) => shadow.querySelector(selector).value.split('\n').map((s) => s.trim()).filter(Boolean);
      const maxDepthRaw = shadow.querySelector('.max-depth').value.trim();
      const payload = {
        startUrl: shadow.querySelector('.start-url').value.trim(),
        maxPages: Number(shadow.querySelector('.max-pages').value) || 40,
        concurrency: Number(shadow.querySelector('.concurrency').value) || 3,
        includeSubdomains: shadow.querySelector('.include-subdomains').checked,
        respectRobots: shadow.querySelector('.respect-robots').checked,
        maxDepth: maxDepthRaw === '' ? null : Number(maxDepthRaw),
        requestDelayMs: Number(shadow.querySelector('.request-delay').value) || 0,
        includePatterns: parsePatterns('.include-patterns'),
        excludePatterns: parsePatterns('.exclude-patterns'),
        checkExternalLinks: shadow.querySelector('.check-external-links').checked,
        respectNofollow: shadow.querySelector('.respect-nofollow').checked
      };
      const r = await chrome.runtime.sendMessage({ type: 'SITE_AUDIT_START', ...payload });
      if (!r?.ok) throw new Error(r?.error || 'Could not start the audit.');
      siteAudit.auditId = r.auditId;
      siteAudit.startedAt = Date.now();
      setSiteAuditView('progress');
      beginPolling();
    } catch (error) {
      errorEl.textContent = String(error?.message || error || 'Could not start the audit.');
      errorEl.style.display = 'block';
    } finally {
      startBtn.disabled = false;
    }
  }

  async function cancelSiteAudit() {
    if (!siteAudit?.auditId) return;
    await chrome.runtime.sendMessage({ type: 'SITE_AUDIT_CANCEL', auditId: siteAudit.auditId }).catch(() => {});
  }

  /** How often the results view repaints while a crawl runs. It is the only
   * cadence that view has — nothing repaints on its own faster beat, because
   * two cadences means two numbers for the same fact. Fast enough that nothing
   * on screen is visibly stale, slow enough not to hammer the gateway for the
   * length of a crawl. */
  const SITE_AUDIT_RESULTS_REFRESH_MS = 3000;

  function beginPolling() {
    stopPolling();
    pollSiteAuditOnce();
    siteAudit.pollTimer = setInterval(pollSiteAuditOnce, 2000);
  }

  async function pollSiteAuditOnce() {
    if (!siteAudit?.auditId) return;
    const r = await chrome.runtime.sendMessage({ type: 'SITE_AUDIT_STATUS', auditId: siteAudit.auditId }).catch(() => null);
    const audit = r?.audit;
    if (!audit || !siteAudit) return;
    if (siteAudit.view === 'progress') {
      renderSiteAuditProgress(audit);
      // Early signals and the severity mix read the finding groups, so the
      // progress screen keeps them fresh on the same slower beat the results
      // view uses rather than refetching every two seconds.
      const now = Date.now();
      if (now - (siteAudit.lastGroupsRead || 0) >= SITE_AUDIT_RESULTS_REFRESH_MS) {
        siteAudit.lastGroupsRead = now;
        chrome.runtime.sendMessage({ type: 'SITE_AUDIT_FINDINGS', auditId: siteAudit.auditId, groupByRule: true })
          .then((r) => { if (siteAudit && r?.groups) { siteAudit.rawFindingGroups = r.groups; renderEarlySignals(audit); renderRunMix(audit); } })
          .catch(() => {});
      }
    }
    const finished = ['complete', 'cancelled', 'failed'].includes(audit.status);
    if (siteAudit.view === 'results') {
      // ONE cadence for the whole view. Repainting the banner every 2s while
      // the tiles waited for a slower beat was the same bug in smaller form:
      // the banner said 39 fetched above tiles that said 32, because the two
      // came from different reads. Every number on this screen now comes from
      // a single read of the audit, or from none.
      const now = Date.now();
      const due = now - (siteAudit.lastResultsPaint || 0) >= SITE_AUDIT_RESULTS_REFRESH_MS;
      // A finished crawl gets one last unconditional repaint: polling stops on
      // the same tick, so without this the final figures never land and the
      // header sits on "Still running" over a completed audit.
      if (due || finished) {
        siteAudit.lastResultsPaint = now;
        loadAndPaintResults();
      }
    }
    if (finished && siteAudit.view === 'progress') {
      stopPolling();
      showSiteAuditResults();
      return;
    }
    // Once the crawl itself is done, polling only needs to continue while the
    // (separate, optional) render pass is actively running in this browser.
    if (audit.status !== 'running' && !siteAudit.renderRunning) stopPolling();
  }

  const SITE_AUDIT_PHASE_COPY = {
    queued: 'Queued, waiting to start.',
    discovering: 'Finding pages from the sitemap and homepage links…',
    crawling: 'Fetching and checking each page…',
    analyzing: 'Comparing pages against each other to finish the audit…',
    complete: 'Finished.'
  };
  const SITE_AUDIT_STATUS_COPY = {
    complete: 'Audit finished.',
    cancelled: 'Audit cancelled. The results below cover what was crawled first.',
    failed: 'Audit failed before it could finish.'
  };

  // The title block is the sheet's provenance: which project, at what scale,
  // on what date. It carries the facts a client asks about first.
  /** How long ago, in the coarsest unit that is still true. */
  function relativeTime(iso) {
    const then = Date.parse(iso || '');
    if (!Number.isFinite(then)) return '';
    const seconds = Math.max(0, Math.round((Date.now() - then) / 1000));
    if (seconds < 60) return 'just now';
    const minutes = Math.round(seconds / 60);
    if (minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'} ago`;
    const hours = Math.round(minutes / 60);
    if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`;
    const days = Math.round(hours / 24);
    return `${days} day${days === 1 ? '' : 's'} ago`;
  }

  /** Where this audit started and when it ran — the two facts about the run
   * itself that no tile, nav row or chart on this screen carries. */
  function auditProvenanceLine(audit) {
    const start = audit?.config?.startUrl || audit?.startUrl || siteAudit.siteOrigin || '';
    const from = start ? `Crawled from ${start}` : 'Crawled from this site';
    if (audit?.status === 'running') {
      const since = relativeTime(audit.startedAt);
      return `${from} · running${since && since !== 'just now' ? `, started ${since}` : ' now'}`;
    }
    const when = relativeTime(audit?.completedAt || audit?.startedAt);
    const state = audit?.status === 'complete' ? 'finished' : String(audit?.status || 'finished');
    return `${from} · ${state}${when ? ` ${when}` : ''}`;
  }

  function paintTitleBlock(audit) {
    const shadow = siteAudit.shadow;
    let project = '';
    try { project = new URL(audit?.config?.startUrl || siteAudit.siteOrigin || location.href).hostname; } catch { project = ''; }
    const counts = audit?.urlCounts || {};
    const fetched = Number(counts.fetched || 0);
    const discovered = Object.values(counts).reduce((s, n) => s + Number(n || 0), 0);
    const date = new Date(siteAudit.startedAt || Date.now());
    for (const el of shadow.querySelectorAll('.tb-project')) el.textContent = project || '–';
    for (const el of shadow.querySelectorAll('.tb-date')) el.textContent = date.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
    const pageWord = (n) => `${n} ${n === 1 ? 'page' : 'pages'}`;
    for (const el of shadow.querySelectorAll('.tb-scale')) {
      el.textContent = discovered ? `${fetched} of ${pageWord(discovered)} surveyed` : (fetched ? `${pageWord(fetched)} surveyed` : String.fromCharCode(8212));
    }
  }

  /**
   * The four phases an audit moves through, in order.
   *
   * A single progress bar cannot distinguish "crawling slowly" from "finished
   * crawling, waiting for a browser pass nobody started". The stepper exists
   * so a run that looks stalled can be read for which phase it is actually in.
   */
  const SITE_AUDIT_PHASES = [
    { id: 'discover', name: 'Discover', matches: ['queued', 'discovering'] },
    { id: 'crawl', name: 'Crawl pages', matches: ['crawling', 'paused'] },
    { id: 'render', name: 'Browser checks', matches: [] },
    { id: 'analyze', name: 'Lumen analysis', matches: ['analyzing', 'complete', 'cancelled', 'failed'] }
  ];

  function phaseIndexFor(audit) {
    const phase = String(audit?.phase || 'queued');
    const rp = audit?.renderProgress || {};
    if (phase === 'analyzing' || phase === 'complete') {
      // The render pass sits between the crawl and the reading, and it is
      // optional — a finished crawl with nothing rendered is waiting at
      // phase 3, not done with it.
      if (Number(rp.total || 0) > 0 && Number(rp.rendered || 0) < Number(rp.total || 0)) return 2;
      return 3;
    }
    const index = SITE_AUDIT_PHASES.findIndex((p) => p.matches.includes(phase));
    return index < 0 ? 0 : index;
  }

  /** Pages per second, smoothed over the recent poll history rather than the
   * last interval — a two-second window over a crawl that fetches in bursts
   * reports numbers that swing between zero and twenty. */
  function crawlRate(audit) {
    const fetched = Number(audit?.urlCounts?.fetched || 0);
    const now = Date.now();
    const history = siteAudit.rateHistory || (siteAudit.rateHistory = []);
    const last = history[history.length - 1];
    if (!last || last.fetched !== fetched) history.push({ at: now, fetched });
    while (history.length > 12) history.shift();
    if (history.length < 2) return null;
    const first = history[0];
    const seconds = (now - first.at) / 1000;
    const pages = fetched - first.fetched;
    if (seconds < 2 || pages <= 0) return null;
    return pages / seconds;
  }

  function humanDuration(seconds) {
    const s = Math.max(0, Math.round(seconds));
    if (s < 60) return `${s} second${s === 1 ? '' : 's'}`;
    const m = Math.round(s / 60);
    if (m < 60) return `${m} minute${m === 1 ? '' : 's'}`;
    const h = Math.floor(m / 60);
    return `${h}h ${m % 60}m`;
  }

  function elapsedLabel(audit) {
    const started = Date.parse(audit?.startedAt || '') || siteAudit.startedAt || Date.now();
    const s = Math.max(0, Math.round((Date.now() - started) / 1000));
    if (s < 60) return `Elapsed ${s}s`;
    return `Elapsed ${Math.floor(s / 60)}m ${String(s % 60).padStart(2, '0')}s`;
  }

  function renderStepper(audit) {
    const list = siteAudit.shadow.querySelector('.stepper');
    if (!list) return;
    const counts = audit?.urlCounts || {};
    const discovered = Object.values(counts).reduce((s, n) => s + Number(n || 0), 0);
    const fetched = Number(counts.fetched || 0);
    const rp = audit?.renderProgress || {};
    const budget = Number(audit?.config?.maxPages || 0);
    const active = phaseIndexFor(audit);
    const finished = ['complete', 'cancelled', 'failed'].includes(String(audit?.status || ''));
    const notes = [
      discovered ? `${discovered} URL${discovered === 1 ? '' : 's'} found` : 'Reading robots.txt and sitemap',
      budget ? `${fetched} of ${budget}` : `${fetched} fetched`,
      Number(rp.total || 0) ? `${Number(rp.rendered || 0)} of ${rp.total} checked` : 'Waiting',
      finished ? 'Complete' : active >= 3 ? 'Reading the evidence' : 'Preparing'
    ];
    list.innerHTML = '';
    SITE_AUDIT_PHASES.forEach((phase, i) => {
      const li = document.createElement('li');
      li.className = 'step';
      li.dataset.state = i < active ? 'done' : i === active ? 'active' : 'waiting';
      const mark = document.createElement('span');
      mark.className = 'step-mark';
      mark.textContent = i < active ? '✓' : String(i + 1);
      const body = document.createElement('span');
      body.className = 'step-body';
      const name = document.createElement('span');
      name.className = 'step-name';
      name.textContent = phase.name;
      const note = document.createElement('span');
      note.className = 'step-note';
      note.textContent = notes[i];
      body.append(name, note);
      li.append(mark, body);
      if (i < SITE_AUDIT_PHASES.length - 1) {
        const rule = document.createElement('span');
        rule.className = 'step-rule';
        li.appendChild(rule);
      }
      list.appendChild(li);
    });
  }

  function renderPhaseCard(audit) {
    const shadow = siteAudit.shadow;
    const counts = audit?.urlCounts || {};
    const discovered = Object.values(counts).reduce((s, n) => s + Number(n || 0), 0);
    const fetched = Number(counts.fetched || 0);
    const budget = Number(audit?.config?.maxPages || 0);
    const active = phaseIndexFor(audit);
    const paused = Boolean(audit?.paused);
    const finished = ['complete', 'cancelled', 'failed'].includes(String(audit?.status || ''));

    shadow.querySelector('.phase-badge').textContent = `Phase ${active + 1} of ${SITE_AUDIT_PHASES.length}`;
    shadow.querySelector('.phase-name').textContent = paused ? 'Paused' : SITE_AUDIT_PHASES[active].name;
    const pct = budget ? Math.min(100, Math.round((fetched / budget) * 100)) : 0;
    shadow.querySelector('.phase-count').textContent = budget ? `${fetched} of ${budget} page budget · ${pct}%` : `${fetched} fetched`;
    shadow.querySelector('.progress-fill').style.transform = `scaleX(${Math.max(2, pct) / 100})`;

    const rate = paused || finished ? null : crawlRate(audit);
    const remaining = Math.max(0, budget - fetched);
    const metrics = [
      ['Discovered', `${discovered} URL${discovered === 1 ? '' : 's'}`],
      ['Budget remaining', `${remaining} page${remaining === 1 ? '' : 's'}`],
      // Rate and finish are measurements of this run, so they say so when they
      // have not got one yet rather than showing a confident zero.
      ['Current rate', paused ? 'Paused' : rate ? `${rate.toFixed(1)} pages/sec` : 'Measuring'],
      ['Estimated finish', paused ? 'Paused' : finished ? 'Finished' : rate && remaining ? `~${humanDuration(remaining / rate)}` : remaining ? 'Measuring' : 'Any moment']
    ];
    const dl = shadow.querySelector('.phase-metrics');
    dl.innerHTML = '';
    for (const [label, value] of metrics) {
      const pair = document.createElement('div');
      pair.className = 'metric-pair';
      const dt = document.createElement('dt');
      dt.textContent = label;
      const dd = document.createElement('dd');
      dd.textContent = value;
      pair.append(dt, dd);
      dl.appendChild(pair);
    }

    // The URL actually in flight: a row the crawl has claimed but not yet
    // recorded a result for.
    const inFlight = (audit?.inFlightUrls || [])[0];
    const nr = shadow.querySelector('.now-requesting');
    if (inFlight && !paused && !finished) {
      nr.hidden = false;
      nr.querySelector('.nr-url').textContent = inFlight;
      nr.querySelector('.nr-url').title = inFlight;
    } else {
      nr.hidden = true;
    }
  }

  /** The offer to widen a page-limited crawl. Only shown when there is a
   * frontier to widen it onto — an audit that reached the end of the site has
   * nothing to buy with a bigger budget. */
  function renderBudgetCallout(audit) {
    const shadow = siteAudit.shadow;
    const callout = shadow.querySelector('.budget-callout');
    if (!callout) return;
    const counts = audit?.urlCounts || {};
    const outside = Number(counts.queued || 0);
    const budget = Number(audit?.config?.maxPages || 0);
    const ceiling = Number(audit?.budgetCeiling || 300);
    if (!outside || !budget || budget >= ceiling) { callout.hidden = true; return; }
    const target = Math.min(ceiling, Math.max(budget + 20, Math.min(budget + outside, budget * 2, ceiling)));
    if (target <= budget) { callout.hidden = true; return; }
    callout.hidden = false;
    // Numbers only — nothing crawl-sourced reaches this markup.
    callout.querySelector('.budget-text').innerHTML =
      `<b>${outside}</b> discovered URL${outside === 1 ? '' : 's'} fall outside this <b>${budget}</b>-page audit. Raise the budget now without restarting completed work.`;
    const btn = callout.querySelector('.budget-btn');
    btn.textContent = `Increase to ${target} pages`;
    btn.onclick = () => raiseBudget(target);
  }

  async function raiseBudget(maxPages) {
    const shadow = siteAudit.shadow;
    const btn = shadow.querySelector('.budget-btn');
    const error = shadow.querySelector('.budget-error');
    btn.disabled = true;
    error.hidden = true;
    try {
      const r = await chrome.runtime.sendMessage({ type: 'SITE_AUDIT_BUDGET', auditId: siteAudit.auditId, maxPages }).catch((e) => ({ ok: false, error: e?.message }));
      if (!r?.ok) throw new Error(r?.error || 'Could not raise the page budget.');
      // A finished crawl that just got a bigger budget is running again.
      beginPolling();
    } catch (e) {
      error.hidden = false;
      error.textContent = String(e?.message || e);
    } finally {
      btn.disabled = false;
    }
  }

  async function togglePause() {
    const shadow = siteAudit.shadow;
    const btn = shadow.querySelector('.pause-btn');
    const next = !siteAudit.paused;
    btn.disabled = true;
    try {
      const r = await chrome.runtime.sendMessage({ type: 'SITE_AUDIT_PAUSE', auditId: siteAudit.auditId, paused: next }).catch((e) => ({ ok: false, error: e?.message }));
      if (r?.ok) siteAudit.paused = Boolean(r.paused);
    } finally {
      btn.disabled = false;
    }
  }

  /** Relative age in the coarsest unit still true, for a feed that updates
   * every two seconds. */
  function feedAge(iso) {
    const then = Date.parse(iso || '');
    if (!Number.isFinite(then)) return '';
    const s = Math.max(0, Math.round((Date.now() - then) / 1000));
    if (s < 3) return 'just now';
    if (s < 60) return `${s}s`;
    if (s < 3600) return `${Math.floor(s / 60)}m`;
    return `${Math.floor(s / 3600)}h`;
  }

  /**
   * The live activity feed.
   *
   * Every row is a fact the store already holds about a specific row: what was
   * fetched, what it answered, whether it is indexable, what could not be
   * reached. Discoveries and confirmed broken destinations come from counter
   * deltas between polls. Nothing here is invented to fill the feed — a quiet
   * crawl shows a quiet feed.
   */
  function renderRecentActivity(audit) {
    const list = siteAudit.shadow.querySelector('.recent-feed');
    if (!list) return;
    const rows = [];
    const counts = audit?.urlCounts || {};
    const links = audit?.linkCounts || {};
    const prev = siteAudit.lastCounts || {};
    const queued = Number(counts.queued || 0);
    const broken = Number(links.broken || 0);
    // Counter deltas are events with no row of their own, so they are
    // remembered across polls — with the time they happened, because a row
    // kept saying "just now" thirty seconds after the fact.
    const remembered = [];
    if (prev.queued !== undefined && queued > prev.queued) {
      remembered.push({ kind: 'found', mark: '+', at: Date.now(), title: `Discovered ${queued - prev.queued} new URL${queued - prev.queued === 1 ? '' : 's'}`, note: 'Added to the queue; duplicates removed automatically' });
    }
    if (prev.broken !== undefined && broken > prev.broken) {
      remembered.push({ kind: 'bad', mark: '!', at: Date.now(), title: `Confirmed ${broken - prev.broken} broken destination${broken - prev.broken === 1 ? '' : 's'}`, note: 'Independent destination request · evidence retained' });
    }
    siteAudit.lastCounts = { queued, broken };
    siteAudit.feedMemory = [...remembered, ...(siteAudit.feedMemory || [])].slice(0, 4);
    for (const row of siteAudit.feedMemory) {
      rows.push({ ...row, age: feedAge(new Date(row.at).toISOString()) });
    }
    for (const u of (audit?.recentUrls || [])) {
      if (u.status === 'fetching') continue;
      const code = Number(u.http_status || 0);
      const notes = [];
      if (code) notes.push(`${code} ${code < 300 ? 'OK' : code < 400 ? 'redirect' : code < 500 ? 'not found' : 'server error'}`);
      if (u.status === 'fetched') {
        notes.push(u.indexable === 1 ? 'indexable' : u.indexable === 0 ? 'noindex' : 'indexability not read');
        if (u.canonical) notes.push('canonical resolved');
      }
      if (u.error) notes.push(String(u.error).slice(0, 60));
      rows.push({
        kind: u.status === 'error' ? 'bad' : u.status === 'skipped' ? 'skip' : 'ok',
        mark: u.status === 'error' ? '!' : u.status === 'skipped' ? '–' : '✓',
        title: u.status === 'error' ? 'Could not fetch' : u.status === 'skipped' ? 'Skipped by robots.txt' : 'Fetched',
        url: shortUrl(u.url),
        fullUrl: u.url,
        note: notes.join(' · '),
        age: feedAge(u.fetched_at)
      });
    }

    list.innerHTML = '';
    if (!rows.length) {
      const li = document.createElement('li');
      li.className = 'empty-row';
      li.textContent = 'Nothing has completed yet.';
      list.appendChild(li);
      return;
    }
    for (const row of rows.slice(0, 9)) {
      const li = document.createElement('li');
      const mark = document.createElement('span');
      mark.className = 'feed-mark';
      mark.dataset.kind = row.kind;
      mark.setAttribute('aria-hidden', 'true');
      mark.textContent = row.mark;
      const body = document.createElement('span');
      body.className = 'feed-body';
      const title = document.createElement('span');
      title.className = 'feed-title';
      title.textContent = row.title;
      if (row.url) {
        const code = document.createElement('code');
        code.textContent = ` ${row.url}`;
        code.title = row.fullUrl || '';
        title.appendChild(code);
      }
      const note = document.createElement('span');
      note.className = 'feed-note';
      note.textContent = row.note || '';
      body.append(title, note);
      const age = document.createElement('span');
      age.className = 'feed-age';
      age.textContent = row.age || '';
      li.append(mark, body, age);
      list.appendChild(li);
    }
  }

  /**
   * Early signals: what the evidence already looks like it is saying, labelled
   * as provisional because collection has not finished.
   *
   * This is a deterministic reading of the groups already loaded, never a
   * model's. A rule that has appeared on nearly every page crawled so far is
   * evidence of one shared cause rather than N independent defects — that is
   * an observation about repetition, and it is stated as one.
   */
  function renderEarlySignals(audit) {
    const shadow = siteAudit.shadow;
    const lead = shadow.querySelector('.signal-lead');
    const list = shadow.querySelector('.signal-list');
    if (!lead || !list) return;
    const groups = siteAudit.rawFindingGroups || [];
    const fetched = Number(audit?.urlCounts?.fetched || 0);
    // Severity first, then breadth — the same ranking every other surface uses.
    // Sorting by breadth alone put "Analytics/tracking tag detected", an
    // info-level observation, at the head of a list meant to surface what
    // matters, which is the volume-wins failure the product exists to avoid.
    const rank = { critical: 0, high: 1, medium: 2, low: 3, info: 4 };
    const ranked = [...groups]
      .filter((g) => g.confidence !== 'inconclusive' && g.category !== 'context')
      .sort((a, b) =>
        (rank[a.severity] ?? 9) - (rank[b.severity] ?? 9) ||
        (b.affected_urls || 0) - (a.affected_urls || 0));

    const sitewide = ranked.find((g) => fetched >= 3 && Number(g.affected_urls || 0) >= Math.ceil(fetched * 0.75));
    lead.hidden = !sitewide;
    if (sitewide) {
      lead.innerHTML = '';
      const b = document.createElement('b');
      b.textContent = 'A shared cause is emerging';
      const span = document.createElement('span');
      span.textContent = `${findingLabel(sitewide)} appears on ${sitewide.affected_urls} of the ${fetched} pages fetched so far. Repetition at that rate usually means one shared component rather than ${sitewide.affected_urls} separate defects. Final priority waits for the full crawl.`;
      lead.append(b, span);
    }

    list.innerHTML = '';
    const shown = ranked.slice(0, 4);
    if (!shown.length) {
      const li = document.createElement('li');
      li.className = 'empty-row';
      li.textContent = fetched ? 'Nothing established yet.' : 'Waiting for the first page.';
      list.appendChild(li);
      return;
    }
    for (const g of shown) {
      const li = document.createElement('li');
      const name = document.createElement('span');
      name.className = 'signal-name';
      name.textContent = findingLabel(g);
      const badge = document.createElement('span');
      badge.className = 'pill signal-badge';
      const confirmed = g.confidence === 'confirmed' || g.confidence === 'corroborated';
      badge.dataset.tone = confirmed ? 'ok' : 'warn';
      badge.textContent = confirmed ? 'Confirmed' : 'Early signal';
      const note = document.createElement('span');
      note.className = 'signal-note';
      const wide = fetched >= 3 && Number(g.affected_urls || 0) >= Math.ceil(fetched * 0.75);
      note.textContent = `${g.affected_urls} of ${fetched} page${fetched === 1 ? '' : 's'}${wide ? ' · likely shared component' : ''}`;
      li.append(name, badge, note);
      list.appendChild(li);
    }
  }

  /** The severity split of what has landed so far. */
  function renderRunMix(audit) {
    const shadow = siteAudit.shadow;
    const list = shadow.querySelector('.mix-rows');
    if (!list) return;
    const groups = siteAudit.rawFindingGroups || [];
    const buckets = { high: 0, medium: 0, low: 0 };
    for (const g of groups) {
      const sev = String(g.severity || 'info');
      if (sev === 'critical' || sev === 'high') buckets.high += g.instances;
      else if (sev === 'medium') buckets.medium += g.instances;
      else buckets.low += g.instances;
    }
    const total = buckets.high + buckets.medium + buckets.low;
    shadow.querySelector('.mix-total').textContent = `${total} observation${total === 1 ? '' : 's'}`;
    const rows = [
      ['High', buckets.high, 'var(--sa-sev-high)'],
      ['Medium', buckets.medium, 'var(--sa-sev-medium)'],
      ['Low / info', buckets.low, 'var(--sa-sev-info)']
    ];
    const max = Math.max(1, ...rows.map((r) => r[1]));
    list.innerHTML = '';
    for (const [label, value, colour] of rows) {
      const li = document.createElement('li');
      const name = document.createElement('span');
      name.textContent = label;
      const track = document.createElement('span');
      track.className = 'mix-track';
      const fill = document.createElement('span');
      fill.className = 'mix-fill';
      fill.style.width = `${value ? Math.max(4, (value / max) * 100) : 0}%`;
      fill.style.background = colour;
      track.appendChild(fill);
      const count = document.createElement('span');
      count.className = 'mix-count';
      count.textContent = String(value);
      li.append(name, track, count);
      list.appendChild(li);
    }
  }

  /** The crawl's own settings, so the numbers above can be read against the
   * work that produced them. */
  function renderRunConfig(audit) {
    const el = siteAudit.shadow.querySelector('.run-config-facts');
    if (!el) return;
    const c = audit?.config || {};
    const facts = [
      `${Number(c.concurrency || 0)} concurrent request${Number(c.concurrency) === 1 ? '' : 's'}`,
      `${Number(c.requestDelayMs || 0)} ms delay`,
      c.respectRobots ? 'robots.txt respected' : 'robots.txt ignored',
      c.checkExternalLinks ? 'external validation enabled' : 'external validation off'
    ];
    if (c.maxDepth != null) facts.push(`max depth ${c.maxDepth}`);
    el.textContent = facts.join('  ·  ');
  }

  function renderSiteAuditProgress(audit) {
    paintTitleBlock(audit);
    siteAudit.paused = Boolean(audit?.paused);
    const shadow = siteAudit.shadow;
    shadow.querySelector('.stat-elapsed').textContent = elapsedLabel(audit);
    shadow.querySelector('.run-where').textContent = audit?.paused ? 'Paused on gateway' : 'Running on gateway';
    shadow.querySelector('.chip-row .state-chip.live').dataset.tone = audit?.paused ? 'warn' : 'brand';
    const pause = shadow.querySelector('.pause-btn');
    pause.textContent = audit?.paused ? 'Resume' : 'Pause';
    const finished = ['complete', 'cancelled', 'failed'].includes(String(audit?.status || ''));
    pause.hidden = finished;
    shadow.querySelector('.cancel-btn').hidden = finished;
    shadow.querySelector('.view-partial-btn').disabled = Number(audit?.urlCounts?.fetched || 0) === 0;
    renderStepper(audit);
    renderPhaseCard(audit);
    renderBudgetCallout(audit);
    renderRecentActivity(audit);
    renderEarlySignals(audit);
    renderRunMix(audit);
    renderRunConfig(audit);
  }

  function renderSiteAuditRenderSection(audit) {
    const shadow = siteAudit.shadow;
    const section = shadow.querySelector('.render-section');
    const raw = audit.renderProgress || { total: 0, rendered: 0 };
    // 'remaining' is derived, never trusted: a payload that omits it used to
    // print the literal word 'undefined' into the operator's instructions and
    // skip the all-done branch entirely.
    const total = Number(raw.total || 0);
    const rendered = Number(raw.rendered || 0);
    const rp = { ...raw, total, rendered, remaining: Number.isFinite(Number(raw.remaining)) ? Number(raw.remaining) : Math.max(0, total - rendered) };
    if (!rp.total) { section.hidden = true; return; }
    section.hidden = false;
    const startBtn = shadow.querySelector('.render-start-btn');
    const stopBtn = shadow.querySelector('.render-stop-btn');
    const statusEl = shadow.querySelector('.render-status');
    const titleEl = shadow.querySelector('.render-title');
    const stateEl = shadow.querySelector('.render-state');
    const fill = shadow.querySelector('.render-progress-fill');
    const pct = Math.round((rp.rendered / rp.total) * 100);
    fill.style.transform = `scaleX(${(rp.rendered ? Math.max(4, pct) : 0) / 100})`;
    if (rp.remaining === 0) {
      section.dataset.state = 'done';
      stateEl.textContent = 'Observed';
      titleEl.textContent = 'Deeper checks in your browser';
      statusEl.textContent = `All ${rp.total} crawled page${rp.total === 1 ? '' : 's'} have been checked in your browser for accessibility, JavaScript, and performance issues.`;
      startBtn.hidden = true;
      stopBtn.hidden = true;
      siteAudit.renderRunning = false;
    } else if (siteAudit.renderRunning) {
      section.dataset.state = 'running';
      stateEl.textContent = 'In progress';
      titleEl.textContent = 'Checking pages in your browser';
      statusEl.textContent = `${rp.rendered} of ${rp.total} done. Keep this tab open until it finishes.`;
      startBtn.hidden = true;
      stopBtn.hidden = false;
    } else if (rp.rendered === 0) {
      // The state that used to read as an upsell. Nothing has been rendered,
      // so accessibility, runtime errors and performance are not "clean" on
      // this site — they are unmeasured, and the panel has to say which.
      section.dataset.state = 'none';
      stateEl.textContent = 'Not established';
      titleEl.textContent = 'Accessibility, JavaScript and performance are unchecked';
      statusEl.textContent = `None of the ${rp.total} crawled page${rp.total === 1 ? ' has' : 's have'} been opened in a real browser, so this audit carries no accessibility, runtime-error or performance evidence for ${rp.total === 1 ? 'it' : 'them'}. That is a gap in coverage, not a clean result. The pass runs in this browser, one page at a time, and nothing is sent anywhere to do it.`;
      startBtn.textContent = `Check ${rp.total} page${rp.total === 1 ? '' : 's'} in this browser`;
      startBtn.hidden = false;
      stopBtn.hidden = true;
    } else {
      section.dataset.state = 'partial';
      stateEl.textContent = `${rp.rendered} of ${rp.total} checked`;
      titleEl.textContent = 'Deeper checks in your browser';
      statusEl.textContent = `${rp.rendered} of ${rp.total} pages checked so far. The remaining ${rp.remaining} carry no accessibility, JavaScript-dependent or performance evidence yet.`;
      startBtn.textContent = `Check the remaining ${rp.remaining} page${rp.remaining === 1 ? '' : 's'}`;
      startBtn.hidden = false;
      stopBtn.hidden = true;
    }
  }

  async function startRenderPass() {
    const shadow = siteAudit.shadow;
    const errorEl = shadow.querySelector('.render-error');
    errorEl.style.display = 'none';
    const startBtn = shadow.querySelector('.render-start-btn');
    startBtn.disabled = true;
    try {
      const r = await chrome.runtime.sendMessage({ type: 'SITE_AUDIT_RENDER_START', auditId: siteAudit.auditId, siteOrigin: siteAudit.siteOrigin }).catch((error) => ({ started: false, error: error?.message }));
      if (!r?.started) {
        // The button's label is now state-dependent, so the retry instruction
        // names the action rather than a caption that may have changed.
        errorEl.textContent = r?.error === 'permission-denied'
          ? 'Permission to open pages on this site was declined. Grant it and start the check again to retry.'
          : 'Could not start the render pass. Try again.';
        errorEl.style.display = 'block';
        return;
      }
      siteAudit.renderRunning = true;
      beginPolling();
    } finally {
      startBtn.disabled = false;
    }
  }

  async function stopRenderPass() {
    siteAudit.renderRunning = false;
    await chrome.runtime.sendMessage({ type: 'SITE_AUDIT_RENDER_STOP', auditId: siteAudit.auditId }).catch(() => {});
  }

  async function showSiteAuditResults() {
    setSiteAuditView('results');
    await loadAndPaintResults({ switchTab: true });
  }

  /**
   * Reads the audit and repaints every part of the results view from it.
   *
   * This is one function rather than an initial paint plus a partial refresh
   * because the partial refresh was the bug: while a crawl ran, polling
   * repainted only the scope banner and the render panel, so the banner
   * announced "40 of 113 discovered pages were fetched" directly above tiles
   * that still said 20 and a nav that still said 20. Two numbers for the same
   * fact on one screen, and the banner's whole purpose is to stop exactly that.
   * Everything on this view now moves together or not at all.
   */
  async function loadAndPaintResults({ switchTab = false } = {}) {
    const shadow = siteAudit.shadow;
    // Distributions travel with the status read: every discipline section and
    // both Overview charts are drawn from them, so fetching them lazily per
    // section would make the nav's own state chips lag behind the nav.
    const [statusResult, renderStateResult, distributionsResult, groupsResult] = await Promise.all([
      chrome.runtime.sendMessage({ type: 'SITE_AUDIT_STATUS', auditId: siteAudit.auditId }).catch(() => null),
      chrome.runtime.sendMessage({ type: 'SITE_AUDIT_RENDER_STATE', auditId: siteAudit.auditId }).catch(() => null),
      chrome.runtime.sendMessage({ type: 'SITE_AUDIT_DISTRIBUTIONS', auditId: siteAudit.auditId }).catch(() => null),
      chrome.runtime.sendMessage({ type: 'SITE_AUDIT_FINDINGS', auditId: siteAudit.auditId, groupByRule: true }).catch(() => null)
    ]);
    if (!siteAudit) return; // closeSiteAudit() may have run while the messages were in flight
    siteAudit.lastResultsPaint = Date.now();
    const audit = statusResult?.audit;
    siteAudit.renderRunning = Boolean(renderStateResult?.running);
    // Keep the last successful read: a failed refresh must not blank sections
    // that were correctly drawn a moment ago.
    if (distributionsResult?.distributions) siteAudit.distributions = distributionsResult.distributions;
    if (groupsResult?.groups) siteAudit.rawFindingGroups = groupsResult.groups;
    if (audit) {
      siteAudit.audit = audit;
      const counts = audit.urlCounts || {};
      const linkCounts = audit.linkCounts || {};
      // Every figure this sentence used to carry — pages, broken links,
      // findings — sits in a tile directly beneath it or on a nav row beside
      // it. What is not stated anywhere else is where the audit started and
      // when it ran, so that is what it says now.
      shadow.querySelector('.results-summary').textContent = auditProvenanceLine(audit);
      renderSiteAuditRenderSection(audit);
      renderScopeBanner(audit);

      siteAudit.urlCounts = counts;
      siteAudit.totalUrls = urlTotalForScope(currentUrlScope());
      siteAudit.totalLinksByStatus = linkCounts;
    }
    // The nav's state chips depend on both the audit facts and the finding
    // groups, so they are painted once both have landed.
    renderNavStates();
    // The structured-data badge needs the inventory, and a destination whose
    // count only appears after you visit it is not telling you anything. Fetched
    // once, in the background, and the nav repainted when it lands — a failure
    // here leaves the badge hidden rather than showing a wrong number.
    if (siteAudit.auditId && !siteAudit.schema && !siteAudit.schemaLoading) {
      siteAudit.schemaLoading = true;
      chrome.runtime.sendMessage({ type: 'SITE_AUDIT_SCHEMA', auditId: siteAudit.auditId })
        .then((r) => {
          if (!siteAudit) return;
          siteAudit.schemaLoading = false;
          if (r?.schema) { siteAudit.schema = r.schema; renderNavStates(); }
        })
        .catch(() => { if (siteAudit) siteAudit.schemaLoading = false; });
    }
    if (audit) {
      renderSummaryHeader(groupsResult?.groups || siteAudit.rawFindingGroups || [], audit);

      renderCrawlShape();
    } else {
      // Say so rather than showing zeros: an unreachable audit is a coverage
      // fact about this session, not a site with nothing wrong in it.
      const summaryEl = shadow.querySelector('.results-summary');
      if (summaryEl && !/could not be read/.test(summaryEl.textContent)) {
        summaryEl.textContent = 'The audit record could not be read just now. The figures below are from the last successful read. ' + summaryEl.textContent;
      }
    }
    // A render pass (this browser's own tabs) or a still-running crawl both
    // need live updates while this view is open, even though the crawl-done
    // branch in pollSiteAuditOnce already stopped the original poll timer.
    if (siteAudit.renderRunning || audit?.status === 'running') beginPolling();
    if (switchTab) return switchSiteAuditTab(siteAudit.tab || 'findings');
    // A refresh must not move the operator: repaint whatever they are looking
    // at, in place.
    return repaintCurrentTab();
  }

  /** Repaints the open tab without changing which tab is open. */
  function repaintCurrentTab() {
    const tab = siteAudit.tab;
    if (SITE_AUDIT_DISCIPLINE_META[tab]) return renderDisciplineSection(tab);
    if (tab === 'findings') return renderFindingsList();
    if (tab === 'urls') return loadSiteAuditUrls();
    if (tab === 'links') return loadSiteAuditLinks();
  }

  const SITE_AUDIT_SEVERITY_RANK = { critical: 4, high: 3, medium: 2, low: 1, info: 0 };

  /** The same deterministic ranking packages/crawl/report.js uses for its
   * downloadable report's "top priorities" list (severity, then how many
   * pages are affected) — ported here so the live results view shows the
   * same ranked picture without a round trip through a generated HTML file.
   * No AI/LLM summary here: a single-page "priority brief" is scoped to one
   * page's findings and would need real cross-page pattern synthesis to say
   * anything useful about a whole audit, which this simple, honest ranking
   * already does without that risk. */
  const SITE_AUDIT_SEVERITY_LABEL = { critical: 'Critical', high: 'High', medium: 'Medium', low: 'Low', info: 'Info' };

  // Mirrors packages/findings/impact.js's IMPACT_CLASSES order/labels — what
  // a finding threatens, not which scanner produced it, so "Security" and
  // "Discoverability" group findings the same way regardless of whether they
  // came from the static crawl or the rendered pass.
  const SITE_AUDIT_IMPACT_ORDER = ['availability', 'discoverability', 'accessibility', 'performance', 'security', 'implementation', 'coverage'];
  const SITE_AUDIT_IMPACT_LABEL = { availability: 'Availability', discoverability: 'Discoverability', accessibility: 'Accessibility', performance: 'Performance', security: 'Security', implementation: 'Web quality', coverage: 'Coverage' };

  /**
   * Impact-area filtering, as a control on the list it filters.
   *
   * This was a card on the Overview holding one row per impact class — the
   * same counts every nav row already carries, on a different tab from the
   * findings it narrowed. The counts were redundant; the filter was not, so
   * the filter moved to the Findings toolbar and the card went away.
   */
  /**
   * The area filter on Findings.
   *
   * Areas are the ten disciplines, not the seven impact classes: every rule id
   * either scanner tier can emit maps to exactly one discipline, and that map
   * is what the nav's discipline sections used to expose. Removing those
   * sections moved the taxonomy here rather than deleting it — a discipline is
   * a lens on the findings, and a lens belongs on the list it narrows.
   *
   * Ordered by the standing prioritization rule, so availability heads the
   * list and accessibility takes its turn rather than leading on volume.
   */
  function renderImpactFilter(groups) {
    const select = siteAudit.shadow.querySelector('.findings-impact');
    if (!select) return;
    const counts = {};
    for (const g of groups) {
      const area = disciplineOf(g.rule_id);
      counts[area] = (counts[area] || 0) + g.instances;
    }
    const present = SITE_AUDIT_DISCIPLINE_IDS.filter((id) => counts[id]);
    select.innerHTML = '';
    const all = document.createElement('option');
    all.value = '';
    all.textContent = 'All areas';
    select.appendChild(all);
    for (const id of present) {
      const option = document.createElement('option');
      option.value = id;
      option.textContent = `${SITE_AUDIT_AREA_LABEL[id] || id} (${counts[id]})`;
      select.appendChild(option);
    }
    select.value = siteAudit.findingsImpactClass || '';
    select.disabled = !present.length;
  }

  function renderSeverityBar(groups) {
    const shadow = siteAudit.shadow;
    const bar = shadow.querySelector('.severity-bar');
    const legend = shadow.querySelector('.severity-legend');
    bar.innerHTML = '';
    legend.innerHTML = '';
    const counts = { critical: 0, high: 0, medium: 0, low: 0, info: 0 };
    let total = 0;
    for (const g of groups) {
      const sev = counts.hasOwnProperty(g.severity) ? g.severity : 'info';
      counts[sev] += g.instances;
      total += g.instances;
    }
    if (!total) { bar.hidden = true; legend.hidden = true; return; }
    bar.hidden = false; legend.hidden = false;
    for (const sev of Object.keys(SITE_AUDIT_SEVERITY_LABEL)) {
      if (!counts[sev]) continue;
      const seg = document.createElement('span');
      seg.style.background = `var(--sa-sev-${sev})`;
      seg.style.width = `${(counts[sev] / total) * 100}%`;
      bar.appendChild(seg);
      const li = document.createElement('li');
      const sw = document.createElement('span');
      sw.className = 'sw';
      sw.style.background = `var(--sa-sev-${sev})`;
      li.append(sw, document.createTextNode(`${SITE_AUDIT_SEVERITY_LABEL[sev]} (${counts[sev]})`));
      legend.appendChild(li);
    }
  }

  /** The human title a scanner wrote, falling back to the rule id only when a
   * rule genuinely shipped without one (which is a content bug to fix at
   * source, not a reason to show machine language to a client). */
  function findingLabel(g) {
    return (g.title || '').trim() || g.rule_id;
  }

  const CONDITION_STATE_WORD = { ok: 'Observed', attention: 'Needs attention', unknown: 'Not established' };

  /* The pill tone vocabulary ------------------------------------------------
   *
   * Every pill in the overlay takes its wash, its text colour and its hairline
   * from one of these tones, and these three tables are the only places a state
   * is turned into one. Before them each rendering site chose its own class —
   * six of them built a severity badge, and any one could have drifted.
   *
   * Severity is the case that matters most: the ramp is fills only, so a
   * severity badge takes the semantic wash-and-text pair, never --sa-sev-*.
   * Critical is the single exception, and the solid fill at the top of the ramp
   * is how it announces itself. */
  const SEVERITY_TONE = { critical: 'critical-solid', high: 'critical', medium: 'warn', low: 'warn', info: 'muted' };
  const STATUS_TONE = { healthy: 'ok', broken: 'critical', blocked: 'muted', inconclusive: 'muted' };
  const CONDITION_STATE_TONE = { ok: 'ok', attention: 'critical' };

  /** Casing belongs to the string, not to the stylesheet: text-transform
   * capitalises every word, which turns "high priority" into title case and
   * "Needs attention" into "Needs Attention". The scanner's vocabulary arrives
   * lowercase and this is what puts one capital on the front of it. */
  function sentenceCase(text) {
    const s = String(text || '');
    return s ? s[0].toUpperCase() + s.slice(1) : s;
  }

  /** A severity badge. One function, because six places built this span. */
  function severityPill(severity, text) {
    const el = document.createElement('span');
    el.className = 'pill';
    el.dataset.tone = SEVERITY_TONE[severity] || SEVERITY_TONE.info;
    el.textContent = text === undefined ? sentenceCase(severity || 'info') : text;
    return el;
  }

  /**
   * How sure the scanner is, in the scanner's own closed vocabulary.
   *
   * Only 'confirmed' is drawn as settled. Everything softer reads as warn
   * rather than as neutral, because a plan that renders 'inferred' the same way
   * it renders 'confirmed' has quietly promoted a guess.
   */
  function confidencePill(confidence) {
    const el = document.createElement('span');
    el.className = 'pill cap';
    el.dataset.tone = confidence === 'confirmed' ? 'ok' : 'warn';
    el.textContent = confidence || 'inferred';
    return el;
  }


  /**
   * The factual state readout — the one place this screen says what is true of
   * the site.
   *
   * Composed by the crawl when the audit finishes, so every surface reports the
   * same states from the same evidence. Until then the three documents fetched
   * before the crawl started stand in, which is why this block is populated
   * from the first moment there is anything to say rather than staying blank
   * for the length of the run.
   *
   * A row whose state is `attention` opens with its evidence showing. What is
   * wrong is what the reader came for, and making them click for it is a
   * disclosure that protects nothing.
   */
  function renderAuditSummary(audit) {
    const shadow = siteAudit.shadow;
    const section = shadow.querySelector('.conditions');
    const list = shadow.querySelector('.conditions-list');
    if (!section || !list) return;
    const signals = audit?.stats?.siteSignals || null;
    const composed = audit?.stats?.auditSummary?.rows || [];
    const rows = composed.length ? composed : (signals ? provisionalConditionRows(signals) : []);
    if (!rows.length) { section.hidden = true; return; }
    section.hidden = false;
    list.innerHTML = '';
    for (const r of rows) {
      const li = document.createElement('li');
      li.className = 'cond-row';
      li.dataset.state = r.state;
      const evidenceId = `cond-ev-${r.id}`;
      const open = r.state === 'attention';
      const head = document.createElement('button');
      head.type = 'button';
      head.className = 'cond-head';
      head.setAttribute('aria-expanded', String(open));
      head.setAttribute('aria-controls', evidenceId);
      head.innerHTML = '<span class="cond-mark" aria-hidden="true"></span><span class="cond-label"></span><span class="cond-headline"></span><span class="pill cond-state"></span><svg class="cond-caret" viewBox="0 0 12 12" aria-hidden="true"><path d="M4.5 2.5L8 6l-3.5 3.5"/></svg>';
      head.querySelector('.cond-label').textContent = r.label;
      head.querySelector('.cond-headline').textContent = r.headline;
      const statePill = head.querySelector('.cond-state');
      statePill.textContent = CONDITION_STATE_WORD[r.state] || r.state;
      // The row already knows its state; the pill takes its tone from the same
      // place rather than from one descendant selector per state.
      if (CONDITION_STATE_TONE[r.state]) statePill.dataset.tone = CONDITION_STATE_TONE[r.state];
      const evidence = document.createElement('ul');
      evidence.className = 'cond-evidence';
      evidence.id = evidenceId;
      evidence.hidden = !open;
      for (const line of r.evidence || []) {
        const item = document.createElement('li');
        item.textContent = line;
        evidence.appendChild(item);
      }
      // Confidence and the document behind the row close the evidence on one line.
      const foot = document.createElement('li');
      foot.className = 'cond-foot';
      const conf = document.createElement('span');
      conf.className = 'pill cond-confidence';
      conf.textContent = `Confidence: ${r.confidence}`;
      foot.appendChild(conf);
      // The three rows backed by a document the reader can open for themselves.
      // It sits inside the evidence, not on the row: the row states the
      // condition, and the file that proves it belongs with the rest of the
      // proof, named rather than left as a bare "Open". Never a child of the
      // row's toggle either — a button inside a button is invalid and
      // unreachable for half of assistive technology.
      const docUrl = conditionDocumentUrl(r.id, signals, siteAudit.siteOrigin);
      if (docUrl) {
        const docName = r.label === 'Indexable' ? 'robots.txt' : r.label === 'Sitemap' ? 'the sitemap' : r.label;
        const openBtn = document.createElement('button');
        openBtn.type = 'button';
        openBtn.className = 'cond-open';
        openBtn.textContent = `Open ${docName}`;
        openBtn.title = docUrl;
        openBtn.setAttribute('aria-label', `Open ${docName} in a new tab`);
        openBtn.addEventListener('click', () => window.open(docUrl, '_blank', 'noopener'));
        foot.appendChild(openBtn);
      }
      evidence.appendChild(foot);
      head.addEventListener('click', () => {
        const showing = evidence.hidden;
        evidence.hidden = !showing;
        head.setAttribute('aria-expanded', String(showing));
      });
      li.appendChild(head);
      li.appendChild(evidence);
      list.appendChild(li);
    }
  }
  function renderSummaryHeader(groups, audit) {
    if (!audit) return;
    const shadow = siteAudit.shadow;
    paintTitleBlock(audit);
    try { renderAuditSummary(audit); } catch { /* the conditions block never takes the header down with it */ }
    let fix = 0, findings = 0;
    for (const g of groups) {
      findings += g.instances;
      if (g.category === 'fix') fix += g.instances;
    }
    const counts = audit?.urlCounts || {};
    const fetched = Number(counts.fetched || 0);
    const discovered = Object.values(counts).reduce((s, n) => s + Number(n || 0), 0);
    // A "coverage gap" is a page the crawl could not turn into evidence:
    // still queued when it stopped, errored, or skipped by robots. It is
    // deliberately not folded into the findings count — see PRODUCT.md.
    const gaps = Number(counts.queued || 0) + Number(counts.error || 0) + Number(counts.skipped || 0);

    shadow.querySelector('.sh-pages').textContent = discovered > fetched ? `${fetched} / ${discovered}` : String(fetched);
    shadow.querySelector('.sh-pages-sub').textContent = discovered > fetched ? `of ${discovered} discovered` : 'all discovered pages';
    const fill = shadow.querySelector('.tile-fill');
    if (fill) fill.style.width = `${discovered ? Math.max(3, Math.round((fetched / discovered) * 100)) : 0}%`;
    shadow.querySelector('.sh-findings').textContent = String(findings);
    shadow.querySelector('.sh-findings-sub').textContent = `${groups.length} distinct issue type${groups.length === 1 ? '' : 's'}`;
    shadow.querySelector('.sh-fix').textContent = String(fix);
    // "Fix-category findings" named an internal taxonomy value. A denominator
    // against the total is what the operator actually wants to know.
    shadow.querySelector('.sh-fix-sub').textContent = findings ? `of ${findings} findings` : '';
    shadow.querySelector('.sh-gaps').textContent = String(gaps);
    shadow.querySelector('.sh-gaps-sub').textContent = gaps ? 'discovered, not crawled' : 'every page fetched';
    // A tile only offers a drill-in when there is something behind it.
    const tileCounts = { crawled: fetched, findings, fix, gaps };
    for (const btn of shadow.querySelectorAll('.stat-open')) {
      btn.disabled = !tileCounts[btn.dataset.open];
    }
    renderOverviewHead(audit);
    renderLumenBrief(groups, audit);
    renderFindingMix(groups, audit);
    renderImpactFilter(groups);

    const top = [...groups]
      .sort((a, b) => (SITE_AUDIT_SEVERITY_RANK[b.severity] ?? -1) - (SITE_AUDIT_SEVERITY_RANK[a.severity] ?? -1) || b.affected_urls - a.affected_urls)
      .slice(0, 5);
    const list = shadow.querySelector('.top-issues');
    list.innerHTML = '';
    if (!top.length) {
      const li = document.createElement('li');
      li.className = 'sev-info';
      li.textContent = 'No findings recorded yet.';
      list.appendChild(li);
      return;
    }
    for (const g of top) {
      const li = document.createElement('li');
      li.className = `sev-${g.severity || 'info'}`;
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'ti-open';
      const rule = findingLabel(g);
      button.title = `Open "${rule}" in Findings`;
      const badge = severityPill(g.severity, sentenceCase(g.severity || g.category || ''));
      const label = document.createElement('span');
      label.className = 'ti-rule';
      label.textContent = rule;
      const scope = document.createElement('span');
      scope.className = 'ti-scope';
      scope.textContent = `${g.affected_urls} page${g.affected_urls === 1 ? '' : 's'}`;
      // Search by rule id: it is exact, whereas the human title is what the
      // search box already matches loosely and could pull in neighbours.
      button.addEventListener('click', () => {
        siteAudit.findingsSearch = g.rule_id || rule;
        siteAudit.findingsCategory = '';
        siteAudit.findingsImpactClass = '';
        const input = siteAudit.shadow.querySelector('.findings-search');
        if (input) input.value = siteAudit.findingsSearch;
        switchSiteAuditTab('findings');
      });
      button.append(badge, label, scope);
      li.appendChild(button);
      list.appendChild(li);
    }
  }

  /** Whether the crawl stopped because it ran out of page budget rather than
   * because it ran out of site. Several readouts have to qualify themselves
   * when this is true — a comparison against a crawl that was cut short is a
   * statement about the budget, not about the site. */
  function pageLimitStopped(audit) {
    const counts = audit?.urlCounts || {};
    return Number(counts.queued || 0) > 0;
  }

  /**
   * The document behind a site-conditions row, where there is one.
   *
   * robots.txt, the sitemap and llms.txt are the three rows a reader can check
   * for themselves, and one click to the file is the difference between a
   * report and an assertion. They briefly had a second block of their own,
   * which restated the same three facts in different words directly beneath
   * the rows that already carried them; the link is what that block was
   * actually for, so it moved here and the block went away.
   */
  function conditionDocumentUrl(rowId, signals, origin) {
    if (!origin && !signals) return '';
    const base = signals?.origin || origin || '';
    if (rowId === 'indexable') return base ? `${base}/robots.txt` : '';
    if (rowId === 'llms') return base ? `${base}${'/llms.txt'}` : '';
    if (rowId === 'sitemap') return signals?.sitemap?.source || '';
    return '';
  }

  /**
   * Site-conditions rows synthesised from the site signals alone.
   *
   * The server composes the real readout when the audit finishes. These three
   * are settled before the crawl starts, so during a run they stand in — same
   * ids, same labels, same vocabulary, so the server's rows replace them
   * without the readout appearing to change its mind.
   */
  function provisionalConditionRows(signals) {
    const robots = signals.robots || {};
    const sitemap = signals.sitemap || {};
    const llms = signals.llmsTxt || {};
    const rows = [];

    if (robots.present === true && robots.blocksEverything) {
      rows.push({ id: 'indexable', label: 'Indexable', state: 'attention', headline: 'robots.txt disallows the whole site', confidence: 'confirmed',
        evidence: [`robots.txt returned HTTP ${robots.status} and contains "Disallow: /" for all user agents.`, 'Search engines that respect robots.txt will not crawl any page here.'] });
    } else if (robots.present === true) {
      rows.push({ id: 'indexable', label: 'Indexable', state: 'ok', headline: 'robots.txt allows crawling', confidence: 'confirmed',
        evidence: [`robots.txt returned HTTP ${robots.status} with ${robots.disallowCount} disallow rule${robots.disallowCount === 1 ? '' : 's'} and no site-wide block.`] });
    } else if (robots.present === false) {
      rows.push({ id: 'indexable', label: 'Indexable', state: 'ok', headline: 'No robots.txt, so nothing is disallowed', confidence: 'confirmed',
        evidence: [`robots.txt returned HTTP ${robots.status}. With no file present, crawlers treat the whole site as allowed.`] });
    } else {
      rows.push({ id: 'indexable', label: 'Indexable', state: 'unknown', headline: 'robots.txt could not be read', confidence: 'inconclusive',
        evidence: [robots.error ? `Request failed: ${robots.error}` : `robots.txt returned HTTP ${robots.status || 0}.`] });
    }

    if (sitemap.present) {
      rows.push({ id: 'sitemap', label: 'Sitemap', state: 'ok', confidence: sitemap.truncated ? 'inferred' : 'confirmed',
        headline: sitemap.declaredInRobots ? 'Declared in robots.txt and readable' : 'Found at the conventional path',
        evidence: [`Read ${sitemap.urlCount} URL${sitemap.urlCount === 1 ? '' : 's'} from ${sitemap.source}.`, sitemap.truncated ? 'The sitemap is longer than this audit reads.' : null].filter(Boolean) });
    } else if (sitemap.declaredInRobots) {
      rows.push({ id: 'sitemap', label: 'Sitemap', state: 'attention', headline: 'Declared in robots.txt but nothing could be read from it', confidence: 'confirmed',
        evidence: [`robots.txt declares ${(sitemap.declared || []).length} sitemap${(sitemap.declared || []).length === 1 ? '' : 's'}, but no URLs were read from ${(sitemap.declared || []).slice(0, 3).join(', ')}.`] });
    } else {
      rows.push({ id: 'sitemap', label: 'Sitemap', state: 'attention', headline: 'No sitemap found', confidence: 'confirmed',
        evidence: ['Nothing was declared in robots.txt and /sitemap.xml returned no URLs.', 'Discovery then depends entirely on internal linking.'] });
    }

    // A proposed convention's absence is context, never a defect.
    if (llms.present === true) {
      rows.push({ id: 'llms', label: 'llms.txt', state: 'ok', headline: 'Published', confidence: 'confirmed',
        evidence: [`Served ${llms.bytes} byte${llms.bytes === 1 ? '' : 's'} at /llms.txt.`, 'A proposed convention for describing a site to language models. Publishing one is a deliberate choice, not a requirement.'] });
    } else if (llms.present === false) {
      rows.push({ id: 'llms', label: 'llms.txt', state: 'ok', headline: 'Not published', confidence: 'confirmed',
        evidence: [`/llms.txt returned HTTP ${llms.status}. This is a proposed convention, not a standard. Its absence is not a defect and is reported here as context only.`] });
    }
    return rows;
  }

  /**
   * The Lumen brief: the audit's findings composed into a short ranked list of
   * things to do, with the evidence for each kept attached.
   *
   * This is deterministic composition, never a model's reading. It groups
   * findings that share a fix, ranks those groups, and writes each one's
   * sentence from counts the scanners produced. No finding is created,
   * promoted, demoted or reworded here — severity and confidence stay exactly
   * as the scanner recorded them, which is why the panel says so on its face.
   *
   * The ranking is the standing prioritization rule made executable:
   *   1. a confirmed functional failure outranks everything
   *   2. then severity
   *   3. then how many pages share one cause, because one shared component is
   *      one fix and forty separate defects are forty
   * A discipline cannot buy the top of this list with volume.
   */
  const SITE_AUDIT_BRIEF_ACTIONS = {
    availability: { verb: 'Repair', subject: 'confirmed broken destinations', sitewide: 'Repair the broken destinations repeated across the site' },
    indexability: { verb: 'Resolve', subject: 'indexability blockers', sitewide: 'Resolve the sitewide indexability pattern' },
    duplicates: { verb: 'Differentiate', subject: 'duplicated pages', sitewide: 'Differentiate the duplicated pages' },
    sitemaps: { verb: 'Reconcile', subject: 'the sitemap with the crawl', sitewide: 'Reconcile the sitemap with the crawl' },
    security: { verb: 'Add', subject: 'the missing response headers', sitewide: 'Add the missing response headers consistently' },
    international: { verb: 'Correct', subject: 'language targeting', sitewide: 'Correct the sitewide language targeting' },
    content: { verb: 'Restore', subject: 'on-page content signals', sitewide: 'Restore the on-page signals missing across the site' },
    quality: { verb: 'Fix', subject: 'markup and structured data', sitewide: 'Fix the shared markup defect' },
    performance: { verb: 'Improve', subject: 'measured loading behaviour', sitewide: 'Improve the loading behaviour shared across pages' },
    accessibility: { verb: 'Remove', subject: 'accessibility barriers', sitewide: 'Remove the accessibility barrier repeated across the site' }
  };

  const SEV_RANK_ORDER = { critical: 0, high: 1, medium: 2, low: 3, info: 4 };

  function composeLumenBrief(groups, audit) {
    const fetched = Number(audit?.urlCounts?.fetched || 0);
    const established = (groups || []).filter((g) => g.confidence !== 'inconclusive' && g.category !== 'context');
    const byArea = new Map();
    for (const g of established) {
      const area = disciplineOf(g.rule_id);
      if (!byArea.has(area)) byArea.set(area, []);
      byArea.get(area).push(g);
    }

    const composed = [];
    for (const [area, rows] of byArea) {
      const instances = rows.reduce((n, r) => n + Number(r.instances || 0), 0);
      const pages = Math.max(...rows.map((r) => Number(r.affected_urls || 0)));
      const severity = rows.map((r) => String(r.severity || 'info')).sort((a, b) => (SEV_RANK_ORDER[a] ?? 9) - (SEV_RANK_ORDER[b] ?? 9))[0];
      const confirmed = rows.some((r) => r.confidence === 'confirmed' || r.confidence === 'corroborated');
      // One rule on most of the crawled pages is one shared cause, not N
      // independent defects. That changes both the wording and the ranking.
      // The lead is the rule this group is described by, so it decides both
      // the wording and the claim. Established evidence leads: describing a
      // group by an inferred rule while the sentence beside it says
      // "independently confirmed" is manufactured certainty, and it is exactly
      // what happened when the lead was picked on severity alone.
      const lead = [...rows].sort((a, b) =>
        Number(!(a.confidence === 'confirmed' || a.confidence === 'corroborated')) -
        Number(!(b.confidence === 'confirmed' || b.confidence === 'corroborated')) ||
        (SEV_RANK_ORDER[a.severity] ?? 9) - (SEV_RANK_ORDER[b.severity] ?? 9) ||
        (b.affected_urls || 0) - (a.affected_urls || 0))[0];
      const leadConfirmed = lead?.confidence === 'confirmed' || lead?.confidence === 'corroborated';
      // Sitewide describes the rule being named, not any rule in the area. A
      // fragment defect on every page must not retitle two broken links as a
      // sitewide pattern.
      const sitewide = fetched >= 3 && Number(lead?.affected_urls || 0) >= Math.ceil(fetched * 0.75);
      const action = SITE_AUDIT_BRIEF_ACTIONS[area] || { verb: 'Review', subject: area, sitewide: `Review the ${area} pattern` };
      const journeyFailure = area === 'availability' && leadConfirmed;
      composed.push({
        area,
        rules: rows,
        title: sitewide ? action.sitewide : `${action.verb} ${action.subject}`,
        severity,
        confirmed,
        leadConfirmed,
        sitewide,
        instances,
        pages,
        leadPages: Number(lead?.affected_urls || 0),
        journeyFailure,
        lead
      });
    }

    composed.sort((a, b) =>
      Number(b.journeyFailure) - Number(a.journeyFailure) ||
      (SEV_RANK_ORDER[a.severity] ?? 9) - (SEV_RANK_ORDER[b.severity] ?? 9) ||
      Number(b.sitewide) - Number(a.sitewide) ||
      b.pages - a.pages);

    const top = composed.slice(0, 4);
    const totalInstances = (groups || []).reduce((n, g) => n + Number(g.instances || 0), 0);
    return {
      groups: top,
      totalInstances,
      fetched,
      // The opening sentence names the order and the reason for it, so the
      // ranking can be argued with rather than merely trusted.
      summary: composeBriefSummary(top, fetched)
    };
  }

  function composeBriefSummary(top, fetched) {
    if (!top.length) return `Nothing established needs attention across the ${fetched} page${fetched === 1 ? '' : 's'} analysed. Coverage limits are stated separately below.`;
    const first = top[0];
    const parts = [];
    if (first.journeyFailure) {
      parts.push(`Start with the ${first.pages === 1 ? 'destination' : 'destinations'} that fail for a visitor: those are confirmed journey failures, not stylistic warnings.`);
    } else {
      parts.push(`Start with ${first.title.toLowerCase()}, the highest-severity established evidence in this audit.`);
    }
    const shared = top.slice(1).find((g) => g.sitewide);
    if (shared) parts.push(`Then repair the pattern repeated across the site: one shared cause is one fix, not ${shared.pages}.`);
    const rest = top.filter((g) => g !== first && g !== shared);
    if (rest.length) parts.push(`${rest.map((g) => SITE_AUDIT_AREA_LABEL[g.area] || g.area).join(' and ')} affect many pages, but come after those.`);
    return parts.join(' ');
  }

  /** Why this group sits where it sits, in the product's own words and only
   * from what the scanners recorded. */
  function briefRationale(group) {
    // Every sentence here is written from the LEAD rule's own confidence. A
    // claim of independent confirmation may only appear when the rule being
    // described actually carries it.
    const pages = group.leadPages || group.pages;
    if (group.journeyFailure) {
      return `These are direct journey failures rather than optimisation warnings. A visitor following the link reaches a destination that independently returned a missing-page or server-error response, so Lumen ranks them ahead of broader metadata and security hygiene.`;
    }
    if (group.sitewide && group.leadConfirmed) {
      return `Independently confirmed on ${pages} of the pages analysed, which usually means one shared component rather than ${pages} separate defects. Fixing the component fixes every instance.`;
    }
    if (group.sitewide) {
      return `The same finding appears on ${pages} of the pages analysed, which usually means one shared component rather than ${pages} separate defects. It is inferred from the static HTML rather than independently confirmed, so verify the component before treating the count as settled.`;
    }
    return `${group.instances} observation${group.instances === 1 ? '' : 's'} across ${group.pages} page${group.pages === 1 ? '' : 's'}, at ${group.severity} severity and ${group.lead?.confidence || 'inferred'} confidence. It sits here because higher-severity or confirmed journey evidence ranks above it.`;
  }
  /** The identity block: what was audited, in what state, from where. */
  function renderOverviewHead(audit) {
    const shadow = siteAudit.shadow;
    let host = siteAudit.siteOrigin || '';
    try { host = new URL(audit?.config?.startUrl || audit?.startUrl || siteAudit.siteOrigin).hostname; } catch {}
    shadow.querySelector('.ov-title').textContent = host || '–';
    const counts = audit?.urlCounts || {};
    const queued = Number(counts.queued || 0);
    const running = audit?.status === 'running';
    const chips = [];
    if (running) chips.push({ text: 'Crawl in progress', tone: 'live' });
    else if (queued > 0) chips.push({ text: 'Partial crawl', tone: 'provisional' });
    else chips.push({ text: 'Full crawl', tone: 'ok' });
    chips.push({ text: auditProvenanceLine(audit).split(' · ').pop() });
    const start = audit?.config?.startUrl || audit?.startUrl || '';
    if (start) chips.push({ text: `Started from ${start}`, mono: true });
    const row = shadow.querySelector('.ov-chips');
    row.innerHTML = '';
    for (const chip of chips) {
      const el = document.createElement('span');
      el.className = 'pill roomy state-chip';
      // 'live' and 'provisional' are what this row calls its two states; the
      // pill knows them as brand and warn.
      if (chip.tone) el.dataset.tone = chip.tone === 'live' ? 'brand' : 'warn';
      if (chip.tone === 'live') {
        const dot = document.createElement('span');
        dot.className = 'pulse-dot';
        dot.setAttribute('aria-hidden', 'true');
        el.appendChild(dot);
      }
      const text = document.createElement('span');
      if (chip.mono) text.style.fontFamily = 'var(--sa-mono)';
      text.textContent = chip.text;
      el.appendChild(text);
      row.appendChild(el);
    }
    // Continuing is only offered when there is a frontier left to continue on.
    const ceiling = Number(audit?.budgetCeiling || 300);
    const budget = Number(audit?.config?.maxPages || 0);
    const canContinue = !running && queued > 0 && budget < ceiling;
    const btn = shadow.querySelector('.ov-continue-btn');
    btn.hidden = !canContinue;
    if (canContinue) {
      const target = Math.min(ceiling, Math.max(budget + 20, Math.min(budget + queued, budget * 2)));
      btn.textContent = `Continue crawl to ${target} pages`;
      btn.onclick = () => raiseBudget(target);
    }
  }

  /** The brief, and the detail pane beside it. */
  /**
   * The brief's wording, and where it came from.
   *
   * The reader must always be able to tell a composed sentence from a
   * written one. "Grounded in scan evidence" is true of both — the evidence
   * and the ranking are identical either way — so the label names the author
   * of the words, not the source of the facts.
   */
  const BRIEF_PROVENANCE = {
    deterministic: "written by Lumen from scan evidence",
    pending: "written by Lumen from scan evidence · rewriting",
    model: "scan evidence · written by the model on this device",
    byo: "scan evidence · written by your model",
    unavailable: "written by Lumen from scan evidence"
  };

  /**
   * Why the model did not write the words.
   *
   * Four different things used to render the same sentence: AI turned off, the
   * model unavailable, the model's answer rejected for breaking the evidence
   * rules, and the request never made. The brief read identically in all four,
   * so an operator could not tell a deterministic brief from a failed one — and
   * PRODUCT.md is explicit that unavailable reasoning is a coverage fact, never
   * a silent omission. Each of these is short enough to sit in the kicker.
   */
  const BRIEF_UNAVAILABLE_REASON = {
    BRIEF_AI_OFF: "no model is configured, by choice",
    BRIEF_AI_NO_PROVIDER: "no model is configured",
    LOCAL_AI_API_UNAVAILABLE: "this browser has no built-in model",
    LOCAL_AI_DOWNLOADABLE: "the built-in model has not been downloaded",
    LOCAL_AI_DOWNLOADING: "the built-in model is still downloading",
    LOCAL_AI_UNAVAILABLE: "this device cannot run the built-in model",
    LOCAL_AI_PROBE_FAILED: "the built-in model could not be reached",
    LOCAL_AI_TIMEOUT: "the model did not answer in time",
    BRIEF_AI_TIMEOUT: "the model did not answer in time",
    BRIEF_AI_REJECTED: "the model's reply broke the evidence rules and was discarded",
    BRIEF_AI_NOTHING_TO_SAY: "there was nothing to rewrite",
    BYO_AI_NO_PERMISSION: "your endpoint has not been granted access",
    BYO_AI_NO_MODEL: "your endpoint has no model name set",
    BYO_AI_NO_ENDPOINT: "no endpoint is configured",
    BYO_AI_TIMEOUT: "your endpoint did not answer in time",
    BYO_AI_EMPTY: "your endpoint returned nothing",
    BYO_AI_FAILED: "your endpoint could not be reached"
  };

  /** A model that never answers is the failure this had no defence against:
   * session.prompt() is an unbounded await on someone else's runtime, and a
   * stalled one left the brief saying "asking AI for wording" for as long as the
   * overlay stayed open. The deterministic brief is already on screen, so the
   * only thing waiting longer buys is a label that never resolves. */
  /**
   * Configured absence, as distinct from failure.
   *
   * A brief nobody asked a model to rewrite is a finished brief, not a degraded
   * one, and badging it "unavailable" put an error on a screen where nothing
   * went wrong. These codes mean the operator has no model set up, which is a
   * choice rather than a fault, so the line says only who wrote the words.
   *
   * Everything else still states its reason. A configured endpoint that timed
   * out, or a reply discarded for breaking the evidence rules, is a coverage
   * fact the operator needs, and PRODUCT.md is explicit that it is never a
   * silent omission.
   */
  const BRIEF_NOT_A_FAILURE = new Set([
    "BRIEF_AI_OFF", "BRIEF_AI_NO_PROVIDER", "BYO_AI_NO_ENDPOINT", "BYO_AI_NO_MODEL",
    "LOCAL_AI_API_UNAVAILABLE", "LOCAL_AI_UNAVAILABLE", "BRIEF_AI_NOTHING_TO_SAY"
  ]);

  function briefUnavailableReason(code) {
    if (!code || BRIEF_NOT_A_FAILURE.has(code)) return "";
    return BRIEF_UNAVAILABLE_REASON[code] || "the model did not answer";
  }

  const BRIEF_AI_DEADLINE_MS = 12000;

  function withDeadline(promise, ms, code) {
    let timer = null;
    return Promise.race([
      promise.finally(() => clearTimeout(timer)),
      new Promise((resolve) => { timer = setTimeout(() => resolve({ ok: false, code }), ms); })
    ]);
  }

  /**
   * Ask the on-device model to phrase the brief.
   *
   * One stateless call per audit: no session is retained, because this is a
   * single request rather than a conversation, and a retained session would
   * let one audit's wording bleed into the next.
   *
   * Everything that constitutes a claim — which areas, in what order, with
   * what counts, severity and confidence — is already decided. The model is
   * given the skeleton and may only return words for it, and
   * validateBriefPhrasing rejects the response outright if it tries to do
   * more. A rejection is not a failure state for the operator: the
   * deterministic brief was already on screen and simply stays.
   */
  /** The instruction and the evidence, identical for every provider. Two
   * providers given two different prompts would be two products wearing one
   * label. */
  function briefPromptFor(envelope) {
    const api = globalThis.LumenBriefPhrasing;
    const rules = api.BRIEF_PHRASING_RULES.map((r, i) => (i + 1) + ". " + r).join("\n");
    const shape = JSON.stringify({
      summary: "two or three sentences",
      areas: envelope.areas.map((a) => ({ id: a.id, action: "short imperative headline", rationale: "one or two sentences" }))
    });
    return {
      system: [
        "You word the findings of a web site audit for a professional auditing a client site.",
        "The audit is already complete and its conclusions are fixed. You are not deciding anything.",
        "",
        "Rules:",
        rules,
        "",
        "Reply with JSON only, in exactly this shape:",
        shape
      ].join("\n"),
      // The composed brief goes in labelled, as the standard rather than as
      // one more field of JSON. The first on-device run had it in the payload
      // and ignored it, producing a restatement that lost both the reason for
      // the ordering and the number that made one fix out of forty pages.
      user: [
        "Evidence:",
        JSON.stringify(envelope),
        "",
        "Lumen already composed this summary. It is the standard to beat:",
        envelope.deterministicSummary,
        "",
        "Write something a professional would rather read. If you cannot, return that summary unchanged.",
        "JSON only."
      ].join("\n")
    };
  }

  /** Parse, gate and merge. Every provider ends here, so the rule that
   * rejects an invented number applies once and applies to all of them. */
  function acceptBriefPhrasing(raw, brief, envelope) {
    const api = globalThis.LumenBriefPhrasing;
    let candidate = null;
    try { candidate = JSON.parse(String(raw).replace(/^[^{]*/, "").replace(/[^}]*$/, "")); }
    catch { return { ok: false, code: "BRIEF_AI_INVALID_JSON" }; }
    const verdict = api.validateBriefPhrasing(candidate, envelope);
    if (!verdict.ok) return { ok: false, code: verdict.code, message: verdict.message };
    return { ok: true, brief: api.mergeBriefPhrasing(brief, candidate) };
  }

  /**
   * The operator's own endpoint.
   *
   * The request is made by the service worker, not here: a content script's
   * fetch is subject to the audited page's CSP, and most sites would refuse
   * a call to a third-party host. The response still lands in the same gate.
   */
  async function phraseBriefWithOwnAi(brief, audit) {
    const api = globalThis.LumenBriefPhrasing;
    if (!api) return { ok: false, code: "BRIEF_AI_GATE_MISSING" };
    const envelope = api.briefEnvelope(brief, audit?.urlCounts || {});
    if (!envelope.areas.length) return { ok: false, code: "BRIEF_AI_NOTHING_TO_SAY" };
    const prompt = briefPromptFor(envelope);
    let response = null;
    try {
      response = await chrome.runtime.sendMessage({ type: "BRIEF_AI_PHRASE", provider: "byo", system: prompt.system, user: prompt.user });
    } catch (error) {
      return { ok: false, code: "BYO_AI_FAILED", message: String(error?.message || error) };
    }
    if (!response?.ok) return { ok: false, code: response?.code || "BYO_AI_FAILED", message: response?.message || "" };
    return acceptBriefPhrasing(response.text, brief, envelope);
  }
  async function phraseBriefOnDevice(brief, audit) {
    const api = globalThis.LumenBriefPhrasing;
    const model = globalThis.LanguageModel;
    if (!api || !model?.availability) return { ok: false, code: "LOCAL_AI_API_UNAVAILABLE" };

    const envelope = api.briefEnvelope(brief, audit?.urlCounts || {});
    if (!envelope.areas.length) return { ok: false, code: "BRIEF_AI_NOTHING_TO_SAY" };

    let status = "unavailable";
    try { status = await model.availability({ expectedInputs: [{ type: "text" }] }); }
    catch { return { ok: false, code: "LOCAL_AI_PROBE_FAILED" }; }
    // "downloadable" means Chrome would fetch a multi-gigabyte model. That is
    // not something an audit should trigger on the operator's behalf.
    if (status !== "available") return { ok: false, code: "LOCAL_AI_" + String(status).toUpperCase() };

    const prompt = briefPromptFor(envelope);

    let session = null;
    try {
      session = await model.create({
        expectedInputs: [{ type: "text" }],
        initialPrompts: [{ role: "system", content: prompt.system }]
      });
      const raw = await session.prompt(prompt.user);
      return acceptBriefPhrasing(raw, brief, envelope);
    } catch (error) {
      return { ok: false, code: "LOCAL_AI_FAILED", message: String(error?.message || error) };
    } finally {
      try { session?.destroy?.(); } catch {}
    }
  }

  /** Start the phrasing once per audit, and repaint only if it is accepted. */
  /**
   * Ask for wording, once per audit, from whichever provider the operator
   * chose.
   *
   * On-device is tried first whenever it is permitted, because it is the
   * only option where nothing leaves the machine. Falling back to the
   * operator's own endpoint is a deliberate second choice, not a silent
   * upgrade: it only happens when they configured one.
   *
   * Every branch ends at the deterministic brief. There is no state in which
   * a failure leaves the operator worse off than not asking.
   */
  /**
   * Who will actually be asked.
   *
   * The worker resolves this from what can answer rather than from a fixed
   * preference. The overlay's job is only to report whether Chrome's built-in
   * model is usable here, which cannot be probed anywhere else, and to accept
   * the answer. Preferring a provider that reports unavailable, and only then
   * falling back, is what made this feature look broken on every machine where
   * the built-in model does not run.
   */
  async function localModelUsable() {
    try {
      if (typeof LanguageModel === "undefined" || !LanguageModel?.availability) return false;
      const status = await LanguageModel.availability({
        expectedInputs: [{ type: "text", languages: ["en"] }],
        expectedOutputs: [{ type: "text", languages: ["en"] }]
      });
      return status === "available" || status === "downloadable" || status === "downloading";
    } catch { return false; }
  }

  async function briefPhrasingProvider() {
    try {
      const localAvailable = await localModelUsable();
      const s = await chrome.runtime.sendMessage({ type: "BRIEF_AI_SETTINGS", localAvailable });
      const resolved = s?.resolved || {};
      return { provider: String(resolved.id || "none"), reason: String(resolved.reason || ""), substituted: Boolean(resolved.substituted) };
    } catch {
      return { provider: "none", reason: "", substituted: false };
    }
  }

  function requestBriefPhrasing(brief, audit) {
    const auditId = String(audit?.id || siteAudit.auditId || "");
    const state = siteAudit.briefPhrasing;
    if (state && state.auditId === auditId) return;
    siteAudit.briefPhrasing = { auditId, status: "pending" };
    renderBriefProvenance();

    const settle = (result, source) => {
      if (!siteAudit || String(siteAudit.auditId || "") !== auditId) return;
      siteAudit.briefPhrasing = result.ok
        ? { auditId, status: source, brief: result.brief }
        : { auditId, status: "unavailable", code: result.code, message: result.message || "" };
      if (result.ok) renderLumenBrief(siteAudit.rawFindingGroups || [], siteAudit.audit);
      else renderBriefProvenance();
    };

    // The whole chain is bounded, not just one call in it: a provider lookup
    // that never answers stalls this as surely as a prompt that never returns.
    withDeadline(briefPhrasingProvider().then(async ({ provider }) => {
      if (provider === "off") return { ok: false, code: "BRIEF_AI_OFF" };
      // One provider, chosen because it can answer. No speculative first
      // attempt against something already known to be unavailable.
      if (provider === "on-device") {
        const local = await phraseBriefOnDevice(brief, audit);
        return local.ok ? { ...local, source: "model" } : local;
      }
      if (provider === "byo") {
        const own = await phraseBriefWithOwnAi(brief, audit);
        return own.ok ? { ...own, source: "byo" } : own;
      }
      return { ok: false, code: "BRIEF_AI_NO_PROVIDER" };
    }), BRIEF_AI_DEADLINE_MS, "BRIEF_AI_TIMEOUT")
      .then((result) => settle(result, result.ok ? (result.source || "model") : "deterministic"))
      .catch((error) => {
        settle({ ok: false, code: "BRIEF_AI_FAILED", message: String(error?.message || error) }, "deterministic");
      });
  }

  function renderBriefProvenance() {
    const kicker = siteAudit?.shadow?.querySelector(".brief-kicker .brief-source");
    if (!kicker) return;
    const state = siteAudit.briefPhrasing || {};
    const status = state.status || "deterministic";
    kicker.textContent = BRIEF_PROVENANCE[status] || BRIEF_PROVENANCE.deterministic;
    // Why, not just what. A brief that says only "grounded in scan evidence"
    // after a failed request reads exactly like one where AI was never asked.
    const reason = status === "unavailable" ? briefUnavailableReason(state.code) : "";
    if (reason) kicker.textContent += ` · ${reason}`;
    // The code is kept whether or not it is shown, so an operator who goes
    // looking for why can still find it without it shouting from the page.
    kicker.title = state.code
      ? `${state.code}${state.message ? ": " + state.message : ""}${reason ? "" : " (no model is configured; this is not an error)"}`
      : "";
    // Working, and visibly so. Without this the pending state is a line of text
    // that looks the same as a finished one.
    const spinner = siteAudit.shadow.querySelector(".brief-kicker .work-dot");
    if (spinner) spinner.hidden = status !== "pending";
  }
  function renderLumenBrief(groups, audit) {
    const shadow = siteAudit.shadow;
    const section = shadow.querySelector('.brief');
    if (!section) return;
    const deterministic = composeLumenBrief(groups, audit);
    // An accepted phrasing replaces the words and nothing else; the ranking,
    // counts, severity and confidence in it came from composeLumenBrief.
    const phrased = siteAudit.briefPhrasing?.status === "model" ? siteAudit.briefPhrasing.brief : null;
    const brief = phrased || deterministic;
    siteAudit.brief = brief;
    if (!brief.groups.length) { section.hidden = true; return; }
    section.hidden = false;
    shadow.querySelector('.brief-summary').textContent = brief.summary;
    renderBriefProvenance();
    if (!phrased) requestBriefPhrasing(deterministic, audit);
    shadow.querySelector('.brief-scope').textContent =
      `${brief.groups.length} priority group${brief.groups.length === 1 ? '' : 's'}, ranked from ${brief.totalInstances} finding${brief.totalInstances === 1 ? '' : 's'} across the ${brief.fetched} page${brief.fetched === 1 ? '' : 's'} actually analysed.`;

    const list = shadow.querySelector('.brief-list');
    list.innerHTML = '';
    if (siteAudit.briefSelected == null || siteAudit.briefSelected >= brief.groups.length) siteAudit.briefSelected = 0;
    brief.groups.forEach((group, i) => {
      const li = document.createElement('li');
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = `brief-item${i === siteAudit.briefSelected ? ' active' : ''}`;
      const rank = document.createElement('span');
      rank.className = 'brief-rank';
      rank.textContent = String(i + 1).padStart(2, '0');
      const body = document.createElement('span');
      body.className = 'brief-item-body';
      const title = document.createElement('span');
      title.className = 'brief-item-title';
      title.textContent = group.title;
      const meta = document.createElement('span');
      meta.className = 'brief-item-meta';
      const sev = severityPill(group.severity);
      const where = document.createElement('span');
      where.textContent = `${SITE_AUDIT_AREA_LABEL[group.area] || group.area} · ${group.leadConfirmed ? 'confirmed' : group.sitewide ? 'repeated pattern' : `${group.rules.length} pattern${group.rules.length === 1 ? '' : 's'}`}`;
      meta.append(sev, where);
      body.append(title, meta);
      const pages = document.createElement('span');
      pages.className = 'brief-item-pages';
      pages.innerHTML = '';
      // The count describes the rule the row is titled by, not the widest rule
      // in the area — "Repair confirmed broken destinations · 14 pages" beside
      // two confirmed broken links is a number nobody can act on.
      const shown = group.leadPages || group.pages;
      const n = document.createElement('b');
      n.textContent = String(shown);
      const word = document.createElement('span');
      word.textContent = shown === 1 ? 'page' : 'pages';
      pages.append(n, word);
      btn.append(rank, body, pages);
      btn.addEventListener('click', () => { siteAudit.briefSelected = i; renderLumenBrief(groups, audit); });
      li.appendChild(btn);
      list.appendChild(li);
    });
    renderBriefDetail(brief.groups[siteAudit.briefSelected]);
  }

  function renderBriefDetail(group) {
    const pane = siteAudit.shadow.querySelector('.brief-detail');
    if (!pane || !group) return;
    pane.innerHTML = '';
    const badges = document.createElement('div');
    badges.className = 'brief-badges';
    const priority = severityPill(group.severity, `${sentenceCase(group.severity)} priority`);
    const evidence = document.createElement('span');
    evidence.className = 'pill signal-badge';
    evidence.dataset.tone = group.leadConfirmed ? 'ok' : 'warn';
    evidence.textContent = sentenceCase(group.lead?.confidence || 'inferred');
    badges.append(priority, evidence);

    const h = document.createElement('h4');
    h.textContent = findingLabel(group.lead);
    const why = document.createElement('p');
    why.className = 'brief-why';
    why.textContent = briefRationale(group);

    const box = document.createElement('div');
    box.className = 'evidence-box';
    const label = document.createElement('span');
    label.className = 'evidence-label';
    label.textContent = 'Scanner evidence';
    const facts = document.createElement('dl');
    facts.className = 'evidence-facts';
    // The evidence box describes the rule this pane is titled by. Group totals
    // belong to the action below it, which says which scope it opens.
    const rows = [
      ['Findings', String(Number(group.lead?.instances || 0))],
      ['Pages', String(group.leadPages || 0)],
      ['Confidence', String(group.lead?.confidence || 'inferred')]
    ];
    for (const [k, v] of rows) {
      const pair = document.createElement('div');
      const dt = document.createElement('dt');
      dt.textContent = k;
      const dd = document.createElement('dd');
      dd.textContent = v;
      pair.append(dt, dd);
      facts.appendChild(pair);
    }
    box.append(label, facts);

    const actions = document.createElement('div');
    actions.className = 'actions';
    const open = document.createElement('button');
    open.type = 'button';
    open.className = 'btn primary';
    open.textContent = `Open all ${group.instances} in ${SITE_AUDIT_AREA_LABEL[group.area] || group.area}`;
    open.addEventListener('click', () => {
      // Narrow Findings to this group's area and show the control doing it.
      siteAudit.findingsSearch = '';
      siteAudit.findingsCategory = '';
      siteAudit.findingsImpactClass = group.area;
      const search = siteAudit.shadow.querySelector('.findings-search');
      if (search) search.value = '';
      switchSiteAuditTab('findings');
    });
    actions.appendChild(open);
    pane.append(badges, h, why, box, actions);
  }

  /** Finding mix: the severity split and the patterns behind it. */
  function renderFindingMix(groups, audit) {
    const shadow = siteAudit.shadow;
    const card = shadow.querySelector('.mix-card');
    if (!card) return;
    const total = groups.reduce((n, g) => n + Number(g.instances || 0), 0);
    card.hidden = !groups.length;
    if (!groups.length) return;
    shadow.querySelector('.mix-scope').textContent =
      `${total} observation${total === 1 ? '' : 's'} across ${groups.length} distinct pattern${groups.length === 1 ? '' : 's'}.`;
    renderSeverityBar(groups);
  }
  const SITE_AUDIT_HTTP_CLASSES = [
    { id: '2xx', label: '2xx Success', tone: 'ok', min: 200, max: 299 },
    { id: '3xx', label: '3xx Redirect', tone: 'warn', min: 300, max: 399 },
    { id: '4xx', label: '4xx Not found', tone: 'attention', min: 400, max: 499 },
    { id: '5xx', label: '5xx Server error', tone: 'attention', min: 500, max: 599 }
  ];

  /**
   * The two distributions Sitebulb's overview leads with and Lumen had
   * nowhere: how deep the crawl went, and what the site answered.
   *
   * Depth is drawn across every *discovered* URL, not just fetched ones, with
   * the never-reached share hatched — on a page-limited crawl "31 URLs found
   * at depth 3, none of them reached" is the single most useful sentence on
   * this screen, and a fetched-only chart would silently omit it.
   */
  function renderCrawlShape() {
    const shadow = siteAudit.shadow;
    const grid = shadow.querySelector('.crawl-shape');
    if (!grid) return;
    grid.innerHTML = '';
    const d = siteAudit.distributions;
    if (!d) { grid.hidden = true; return; }
    grid.hidden = false;

    const byDepth = new Map();
    let unrecorded = 0;
    for (const row of d.depth || []) {
      if (row.depth === null) { unrecorded += row.n; continue; }
      const entry = byDepth.get(row.depth) || { reached: 0, gap: 0 };
      if (row.status === 'fetched') entry.reached += row.n;
      else entry.gap += row.n;
      byDepth.set(row.depth, entry);
    }
    const depthRows = [...byDepth.entries()].sort((a, b) => a[0] - b[0]).map(([depth, entry]) => ({
      label: depth === 0 ? 'Start and sitemap' : `${depth} hop${depth === 1 ? '' : 's'} in`,
      n: entry.reached + entry.gap,
      sub: `${entry.reached} reached, ${entry.gap} not`,
      segments: [{ n: entry.reached, tone: 'default' }, { n: entry.gap, tone: 'gap' }],
      open: () => openUrlsScoped({ depth }),
      openLabel: `View the pages discovered ${depth} link hop${depth === 1 ? '' : 's'} from the start URL`
    }));
    if (unrecorded) {
      // An audit run before depth was recorded. Saying so is better than
      // drawing those pages as if they sat at the start URL.
      depthRows.push({ label: 'Not recorded', n: unrecorded, tone: 'gap', sub: 'crawled before depth was stored' });
    }
    grid.appendChild(distBlock({
      title: 'Crawl depth',
      note: 'Link hops from the start URL, across every URL this crawl discovered. The hatched part of a bar was found but never fetched.',
      totalLabel: `${depthRows.reduce((n, r) => n + r.n, 0)} URL${depthRows.reduce((n, r) => n + r.n, 0) === 1 ? '' : 's'}`,
      rows: depthRows,
      empty: 'No URL was discovered.'
    }));

    const status = d.httpStatus || [];
    const total = status.reduce((n, r) => n + r.n, 0);
    const statusRows = SITE_AUDIT_HTTP_CLASSES.map((cls) => {
      const inClass = status.filter((r) => r.status >= cls.min && r.status <= cls.max);
      const n = inClass.reduce((sum, r) => sum + r.n, 0);
      return {
        label: cls.label,
        n,
        tone: cls.tone,
        sub: inClass.map((r) => `${r.status}: ${r.n}`).join(', '),
        // All four classes stay on screen even at zero. There are only four of
        // them and each is a fact worth stating: "no 4xx among the fetched
        // pages" is the reassurance a dropped row would leave unsaid, and a
        // one-row chart is not a distribution.
        always: true,
        open: n ? () => openUrlsScoped({ httpClass: cls.id }) : null,
        openLabel: `View the pages that answered ${cls.id}`
      };
    });
    grid.appendChild(distBlock({
      title: 'What the site answered',
      note: total ? 'The HTTP status each fetched URL returned. Hover a row for the exact codes behind it.' : '',
      totalLabel: `${total} response${total === 1 ? '' : 's'}`,
      rows: statusRows,
      empty: 'No response was recorded: no URL was fetched.'
    }));

    // Third in the same row rather than alone in a grid of its own: all three
    // answer "what did this crawl actually cover", and all three are short.
    grid.appendChild(buildCoverageCard(siteAudit.audit || {}, siteAudit.audit?.urlCounts || {}));
  }

  // --- Discipline section rendering -----------------------------------------

  /**
   * The finding groups belonging to one discipline, ranked. Groups arrive
   * split by confidence (the store groups by rule_id + confidence), so a rule
   * with both confirmed and inferred instances legitimately appears twice.
   *
   * The store returns them by instance count, which is the wrong order for a
   * report: on a rate-limiting site one unverifiable-destination group with
   * 3,519 instances led Availability while 38 confirmed 404s sat below it.
   * Severity first, then how many pages are affected — the same ranking the
   * Findings tab and the exported report already use, so no discipline can buy
   * the top of its own section with volume.
   */
  function disciplineGroups(id) {
    const rank = { critical: 0, high: 1, medium: 2, low: 3, info: 4 };
    return (siteAudit.rawFindingGroups || [])
      .filter((g) => disciplineOf(g.rule_id) === id)
      .sort((a, b) =>
        (rank[a.severity] ?? 9) - (rank[b.severity] ?? 9) ||
        // Established evidence outranks a group that could not be settled.
        Number(a.confidence === 'inconclusive') - Number(b.confidence === 'inconclusive') ||
        (b.affected_urls || 0) - (a.affected_urls || 0) ||
        (b.instances || 0) - (a.instances || 0));
  }

  /** Total instances across groups matching a rule pattern. For the per-page
   * rules these tiles use (one finding per page per rule), instances and pages
   * are the same number; the tile's sub-label states the denominator so the
   * figure is never read as a site-wide claim. */
  function ruleInstances(pattern) {
    return (siteAudit.rawFindingGroups || [])
      .filter((g) => pattern.test(String(g.rule_id || '')))
      .reduce((n, g) => n + Number(g.instances || 0), 0);
  }

  /** Whether a discipline's evidence tier actually ran. This is the whole
   * difference between "Observed" and "Not established", so it reads the
   * collection facts directly rather than inferring from an empty list. */
  function disciplineEstablished(id) {
    const audit = siteAudit.audit || {};
    const fetched = Number(audit.urlCounts?.fetched || 0);
    switch (SITE_AUDIT_DISCIPLINE_META[id]?.evidence) {
      case 'render': return Number(audit.renderProgress?.rendered || 0) > 0;
      case 'links': return Object.values(audit.linkCounts || {}).some((n) => Number(n) > 0);
      case 'signals': return Boolean(audit.stats?.siteSignals);
      default: return fetched > 0;
    }
  }

  /**
   * Three states, the same vocabulary the Site conditions readout uses.
   *
   * `attention` requires either a finding this audit would actually ask
   * someone to fix, or a section whose own coverage statement already says
   * something is wrong. The second half matters: the Sitemaps section can be
   * in trouble ("no sitemap could be read") with no finding attached to any
   * single page, and a green dot beside that statement would contradict it.
   *
   * The count deliberately excludes `inconclusive` findings. On a site that
   * rate-limits automated requests, one unverifiable-destination group can
   * carry thousands of instances and would make Availability's chip read
   * "3.6k" when 40 links are actually broken — volume drowning the number the
   * operator needs. The unverified figure is stated in the section's own
   * coverage line, where it belongs, as coverage rather than as defects.
   */
  function disciplineState(id) {
    const groups = disciplineGroups(id);
    const count = groups
      .filter((g) => g.confidence !== 'inconclusive')
      .reduce((n, g) => n + Number(g.instances || 0), 0);
    if (!disciplineEstablished(id)) return { state: 'unknown', count };
    const actionable = groups.some((g) => g.category === 'fix' || g.severity === 'critical' || g.severity === 'high');
    let coverageState = '';
    try { coverageState = SITE_AUDIT_SECTION_BUILDERS[id]?.().coverage?.state || ''; } catch { coverageState = ''; }
    if (coverageState === 'unknown') return { state: 'unknown', count };
    return { state: actionable || coverageState === 'attention' ? 'attention' : 'ok', count };
  }

  const SITE_AUDIT_STATE_WORD = { ok: 'Observed', attention: 'Needs attention', unknown: 'Not established' };
  const fmtCount = (n) => (n > 999 ? `${Math.round(n / 100) / 10}k` : String(n));

  /**
   * Every nav row carries what it can say about itself.
   *
   * Overview says nothing — it is the summary of everything else. Findings,
   * Pages and Links carry counts, because they are inventories. Browser checks
   * carries a state, because the honest answer there is usually "not run", and
   * a count of zero would read as a clean result.
   */
  function renderNavStates() {
    const shadow = siteAudit.shadow;
    const audit = siteAudit.audit || {};
    const counts = audit.urlCounts || {};
    const linkTotal = Object.values(audit.linkCounts || {}).reduce((s, n) => s + Number(n || 0), 0);
    const rp = audit.renderProgress || {};
    const rendered = Number(rp.rendered || 0);
    const renderTotal = Number(rp.total || 0);
    for (const btn of shadow.querySelectorAll('.tab')) {
      const id = btn.dataset.tab;
      const chip = btn.querySelector('.tab-state');
      if (!chip) continue;
      const dot = chip.querySelector('.tab-dot');
      const num = chip.querySelector('.tab-num');
      if (id === 'browser') {
        chip.hidden = false;
        dot.hidden = false;
        chip.dataset.state = !renderTotal ? 'unknown' : rendered === 0 ? 'unknown' : rendered < renderTotal ? 'attention' : 'ok';
        num.textContent = !renderTotal ? '–' : rendered === 0 ? 'Not run' : rendered < renderTotal ? `${rendered}/${renderTotal}` : 'Done';
        btn.title = rendered === 0
          ? 'Accessibility, JavaScript and performance have not been measured on this site'
          : `${rendered} of ${renderTotal} pages checked in this browser`;
        continue;
      }
      // The number beside a destination is how many rows it opens on.
      const discovered = Object.values(counts).reduce((n, v) => n + Number(v || 0), 0);
      const observations = Number(audit.findingsCount || 0);
      const groups = siteAudit.rawFindingGroups;
      // Findings opens on a table of patterns, not of observations. Until the
      // groups have landed the raw count is the only honest answer.
      const patterns = Array.isArray(groups) ? groups.length : observations;
      // Structured data counts what is wrong, not how many items exist. The
      // inventory size is a fact about the site; the number beside a destination
      // is a reason to open it. Opportunities are deliberately excluded — they
      // are inferences, and a badge in the navigation is read as a defect count.
      const schemaFaults = siteAudit.schema ? siteAudit.schema.errors.length + siteAudit.schema.conflicts.length : null;
      const plain = { findings: patterns, urls: discovered, links: linkTotal, schema: schemaFaults }[id];
      if (plain === undefined || plain === null) { chip.hidden = true; continue; }
      chip.hidden = false;
      delete chip.dataset.state;
      dot.hidden = true;
      if (id === 'schema') {
        chip.dataset.state = plain ? 'attention' : 'ok';
        dot.hidden = false;
        btn.title = plain
          ? `${plain} confirmed structured-data fault${plain === 1 ? '' : 's'}`
          : 'No validation errors or entity conflicts in the items that were parsed';
      }
      num.textContent = fmtCount(plain);
      if (id === "findings" && Array.isArray(groups) && observations !== patterns) {
        btn.title = `${observations} observations grouped into ${patterns} issue patterns`;
      } else {
        btn.removeAttribute("title");
      }
    }
    renderSubnavCounts();
  }

  /** Sub-view rows carry the size of the scope behind them, so an operator can
   * see there are 40 broken links without opening the view to find out. */
  function renderSubnavCounts() {
    const shadow = siteAudit.shadow;
    const audit = siteAudit.audit || {};
    const counts = audit.urlCounts || {};
    const links = audit.linkCounts || {};
    const pages = siteAudit.distributions?.pages || {};
    const sizes = {
      // Every discovered URL, because that is what the unscoped table lists.
      'urls:all': Object.values(counts).reduce((n, v) => n + Number(v || 0), 0),
      'urls:gaps': ['queued', 'error', 'skipped'].reduce((n, k) => n + Number(counts[k] || 0), 0),
      'urls:noindex': Number(pages.noindex || 0),
      'urls:errors': Number(counts.error || 0),
      'links:all': Object.values(links).reduce((s, n) => s + Number(n || 0), 0),
      'links:broken': Number(links.broken || 0),
      'links:blocked': Number(links.blocked || 0),
      'links:inconclusive': Number(links.inconclusive || 0),
      'links:healthy': Number(links.healthy || 0)
    };
    for (const btn of shadow.querySelectorAll('.subnav-item')) {
      const size = sizes[`${btn.dataset.tab}:${btn.dataset.view}`];
      const label = (SITE_AUDIT_SUBVIEWS[btn.dataset.tab] || []).find((v) => v.id === btn.dataset.view)?.label || '';
      btn.textContent = '';
      const name = document.createElement('span');
      name.textContent = label;
      const count = document.createElement('span');
      count.className = 'subnav-count';
      count.textContent = size === undefined ? '' : fmtCount(size);
      btn.append(name, count);
      // A scope with nothing behind it stays visible but stops inviting a
      // click into an empty table.
      btn.disabled = size === 0 && btn.dataset.view !== 'all';
    }
  }

  /**
   * Browser checks: the render pass and the two disciplines that depend on it.
   *
   * Zero rendered pages is not a clean accessibility result, so this view
   * leads with the pass itself and states the gap before it shows anything.
   */
  function renderBrowserChecks() {
    const shadow = siteAudit.shadow;
    const host = shadow.querySelector('.browser-host');
    const blocks = shadow.querySelector('.browser-blocks');
    if (!host || !blocks) return;
    // The render panel is one element and lives on the Overview; it is moved
    // here rather than duplicated, so there is one of it in the DOM.
    const panel = shadow.querySelector('.render-section');
    if (panel && panel.parentElement !== host) host.appendChild(panel);
    if (panel) renderSiteAuditRenderSection(siteAudit.audit || {});

    const groups = [...disciplineGroups('performance'), ...disciplineGroups('accessibility')];
    const rp = siteAudit.audit?.renderProgress || {};
    const rendered = Number(rp.rendered || 0);
    blocks.innerHTML = '';
    for (const id of ['performance', 'accessibility']) {
      const built = SITE_AUDIT_SECTION_BUILDERS[id] ? SITE_AUDIT_SECTION_BUILDERS[id]() : null;
      if (!built) continue;
      const card = document.createElement('section');
      card.className = 'dist';
      const head = document.createElement('div');
      head.className = 'dist-head';
      const h3 = document.createElement('h3');
      h3.textContent = SITE_AUDIT_DISCIPLINE_META[id] ? (id === 'performance' ? 'Performance' : 'Accessibility') : id;
      head.appendChild(h3);
      card.appendChild(head);
      const note = document.createElement('p');
      note.className = 'dist-note';
      note.textContent = String(built.coverage?.text || '').replace(/<[^>]*>/g, '');
      card.appendChild(note);
      const stats = document.createElement('dl');
      stats.className = 'section-stats';
      for (const tile of built.tiles || []) stats.appendChild(sectionTile(tile));
      if ((built.tiles || []).length) card.appendChild(stats);
      blocks.appendChild(card);
    }
    shadow.querySelector('.browser-panel .section-findings-note').textContent =
      rendered ? `From the ${rendered} page${rendered === 1 ? '' : 's'} opened in this browser.` : 'None yet: the pass has not run.';
    renderFindingRowsInto(
      shadow.querySelector('.browser-findings-list'),
      groups,
      rendered ? 'Nothing was flagged on the pages checked in this browser.' : 'Nothing here has been measured yet, so there is nothing to report either way.'
    );
  }

  // --- Small presentational builders ---------------------------------------

  /** A figure tile. `open` is omitted when nothing can be opened, and then the
   * tile renders with no arrow and no hover affordance rather than advertising
   * a drill-in that would go nowhere. */
  function sectionTile({ label, value, sub = '', open = null, openLabel = '' }) {
    const wrap = document.createElement('div');
    wrap.className = 'stat-tile';
    const dt = document.createElement('dt');
    dt.textContent = label;
    const dd = document.createElement('dd');
    dd.textContent = typeof value === 'number' ? fmtCount(value) : String(value);
    wrap.append(dt, dd);
    if (sub) {
      const span = document.createElement('span');
      span.className = 'stat-sub';
      span.textContent = sub;
      wrap.appendChild(span);
    }
    if (open && Number(value) > 0) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'stat-open';
      const sr = document.createElement('span');
      sr.className = 'sr-only';
      sr.textContent = openLabel || `View the rows behind ${label}`;
      btn.appendChild(sr);
      btn.addEventListener('click', open);
      wrap.appendChild(btn);
    }
    return wrap;
  }

  /**
   * One distribution, as labelled bar rows.
   *
   * `rows` are `{ label, n, tone, sub, open }`. Bars are scaled against the
   * largest row rather than the total, because the interesting distributions
   * here are lopsided (one depth level usually holds most of a site) and a
   * total-scaled bar would flatten every other row into invisibility.
   */
  function distBlock({ title, note = '', rows = [], totalLabel = '', empty = 'Nothing to distribute here.' }) {
    const box = document.createElement('section');
    box.className = 'dist';
    const head = document.createElement('div');
    head.className = 'dist-head';
    const h3 = document.createElement('h3');
    h3.textContent = title;
    head.appendChild(h3);
    if (totalLabel) {
      const total = document.createElement('span');
      total.className = 'dist-total';
      total.textContent = totalLabel;
      head.appendChild(total);
    }
    box.appendChild(head);
    if (note) {
      const p = document.createElement('p');
      p.className = 'dist-note';
      p.textContent = note;
      box.appendChild(p);
    }
    const present = rows.filter((r) => Number(r.n || 0) > 0 || r.always);
    if (!present.length) {
      const p = document.createElement('p');
      p.className = 'dist-empty';
      p.textContent = empty;
      box.appendChild(p);
      return box;
    }
    const max = Math.max(...present.map((r) => Number(r.n || 0)), 1);
    const list = document.createElement('ul');
    list.className = 'dist-rows';
    for (const row of present) {
      const li = document.createElement('li');
      const inner = document.createElement(row.open ? 'button' : 'div');
      inner.className = 'dist-row';
      if (row.open) {
        inner.type = 'button';
        inner.title = row.openLabel || `Open the pages behind ${row.label}`;
        inner.addEventListener('click', row.open);
      }
      const label = document.createElement('span');
      label.className = 'dist-label';
      label.textContent = row.label;
      if (row.sub) label.title = row.sub;
      const track = document.createElement('span');
      track.className = 'dist-track';
      // A row may carry a second, hatched segment (pages discovered at this
      // depth that were never reached). Hatch is the survey convention for
      // "outside what was measured" and is never a severity colour.
      for (const seg of row.segments || [{ n: Number(row.n || 0), tone: row.tone }]) {
        if (!Number(seg.n)) continue;
        const fill = document.createElement('span');
        fill.className = `dist-fill${seg.tone ? ` tone-${seg.tone}` : ''}`;
        fill.style.width = `${Math.max(2, (Number(seg.n) / max) * 100)}%`;
        track.appendChild(fill);
      }
      const count = document.createElement('span');
      count.className = 'dist-count';
      count.textContent = fmtCount(Number(row.n || 0));
      inner.append(label, track, count);
      li.appendChild(inner);
      list.appendChild(li);
    }
    box.appendChild(list);
    return box;
  }

  /** Key/value facts that are statements rather than magnitudes: robots.txt,
   * the sitemap record, response-header coverage. Values are set as text, never
   * markup — several of them carry crawl-sourced strings. */
  function readoutBlock({ title, note = '', rows = [] }) {
    const box = document.createElement('section');
    box.className = 'dist';
    const head = document.createElement('div');
    head.className = 'dist-head';
    const h3 = document.createElement('h3');
    h3.textContent = title;
    head.append(h3);
    box.appendChild(head);
    if (note) {
      const p = document.createElement('p');
      p.className = 'dist-note';
      p.textContent = note;
      box.appendChild(p);
    }
    const list = document.createElement('ul');
    list.className = 'readout';
    for (const [key, value] of rows) {
      if (value === null || value === undefined) continue;
      const li = document.createElement('li');
      const k = document.createElement('span');
      k.className = 'ro-key';
      k.textContent = key;
      const v = document.createElement('span');
      v.className = 'ro-val';
      v.textContent = String(value);
      li.append(k, v);
      list.appendChild(li);
    }
    box.appendChild(list);
    return box;
  }

  // --- The sections themselves ---------------------------------------------

  /** Each builder returns `{ coverage, tiles, blocks }`. `coverage` is the
   * section's own statement of what its evidence covers, and it is required —
   * a section that shows figures without saying what they are figures *of* is
   * the mistake the scope banner exists to stop, repeated per section. */
  const SITE_AUDIT_SECTION_BUILDERS = {
    availability() {
      const audit = siteAudit.audit || {};
      const link = audit.linkCounts || {};
      const counts = audit.urlCounts || {};
      const scope = (siteAudit.distributions?.linksByScope) || [];
      const at = (internal, status) => scope.filter((r) => r.internal === internal && r.status === status).reduce((n, r) => n + r.n, 0);
      const total = Object.values(link).reduce((s, n) => s + Number(n || 0), 0);
      const broken = Number(link.broken || 0);
      const unverified = Number(link.inconclusive || 0);
      const unver = audit.stats?.unverifiableExternal;
      const coverage = total
        ? {
          state: broken ? 'attention' : 'ok',
          text: `<b>${total}</b> link destination${total === 1 ? '' : 's'} were requested independently of the page that linked to ${total === 1 ? 'it' : 'them'}. <b>${broken}</b> confirmed broken, <b>${unverified}</b> could not be verified either way.`,
          extra: unver?.destinationCount
            ? `${unver.destinationCount} external destination${unver.destinationCount === 1 ? '' : 's'} on ${unver.hosts.join(', ')} refuse automated requests. That says nothing about whether those links work.`
            : ''
        }
        : { state: 'unknown', text: 'No link destination was verified in this audit, so nothing here can be said about whether this site’s links resolve.' };
      const tiles = [
        { label: 'Broken links', value: broken, sub: broken ? 'confirmed missing or erroring' : 'none confirmed', open: () => openLinksWithStatus('broken') },
        { label: 'Blocked', value: Number(link.blocked || 0), sub: 'refused the request', open: () => openLinksWithStatus('blocked') },
        { label: 'Unverified', value: unverified, sub: 'not counted as broken', open: () => openLinksWithStatus('inconclusive') },
        { label: 'Pages that failed', value: Number(counts.error || 0), sub: 'could not be fetched at all', open: () => openUrlsScoped({ statuses: 'error' }) }
      ];
      const rowsFor = (internal) => [
        { label: 'Healthy', n: at(internal, 'healthy'), tone: 'ok' },
        { label: 'Broken', n: at(internal, 'broken'), tone: 'attention' },
        { label: 'Blocked', n: at(internal, 'blocked'), tone: 'warn' },
        { label: 'Not verified', n: at(internal, 'inconclusive'), tone: 'gap' },
        { label: 'Unknown', n: at(internal, 'unknown'), tone: 'quiet' }
      ];
      const internalTotal = rowsFor(true).reduce((n, r) => n + r.n, 0);
      const externalTotal = rowsFor(false).reduce((n, r) => n + r.n, 0);
      return {
        coverage,
        tiles,
        blocks: () => [
          distBlock({
            title: 'Internal destinations',
            note: 'Links to this site. A broken one is this site’s own defect.',
            totalLabel: `${internalTotal} link${internalTotal === 1 ? '' : 's'}`,
            rows: rowsFor(true),
            empty: 'No internal link was recorded.'
          }),
          distBlock({
            title: 'External destinations',
            note: 'Links off this site. A broken one is someone else’s outage plus a stale link here.',
            totalLabel: `${externalTotal} link${externalTotal === 1 ? '' : 's'}`,
            rows: rowsFor(false),
            empty: 'No external link was recorded.'
          })
        ]
      };
    },

    indexability() {
      const d = siteAudit.distributions || {};
      const pages = d.pages || {};
      const canonical = d.canonical || {};
      const fetched = Number(pages.fetched || 0);
      const signals = siteAudit.audit?.stats?.siteSignals || null;
      const robots = signals?.robots || null;
      const coverage = fetched
        ? { state: Number(pages.noindex || 0) || canonical.missing ? 'attention' : 'ok', text: `Read from the static HTML of <b>${fetched}</b> fetched page${fetched === 1 ? '' : 's'}. Directives injected by JavaScript are not visible to this tier.` }
        : { state: 'unknown', text: 'No page was fetched, so no indexability directive was read.' };
      return {
        coverage,
        // Both indexability tiles open the pages behind them. An aggregate an
        // operator cannot check against actual rows is an assertion, not a
        // report — and the Pages table now carries the per-page answer.
        tiles: [
          { label: 'Indexable', value: Number(pages.indexable || 0), sub: fetched ? `of ${fetched} fetched pages` : '', open: () => openUrlsScoped({ indexable: 'yes' }), openLabel: 'View the indexable pages' },
          { label: 'noindex', value: Number(pages.noindex || 0), sub: 'excluded from search results', open: () => openUrlsScoped({ indexable: 'no' }), openLabel: 'View the pages that ask not to be indexed' },
          { label: 'Redirected', value: Number(pages.redirected || 0), sub: 'resolved to a different URL' },
          { label: 'No canonical', value: Number(canonical.missing || 0), sub: 'declare none at all' }
        ],
        blocks: () => [
          distBlock({
            title: 'Canonical declarations',
            note: 'Compared literally, tolerating only a trailing slash. A canonical pointing elsewhere is normal on a deliberate duplicate and wrong everywhere else.',
            totalLabel: `${fetched} page${fetched === 1 ? '' : 's'}`,
            rows: [
              { label: 'Self-referencing', n: Number(canonical.self || 0), tone: 'ok' },
              { label: 'Points elsewhere', n: Number(canonical.other || 0), tone: 'warn' },
              { label: 'Missing', n: Number(canonical.missing || 0), tone: 'attention', always: true }
            ],
            empty: 'No page was fetched.'
          }),
          robots
            ? readoutBlock({
              title: 'robots.txt',
              note: 'Collected independently of whether this crawl obeyed it.',
              rows: [
                ['Present', robots.present === true ? `Yes (HTTP ${robots.status})` : robots.present === false ? `No (HTTP ${robots.status})` : 'Could not be read'],
                ['Site-wide block', robots.present === true ? (robots.blocksEverything ? 'Yes, Disallow: / for all agents' : 'No') : null],
                ['Disallow rules', robots.present === true ? robots.disallowCount : null],
                ['Sitemaps declared', robots.present === true ? (robots.sitemaps?.length ? robots.sitemaps.join(', ') : 'None') : null],
                ['Confidence', robots.confidence]
              ]
            })
            // "Not checked" was wrong twice over: robots.txt is fetched before
            // the crawl starts, and while a crawl runs the answer simply has
            // not been read back yet. A pending check is not a skipped one.
            : readoutBlock({ title: 'robots.txt', rows: [['Present', siteAudit.audit?.status === 'running' ? 'Being fetched; this audit reads it before it crawls' : 'Not checked in this audit']] })
        ]
      };
    },

    content() {
      const d = siteAudit.distributions || {};
      const pages = d.pages || {};
      const fetched = Number(pages.fetched || 0);
      const title = pages.title || {};
      const desc = pages.description || {};
      const h1 = pages.h1 || {};
      const words = pages.words || {};
      const coverage = fetched
        ? { state: (title.missing || desc.missing || h1.none) ? 'attention' : 'ok', text: `Measured on the static HTML of <b>${fetched}</b> fetched page${fetched === 1 ? '' : 's'}. Length bands use the same cuts as the findings beside them.` }
        : { state: 'unknown', text: 'No page was fetched, so nothing on-page was measured.' };
      return {
        coverage,
        tiles: [
          { label: 'No title', value: Number(title.missing || 0), sub: fetched ? `of ${fetched} fetched pages` : '' },
          { label: 'No description', value: Number(desc.missing || 0), sub: fetched ? `of ${fetched} fetched pages` : '' },
          { label: 'No H1', value: Number(h1.none || 0), sub: 'no main heading' },
          { label: 'Thin pages', value: Number(words.thin || 0), sub: 'under 150 words' }
        ],
        blocks: () => [
          distBlock({
            title: 'Title length',
            note: 'Under 15 characters under-describes the page; over 65 is truncated in most search results.',
            totalLabel: `${fetched} page${fetched === 1 ? '' : 's'}`,
            rows: [
              { label: 'Missing', n: Number(title.missing || 0), tone: 'attention', always: true },
              { label: 'Under 15', n: Number(title.short || 0), tone: 'warn' },
              { label: '15 to 65', n: Number(title.ok || 0), tone: 'ok' },
              { label: 'Over 65', n: Number(title.long || 0), tone: 'warn' }
            ]
          }),
          distBlock({
            title: 'Meta description length',
            note: 'Under 50 characters gives search engines little to work with; over 160 is truncated.',
            totalLabel: `${fetched} page${fetched === 1 ? '' : 's'}`,
            rows: [
              { label: 'Missing', n: Number(desc.missing || 0), tone: 'attention', always: true },
              { label: 'Under 50', n: Number(desc.short || 0), tone: 'warn' },
              { label: '50 to 160', n: Number(desc.ok || 0), tone: 'ok' },
              { label: 'Over 160', n: Number(desc.long || 0), tone: 'warn' }
            ]
          }),
          distBlock({
            title: 'H1 headings per page',
            totalLabel: `${fetched} page${fetched === 1 ? '' : 's'}`,
            rows: [
              { label: 'None', n: Number(h1.none || 0), tone: 'attention', always: true },
              { label: 'Exactly one', n: Number(h1.one || 0), tone: 'ok' },
              { label: 'More than one', n: Number(h1.many || 0), tone: 'warn' },
              { label: 'Not recorded', n: Number(h1.unknown || 0), tone: 'gap' }
            ]
          }),
          distBlock({
            title: 'Body length',
            note: 'Word counts from the static HTML, so a page that builds its body in JavaScript reads as thin here.',
            totalLabel: `${fetched} page${fetched === 1 ? '' : 's'}`,
            rows: [
              { label: 'Under 150', n: Number(words.thin || 0), tone: 'warn' },
              { label: '150 to 499', n: Number(words.short || 0), tone: 'ok' },
              { label: '500 to 999', n: Number(words.medium || 0), tone: 'ok' },
              { label: '1000 or more', n: Number(words.long || 0), tone: 'ok' },
              { label: 'Not recorded', n: Number(words.unknown || 0), tone: 'gap' }
            ]
          })
        ]
      };
    },

    duplicates() {
      const d = siteAudit.distributions || {};
      const dup = d.duplicates || {};
      const fetched = Number(d.pages?.fetched || 0);
      const sets = (list) => (list || []).length;
      const pagesIn = (list) => (list || []).reduce((n, r) => n + r.pages, 0);
      const totalSets = sets(dup.titles) + sets(dup.descriptions) + sets(dup.h1s);
      const coverage = fetched
        ? {
          state: totalSets ? 'attention' : 'ok',
          text: `Compared across the <b>${fetched}</b> fetched page${fetched === 1 ? '' : 's'}.`,
          extra: 'A page the crawl never reached cannot appear in a duplicate set found here. The tables below list up to 25 sets of each kind, largest first.'
        }
        : { state: 'unknown', text: 'Fewer than one page was fetched, so nothing could be compared.' };
      const table = (title, rows, what) => {
        const box = document.createElement('section');
        box.className = 'dist';
        const head = document.createElement('div');
        head.className = 'dist-head';
        const h3 = document.createElement('h3');
        h3.textContent = title;
        head.appendChild(h3);
        box.appendChild(head);
        if (!rows?.length) {
          const p = document.createElement('p');
          p.className = 'dist-empty';
          p.textContent = `No ${what} is shared by more than one crawled page.`;
          box.appendChild(p);
          return box;
        }
        const tbl = document.createElement('table');
        tbl.className = 'data-table dup-table';
        tbl.innerHTML = '<thead><tr><th>Shared value</th><th class="col-status">Pages</th></tr></thead>';
        const body = document.createElement('tbody');
        for (const row of rows) {
          const tr = document.createElement('tr');
          const value = document.createElement('td');
          value.className = 'dup-value';
          // Crawl-sourced text: set, never interpolated.
          value.textContent = row.value.length > 160 ? `${row.value.slice(0, 160)}…` : row.value;
          const n = document.createElement('td');
          n.className = 'col-status';
          n.textContent = String(row.pages);
          tr.append(value, n);
          body.appendChild(tr);
        }
        tbl.appendChild(body);
        box.appendChild(tbl);
        return box;
      };
      return {
        coverage,
        tiles: [
          { label: 'Duplicate titles', value: sets(dup.titles), sub: `${pagesIn(dup.titles)} page${pagesIn(dup.titles) === 1 ? '' : 's'} involved` },
          { label: 'Duplicate descriptions', value: sets(dup.descriptions), sub: `${pagesIn(dup.descriptions)} page${pagesIn(dup.descriptions) === 1 ? '' : 's'} involved` },
          { label: 'Duplicate H1s', value: sets(dup.h1s), sub: `${pagesIn(dup.h1s)} page${pagesIn(dup.h1s) === 1 ? '' : 's'} involved` }
        ],
        blocks: () => [
          table('Titles shared by more than one page', dup.titles, 'title'),
          table('Descriptions shared by more than one page', dup.descriptions, 'meta description'),
          table('H1s shared by more than one page', dup.h1s, 'H1')
        ]
      };
    },

    sitemaps() {
      const audit = siteAudit.audit || {};
      const signals = audit.stats?.siteSignals || null;
      const sitemap = signals?.sitemap || null;
      const robots = signals?.robots || null;
      const running = audit.status === 'running';
      const orphan = ruleInstances(/^seo\.sitemap-orphan/);
      const unreached = ruleInstances(/^seo\.sitemap-unreached/);
      const blocked = ruleInstances(/^seo\.sitemap-blocked-by-robots/);
      // "Never reached" is only computed when the crawl exhausted its frontier
      // on its own (packages/crawl/scanners/seo.js gates it on maxPagesReached),
      // because otherwise "unreached" just means "not gotten to yet". The check
      // is correctly withheld — but this tile used to render that silence as a
      // confident 0, which reports a coverage gap as agreement. On any crawl
      // that hits its page limit, which is most of them.
      const reconciled = Boolean(sitemap?.present) && !sitemap.truncated && !pageLimitStopped(audit) && !running;
      const withheldReason = !sitemap?.present ? ''
        : running ? 'the crawl is still running'
          : sitemap.truncated ? 'the sitemap is longer than this audit reads'
            : pageLimitStopped(audit) ? 'the page limit stopped the crawl first'
              : '';
      const coverage = !signals
        ? {
          state: 'unknown',
          text: running
            ? 'The sitemap is being fetched. This audit reads it before it crawls.'
            : 'Site signals were not collected for this audit, so the presence of a sitemap was never established.'
        }
        : sitemap?.present
          ? {
            // Reading the sitemap is itself an established fact — 106 URLs is
            // not "not established". Only the comparison against the crawl was
            // withheld, and the coverage sentence and the em-dash tile below
            // both say so. Marking the whole section unknown overstated the gap.
            state: (orphan || unreached || blocked) ? 'attention' : 'ok',
            text: `Read <b>${Number(sitemap.urlCount || 0)}</b> URL${Number(sitemap.urlCount) === 1 ? '' : 's'} from the sitemap.`,
            extra: reconciled
              ? 'Every one of them was compared against what the crawl reached.'
              : `They have not been compared against the crawl, because ${withheldReason}. Sitemap URLs the crawl never got to are not evidence of a problem, so this audit does not report any.`
          }
          : { state: 'attention', text: 'No sitemap could be read, so discovery depends entirely on internal linking.' };
      return {
        coverage,
        // With no sitemap read there is nothing to reconcile, and four zero
        // tiles would only restate the coverage line above them.
        tiles: sitemap?.present
          ? [
            { label: 'Sitemap URLs', value: Number(sitemap.urlCount || 0), sub: sitemap.truncated ? 'read up to this audit’s cap' : 'listed by the site' },
            { label: 'Not in the sitemap', value: orphan, sub: 'crawled but unlisted' },
            // An em-dash, never a zero: this comparison did not run.
            reconciled
              ? { label: 'Never reached', value: unreached, sub: 'listed but not crawlable' }
              : { label: 'Never reached', value: '–', sub: 'not compared' },
            { label: 'Blocked by robots', value: blocked, sub: 'listed and disallowed' }
          ]
          : [],
        blocks: () => [
          readoutBlock({
            title: 'Sitemap record',
            rows: sitemap
              ? [
                ['Declared in robots.txt', sitemap.declaredInRobots ? 'Yes' : 'No'],
                ['Read from', sitemap.source || 'Nothing could be read'],
                ['URLs read', sitemap.urlCount],
                ['Truncated', sitemap.truncated ? 'Yes, longer than this audit reads' : 'No'],
                ['Compared against the crawl', reconciled ? 'Yes' : `No: ${withheldReason || 'nothing was read to compare'}`],
                ['Confidence', sitemap.confidence]
              ]
              : [['Checked', running ? 'Not yet, the crawl is still running' : 'No']]
          }),
          readoutBlock({
            title: 'What robots.txt declares',
            rows: robots
              ? [
                ['robots.txt', robots.present === true ? `HTTP ${robots.status}` : robots.present === false ? `Absent (HTTP ${robots.status})` : 'Could not be read'],
                ['Sitemaps listed', robots.sitemaps?.length ? robots.sitemaps.join(', ') : 'None']
              ]
              : [['robots.txt', running ? 'Being fetched' : 'Not checked in this audit']]
          })
        ]
      };
    },

    security() {
      const fetched = Number(siteAudit.distributions?.pages?.fetched || 0);
      const hsts = ruleInstances(/^security\.hsts-missing/);
      const nosniff = ruleInstances(/^security\.content-type-options-missing/);
      const frame = ruleInstances(/^security\.clickjacking-exposure/);
      const referrer = ruleInstances(/^security\.referrer-policy-missing/);
      const mixed = ruleInstances(/^security\.mixed-content/);
      const insecureHop = ruleInstances(/^security\.redirect-insecure-hop/);
      const forms = ruleInstances(/^security\.insecure-form-action/);
      const opener = ruleInstances(/^security\.blank-opener/);
      const denom = fetched ? `of ${fetched} fetched pages` : '';
      const coverage = fetched
        ? { state: (hsts || frame || mixed || insecureHop || forms) ? 'attention' : 'ok', text: `Taken from the HTTP responses of <b>${fetched}</b> fetched page${fetched === 1 ? '' : 's'}. Header facts are confirmed: no JavaScript can change them. TLS protocol and cipher inspection is not part of this audit.` }
        : { state: 'unknown', text: 'No page was fetched, so no response header was read.' };
      return {
        coverage,
        // The four response-header facts, so the tiles mirror the block
        // beneath them. Tiles that named mixed content and form actions read
        // as four zeros on a site whose only gap was Referrer-Policy, while a
        // finding sat directly below saying otherwise.
        tiles: [
          { label: 'No HSTS', value: hsts, sub: denom },
          { label: 'No clickjacking defence', value: frame, sub: denom },
          { label: 'No nosniff', value: nosniff, sub: denom },
          { label: 'No Referrer-Policy', value: referrer, sub: denom }
        ],
        blocks: () => [
          distBlock({
            title: 'Response headers not sent',
            note: 'Counted per page. A header this site never sends appears on every page it serves, which is why these numbers track the page count rather than a defect count.',
            totalLabel: fetched ? `${fetched} page${fetched === 1 ? '' : 's'}` : '',
            rows: [
              { label: 'Strict-Transport-Security', n: hsts, tone: 'attention' },
              { label: 'X-Frame-Options / CSP', n: frame, tone: 'attention' },
              { label: 'X-Content-Type-Options', n: nosniff, tone: 'warn' },
              { label: 'Referrer-Policy', n: referrer, tone: 'warn' }
            ],
            empty: fetched ? 'Every fetched page sent all four headers.' : 'No page was fetched.'
          }),
          distBlock({
            title: 'Transport and destination',
            rows: [
              { label: 'Mixed content', n: mixed, tone: 'attention' },
              { label: 'Insecure redirect hop', n: insecureHop, tone: 'attention' },
              { label: 'Insecure form action', n: forms, tone: 'attention' },
              { label: 'Unsafe blank opener', n: opener, tone: 'warn' }
            ],
            empty: fetched ? 'Nothing insecure was observed in the responses or markup.' : 'No page was fetched.'
          })
        ]
      };
    },

    international() {
      const fetched = Number(siteAudit.distributions?.pages?.fetched || 0);
      const hreflang = ruleInstances(/^seo\.hreflang-/);
      const lang = ruleInstances(/^a11y\.lang-/);
      const coverage = fetched
        ? {
          state: (hreflang || lang) ? 'attention' : 'ok',
          text: `Read from the static HTML of <b>${fetched}</b> fetched page${fetched === 1 ? '' : 's'}.`,
          extra: 'Lumen records hreflang and language problems; it does not build a full hreflang inventory. An empty section means nothing was flagged, not that this site declares no alternates.'
        }
        : { state: 'unknown', text: 'No page was fetched, so no language declaration was read.' };
      return {
        coverage,
        tiles: [
          { label: 'hreflang problems', value: hreflang, sub: 'invalid or duplicated alternates' },
          { label: 'Language declaration', value: lang, sub: 'missing or invalid lang attribute' }
        ],
        blocks: () => []
      };
    },

    quality() {
      const d = siteAudit.distributions || {};
      const fetched = Number(d.pages?.fetched || 0);
      const withSchema = Number(d.pages?.withSchema || 0);
      const viewport = ruleInstances(/^web\.viewport-missing/);
      const charset = ruleInstances(/^web\.charset-missing/);
      const doctype = ruleInstances(/^web-quality\.doctype-missing/);
      const schemaMissing = ruleInstances(/^schema\.(missing|jsonld-missing-type)/);
      const schemaInvalid = ruleInstances(/^schema\.(invalid-json|jsonld-invalid)/);
      const coverage = fetched
        ? { state: (viewport || charset || doctype || schemaInvalid) ? 'attention' : 'ok', text: `Parsed from the static HTML of <b>${fetched}</b> fetched page${fetched === 1 ? '' : 's'}. Structured data injected by JavaScript is not visible to this tier.` }
        : { state: 'unknown', text: 'No page was fetched, so no markup was parsed.' };
      return {
        coverage,
        tiles: [
          { label: 'Pages with schema', value: withSchema, sub: fetched ? `of ${fetched} fetched pages` : '' },
          { label: 'No viewport', value: viewport, sub: 'will not adapt to a phone' },
          { label: 'No charset', value: charset, sub: 'encoding left to the browser' },
          { label: 'Invalid structured data', value: schemaInvalid, sub: 'search engines cannot read it' }
        ],
        blocks: () => [
          distBlock({
            title: 'Structured data coverage',
            totalLabel: `${fetched} page${fetched === 1 ? '' : 's'}`,
            rows: [
              { label: 'Carries JSON-LD', n: withSchema, tone: 'ok' },
              { label: 'Carries none', n: Math.max(0, fetched - withSchema), tone: 'warn', always: true }
            ],
            empty: 'No page was fetched.'
          }),
          distBlock({
            title: 'Document metadata',
            rows: [
              { label: 'No viewport', n: viewport, tone: 'attention' },
              { label: 'No charset', n: charset, tone: 'warn' },
              { label: 'No doctype', n: doctype, tone: 'warn' },
              { label: 'Structured data missing', n: schemaMissing, tone: 'quiet' },
              { label: 'Structured data invalid', n: schemaInvalid, tone: 'attention' }
            ],
            empty: fetched ? 'Nothing was flagged in the document metadata of the fetched pages.' : 'No page was fetched.'
          })
        ]
      };
    },

    performance() {
      return renderPassSection({
        kind: 'performance',
        tiles: [
          { label: 'Slow first byte', value: ruleInstances(/^performance\.browser\.ttfb/), sub: 'measured TTFB' },
          { label: 'Slow largest paint', value: ruleInstances(/^performance\.browser\.lcp/), sub: 'measured LCP' },
          { label: 'Layout shift', value: ruleInstances(/^performance\.browser\.cls/), sub: 'measured CLS' },
          { label: 'Oversized images', value: ruleInstances(/^performance\.browser\.(image-oversized|lcp-image-oversized)/), sub: 'delivered larger than displayed' }
        ]
      });
    },

    accessibility() {
      const groups = disciplineGroups('accessibility');
      const rules = groups.length;
      const instances = groups.reduce((n, g) => n + Number(g.instances || 0), 0);
      const serious = groups.filter((g) => g.severity === 'critical' || g.severity === 'high').reduce((n, g) => n + Number(g.instances || 0), 0);
      const pages = groups.reduce((n, g) => Math.max(n, Number(g.affected_urls || 0)), 0);
      return renderPassSection({
        kind: 'accessibility',
        tiles: [
          { label: 'Barriers found', value: instances, sub: `${rules} distinct rule${rules === 1 ? '' : 's'}` },
          { label: 'Critical or high', value: serious, sub: 'blocking severities' },
          { label: 'Pages affected', value: pages, sub: 'at most, by any one rule' }
        ]
      });
    }
  };

  /** Performance and Accessibility share one shape: their evidence exists only
   * where the render pass has run, so the coverage line states the ratio and
   * offers the pass itself rather than leaving an empty section to be read as
   * a clean result. */
  function renderPassSection({ kind, tiles }) {
    const rp = siteAudit.audit?.renderProgress || {};
    const total = Number(rp.total || 0);
    const rendered = Number(rp.rendered || 0);
    const label = kind === 'performance' ? 'performance' : 'accessibility';
    if (!rendered) {
      return {
        coverage: {
          state: 'unknown',
          text: total
            ? `<b>0</b> of <b>${total}</b> crawled page${total === 1 ? '' : 's'} have been opened in a real browser, so this audit carries no ${label} evidence at all. That is a gap in coverage, not a clean result.`
            : `No page has been checked in a browser, so this audit carries no ${label} evidence.`,
          action: total ? { label: `Check ${total} page${total === 1 ? '' : 's'} in this browser`, run: startRenderPass } : null
        },
        // The same figures the pass will fill in, held open with an em-dash.
        // This is what makes the case for running it — an operator can see
        // which measurements are on offer — and an em-dash cannot be misread
        // as a measurement of zero.
        tiles: tiles.map((t) => ({ label: t.label, value: '–', sub: 'not measured yet' })),
        blocks: () => []
      };
    }
    const partial = rendered < total;
    return {
      coverage: {
        state: partial ? 'attention' : 'ok',
        text: `<b>${rendered}</b> of <b>${total}</b> crawled page${total === 1 ? '' : 's'} checked in this browser.${partial ? ` The other ${total - rendered} carry no ${label} evidence yet.` : ''}`,
        action: partial ? { label: `Check the remaining ${total - rendered}`, run: startRenderPass } : null
      },
      tiles,
      blocks: () => []
    };
  }

  /** Renders one discipline section into the shared section panel. */
  function renderDisciplineSection(id) {
    const shadow = siteAudit.shadow;
    const meta = SITE_AUDIT_DISCIPLINE_META[id];
    if (!meta) return;
    const built = SITE_AUDIT_SECTION_BUILDERS[id] ? SITE_AUDIT_SECTION_BUILDERS[id]() : { coverage: null, tiles: [], blocks: () => [] };

    shadow.querySelector('.section-title').textContent = SITE_AUDIT_TAB_LABEL[id];
    shadow.querySelector('.section-lede').textContent = meta.lede;

    const cov = shadow.querySelector('.coverage-line');
    const covText = cov.querySelector('.cl-text');
    const covAction = cov.querySelector('.cl-action');
    cov.dataset.state = built.coverage?.state || 'unknown';
    // Only numbers and fixed copy are interpolated here; every crawl-sourced
    // string in this panel is appended as a text node.
    covText.innerHTML = built.coverage?.text || '';
    if (built.coverage?.extra) {
      const extra = document.createElement('span');
      extra.textContent = ` ${built.coverage.extra}`;
      covText.appendChild(extra);
    }
    if (built.coverage?.action) {
      covAction.hidden = false;
      covAction.textContent = built.coverage.action.label;
      covAction.onclick = built.coverage.action.run;
      // With nothing measured, running the pass is the only thing to do on
      // this screen, so it carries the primary weight.
      covAction.classList.toggle('primary', built.coverage.state === 'unknown');
    } else {
      covAction.hidden = true;
      covAction.onclick = null;
    }

    const stats = shadow.querySelector('.section-stats');
    stats.innerHTML = '';
    stats.hidden = !built.tiles.length;
    for (const tile of built.tiles) stats.appendChild(sectionTile(tile));

    // `.section-blocks`, not `.section-grid`: the Overview's crawl-shape
    // container carries the same layout class and appears earlier in the DOM,
    // so a `.section-grid` lookup here silently painted every discipline's
    // distributions into the Overview instead.
    const grid = shadow.querySelector('.section-blocks');
    grid.innerHTML = '';
    const blocks = typeof built.blocks === 'function' ? built.blocks() : (built.blocks || []);
    grid.hidden = !blocks.length;
    for (const block of blocks) grid.appendChild(block);

    const groups = disciplineGroups(id);
    shadow.querySelector('.section-findings-title').textContent = `Findings in ${SITE_AUDIT_TAB_LABEL[id]}`;
    shadow.querySelector('.section-findings-note').textContent = meta.findingsNote;
    renderFindingRowsInto(
      shadow.querySelector('.section-findings-list'),
      groups,
      disciplineEstablished(id)
        ? 'Nothing was flagged in this discipline on the pages this audit covered.'
        : 'Nothing here has been measured yet, so there is nothing to report either way.'
    );
  }

  /** Opens the Links tab filtered to one status, writing the value into the
   * visible control so the operator can see and undo it. */
  function openLinksWithStatus(status) {
    siteAudit.linksStatus = status || '';
    siteAudit.linksOffset = 0;
    siteAudit.linksSearch = '';
    const search = siteAudit.shadow.querySelector('.links-search');
    if (search) search.value = '';
    const select = siteAudit.shadow.querySelector('.links-status');
    if (select) select.value = siteAudit.linksStatus;
    return switchSiteAuditTab('links');
  }


  /** The headline used to read "40 pages crawled, 128 broken links, 235
   * findings" on a site with 218 discovered pages — true of the 40, and read
   * by every operator as a claim about the site. The coverage card said so
   * correctly, but a card below the fold does not caveat a number above it.
   * This band sits outside the tab panels, so the qualification travels with
   * the operator into Findings, Pages and Links as well.
   *
   * Every value here is Number()-coerced arithmetic on the audit's own status
   * counts — no crawl-sourced string reaches the markup. */
  function renderScopeBanner(audit) {
    const banner = siteAudit.shadow.querySelector('.scope-banner');
    if (!banner) return;
    const counts = audit?.urlCounts || {};
    const fetched = Number(counts.fetched || 0);
    const pending = Number(counts.queued || 0) + Number(counts.fetching || 0);
    const errored = Number(counts.error || 0);
    const skipped = Number(counts.skipped || 0);
    const discovered = fetched + pending + errored + skipped;
    // Nothing to qualify: the crawl turned every page it discovered into
    // evidence. Staying silent is the honest outcome here, not reassurance.
    if (!discovered || discovered === fetched) { banner.hidden = true; return; }

    const running = audit?.status === 'running';
    const limit = Number(audit?.config?.maxPages || 0);
    const limitStopped = !running && pending > 0 && limit > 0 && fetched >= limit;
    const reasons = [];
    if (pending > 0) {
      reasons.push(running
        ? `<b>${pending}</b> still to fetch`
        : `<b>${pending}</b> never fetched${limitStopped ? `; the ${limit}-page limit stopped the crawl first` : ''}`);
    }
    if (errored > 0) reasons.push(`<b>${errored}</b> could not be fetched`);
    if (skipped > 0) reasons.push(`<b>${skipped}</b> skipped by robots.txt`);

    const lead = running
      ? `<b>Crawl in progress</b>: <b>${fetched}</b> of <b>${discovered}</b> discovered pages fetched so far.`
      : `<b>Partial crawl</b>: <b>${fetched}</b> of <b>${discovered}</b> discovered pages were fetched.`;
    const tail = running
      ? 'Every count on this screen describes the pages fetched so far, not the whole site.'
      : `Every count on this screen describes those <b>${fetched}</b> page${fetched === 1 ? '' : 's'}, not the whole site.`;
    banner.hidden = false;
    banner.querySelector('.scope-text').innerHTML = `${lead} ${reasons.join('; ')}. ${tail}`;
  }

  /**
   * What this audit could not establish, as a card in the crawl-shape row.
   *
   * It used to sit alone in a four-card grid restating facts that were already
   * on screen: the queued count is the "Coverage gaps" tile and the scope
   * banner, and the browser-checked ratio is the render panel's entire subject.
   * What only this card carries is the hatched survey plan and the coverage
   * sentences the crawl composes for itself — unverifiable destinations, a
   * truncated sitemap — so that is what is left.
   */
  function buildCoverageCard(audit, counts) {
    const box = document.createElement('section');
    box.className = 'dist';
    const head = document.createElement('div');
    head.className = 'dist-head';
    const h3 = document.createElement('h3');
    h3.textContent = 'What was not established';
    head.appendChild(h3);
    box.appendChild(head);

    const queued = Number(counts.queued || 0);
    const errored = Number(counts.error || 0);
    const skipped = Number(counts.skipped || 0);
    const fetched = Number(counts.fetched || 0);
    const total = Math.max(1, fetched + queued + errored + skipped);
    const surveyedPct = Math.round((fetched / total) * 100);

    // Drafting convention: area outside the survey is hatched, never left blank
    // and never coloured as a defect. The hatch is also stated in words,
    // because no graphic in this system carries meaning on its own.
    const plan = document.createElement('div');
    plan.className = 'cov-plan';
    plan.setAttribute('role', 'img');
    plan.setAttribute('aria-label', `${surveyedPct}% of discovered pages surveyed; the remainder is outside this survey`);
    const surveyed = document.createElement('div');
    surveyed.className = 'cov-surveyed';
    surveyed.style.width = `${surveyedPct}%`;
    const unsurveyed = document.createElement('div');
    unsurveyed.className = 'cov-unsurveyed';
    plan.append(surveyed, unsurveyed);
    box.appendChild(plan);

    const note = document.createElement('div');
    note.className = 'cov-note';
    const lines = [];
    if (errored > 0) lines.push(`${errored} page${errored === 1 ? '' : 's'} could not be fetched.`);
    if (skipped > 0) lines.push(`${skipped} page${skipped === 1 ? '' : 's'} skipped by robots.txt.`);
    // Whatever the crawl itself could not settle. These carry host names and
    // other crawl output, so they are set as text, never interpolated.
    for (const line of audit?.stats?.auditSummary?.coverage || []) lines.push(line);
    if (!lines.length) {
      lines.push(queued > 0
        ? `${surveyedPct}% of the pages this crawl discovered were surveyed. Everything else on this screen describes that share.`
        : 'Every page this crawl discovered was surveyed, and nothing was left unverified.');
    }
    for (const line of lines) {
      const span = document.createElement('span');
      span.textContent = line;
      note.appendChild(span);
    }
    box.appendChild(note);
    return box;
  }


  /* Structured data ---------------------------------------------------------
   *
   * The crawl records the items; packages/findings/schema-validation.js decides
   * what is wrong with them. This renders that, and its only real job is to keep
   * three kinds of statement from blurring into one list of "issues":
   *
   *   errors        faults in items we parsed          confirmed
   *   conflicts     the site disagreeing with itself   confirmed
   *   opportunities markup we did not see              inferred, not a defect
   *
   * The last one is where a schema tool normally starts lying. An opportunity is
   * rendered in its own lens, labelled inferred, worded as something to confirm,
   * and never counted in the invalid figure.
   */
  const SCHEMA_LENSES = [
    { id: 'validation', label: 'Validation' },
    { id: 'types', label: 'Schema types' },
    { id: 'pages', label: 'Pages' },
    { id: 'opportunities', label: 'Opportunities' }
  ];

  async function loadSiteAuditSchema() {
    const shadow = siteAudit.shadow;
    const body = shadow.querySelector('.schema-body');
    if (!siteAudit.schema) {
      body.innerHTML = '<p class="hint">Reading the structured-data inventory…</p>';
      const r = await chrome.runtime.sendMessage({ type: 'SITE_AUDIT_SCHEMA', auditId: siteAudit.auditId }).catch(() => null);
      if (!siteAudit) return;
      if (!r?.schema) {
        body.innerHTML = '<p class="hint">The structured-data inventory could not be read just now.</p>';
        return;
      }
      siteAudit.schema = r.schema;
    }
    renderSchemaSection();
  }

  function renderSchemaSection() {
    const shadow = siteAudit.shadow;
    const s = siteAudit.schema;
    if (!s) return;
    const lens = siteAudit.schemaLens || 'validation';

    // Scope before any count that depends on it, the same order the Overview uses.
    const scope = shadow.querySelector('.schema-scope');
    const truncatedNote = s.truncatedPages
      ? ` ${s.truncatedPages} page${s.truncatedPages === 1 ? ' carried' : 's carried'} more items than the per-page limit and ${s.truncatedPages === 1 ? 'is' : 'are'} recorded as truncated.`
      : '';
    scope.textContent = `Parsed from ${s.pagesParsed} fetched page${s.pagesParsed === 1 ? '' : 's'}. Pages the crawl never fetched carry no structured-data evidence either way and are not counted here.${truncatedNote}`;

    const invalidItems = s.errors.length;
    const tiles = [
      { label: 'Pages with schema', value: `${s.pagesWithSchema} / ${s.pagesParsed}`, sub: s.pagesParsed ? `${Math.round((s.pagesWithSchema / s.pagesParsed) * 100)}% of parsed pages` : '' },
      { label: 'Items detected', value: String(s.itemCount), sub: `${s.types.length} schema type${s.types.length === 1 ? '' : 's'}` },
      { label: 'Validation errors', value: String(invalidItems), sub: invalidItems ? 'confirmed faults in parsed items' : 'none in what was parsed' },
      { label: 'Entity conflicts', value: String(s.conflicts.length), sub: s.conflicts.length ? 'the site disagreeing with itself' : 'identities agree' },
      // Opportunities get a tile of their own rather than being folded into a
      // total, because they are not defects and a combined figure would make
      // correct markup look broken.
      { label: 'Opportunities', value: String(s.opportunities.length), sub: 'inferred · confirm before acting' }
    ];
    const grid = shadow.querySelector('.schema-stats');
    grid.innerHTML = '';
    for (const tile of tiles) {
      const cell = document.createElement('div');
      const dt = document.createElement('dt');
      dt.textContent = tile.label;
      const dd = document.createElement('dd');
      dd.textContent = tile.value;
      cell.append(dt, dd);
      if (tile.sub) {
        const sub = document.createElement('span');
        sub.className = 'stat-sub';
        sub.textContent = tile.sub;
        cell.appendChild(sub);
      }
      grid.appendChild(cell);
    }

    const conflictCard = shadow.querySelector('.schema-conflicts');
    const conflictList = shadow.querySelector('.schema-conflict-list');
    conflictCard.hidden = !s.conflicts.length;
    conflictList.innerHTML = '';
    for (const conflict of s.conflicts) {
      const li = document.createElement('li');
      li.className = 'schema-conflict';
      const head = document.createElement('div');
      head.className = 'schema-conflict-head';
      const title = document.createElement('b');
      title.textContent = conflict.title;
      const pill = document.createElement('span');
      pill.className = 'pill';
      pill.dataset.tone = 'critical';
      pill.textContent = 'Conflict';
      head.append(title, pill);
      const detail = document.createElement('p');
      detail.className = 'hint';
      detail.textContent = conflict.detail;
      li.append(head, detail);
      for (const variant of conflict.variants || []) {
        const row = document.createElement('div');
        row.className = 'schema-variant';
        const id = document.createElement('code');
        id.textContent = variant.id;
        const count = document.createElement('span');
        count.textContent = `${variant.pages} page${variant.pages === 1 ? '' : 's'}`;
        row.append(id, count);
        li.appendChild(row);
      }
      conflictList.appendChild(li);
    }

    const tabs = shadow.querySelector('.schema-tabs');
    tabs.innerHTML = '';
    for (const entry of SCHEMA_LENSES) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = `fx-tab${entry.id === lens ? ' active' : ''}`;
      btn.textContent = entry.label;
      btn.addEventListener('click', () => { siteAudit.schemaLens = entry.id; renderSchemaSection(); });
      tabs.appendChild(btn);
    }

    const body = shadow.querySelector('.schema-body');
    body.innerHTML = '';
    if (lens === 'validation') schemaValidationLens(body, s);
    else if (lens === 'types') schemaTypesLens(body, s);
    else if (lens === 'pages') schemaPagesLens(body, s);
    else schemaOpportunityLens(body, s);
  }

  /** One row per distinct fault, with the pages behind it — the same grouping
   * the findings inspector uses, because forty pages sharing one broken template
   * is one job rather than forty. */
  function schemaValidationLens(body, s) {
    if (!s.errors.length) {
      body.appendChild(schemaEmpty(
        'No validation errors in the items that were parsed.',
        `${s.itemCount} item${s.itemCount === 1 ? '' : 's'} across ${s.pagesWithSchema} page${s.pagesWithSchema === 1 ? '' : 's'} were checked. This is a clean result for what the crawl could read, not a statement about markup added by JavaScript.`
      ));
      return;
    }
    const groups = new Map();
    for (const error of s.errors) {
      const key = `${error.code}::${error.type || ''}::${error.property || ''}`;
      if (!groups.has(key)) groups.set(key, { ...error, urls: [] });
      groups.get(key).urls.push(error.url);
    }
    const rows = [...groups.values()].sort((a, b) => b.urls.length - a.urls.length);

    const table = document.createElement('table');
    table.className = 'data-table schema-table';
    table.innerHTML = '<thead><tr><th>Validation finding</th><th>Type</th><th class="col-num">Pages</th><th class="col-status">Evidence</th></tr></thead>';
    const tbody = document.createElement('tbody');
    for (const row of rows) {
      const tr = document.createElement('tr');
      const first = document.createElement('td');
      const title = document.createElement('button');
      title.type = 'button';
      title.className = 'schema-open';
      title.textContent = row.title;
      title.title = `Open ${row.code} in Findings`;
      title.addEventListener('click', () => {
        siteAudit.findingsSearch = row.code;
        switchSiteAuditTab('findings');
      });
      const detail = document.createElement('span');
      detail.className = 'schema-detail';
      detail.textContent = row.detail;
      first.append(title, detail);
      const type = document.createElement('td');
      type.textContent = row.type || '–';
      const pages = document.createElement('td');
      pages.className = 'col-num';
      pages.textContent = String(new Set(row.urls).size);
      const status = document.createElement('td');
      status.className = 'col-status';
      const pill = document.createElement('span');
      pill.className = 'pill cap';
      pill.dataset.tone = 'critical';
      pill.textContent = row.confidence;
      status.appendChild(pill);
      tr.append(first, type, pages, status);
      tbody.appendChild(tr);

      const detailRow = document.createElement('tr');
      detailRow.className = 'schema-urls';
      const cell = document.createElement('td');
      cell.colSpan = 4;
      const list = document.createElement('div');
      list.className = 'url-list';
      for (const url of [...new Set(row.urls)].slice(0, 25)) {
        const a = document.createElement('a');
        a.className = 'url-item';
        a.href = url;
        a.target = '_blank';
        a.rel = 'noopener noreferrer';
        a.textContent = shortUrl(url);
        a.title = url;
        list.appendChild(a);
      }
      cell.appendChild(list);
      detailRow.appendChild(cell);
      tbody.appendChild(detailRow);
    }
    table.appendChild(tbody);
    body.appendChild(table);
  }

  function schemaTypesLens(body, s) {
    if (!s.types.length) {
      body.appendChild(schemaEmpty('No schema.org items were parsed.', 'The crawl reads JSON-LD and microdata from the served HTML. Markup added by JavaScript is not visible to it.'));
      return;
    }
    const table = document.createElement('table');
    table.className = 'data-table schema-table';
    table.innerHTML = '<thead><tr><th>Type</th><th class="col-num">Items</th><th class="col-num">Pages</th><th class="col-status">Format</th></tr></thead>';
    const tbody = document.createElement('tbody');
    for (const type of s.types) {
      const tr = document.createElement('tr');
      const name = document.createElement('td');
      name.textContent = type.type;
      const items = document.createElement('td');
      items.className = 'col-num';
      items.textContent = String(type.items);
      const pages = document.createElement('td');
      pages.className = 'col-num';
      pages.textContent = String(type.pages);
      const format = document.createElement('td');
      format.className = 'col-status';
      for (const f of type.formats) {
        const pill = document.createElement('span');
        pill.className = 'pill';
        pill.textContent = f;
        format.appendChild(pill);
      }
      tr.append(name, items, pages, format);
      tbody.appendChild(tr);
    }
    table.appendChild(tbody);
    body.appendChild(table);
  }

  function schemaPagesLens(body, s) {
    const byPage = new Map();
    for (const error of s.errors) byPage.set(error.url, (byPage.get(error.url) || 0) + 1);
    const table = document.createElement('table');
    table.className = 'data-table schema-table';
    table.innerHTML = '<thead><tr><th>Page</th><th class="col-num">Errors</th></tr></thead>';
    const tbody = document.createElement('tbody');
    const rows = [...byPage.entries()].sort((a, b) => b[1] - a[1]);
    if (!rows.length) {
      body.appendChild(schemaEmpty('No page carries a validation error.', 'Use the Schema types view to see what each page publishes.'));
      return;
    }
    for (const [url, count] of rows) {
      const tr = document.createElement('tr');
      const first = document.createElement('td');
      const a = document.createElement('a');
      a.className = 'url-item';
      a.href = url;
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
      a.textContent = shortUrl(url);
      a.title = url;
      first.appendChild(a);
      const n = document.createElement('td');
      n.className = 'col-num';
      n.textContent = String(count);
      tr.append(first, n);
      tbody.appendChild(tr);
    }
    table.appendChild(tbody);
    body.appendChild(table);
  }

  /** The lens that has to work hardest not to overclaim. */
  function schemaOpportunityLens(body, s) {
    const note = document.createElement('p');
    note.className = 'hint schema-opportunity-note';
    note.textContent = 'These are inferences, not defects. The crawl does not run JavaScript, so markup it did not see may still be on the page. Confirm on one page before acting on any of them.';
    body.appendChild(note);
    if (!s.opportunities.length) {
      body.appendChild(schemaEmpty('No template-level opportunities were inferred.', 'An opportunity is only raised where the site has already established the pattern elsewhere.'));
      return;
    }
    const list = document.createElement('ul');
    list.className = 'schema-opportunities';
    for (const opportunity of s.opportunities) {
      const li = document.createElement('li');
      const head = document.createElement('div');
      head.className = 'schema-conflict-head';
      const title = document.createElement('b');
      title.textContent = opportunity.title;
      const pill = document.createElement('span');
      pill.className = 'pill cap';
      pill.dataset.tone = 'warn';
      pill.textContent = opportunity.confidence;
      head.append(title, pill);
      const detail = document.createElement('p');
      detail.className = 'hint';
      detail.textContent = opportunity.detail;
      li.append(head, detail);
      if (opportunity.code) {
        const toPlan = document.createElement('button');
        toPlan.type = 'button';
        toPlan.className = 'link-btn schema-to-plan';
        toPlan.textContent = 'Show this in the plan';
        toPlan.addEventListener('click', () => openPlanFor(opportunity.code));
        li.appendChild(toPlan);
      }
      if (opportunity.urls?.length) {
        const list2 = document.createElement('div');
        list2.className = 'url-list';
        for (const url of opportunity.urls.slice(0, 15)) {
          const a = document.createElement('a');
          a.className = 'url-item';
          a.href = url;
          a.target = '_blank';
          a.rel = 'noopener noreferrer';
          a.textContent = shortUrl(url);
          a.title = url;
          list2.appendChild(a);
        }
        li.appendChild(list2);
      }
      list.appendChild(li);
    }
    body.appendChild(list);
  }

  /** An empty state that says what was checked, so "none" cannot be read as
   * "not looked at". */
  function schemaEmpty(headline, detail) {
    const box = document.createElement('div');
    box.className = 'schema-empty';
    const b = document.createElement('b');
    b.textContent = headline;
    const p = document.createElement('p');
    p.className = 'hint';
    p.textContent = detail;
    box.append(b, p);
    return box;
  }


  /* Optimize -----------------------------------------------------------------
   *
   * The sequenced plan. Two things this surface has to keep saying, because both
   * are easy for a reader to assume wrongly:
   *
   *   - The order is a dependency sequence, not a severity ranking. Group 1 is
   *     first because the rest is measured on pages that resolve, not because it
   *     matters most. Each group states what it unblocks, and the last one says
   *     in as many words that being last is not being least important.
   *   - Every action names the rules, counts and confidence behind it. A plan
   *     whose recommendations cannot be traced back to findings is advice, and
   *     this product does not give advice it cannot show the evidence for.
   */
  const OPTIMIZE_LENSES = [
    { id: 'priorities', label: 'Priorities' },
    { id: 'model', label: 'Site model' },
    { id: 'trail', label: 'Evidence trail' }
  ];


  /* Optimize wording ---------------------------------------------------------
   *
   * The plan's sequence, counts, severities and confidence are decided before a
   * model is asked anything, and are not on offer. What the model may do is word
   * the plan for this site instead of leaving the generic headline every audit
   * would get — the same contract the Lumen brief already runs under, validated
   * by the same function rather than by a second copy of the rules.
   *
   * The plan is shaped into the brief's envelope to make that reuse literal: one
   * set of phrasing rules, one validator, one definition of an invented number.
   */
  function planEnvelope(plan) {
    const areas = plan.priorities.map((priority, index) => ({
      id: String(priority.id),
      rank: index + 1,
      label: String(priority.title),
      deterministicAction: String(priority.title),
      severity: String(priority.severity || 'info'),
      confidence: String(priority.confidence || 'inferred'),
      leadRule: String(priority.actions?.[0]?.evidence?.ruleIds?.[0] || ''),
      // Scope is now measured rather than assumed. The model uses it to decide
      // whether a phase reads as one edit or as many, which was the single
      // thing it most often got wrong while this was hardcoded false.
      sitewide: priority.actions.some((a) => (a.changes || []).some((c) => c.scope === 'sitewide')),
      changes: Number(priority.changes || 0),
      journeyFailure: priority.id === 'integrity',
      pages: Math.max(0, ...priority.actions.map((a) => Number(a.evidence.pages || 0))),
      leadPages: Number(priority.actions?.[0]?.evidence?.pages || 0),
      instances: Number(priority.findings || 0),
      ruleCount: priority.actions.reduce((n, a) => n + a.evidence.ruleIds.length, 0)
    }));
    return {
      scope: {
        fetched: plan.coverage.fetched,
        discovered: plan.coverage.discovered,
        neverFetched: plan.coverage.uncrawled,
        partial: plan.coverage.uncrawled > 0
      },
      totalInstances: Number(plan.totals.actionableFindings || 0),
      deterministicSummary: String(siteAudit.shadow.querySelector('.optimize-headline')?.textContent || ''),
      areas
    };
  }

  const PLAN_PROVENANCE = {
    pending: 'sequenced from scan evidence · rewriting',
    deterministic: 'sequenced from scan evidence, written by Lumen',
    model: 'sequence from scan evidence · written by the model on this device',
    byo: 'sequence from scan evidence · written by your model',
    unavailable: 'sequenced from scan evidence, written by Lumen'
  };

  async function phrasePlanOnDevice(plan) {
    const api = globalThis.LumenBriefPhrasing;
    const model = globalThis.LanguageModel;
    if (!api?.validateBriefPhrasing || !model?.availability) return { ok: false, code: 'LOCAL_AI_API_UNAVAILABLE' };
    const envelope = planEnvelope(plan);
    if (!envelope.areas.length) return { ok: false, code: 'BRIEF_AI_NOTHING_TO_SAY' };

    let status = 'unavailable';
    try { status = await model.availability({ expectedInputs: [{ type: 'text' }] }); }
    catch { return { ok: false, code: 'LOCAL_AI_PROBE_FAILED' }; }
    // Same refusal as the brief: "downloadable" means Chrome would fetch a
    // multi-gigabyte model, which an audit does not get to trigger on the
    // operator's behalf.
    if (status !== 'available') return { ok: false, code: 'LOCAL_AI_' + String(status).toUpperCase() };

    const prompt = briefPromptFor(envelope);
    let session = null;
    try {
      session = await model.create({
        expectedInputs: [{ type: 'text' }],
        initialPrompts: [{ role: 'system', content: prompt.system }]
      });
      const raw = await session.prompt(prompt.user);
      let parsed = null;
      try { parsed = JSON.parse(String(raw).replace(/^[^{]*/, '').replace(/[^}]*$/, '')); }
      catch { return { ok: false, code: 'BRIEF_AI_REJECTED', message: 'the reply was not JSON' }; }
      const verdict = api.validateBriefPhrasing(parsed, envelope);
      if (!verdict.ok) return { ok: false, code: 'BRIEF_AI_REJECTED', message: verdict.reason || '' };
      return { ok: true, phrasing: verdict.value || parsed };
    } catch (error) {
      return { ok: false, code: 'LOCAL_AI_FAILED', message: String(error?.message || error) };
    } finally {
      try { session?.destroy?.(); } catch {}
    }
  }

  /** Words only. The sequence, the counts and the labels are re-read from the
   * plan afterwards, so an accepted phrasing cannot move a priority even if the
   * validator were to miss something. */
  function applyPlanPhrasing(plan, phrasing) {
    if (phrasing?.summary) plan.phrasedSummary = String(phrasing.summary);
    for (const area of phrasing?.areas || []) {
      const priority = plan.priorities.find((p) => p.id === area.id);
      if (!priority) continue;
      if (area.action) priority.phrasedTitle = String(area.action);
      if (area.rationale) priority.phrasedSummary = String(area.rationale);
    }
  }

  /**
   * The plan, worded by the operator's own endpoint.
   *
   * The Optimize section had no path to it at all: it asked the built-in model
   * and nothing else, so on every machine where that reports unavailable the
   * plan could never be worded however the endpoint was configured. Same
   * envelope, same prompt, same gate as the brief; only the transport differs.
   */
  async function phrasePlanWithOwnAi(plan) {
    const api = globalThis.LumenBriefPhrasing;
    if (!api?.validateBriefPhrasing) return { ok: false, code: 'BRIEF_AI_GATE_MISSING' };
    const envelope = planEnvelope(plan);
    if (!envelope.areas.length) return { ok: false, code: 'BRIEF_AI_NOTHING_TO_SAY' };
    const prompt = briefPromptFor(envelope);
    let response;
    try {
      response = await chrome.runtime.sendMessage({ type: 'BRIEF_AI_PHRASE', provider: 'byo', system: prompt.system, user: prompt.user });
    } catch (error) {
      return { ok: false, code: 'BYO_AI_FAILED', message: String(error?.message || error) };
    }
    if (!response?.ok) return { ok: false, code: response?.code || 'BYO_AI_FAILED', message: response?.message || '' };
    let parsed = null;
    try { parsed = JSON.parse(String(response.text).replace(/^[^{]*/, '').replace(/[^}]*$/, '')); }
    catch { return { ok: false, code: 'BRIEF_AI_REJECTED', message: 'the reply was not JSON' }; }
    const verdict = api.validateBriefPhrasing(parsed, envelope);
    if (!verdict.ok) return { ok: false, code: 'BRIEF_AI_REJECTED', message: verdict.reason || verdict.message || '' };
    return { ok: true, phrasing: verdict.value || parsed };
  }

  async function requestPlanPhrasing(plan) {
    siteAudit.planPhrasing = { status: 'pending' };
    renderOptimizeSection();
    const result = await withDeadline(
      briefPhrasingProvider().then(async ({ provider }) => {
        if (provider === 'off') return { ok: false, code: 'BRIEF_AI_OFF' };
        if (provider === 'byo') {
          const own = await phrasePlanWithOwnAi(plan);
          return own.ok ? { ...own, source: 'byo' } : own;
        }
        if (provider === 'on-device') {
          const local = await phrasePlanOnDevice(plan);
          return local.ok ? { ...local, source: 'model' } : local;
        }
        return { ok: false, code: 'BRIEF_AI_NO_PROVIDER' };
      }),
      BRIEF_AI_DEADLINE_MS,
      'BRIEF_AI_TIMEOUT'
    ).catch((error) => ({ ok: false, code: 'BRIEF_AI_FAILED', message: String(error?.message || error) }));
    if (!siteAudit || siteAudit.plan !== plan) return;
    if (result.ok) {
      applyPlanPhrasing(plan, result.phrasing);
      siteAudit.planPhrasing = { status: result.source || 'model' };
    } else {
      siteAudit.planPhrasing = { status: 'unavailable', code: result.code, message: result.message || '' };
    }
    renderOptimizeSection();
  }

  async function loadSiteAuditOptimize() {
    if (siteAudit.plan) return renderOptimizeSection();
    if (siteAudit.planBuilding) return;
    renderOptimizeIdle();
  }

  /**
   * Before the plan exists.
   *
   * This was a button in an empty page, which is the shape of a screen that has
   * nothing to say. It has plenty to say: the plan is about to be built from
   * evidence this audit already holds, and the operator can see exactly what
   * that is before spending anything on it.
   *
   * It also asks for the two things the crawl cannot know. Only two, and each
   * one demonstrably moves the output — a field that changes nothing is fake
   * configuration, and the product does not ship those. Whatever is set here is
   * labelled as stated by the operator wherever it appears afterwards: it is not
   * evidence, carries no scanner confidence, and can never create, remove or
   * re-rate a finding.
   */
  function renderOptimizeIdle() {
    const shadow = siteAudit.shadow;
    shadow.querySelector('.optimize-stats').innerHTML = '';
    const why = shadow.querySelector('.optimize-why');
    why.innerHTML = '';
    // An emptied card is still a bordered box. Hide it rather than draw one.
    why.hidden = true;
    shadow.querySelector('.optimize-tabs').innerHTML = '';
    shadow.querySelector('.optimize-limits').hidden = true;
    const body = shadow.querySelector('.optimize-body');
    body.innerHTML = '';

    const audit = siteAudit.audit || {};
    const counts = audit.urlCounts || {};
    const fetched = Number(counts.fetched || 0);
    const discovered = Object.values(counts).reduce((n, v) => n + Number(v || 0), 0);
    const groups = siteAudit.rawFindingGroups || [];
    const findings = groups.reduce((n, g) => n + Number(g.instances || 0), 0);
    const rp = audit.renderProgress || {};
    const schema = siteAudit.schema;
    const linkTotal = Object.values(audit.linkCounts || {}).reduce((n, v) => n + Number(v || 0), 0);
    // A page the crawl could not turn into evidence: queued when it stopped,
    // errored, or skipped. The plan is built from what is left.
    const gaps = ['queued', 'error', 'skipped'].reduce((n, k) => n + Number(counts[k] || 0), 0);

    const grid = document.createElement('div');
    grid.className = 'optimize-inputs';

    // Column one: what is already in hand. Every row is a count this audit can
    // defend, so the screen is made of evidence rather than of an explanation.
    const have = document.createElement('section');
    have.className = 'optimize-input-card';
    have.appendChild(inputCardHead('Evidence this plan will use', 'Collected by the crawl. Nothing here needs anything from you.'));
    const haveList = document.createElement('dl');
    haveList.className = 'optimize-facts';
    const rows = [
      ['Findings', findings ? `${findings} across ${groups.length} pattern${groups.length === 1 ? '' : 's'}` : 'none recorded', Boolean(findings)],
      ['Pages read', discovered ? `${fetched} of ${discovered} discovered` : `${fetched}`, fetched > 0],
      ['Structured data', schema ? (schema.itemCount ? `${schema.itemCount} items · ${schema.errors.length + schema.conflicts.length} faults` : 'none parsed') : 'not read yet', Boolean(schema?.itemCount)],
      ['Links checked', linkTotal ? String(linkTotal) : 'none recorded', linkTotal > 0],
      ['Browser checks', Number(rp.total || 0) ? (Number(rp.rendered || 0) ? `${rp.rendered} of ${rp.total} pages` : 'not run') : 'not run', Number(rp.rendered || 0) > 0],
      ['Coverage gaps', gaps ? `${gaps} page${gaps === 1 ? '' : 's'} never read` : 'none', gaps === 0],
      // Off-site research is a row rather than an omission. A plan that simply
      // leaves the question out implies it was considered and answered.
      ['Off-site research', 'not connected', false]
    ];
    for (const [label, value, ok] of rows) {
      const dt = document.createElement('dt');
      dt.textContent = label;
      const dd = document.createElement('dd');
      dd.textContent = value;
      if (!ok) dd.classList.add('optimize-fact-absent');
      haveList.append(dt, dd);
    }
    have.appendChild(haveList);

    // Column two: what only the operator can answer.
    const ask = document.createElement('section');
    ask.className = 'optimize-input-card';
    ask.appendChild(inputCardHead('What the crawl cannot know', 'Optional. Both are recorded as your statement, never as scan evidence, and neither changes a finding.'));

    const readModel = schema ? null : null;
    const inputs = siteAudit.planInputs || { siteType: '', templateAccess: '' };

    const typeField = document.createElement('label');
    typeField.className = 'field';
    const typeLabel = document.createElement('span');
    typeLabel.textContent = 'What kind of site is this?';
    const typeSelect = document.createElement('select');
    for (const option of ['', 'Legal practice', 'Medical practice', 'Dental practice', 'Home services',
      'Professional services', 'Financial services', 'Real estate', 'Retail', 'Ecommerce', 'Food service',
      'Education', 'Publishing', 'Recruitment', 'Other']) {
      const o = document.createElement('option');
      o.value = option;
      o.textContent = option || 'Let the crawl decide';
      if (option === inputs.siteType) o.selected = true;
      typeSelect.appendChild(o);
    }
    typeSelect.addEventListener('change', () => {
      siteAudit.planInputs = { ...(siteAudit.planInputs || {}), siteType: typeSelect.value };
    });
    const typeHint = document.createElement('span');
    typeHint.className = 'hint';
    typeHint.textContent = 'Lumen reads this from published structured data where it can. Most sites publish an Organization, which names no industry, so it usually cannot.';
    typeField.append(typeLabel, typeSelect, typeHint);

    const accessField = document.createElement('label');
    accessField.className = 'field';
    const accessLabel = document.createElement('span');
    accessLabel.textContent = 'Can shared templates be edited this cycle?';
    const accessSelect = document.createElement('select');
    for (const [value, text] of [['', 'Assume yes'], ['open', 'Yes, templates can be changed'], ['blocked', 'No, templates are frozen']]) {
      const o = document.createElement('option');
      o.value = value;
      o.textContent = text;
      if (value === inputs.templateAccess) o.selected = true;
      accessSelect.appendChild(o);
    }
    accessSelect.addEventListener('change', () => {
      siteAudit.planInputs = { ...(siteAudit.planInputs || {}), templateAccess: accessSelect.value };
    });
    const accessHint = document.createElement('span');
    accessHint.className = 'hint';
    accessHint.textContent = 'Template fixes are sequenced early because one edit changes many pages. If they are frozen, that ordering is advice you cannot act on, so the plan moves them and says you asked for it.';
    accessField.append(accessLabel, accessSelect, accessHint);

    ask.append(typeField, accessField);
    grid.append(have, ask);
    body.appendChild(grid);

    const actions = document.createElement('div');
    actions.className = 'actions optimize-build-actions';
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'btn primary optimize-start-btn';
    btn.textContent = 'Build the plan';
    btn.addEventListener('click', () => buildOptimizePlanNow());
    const note = document.createElement('p');
    note.className = 'hint';
    note.textContent = findings
      ? 'Clusters the findings by technical cause, sequences them by dependency, then asks the on-device model to word the result. The sequence is decided from the evidence either way.'
      : 'This audit recorded no findings that ask for a change, so the plan will be empty. That is a result, not a failure.';
    actions.append(btn, note);
    body.appendChild(actions);
    void readModel;
  }

  function inputCardHead(title, detail) {
    const head = document.createElement('div');
    const h = document.createElement('h3');
    h.textContent = title;
    const p = document.createElement('p');
    p.className = 'hint';
    p.textContent = detail;
    head.append(h, p);
    return head;
  }


  async function buildOptimizePlanNow() {
    const shadow = siteAudit.shadow;
    const body = shadow.querySelector('.optimize-body');
    siteAudit.planBuilding = true;
    body.innerHTML = '';
    const working = document.createElement('div');
    working.className = 'optimize-start';
    const label = document.createElement('b');
    label.className = 'optimize-working';
    label.textContent = 'Sequencing the findings';
    const dots = document.createElement('span');
    dots.className = 'work-dot';
    dots.setAttribute('aria-hidden', 'true');
    dots.appendChild(document.createElement('i'));
    label.appendChild(dots);
    const note = document.createElement('p');
    note.className = 'hint';
    note.textContent = 'Clustering by technical cause, then ordering by dependency.';
    working.append(label, note);
    body.appendChild(working);

    const stated = siteAudit.planInputs || {};
    const r = await chrome.runtime.sendMessage({
      type: 'SITE_AUDIT_OPTIMIZE', auditId: siteAudit.auditId,
      siteType: stated.siteType || '', templateAccess: stated.templateAccess || ''
    }).catch(() => null);
    if (!siteAudit) return;
    siteAudit.planBuilding = false;
    if (!r?.plan) {
      body.innerHTML = '';
      const fail = document.createElement('div');
      fail.className = 'optimize-start';
      const b = document.createElement('b');
      b.textContent = 'The plan could not be built just now.';
      const again = document.createElement('button');
      again.type = 'button';
      again.className = 'btn optimize-start-btn';
      again.textContent = 'Try again';
      again.addEventListener('click', () => buildOptimizePlanNow());
      fail.append(b, again);
      body.appendChild(fail);
      return;
    }
    siteAudit.plan = r.plan;
    renderOptimizeSection();
    // The wording pass runs after the plan is on screen, never in front of it:
    // the sequence is the product, and holding it back behind an optional model
    // would make an unavailable model look like a broken audit.
    requestPlanPhrasing(siteAudit.plan);
  }

  function renderOptimizeSection() {
    const shadow = siteAudit.shadow;
    const plan = siteAudit.plan;
    if (!plan) return;
    const lens = siteAudit.optimizeLens || 'priorities';

    // Coverage first, before any number that depends on it.
    const banner = shadow.querySelector('.optimize-limits');
    const limitText = shadow.querySelector('.optimize-limit-text');
    // The workspace already carries a partial-crawl banner above this one, and
    // stacking two bordered cards that both say "the crawl stopped early" spent
    // the plan's opening on a point already made. Only limits the reader has not
    // already been told about earn a banner here.
    const scopeBanner = shadow.querySelector('.scope-banner');
    const scopeStated = Boolean(scopeBanner && !scopeBanner.hidden);
    const limits = plan.coverage.limits.filter((l) => !(scopeStated && l.code.startsWith('pages')));
    if (limits.length) {
      banner.hidden = false;
      limitText.textContent = `What this plan could not see: ${limits.map((l) => l.text).join(' ')}`;
      const act = shadow.querySelector('.optimize-complete');
      const wantsBrowser = limits.some((l) => l.code.startsWith('browser-checks'));
      act.textContent = wantsBrowser ? 'Run browser checks' : 'Raise the page limit';
      act.onclick = () => switchSiteAuditTab(wantsBrowser ? 'browser' : 'urls');
    } else {
      banner.hidden = true;
    }

    // The plan's claim, stated as the two numbers that carry it: this many
    // findings are this many jobs, and this many of those jobs are made once
    // and land on many pages. The priority-group count was dropped from here —
    // the numbered phases are directly below, and a tile restating them spent
    // the strip's most valuable slot on something already on screen.
    const shared = plan.changeSummary.sitewide + plan.changeSummary.template;
    const compression = plan.compression || {};
    const groups = plan.siteStructure?.groups?.length || 0;
    const tiles = [
      { label: 'Changes', value: `${plan.changeSummary.findings} → ${compression.jobs || plan.changeSummary.total}`, sub: compression.templateActions ? `${compression.templateActions} of them one template edit` : 'findings, collapsed into jobs' },
      { label: 'Shared fixes', value: `${shared} of ${plan.changeSummary.total}`, sub: shared ? 'one edit reaches many pages' : 'no change repeats across pages' },
      { label: 'Page groups', value: groups ? String(groups) : 'None', sub: groups ? 'families the crawl could read' : 'no repeating structure found' },
      { label: 'Site model', value: plan.siteModel.label, sub: plan.siteModel.established ? `${plan.siteModel.confidence} · verify` : 'not inferred from wording' },
      { label: 'Connected research', value: plan.research.connected ? 'Connected' : 'Not connected', sub: 'no off-site claims' }
    ];
    const grid = shadow.querySelector('.optimize-stats');
    grid.innerHTML = '';
    for (const tile of tiles) {
      const cell = document.createElement('div');
      const dt = document.createElement('dt');
      dt.textContent = tile.label;
      const dd = document.createElement('dd');
      dd.textContent = tile.value;
      // The site model is a phrase, not a figure; at the strip's display size a
      // long label would set as a headline and read as a claim.
      if (String(tile.value).length > 6) dd.classList.add('stat-word');
      cell.append(dt, dd);
      const sub = document.createElement('span');
      sub.className = 'stat-sub';
      sub.textContent = tile.sub;
      cell.appendChild(sub);
      grid.appendChild(cell);
    }

    // Why this order — the sequence stated once, above the work.
    const why = shadow.querySelector('.optimize-why');
    why.hidden = false;
    why.innerHTML = '';
    // Who wrote these words. The sequence is identical either way, which is
    // exactly why the label has to name the author rather than the source.
    const state = siteAudit.planPhrasing || { status: 'deterministic' };
    const prov = document.createElement('p');
    prov.className = 'optimize-provenance';
    prov.textContent = PLAN_PROVENANCE[state.status] || PLAN_PROVENANCE.deterministic;
    if (state.status === 'unavailable') {
      const reason = briefUnavailableReason(state.code);
      if (reason) prov.textContent += ` · ${reason}`;
      prov.title = `${state.code || ''}${state.message ? ': ' + state.message : ''}`;
    }
    if (state.status === 'pending') {
      const dots = document.createElement('span');
      dots.className = 'work-dot';
      dots.setAttribute('aria-hidden', 'true');
      dots.appendChild(document.createElement('i'));
      prov.appendChild(dots);
    }
    why.appendChild(prov);
    const headline = document.createElement('h3');
    headline.className = 'optimize-headline';
    // The fallback is the phase titles joined, which the map below states
    // better. Shown only when there is no map to read it from, or when a model
    // wrote something the map does not say.
    headline.textContent = plan.phrasedSummary
      || (plan.priorities.length ? '' : 'Nothing is sequenced: no actionable findings were recorded.');
    headline.hidden = !headline.textContent;
    const lede = document.createElement('p');
    lede.className = 'hint';
    lede.textContent = 'Findings are clustered by what you would change to fix them, then sequenced by what each group unblocks. This is a dependency order, not a severity ranking. Severity and confidence stay exactly as the scanner recorded them, and are shown on every group.';
    why.append(headline, lede);
    why.appendChild(planOfAttack(plan));

    const tabs = shadow.querySelector('.optimize-tabs');
    tabs.innerHTML = '';
    for (const entry of OPTIMIZE_LENSES) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = `fx-tab${entry.id === lens ? ' active' : ''}`;
      btn.textContent = entry.label;
      btn.addEventListener('click', () => { siteAudit.optimizeLens = entry.id; renderOptimizeSection(); });
      tabs.appendChild(btn);
    }

    const body = shadow.querySelector('.optimize-body');
    body.innerHTML = '';
    if (lens === 'priorities') optimizePrioritiesLens(body, plan);
    else if (lens === 'model') optimizeModelLens(body, plan);
    else optimizeTrailLens(body, plan);
    // The plan repaints while the wording request settles; a focus set once
    // would not survive that, so it is re-applied with the rows it points at.
    applyPlanFocus();
  }

  const CHANGE_SCOPE_TONE = { sitewide: 'brand', template: 'outline', page: 'muted' };
  const PRIORITY_TONE = { blocker: 'critical-solid', high: 'critical', medium: 'warn', low: 'muted' };

  /** A rule, openable in Findings. The plan never asserts anything it cannot
   * hand back to the evidence it came from. */
  function ruleChip(row) {
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'optimize-rule';
    chip.title = `${row.ruleId}: ${row.instances} finding${row.instances === 1 ? '' : 's'} on ${row.pages} page${row.pages === 1 ? '' : 's'}, ${row.confidence}`;
    chip.textContent = row.title;
    const n = document.createElement('span');
    n.textContent = String(row.instances);
    chip.appendChild(n);
    chip.addEventListener('click', () => {
      siteAudit.findingsSearch = row.ruleId;
      switchSiteAuditTab('findings');
    });
    return chip;
  }

  /**
   * One change: the row a plan is executed from.
   *
   * Closed, it answers the three questions someone assigning work asks — which
   * job, what do I edit, and what does it say now. Open, it answers the three
   * the person doing the work asks: what do I change it to, how do I know it is
   * done, and exactly which pages. Nothing here is inferred — an unknown
   * current value is stated as unrecorded rather than filled with something
   * plausible, because a plausible value in a plan is what gets a consultant
   * caught in front of a client.
   */
  function changeRow(change) {
    const li = document.createElement('li');
    const bodyId = `change-${change.id}`;
    const head = document.createElement('button');
    head.type = 'button';
    head.className = 'change-head';
    head.setAttribute('aria-expanded', 'false');
    head.setAttribute('aria-controls', bodyId);
    head.innerHTML = '<span class="change-id"></span><span class="pill change-priority"></span><span class="change-loc"></span><span class="change-now"></span><span class="change-meta"><span class="change-category"></span><span class="pill change-scope"></span></span><svg class="change-caret" viewBox="0 0 12 12" aria-hidden="true"><path d="M4.5 2.5L8 6l-3.5 3.5"/></svg>';
    head.querySelector('.change-id').textContent = change.id;
    // Four facts, closed: how soon, what kind of work, what to edit, how far it
    // reaches. That is what someone deciding whether to open a row is asking.
    const priority = head.querySelector('.change-priority');
    priority.dataset.tone = PRIORITY_TONE[change.priority] || 'muted';
    priority.textContent = change.priorityLabel || 'Low';
    head.querySelector('.change-category').textContent = change.category || '';
    head.querySelector('.change-loc').textContent = change.location;
    const now = head.querySelector('.change-now');
    now.textContent = change.current || change.absence || 'value not recorded';
    if (change.current) now.title = change.current;
    else now.classList.add('absent');
    const scope = head.querySelector('.change-scope');
    scope.dataset.tone = CHANGE_SCOPE_TONE[change.scope] || 'muted';
    scope.textContent = change.scopeLabel;

    const body = document.createElement('div');
    body.className = 'change-body';
    body.id = bodyId;
    body.hidden = true;
    const facts = document.createElement('dl');
    facts.className = 'change-facts';
    const fact = (term, value, mono) => {
      if (!value) return;
      const dt = document.createElement('dt');
      dt.textContent = term;
      const dd = document.createElement('dd');
      if (mono) dd.className = 'mono';
      dd.textContent = value;
      facts.append(dt, dd);
    };
    fact('Change', change.action);
    fact('Done when', change.doneWhen);
    fact('Effort', change.effort);
    fact('Priority', change.priorityReason);
    body.appendChild(facts);

    const evidence = document.createElement('div');
    evidence.className = 'optimize-rules';
    evidence.append(
      // No severity pill here. The row already carries a priority pill, and two
      // unlabelled pills both reading "High" while meaning different things is
      // worse than one. The priority sentence above states the severity in
      // words, and the rule chip carries it too.
      confidencePill(change.confidence),
      ruleChip({ ruleId: change.ruleId, title: change.title, instances: change.instances, pages: change.pages, confidence: change.confidence })
    );
    body.appendChild(evidence);

    draftControls(change, body);

    if (change.urls.length) {
      const where = document.createElement('p');
      where.className = 'change-where';
      where.textContent = change.pages === 1 ? 'On this page' : `On ${change.pages} pages`;
      body.appendChild(where);
      const list = document.createElement('div');
      list.className = 'url-list';
      for (const url of change.urls.slice(0, 8)) {
        const a = document.createElement('a');
        a.className = 'url-item';
        a.href = url;
        a.target = '_blank';
        a.rel = 'noopener noreferrer';
        a.textContent = shortUrl(url);
        a.title = url;
        list.appendChild(a);
      }
      body.appendChild(list);
      const notes = [];
      const hidden = change.urls.length - 8;
      if (hidden > 0) notes.push(`${hidden} further page${hidden === 1 ? '' : 's'} not listed.`);
      // A template change carries one page's value as a sample. Saying so is
      // the difference between an example and a claim about every page.
      if (change.currentIsSample && change.pages > 1) notes.push('The value above is from the first of these pages; the others carry their own.');
      if (notes.length) {
        const more = document.createElement('p');
        more.className = 'change-more';
        more.textContent = notes.join(' ');
        body.appendChild(more);
      }
    }

    head.addEventListener('click', () => {
      const showing = body.hidden;
      body.hidden = !showing;
      head.setAttribute('aria-expanded', String(showing));
    });
    li.append(head, body);
    return li;
  }

  /**
   * Drafting the replacement text for one change.
   *
   * The only place in Lumen where a model produces something the operator could
   * not have got from the scan, and the only place where page text leaves the
   * machine. Both facts are stated on the control rather than in a settings
   * screen, and it never runs on its own: one change, one click, one draft.
   *
   * The draft is a proposal. It is never written to the site, never merged into
   * a finding, and never treated as the current value; it sits beside the
   * change and travels into the Action Plan's "Change it to" column, labelled
   * as a draft, for a person to accept or edit.
   */
  const DRAFT_FAILURE = {
    DRAFT_EMPTY: 'the model returned nothing',
    DRAFT_SHORT: 'too short',
    DRAFT_LONG: 'too long',
    DRAFT_UNCHANGED: 'it repeated the current value',
    DRAFT_DUPLICATE: 'it matched another page',
    DRAFT_CLAIM: 'it made a claim the audit cannot support',
    DRAFT_UNGROUNDED: 'it did not use this page\'s own words',
    DRAFT_MARKUP: 'it contained markup',
    DRAFT_URL: 'it contained a URL',
    DRAFT_MARKDOWN: 'it contained markdown',
    DRAFT_MULTILINE: 'it was more than one line'
  };

  async function draftChangeValue(change) {
    const api = globalThis.LumenChangeDrafts;
    if (!api?.draftEnvelope) return { ok: false, message: 'The draft rules are not loaded.' };
    const envelope = api.draftEnvelope(change, change.page || {}, change.siblings || []);
    if (!envelope) return { ok: false, message: 'This change has no single value to draft.' };
    const { provider } = await briefPhrasingProvider();
    if (provider === 'off' || provider === 'none') {
      return { ok: false, message: 'No model is configured. Set one under Writing in the Lumen side panel.' };
    }
    const prompt = api.draftPrompt(envelope);

    let raw = '';
    if (provider === 'byo') {
      const response = await chrome.runtime.sendMessage({
        type: 'BRIEF_AI_PHRASE', provider: 'byo', system: prompt.system, user: prompt.user
      }).catch((error) => ({ ok: false, message: String(error?.message || error) }));
      if (!response?.ok) return { ok: false, message: response?.message || 'Your endpoint did not answer.' };
      raw = String(response.text || '');
    } else {
      const model = globalThis.LanguageModel;
      if (!model?.create) return { ok: false, message: 'This browser has no built-in model.' };
      let session = null;
      try {
        session = await model.create({ expectedInputs: [{ type: 'text' }], initialPrompts: [{ role: 'system', content: prompt.system }] });
        raw = String(await session.prompt(prompt.user));
      } catch (error) {
        return { ok: false, message: String(error?.message || error) };
      } finally {
        try { session?.destroy?.(); } catch {}
      }
    }

    let parsed = raw;
    try { parsed = JSON.parse(raw.replace(/^[^{]*/, '').replace(/[^}]*$/, '')); } catch { parsed = raw; }
    const verdict = api.validateChangeDraft(parsed, envelope);
    if (!verdict.ok) {
      return { ok: false, message: `The draft was discarded: ${DRAFT_FAILURE[verdict.code] || verdict.message || verdict.code}.` };
    }
    return { ok: true, draft: verdict.draft, provider };
  }

  /** The control, and the two states it has after being pressed. */
  function draftControls(change, body) {
    const api = globalThis.LumenChangeDrafts;
    if (!api?.draftableField?.(change.ruleId)) return;
    const wrap = document.createElement('div');
    wrap.className = 'draft';
    const row = document.createElement('div');
    row.className = 'draft-row';
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'btn draft-btn';
    button.textContent = change.draft ? 'Draft again' : 'Draft a replacement';
    const note = document.createElement('span');
    note.className = 'draft-note';
    // Said here, on the control, because this is the one request that carries
    // the page's own text off the machine.
    note.textContent = 'Sends this page\'s title, heading and address to your model.';
    row.append(button, note);
    wrap.appendChild(row);

    const out = document.createElement('div');
    out.className = 'draft-out';
    out.hidden = !change.draft;
    if (change.draft) paintDraft(out, change);
    wrap.appendChild(out);

    button.addEventListener('click', async () => {
      button.disabled = true;
      const was = button.textContent;
      button.textContent = 'Drafting…';
      out.hidden = false;
      out.textContent = '';
      const result = await draftChangeValue(change);
      button.disabled = false;
      button.textContent = 'Draft again';
      if (!result.ok) {
        out.textContent = '';
        const problem = document.createElement('p');
        problem.className = 'draft-problem';
        problem.textContent = result.message;
        out.appendChild(problem);
        void was;
        return;
      }
      change.draft = result.draft;
      change.draftBy = result.provider;
      paintDraft(out, change);
    });
    body.appendChild(wrap);
  }

  function paintDraft(out, change) {
    out.textContent = '';
    const label = document.createElement('span');
    label.className = 'draft-label';
    label.textContent = 'Drafted, not applied';
    const value = document.createElement('p');
    value.className = 'draft-value';
    value.textContent = change.draft;
    const meta = document.createElement('p');
    meta.className = 'draft-meta';
    meta.textContent = `${change.draft.length} characters · written by ${change.draftBy === 'byo' ? 'your model' : 'the model on this device'} · exported in the Action Plan for you to check`;
    const drop = document.createElement('button');
    drop.type = 'button';
    drop.className = 'link-btn draft-drop';
    drop.textContent = 'Discard';
    drop.addEventListener('click', () => {
      delete change.draft;
      delete change.draftBy;
      out.hidden = true;
      out.textContent = '';
    });
    out.append(label, value, meta, drop);
  }

  function changeList(changes) {
    const list = document.createElement('ul');
    list.className = 'change-list';
    for (const change of changes) list.appendChild(changeRow(change));
    return list;
  }

  /**
   * What the plan concluded across findings, above the work itself.
   *
   * Two kinds of claim live here and neither belongs to a single scanner:
   * changes that look like one template edit, and situations where the site's
   * own signals disagree and no instruction is defensible. Both are drawn as
   * something to weigh rather than something decided.
   *
   * Questions come first. A template proposal is an efficiency; an open
   * decision changes what the work should be, and sequencing around it is the
   * next thing the reader does. Neither block appears at all when there is
   * nothing to say, because a heading over an empty region is how a screen
   * starts looking padded.
   */
  function renderPlanReasoning(body, plan) {
    const merges = plan.templateActions || [];
    const questions = plan.openQuestions || [];
    if (!merges.length && !questions.length) return;

    const head = document.createElement('div');
    head.className = 'reason-section';
    const title = document.createElement('h3');
    title.textContent = 'Read across the findings';
    const note = document.createElement('p');
    note.className = 'hint';
    note.textContent = 'Conclusions no single check could reach, because each is about how several findings relate. They sit before the sequence: an open decision changes what the work should be.';
    head.append(title, note);
    body.appendChild(head);

    for (const question of questions) body.appendChild(questionCard(question));
    for (const merge of merges) body.appendChild(templateCard(merge));
  }

  function questionCard(question) {
    const card = document.createElement('section');
    card.className = 'reason-card question';
    const head = document.createElement('div');
    head.className = 'reason-head';
    const tag = document.createElement('span');
    tag.className = 'pill';
    tag.dataset.tone = 'warn';
    tag.textContent = 'Needs a decision';
    const title = document.createElement('h3');
    title.textContent = question.question;
    head.append(tag, title);

    const why = document.createElement('p');
    why.className = 'reason-body';
    why.textContent = question.why;
    const blocked = document.createElement('p');
    blocked.className = 'reason-caveat';
    blocked.textContent = question.blocked;
    const settled = document.createElement('p');
    settled.className = 'reason-settled';
    settled.textContent = question.settledBy;
    card.append(head, why, blocked, settled);

    // Four pages, then a count. The first version listed every affected URL in
    // a tall scroller that was taller than the question it was evidence for,
    // which is the wrong thing to give the most room to. The full list travels
    // in the export, where a reader is working through them one at a time.
    if (question.urls?.length) {
      const list = document.createElement('div');
      list.className = 'url-list reason-urls';
      for (const url of question.urls.slice(0, 4)) list.appendChild(urlLink(url));
      card.appendChild(list);
      const hidden = Number(question.count || question.urls.length) - Math.min(4, question.urls.length);
      if (hidden > 0) {
        const more = document.createElement('p');
        more.className = 'change-more';
        more.textContent = `and ${hidden} more page${hidden === 1 ? '' : 's'}, listed in the exported Action Plan.`;
        card.appendChild(more);
      }
    }
    return card;
  }

  function templateCard(merge) {
    const card = document.createElement('section');
    card.className = 'reason-card merge';
    const head = document.createElement('div');
    head.className = 'reason-head';
    const tag = document.createElement('span');
    tag.className = 'pill';
    tag.dataset.tone = 'brand';
    tag.textContent = merge.id;
    const title = document.createElement('h3');
    title.textContent = `These ${merge.resolves.length} changes look like one template edit`;
    const scope = document.createElement('span');
    scope.className = 'reason-scope';
    scope.textContent = `${merge.pages} page${merge.pages === 1 ? '' : 's'} · ${merge.findings} finding${merge.findings === 1 ? '' : 's'}`;
    head.append(tag, title, confidencePill(merge.confidence), scope);

    const cause = document.createElement('p');
    cause.className = 'reason-body';
    cause.textContent = merge.rootCause;

    const covers = document.createElement('div');
    covers.className = 'reason-covers';
    for (const step of merge.implementation) {
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'optimize-rule';
      chip.textContent = `${step.id} ${step.location}`;
      chip.title = step.action || '';
      // The merge never replaces what it covers, so every chip opens the change
      // it names rather than standing in for it.
      chip.addEventListener('click', () => openChange(step.id));
      covers.appendChild(chip);
    }

    const caveat = document.createElement('p');
    caveat.className = 'reason-caveat';
    caveat.textContent = merge.caveat;
    card.append(head, cause, covers, caveat);
    return card;
  }

  /** Open one change row by id and bring it into view. */
  function openChange(id) {
    const row = siteAudit.shadow.querySelector(`#change-${id}`);
    const toggle = row?.previousElementSibling;
    if (!row || !toggle) return;
    row.hidden = false;
    toggle.setAttribute('aria-expanded', 'true');
    toggle.scrollIntoView({ block: 'center' });
  }

  function urlLink(url) {
    const a = document.createElement('a');
    a.className = 'url-item';
    a.href = url;
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    a.textContent = shortUrl(url);
    a.title = url;
    return a;
  }

  /**
   * The route into the plan, from anywhere that shows a problem.
   *
   * Optimize links out to Findings from every rule chip, and until now nothing
   * linked back. The flagship surface was reachable only from the nav, which
   * left a reader looking at a confirmed fault with no way to ask the one
   * question the product exists to answer.
   *
   * Passing a rule opens the plan and the change that resolves it. Where the
   * plan has not been built yet, this builds it: making someone press a second
   * button to see the answer they just asked for is a hop with no decision in
   * it. Where the rule is not in the plan, the plan still opens and says why,
   * because "this is informational and asks for no change" is an answer.
   */
  async function openPlanFor(ruleId) {
    siteAudit.planFocusRule = String(ruleId || '');
    switchSiteAuditTab('optimize');
    if (!siteAudit.plan && !siteAudit.planBuilding) await buildOptimizePlanNow();
    applyPlanFocus();
  }

  /**
   * Reveal the changes that resolve the rule a reader arrived on.
   *
   * Applied at the end of every render rather than once on arrival. The plan
   * repaints at least twice after it is built, because the wording request
   * moves through pending and then settles, and a focus applied once was wiped
   * by the next repaint a second later. Anything that survives a re-render has
   * to be derived during one.
   */
  function applyPlanFocus() {
    const ruleId = siteAudit.planFocusRule;
    const note = siteAudit.shadow?.querySelector('.optimize-focus');
    if (!note) return;
    if (!ruleId || !siteAudit.plan) { note.hidden = true; return; }

    const matches = [];
    for (const priority of siteAudit.plan.priorities || []) {
      for (const action of priority.actions || []) {
        for (const change of action.changes || []) if (change.ruleId === ruleId) matches.push(change.id);
      }
    }

    note.hidden = false;
    note.textContent = matches.length
      ? `Showing the ${matches.length === 1 ? 'change that resolves' : matches.length + ' changes that resolve'} ${ruleId}.`
      // Not every finding becomes work, and saying so is a better answer than
      // an empty result: an observation asks for no change by design.
      : `${ruleId} is not in the plan. It was recorded as an observation rather than as work, so no change resolves it.`;
    const clear = document.createElement('button');
    clear.type = 'button';
    clear.className = 'link-btn';
    clear.textContent = 'Show the whole plan';
    clear.addEventListener('click', () => {
      siteAudit.planFocusRule = '';
      note.hidden = true;
    });
    note.appendChild(clear);
    for (const id of matches) openChange(id);
  }

  /**
   * When each phase happens, rather than what number it is.
   *
   * The sequence was rendered as an ordered list, which is accurate and reads
   * as a list of findings: a reader could see three headings and still not know
   * which one to start on this afternoon. A dependency order has a *shape* —
   * something is happening now, something waits on it — and the words for that
   * are Now, Next, Then, Later, not 01, 02, 03.
   *
   * The labels describe position in the sequence that actually exists. A plan
   * with two phases says Now and Next and stops; there is no fourth slot to
   * fill, and padding one would be inventing work.
   */
  const PHASE_WHEN = ['Now', 'Next', 'Then', 'Later'];
  // Position in a sequence is one idea, so it is one hue getting quieter.
  // Severity has its own ramp in this product and a phase label must not borrow
  // it: "do this first" is not "this is worse".
  const PHASE_TONE = { Now: 'brand', Next: 'outline', Then: 'muted', Later: 'muted' };

  function planOfAttack(plan) {
    const wrap = document.createElement('div');
    wrap.className = 'attack';
    const list = document.createElement('ul');
    list.className = 'attack-list';

    plan.priorities.forEach((priority, index) => {
      const li = document.createElement('li');
      li.className = index === 0 ? 'attack-row lead' : 'attack-row';

      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'attack-open';
      // The whole row is the control: the reader's intent here is always "take
      // me to that phase", and a link buried in the title would be a smaller
      // target for the same intent.
      button.addEventListener('click', () => {
        const card = siteAudit.shadow.querySelectorAll('.optimize-priority')[index];
        card?.scrollIntoView({ block: 'start' });
      });

      const when = document.createElement('span');
      const word = PHASE_WHEN[index] || `Step ${index + 1}`;
      when.className = 'pill attack-when';
      when.dataset.tone = PHASE_TONE[word] || 'muted';
      when.textContent = word;

      const text = document.createElement('span');
      text.className = 'attack-text';
      const title = document.createElement('b');
      title.textContent = priority.phrasedTitle || priority.title;
      const summary = document.createElement('span');
      summary.className = 'attack-summary';
      summary.textContent = priority.phrasedSummary || priority.summary;
      text.append(title, summary);

      // What this phase touches, in the audit's own discipline names. Three at
      // most: past that the tags stop narrowing anything and start wrapping.
      const tags = document.createElement('span');
      tags.className = 'attack-tags';
      for (const discipline of (priority.disciplines || []).slice(0, 3)) {
        const tag = document.createElement('span');
        tag.className = 'attack-tag';
        tag.textContent = discipline;
        tags.appendChild(tag);
      }
      text.appendChild(tags);

      const count = document.createElement('span');
      count.className = 'attack-count';
      const n = document.createElement('b');
      n.textContent = String(priority.changes);
      const unit = document.createElement('span');
      // "changes" everywhere, because that is the unit the rows, the totals and
      // the exported spreadsheet all use. A second word for one thing is how a
      // plan and its export stop agreeing.
      unit.textContent = priority.changes === 1 ? 'change' : 'changes';
      count.append(n, unit);

      // The row goes somewhere, and nothing on it said so. The same caret the
      // conditions rows and the change rows use, pointing right because this
      // navigates rather than expands.
      const caret = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      caret.setAttribute('class', 'attack-caret');
      caret.setAttribute('viewBox', '0 0 12 12');
      caret.setAttribute('aria-hidden', 'true');
      const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      path.setAttribute('d', 'M4.5 2.5L8 6l-3.5 3.5');
      caret.appendChild(path);
      button.append(when, text, count, caret);
      li.appendChild(button);
      list.appendChild(li);
    });

    wrap.appendChild(list);
    return wrap;
  }

  function optimizePrioritiesLens(body, plan) {
    if (!plan.priorities.length) {
      body.appendChild(schemaEmpty('No work is sequenced.', 'The crawl recorded no findings that ask for a change. Informational observations are in Findings.'));
      return;
    }
    renderPlanReasoning(body, plan);
    for (const priority of plan.priorities) {
      const card = document.createElement('section');
      card.className = 'optimize-priority';
      const head = document.createElement('div');
      head.className = 'optimize-priority-head';
      const num = document.createElement('span');
      num.className = 'pill optimize-priority-when';
      const word = PHASE_WHEN[priority.order - 1] || `Step ${priority.order}`;
      num.dataset.tone = PHASE_TONE[word] || 'muted';
      num.textContent = word;
      const titles = document.createElement('div');
      const title = document.createElement('h3');
      title.textContent = priority.phrasedTitle || priority.title;
      const summary = document.createElement('p');
      summary.className = 'hint';
      summary.textContent = priority.phrasedSummary || priority.summary;
      titles.append(title, summary);
      const meta = document.createElement('div');
      meta.className = 'optimize-priority-meta';
      const sev = severityPill(priority.severity);
      const conf = confidencePill(priority.confidence);
      const count = document.createElement('span');
      count.className = 'optimize-count';
      // Changes lead: a plan is counted in jobs. The findings stay beside them
      // so the phase can still be reconciled against the Findings section.
      count.textContent = `${priority.changes} change${priority.changes === 1 ? '' : 's'} · ${priority.findings} finding${priority.findings === 1 ? '' : 's'}`;
      meta.append(sev, conf, count);
      head.append(num, titles, meta);

      // What this group unblocks is the reason it sits where it does. Without it
      // the order is just an assertion.
      const unblocks = document.createElement('p');
      unblocks.className = 'optimize-unblocks';
      unblocks.textContent = priority.unblocks;

      card.append(head, unblocks);

      const list = document.createElement('ul');
      list.className = 'optimize-actions';
      for (const action of priority.actions) {
        const li = document.createElement('li');
        const actionHead = document.createElement('div');
        actionHead.className = 'optimize-action-head';
        const b = document.createElement('b');
        b.textContent = action.title;
        const pages = document.createElement('span');
        pages.className = 'change-tally';
        pages.textContent = action.changeCount
          ? `${action.changeCount} change${action.changeCount === 1 ? '' : 's'} · ${action.evidence.findings} finding${action.evidence.findings === 1 ? '' : 's'}`
          : `${action.evidence.findings} on ${action.evidence.pages} page${action.evidence.pages === 1 ? '' : 's'}`;
        actionHead.append(b, pages);
        li.appendChild(actionHead);

        // Why the area matters, in the consequence the site owner feels rather
        // than a restatement of the rule. The cluster description stands in
        // where an area has not been given one.
        const rationale = document.createElement('p');
        rationale.className = action.rationale ? 'optimize-rationale' : 'hint';
        rationale.textContent = action.rationale || action.detail;
        li.appendChild(rationale);

        if (action.changes && action.changes.length) {
          // The work itself. Each row carries its own evidence chip, so
          // traceability lives on the change rather than on the area above it.
          li.appendChild(changeList(action.changes));
        } else {
          // No change could be derived from the evidence. The area is still
          // traceable rather than silently empty.
          const rules = document.createElement('div');
          rules.className = 'optimize-rules';
          for (const row of action.evidence.titles) rules.appendChild(ruleChip(row));
          li.appendChild(rules);
          const verify = document.createElement('p');
          verify.className = 'optimize-verify';
          verify.textContent = action.verify;
          li.appendChild(verify);
        }
        list.appendChild(li);
      }
      card.appendChild(list);
      body.appendChild(card);
    }
  }

  /**
   * How Lumen read the site's structure.
   *
   * This is the evidence behind every template claim the plan makes, so it is
   * shown with the measurement rather than as an assertion: how many pages,
   * how strongly they agree, and on what. A reader who does not believe a
   * template proposal should be able to come here and see exactly what it rests
   * on, including the pages that fitted nowhere.
   */
  function renderSiteStructure(body, plan) {
    const model = plan.siteStructure;
    if (!model) return;
    const card = document.createElement('section');
    card.className = 'structure';
    const head = document.createElement('div');
    head.className = 'card-head';
    const h = document.createElement('h3');
    h.textContent = 'Page groups';
    const note = document.createElement('p');
    note.className = 'hint';
    note.textContent = model.groups.length
      ? `${model.grouped} of ${model.pagesConsidered} pages read fall into ${model.groups.length} group${model.groups.length === 1 ? '' : 's'}. A group named by a path is something the site states; one named by shape is something Lumen measured.`
      : `None of the ${model.pagesConsidered} pages read fall into a group. Nothing in the plan is treated as template work.`;
    head.append(h, note);
    card.appendChild(head);

    if (model.groups.length) {
      const list = document.createElement('ul');
      list.className = 'structure-list';
      for (const group of model.groups) {
        const li = document.createElement('li');
        const top = document.createElement('div');
        top.className = 'structure-row';
        const label = document.createElement('b');
        label.textContent = group.label;
        const count = document.createElement('span');
        count.className = 'structure-count';
        count.textContent = `${group.count} page${group.count === 1 ? '' : 's'}`;
        const conf = confidencePill(group.confidence);
        const template = document.createElement('span');
        template.className = 'pill';
        template.dataset.tone = group.probableTemplate ? 'brand' : 'muted';
        template.textContent = group.probableTemplate ? 'Probably one template' : 'Not a template';
        top.append(label, count, conf, template);
        const basis = document.createElement('p');
        basis.className = 'structure-basis';
        basis.textContent = group.basis;
        li.append(top, basis);
        list.appendChild(li);
      }
      card.appendChild(list);
    }

    if (model.shapeSearchSkipped) {
      const skipped = document.createElement('p');
      skipped.className = 'hint';
      skipped.textContent = `${model.shapeSearchSkipped.candidates} pages sit at addresses that say nothing about a family. Comparing them all with each other is more work than a plan should spend, so Lumen did not look for a shared shape among them. Any group named by a path above is unaffected.`;
      body.lastElementChild.appendChild(skipped);
    }
    if (model.ungrouped.length) {
      const rest = document.createElement('p');
      rest.className = 'hint';
      // Named rather than dropped: a model that silently assigns every page
      // somewhere is a model nobody can check.
      rest.textContent = `${model.ungrouped.length} page${model.ungrouped.length === 1 ? '' : 's'} fitted no group: ${[...new Set(model.ungrouped.map((u) => u.reason))].slice(0, 3).join('; ')}.`;
      card.appendChild(rest);
    }
    body.appendChild(card);
  }

  function optimizeModelLens(body, plan) {
    renderSiteStructure(body, plan);
    const model = plan.siteModel;
    const card = document.createElement('div');
    card.className = model.established ? 'optimize-model' : 'optimize-model unestablished';
    const head = document.createElement('div');
    head.className = 'schema-conflict-head';
    const b = document.createElement('b');
    b.textContent = model.label;
    const pill = document.createElement('span');
    pill.className = 'pill cap';
    pill.dataset.tone = model.established ? 'ok' : 'muted';
    pill.textContent = model.confidence;
    head.append(b, pill);
    const basis = document.createElement('p');
    basis.className = 'hint';
    basis.textContent = model.basis;
    card.append(head, basis);
    if (model.evidence?.length) {
      const list = document.createElement('div');
      list.className = 'optimize-model-evidence';
      for (const row of model.evidence) {
        const item = document.createElement('div');
        item.className = 'schema-variant';
        const code = document.createElement('code');
        code.textContent = row.type;
        const count = document.createElement('span');
        count.textContent = `${row.pages} page${row.pages === 1 ? '' : 's'} · ${row.items} item${row.items === 1 ? '' : 's'}`;
        item.append(code, count);
        list.appendChild(item);
      }
      card.appendChild(list);
    }
    body.appendChild(card);

    const research = document.createElement('div');
    research.className = 'optimize-model unestablished';
    const rHead = document.createElement('div');
    rHead.className = 'schema-conflict-head';
    const rb = document.createElement('b');
    rb.textContent = 'Connected research';
    const rPill = document.createElement('span');
    rPill.className = 'pill';
    rPill.dataset.tone = 'muted';
    rPill.textContent = plan.research.connected ? 'Connected' : 'Not connected';
    rHead.append(rb, rPill);
    const rNote = document.createElement('p');
    rNote.className = 'hint';
    rNote.textContent = plan.research.note;
    research.append(rHead, rNote);
    body.appendChild(research);
  }

  /** Where every finding went, including the ones the plan deliberately does not
   * sequence. A plan whose totals cannot be reconciled against the Findings
   * section is a plan the reader has to take on trust. */
  function optimizeTrailLens(body, plan) {
    const intro = document.createElement('p');
    intro.className = 'hint schema-opportunity-note';
    intro.textContent = `Every finding this audit recorded, and what the plan did with it. ${plan.totals.findings} findings across ${plan.totals.patterns} patterns: ${plan.totals.actionableFindings} sequenced into ${plan.totals.clusters} clusters, ${plan.informational.findings} recorded as informational and not sequenced.`;
    body.appendChild(intro);

    const table = document.createElement('table');
    table.className = 'data-table schema-table';
    table.innerHTML = '<thead><tr><th>Cluster</th><th>Sequenced into</th><th class="col-num">Findings</th><th>Rules</th></tr></thead>';
    const tbody = document.createElement('tbody');
    for (const priority of plan.priorities) {
      for (const action of priority.actions) {
        const tr = document.createElement('tr');
        const cluster = document.createElement('td');
        const cb = document.createElement('b');
        cb.textContent = action.title;
        cluster.appendChild(cb);
        const into = document.createElement('td');
        into.textContent = `Priority ${priority.order}: ${priority.title}`;
        const n = document.createElement('td');
        n.className = 'col-num';
        n.textContent = String(action.evidence.findings);
        const rules = document.createElement('td');
        const code = document.createElement('code');
        code.className = 'optimize-ruleids';
        code.textContent = action.evidence.ruleIds.join(', ');
        rules.appendChild(code);
        tr.append(cluster, into, n, rules);
        tbody.appendChild(tr);
      }
    }
    if (plan.informational.patterns) {
      const tr = document.createElement('tr');
      tr.className = 'optimize-excluded';
      const cluster = document.createElement('td');
      const cb = document.createElement('b');
      cb.textContent = 'Informational observations';
      const note = document.createElement('span');
      note.className = 'schema-detail';
      note.textContent = plan.informational.note;
      cluster.append(cb, note);
      const into = document.createElement('td');
      into.textContent = 'Not sequenced';
      const n = document.createElement('td');
      n.className = 'col-num';
      n.textContent = String(plan.informational.findings);
      const rules = document.createElement('td');
      const code = document.createElement('code');
      code.className = 'optimize-ruleids';
      code.textContent = plan.informational.rules.join(', ');
      rules.appendChild(code);
      tr.append(cluster, into, n, rules);
      tbody.appendChild(tr);
    }
    table.appendChild(tbody);
    body.appendChild(table);
  }

  async function switchSiteAuditTab(tab, view) {
    siteAudit.tab = tab;
    const shadow = siteAudit.shadow;
    const discipline = Boolean(SITE_AUDIT_DISCIPLINE_META[tab]);
    for (const btn of shadow.querySelectorAll('.tab')) btn.classList.toggle('active', btn.dataset.tab === tab);
    // A parent's scopes are revealed in place, so the navigation the operator
    // was reading stays on screen.
    for (const nav of shadow.querySelectorAll('.subnav')) nav.hidden = nav.dataset.for !== tab;
    if (view !== undefined) siteAudit.subview = { ...(siteAudit.subview || {}), [tab]: view };
    const openView = (siteAudit.subview || {})[tab] || 'all';
    for (const btn of shadow.querySelectorAll('.subnav-item')) {
      btn.classList.toggle('active', btn.dataset.tab === tab && btn.dataset.view === openView);
    }
    const panelFor = tab === 'browser' ? 'browser' : tab;
    for (const panel of shadow.querySelectorAll('.tab-panel')) {
      panel.hidden = discipline ? !panel.classList.contains('section-panel') : !panel.classList.contains(`${panelFor}-panel`);
    }
    // A section can be several screens tall. Arriving at one already scrolled
    // to where the previous section happened to be is disorienting.
    const main = shadow.querySelector('.view-results .main');
    if (main) main.scrollTop = 0;
    if (discipline) {
      if (!siteAudit.rawFindingGroups) await loadSiteAuditFindings({ silent: true });
      if (!siteAudit) return;
      return renderDisciplineSection(tab);
    }
    if (tab === 'findings') { shadow.querySelector('.findings-search').value = siteAudit.findingsSearch; return loadSiteAuditFindings(); }
    if (tab === 'urls') {
      const scope = (SITE_AUDIT_SUBVIEWS.urls.find((v) => v.id === openView) || {}).scope || {};
      siteAudit.urlsStatus = scope.statuses || '';
      siteAudit.urlsIndexable = scope.indexable || '';
      siteAudit.urlsDepth = null;
      siteAudit.urlsHttpClass = '';
      siteAudit.urlsOffset = 0;
      return loadSiteAuditUrls();
    }
    if (tab === 'links') {
      const scope = SITE_AUDIT_SUBVIEWS.links.find((v) => v.id === openView) || {};
      siteAudit.linksStatus = scope.status || '';
      siteAudit.linksOffset = 0;
      shadow.querySelector('.links-status').value = siteAudit.linksStatus;
      return loadSiteAuditLinks();
    }
    if (tab === 'schema') return loadSiteAuditSchema();
    if (tab === 'optimize') return loadSiteAuditOptimize();
    if (tab === 'browser') return renderBrowserChecks();
  }


  async function loadSiteAuditFindings({ silent = false } = {}) {
    const r = await chrome.runtime.sendMessage({ type: 'SITE_AUDIT_FINDINGS', auditId: siteAudit.auditId, groupByRule: true }).catch(() => null);
    if (!siteAudit) return;
    siteAudit.rawFindingGroups = r?.groups || [];
    // `silent` is for a discipline section priming the groups it needs: the
    // Findings tab is not on screen, and painting its list would fight with
    // the section that is about to render.
    if (!silent) renderFindingsList();
    renderNavStates();
  }

  /**
   * The Findings screen: issue patterns on the left, one inspected pattern on
   * the right.
   *
   * 343 observations do not become 343 rows. They group into the distinct
   * patterns behind them, which is what an operator can actually act on — and
   * the footer says so, because a view that silently reduces a number owes the
   * reader an account of where the rest went.
   */
  const SITE_AUDIT_FX_COLUMNS = [
    { id: 'issue', label: 'Issue', fixed: true },
    { id: 'area', label: 'Area' },
    { id: 'affected', label: 'Affected', fixed: true },
    { id: 'evidence', label: 'Evidence', fixed: true },
    { id: 'instances', label: 'Instances' },
    { id: 'rule', label: 'Rule id' }
  ];

  const SITE_AUDIT_LENSES = {
    priority: { label: 'Lumen priority', note: 'Priority order active' },
    all: { label: 'All patterns', note: 'Scanner order' },
    sitewide: { label: 'Sitewide', note: 'Repeated across the site' },
    unconfirmed: { label: 'Needs confirmation', note: 'Not independently established' }
  };

  function fxColumns() {
    const chosen = siteAudit.fxColumns || (siteAudit.fxColumns = ['issue', 'area', 'affected', 'evidence']);
    return SITE_AUDIT_FX_COLUMNS.filter((c) => c.fixed || chosen.includes(c.id));
  }

  /** Patterns after the search box, the three selects and the active lens. */
  function fxVisibleGroups() {
    const all = siteAudit.rawFindingGroups || [];
    const search = String(siteAudit.findingsSearch || '').trim().toLowerCase();
    const category = siteAudit.findingsCategory;
    const area = siteAudit.findingsImpactClass;
    const evidence = siteAudit.findingsEvidence || '';
    const fetched = Number(siteAudit.audit?.urlCounts?.fetched || 0);
    const lens = siteAudit.fxLens || 'priority';

    let rows = all.filter((g) =>
      (!search || g.rule_id.toLowerCase().includes(search) || findingLabel(g).toLowerCase().includes(search) || (SITE_AUDIT_AREA_LABEL[disciplineOf(g.rule_id)] || '').toLowerCase().includes(search)) &&
      (!category || g.category === category) &&
      (!area || disciplineOf(g.rule_id) === area) &&
      (!evidence || g.confidence === evidence) &&
      (!siteAudit.findingsHideUnconfirmed || g.confidence === 'confirmed'));

    if (lens === 'sitewide') rows = rows.filter((g) => fetched >= 3 && Number(g.affected_urls || 0) >= Math.ceil(fetched * 0.75));
    if (lens === 'unconfirmed') rows = rows.filter((g) => g.confidence === 'inferred' || g.confidence === 'inconclusive');

    const rank = { critical: 0, high: 1, medium: 2, low: 3, info: 4 };
    const sort = siteAudit.findingsSort || 'severity';
    const byScanner = (a, b) =>
      (rank[a.severity] ?? 9) - (rank[b.severity] ?? 9) || (b.affected_urls || 0) - (a.affected_urls || 0);
    if (lens === 'all') rows.sort((a, b) => (b.instances || 0) - (a.instances || 0));
    else if (sort === 'pages') rows.sort((a, b) => (b.affected_urls || 0) - (a.affected_urls || 0));
    else if (sort === 'instances') rows.sort((a, b) => (b.instances || 0) - (a.instances || 0));
    else if (sort === 'area') rows.sort((a, b) => String(disciplineOf(a.rule_id)).localeCompare(String(disciplineOf(b.rule_id))) || byScanner(a, b));
    else {
      // Lumen priority: visitor impact first, then established evidence, then
      // breadth. The scanner's own labels are untouched by this ordering.
      rows.sort((a, b) =>
        Number(disciplineOf(b.rule_id) === 'availability' && (b.confidence === 'confirmed' || b.confidence === 'corroborated')) -
        Number(disciplineOf(a.rule_id) === 'availability' && (a.confidence === 'confirmed' || a.confidence === 'corroborated')) ||
        byScanner(a, b) ||
        Number(a.confidence === 'inconclusive') - Number(b.confidence === 'inconclusive'));
    }
    return rows;
  }

  function renderFindingsList() {
    const shadow = siteAudit.shadow;
    const all = siteAudit.rawFindingGroups || [];
    const rows = fxVisibleGroups();
    const audit = siteAudit.audit || {};
    const counts = audit.urlCounts || {};
    const fetched = Number(counts.fetched || 0);
    const discovered = Object.values(counts).reduce((s, n) => s + Number(n || 0), 0);

    let host = siteAudit.siteOrigin || '';
    try { host = new URL(audit?.config?.startUrl || siteAudit.siteOrigin).hostname; } catch {}
    shadow.querySelector('.fx-meta').textContent =
      `${host} · ${auditProvenanceLine(audit).split(' · ').pop()} · evidence from ${fetched} fetched page${fetched === 1 ? '' : 's'}`;

    const observations = all.reduce((n, g) => n + Number(g.instances || 0), 0);
    const actionable = all.filter((g) => g.category === 'fix').reduce((n, g) => n + Number(g.instances || 0), 0);
    shadow.querySelector('.fx-observations').textContent = fmtCount(observations);
    shadow.querySelector('.fx-patterns').textContent = fmtCount(all.length);
    shadow.querySelector('.fx-action').textContent = fmtCount(actionable);
    shadow.querySelector('.fx-pages').textContent = String(fetched);
    shadow.querySelector('.fx-pages-sub').textContent = discovered > fetched ? `of ${discovered}` : 'all discovered';

    for (const btn of shadow.querySelectorAll('.lens')) btn.classList.toggle('active', btn.dataset.lens === (siteAudit.fxLens || 'priority'));
    shadow.querySelector('.lens-state').textContent = SITE_AUDIT_LENSES[siteAudit.fxLens || 'priority'].note;
    shadow.querySelector('.filter-state').textContent = `${rows.length} of ${all.length} pattern${all.length === 1 ? '' : 's'} shown`;
    shadow.querySelector('.fx-foot-text').textContent =
      `${observations} observation${observations === 1 ? '' : 's'} remain unchanged; this view groups them into ${all.length} inspectable issue pattern${all.length === 1 ? '' : 's'}.`;

    renderFxTable(rows);
    const selected = rows.find((g) => `${g.rule_id}::${g.confidence}` === siteAudit.fxSelected) || rows[0];
    siteAudit.fxSelected = selected ? `${selected.rule_id}::${selected.confidence}` : null;
    renderFxDetail(selected, rows.indexOf(selected));
  }

  function renderFxTable(rows) {
    const shadow = siteAudit.shadow;
    const head = shadow.querySelector('.fx-head-row');
    const body = shadow.querySelector('.fx-body');
    const cols = fxColumns();
    head.innerHTML = '';
    for (const col of cols) {
      const th = document.createElement('th');
      th.textContent = col.label;
      if (col.id === 'evidence' || col.id === 'affected' || col.id === 'instances') th.className = 'col-status';
      head.appendChild(th);
    }
    const page = rows.slice(siteAudit.fxOffset || 0, (siteAudit.fxOffset || 0) + SITE_AUDIT_FX_PAGE);
    body.innerHTML = '';
    if (!page.length) {
      const tr = document.createElement('tr');
      const td = document.createElement('td');
      td.colSpan = cols.length;
      td.className = 'empty-row';
      td.textContent = rows.length ? 'Nothing on this page.' : (siteAudit.rawFindingGroups || []).length ? 'No pattern matches these filters.' : 'No findings recorded yet.';
      tr.appendChild(td);
      body.appendChild(tr);
    }
    for (const g of page) {
      const key = `${g.rule_id}::${g.confidence}`;
      const tr = document.createElement('tr');
      tr.className = `fx-row${key === siteAudit.fxSelected ? ' selected' : ''}`;
      for (const col of cols) tr.appendChild(fxCell(col, g));
      tr.addEventListener('click', () => { siteAudit.fxSelected = key; renderFindingsList(); });
      body.appendChild(tr);
    }
    const total = rows.length;
    const from = total ? (siteAudit.fxOffset || 0) + 1 : 0;
    const to = Math.min(total, (siteAudit.fxOffset || 0) + SITE_AUDIT_FX_PAGE);
    shadow.querySelector('.fx-label').textContent = total ? `Showing ${from}–${to} of ${total} issue pattern${total === 1 ? '' : 's'}` : '';
    shadow.querySelector('.fx-prev').disabled = (siteAudit.fxOffset || 0) === 0;
    shadow.querySelector('.fx-next').disabled = to >= total;
  }

  function fxCell(col, g) {
    const td = document.createElement('td');
    if (col.id === 'issue') {
      const title = document.createElement('span');
      title.className = 'fx-issue';
      title.textContent = findingLabel(g);
      const meta = document.createElement('span');
      meta.className = 'fx-issue-meta';
      const badge = severityPill(g.severity);
      const where = document.createElement('span');
      where.textContent = `${SITE_AUDIT_AREA_LABEL[disciplineOf(g.rule_id)] || ''} · ${g.instances} instance${g.instances === 1 ? '' : 's'}`;
      meta.append(badge, where);
      td.append(title, meta);
      return td;
    }
    if (col.id === 'area') { td.textContent = SITE_AUDIT_AREA_LABEL[disciplineOf(g.rule_id)] || ''; return td; }
    if (col.id === 'instances') { td.className = 'col-status'; td.textContent = String(g.instances); return td; }
    if (col.id === 'rule') { td.className = 'mono'; td.textContent = g.rule_id; return td; }
    if (col.id === 'affected') {
      td.className = 'col-status';
      const n = document.createElement('b');
      n.textContent = String(g.affected_urls);
      const word = document.createElement('span');
      word.className = 'fx-pages-word';
      word.textContent = g.affected_urls === 1 ? ' page' : ' pages';
      td.append(n, word);
      return td;
    }
    // Evidence
    td.className = 'col-status';
    const dot = document.createElement('span');
    dot.className = `confidence-dot ${g.confidence || 'inferred'}`;
    const label = document.createElement('span');
    label.textContent = ` ${g.confidence || 'inferred'}`;
    td.append(dot, label);
    return td;
  }

  const SITE_AUDIT_FX_PAGE = 7;

  /** The inspected pattern: what Lumen reads into it, what the scanner
   * recorded, and the move it implies — each kept visibly separate. */
  function renderFxDetail(group, index) {
    const pane = siteAudit.shadow.querySelector('.fx-detail');
    if (!pane) return;
    pane.innerHTML = '';
    if (!group) {
      const empty = document.createElement('p');
      empty.className = 'hint';
      empty.textContent = 'Select an issue pattern to inspect its evidence.';
      pane.appendChild(empty);
      return;
    }
    const kicker = document.createElement('p');
    kicker.className = 'fx-kicker';
    kicker.textContent = (siteAudit.fxLens || 'priority') === 'priority' && index >= 0
      ? `Lumen priority ${String(index + 1).padStart(2, '0')}`
      : 'Issue pattern';
    const h = document.createElement('h3');
    h.className = 'fx-detail-title';
    h.textContent = findingLabel(group);

    const badges = document.createElement('div');
    badges.className = 'brief-badges';
    const sev = severityPill(group.severity);
    const area = document.createElement('span');
    area.className = 'pill state-chip';
    area.textContent = SITE_AUDIT_AREA_LABEL[disciplineOf(group.rule_id)] || '';
    const conf = document.createElement('span');
    conf.className = 'pill signal-badge';
    const established = group.confidence === 'confirmed' || group.confidence === 'corroborated';
    conf.dataset.tone = established ? 'ok' : 'warn';
    conf.textContent = sentenceCase(group.confidence || 'inferred');
    badges.append(sev, area, conf);

    const tabs = document.createElement('nav');
    tabs.className = 'fx-tabs';
    const active = siteAudit.fxTab || 'summary';
    for (const [id, label] of [['summary', 'Summary'], ['instances', 'Instances'], ['guidance', 'Guidance']]) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = `fx-tab${id === active ? ' active' : ''}`;
      btn.textContent = label;
      btn.addEventListener('click', () => { siteAudit.fxTab = id; renderFxDetail(group, index); });
      tabs.appendChild(btn);
    }
    pane.append(kicker, h, badges, tabs);

    // Findings answers what is wrong; the plan answers what to do. An
    // observation that asks for no change is honest about having no entry:
    // openPlanFor says so rather than opening an empty search.
    const toPlan = document.createElement('button');
    toPlan.type = 'button';
    toPlan.className = 'btn fx-to-plan';
    toPlan.textContent = 'Show this in the plan';
    toPlan.addEventListener('click', () => openPlanFor(group.rule_id));
    pane.appendChild(toPlan);

    const body = document.createElement('div');
    body.className = 'fx-tab-body';
    if (active === 'summary') fxSummaryTab(body, group);
    else if (active === 'instances') fxInstancesTab(body, group);
    else fxGuidanceTab(body, group);
    pane.appendChild(body);
  }

  function fxSummaryTab(body, group) {
    const label = document.createElement('span');
    label.className = 'evidence-label';
    label.textContent = 'Lumen interpretation';
    const why = document.createElement('p');
    why.className = 'brief-why';
    const area = disciplineOf(group.rule_id);
    const established = group.confidence === 'confirmed' || group.confidence === 'corroborated';
    why.textContent = area === 'availability' && established
      ? 'These are direct journey failures rather than optimisation warnings. A visitor following the link reaches a destination that independently returned an error, which is why this ranks ahead of metadata and hygiene.'
      : established
        ? `Independently established on ${group.affected_urls} page${group.affected_urls === 1 ? '' : 's'}. The evidence settles the question; what remains is the fix.`
        : `Inferred from the static HTML on ${group.affected_urls} page${group.affected_urls === 1 ? '' : 's'}. JavaScript was not executed for this tier, so confirm on a rendered page before treating it as settled.`;

    const box = document.createElement('div');
    box.className = 'evidence-box';
    const boxLabel = document.createElement('span');
    boxLabel.className = 'evidence-label';
    boxLabel.textContent = 'Scanner evidence';
    const facts = document.createElement('dl');
    facts.className = 'evidence-facts';
    // Confidence is not repeated here: the badge states it two rows above, and
    // breadth is the fact the badges cannot carry.
    const fetched = fxFetchedPages();
    for (const [k, v] of [['Findings', String(group.instances)], ['Pages', fetched ? `${group.affected_urls} of ${fetched}` : String(group.affected_urls)]]) {
      const pair = document.createElement('div');
      const dt = document.createElement('dt');
      dt.textContent = k;
      const dd = document.createElement('dd');
      dd.textContent = v;
      pair.append(dt, dd);
      facts.appendChild(pair);
    }
    box.append(boxLabel, facts);

    const actions = document.createElement('div');
    actions.className = 'actions';
    const view = document.createElement('button');
    view.type = 'button';
    view.className = 'btn primary';
    view.textContent = `View ${group.instances} instance${group.instances === 1 ? '' : 's'}`;
    view.addEventListener('click', () => { siteAudit.fxTab = 'instances'; renderFxDetail(group, -1); });
    actions.appendChild(view);
    body.append(label, why, box, actions);
  }

  function fxInstancesTab(body, group) {
    const list = document.createElement('div');
    list.className = 'fx-instances';
    list.textContent = 'Loading affected pages…';
    body.appendChild(list);
    chrome.runtime.sendMessage({ type: 'SITE_AUDIT_FINDINGS', auditId: siteAudit.auditId, ruleId: group.rule_id, confidence: group.confidence, limit: 100 })
      .then((r) => {
        if (!siteAudit) return;
        const rows = r?.findings || [];
        list.innerHTML = '';
        if (!rows.length) { list.textContent = 'No individual rows were returned for this pattern.'; return; }
        const seen = new Set();
        for (const row of rows) {
          if (seen.has(row.url)) continue;
          seen.add(row.url);
          const a = document.createElement('a');
          a.className = 'url-item';
          a.href = row.url;
          a.target = '_blank';
          a.rel = 'noopener';
          a.textContent = shortUrl(row.url);
          a.title = row.url;
          list.appendChild(a);
        }
        const note = document.createElement('p');
        note.className = 'hint';
        note.textContent = `${seen.size} page${seen.size === 1 ? '' : 's'} carry this pattern.`;
        list.appendChild(note);
      })
      .catch(() => { list.textContent = 'Those rows could not be read just now.'; });
  }

  /** How many pages the audit actually fetched — the denominator every
   * breadth statement in the detail pane is measured against. */
  function fxFetchedPages() {
    return Number((siteAudit.audit || {}).urlCounts?.fetched || 0);
  }

  function fxGuidanceTab(body, group) {
    const label = document.createElement('span');
    label.className = 'evidence-label';
    label.textContent = 'Recommended next move';
    const p = document.createElement('p');
    p.className = 'brief-why';
    // Composed by the gateway from one shared lookup, so this and the exported
    // client report never recommend different things for the same rule.
    p.textContent = group.guidance || 'Review the affected pages and apply the fix implied by the finding.';

    // A fix instruction on its own does not tell an operator how large the job
    // is. These three facts are the scanner's own, and they size the work.
    const box = document.createElement('div');
    box.className = 'evidence-box';
    const boxLabel = document.createElement('span');
    boxLabel.className = 'evidence-label';
    boxLabel.textContent = 'Scope of this fix';
    const facts = document.createElement('dl');
    facts.className = 'evidence-facts';
    const fetched = fxFetchedPages();
    const pairs = [
      ['Places to change', String(group.instances)],
      ['Pages', fetched ? `${group.affected_urls} of ${fetched}` : String(group.affected_urls)],
      ['Area', SITE_AUDIT_AREA_LABEL[disciplineOf(group.rule_id)] || 'Other']
    ];
    for (const [k, v] of pairs) {
      const pair = document.createElement('div');
      const dt = document.createElement('dt');
      dt.textContent = k;
      const dd = document.createElement('dd');
      dd.textContent = v;
      pair.append(dt, dd);
      facts.appendChild(pair);
    }
    box.append(boxLabel, facts);

    const checkLabel = document.createElement('span');
    checkLabel.className = 'evidence-label';
    checkLabel.textContent = 'Confirming the fix';
    const check = document.createElement('p');
    check.className = 'brief-why';
    const established = group.confidence === 'confirmed' || group.confidence === 'corroborated';
    check.textContent = established
      ? 'Re-run the audit after the change ships. The pattern clears when the rule below stops matching on those pages.'
      : 'Re-run the audit after the change ships. This pattern was not independently confirmed, so check one affected page directly as well.';

    const ruleLabel = document.createElement('span');
    ruleLabel.className = 'evidence-label';
    ruleLabel.textContent = 'Technical evidence';
    const rule = document.createElement('p');
    rule.className = 'detail-rule';
    const code = document.createElement('code');
    code.textContent = group.rule_id;
    rule.append(document.createTextNode('Rule '), code);
    body.append(label, p, box, checkLabel, check, ruleLabel, rule);
  }

  /** The column chooser. Three columns are fixed because without them a row
   * cannot be read at all. */
  function renderColumnsMenu() {
    const shadow = siteAudit.shadow;
    const menu = shadow.querySelector('.columns-menu');
    if (!menu) return;
    menu.innerHTML = '';
    const title = document.createElement('p');
    title.className = 'columns-title';
    title.textContent = 'Columns';
    menu.appendChild(title);
    for (const col of SITE_AUDIT_FX_COLUMNS) {
      const row = document.createElement('label');
      row.className = 'columns-row';
      const input = document.createElement('input');
      input.type = 'checkbox';
      input.checked = col.fixed || (siteAudit.fxColumns || []).includes(col.id);
      input.disabled = Boolean(col.fixed);
      input.addEventListener('change', () => {
        const chosen = new Set(siteAudit.fxColumns || []);
        if (input.checked) chosen.add(col.id); else chosen.delete(col.id);
        siteAudit.fxColumns = [...chosen];
        renderFindingsList();
      });
      const text = document.createElement('span');
      text.textContent = col.label + (col.fixed ? ' (always shown)' : '');
      row.append(input, text);
      menu.appendChild(row);
    }
  }

  /** Export exactly the rows the filters left on screen. */
  async function exportCurrentView() {
    const rows = fxVisibleGroups();
    if (!rows.length) return;
    const ruleIds = [...new Set(rows.map((g) => g.rule_id))].slice(0, 200).join(',');
    return exportSiteAudit('findings', ruleIds);
  }

  /**
   * The grouped-finding rows, rendered into whichever list asked for them —
   * the Findings tab's filtered list, or a discipline section's own scoped
   * list. Both are the same component on purpose: an operator who has learned
   * to read a finding row in one place should not meet a different one in the
   * next section. Expansion state is shared, so a row opened in Availability
   * is still open when the same rule is met in the full Findings list.
   */
  function renderFindingRowsInto(list, groups, emptyText) {
    if (!list) return;
    list.innerHTML = '';
    if (!groups.length) {
      const li = document.createElement('li');
      li.className = 'empty-row';
      li.textContent = emptyText;
      list.appendChild(li);
      return;
    }
    for (const g of groups) {
      const key = `${g.rule_id}::${g.confidence}`;
      const detailId = `fd-${key.replace(/[^a-z0-9]+/gi, '-')}`;
      const li = document.createElement('li');
      li.className = `finding-row sev-${g.severity || 'info'}`;

      // A real <button> rather than a click handler on the <li>: this is the
      // primary data interaction in the product, and it was mouse-only.
      const toggle = document.createElement('button');
      toggle.type = 'button';
      toggle.className = 'f-toggle';
      toggle.setAttribute('aria-expanded', String(siteAudit.expandedFindingKey === key));
      toggle.setAttribute('aria-controls', detailId);

      const top = document.createElement('div');
      top.className = 'f-top';
      const badge = severityPill(g.severity, sentenceCase(g.severity || g.category || ''));
      const title = document.createElement('span');
      title.className = 'f-title';
      title.textContent = findingLabel(g);
      const conf = document.createElement('span');
      conf.className = 'f-conf';
      const dot = document.createElement('span');
      dot.className = `confidence-dot ${g.confidence || 'inferred'}`;
      conf.append(dot, document.createTextNode(g.confidence || 'inferred'));
      top.append(badge, title, conf);

      const meta = document.createElement('div');
      meta.className = 'f-meta';
      meta.textContent = `${g.instances} instance${g.instances === 1 ? '' : 's'} on ${g.affected_urls} page${g.affected_urls === 1 ? '' : 's'}`;
      const chev = document.createElement('span');
      chev.className = 'f-chev';
      chev.setAttribute('aria-hidden', 'true');
      chev.textContent = '›';
      meta.appendChild(chev);

      toggle.append(top, meta);
      li.appendChild(toggle);
      toggle.addEventListener('click', () => toggleFindingDetail(g, li, key, toggle, detailId));
      list.appendChild(li);
      if (siteAudit.expandedFindingKey === key) li.appendChild(buildFindingDetailBlock(g, key, detailId));
    }
  }

  function clearFindingFilters() {
    siteAudit.findingsSearch = '';
    siteAudit.findingsCategory = '';
    siteAudit.findingsImpactClass = '';
    siteAudit.findingsHideUnconfirmed = false;
    const shadow = siteAudit.shadow;
    shadow.querySelector('.findings-search').value = '';
    shadow.querySelector('.findings-category').value = '';
    shadow.querySelector('.findings-impact').value = '';
    shadow.querySelector('.findings-evidence').value = '';
    renderImpactFilter(siteAudit.rawFindingGroups || []);
    renderFindingsList();
  }

  /** Destination for each Overview tile. "Needs fixing" writes its value into
   * the visible category control rather than filtering invisibly, the same way
   * the quick-filter chips already do — an operator must be able to see, and
   * undo, a filter that was applied on their behalf. */
  function openSummaryTile(kind) {
    const shadow = siteAudit.shadow;
    if (kind === 'crawled') return openUrlsWithStatus('fetched');
    if (kind === 'gaps') return openUrlsWithStatus(URL_GAP_STATUSES.join(','));
    if (kind === 'fix') {
      siteAudit.findingsSearch = '';
      siteAudit.findingsImpactClass = '';
      siteAudit.findingsCategory = 'fix';
      shadow.querySelector('.findings-search').value = '';
      shadow.querySelector('.findings-category').value = 'fix';
      return switchSiteAuditTab('findings');
    }
    if (kind === 'findings') {
      clearFindingFilters();
      return switchSiteAuditTab('findings');
    }
  }

  function toggleFindingDetail(g, li, key, toggle, detailId) {
    const alreadyOpen = siteAudit.expandedFindingKey === key;
    siteAudit.expandedFindingKey = alreadyOpen ? null : key;
    const existing = li.querySelector('.finding-detail');
    if (existing) existing.remove();
    if (toggle) toggle.setAttribute('aria-expanded', String(!alreadyOpen));
    if (!alreadyOpen) li.appendChild(buildFindingDetailBlock(g, key, detailId));
  }

  function buildFindingDetailBlock(g, key, detailId) {
    const block = document.createElement('div');
    block.className = 'finding-detail';
    if (detailId) block.id = detailId;
    block.textContent = 'Loading affected URLs…';
    chrome.runtime.sendMessage({ type: 'SITE_AUDIT_FINDINGS', auditId: siteAudit.auditId, ruleId: g.rule_id, confidence: g.confidence, limit: 100 }).catch(() => null).then((result) => {
      if (!siteAudit || siteAudit.expandedFindingKey !== key) return; // collapsed, or a different row opened, while this was in flight
      const findings = result?.findings || [];
      block.innerHTML = '';

      // The evidence basis, stated in the open rather than hidden in a title
      // tooltip that touch and keyboard users never see.
      const basis = document.createElement('p');
      basis.className = 'detail-basis';
      basis.textContent = g.confidence === 'confirmed'
        ? 'Confirmed: directly observed in the fetched response.'
        : g.confidence === 'inconclusive'
          ? 'Inconclusive: the available evidence could not confirm or rule this out. Reported as coverage, not as a defect.'
          : 'Inferred: read from the static HTML response. JavaScript was not executed, so a page that injects content at runtime may differ.';
      block.appendChild(basis);

      if (findings[0]?.detail) {
        const detail = document.createElement('p');
        detail.className = 'detail-explain';
        detail.textContent = String(findings[0].detail).slice(0, 400);
        block.appendChild(detail);
      }

      if (String(g.category || '') === 'fix' || String(g.severity || '') !== 'info') {
        const toPlan = document.createElement('button');
        toPlan.type = 'button';
        toPlan.className = 'btn detail-plan';
        toPlan.textContent = 'Show this in the plan';
        toPlan.addEventListener('click', () => openPlanFor(g.rule_id));
        block.appendChild(toPlan);
      }

      const ruleLine = document.createElement('p');
      ruleLine.className = 'detail-rule';
      const ruleLabel = document.createElement('span');
      ruleLabel.textContent = 'Scanner rule ';
      const ruleCode = document.createElement('code');
      ruleCode.textContent = g.rule_id;
      ruleLine.append(ruleLabel, ruleCode);
      block.appendChild(ruleLine);

      const urlsHeading = document.createElement('h4');
      urlsHeading.textContent = `Affected pages (${g.affected_urls})`;
      block.appendChild(urlsHeading);

      if (!findings.length) {
        const none = document.createElement('p');
        none.className = 'detail-empty';
        none.textContent = 'No affected URLs found.';
        block.appendChild(none);
        return;
      }
      const urlList = document.createElement('div');
      urlList.className = 'url-list';
      block.appendChild(urlList);
      const seen = new Set();
      for (const f of findings) {
        if (seen.has(f.url)) continue;
        seen.add(f.url);
        const a = document.createElement('a');
        a.className = 'url-item';
        a.href = f.url;
        a.target = '_blank';
        a.rel = 'noopener noreferrer';
        a.textContent = shortUrl(f.url);
        a.title = f.url;
        a.addEventListener('click', (e) => e.stopPropagation());
        urlList.appendChild(a);
      }
      if (g.affected_urls > seen.size) {
        const more = document.createElement('p');
        more.className = 'hint';
        more.textContent = `Showing ${seen.size} of ${g.affected_urls} affected URLs. Use the Findings CSV export for the full list.`;
        block.appendChild(more);
      }
    });
    return block;
  }

  /** The states a page can be in that mean it never became evidence. Must
   * match URL_GAP_STATUSES in packages/crawl/store.js — the tile's count and
   * the list it opens have to be the same set of pages. */
  const URL_GAP_STATUSES = ['queued', 'error', 'skipped'];

  const URL_STATUS_SCOPE_COPY = {
    fetched: (n) => `Showing the <b>${n}</b> page${n === 1 ? '' : 's'} the crawl fetched.`,
    'queued,error,skipped': (n) => `Showing the <b>${n}</b> page${n === 1 ? '' : 's'} that were never fully checked.`
  };

  /** The size of the set the active Pages scope selects, so the pager reports
   * a position inside that set rather than inside the whole crawl ("1–100 of
   * 178", not "1–100 of 218").
   *
   * Crawl states come from the audit's own status counts; depth and HTTP class
   * come from the distributions, which are aggregates over exactly the same
   * rows the listing pages through. When two scopes are combined the smaller
   * one is the honest ceiling — the store intersects them, and this is a
   * pager label, not a claim about how many rows matched.
   */
  function urlTotalForScope({ statuses = '', depth = null, httpClass = '', indexable = '' } = {}) {
    const counts = siteAudit.urlCounts || {};
    const all = Object.values(counts).reduce((s, n) => s + Number(n || 0), 0);
    const totals = [];
    if (statuses) totals.push(statuses.split(',').reduce((s, k) => s + Number(counts[k] || 0), 0));
    if (depth !== null && depth !== '') {
      totals.push((siteAudit.distributions?.depth || [])
        .filter((r) => r.depth === Number(depth))
        .reduce((s, r) => s + r.n, 0));
    }
    if (httpClass) {
      const cls = SITE_AUDIT_HTTP_CLASSES.find((c) => c.id === httpClass);
      totals.push(cls
        ? (siteAudit.distributions?.httpStatus || [])
          .filter((r) => r.status >= cls.min && r.status <= cls.max)
          .reduce((s, r) => s + r.n, 0)
        : all);
    }
    if (indexable) {
      const pages = siteAudit.distributions?.pages || {};
      totals.push(Number(indexable === 'no' ? pages.noindex || 0 : pages.indexable || 0));
    }
    return totals.length ? Math.min(...totals) : all;
  }

  /** Kept for the callers that only ever narrow by crawl state. */
  function urlTotalForStatus(status) {
    return urlTotalForScope({ statuses: status || '' });
  }

  function currentUrlScope() {
    return { statuses: siteAudit.urlsStatus || '', depth: siteAudit.urlsDepth ?? null, httpClass: siteAudit.urlsHttpClass || '', indexable: siteAudit.urlsIndexable || '' };
  }

  function renderScopedNote() {
    const note = siteAudit.shadow.querySelector('.scoped-note');
    if (!note) return;
    const scope = currentUrlScope();
    const active = Boolean(scope.statuses || scope.depth !== null || scope.httpClass || scope.indexable);
    if (!active) { note.hidden = true; return; }
    const total = urlTotalForScope(scope);
    const only = (key) => Object.entries(scope).every(([k, v]) => (k === key ? true : v === '' || v === null));
    const copy = scope.statuses && only('statuses') ? URL_STATUS_SCOPE_COPY[scope.statuses] : null;
    let text;
    if (copy) text = copy(total);
    else if (scope.depth !== null && !scope.statuses && !scope.httpClass) {
      text = Number(scope.depth) === 0
        ? `Showing the <b>${total}</b> page${total === 1 ? '' : 's'} the crawl started from, including everything the sitemap named.`
        : `Showing the <b>${total}</b> page${total === 1 ? '' : 's'} discovered <b>${Number(scope.depth)}</b> link hop${Number(scope.depth) === 1 ? '' : 's'} from the start URL.`;
    } else if (scope.httpClass && only('httpClass')) {
      // The class id is one of four fixed literals, never crawl output.
      text = `Showing the <b>${total}</b> page${total === 1 ? '' : 's'} that answered <b>${scope.httpClass}</b>.`;
    } else if (scope.indexable && only('indexable')) {
      text = scope.indexable === 'no'
        ? `Showing the <b>${total}</b> page${total === 1 ? '' : 's'} that ask search engines not to index them.`
        : `Showing the <b>${total}</b> page${total === 1 ? '' : 's'} that are indexable.`;
    } else {
      text = `Showing <b>${total}</b> of ${urlTotalForScope({})} pages.`;
    }
    note.hidden = false;
    // Numbers and fixed copy only — no crawl-sourced string reaches this markup.
    note.querySelector('.scoped-text').innerHTML = text;
  }

  async function loadSiteAuditUrls() {
    const scope = currentUrlScope();
    const r = await chrome.runtime.sendMessage({
      type: 'SITE_AUDIT_URLS', auditId: siteAudit.auditId,
      limit: SITE_AUDIT_PAGE_SIZE, offset: siteAudit.urlsOffset,
      ...(scope.statuses ? { status: scope.statuses } : {}),
      ...(scope.depth !== null ? { depth: scope.depth } : {}),
      ...(scope.httpClass ? { httpClass: scope.httpClass } : {}),
      ...(scope.indexable ? { indexable: scope.indexable } : {})
    }).catch(() => null);
    if (!siteAudit) return;
    siteAudit.rawUrls = r?.urls || [];
    siteAudit.totalUrls = urlTotalForScope(scope);
    renderScopedNote();
    renderUrlsTable();
  }

  /**
   * Opens the Pages tab narrowed to one scope — a set of crawl states, a
   * crawl depth, or an HTTP status class. Every scope is exclusive of the
   * others: arriving from a depth bar should show that depth, not that depth
   * intersected with whatever filter the last drill-in left behind. Offset
   * resets too, because page 3 of the unfiltered list is not page 3 of this one.
   */
  function openUrlsScoped({ statuses = '', depth = null, httpClass = '', indexable = '' } = {}) {
    siteAudit.urlsStatus = statuses || '';
    siteAudit.urlsDepth = depth === null || depth === '' ? null : Number(depth);
    siteAudit.urlsHttpClass = httpClass || '';
    siteAudit.urlsIndexable = indexable || '';
    siteAudit.urlsOffset = 0;
    siteAudit.urlsSearch = '';
    siteAudit.urlsSection = '';
    siteAudit.expandedUrl = null;
    const input = siteAudit.shadow.querySelector('.urls-search');
    if (input) input.value = '';
    return switchSiteAuditTab('urls');
  }

  function openUrlsWithStatus(status) {
    return openUrlsScoped({ statuses: status || '' });
  }

  function sortUrlsBy(key) {
    const current = siteAudit.urlsSort;
    siteAudit.urlsSort = { key, dir: current.key === key && current.dir === 'asc' ? 'desc' : 'asc' };
    renderUrlsTable();
  }

  function urlSection(rawUrl) {
    try {
      const seg = new URL(rawUrl).pathname.split('/').filter(Boolean)[0];
      return seg ? `/${seg}/` : '/';
    } catch { return '/'; }
  }

  // The section index is the level between the site and a page. It renders only
  // when the crawl actually found more than one section, so a flat site never
  // grows a control that would always read "all".
  function renderSectionIndex() {
    const shadow = siteAudit.shadow;
    const nav = shadow.querySelector('.section-index');
    if (!nav) return;
    const counts = new Map();
    for (const u of siteAudit.rawUrls || []) {
      const s = urlSection(u.url);
      counts.set(s, (counts.get(s) || 0) + 1);
    }
    nav.innerHTML = '';
    const pageCount = (siteAudit.rawUrls || []).length;
    const grouped = [...counts.values()].filter((n) => n > 1).length;
    // Useful only when it actually collapses the list: at least two sections,
    // at least one holding several pages, and few enough to scan at a glance.
    const useful = counts.size >= 2 && counts.size <= 12 && grouped >= 1 && counts.size < pageCount;
    if (!useful) { nav.hidden = true; siteAudit.urlsSection = ''; return; }
    nav.hidden = false;
    const total = (siteAudit.rawUrls || []).length;
    const entries = [['', 'All sections', total], ...[...counts.entries()].sort((a, b) => b[1] - a[1]).map(([s, n]) => [s, s, n])];
    for (const [value, label, count] of entries) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'section-cut';
      b.dataset.section = value;
      const active = siteAudit.urlsSection === value;
      b.setAttribute('aria-pressed', String(active));
      b.classList.toggle('active', active);
      b.innerHTML = `<span class="sc-label"></span><span class="sc-count"></span>`;
      b.querySelector('.sc-label').textContent = label;
      b.querySelector('.sc-count').textContent = String(count);
      b.addEventListener('click', () => {
        siteAudit.urlsSection = siteAudit.urlsSection === value ? '' : value;
        renderUrlsTable();
      });
      nav.appendChild(b);
    }
  }

  async function loadSiteModelOnce() {
    if (siteAudit.siteModel || siteAudit.siteModelLoading) return;
    siteAudit.siteModelLoading = true;
    try {
      const r = await chrome.runtime.sendMessage({ type: 'SITE_AUDIT_SITE_MODEL', auditId: siteAudit.auditId }).catch(() => null);
      if (!siteAudit) return;
      siteAudit.siteModel = r?.model || { groups: [] };
      // The URL is the key everywhere else in the audit, so the lookup is built
      // once rather than scanning every group's list per row.
      siteAudit.pageGroupByUrl = new Map();
      for (const group of siteAudit.siteModel.groups || []) {
        for (const url of group.urls || []) siteAudit.pageGroupByUrl.set(url, group);
      }
      renderUrlsTable();
    } finally {
      siteAudit.siteModelLoading = false;
    }
  }

  function renderUrlsTable() {
    const shadow = siteAudit.shadow;
    const body = shadow.querySelector('.urls-body');
    loadSiteModelOnce();
    renderSectionIndex();
    for (const th of shadow.querySelectorAll('.urls-panel th[data-sort]')) {
      th.classList.toggle('sorted-asc', th.dataset.sort === siteAudit.urlsSort.key && siteAudit.urlsSort.dir === 'asc');
      th.classList.toggle('sorted-desc', th.dataset.sort === siteAudit.urlsSort.key && siteAudit.urlsSort.dir === 'desc');
    }
    const search = String(siteAudit.urlsSearch || '').trim().toLowerCase();
    const sortValue = (u, key) => key === 'status' ? (u.http_status || u.status || '')
      : key === 'group' ? (siteAudit.pageGroupByUrl?.get(u.final_url || u.url)?.label || '')
        : key === 'schema' ? (u.schema_types || '')
        // Sort noindex to one end rather than mixing it through: the point of
        // sorting this column is to gather the exceptions.
        : key === 'indexable' ? (u.indexable === null || u.indexable === undefined ? 2 : Number(u.indexable))
          : (u[key] || '');
    const { key, dir } = siteAudit.urlsSort;
    const rows = (siteAudit.rawUrls || [])
      .filter((u) => !siteAudit.urlsSection || urlSection(u.url) === siteAudit.urlsSection)
      .filter((u) => !search || u.url.toLowerCase().includes(search) || (u.title || '').toLowerCase().includes(search))
      .sort((a, b) => {
        const av = sortValue(a, key), bv = sortValue(b, key);
        return (av > bv ? 1 : av < bv ? -1 : 0) * (dir === 'asc' ? 1 : -1);
      });
    body.innerHTML = '';
    for (const u of rows) {
      let schemaLabel = '–';
      try { const types = JSON.parse(u.schema_types || '[]'); if (types.length) schemaLabel = types.join(', '); } catch {}
      // Which family this page belongs to, so the table stops presenting a
      // templated site as a list of unrelated documents.
      const group = siteAudit.pageGroupByUrl?.get(u.final_url || u.url) || null;
      const tr = siteAuditRow([shortUrl(u.url), '', '', u.title || '', group ? group.label : '', u.word_count ?? '–', schemaLabel], { mono: [0] });
      if (group) {
        tr.cells[4].title = group.basis;
        tr.cells[4].className = 'col-group';
      }
      tr.cells[0].title = u.url;
      // Status carries a pill so a 404 among two hundred 200s is findable
      // by scanning rather than by reading every row.
      const code = Number(u.http_status || 0);
      const tone = !code ? 'inconclusive' : code >= 200 && code < 400 ? 'healthy' : 'broken';
      const statusPill = document.createElement('span');
      statusPill.className = 'pill status-pill';
      statusPill.dataset.tone = STATUS_TONE[tone];
      statusPill.textContent = code ? String(code) : (u.status || '–');
      tr.cells[1].textContent = '';
      tr.cells[1].className = 'col-status';
      tr.cells[1].appendChild(statusPill);
      // Indexability was stored on every crawled page and shown nowhere, so
      // "20 of 20 indexable" could not be checked against any actual page.
      // Only the exception gets a pill: noindex is what an operator scans for,
      // and a page being indexable is the unremarkable case.
      tr.cells[2].className = 'col-status';
      tr.cells[2].textContent = '';
      if (u.indexable === null || u.indexable === undefined) {
        tr.cells[2].textContent = '–';
        tr.cells[2].title = 'Not read: this page was never fetched.';
      } else if (Number(u.indexable) === 1) {
        tr.cells[2].textContent = 'Yes';
      } else {
        const pill = document.createElement('span');
        pill.className = 'pill status-pill';
        pill.dataset.tone = STATUS_TONE.blocked;
        pill.textContent = 'noindex';
        pill.title = 'This page asks search engines not to index it.';
        tr.cells[2].appendChild(pill);
      }
      tr.classList.add('row-expand');
      tr.addEventListener('click', () => toggleUrlDetail(u.url, tr));
      body.appendChild(tr);
      if (siteAudit.expandedUrl === u.url) body.appendChild(buildUrlDetailRow(u.url, 6));
    }
    const shown = siteAudit.rawUrls?.length || 0;
    const from = shown ? siteAudit.urlsOffset + 1 : 0;
    const to = siteAudit.urlsOffset + shown;
    // The scope total is derived from the distributions, which are read on the
    // refresh beat, while these rows are read on demand. During a running
    // crawl the rows can legitimately arrive first, and "1–40 of 32" is not a
    // position anyone can act on. The rows in hand are the floor.
    const total = Math.max(Number(siteAudit.totalUrls || 0), to);
    shadow.querySelector('.urls-label').textContent = total ? `${from}–${to} of ${total}` : '';
    shadow.querySelector('.urls-prev').disabled = siteAudit.urlsOffset === 0;
    shadow.querySelector('.urls-next').disabled = to >= total || shown < SITE_AUDIT_PAGE_SIZE;
  }

  /** A narrow side panel has no room for a true split-pane "detail drawer" —
   * the list column would be squeezed illegible alongside it. Expanding the
   * detail inline, beneath the row the user clicked, keeps one column and
   * needs no new interaction vocabulary (the Findings tab uses the same
   * click-to-see-more idea). Re-clicking the same row collapses it; clicking
   * a different row swaps which one is open rather than stacking both. */
  function toggleUrlDetail(url, tr) {
    const alreadyOpen = siteAudit.expandedUrl === url;
    siteAudit.expandedUrl = alreadyOpen ? null : url;
    const existingDetail = tr.nextElementSibling?.classList.contains('detail-row') ? tr.nextElementSibling : null;
    if (existingDetail) existingDetail.remove();
    for (const row of siteAudit.shadow.querySelectorAll('.urls-body .detail-row')) row.remove();
    if (!alreadyOpen) tr.after(buildUrlDetailRow(url, tr.children.length));
  }

  function buildUrlDetailRow(url, colSpan) {
    const tr = document.createElement('tr');
    tr.className = 'detail-row';
    const td = document.createElement('td');
    td.colSpan = colSpan;
    const block = document.createElement('div');
    block.className = 'detail-block';
    block.textContent = 'Loading…';
    td.appendChild(block);
    tr.appendChild(td);
    Promise.all([
      chrome.runtime.sendMessage({ type: 'SITE_AUDIT_FINDINGS', auditId: siteAudit.auditId, url, limit: 50 }).catch(() => null),
      chrome.runtime.sendMessage({ type: 'SITE_AUDIT_LINKS', auditId: siteAudit.auditId, sourceUrl: url, limit: 50 }).catch(() => null)
    ]).then(([findingsResult, linksResult]) => {
      if (!siteAudit || siteAudit.expandedUrl !== url) return; // collapsed or a different row opened while this was in flight
      const findings = findingsResult?.findings || [];
      const links = linksResult?.links || [];
      block.innerHTML = '';
      const fHeading = document.createElement('h4');
      fHeading.textContent = `Findings on this page (${findings.length})`;
      block.appendChild(fHeading);
      if (findings.length) {
        const ul = document.createElement('ul');
        for (const f of findings.slice(0, 20)) {
          const li = document.createElement('li');
          li.textContent = `${f.rule_id}: ${f.title || ''}`;
          ul.appendChild(li);
        }
        block.appendChild(ul);
      } else {
        const p = document.createElement('p');
        p.textContent = 'No findings on this page.';
        block.appendChild(p);
      }
      const lHeading = document.createElement('h4');
      lHeading.textContent = `Outbound links (${links.length})`;
      block.appendChild(lHeading);
      if (links.length) {
        const ul = document.createElement('ul');
        for (const l of links.slice(0, 20)) {
          const li = document.createElement('li');
          li.textContent = `[${l.status}] ${l.target_url}`;
          ul.appendChild(li);
        }
        block.appendChild(ul);
      } else {
        const p = document.createElement('p');
        p.textContent = 'No outbound links recorded from this page.';
        block.appendChild(p);
      }
    });
    return tr;
  }

  async function loadSiteAuditLinks() {
    const r = await chrome.runtime.sendMessage({ type: 'SITE_AUDIT_LINKS', auditId: siteAudit.auditId, limit: SITE_AUDIT_PAGE_SIZE, offset: siteAudit.linksOffset, status: siteAudit.linksStatus || undefined }).catch(() => null);
    siteAudit.rawLinks = r?.links || [];
    renderLinksTable();
  }

  const LINK_STATUS_ORDER = [
    ['broken', 'Broken'],
    ['blocked', 'Blocked'],
    ['inconclusive', 'Unverified'],
    ['healthy', 'Healthy']
  ];


  function renderLinksTable() {
    const shadow = siteAudit.shadow;
    const body = shadow.querySelector('.links-body');
    const search = String(siteAudit.linksSearch || '').trim().toLowerCase();
    const rows = (siteAudit.rawLinks || []).filter((l) => !search || l.source_url.toLowerCase().includes(search) || l.target_url.toLowerCase().includes(search) || (l.anchor_text || '').toLowerCase().includes(search));
    body.innerHTML = '';
    let lastSource = null;
    for (const l of rows) {
      const repeated = l.source_url === lastSource;
      lastSource = l.source_url;
      const tr = siteAuditRow([repeated ? '' : shortUrl(l.source_url), shortUrl(l.target_url), l.anchor_text || '–'], { mono: [0, 1] });
      // A run of links from one page reads as one block instead of the same
      // URL restated fifteen times.
      if (repeated) tr.classList.add('link-same-source');
      tr.cells[0].title = l.source_url;
      tr.cells[1].title = l.target_url;
      const statusTd = document.createElement('td');
      statusTd.className = 'col-status';
      const pill = document.createElement('span');
      pill.className = 'pill status-pill';
      pill.dataset.tone = STATUS_TONE[l.status] || STATUS_TONE.inconclusive;
      pill.textContent = l.status;
      statusTd.appendChild(pill);
      tr.appendChild(statusTd);
      body.appendChild(tr);
    }
    const total = siteAudit.linksStatus ? (siteAudit.totalLinksByStatus?.[siteAudit.linksStatus] || 0) : Object.values(siteAudit.totalLinksByStatus || {}).reduce((s, n) => s + n, 0);
    const shown = siteAudit.rawLinks?.length || 0;
    const from = shown ? siteAudit.linksOffset + 1 : 0;
    const to = siteAudit.linksOffset + shown;
    shadow.querySelector('.links-label').textContent = total ? `${from}–${to} of ${total}` : '';
    shadow.querySelector('.links-prev').disabled = siteAudit.linksOffset === 0;
    shadow.querySelector('.links-next').disabled = to >= total || shown < SITE_AUDIT_PAGE_SIZE;
  }

  /**
   * The download control.
   *
   * Both boxes start checked because both are what an audit is for, and the
   * common case is handing over the whole thing. Unchecking both is not an
   * error state to explain — the action simply cannot run, and says so.
   */
  function wireDownloadMenu() {
    const shadow = siteAudit.shadow;
    const btn = shadow.querySelector('.report-btn');
    const menu = shadow.querySelector('.download-menu');
    const plan = shadow.querySelector('.dl-plan');
    const scan = shadow.querySelector('.dl-scan');
    const go = shadow.querySelector('.dl-go');
    const what = shadow.querySelector('.download-what');

    // Say what the file will be before it is made, in tabs rather than in
    // adjectives: the reader is deciding what to send someone.
    const describe = () => {
      const tabs = 1 + (plan.checked ? 2 : 0) + (scan.checked ? 3 : 0);
      go.disabled = !plan.checked && !scan.checked;
      what.textContent = go.disabled
        ? 'Choose at least one.'
        : `One .xlsx, ${tabs} tabs. Everything stays on this machine.`;
    };
    plan.addEventListener('change', describe);
    scan.addEventListener('change', describe);
    describe();

    const close = () => { menu.hidden = true; btn.setAttribute('aria-expanded', 'false'); };
    // Measured after it is shown, because a hidden element has no height to
    // place against, and clamped so it never opens off the workspace.
    const place = () => {
      const rect = btn.getBoundingClientRect();
      const left = Math.min(Math.max(12, rect.left), window.innerWidth - menu.offsetWidth - 12);
      menu.style.left = `${Math.max(12, left)}px`;
      menu.style.top = `${Math.max(12, rect.top - menu.offsetHeight - 8)}px`;
    };
    btn.addEventListener('click', (event) => {
      event.stopPropagation();
      const open = menu.hidden;
      menu.hidden = !open;
      btn.setAttribute('aria-expanded', String(open));
      if (open) place();
    });
    menu.addEventListener('click', (event) => event.stopPropagation());
    shadow.addEventListener('click', close);
    shadow.addEventListener('keydown', (event) => { if (event.key === 'Escape' && !menu.hidden) close(); });
    go.addEventListener('click', () => downloadWorkbook({ scan: scan.checked, plan: plan.checked }));
    shadow.querySelector('.dl-html').addEventListener('click', () => { close(); downloadFullReport(); });
  }

  /**
   * Build and save the workbook.
   *
   * The gateway is local, so the file is assembled from data that never left
   * this machine and is handed straight back. The base64 hop exists only
   * because extension messaging cannot carry bytes.
   */
  async function downloadWorkbook(include) {
    const shadow = siteAudit.shadow;
    const go = shadow.querySelector('.dl-go');
    const what = shadow.querySelector('.download-what');
    const label = go.textContent;
    go.disabled = true;
    go.textContent = 'Building…';
    try {
      const r = await chrome.runtime.sendMessage({
        type: 'SITE_AUDIT_WORKBOOK', auditId: siteAudit.auditId, scan: include.scan, plan: include.plan,
        // The gateway rebuilds the plan to make the file, so anything drafted
        // in this session travels with the request or it never reaches the
        // spreadsheet it was written for.
        drafts: collectDrafts()
      }).catch((error) => ({ ok: false, error: error?.message }));
      if (!r?.ok || !r.base64) {
        what.textContent = 'The file could not be built. The gateway may not be running.';
        return;
      }
      const binary = atob(r.base64);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
      saveBlob(new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), r.filename || 'audit.xlsx');
      shadow.querySelector('.download-menu').hidden = true;
      shadow.querySelector('.report-btn').setAttribute('aria-expanded', 'false');
    } finally {
      go.disabled = false;
      go.textContent = label;
    }
  }

  /** The drafts accepted in this session, keyed by the change they belong to.
   * The rule id travels with each one so the gateway can refuse to land a draft
   * on a change that is no longer the same kind of work. */
  function collectDrafts() {
    const out = {};
    for (const priority of siteAudit.plan?.priorities || []) {
      for (const action of priority.actions || []) {
        for (const change of action.changes || []) {
          if (change.draft) out[change.id] = { draft: change.draft, by: change.draftBy || '', ruleId: change.ruleId };
        }
      }
    }
    return out;
  }

  /** One place that turns a blob into a saved file. */
  function saveBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
  }

  async function downloadFullReport() {
    const btn = siteAudit.shadow.querySelector('.report-btn');
    btn.disabled = true;
    try {
      const r = await chrome.runtime.sendMessage({ type: 'SITE_AUDIT_REPORT', auditId: siteAudit.auditId }).catch((error) => ({ ok: false, error: error?.message }));
      if (!r?.ok) return;
      saveBlob(new Blob([r.html], { type: 'text/html;charset=utf-8' }), r.filename || 'audit-report.html');
    } finally {
      btn.disabled = false;
    }
  }

  async function downloadDebugReport() {
    const btn = siteAudit.shadow.querySelector('.debug-btn');
    btn.disabled = true;
    try {
      const r = await chrome.runtime.sendMessage({ type: 'SITE_AUDIT_DEBUG', auditId: siteAudit.auditId }).catch((error) => ({ ok: false, error: error?.message }));
      if (!r?.ok) return;
      saveBlob(new Blob([r.json], { type: 'application/json;charset=utf-8' }), r.filename || 'audit-debug.json');
    } finally {
      btn.disabled = false;
    }
  }

  async function exportSiteAudit(dataset, ruleIds) {
    const r = await chrome.runtime.sendMessage({ type: 'SITE_AUDIT_EXPORT', auditId: siteAudit.auditId, dataset, ...(ruleIds ? { ruleIds } : {}) }).catch((error) => ({ ok: false, error: error?.message }));
    if (!r?.ok) return;
    saveBlob(new Blob([r.text], { type: 'text/csv;charset=utf-8' }), r.filename || `audit-${dataset}.csv`);
  }

  chrome.runtime.onMessage.addListener((msg, sender, send) => {
    if (msg.type === 'PING') { send({ ok: true }); return; }
    if (msg.type === 'SCAN') { scan().then(send); return true; }
    if (msg.type === 'AUDIT_LINKS') { auditLinks().then(send); return true; }
    if (msg.type === 'OPEN_SITE_AUDIT') { openSiteAudit(msg.startUrl || location.href); send({ opened: true }); return; }
    if (msg.type === 'APPLY_EXTERNAL_LINK_PROBES') {
      try { send(window.WebQARules.applyExternalProbeResults(msg.candidates || [], msg.rows || [])); }
      catch (error) { send({ findings: [], incompleteChecks: [], resolvedUrls: [], error: error?.message || 'External probe apply failed.' }); }
      return;
    }
    if (msg.type === 'RECHECK_LINK') {
      chrome.runtime.sendMessage({ type: 'LINK_CACHE_INVALIDATE', url: msg.url || '' }).catch(() => {});
      window.WebQARules.recheckLink(msg.url || '').then(send).catch(error => send({ verificationState: 'inconclusive', confidence: 'inconclusive', error: error?.message || 'Link recheck failed.' }));
      return true;
    }
    if (msg.type === 'HIGHLIGHT') { send(highlight(msg.targetId, msg.selector, msg.ruleId)); return; }
    if (msg.type === 'RECONCILE_LINK_TARGETS') { send({ patches: window.WebQARules.reconcileGatewayLinkTargets(msg.findings || []) }); return; }
    if (msg.type === 'TARGET_CONTEXT') { send(targetContext(msg.targetId, msg.selector, msg.ruleId)); return; }
    if (msg.type === 'ENABLE_WATCH') { send(enableWatch()); return; }
    if (msg.type === 'FRANK_START') { send(startFrank(msg.plan, msg.targets || {}, msg.reasoning || {}, msg.readiness || {})); return; }
    if (msg.type === 'FRANK_GOTO') { send(renderFrank(msg.index, false)); return; }
    if (msg.type === 'FRANK_END') { send(endFrank(false)); return; }
    if (msg.type === 'INJECTED_UI_STATUS') { send(injectedUiSnapshot()); return; }
    if (msg.type === 'CLEANUP_INJECTED_UI') { send(cleanupInjectedUi()); return; }
    if (msg.type === 'FRANK_PREVIEW') { send(previewFrank(msg.targetId, msg.preview)); return; }
    if (msg.type === 'FRANK_RESET_PREVIEW') { resetPreview(); send({ ok: true }); return; }
  });
}
