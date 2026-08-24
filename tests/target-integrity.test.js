import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  TARGET_STATES,
  assessTargetIntegrity,
  collectDomSignals,
  suppressFindingsForTargetIntegrity,
  adjustCoverageForTargetIntegrity,
  targetIntegrityBlocksAudit,
  targetIntegrityLimitsAudit,
  targetIntegrityReached
} from '../packages/integrity/target-integrity.js';
import { applyTargetIntegrityReport, finalizeBlockedTargetReport } from '../packages/integrity/apply-report.js';
import { deterministicBrief } from '../packages/findings/correlate.js';

const cloudflareHtml = fs.readFileSync('fixtures/interstitial/cloudflare-challenge.html', 'utf8');
const normalCdnHtml = fs.readFileSync('fixtures/interstitial/cdn-normal-page.html', 'utf8');

test('detects Cloudflare-style challenge interstitial from multi-signal evidence', () => {
  const integrity = assessTargetIntegrity({
    requestedUrl: 'https://example.com/',
    finalUrl: 'https://example.com/',
    title: 'Attention Required! | Cloudflare',
    httpStatus: 403,
    linkCount: 1,
    interactiveCount: 2,
    html: cloudflareHtml,
    bodyText: 'Checking your browser before accessing the site.'
  });
  assert.equal(integrity.state, TARGET_STATES.PROBABLE_INTERSTITIAL);
  assert.ok(integrity.signals.includes('challenge-title'));
  assert.ok(integrity.signals.some(s => s.startsWith('cloudflare-challenge')));
  assert.equal(targetIntegrityBlocksAudit(integrity), true);
});

test('normal CDN-hosted editorial page remains reached when only vendor markers appear in comments', () => {
  const integrity = assessTargetIntegrity({
    requestedUrl: 'https://example.com/',
    finalUrl: 'https://example.com/',
    title: 'Sample Workspace | Neutral QA Fixture',
    httpStatus: 200,
    linkCount: 12,
    interactiveCount: 20,
    html: normalCdnHtml,
    bodyText: 'Sample Workspace Neutral fixture content'
  });
  assert.equal(integrity.state, TARGET_STATES.REACHED);
  assert.equal(targetIntegrityReached(integrity), true);
  assert.equal(targetIntegrityBlocksAudit(integrity), false);
});

test('vendor CDN comment alone does not classify as interstitial', () => {
  const signals = collectDomSignals({ html: normalCdnHtml, bodyText: 'Sample Workspace' });
  assert.equal(signals.length, 0);
});

test('suppresses page-derived findings for probable interstitial targets', () => {
  const integrity = { state: TARGET_STATES.PROBABLE_INTERSTITIAL };
  const findings = [
    { ruleId: 'seo.noindex', title: 'Page requests noindex' },
    { ruleId: 'correlation.title-mismatch', title: 'Rendered and published titles differ' },
    { ruleId: 'coverage.custom', title: 'Scanner executed' }
  ];
  const kept = suppressFindingsForTargetIntegrity(findings, integrity);
  assert.deepEqual(kept.map(f => f.ruleId), ['coverage.custom']);
});

test('marks substituted-target coverage honestly instead of complete-with-zero-links', () => {
  const integrity = { state: TARGET_STATES.PROBABLE_INTERSTITIAL };
  const coverage = adjustCoverageForTargetIntegrity(
    { browser: 'complete', links: 'complete', axe: 'complete', performance: 'current-page' },
    { checked: 0 },
    integrity
  );
  assert.equal(coverage.browser, 'substituted');
  assert.equal(coverage.links, 'not_applicable');
  assert.equal(coverage.axe, 'not_applicable');
  assert.equal(coverage.performance, 'not_applicable');
  assert.equal(coverage.target, TARGET_STATES.PROBABLE_INTERSTITIAL);
});

test('distinguishes zero checked links on reached pages from substituted-target not applicable', () => {
  const reached = adjustCoverageForTargetIntegrity(
    { browser: 'complete', links: 'complete', axe: 'complete' },
    { checked: 0 },
    { state: TARGET_STATES.REACHED }
  );
  assert.equal(reached.links, 'none_checked');

  const substituted = adjustCoverageForTargetIntegrity(
    { browser: 'complete', links: 'complete', axe: 'complete' },
    { checked: 0 },
    { state: TARGET_STATES.PROBABLE_INTERSTITIAL }
  );
  assert.equal(substituted.links, 'not_applicable');
});

test('applyTargetIntegrityReport withholds SEO conclusions for challenge HTML', () => {
  const report = applyTargetIntegrityReport({
    page: {
      url: 'https://example.com/',
      requestedUrl: 'https://example.com/',
      title: 'Attention Required! | Cloudflare',
      linkCount: 1,
      interactiveCount: 2
    },
    findings: [
      { ruleId: 'seo.noindex', title: 'Page requests noindex', category: 'fix', severity: 'high' },
      { ruleId: 'correlation.robots-mismatch', title: 'Rendered and published robots directives differ', category: 'fix', severity: 'high' }
    ],
    coverage: { browser: 'complete', links: 'complete', axe: 'complete' },
    linkAudit: { checked: 0 }
  }, { requestedUrl: 'https://example.com/', html: cloudflareHtml });

  assert.equal(report.page.targetIntegrity.state, TARGET_STATES.PROBABLE_INTERSTITIAL);
  assert.equal(report.findings.length, 0);
  assert.equal(report.targetIntegrityBlocked, true);
  assert.match(report.priorityBrief, /could not confirm it reached the requested page/i);
  assert.equal(report.coverage.links, 'not_applicable');
});

