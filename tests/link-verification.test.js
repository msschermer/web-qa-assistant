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
  assert.equal(result.unprobed,0);
  assert.equal(result.scannerAborted||0,0);
  // Attempted-but-inconclusive is not the same as untested — coverage is complete.
  assert.equal(result.status,'complete');
  assert.equal(result.incompleteChecks[0].path,'/slow/');
  assert.equal(result.incompleteChecks[0].cause,'scanner-timeout');
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

test('link discovery is not capped by the probe limit',async()=>{
  const anchors=[];
  const sequences={};
  for(let i=0;i<40;i++){
    const url=`https://example.com/page-${i}/`;
    anchors.push(anchor(url,`Link ${i}`));
    sequences[url]=[{status:200}];
  }
  const h=harness(anchors,sequences);
  const result=await h.rules.auditLinks({limit:10,concurrency:4,timeoutMs:100,retryTimeoutMs:100,budgetMs:5000});
  assert.equal(result.discovered,40);
  assert.equal(result.eligible,40);
  assert.equal(result.attempted,10);
  assert.equal(result.unprobed,30);
  assert.equal(result.status,'partial');
  assert.equal(result.probeBudgetPreventedCoverage,true);
});

function makeAnchors(n, {host='example.com', prefix='page'}={}){
  const anchors=[], sequences={};
  for(let i=0;i<n;i++){
    const url=`https://${host}/${prefix}-${i}/`;
    anchors.push(anchor(url,`Link ${i}`));
    sequences[url]=[{status:200}];
  }
  return {anchors, sequences};
}

test('small page: 1 eligible link is attempted',async()=>{
  const {anchors,sequences}=makeAnchors(1);
  const result=await harness(anchors,sequences).rules.auditLinks({concurrency:8,timeoutMs:200,retryTimeoutMs:200,budgetMs:5000});
  assert.equal(result.discovered,1);
  assert.equal(result.eligible,1);
  assert.equal(result.attempted,1);
  assert.equal(result.unprobed,0);
  assert.equal(result.scannerAborted,0);
  assert.equal(result.status,'complete');
});

test('ordinary page: 36 eligible links are all attempted',async()=>{
  const {anchors,sequences}=makeAnchors(36);
  const result=await harness(anchors,sequences).rules.auditLinks({concurrency:8,timeoutMs:200,retryTimeoutMs:200,budgetMs:8000});
  assert.equal(result.discovered,36);
  assert.equal(result.eligible,36);
  assert.equal(result.attempted,36);
  assert.equal(result.unprobed,0);
  assert.equal(result.scannerAborted,0);
  assert.equal(result.status,'complete');
  assert.equal(result.probeBudgetPreventedCoverage,false);
});

test('larger ordinary page: 100 eligible links are all attempted under default ceiling',async()=>{
  const {anchors,sequences}=makeAnchors(100);
  const result=await harness(anchors,sequences).rules.auditLinks({concurrency:8,timeoutMs:150,retryTimeoutMs:150,budgetMs:15000});
  assert.equal(result.discovered,100);
  assert.equal(result.eligible,100);
  assert.equal(result.attempted,100);
  assert.equal(result.unprobed,0);
  assert.equal(result.status,'complete');
});

test('large page: 200 eligible links are all attempted under the 500 hard ceiling',async()=>{
  const {anchors,sequences}=makeAnchors(200);
  const result=await harness(anchors,sequences).rules.auditLinks({concurrency:8,timeoutMs:100,retryTimeoutMs:100,emergencyMs:20000});
  assert.equal(result.discovered,200);
  assert.equal(result.eligible,200);
  assert.equal(result.attempted,200);
  assert.equal(result.unprobed,0);
  assert.equal(result.status,'complete');
});

test('emergency hard ceiling: discovery stays full and leftover links are unprobed',async()=>{
  const {anchors,sequences}=makeAnchors(320);
  const result=await harness(anchors,sequences).rules.auditLinks({limit:300,concurrency:8,timeoutMs:80,retryTimeoutMs:80,budgetMs:20000});
  assert.equal(result.discovered,320);
  assert.equal(result.eligible,320);
  assert.equal(result.attempted,300);
  assert.equal(result.unprobed,20);
  assert.equal(result.status,'partial');
  assert.equal(result.probeBudgetPreventedCoverage,true);
  assert.equal(result.reachedLimit,true);
});

