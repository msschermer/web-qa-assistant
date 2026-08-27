import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { buildIndexControl, indexabilityState } from '../packages/environment/index-control.js';
import {
  classifyEnvironment,
  environmentNotice,
  attachEnvironmentContext,
  isNonProductionEnvironment
} from '../packages/environment/classify.js';
import { classifyHostRelationship } from '../packages/environment/hosts.js';
import { buildCanonicalContext, buildLaunchReadiness, launchIntegrityFindings } from '../packages/environment/launch-readiness.js';
import { applyFindingPolicy } from '../packages/findings/policy.js';
import { attachCorrelationMetadata } from '../packages/findings/correlation.js';
import { composeAttention } from '../packages/findings/compose.js';
import { buildEvidenceLedger } from '../packages/findings/evidence-ledger.js';
import { buildFindingReviewContext } from '../packages/frank/review-context.js';
import { presentFinding } from '../packages/presentation/present.js';

test('A rendered meta noindex is noindex-detected', () => {
  const control = buildIndexControl({ page: { robots: 'noindex,nofollow' } });
  assert.equal(control.assessment, 'noindex-detected');
  assert.equal(control.metaRobots.noindex, true);
  assert.equal(control.robotsTxt.crawlAllowed, null);
});

test('B X-Robots-Tag noindex is noindex-detected', () => {
  const control = buildIndexControl({ page: {}, xRobotsTag: 'noindex', xRobotsKnown: true });
  assert.equal(control.assessment, 'noindex-detected');
  assert.equal(control.xRobotsTag.noindex, true);
  assert.equal(control.metaRobots.noindex, false);
});

test('C robots.txt disallow only is crawl-restricted and not noindex', () => {
  const control = buildIndexControl({
    page: { robots: '' },
    robotsTxt: { globalDisallowAll: true, url: 'https://www.example.com/robots.txt', crawlAllowed: false },
    robotsTxtKnown: true
  });
  assert.equal(control.assessment, 'crawl-restricted');
  assert.equal(control.noindexDetected, false);
  const notice = environmentNotice({ type: 'staging' }, control);
  assert.match(notice.title, /robots\.txt/i);
  assert.doesNotMatch(JSON.stringify(notice), /cannot be indexed|noindex directive was detected/i);
});

test('D no blocking control is not indexable', () => {
  const control = buildIndexControl({ page: { robots: 'index,follow' }, publishedKnown: true, publishedRobots: 'index,follow' });
  assert.equal(control.assessment, 'no-blocking-control-detected');
  const compat = indexabilityState({ robots: 'index,follow' }, 'index,follow');
  assert.equal(compat.blocked, false);
  const notice = environmentNotice({ type: 'staging' }, control);
  assert.doesNotMatch(JSON.stringify(notice), /\bindexable\b/i);
  assert.match(notice.title, /No index-prevention control was detected/i);
});

test('E rendered index + published noindex is conflicting-signals', () => {
  const control = buildIndexControl({
    page: { robots: 'index,follow' },
    publishedRobots: 'noindex,nofollow',
    publishedKnown: true
  });
  assert.equal(control.assessment, 'conflicting-signals');
});

test('F rendered noindex + published index is conflicting-signals', () => {
  const control = buildIndexControl({
    page: { robots: 'noindex' },
    publishedRobots: 'index,follow',
    publishedKnown: true
  });
  assert.equal(control.assessment, 'conflicting-signals');
});

test('G missing required sources is unable-to-determine', () => {
  const control = buildIndexControl({
    page: {},
    renderedKnown: false,
    publishedKnown: false,
    xRobotsKnown: false,
    robotsTxtKnown: false
  });
  assert.equal(control.assessment, 'unable-to-determine');
  const notice = environmentNotice({ type: 'staging' }, control);
  assert.match(notice.title, /could not determine/i);
});

test('environment and index-control stay independent', () => {
  const staging = classifyEnvironment({ url: 'https://example.bigscoots-staging.com/' });
  assert.equal(staging.type, 'staging');
  assert.ok(['high', 'certain'].includes(staging.confidenceLabel));
  assert.ok(!isNonProductionEnvironment({ type: 'production' }));
  const withNoindex = attachEnvironmentContext(
    { url: 'https://example.bigscoots-staging.com/', robots: 'noindex' },
    { publishedRobots: 'noindex', publishedKnown: true }
  );
  assert.equal(withNoindex.type, 'staging');
  assert.equal(withNoindex.indexControl.assessment, 'noindex-detected');
  assert.ok(!withNoindex.signals.includes('noindex-means-staging'));
});

