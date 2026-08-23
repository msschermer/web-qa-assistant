import test from 'node:test';
import assert from 'node:assert/strict';
import { guidanceFor } from '../packages/frank/guidance.js';

test('Frank guidance never falls back to vague address-the-evidence language',()=>{
  const rows=[
    guidanceFor({ruleId:'navigation.link-404',title:'Broken',link:{status:404}},{type:'production'}),
    guidanceFor({ruleId:'web.duplicate-id',title:'Duplicate ID'},{type:'production'}),
    guidanceFor({ruleId:'axe.label',title:'Label',axe:{failureSummary:'Fix any of the following: Add a label.'}},{type:'production'}),
    guidanceFor({ruleId:'unknown.rule',title:'Unknown'},{type:'production'})
  ];
  for(const g of rows){
    assert.ok(g.impact&&g.remediation&&g.verify);
    assert.doesNotMatch(g.remediation,/address the implementation evidence/i);
  }
});
