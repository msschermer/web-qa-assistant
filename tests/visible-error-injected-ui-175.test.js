import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { guidanceFor } from '../packages/frank/guidance.js';
import { impactClassFor } from '../packages/findings/impact.js';
import { applyFindingPolicy } from '../packages/findings/policy.js';

const root = path.resolve('apps/extension');

test('Web QA page injections are namespaced in content.js', () => {
  const src = fs.readFileSync(path.join(root, 'content.js'), 'utf8');
  assert.match(src, /data-webqa-ui/);
  assert.match(src, /data-webqa-overlay/);
  assert.match(src, /data-webqa-highlight/);
  assert.match(src, /cleanupInjectedUi/);
  assert.match(src, /injectedUiSnapshot/);
  assert.doesNotMatch(src, /ERROR fo|Invalid do/);
  // Cleanup must not indiscriminately remove arbitrary fixed page UI.
  assert.doesNotMatch(src, /querySelectorAll\(['"][^'"]*fixed[^'"]*['"]\)\.forEach\([^)]*remove/);
});

test('visible error findings outrank low-value TTFB diagnostics in policy', () => {
  const rows = applyFindingPolicy([
    {
      ruleId: 'runtime.visible-error',
      title: 'Visible error',
      detail: 'Invalid domain',
      category: 'fix',
      severity: 'high',
      confidence: 'confirmed',
      visibleError: { messageExcerpt: 'Invalid domain', firstObservedPhase: 'initial-scan' }
    },
    {
      ruleId: 'performance.browser.ttfb',
      title: 'TTFB',
      detail: 'slow',
      category: 'review',
      severity: 'medium',
      confidence: 'inferred',
      performanceObservation: { ttfbMs: 1900, largestContentfulPaintMs: 2000, firstContentfulPaintMs: 1200 }
    }
  ], {
    type: 'staging',
    performanceAssessment: { ttfbPresentation: 'diagnostic' }
  });
  const visible = rows.find(r => r.ruleId === 'runtime.visible-error');
  const ttfb = rows.find(r => r.ruleId === 'performance.browser.ttfb');
  assert.equal(visible.frankVisible, true);
  assert.equal(visible.frankPriority, 'high');
  assert.equal(impactClassFor(visible), 'availability');
  assert.equal(ttfb.frankVisible, false);
});

test('browser-rules visible-error detector requires corroboration patterns', () => {
  const src = fs.readFileSync(path.join('packages/rules/browser-rules.js'), 'utf8');
  assert.match(src, /function visibleErrorFindings/);
  assert.match(src, /role="alert"/);
  assert.match(src, /Require corroboration: text alone is never enough/);
  assert.match(src, /runtime\.visible-error/);
});

test('Frank guidance source labels distinguish deterministic fallback', () => {
  const g = guidanceFor({ ruleId: 'performance.browser.ttfb', performanceObservation: { ttfbMs: 2000 } });
  assert.ok(g.interpretation);
  const side = fs.readFileSync(path.join(root, 'sidepanel.js'), 'utf8');
  assert.match(side, /Verified guidance/);
  assert.match(side, /guidanceSource === 'frank-model'/);
  const content = fs.readFileSync(path.join(root, 'content.js'), 'utf8');
  assert.match(content, /Verified guidance/);
  assert.match(content, /Page-level performance observation/);
});
