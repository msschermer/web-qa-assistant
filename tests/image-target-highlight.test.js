import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { JSDOM } from 'jsdom';
import { composeAttention } from '../packages/findings/compose.js';

const source = fs.readFileSync('packages/rules/browser-rules.js', 'utf8');
const imagePurpose = fs.readFileSync('packages/rules/image-purpose.js', 'utf8');

function hydrateSrcdoc(root) {
  const frames = [...root.querySelectorAll('iframe')];
  for (const frame of frames) {
    const srcdoc = frame.getAttribute('srcdoc');
    if (!srcdoc) continue;
    try {
      const doc = frame.contentDocument;
      if (!doc) continue;
      doc.open();
      doc.write(srcdoc);
      doc.close();
      hydrateSrcdoc(doc);
    } catch {}
  }
}

function decorateImages(root) {
  for (const img of root.querySelectorAll('img')) {
    const w = Number(img.getAttribute('data-natural-width') || 0);
    const h = Number(img.getAttribute('data-natural-height') || 0);
    if (!w || !h) continue;
    Object.defineProperty(img, 'naturalWidth', { configurable: true, get: () => w });
    Object.defineProperty(img, 'naturalHeight', { configurable: true, get: () => h });
    Object.defineProperty(img, 'complete', { configurable: true, get: () => true });
    Object.defineProperty(img, 'currentSrc', {
      configurable: true,
      get: () => img.getAttribute('data-current-src') || img.getAttribute('src') || ''
    });
    img.getBoundingClientRect = () => ({
      width: Number(img.getAttribute('data-css-width') || 150),
      height: Number(img.getAttribute('data-css-height') || 84),
      top: 0, left: 0, right: 0, bottom: 0, x: 0, y: 0, toJSON() { return {}; }
    });
  }
}

function scan(html, { url = 'https://www.example.com/images' } = {}) {
  const dom = new JSDOM(html, { url, pretendToBeVisual: true, contentType: 'text/html', runScripts: 'outside-only' });
  hydrateSrcdoc(dom.window.document);
  decorateImages(dom.window.document);
  for (const frame of [...dom.window.document.querySelectorAll('iframe')]) {
    try { if (frame.contentDocument) decorateImages(frame.contentDocument); } catch {}
  }
  const context = {
    window: dom.window,
    document: dom.window.document,
    location: dom.window.location,
    performance: {
      now: () => 0,
      getEntriesByType: (type) => type === 'navigation'
        ? [{ responseStart: 80, requestStart: 0, domContentLoadedEventEnd: 200, loadEventEnd: 300, duration: 300, transferSize: 1000 }]
        : []
    },
    PerformanceObserver: function () { this.observe = () => {}; this.disconnect = () => {}; },
    CSS: dom.window.CSS,
    Node: dom.window.Node,
    HTMLElement: dom.window.HTMLElement,
    setTimeout: dom.window.setTimeout.bind(dom.window),
    clearTimeout: dom.window.clearTimeout.bind(dom.window),
    devicePixelRatio: 1,
    URL: dom.window.URL,
    console,
    globalThis: null
  };
  context.globalThis = context;
  vm.createContext(context);
  vm.runInContext(imagePurpose, context);
  vm.runInContext(source, context);
  return { report: context.WebQARules.run(), rules: context.WebQARules, document: dom.window.document, dom };
}

function oversized(report) {
  return (report.findings || []).filter(f => f.ruleId === 'performance.browser.image-oversized');
}

test('oversized-image target is the rendered img inside picture, not the wrapper', () => {
  const html = `<!doctype html><html lang="en"><head><title>Pic</title></head><body>
    <section class="hero">
      <picture>
        <source srcset="https://www.example.com/huge.webp" type="image/webp">
        <img id="hero-img" src="https://www.example.com/huge.jpg" data-natural-width="3840" data-natural-height="2160" data-css-width="150" data-css-height="84" alt="">
      </picture>
    </section>
  </body></html>`;
  const { report, rules, document } = scan(html);
  const rows = oversized(report);
  assert.equal(rows.length, 1);
  const finding = rows[0];
  assert.equal(finding.target.elementType, 'img');
  assert.match(finding.selector, /img/i);
  assert.doesNotMatch(finding.selector.split(' > ').pop() || '', /^picture$/i);
  const resolved = rules.resolveTarget(finding.targetId, finding.selector);
  assert.equal(resolved, document.getElementById('hero-img'));
  const validated = rules.validateResolvedTarget(finding.targetId, finding.selector, { ruleId: finding.ruleId, elementType: 'img' });
  assert.equal(validated.found, true);
  assert.equal(validated.tag, 'img');
});

