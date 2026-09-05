import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildOptimizePlan } from '../packages/findings/optimize-plan.js';

/**
 * The plan's shape, pinned.
 *
 * Everything downstream reads this object: the Optimize screen, the workbook,
 * and eventually an export API and whatever asks Lumen to investigate further.
 * The point of pinning it is that the next layer can be built against a
 * contract rather than against whatever the UI happened to need that week, and
 * that a field cannot quietly disappear from the spreadsheet because a renderer
 * stopped using it.
 *
 * A field being here is a promise. Adding one is free; removing or renaming one
 * breaks a deliverable somebody has already sent to a client.
 */

const group = (rule_id, over = {}) => ({
  rule_id, title: rule_id, category: 'fix', severity: 'medium', confidence: 'confirmed',
  impact_class: 'quality', instances: 2, affected_urls: 2, guidance: 'Do the thing.', ...over
});
const finding = (rule_id, url) => ({ rule_id, url, detail: '', count: 1 });
const pageRow = (url, over = {}) => ({
  url, final_url: url, status: 'fetched', title: `Page | Example Firm`, h1_text: 'Page',
  word_count: 700, schema_types: '["Article"]', canonical: url, indexable: 1, redirected: 0, ...over
});

const urls = ['https://example.com/team/a', 'https://example.com/team/b', 'https://example.com/team/c'];

function samplePlan() {
  const pageRows = [pageRow('https://example.com/'), ...urls.map((u) => pageRow(u))];
  return buildOptimizePlan({
    groups: [group('navigation.link-404', { severity: 'high' }), group('seo.title-long', { severity: 'low' })],
    findings: [...urls.map((u) => finding('navigation.link-404', u)), ...urls.map((u) => finding('seo.title-long', u))],
    pages: new Map(pageRows.map((p) => [p.url, p])),
    pageRows,
    urlCounts: { fetched: 4 },
    links: [],
    sitemapUrls: new Set(urls),
    normalizeUrl: (u) => String(u).replace(/\/$/, '')
  });
}

test('the plan exposes every field the interface and the export both read', () => {
  const plan = samplePlan();
  for (const field of ['priorities', 'totals', 'coverage', 'changeSummary', 'siteModel', 'research',
    'informational', 'siteStructure', 'templateActions', 'openQuestions', 'compression']) {
    assert.ok(field in plan, `plan.${field} is missing`);
  }
  // Phases carry their own sequence and the reason for it.
  for (const priority of plan.priorities) {
    for (const field of ['id', 'order', 'title', 'summary', 'unblocks', 'severity', 'confidence', 'findings', 'changes', 'actions']) {
      assert.ok(field in priority, `priority.${field} is missing`);
    }
    for (const action of priority.actions) {
      for (const field of ['id', 'title', 'detail', 'rationale', 'changes', 'changeCount', 'evidence', 'verify']) {
        assert.ok(field in action, `action.${field} is missing`);
      }
    }
  }
});

test('a change carries everything an implementer and a spreadsheet need', () => {
  const changes = samplePlan().priorities.flatMap((p) => p.actions.flatMap((a) => a.changes));
  assert.ok(changes.length, 'the sample must produce changes');
  for (const change of changes) {
    for (const field of ['id', 'ruleId', 'area', 'category', 'title', 'severity', 'confidence',
      'location', 'action', 'doneWhen', 'scope', 'scopeLabel', 'effort', 'urls', 'pages',
      'instances', 'current', 'absence', 'priority', 'priorityLabel', 'priorityReason']) {
      assert.ok(field in change, `change.${field} is missing from ${change.id}`);
    }
    // Ids are citable in a ticket and stable within a plan.
    assert.match(change.id, /^C\d\d$/);
    assert.ok(Array.isArray(change.urls) && change.urls.length);
  }
  // Ids are unique, or a drafted value could land on the wrong row when the
  // export request carries it back.
  const ids = changes.map((c) => c.id);
  assert.equal(new Set(ids).size, ids.length);
});

test('reasoning output is shaped for a consumer that is not the current screen', () => {
  const plan = samplePlan();
  // The site model, which the next layer would reason over.
  for (const field of ['groups', 'ungrouped', 'pagesConsidered', 'grouped']) {
    assert.ok(field in plan.siteStructure, `siteStructure.${field} is missing`);
  }
  for (const group of plan.siteStructure.groups) {
    for (const field of ['id', 'label', 'kind', 'urls', 'count', 'cohesion', 'cohesionSignals',
      'probableTemplate', 'confidence', 'templateConfidence', 'basis']) {
      assert.ok(field in group, `page group.${field} is missing`);
    }
  }
  // Compression is reported, so it can be checked rather than trusted.
  for (const field of ['findings', 'changes', 'templateActions', 'jobs', 'ratio']) {
    assert.ok(field in plan.compression, `compression.${field} is missing`);
  }
  assert.ok(Array.isArray(plan.templateActions));
  assert.ok(Array.isArray(plan.openQuestions));
});

test('a template action names what it covers and never swallows it', () => {
  // This is what keeps the plan checkable: a merge is a claim about changes
  // that are still there, so the arithmetic still reconciles against Findings
  // and a reader can always reach the evidence.
  const plan = samplePlan();
  const changeIds = new Set(plan.priorities.flatMap((p) => p.actions.flatMap((a) => a.changes.map((c) => c.id))));
  for (const action of plan.templateActions) {
    for (const field of ['id', 'group', 'rootCause', 'resolves', 'implementation', 'urls', 'pages',
      'findings', 'leverage', 'confidence', 'caveat']) {
      assert.ok(field in action, `template action.${field} is missing`);
    }
    for (const id of action.resolves) assert.ok(changeIds.has(id), `${id} was merged away instead of covered`);
    // A template is never something the crawl saw, so a merge is never confirmed.
    assert.notEqual(action.confidence, 'confirmed');
  }
  // Whatever the merges did, every finding is still accounted for once.
  assert.equal(plan.changeSummary.findings, plan.compression.findings);
});

test('an open question is a question, with what would settle it', () => {
  const plan = samplePlan();
  for (const question of plan.openQuestions) {
    for (const field of ['id', 'question', 'why', 'blocked', 'settledBy', 'urls', 'count', 'confidence']) {
      assert.ok(field in question, `question.${field} is missing`);
    }
    assert.match(question.question, /\?$/, 'it has to read as a question');
  }
});

test('a plan with nothing to do says so rather than inventing work', () => {
  const empty = buildOptimizePlan({ groups: [], findings: [], urlCounts: { fetched: 4 } });
  assert.deepEqual(empty.priorities, []);
  assert.equal(empty.changeSummary.total, 0);
  assert.deepEqual(empty.templateActions, []);
  assert.equal(empty.compression.jobs, 0);
  // And the contract is still whole, so a consumer needs no special case.
  for (const field of ['siteStructure', 'templateActions', 'openQuestions', 'compression']) {
    assert.ok(field in empty, `${field} must exist even when there is no work`);
  }
});
