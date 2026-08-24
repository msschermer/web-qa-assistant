import test from 'node:test';
import assert from 'node:assert/strict';
import { buildEvidenceGraph } from '../packages/frank/evidence.js';
import { deterministicFrankPlan, validateFrankPlan } from '../packages/frank/plan.js';

function contrastGraph(){
  const finding={
    id:'axe.color-contrast:demo',ruleId:'axe.color-contrast',title:'Elements must meet minimum color contrast ratio thresholds',
    detail:'Element has insufficient color contrast.',category:'fix',severity:'high',confidence:'confirmed',selector:'.status-label',targetId:'target_status',targetType:'visual',evidence:'<span class="status-label">Running</span>',sources:['axe'],wcag:['1.4.3'],
    verification:{state:'confirmed',method:'axe automated violation',attempts:1,evidence:['Fix contrast']},
    axe:{impact:'serious',failureSummary:'Fix any of the following: Element has insufficient color contrast of 2.8 (foreground color: #77808a, background color: #eef2f5, font size: 10.5pt (14px), font weight: normal). Expected contrast ratio of 4.5:1',checks:{any:[{id:'color-contrast',message:'Element has insufficient color contrast',data:{fgColor:'#77808a',bgColor:'#eef2f5',contrastRatio:2.8,expectedContrastRatio:'4.5',fontSize:'10.5pt (14px)',fontWeight:'normal'}}],all:[],none:[]}}
  };
  return buildEvidenceGraph({finding,page:{url:'https://example.com/',hostname:'example.com',title:'Sample Workspace'},coverage:{axe:'complete'},environment:{type:'production',confidenceLabel:'high'},targetContext:{found:true,tag:'span',markup:'<span class="status-label">Running</span>',text:'Running',rect:{width:54,height:18},styles:{color:'rgb(119, 128, 138)',backgroundColor:'rgb(238, 242, 245)'}}});
}

test('contrast evidence carries observed and required ratios into Frank',()=>{
  const graph=contrastGraph();
  assert.ok(graph.evidence.some(e=>e.kind==='contrast-ratio'&&e.value==='2.8:1'));
  assert.ok(graph.evidence.some(e=>e.kind==='contrast-required'&&e.value==='4.5:1'));
  const plan=deterministicFrankPlan(graph);
  assert.ok(validateFrankPlan(plan,graph));
  assert.equal(plan.steps.some(s=>s.headline==='This is the evidence behind the finding'),false);
  const interpretation=plan.steps.find(s=>s.type==='interpretation');
  assert.match(interpretation.body,/Running/i);
  assert.match(interpretation.body,/2\.8:1/);
  assert.match(interpretation.body,/4\.5:1/);
  assert.ok(interpretation.metrics.some(m=>m.label==='Observed contrast ratio'&&m.value==='2.8:1'));
});

test('deterministic fallback is actionable rather than scanner-provenance filler',()=>{
  const plan=deterministicFrankPlan(contrastGraph());
  const remediation=plan.steps.find(s=>s.type==='remediation');
  assert.match(remediation.body,/contrast|foreground|background/i);
  assert.doesNotMatch(plan.steps.map(s=>s.body).join(' '),/not from Frank inventing a diagnosis/i);
});
