import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

function abortError(message='timed out'){
  const error=new Error(message);error.name='AbortError';return error;
}
function anchor(href,text='Profile',{nav=false,main=false,footer=false,classes=''}={}){
  return {
    href,innerText:text,className:classes,nodeType:1,localName:'a',tagName:'A',id:'',
    classList:classes?classes.split(/\s+/).filter(Boolean):[],
    parentElement:null,outerHTML:`<a href="${href}">${text}</a>`,
    getAttribute(name){if(name==='href')return href;if(name==='aria-label'||name==='title')return'';return null},
    hasAttribute(){return false},
    closest(selector){
      if(nav&&selector.includes('nav'))return{};
      if(main&&selector.includes('main'))return{};
      if(footer&&selector.includes('footer'))return{};
      return null;
    }
  };
}
function harness(anchors,sequences){
  const queues=new Map(Object.entries(sequences).map(([url,rows])=>[url,[...rows]]));
  let fetchCount=0;
  const context={
    URL,AbortController,setTimeout,clearTimeout,performance,
    CSS:{escape:v=>String(v)},
    location:{href:'https://example.com/source/',origin:'https://example.com',protocol:'https:',hostname:'example.com'},
    document:{
      querySelectorAll(selector){return selector==='a[href]'?anchors:[]},
      querySelector(){return null},
      head:{contains(){return false}},
      body:{contains(){return true}},
      documentElement:{},
      links:anchors,forms:[],images:[]
    },
    fetch:async url=>{
      fetchCount++;
      const queue=queues.get(String(url))||[];
      const next=queue.length?queue.shift():{status:200};
      if(next instanceof Error)throw next;
      if(next?.throw)throw next.throw;
      return {status:next.status,url:next.url||String(url),redirected:Boolean(next.redirected)};
    }
  };
  vm.createContext(context);
  vm.runInContext(fs.readFileSync('packages/rules/browser-rules.js','utf8'),context,{filename:'browser-rules.js'});
  return {rules:context.WebQARules,fetchCount:()=>fetchCount};
}

test('a timeout followed by a healthy response is not a finding',async()=>{
  const url='https://example.com/team-profile/';
  const h=harness([anchor(url,'Team Profile',{nav:true})],{[url]:[abortError(),{status:200}]});
  const result=await h.rules.auditLinks({limit:10,concurrency:1,timeoutMs:100,retryTimeoutMs:100,budgetMs:2000});
  assert.equal(result.findings.length,0);
  assert.equal(result.inconclusive,0);
  assert.equal(result.verifiedHealthy,1);
});

test('two independent 404 responses create one confirmed broken-link finding',async()=>{
  const url='https://example.com/missing/';
  const h=harness([anchor(url,'Missing',{nav:true})],{[url]:[{status:404},{status:404}]});
  const result=await h.rules.auditLinks({limit:10,concurrency:1,timeoutMs:100,retryTimeoutMs:100,budgetMs:2000});
  assert.equal(result.findings.length,1);
  assert.equal(result.findings[0].ruleId,'navigation.link-404');
  assert.equal(result.findings[0].confidence,'confirmed');
  assert.equal(result.findings[0].verification.attempts,2);
  assert.equal(result.confirmedIssues,1);
});

test('repeated timeouts remain coverage-only and never become a broken-link finding',async()=>{
  const url='https://example.com/slow/';
  const h=harness([anchor(url,'Slow')],{[url]:[abortError(),abortError()]});
  const result=await h.rules.auditLinks({limit:10,concurrency:1,timeoutMs:100,retryTimeoutMs:100,budgetMs:2000});
  assert.equal(result.findings.length,0);
  assert.equal(result.inconclusive,1);
  assert.equal(result.status,'partial');
  assert.equal(result.incompleteChecks[0].path,'/slow/');
});

test('one failure plus one inconclusive probe requires a third confirming failure',async()=>{
  const url='https://example.com/missing-after-retry/';
  const h=harness([anchor(url,'Retry')],{[url]:[{status:404},abortError(),{status:404}]});
  const result=await h.rules.auditLinks({limit:10,concurrency:1,timeoutMs:100,retryTimeoutMs:100,budgetMs:2000});
  assert.equal(result.findings.length,1);
  assert.equal(result.findings[0].confidence,'confirmed');
  assert.equal(result.findings[0].verification.attempts,3);
});

test('duplicate source anchors are grouped into one underlying URL issue',async()=>{
  const url='https://example.com/team/gone/';
  const h=harness([anchor(url,'Team member',{nav:true}),anchor(url,'Team member',{main:true})],{[url]:[{status:404},{status:404}]});
  const result=await h.rules.auditLinks({limit:10,concurrency:1,timeoutMs:100,retryTimeoutMs:100,budgetMs:2000});
  assert.equal(result.findings.length,1);
  assert.equal(result.findings[0].count,2);
  assert.equal(result.findings[0].link.occurrences,2);
  assert.equal(result.findings[0].link.sources.length,2);
});

test('link verifier uses browser GET and does not emit timeout findings',()=>{
  const source=fs.readFileSync('packages/rules/browser-rules.js','utf8');
  assert.match(source,/method:'GET'/);
  assert.doesNotMatch(source,/ruleId:'navigation\.link-timeout'/);
  assert.match(source,/verificationState:'inconclusive'/);
});
