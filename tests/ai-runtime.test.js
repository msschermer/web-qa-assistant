import test from 'node:test';
import assert from 'node:assert/strict';
import { frankWalkthrough, probeAiHealth, __resetAiHealthCacheForTests } from '../packages/ai/ai.js';

const graph={version:3,findingId:'demo',finding:{id:'demo',ruleId:'seo.title-missing',title:'Missing title',detail:'No title was found.',category:'fix',severity:'high',confidence:'confirmed',verification:{state:'confirmed',method:'browser',attempts:1},selector:'',targetId:'',targetType:'document',signal:'title',sources:['browser'],wcag:[]},page:{url:'https://example.com/',hostname:'example.com',title:''},environment:{type:'production'},coverage:{browser:'complete'},targets:{},evidence:[{id:'ev1',source:'browser',kind:'finding',label:'Verified finding',value:'No title was found.',scope:'current-page',targetId:''}],sources:['browser']};

test('Frank AI failure is thrown instead of silently becoming a deterministic plan',async()=>{
  const previousKey=process.env.OPENAI_API_KEY,previousFetch=global.fetch;
  process.env.OPENAI_API_KEY='test-key-that-is-never-sent-to-a-real-service';
  global.fetch=async()=>new Response(JSON.stringify({error:{message:'provider failed'}}),{status:500,headers:{'content-type':'application/json'}});
  try{await assert.rejects(()=>frankWalkthrough(graph),error=>error?.code==='AI_HTTP_ERROR')}finally{global.fetch=previousFetch;if(previousKey===undefined)delete process.env.OPENAI_API_KEY;else process.env.OPENAI_API_KEY=previousKey}
});

test('Frank AI health distinguishes configured from operational',async()=>{
  const previousKey=process.env.OPENAI_API_KEY,previousFetch=global.fetch;
  process.env.OPENAI_API_KEY='test-key-that-is-never-sent-to-a-real-service';
  global.fetch=async()=>new Response(JSON.stringify({error:{message:'provider failed'}}),{status:500,headers:{'content-type':'application/json'}});
  __resetAiHealthCacheForTests();
  try{const health=await probeAiHealth({force:true});assert.equal(health.operational,false);assert.equal(health.status,'failed');assert.equal(health.code,'AI_HTTP_ERROR')}finally{global.fetch=previousFetch;if(previousKey===undefined)delete process.env.OPENAI_API_KEY;else process.env.OPENAI_API_KEY=previousKey;__resetAiHealthCacheForTests()}
});
