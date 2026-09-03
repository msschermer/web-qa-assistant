import test from 'node:test';
import assert from 'node:assert/strict';
import { applyFindingPolicy } from '../packages/findings/policy.js';
import { deterministicBrief } from '../packages/findings/correlate.js';

test('inconclusive evidence never enters Frank even when nominal severity is high',()=>{
  const [row]=applyFindingPolicy([{ruleId:'example.failure',title:'Could be bad',detail:'not verified',category:'fix',severity:'critical',confidence:'inconclusive'}],{type:'production'});
  assert.equal(row.frankVisible,false);
  assert.equal(row.frankPriority,'quiet');
});

test('low-severity inferred observations stay in the full scan but remain quiet',()=>{
  const [row]=applyFindingPolicy([{ruleId:'structure.h1-multiple',title:'Multiple H1',detail:'review',category:'review',severity:'low',confidence:'inferred'}],{type:'production'});
  assert.equal(row.frankVisible,false);
});

test('verified material findings retain confidence and can enter Frank',()=>{
  const [row]=applyFindingPolicy([{ruleId:'web.duplicate-id',title:'Duplicate ID',detail:'duplicate',category:'fix',severity:'medium',confidence:'confirmed'}],{type:'production'});
  assert.equal(row.frankVisible,true);
  assert.equal(row.confidence,'confirmed');
});

test('priority brief separates incomplete coverage from real defects',()=>{
  const text=deterministicBrief([],{
    coverage:{links:'partial'},
    linkAudit:{checked:12,inconclusive:2}
  });
  assert.match(text,/No confirmed material issues/i);
  assert.match(text,/2 of 12/i);
  assert.match(text,/were not counted as broken links/i);
});
