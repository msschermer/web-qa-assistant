import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { buildEvidenceGraph } from '../packages/frank/evidence.js';
import { deterministicFrankPlan } from '../packages/frank/plan.js';
import { validateLocalFrankOutput, localFrankWalkthrough } from '../apps/extension/local-ai.js';

function targetSizeFinding(){
  const diagnostic='Fix any of the following: Target has insufficient size (849px by 18px, should be at least 24px by 24px) Target has insufficient space to its closest neighbors. Safe clickable space has a diameter of 18px instead of at least 24px.';
  return {
    id:'axe.target-size:acceptance', ruleId:'axe.target-size', title:'All touch targets must be 24px large, or leave sufficient space',
    detail:'Ensure touch targets have sufficient size and space', category:'fix', severity:'high', confidence:'confirmed',
    selector:'a[aria-label="Category: Sample Series"]', targetType:'visual', targetId:'target_sample', sources:['axe','wcag-translator'], wcag:['2.5.8'],
    verification:{state:'confirmed',method:'axe automated violation',attempts:1,evidence:[diagnostic]},
    axe:{impact:'serious',failureSummary:diagnostic,checks:{any:[],all:[],none:[]}},
    semantics:{naming:{ariaLabel:'Category: Sample Series',parentTag:'div',parentClass:'primary-category-container',inLandmark:'main'}}
  };
}
function targetSizeGraph(){
  return buildEvidenceGraph({
    finding:targetSizeFinding(), page:{url:'https://example.com'}, environment:{type:'production',confidenceLabel:'high'},
    targetContext:{found:true,text:'SAMPLE SERIES',markup:'<a aria-label="Category: Sample Series">SAMPLE SERIES</a>',rect:{width:849,height:18},styles:{},semantics:{naming:{ariaLabel:'Category: Sample Series',parentTag:'div',parentClass:'primary-category-container',inLandmark:'main'}}}
  });
}
function usefulLocalTargetSize(){
  return {
    summary:'The highlighted link has a pointer target that is too short and too tightly spaced.',
    interpretation:'The clickable target is 18px tall, while this check requires a 24px minimum target size or enough separation to satisfy the spacing exception.',
    impact:'A small, tightly packed pointer target is easier to miss or activate accidentally with touch, mouse, or stylus input, especially for users with reduced fine-motor precision.',
    remediation:'Increase the clickable height to at least 24px with vertical padding or a minimum hit-area height. If the visual size must stay smaller, increase spacing around the target until the 24px spacing exception passes.',
    verification:'Rerun the target-size rule and confirm the target either reaches the 24px minimum or the verified spacing exception passes.'
  };
}

