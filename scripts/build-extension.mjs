import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
const root=process.cwd(),src=path.join(root,'apps/extension'),out=path.join(root,'dist/extension');
function shortBuildRevision(){
  try{
    const rev=String(execSync('git rev-parse --short=12 HEAD',{cwd:root,encoding:'utf8',stdio:['ignore','pipe','ignore']})).trim();
    if(/^[0-9a-f]{7,12}$/i.test(rev))return rev.toLowerCase();
  }catch{}
  return 'unknown';
}
const buildRevision=shortBuildRevision();
const installedAxe=path.join(root,'node_modules/axe-core/axe.min.js'),vendoredAxe=path.join(out,'vendor/axe.min.js');
const axeBytes=fs.existsSync(installedAxe)?fs.readFileSync(installedAxe):fs.existsSync(vendoredAxe)?fs.readFileSync(vendoredAxe):null;
if(!axeBytes)throw new Error('axe-core runtime is unavailable. Run npm ci, or start from a release source package that includes dist/extension/vendor/axe.min.js.');
fs.rmSync(out,{recursive:true,force:true});fs.mkdirSync(out,{recursive:true});
for(const name of ['manifest.json','background.js','content.js','page-diagnostics.js','sidepanel.html','sidepanel.css','sidepanel.js'])fs.copyFileSync(path.join(src,name),path.join(out,name));
const localAiSource=fs.readFileSync(path.join(src,'local-ai.js'),'utf8')
  .replaceAll('../../packages/findings/evidence-ledger.js','./evidence-ledger.js')
  .replaceAll('../../packages/findings/guidance-composition.js','./guidance-composition.js');
fs.writeFileSync(path.join(out,'local-ai.js'),localAiSource);
const presentationSource=fs.readFileSync(path.join(root,'packages/presentation/present.js'),'utf8')
  .replace("../frank/guidance.js","./guidance.js")
  .replace("../findings/link-in-text.js","./link-in-text.js");
fs.writeFileSync(path.join(out,'presentation.js'),presentationSource);
fs.copyFileSync(path.join(root,'packages/findings/coverage.js'),path.join(out,'coverage.js'));
fs.copyFileSync(path.join(root,'packages/findings/scan-lifecycle.js'),path.join(out,'scan-lifecycle.js'));
const bugReportSource=fs.readFileSync(path.join(root,'packages/support/bug-report.js'),'utf8')
  .replaceAll('../ai/evidence-contract.js','./evidence-contract.js')
  .replaceAll('../findings/coverage.js','./coverage.js')
  .replaceAll('../findings/evidence-ledger.js','./evidence-ledger.js')
  .replaceAll('../frank/review-state.js','./review-state.js');
fs.writeFileSync(path.join(out,'bug-report.js'),bugReportSource);
fs.copyFileSync(path.join(root,'packages/ui/tokens.css'),path.join(out,'ui-tokens.css'));
fs.copyFileSync(path.join(root,'packages/ai/evidence-contract.js'),path.join(out,'evidence-contract.js'));
fs.copyFileSync(path.join(root,'packages/rules/browser-rules.js'),path.join(out,'browser-rules.js'));
fs.copyFileSync(path.join(root,'packages/rules/image-purpose.js'),path.join(out,'image-purpose.js'));
fs.copyFileSync(path.join(root,'packages/integrity/target-integrity.js'),path.join(out,'target-integrity.js'));
fs.copyFileSync(path.join(root,'packages/integrity/apply-report.js'),path.join(out,'apply-report.js'));
function buildIntegrityBrowserBundle(root, outDir) {
  let src = fs.readFileSync(path.join(root, 'packages/integrity/target-integrity.js'), 'utf8');
  src = src.replace(/^export const /gm, 'const ');
  src = src.replace(/^export function /gm, 'function ');
  const bundle = `(() => {\n${src}\nglobalThis.WebQATargetIntegrity = { TARGET_STATES, collectDomSignals, assessTargetIntegrity, targetIntegrityReached, targetIntegrityBlocksAudit, suppressFindingsForTargetIntegrity, adjustCoverageForTargetIntegrity, targetIntegrityBrief, isPageDerivedFinding };\n})();\n`;
  fs.writeFileSync(path.join(root, 'packages/integrity/target-integrity.browser.js'), bundle);
  fs.writeFileSync(path.join(outDir, 'target-integrity.browser.js'), bundle);
}

