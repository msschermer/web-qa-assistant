import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const panelHtml = fs.readFileSync('apps/extension/sidepanel.html', 'utf8');
const panelJs = fs.readFileSync('apps/extension/sidepanel.js', 'utf8');
const panelCss = fs.readFileSync('apps/extension/sidepanel.css', 'utf8');
const content = fs.readFileSync('apps/extension/content.js', 'utf8');
const tokens = fs.readFileSync('packages/ui/tokens.css', 'utf8');

test('sidebar is the deterministic evidence panel, not a duplicate walkthrough narrative card', () => {
  assert.match(panelHtml, />Evidence</);
  assert.doesNotMatch(panelHtml, /Evidence ledger/);
  assert.match(panelHtml, /id="frank-facts"/);
  assert.match(panelHtml, /Evidence for this step/);
  assert.match(panelHtml, /Full evidence record/);
  assert.doesNotMatch(panelHtml, /id="frank-step-headline"|id="frank-step-body"/);
  assert.match(panelJs, /renderFrankEvidenceLedger/);
  assert.match(panelJs, /Observed by/);
  assert.match(panelJs, /Reference context/);
  assert.match(panelJs, /attempts > 1/);
  assert.match(panelJs, /Sources/);
});

test('center focus card owns walkthrough explanation and navigation', () => {
  assert.match(content, /textContent = step\.headline/);
  assert.match(content, /textContent = step\.body/);
  assert.match(content, /aria-live="polite" aria-atomic="true"/);
  assert.match(content, /aria-labelledby="frank-coach-title"/);
  assert.match(content, /pointer-events:auto/);
  assert.match(content, /Back/);
  assert.match(content, /Next/);
  assert.match(content, /Back to findings/);
  assert.doesNotMatch(content, /Return to QA/);
  assert.doesNotMatch(content, /aria-label="Exit Frank"/);
  assert.doesNotMatch(content, /orientation only/i);
});

test('focus mode keeps the real target visible and positions the coach around it', () => {
  assert.match(content, /getBoundingClientRect\(\)/);
  assert.match(content, /positions/);
  assert.match(content, /spotlight/);
  assert.match(content, /backdrop/);
  assert.match(content, /Math\.min/);
});

test('current-step evidence can be visually traced back to walkthrough reasoning', () => {
  assert.match(panelJs, /activeIds/);
  assert.match(panelJs, /row\.dataset\.active/);
  assert.match(panelCss, /evidence-row\[data-active=(?:"true"|true)\]/);
});

