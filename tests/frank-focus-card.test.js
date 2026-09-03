import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { JSDOM } from 'jsdom';

const rules = fs.readFileSync('packages/rules/browser-rules.js', 'utf8');
const imagePurpose = fs.readFileSync('packages/rules/image-purpose.js', 'utf8');
const content = fs.readFileSync('apps/extension/content.js', 'utf8');

// The plan already carries measurements, markup and provenance for every step.
// The card used to render only the headline and body, which is what made a
// multi-step walkthrough feel like it had nothing to say.
function planFixture() {
  return {
    version: 3, title: 'Contrast', summary: 'Frank is using Axe.', mode: 'deterministic', findingId: 'f1', sources: ['axe'],
    assessment: { status: 'verified', statement: 'The evidence is sufficient.', limitations: '' },
    steps: [
      { id: 'read', type: 'interpretation', headline: 'What is happening here', body: 'The status label sits at 2.8:1 against its background.', targetId: 'target_x', evidenceRefs: ['e1', 'e2'], sourceLabels: ['Axe', 'Browser'], code: '', metrics: [{ label: 'Observed contrast ratio', value: '2.8:1' }, { label: 'Required contrast ratio', value: '4.5:1' }], preview: { enabled: true, property: 'color', value: '#48515c' } },
      { id: 'fix', type: 'remediation', headline: 'What I would change', body: 'Darken the foreground until it clears 4.5:1.', targetId: 'target_x', evidenceRefs: ['e1'], sourceLabels: ['Axe'], code: '<span class="status-label">Running</span>', metrics: [], preview: { enabled: false, property: '', value: '' } },
      { id: 'verify', type: 'verification', headline: 'Verify the correction', body: 'Rerun the accessibility scan.', targetId: '', evidenceRefs: [], sourceLabels: [], code: '', metrics: [], preview: { enabled: false, property: '', value: '' } }
    ]
  };
}

function bootPage() {
  const dom = new JSDOM('<!doctype html><html><head><title>Fixture</title></head><body><main><span class="status-label">Running</span></main></body></html>', { url: 'https://example.com/page', pretendToBeVisual: true });
  const { window } = dom;
  window.Element.prototype.scrollIntoView = function () {};
  if (!window.CSS.supports) window.CSS.supports = () => true;
  // jsdom ships neither of these, and the card reads both while rendering.
  if (!window.matchMedia) window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });

  let listener = null;
  const context = {
    window, document: window.document, location: window.location, navigator: window.navigator,
    getComputedStyle: window.getComputedStyle.bind(window), matchMedia: window.matchMedia,
    CSS: window.CSS, Node: window.Node, MutationObserver: window.MutationObserver,
    requestAnimationFrame: fn => fn(), setTimeout, clearTimeout, performance: window.performance,
    PerformanceObserver: function () {}, console,
    addEventListener: () => {}, removeEventListener: () => {},
    get innerWidth() { return 1280; }, get innerHeight() { return 900; },
    chrome: {
      runtime: {
        lastError: null,
        sendMessage: (msg, cb) => {
          if (typeof cb === 'function') queueMicrotask(() => cb({ ok: true, opened: true }));
          return Promise.resolve({ ok: true, opened: true });
        },
        onMessage: { addListener: fn => { listener = fn; } }
      }
    }
  };
  context.globalThis = context;
  vm.createContext(context);
  vm.runInContext(imagePurpose, context);
  vm.runInContext(rules, context);
  window.WebQARules = context.WebQARules;
  vm.runInContext(content, context);

  return {
    document: window.document,
    send: message => new Promise(resolve => { const sync = listener(message, {}, resolve); if (sync !== true) resolve(undefined); }),
    shadow: () => window.document.getElementById('__web_qa_frank_root').shadowRoot
  };
}

// jsdom has no layout, so a target that should read as "on screen" needs a rect.
function giveRect(el, rect = { top: 200, left: 300, width: 120, height: 24 }) {
  el.getBoundingClientRect = () => ({ ...rect, right: rect.left + rect.width, bottom: rect.top + rect.height, x: rect.left, y: rect.top });
}

// The spotlight is positioned a tick after the step renders so the page has a
// chance to scroll first.
const settle = () => new Promise(resolve => setTimeout(resolve, 260));

function start(page, { withRect = true } = {}) {
  const label = page.document.querySelector('.status-label');
  if (label && withRect) giveRect(label);
  return page.send({ type: 'FRANK_START', plan: planFixture(), targets: { target_x: { selector: '.status-label' } } });
}

