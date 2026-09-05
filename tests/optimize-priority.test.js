import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { changePriority, byPriority, bestPriority, comparePriority, PRIORITY_LABEL } from '../packages/findings/optimize-changes.js';
import { runCrossPageScanners } from '../packages/crawl/scanners/index.js';

const change = (over = {}) => ({
  area: 'page-metadata', scope: 'page', pages: 1, severity: 'medium', confidence: 'confirmed', ...over
});

test('priority is a remediation judgement, not the scanner severity relabelled', () => {
  // The two come apart constantly, and ordering by severity alone was the
  // arbitrary sort this replaces.
  assert.equal(changePriority(change({ severity: 'high' })).band, 'high');
  assert.equal(changePriority(change({ severity: 'medium' })).band, 'medium');
  assert.equal(changePriority(change({ severity: 'low' })).band, 'low');
  // A medium-severity pattern on every page outranks a medium on one page,
  // because one edit resolves it everywhere.
  assert.equal(changePriority(change({ severity: 'medium', scope: 'sitewide', pages: 9 })).band, 'high');
  assert.equal(changePriority(change({ severity: 'low', scope: 'template', pages: 5 })).band, 'medium');
  // Leverage needs enough pages to be leverage. Two pages is two edits.
  assert.equal(changePriority(change({ severity: 'low', scope: 'template', pages: 2 })).band, 'low');
});

test('an indexing blocker outranks everything, and nothing else claims the word', () => {
  // Everything else in the plan is measured on pages that can be indexed.
  assert.equal(changePriority(change({ area: 'indexing-directives', severity: 'medium' })).band, 'blocker');
  // Deliberately narrow. An orphan page is a real discoverability problem and a
  // sitemap contradiction is a real contradiction, but neither stops a page
  // being indexed, and calling everything a blocker empties the word.
  for (const area of ['crawl-reachability', 'sitemaps', 'link-targets', 'page-metadata']) {
    assert.notEqual(changePriority(change({ area, severity: 'high' })).band, 'blocker', area);
  }
  // And an inferred indexing signal is not asserted as a blocker.
  assert.equal(changePriority(change({ area: 'indexing-directives', confidence: 'inferred' })).band, 'low');
});

test('inferred evidence never jumps the queue', () => {
  // The static crawl cannot prove a meta description is absent, so a template
  // full of them does not outrank a confirmed fault.
  const inferred = changePriority(change({ severity: 'low', confidence: 'inferred', scope: 'template', pages: 6 }));
  assert.equal(inferred.band, 'low');
  assert.match(inferred.reason, /inferred rather than confirmed/);
  assert.equal(changePriority(change({ severity: 'high', confidence: 'inferred' })).band, 'medium');
});

test('every priority can be explained in one sentence', () => {
  // The plan states why an action sits where it does. A rule nobody can restate
  // cannot be defended to a client.
  for (const spec of [
    { severity: 'high' },
    { severity: 'medium', scope: 'sitewide', pages: 9 },
    { area: 'indexing-directives' },
    { severity: 'low', confidence: 'inferred' }
  ]) {
    const { band, reason } = changePriority(change(spec));
    assert.ok(PRIORITY_LABEL[band], `${band} needs a label`);
    assert.ok(reason.length > 45 && reason.endsWith('.'), `${band}: ${reason}`);
    assert.ok(!/important|critical issue|urgent/i.test(reason), 'no urgency theatre');
  }
  // The reason names the evidence it was derived from.
  assert.match(changePriority(change({ severity: 'high' })).reason, /high and confirmed/);
  assert.match(changePriority(change({ severity: 'medium', scope: 'sitewide', pages: 9 })).reason, /all 9 pages carrying it/);
});

test('ordering puts the most urgent work first without touching the phase sequence', () => {
  const rows = [
    { priority: 'low', pages: 1 }, { priority: 'blocker', pages: 1 },
    { priority: 'medium', pages: 2 }, { priority: 'high', pages: 1 }, { priority: 'medium', pages: 9 }
  ];
  assert.deepEqual(rows.slice().sort(byPriority).map((r) => r.priority),
    ['blocker', 'high', 'medium', 'medium', 'low']);
  // Ties break on reach, so the bigger job of equal urgency leads.
  assert.equal(rows.slice().sort(byPriority)[2].pages, 9);
  assert.equal(bestPriority(rows), 'blocker');
  assert.equal(bestPriority([]), 'low');
  assert.ok(comparePriority('blocker', 'low') < 0);
});

