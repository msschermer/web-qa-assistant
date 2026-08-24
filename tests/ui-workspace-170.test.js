import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

test('side panel is organized as a SaaS QA workspace rather than a scanner stack',()=>{
  const html=fs.readFileSync('apps/extension/sidepanel.html','utf8');
  const css=fs.readFileSync('apps/extension/sidepanel.css','utf8');
  for(const phrase of ['Page assessment','QA areas','Recommended order','Workspace tools','Report bug'])assert.match(html,new RegExp(phrase));
  assert.match(html,/class="brand-mark"/); assert.match(html,/class="tool-grid"/); assert.match(html,/section-intro/);
  assert.match(css,/\.workspace-section/); assert.match(css,/\.tool-grid/); assert.match(css,/\.ledger-cell/); assert.match(css,/\.bug-dialog/);
  assert.match(html,/data-tooltip=/);
});

test('finding cards lead with translated guidance and demote scanner language to technical evidence',()=>{
  const html=fs.readFileSync('apps/extension/sidepanel.html','utf8');
  const js=fs.readFileSync('apps/extension/sidepanel.js','utf8');
  assert.match(js,/presentFinding/); assert.match(js,/presentation\.summary/); assert.match(js,/presentation\.nextAction/);
  assert.match(html,/Recommended next step/); assert.match(html,/Technical evidence/); assert.match(html,/Scanner rule/); assert.match(html,/Observed by/);
});

test('Frank evidence sidebar visibly explains its role while the page card owns reasoning',()=>{
  const html=fs.readFileSync('apps/extension/sidepanel.html','utf8');
  assert.match(html,/What the tools observed/);
  assert.match(html,/Frank’s interpretation and fix stay in the focused card on the page/);
  assert.match(html,/Key facts/); assert.match(html,/Evidence for this step/);
});

test('extension builder packages presentation and bug-report runtime modules',()=>{
  const build=fs.readFileSync('scripts/build-extension.mjs','utf8');
  assert.match(build,/presentation\.js/); assert.match(build,/bug-report\.js/);
});


test('primary workspace copy avoids internal materiality jargon',()=>{
  const html=fs.readFileSync('apps/extension/sidepanel.html','utf8');
  const js=fs.readFileSync('apps/extension/sidepanel.js','utf8');
  assert.match(html,/Evidence-backed assessment/);
  assert.match(html,/Download report/);
  assert.doesNotMatch(html,/grouped material issues|>Download JSON</i);
  assert.doesNotMatch(js,/Nothing material found|material finding|Cloud-enhanced summary|Evidence summary/);
});
