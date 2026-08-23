import fs from 'node:fs';
import path from 'node:path';
const pkg=JSON.parse(fs.readFileSync('package.json','utf8'));
const manifest=JSON.parse(fs.readFileSync('apps/extension/manifest.json','utf8'));
const tag=String(process.env.RELEASE_TAG||'').replace(/^v/,'');
const errors=[];
if(pkg.version!==manifest.version)errors.push(`package ${pkg.version} != manifest ${manifest.version}`);
if(tag&&tag!==pkg.version)errors.push(`tag ${tag} != package ${pkg.version}`);
const read=p=>fs.existsSync(p)?fs.readFileSync(p,'utf8'):'';
const readme=read('README.md'),provenance=read('RELEASE_PROVENANCE.txt'),buildStatus=read('BUILD_STATUS.md');
if(!readme.includes(`Current delivery candidate: **${pkg.version}**`))errors.push('README current delivery candidate is stale');
if(!provenance.startsWith(`Web QA Assistant ${pkg.version}\n`))errors.push('RELEASE_PROVENANCE.txt version is stale');
if(!buildStatus.includes(`Web QA Assistant ${pkg.version}`))errors.push('BUILD_STATUS.md version is stale');
const distManifest='dist/extension/manifest.json';if(fs.existsSync(distManifest)){const d=JSON.parse(fs.readFileSync(distManifest,'utf8'));if(d.version!==pkg.version)errors.push(`dist manifest ${d.version} != package ${pkg.version}`);}
if(errors.length){console.error(errors.join('\n'));process.exit(1)}
console.log(`Release version validated: ${pkg.version}`);
