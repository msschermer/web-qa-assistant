import test from 'node:test';
import assert from 'node:assert/strict';
import { composeAttention, composedBrief, groupFindings } from '../packages/findings/compose.js';
import { impactClassFor, materialityScore } from '../packages/findings/impact.js';

function axeFinding(n, ruleId = 'axe.image-alt') {
  return {
    id: `${ruleId}:${n}`, ruleId, title: 'Images must have alternative text',
    detail: 'An image has no alt attribute.', category: 'fix', severity: 'high',
    confidence: 'confirmed', frankPriority: 'high', frankVisible: true,
    selector: `img.icon-${n}`, sources: ['axe'], count: 1
  };
}
function brokenLink() {
  return {
    id: 'navigation.link-404:a', ruleId: 'navigation.link-404',
    title: 'Internal link points to a missing page',
    detail: '"Team Profile" points to /team-profile/. Independent browser requests confirmed HTTP 404.',
    category: 'fix', severity: 'high', confidence: 'confirmed', frankPriority: 'blocker', frankVisible: true,
    sources: ['browser'], link: { url: 'https://example.com/team-profile/', status: 404, prominence: 'navigation', text: 'Team Profile' }
  };
}
function noindex() {
  return {
    id: 'seo.noindex:a', ruleId: 'seo.noindex', title: 'Production page requests noindex',
    detail: 'This production page publishes a noindex directive.', category: 'fix', severity: 'critical',
    confidence: 'confirmed', frankPriority: 'blocker', frankVisible: true, sources: ['meta-state']
  };
}
function slowLcp() {
  return {
    id: 'performance.browser.lcp:a', ruleId: 'performance.browser.lcp',
    title: 'Largest contentful paint is slow in this browser', detail: 'LCP observed at 5.2s.',
    category: 'review', severity: 'medium', confidence: 'inferred', frankPriority: 'medium',
    frankVisible: true, sources: ['browser-performance']
  };
}

test('impact classes route findings by what they threaten, not by which tool found them', () => {
  assert.equal(impactClassFor(brokenLink()), 'availability');
  assert.equal(impactClassFor(noindex()), 'discoverability');
  assert.equal(impactClassFor(axeFinding(1)), 'accessibility');
  assert.equal(impactClassFor(slowLcp()), 'performance');
  assert.equal(impactClassFor({ ruleId: 'x', confidence: 'inconclusive' }), 'coverage');
});

// The core product defect from acceptance testing: five axe rows occupied the
// whole brief and a confirmed 404 never surfaced.
test('a confirmed broken link is not crowded out by five accessibility findings', () => {
  const findings = [...Array(5)].map((_, i) => axeFinding(i)).concat(brokenLink());
  const composition = composeAttention(findings);
  const classes = composition.groups.map(g => g.impactClass);
  assert.ok(classes.includes('availability'), 'availability must appear in the composed feed');
  assert.equal(classes[0], 'availability', 'the blocker outranks the accessibility group');
  assert.ok(classes.indexOf('accessibility') > 0);
});

test('repeated instances of one rule collapse into a single group with a count', () => {
  const findings = [...Array(6)].map((_, i) => axeFinding(i));
  const composition = composeAttention(findings);
  assert.equal(composition.groups.length, 1, 'six instances of one rule are one problem');
  assert.equal(composition.groups[0].instanceCount, 6);
  assert.match(composition.groups[0].title, /\(6 instances\)/);
  assert.equal(composition.groups[0].selectors.length, 6, 'every affected element stays addressable');
});

test('two different broken destinations stay separate problems', () => {
  const a = brokenLink();
  const b = { ...brokenLink(), id: 'navigation.link-404:b', link: { ...brokenLink().link, url: 'https://example.com/other/' } };
  assert.equal(groupFindings([a, b]).length, 2);
});

test('every represented class contributes before any class contributes twice', () => {
  const findings = [
    ...[...Array(8)].map((_, i) => axeFinding(i)),
    ...[...Array(3)].map((_, i) => axeFinding(i, 'axe.color-contrast')),
    brokenLink(), noindex(), slowLcp()
  ];
  const composition = composeAttention(findings);
  const seen = new Set();
  let firstRepeatAt = composition.groups.length;
  composition.groups.forEach((g, i) => {
    if (seen.has(g.impactClass) && i < firstRepeatAt) firstRepeatAt = i;
    seen.add(g.impactClass);
  });
  assert.ok(firstRepeatAt >= composition.representedClasses.length,
    'a class repeats only after every represented class has appeared once');
});

test('classes with nothing material are never padded into the feed', () => {
  const composition = composeAttention([axeFinding(1)]);
  assert.deepEqual(Object.keys(composition.classCounts), ['accessibility']);
  assert.equal(composition.groups.length, 1);
});

test('inconclusive and context findings never enter the composed feed', () => {
  const composition = composeAttention([
    { id: 'a', ruleId: 'x', category: 'fix', confidence: 'inconclusive', frankVisible: true },
    { id: 'b', ruleId: 'y', category: 'context', confidence: 'confirmed', frankVisible: true },
    { id: 'c', ruleId: 'z', category: 'fix', confidence: 'confirmed', frankVisible: false },
    brokenLink()
  ]);
  assert.equal(composition.groups.length, 1);
  assert.equal(composition.groups[0].impactClass, 'availability');
});

test('the brief reads across areas instead of leading with the noisiest one', () => {
  const findings = [...Array(5)].map((_, i) => axeFinding(i)).concat(brokenLink(), slowLcp());
  const brief = composedBrief(composeAttention(findings), { linkAudit: { checked: 20, inconclusive: 0 } });
  assert.match(brief, /3 issues need attention across 3 areas/);
  assert.match(brief, /missing page/i, 'the broken destination leads the brief');
});

test('the brief keeps unverified links as coverage rather than defects', () => {
  const brief = composedBrief(composeAttention([]), { linkAudit: { checked: 12, inconclusive: 2 } });
  assert.match(brief, /2 of 12/);
  assert.match(brief, /not count those URLs as broken links/i);
});

test('prominent navigation raises materiality over an equivalent body link', () => {
  const navLink = brokenLink();
  const bodyLink = { ...brokenLink(), frankPriority: 'high', link: { ...brokenLink().link, prominence: 'normal' } };
  assert.ok(materialityScore(navLink) > materialityScore(bodyLink));
});