test('six oversized images each have a distinct exact target', () => {
  const imgs = Array.from({ length: 6 }, (_, i) =>
    `<img id="img-${i}" src="https://www.example.com/huge-${i}.jpg" data-natural-width="3840" data-natural-height="2160" data-css-width="150" data-css-height="84" alt="">`
  ).join('');
  const html = `<!doctype html><html lang="en"><head><title>Six</title></head><body>${imgs}</body></html>`;
  const { report, rules, document } = scan(html);
  const rows = oversized(report);
  assert.equal(rows.length, 6);
  const ids = new Set(rows.map(f => f.targetId));
  assert.equal(ids.size, 6);
  const attention = composeAttention(rows);
  const group = attention.groups.find(g => g.lead.ruleId === 'performance.browser.image-oversized');
  assert.equal(group.size, 6);
  for (const finding of rows) {
    const el = rules.resolveTarget(finding.targetId, finding.selector);
    assert.equal(el?.localName, 'img');
    assert.equal(el, document.getElementById(finding.selector.includes('img-') ? finding.selector.match(/img-\d/)?.[0] : el.id) || el);
    assert.notEqual(el?.localName, 'body');
    assert.notEqual(el?.localName, 'picture');
  }
});

test('stale oversized-image targets refuse an arbitrary parent highlight', () => {
  const html = `<!doctype html><html lang="en"><head><title>Stale</title></head><body>
    <div class="wrap"><img id="gone" src="https://www.example.com/huge.jpg" data-natural-width="3840" data-natural-height="2160" data-css-width="150" data-css-height="84" alt=""></div>
  </body></html>`;
  const { report, rules, document } = scan(html);
  const finding = oversized(report)[0];
  assert.ok(finding.targetId);
  document.getElementById('gone').remove();
  document.querySelector('.wrap').innerHTML = '<section class="placeholder">content</section>';
  const validated = rules.validateResolvedTarget(finding.targetId, finding.selector, { ruleId: finding.ruleId, elementType: 'img' });
  assert.equal(validated.found, false);
  assert.equal(validated.targetStatus, 'stale');
  assert.match(validated.reason, /changed after the scan/i);
});

test('same-origin iframe oversized images target the framed img', () => {
  const html = `<!doctype html><html lang="en"><head><title>Frame</title></head><body>
    <iframe srcdoc="<!doctype html><html><body><img id='framed' src='https://www.example.com/frame.jpg' data-natural-width='3840' data-natural-height='2160' data-css-width='150' data-css-height='84' alt=''></body></html>"></iframe>
  </body></html>`;
  const { report, rules, document } = scan(html);
  const rows = oversized(report);
  assert.ok(rows.length >= 1, 'expected an oversized image inside the iframe');
  const finding = rows.find(f => f.embeddedContext === 'same-origin-iframe') || rows[0];
  assert.equal(finding.targetType, 'visual');
  assert.ok(finding.targetId);
  const resolved = rules.resolveTarget(finding.targetId, finding.selector);
  assert.equal(resolved?.id, 'framed');
  assert.equal(resolved?.ownerDocument, document.querySelector('iframe').contentDocument);
});

test('blank-opener, contrast, and link-in-text-block resolve the exact affected node', () => {
  const html = `<!doctype html><html lang="en"><head><title>Targets</title></head><body>
    <p id="block">Visible text with <a id="inline-link" href="https://www.example.com/more">more</a> inside the sentence.</p>
    <a id="blank" href="https://www.example.com/new" target="_blank">Open</a>
    <span id="contrast" style="color:#888;background:#eee">Low</span>
  </body></html>`;
  const { report, rules, document } = scan(html);
  const opener = (report.findings || []).find(f => f.ruleId === 'security.blank-opener');
  assert.ok(opener);
  const resolvedOpener = rules.resolveTarget(opener.targetId, opener.selector);
  assert.equal(resolvedOpener, document.getElementById('blank'));
  const contrast = rules.axeFindings({
    violations: [{
      id: 'color-contrast',
      help: 'Elements must meet minimum color contrast ratio thresholds',
      description: 'contrast',
      impact: 'serious',
      tags: ['wcag143'],
      nodes: [{ target: ['#contrast'], html: '<span id="contrast">Low</span>', failureSummary: 'low contrast' }]
    }]
  })[0];
  const contrastEl = rules.resolveTarget(contrast.targetId, contrast.selector);
  assert.equal(contrastEl, document.getElementById('contrast'));
  assert.equal(contrastEl?.localName, 'span');
  document.getElementById('blank').remove();
  const stale = rules.validateResolvedTarget(opener.targetId, opener.selector, { ruleId: opener.ruleId, elementType: 'a' });
  assert.equal(stale.found, false);
  assert.equal(stale.targetStatus, 'stale');
  const linkInText = rules.axeFindings({
    violations: [{
      id: 'link-in-text-block',
      help: 'Links must be distinguishable without relying on color',
      description: 'link in text',
      impact: 'moderate',
      tags: ['wcag141'],
      nodes: [{ target: ['#inline-link'], html: '<a id="inline-link">more</a>' }]
    }]
  })[0];
  assert.equal(rules.resolveTarget(linkInText.targetId, linkInText.selector), document.getElementById('inline-link'));
});