test('staging noindex is launch context; production noindex stays recommended', () => {
  const finding = { ruleId: 'seo.noindex', title: 'Page requests noindex', detail: 'noindex', category: 'context', severity: 'info', sources: ['browser'] };
  const stagingEnv = attachEnvironmentContext({ url: 'https://example.bigscoots-staging.com/', robots: 'noindex' }, { publishedRobots: 'noindex', publishedKnown: true });
  const staging = applyFindingPolicy([finding], stagingEnv)[0];
  assert.equal(staging.frankVisible, false);
  assert.equal(staging.presentationDisposition, 'environment-context');
  const ledger = buildEvidenceLedger({ findings: [staging] }, { uiLimit: 8, findings: [staging] });
  assert.ok(ledger.groups.some(g => g.ruleId === 'seo.noindex'));
  const attention = composeAttention([staging]);
  assert.equal(attention.groups.length, 0);
  const prod = applyFindingPolicy([finding], { type: 'production', pathname: '/' })[0];
  assert.equal(prod.frankVisible, true);
  assert.equal(prod.presentationDisposition, 'recommended');
  assert.equal(prod.frankPriority, 'blocker');
});

test('unknown + noindex remains an issue and is not called production', () => {
  const env = classifyEnvironment({ url: 'https://app.example.com/', robots: 'noindex' });
  assert.equal(env.type, 'unknown');
  const row = applyFindingPolicy([{ ruleId: 'seo.noindex', title: 'Page requests noindex', detail: 'noindex' }], env)[0];
  assert.equal(row.frankVisible, true);
  const presented = presentFinding(row, env);
  assert.doesNotMatch(presented.title + presented.summary, /production site/i);
});

test('canonical staging to production is observational, not an automatic defect', () => {
  const page = { url: 'https://example.bigscoots-staging.com/about/', canonical: 'https://www.example.com/about/' };
  const environment = classifyEnvironment(page);
  const canonical = buildCanonicalContext({ page, environment });
  assert.equal(canonical.relationshipToCurrentHost, 'related-production-host');
  assert.equal(canonical.assessment, 'observed');
  const staged = applyFindingPolicy([{
    ruleId: 'seo.canonical-cross-host',
    title: 'Canonical points to another host',
    detail: 'cross host',
    category: 'review',
    severity: 'medium'
  }], { ...environment, canonicalContext: canonical });
  assert.equal(staged[0].frankVisible, false);
  assert.equal(staged[0].presentationDisposition, 'launch-check');
});

test('canonical staging to staging is verify-before-launch', () => {
  const page = { url: 'https://example.bigscoots-staging.com/', canonical: 'https://example.bigscoots-staging.com/' };
  const environment = classifyEnvironment(page);
  const canonical = buildCanonicalContext({ page, environment });
  assert.equal(canonical.relationshipToCurrentHost, 'same-host');
  const readiness = buildLaunchReadiness({ page, environment, indexControl: { assessment: 'no-blocking-control-detected' }, canonical });
  assert.ok(readiness.items.some(item => item.id === 'canonical-staging'));
});

test('canonical currently pointing at staging host is verify-before-launch', () => {
  const page = { url: 'https://example.bigscoots-staging.com/a/', canonical: 'https://other.bigscoots-staging.com/a/' };
  const environment = classifyEnvironment(page);
  const canonical = buildCanonicalContext({ page, environment });
  assert.equal(canonical.relationshipToCurrentHost, 'related-staging-host');
  const readiness = buildLaunchReadiness({ page, environment, indexControl: {}, canonical });
  assert.ok(readiness.items.some(item => item.id === 'canonical-staging'));
});

test('production canonical to staging is high-priority', () => {
  const page = { url: 'https://www.example.com/', canonical: 'https://example.bigscoots-staging.com/' };
  const environment = { type: 'production', canonicalContext: buildCanonicalContext({ page, environment: { type: 'production' } }) };
  const row = applyFindingPolicy([{
    ruleId: 'seo.canonical-cross-host',
    title: 'Canonical points to another host',
    detail: 'staging',
    category: 'review',
    severity: 'medium'
  }], environment)[0];
  assert.equal(row.frankPriority, 'high');
  assert.equal(row.frankVisible, true);
});

