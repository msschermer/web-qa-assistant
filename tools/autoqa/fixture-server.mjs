/**
 * Local fixture HTTP server for AutoQA golden/adversarial corpus URLs.
 * Serves fixtures/ under the paths encoded in qa-sites/*.json (port 8787).
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { REPO_ROOT } from './lib/paths.mjs';

const PORT = Number(process.env.WEBQA_AUTOQA_FIXTURE_PORT || 8787);
const HOST = process.env.WEBQA_AUTOQA_FIXTURE_HOST || '127.0.0.1';

const MOUNTS = [
  { prefix: '/qa-matrix/', dir: path.join(REPO_ROOT, 'fixtures', 'qa-matrix') },
  { prefix: '/benchmark-corpus/', dir: path.join(REPO_ROOT, 'fixtures', 'benchmark-corpus') },
  { prefix: '/corpus/', dir: path.join(REPO_ROOT, 'fixtures', 'benchmark-corpus') },
  { prefix: '/interstitial/', dir: path.join(REPO_ROOT, 'fixtures', 'interstitial') },
  { prefix: '/known-answer/', dir: path.join(REPO_ROOT, 'fixtures', 'known-answer') }
];

function contentType(file) {
  const ext = path.extname(file).toLowerCase();
  if (ext === '.html' || ext === '.htm') return 'text/html; charset=utf-8';
  if (ext === '.css') return 'text/css; charset=utf-8';
  if (ext === '.js' || ext === '.mjs') return 'text/javascript; charset=utf-8';
  if (ext === '.json') return 'application/json; charset=utf-8';
  if (ext === '.png') return 'image/png';
  if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg';
  if (ext === '.svg') return 'image/svg+xml';
  if (ext === '.woff2') return 'font/woff2';
  return 'application/octet-stream';
}

function safeFile(dir, rel) {
  const resolved = path.resolve(dir, rel);
  if (!resolved.startsWith(path.resolve(dir))) return '';
  return resolved;
}

export function createFixtureServer() {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url || '/', `http://${HOST}`);
    if (url.pathname === '/' || url.pathname === '/health') {
      res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ ok: true, service: 'autoqa-fixture', mounts: MOUNTS.map(m => m.prefix) }));
      return;
    }
    for (const mount of MOUNTS) {
      if (!url.pathname.startsWith(mount.prefix)) continue;
      const rel = decodeURIComponent(url.pathname.slice(mount.prefix.length));
      const file = safeFile(mount.dir, rel);
      if (!file || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
        res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
        res.end('not found');
        return;
      }
      res.writeHead(200, { 'content-type': contentType(file), 'cache-control': 'no-store' });
      fs.createReadStream(file).pipe(res);
      return;
    }
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('not found');
  });
  return server;
}

export function startFixtureServer({ port = PORT, host = HOST } = {}) {
  return new Promise((resolve, reject) => {
    const server = createFixtureServer();
    server.once('error', reject);
    server.listen(port, host, () => {
      resolve({
        server,
        origin: `http://${host}:${port}`,
        port,
        host
      });
    });
  });
}

async function main() {
  const started = await startFixtureServer();
  console.log(JSON.stringify({
    ok: true,
    origin: started.origin,
    health: `${started.origin}/health`,
    sample: `${started.origin}/qa-matrix/clean.html`
  }, null, 2));
}

if (import.meta.url === pathToFileURL(path.resolve(process.argv[1] || '')).href) {
  main().catch((err) => {
    console.error(JSON.stringify({ ok: false, error: String(err?.stack || err) }));
    process.exit(1);
  });
}
