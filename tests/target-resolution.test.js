import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { JSDOM } from 'jsdom';

const source = fs.readFileSync('packages/rules/browser-rules.js', 'utf8');
const imagePurpose = fs.readFileSync('packages/rules/image-purpose.js', 'utf8');

// The highlight failures Frank used to hit were all DOM-shaped: a re-render, a
// changed wrapper, a component boundary. They are only reproducible against a
// real DOM, so these run in jsdom rather than against a hand-built stub.
function pageWith(html) {
  const dom = new JSDOM(`<!doctype html><html><head><title>Fixture page</title></head><body>${html}</body></html>`, { url: 'https://example.com/page' });
  const context = {
    window: dom.window,
    document: dom.window.document,
    location: dom.window.location,
    getComputedStyle: dom.window.getComputedStyle.bind(dom.window),
    CSS: dom.window.CSS,
    Node: dom.window.Node,
    performance: dom.window.performance,
    PerformanceObserver: dom.window.PerformanceObserver || function () {},
    fetch: async () => { throw new Error('no network in fixtures'); },
    console
  };
  context.globalThis = context;
  vm.createContext(context);
  vm.runInContext(imagePurpose, context);
  vm.runInContext(source, context);
  return { dom, document: dom.window.document, rules: context.WebQARules };
}

// Element-level findings arrive through the axe path in practice, so the tests
// register targets the same way the extension does rather than through a hook.
function findingFor(page, selector) {
  const results = { violations: [{ id: 'image-alt', impact: 'serious', help: 'Images must have alternate text', description: 'Image alt', tags: ['wcag2a', 'wcag111'], nodes: [{ target: [selector], html: '', any: [], all: [], none: [] }] }], incomplete: [] };
  const finding = page.rules.axeFindings(results)[0];
  assert.ok(finding && finding.targetId, 'expected a registered target for ' + selector);
  return finding;
}

test('a target survives being moved into a different wrapper', () => {
  const page = pageWith('<main><section class="hero"><img src="/logo.png"></section></main>');
  const finding = findingFor(page, 'img');
  const image = page.document.querySelector('img');

  const wrapper = page.document.createElement('div');
  wrapper.className = 'lazy-hydrated';
  image.parentElement.appendChild(wrapper);
  wrapper.appendChild(image);

  assert.equal(page.rules.resolveTarget(finding.targetId, finding.selector), image);
});

test('a target is recovered when its ancestors are rebuilt around it', () => {
  const page = pageWith('<div class="grid-a"><div class="col-1"><img src="/hero.png" alt=""></div></div>');
  const finding = findingFor(page, 'img');
  const image = page.document.querySelector('img');

  // Framework re-render: same element, entirely different ancestor classes, so
  // the recorded path no longer matches from the document root.
  const fresh = page.document.createElement('div');
  fresh.className = 'grid-b';
  fresh.innerHTML = '<div class="col-9"></div>';
  page.document.body.replaceChildren(fresh);
  fresh.firstElementChild.appendChild(image);

  assert.equal(page.rules.resolveTarget(finding.targetId, finding.selector), image);
});

test('a target inside an open shadow root is still reachable', () => {
  const page = pageWith('<div id="host"></div>');
  const shadow = page.document.getElementById('host').attachShadow({ mode: 'open' });
  shadow.innerHTML = '<img class="inside" src="/inside.png">';

  // No live reference, and document.querySelector cannot cross the boundary.
  const found = page.rules.resolveTarget('target_not_in_registry', 'img.inside');
  assert.equal(found, shadow.querySelector('img'));
});

test('an ambiguous selector is disambiguated by the recorded element, not by order', () => {
  const page = pageWith('<ul><li class="row"><a href="/alpha">Alpha</a></li><li class="row"><a href="/beta">Beta</a></li><li class="row"><a href="/gamma">Gamma</a></li></ul>');
  const finding = findingFor(page, 'ul li:nth-child(2) a');
  const beta = page.document.querySelector('a[href="/beta"]');
  assert.equal(page.rules.resolveTarget(finding.targetId, finding.selector), beta);

  // The recorded path no longer resolves, and the remaining selector matches
  // every link on the page. Order alone would pick Alpha.
  page.document.querySelector('ul').replaceChildren(...['/alpha', '/beta', '/gamma'].map(href => {
    const li = page.document.createElement('li');
    li.innerHTML = `<a href="${href}">${href.slice(1)}</a>`;
    return li;
  }));
  const rebuiltBeta = page.document.querySelector('a[href="/beta"]');
  assert.equal(page.rules.resolveTarget(finding.targetId, 'a'), rebuiltBeta);
});

test('an unresolved target reports why, so Frank can explain it', () => {
  const page = pageWith('<main><img src="/gone.png" alt="Team photo"></main>');
  const finding = findingFor(page, 'img');
  page.document.querySelector('img').remove();

  const state = page.rules.resolvedTargetState(finding.targetId, finding.selector);
  assert.equal(state.found, false);
  assert.match(state.reason, /\S/);
  assert.equal(state.described.alt, 'Team photo');
});

test('a hidden but present target is reported as present rather than missing', () => {
  const page = pageWith('<main><img src="/hidden.png" style="display:none"></main>');
  const finding = findingFor(page, 'img');
  const state = page.rules.resolvedTargetState(finding.targetId, finding.selector);
  assert.equal(state.found, true);
  assert.equal(state.visible, false);
  assert.match(state.reason, /hidden/i);
});

test('resolution never writes attributes onto the inspected page', () => {
  const page = pageWith('<main><img src="/logo.png"></main>');
  const finding = findingFor(page, 'img');
  page.document.body.innerHTML = '<section><img src="/logo.png"></section>';
  page.rules.resolveTarget(finding.targetId, finding.selector);

  const image = page.document.querySelector('img');
  assert.deepEqual([...image.attributes].map(a => a.name).sort(), ['src']);
  assert.doesNotMatch(page.document.body.innerHTML, /data-web-qa/);
});

test('indistinguishable candidates resolve to nothing rather than to a guess', () => {
  const page = pageWith('<ul>' + Array.from({ length: 6 }, () => '<li class="row"><button type="button">Go</button></li>').join('') + '</ul>');
  const finding = findingFor(page, 'ul li:nth-child(4) button');
  page.document.querySelector('ul').innerHTML = Array.from({ length: 6 }, () => '<li><button type="button">Go</button></li>').join('');

  // Six identical buttons and nothing to tell them apart. Highlighting the
  // first would report a confident hit on a coin flip.
  assert.equal(page.rules.resolveTarget(finding.targetId, 'button'), null);
  const state = page.rules.resolvedTargetState(finding.targetId, 'button');
  assert.equal(state.found, false);
  assert.equal(state.selectorMatches, 6);
});

test('a resolved target reports which stage found it', () => {
  const page = pageWith('<main><img src="/logo.png" alt="Logo"></main>');
  const finding = findingFor(page, 'main > img');
  assert.equal(page.rules.resolvedTargetState(finding.targetId, finding.selector).via, 'live-reference');

  page.document.body.innerHTML = '<section class="rebuilt"><img src="/logo.png" alt="Logo"></section>';
  const state = page.rules.resolvedTargetState(finding.targetId, finding.selector);
  assert.equal(state.found, true);
  assert.equal(state.via, 'relaxed-selector');
});