test('production to staging link leakage is grouped with instances', () => {
  const page = { url: 'https://www.example.com/' };
  const environment = { type: 'production' };
  const destinations = [
    { url: 'https://example.bigscoots-staging.com/a/' },
    { url: 'https://example.bigscoots-staging.com/b/' },
    { url: 'https://example.bigscoots-staging.com/c/' },
    { url: 'https://example.bigscoots-staging.com/d/' }
  ];
  const findings = launchIntegrityFindings({ page, environment, destinations });
  assert.equal(findings.length, 1);
  assert.equal(findings[0].ruleId, 'launch.host-leakage-staging');
  assert.match(findings[0].title, /4 internal links point to a staging host/i);
  assert.equal(findings[0].count, 4);
  assert.equal(findings[0].instances.length, 4);
});

test('staging to production links are observational', () => {
  const page = { url: 'https://example.bigscoots-staging.com/', canonical: 'https://www.example.com/' };
  const environment = classifyEnvironment(page);
  const canonical = buildCanonicalContext({ page, environment });
  const readiness = buildLaunchReadiness({
    page,
    environment,
    canonical,
    indexControl: {},
    destinations: [{ url: 'https://www.example.com/contact/' }]
  });
  const item = readiness.items.find(row => row.id === 'link-staging-to-production');
  assert.ok(item);
  assert.equal(item.category, 'expected in staging');
  const findings = launchIntegrityFindings({ page, environment, canonical, destinations: [{ url: 'https://www.example.com/contact/' }] });
  assert.equal(findings.length, 0);
});

test('link review adapter distinguishes broken from unverifiable outcomes', () => {
  const broken = buildFindingReviewContext({
    id: 'navigation.link-404:1',
    ruleId: 'navigation.link-404',
    confidence: 'confirmed',
    count: 3,
    link: { url: 'https://www.example.com/missing', status: 404, internal: true, occurrences: 3, sources: [{ text: 'A' }] }
  });
  assert.equal(broken.outcome, 'confirmed-broken');
  assert.equal(broken.broken, true);
  assert.equal(broken.occurrenceCount, 3);

  const forbidden = buildFindingReviewContext({
    ruleId: 'navigation.link-review',
    confidence: 'inconclusive',
    link: { url: 'https://www.example.com/private', status: 403, internal: true, cause: 'remote-blocked' }
  });
  assert.equal(forbidden.outcome, 'remote-blocked');
  assert.equal(forbidden.broken, false);

  const limited = buildFindingReviewContext({
    ruleId: 'navigation.link-review-external',
    confidence: 'inconclusive',
    link: { url: 'https://assets.example.net/x', status: 429, internal: false, cause: 'rate-limited' }
  });
  assert.equal(limited.outcome, 'rate-limited');

  const timeout = buildFindingReviewContext({
    ruleId: 'navigation.link-timeout',
    confidence: 'inconclusive',
    link: { url: 'https://www.example.com/slow', state: 'timeout', cause: 'scanner-timeout' }
  });
  assert.equal(timeout.outcome, 'timeout');

  const opaque = buildFindingReviewContext({
    ruleId: 'navigation.link-review-external',
    confidence: 'inconclusive',
    link: { url: 'https://ads.example.net/p', internal: false, cause: 'cors-or-opaque' }
  });
  assert.equal(opaque.outcome, 'cors-opaque');
  assert.equal(opaque.broken, false);
});

test('TTFB review adapter includes measurement and staging context without claiming backend cause', () => {
  const env = classifyEnvironment({ url: 'https://example.bigscoots-staging.com/' });
  const ctx = buildFindingReviewContext({
    ruleId: 'performance.browser.ttfb',
    confidence: 'inferred',
    performanceObservation: { ttfbMs: 1948, largestContentfulPaintMs: 3200, measuredTransferCount: 42 }
  }, { environment: env });
  assert.equal(ctx.adapter, 'performance.browser.ttfb');
  assert.equal(ctx.observedTtfbMs, 1948);
  assert.equal(ctx.environment.kind, 'staging');
  assert.equal(ctx.claims.measuredSlowResponse, true);
  assert.equal(ctx.claims.confirmedBackendRootCause, false);
});

test('12 equivalent blank-opener instances collapse to one group', () => {
  const rows = attachCorrelationMetadata(Array.from({ length: 12 }, (_, i) => ({
    id: `security.blank-opener:${i}`,
    ruleId: 'security.blank-opener',
    title: 'New-tab link can retain opener access',
    detail: 'missing noopener',
    category: 'review',
    severity: 'low',
    confidence: 'confirmed',
    frankVisible: true,
    selector: `a#n${i}`,
    count: 1
  })));
  const attention = composeAttention(rows);
  const group = attention.allGroups.find(g => /blank-opener/.test(g.lead.ruleId));
  assert.equal(group.size, 12);
  assert.equal(group.instanceCount, 12);
  assert.match(group.title, /12 links open new tabs without opener protection/);
});