test('the focus card shows the measurements the step actually carries', async () => {
  const page = bootPage();
  await start(page);
  const shadow = page.shadow();

  const metrics = [...shadow.querySelectorAll('.metric')].map(m => `${m.querySelector('dt').textContent}=${m.querySelector('dd').textContent}`);
  assert.deepEqual(metrics, ['Observed contrast ratio=2.8:1', 'Required contrast ratio=4.5:1']);
  assert.equal(shadow.querySelector('.metrics').hidden, false);
});

test('the card carries the finding verdict, step rail and provenance', async () => {
  const page = bootPage();
  await start(page);
  const shadow = page.shadow();

  assert.equal(shadow.querySelector('.verdict').textContent, 'Verified finding');
  assert.equal(shadow.querySelectorAll('.rail button').length, 3);
  assert.equal(shadow.querySelector('.rail button[data-state="current"]').textContent.trim(), 'Interpret');
  assert.deepEqual([...shadow.querySelectorAll('.sources span')].map(s => s.textContent), ['Axe', 'Browser']);
  assert.match(shadow.querySelector('.sources em').textContent, /2 supporting evidence items for this step/);
  assert.equal(shadow.querySelector('.return-qa').textContent, 'Back to findings');
  assert.equal(shadow.querySelector('.next').textContent, 'Next');
});

test('remediation markup is shown on the page, not just in the sidebar', async () => {
  const page = bootPage();
  await start(page);
  await page.send({ type: 'FRANK_GOTO', index: 1 });
  const shadow = page.shadow();

  assert.equal(shadow.querySelector('.code').hidden, false);
  assert.equal(shadow.querySelector('.code pre').textContent, '<span class="status-label">Running</span>');
});

test('a located target is reported as highlighted and offers its selector', async () => {
  const page = bootPage();
  await start(page);
  await settle();
  const shadow = page.shadow();

  assert.equal(shadow.querySelector('.anchor').dataset.tone, 'located');
  assert.equal(shadow.querySelector('.anchor-selector').textContent, '.status-label');
  assert.equal(shadow.querySelector('.spotlight').hidden, false);
});

test('an unresolvable target still explains itself instead of showing a bare card', async () => {
  const page = bootPage();
  await start(page);
  page.document.querySelector('.status-label').remove();
  await page.send({ type: 'FRANK_GOTO', index: 0 });
  const shadow = page.shadow();

  const anchor = shadow.querySelector('.anchor');
  assert.equal(anchor.dataset.tone, 'missing');
  assert.match(anchor.querySelector('.anchor-note').textContent, /changed after the scan|re-rendered|not there now|could not be located/i);
  assert.match(anchor.querySelector('.anchor-note').textContent, /evidence below still stands/i);
  assert.ok([...anchor.querySelectorAll('.anchor-actions button')].some(b => b.textContent === 'Look again'));
  // The evidence has to keep rendering: it is the whole value of the step.
  assert.equal(shadow.querySelector('.metrics').hidden, false);
});

test('with nothing to spotlight the card is centred rather than parked in a corner', async () => {
  const page = bootPage();
  await start(page);
  await page.send({ type: 'FRANK_GOTO', index: 2 });
  await settle();
  const shadow = page.shadow();
  const coach = shadow.querySelector('.coach');

  assert.equal(shadow.querySelector('.spotlight').hidden, true);
  assert.equal(shadow.querySelector('.backdrop').hidden, false);
  assert.equal(coach.dataset.anchored, 'false');
  const width = Number.parseInt(coach.style.width, 10);
  assert.equal(Number.parseInt(coach.style.left, 10), Math.round((1280 - width) / 2));
});

test('a document-level step says so rather than reporting a missing element', async () => {
  const page = bootPage();
  await start(page);
  await page.send({ type: 'FRANK_GOTO', index: 2 });
  const anchor = page.shadow().querySelector('.anchor');

  assert.equal(anchor.dataset.tone, 'document');
  assert.match(anchor.querySelector('.anchor-head').textContent, /Document-level/);
});

test('a preview is offered only on the step that defines one', async () => {
  const page = bootPage();
  await start(page);
  assert.equal(page.shadow().querySelector('.preview').hidden, false);
  await page.send({ type: 'FRANK_GOTO', index: 1 });
  assert.equal(page.shadow().querySelector('.preview').hidden, true);
});
