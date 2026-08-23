import test from 'node:test';
import assert from 'node:assert/strict';
import { aiEvidenceEnvelope, gatewayContextEnvelope, gatewayFrankGraph, sanitizeMarkup, sanitizeUrl } from '../packages/ai/evidence-contract.js';

test('AI evidence contract strips form values, arbitrary data attributes and query values',()=>{
  const markup='<input id="email" class="field" type="email" value="person@example.com" data-user-id="123" data-token="secret" aria-label="Email">';
  const safe=sanitizeMarkup(markup);
  assert.match(safe,/id="email"/);
  assert.match(safe,/aria-label="Email"/);
  assert.doesNotMatch(safe,/person@example\.com/);
  assert.doesNotMatch(safe,/data-user-id/);
  assert.doesNotMatch(safe,/data-token/);
});

test('AI evidence contract redacts URL query contents while preserving useful route context',()=>{
  const safe=sanitizeUrl('https://example.com/contact?utm_source=google&token=supersecret#section');
  assert.match(safe,/https:\/\/example\.com\/contact/);
  assert.match(safe,/utm_source=%5Bvalue%5D/);
  assert.match(safe,/token=%5Bredacted%5D/);
  assert.doesNotMatch(safe,/supersecret/);
  assert.doesNotMatch(safe,/#section/);
});

test('AI envelope explicitly forbids whole DOM, cookies and form values',()=>{
  const envelope=aiEvidenceEnvelope({
    finding:{ruleId:'axe.label',title:'Missing label',detail:'Control has no accessible name',selector:'#email',verification:{state:'confirmed',method:'axe',attempts:1}},
    page:{url:'https://example.com/form?session=abc',hostname:'example.com',title:'Form'},
    environment:{type:'production'},coverage:{browser:'complete'},sources:['axe'],
    evidence:[{id:'e1',source:'browser',kind:'markup',label:'Markup',value:'<input id="email" value="private">',scope:'current-page',targetId:'t1'}],
    targets:{t1:{selector:'#email',context:{tag:'input',markup:'<input id="email" value="private">',text:'private value',styles:{display:'block'}}}}
  });
  assert.equal(envelope.rules.wholeDomAllowed,false);
  assert.equal(envelope.rules.formValuesAllowed,false);
  assert.equal(envelope.rules.cookiesAllowed,false);
  assert.doesNotMatch(JSON.stringify(envelope),/value=\\?"private/);
  assert.doesNotMatch(envelope.page.url,/abc/);
});

test('gateway context envelope is report-shaped but excludes raw axe payloads and incomplete URL lists',()=>{
  const report=gatewayContextEnvelope({
    page:{url:'https://example.com/form?token=abc',hostname:'example.com',title:'Form',canonical:'https://example.com/form?x=1'},
    findings:[{id:'a',ruleId:'axe.label',title:'Missing label',detail:'A label is missing',category:'fix',severity:'high',confidence:'confirmed',selector:'#email',targetId:'target_email',targetType:'visual',axe:{nodes:[{html:'secret'}]},evidence:'<input id="email" value="person@example.com">'}],
    coverage:{browser:'complete'},linkAudit:{checked:5,inconclusive:1,incompleteChecks:[{url:'https://example.com/private?token=secret'}]}
  });
  const text=JSON.stringify(report);
  assert.doesNotMatch(text,/person@example\.com/);
  assert.doesNotMatch(text,/nodes/);
  assert.doesNotMatch(text,/incompleteChecks/);
  assert.doesNotMatch(text,/token=abc/);
  assert.equal(report.findings[0].targetId,'target_email');
});

test('gateway Frank graph preserves evidence and target IDs while sanitizing values',()=>{
  const graph=gatewayFrankGraph({version:3,findingId:'f1',finding:{id:'f1',ruleId:'axe.label',title:'Label',detail:'Missing',selector:'#email'},page:{url:'https://example.com/?token=abc',hostname:'example.com',title:'Test'},environment:{type:'production'},coverage:{browser:'complete'},sources:['axe'],evidence:[{id:'e1',source:'browser',kind:'markup',label:'Markup',value:'<input id="email" value="secret">',scope:'current-page',targetId:'t1'}],targets:{t1:{selector:'#email',context:{tag:'input',markup:'<input id="email" value="secret">',text:'',styles:{display:'block'}}}}});
  assert.equal(graph.version,3);
  assert.equal(graph.findingId,'f1');
  assert.equal(graph.evidence[0].id,'e1');
  assert.ok(graph.targets.t1);
  assert.doesNotMatch(JSON.stringify(graph),/value=\\?"secret/);
  assert.doesNotMatch(graph.page.url,/abc/);
});
