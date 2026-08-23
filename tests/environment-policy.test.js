import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyEnvironment, sameSiteFamily } from '../packages/environment/classify.js';
import { applyFindingPolicy } from '../packages/findings/policy.js';

test('environment classifier recognizes clear local, staging, preview, and production hosts without AI',()=>{
  assert.equal(classifyEnvironment({url:'http://localhost:3000'}).type,'local');
  assert.equal(classifyEnvironment({url:'https://staging.example.com'}).type,'staging');
  assert.equal(classifyEnvironment({url:'https://feature-123.vercel.app'}).type,'preview');
  assert.equal(classifyEnvironment({url:'https://www.example.com',canonical:'https://www.example.com/'}).type,'production');
  assert.equal(classifyEnvironment({url:'https://example.co.uk'}).type,'production');
});

test('ambiguous public subdomains stay unknown instead of being promoted to production',()=>{
  const env=classifyEnvironment({url:'https://app.example.com',canonical:'https://app.example.com/'});
  assert.equal(env.type,'unknown');
  assert.equal(env.canonicalRelationship,'same-host');
});

test('same-site family handles common multi-part public suffix patterns',()=>{
  assert.equal(sameSiteFamily('staging.example.co.uk','www.example.co.uk'),true);
  assert.equal(sameSiteFamily('staging.example.co.uk','other.co.uk'),false);
});

test('user environment override wins over inference',()=>{
  const env=classifyEnvironment({url:'https://staging.example.com'},{override:'production'});
  assert.equal(env.type,'production');
  assert.equal(env.source,'user');
  assert.equal(env.confidence,1);
});

test('noindex is quiet on staging and critical on primary production pages',()=>{
  const finding={ruleId:'seo.noindex',title:'Page requests noindex',detail:'noindex',category:'context',severity:'info',sources:['browser']};
  const staging=applyFindingPolicy([finding],{type:'staging',pathname:'/services/'})[0];
  const prod=applyFindingPolicy([finding],{type:'production',pathname:'/services/'})[0];
  assert.equal(staging.frankVisible,false);
  assert.equal(staging.frankPriority,'quiet');
  assert.equal(prod.frankVisible,true);
  assert.equal(prod.frankPriority,'blocker');
  assert.equal(prod.category,'fix');
  assert.equal(prod.severity,'critical');
});

test('likely intentional utility noindex stays quiet even on production',()=>{
  const finding={ruleId:'seo.noindex',title:'Page requests noindex',detail:'noindex',category:'context',severity:'info'};
  const row=applyFindingPolicy([finding],{type:'production',pathname:'/thank-you/'})[0];
  assert.equal(row.frankVisible,false);
  assert.equal(row.frankPriority,'quiet');
});

test('staging canonical to the same site family is quiet but cross-site canonical remains reviewable',()=>{
  const finding={ruleId:'seo.canonical-cross-host',title:'Canonical points to another host',detail:'cross host',category:'review',severity:'medium'};
  const safe=applyFindingPolicy([finding],{type:'staging',canonicalRelationship:'same-site'})[0];
  const risky=applyFindingPolicy([finding],{type:'staging',canonicalRelationship:'cross-site'})[0];
  assert.equal(safe.frankVisible,false);
  assert.equal(risky.frankVisible,true);
});

test('low-materiality optimization observations stay available but quiet',()=>{
  const rows=applyFindingPolicy([{ruleId:'seo.title-long',title:'Review page title length',detail:'72 chars',category:'context',severity:'info'}],{type:'production'});
  assert.equal(rows[0].frankVisible,false);
});

test('confirmed broken internal links are material, and prominent production links become blockers',()=>{
  const base={ruleId:'navigation.link-404',title:'Internal link points to a missing page',detail:'404',category:'fix',severity:'high',link:{status:404,state:'complete'}};
  for(const type of ['staging','preview','local']) {
    const row=applyFindingPolicy([base],{type})[0];
    assert.equal(row.frankVisible,true);
    assert.equal(row.frankPriority,'high');
  }
  const prod=applyFindingPolicy([{...base,link:{...base.link,prominence:'navigation'}}],{type:'production'})[0];
  assert.equal(prod.frankPriority,'blocker');
  assert.equal(prod.severity,'critical');
});

test('unverified link timeouts do not enter Franks default feed',()=>{
  const row=applyFindingPolicy([{ruleId:'navigation.link-timeout',title:'Internal link could not be verified',detail:'timeout',category:'review',severity:'low',link:{state:'timeout'}}],{type:'production'})[0];
  assert.equal(row.frankVisible,false);
});
