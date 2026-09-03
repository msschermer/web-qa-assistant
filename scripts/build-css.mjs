import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = process.cwd();
const input = path.join(root, 'packages/ui/lumen.css');
const cli = path.join(root, 'node_modules/@tailwindcss/cli/dist/index.mjs');

export function compileLumenCss(outFile) {
  if (!fs.existsSync(cli)) {
    throw new Error('Tailwind CLI is missing. Run npm ci before compiling Lumen CSS.');
  }
  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  const result = spawnSync(process.execPath, [cli, '-i', input, '-o', outFile], {
    cwd: root,
    encoding: 'utf8'
  });
  if (result.status !== 0) {
    const detail = String(result.stderr || result.stdout || '').trim();
    throw new Error(`Lumen CSS compile failed for ${path.relative(root, outFile)}${detail ? `:\n${detail}` : ''}`);
  }
  const css = fs.readFileSync(outFile, 'utf8').replace(/^\/\*![\s\S]*?\*\/\s*/, '');
  fs.writeFileSync(outFile, css);
  return outFile;
}

export function buildLumenCss({ extensionCss, webCss } = {}) {
  const written = [];
  if (extensionCss) written.push(compileLumenCss(extensionCss));
  if (webCss) written.push(compileLumenCss(webCss));
  return written;
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  const written = buildLumenCss({
    extensionCss: path.join(root, 'dist/extension/sidepanel.css'),
    webCss: path.join(root, 'apps/web/public/styles.css')
  });
  console.log(`Compiled Lumen CSS → ${written.map(file => path.relative(root, file)).join(', ')}`);
}
