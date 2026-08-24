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

  async function scan() {
    try { await window.WebQARules.preparePerformanceSignals?.(); } catch {}
    const local = window.WebQARules.run();
    let axeResults = null;
    try {
      axeResults = await window.axe.run(document, {
        runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'] }
      });
    } catch {}
    const report = window.WebQARules.merge(local, axeResults, { findings: [], checked: 0 });
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

  function frankCss() {
    return `
      :host{all:initial}
      *{box-sizing:border-box}
      .backdrop{position:fixed;inset:0;background:rgba(10,20,32,.68);z-index:2147483644;pointer-events:none;transition:opacity .18s ease}
      .spotlight{position:fixed;z-index:2147483645;border:2px solid rgba(255,255,255,.96);border-radius:8px;box-shadow:0 0 0 99999px rgba(10,20,32,.68),0 0 0 5px rgba(31,100,125,.38),0 0 24px rgba(31,100,125,.22);pointer-events:none;transition:top .16s ease,left .16s ease,width .16s ease,height .16s ease}
      .coach{position:fixed;z-index:2147483647;width:min(430px,calc(100vw - 28px));background:#fff;color:#101828;border:1px solid rgba(18,57,94,.16);border-radius:16px;box-shadow:0 18px 48px rgba(8,20,34,.3),0 3px 10px rgba(8,20,34,.12);font-family:'IBM Plex Sans',system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;pointer-events:auto;overflow:hidden}
      .accent{height:3px;background:linear-gradient(90deg,#12395E 0%,#1F647D 58%,#4E8D78 100%)}
      .top{display:flex;align-items:center;gap:9px;padding:12px 15px 0}
      .mark{display:grid;place-items:center;width:23px;height:23px;border-radius:7px;background:#12395E;color:#fff;font:700 12px/1 inherit;flex:none;box-shadow:inset 0 0 0 1px rgba(255,255,255,.12)}
      .identity{display:grid;gap:1px}.name{font:650 12.5px/1.1 inherit;color:#101828}.device{font:500 10.5px/1.2 inherit;color:#667085}
      .progress{margin-left:auto;font:550 11px/1 inherit;color:#667085;font-variant-numeric:tabular-nums}
      .close{border:0;background:transparent;color:#8A94A6;font:400 19px/1 inherit;cursor:pointer;padding:3px 5px;margin-right:-5px;border-radius:6px}
      .close:hover{background:#F1F4F8;color:#344054}
      .body{padding:14px 17px 15px}
      .eyebrow{display:block;margin-bottom:5px;color:#1F647D;font:650 10.5px/1.2 inherit;letter-spacing:.09em;text-transform:uppercase}
      h2{margin:0 0 7px;color:#101828;font:650 18px/1.28 inherit;letter-spacing:-.012em}
      p{font:14.5px/1.52 inherit;margin:0;color:#344054}
      .foot{display:flex;gap:8px;padding:0 17px 15px}
      .nav{border:1px solid #D0D7E2;border-radius:8px;background:#fff;color:#101828;padding:7px 13px;font:550 12.5px/1.2 inherit;cursor:pointer}
      .nav:hover:not(:disabled){background:#F7F9FB;border-color:#AEB8C7}.nav:disabled{opacity:.42;cursor:default}
      .next{margin-left:auto;background:#12395E;border-color:#12395E;color:#fff}.next:hover:not(:disabled){background:#0C2A46;border-color:#0C2A46}
      .nav:focus-visible,.close:focus-visible{outline:2px solid #1F647D;outline-offset:2px}
      @media(max-width:520px){.coach{width:calc(100vw - 20px);border-radius:13px}.body{padding:12px 14px 14px}.foot{padding:0 14px 14px}h2{font-size:17px}}
      @media(prefers-reduced-motion:reduce){.spotlight,.backdrop{transition:none}}
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
    shadow.innerHTML = `<style>${frankCss()}</style><div class="backdrop"></div><div class="spotlight" hidden></div><section class="coach" role="dialog" aria-modal="true" aria-labelledby="frank-coach-title" aria-describedby="frank-coach-body" tabindex="-1"><div class="accent"></div><div class="top"><span class="mark" aria-hidden="true">F</span><span class="identity"><span class="name">Frank</span><span class="device">Evidence-grounded guidance</span></span><span class="progress"></span><button type="button" class="close" aria-label="Exit Frank">\u00d7</button></div><div class="body" aria-live="polite" aria-atomic="true"><span class="eyebrow"></span><h2 id="frank-coach-title"></h2><p id="frank-coach-body"></p></div><div class="foot"><button type="button" class="nav back">Back</button><button type="button" class="nav next">Next</button></div></section>`;
    return { host, shadow };
  }

  function frankTarget(step) {
    if (!frankSession || !step?.targetId) return null;
    const target = frankSession.targets?.[step.targetId] || {};
    return findTarget(step.targetId, target.selector || '');
  }

  function positionCoach(coach, rect) {
    const margin = 14, gap = 18;
    const width = Math.min(430, innerWidth - margin * 2);
    coach.style.width = `${Math.max(280, width)}px`;
    coach.style.left = `${margin}px`; coach.style.top = `${margin}px`;
    const card = coach.getBoundingClientRect(), height = Math.min(card.height || 260, innerHeight - margin * 2);
    const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
    const positions = rect ? [
      { left: rect.right + gap, top: rect.top + rect.height / 2 - height / 2 },
      { left: rect.left - width - gap, top: rect.top + rect.height / 2 - height / 2 },
      { left: rect.left + rect.width / 2 - width / 2, top: rect.bottom + gap },
      { left: rect.left + rect.width / 2 - width / 2, top: rect.top - height - gap }
    ] : [{ left: innerWidth - width - margin, top: margin }];
    const overlaps = p => rect && !(p.left + width < rect.left - 8 || p.left > rect.right + 8 || p.top + height < rect.top - 8 || p.top > rect.bottom + 8);
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
    if (!el) {
      spotlight.hidden = true; backdrop.hidden = false;
      requestAnimationFrame(() => positionCoach(coach, null));
      return;
    }
    const rect = el.getBoundingClientRect();
    if (rect.width < 1 || rect.height < 1) {
      spotlight.hidden = true; backdrop.hidden = false;
      requestAnimationFrame(() => positionCoach(coach, null));
      return;
    }
    backdrop.hidden = true; spotlight.hidden = false;
    const pad = 6, left = Math.max(2, rect.left - pad), top = Math.max(2, rect.top - pad);
    spotlight.style.left = `${left}px`; spotlight.style.top = `${top}px`;
    spotlight.style.width = `${Math.max(8, Math.min(innerWidth - left - 2, rect.width + pad * 2))}px`;
    spotlight.style.height = `${Math.max(8, Math.min(innerHeight - top - 2, rect.height + pad * 2))}px`;
    requestAnimationFrame(() => positionCoach(coach, rect));
  }

  function stepLabel(step) {
    const labels = { spotlight: 'Locate', evidence: 'Evidence', interpretation: 'Interpretation', comparison: 'Comparison', trend: 'History', impact: 'Impact', remediation: 'Remediation', verification: 'Verification', summary: 'Summary' };
    return labels[step?.type] || 'Guidance';
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
    shadow.querySelector('.next').textContent = frankSession.index === steps.length - 1 ? 'Done' : 'Next';
    const el = frankTarget(step);
    if (el) el.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'center', inline: 'nearest' });
    setTimeout(updateSpotlight, el ? 180 : 0);
    if (notify) chrome.runtime.sendMessage({ type: 'FRANK_STEP_CHANGED', index: frankSession.index, stepId: step.id }).catch(() => {});
    return { ok: true, index: frankSession.index, stepId: step.id };
  }

  function resetPreview() {
    if (!frankSession?.previewRestore) return;
    const { el, property, value, priority } = frankSession.previewRestore;
    if (el?.isConnected) el.style.setProperty(property, value, priority);
    frankSession.previewRestore = null;
  }

  function endFrank(notify = true) {
    if (!frankSession) return { ended: true };
    resetPreview();
    removeEventListener('scroll', updateSpotlight, true);
    removeEventListener('resize', updateSpotlight, true);
    document.removeEventListener('keydown', frankSession.keyHandler, true);
    const returnFocus = frankSession.returnFocus;
    frankSession.host.remove();
    frankSession = null;
    try { returnFocus?.focus?.({ preventScroll: true }); } catch {}
    if (notify) chrome.runtime.sendMessage({ type: 'FRANK_CLOSED' }).catch(() => {});
    return { ended: true };
  }

  function startFrank(plan, targets = {}) {
    endFrank(false);
    const { host, shadow } = createFrankRoot();
    const returnFocus = document.activeElement;
    const keyHandler = event => {
      if (event.key === 'Escape') { event.preventDefault(); endFrank(true); }
      else if (event.key === 'Tab') {
        const focusable = [...shadow.querySelectorAll('button:not(:disabled),[tabindex]:not([tabindex="-1"])')];
        if (!focusable.length) return;
        const first = focusable[0], last = focusable[focusable.length - 1], active = shadow.activeElement;
        if (event.shiftKey && active === first) { event.preventDefault(); last.focus(); }
        else if (!event.shiftKey && active === last) { event.preventDefault(); first.focus(); }
      }
      else if (event.key === 'ArrowRight' && !event.target?.matches?.('input,textarea,select,[contenteditable=true]')) renderFrank((frankSession?.index || 0) + 1, true);
      else if (event.key === 'ArrowLeft' && !event.target?.matches?.('input,textarea,select,[contenteditable=true]')) renderFrank((frankSession?.index || 0) - 1, true);
    };
    frankSession = { plan, targets, host, shadow, index: 0, keyHandler, previewRestore: null, returnFocus };
    shadow.querySelector('.close').addEventListener('click', () => endFrank(true));
    shadow.querySelector('.back').addEventListener('click', () => renderFrank(frankSession.index - 1, true));
    shadow.querySelector('.next').addEventListener('click', () => {
      if (frankSession.index >= plan.steps.length - 1) endFrank(true);
      else renderFrank(frankSession.index + 1, true);
    });
    addEventListener('scroll', updateSpotlight, true);
    addEventListener('resize', updateSpotlight, true);
    document.addEventListener('keydown', keyHandler, true);
    renderFrank(0, true);
    setTimeout(() => shadow.querySelector('.coach')?.focus(), 0);
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
    if (msg.type === 'RECHECK_LINK') { window.WebQARules.recheckLink(msg.url || '').then(send).catch(error => send({ verificationState: 'inconclusive', confidence: 'inconclusive', error: error?.message || 'Link recheck failed.' })); return true; }
    if (msg.type === 'HIGHLIGHT') { send(highlight(msg.targetId, msg.selector)); return; }
    if (msg.type === 'TARGET_CONTEXT') { send(targetContext(msg.targetId, msg.selector, msg.ruleId)); return; }
    if (msg.type === 'ENABLE_WATCH') { send(enableWatch()); return; }
    if (msg.type === 'FRANK_START') { send(startFrank(msg.plan, msg.targets || {})); return; }
    if (msg.type === 'FRANK_GOTO') { send(renderFrank(msg.index, false)); return; }
    if (msg.type === 'FRANK_END') { send(endFrank(false)); return; }
    if (msg.type === 'FRANK_PREVIEW') { send(previewFrank(msg.targetId, msg.preview)); return; }
    if (msg.type === 'FRANK_RESET_PREVIEW') { resetPreview(); send({ ok: true }); return; }
  });
}
