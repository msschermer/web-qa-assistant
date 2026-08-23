import fs from 'node:fs';
import { spawn } from 'node:child_process';
import { chromium } from 'playwright';

const root = process.cwd();
const port = String(process.env.PORT || 3000);
const rendererPort = String(process.env.RENDERER_PORT || 8790);
const proxyPort = String(process.env.PROXY_PORT || 8899);
const token = process.env.RENDERER_TOKEN || 'dev-token';

const browserCandidates = [
  process.env.CHROMIUM_EXECUTABLE_PATH,
  (() => { try { return chromium.executablePath(); } catch { return ''; } })(),
  process.platform === 'linux' ? '/usr/bin/chromium' : '',
  process.platform === 'linux' ? '/usr/bin/google-chrome' : '',
  process.platform === 'darwin' ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' : '',
  process.platform === 'win32' && process.env.LOCALAPPDATA ? `${process.env.LOCALAPPDATA}\\Google\\Chrome\\Application\\chrome.exe` : '',
  process.platform === 'win32' && process.env.PROGRAMFILES ? `${process.env.PROGRAMFILES}\\Google\\Chrome\\Application\\chrome.exe` : ''
].filter(Boolean);
if (!browserCandidates.some(p => fs.existsSync(p))) {
  console.warn('\nChromium was not found for the standalone renderer.');
  console.warn('Run: npx playwright install chromium');
  console.warn('Or set CHROMIUM_EXECUTABLE_PATH to an installed Chrome/Chromium executable.\n');
}

const children = [];

function start(name, script, extraEnv = {}) {
  const child = spawn(process.execPath, [script], {
    cwd: root,
    env: { ...process.env, ...extraEnv },
    stdio: ['inherit', 'pipe', 'pipe']
  });
  child.stdout.on('data', chunk => process.stdout.write(`[${name}] ${chunk}`));
  child.stderr.on('data', chunk => process.stderr.write(`[${name}] ${chunk}`));
  child.on('exit', code => {
    if (code && code !== 0) console.error(`[${name}] exited with code ${code}`);
  });
  children.push(child);
}

start('proxy', 'services/egress-proxy/server.js', {
  PROXY_PORT: proxyPort
});

start('renderer', 'services/renderer/server.js', {
  RENDERER_PORT: rendererPort,
  RENDERER_TOKEN: token,
  EGRESS_PROXY_URL: `http://localhost:${proxyPort}`
});

start('api', 'services/api/server.js', {
  PORT: port,
  RENDERER_URL: `http://localhost:${rendererPort}`,
  RENDERER_TOKEN: token
});

console.log('');
console.log(`Web QA Assistant: http://localhost:${port}/`);
console.log(`API health:       http://localhost:${port}/api/health`);
console.log(`Renderer health:  http://localhost:${rendererPort}/health`);
console.log(`Egress proxy:     http://localhost:${proxyPort}`);
console.log('');
console.log('Press Ctrl+C to stop all local services.');

let shuttingDown = false;
function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const child of children) {
    if (!child.killed) child.kill();
  }
  setTimeout(() => process.exit(0), 250);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
