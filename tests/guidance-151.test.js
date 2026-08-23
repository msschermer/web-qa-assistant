import test from 'node:test';
import assert from 'node:assert/strict';
import { guidanceFor } from '../packages/frank/guidance.js';

const cases=[
  ['seo.canonical-invalid',/valid absolute HTTP/i],['seo.canonical-cross-host',/intentional/i],['seo.canonical-fragment',/fragment/i],
  ['seo.title-multiple',/one intended/i],['seo.description-missing',/description/i],['structure.heading-skip',/heading level/i],
  ['security.blank-opener',/noopener/i],['web.charset-missing',/UTF-8/i],['web.meta-refresh',/server redirect|3xx/i],['social.og-incomplete',/Open Graph/i]
];
for(const [ruleId,pattern] of cases)test(`${ruleId} has rule-specific Frank guidance`,()=>{const g=guidanceFor({ruleId},{type:'production'});assert.match(`${g.interpretation} ${g.recommendation} ${g.remediation}`,pattern)});

test('browser performance guidance is metric-specific and evidence-led',()=>{
  const ttfb=guidanceFor({ruleId:'performance.browser.ttfb',performanceObservation:{ttfbMs:2100}});assert.match(ttfb.remediation,/origin|cache|CDN/i);assert.doesNotMatch(ttfb.remediation,/image payloads and asset changes around the regression window/i);
  const lcp=guidanceFor({ruleId:'performance.browser.lcp',performanceObservation:{largestContentfulPaintMs:5100,lcpElement:{selector:'#hero'}}});assert.match(lcp.interpretation,/#hero/);assert.match(lcp.remediation,/LCP element|image|text/i);
  const weight=guidanceFor({ruleId:'performance.browser.weight',performanceObservation:{transferBytes:7340032,unknownTransferCount:3,transferIsLowerBound:true}});assert.match(weight.interpretation,/at least 7\.0MB/i);assert.match(weight.remediation,/heaviest/i);
});
