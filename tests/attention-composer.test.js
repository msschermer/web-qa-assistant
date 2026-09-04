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
  assert.match(brief, /were not counted as broken links/i);
});

test('multiple confirmed broken links cluster at the top ahead of unrelated lower-priority classes', () => {
  const brokenLinks = [...Array(3)].map((_, i) => ({
    ...brokenLink(),
    id: `navigation.link-404:${i}`,
    link: { ...brokenLink().link, url: `https://example.com/dead-${i}/`, prominence: 'normal' },
    frankPriority: 'high' // the real policy.js mapping for a confirmed 404, not the 'blocker' test shorthand
  }));
  const findings = [noindex(), slowLcp(), ...brokenLinks];
  const composition = composeAttention(findings, { limit: 8 });
  const classes = composition.groups.map(g => g.impactClass);
  assert.deepEqual(classes.slice(0, 3), ['availability', 'availability', 'availability'],
    'all three confirmed broken links lead the brief, not just the single best-scoring one');
});

test('prominent navigation raises materiality over an equivalent body link', () => {
  const navLink = brokenLink();
  const bodyLink = { ...brokenLink(), frankPriority: 'high', link: { ...brokenLink().link, prominence: 'normal' } };
  assert.ok(materialityScore(navLink) > materialityScore(bodyLink));
});

// --- The heading and the sentence beneath it count the same thing ----------

test('the brief and the panel heading are composed from one grouping', () => {
  // The real defect: a scan printed "8 issues need attention" as its heading
  // and "10 issues need attention across 5 areas" as the sentence directly
  // under it. The heading read `attention.materialGroupCount` from the
  // composition made when the scan finished; the brief was recomposed later,
  // from a finding set that had moved on. Whichever number is right, the
  // product may not print both.
  const findings = [
    brokenLink(),
    ...Array.from({ length: 6 }, (_, i) => axeFinding(i)),
    ...Array.from({ length: 4 }, (_, i) => axeFinding(i, `seo.rule-${i}`))
  ];
  const composition = composeAttention(findings, { limit: 8 });
  const brief = composedBrief(composition, {});

  // The count the UI shows is the count the sentence states, and it is the
  // real total rather than the display cap.
  assert.ok(composition.materialGroupCount >= composition.groups.length,
    'the total may not be smaller than the page of it that is displayed');
  const stated = brief.match(/^(?:One issue needs|(\d+) issues need) attention/);
  assert.ok(stated, `the brief should open with a count, got: ${brief}`);
  const statedCount = stated[1] ? Number(stated[1]) : 1;
  assert.equal(statedCount, composition.materialGroupCount,
    'the brief must state the composition it was given, not a re-grouping of its own');

  // And a display cap never becomes the reported total.
  const capped = composeAttention(findings, { limit: 2 });
  assert.equal(capped.materialGroupCount, composition.materialGroupCount,
    'lowering the display limit must not change how many issues are reported to exist');
  assert.equal(capped.groups.length, 2, 'the limit still caps what is displayed');
  assert.equal(composedBrief(capped, {}).match(/^(\d+) issues need attention/)[1],
    String(composition.materialGroupCount),
    'the brief reports the total even when the list beneath it is capped');
});
