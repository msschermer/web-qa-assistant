import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildChanges, summariseChanges, classifyScope, changeLocation, doneWhen, AREA_RATIONALE } from '../packages/findings/optimize-changes.js';
import { buildOptimizePlan, PRIORITY_GROUPS, CAUSE_RULES } from '../packages/findings/optimize-plan.js';

const group = (rule_id, over = {}) => ({
  rule_id, title: rule_id, category: 'fix', severity: 'medium', confidence: 'confirmed',
  impact_class: 'quality', instances: 1, affected_urls: 1, guidance: `do something about ${rule_id}`, ...over
});
const finding = (rule_id, url, over = {}) => ({ rule_id, url, detail: '', count: 1, ...over });
const pages = (n, prefix = 'https://example.com/p') =>
  Array.from({ length: n }, (_, i) => `${prefix}${i + 1}`);

test('scope is the difference between one job and many', () => {
  // The whole reason this layer exists: 8 findings on 8 of 10 fetched pages is
  // one template that does not emit something, not 8 separate pieces of work.
  assert.equal(classifyScope(8, 10).scope, 'sitewide');
  assert.equal(classifyScope(4, 40).scope, 'template');
  assert.equal(classifyScope(2, 40).scope, 'page');
  // Two pages is never a template, however small the crawl. A share taken
  // against a tiny denominator would call every pair of pages a template.
  assert.equal(classifyScope(2, 2).scope, 'page');
  // And the share is taken against pages fetched, not pages discovered, so a
  // crawl that stopped early still reports scope honestly.
  assert.equal(classifyScope(8, 10).label, 'Sitewide');
  assert.equal(classifyScope(1, 10).label, 'Single page');
});

test('a sitewide finding is one change; a page-scoped finding is one change per page', () => {
  const urls = pages(8);
  const changes = buildChanges({
    groups: [
      group('seo.description-missing', { instances: 8, affected_urls: 8 }),
      group('navigation.link-404', { severity: 'high', instances: 2, affected_urls: 2 })
    ],
    findings: [
      ...urls.map((u) => finding('seo.description-missing', u)),
      finding('navigation.link-404', 'https://example.com/a'),
      finding('navigation.link-404', 'https://example.com/b')
    ],
    fetchedPages: 10
  });
  const template = changes.filter((c) => c.ruleId === 'seo.description-missing');
  const perPage = changes.filter((c) => c.ruleId === 'navigation.link-404');
  assert.equal(template.length, 1, 'eight pages missing one tag is one edit');
  assert.equal(template[0].pages, 8, 'and it still says where it lands');
  assert.equal(perPage.length, 2, 'two unrelated broken links are two jobs');
  // A per-page change describes itself, not the rule that spawned it. The rule
  // reaches two pages; this change reaches one.
  for (const c of perPage) {
    assert.equal(c.scopeLabel, 'Single page');
    assert.equal(c.pages, 1);
    assert.equal(c.urls.length, 1);
  }
  // Ids are stable, sequential and citable in a ticket.
  assert.deepEqual(changes.map((c) => c.id), ['C01', 'C02', 'C03']);
});

test('the plan arithmetic reconciles against the findings it came from', () => {
  // The Reconcilable Totals rule: a reader must be able to add the plan up and
  // land on the Findings count. Instances are counted one row per instance —
  // the stored count column is rule-dependent (seo.title-long puts the title's
  // character length in it) and summing it once reported 383 instances of a
  // single long title.
  const findings = [
    ...pages(5).map((u) => finding('seo.title-long', u, { count: 76 })),
    finding('navigation.link-404', 'https://example.com/a', { count: 1 }),
    finding('navigation.link-404', 'https://example.com/a', { count: 1 })
  ];
  const groups = [
    group('seo.title-long', { instances: 5, affected_urls: 5 }),
    group('navigation.link-404', { severity: 'high', instances: 2, affected_urls: 1 })
  ];
  const changes = buildChanges({ findings, groups, fetchedPages: 6 });
  const summary = summariseChanges(changes);
  assert.equal(summary.findings, 7, 'every finding is accounted for exactly once');
  assert.equal(summary.findings, groups.reduce((n, g) => n + g.instances, 0));
  assert.equal(summary.total, changes.length);
  assert.equal(summary.sitewide + summary.template + summary.page, summary.total);
});

test('a change names what you edit and never invents what it says now', () => {
  const changes = buildChanges({
    groups: [group('seo.title-long', { instances: 1, affected_urls: 1 })],
    findings: [finding('seo.title-long', 'https://example.com/a', { detail: 'The title is 92 characters: “Example business — the long one”' })],
    pages: new Map([['https://example.com/a', { title: 'Example business — the long one' }]]),
    fetchedPages: 4
  });
  const [change] = changes;
  assert.equal(change.location, 'The <title> tag', 'the location is the element, not the page');
  assert.equal(change.current, 'Example business — the long one', 'read from the stored page row');
  assert.ok(change.doneWhen.length > 30, 'done-when is stated');
  assert.ok(!/re-run the audit/i.test(change.doneWhen), 'and is checkable without this tool');
  assert.equal(change.action, 'do something about seo.title-long', 'the guidance is the scanner’s, unchanged');

  // Nothing recorded means nothing shown. A plausible value in a plan is worse
  // than a blank one.
  const blind = buildChanges({
    groups: [group('seo.description-missing')],
    findings: [finding('seo.description-missing', 'https://example.com/a')],
    fetchedPages: 4
  });
  assert.equal(blind[0].current, '', 'an unknown current value stays absent');
});

