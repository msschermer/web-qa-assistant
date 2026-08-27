import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { RuntimeTrace, buildBugReport, bugReportPrivacySummary, DIAGNOSTIC_KIND, BUG_REPORT_SCHEMA_V2 } from '../packages/support/bug-report.js';

const finding={ruleId:'links.broken-link',impactClass:'availability',category:'fix',severity:'high',confidence:'confirmed',frankPriority:'blocker',selector:'#private-selector',sources:['browser'],verification:{state:'confirmed',method:'two browser GETs',attempts:2}};
const frank={finding,reasoning:{status:'fallback',provider:'chrome-built-in',mode:'deterministic',code:'LOCAL_AI_REMEDIATION_DRIFT',message:'Rejected https://example.com/private?token=secret'},plan:{mode:'deterministic',assessment:{status:'verified',statement:'Verified',limitations:''},steps:[{type:'interpretation',headline:'What I found',body:'Link https://example.com/private?token=secret is broken.',evidenceRefs:['ev1']}]},graph:{evidence:[{source:'browser',kind:'http-status',label:'Status',value:404},{source:'browser',kind:'selector',label:'Selector',value:'#private-selector'},{source:'browser',kind:'link-url',label:'URL',value:'https://example.com/private?token=secret'}]},planValid:true};

test('Report bug is privacy-safe by default and does not include page/Frank content',()=>{
  const trace=new RuntimeTrace({clock:()=> '2026-08-24T12:00:00Z'});
  trace.record('frank-reasoning',{code:'LOCAL_AI_FAILED',selector:'#secret',token:['sk','not','real','123456789012345'].join('-'),message:'secret page text',error:'secret page text'});
  const artifact=buildBugReport({version:'1.7.0',trace:trace.snapshot(),readiness:{status:'ready'},report:{environment:{type:'production'}},frank,localAi:{status:'rejected',code:'LOCAL_AI_REMEDIATION_DRIFT',candidate:{remediation:'secret page text'}},includeContext:false,userAgent:'Mozilla/5.0 Chrome/151.0.0.0 Safari/537.36'});
  const text=JSON.stringify(artifact);
  assert.equal(artifact.schema,BUG_REPORT_SCHEMA_V2);
  assert.equal(artifact.kind,DIAGNOSTIC_KIND);
  assert.equal(artifact.browser.chromeVersion,'151.0.0.0');
  assert.doesNotMatch(text,/private-selector|secret page text|sk-not-real|token=secret/);
  assert.match(text,/LOCAL_AI_REMEDIATION_DRIFT/);
  assert.equal(artifact.frank?.fallbackCode,'LOCAL_AI_REMEDIATION_DRIFT');
  assert.equal(artifact.frank?.optIn,undefined);
  assert.equal('context' in artifact,false);
  assert.match(bugReportPrivacySummary(false),/Finding titles, query values, cookies/);
});

test('Report bug opt-in includes bounded finding and Frank wording but never selectors or secrets',()=>{
  const artifact=buildBugReport({version:'1.7.0',trace:[],readiness:{status:'ready'},report:{environment:{type:'production'}},frank,localAi:{status:'rejected',code:'LOCAL_AI_REMEDIATION_DRIFT',candidate:{remediation:'Repair https://example.com/private?token=secret then contact qa@example.com or '+['602','555','1212'].join('-')}},includeContext:true,userNote:'Broken on https://example.com/page?session=abc'});
  const text=JSON.stringify(artifact);
  assert.equal(artifact.context.finding.ruleId,'links.broken-link');
  assert.match(text,/What I found/);
  assert.match(text,/\[email\]|\[phone\]/);
  assert.doesNotMatch(text,/private-selector|token=secret|session=abc/);
  assert.doesNotMatch(text,/cookies|formValues|rawDom/);
  assert.match(bugReportPrivacySummary(true),/bounded current-finding measurements/);
});

test('runtime trace is bounded and strips credential-shaped keys',()=>{
  const trace=new RuntimeTrace({limit:3,clock:()=> 't'});
  for(let i=0;i<5;i++)trace.record(`event-${i}`,{i,apiKey:'should-not-appear',pageText:'should-not-appear'});
  const out=trace.snapshot();
  assert.equal(out.length,3);
  assert.equal(out[0].type,'event-2');
  assert.doesNotMatch(JSON.stringify(out),/should-not-appear|apiKey|pageText/);
});

test('runtime trace ignores readiness flood',()=>{
  const trace=new RuntimeTrace({limit:5,clock:()=>'t'});
  for(let i=0;i<20;i++)trace.record('frank-readiness',{status:'checking'});
  trace.record('scan-start',{scanId:'scan-1',hasTab:true});
  const out=trace.snapshot();
  assert.equal(out.length,1);
  assert.equal(out[0].type,'scan-start');
});

test('Report bug redacts bearer-style credentials even from explicit user context',()=>{
  const bearer='Bearer '+['abcDEF123456','7890xyzTOKEN'].join('');
  const artifact=buildBugReport({version:'1.7.0',trace:[],readiness:{status:'ready'},includeContext:true,userNote:`Request failed with ${bearer}`,localAi:{status:'rejected',code:'LOCAL_AI_FAILED',candidate:{remediation:`Retry with ${bearer}`}}});
  const text=JSON.stringify(artifact);
  assert.doesNotMatch(text,/abcDEF123456|7890xyzTOKEN/);
  assert.match(text,/\[credential\]/);
});

test('Report bug is consumer-facing and local-only in the side panel',()=>{
  const html=fs.readFileSync('apps/extension/sidepanel.html','utf8');
  const js=fs.readFileSync('apps/extension/sidepanel.js','utf8');
  assert.match(html,/id="report-bug"/);
  assert.match(html,/Nothing is sent automatically/);
  assert.match(html,/Include current finding and Frank wording/);
  assert.match(html,/Download report/);
  assert.doesNotMatch(html,/Export Logs|Support Bundle|JSON Dump/);
  assert.match(js,/buildBugReport/);
  const handler=js.slice(js.indexOf("$('#report-bug').onclick"),js.indexOf("$('#scan').onclick"));
  assert.doesNotMatch(handler,/fetch\(|gatewayPost|send\(\{\s*type:\s*['\"]REPORT/);
});

test('default Report Bug omits visible-error page text and redacts it when opted in',()=>{
  const finding={
    ruleId:'browser.visible-error',
    visibleError:{
      messageExcerpt:'Reset https://example.com/reset?token=secret for qa@example.com',
      visibility:'visible',
      role:'alert',
      originClass:'page',
      firstObservedPhase:'initial-scan'
    },
    detail:'Reset https://example.com/reset?token=secret for qa@example.com',
    target:{status:'visible'}
  };
  const def=buildBugReport({version:'1.7.5',trace:[],readiness:{status:'ready'},report:{findings:[finding]},includeContext:false});
  assert.equal(def.visibleErrors.total,1);
  assert.equal(def.visibleErrors.items[0].messageExcerpt,undefined);
  assert.doesNotMatch(JSON.stringify(def),/token=secret|qa@example\.com/);
  const optIn=buildBugReport({version:'1.7.5',trace:[],readiness:{status:'ready'},report:{findings:[finding]},includeContext:true});
  assert.ok(optIn.visibleErrors.items[0].messageExcerpt);
  assert.match(optIn.visibleErrors.items[0].messageExcerpt,/\[email\]|\[url\]/);
  assert.doesNotMatch(JSON.stringify(optIn),/token=secret/);
});
