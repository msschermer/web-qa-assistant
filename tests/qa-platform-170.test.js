import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { impactClassFor, IMPACT_CLASSES } from '../packages/findings/impact.js';
import { composeAttention } from '../packages/findings/compose.js';
import { presentFinding, QA_AREA_META } from '../packages/presentation/present.js';
import { deterministicFrankPlan } from '../packages/frank/plan.js';
import { validateLocalFrankOutput } from '../apps/extension/local-ai.js';

function base(overrides={}){return{id:overrides.ruleId||Math.random().toString(36),ruleId:'axe.color-contrast',title:'Raw scanner title',detail:'Raw scanner detail',category:'fix',severity:'medium',confidence:'confirmed',frankPriority:'medium',sources:['browser'],...overrides}}

test('security has its own QA area instead of being hidden under availability',()=>{
  const f=base({ruleId:'security.blank-opener',signal:'security'});
  assert.equal(impactClassFor(f),'security');
  assert.equal(IMPACT_CLASSES.security.label,'Security');
  assert.ok(QA_AREA_META.security.description.includes('security'));
});

test('consumer presentation translates findings across QA disciplines',()=>{
  const broken=presentFinding(base({ruleId:'links.broken-link',impactClass:'availability',link:{url:'https://example.com/missing?x=1',text:'Pricing',status:404},title:'Confirmed broken internal link'}),{type:'production'});
  const noindex=presentFinding(base({ruleId:'seo.noindex',impactClass:'discoverability'}),{type:'production'});
  const lcp=presentFinding(base({ruleId:'performance.browser.lcp',impactClass:'performance',performanceObservation:{largestContentfulPaintMs:4100}}));
  const security=presentFinding(base({ruleId:'security.blank-opener',impactClass:'security'}));
  const cls=presentFinding(base({ruleId:'performance.browser.cls',impactClass:'performance',performanceObservation:{cumulativeLayoutShift:0.31}}));
  const target=presentFinding(base({ruleId:'axe.target-size',impactClass:'accessibility'}));
  assert.equal(broken.title,'Broken internal link'); assert.match(broken.summary,/Pricing|missing/i);
  assert.equal(noindex.title,'Page is blocked from search indexing'); assert.match(noindex.nextAction,/noindex|discoverable|index/i);
  assert.match(lcp.title,/Largest contentful paint/i); assert.match(lcp.summary,/4\.1s/);
  assert.match(cls.title,/Layout shift is high/i); assert.match(cls.summary,/0\.31/); assert.match(cls.summary,/lab observation/i);
  assert.match(security.title,/opener access/i); assert.match(security.nextAction,/noopener|noreferrer/i);
  assert.match(target.title,/Clickable target/i);
});

test('mixed-discipline queue represents each material area before repeating noisy accessibility',()=>{
  const findings=[
    base({id:'404',ruleId:'links.broken-link',impactClass:'availability',frankPriority:'blocker',severity:'critical',link:{url:'https://example.com/missing'}}),
    base({id:'noindex',ruleId:'seo.noindex',impactClass:'discoverability',frankPriority:'blocker',severity:'critical'}),
    base({id:'lcp',ruleId:'performance.browser.lcp',impactClass:'performance',frankPriority:'high',severity:'high'}),
    base({id:'security',ruleId:'security.blank-opener',impactClass:'security',frankPriority:'high',severity:'high'}),
    ...Array.from({length:6},(_,i)=>base({id:`a${i}`,ruleId:`axe.rule-${i}`,impactClass:'accessibility',frankPriority:'medium'}))
  ];
  const out=composeAttention(findings,{limit:6});
  const firstFive=out.groups.slice(0,5).map(g=>g.impactClass);
  for(const area of ['availability','discoverability','performance','security','accessibility'])assert.ok(firstFive.includes(area),`${area} missing from first pass`);
  assert.equal(firstFive.filter(x=>x==='accessibility').length,1);
});

test('performance Frank steps cite performance measurements instead of generic evidence',()=>{
  const graph={findingId:'lcp',finding:base({id:'lcp',ruleId:'performance.browser.lcp',impactClass:'performance',performanceObservation:{available:true,largestContentfulPaintMs:4200,lcpElement:{selector:'#hero'}}}),environment:{type:'production'},sources:['browser-performance'],targets:{},evidence:[
    {id:'ev-rule',source:'browser',kind:'rule',label:'Rule',value:'performance.browser.lcp'},
    {id:'ev-type',source:'browser-performance',kind:'measurement-type',label:'Measurement type',value:'lab observation in the inspecting browser'},
    {id:'ev-lcp',source:'browser-performance',kind:'lcp',label:'Largest contentful paint',value:'4200ms'},
    {id:'ev-el',source:'browser-performance',kind:'lcp-element',label:'Observed LCP element',value:{selector:'#hero',tag:'IMG'}}
  ]};
  const plan=deterministicFrankPlan(graph); const interpretation=plan.steps.find(s=>s.type==='interpretation'); const fix=plan.steps.find(s=>s.type==='remediation');
  assert.ok(interpretation.evidenceRefs.includes('ev-lcp'));
  assert.ok(fix.evidenceRefs.includes('ev-el'));
  assert.match(interpretation.body,/4\.2s|4200/);
  assert.doesNotMatch(interpretation.body,/#hero/,'Frank should explain the metric in product language while the selector stays in evidence');
});

test('local AI may mention an evidence URL but rejects a new URL',()=>{
  const graph={finding:{ruleId:'links.broken-link',wcag:[]},environment:{},evidence:[{kind:'link-url',value:'https://example.com/missing?secret=x'}]};
  const plan={steps:[{type:'remediation',body:'Update the link destination.'}]};
  const candidate={summary:'The internal destination is confirmed missing.',interpretation:'The link to https://example.com/missing is confirmed missing.',impact:'Visitors cannot reach the intended internal destination.',remediation:'Update the link to a healthy destination or restore the route.',verification:'Open https://example.com/missing and verify the destination responds successfully.'};
  assert.equal(validateLocalFrankOutput(candidate,graph,plan).ok,true);
  assert.equal(validateLocalFrankOutput({...candidate,verification:'Open https://example.net/invented and verify it works.'},graph,plan).code,'LOCAL_AI_INVENTED_URL');
});

test('cross-discipline remediation drift is rejected for discoverability, performance and security',()=>{
  const make=(ruleId,evidence,remediation)=>validateLocalFrankOutput({summary:'This verified condition needs a focused correction.',interpretation:'The verified evidence identifies this specific condition on the current page.',impact:'The verified condition can affect the user or platform behavior described by this rule.',remediation,verification:'Repeat the same check after the correction and confirm the verified condition no longer reproduces.'},{finding:{ruleId,wcag:[]},environment:{},evidence}, {steps:[{type:'remediation',body:'trusted baseline'}]});
  assert.equal(make('seo.noindex',[], 'Increase image compression and defer JavaScript.').code,'LOCAL_AI_REMEDIATION_DRIFT');
  assert.equal(make('performance.browser.ttfb',[{kind:'ttfb',value:'900ms'}], 'Change the page title and canonical URL.').code,'LOCAL_AI_REMEDIATION_DRIFT');
  assert.equal(make('security.blank-opener',[], 'Increase the button padding.').code,'LOCAL_AI_REMEDIATION_DRIFT');
});
