/**
 * Look at every state of every surface in one pass.
 *
 * The gallery exists so states a real audit will not conveniently produce can
 * be seen, and so the four surfaces can be compared where the product never
 * shows them together. This is the machine reading of the same page: it
 * screenshots it and computes contrast for every text node in every specimen,
 * which is the check that would have caught a confidence dot drawn in nothing.
 *
 * A specimen lives in one of two roots. The overlay's is a shadow root, because
 * the content script builds one; the side panel, the web app and the exported
 * report are documents and render in same-origin iframes, because their sheets
 * style `html` and `body`. Both are reachable from this process, which is the
 * reason the frames use `srcdoc` rather than a blob or a data URL.
 */
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';

const OUT = path.join(process.cwd(), '.autoqa', 'runs', 'driver');
fs.mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 2 });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('requestfailed', (r) => errors.push(`request failed: ${r.url()}`));
// The gateway serves the page and every surface's stylesheet. PORT matches the
// server's own variable, so a gallery run can be pointed at a second instance
// rather than requiring the development one to be stopped first.
const origin = `http://localhost:${process.env.PORT || 3000}`;
await page.goto(`${origin}/gallery.html`, { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => document.body.dataset.ready === 'true', { timeout: 20000 });

const report = await page.evaluate(() => {
  const luminance = (rgb) => {
    const [r, g, b] = rgb.map((v) => {
      const c = v / 255;
      return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const parse = (value) => (value.match(/\d+(\.\d+)?/g) || []).slice(0, 3).map(Number);
  const ratio = (fg, bg) => {
    const a = luminance(parse(fg)); const b = luminance(parse(bg));
    return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
  };
  // Climbs out of a shadow root through its host, and stops at an iframe's own
  // body, which every surface's sheet paints. The fallback is the gallery's
  // specimen ground, which is what a transparent chain resolves to on screen.
  const groundOf = (el) => {
    let node = el;
    while (node) {
      const view = node.ownerDocument?.defaultView || window;
      const bg = view.getComputedStyle(node).backgroundColor;
      if (bg && !/rgba\(0, 0, 0, 0\)|transparent/.test(bg)) return bg;
      node = node.parentElement || node.getRootNode()?.host || null;
    }
    return 'rgb(14, 14, 20)';
  };

  // The two rendering contexts, read the same way.
  const rootOf = (host) => host.shadowRoot || host.querySelector('iframe')?.contentDocument || null;

  const findings = [];
  const surfaces = {};
  let checked = 0;
  let painted = 0;
  const hosts = [...document.querySelectorAll('[data-webqa-ui="gallery-specimen"]')];

  for (const host of hosts) {
    const surface = host.dataset.gallerySurface || 'overlay';
    surfaces[surface] = (surfaces[surface] || 0) + 1;
    const cell = host.closest('.specimen');
    const label = `${surface}/${cell?.querySelector('.label')?.firstChild?.textContent?.trim() || '(unlabelled)'}`;
    const root = rootOf(host);
    const box = host.getBoundingClientRect();
    if (box.width > 0 && box.height > 0) painted++;

    if (!root) {
      findings.push({ specimen: label, text: '(no rendering context)', ratio: 0, floor: 0 });
      continue;
    }

    for (const el of root.querySelectorAll('*')) {
      const text = [...el.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent.trim()).join('');
      if (!text) continue;
      const view = el.ownerDocument?.defaultView || window;
      const cs = view.getComputedStyle(el);
      if (cs.visibility === 'hidden' || cs.display === 'none') continue;
      checked++;
      const size = parseFloat(cs.fontSize);
      const bold = Number(cs.fontWeight) >= 600;
      const floor = size >= 24 || (size >= 18.66 && bold) ? 3 : 4.5;
      const value = ratio(cs.color, groundOf(el));
      if (value < floor) {
        findings.push({ specimen: label, text: text.slice(0, 42), ratio: Number(value.toFixed(2)), floor });
      }
    }

    // A specimen that renders nothing is the defect this page exists to catch.
    // Ink counts as text, a drawn glyph, or a painted shape: a confidence dot
    // and the coverage hatch carry their whole meaning without a character.
    const canvas = root.querySelector('.workspace') || root.querySelector('.lumen-specimen');
    const hasText = Boolean(canvas?.textContent.trim());
    const hasShape = Boolean(root.querySelector('svg, .confidence-dot, .brand-mark, .mark, .ev, [style*="hatch"]'));
    if (!hasText && !hasShape) {
      findings.push({ specimen: label, text: '(renders nothing)', ratio: 0, floor: 0 });
    }
    // A frame collapsed to nothing is the same defect wearing a different hat:
    // it means the height measurement never ran.
    const frame = host.querySelector('iframe');
    if (frame && frame.getBoundingClientRect().height < 8) {
      findings.push({ specimen: label, text: '(frame has no height)', ratio: 0, floor: 0 });
    }
  }
  return { specimens: hosts.length, painted, checked, findings, surfaces };
});

const spread = Object.entries(report.surfaces).map(([k, n]) => `${k} ${n}`).join(', ');
console.log(`specimens: ${report.specimens} (${report.painted} painted) across ${spread}`);
console.log(`text nodes contrast-checked: ${report.checked}`);
if (errors.length) console.log('page errors:', errors);
if (report.findings.length) {
  console.log(`\ncontrast below floor: ${report.findings.length}`);
  for (const f of report.findings.slice(0, 30)) {
    console.log(`  ${String(f.specimen).padEnd(28)} ${String(f.ratio).padStart(5)}:1 (needs ${f.floor}) "${f.text}"`);
  }
} else {
  console.log('contrast: every specimen clears its floor');
}
await page.screenshot({ path: path.join(OUT, 'gallery.png'), fullPage: true });
console.log('screenshot: .autoqa/runs/driver/gallery.png');
await browser.close();
process.exitCode = report.findings.length || errors.length ? 1 : 0;
