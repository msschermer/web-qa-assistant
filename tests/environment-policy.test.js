import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyEnvironment, sameSiteFamily, environmentNotice } from '../packages/environment/classify.js';
import { applyFindingPolicy } from '../packages/findings/policy.js';
import { guidanceFor } from '../packages/frank/guidance.js';

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
  assert.equal(env.source,'manual');
  assert.equal(env.confidence,1);
});

test('known BigScoots staging hosts classify as staging with high confidence',()=>{
  const env=classifyEnvironment({url:'https://example.bigscoots-staging.com/',robots:'noindex,nofollow'},{indexability:{blocked:true,publishedBlocked:true,renderedBlocked:true,mismatch:false}});
  assert.equal(env.type,'staging');
  assert.ok(['high','certain'].includes(env.confidenceLabel), `expected high or certain, got ${env.confidenceLabel}`);
  assert.equal(env.source,'auto');
  assert.ok(env.signals.some(s=>s==='known-host:bigscoots-staging.com'));
  assert.ok(env.signals.some(s=>s==='published-noindex'||s==='rendered-noindex'));
});

test('noindex does not classify an ordinary production domain as staging',()=>{
  const env=classifyEnvironment({url:'https://www.example.com/',robots:'noindex'});
  assert.equal(env.type,'production');
  assert.ok(env.signals.some(s=>/noindex/.test(s)));
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

test('staging noindex is an environment fact, not a Recommended Order defect',()=>{
  const published={ruleId:'seo.noindex-published',title:'Published response requests noindex',detail:'noindex',category:'fix',severity:'high',sources:['meta-state']};
  const mismatch={ruleId:'correlation.robots-mismatch',title:'Rendered and published robots directives differ',detail:'disagree',category:'fix',severity:'high',sources:['browser','meta-state']};
  const staging=applyFindingPolicy([published,mismatch],{type:'staging',pathname:'/'});
  assert.equal(staging[0].frankVisible,false);
  assert.equal(staging[0].frankPriority,'quiet');
  assert.equal(staging[1].frankVisible,false);
  const prod=applyFindingPolicy([published],{type:'production',pathname:'/'})[0];
  assert.equal(prod.frankVisible,true);
  assert.equal(prod.frankPriority,'blocker');
});

test('manual Production override on a staging-looking host restores noindex severity',()=>{
  const env=classifyEnvironment({url:'https://example.bigscoots-staging.com/'},{override:'production'});
  assert.equal(env.type,'production');
  assert.equal(env.source,'manual');
  const row=applyFindingPolicy([{ruleId:'seo.noindex',title:'Page requests noindex',detail:'noindex',category:'context',severity:'info'}],{type:env.type,pathname:'/'})[0];
  assert.equal(row.frankVisible,true);
  assert.equal(row.frankPriority,'blocker');
});

test('manual Staging override applies staging semantics on a production-looking host',()=>{
  const env=classifyEnvironment({url:'https://www.example.com/'},{override:'staging'});
  assert.equal(env.type,'staging');
  assert.equal(env.source,'manual');
  const row=applyFindingPolicy([{ruleId:'seo.noindex',title:'Page requests noindex',detail:'noindex'}],{type:env.type,pathname:'/'})[0];
  assert.equal(row.frankVisible,false);
  assert.equal(row.frankPriority,'quiet');
});

test('unverified link timeouts do not enter Franks default feed',()=>{
  const row=applyFindingPolicy([{ruleId:'navigation.link-timeout',title:'Internal link could not be verified',detail:'timeout',category:'review',severity:'low',link:{state:'timeout'}}],{type:'production'})[0];
  assert.equal(row.frankVisible,false);
});

test('staging environment notice is context, not an alarming defect',()=>{
  const env=classifyEnvironment({url:'https://example.bigscoots-staging.com/'},{indexability:{blocked:true,publishedBlocked:true,renderedBlocked:true,mismatch:false}});
  const notice=environmentNotice(env,{assessment:'noindex-detected'});
  assert.equal(notice.kind,'environment-noindex-detected');
  assert.equal(notice.tone,'info');
  assert.match(notice.kicker,/STAGING ENVIRONMENT/);
  assert.match(notice.title,/noindex directive was detected/i);
  assert.match(notice.body,/consistent with a staging environment/i);
  assert.doesNotMatch(JSON.stringify(notice),/\bindexable\b/i);
});

test('staging without blocking controls does not claim the page is indexable',()=>{
  const env=classifyEnvironment({url:'https://example.bigscoots-staging.com/'});
  const notice=environmentNotice(env,{assessment:'no-blocking-control-detected'});
  assert.equal(notice.kind,'environment-no-blocking-control');
  assert.match(notice.title,/No index-prevention control was detected/i);
  assert.doesNotMatch(JSON.stringify(notice),/indexable|does not appear to block search indexing/i);
});

test('unknown environment with noindex does not assume staging',()=>{
  const env=classifyEnvironment({url:'https://app.example.com/',robots:'noindex'});
  assert.equal(env.type,'unknown');
  const notice=environmentNotice(env,env.indexability);
  assert.equal(notice.kind,'unknown-index-blocked');
  const row=applyFindingPolicy([{ruleId:'seo.noindex',title:'Page requests noindex',detail:'noindex'}],{type:'unknown',pathname:'/'})[0];
  assert.equal(row.frankVisible,true);
});

test('unknown-environment Frank copy does not call the page production',()=>{
  const g=guidanceFor({ruleId:'seo.noindex',title:'Page requests noindex'},{type:'unknown',confidenceLabel:'low',source:'auto'});
  assert.match(g.interpretation,/could not be classified/i);
  assert.doesNotMatch(g.interpretation,/this production page/i);
  assert.match(g.recommendation,/confirm the environment/i);
});

test('medium-confidence hostname tokens do not quiet noindex as if staging were proven',()=>{
  const env=classifyEnvironment({url:'https://qa.example.com/',robots:'noindex'});
  assert.equal(env.type,'staging');
  assert.equal(env.confidenceLabel,'medium');
  const row=applyFindingPolicy([{ruleId:'seo.noindex',title:'Page requests noindex',detail:'noindex'}],env)[0];
  assert.equal(row.frankVisible,true);
});

test('production homepage noindex is not a blocker when published coverage is incomplete',()=>{
  const finding={ruleId:'seo.noindex',title:'Page requests noindex',detail:'noindex',category:'context',severity:'info',sources:['browser']};
  const incomplete=applyFindingPolicy([finding],{type:'production',pathname:'/',publishedCoverage:{status:'unavailable',reason:'meta-state-missing'}})[0];
  assert.equal(incomplete.frankPriority,'high');
  assert.equal(incomplete.category,'review');
  assert.match(incomplete.detail,/rendered document/);
  const complete=applyFindingPolicy([finding],{type:'production',pathname:'/'})[0];
  assert.equal(complete.frankPriority,'blocker');
  assert.match(complete.detail,/publishes a noindex/);
});