buildIntegrityBrowserBundle(root, out);
fs.copyFileSync(path.join(root,'packages/findings/correlate.js'),path.join(out,'correlate.js'));
fs.copyFileSync(path.join(root,'packages/findings/correlation.js'),path.join(out,'correlation.js'));
fs.copyFileSync(path.join(root,'packages/findings/compose.js'),path.join(out,'compose.js'));
fs.copyFileSync(path.join(root,'packages/findings/evidence-ledger.js'),path.join(out,'evidence-ledger.js'));
fs.copyFileSync(path.join(root,'packages/findings/impact.js'),path.join(out,'impact.js'));
fs.copyFileSync(path.join(root,'packages/findings/signals.js'),path.join(out,'signals.js'));
fs.copyFileSync(path.join(root,'packages/findings/confidence.js'),path.join(out,'confidence.js'));
fs.copyFileSync(path.join(root,'packages/findings/policy.js'),path.join(out,'policy.js'));
fs.copyFileSync(path.join(root,'packages/findings/performance-assessment.js'),path.join(out,'performance-assessment.js'));
fs.copyFileSync(path.join(root,'packages/findings/link-in-text.js'),path.join(out,'link-in-text.js'));
fs.copyFileSync(path.join(root,'packages/findings/guidance-composition.js'),path.join(out,'guidance-composition.js'));
fs.copyFileSync(path.join(root,'packages/findings/link-probe-control.js'),path.join(out,'link-probe-control.js'));
fs.copyFileSync(path.join(root,'packages/findings/link-status-cache.js'),path.join(out,'link-status-cache.js'));
fs.copyFileSync(path.join(root,'packages/environment/published-coverage.js'),path.join(out,'published-coverage.js'));
fs.copyFileSync(path.join(root,'packages/frank/review-state.js'),path.join(out,'review-state.js'));
fs.copyFileSync(path.join(root,'packages/environment/hosts.js'),path.join(out,'hosts.js'));
fs.copyFileSync(path.join(root,'packages/environment/index-control.js'),path.join(out,'index-control.js'));
fs.copyFileSync(path.join(root,'packages/environment/launch-readiness.js'),path.join(out,'launch-readiness.js'));
fs.copyFileSync(path.join(root,'packages/environment/classify.js'),path.join(out,'environment.js'));
const reviewContextSource=fs.readFileSync(path.join(root,'packages/frank/review-context.js'),'utf8').replace('../environment/classify.js','./environment.js');
fs.writeFileSync(path.join(out,'review-context.js'),reviewContextSource);
fs.copyFileSync(path.join(root,'packages/frank/evidence.js'),path.join(out,'frank-evidence.js'));
// Keep the original module filename too because frank-plan.js imports ./evidence.js.
fs.copyFileSync(path.join(root,'packages/frank/evidence.js'),path.join(out,'evidence.js'));
fs.copyFileSync(path.join(root,'packages/frank/guidance.js'),path.join(out,'guidance.js'));
{
  const guidancePath=path.join(out,'guidance.js');
  let guidance=fs.readFileSync(guidancePath,'utf8');
  guidance=guidance.replace('../findings/link-in-text.js','./link-in-text.js');
  fs.writeFileSync(guidancePath,guidance);
}
const frankPlanSource=fs.readFileSync(path.join(root,'packages/frank/plan.js'),'utf8')
  .replace('../findings/correlation.js','./correlation.js')
  .replace('../findings/guidance-composition.js','./guidance-composition.js');
fs.writeFileSync(path.join(out,'frank-plan.js'),frankPlanSource);
fs.writeFileSync(path.join(out,'plan.js'),frankPlanSource);
fs.mkdirSync(path.join(out,'vendor'),{recursive:true});fs.writeFileSync(path.join(out,'vendor/axe.min.js'),axeBytes);
fs.mkdirSync(path.join(out,'icons'),{recursive:true});for(const n of ['16.png','32.png','48.png','128.png'])fs.copyFileSync(path.join(src,'icons',n),path.join(out,'icons',n));
fs.writeFileSync(path.join(out,'build-revision.json'),`${JSON.stringify({ buildRevision, releasedVersion: '1.7.5', developmentTarget: '1.7.6' }, null, 2)}\n`);
// Inject revision into sidepanel without editing source tree identity.
{
  const panelPath=path.join(out,'sidepanel.js');
  let panel=fs.readFileSync(panelPath,'utf8');
  // Always assign once at the top. Never string-replace the identifier — source may read the global.
  if(!/globalThis\.__WEBQA_BUILD_REVISION__\s*=/.test(panel)){
    panel=`globalThis.__WEBQA_BUILD_REVISION__=${JSON.stringify(buildRevision)};\n${panel}`;
  }
  fs.writeFileSync(panelPath,panel);
}
console.log(`Built ${out} (buildRevision=${buildRevision})`);
