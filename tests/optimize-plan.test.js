import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { buildOptimizePlan, causeOf, inferSiteModel, resolveSiteModel, normalizePlanInputs, PRIORITY_GROUPS, CAUSE_RULES } from '../packages/findings/optimize-plan.js';

const group = (rule_id, over = {}) => ({
  rule_id, title: rule_id, category: 'fix', severity: 'medium', confidence: 'confirmed',
  impact_class: 'quality', instances: 1, affected_urls: 1, ...over
});

test('every rule lands in exactly one cause, and nothing falls through', () => {
  // A taxonomy with holes drops findings quietly on the way into the plan, and
  // a plan that silently omits work is worse than no plan.
  const ids = ['navigation.link-404', 'structure.orphan-page', 'seo.canonical-missing', 'schema.invalid-json',
    'seo.title-long', 'content.generic-link-text', 'structure.heading-skip', 'structure.image-alt-missing',
    'axe.color-contrast', 'performance.lcp-slow', 'security.hsts-missing', 'runtime.visible-error',
    'seo.hreflang-missing', 'something.completely.unknown'];
  for (const id of ids) assert.ok(causeOf(id), `${id} has no cause`);
  assert.equal(causeOf('something.completely.unknown'), 'other-quality', 'the catch-all exists');
  // Every cause a group claims must be a cause that exists, or work vanishes.
  const known = new Set(CAUSE_RULES.map(([id]) => id));
  for (const g of PRIORITY_GROUPS) for (const c of g.causes) assert.ok(known.has(c), `${c} is claimed by ${g.id} but is not a cause`);
  // And every cause must be claimed by exactly one group.
  const claimed = PRIORITY_GROUPS.flatMap((g) => g.causes);
  assert.equal(new Set(claimed).size, claimed.length, 'a cause claimed twice would duplicate work');
  for (const c of known) assert.ok(claimed.includes(c), `${c} is a cause no priority group owns`);
});

test('the plan sequences by dependency and says what each group unblocks', () => {
  const plan = buildOptimizePlan({
    groups: [group('navigation.link-404', { severity: 'high', instances: 20, affected_urls: 10 }), group('seo.title-long', { instances: 3 })],
    urlCounts: { fetched: 10 }
  });
  assert.equal(plan.priorities[0].id, 'integrity', 'integrity is sequenced first');
  assert.equal(plan.priorities[1].id, 'templates');
  // The reason is the point. An order without one is an assertion.
  for (const p of plan.priorities) assert.ok(p.unblocks && p.unblocks.length > 40, `${p.id} must say what it unblocks`);
  // And the last group must say that last is not least, or a reader will read
  // the sequence as a ranking and deprioritise a confirmed high-severity fault.
  const last = PRIORITY_GROUPS[PRIORITY_GROUPS.length - 1];
  assert.match(last.unblocks, /not being least important/);
});

test('every action carries the rules, counts and confidence behind it', () => {
  const plan = buildOptimizePlan({
    groups: [
      group('navigation.link-404', { severity: 'high', instances: 20, affected_urls: 10, confidence: 'confirmed' }),
      group('navigation.fragment-missing', { severity: 'high', instances: 5, affected_urls: 4, confidence: 'inferred' })
    ],
    urlCounts: { fetched: 10 }
  });
  const action = plan.priorities[0].actions[0];
  assert.deepEqual(action.evidence.ruleIds.sort(), ['navigation.fragment-missing', 'navigation.link-404']);
  assert.equal(action.evidence.findings, 25);
  // The weakest confidence in the group, not the strongest: a cluster is only as
  // established as its least established member.
  assert.equal(action.evidence.confidence, 'inferred');
  assert.equal(action.evidence.severity, 'high');
  assert.ok(action.verify, 'an action a reader cannot verify is advice');
  for (const row of action.evidence.titles) assert.ok(row.ruleId && row.title);
});

