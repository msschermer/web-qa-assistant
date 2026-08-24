import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const panelHtml = fs.readFileSync('apps/extension/sidepanel.html', 'utf8');
const panelJs = fs.readFileSync('apps/extension/sidepanel.js', 'utf8');
const panelCss = fs.readFileSync('apps/extension/sidepanel.css', 'utf8');
const content = fs.readFileSync('apps/extension/content.js', 'utf8');
const tokens = fs.readFileSync('packages/ui/tokens.css', 'utf8');

test('sidebar is the deterministic evidence ledger, not a duplicate Frank narrative card', () => {
  assert.match(panelHtml, /Evidence ledger/);
  assert.match(panelHtml, /id="frank-facts"/);
  assert.match(panelHtml, /Evidence for this step/);
  assert.match(panelHtml, /Full evidence record/);
  assert.doesNotMatch(panelHtml, /id="frank-step-headline"|id="frank-step-body"/);
  assert.match(panelJs, /renderFrankEvidenceLedger/);
  assert.match(panelJs, /Verification attempts/);
  assert.match(panelJs, /Sources/);
});

test('center focus card owns Frank explanation and walkthrough navigation', () => {
  assert.match(content, /textContent = step\.headline/);
  assert.match(content, /textContent = step\.body/);
  assert.match(content, /aria-live="polite" aria-atomic="true"/);
  assert.match(content, /aria-labelledby="frank-coach-title"/);
  assert.match(content, /pointer-events:auto/);
  assert.match(content, /Back/);
  assert.match(content, /Next/);
  assert.match(content, /Done/);
  assert.doesNotMatch(content, /orientation only/i);
});

test('focus mode keeps the real target visible and positions Frank around it', () => {
  assert.match(content, /getBoundingClientRect\(\)/);
  assert.match(content, /positions/);
  assert.match(content, /spotlight/);
  assert.match(content, /backdrop/);
  assert.match(content, /Math\.min/);
});

test('current-step evidence can be visually traced back to Frank reasoning', () => {
  assert.match(panelJs, /activeIds/);
  assert.match(panelJs, /row\.dataset\.active/);
  assert.match(panelCss, /evidence-row\[data-active=(?:"true"|true)\]/);
});

test('1.6 visual identity strengthens Frank without adding Tailwind build debt', () => {
  assert.match(tokens, /--wqa-accent:/);
  assert.match(tokens, /--wqa-accent-soft:/);
  assert.match(panelCss, /linear-gradient/);
  assert.match(content, /linear-gradient/);
  const packageJson = fs.readFileSync('package.json', 'utf8');
  assert.doesNotMatch(packageJson, /tailwind/i);
});
