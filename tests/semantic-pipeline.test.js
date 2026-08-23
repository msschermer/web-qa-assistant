import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

function browserContext(extra={}){
  const document={getElementById:()=>null,querySelector:()=>null,querySelectorAll:()=>[],documentElement:{},title:'',body:{},...extra.document};
  return vm.createContext({console,URL,Intl,CSS:{escape:s=>String(s)},location:{href:'https://example.com/',hostname:'example.com',protocol:'https:'},document,getComputedStyle:()=>({}),performance:{getEntriesByType:()=>[]},setTimeout,clearTimeout,...extra});
}

test('actual classifier -> runtime semantic context preserves adjacent text',()=>{
  const context=browserContext();
  vm.runInContext(fs.readFileSync('packages/rules/image-purpose.js','utf8'),context);
  vm.runInContext(fs.readFileSync('packages/rules/browser-rules.js','utf8'),context);
  const parent={tagName:'SECTION',className:'status-badge',cloneNode:()=>({querySelectorAll:()=>[],innerText:'Verified',textContent:'Verified'})};
  const attrs={src:'/assets/check-icon.svg'};
  const el={nodeType:1,tagName:'IMG',id:'',className:'check-icon',parentElement:parent,naturalWidth:24,naturalHeight:24,getAttribute:n=>attrs[n]||'',closest:()=>null,getBoundingClientRect:()=>({width:24,height:24}),innerText:'',textContent:''};
  const semantic=context.WebQARules.semanticContextFor(el,'axe.image-alt');
  assert.equal(semantic.imagePurpose.purpose,'decorative');
  assert.equal(semantic.imagePurpose.confidence,'high');
  assert.equal(semantic.imagePurpose.descriptor.siblingText,'Verified');
});

test('LCP is captured through buffered PerformanceObserver and transfer coverage is explicit',async()=>{
  const nav={requestStart:10,responseStart:2110,domContentLoadedEventEnd:2600,loadEventEnd:3100,duration:3100,transferSize:1200};
  const resources=[{name:'https://example.com/hero.jpg?token=private',initiatorType:'img',transferSize:7_000_000,duration:500},{name:'https://cdn.example.org/font.woff2',initiatorType:'css',transferSize:0,duration:40}];
  class PO{constructor(cb){this.cb=cb}observe(opts){assert.equal(opts.type,'largest-contentful-paint');assert.equal(opts.buffered,true);this.cb({getEntries:()=>[{startTime:5100,size:200000,url:'https://example.com/hero.jpg?token=private',element:{nodeType:1,tagName:'IMG',id:'hero',getAttribute:()=>'',parentElement:null}}]})}}
  const context=browserContext({PerformanceObserver:PO,performance:{getEntriesByType:type=>type==='navigation'?[nav]:type==='resource'?resources:type==='paint'?[]:[]}});
  vm.runInContext(fs.readFileSync('packages/rules/browser-rules.js','utf8'),context);
  await context.WebQARules.preparePerformanceSignals();
  const perf=context.WebQARules.performanceSignals();
  assert.equal(perf.largestContentfulPaintMs,5100);
  assert.equal(perf.lcpElement.selector,'#hero');
  assert.equal(perf.transferIsLowerBound,true);
  assert.equal(perf.unknownTransferCount,1);
  assert.ok(perf.transferBytes>7_000_000);
});