test('link probing uses bounded concurrency',async()=>{
  const anchors=[];
  const sequences={};
  let inFlight=0,maxInFlight=0;
  for(let i=0;i<24;i++){
    const url=`https://example.com/conc-${i}/`;
    anchors.push(anchor(url,`C ${i}`));
    sequences[url]=[{status:200,delay:40}];
  }
  const queues=new Map(Object.entries(sequences).map(([url,rows])=>[url,[...rows]]));
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
      inFlight++;
      maxInFlight=Math.max(maxInFlight,inFlight);
      const queue=queues.get(String(url))||[];
      const next=queue.length?queue.shift():{status:200};
      try{
        if(next.delay)await new Promise(r=>setTimeout(r,next.delay));
        return {status:next.status||200,url:next.url||String(url),redirected:Boolean(next.redirected)};
      }finally{inFlight--;}
    }
  };
  vm.createContext(context);
  vm.runInContext(fs.readFileSync('packages/rules/browser-rules.js','utf8'),context,{filename:'browser-rules.js'});
  const result=await context.WebQARules.auditLinks({concurrency:8,perHostConcurrency:8,timeoutMs:500,retryTimeoutMs:500,emergencyMs:8000});
  assert.equal(result.attempted,24);
  assert.ok(maxInFlight<=8,`expected <=8 in-flight, got ${maxInFlight}`);
  assert.ok(maxInFlight>=2,`expected overlapping probes, got ${maxInFlight}`);
});

test('deadline with active probes records scanner-caused aborts, not invented remotes',async()=>{
  const anchors=[];
  const sequences={};
  for(let i=0;i<40;i++){
    const url=`https://example.com/slow-${i}/`;
    anchors.push(anchor(url,`Slow ${i}`));
    sequences[url]=[abortError(),abortError()];
  }
  const queues=new Map(Object.entries(sequences).map(([url,rows])=>[url,[...rows]]));
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
    fetch:async(url,opts)=>{
      await new Promise((resolve,reject)=>{
        const timer=setTimeout(resolve,400);
        opts?.signal?.addEventListener('abort',()=>{
          clearTimeout(timer);
          const error=abortError();
          reject(error);
        });
      });
      if(opts?.signal?.aborted)throw abortError();
      const queue=queues.get(String(url))||[];
      const next=queue.length?queue.shift():abortError();
      if(next instanceof Error)throw next;
      throw abortError();
    }
  };
  vm.createContext(context);
  vm.runInContext(fs.readFileSync('packages/rules/browser-rules.js','utf8'),context,{filename:'browser-rules.js'});
  const result=await context.WebQARules.auditLinks({concurrency:8,perHostConcurrency:2,timeoutMs:80,retryTimeoutMs:80,emergencyMs:50});
  assert.equal(result.discovered,40);
  assert.ok(result.unprobed>0 || result.scannerAborted>0, 'emergency deadline must leave unfinished or aborted work');
  if(result.scannerAborted>0){
    assert.equal(result.scannerAborted, result.inconclusiveByCause.scannerBudgetAborted);
  }
  assert.equal(result.attempted, result.verifiedHealthy + result.confirmedIssues + result.inconclusive);
  assert.equal(result.eligible, result.attempted + result.unprobed + result.explicitlySkipped);
  assert.equal(result.probeBudgetPreventedCoverage, true);
  assert.equal(result.status,'partial');
});

test('default hard ceiling is a safety limit, not a 36-link functional cap',()=>{
  const source=fs.readFileSync('packages/rules/browser-rules.js','utf8');
  const content=fs.readFileSync('apps/extension/content.js','utf8');
  assert.match(source,/LINK_PROBE_HARD_CEILING\s*=\s*500/);
  assert.match(source,/LINK_PROBE_EMERGENCY_MS\s*=\s*60000/);
  assert.match(source,/runPrimaryVerificationQueue/);
  assert.doesNotMatch(source,/LINK_PROBE_BUDGET_MS\s*=\s*20000/);
  assert.doesNotMatch(source,/limit:\s*36/);
  assert.doesNotMatch(source,/SAME_ORIGIN_IFRAME_BUDGET\s*=\s*3/);
  assert.match(content,/emergencyMs: 60000/);
  assert.doesNotMatch(content,/budgetMs: 20000/);
});
