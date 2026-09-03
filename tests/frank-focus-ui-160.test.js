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
  const packageJson = fs.readFileSync('package.json', 'utf8');
  assert.match(packageJson, /tailwindcss/);
  const lumen = fs.readFileSync('packages/ui/lumen.css', 'utf8');
  assert.match(lumen, /@theme/);
  assert.match(lumen, /tailwindcss/);
  assert.doesNotMatch(panelHtml, /class="[^"]*\bflex\s+(?:flex-col|items-|justify-|px-|py-)/);
});
