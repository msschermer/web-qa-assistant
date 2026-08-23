import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

test('synthetic known-answer fixture covers cross-discipline acceptance cases',()=>{
  const html=fs.readFileSync('fixtures/known-answer/index.html','utf8');
  assert.match(html,/Sample Workspace/);
  assert.match(html,/Verified/);
  assert.match(html,/href="\/missing"/);
  assert.match(html,/canonical[^>]+#fragment/);
  assert.match(html,/<h1>[^<]+<\/h1>[\s\S]*<h3>/);
  assert.match(html,/<button><\/button>/);
  assert.match(html,/<input type="text">/);
  const hrefHosts=[...html.matchAll(/href=\"https?:\/\/([^/\"]+)/gi)].map(m=>m[1]);
  assert.deepEqual(hrefHosts.sort(),['example.com','example.org']);
});