test('every cause has a rationale a non-technical reader can act on', () => {
  // The tracker this is modelled on carries a "why it matters" column beside
  // every area, and it is the column the client actually reads. A cause with no
  // rationale renders the scanner's own restatement instead.
  for (const [cause] of CAUSE_RULES) {
    assert.ok(AREA_RATIONALE[cause], `${cause} has no rationale`);
    assert.ok(AREA_RATIONALE[cause].length > 60, `${cause}'s rationale is too thin to be worth reading`);
  }
});

test('every rule resolves to a location and a done-when', () => {
  const ids = ['navigation.link-404', 'navigation.fragment-missing', 'navigation.redirect-chain-long',
    'structure.orphan-page', 'seo.canonical-missing', 'seo.noindex-detected', 'seo.sitemap-mismatch',
    'schema.invalid-json', 'seo.title-long', 'seo.description-missing', 'content.generic-link-text',
    'structure.heading-skip', 'structure.duplicate-h1', 'structure.image-alt-missing', 'axe.color-contrast',
    'performance.lcp-slow', 'security.hsts-missing', 'runtime.visible-error', 'seo.hreflang-missing',
    'ux.inert-link', 'analytics.no-tag', 'totally.unknown-rule'];
  for (const id of ids) {
    assert.ok(changeLocation(id), `${id} has no location`);
    assert.ok(doneWhen(id), `${id} has no done-when`);
  }
  // The fallbacks are honest rather than absent: an unmapped rule says so
  // vaguely instead of naming an element it cannot know.
  assert.equal(changeLocation('totally.unknown-rule'), 'The affected page');
});

test('the plan hangs changes off the areas that own them and counts them per phase', () => {
  const plan = buildOptimizePlan({
    groups: [
      group('navigation.link-404', { severity: 'high', instances: 3, affected_urls: 3 }),
      group('seo.description-missing', { instances: 8, affected_urls: 8 })
    ],
    findings: [
      ...pages(3, 'https://example.com/x').map((u) => finding('navigation.link-404', u)),
      ...pages(8).map((u) => finding('seo.description-missing', u))
    ],
    urlCounts: { fetched: 10 }
  });
  // Three pages carrying a dead link with no recorded destination cannot be
  // told apart, so they group as one shared change; the template edit is the
  // other. Two jobs is the number a client would be quoted.
  assert.equal(plan.changeSummary.total, 2);
  assert.equal(plan.changeSummary.findings, 11, 'and all eleven findings are still accounted for');
  // Every phase total is the sum of its areas, and every area total the number
  // of rows under it, or the screen contradicts itself.
  let seen = 0;
  for (const priority of plan.priorities) {
    const fromActions = priority.actions.reduce((n, a) => n + a.changeCount, 0);
    assert.equal(priority.changes, fromActions, `${priority.id} miscounts its changes`);
    for (const action of priority.actions) {
      assert.equal(action.changeCount, action.changes.length);
      for (const change of action.changes) assert.equal(change.area, action.id, 'a change belongs to its own area');
      seen += action.changeCount;
    }
  }
  assert.equal(seen, plan.changeSummary.total, 'no change is orphaned outside a phase');
  // And the sequence still leads with the confirmed functional failure.
  assert.equal(plan.priorities[0].id, PRIORITY_GROUPS[0].id);
});

test('informational findings never become work', () => {
  // A plan is a list of things to do. An observation that asks for no change
  // has no place in it, and inflating the job count with observations is how a
  // plan stops being believed.
  const plan = buildOptimizePlan({
    groups: [
      group('navigation.link-404', { severity: 'high', instances: 2, affected_urls: 2 }),
      group('seo.canonical-present', { severity: 'info', category: 'observation', instances: 40, affected_urls: 40 })
    ],
    findings: [
      ...pages(2, 'https://example.com/x').map((u) => finding('navigation.link-404', u)),
      ...pages(40).map((u) => finding('seo.canonical-present', u))
    ],
    urlCounts: { fetched: 40 }
  });
  assert.equal(plan.changeSummary.total, 2);
  assert.equal(plan.changeSummary.findings, 2, 'the 40 observations are not jobs');
  assert.equal(plan.informational.patterns, 1, 'but they are still reported, not dropped');
  assert.equal(plan.informational.findings, 40);
});

test('a repeated link is one change only when it is the same link', () => {
  // Page count alone cannot tell a shared nav href from three unrelated dead
  // links: both fire the same rule on the same number of pages. The recorded
  // destination can, and it is the difference between quoting one job and
  // quoting three.
  const linkFinding = (url, dest) => finding('navigation.link-404', url, {
    detail: `The link “Contact” points at ${dest}`,
    evidence_json: JSON.stringify({ link: { url: dest, status: 404 } })
  });
  const shared = buildChanges({
    groups: [group('navigation.link-404', { severity: 'high', instances: 3, affected_urls: 3 })],
    findings: pages(3).map((u) => linkFinding(u, 'https://example.com/gone')),
    fetchedPages: 12
  });
  assert.equal(shared.length, 1, 'one href in a shared component is one edit');
  assert.equal(shared[0].pages, 3, 'and it still names the three pages it appears on');
  assert.match(shared[0].current, /https:\/\/example\.com\/gone/);

  const distinct = buildChanges({
    groups: [group('navigation.link-404', { severity: 'high', instances: 3, affected_urls: 3 })],
    findings: pages(3).map((u, i) => linkFinding(u, `https://example.com/gone-${i}`)),
    fetchedPages: 12
  });
  assert.equal(distinct.length, 3, 'three different dead destinations are three edits');
  for (const change of distinct) assert.equal(change.scopeLabel, 'Single page');
  // Either way the findings reconcile.
  assert.equal(summariseChanges(shared).findings, 3);
  assert.equal(summariseChanges(distinct).findings, 3);
});
