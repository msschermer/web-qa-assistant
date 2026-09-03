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
      box-shadow:0 0 0 4px rgba(180,35,24,.35),0 0 0 8px rgba(180,35,24,.16),0 0 26px 4px rgba(180,35,24,.35);
      pointer-events:none;opacity:0;transform:scale(.96);
      transition:opacity .22s ease,transform .22s ease,top .16s ease,left .16s ease,width .16s ease,height .16s ease}
    .ring.in{opacity:1;transform:scale(1)}
    .ring.pulse{animation:webqa-hl-pulse 900ms ease-out 2}
    @keyframes webqa-hl-pulse{
      0%{box-shadow:0 0 0 4px rgba(180,35,24,.6),0 0 0 8px rgba(180,35,24,.28),0 0 40px 6px rgba(180,35,24,.55)}
      70%{box-shadow:0 0 0 9px rgba(180,35,24,.1),0 0 0 15px rgba(180,35,24,.05),0 0 44px 6px rgba(180,35,24,.2)}
      100%{box-shadow:0 0 0 4px rgba(180,35,24,.35),0 0 0 8px rgba(180,35,24,.16),0 0 26px 4px rgba(180,35,24,.35)}
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

  function frankCss() {
    return ":host{\n  all:initial;\n  --f-brand:#101828;\n  --f-brand-ink:#4338CA;\n  --f-accent:#4F46E5;\n  --f-accent-soft:#EEF2FF;\n  --f-ink:#101828;\n  --f-ink-soft:#475467;\n  --f-ink-faint:#667085;\n  --f-line:#EAECF0;\n  --f-line-strong:#D0D5DD;\n  --f-surface:#FFFFFF;\n  --f-sunken:#F9FAFB;\n  --f-ok:#067647;\n  --f-ok-soft:#ECFDF3;\n  --f-warn:#B54708;\n  --f-warn-soft:#FFFAEB;\n  --f-critical:#B42318;\n  --f-critical-soft:#FEF3F2;\n  --f-sans:'Inter',system-ui,-apple-system,'Segoe UI',Roboto,'Helvetica Neue',sans-serif;\n  --f-mono:ui-monospace,SFMono-Regular,'SF Mono',Menlo,Consolas,monospace;\n}\n*{box-sizing:border-box}\n.backdrop{position:fixed;inset:0;background:rgba(16,24,40,.62);z-index:2147483644;pointer-events:none;transition:opacity .18s ease,background .18s ease}\n.backdrop[data-soft=\"true\"]{background:rgba(16,33,51,.42);backdrop-filter:blur(1.5px)}\n.spotlight{position:fixed;z-index:2147483645;border:2px solid rgba(255,255,255,.96);border-radius:6px;box-shadow:0 0 0 99999px rgba(16,24,40,.62),0 0 0 5px rgba(79,70,229,.34);pointer-events:none;transition:top .16s ease,left .16s ease,width .16s ease,height .16s ease}\n\n.coach{position:fixed;z-index:2147483647;display:flex;flex-direction:column;width:min(468px,calc(100vw - 28px));max-height:min(78vh,760px);background:var(--f-surface);color:var(--f-ink);border:1px solid var(--f-line-strong);border-radius:12px;box-shadow:0 22px 56px rgba(16,33,51,.28),0 3px 10px rgba(16,33,51,.1);font-family:var(--f-sans);pointer-events:auto;overflow:hidden}\n.accent{height:3px;flex:none;background:var(--f-ink)}\n\n.top{display:flex;align-items:center;gap:10px;padding:13px 16px 11px;flex:none;background:var(--f-surface);border-bottom:1px solid var(--f-line)}\n.mark{display:block;width:28px;height:28px;border-radius:50%;background:radial-gradient(circle at 50% 50%,transparent 31%,var(--f-brand) 33%,var(--f-brand) 46%,transparent 48%);color:transparent;font-size:0;flex:none}\n.identity{display:grid;gap:1px;min-width:0}\n.name{font:650 13px/1.15 var(--f-sans);color:var(--f-ink);letter-spacing:-.005em}\n.device{font:500 10.5px/1.2 var(--f-sans);color:var(--f-ink-faint)}\n.verdict{margin-left:auto;display:inline-flex;align-items:center;gap:5px;border-radius:2px;padding:3px 9px;font:600 10.5px/1.5 var(--f-sans);background:var(--f-ok-soft);color:var(--f-ok);white-space:nowrap}\n.verdict[data-status=\"review\"]{background:var(--f-warn-soft);color:var(--f-warn)}\n.verdict[data-status=\"context\"]{background:var(--f-sunken);color:var(--f-ink-faint)}\n.verdict::before{content:\"\";width:6px;height:6px;border-radius:50%;background:currentColor;flex:none}\n.progress{font:550 11px/1 var(--f-sans);color:var(--f-ink-faint);font-variant-numeric:tabular-nums;white-space:nowrap;margin-left:auto}\n.verdict[hidden]+.progress{margin-left:auto}\n\n.rail{display:flex;gap:4px;padding:9px 16px 10px;flex:none;border-bottom:1px solid var(--f-line);background:var(--f-surface);overflow-x:auto;scrollbar-width:none}\n.rail::-webkit-scrollbar{display:none}\n.rail button{flex:1 1 0;min-width:56px;border:0;background:transparent;padding:0;cursor:pointer;text-align:left;font:inherit}\n.rail button i{display:block;height:3px;border-radius:2px;background:var(--f-line-strong);transition:background .15s ease}\n.rail button b{display:block;margin-top:5px;font:550 11px/1.2 var(--f-sans);color:var(--f-ink-faint);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}\n.rail button[data-state=\"done\"] i{background:var(--f-accent)}\n.rail button[data-state=\"current\"] i{background:var(--f-brand);height:4px}\n.rail button[data-state=\"current\"] b{color:var(--f-brand);font-weight:650}\n.rail button[data-role=\"remediation\"] b,.rail button[data-role=\"verification\"] b{font-weight:650}\n.rail button:hover b{color:var(--f-ink-soft)}\n\n.scroll{overflow:auto;overscroll-behavior:contain;padding:0 0 2px}\n.body{padding:15px 17px 4px}\n.eyebrow{display:none}\nh2{margin:0 0 8px;color:var(--f-ink);font:650 19px/1.26 var(--f-sans);letter-spacing:-.014em}\np{font:14.5px/1.55 var(--f-sans);margin:0;color:var(--f-ink-soft)}\n\n.anchor{margin:13px 17px 0;border:1px solid var(--f-line);border-radius:8px;background:var(--f-sunken);padding:10px 12px}\n.anchor[data-tone=\"located\"]{border-color:rgba(79,70,229,.28);background:var(--f-accent-soft)}\n.anchor[data-tone=\"missing\"]{border-color:rgba(181,71,8,.3);background:var(--f-warn-soft)}\n.anchor-head{display:flex;align-items:center;gap:7px;font:650 10.5px/1.3 var(--f-sans);letter-spacing:.06em;text-transform:uppercase;color:var(--f-ink-soft)}\n.anchor[data-tone=\"located\"] .anchor-head{color:var(--f-accent)}\n.anchor[data-tone=\"missing\"] .anchor-head{color:var(--f-warn)}\n.anchor-head::before{content:\"\";width:7px;height:7px;border-radius:50%;background:currentColor;flex:none}\n.anchor-note{margin:6px 0 0;font:12.75px/1.5 var(--f-sans);color:var(--f-ink-soft)}\n.anchor-selector{display:block;margin-top:7px;padding:6px 8px;border-radius:8px;background:rgba(255,255,255,.75);border:1px solid var(--f-line);font:11px/1.45 var(--f-mono);color:var(--f-ink);overflow-wrap:anywhere}\n.anchor-actions{display:flex;gap:6px;flex-wrap:wrap;margin-top:8px}\n.mini{border:1px solid var(--f-line-strong);border-radius:8px;background:var(--f-surface);color:var(--f-ink-soft);padding:4px 9px;font:550 11.5px/1.3 var(--f-sans);cursor:pointer}\n.mini:hover{background:var(--f-sunken);color:var(--f-ink)}\n\n.metrics{display:grid;grid-template-columns:repeat(auto-fit,minmax(132px,1fr));gap:6px;margin:10px 17px 0;padding:0}\n.metric{border:1px solid var(--f-line);border-radius:8px;background:var(--f-sunken);padding:7px 9px;min-width:0}\n.metric dt{margin:0;font:550 11px/1.3 var(--f-sans);color:var(--f-ink-faint);overflow-wrap:anywhere}\n.metric dd{margin:2px 0 0;font:600 12.5px/1.35 var(--f-mono);color:var(--f-ink);overflow-wrap:anywhere}\n\n.code{margin:10px 17px 0}\n.code-head{display:flex;align-items:center;justify-content:space-between;gap:9px;padding:6px 10px;border:1px solid var(--f-line);border-bottom:0;border-radius:12px 8px 0 0;background:var(--f-sunken);font:650 11px/1.3 var(--f-sans);color:var(--f-ink-faint)}\n.code pre{margin:0;padding:9px 10px;border:1px solid var(--f-line);border-radius:0 0 8px 8px;background:#0B2B48;color:#E2E8F0;font:11px/1.55 var(--f-mono);white-space:pre-wrap;overflow-wrap:anywhere;max-height:140px;overflow:auto}\n\n.sources{display:flex;align-items:center;gap:6px;flex-wrap:wrap;margin:10px 17px 0;padding-top:9px;border-top:1px solid var(--f-line)}\n.sources span{border-radius:2px;background:var(--f-sunken);color:var(--f-ink-soft);padding:2px 8px;font:550 11px/1.5 var(--f-sans)}\n.sources em{font-style:normal;color:var(--f-ink-faint);font:11px/1.5 var(--f-sans)}\n\n.state{margin:11px 17px 0;font:12.5px/1.5 var(--f-sans);color:var(--f-accent)}\n.state[data-kind=\"error\"]{color:var(--f-critical)}\n\n.foot{display:flex;align-items:center;gap:8px;padding:12px 17px 14px;flex:none;border-top:1px solid var(--f-line);background:var(--f-surface);flex-wrap:wrap}\n.nav{border:1px solid var(--f-line-strong);border-radius:12px;background:var(--f-surface);color:var(--f-ink);padding:8px 14px;font:550 12.5px/1.2 var(--f-sans);cursor:pointer;transition:background .12s ease,border-color .12s ease}\n.nav:hover:not(:disabled){background:var(--f-sunken);border-color:var(--f-ink-faint)}\n.nav:disabled{opacity:.42;cursor:default}\n.ghost{color:var(--f-accent);border-color:rgba(79,70,229,.34);background:var(--f-accent-soft)}\n.ghost:hover:not(:disabled){background:#D5EDEF;border-color:var(--f-accent)}\n.next{margin-left:auto;background:var(--f-brand);border-color:var(--f-brand-ink);color:#fff}\n.next:hover:not(:disabled){background:var(--f-brand-ink)}\n.return-qa{width:100%;order:3;background:var(--f-brand);border-color:var(--f-brand-ink);color:#fff;font-weight:650}\n.return-qa:hover:not(:disabled){background:var(--f-brand-ink);border-color:var(--f-brand-ink);color:#fff}\n.nav:focus-visible,.mini:focus-visible,.rail button:focus-visible{outline:2px solid var(--f-accent);outline-offset:2px}\n\n@media(max-width:560px){.coach{width:calc(100vw - 20px);border-radius:12px;max-height:82vh}.body{padding:13px 14px 4px}.anchor,.metrics,.code,.sources,.state{margin-left:14px;margin-right:14px}.foot{padding:11px 14px 12px}h2{font-size:17.5px}}\n@media(prefers-reduced-motion:reduce){.spotlight,.backdrop,.nav,.rail button i{transition:none}}\n";
  }

  function createFrankRoot() {
    const old = document.getElementById('__web_qa_frank_root');
    if (old) old.remove();
    const host = document.createElement('div');
    host.id = '__web_qa_frank_root';
    host.setAttribute('data-webqa-ui', 'frank-overlay');
    host.setAttribute('data-webqa-overlay', 'frank');
    host.style.cssText = 'all:initial;position:fixed;inset:0;z-index:2147483647;pointer-events:auto;';
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

  function siteAuditCss() {
    return `
      :host{all:initial;
        /* Lumen Site Audit — the category standard, executed straight.
           Reference bar: Sitebulb's density and severity discipline, Semrush's
           polish and colour confidence. Light theme only, by decision. */
        --sa-canvas:#F6F7F9;      /* app background behind panels */
        --sa-surface:#FFFFFF;     /* cards, tables, panels */
        --sa-subtle:#F9FAFB;      /* table heads, inset rows, hover */
        --sa-nav:#FFFFFF;         /* side navigation */

        --sa-ink:#101828;         /* primary text */
        --sa-ink-soft:#475467;    /* secondary text */
        --sa-ink-faint:#667085;   /* meta, labels, placeholders */
        --sa-line:#EAECF0;        /* hairline between rows */
        --sa-line-strong:#D0D5DD; /* control borders, panel edges */

        /* One primary. Indigo carries the product's own voice: navigation,
           primary actions, focus, selection. It never means severity. */
        --sa-primary:#4F46E5;
        --sa-primary-hover:#4338CA;
        --sa-primary-soft:#EEF2FF;
        --sa-primary-line:#C7D2FE;

        /* Severity ramp, five steps, used only for severity. */
        --sa-critical:#B42318;
        --sa-high:#D92D20;
        --sa-medium:#DC6803;
        --sa-low:#B54708;
        --sa-info:#667085;
        --sa-critical-soft:#FEF3F2;
        --sa-high-soft:#FEF3F2;
        --sa-medium-soft:#FFFAEB;
        --sa-low-soft:#FFFAEB;
        --sa-info-soft:#F2F4F7;

        --sa-success:#067647;
        --sa-success-soft:#ECFDF3;
        --sa-success-line:#ABEFC6;
        --sa-warn:#DC6803;
        --sa-warn-soft:#FFFAEB;
        --sa-defect:var(--sa-high);
        --sa-review:var(--sa-medium);
        --sa-pass:var(--sa-success);
        --sa-note:var(--sa-primary);
        --sa-brand:var(--sa-primary);--sa-brand-strong:var(--sa-primary-hover);--sa-brand-soft:var(--sa-primary-soft);
        --sa-accent:var(--sa-primary);--sa-sheet:var(--sa-surface);--sa-vellum:var(--sa-subtle);--sa-paper:var(--sa-canvas);
        --sa-sev-critical:var(--sa-critical);--sa-sev-high:var(--sa-high);--sa-sev-medium:var(--sa-medium);--sa-sev-low:var(--sa-low);--sa-sev-info:var(--sa-info);
        --sa-ok:var(--sa-success);

        --sa-radius:8px;
        --sa-radius-sm:6px;
        --sa-shadow-sm:0 1px 2px rgba(16,24,40,.06);
        --sa-shadow:0 1px 3px rgba(16,24,40,.10),0 1px 2px rgba(16,24,40,.06);
        --sa-shadow-lg:0 24px 48px -12px rgba(16,24,40,.18);

        --sa-sans:'Inter',system-ui,-apple-system,"Segoe UI",Roboto,"Helvetica Neue",sans-serif;
        --sa-draw:var(--sa-sans);
        --sa-mono:ui-monospace,SFMono-Regular,'SF Mono',Menlo,Consolas,monospace;
        --sa-hatch:repeating-linear-gradient(45deg,transparent 0 6px,rgba(16,24,40,.06) 6px 7px);
        --sa-grain:none}
      *{box-sizing:border-box;font-family:var(--sa-sans)}
      [hidden]{display:none!important}
      .backdrop{position:fixed;inset:0;background:rgba(16,24,40,.55);z-index:1;backdrop-filter:blur(2px)}

      .workspace{position:fixed;inset:24px;z-index:2;background:var(--sa-canvas);border-radius:12px;box-shadow:var(--sa-shadow-lg);display:flex;flex-direction:column;overflow:hidden;color:var(--sa-ink)}

      /* Top bar ------------------------------------------------------------ */
      .head{display:flex;align-items:center;gap:12px;padding:0 16px;height:56px;background:var(--sa-surface);border-bottom:1px solid var(--sa-line);flex:0 0 auto}
      .mark{display:block;flex:0 0 auto;width:26px;height:26px;border-radius:7px;background:var(--sa-primary);position:relative}
      .mark::after{content:"";position:absolute;inset:8px;border-radius:50%;border:2px solid #fff}
      .identity{display:flex;align-items:baseline;gap:8px;margin-right:auto}
      .identity .name{font-size:15px;font-weight:650;letter-spacing:-.01em;color:var(--sa-ink)}
      .identity .device{font-size:12px;color:var(--sa-ink-faint)}
      .close{border:1px solid var(--sa-line-strong);background:var(--sa-surface);width:32px;height:32px;display:grid;place-items:center;font-size:16px;line-height:1;color:var(--sa-ink-faint);cursor:pointer;border-radius:var(--sa-radius-sm)}
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
      .tab.active{background:var(--sa-primary-soft);color:var(--sa-primary);font-weight:600}
      .tab-label{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
      .nav-foot{margin-top:auto;padding-top:14px;display:flex;flex-direction:column;gap:8px}

      .main{flex:1 1 auto;min-width:0;overflow:auto;padding:20px 24px 28px;background:var(--sa-canvas)}
      .main-narrow{max-width:none;margin:0;width:100%;padding-left:max(24px,calc((100% - 820px) / 2));padding-right:max(24px,calc((100% - 820px) / 2))}

      /* A run in progress: full width, controls beside the title, and the
         activity feed taking whatever vertical space is left rather than
         stranding it. */
      .run-main{max-width:none;margin:0;width:100%;display:flex;flex-direction:column;min-height:0;padding-left:max(24px,calc((100% - 1280px) / 2));padding-right:max(24px,calc((100% - 1280px) / 2))}
      .run-head{align-items:center}
      .run-target{margin:4px 0 0;font-size:13.5px;color:var(--sa-ink-faint);font-family:var(--sa-mono);overflow-wrap:anywhere}
      .run-actions{margin-left:auto;display:flex;gap:10px;flex-wrap:wrap}
      .run-progress{background:var(--sa-surface);border:1px solid var(--sa-line);border-radius:var(--sa-radius);box-shadow:var(--sa-shadow-sm);padding:16px 18px;margin:0 0 16px}
      .run-progress-top{display:flex;align-items:baseline;gap:12px;margin:0 0 10px}
      .run-progress .phase-label{margin:0;font-size:14px;font-weight:600;color:var(--sa-ink)}
      .run-pct{margin-left:auto;font-size:22px;font-weight:650;letter-spacing:-.02em;color:var(--sa-primary);font-variant-numeric:tabular-nums}
      .run-progress .progress-bar{margin:0}
      .run-scale{margin:10px 0 0;font-size:12.5px;color:var(--sa-ink-faint);font-variant-numeric:tabular-nums}
      .run-scale:empty{display:none}
      /* Six counters read as one instrument row, not as a ragged wrap. */
      .stat-grid.run-stats{grid-template-columns:repeat(6,minmax(0,1fr));gap:12px;margin:0 0 16px}
      .stat-grid.run-stats>div{padding:12px 14px}
      .stat-grid.run-stats dd{font-size:22px}
      @media(max-width:1180px){.stat-grid.run-stats{grid-template-columns:repeat(3,minmax(0,1fr))}}
      @media(max-width:720px){.stat-grid.run-stats{grid-template-columns:repeat(2,minmax(0,1fr))}}
      /* The feed is the live part of this screen, so it gets the leftover height. */
      .run-feed{flex:1 1 auto;min-height:0;display:flex;flex-direction:column;margin:0 0 4px}
      .run-feed .recent-feed{flex:1 1 auto;min-height:120px;overflow:auto}
      .run-feed .recent-feed:empty::after{content:"Waiting for the first page to come back…";display:block;padding:14px;font-size:13px;color:var(--sa-ink-faint)}
      .page-head{display:flex;align-items:flex-start;gap:16px;flex-wrap:wrap;margin:0 0 18px}
      h2{margin:0;font-size:22px;font-weight:650;letter-spacing:-.02em;line-height:1.2}
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
      .sheet-scale:empty{display:none}
      .sheet-scale{margin-left:auto;font-size:12px;color:var(--sa-ink-faint);font-variant-numeric:tabular-nums;background:var(--sa-surface);border:1px solid var(--sa-line);border-radius:999px;padding:4px 12px;white-space:nowrap}

      /* Cards --------------------------------------------------------------- */
      .card{background:var(--sa-surface);border:1px solid var(--sa-line);border-radius:var(--sa-radius);box-shadow:var(--sa-shadow-sm)}
      .card-head{display:flex;align-items:center;gap:10px;padding:12px 14px;border-bottom:1px solid var(--sa-line)}
      .card-head h3{margin:0;font-size:13.5px;font-weight:600;color:var(--sa-ink)}
      .feed-heading{margin:0 0 10px;font-size:13.5px;font-weight:600;color:var(--sa-ink);letter-spacing:0;text-transform:none;padding:0;border:0}

      /* Stat tiles ---------------------------------------------------------- */
      .stat-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:14px;margin:0 0 18px}
      .stat-grid>div{background:var(--sa-surface);border:1px solid var(--sa-line);border-radius:var(--sa-radius);box-shadow:var(--sa-shadow-sm);padding:14px 16px}
      .stat-grid dt{font-size:12.5px;font-weight:500;color:var(--sa-ink-faint);margin:0 0 6px;text-transform:none;letter-spacing:0}
      .stat-grid dd{margin:0;font-size:26px;font-weight:650;letter-spacing:-.02em;line-height:1.1;color:var(--sa-ink);font-variant-numeric:tabular-nums}
      .stat-sub{display:block;margin-top:5px;font-size:12px;line-height:1.4;color:var(--sa-ink-faint)}
      .tb-quantities{display:none}

      .sr-only{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap;border:0}

      /* Arriving from a tile means arriving at a pre-filtered list. Say which
         filter is on and how to leave it — an unexplained subset reads as a
         smaller site, which is the same mistake the scope banner exists to
         stop. */
      .scoped-note{display:flex;align-items:center;gap:10px;margin:0 0 12px;padding:8px 12px;background:var(--sa-primary-soft);border:1px solid var(--sa-primary-line);border-radius:var(--sa-radius);font-size:12.5px;color:var(--sa-ink-soft)}
      .scoped-note .scoped-text b{color:var(--sa-ink);font-weight:650;font-variant-numeric:tabular-nums}
      .scoped-note .link-btn{color:var(--sa-primary);flex:0 0 auto}

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
      .stat-tile:has(.stat-open:not(:disabled)):hover dt::after{color:var(--sa-primary)}

      /* Grouped navigation --------------------------------------------------
         Twelve report sections need grouping or they read as a list of
         twenty. The groups also carry the one thing an operator has to know
         before trusting a section: where its evidence comes from. "Browser
         checks" is a separate group precisely because those two sections are
         the ones that can honestly be empty. */
      .nav-group{margin:0 0 12px}
      .nav-group:last-of-type{margin-bottom:0}
      .nav-group-label{font-size:10.5px;font-weight:650;letter-spacing:.07em;text-transform:uppercase;color:var(--sa-ink-faint);padding:0 10px;margin:0 0 5px}

      /* The state chip is the answer to Sitebulb's score dial: the same
         glanceable per-section signal without inventing a number. Three
         states only, in the same words the Site conditions readout uses. */
      .tab-state{margin-left:auto;display:inline-flex;align-items:center;gap:6px;flex:0 0 auto}
      .tab-dot{width:7px;height:7px;border-radius:50%;background:var(--sa-line-strong);flex:0 0 auto}
      .tab-state[data-state=attention] .tab-dot{background:var(--sa-high)}
      .tab-state[data-state=ok] .tab-dot{background:var(--sa-success)}
      .tab-state[data-state=unknown] .tab-dot{background:transparent;border:1.5px dashed var(--sa-ink-faint);width:9px;height:9px}
      .tab-num{font-size:11.5px;font-weight:600;color:var(--sa-ink-faint);font-variant-numeric:tabular-nums}
      .tab-state[data-state=attention] .tab-num{color:var(--sa-high)}
      .tab.active .tab-num{color:var(--sa-primary)}

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
      .coverage-line[data-state=attention] .cl-mark{background:var(--sa-high)}
      .coverage-line[data-state=unknown]{border-style:dashed;border-color:var(--sa-line-strong);background-image:var(--sa-hatch)}
      .coverage-line[data-state=unknown] .cl-mark{background:transparent;border:1.5px dashed var(--sa-ink-faint)}
      .coverage-line .cl-action{margin-left:auto;flex:0 0 auto}

      .section-stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px;margin:0 0 16px}
      .section-stats>div{position:relative;background:var(--sa-surface);border:1px solid var(--sa-line);border-radius:var(--sa-radius);box-shadow:var(--sa-shadow-sm);padding:11px 13px}
      .section-stats dt{font-size:12px;font-weight:500;color:var(--sa-ink-faint);margin:0 0 5px}
      .section-stats dd{margin:0;font-size:21px;font-weight:650;letter-spacing:-.02em;line-height:1.1;color:var(--sa-ink);font-variant-numeric:tabular-nums}
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
      .dist-fill.tone-attention{background:var(--sa-high)}
      .dist-fill.tone-warn{background:var(--sa-medium)}
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
      .section-findings{margin:18px 0 0}
      .section-findings h3{margin:0 0 4px;font-size:14px;font-weight:600;color:var(--sa-ink)}
      .section-findings .hint{margin:0 0 10px}

      /* Overview grid ------------------------------------------------------- */
      .overview-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(320px,1fr));gap:14px;margin:0 0 18px;align-items:start}
      .panel-card{background:var(--sa-surface);border:1px solid var(--sa-line);border-radius:var(--sa-radius);box-shadow:var(--sa-shadow-sm);padding:14px 16px 16px}

      /* Site conditions ----------------------------------------------------- */
      .conditions{margin:0 0 18px;background:var(--sa-surface);border:1px solid var(--sa-line);border-radius:var(--sa-radius);box-shadow:var(--sa-shadow-sm);overflow:hidden}
      .conditions>.feed-heading{padding:14px 16px 0;margin:0}
      .conditions-list{list-style:none;margin:10px 0 0;padding:0}
      .cond-row{border-top:1px solid var(--sa-line)}
      .cond-head{display:grid;grid-template-columns:22px 150px minmax(0,1fr) auto;gap:12px;align-items:center;width:100%;text-align:left;border:0;background:transparent;padding:11px 16px;font:inherit;color:inherit;cursor:pointer}
      .cond-head:hover{background:var(--sa-subtle)}
      .cond-head:focus-visible{outline:2px solid var(--sa-primary);outline-offset:-2px}
      .cond-mark{width:18px;height:18px;border-radius:50%;display:block;background:var(--sa-info-soft);border:1px solid var(--sa-line-strong);position:relative}
      .cond-mark::after{content:"";position:absolute;inset:5px;border-radius:50%;background:var(--sa-ink-faint)}
      .cond-row[data-state=ok] .cond-mark{background:var(--sa-success-soft);border-color:var(--sa-success-line)}
      .cond-row[data-state=ok] .cond-mark::after{background:var(--sa-success)}
      .cond-row[data-state=attention] .cond-mark{background:var(--sa-high-soft);border-color:#FECDCA}
      .cond-row[data-state=attention] .cond-mark::after{background:var(--sa-high)}
      .cond-row[data-state=unknown] .cond-mark::after{background:transparent;border:2px dashed var(--sa-ink-faint);inset:3px}
      .cond-label{font-size:13px;font-weight:600;color:var(--sa-ink)}
      .cond-headline{font-size:13px;color:var(--sa-ink-soft)}
      .cond-state{font-size:11.5px;font-weight:600;color:var(--sa-ink-faint);white-space:nowrap;background:var(--sa-subtle);border-radius:999px;padding:3px 10px}
      .cond-row[data-state=ok] .cond-state{background:var(--sa-success-soft);color:var(--sa-success)}
      .cond-row[data-state=attention] .cond-state{background:var(--sa-high-soft);color:var(--sa-high)}
      .cond-evidence{margin:0;padding:0 16px 14px 50px;list-style:none}
      .cond-evidence li{font-size:12.5px;line-height:1.55;color:var(--sa-ink-soft);margin-bottom:4px}
      .cond-confidence{display:inline-block;margin-top:6px;font-size:11.5px;color:var(--sa-ink-faint);background:var(--sa-subtle);border-radius:999px;padding:2px 9px}
      .conditions-note{margin:0;padding:0 16px 14px;font-size:12px;line-height:1.5;color:var(--sa-ink-faint)}

      /* Findings ------------------------------------------------------------ */
      .findings-list{list-style:none;margin:0;padding:0;display:grid;gap:10px;counter-reset:keynote}
      .finding-row{background:var(--sa-surface);border:1px solid var(--sa-line);border-radius:var(--sa-radius);box-shadow:var(--sa-shadow-sm);overflow:hidden;counter-increment:keynote}
      .finding-row:hover{border-color:var(--sa-line-strong)}
      .f-toggle{display:block;width:100%;text-align:left;background:transparent;border:0;padding:12px 14px;font:inherit;color:inherit;cursor:pointer}
      .f-toggle:hover{background:var(--sa-subtle)}
      .f-toggle:focus-visible{outline:2px solid var(--sa-primary);outline-offset:-2px}
      .finding-row .f-top{display:grid;grid-template-columns:auto minmax(0,1fr) auto auto;align-items:center;gap:12px;margin-bottom:4px}
      .finding-row .f-top .badge{justify-self:start}
      .finding-row .f-title{min-width:0;overflow-wrap:anywhere}
      .finding-row .f-top::before{content:none}
      .finding-row .f-title{font-weight:600;font-size:14px;color:var(--sa-ink)}
      .finding-row .f-meta{display:flex;align-items:center;gap:10px;font-size:12.5px;color:var(--sa-ink-faint);padding-left:0}
      .f-chev{flex:0 0 auto;width:16px;text-align:right;color:var(--sa-ink-faint);font-size:15px;line-height:1;transition:transform .15s ease}
      .f-toggle[aria-expanded="true"] .f-chev{transform:rotate(90deg)}
      .finding-row .f-conf{flex:0 0 auto;width:112px;font-size:12px;color:var(--sa-ink-faint);display:flex;align-items:center;gap:6px;margin-left:auto}
      .finding-row.sev-critical,.finding-row.sev-high{box-shadow:inset 3px 0 0 var(--sa-high),var(--sa-shadow-sm)}
      .finding-row.sev-medium{box-shadow:inset 3px 0 0 var(--sa-medium),var(--sa-shadow-sm)}
      .finding-row.sev-low{box-shadow:inset 3px 0 0 var(--sa-low),var(--sa-shadow-sm)}
      .finding-row.sev-info{box-shadow:inset 3px 0 0 var(--sa-line-strong),var(--sa-shadow-sm)}
      .empty-row{font-size:13px;color:var(--sa-ink-faint);padding:16px;background:var(--sa-surface);border:1px solid var(--sa-line);border-radius:var(--sa-radius)}

      .badge{display:inline-flex;align-items:center;border-radius:999px;padding:2px 9px;font-size:11.5px;font-weight:600;letter-spacing:0;text-transform:capitalize;border:1px solid transparent}
      .badge.fix{background:var(--sa-high-soft);color:var(--sa-high)}
      .badge.review{background:var(--sa-medium-soft);color:var(--sa-medium)}
      .badge.sev-critical{background:var(--sa-critical);color:#fff}
      .badge.sev-high{background:var(--sa-high-soft);color:var(--sa-high);border-color:#FECDCA}
      .badge.sev-medium{background:var(--sa-medium-soft);color:var(--sa-medium);border-color:#FEDF89}
      .badge.sev-low{background:var(--sa-low-soft);color:var(--sa-low);border-color:#FEDF89}
      .badge.sev-info{background:var(--sa-info-soft);color:var(--sa-ink-faint);border-color:var(--sa-line-strong)}

      .confidence-dot{display:inline-block;width:8px;height:8px;border-radius:50%;flex:0 0 auto}
      .confidence-dot.confirmed{background:var(--sa-success)}
      .confidence-dot.inferred{background:var(--sa-medium)}
      .confidence-dot.inconclusive{background:var(--sa-line-strong)}

      /* Tables -------------------------------------------------------------- */
      .data-table{width:100%;border-collapse:collapse;font-size:13px;background:var(--sa-surface);border:1px solid var(--sa-line);border-radius:var(--sa-radius);overflow:hidden}
      .data-table th{text-align:left;font-size:12px;font-weight:600;color:var(--sa-ink-faint);text-transform:none;letter-spacing:0;padding:10px 12px;border-bottom:1px solid var(--sa-line);background:var(--sa-subtle)}
      .data-table td{padding:10px 12px;border-bottom:1px solid var(--sa-line);vertical-align:top;word-break:break-word;font-variant-numeric:tabular-nums;color:var(--sa-ink-soft)}
      .data-table tbody tr:hover:not(.detail-row){background:var(--sa-subtle)}
      .data-table tbody tr:nth-child(even):not(.detail-row){background:transparent}
      .data-table td.mono{font-family:var(--sa-mono);font-size:12px;color:var(--sa-ink)}
      .data-table th[data-sort]{cursor:pointer;user-select:none}
      .data-table th[data-sort]:hover{color:var(--sa-ink)}
      .data-table th.sorted-asc::after{content:' \\25B2'}
      .data-table th.sorted-desc::after{content:' \\25BC'}

      /* inline-block + nowrap: as an inline span in a narrow table cell the
         pill used to break mid-word, rendering "broken" as "broke / n" across
         two lines inside its own pill. A status label is a single token. */
      .status-pill{display:inline-block;white-space:nowrap;word-break:normal;overflow-wrap:normal;font-size:11.5px;font-weight:600;text-transform:none;letter-spacing:0;padding:2px 9px;border-radius:999px;border:1px solid transparent}
      /* The status column sizes to its content instead of taking an equal
         share and squeezing the pill; the URL columns absorb the slack. */
      .data-table td.col-status,.data-table th.col-status{width:1%;white-space:nowrap}
      .status-pill.healthy{background:var(--sa-success-soft);color:var(--sa-success);border-color:var(--sa-success-line)}
      .status-pill.broken{background:var(--sa-high-soft);color:var(--sa-high);border-color:#FECDCA}
      .status-pill.inconclusive,.status-pill.blocked{background:var(--sa-info-soft);color:var(--sa-ink-faint);border-color:var(--sa-line-strong)}

      /* Controls ------------------------------------------------------------ */
      .btn{display:inline-flex;align-items:center;justify-content:center;gap:7px;border:1px solid var(--sa-line-strong);border-radius:var(--sa-radius-sm);background:var(--sa-surface);color:var(--sa-ink);padding:8px 14px;font-family:var(--sa-sans);font-size:13.5px;font-weight:600;letter-spacing:0;text-transform:none;cursor:pointer;min-height:36px;box-shadow:var(--sa-shadow-sm);transition:background .12s ease,border-color .12s ease}
      .btn:hover:not(:disabled){background:var(--sa-subtle)}
      .btn:focus-visible{outline:2px solid var(--sa-primary);outline-offset:1px}
      .btn:disabled{opacity:.5;cursor:default}
      .btn.primary{background:var(--sa-primary);border-color:var(--sa-primary);color:#fff}
      .btn.primary:hover:not(:disabled){background:var(--sa-primary-hover);border-color:var(--sa-primary-hover)}
      .btn.danger{border-color:#FDA29B;color:var(--sa-high);background:var(--sa-surface)}
      .btn.danger:hover:not(:disabled){background:var(--sa-high-soft)}
      .btn .departs{width:13px;height:13px;flex:0 0 auto;fill:none;stroke:currentColor;stroke-width:1.6;stroke-linecap:round;stroke-linejoin:round;opacity:.8}

      .chip{border:1px solid var(--sa-line-strong);background:var(--sa-surface);border-radius:999px;padding:6px 13px;font-family:var(--sa-sans);font-size:12.5px;font-weight:500;letter-spacing:0;text-transform:none;color:var(--sa-ink-soft);cursor:pointer;min-height:32px;box-shadow:var(--sa-shadow-sm)}
      .chip:hover{background:var(--sa-subtle);color:var(--sa-ink)}
      .toolbar{display:flex;gap:10px;margin:0 0 12px;flex-wrap:wrap}
      .toolbar input[type="search"]{flex:1 1 260px;border:1px solid var(--sa-line-strong);border-radius:var(--sa-radius-sm);padding:9px 12px;font-size:13.5px;background:var(--sa-surface);color:var(--sa-ink);box-shadow:var(--sa-shadow-sm)}
      .toolbar input[type="search"]::placeholder{color:var(--sa-ink-faint)}
      .toolbar select{border:1px solid var(--sa-line-strong);border-radius:var(--sa-radius-sm);padding:9px 12px;font-size:13.5px;background:var(--sa-surface);color:var(--sa-ink);box-shadow:var(--sa-shadow-sm)}
      /* Link status filters carry their own counts. */
      .status-chips{display:flex;gap:8px;flex-wrap:wrap;margin:0 0 14px}
      .status-chip{display:inline-flex;align-items:center;gap:8px}
      .status-chip b{font-variant-numeric:tabular-nums;font-weight:650;color:var(--sa-ink)}
      .status-chip.active{background:var(--sa-primary-soft);border-color:var(--sa-primary-line);color:var(--sa-primary)}
      .status-chip.active b{color:var(--sa-primary)}
      /* A run of links from one page reads as a block, not the same URL
         restated on every row. */
      .links-table .link-same-source td:first-child{border-top:0}
      .links-table tbody tr:not(.link-same-source) td{border-top:1px solid var(--sa-line)}
      .links-source-head{width:34%}
      .urls-table td:first-child{font-family:var(--sa-mono);font-size:12px}
      .toolbar input:focus-visible,.toolbar select:focus-visible,.field input:focus-visible,.field textarea:focus-visible{outline:2px solid var(--sa-primary);outline-offset:1px;border-color:var(--sa-primary)}
      .quick-filters{display:flex;gap:8px;margin:0 0 14px;align-items:center;flex-wrap:wrap}
      .filter-state{font-size:12.5px;color:var(--sa-ink-faint);margin-left:auto;font-variant-numeric:tabular-nums}
      .hide-unconfirmed{display:flex;align-items:center;gap:7px;font-size:13px;color:var(--sa-ink-soft);white-space:nowrap}

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
      .lede{margin:0 0 18px;color:var(--sa-ink-soft);font-size:14px;line-height:1.6;max-width:76ch}
      .tier-note{padding:12px 14px;background:var(--sa-primary-soft);border:1px solid var(--sa-primary-line);border-radius:var(--sa-radius);font-size:13px;color:var(--sa-ink-soft)}
      .resume-banner{display:flex;align-items:center;gap:14px;justify-content:space-between;border:1px solid var(--sa-primary-line);background:var(--sa-primary-soft);border-radius:var(--sa-radius);padding:12px 14px;margin:0 0 18px}
      .resume-text{margin:0;font-size:13px;color:var(--sa-ink-soft)}
      .setup-error{color:var(--sa-high);font-size:13px}

      .advanced{border:1px solid var(--sa-line);border-radius:var(--sa-radius);margin:6px 0 18px;overflow:hidden;background:var(--sa-surface);box-shadow:var(--sa-shadow-sm)}
      .advanced summary{cursor:pointer;padding:12px 14px;font-size:13.5px;font-weight:600;letter-spacing:0;text-transform:none;color:var(--sa-ink);list-style:none;display:flex;align-items:center;gap:8px;background:var(--sa-surface)}
      .advanced summary::-webkit-details-marker{display:none}
      .advanced summary::before{content:'\\25B8';display:inline-block;font-size:10px;color:var(--sa-ink-faint);transition:transform .15s ease}
      .advanced[open] summary::before{transform:rotate(90deg)}
      .advanced-body{padding:4px 14px 16px;border-top:1px solid var(--sa-line)}
      .advanced textarea{font-family:var(--sa-mono);font-size:12.5px;resize:vertical;min-height:60px}

      /* Progress ------------------------------------------------------------ */
      .phase-label{font-size:13.5px;color:var(--sa-ink-soft);margin:0 0 12px}
      .progress-bar{height:8px;border-radius:999px;background:var(--sa-info-soft);overflow:hidden;margin-bottom:22px}
      .progress-fill{height:100%;background:var(--sa-primary);width:4%;transition:width .3s ease;border-radius:999px}
      .recent-feed{list-style:none;margin:0;padding:0;background:var(--sa-surface);border:1px solid var(--sa-line);border-radius:var(--sa-radius);overflow:hidden;box-shadow:var(--sa-shadow-sm)}
      .recent-feed li{display:flex;align-items:center;gap:10px;font-size:12.5px;padding:9px 12px;border-bottom:1px solid var(--sa-line)}
      .recent-feed li:last-child{border-bottom:0}
      .recent-feed .url{flex:1 1 auto;font-family:var(--sa-mono);font-size:12px;color:var(--sa-ink-soft);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
      .reassure{margin:14px 0 0;max-width:76ch}

      /* Severity + breakdown ------------------------------------------------- */
      .severity-block{margin:0}
      .severity-bar{display:flex;height:12px;border-radius:999px;overflow:hidden;background:var(--sa-info-soft);margin:0 0 12px}
      .severity-bar span{height:100%}
      .severity-legend{list-style:none;display:grid;gap:8px;margin:0;padding:0;font-size:13px;color:var(--sa-ink-soft)}
      .severity-legend li{display:flex;align-items:center;gap:8px;font-variant-numeric:tabular-nums}
      .severity-legend .sw{width:10px;height:10px;border-radius:12px;flex:0 0 auto}

      .impact-breakdown{display:grid;gap:2px;margin:0}
      .impact-chip{display:flex;align-items:center;gap:10px;border:1px solid transparent;background:transparent;border-radius:var(--sa-radius-sm);padding:8px 10px;cursor:pointer;font-size:13px;text-align:left;width:100%;color:var(--sa-ink-soft)}
      .impact-chip:hover{background:var(--sa-subtle)}
      .impact-chip.active{background:var(--sa-primary-soft);border-color:var(--sa-primary-line);color:var(--sa-primary)}
      .impact-chip .ic-count{font-weight:650;font-size:15px;color:var(--sa-ink);font-variant-numeric:tabular-nums;min-width:38px;text-align:right}
      .impact-chip.active .ic-count{color:var(--sa-primary)}

      .top-issues{list-style:none;margin:0;padding:0;display:grid;gap:2px}
      .top-issues li{min-width:0}
      .ti-open{display:flex;align-items:center;gap:10px;width:100%;min-width:0;font:inherit;font-size:13px;text-align:left;border:0;background:transparent;padding:8px 10px;border-radius:var(--sa-radius-sm);color:var(--sa-ink-soft);cursor:pointer}
      .ti-open:hover{background:var(--sa-subtle)}
      .ti-open:focus-visible{outline:2px solid var(--sa-primary);outline-offset:-2px}
      .top-issues .badge{flex:0 0 auto}
      /* min-width:0 is what actually lets the title shrink and ellipsis inside
         a flex row; without it the row grew and pushed the count off the card. */
      .top-issues .ti-rule{font-weight:500;flex:1 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--sa-ink)}
      .top-issues .ti-scope{flex:0 0 auto;color:var(--sa-ink-faint);font-size:12px;white-space:nowrap;font-variant-numeric:tabular-nums}

      /* Coverage ------------------------------------------------------------- */
      .coverage-banner{border:0;border-radius:0;padding:0;margin:0;font-size:13px;color:var(--sa-ink-soft);display:block}
      .coverage-banner strong{color:var(--sa-ink);font-variant-numeric:tabular-nums}
      .cov-plan{display:flex;height:10px;border-radius:999px;overflow:hidden;margin:0 0 12px;background:var(--sa-info-soft)}
      .cov-surveyed{background:var(--sa-primary)}
      .cov-unsurveyed{background-image:var(--sa-hatch);flex:1 1 auto}
      .cov-note{display:grid;gap:8px;line-height:1.55}

      /* The render pass is where every accessibility, runtime-error and
         performance finding comes from. When it has not run, the audit is
         missing three whole disciplines — so the panel states which of the
         three coverage states it is in, in the same words the Site conditions
         readout uses, instead of reading as an optional extra tucked under the
         fold. */
      .render-section{border:1px solid var(--sa-primary-line);border-radius:var(--sa-radius);padding:16px;margin:0 0 18px;background:var(--sa-primary-soft)}
      .render-section h3{margin:0;font-size:14px;font-weight:600;letter-spacing:0;text-transform:none;color:var(--sa-ink)}
      .render-head{display:flex;align-items:center;gap:10px;margin:0 0 6px}
      .render-state{margin-left:auto;flex:0 0 auto;font-size:11.5px;font-weight:600;white-space:nowrap;border-radius:999px;padding:3px 10px;background:var(--sa-subtle);color:var(--sa-ink-faint)}
      .render-status{margin:0 0 12px;font-size:13px;line-height:1.55;color:var(--sa-ink-soft);max-width:82ch}
      .render-section .actions{margin-top:0}
      /* Unrun is a coverage fact, not a defect: neutral surface with the same
         hatched rail the survey drawings use, never a severity colour. */
      .render-section[data-state=none]{background:var(--sa-surface);border-color:var(--sa-line-strong);border-left:6px solid transparent;background-image:linear-gradient(var(--sa-surface),var(--sa-surface)),var(--sa-hatch);background-origin:padding-box,border-box;background-clip:padding-box,border-box}
      .render-section[data-state=none] .render-state{background:var(--sa-subtle);color:var(--sa-ink);border:1px dashed var(--sa-line-strong)}
      .render-section[data-state=none] .render-progress-bar{display:none}
      .render-section[data-state=done]{background:var(--sa-success-soft);border-color:var(--sa-success-line)}
      .render-section[data-state=done] .render-state{background:#fff;color:var(--sa-success)}
      .render-section[data-state=done] .render-progress-bar{display:none}
      .render-section[data-state=running] .render-state,.render-section[data-state=partial] .render-state{background:#fff;color:var(--sa-primary)}

      .deliver{border:1px solid var(--sa-line);border-radius:var(--sa-radius);margin:0;overflow:hidden;background:var(--sa-surface);box-shadow:var(--sa-shadow-sm)}
      .deliver-main{display:flex;align-items:center;gap:18px;padding:16px}
      .deliver-copy{flex:1 1 auto}
      .deliver-copy h3{margin:0 0 3px;font-size:14px;font-weight:600;letter-spacing:0;text-transform:none;color:var(--sa-ink)}
      .deliver-copy .hint{margin:0;color:var(--sa-ink-faint)}
      .deliver-data{display:flex;align-items:center;gap:10px;flex-wrap:wrap;padding:12px 16px;background:var(--sa-subtle);border-top:1px solid var(--sa-line)}
      .deliver-label{font-size:12.5px;font-weight:600;text-transform:none;letter-spacing:0;color:var(--sa-ink-faint);margin-right:4px}
      .link-btn{background:none;border:0;padding:6px 2px;font:inherit;font-size:12.5px;color:var(--sa-ink-faint);text-decoration:underline;cursor:pointer;margin-left:auto}
      .link-btn:hover{color:var(--sa-ink)}
      .actions-end{justify-content:flex-end}

      .pager{display:flex;align-items:center;gap:12px;margin:14px 0 4px}
      .pager-label{font-size:12.5px;color:var(--sa-ink-faint);font-variant-numeric:tabular-nums}
      .csv-sep{font-size:12.5px;color:var(--sa-ink-faint);margin-left:4px}

      .section-index{display:flex;flex-wrap:wrap;gap:8px;margin:0 0 14px}
      .section-cut{display:flex;align-items:baseline;gap:8px;border:1px solid var(--sa-line-strong);background:var(--sa-surface);border-radius:999px;padding:6px 13px;cursor:pointer;font-family:var(--sa-sans);font-size:12.5px;color:var(--sa-ink-soft);min-height:32px;box-shadow:var(--sa-shadow-sm)}
      .section-cut:hover{background:var(--sa-subtle)}
      .section-cut:focus-visible{outline:2px solid var(--sa-primary);outline-offset:1px}
      .section-cut.active{background:var(--sa-primary-soft);border-color:var(--sa-primary-line);color:var(--sa-primary);box-shadow:none}
      .section-cut .sc-count{font-variant-numeric:tabular-nums;color:var(--sa-ink-faint);font-weight:600}
      .section-cut.active .sc-count{color:var(--sa-primary)}

      .history-list{list-style:none;margin:16px 0 0;padding:0;background:var(--sa-surface);border:1px solid var(--sa-line);border-radius:var(--sa-radius);overflow:hidden}
      .history-list li{display:flex;align-items:center;justify-content:space-between;gap:10px;border-bottom:1px solid var(--sa-line);padding:11px 14px;font-size:13px;font-variant-numeric:tabular-nums}
      .history-list li:last-child{border-bottom:0}
      .history-list button{border:0;background:transparent;color:var(--sa-primary);font-weight:600;cursor:pointer;font-size:13px}

      .foot-note{margin:0;padding:10px 16px;border-top:1px solid var(--sa-line);background:var(--sa-surface);color:var(--sa-ink-faint);font-size:12px;flex:0 0 auto;font-family:var(--sa-sans)}

      .finding-detail{margin:0 14px 14px;padding-top:12px;border-top:1px solid var(--sa-line)}
      .finding-detail h4{margin:14px 0 5px;font-size:12.5px;font-weight:600;text-transform:none;letter-spacing:0;color:var(--sa-ink-faint)}
      .detail-basis,.detail-explain{margin:0 0 8px;font-size:13px;line-height:1.6;color:var(--sa-ink-soft);max-width:84ch}
      .detail-rule{margin:0;font-size:12.5px;color:var(--sa-ink-faint)}
      .detail-rule code{font-family:var(--sa-mono);font-size:12px;color:var(--sa-ink-soft)}
      .finding-detail .url-list{max-height:220px;overflow:auto;border:1px solid var(--sa-line);border-radius:var(--sa-radius-sm);background:var(--sa-subtle);padding:6px 10px;margin:2px 0 4px}
      .finding-detail .url-item{display:block;font-family:var(--sa-mono);font-size:12.5px;color:var(--sa-primary);text-decoration:none;padding:3px 0;word-break:break-all}
      .finding-detail .url-item:hover{text-decoration:underline}
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
        .nav-foot{margin:0 0 0 auto;flex-direction:row;padding:0 12px 0 10px;flex:0 0 auto;position:sticky;right:0;background:var(--sa-nav);box-shadow:-10px 0 10px -8px rgba(16,24,40,.18)}
        .main{padding:16px 14px 22px}
        h2{font-size:19px}
        .cond-head{grid-template-columns:22px minmax(0,1fr);gap:8px 12px}
        .cond-headline,.cond-state{grid-column:2}
        .cond-state{justify-self:start}
        .cond-evidence{padding-left:16px}
      }
      @media(prefers-reduced-motion:reduce){.progress-fill,.f-chev{transition:none}}
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
  const SITE_AUDIT_NAV_GROUPS = [
    { label: 'Report', items: ['overview', 'findings'] },
    { label: 'Disciplines', items: ['availability', 'indexability', 'content', 'duplicates', 'sitemaps', 'security', 'international', 'quality'] },
    // Separated because these two are the sections that can legitimately hold
    // nothing: their evidence comes from the optional render pass, and an
    // empty Accessibility section means "not measured", never "clean".
    { label: 'Browser checks', items: ['performance', 'accessibility'] },
    { label: 'Crawl data', items: ['urls', 'links'] }
  ];

  const SITE_AUDIT_TAB_LABEL = {
    overview: 'Overview', findings: 'Findings', urls: 'Pages', links: 'Links',
    availability: 'Availability', indexability: 'Indexability', content: 'Content',
    duplicates: 'Duplicates', sitemaps: 'Sitemaps', security: 'Security',
    international: 'International', quality: 'Web quality',
    performance: 'Performance', accessibility: 'Accessibility'
  };

  /** Rule id to discipline, first match wins. Order is load-bearing:
   * `a11y.lang-*` is an International fact before it is an accessibility one,
   * `web.meta-refresh` is an indexability fact, and `quality` is last because
   * it is the catch-all. Every finding lands in exactly one section — a
   * taxonomy with holes would quietly drop rows out of the report. */
  const SITE_AUDIT_DISCIPLINE_RULES = [
    ['availability', [/^navigation\.link-/, /^runtime\.(resource-failed|resource-status|visible-error)/, /^navigation\.(fragment-missing|skip-link-target-missing)/, /^ux\.(inert-link|form-no-submit|controls-target-missing|disclosure-target-missing|disclosure-toggle-failed|menu-toggle-failed|interaction-restoration-unproven)/]],
    ['duplicates', [/^seo\.duplicate-/, /^structure\.duplicate-h1/]],
    ['sitemaps', [/^seo\.sitemap-/]],
    ['international', [/^seo\.hreflang-/, /^a11y\.lang-/]],
    ['indexability', [/^seo\.(canonical|noindex|robots|soft-404)/, /^structure\.orphan-page/, /^navigation\.redirect-chain-long/, /^web\.meta-refresh/]],
    ['security', [/^security\./]],
    ['performance', [/^performance\./]],
    ['accessibility', [/^(axe|a11y)\./]],
    ['content', [/^seo\.(title|description|thin-content)/, /^structure\.(h1-|heading-skip|image-alt-missing)/, /^content\./, /^social\./]],
    ['quality', [/./]]
  ];

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
      lede: 'Whether the things this site links to actually resolve. A confirmed broken link is a functional failure, not a suggestion — which is why this section leads the report.',
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
      lede: 'Measured loading behaviour — largest contentful paint, layout shift, time to first byte, page weight. Every number here comes from opening the page in a real browser.',
      findingsNote: 'Performance findings from the pages checked in this browser.'
    },
    accessibility: {
      evidence: 'render',
      lede: 'Barriers for assistive technology, keyboard and low-vision users, found by running axe against the rendered page.',
      findingsNote: 'Accessibility findings from the pages checked in this browser.'
    }
  };

  const SITE_AUDIT_DISCIPLINE_IDS = Object.keys(SITE_AUDIT_DISCIPLINE_META);

  function siteAuditNavMarkup() {
    return SITE_AUDIT_NAV_GROUPS.map((group) => `
            <div class="nav-group">
              <p class="nav-group-label">${group.label}</p>
              <nav class="tabs" aria-label="${group.label}">
                ${group.items.map((id) => `<button type="button" class="tab${id === 'overview' ? ' active' : ''}" data-tab="${id}"><span class="tab-label">${SITE_AUDIT_TAB_LABEL[id]}</span><span class="tab-state" hidden><span class="tab-dot" aria-hidden="true"></span><span class="tab-num"></span></span></button>`).join('')}
              </nav>
            </div>`).join('');
  }

  function createSiteAuditRoot() {
    const old = document.getElementById('__web_qa_site_audit_root');
    if (old) old.remove();
    const host = document.createElement('div');
    host.id = '__web_qa_site_audit_root';
    host.setAttribute('data-webqa-ui', 'site-audit-overlay');
    host.setAttribute('data-webqa-overlay', 'site-audit');
    host.style.cssText = 'all:initial;position:fixed;inset:0;z-index:2147483646;pointer-events:auto;';
    document.documentElement.appendChild(host);
    const shadow = host.attachShadow({ mode: 'open' });
    shadow.innerHTML = `<!--
      THESIS: The category standard for a site-audit tool, executed straight. The operator took the standing exit and named Sitebulb and Semrush as the bar: Sitebulb's density and severity discipline, Semrush's polish and colour confidence.
      OWN-WORLD: Light app canvas under white cards, one indigo primary for the product's own voice, a five-step severity ramp used only for severity, 8px radii, soft elevation, Inter-class system type, tabular figures.
      STORY: The consultant sees what was surveyed, what was not, and what is broken, then hands the sheet to a client.
      FIRST VIEWPORT: Left navigation carrying the site and its sections; main column opens on Overview — stat tiles, the site-conditions readout, then severity, findings by area, top issues and coverage. Primary action sits in the nav foot.
      FORM: The category standard (the standing exit), taken over the rolled direction; seed 40294b97.
      FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance
    --><style>${siteAuditCss()}</style><div class="backdrop"></div><section class="workspace" role="dialog" aria-modal="true" aria-labelledby="sa-title">
      <header class="head"><span class="mark" aria-hidden="true"></span><div class="identity"><span class="name">Lumen</span><span class="device">Site Audit</span></div><button type="button" class="close" aria-label="Close site audit">&times;</button></header>
      <div class="body">
        <div class="view view-setup active">
          <div class="main main-narrow">
          <div class="resume-banner" hidden>
            <p class="resume-text"></p>
            <button type="button" class="btn resume-btn">Resume</button>
          </div>
          <div class="page-head"><div><h2 id="sa-title">Audit this site</h2></div></div>
          <p class="lede">Crawls every page it can reach from this URL and checks it for broken links, missing SEO metadata, and heading structure. This step runs on the assistant server, not your computer — it's a plain page fetch, not a full browser render, which is what keeps it fast and cheap at any site size. It keeps going even if you close this window.</p>
          <p class="lede tier-note">Deeper checks that need a real browser — accessibility (axe), JavaScript-dependent content, and image/performance sizing — are a separate, optional step after the crawl finishes. That step runs in your own browser instead, one page at a time, so it costs your computer's resources rather than the server's.</p>
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
                <label class="field"><span>Delay between pages</span><input type="number" class="request-delay" min="0" max="5000" step="50" placeholder="0" /><span class="hint">Milliseconds to wait before each page fetch — a light rate limit if the target site is sensitive to burst traffic. 0 = off.</span></label>
              </div>
              <label class="field"><span>Only crawl paths containing</span><textarea class="include-patterns" placeholder="/blog/&#10;/products/"></textarea><span class="hint">One per line. If set, only URLs whose path contains at least one of these are crawled.</span></label>
              <label class="field"><span>Never crawl paths containing</span><textarea class="exclude-patterns" placeholder="/wp-admin/&#10;/tag/"></textarea><span class="hint">One per line. These are skipped even if linked from a crawled page.</span></label>
              <label class="check"><input type="checkbox" class="check-external-links" checked /><span>Check external links</span></label>
              <p class="hint hint-indent">Verify off-site links actually resolve. Turn off for a faster crawl, or if the target site's outbound links commonly trigger destination bot-protection.</p>
              <label class="check"><input type="checkbox" class="respect-nofollow" /><span>Don't follow rel="nofollow" links</span></label>
              <p class="hint hint-indent">Links are still recorded and link-checked either way — this only controls whether the crawler follows them to discover more pages.</p>
            </div>
          </details>
          <p class="setup-error" style="display:none"></p>
          <div class="actions">
            <button type="button" class="btn primary start-btn">Start audit</button>
            <button type="button" class="btn history-btn">Past audits</button>
          </div>
          <ul class="history-list" hidden></ul>
          </div>
        </div>
        <div class="view view-progress">
          <div class="main run-main">
          <div class="page-head run-head">
            <div>
              <h2>Auditing the site</h2>
              <p class="run-target tb-project">&mdash;</p>
            </div>
            <div class="run-actions">
              <button type="button" class="btn view-partial-btn">View results so far</button>
              <button type="button" class="btn danger cancel-btn">Cancel audit</button>
            </div>
          </div>
          <section class="run-progress">
            <div class="run-progress-top">
              <p class="phase-label"></p>
              <span class="run-pct">0%</span>
            </div>
            <div class="progress-bar"><div class="progress-fill"></div></div>
            <p class="run-scale tb-scale"></p>
          </section>
          <dl class="stat-grid run-stats">
            <div><dt>Discovered</dt><dd class="stat-discovered">0</dd></div>
            <div><dt>Crawled</dt><dd class="stat-crawled">0</dd></div>
            <div><dt>Links checked</dt><dd class="stat-links">0</dd></div>
            <div><dt>Findings</dt><dd class="stat-findings">0</dd></div>
            <div><dt>Errors</dt><dd class="stat-errors">0</dd></div>
            <div><dt>Elapsed</dt><dd class="stat-elapsed">0s</dd></div>
          </dl>
          <section class="run-feed">
            <h3 class="feed-heading">Recent activity</h3>
            <ul class="recent-feed"></ul>
          </section>
          <p class="hint reassure">This crawl runs on the assistant gateway, not in this tab. You can close this window or navigate away — it keeps going, and reopening Site Audit on this site reconnects to it.</p>
          </div>
        </div>
        <div class="view view-results">
          <aside class="sidenav">
            <div class="nav-site"><b class="tb-project">&mdash;</b><span class="tb-scale">&mdash;</span></div>
            ${siteAuditNavMarkup()}
            <div class="nav-foot">
              <button type="button" class="btn primary report-btn">Download report</button>
              <button type="button" class="btn new-audit-btn">New audit</button>
              <span class="tb-date" hidden></span>
            </div>
          </aside>
          <div class="main">
          <div class="page-head"><div><h2>Audit results</h2><p class="results-summary"></p></div></div>
          <div class="scope-banner" role="status" hidden><p class="scope-text"></p></div>
          <div class="tab-panel overview-panel">
          <dl class="stat-grid summary-stats">
            <div class="stat-tile"><dt>Pages crawled</dt><dd class="sh-pages">0</dd><span class="stat-sub sh-pages-sub"></span><button type="button" class="stat-open" data-open="crawled"><span class="sr-only">View the pages that were crawled</span></button></div>
            <div class="stat-tile"><dt>Findings</dt><dd class="sh-findings">0</dd><span class="stat-sub sh-findings-sub"></span><button type="button" class="stat-open" data-open="findings"><span class="sr-only">View all findings</span></button></div>
            <div class="stat-tile"><dt>Needs fixing</dt><dd class="sh-fix">0</dd><span class="stat-sub sh-fix-sub"></span><button type="button" class="stat-open" data-open="fix"><span class="sr-only">View the findings that need fixing</span></button></div>
            <div class="stat-tile"><dt>Coverage gaps</dt><dd class="sh-gaps">0</dd><span class="stat-sub sh-gaps-sub"></span><button type="button" class="stat-open" data-open="gaps"><span class="sr-only">View the pages that were not fully checked</span></button></div>
          </dl>
          <section class="render-section" data-state="idle" hidden>
            <div class="render-head">
              <h3 class="render-title">Deeper checks in your browser</h3>
              <span class="render-state"></span>
            </div>
            <p class="render-status"></p>
            <div class="progress-bar render-progress-bar"><div class="progress-fill render-progress-fill"></div></div>
            <p class="render-error" style="display:none"></p>
            <div class="actions">
              <button type="button" class="btn primary render-start-btn">Render remaining pages</button>
              <button type="button" class="btn danger render-stop-btn" hidden>Stop rendering</button>
            </div>
          </section>
          <section class="conditions" hidden>
            <h3 class="feed-heading">Site conditions</h3>
            <ul class="conditions-list"></ul>
            <p class="conditions-note">Each line states what was observed and the confidence that observation supports. There is no score: a single number would hide the evidence a client is entitled to see.</p>
          </section>
          <!-- The shape of what was crawled: how deep the site goes and what
               it answered. Both open the pages behind any bar. -->
          <div class="section-grid crawl-shape"></div>
          <div class="overview-grid">
            <section class="panel-card"><h3 class="feed-heading">Severity</h3><div class="severity-block"><div class="severity-bar" aria-hidden="true"></div></div><ul class="severity-legend"></ul></section>
            <section class="panel-card"><h3 class="feed-heading">Findings by area</h3><div class="impact-breakdown"></div></section>
            <section class="panel-card"><h3 class="feed-heading">Top issues</h3><ul class="top-issues"></ul></section>
            <section class="panel-card"><h3 class="feed-heading">Coverage</h3><div class="coverage-banner"></div></section>
          </div>
          <section class="deliver">
            <div class="deliver-main">
              <div class="deliver-copy">
                <h3>Share this audit</h3>
                <p class="hint">A self-contained HTML report with findings, evidence and coverage &mdash; the version to send a client.</p>
              </div>
              <button type="button" class="btn primary report-btn-2">Download report</button>
            </div>
            <div class="deliver-data">
              <span class="deliver-label">Raw data (CSV)</span>
              <button type="button" class="btn export-btn" data-dataset="findings">Findings</button>
              <button type="button" class="btn export-btn" data-dataset="urls-summary">Per-page summary</button>
              <button type="button" class="btn export-btn" data-dataset="urls">URLs</button>
              <button type="button" class="btn export-btn" data-dataset="links">Links</button>
              <button type="button" class="link-btn debug-btn" title="Raw audit data for troubleshooting an unexpected result">Debug report</button>
            </div>
          </section>
          </div>
          <div class="tab-panel findings-panel" hidden>
            <div class="toolbar">
              <input type="search" class="findings-search" placeholder="Search findings…" />
              <select class="findings-category" aria-label="Filter by category"><option value="">All categories</option><option value="fix">Fix</option><option value="review">Review</option><option value="context">Context</option></select>
              <select class="findings-sort" aria-label="Sort findings">
                <option value="severity">Sort: severity</option>
                <option value="pages">Sort: pages affected</option>
                <option value="instances">Sort: instances</option>
                <option value="area">Sort: area</option>
              </select>
              <label class="hide-unconfirmed"><input type="checkbox" class="findings-hide-unconfirmed" /> Hide unconfirmed</label>
            </div>
            <div class="quick-filters">
              <button type="button" class="chip chip-broken">Broken links</button>
              <button type="button" class="chip chip-schema">Structured data</button>
              <button type="button" class="chip chip-clear" hidden>Clear filters</button>
              <span class="filter-state" role="status"></span>
            </div>
            <ul class="findings-list"></ul>
          </div>
          <div class="tab-panel urls-panel" hidden>
            <div class="toolbar">
              <input type="search" class="urls-search" placeholder="Filter by URL or title…" />
            </div>
            <div class="scoped-note" role="status" hidden><span class="scoped-text"></span><button type="button" class="link-btn scoped-clear">Show all pages</button></div>
            <nav class="section-index" aria-label="Site sections"></nav>
            <table class="data-table urls-table"><thead><tr><th data-sort="url">Page</th><th data-sort="status" class="col-status">Status</th><th data-sort="title">Title</th><th data-sort="word_count">Words</th><th data-sort="schema">Structured data</th></tr></thead><tbody class="urls-body"></tbody></table>
            <div class="pager"><button type="button" class="btn pager-prev urls-prev">Prev</button><span class="pager-label urls-label"></span><button type="button" class="btn pager-next urls-next">Next</button></div>
          </div>
          <div class="tab-panel links-panel" hidden>
            <div class="toolbar">
              <input type="search" class="links-search" placeholder="Filter by source or target…" />
              <select class="links-status" hidden><option value="">All statuses</option><option value="broken">Broken</option><option value="blocked">Blocked</option><option value="inconclusive">Inconclusive</option><option value="healthy">Healthy</option></select>
            </div>
            <div class="status-chips" role="group" aria-label="Filter links by status"></div>
            <table class="data-table links-table"><thead><tr><th class="links-source-head">Source page</th><th>Links to</th><th>Anchor text</th><th class="col-status">Status</th></tr></thead><tbody class="links-body"></tbody></table>
            <div class="pager"><button type="button" class="btn pager-prev links-prev">Prev</button><span class="pager-label links-label"></span><button type="button" class="btn pager-next links-next">Next</button></div>
          </div>
          <!-- One panel serves all ten discipline sections. Their shape is
               identical by design — heading, coverage statement, figures,
               distributions, then the findings scoped to that discipline — so
               an operator who has read one knows how to read the rest. -->
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
      <p class="foot-note">Audit data is stored on the assistant gateway under this audit id — reopen Site Audit on this site to reconnect.</p>
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
      urlsStatus: '', urlsDepth: null, urlsHttpClass: '', urlCounts: {}, distributions: null, audit: null,
      linksOffset: 0, linksSearch: '', linksStatus: '', totalLinksByStatus: {}, urlsSection: '',
      findingsSearch: '', findingsCategory: '', findingsHideUnconfirmed: false, findingsImpactClass: '', expandedFindingKey: null, tabDefault: 'overview', findingsSort: 'severity'
    };
    shadow.querySelector('.start-url').value = `${origin}/`;
    paintTitleBlock(null);
    shadow.querySelector('.close').addEventListener('click', closeSiteAudit);
    shadow.querySelector('.start-btn').addEventListener('click', startSiteAudit);
    shadow.querySelector('.cancel-btn').addEventListener('click', cancelSiteAudit);
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
      setSiteAuditView('setup');
    });
    shadow.querySelector('.chip-clear').addEventListener('click', clearFindingFilters);
    // Every summary tile opens the rows behind its number. A count with no way
    // through to its evidence is the thing this product exists not to ship.
    for (const btn of shadow.querySelectorAll('.stat-open')) {
      btn.addEventListener('click', () => openSummaryTile(btn.dataset.open));
    }
    shadow.querySelector('.scoped-clear').addEventListener('click', () => {
      siteAudit.urlsStatus = '';
      siteAudit.urlsDepth = null;
      siteAudit.urlsHttpClass = '';
      siteAudit.urlsOffset = 0;
      loadSiteAuditUrls();
    });
    shadow.querySelector('.history-btn').addEventListener('click', () => loadSiteAuditHistory(origin));
    shadow.querySelector('.render-start-btn').addEventListener('click', startRenderPass);
    shadow.querySelector('.render-stop-btn').addEventListener('click', stopRenderPass);
    shadow.querySelector('.report-btn').addEventListener('click', downloadFullReport);
    shadow.querySelector('.report-btn-2')?.addEventListener('click', downloadFullReport);
    shadow.querySelector('.debug-btn').addEventListener('click', downloadDebugReport);
    // Both quick filters now write their value into the visible control they
    // drive, so the operator can see (and undo) what was applied on their behalf.
    shadow.querySelector('.chip-broken').addEventListener('click', () => {
      siteAudit.linksStatus = 'broken';
      shadow.querySelector('.links-status').value = 'broken';
      switchSiteAuditTab('links');
    });
    shadow.querySelector('.chip-schema').addEventListener('click', () => {
      siteAudit.findingsSearch = 'schema';
      shadow.querySelector('.findings-search').value = 'schema';
      switchSiteAuditTab('findings');
    });
    for (const tab of shadow.querySelectorAll('.tab')) tab.addEventListener('click', () => switchSiteAuditTab(tab.dataset.tab));
    for (const btn of shadow.querySelectorAll('.export-btn')) btn.addEventListener('click', () => exportSiteAudit(btn.dataset.dataset));
    const onFindingsSearch = debounce((value) => { siteAudit.findingsSearch = value; renderFindingsList(); }, 150);
    shadow.querySelector('.findings-search').addEventListener('input', (e) => onFindingsSearch(e.target.value));
    shadow.querySelector('.findings-category').addEventListener('change', (e) => { siteAudit.findingsCategory = e.target.value; renderFindingsList(); });
    shadow.querySelector('.findings-hide-unconfirmed').addEventListener('change', (e) => { siteAudit.findingsHideUnconfirmed = e.target.checked; renderFindingsList(); });
    shadow.querySelector('.findings-sort').addEventListener('change', (e) => { siteAudit.findingsSort = e.target.value; renderFindingsList(); });
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
    const mostRecent = (r?.audits || [])[0];
    if (!mostRecent || !siteAudit) return;
    const banner = siteAudit.shadow.querySelector('.resume-banner');
    const when = new Date(mostRecent.createdAt).toLocaleString();
    banner.querySelector('.resume-text').textContent = mostRecent.status === 'running'
      ? `An audit of this site is still running (started ${when}).`
      : `Last audit of this site: ${when} — ${mostRecent.status}, ${mostRecent.findingsCount} findings.`;
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
  }
  function stopPolling() {
    if (siteAudit?.pollTimer) { clearInterval(siteAudit.pollTimer); siteAudit.pollTimer = null; }
  }

  async function loadSiteAuditHistory(origin) {
    const list = siteAudit.shadow.querySelector('.history-list');
    const r = await chrome.runtime.sendMessage({ type: 'SITE_AUDIT_LIST', site: origin }).catch(() => null);
    list.innerHTML = '';
    const audits = (r?.audits || []).filter((a) => a.status !== 'running');
    if (!audits.length) { list.hidden = true; return; }
    list.hidden = false;
    for (const audit of audits.slice(0, 8)) {
      const li = document.createElement('li');
      const label = document.createElement('span');
      label.textContent = `${new Date(audit.createdAt).toLocaleString()} — ${audit.status} (${audit.findingsCount} findings)`;
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.textContent = 'Open';
      btn.addEventListener('click', () => { siteAudit.auditId = audit.id; showSiteAuditResults(); });
      li.append(label, btn);
      list.appendChild(li);
    }
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
    if (siteAudit.view === 'progress') renderSiteAuditProgress(audit);
    if (siteAudit.view === 'results') { renderSiteAuditRenderSection(audit); renderScopeBanner(audit); }
    if (['complete', 'cancelled', 'failed'].includes(audit.status) && siteAudit.view === 'progress') {
      stopPolling();
      showSiteAuditResults();
      return;
    }
    // Once the crawl itself is done, polling only needs to continue while the
    // (separate, optional) render pass is actively running in this browser.
    if (audit.status !== 'running' && !siteAudit.renderRunning) stopPolling();
  }

  const SITE_AUDIT_PHASE_COPY = {
    queued: 'Queued — waiting to start.',
    discovering: 'Finding pages from the sitemap and homepage links…',
    crawling: 'Fetching and checking each page…',
    analyzing: 'Comparing pages against each other to finish the audit…',
    complete: 'Finished.'
  };
  const SITE_AUDIT_STATUS_COPY = {
    complete: 'Audit finished.',
    cancelled: 'Audit cancelled — results below cover what was crawled first.',
    failed: 'Audit failed before it could finish.'
  };

  // The title block is the sheet's provenance: which project, at what scale,
  // on what date. It carries the facts a client asks about first.
  function paintTitleBlock(audit) {
    const shadow = siteAudit.shadow;
    let project = '';
    try { project = new URL(audit?.config?.startUrl || siteAudit.siteOrigin || location.href).hostname; } catch { project = ''; }
    const counts = audit?.urlCounts || {};
    const fetched = Number(counts.fetched || 0);
    const discovered = Object.values(counts).reduce((s, n) => s + Number(n || 0), 0);
    const date = new Date(siteAudit.startedAt || Date.now());
    for (const el of shadow.querySelectorAll('.tb-project')) el.textContent = project || '—';
    for (const el of shadow.querySelectorAll('.tb-date')) el.textContent = date.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
    for (const el of shadow.querySelectorAll('.tb-scale')) el.textContent = discovered ? `${fetched} of ${discovered} pages surveyed` : (fetched ? `${fetched} pages surveyed` : String.fromCharCode(8212));
    const scale = shadow.querySelector('.run-scale');
    if (scale) {
      scale.textContent = discovered
        ? `${fetched} of ${discovered} discovered ${discovered === 1 ? 'page' : 'pages'} fetched so far`
        : '';
    }
  }

  function renderSiteAuditProgress(audit) {
    const shadow = siteAudit.shadow;
    paintTitleBlock(audit);
    const counts = audit.urlCounts || {};
    const discovered = Object.values(counts).reduce((s, n) => s + n, 0);
    const crawled = Number(counts.fetched || 0);
    const errored = Number(counts.error || 0);
    const target = Number(audit.config?.maxPages || 40);
    // `Phase: fetching` leaked an internal state token as the operator's only
    // description of what the product was doing during the longest wait.
    shadow.querySelector('.phase-label').textContent = audit.status === 'running'
      ? (SITE_AUDIT_PHASE_COPY[audit.phase] || 'Working…')
      : SITE_AUDIT_STATUS_COPY[audit.status] || `Status: ${audit.status}`;
    const pct = Math.max(0, Math.min(100, Math.round(((crawled + errored) / target) * 100)));
    shadow.querySelector('.progress-fill').style.width = `${Math.max(2, pct)}%`;
    const pctLabel = shadow.querySelector('.run-pct');
    if (pctLabel) pctLabel.textContent = `${pct}%`;
    shadow.querySelector('.stat-discovered').textContent = String(discovered);
    shadow.querySelector('.stat-crawled').textContent = String(crawled);
    shadow.querySelector('.stat-links').textContent = String(Object.values(audit.linkCounts || {}).reduce((s, n) => s + n, 0));
    shadow.querySelector('.stat-findings').textContent = String(audit.findingsCount || 0);
    shadow.querySelector('.stat-errors').textContent = String(errored);
    shadow.querySelector('.stat-elapsed').textContent = `${Math.max(0, Math.round((Date.now() - siteAudit.startedAt) / 1000))}s`;
    shadow.querySelector('.view-partial-btn').disabled = crawled === 0;
    renderRecentActivity(audit);
  }

  function renderRecentActivity(audit) {
    const feed = siteAudit.shadow.querySelector('.recent-feed');
    feed.innerHTML = '';
    for (const u of audit.recentUrls || []) {
      const li = document.createElement('li');
      const pill = document.createElement('span');
      // 401/403/429 mean the page blocked our automated request, not that it's
      // actually down — conflating the two (as this used to) makes a site's
      // own bot-protection look like a broken page.
      const status = u.status === 'error' ? 'broken' : [401, 403, 429].includes(u.http_status) ? 'blocked' : (u.http_status && u.http_status >= 400) ? 'broken' : 'healthy';
      pill.className = `status-pill ${status}`;
      pill.textContent = u.http_status ? String(u.http_status) : (u.status || '');
      const urlSpan = document.createElement('span');
      urlSpan.className = 'url';
      urlSpan.textContent = u.url;
      li.append(pill, urlSpan);
      feed.appendChild(li);
    }
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
    fill.style.width = `${rp.rendered ? Math.max(4, pct) : 0}%`;
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
      statusEl.textContent = `None of the ${rp.total} crawled page${rp.total === 1 ? ' has' : 's have'} been opened in a real browser, so this audit carries no accessibility, runtime-error or performance evidence for ${rp.total === 1 ? 'it' : 'them'}. That is a gap in coverage, not a clean result. The pass runs in this browser, one page at a time — nothing is sent anywhere to do it.`;
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
    const shadow = siteAudit.shadow;
    // Distributions travel with the status read: every discipline section and
    // both Overview charts are drawn from them, so fetching them lazily per
    // section would make the nav's own state chips lag behind the nav.
    const [statusResult, renderStateResult, distributionsResult] = await Promise.all([
      chrome.runtime.sendMessage({ type: 'SITE_AUDIT_STATUS', auditId: siteAudit.auditId }).catch(() => null),
      chrome.runtime.sendMessage({ type: 'SITE_AUDIT_RENDER_STATE', auditId: siteAudit.auditId }).catch(() => null),
      chrome.runtime.sendMessage({ type: 'SITE_AUDIT_DISTRIBUTIONS', auditId: siteAudit.auditId }).catch(() => null)
    ]);
    if (!siteAudit) return; // closeSiteAudit() may have run while the messages were in flight
    const audit = statusResult?.audit;
    siteAudit.renderRunning = Boolean(renderStateResult?.running);
    // Keep the last successful read: a failed refresh must not blank sections
    // that were correctly drawn a moment ago.
    if (distributionsResult?.distributions) siteAudit.distributions = distributionsResult.distributions;
    if (audit) {
      siteAudit.audit = audit;
      const counts = audit.urlCounts || {};
      const linkCounts = audit.linkCounts || {};
      shadow.querySelector('.results-summary').textContent =
        `${audit.status === 'running' ? 'Still running — showing progress so far. ' : ''}${counts.fetched || 0} pages crawled, ${linkCounts.broken || 0} broken links, ${linkCounts.inconclusive || 0} links could not be independently verified, ${audit.findingsCount || 0} findings.`;
      renderSiteAuditRenderSection(audit);
      renderScopeBanner(audit);
      renderCoverageBanner(audit, counts);
      siteAudit.urlCounts = counts;
      siteAudit.totalUrls = urlTotalForStatus(siteAudit.urlsStatus);
      siteAudit.totalLinksByStatus = linkCounts;
    }
    const groupsResult = await chrome.runtime.sendMessage({ type: 'SITE_AUDIT_FINDINGS', auditId: siteAudit.auditId, groupByRule: true }).catch(() => null);
    if (!siteAudit) return;
    if (groupsResult?.groups) siteAudit.rawFindingGroups = groupsResult.groups;
    // The nav's state chips depend on both the audit facts and the finding
    // groups, so they are painted once both have landed.
    renderNavStates();
    if (audit) {
      renderSummaryHeader(groupsResult?.groups || [], audit);
      renderCrawlShape();
    } else {
      // Say so rather than showing zeros: an unreachable audit is a coverage
      // fact about this session, not a site with nothing wrong in it.
      const summaryEl = shadow.querySelector('.results-summary');
      if (summaryEl && !/could not be read/.test(summaryEl.textContent)) {
        summaryEl.textContent = 'The audit record could not be read just now — the figures below are from the last successful read. ' + summaryEl.textContent;
      }
    }
    // A render pass (this browser's own tabs) or a still-running crawl both
    // need live updates while this view is open, even though the crawl-done
    // branch in pollSiteAuditOnce already stopped the original poll timer.
    if (siteAudit.renderRunning || audit?.status === 'running') beginPolling();
    await switchSiteAuditTab(siteAudit.tab || 'findings');
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

  function renderImpactBreakdown(groups) {
    const container = siteAudit.shadow.querySelector('.impact-breakdown');
    container.innerHTML = '';
    const counts = {};
    for (const g of groups) {
      const cls = g.impact_class || 'implementation';
      counts[cls] = (counts[cls] || 0) + g.instances;
    }
    const present = SITE_AUDIT_IMPACT_ORDER.filter((cls) => counts[cls]);
    if (!present.length) { container.hidden = true; return; }
    container.hidden = false;
    for (const cls of present) {
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = `impact-chip${siteAudit.findingsImpactClass === cls ? ' active' : ''}`;
      const count = document.createElement('span');
      count.className = 'ic-count';
      count.textContent = String(counts[cls]);
      const label = document.createElement('span');
      label.className = 'ic-label';
      label.textContent = SITE_AUDIT_IMPACT_LABEL[cls] || cls;
      chip.append(count, label);
      chip.addEventListener('click', () => {
        siteAudit.findingsImpactClass = siteAudit.findingsImpactClass === cls ? '' : cls;
        renderImpactBreakdown(groups);
        switchSiteAuditTab('findings');
      });
      container.appendChild(chip);
    }
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

  /** The factual state readout. Composed server-side by the crawl so every
   * surface reports the same states from the same evidence, rather than each
   * one deriving its own idea of "healthy". */
  function renderAuditSummary(audit) {
    const shadow = siteAudit.shadow;
    const section = shadow.querySelector('.conditions');
    const list = shadow.querySelector('.conditions-list');
    if (!section || !list) return;
    const summary = audit?.stats?.auditSummary;
    const rows = summary?.rows || [];
    if (!rows.length) { section.hidden = true; return; }
    section.hidden = false;
    list.innerHTML = '';
    for (const r of rows) {
      const li = document.createElement('li');
      li.className = 'cond-row';
      li.dataset.state = r.state;
      const evidenceId = `cond-ev-${r.id}`;
      const head = document.createElement('button');
      head.type = 'button';
      head.className = 'cond-head';
      head.setAttribute('aria-expanded', 'false');
      head.setAttribute('aria-controls', evidenceId);
      head.innerHTML = '<span class="cond-mark" aria-hidden="true"></span><span class="cond-label"></span><span class="cond-headline"></span><span class="cond-state"></span>';
      head.querySelector('.cond-label').textContent = r.label;
      head.querySelector('.cond-headline').textContent = r.headline;
      head.querySelector('.cond-state').textContent = CONDITION_STATE_WORD[r.state] || r.state;
      const evidence = document.createElement('ul');
      evidence.className = 'cond-evidence';
      evidence.id = evidenceId;
      evidence.hidden = true;
      for (const line of r.evidence || []) {
        const item = document.createElement('li');
        item.textContent = line;
        evidence.appendChild(item);
      }
      const conf = document.createElement('span');
      conf.className = 'cond-confidence';
      conf.textContent = `Confidence: ${r.confidence}`;
      evidence.appendChild(conf);
      head.addEventListener('click', () => {
        const open = evidence.hidden;
        evidence.hidden = !open;
        head.setAttribute('aria-expanded', String(open));
      });
      li.append(head, evidence);
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

    shadow.querySelector('.sh-pages').textContent = String(fetched);
    shadow.querySelector('.sh-pages-sub').textContent = discovered > fetched ? `of ${discovered} discovered` : 'all discovered pages';
    shadow.querySelector('.sh-findings').textContent = String(findings);
    shadow.querySelector('.sh-findings-sub').textContent = `${groups.length} distinct issue type${groups.length === 1 ? '' : 's'}`;
    shadow.querySelector('.sh-fix').textContent = String(fix);
    // "Fix-category findings" named an internal taxonomy value. A denominator
    // against the total is what the operator actually wants to know.
    shadow.querySelector('.sh-fix-sub').textContent = findings ? `of ${findings} findings` : '';
    shadow.querySelector('.sh-gaps').textContent = String(gaps);
    shadow.querySelector('.sh-gaps-sub').textContent = gaps ? 'pages not fully checked' : 'every page checked';
    // A tile only offers a drill-in when there is something behind it.
    const tileCounts = { crawled: fetched, findings, fix, gaps };
    for (const btn of shadow.querySelectorAll('.stat-open')) {
      btn.disabled = !tileCounts[btn.dataset.open];
    }
    renderSeverityBar(groups);
    renderImpactBreakdown(groups);

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
      const badge = document.createElement('span');
      badge.className = `badge sev-${g.severity || 'info'}`;
      badge.textContent = g.severity || g.category || '';
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
      empty: 'No response was recorded — no URL was fetched.'
    }));
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

  /** Every nav row carries its own state and count. This is the answer to
   * Sitebulb's score dials: the same at-a-glance section triage, with no
   * invented number to be quoted back without its caveats. */
  function renderNavStates() {
    const shadow = siteAudit.shadow;
    const audit = siteAudit.audit || {};
    const counts = audit.urlCounts || {};
    const linkTotal = Object.values(audit.linkCounts || {}).reduce((s, n) => s + Number(n || 0), 0);
    for (const btn of shadow.querySelectorAll('.tab')) {
      const id = btn.dataset.tab;
      const chip = btn.querySelector('.tab-state');
      if (!chip) continue;
      const dot = chip.querySelector('.tab-dot');
      const num = chip.querySelector('.tab-num');
      if (SITE_AUDIT_DISCIPLINE_META[id]) {
        const { state, count } = disciplineState(id);
        chip.hidden = false;
        chip.dataset.state = state;
        dot.hidden = false;
        num.textContent = state === 'unknown' ? '—' : fmtCount(count);
        btn.title = `${SITE_AUDIT_TAB_LABEL[id]} — ${SITE_AUDIT_STATE_WORD[state]}${state === 'unknown' ? '' : `, ${count} established finding${count === 1 ? '' : 's'}`}`;
        continue;
      }
      // Findings, Pages and Links are inventories, not judgements: they carry
      // a count and no state dot, because there is nothing to be "attentive"
      // about in a complete list of what was crawled.
      const plain = { findings: Number(audit.findingsCount || 0), urls: Number(counts.fetched || 0), links: linkTotal }[id];
      if (plain === undefined) { chip.hidden = true; continue; }
      chip.hidden = false;
      delete chip.dataset.state;
      dot.hidden = true;
      num.textContent = fmtCount(plain);
      btn.removeAttribute('title');
    }
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
        tiles: [
          { label: 'Indexable', value: Number(pages.indexable || 0), sub: fetched ? `of ${fetched} fetched pages` : '' },
          { label: 'noindex', value: Number(pages.noindex || 0), sub: 'excluded from search results' },
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
                ['Site-wide block', robots.present === true ? (robots.blocksEverything ? 'Yes — Disallow: / for all agents' : 'No') : null],
                ['Disallow rules', robots.present === true ? robots.disallowCount : null],
                ['Sitemaps declared', robots.present === true ? (robots.sitemaps?.length ? robots.sitemaps.join(', ') : 'None') : null],
                ['Confidence', robots.confidence]
              ]
            })
            : readoutBlock({ title: 'robots.txt', rows: [['Present', 'Not checked in this audit']] })
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
      const signals = siteAudit.audit?.stats?.siteSignals || null;
      const sitemap = signals?.sitemap || null;
      const robots = signals?.robots || null;
      const orphan = ruleInstances(/^seo\.sitemap-orphan/);
      const unreached = ruleInstances(/^seo\.sitemap-unreached/);
      const blocked = ruleInstances(/^seo\.sitemap-blocked-by-robots/);
      const coverage = !signals
        ? { state: 'unknown', text: 'Site signals were not collected for this audit, so the presence of a sitemap was never established.' }
        : sitemap?.present
          ? { state: (orphan || unreached || blocked) ? 'attention' : 'ok', text: `Read <b>${sitemap.urlCount}</b> URL${sitemap.urlCount === 1 ? '' : 's'} from the sitemap and compared them against what the crawl reached.${sitemap.truncated ? ' The sitemap is longer than this audit reads, so the comparison is partial.' : ''}` }
          : { state: 'attention', text: 'No sitemap could be read, so discovery depends entirely on internal linking.' };
      return {
        coverage,
        // With no sitemap read there is nothing to reconcile, and four zero
        // tiles would only restate the coverage line above them.
        tiles: sitemap?.present
          ? [
            { label: 'Sitemap URLs', value: Number(sitemap.urlCount || 0), sub: sitemap.truncated ? 'read up to this audit’s cap' : 'listed by the site' },
            { label: 'Not in the sitemap', value: orphan, sub: 'crawled but unlisted' },
            { label: 'Never reached', value: unreached, sub: 'listed but not crawlable' },
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
                ['Truncated', sitemap.truncated ? 'Yes — longer than this audit reads' : 'No'],
                ['Confidence', sitemap.confidence]
              ]
              : [['Checked', 'No']]
          }),
          readoutBlock({
            title: 'What robots.txt declares',
            rows: robots
              ? [
                ['robots.txt', robots.present === true ? `HTTP ${robots.status}` : robots.present === false ? `Absent (HTTP ${robots.status})` : 'Could not be read'],
                ['Sitemaps listed', robots.sitemaps?.length ? robots.sitemaps.join(', ') : 'None']
              ]
              : [['robots.txt', 'Not checked']]
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
        ? { state: (hsts || frame || mixed || insecureHop || forms) ? 'attention' : 'ok', text: `Taken from the HTTP responses of <b>${fetched}</b> fetched page${fetched === 1 ? '' : 's'}. Header facts are confirmed — no JavaScript can change them. TLS protocol and cipher inspection is not part of this audit.` }
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
        tiles: tiles.map((t) => ({ label: t.label, value: '—', sub: 'not measured yet' })),
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
        : `<b>${pending}</b> never fetched${limitStopped ? ` — the ${limit}-page limit stopped the crawl first` : ''}`);
    }
    if (errored > 0) reasons.push(`<b>${errored}</b> could not be fetched`);
    if (skipped > 0) reasons.push(`<b>${skipped}</b> skipped by robots.txt`);

    const lead = running
      ? `<b>Crawl in progress</b> — <b>${fetched}</b> of <b>${discovered}</b> discovered pages fetched so far.`
      : `<b>Partial crawl</b> — <b>${fetched}</b> of <b>${discovered}</b> discovered pages were fetched.`;
    const tail = running
      ? 'Every count on this screen describes the pages fetched so far, not the whole site.'
      : `Every count on this screen describes those <b>${fetched}</b> page${fetched === 1 ? '' : 's'}, not the whole site.`;
    banner.hidden = false;
    banner.querySelector('.scope-text').innerHTML = `${lead} ${reasons.join('; ')}. ${tail}`;
  }

  function renderCoverageBanner(audit, counts) {
    const banner = siteAudit.shadow.querySelector('.coverage-banner');
    const queued = Number(counts.queued || 0);
    const errored = Number(counts.error || 0);
    const skipped = Number(counts.skipped || 0);
    const rp = audit.renderProgress || { total: 0, rendered: 0 };
    const parts = [];
    if (queued > 0) parts.push(`<span><strong>${queued}</strong> page${queued === 1 ? '' : 's'} still queued (page limit reached before the crawl finished)</span>`);
    if (errored > 0) parts.push(`<span><strong>${errored}</strong> page${errored === 1 ? '' : 's'} could not be fetched</span>`);
    if (skipped > 0) parts.push(`<span><strong>${skipped}</strong> skipped by robots.txt</span>`);
    if (rp.total > 0) parts.push(`<span><strong>${rp.rendered}</strong> of ${rp.total} browser-checked</span>`);
    // Drafting convention: area outside the survey is hatched, never left blank
    // and never coloured as a defect. The hatch is also stated in words, because
    // no graphic in this system carries meaning on its own.
    const fetched = Number(counts.fetched || 0);
    const total = Math.max(1, fetched + queued + errored + skipped);
    const surveyedPct = Math.round((fetched / total) * 100);
    const plan = `<div class="cov-plan" role="img" aria-label="${surveyedPct}% of discovered pages surveyed; the remainder is outside this survey"><div class="cov-surveyed" style="width:${surveyedPct}%"></div><div class="cov-unsurveyed"></div></div>`;
    const note = parts.length ? parts.join('') : '<span>Crawl finished with no coverage gaps.</span>';
    banner.innerHTML = plan + '<div class="cov-note">' + note + '</div>';
    // The crawl composes its own coverage sentences (unverifiable destinations,
    // truncated sitemaps). They are appended as text nodes: these strings carry
    // host names and other crawl output, and must never be interpolated as markup.
    const noteBox = banner.querySelector('.cov-note');
    for (const line of audit?.stats?.auditSummary?.coverage || []) {
      if (/still queued/i.test(line)) continue; // already stated by the queued part above
      const span = document.createElement('span');
      span.textContent = line;
      noteBox.appendChild(span);
    }
  }

  async function switchSiteAuditTab(tab) {
    siteAudit.tab = tab;
    const shadow = siteAudit.shadow;
    const discipline = Boolean(SITE_AUDIT_DISCIPLINE_META[tab]);
    for (const btn of shadow.querySelectorAll('.tab')) btn.classList.toggle('active', btn.dataset.tab === tab);
    for (const panel of shadow.querySelectorAll('.tab-panel')) {
      panel.hidden = discipline ? !panel.classList.contains('section-panel') : !panel.classList.contains(`${tab}-panel`);
    }
    // A section can be several screens tall. Arriving at one already scrolled
    // to where the previous section happened to be is disorienting.
    const main = shadow.querySelector('.view-results .main');
    if (main) main.scrollTop = 0;
    if (discipline) {
      // The groups are the section's contents, so a section opened before the
      // first findings read lands fetches them rather than rendering empty.
      if (!siteAudit.rawFindingGroups) await loadSiteAuditFindings({ silent: true });
      if (!siteAudit) return;
      return renderDisciplineSection(tab);
    }
    if (tab === 'findings') { shadow.querySelector('.findings-search').value = siteAudit.findingsSearch; return loadSiteAuditFindings(); }
    if (tab === 'urls') return loadSiteAuditUrls();
    if (tab === 'links') { shadow.querySelector('.links-status').value = siteAudit.linksStatus; return loadSiteAuditLinks(); }
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

  function renderFindingsList() {
    const list = siteAudit.shadow.querySelector('.findings-list');
    list.innerHTML = '';
    const search = String(siteAudit.findingsSearch || '').trim().toLowerCase();
    const category = siteAudit.findingsCategory;
    const impactClass = siteAudit.findingsImpactClass;
    const all = siteAudit.rawFindingGroups || [];
    // Search now covers the human title too — the old placeholder promised
    // "rule or text" while only ever matching the rule id.
    const groups = all.filter((g) =>
      (!search || g.rule_id.toLowerCase().includes(search) || findingLabel(g).toLowerCase().includes(search)) &&
      (!category || g.category === category) &&
      (!impactClass || (g.impact_class || 'implementation') === impactClass) &&
      (!siteAudit.findingsHideUnconfirmed || g.confidence === 'confirmed')
    );
    const SEV_RANK = { critical: 0, high: 1, medium: 2, low: 3, info: 4 };
    const sort = siteAudit.findingsSort || 'severity';
    groups.sort((a, b) => {
      if (sort === 'pages') return (b.affected_urls || 0) - (a.affected_urls || 0);
      if (sort === 'instances') return (b.instances || 0) - (a.instances || 0);
      if (sort === 'area') return String(a.impact_class || '').localeCompare(String(b.impact_class || '')) || (b.affected_urls || 0) - (a.affected_urls || 0);
      // Severity first, then breadth — a high on forty pages outranks a high on one.
      return (SEV_RANK[a.severity] ?? 9) - (SEV_RANK[b.severity] ?? 9) || (b.affected_urls || 0) - (a.affected_urls || 0);
    });
    renderFilterState(groups.length, all.length);
    renderFindingRowsInto(list, groups, all.length ? 'No findings match these filters.' : 'No findings recorded yet.');
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
      const badge = document.createElement('span');
      badge.className = `badge sev-${g.severity || 'info'}`;
      badge.textContent = g.severity || g.category || '';
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

  function renderFilterState(shown, total) {
    const shadow = siteAudit.shadow;
    const active = Boolean(siteAudit.findingsSearch || siteAudit.findingsCategory || siteAudit.findingsImpactClass || siteAudit.findingsHideUnconfirmed);
    shadow.querySelector('.chip-clear').hidden = !active;
    shadow.querySelector('.filter-state').textContent = active ? `Showing ${shown} of ${total} issue types` : '';
  }

  function clearFindingFilters() {
    siteAudit.findingsSearch = '';
    siteAudit.findingsCategory = '';
    siteAudit.findingsImpactClass = '';
    siteAudit.findingsHideUnconfirmed = false;
    const shadow = siteAudit.shadow;
    shadow.querySelector('.findings-search').value = '';
    shadow.querySelector('.findings-category').value = '';
    shadow.querySelector('.findings-hide-unconfirmed').checked = false;
    renderImpactBreakdown(siteAudit.rawFindingGroups || []);
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
  function urlTotalForScope({ statuses = '', depth = null, httpClass = '' } = {}) {
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
    return totals.length ? Math.min(...totals) : all;
  }

  /** Kept for the callers that only ever narrow by crawl state. */
  function urlTotalForStatus(status) {
    return urlTotalForScope({ statuses: status || '' });
  }

  function currentUrlScope() {
    return { statuses: siteAudit.urlsStatus || '', depth: siteAudit.urlsDepth ?? null, httpClass: siteAudit.urlsHttpClass || '' };
  }

  function renderScopedNote() {
    const note = siteAudit.shadow.querySelector('.scoped-note');
    if (!note) return;
    const scope = currentUrlScope();
    const active = Boolean(scope.statuses || scope.depth !== null || scope.httpClass);
    if (!active) { note.hidden = true; return; }
    const total = urlTotalForScope(scope);
    const copy = scope.statuses && scope.depth === null && !scope.httpClass ? URL_STATUS_SCOPE_COPY[scope.statuses] : null;
    let text;
    if (copy) text = copy(total);
    else if (scope.depth !== null && !scope.statuses && !scope.httpClass) {
      text = Number(scope.depth) === 0
        ? `Showing the <b>${total}</b> page${total === 1 ? '' : 's'} the crawl started from, including everything the sitemap named.`
        : `Showing the <b>${total}</b> page${total === 1 ? '' : 's'} discovered <b>${Number(scope.depth)}</b> link hop${Number(scope.depth) === 1 ? '' : 's'} from the start URL.`;
    } else if (scope.httpClass && !scope.statuses && scope.depth === null) {
      // The class id is one of four fixed literals, never crawl output.
      text = `Showing the <b>${total}</b> page${total === 1 ? '' : 's'} that answered <b>${scope.httpClass}</b>.`;
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
      ...(scope.httpClass ? { httpClass: scope.httpClass } : {})
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
  function openUrlsScoped({ statuses = '', depth = null, httpClass = '' } = {}) {
    siteAudit.urlsStatus = statuses || '';
    siteAudit.urlsDepth = depth === null || depth === '' ? null : Number(depth);
    siteAudit.urlsHttpClass = httpClass || '';
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

  function renderUrlsTable() {
    const shadow = siteAudit.shadow;
    const body = shadow.querySelector('.urls-body');
    renderSectionIndex();
    for (const th of shadow.querySelectorAll('.urls-panel th[data-sort]')) {
      th.classList.toggle('sorted-asc', th.dataset.sort === siteAudit.urlsSort.key && siteAudit.urlsSort.dir === 'asc');
      th.classList.toggle('sorted-desc', th.dataset.sort === siteAudit.urlsSort.key && siteAudit.urlsSort.dir === 'desc');
    }
    const search = String(siteAudit.urlsSearch || '').trim().toLowerCase();
    const sortValue = (u, key) => key === 'status' ? (u.http_status || u.status || '') : key === 'schema' ? (u.schema_types || '') : (u[key] || '');
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
      let schemaLabel = '—';
      try { const types = JSON.parse(u.schema_types || '[]'); if (types.length) schemaLabel = types.join(', '); } catch {}
      const tr = siteAuditRow([shortUrl(u.url), '', u.title || '', u.word_count ?? '—', schemaLabel], { mono: [0] });
      tr.cells[0].title = u.url;
      // Status carries a pill so a 404 among two hundred 200s is findable
      // by scanning rather than by reading every row.
      const code = Number(u.http_status || 0);
      const tone = !code ? 'inconclusive' : code >= 200 && code < 400 ? 'healthy' : 'broken';
      const statusPill = document.createElement('span');
      statusPill.className = `status-pill ${tone}`;
      statusPill.textContent = code ? String(code) : (u.status || '—');
      tr.cells[1].textContent = '';
      tr.cells[1].className = 'col-status';
      tr.cells[1].appendChild(statusPill);
      tr.classList.add('row-expand');
      tr.addEventListener('click', () => toggleUrlDetail(u.url, tr));
      body.appendChild(tr);
      if (siteAudit.expandedUrl === u.url) body.appendChild(buildUrlDetailRow(u.url, 5));
    }
    const shown = siteAudit.rawUrls?.length || 0;
    const from = shown ? siteAudit.urlsOffset + 1 : 0;
    const to = siteAudit.urlsOffset + shown;
    shadow.querySelector('.urls-label').textContent = siteAudit.totalUrls ? `${from}–${to} of ${siteAudit.totalUrls}` : '';
    shadow.querySelector('.urls-prev').disabled = siteAudit.urlsOffset === 0;
    shadow.querySelector('.urls-next').disabled = to >= siteAudit.totalUrls || shown < SITE_AUDIT_PAGE_SIZE;
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
          li.textContent = `${f.rule_id} — ${f.title || ''}`;
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

  /** Status filters that carry their own counts, so the 126 broken links are
   * one click away instead of buried under a thousand healthy ones. */
  function renderLinkStatusChips() {
    const wrap = siteAudit.shadow.querySelector('.status-chips');
    if (!wrap) return;
    const totals = siteAudit.totalLinksByStatus || {};
    const all = Object.values(totals).reduce((n, v) => n + Number(v || 0), 0);
    wrap.innerHTML = '';
    const entries = [['', 'All links', all], ...LINK_STATUS_ORDER.map(([k, label]) => [k, label, Number(totals[k] || 0)])];
    for (const [value, label, count] of entries) {
      if (value && !count) continue; // never offer a filter that returns nothing
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'chip status-chip' + (siteAudit.linksStatus === value ? ' active' : '');
      b.dataset.status = value;
      b.setAttribute('aria-pressed', String(siteAudit.linksStatus === value));
      b.innerHTML = '<span></span><b></b>';
      b.querySelector('span').textContent = label;
      b.querySelector('b').textContent = String(count);
      b.addEventListener('click', () => {
        siteAudit.linksStatus = value;
        siteAudit.linksOffset = 0;
        const select = siteAudit.shadow.querySelector('.links-status');
        if (select) select.value = value;
        loadSiteAuditLinks();
      });
      wrap.appendChild(b);
    }
  }

  function renderLinksTable() {
    const shadow = siteAudit.shadow;
    const body = shadow.querySelector('.links-body');
    const search = String(siteAudit.linksSearch || '').trim().toLowerCase();
    const rows = (siteAudit.rawLinks || []).filter((l) => !search || l.source_url.toLowerCase().includes(search) || l.target_url.toLowerCase().includes(search) || (l.anchor_text || '').toLowerCase().includes(search));
    body.innerHTML = '';
    renderLinkStatusChips();
    let lastSource = null;
    for (const l of rows) {
      const repeated = l.source_url === lastSource;
      lastSource = l.source_url;
      const tr = siteAuditRow([repeated ? '' : shortUrl(l.source_url), shortUrl(l.target_url), l.anchor_text || '—'], { mono: [0, 1] });
      // A run of links from one page reads as one block instead of the same
      // URL restated fifteen times.
      if (repeated) tr.classList.add('link-same-source');
      tr.cells[0].title = l.source_url;
      tr.cells[1].title = l.target_url;
      const statusTd = document.createElement('td');
      statusTd.className = 'col-status';
      const pill = document.createElement('span');
      pill.className = `status-pill ${l.status}`;
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

  async function downloadFullReport() {
    const btn = siteAudit.shadow.querySelector('.report-btn');
    btn.disabled = true;
    try {
      const r = await chrome.runtime.sendMessage({ type: 'SITE_AUDIT_REPORT', auditId: siteAudit.auditId }).catch((error) => ({ ok: false, error: error?.message }));
      if (!r?.ok) return;
      const blob = new Blob([r.html], { type: 'text/html;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = r.filename || `audit-report.html`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 4000);
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
      const blob = new Blob([r.json], { type: 'application/json;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = r.filename || 'audit-debug.json';
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 4000);
    } finally {
      btn.disabled = false;
    }
  }

  async function exportSiteAudit(dataset) {
    const r = await chrome.runtime.sendMessage({ type: 'SITE_AUDIT_EXPORT', auditId: siteAudit.auditId, dataset }).catch((error) => ({ ok: false, error: error?.message }));
    if (!r?.ok) return;
    const blob = new Blob([r.text], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = r.filename || `audit-${dataset}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
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