test('structured data validation reaches findings, and brings no noise with it', () => {
  // It used to be computed and shown on one screen only, so a site could carry
  // conflicting identities and an incomplete address and none of it reached
  // Findings, the plan or the export.
  const schemaPages = [
    // A business item that names itself but carries no address, which is a
    // fault in markup that exists rather than a limit on what could be read.
    { url: 'https://example.com/', items: [{ type: 'LegalService', path: 'ld+json[0]', propKeys: ['name'], props: { name: { kind: 'text' } } }], invalidBlocks: [] },
    { url: 'https://example.com/a', items: [{ type: 'LegalService', path: 'ld+json[0]', propKeys: ['name'], props: { name: { kind: 'text' } } }, { type: 'CommentAction', path: 'ld+json[1]', propKeys: [], props: {} }], invalidBlocks: [] },
    { url: 'https://example.com/b', items: [{ type: 'LegalService', path: 'ld+json[0]', propKeys: ['name'], props: { name: { kind: 'text' } } }, { type: 'CommentAction', path: 'ld+json[1]', propKeys: [], props: {} }], invalidBlocks: [] },
    { url: 'https://example.com/c', items: [{ type: 'CommentAction', path: 'ld+json[0]', propKeys: [], props: {} }], invalidBlocks: [] },
    { url: 'https://example.com/d', items: [{ type: 'CommentAction', path: 'ld+json[0]', propKeys: [], props: {} }], invalidBlocks: [] }
  ];
  const ctx = { startUrl: 'https://example.com/', sitemapUrls: new Set(), robotsDisallow: [], inlinkCounts: new Map(), schemaPages };
  const out = runCrossPageScanners(schemaPages.map((p) => ({ url: p.url, final_url: p.url })), ctx);
  const schema = [...out.values()].flat().filter((f) => String(f.ruleId).startsWith('schema.'));
  assert.ok(schema.length, 'schema validation must produce findings');

  // Plumbing a CMS emits around a page is not a template gap worth planning.
  // Without this the pass reported "CommentAction is on most pages but not all",
  // which is true, useless, and the kind of row that stops a plan being read.
  assert.ok(!schema.some((f) => /CommentAction/.test(String(f.title))), 'structural types are not template gaps');
  // Article on 3 of 5 is below the coverage threshold, so it is not one either.
  // And an address a business never published is reported, on every page that
  // publishes the item, because each is a real item that is really incomplete.
  assert.ok(schema.some((f) => /missing address/.test(String(f.title))), 'a real markup fault is reported');

  // Statements about the site are recorded once, not once per page carrying the
  // evidence, which is the duplication the plan exists to remove.
  const siteScope = schema.filter((f) => f.ruleId === 'schema.no-sameas');
  assert.ok(siteScope.length <= 1, `no-sameas recorded ${siteScope.length} times`);

  // And the three statement kinds stay apart: an opportunity is never a defect.
  for (const finding of schema) {
    assert.ok(['fix', 'review'].includes(finding.category));
    if (finding.category === 'review') assert.equal(finding.confidence, 'inferred');
  }
});

test('the plan reads as a sequence, not as a numbered list', () => {
  // The complaint this closes: Optimize listed phases as 01 / 02 / 03, which is
  // accurate and reads exactly like the Findings table. A dependency order has
  // a shape, and the words for it are Now, Next, Then, Later.
  const overlay = fs.readFileSync('apps/extension/content.js', 'utf8');
  assert.match(overlay, /const PHASE_WHEN = \['Now', 'Next', 'Then', 'Later'\]/);
  // Position in a sequence is one idea getting quieter. The first attempt gave
  // Now a critical-red pill and Next amber, which in this product is the
  // vocabulary of severity: "do this first" is not "this is worse".
  const tones = overlay.match(/const PHASE_TONE = \{[^}]*\}/)[0];
  for (const severityTone of ['critical', 'warn', "'ok'"]) {
    assert.ok(!tones.includes(severityTone), `a phase label must not borrow the ${severityTone} tone`);
  }
  // The map and the phase cards use one vocabulary, so the reader is not
  // translating between "Now" above and "01" below.
  assert.ok(!overlay.includes("num.textContent = String(priority.order).padStart(2, '0')"),
    'the ordinal was replaced by the word the map uses');
  assert.match(overlay, /PHASE_WHEN\[priority\.order - 1\]/);
});

test('a plan with fewer phases does not invent the missing ones', () => {
  // Four labels exist because four dependency groups exist, not because four
  // is a nice number for a layout. A two-phase plan says Now and Next and
  // stops; padding it would be inventing work.
  const overlay = fs.readFileSync('apps/extension/content.js', 'utf8');
  const component = overlay.match(/function planOfAttack\(plan\) \{[\s\S]*?\n  \}/)[0];
  assert.match(component, /plan\.priorities\.forEach/, 'rows come from the phases that exist');
  assert.ok(!/PHASE_WHEN\.map|PHASE_WHEN\.forEach/.test(component), 'never iterate the labels themselves');
  // And a fifth phase, if the taxonomy ever grows one, is numbered rather than
  // silently unlabelled.
  assert.match(component, /Step \$\{index \+ 1\}/);
});