test('informational observations are excluded from the work and counted where the reader can see it', () => {
  // Recording that a site uses GA4 is worth knowing and is not a job. Letting it
  // become a priority fills the plan with work that does not exist; dropping it
  // silently makes the totals impossible to reconcile against Findings.
  const plan = buildOptimizePlan({
    groups: [
      group('navigation.link-404', { severity: 'high', instances: 20, affected_urls: 10 }),
      group('analytics.detected', { severity: 'info', category: 'context', instances: 10, affected_urls: 10 })
    ],
    urlCounts: { fetched: 10 }
  });
  assert.equal(plan.totals.findings, 30, 'the total still counts everything');
  assert.equal(plan.totals.actionableFindings, 20);
  assert.equal(plan.informational.findings, 10);
  assert.deepEqual(plan.informational.rules, ['analytics.detected']);
  assert.equal(plan.totals.actionableFindings + plan.informational.findings, plan.totals.findings, 'the two must add back up');
  const sequenced = plan.priorities.flatMap((p) => p.actions).flatMap((a) => a.evidence.ruleIds);
  assert.ok(!sequenced.includes('analytics.detected'));
});

test('an info-severity finding that is still a fix is sequenced', () => {
  // The exclusion is for observations, not for low severity. A fix is work
  // however quietly the scanner rates it.
  const plan = buildOptimizePlan({
    groups: [group('seo.title-long', { severity: 'info', category: 'fix', instances: 2 })],
    urlCounts: { fetched: 5 }
  });
  assert.equal(plan.informational.patterns, 0);
  assert.equal(plan.totals.actionableFindings, 2);
});

test('coverage limits travel with the plan', () => {
  const plan = buildOptimizePlan({
    groups: [group('navigation.link-404')],
    urlCounts: { fetched: 10, queued: 183 },
    renderProgress: { rendered: 0, total: 10 },
    schema: { types: [] }
  });
  const codes = plan.coverage.limits.map((l) => l.code).sort();
  assert.deepEqual(codes, ['browser-checks-unrun', 'pages-uncrawled', 'schema-absent']);
  assert.equal(plan.coverage.uncrawled, 183);
  // Unrun browser checks are absent evidence, never a clean result.
  const browser = plan.coverage.limits.find((l) => l.code === 'browser-checks-unrun');
  assert.match(browser.text, /absent from it, not clear/);
});

test('the site model is read from published markup, and left unset when there is none', () => {
  const legal = inferSiteModel({ types: [{ type: 'LegalService', pages: 12, items: 12 }] });
  assert.equal(legal.established, true);
  assert.equal(legal.label, 'Legal practice');
  // Corroborated, not confirmed: the markup is confirmed, that it means the site
  // *is* that kind of business is a reading of it.
  assert.equal(legal.confidence, 'corroborated');
  assert.match(legal.basis, /structured data/);
  assert.match(legal.basis, /Confirm it/);

  const none = inferSiteModel({ types: [] });
  assert.equal(none.established, false);
  assert.equal(none.confidence, 'inconclusive');
  // The one thing it must never do is guess an industry from page wording.
  assert.match(none.basis, /Nothing here infers an industry from page text/);

  // Structured data that names no vertical leaves the model unset rather than
  // reaching for the nearest label.
  const generic = inferSiteModel({ types: [{ type: 'WebPage', pages: 40, items: 40 }] });
  assert.equal(generic.established, false);
  assert.match(generic.basis, /left unset rather than guessed/);
});

test('off-site research is reported as not connected rather than omitted', () => {
  const plan = buildOptimizePlan({ groups: [group('navigation.link-404')], urlCounts: { fetched: 1 } });
  assert.equal(plan.research.connected, false);
  assert.match(plan.research.note, /no claim about competitors, search demand, rankings or traffic/);
});

test('the plan never invents work for a clean audit', () => {
  const plan = buildOptimizePlan({ groups: [], urlCounts: { fetched: 10 } });
  assert.equal(plan.priorities.length, 0);
  assert.equal(plan.totals.clusters, 0);
});

test('the overlay presents the order as a sequence, not a ranking', () => {
  const overlay = fs.readFileSync('apps/extension/content.js', 'utf8');
  assert.match(overlay, /optimize: 'Optimize'/);
  assert.match(overlay, /dependency order, not a severity ranking/);
  // Traceability: a rule chip opens the findings behind the action.
  assert.match(overlay, /className = 'optimize-rule'/);
  assert.match(overlay, /siteAudit\.findingsSearch = row\.ruleId/);
});

test('operator inputs are allowlisted, never trusted as typed', () => {
  const junk = normalizePlanInputs({ siteType: '<script>alert(1)</script>', templateAccess: 'whatever' });
  assert.deepEqual(junk, { siteType: '', templateAccess: '' });
  const good = normalizePlanInputs({ siteType: 'Legal practice', templateAccess: 'blocked' });
  assert.deepEqual(good, { siteType: 'Legal practice', templateAccess: 'blocked' });
});