test('deterministic brief uses target-integrity message instead of SEO ordering when blocked', () => {
  const text = deterministicBrief(
    [{ ruleId: 'seo.noindex', title: 'Production page requests noindex', category: 'fix', severity: 'critical', frankVisible: true }],
    { targetIntegrity: { state: TARGET_STATES.PROBABLE_INTERSTITIAL } }
  );
  assert.match(text, /withheld/i);
  assert.doesNotMatch(text, /noindex/i);
});

test('generic 403 without challenge DOM is blocked and withholds page-derived QA', () => {
  const integrity = assessTargetIntegrity({
    requestedUrl: 'https://example.com/private',
    finalUrl: 'https://example.com/private',
    title: '403 Forbidden',
    httpStatus: 403,
    linkCount: 2,
    interactiveCount: 4,
    html: '<html><body><h1>403 Forbidden</h1><p>You do not have access.</p></body></html>',
    bodyText: '403 Forbidden You do not have access.'
  });
  assert.equal(integrity.state, TARGET_STATES.BLOCKED);
  assert.equal(targetIntegrityLimitsAudit(integrity), true);
  assert.equal(suppressFindingsForTargetIntegrity([{ ruleId: 'seo.noindex', title: 'noindex' }], integrity).length, 0);
});

test('content-rich page with lone challenge-platform script stays reached', () => {
  const integrity = assessTargetIntegrity({
    requestedUrl: 'https://example.com/',
    finalUrl: 'https://example.com/',
    title: 'Sample Workspace | Neutral QA Fixture',
    httpStatus: 200,
    linkCount: 12,
    interactiveCount: 20,
    html: `${normalCdnHtml}\n<script src="/cdn-cgi/challenge-platform/scripts/jsd/main.js"></script>`,
    bodyText: 'Sample Workspace Neutral fixture content'
  });
  assert.equal(integrity.state, TARGET_STATES.REACHED);
});

test('thin challenge-only page with lone challenge-platform script stays inconclusive or interstitial', () => {
  const integrity = assessTargetIntegrity({
    requestedUrl: 'https://example.com/',
    finalUrl: 'https://example.com/',
    title: 'Example Site',
    httpStatus: 200,
    linkCount: 1,
    interactiveCount: 2,
    html: '<script src="/cdn-cgi/challenge-platform/scripts/jsd/main.js"></script>',
    bodyText: 'Checking your browser before accessing the site.'
  });
  assert.notEqual(integrity.state, TARGET_STATES.REACHED);
  assert.ok([TARGET_STATES.INCONCLUSIVE, TARGET_STATES.PROBABLE_INTERSTITIAL].includes(integrity.state));
});

test('normal Turnstile widget on content-rich page stays reached', () => {
  const integrity = assessTargetIntegrity({
    requestedUrl: 'https://example.com/login',
    finalUrl: 'https://example.com/login',
    title: 'Sign in | Sample Workspace',
    httpStatus: 200,
    linkCount: 10,
    interactiveCount: 16,
    html: `${normalCdnHtml}<div class="cf-turnstile" data-sitekey="example"></div>`,
    bodyText: 'Sample Workspace Sign in Email Password'
  });
  assert.equal(integrity.state, TARGET_STATES.REACHED);
});

test('inconclusive integrity suppresses page-derived findings and marks coverage incomplete', () => {
  const integrity = { state: TARGET_STATES.INCONCLUSIVE };
  const findings = suppressFindingsForTargetIntegrity([
    { ruleId: 'seo.noindex', title: 'Page requests noindex' }
  ], integrity);
  assert.equal(findings.length, 0);
  const coverage = adjustCoverageForTargetIntegrity(
    { browser: 'complete', links: 'complete', axe: 'complete' },
    { checked: 0 },
    integrity
  );
  assert.equal(coverage.browser, 'inconclusive');
  assert.equal(coverage.links, 'inconclusive');
  assert.equal(coverage.target, TARGET_STATES.INCONCLUSIVE);
  assert.equal(targetIntegrityLimitsAudit(integrity), true);
  assert.equal(targetIntegrityBlocksAudit(integrity), false);
});

test('finalizeBlockedTargetReport withholds findings for probable interstitial targets', () => {
  const finalized = finalizeBlockedTargetReport({
    page: { targetIntegrity: { state: TARGET_STATES.PROBABLE_INTERSTITIAL } },
    coverage: { browser: 'complete', links: 'complete', axe: 'complete' },
    linkAudit: { checked: 0 }
  }, [{ ruleId: 'seo.noindex', title: 'Page requests noindex', category: 'fix', severity: 'high' }]);
  assert.equal(finalized.coverage.browser, 'substituted');
  assert.equal(finalized.coverage.links, 'not_applicable');
  assert.equal(finalized.findings.length, 0);
});

test('finalizeBlockedTargetReport preserves normal findings for reached targets', () => {
  const finalized = finalizeBlockedTargetReport({
    page: { targetIntegrity: { state: TARGET_STATES.REACHED } },
    coverage: { browser: 'complete', links: 'complete', axe: 'complete' },
    linkAudit: { checked: 4 }
  }, [{ ruleId: 'web.duplicate-id', title: 'Duplicate element ID', category: 'fix', severity: 'medium' }]);
  assert.equal(finalized.findings.length, 1);
  assert.equal(finalized.targetIntegrityBlocked, undefined);
});
