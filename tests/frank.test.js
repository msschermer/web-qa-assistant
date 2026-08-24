import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { buildEvidenceGraph, targetIdForFinding } from '../packages/frank/evidence.js';
import { deterministicFrankPlan, validateFrankPlan } from '../packages/frank/plan.js';

test('Frank evidence graph keeps relevant provenance and excludes unrelated tool noise',()=>{
  const finding={id:'correlation.canonical-mismatch:x',fingerprint:'x',ruleId:'correlation.canonical-mismatch',title:'Rendered and published canonicals disagree',detail:'Browser and published canonicals differ.',category:'fix',severity:'high',confidence:'corroborated',selector:'link[rel="canonical"]',targetType:'document',targetId:'',signal:'canonical',evidence:'browser=/a; published=/',sources:['browser','meta-state'],wcag:[]};
  const graph=buildEvidenceGraph({finding,page:{url:'https://example.com/a',hostname:'example.com',title:'A'},environment:{type:'production',confidence:.9,confidenceLabel:'high'},coverage:{browser:'complete'},targetContext:null,context:{performance:{monitored:true,mobile:48,desktop:90,threshold:70,mobileChange:-12},services:{metaState:{data:{snapshot:{pageMeta:{canonical:{resolved:'https://example.com/'},title:{value:'A'}},fetch:{status:200}}}},wcag:{data:{mapping:{}}}}}});
  assert.equal(graph.version,3);
  assert.equal(graph.finding.targetId,'');
  for(const source of ['browser','meta-state'])assert(graph.evidence.some(e=>e.source===source),`missing ${source}`);
  assert.equal(graph.evidence.some(e=>e.source==='performance-monitor'),false);
  assert.equal(graph.evidence.some(e=>e.source==='preflight'),false);
});

test('deterministic Frank plan references only verified visual targets and includes verification',()=>{
  const finding={id:'axe.label:a',fingerprint:'a',ruleId:'axe.label',title:'Form elements must have labels',detail:'Ensure every form element has a label.',category:'fix',severity:'high',selector:'#email',targetType:'visual',targetId:'target_email',signal:'a11y.name',evidence:'<input id="email">',sources:['axe','wcag-translator'],wcag:['1.3.1'],wcagExplanation:'Controls need programmatic relationships.',axe:{impact:'serious',failureSummary:'Fix any of the following: label the element.'}};
  const graph=buildEvidenceGraph({finding,page:{url:'https://example.com',hostname:'example.com'},environment:{type:'production',confidence:.9,confidenceLabel:'high'},coverage:{axe:'complete',wcag:'complete'},targetContext:{found:true,tag:'input',selector:'#email',markup:'<input id="email">',text:'',styles:{color:'rgb(0,0,0)'}}});
  const plan=deterministicFrankPlan(graph);
  assert.equal(targetIdForFinding(finding),'target_email');
  assert.equal(validateFrankPlan(plan,graph),true);
  assert.equal(plan.mode,'deterministic');
  assert.equal(plan.steps[0].type,'interpretation');
  assert(plan.steps.some(s=>s.type==='remediation'));
  assert(plan.steps.some(s=>s.type==='verification'));
});

test('document findings never receive a fake spotlight',()=>{
  const finding={id:'seo.noindex:x',ruleId:'seo.noindex',title:'Production page requests noindex',detail:'Production noindex.',category:'fix',severity:'critical',selector:'meta[name="robots"]',targetType:'document',targetId:'',signal:'indexing.noindex',sources:['browser'],evidence:'noindex'};
  const graph=buildEvidenceGraph({finding,page:{url:'https://example.com',hostname:'example.com'},environment:{type:'production',confidence:.9,confidenceLabel:'high'},coverage:{browser:'complete'}});
  const plan=deterministicFrankPlan(graph);
  assert.equal(plan.steps.some(s=>s.type==='spotlight'),false);
  assert.equal(plan.steps[0].type,'interpretation');
  assert.equal(plan.steps[0].targetId,'');
  assert(plan.steps.some(s=>s.type==='verification'));
});


test('stale visual targets downgrade to page-level guidance instead of an empty spotlight',()=>{
  const finding={id:'axe.label:stale',ruleId:'axe.label',title:'Label issue',detail:'Label missing.',category:'fix',severity:'high',selector:'#gone',targetType:'visual',targetId:'target_gone',signal:'a11y.name',sources:['axe'],evidence:'<input id="gone">'};
  const graph=buildEvidenceGraph({finding,page:{url:'https://example.com',hostname:'example.com'},environment:{type:'production',confidence:.9,confidenceLabel:'high'},coverage:{axe:'complete'},targetContext:null});
  const plan=deterministicFrankPlan(graph);
  assert.equal(graph.finding.targetId,'');
  assert.equal(graph.finding.targetType,'page');
  assert.equal(plan.steps.some(s=>s.type==='spotlight'),false);
});

test('extension ships immersive Frank runtime without debugger permission',()=>{
  const manifest=JSON.parse(fs.readFileSync('apps/extension/manifest.json','utf8'));
  const content=fs.readFileSync('apps/extension/content.js','utf8');
  const panel=fs.readFileSync('apps/extension/sidepanel.js','utf8');
  const build=fs.readFileSync('scripts/build-extension.mjs','utf8');
  assert.equal(manifest.permissions.includes('debugger'),false);
  assert.match(content,/FRANK_START/);
  assert.match(content,/box-shadow:0 0 0 99999px/);
  assert.match(content,/Shadow/iu);
  assert.match(panel,/PREPARE_FRANK/);
  assert.match(panel,/localFrankRuntime\.activateFromGesture/);
  assert.match(panel,/localFrankRuntime\.cloneTask/);
  assert.match(build,/local-ai\.js/);
  assert.match(panel,/Temporary preview applied/);
  assert.match(build,/frank-evidence\.js/);
  assert.match(build,/frank-plan\.js/);
  assert.match(build,/environment\.js/);
  assert.match(build,/policy\.js/);
});

test('Frank web demo has guided screenshot path and Ask Frank controls',()=>{
  const api=fs.readFileSync('services/api/server.js','utf8');
  const renderer=fs.readFileSync('services/renderer/server.js','utf8');
  const web=fs.readFileSync('apps/web/public/app.js','utf8');
  assert.match(api,/\/api\/frank\/snapshot/);
  assert.match(api,/\/api\/frank\/start/);
  assert.match(renderer,/app\.post\('\/snapshot'/);
  assert.match(web,/ask-frank/);
  assert.match(web,/frank-snapshot/);
});
