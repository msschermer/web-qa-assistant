import test from 'node:test';
import assert from 'node:assert/strict';
import { gatewayContextEnvelope, gatewayFrankGraph } from '../packages/ai/evidence-contract.js';

test('Frank payload removes hostile secrets from nested performance and unknown finding fields',()=>{
  const secret='supersecret-session-value';
  const graph=gatewayFrankGraph({version:3,findingId:'f1',finding:{id:'f1',ruleId:'performance.browser.weight',title:'Heavy',detail:'Heavy page',category:'review',severity:'medium',confidence:'confirmed',selector:'',secretField:secret,semantics:{imagePurpose:{purpose:'decorative',confidence:'high',descriptor:{siblingText:'Verified',secret:secret}}},performanceObservation:{available:true,transferBytes:7000000,resourceCount:2,measuredTransferCount:1,unknownTransferCount:1,transferIsLowerBound:true,lcpElement:{tag:'img',selector:'#hero',url:`https://example.com/hero?token=${secret}`,size:10},heaviest:[{type:'img',bytes:7000000,durationMs:100,name:`https://example.com/a.jpg?session=${secret}&utm_source=x`}]}},page:{url:`https://example.com/?token=${secret}`,hostname:'example.com',title:'Test'},environment:{type:'production'},coverage:{browser:'complete'},sources:['browser-performance'],evidence:[{id:'e1',source:'browser-performance',kind:'heaviest-resource',label:'Heaviest img',value:{bytes:7000000,url:`https://example.com/a.jpg?token=${secret}`},scope:'current-page'}],targets:{}});
  const text=JSON.stringify(graph);
  assert.doesNotMatch(text,new RegExp(secret));
  assert.doesNotMatch(text,/secretField/);
  assert.match(text,/\[redacted\]|%5Bredacted%5D/);
  assert.equal(graph.finding.semantics.imagePurpose.nearbyText,'Verified');
});


test('gateway context sanitizes URLs embedded inside generic finding and verification evidence',()=>{
  const secret='shortsecret';
  const report=gatewayContextEnvelope({
    page:{url:`https://example.com/?session=${secret}`,hostname:'example.com',title:'Example'},
    findings:[{id:'l1',ruleId:'navigation.link-404',title:'Broken',detail:'Broken link',category:'fix',severity:'high',confidence:'confirmed',evidence:`confirmed 404 https://example.com/private?token=${secret}`,verification:{state:'confirmed-failure',method:'GET',attempts:2,evidence:[{finalUrl:`https://example.com/private?auth=${secret}`,status:404}]},link:{url:`https://example.com/private?token=${secret}`,status:404,state:'missing'}}],
    coverage:{browser:'complete'}
  });
  const text=JSON.stringify(report);
  assert.doesNotMatch(text,new RegExp(secret));
  assert.match(text,/\[redacted\]|%5Bredacted%5D/);
});
