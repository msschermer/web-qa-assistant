import fs from 'node:fs/promises';
import path from 'node:path';
import { gatewayHealth, projectRoot, runCommand } from './lib.mjs';

const rows = [];
function row(name, ok, detail, { required = true } = {}) { rows.push({ name, ok, detail, required }); }

const major = Number(process.versions.node.split('.')[0]);
row('Node.js', major >= 22, process.version);

try {
  const pkg = JSON.parse(await fs.readFile(path.join(projectRoot, 'package.json'), 'utf8'));
  row('WebQA repository', pkg.name === 'web-qa-assistant', `${pkg.name || 'unknown'} v${pkg.version || 'unknown'}`);
} catch (error) { row('WebQA repository', false, error.message); }

for (const [name, file] of [
  ['Cursor MCP config', '.cursor/mcp.json'],
  ['Cursor project contract', 'AGENTS.md'],
  ['Cursor rules', '.cursor/rules/00-project-guardrails.mdc']
]) {
  try { await fs.access(path.join(projectRoot, file)); row(name, true, file); }
  catch { row(name, false, `Missing ${file}`); }
}

try {
  await import('@modelcontextprotocol/server');
  row('WebQA MCP SDK', true, '@modelcontextprotocol/server available');
} catch {
  row('WebQA MCP SDK', false, 'Run: npm install --prefix tools/cursor-webqa');
}

try {
  const health = await gatewayHealth();
  row('Deployed WebQA gateway', health?.ok === true, `v${health?.version || 'unknown'} · ${health?.preferredFrankAi || 'unknown Frank mode'}`, { required: false });
} catch (error) {
  row('Deployed WebQA gateway', false, `Optional external check failed: ${error.message}`, { required: false });
}

try {
  const git = await runCommand('git', ['status', '--short'], { timeoutMs: 10000 });
  row('Git', git.ok, git.ok ? (git.stdout.trim() ? 'Working tree has changes' : 'Working tree clean') : git.stderr || 'git status failed');
} catch (error) { row('Git', false, error.message); }

let browserDetail = 'Optional Playwright existing-profile bridge not configured; Cursor native Browser and WebQA MCP remain available.';
try {
  const env = await fs.readFile(path.join(projectRoot, '.cursor', 'webqa.env'), 'utf8');
  const token = env.match(/^PLAYWRIGHT_MCP_EXTENSION_TOKEN=(.+)$/m)?.[1]?.trim();
  if (token) browserDetail = 'Optional Playwright existing-profile bridge token configured.';
} catch {}
row('Existing-Chrome bridge', true, browserDetail, { required: false });

for (const r of rows) {
  const label = r.required ? (r.ok ? 'PASS' : 'FAIL') : (r.ok ? 'INFO' : 'WARN');
  console.log(`${label}  ${r.name}: ${r.detail}`);
}
const failures = rows.filter(r => r.required && !r.ok);
if (failures.length) {
  console.error(`\n${failures.length} required setup check(s) need attention.`);
  process.exitCode = 1;
} else console.log('\nRequired Cursor/WebQA development setup is ready. External/browser checks above are advisory.');
