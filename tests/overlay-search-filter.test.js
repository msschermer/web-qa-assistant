import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const content = fs.readFileSync('apps/extension/content.js', 'utf8');

// An `input` event's target retargets to the shadow HOST once dispatch is over.
// The Site Audit overlay lives in a shadow root, so a debounced handler that
// reads `e.target.value` when its timer fires reads the host, not the input,
// and gets `undefined`. That assigned undefined into the filter state and made
// renderFindingsList throw on `.trim()` — after it had already emptied the
// list, which is why typing looked like it filtered, clearing never restored,
// and the Clear filters button never appeared.
test('search handlers capture the input value synchronously, not inside the debounced callback', () => {
  // The debounced function must receive a value, never the event.
  for (const field of ['findings', 'urls', 'links']) {
    const re = new RegExp(`debounce\\(\\(e\\)\\s*=>\\s*\\{[^}]*${field}Search\\s*=\\s*e\\.target`, 'i');
    assert.doesNotMatch(
      content,
      re,
      `${field}-search reads e.target inside its debounced callback; across a shadow boundary that resolves to the host and yields undefined`
    );
  }
  // And the wiring that replaced it must still exist.
  for (const handler of ['onFindingsSearch', 'onUrlsSearch', 'onLinksSearch']) {
    assert.match(content, new RegExp(`const ${handler} = debounce\\(\\(value\\)`), `${handler} should debounce over a captured value`);
    assert.match(content, new RegExp(`${handler}\\(e\\.target\\.value\\)`), `${handler} should be called with the value read during dispatch`);
  }
});

test('filter rendering cannot be wiped by a malformed filter value', () => {
  // renderFindingsList empties the list before it reads the search term, so a
  // throw there leaves an empty list and skips the state render. Coercing the
  // value keeps a bad state from presenting as "no results".
  for (const field of ['findingsSearch', 'urlsSearch', 'linksSearch']) {
    assert.match(
      content,
      new RegExp(`String\\(siteAudit\\.${field} \\|\\| ''\\)\\.trim\\(\\)`),
      `${field} should be coerced before .trim() so a bad value cannot throw mid-render`
    );
    assert.doesNotMatch(
      content,
      new RegExp(`const search = siteAudit\\.${field}\\.trim\\(\\)`),
      `${field} is read with an unguarded .trim()`
    );
  }
});

// A status fetch that returns nothing must not repaint a populated results view
// with zeros. The earlier renders in showSiteAuditResults are guarded by
// `if (audit)`; renderSummaryHeader was not, so a later empty read zeroed every
// count while the summary sentence above kept the real figures.
test('a failed audit status read cannot zero an already-populated results header', () => {
  const content = fs.readFileSync('apps/extension/content.js', 'utf8');
  assert.match(
    content,
    /if \(audit\) \{\s*renderSummaryHeader\(groupsResult\?\.groups \|\|[^;]*, audit\);/,
    'renderSummaryHeader must only run when an audit was actually read'
  );
  assert.match(
    content,
    /function renderSummaryHeader\(groups, audit\) \{\s*if \(!audit\) return;/,
    'the renderer itself must refuse a missing audit rather than rendering zeros'
  );
  assert.match(content, /could not be read just now/, 'an unreadable audit is stated, not silently shown as zeros');
  // The conditions block is optional decoration on this header; it must never
  // be able to take the counts down with it.
  assert.match(content, /try \{ renderAuditSummary\(audit\); \} catch/);
});

// Top issues is the most obviously clickable thing on the overview, and its
// titles are long enough to overflow. A flex item defaults to min-width:auto,
// so .ti-rule could not shrink and pushed the page count outside the card.
test('top issues open their rule in Findings and cannot overflow their card', () => {
  const content = fs.readFileSync('apps/extension/content.js', 'utf8');
  assert.match(content, /\.top-issues \.ti-rule\{[^}]*min-width:0/, 'the title must be able to shrink so its ellipsis engages');
  assert.match(content, /\.top-issues \.ti-scope\{flex:0 0 auto/, 'the page count must never be compressed or pushed out');
  assert.match(content, /button\.className = 'ti-open'/, 'each top issue is a real button');
  assert.match(content, /switchSiteAuditTab\('findings'\)/, 'clicking one opens Findings');
  assert.match(content, /siteAudit\.findingsSearch = g\.rule_id \|\| rule/, 'it filters by rule id, which is exact');
});

// A payload missing renderProgress.remaining printed the literal word
// "undefined" into the operator's instructions and skipped the all-done branch.
test('the render-pass instruction derives its remaining count instead of trusting it', () => {
  const content = fs.readFileSync('apps/extension/content.js', 'utf8');
  assert.match(content, /remaining: Number\.isFinite\(Number\(raw\.remaining\)\) \? Number\(raw\.remaining\) : Math\.max\(0, total - rendered\)/);
  assert.doesNotMatch(content, /const rp = audit\.renderProgress \|\| \{ total: 0, rendered: 0, remaining: 0 \}/);
});

// .main was both the scroll container and the width-constrained column, so its
// scrollbar rendered against the centred column mid-panel rather than the edge.
test('narrow views centre their content with padding, not by narrowing the scroller', () => {
  const content = fs.readFileSync('apps/extension/content.js', 'utf8');
  for (const cls of ['main-narrow', 'run-main']) {
    assert.match(content, new RegExp(`\.${cls}\{[^}]*max-width:none`), `${cls} must not narrow the scroll container`);
    assert.ok(content.includes(`.${cls}{`) && content.split(`.${cls}{`)[1].split(String.fromCharCode(125))[0].includes(String.fromCharCode(112,97,100,100,105,110,103,45,108,101,102,116,58,109,97,120,40)), `${cls} should centre via padding`);
  }
});