test('a stated site type is recorded as stated, and carries no scanner confidence', () => {
  // The closed confidence vocabulary describes evidence. Borrowing one of its
  // words for something a person typed is exactly the conflation this product
  // refuses everywhere else, so a stated model carries no confidence at all.
  const stated = resolveSiteModel({ types: [] }, { siteType: 'Legal practice' });
  assert.equal(stated.label, 'Legal practice');
  assert.equal(stated.stated, true);
  assert.equal(stated.confidence, null);
  assert.match(stated.basis, /Stated by you/);
  assert.match(stated.basis, /nothing corroborates this/);

  // Where the crawl read the same thing, the plan says the two agree rather
  // than quietly presenting one as the other.
  const agreeing = resolveSiteModel({ types: [{ type: 'LegalService', pages: 9, items: 9 }] }, { siteType: 'Legal practice' });
  assert.match(agreeing.basis, /the two agree/);
  assert.equal(agreeing.readFromMarkup, 'Legal practice');

  // With nothing stated, the crawl's reading stands untouched.
  const read = resolveSiteModel({ types: [{ type: 'LegalService', pages: 9, items: 9 }] }, {});
  assert.equal(read.stated, undefined);
  assert.equal(read.confidence, 'corroborated');
});

test('frozen templates reorder the plan and the plan says who asked', () => {
  const groups = [
    { rule_id: 'navigation.link-404', title: 'x', category: 'fix', severity: 'high', confidence: 'confirmed', instances: 5, affected_urls: 3 },
    { rule_id: 'seo.title-long', title: 'x', category: 'fix', severity: 'medium', confidence: 'confirmed', instances: 3, affected_urls: 3 },
    { rule_id: 'axe.color-contrast', title: 'x', category: 'fix', severity: 'medium', confidence: 'confirmed', instances: 2, affected_urls: 2 }
  ];
  const open = buildOptimizePlan({ groups, urlCounts: { fetched: 5 } });
  assert.deepEqual(open.priorities.map((p) => p.id), ['integrity', 'templates', 'page-level']);

  const frozen = buildOptimizePlan({ groups, urlCounts: { fetched: 5 }, inputs: { templateAccess: 'blocked' } });
  assert.deepEqual(frozen.priorities.map((p) => p.id), ['integrity', 'page-level', 'templates']);
  assert.deepEqual(frozen.priorities.map((p) => p.order), [1, 2, 3], 'the numbering is resequenced, not left with a hole');
  const templates = frozen.priorities.find((p) => p.id === 'templates');
  assert.equal(templates.deferred, true);
  // Attribution matters: the evidence did not move this, the operator did.
  assert.match(templates.unblocks, /you told Lumen/);
  assert.match(templates.unblocks, /Nothing in the evidence moved it/);
  // And nothing about the findings changed.
  assert.equal(frozen.totals.actionableFindings, open.totals.actionableFindings);
});

test('the inputs screen collects only what changes the output', () => {
  const overlay = fs.readFileSync('apps/extension/content.js', 'utf8');
  const idle = overlay.match(/function renderOptimizeIdle\(\)[\s\S]*?\n  \}/)[0];
  // Two selects, matching the two fields the plan actually reads. A field that
  // is collected and moves nothing is fake configuration.
  assert.equal((idle.match(/document\.createElement\('select'\)/g) || []).length, 2);
  assert.match(idle, /siteType/);
  assert.match(idle, /templateAccess/);
  // The screen leads with evidence the audit already holds rather than a bare
  // button in an empty page.
  assert.match(idle, /Evidence this plan will use/);
  for (const row of ['Findings', 'Pages read', 'Structured data', 'Browser checks', 'Coverage gaps', 'Off-site research']) {
    assert.ok(idle.includes(`'${row}'`), `${row} should be stated before the plan is built`);
  }
  // An emptied card is still a bordered box; it is hidden rather than drawn.
  assert.match(idle, /why\.hidden = true/);
  assert.match(overlay, /why\.hidden = false/);
  // And the operator is told what their answers are treated as.
  assert.match(idle, /recorded as your statement, never as scan evidence/);
});
