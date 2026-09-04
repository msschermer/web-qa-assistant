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
    return ":host{\n  all:initial;\n  /* Grounds, darkest to lightest. The backdrop is what the overlay dims the\n     host page to; canvas is the app field; surface is a card. */\n  --wqa-backdrop:#07070B;\n  --wqa-canvas:#0E0E14;\n  --wqa-surface:#15151E;\n  --wqa-surface-raised:#22222E;\n  --wqa-sunken:#1B1B25;        /* table heads, inset rows, hover */\n\n  --wqa-ink:#E9E9F2;           /* 15.0:1 on surface */\n  --wqa-ink-soft:#A8A8BD;      /* 7.8:1 */\n  --wqa-ink-faint:#8B8BA3;     /* 5.5:1 — the floor, do not darken */\n  --wqa-line:#2E2E3D;          /* hairline between rows */\n  --wqa-line-strong:#3A3A4C;   /* control borders, panel edges */\n\n  /* One primary. White clears 4.5:1 on it, which is why it is this violet and\n     not the brighter one: every lighter candidate fails its own button. Hover\n     deepens rather than lightens, for the same reason. */\n  --wqa-brand:#7350F5;\n  --wqa-brand-strong:#6741E8;\n  --wqa-brand-soft:#1E1838;\n  --wqa-brand-line:#3A2E6B;\n  --wqa-brand-text:#A896FF;    /* the primary as text, 7.3:1 on surface */\n  --wqa-accent:#7350F5;\n  --wqa-accent-strong:#6741E8;\n  --wqa-accent-soft:#1E1838;\n  --wqa-violet:#7350F5;\n  --wqa-violet-soft:#1E1838;\n\n  /* Semantic TEXT colours: safe on their own wash and on every ground. */\n  --wqa-critical:#FF6B78;\n  --wqa-critical-soft:#2A1418;\n  --wqa-warn:#F0A93A;\n  --wqa-warn-soft:#2A1F0F;\n  --wqa-ok:#45D68F;\n  --wqa-ok-soft:#0F2419;\n  --wqa-info:#A896FF;\n  --wqa-info-soft:#1E1838;\n  --wqa-muted:#8B8BA3;\n\n  /* Severity ramp: fills for bars, rails and dots. Not text on a tint. */\n  --wqa-sev-critical:#E14356;\n  --wqa-sev-high:#FF5C6C;\n  --wqa-sev-medium:#F0A93A;\n  --wqa-sev-low:#D8873C;\n  --wqa-sev-info:#7A7A94;\n\n  --wqa-focus:#7350F5;\n\n  --wqa-r-xs:6px;\n  --wqa-r-sm:8px;\n  --wqa-r:10px;\n  --wqa-r-lg:14px;\n  --wqa-r-pill:999px;\n\n  /* On a dark ground a drop shadow reads as smudge, so elevation is carried by\n     the ground stepping lighter and by a hairline. These stay for the few\n     elements that genuinely float above the surface. */\n  --wqa-shadow:0 1px 2px rgba(0,0,0,.40);\n  --wqa-shadow-md:0 2px 6px rgba(0,0,0,.45),0 1px 2px rgba(0,0,0,.35);\n  --wqa-shadow-lg:0 28px 64px -16px rgba(0,0,0,.72);\n\n  --wqa-space-1:4px;\n  --wqa-space-2:8px;\n  --wqa-space-3:12px;\n  --wqa-space-4:16px;\n  --wqa-space-5:24px;\n\n  /* IBM Plex Sans and its own monospace sibling, self-hosted (packages/ui/\n     fonts.css). The stack behind them is load-bearing, not decoration: the\n     overlay is injected into third-party pages whose CSP we do not control, so\n     every surface must stay legible when the face does not arrive. */\n  --wqa-sans:'IBM Plex Sans',system-ui,-apple-system,'Segoe UI',Roboto,'Helvetica Neue',sans-serif;\n  --wqa-draw:var(--wqa-sans);\n  --wqa-mono:'IBM Plex Mono',ui-monospace,SFMono-Regular,'SF Mono',Menlo,Consolas,monospace;\n\n  /* Coverage still hatches what was not surveyed: not knowing is not the same\n     as being broken, and that distinction stays visual. Light-on-dark now. */\n  --wqa-hatch:repeating-linear-gradient(45deg,transparent 0 6px,rgba(233,233,242,.07) 6px 7px);\n  --wqa-grain:none;\n\n  --wqa-paper:var(--wqa-canvas);--wqa-surface-strong:var(--wqa-surface-raised);--wqa-rule:var(--wqa-line-strong);--wqa-rule-soft:var(--wqa-line);--wqa-blue:var(--wqa-brand);--wqa-blue-wash:var(--wqa-brand-soft);--wqa-live:var(--wqa-ok);--wqa-danger:var(--wqa-critical);--wqa-warning:var(--wqa-warn);--wqa-radius:var(--wqa-r);\n\n  --f-brand:var(--wqa-ink);\n  --f-brand-ink:var(--wqa-brand-strong);\n  --f-accent:var(--wqa-brand);\n  --f-accent-soft:var(--wqa-brand-soft);\n  --f-ink:var(--wqa-ink);\n  --f-ink-soft:var(--wqa-ink-soft);\n  --f-ink-faint:var(--wqa-ink-faint);\n  --f-line:var(--wqa-line);\n  --f-line-strong:var(--wqa-line-strong);\n  --f-surface:var(--wqa-surface);\n  --f-sunken:var(--wqa-sunken);\n  --f-ok:var(--wqa-ok);\n  --f-ok-soft:var(--wqa-ok-soft);\n  --f-warn:var(--wqa-warn);\n  --f-warn-soft:var(--wqa-warn-soft);\n  --f-critical:var(--wqa-critical);\n  --f-critical-soft:var(--wqa-critical-soft);\n  --f-sans:var(--wqa-sans);\n  --f-mono:var(--wqa-mono);\n}\n*{box-sizing:border-box}\n.backdrop{position:fixed;inset:0;background:rgba(7,7,11,.78);z-index:2147483644;pointer-events:none;transition:opacity .18s ease,background .18s ease}\n.backdrop[data-soft=\"true\"]{background:rgba(7,7,11,.6);backdrop-filter:blur(1.5px)}\n.spotlight{position:fixed;z-index:2147483645;border:2px solid rgba(255,255,255,.96);border-radius:6px;box-shadow:0 0 0 99999px rgba(7,7,11,.78),0 0 0 5px rgba(115,80,245,.34);pointer-events:none;transition:top .16s ease,left .16s ease,width .16s ease,height .16s ease}\n\n.coach{position:fixed;z-index:2147483647;display:flex;flex-direction:column;width:min(468px,calc(100vw - 28px));max-height:min(78vh,760px);background:var(--f-surface);color:var(--f-ink);border:1px solid var(--f-line-strong);border-radius:12px;box-shadow:0 22px 56px rgba(0,0,0,.5),0 3px 10px rgba(0,0,0,.35);font-family:var(--f-sans);pointer-events:auto;overflow:hidden}\n.accent{height:3px;flex:none;background:var(--f-ink)}\n\n.top{display:flex;align-items:center;gap:10px;padding:13px 16px 11px;flex:none;background:var(--f-surface);border-bottom:1px solid var(--f-line)}\n.mark{display:block;width:28px;height:28px;border-radius:50%;background:radial-gradient(circle at 50% 50%,transparent 31%,var(--f-brand) 33%,var(--f-brand) 46%,transparent 48%);color:transparent;font-size:0;flex:none}\n.identity{display:grid;gap:1px;min-width:0}\n.name{font:650 13px/1.15 var(--f-sans);color:var(--f-ink);letter-spacing:-.005em}\n.device{font:500 11px/1.2 var(--f-sans);color:var(--f-ink-faint)}\n.verdict{margin-left:auto;display:inline-flex;align-items:center;gap:5px;border-radius:2px;padding:3px 9px;font:600 11px/1.5 var(--f-sans);background:var(--f-ok-soft);color:var(--f-ok);white-space:nowrap}\n.verdict[data-status=\"review\"]{background:var(--f-warn-soft);color:var(--f-warn)}\n.verdict[data-status=\"context\"]{background:var(--f-sunken);color:var(--f-ink-faint)}\n.verdict::before{content:\"\";width:6px;height:6px;border-radius:50%;background:currentColor;flex:none}\n.progress{font:550 11px/1 var(--f-sans);color:var(--f-ink-faint);font-variant-numeric:tabular-nums;white-space:nowrap;margin-left:auto}\n.verdict[hidden]+.progress{margin-left:auto}\n\n.rail{display:flex;gap:4px;padding:9px 16px 10px;flex:none;border-bottom:1px solid var(--f-line);background:var(--f-surface);overflow-x:auto;scrollbar-width:none}\n.rail::-webkit-scrollbar{display:none}\n.rail button{flex:1 1 0;min-width:56px;border:0;background:transparent;padding:0;cursor:pointer;text-align:left;font:inherit}\n.rail button i{display:block;height:3px;border-radius:2px;background:var(--f-line-strong);transition:background .15s ease}\n.rail button b{display:block;margin-top:5px;font:550 11px/1.2 var(--f-sans);color:var(--f-ink-faint);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}\n.rail button[data-state=\"done\"] i{background:var(--f-accent)}\n.rail button[data-state=\"current\"] i{background:var(--f-brand);height:4px}\n.rail button[data-state=\"current\"] b{color:var(--f-brand);font-weight:650}\n.rail button[data-role=\"remediation\"] b,.rail button[data-role=\"verification\"] b{font-weight:650}\n.rail button:hover b{color:var(--f-ink-soft)}\n\n.scroll{overflow:auto;overscroll-behavior:contain;padding:0 0 2px}\n.body{padding:15px 17px 4px}\n.eyebrow{display:none}\nh2{margin:0 0 8px;color:var(--f-ink);font:650 19px/1.26 var(--f-sans);letter-spacing:-.014em}\np{font:14.5px/1.55 var(--f-sans);margin:0;color:var(--f-ink-soft)}\n\n.anchor{margin:13px 17px 0;border:1px solid var(--f-line);border-radius:8px;background:var(--f-sunken);padding:10px 12px}\n.anchor[data-tone=\"located\"]{border-color:rgba(115,80,245,.28);background:var(--f-accent-soft)}\n.anchor[data-tone=\"missing\"]{border-color:rgba(240,169,58,.35);background:var(--f-warn-soft)}\n.anchor-head{display:flex;align-items:center;gap:7px;font:650 11px/1.3 var(--f-sans);letter-spacing:.06em;text-transform:uppercase;color:var(--f-ink-soft)}\n.anchor[data-tone=\"located\"] .anchor-head{color:var(--f-accent)}\n.anchor[data-tone=\"missing\"] .anchor-head{color:var(--f-warn)}\n.anchor-head::before{content:\"\";width:7px;height:7px;border-radius:50%;background:currentColor;flex:none}\n.anchor-note{margin:6px 0 0;font:12.75px/1.5 var(--f-sans);color:var(--f-ink-soft)}\n.anchor-selector{display:block;margin-top:7px;padding:6px 8px;border-radius:8px;background:rgba(233,233,242,.72);border:1px solid var(--f-line);font:11px/1.45 var(--f-mono);color:var(--f-ink);overflow-wrap:anywhere}\n.anchor-actions{display:flex;gap:6px;flex-wrap:wrap;margin-top:8px}\n.mini{border:1px solid var(--f-line-strong);border-radius:8px;background:var(--f-surface);color:var(--f-ink-soft);padding:4px 9px;font:550 11.5px/1.3 var(--f-sans);cursor:pointer}\n.mini:hover{background:var(--f-sunken);color:var(--f-ink)}\n\n.metrics{display:grid;grid-template-columns:repeat(auto-fit,minmax(132px,1fr));gap:6px;margin:10px 17px 0;padding:0}\n.metric{border:1px solid var(--f-line);border-radius:8px;background:var(--f-sunken);padding:7px 9px;min-width:0}\n.metric dt{margin:0;font:550 11px/1.3 var(--f-sans);color:var(--f-ink-faint);overflow-wrap:anywhere}\n.metric dd{margin:2px 0 0;font:600 12.5px/1.35 var(--f-mono);color:var(--f-ink);overflow-wrap:anywhere}\n\n.code{margin:10px 17px 0}\n.code-head{display:flex;align-items:center;justify-content:space-between;gap:9px;padding:6px 10px;border:1px solid var(--f-line);border-bottom:0;border-radius:12px 8px 0 0;background:var(--f-sunken);font:650 11px/1.3 var(--f-sans);color:var(--f-ink-faint)}\n.code pre{margin:0;padding:9px 10px;border:1px solid var(--f-line);border-radius:0 0 8px 8px;background:var(--wqa-canvas);color:var(--wqa-ink);font:11px/1.55 var(--f-mono);white-space:pre-wrap;overflow-wrap:anywhere;max-height:140px;overflow:auto}\n\n.sources{display:flex;align-items:center;gap:6px;flex-wrap:wrap;margin:10px 17px 0;padding-top:9px;border-top:1px solid var(--f-line)}\n.sources span{border-radius:2px;background:var(--f-sunken);color:var(--f-ink-soft);padding:2px 8px;font:550 11px/1.5 var(--f-sans)}\n.sources em{font-style:normal;color:var(--f-ink-faint);font:11px/1.5 var(--f-sans)}\n\n.state{margin:11px 17px 0;font:12.5px/1.5 var(--f-sans);color:var(--f-accent)}\n.state[data-kind=\"error\"]{color:var(--f-critical)}\n\n.foot{display:flex;align-items:center;gap:8px;padding:12px 17px 14px;flex:none;border-top:1px solid var(--f-line);background:var(--f-surface);flex-wrap:wrap}\n.nav{border:1px solid var(--f-line-strong);border-radius:12px;background:var(--f-surface);color:var(--f-ink);padding:8px 14px;font:550 12.5px/1.2 var(--f-sans);cursor:pointer;transition:background .12s ease,border-color .12s ease}\n.nav:hover:not(:disabled){background:var(--f-sunken);border-color:var(--f-ink-faint)}\n.nav:disabled{opacity:.42;cursor:default}\n.ghost{color:var(--f-accent);border-color:rgba(115,80,245,.34);background:var(--f-accent-soft)}\n.ghost:hover:not(:disabled){background:var(--wqa-ok);border-color:var(--f-accent)}\n.next{margin-left:auto;background:var(--f-brand);border-color:var(--f-brand-ink);color:#fff}\n.next:hover:not(:disabled){background:var(--f-brand-ink)}\n.return-qa{width:100%;order:3;background:var(--f-brand);border-color:var(--f-brand-ink);color:#fff;font-weight:650}\n.return-qa:hover:not(:disabled){background:var(--f-brand-ink);border-color:var(--f-brand-ink);color:#fff}\n.nav:focus-visible,.mini:focus-visible,.rail button:focus-visible{outline:2px solid var(--f-accent);outline-offset:2px}\n\n@media(max-width:560px){.coach{width:calc(100vw - 20px);border-radius:12px;max-height:82vh}.body{padding:13px 14px 4px}.anchor,.metrics,.code,.sources,.state{margin-left:14px;margin-right:14px}.foot{padding:11px 14px 12px}h2{font-size:17.5px}}\n@media(prefers-reduced-motion:reduce){.spotlight,.backdrop,.nav,.rail button i{transition:none}}\n";
  }

  /** The @font-face rules from packages/ui/fonts.css, injected at build time
   * with `__LUMEN_FONT_BASE__` still in them so the runtime can resolve the
   * extension's own URL. */
  function lumenFontFaceTemplate() {
    return "/* Lumen's typeface, self-hosted.\n   ------------------------------------------------------------------------\n   IBM Plex Sans and IBM Plex Mono, SIL OFL 1.1 (see fonts/OFL.txt). One\n   superfamily rather than two unrelated ones: the mono is the sans's own\n   sibling, so a rule id sitting next to a sentence is the same voice at a\n   different width.\n\n   Self-hosted rather than fetched from a font CDN, deliberately. Lumen audits\n   sites for third-party requests and privacy exposure; a tool that does that\n   while phoning a font CDN on every page load is not one a consultant should\n   trust. Self-hosting also means the extension works offline and the exported\n   client report renders correctly on a plane.\n\n   The sans is the variable build (400–700 on the weight axis), which is what\n   makes the design system's 650 weight a real weight rather than a synthetic\n   bold rounded to 700.\n\n   `__LUMEN_FONT_BASE__` is replaced per delivery path — see The Three\n   Delivery Paths Rule in DESIGN.md. Nothing here may be the only copy of a\n   src: the fallback stack in tokens.css carries every surface where the font\n   cannot load. */\n\n@font-face {\n  font-family: 'IBM Plex Sans';\n  font-style: normal;\n  font-weight: 400 700;\n  font-display: swap;\n  src: url(__LUMEN_FONT_BASE__ibm-plex-sans-latin.woff2) format('woff2');\n  unicode-range: U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD;\n}\n@font-face {\n  font-family: 'IBM Plex Sans';\n  font-style: normal;\n  font-weight: 400 700;\n  font-display: swap;\n  src: url(__LUMEN_FONT_BASE__ibm-plex-sans-latin-ext.woff2) format('woff2');\n  unicode-range: U+0100-02BA, U+02BD-02C5, U+02C7-02CC, U+02CE-02D7, U+02DD-02FF, U+0304, U+0308, U+0329, U+1D00-1DBF, U+1E00-1E9F, U+1EF2-1EFF, U+2020, U+20A0-20AB, U+20AD-20C0, U+2113, U+2C60-2C7F, U+A720-A7FF;\n}\n@font-face {\n  font-family: 'IBM Plex Mono';\n  font-style: normal;\n  font-weight: 400;\n  font-display: swap;\n  src: url(__LUMEN_FONT_BASE__ibm-plex-mono-400-latin.woff2) format('woff2');\n  unicode-range: U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD;\n}\n@font-face {\n  font-family: 'IBM Plex Mono';\n  font-style: normal;\n  font-weight: 600;\n  font-display: swap;\n  src: url(__LUMEN_FONT_BASE__ibm-plex-mono-600-latin.woff2) format('woff2');\n  unicode-range: U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD;\n}\n";
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
    return "/* Grounds, darkest to lightest. The backdrop is what the overlay dims the\n     host page to; canvas is the app field; surface is a card. */\n  --wqa-backdrop:#07070B;\n  --wqa-canvas:#0E0E14;\n  --wqa-surface:#15151E;\n  --wqa-surface-raised:#22222E;\n  --wqa-sunken:#1B1B25;        /* table heads, inset rows, hover */\n\n  --wqa-ink:#E9E9F2;           /* 15.0:1 on surface */\n  --wqa-ink-soft:#A8A8BD;      /* 7.8:1 */\n  --wqa-ink-faint:#8B8BA3;     /* 5.5:1 — the floor, do not darken */\n  --wqa-line:#2E2E3D;          /* hairline between rows */\n  --wqa-line-strong:#3A3A4C;   /* control borders, panel edges */\n\n  /* One primary. White clears 4.5:1 on it, which is why it is this violet and\n     not the brighter one: every lighter candidate fails its own button. Hover\n     deepens rather than lightens, for the same reason. */\n  --wqa-brand:#7350F5;\n  --wqa-brand-strong:#6741E8;\n  --wqa-brand-soft:#1E1838;\n  --wqa-brand-line:#3A2E6B;\n  --wqa-brand-text:#A896FF;    /* the primary as text, 7.3:1 on surface */\n  --wqa-accent:#7350F5;\n  --wqa-accent-strong:#6741E8;\n  --wqa-accent-soft:#1E1838;\n  --wqa-violet:#7350F5;\n  --wqa-violet-soft:#1E1838;\n\n  /* Semantic TEXT colours: safe on their own wash and on every ground. */\n  --wqa-critical:#FF6B78;\n  --wqa-critical-soft:#2A1418;\n  --wqa-warn:#F0A93A;\n  --wqa-warn-soft:#2A1F0F;\n  --wqa-ok:#45D68F;\n  --wqa-ok-soft:#0F2419;\n  --wqa-info:#A896FF;\n  --wqa-info-soft:#1E1838;\n  --wqa-muted:#8B8BA3;\n\n  /* Severity ramp: fills for bars, rails and dots. Not text on a tint. */\n  --wqa-sev-critical:#E14356;\n  --wqa-sev-high:#FF5C6C;\n  --wqa-sev-medium:#F0A93A;\n  --wqa-sev-low:#D8873C;\n  --wqa-sev-info:#7A7A94;\n\n  --wqa-focus:#7350F5;\n\n  --wqa-r-xs:6px;\n  --wqa-r-sm:8px;\n  --wqa-r:10px;\n  --wqa-r-lg:14px;\n  --wqa-r-pill:999px;\n\n  /* On a dark ground a drop shadow reads as smudge, so elevation is carried by\n     the ground stepping lighter and by a hairline. These stay for the few\n     elements that genuinely float above the surface. */\n  --wqa-shadow:0 1px 2px rgba(0,0,0,.40);\n  --wqa-shadow-md:0 2px 6px rgba(0,0,0,.45),0 1px 2px rgba(0,0,0,.35);\n  --wqa-shadow-lg:0 28px 64px -16px rgba(0,0,0,.72);\n\n  --wqa-space-1:4px;\n  --wqa-space-2:8px;\n  --wqa-space-3:12px;\n  --wqa-space-4:16px;\n  --wqa-space-5:24px;\n\n  /* IBM Plex Sans and its own monospace sibling, self-hosted (packages/ui/\n     fonts.css). The stack behind them is load-bearing, not decoration: the\n     overlay is injected into third-party pages whose CSP we do not control, so\n     every surface must stay legible when the face does not arrive. */\n  --wqa-sans:'IBM Plex Sans',system-ui,-apple-system,'Segoe UI',Roboto,'Helvetica Neue',sans-serif;\n  --wqa-draw:var(--wqa-sans);\n  --wqa-mono:'IBM Plex Mono',ui-monospace,SFMono-Regular,'SF Mono',Menlo,Consolas,monospace;\n\n  /* Coverage still hatches what was not surveyed: not knowing is not the same\n     as being broken, and that distinction stays visual. Light-on-dark now. */\n  --wqa-hatch:repeating-linear-gradient(45deg,transparent 0 6px,rgba(233,233,242,.07) 6px 7px);\n  --wqa-grain:none;\n\n  --wqa-paper:var(--wqa-canvas);--wqa-surface-strong:var(--wqa-surface-raised);--wqa-rule:var(--wqa-line-strong);--wqa-rule-soft:var(--wqa-line);--wqa-blue:var(--wqa-brand);--wqa-blue-wash:var(--wqa-brand-soft);--wqa-live:var(--wqa-ok);--wqa-danger:var(--wqa-critical);--wqa-warning:var(--wqa-warn);--wqa-radius:var(--wqa-r);";
  }

  function siteAuditCss() {
    return `
      :host{all:initial;
        /* Lumen Site Audit — the category standard, executed straight.
           Reference bar: Sitebulb's density and severity discipline, Semrush's
           polish and colour confidence. Light theme only, by decision.

           Every value below is an alias of packages/ui/tokens.css, which is
           injected directly above them. Nothing here may name a colour of its
           own: a second definition is how the ramp drifted the first time. */
        ${lumenTokens()}

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
         actually puts Lumen's face on the overlay. */
      *{box-sizing:border-box;font-family:var(--sa-sans)}
      [hidden]{display:none!important}
      .backdrop{position:fixed;inset:0;background:rgba(7,7,11,.72);z-index:1;backdrop-filter:blur(2px)}

      .workspace{position:fixed;inset:24px;z-index:2;background:var(--sa-canvas);border-radius:12px;box-shadow:var(--sa-shadow-lg);display:flex;flex-direction:column;overflow:hidden;color:var(--sa-ink)}

      /* Top bar ------------------------------------------------------------ */
      .head{display:flex;align-items:center;gap:12px;padding:0 16px;height:56px;background:var(--sa-surface);border-bottom:1px solid var(--sa-line);flex:0 0 auto}
      .mark{display:block;flex:0 0 auto;width:26px;height:26px;border-radius:8px;background:var(--sa-primary);position:relative}
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
      .tab.active{background:var(--sa-primary-soft);color:var(--sa-primary-text);font-weight:600}
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
      .run-progress .progress-bar{margin:0}
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

      /* Scan progress -------------------------------------------------------
         The screen an operator watches, so it answers "what is happening right
         now" before it answers anything else: phase, rate, and the URL in
         flight. Nothing here is a summary; summaries are the results view. */
      .panel-title{margin:0 0 14px;font-size:26px;font-weight:650;letter-spacing:-.025em}
      .run-identity h2{margin:0}
      .run-identity h2 .run-target{font-family:var(--sa-mono);font-size:.72em;color:var(--sa-ink-soft);font-weight:600}
      .chip-row{display:flex;flex-wrap:wrap;gap:8px;margin:9px 0 0}
      .state-chip{display:inline-flex;align-items:center;gap:7px;border:1px solid var(--sa-line);background:var(--sa-subtle);border-radius:999px;padding:4px 11px;font-size:12px;color:var(--sa-ink-soft);white-space:nowrap}
      .state-chip.live{border-color:var(--sa-primary-line);background:var(--sa-primary-soft);color:var(--sa-primary-text)}
      .state-chip.provisional{border-color:color-mix(in srgb,var(--sa-warn) 40%,transparent);background:var(--sa-warn-soft);color:var(--sa-warn)}
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
      .phase-badge{font-size:11px;font-weight:650;letter-spacing:.05em;text-transform:uppercase;color:var(--sa-primary-text);background:var(--sa-primary-soft);border:1px solid var(--sa-primary-line);border-radius:999px;padding:3px 10px}
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
      .nr-url{font-family:var(--sa-mono);font-size:12px;color:var(--sa-ink-soft);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0}

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
      .mix-total{font-size:12px;color:var(--sa-ink-faint);font-variant-numeric:tabular-nums}
      .panel-card>.hint{margin:0 0 11px}

      .recent-feed li{align-items:flex-start;gap:11px;padding:10px 0;border-bottom:1px solid var(--sa-line);background:transparent}
      .recent-feed li:last-child{border-bottom:0}
      .feed-mark{flex:0 0 auto;width:20px;height:20px;margin-top:1px;border-radius:50%;display:grid;place-items:center;font-size:11px;font-weight:700;background:var(--sa-subtle);color:var(--sa-ink-faint);border:1px solid var(--sa-line)}
      .feed-mark[data-kind=ok]{background:var(--sa-success-soft);border-color:color-mix(in srgb,var(--sa-success) 40%,transparent);color:var(--sa-success)}
      .feed-mark[data-kind=found]{background:var(--sa-primary-soft);border-color:var(--sa-primary-line);color:var(--sa-primary-text)}
      .feed-mark[data-kind=bad]{background:var(--sa-critical-soft);border-color:color-mix(in srgb,var(--sa-critical) 40%,transparent);color:var(--sa-critical)}
      .feed-body{flex:1 1 auto;min-width:0}
      .feed-title{display:block;font-size:13px;color:var(--sa-ink);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
      .feed-title code{font-family:var(--sa-mono);font-size:12px;color:var(--sa-ink)}
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
      .signal-badge{grid-area:1/2;justify-self:end;font-size:11px;font-weight:600;border-radius:999px;padding:2px 9px;white-space:nowrap;border:1px solid transparent}
      .signal-badge[data-kind=early]{background:var(--sa-warn-soft);color:var(--sa-warn);border-color:color-mix(in srgb,var(--sa-warn) 35%,transparent)}
      .signal-badge[data-kind=confirmed]{background:var(--sa-success-soft);color:var(--sa-success);border-color:color-mix(in srgb,var(--sa-success) 35%,transparent)}

      .mix-rows{list-style:none;margin:0;padding:0;display:grid;gap:9px}
      .mix-rows li{display:grid;grid-template-columns:64px minmax(0,1fr) 38px;gap:11px;align-items:center;font-size:12.5px;color:var(--sa-ink-soft)}
      .mix-track{height:7px;border-radius:999px;background:var(--sa-subtle);overflow:hidden}
      .mix-fill{height:100%;border-radius:999px}
      .mix-count{text-align:right;font-variant-numeric:tabular-nums;font-weight:600;color:var(--sa-ink)}

      .run-config{display:flex;align-items:center;gap:12px;margin:0;padding:11px 14px;border:1px solid var(--sa-line);border-radius:var(--sa-radius);background:var(--sa-surface);font-size:12px;color:var(--sa-ink-faint)}
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
      .stat-sub{display:block;margin-top:5px;font-size:12px;line-height:1.4;color:var(--sa-ink-faint)}
      .tb-quantities{display:none}

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
      .section-findings h3{margin:0 0 4px;font-size:14px;font-weight:600;color:var(--sa-ink)}
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
      .summary-stats dd{font-size:24px}
      .tile-track{height:4px;margin-top:9px;border-radius:999px;background:var(--sa-subtle);overflow:hidden}
      .tile-fill{display:block;height:100%;border-radius:999px;background:var(--sa-primary)}

      /* The brief. A violet rail and a tinted ground mark the one region that
         reads the evidence rather than reporting it. */
      .brief{margin:0 0 16px;border:1px solid var(--sa-primary-line);border-left:3px solid var(--sa-primary);border-radius:var(--sa-radius);background:linear-gradient(180deg,var(--sa-primary-soft),transparent 70%),var(--sa-surface);overflow:hidden}
      .brief-kicker{margin:0;padding:12px 16px 0;font-size:11px;font-weight:650;letter-spacing:.09em;text-transform:uppercase;color:var(--sa-primary-text)}
      .brief-kicker span{margin:0 5px;opacity:.6}
      .brief-body{display:grid;grid-template-columns:minmax(0,1.15fr) minmax(0,1fr);gap:0;align-items:stretch}
      .brief-lead{padding:10px 16px 16px;min-width:0}
      .brief-lead h3{margin:0 0 7px;font-size:17px;font-weight:650;color:var(--sa-ink)}
      .brief-summary{margin:0 0 10px;font-size:13.5px;line-height:1.6;color:var(--sa-ink-soft);max-width:64ch}
      .brief-scope{margin:0 0 12px;font-size:12px;color:var(--sa-ink-faint)}
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
      .brief-item-pages b{font-size:14px;color:var(--sa-ink);font-variant-numeric:tabular-nums}

      .brief-detail{padding:16px;border-left:1px solid var(--sa-line);background:var(--sa-surface);min-width:0}
      .brief-badges{display:flex;gap:8px;margin:0 0 10px;flex-wrap:wrap}
      .brief-detail h4{margin:0 0 8px;font-size:16px;font-weight:650;letter-spacing:-.015em;color:var(--sa-ink)}
      .brief-why{margin:0 0 13px;font-size:13px;line-height:1.6;color:var(--sa-ink-soft)}
      .evidence-box{padding:11px 13px;border:1px solid var(--sa-line);border-radius:var(--sa-radius-sm);background:var(--sa-subtle);margin:0 0 13px}
      .evidence-label{display:block;margin-bottom:8px;font-size:11px;font-weight:650;letter-spacing:.09em;text-transform:uppercase;color:var(--sa-ink-faint)}
      .evidence-facts{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px;margin:0}
      .evidence-facts dt{font-size:11px;color:var(--sa-ink-faint);margin:0 0 2px}
      .evidence-facts dd{margin:0;font-size:14px;font-weight:600;color:var(--sa-ink);font-variant-numeric:tabular-nums}
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
      /* The row is the grid; the toggle and the document link are siblings in
         it, and the evidence spans both. */
      .cond-row{border-top:1px solid var(--sa-line);display:grid;grid-template-columns:minmax(0,1fr) auto;align-items:center}
      .cond-row>.cond-head{grid-column:1}
      .cond-row>.cond-open{grid-column:2;margin-right:16px}
      .cond-row>.cond-evidence{grid-column:1/-1}
      .cond-head{display:grid;grid-template-columns:22px 150px minmax(0,1fr) auto;gap:12px;align-items:center;width:100%;text-align:left;border:0;background:transparent;padding:11px 16px;font:inherit;color:inherit;cursor:pointer}
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
      .cond-state{font-size:11.5px;font-weight:600;color:var(--sa-ink-faint);white-space:nowrap;background:var(--sa-subtle);border-radius:999px;padding:3px 10px}
      .cond-row[data-state=ok] .cond-state{background:var(--sa-success-soft);color:var(--sa-success)}
      .cond-row[data-state=attention] .cond-state{background:var(--sa-critical-soft);color:var(--sa-critical)}
      .cond-evidence{margin:0;padding:0 16px 14px 50px;list-style:none}
      .cond-evidence li{font-size:12.5px;line-height:1.55;color:var(--sa-ink-soft);margin-bottom:4px}
      .cond-confidence{display:inline-block;margin-top:6px;font-size:11.5px;color:var(--sa-ink-faint);background:var(--sa-subtle);border-radius:999px;padding:2px 9px}
      .conditions-note{margin:0;padding:0 16px 14px;font-size:12px;line-height:1.5;color:var(--sa-ink-faint)}

      /* The three published documents (robots.txt, sitemap, llms.txt) are rows
         in the conditions readout, and each offers to open the file itself. */
      .cond-open{flex:0 0 auto;font-size:12.5px;color:var(--sa-primary-text);background:none;border:0;padding:4px 2px;margin-left:2px;cursor:pointer;text-decoration:underline;font-family:inherit}
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
      .finding-row .f-top .badge{justify-self:start}
      .finding-row .f-title{min-width:0;overflow-wrap:anywhere}
      .finding-row .f-top::before{content:none}
      .finding-row .f-title{font-weight:600;font-size:14px;color:var(--sa-ink)}
      .finding-row .f-meta{display:flex;align-items:center;gap:10px;font-size:12.5px;color:var(--sa-ink-faint);padding-left:0}
      .f-chev{flex:0 0 auto;width:16px;text-align:right;color:var(--sa-ink-faint);font-size:15px;line-height:1;transition:transform .15s ease}
      .f-toggle[aria-expanded="true"] .f-chev{transform:rotate(90deg)}
      .finding-row .f-conf{flex:0 0 auto;width:112px;font-size:12px;color:var(--sa-ink-faint);display:flex;align-items:center;gap:6px;margin-left:auto}
      .finding-row.sev-critical{box-shadow:inset 3px 0 0 var(--sa-sev-critical),var(--sa-shadow-sm)}
      .finding-row.sev-high{box-shadow:inset 3px 0 0 var(--sa-sev-high),var(--sa-shadow-sm)}
      .finding-row.sev-medium{box-shadow:inset 3px 0 0 var(--sa-sev-medium),var(--sa-shadow-sm)}
      .finding-row.sev-low{box-shadow:inset 3px 0 0 var(--sa-sev-low),var(--sa-shadow-sm)}
      .finding-row.sev-info{box-shadow:inset 3px 0 0 var(--sa-line-strong),var(--sa-shadow-sm)}
      .empty-row{font-size:13px;color:var(--sa-ink-faint);padding:16px;background:var(--sa-surface);border:1px solid var(--sa-line);border-radius:var(--sa-radius)}

      .badge{display:inline-flex;align-items:center;border-radius:999px;padding:2px 9px;font-size:11.5px;font-weight:600;letter-spacing:0;text-transform:capitalize;border:1px solid transparent}
      .badge.fix{background:var(--sa-critical-soft);color:var(--sa-critical)}
      .badge.review{background:var(--sa-warn-soft);color:var(--sa-warn)}
      .badge.sev-critical{background:var(--sa-sev-critical);color:#fff}
      .badge.sev-high{background:var(--sa-critical-soft);color:var(--sa-critical);border-color:color-mix(in srgb,var(--wqa-sev-high) 40%,transparent)}
      .badge.sev-medium{background:var(--sa-warn-soft);color:var(--sa-warn);border-color:color-mix(in srgb,var(--wqa-sev-medium) 40%,transparent)}
      .badge.sev-low{background:var(--sa-warn-soft);color:var(--sa-warn);border-color:color-mix(in srgb,var(--wqa-sev-medium) 40%,transparent)}
      .badge.sev-info{background:var(--sa-info-soft);color:var(--sa-ink-faint);border-color:var(--sa-line-strong)}

      .confidence-dot{display:inline-block;width:8px;height:8px;border-radius:50%;flex:0 0 auto}
      .confidence-dot.confirmed{background:var(--sa-success)}
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
      .fx-detail-title{margin:0 0 10px;font-size:17px;font-weight:650;letter-spacing:-.015em;color:var(--sa-ink)}
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

      .fx-foot{display:flex;align-items:center;gap:14px;margin:0;padding:11px 14px;border:1px solid var(--sa-line);border-radius:var(--sa-radius);background:var(--sa-surface);font-size:12px;color:var(--sa-ink-faint)}
      .fx-foot-text{flex:1 1 auto}
      .fx-foot .link-btn{margin-left:0}

      @media(max-width:1040px){
        .fx-split{grid-template-columns:minmax(0,1fr)}
      }

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
      .status-pill.broken{background:var(--sa-critical-soft);color:var(--sa-critical);border-color:color-mix(in srgb,var(--wqa-sev-high) 40%,transparent)}
      .status-pill.inconclusive,.status-pill.blocked{background:var(--sa-info-soft);color:var(--sa-ink-faint);border-color:var(--sa-line-strong)}

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
      .status-chip.active{background:var(--sa-primary-soft);border-color:var(--sa-primary-line);color:var(--sa-primary-text)}
      .status-chip.active b{color:var(--sa-primary-text)}
      /* A run of links from one page reads as a block, not the same URL
         restated on every row. */
      .links-table .link-same-source td:first-child{border-top:0}
      .links-table tbody tr:not(.link-same-source) td{border-top:1px solid var(--sa-line)}
      .links-source-head{width:34%}
      .urls-table td:first-child{font-family:var(--sa-mono);font-size:12px}
      .toolbar input:focus-visible,.toolbar select:focus-visible,.field input:focus-visible,.field textarea:focus-visible{outline:2px solid var(--sa-primary);outline-offset:1px;border-color:var(--sa-primary)}
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
      .progress-fill{height:100%;background:var(--sa-primary);width:4%;transition:width .3s ease;border-radius:999px}
      .recent-feed{list-style:none;margin:0;padding:0;background:var(--sa-surface);border:1px solid var(--sa-line);border-radius:var(--sa-radius);overflow:hidden;box-shadow:var(--sa-shadow-sm)}
      .recent-feed li{display:flex;align-items:center;gap:10px;font-size:12.5px;padding:9px 12px;border-bottom:1px solid var(--sa-line)}
      .recent-feed li:last-child{border-bottom:0}
      .recent-feed .url{flex:1 1 auto;font-family:var(--sa-mono);font-size:12px;color:var(--sa-ink-soft);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}

      /* Severity + breakdown ------------------------------------------------- */
      .severity-block{margin:0}
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
      .top-issues .badge{flex:0 0 auto}
      /* min-width:0 is what actually lets the title shrink and ellipsis inside
         a flex row; without it the row grew and pushed the count off the card. */
      .top-issues .ti-rule{font-weight:500;flex:1 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--sa-ink)}
      .top-issues .ti-scope{flex:0 0 auto;color:var(--sa-ink-faint);font-size:12px;white-space:nowrap;font-variant-numeric:tabular-nums}

      /* Coverage ------------------------------------------------------------- */

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
      .render-section[data-state=done] .render-state{background:var(--sa-surface);color:var(--sa-success)}
      .render-section[data-state=done] .render-progress-bar{display:none}
      .render-section[data-state=running] .render-state,.render-section[data-state=partial] .render-state{background:var(--sa-surface);color:var(--sa-primary-text)}

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
      .section-cut.active{background:var(--sa-primary-soft);border-color:var(--sa-primary-line);color:var(--sa-primary-text);box-shadow:none}
      .section-cut .sc-count{font-variant-numeric:tabular-nums;color:var(--sa-ink-faint);font-weight:600}
      .section-cut.active .sc-count{color:var(--sa-primary-text)}

      .history-list{list-style:none;margin:16px 0 0;padding:0;background:var(--sa-surface);border:1px solid var(--sa-line);border-radius:var(--sa-radius);overflow:hidden}
      .history-list li{display:flex;align-items:center;justify-content:space-between;gap:10px;border-bottom:1px solid var(--sa-line);padding:11px 14px;font-size:13px;font-variant-numeric:tabular-nums}
      .history-list li:last-child{border-bottom:0}
      .history-list button{border:0;background:transparent;color:var(--sa-primary-text);font-weight:600;cursor:pointer;font-size:13px}

      .foot-note{margin:0;padding:10px 16px;border-top:1px solid var(--sa-line);background:var(--sa-surface);color:var(--sa-ink-faint);font-size:12px;flex:0 0 auto;font-family:var(--sa-sans)}

      .finding-detail{margin:0 14px 14px;padding-top:12px;border-top:1px solid var(--sa-line)}
      .finding-detail h4{margin:14px 0 5px;font-size:12.5px;font-weight:600;text-transform:none;letter-spacing:0;color:var(--sa-ink-faint)}
      .detail-basis,.detail-explain{margin:0 0 8px;font-size:13px;line-height:1.6;color:var(--sa-ink-soft);max-width:84ch}
      .detail-rule{margin:0;font-size:12.5px;color:var(--sa-ink-faint)}
      .detail-rule code{font-family:var(--sa-mono);font-size:12px;color:var(--sa-ink-soft)}
      .finding-detail .url-list{max-height:220px;overflow:auto;border:1px solid var(--sa-line);border-radius:var(--sa-radius-sm);background:var(--sa-subtle);padding:6px 10px;margin:2px 0 4px}
      .finding-detail .url-item{display:block;font-family:var(--sa-mono);font-size:12.5px;color:var(--sa-primary-text);text-decoration:none;padding:3px 0;word-break:break-all}
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
        .nav-foot{margin:0 0 0 auto;flex-direction:row;padding:0 12px 0 10px;flex:0 0 auto;position:sticky;right:0;background:var(--sa-nav);box-shadow:-10px 0 10px -8px rgba(0,0,0,.62)}
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
    { label: 'Explore', items: ['urls', 'links'] },
    { label: 'Validate', items: ['browser'] }
  ];

  const SITE_AUDIT_TAB_LABEL = {
    overview: 'Overview', findings: 'Findings', urls: 'Pages', links: 'Links', browser: 'Browser checks'
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
      { id: 'inconclusive', label: 'Unverified', status: 'inconclusive' }
    ]
  };

  /** Rule id to discipline. The list itself lives in
   * packages/findings/disciplines.js and is injected here at build time, the
   * same way the palette is: the overlay groups findings by discipline and so
   * does the exported client report, and while each kept its own copy they
   * disagreed about what a finding *was*. Patterns arrive as strings because
   * that is what survives the injection. */
  function lumenDisciplineRules() {
    return [["availability",["^navigation\\.link-","^runtime\\.(resource-failed|resource-status|visible-error)","^navigation\\.(fragment-missing|skip-link-target-missing)","^ux\\.(inert-link|form-no-submit|controls-target-missing|disclosure-target-missing|disclosure-toggle-failed|menu-toggle-failed|interaction-restoration-unproven)"]],["duplicates",["^seo\\.duplicate-","^structure\\.duplicate-h1"]],["sitemaps",["^seo\\.sitemap-"]],["international",["^seo\\.hreflang-","^a11y\\.lang-"]],["indexability",["^seo\\.(canonical|noindex|robots|soft-404)","^structure\\.orphan-page","^navigation\\.redirect-chain-long","^web\\.meta-refresh"]],["security",["^security\\."]],["performance",["^performance\\."]],["accessibility",["^(axe|a11y)\\."]],["content",["^seo\\.(title|description|thin-content)","^structure\\.(h1-|heading-skip|image-alt-missing)","^content\\.","^social\\."]],["quality",["."]]];
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

  function createSiteAuditRoot() {
    const old = document.getElementById('__web_qa_site_audit_root');
    if (old) old.remove();
    const host = document.createElement('div');
    host.id = '__web_qa_site_audit_root';
    host.setAttribute('data-webqa-ui', 'site-audit-overlay');
    host.setAttribute('data-webqa-overlay', 'site-audit');
    host.style.cssText = 'all:initial;position:fixed;inset:0;z-index:2147483646;pointer-events:auto;';
    ensureLumenFontFaces();
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
            <div class="run-identity">
              <h2>Scanning <span class="run-target tb-project">&mdash;</span></h2>
              <div class="chip-row">
                <span class="state-chip live"><span class="pulse-dot" aria-hidden="true"></span><span class="run-where">Running on gateway</span></span>
                <span class="state-chip"><span class="stat-elapsed">Elapsed 0s</span></span>
                <span class="state-chip">Progress saved continuously</span>
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
              <span class="phase-badge">Phase 1 of 4</span>
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
                <span class="state-chip live"><span class="pulse-dot" aria-hidden="true"></span>Updating live</span>
              </div>
              <p class="hint">Requests, discoveries and independently confirmed destinations.</p>
              <ul class="recent-feed"></ul>
            </section>
            <div class="run-side">
              <section class="panel-card early-signals">
                <div class="card-head">
                  <h3 class="feed-heading">Lumen early signals</h3>
                  <span class="state-chip provisional">Organizing</span>
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
            <div class="nav-site"><b class="tb-project">&mdash;</b><span class="tb-scale">&mdash;</span></div>
            ${siteAuditNavMarkup()}
            <div class="nav-foot">
              <button type="button" class="btn primary report-btn">Download report</button>
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
              <h2 class="ov-title">&mdash;</h2>
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
            <div class="stat-tile"><dt>Coverage gaps</dt><dd class="sh-gaps">0</dd><span class="stat-sub sh-gaps-sub"></span><button type="button" class="stat-open" data-open="gaps"><span class="sr-only">View the pages that were not fully checked</span></button></div>
          </dl>

          <!-- The brief. Composed deterministically from the findings, which is
               why the label says what it is grounded in. -->
          <section class="brief" hidden>
            <p class="brief-kicker">Lumen brief <span aria-hidden="true">·</span> grounded in scan evidence</p>
            <div class="brief-body">
              <div class="brief-lead">
                <h3>What needs attention</h3>
                <p class="brief-summary"></p>
                <p class="brief-scope"></p>
                <ol class="brief-list"></ol>
              </div>
              <div class="brief-detail"></div>
            </div>
          </section>

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
              <span class="state-chip lens-state">Priority order active</span>
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
            <table class="data-table urls-table"><thead><tr><th data-sort="url">Page</th><th data-sort="status" class="col-status">Status</th><th data-sort="indexable" class="col-status">Indexable</th><th data-sort="title">Title</th><th data-sort="word_count">Words</th><th data-sort="schema">Structured data</th></tr></thead><tbody class="urls-body"></tbody></table>
            <div class="pager"><button type="button" class="btn pager-prev urls-prev">Prev</button><span class="pager-label urls-label"></span><button type="button" class="btn pager-next urls-next">Next</button></div>
          </div>
          <div class="tab-panel links-panel" hidden>
            <h2 class="panel-title">Links</h2>
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
    shadow.querySelector('.history-btn').addEventListener('click', () => loadSiteAuditHistory(origin));
    shadow.querySelector('.render-start-btn').addEventListener('click', startRenderPass);
    shadow.querySelector('.render-stop-btn').addEventListener('click', stopRenderPass);
    shadow.querySelector('.report-btn').addEventListener('click', downloadFullReport);
    shadow.querySelector('.report-btn-2')?.addEventListener('click', downloadFullReport);
    shadow.querySelector('.ov-settings-btn')?.addEventListener('click', () => setSiteAuditView('setup'));
    shadow.querySelector('.deliver-pages')?.addEventListener('click', () => switchSiteAuditTab('urls'));
    shadow.querySelector('.deliver-links')?.addEventListener('click', () => switchSiteAuditTab('links'));
    shadow.querySelector('.conditions-all')?.addEventListener('click', () => switchSiteAuditTab('browser'));
    shadow.querySelector('.mix-open')?.addEventListener('click', () => switchSiteAuditTab('findings'));
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
    releaseLumenFontFaces();
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
    for (const el of shadow.querySelectorAll('.tb-project')) el.textContent = project || '—';
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
    shadow.querySelector('.progress-fill').style.width = `${Math.max(2, pct)}%`;

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
      badge.className = 'signal-badge';
      const confirmed = g.confidence === 'confirmed' || g.confidence === 'corroborated';
      badge.dataset.kind = confirmed ? 'confirmed' : 'early';
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
    shadow.querySelector('.chip-row .state-chip.live').classList.toggle('provisional', Boolean(audit?.paused));
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
    if (audit) {
      renderSummaryHeader(groupsResult?.groups || siteAudit.rawFindingGroups || [], audit);

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
      head.innerHTML = '<span class="cond-mark" aria-hidden="true"></span><span class="cond-label"></span><span class="cond-headline"></span><span class="cond-state"></span>';
      head.querySelector('.cond-label').textContent = r.label;
      head.querySelector('.cond-headline').textContent = r.headline;
      head.querySelector('.cond-state').textContent = CONDITION_STATE_WORD[r.state] || r.state;
      const evidence = document.createElement('ul');
      evidence.className = 'cond-evidence';
      evidence.id = evidenceId;
      evidence.hidden = !open;
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
        const showing = evidence.hidden;
        evidence.hidden = !showing;
        head.setAttribute('aria-expanded', String(showing));
      });
      li.appendChild(head);
      // The three rows backed by a document the reader can open for themselves.
      // A sibling of the row's toggle, never a child of it: a button inside a
      // button is invalid, unreachable for half of assistive technology, and
      // was what pushed this link onto a line of its own.
      const docUrl = conditionDocumentUrl(r.id, signals, siteAudit.siteOrigin);
      if (docUrl) {
        const openBtn = document.createElement('button');
        openBtn.type = 'button';
        openBtn.className = 'cond-open';
        openBtn.textContent = 'Open';
        openBtn.title = docUrl;
        openBtn.setAttribute('aria-label', `Open ${r.label === 'Indexable' ? 'robots.txt' : r.label === 'Sitemap' ? 'the sitemap' : r.label} in a new tab`);
        openBtn.addEventListener('click', () => window.open(docUrl, '_blank', 'noopener'));
        li.appendChild(openBtn);
      }
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

    shadow.querySelector('.sh-pages').textContent = String(fetched);
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
    shadow.querySelector('.sh-gaps-sub').textContent = gaps ? 'pages not fully checked' : 'every page checked';
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
        evidence: [`/llms.txt returned HTTP ${llms.status}. This is a proposed convention, not a standard — its absence is not a defect and is reported here as context only.`] });
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
      parts.push(`Start with the ${first.pages === 1 ? 'destination' : 'destinations'} that fail for a visitor — those are confirmed journey failures, not stylistic warnings.`);
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
    shadow.querySelector('.ov-title').textContent = host || '—';
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
      el.className = `state-chip${chip.tone ? ` ${chip.tone}` : ''}`;
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
  function renderLumenBrief(groups, audit) {
    const shadow = siteAudit.shadow;
    const section = shadow.querySelector('.brief');
    if (!section) return;
    const brief = composeLumenBrief(groups, audit);
    siteAudit.brief = brief;
    if (!brief.groups.length) { section.hidden = true; return; }
    section.hidden = false;
    shadow.querySelector('.brief-summary').textContent = brief.summary;
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
      const sev = document.createElement('span');
      sev.className = `badge sev-${group.severity}`;
      sev.textContent = group.severity;
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
    const priority = document.createElement('span');
    priority.className = `badge sev-${group.severity}`;
    priority.textContent = `${group.severity} priority`;
    const evidence = document.createElement('span');
    evidence.className = 'signal-badge';
    evidence.dataset.kind = group.leadConfirmed ? 'confirmed' : 'early';
    evidence.textContent = String(group.lead?.confidence || 'inferred');
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
      empty: 'No response was recorded — no URL was fetched.'
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
        num.textContent = !renderTotal ? '—' : rendered === 0 ? 'Not run' : rendered < renderTotal ? `${rendered}/${renderTotal}` : 'Done';
        btn.title = rendered === 0
          ? 'Accessibility, JavaScript and performance have not been measured on this site'
          : `${rendered} of ${renderTotal} pages checked in this browser`;
        continue;
      }
      const plain = { findings: Number(audit.findingsCount || 0), urls: Number(counts.fetched || 0), links: linkTotal }[id];
      if (plain === undefined) { chip.hidden = true; continue; }
      chip.hidden = false;
      delete chip.dataset.state;
      dot.hidden = true;
      num.textContent = fmtCount(plain);
      btn.removeAttribute('title');
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
      'urls:all': Number(counts.fetched || 0),
      'urls:gaps': ['queued', 'error', 'skipped'].reduce((n, k) => n + Number(counts[k] || 0), 0),
      'urls:noindex': Number(pages.noindex || 0),
      'urls:errors': Number(counts.error || 0),
      'links:all': Object.values(links).reduce((s, n) => s + Number(n || 0), 0),
      'links:broken': Number(links.broken || 0),
      'links:blocked': Number(links.blocked || 0),
      'links:inconclusive': Number(links.inconclusive || 0)
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
      rendered ? `From the ${rendered} page${rendered === 1 ? '' : 's'} opened in this browser.` : 'None yet — the pass has not run.';
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
                ['Site-wide block', robots.present === true ? (robots.blocksEverything ? 'Yes — Disallow: / for all agents' : 'No') : null],
                ['Disallow rules', robots.present === true ? robots.disallowCount : null],
                ['Sitemaps declared', robots.present === true ? (robots.sitemaps?.length ? robots.sitemaps.join(', ') : 'None') : null],
                ['Confidence', robots.confidence]
              ]
            })
            // "Not checked" was wrong twice over: robots.txt is fetched before
            // the crawl starts, and while a crawl runs the answer simply has
            // not been read back yet. A pending check is not a skipped one.
            : readoutBlock({ title: 'robots.txt', rows: [['Present', siteAudit.audit?.status === 'running' ? 'Being fetched — this audit reads it before it crawls' : 'Not checked in this audit']] })
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
            ? 'The sitemap is being fetched — this audit reads it before it crawls.'
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
              : { label: 'Never reached', value: '—', sub: 'not compared' },
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
                ['Compared against the crawl', reconciled ? 'Yes' : `No — ${withheldReason || 'nothing was read to compare'}`],
                ['Confidence', sitemap.confidence]
              ]
              : [['Checked', running ? 'Not yet — the crawl is still running' : 'No']]
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
      const badge = document.createElement('span');
      badge.className = `badge sev-${g.severity || 'info'}`;
      badge.textContent = g.severity || 'info';
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
    const sev = document.createElement('span');
    sev.className = `badge sev-${group.severity || 'info'}`;
    sev.textContent = group.severity || 'info';
    const area = document.createElement('span');
    area.className = 'state-chip';
    area.textContent = SITE_AUDIT_AREA_LABEL[disciplineOf(group.rule_id)] || '';
    const conf = document.createElement('span');
    conf.className = 'signal-badge';
    const established = group.confidence === 'confirmed' || group.confidence === 'corroborated';
    conf.dataset.kind = established ? 'confirmed' : 'early';
    conf.textContent = group.confidence || 'inferred';
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

  function renderUrlsTable() {
    const shadow = siteAudit.shadow;
    const body = shadow.querySelector('.urls-body');
    renderSectionIndex();
    for (const th of shadow.querySelectorAll('.urls-panel th[data-sort]')) {
      th.classList.toggle('sorted-asc', th.dataset.sort === siteAudit.urlsSort.key && siteAudit.urlsSort.dir === 'asc');
      th.classList.toggle('sorted-desc', th.dataset.sort === siteAudit.urlsSort.key && siteAudit.urlsSort.dir === 'desc');
    }
    const search = String(siteAudit.urlsSearch || '').trim().toLowerCase();
    const sortValue = (u, key) => key === 'status' ? (u.http_status || u.status || '')
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
      let schemaLabel = '—';
      try { const types = JSON.parse(u.schema_types || '[]'); if (types.length) schemaLabel = types.join(', '); } catch {}
      const tr = siteAuditRow([shortUrl(u.url), '', '', u.title || '', u.word_count ?? '—', schemaLabel], { mono: [0] });
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
      // Indexability was stored on every crawled page and shown nowhere, so
      // "20 of 20 indexable" could not be checked against any actual page.
      // Only the exception gets a pill: noindex is what an operator scans for,
      // and a page being indexable is the unremarkable case.
      tr.cells[2].className = 'col-status';
      tr.cells[2].textContent = '';
      if (u.indexable === null || u.indexable === undefined) {
        tr.cells[2].textContent = '—';
        tr.cells[2].title = 'Not read — this page was never fetched.';
      } else if (Number(u.indexable) === 1) {
        tr.cells[2].textContent = 'Yes';
      } else {
        const pill = document.createElement('span');
        pill.className = 'status-pill blocked';
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

  async function exportSiteAudit(dataset, ruleIds) {
    const r = await chrome.runtime.sendMessage({ type: 'SITE_AUDIT_EXPORT', auditId: siteAudit.auditId, dataset, ...(ruleIds ? { ruleIds } : {}) }).catch((error) => ({ ok: false, error: error?.message }));
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