test('real-world target-size acceptance case produces specific deterministic guidance',()=>{
  const graph=targetSizeGraph(), plan=deterministicFrankPlan(graph);
  const read=plan.steps.find(s=>s.type==='interpretation'), impact=plan.steps.find(s=>s.type==='impact'), fix=plan.steps.find(s=>s.type==='remediation');
  assert.match(read.body,/18px/); assert.match(read.body,/24px/); assert.doesNotMatch(read.body,/deterministic engine classified/i);
  assert.match(impact.body,/touch, mouse, or stylus/i); assert.doesNotMatch(impact.body,/keyboard, or low-vision/i);
  assert.match(fix.body,/vertical padding|hit-area height/i); assert.match(fix.body,/spacing exception/i);
  assert.doesNotMatch(fix.body,/Target has insufficient size \(/);
});

test('target-size evidence graph exposes measurements as structured facts',()=>{
  const graph=targetSizeGraph(), byKind=Object.fromEntries(graph.evidence.map(e=>[e.kind,e.value]));
  assert.equal(byKind['target-width'],'849px');
  assert.equal(byKind['target-height'],'18px');
  assert.equal(byKind['target-minimum'],'24px × 24px');
  assert.equal(byKind['target-spacing'],'18px');
  assert.equal(byKind['target-spacing-required'],'24px');
});

test('target-size interpretation step cites measurement evidence instead of unrelated DOM context',()=>{
  const graph=targetSizeGraph(), plan=deterministicFrankPlan(graph), step=plan.steps.find(s=>s.type==='interpretation');
  const used=graph.evidence.filter(e=>step.evidenceRefs.includes(e.id));
  const kinds=new Set(used.map(e=>e.kind));
  for(const kind of ['target-height','target-minimum','target-spacing','target-spacing-required']) assert.ok(kinds.has(kind),`missing ${kind}`);
});

test('useful on-device target-size rewrite may substantially rephrase deterministic copy',async()=>{
  const graph=targetSizeGraph(), deterministic=deterministicFrankPlan(graph), response=usefulLocalTargetSize();
  const direct=validateLocalFrankOutput(response,graph,deterministic); assert.equal(direct.ok,true);
  const plan=await localFrankWalkthrough({session:{prompt:async()=>JSON.stringify(response)},graph,deterministicPlan:deterministic});
  assert.equal(plan.mode,'ai'); assert.match(plan.steps.find(s=>s.type==='remediation').body,/vertical padding/i);
});

test('target-size rewrite cannot omit the verified minimum or observed failure measurement',()=>{
  const graph=targetSizeGraph(), deterministic=deterministicFrankPlan(graph), base=usefulLocalTargetSize();
  let result=validateLocalFrankOutput({...base,interpretation:'The target is too tightly packed for reliable pointer activation.',remediation:'Increase the clickable area or spacing around the target.',verification:'Rerun the same target-size rule after the change.'},graph,deterministic);
  assert.equal(result.ok,false); assert.match(result.code,/TARGET_/);
});

test('target-size rewrite cannot drift into an unrelated typography fix',()=>{
  const graph=targetSizeGraph(), deterministic=deterministicFrankPlan(graph), base=usefulLocalTargetSize();
  const result=validateLocalFrankOutput({...base,remediation:'Change the font family and typography scale while preserving the current layout.'},graph,deterministic);
  assert.equal(result.ok,false); assert.equal(result.code,'LOCAL_AI_REMEDIATION_DRIFT');
});

test('center Frank card receives the actual reasoning mode',()=>{
  const background=fs.readFileSync('apps/extension/background.js','utf8');
  const panel=fs.readFileSync('apps/extension/sidepanel.js','utf8');
  const content=fs.readFileSync('apps/extension/content.js','utf8');
  assert.match(panel,/FRANK_START_PLAN', plan, graph: prepared\.graph, reasoning/);
  assert.match(background,/FRANK_START',plan:coachPlan,targets:graph\.targets,reasoning/);
  assert.match(content,/Frank · AI review/); assert.match(content,/Verified scan guidance/); assert.match(content,/Page-level performance observation/);
  assert.doesNotMatch(content,/Evidence-grounded guidance/);
});

test('sidebar distinguishes observation sources, reference context, and single-pass Axe verification',()=>{
  const panel=fs.readFileSync('apps/extension/sidepanel.js','utf8');
  assert.match(panel,/Observed by/); assert.match(panel,/Reference context/); assert.match(panel,/Automated · Axe/);
  assert.match(panel,/attempts > 1/);
  assert.match(fs.readFileSync('apps/extension/sidepanel.html','utf8'),/frank-sticky-summary/);
  assert.match(fs.readFileSync('apps/extension/sidepanel.css','utf8'),/\.frank-sticky-summary\{position:sticky/);
});


test('target-size AI cannot revert to generic keyboard or low-vision boilerplate',()=>{
  const graph=targetSizeGraph(), deterministic=deterministicFrankPlan(graph), base=usefulLocalTargetSize();
  const result=validateLocalFrankOutput({...base,impact:'This can create a barrier for keyboard and low-vision users.'},graph,deterministic);
  assert.equal(result.ok,false); assert.match(result.code,/TARGET_/);
});
