if (!globalThis.__WEB_QA_CONTENT__) {
  globalThis.__WEB_QA_CONTENT__ = true;

  let observer = null;
  let dirtyTimer = null;
  let lastUrl = location.href;
  let frankSession = null;

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
    try { await window.WebQARules.preparePerformanceSignals?.(); } catch {}
    try { await window.WebQARules.prepareSafeInteractions?.(); } catch {}
    const local = window.WebQARules.run();
    let axeResults = null;
    try {
      axeResults = await window.axe.run(document, {
        runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'] }
      });
    } catch {}
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
    return report;
  }
  async function auditLinks() {
    try {
      return await window.WebQARules.auditLinks({
        limit: 36,
        concurrency: 6,
        timeoutMs: 3000,
        retryTimeoutMs: 7000,
        budgetMs: 15000
      });
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

  function clearSimpleHighlight() {
    document.querySelectorAll('[data-web-qa-highlight]').forEach(el => {
      el.style.outline = el.dataset.webQaOldOutline || '';
      el.style.outlineOffset = el.dataset.webQaOldOutlineOffset || '';
      delete el.dataset.webQaHighlight;
      delete el.dataset.webQaOldOutline;
      delete el.dataset.webQaOldOutlineOffset;
    });
  }

  function find(selector) {
    if (!selector) return null;
    try { return document.querySelector(selector); }
    catch { return null; }
  }
  function findTarget(targetId, selector = '') {
    try { return window.WebQARules.resolveTarget(targetId, selector) || find(selector); }
    catch { return find(selector); }
  }

  function highlight(targetId, selector) {
    clearSimpleHighlight();
    const el = findTarget(targetId, selector);
    if (!el) return { found: false };
    el.dataset.webQaOldOutline = el.style.outline || '';
    el.dataset.webQaOldOutlineOffset = el.style.outlineOffset || '';
    el.dataset.webQaHighlight = '1';
    el.style.outline = '3px solid #B3261E';
    el.style.outlineOffset = '3px';
    el.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'nearest' });
    setTimeout(() => {
      if (!el.dataset.webQaHighlight) return;
      el.style.outline = el.dataset.webQaOldOutline || '';
      el.style.outlineOffset = el.dataset.webQaOldOutlineOffset || '';
      delete el.dataset.webQaHighlight;
      delete el.dataset.webQaOldOutline;
      delete el.dataset.webQaOldOutlineOffset;
    }, 6000);
    return { found: true };
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

  const STEP_LABELS = { spotlight: 'Locate', evidence: 'Checks', interpretation: 'Meaning', comparison: 'Comparison', trend: 'History', impact: 'Impact', remediation: 'Remediation', verification: 'Verification', summary: 'Summary' };
  const STEP_SHORT = { spotlight: 'Locate', evidence: 'Checks', interpretation: 'Meaning', comparison: 'Compare', trend: 'History', impact: 'Impact', remediation: 'Fix', verification: 'Verify', summary: 'Summary' };
  const VERDICTS = { verified: 'Verified finding', review: 'Needs review', context: 'Context only' };

  function frankCss() {
    return `
      :host{all:initial;
        --f-brand:#12395E;--f-brand-ink:#0C2A46;--f-accent:#1F647D;--f-accent-soft:#E8F3F5;
        --f-ink:#101828;--f-ink-soft:#475467;--f-ink-faint:#5B6B7C;
        --f-line:#E7ECF3;--f-line-strong:#D3DAE4;--f-surface:#fff;--f-sunken:#F7F9FB;
        --f-ok:#067647;--f-ok-soft:#ECFDF3;--f-warn:#B54708;--f-warn-soft:#FFFAEB;--f-critical:#B42318;--f-critical-soft:#FEF3F2;
        --f-sans:'IBM Plex Sans',system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;
        --f-mono:'IBM Plex Mono',ui-monospace,SFMono-Regular,Menlo,Consolas,monospace}
      *{box-sizing:border-box}
      .backdrop{position:fixed;inset:0;background:rgba(10,20,32,.68);z-index:2147483644;pointer-events:none;transition:opacity .18s ease,background .18s ease}
      .backdrop[data-soft="true"]{background:rgba(10,20,32,.46);backdrop-filter:blur(1.5px)}
      .spotlight{position:fixed;z-index:2147483645;border:2px solid rgba(255,255,255,.96);border-radius:8px;box-shadow:0 0 0 99999px rgba(10,20,32,.68),0 0 0 5px rgba(31,100,125,.38),0 0 24px rgba(31,100,125,.22);pointer-events:none;transition:top .16s ease,left .16s ease,width .16s ease,height .16s ease}

      .coach{position:fixed;z-index:2147483647;display:flex;flex-direction:column;width:min(468px,calc(100vw - 28px));max-height:min(78vh,760px);background:var(--f-surface);color:var(--f-ink);border:1px solid rgba(18,57,94,.14);border-radius:18px;box-shadow:0 24px 60px rgba(8,20,34,.34),0 3px 10px rgba(8,20,34,.12);font-family:var(--f-sans);pointer-events:auto;overflow:hidden}
      .accent{height:4px;flex:none;background:linear-gradient(90deg,#12395E 0%,#1F647D 55%,#4E8D78 100%)}

      .top{display:flex;align-items:center;gap:10px;padding:13px 16px 11px;flex:none;background:linear-gradient(180deg,#FBFCFE 0%,#fff 100%);border-bottom:1px solid var(--f-line)}
      .mark{display:grid;place-items:center;width:28px;height:28px;border-radius:9px;background:linear-gradient(135deg,#12395E 0%,#1F647D 100%);color:#fff;font:700 13px/1 var(--f-sans);flex:none;box-shadow:inset 0 0 0 1px rgba(255,255,255,.16),0 1px 3px rgba(12,42,70,.28)}
      .identity{display:grid;gap:1px;min-width:0}
      .name{font:650 13px/1.15 var(--f-sans);color:var(--f-ink);letter-spacing:-.005em}
      .device{font:500 10.5px/1.2 var(--f-sans);color:var(--f-ink-faint);letter-spacing:.02em}
      .verdict{margin-left:auto;display:inline-flex;align-items:center;gap:5px;border-radius:999px;padding:3px 9px;font:600 10.5px/1.5 var(--f-sans);letter-spacing:.03em;text-transform:uppercase;background:var(--f-ok-soft);color:var(--f-ok);white-space:nowrap}
      .verdict[data-status="review"]{background:var(--f-warn-soft);color:var(--f-warn)}
      .verdict[data-status="context"]{background:var(--f-sunken);color:var(--f-ink-faint)}
      .verdict::before{content:"";width:6px;height:6px;border-radius:50%;background:currentColor;flex:none}
      .progress{font:550 11px/1 var(--f-sans);color:var(--f-ink-faint);font-variant-numeric:tabular-nums;white-space:nowrap;margin-left:auto}
      .verdict[hidden]+.progress{margin-left:auto}

      .rail{display:flex;gap:4px;padding:9px 16px 10px;flex:none;border-bottom:1px solid var(--f-line);background:var(--f-surface);overflow-x:auto;scrollbar-width:none}
      .rail::-webkit-scrollbar{display:none}
      .rail button{flex:1 1 0;min-width:56px;border:0;background:transparent;padding:0;cursor:pointer;text-align:left;font:inherit}
      .rail button i{display:block;height:3px;border-radius:999px;background:var(--f-line-strong);transition:background .15s ease}
      .rail button b{display:block;margin-top:5px;font:550 11px/1.2 var(--f-sans);letter-spacing:.02em;color:var(--f-ink-faint);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
      .rail button[data-state="done"] i{background:var(--f-accent)}
      .rail button[data-state="current"] i{background:var(--f-brand);height:4px}
      .rail button[data-state="current"] b{color:var(--f-brand);font-weight:650}
      .rail button[data-role="remediation"] b,.rail button[data-role="verification"] b{font-weight:650}
      .rail button:hover b{color:var(--f-ink-soft)}

      .scroll{overflow:auto;overscroll-behavior:contain;padding:0 0 2px}
      .body{padding:15px 17px 4px}
      .eyebrow{display:block;margin-bottom:6px;color:var(--f-accent);font:650 10.5px/1.2 var(--f-sans);letter-spacing:.09em;text-transform:uppercase}
      h2{margin:0 0 8px;color:var(--f-ink);font:650 19px/1.26 var(--f-sans);letter-spacing:-.014em}
      p{font:14.5px/1.55 var(--f-sans);margin:0;color:var(--f-ink-soft)}

      .anchor{margin:13px 17px 0;border:1px solid var(--f-line);border-radius:11px;background:var(--f-sunken);padding:10px 12px}
      .anchor[data-tone="located"]{border-color:rgba(31,100,125,.28);background:var(--f-accent-soft)}
      .anchor[data-tone="missing"]{border-color:rgba(181,71,8,.3);background:var(--f-warn-soft)}
      .anchor-head{display:flex;align-items:center;gap:7px;font:650 10.5px/1.3 var(--f-sans);letter-spacing:.07em;text-transform:uppercase;color:var(--f-ink-soft)}
      .anchor[data-tone="located"] .anchor-head{color:var(--f-accent)}
      .anchor[data-tone="missing"] .anchor-head{color:var(--f-warn)}
      .anchor-head::before{content:"";width:7px;height:7px;border-radius:50%;background:currentColor;flex:none}
      .anchor-note{margin:6px 0 0;font:12.75px/1.5 var(--f-sans);color:var(--f-ink-soft)}
      .anchor-selector{display:block;margin-top:7px;padding:6px 8px;border-radius:7px;background:rgba(255,255,255,.75);border:1px solid var(--f-line);font:11px/1.45 var(--f-mono);color:var(--f-ink);overflow-wrap:anywhere}
      .anchor-actions{display:flex;gap:6px;flex-wrap:wrap;margin-top:8px}
      .mini{border:1px solid var(--f-line-strong);border-radius:7px;background:var(--f-surface);color:var(--f-ink-soft);padding:4px 9px;font:550 11.5px/1.3 var(--f-sans);cursor:pointer}
      .mini:hover{background:var(--f-sunken);color:var(--f-ink)}

      .metrics{display:grid;grid-template-columns:repeat(auto-fit,minmax(132px,1fr));gap:6px;margin:10px 17px 0;padding:0}
      .metric{border:1px solid var(--f-line);border-radius:8px;background:var(--f-sunken);padding:7px 9px;min-width:0}
      .metric dt{margin:0;font:550 11px/1.3 var(--f-sans);color:var(--f-ink-faint);overflow-wrap:anywhere}
      .metric dd{margin:2px 0 0;font:600 12.5px/1.35 var(--f-mono);color:var(--f-ink);overflow-wrap:anywhere}

      .code{margin:10px 17px 0}
      .code-head{display:flex;align-items:center;justify-content:space-between;gap:9px;padding:6px 10px;border:1px solid var(--f-line);border-bottom:0;border-radius:8px 8px 0 0;background:var(--f-sunken);font:650 11px/1.3 var(--f-sans);color:var(--f-ink-faint)}
      .code pre{margin:0;padding:9px 10px;border:1px solid var(--f-line);border-radius:0 0 8px 8px;background:#0E1B2A;color:#D7E3F0;font:11px/1.55 var(--f-mono);white-space:pre-wrap;overflow-wrap:anywhere;max-height:140px;overflow:auto}

      .sources{display:flex;align-items:center;gap:6px;flex-wrap:wrap;margin:10px 17px 0;padding-top:9px;border-top:1px solid var(--f-line)}
      .sources span{border-radius:999px;background:var(--f-sunken);color:var(--f-ink-soft);padding:2px 8px;font:550 11px/1.5 var(--f-sans)}
      .sources em{font-style:normal;color:var(--f-ink-faint);font:11px/1.5 var(--f-sans)}

      .state{margin:11px 17px 0;font:12.5px/1.5 var(--f-sans);color:var(--f-accent)}
      .state[data-kind="error"]{color:var(--f-critical)}

      .foot{display:flex;align-items:center;gap:8px;padding:12px 17px 14px;flex:none;border-top:1px solid var(--f-line);background:linear-gradient(180deg,#fff 0%,#FBFCFE 100%);flex-wrap:wrap}
      .nav{border:1px solid var(--f-line-strong);border-radius:9px;background:var(--f-surface);color:var(--f-ink);padding:8px 14px;font:550 12.5px/1.2 var(--f-sans);cursor:pointer;transition:background .12s ease,border-color .12s ease}
      .nav:hover:not(:disabled){background:var(--f-sunken);border-color:var(--f-ink-faint)}
      .nav:disabled{opacity:.42;cursor:default}
      .ghost{color:var(--f-accent);border-color:rgba(31,100,125,.34);background:var(--f-accent-soft)}
      .ghost:hover:not(:disabled){background:#DCEEF1;border-color:var(--f-accent)}
      .next{margin-left:auto;background:linear-gradient(180deg,#194B77 0%,#12395E 100%);border-color:var(--f-brand-ink);color:#fff;box-shadow:0 1px 2px rgba(12,42,70,.32)}
      .next:hover:not(:disabled){background:linear-gradient(180deg,#12395E 0%,#0C2A46 100%)}
      .return-qa{width:100%;order:3;background:var(--f-brand);border-color:var(--f-brand-ink);color:#fff;font-weight:650}
      .return-qa:hover:not(:disabled){background:var(--f-brand-ink);border-color:var(--f-brand-ink);color:#fff}
      .nav:focus-visible,.mini:focus-visible,.rail button:focus-visible{outline:2px solid var(--f-accent);outline-offset:2px}

      @media(max-width:560px){.coach{width:calc(100vw - 20px);border-radius:14px;max-height:82vh}.body{padding:13px 14px 4px}.anchor,.metrics,.code,.sources,.state{margin-left:14px;margin-right:14px}.foot{padding:11px 14px 12px}h2{font-size:17.5px}}
      @media(prefers-reduced-motion:reduce){.spotlight,.backdrop,.nav,.rail button i{transition:none}}
    `;
  }

  function createFrankRoot() {
    const old = document.getElementById('__web_qa_frank_root');
    if (old) old.remove();
    const host = document.createElement('div');
    host.id = '__web_qa_frank_root';
    host.style.cssText = 'all:initial;position:fixed;inset:0;z-index:2147483647;pointer-events:auto;';
    document.documentElement.appendChild(host);
    const shadow = host.attachShadow({ mode: 'open' });
    shadow.innerHTML = `<style>${frankCss()}</style><div class="backdrop"></div><div class="spotlight" hidden></div><section class="coach" role="dialog" aria-modal="true" aria-labelledby="frank-coach-title" aria-describedby="frank-coach-body" tabindex="-1"><div class="accent"></div><div class="top"><span class="mark" aria-hidden="true">F</span><span class="identity"><span class="name">Frank</span><span class="device">Web QA Assistant</span></span><span class="verdict" hidden></span><span class="progress"></span></div><nav class="rail" aria-label="Walkthrough steps"></nav><div class="scroll"><div class="body" aria-live="polite" aria-atomic="true"><span class="eyebrow"></span><h2 id="frank-coach-title"></h2><p id="frank-coach-body"></p></div><section class="anchor" hidden aria-label="Element status"><span class="anchor-head"></span><p class="anchor-note"></p><code class="anchor-selector" hidden></code><div class="anchor-actions"></div></section><dl class="metrics" hidden></dl><figure class="code" hidden><figcaption class="code-head"><span>Observed markup</span><button type="button" class="mini copy-code">Copy</button></figcaption><pre></pre></figure><div class="sources" hidden></div><p class="state" hidden role="status" aria-live="polite"></p></div><div class="foot"><button type="button" class="nav back">Back</button><button type="button" class="nav ghost preview" hidden>Preview change</button><button type="button" class="nav ghost reset" hidden>Reset preview</button><button type="button" class="nav ghost report-bug">Report bug</button><button type="button" class="nav next">Next</button><button type="button" class="nav return-qa">Return to QA</button></div></section>`;
    return { host, shadow };
  }

  function reasoningLabel(plan, reasoning = {}) {
    const ai = plan?.mode === 'ai' && reasoning?.status === 'operational';
    if (ai && reasoning.provider === 'chrome-built-in') return 'On-device reasoning';
    if (ai) return 'Cloud reasoning · metered';
    return 'Verified guidance';
  }

  function frankTarget(step) {
    if (!frankSession || !step?.targetId) return null;
    const target = frankSession.targets?.[step.targetId] || {};
    return findTarget(step.targetId, target.selector || '');
  }
  function frankSelector(step) {
    if (!frankSession || !step?.targetId) return '';
    return frankSession.targets?.[step.targetId]?.selector || '';
  }
  function targetState(step) {
    if (!step?.targetId) return { found: false, documentLevel: true, reason: 'This finding is about page-level markup rather than one visible element, so there is nothing on screen to spotlight.' };
    try {
      const state = window.WebQARules.resolvedTargetState(step.targetId, frankSelector(step));
      return { ...state, documentLevel: false };
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
    const rect = el ? el.getBoundingClientRect() : null;
    if (!rect || rect.width < 1 || rect.height < 1) {
      spotlight.hidden = true;
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
      anchor.dataset.tone = 'document';
      head.textContent = markupMode ? 'Page configuration' : 'Document-level finding';
      note.textContent = markupMode
        ? (state.reason || 'This finding is about document markup rather than a single visible element. The relevant sanitized markup is shown below.')
        : (state.reason || 'This finding is about page-level behavior rather than one visible element, so Frank does not fake a spotlight.');
    } else if (!step?.targetId && /spotlight|multiple/i.test(String(frankSession?.plan?.finding?.targetability || ''))) {
      anchor.dataset.tone = 'missing';
      head.textContent = 'Element not re-anchored';
      note.textContent = 'The recorded element could not be re-anchored on the live page, so Frank will not guess a spotlight. The evidence below still stands.';
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
      note.textContent = `${state.reason || 'The element could not be located on the page.'}${descriptors.length ? ` Frank recorded it as ${descriptors.join(', ')}.` : ''} The evidence below still stands on its own.`;
      const retry = document.createElement('button');
      retry.type = 'button'; retry.className = 'mini'; retry.textContent = 'Look again';
      retry.addEventListener('click', () => {
        renderAnchor(step); updateSpotlight();
        coachState(frankTarget(step) ? 'Found it. The element is highlighted now.' : 'Still not on the page. Rescan if the page has changed since the scan.', frankTarget(step) ? 'ok' : 'error');
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
    shadow.querySelector('h2').textContent = step.headline || 'Frank guidance';
    shadow.querySelector('p').textContent = step.body || '';
    shadow.querySelector('.progress').textContent = `${frankSession.index + 1} / ${steps.length}`;
    shadow.querySelector('.back').disabled = frankSession.index === 0;
    shadow.querySelector('.next').textContent = frankSession.index === steps.length - 1 ? 'Return to QA' : 'Next';
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
    if (el) el.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'center', inline: 'nearest' });
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
    coachState('Returning to QA…', 'ok');
    // Synchronous sendMessage from the click/Escape path preserves the user gesture for sidePanel.open in the service worker.
    chrome.runtime.sendMessage({
      type: 'RETURN_TO_QA',
      findingId,
      stepIndex
    }, response => {
      const err = chrome.runtime.lastError;
      if (err || !response?.ok || !response?.opened) {
        frankSession.returning = false;
        coachState(response?.error || err?.message || 'Could not reopen QA. Keep this card, or use the Web QA Assistant toolbar icon.', 'error');
        return;
      }
      if (frankSession) endFrank(false);
    });
  }

  function endFrank(notify = true) {
    if (!frankSession) return { ended: true };
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
    if (notify) chrome.runtime.sendMessage({ type: 'FRANK_CLOSED' }).catch(() => {});
    return { ended: true };
  }

  function onFrankViewportChange() {
    if (!frankSession) return;
    updateSpotlight();
    clearTimeout(frankSession.reflowTimer);
    frankSession.reflowTimer = setTimeout(() => updateSpotlight(), 180);
  }

  function startFrank(plan, targets = {}, reasoning = {}) {
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
    frankSession = { plan, targets, reasoning, host, shadow, index: 0, keyHandler, previewRestore: null, returnFocus, retryTimer: null, reflowTimer: null, returning: false, tabId: null, windowId: null };
    shadow.querySelector('.device').textContent = reasoningLabel(plan, reasoning);
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
    const el = findTarget(targetId, selector);
    if (!el) return { ok: false, error: 'The affected element is no longer present.' };
    resetPreview();
    frankSession.previewRestore = { el, property: preview.property, value: el.style.getPropertyValue(preview.property), priority: el.style.getPropertyPriority(preview.property) };
    el.style.setProperty(preview.property, preview.value, 'important');
    updateSpotlight();
    return { ok: true };
  }

  chrome.runtime.onMessage.addListener((msg, sender, send) => {
    if (msg.type === 'PING') { send({ ok: true }); return; }
    if (msg.type === 'SCAN') { scan().then(send); return true; }
    if (msg.type === 'AUDIT_LINKS') { auditLinks().then(send); return true; }
    if (msg.type === 'APPLY_EXTERNAL_LINK_PROBES') {
      try { send(window.WebQARules.applyExternalProbeResults(msg.candidates || [], msg.rows || [])); }
      catch (error) { send({ findings: [], incompleteChecks: [], resolvedUrls: [], error: error?.message || 'External probe apply failed.' }); }
      return;
    }
    if (msg.type === 'RECHECK_LINK') { window.WebQARules.recheckLink(msg.url || '').then(send).catch(error => send({ verificationState: 'inconclusive', confidence: 'inconclusive', error: error?.message || 'Link recheck failed.' })); return true; }
    if (msg.type === 'HIGHLIGHT') { send(highlight(msg.targetId, msg.selector)); return; }
    if (msg.type === 'TARGET_CONTEXT') { send(targetContext(msg.targetId, msg.selector, msg.ruleId)); return; }
    if (msg.type === 'ENABLE_WATCH') { send(enableWatch()); return; }
    if (msg.type === 'FRANK_START') { send(startFrank(msg.plan, msg.targets || {}, msg.reasoning || {})); return; }
    if (msg.type === 'FRANK_GOTO') { send(renderFrank(msg.index, false)); return; }
    if (msg.type === 'FRANK_END') { send(endFrank(false)); return; }
    if (msg.type === 'FRANK_PREVIEW') { send(previewFrank(msg.targetId, msg.preview)); return; }
    if (msg.type === 'FRANK_RESET_PREVIEW') { resetPreview(); send({ ok: true }); return; }
  });
}
