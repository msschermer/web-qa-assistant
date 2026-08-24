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
      .backdrop{position:fixed;inset:0;background:rgba(16,24,40,.62);z-index:2147483644;pointer-events:none;transition:opacity .18s ease}
      .spotlight{position:fixed;z-index:2147483645;border:2px solid #fff;border-radius:6px;box-shadow:0 0 0 99999px rgba(16,24,40,.62),0 0 0 5px rgba(18,57,94,.35);pointer-events:none;transition:top .16s ease,left .16s ease,width .16s ease,height .16s ease}
      .coach{position:fixed;z-index:2147483647;width:min(320px,calc(100vw - 28px));background:#fff;color:#101828;border-radius:12px;box-shadow:0 12px 32px rgba(16,24,40,.24),0 2px 6px rgba(16,24,40,.1);font-family:'IBM Plex Sans',system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;pointer-events:auto;overflow:hidden}
      .top{display:flex;align-items:center;gap:8px;padding:11px 13px 0}
      .mark{display:grid;place-items:center;width:20px;height:20px;border-radius:6px;background:#12395E;color:#fff;font:600 11px/1 inherit;flex:none}
      .name{font:600 12px/1 inherit;color:#101828}
      .progress{margin-left:auto;font:500 11px/1 inherit;color:#8A94A6;font-variant-numeric:tabular-nums}
      .close{border:0;background:transparent;color:#8A94A6;font:400 18px/1 inherit;cursor:pointer;padding:2px 4px;margin-right:-4px;border-radius:4px}
      .close:hover{background:#F1F4F8;color:#475467}
      .body{padding:9px 13px 12px}
      p{font:14px/1.45 inherit;margin:0;color:#101828}
      .foot{display:flex;gap:7px;padding:0 13px 12px}
      .nav{border:1px solid #D3DAE4;border-radius:6px;background:#fff;color:#101828;padding:6px 12px;font:500 12.5px/1.2 inherit;cursor:pointer}
      .nav:hover:not(:disabled){background:#F7F9FB}
      .nav:disabled{opacity:.45;cursor:default}
      .next{margin-left:auto;background:#12395E;border-color:#12395E;color:#fff}
      .next:hover:not(:disabled){background:#0C2A46}
      .nav:focus-visible,.close:focus-visible{outline:2px solid #12395E;outline-offset:2px}
      @media (prefers-reduced-motion:reduce){.spotlight,.backdrop{transition:none}}
    `;
  }

  function createFrankRoot() {
    const old = document.getElementById('__web_qa_frank_root');
    if (old) old.remove();
    const host = document.createElement('div');
    host.id = '__web_qa_frank_root';
    host.style.cssText = 'all:initial;position:fixed;inset:0;z-index:2147483647;pointer-events:none;';
    document.documentElement.appendChild(host);
    const shadow = host.attachShadow({ mode: 'open' });
    // The overlay is orientation only. Narrative, evidence and remediation live
    // in the side panel; duplicating them over the page was the main source of
    // visual noise in acceptance testing.
    shadow.innerHTML = `<style>${frankCss()}</style><div class="backdrop"></div><div class="spotlight" hidden></div><section class="coach" role="dialog" aria-modal="true" aria-label="Frank guided explanation" tabindex="-1"><div class="top"><span class="mark" aria-hidden="true">F</span><span class="name">Frank</span><span class="progress"></span><button type="button" class="close" aria-label="Exit Frank">\u00d7</button></div><div class="body"><p></p></div><div class="foot"><button type="button" class="nav back">Back</button><button type="button" class="nav next">Next</button></div></section>`;
    return { host, shadow };
  }

  function frankTarget(step) {
    if (!frankSession || !step?.targetId) return null;
    const target = frankSession.targets?.[step.targetId] || {};
    return findTarget(step.targetId, target.selector || '');
  }

  function positionCoach(coach, rect) {
    const margin = 14;
    const width = Math.min(360, innerWidth - margin * 2);
    coach.style.width = `${width}px`;
    const estimated = 225;
    let left = innerWidth - width - margin;
    let top = margin;
    if (rect) {
      const spaceBelow = innerHeight - rect.bottom;
      top = spaceBelow > estimated + 22 ? Math.min(innerHeight - estimated - margin, rect.bottom + 18) : Math.max(margin, rect.top - estimated - 18);
      if (rect.right + width + 22 < innerWidth) left = rect.right + 18;
      else if (rect.left - width - 22 > 0) left = rect.left - width - 18;
      else left = Math.max(margin, Math.min(innerWidth - width - margin, rect.left));
    }
    coach.style.left = `${Math.max(margin, left)}px`;
    coach.style.top = `${Math.max(margin, top)}px`;
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
      spotlight.hidden = true;
      backdrop.hidden = false;
      positionCoach(coach, null);
      return;
    }
    const rect = el.getBoundingClientRect();
    if (rect.width < 1 || rect.height < 1) {
      spotlight.hidden = true;
      backdrop.hidden = false;
      positionCoach(coach, null);
      return;
    }
    backdrop.hidden = true;
    spotlight.hidden = false;
    const pad = 6;
    spotlight.style.left = `${Math.max(2, rect.left - pad)}px`;
    spotlight.style.top = `${Math.max(2, rect.top - pad)}px`;
    spotlight.style.width = `${Math.max(8, Math.min(innerWidth - Math.max(2, rect.left - pad) - 2, rect.width + pad * 2))}px`;
    spotlight.style.height = `${Math.max(8, Math.min(innerHeight - Math.max(2, rect.top - pad) - 2, rect.height + pad * 2))}px`;
    positionCoach(coach, rect);
  }

  // One short line telling the reader what they are looking at. The side panel
  // carries the explanation; repeating it here is what made the old overlay noisy.
  const ORIENTATION = {
    spotlight: 'This is the affected element.',
    interpretation: 'This is what the element is doing on the page.',
    evidence: 'This step uses verified page evidence.',
    comparison: 'These observation points disagree.',
    trend: 'This comes from monitored history.',
    impact: 'This is why it matters here.',
    remediation: 'This is the element to change.',
    verification: 'Check this element after the change.',
    summary: 'Summary of the finding.'
  };
  function orientationLine(step) {
    const headline = String(step?.headline || '').trim();
    if (headline && headline.length <= 72) return headline;
    return ORIENTATION[step?.type] || 'Frank is pointing at this element.';
  }

  function renderFrank(index, notify = false) {
    if (!frankSession) return { ok: false };
    const steps = frankSession.plan.steps;
    const nextIndex = Math.max(0, Math.min(steps.length - 1, Number(index) || 0));
    if (nextIndex !== frankSession.index) resetPreview();
    frankSession.index = nextIndex;
    const step = steps[frankSession.index];
    const { shadow } = frankSession;
    shadow.querySelector('p').textContent = orientationLine(step);
    shadow.querySelector('.progress').textContent = `${frankSession.index + 1} of ${steps.length}`;
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
    setTimeout(() => shadow.querySelector('.close')?.focus(), 0);
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
