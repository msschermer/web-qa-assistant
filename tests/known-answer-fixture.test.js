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

test('QA matrix fixtures exist for clean-page and problem-page contracts',()=>{
  const clean=fs.readFileSync('fixtures/qa-matrix/clean.html','utf8');
  const problems=fs.readFileSync('fixtures/qa-matrix/problems.html','utf8');
  assert.match(clean,/Clean synthetic workspace page/);
  assert.match(clean,/hreflang="x-default"/);
  assert.match(problems,/javascript:void\(0\)/);
  assert.match(problems,/type="hidden"[^>]*required|required/);
});
