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

test('Lumen visual identity compiles Tailwind from component classes rather than utility soup', () => {
  assert.match(tokens, /--wqa-accent:/);
  assert.match(tokens, /--wqa-accent-soft:/);
  // The operator took the standing exit from the direction round: the product
  // now follows the category standard, with one indigo primary carrying the
  // product voice. Still pinned, so the identity cannot drift silently.
  assert.match(tokens, /--wqa-brand:#4F46E5/);
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
  assert.match(content, /\.badge\.sev-low\{background:var\(--sa-warn-soft\);color:var\(--sa-warn\)/);
});