test('Frank still receives all material groups plus environment context', () => {
  const findings = Array.from({ length: 20 }, (_, i) => ({
    id: `g${i}`,
    ruleId: `impl.rule-${i}`,
    title: `Issue ${i}`,
    detail: 'observed',
    category: 'fix',
    severity: 'high',
    confidence: 'confirmed',
    frankVisible: true,
    impactClass: i % 2 ? 'accessibility' : 'implementation',
    count: 1
  }));
  const attention = composeAttention(findings, { limit: 8 });
  assert.equal(attention.groups.length, 8);
  assert.equal(attention.allGroups.length, 20);
  const ledger = buildEvidenceLedger({ findings }, { uiLimit: 8, composition: attention, findings });
  assert.equal(ledger.groups.length, 20);
  const env = attachEnvironmentContext({ url: 'https://example.bigscoots-staging.com/', robots: 'noindex' }, {
    publishedRobots: 'index,follow',
    publishedKnown: true
  });
  assert.equal(env.indexControl.assessment, 'conflicting-signals');
  const ctx = buildFindingReviewContext({ ruleId: 'seo.noindex', title: 'noindex' }, {
    environment: env,
    instances: findings.slice(0, 3),
    selectedInstanceId: findings[1].id,
    groupCount: 3
  });
  assert.equal(ctx.environment.kind, 'staging');
  assert.equal(ctx.indexControl.assessment, 'conflicting-signals');
  assert.ok(ctx.launchReadiness?.length || ctx.environment.launchReadiness?.length);
});

test('false-positive language is rejected for incomplete evidence', () => {
  const open = environmentNotice({ type: 'staging' }, { assessment: 'no-blocking-control-detected' });
  assert.doesNotMatch(JSON.stringify(open), /Page is indexable|does not appear to block search indexing/i);
  const crawl = environmentNotice({ type: 'staging' }, { assessment: 'crawl-restricted' });
  assert.doesNotMatch(JSON.stringify(crawl), /cannot be indexed/i);
  const unknown = environmentNotice({ type: 'unknown' }, { assessment: 'noindex-detected' });
  assert.doesNotMatch(JSON.stringify(unknown), /Production site/i);
  const link = buildFindingReviewContext({
    ruleId: 'navigation.link-review',
    confidence: 'inconclusive',
    link: { url: 'https://www.example.com/x', status: 0, cause: 'cors-or-opaque' }
  });
  assert.notEqual(link.outcome, 'confirmed-broken');
  assert.equal(link.broken, false);
  const source = [
    fs.readFileSync('packages/environment/index-control.js', 'utf8'),
    fs.readFileSync('packages/environment/classify.js', 'utf8')
  ].join('\n');
  assert.doesNotMatch(source, /This non-production site does not appear to block search indexing/);
  assert.doesNotMatch(source, /this staging site is indexable/i);
});

test('production conflicting-signals stay a production issue, not an unknown-environment banner', () => {
  const notice = environmentNotice({ type: 'production' }, { assessment: 'conflicting-signals' });
  assert.equal(notice.kind, 'production-index-blocked');
  assert.doesNotMatch(notice.title, /could not be classified/i);
});

test('robots none token is treated as noindex-detected', () => {
  const control = buildIndexControl({ page: { robots: 'none' } });
  assert.equal(control.assessment, 'noindex-detected');
  assert.equal(control.metaRobots.noindex, true);
});

test('host classifier distinguishes target, related, staging, and third-party', () => {
  const pageUrl = 'https://www.example.com/';
  assert.equal(classifyHostRelationship('https://www.example.com/a', { pageUrl, environmentType: 'production' }).class, 'target-origin');
  assert.equal(classifyHostRelationship('https://blog.example.com/a', { pageUrl, environmentType: 'production' }).class, 'same-site');
  assert.equal(classifyHostRelationship('https://example.bigscoots-staging.com/a', { pageUrl, environmentType: 'production' }).class, 'staging-host');
  assert.equal(classifyHostRelationship('https://static.example.net/a', { pageUrl, environmentType: 'production' }).class, 'third-party');
});