test('Lumen visual identity is one violet voice over dark grounds, from semantic classes', () => {
  assert.match(tokens, /--wqa-accent:/);
  assert.match(tokens, /--wqa-accent-soft:/);
  // The operator pinned a replacement world with mockups, which is the exit
  // the previous 'category standard, played straight' commitment reserved for
  // them. Still pinned, so the identity cannot drift silently.
  assert.match(tokens, /--wqa-brand:#7350F5/, 'one violet primary carries the product voice');
  assert.match(tokens, /--wqa-canvas:#0E0E14/, 'dark grounds, by decision');
  assert.match(tokens, /--wqa-ink:#E9E9F2/);
  assert.doesNotMatch(panelCss, /linear-gradient/);
  assert.match(content, /linear-gradient/);
  // No utility soup — the reason Tailwind was removed rather than adopted. It
  // emitted 87 utility classes of which none appeared in any markup; the
  // styling has always been semantic component classes over these tokens.
  assert.doesNotMatch(panelHtml, /class="[^"]*\bflex\s+(?:flex-col|items-|justify-|px-|py-)/);
  const packageJson = fs.readFileSync('package.json', 'utf8');
  assert.doesNotMatch(packageJson, /tailwind/i, 'the CSS build is plain concatenation; nothing should reintroduce a CSS toolchain unnoticed');
  assert.equal(fs.existsSync('packages/ui/lumen.css'), false, 'the Tailwind entry point is gone');
});

test('one palette reaches every surface, including the ones that cannot link a stylesheet', () => {
  // Four token systems used to carry the same values: the Tailwind @theme
  // block, tokens.css, the overlay's private copy and the coach's. Two of the
  // five severity steps had already drifted apart.
  const palette = new Set((tokens.match(/#[0-9A-Fa-f]{6}/g) || []).map((h) => h.toUpperCase()));
  assert.ok(palette.size > 15, 'tokens.css should carry the palette');

  // The injected surfaces get it at build time, since :host{all:initial} on a
  // third-party page can never reach a compiled sheet.
  const build = fs.readFileSync('scripts/build-extension.mjs', 'utf8');
  assert.match(build, /lumenTokenBlock\(\)/);
  assert.match(content, /function lumenTokens\(\) \{/);
  const coach = fs.readFileSync('packages/ui/coach.css', 'utf8');
  assert.match(coach, /@lumen-tokens/, 'the coach receives the palette rather than restating it');

  // And neither injected surface names a colour the palette already names.
  const saStart = content.indexOf('function siteAuditCss()');
  const overlayTokens = content.slice(saStart, content.indexOf('--sa-grain', saStart));
  for (const source of [['the Site Audit overlay', overlayTokens], ['the Frank coach', coach]]) {
    const repeats = [...new Set((source[1].match(/#[0-9A-Fa-f]{6}/g) || []).map((h) => h.toUpperCase()))]
      .filter((hex) => palette.has(hex));
    assert.deepEqual(repeats, [], `${source[0]} redeclares palette values instead of aliasing them`);
  }
});

test('the severity ramp stays fills-only once it reaches the overlay', () => {
  // DESIGN.md seals the ramp: bright values for bars, rails and dots, never
  // text on a tint. The overlay had collapsed the two into one variable, so
  // badges and pills were painting #D92D20 text on a #FEF3F2 wash.
  assert.doesNotMatch(content, /color:var\(--sa-sev-[a-z]+\)/, 'the ramp is never a text colour');
  assert.match(content, /--sa-critical:var\(--wqa-critical\)/, 'text uses the semantic pair');
  assert.match(content, /--sa-warn:var\(--wqa-warn\)/);
  assert.match(content, /--sa-sev-critical:var\(--wqa-sev-critical\)/, 'fills use the ramp');
  // Severity now reaches a pill through one table rather than through seven
  // near-identical badge classes, so the guard pins both halves: low maps to
  // the warn tone, and the warn tone is the semantic pair rather than the ramp.
  assert.match(content, /const SEVERITY_TONE = \{[^}]*low: 'warn'/, 'low severity takes the warn tone');
  assert.match(content, /\.pill\[data-tone=warn\]\{background:var\(--sa-warn-soft\);color:var\(--sa-warn\)/);
  // Critical is the one severity whose ground comes from the ramp: a solid
  // fill under white, never ramp-coloured text on a tint.
  assert.match(content, /const SEVERITY_TONE = \{ critical: 'critical-solid'/);
  // The ground is derived from the ramp rather than being the ramp value
  // itself. White on #E14356 measures 4.09:1, under the floor for text this
  // size, and the state gallery's contrast pass caught it on a component that
  // had already shipped. The ramp is sealed, so the pill deepens its own ground
  // from it: still a fill sourced from the ramp, still never ink.
  const solid = content.match(/\.pill\[data-tone=critical-solid\]\{[^}]*\}/)[0];
  assert.match(solid, /background:color-mix\(in srgb,var\(--sa-sev-critical\)/, 'the fill still comes from the ramp');
  assert.match(solid, /color:#fff\}/, 'and carries white ink, not ramp-coloured ink');
  assert.ok(!/color:var\(--sa-sev/.test(solid), 'the ramp never becomes the ink');
});

test('the dark world keeps its contrast floors, computed rather than asserted by eye', () => {
  // DESIGN.md's Computed Contrast Rule survives the world change: text clears
  // 4.5:1 on every ground, semantic text clears it on its own wash, white
  // clears it on the primary, and the severity ramp — fills only — clears 3:1.
  const hex = (h) => h.replace('#', '').match(/../g).map((x) => parseInt(x, 16));
  const lin = (c) => { const s = c / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; };
  const lum = (h) => { const [r, g, b] = hex(h); return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b); };
  const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
  const token = (name) => {
    const m = tokens.match(new RegExp(`--wqa-${name}\s*:\s*(#[0-9A-Fa-f]{6})`));
    assert.ok(m, `--wqa-${name} should be a literal colour in tokens.css`);
    return m[1];
  };
  const grounds = ['canvas', 'surface', 'sunken', 'surface-raised'].map(token);

  for (const name of ['ink', 'ink-soft', 'ink-faint']) {
    for (const ground of grounds) {
      const r = ratio(token(name), ground);
      assert.ok(r >= 4.5, `--wqa-${name} is ${r.toFixed(2)}:1 on ${ground}, below the 4.5 floor`);
    }
  }
  for (const name of ['critical', 'warn', 'ok', 'info']) {
    const fg = token(name);
    const own = ratio(fg, token(`${name}-soft`));
    assert.ok(own >= 4.5, `--wqa-${name} is ${own.toFixed(2)}:1 on its own wash`);
    for (const ground of grounds) {
      assert.ok(ratio(fg, ground) >= 4.5, `--wqa-${name} fails on ${ground}`);
    }
  }
  const white = ratio('#FFFFFF', token('brand'));
  assert.ok(white >= 4.5, `white on the primary is ${white.toFixed(2)}:1 — a primary button cannot carry its own label`);
  for (const step of ['critical', 'high', 'medium', 'low', 'info']) {
    const r = ratio(token(`sev-${step}`), token('surface'));
    assert.ok(r >= 3, `--wqa-sev-${step} is ${r.toFixed(2)}:1 against the surface, below the 3:1 fill floor`);
  }
});
