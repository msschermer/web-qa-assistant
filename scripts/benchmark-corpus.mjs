#!/usr/bin/env node
/**
 * Lightweight internal-beta corpus runner.
 *
 * Scans the synthetic 12-page corpus (optional public controls with --live)
 * through the local renderer, then records completion, coverage accounting,
 * inventory, link/frame completion, timings, Frank ledger representation,
 * result readiness, and fatal errors.
 *
 * Does not crawl destination pages. Does not start a large product refactor.
 *
 * Usage:
 *   node scripts/benchmark-corpus.mjs
 *   node scripts/benchmark-corpus.mjs --live
 *   node scripts/benchmark-corpus.mjs --out qa-runs/benchmark/manual
 */
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  aggregateBenchmark,
  finalizeBenchmarkReport,
  resolveCorpusPages,
  summarizeBenchmarkPage
} from '../packages/findings/benchmark-eval.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = new Set(process.argv.slice(2));
const includeLive = args.has('--live') || process.env.BENCHMARK_LIVE === '1';
const outFlag = process.argv.indexOf('--out');
const rendererFlag = process.argv.indexOf('--renderer-url');
const saveReports = args.has('--save-reports');

function stamp() {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

function readBuildRevision() {
  try {
    const raw = JSON.parse(fs.readFileSync(path.join(root, 'dist/extension/build-revision.json'), 'utf8'));
    return String(raw.buildRevision || 'unknown');
  } catch {
    return 'unknown';
  }
}

function contentType(filePath) {
  if (filePath.endsWith('.html')) return 'text/html; charset=utf-8';
  if (filePath.endsWith('.js')) return 'text/javascript; charset=utf-8';
  if (filePath.endsWith('.css')) return 'text/css; charset=utf-8';
  if (filePath.endsWith('.json')) return 'application/json; charset=utf-8';
  if (filePath.endsWith('.png')) return 'image/png';
  return 'application/octet-stream';
}

function safeFile(dir, name) {
  const resolved = path.resolve(dir, path.basename(name));
  if (!resolved.startsWith(path.resolve(dir))) return '';
  return resolved;
}

function startFixtureServer() {
  const qaDir = path.join(root, 'fixtures', 'qa-matrix');
  const corpusDir = path.join(root, 'fixtures', 'benchmark-corpus');
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const url = new URL(req.url || '/', 'http://127.0.0.1');
      if (url.pathname.startsWith('/ok/')) {
        res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' });
        res.end('ok');
        return;
      }
      if (url.pathname.startsWith('/missing/')) {
        res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
        res.end('missing');
        return;
      }
      const statusMatch = url.pathname.match(/^\/status\/(\d{3})$/);
      if (statusMatch) {
        res.writeHead(Number(statusMatch[1]), { 'content-type': 'text/plain; charset=utf-8' });
        res.end('status');
        return;
      }
      let file = '';
      if (url.pathname.startsWith('/qa-matrix/')) {
        file = safeFile(qaDir, url.pathname.slice('/qa-matrix/'.length));
      } else if (url.pathname.startsWith('/corpus/')) {
        file = safeFile(corpusDir, url.pathname.slice('/corpus/'.length));
      }
      if (!file || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
        res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
        res.end('not found');
        return;
      }
      res.writeHead(200, { 'content-type': contentType(file) });
      fs.createReadStream(file).pipe(res);
    });
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      resolve({ server, origin: `http://127.0.0.1:${port}` });
    });
  });
}

async function rendererHealthy(base, token) {
  const response = await fetch(`${base}/health`, {
    headers: { 'x-renderer-token': token }
  });
  if (!response.ok) throw new Error(`renderer health HTTP ${response.status}`);
  const data = await response.json();
  if (!data?.ok) throw new Error('renderer health not ok');
  return data;
}

function spawnRenderer() {
  const port = 18790 + Math.floor(Math.random() * 200);
  const token = process.env.RENDERER_TOKEN || 'dev-token';
  const child = spawn(process.execPath, [path.join(root, 'services/renderer/server.js')], {
    cwd: root,
    env: {
      ...process.env,
      RENDERER_PORT: String(port),
      RENDERER_TOKEN: token
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  return { child, url: `http://127.0.0.1:${port}`, token };
}

async function waitForRenderer(base, token, child) {
  const deadline = Date.now() + 20000;
  let last = '';
  while (Date.now() < deadline) {
    try {
      return await rendererHealthy(base, token);
    } catch (error) {
      last = error.message;
      if (child && child.exitCode != null) throw new Error(`renderer exited (${child.exitCode}): ${last}`);
      await new Promise((r) => setTimeout(r, 250));
    }
  }
  throw new Error(`renderer did not become healthy: ${last}`);
}

async function ensureRenderer() {
  const token = process.env.RENDERER_TOKEN || 'dev-token';
  const configured = rendererFlag >= 0
    ? String(process.argv[rendererFlag + 1] || '').replace(/\/$/, '')
    : String(process.env.RENDERER_URL || 'http://127.0.0.1:8790').replace(/\/$/, '');
  try {
    await rendererHealthy(configured, token);
    return { url: configured, token, child: null };
  } catch {
    const spawned = spawnRenderer();
    await waitForRenderer(spawned.url, spawned.token, spawned.child);
    return spawned;
  }
}

async function scanUrl(rendererUrl, token, url, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${rendererUrl}/scan`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-renderer-token': token
      },
      body: JSON.stringify({ url }),
      signal: controller.signal
    });
    const text = await response.text();
    let data = {};
    try { data = text ? JSON.parse(text) : {}; }
    catch { throw new Error(`Invalid JSON from renderer (HTTP ${response.status})`); }
    if (!response.ok || data?.ok === false) {
      const error = new Error(data?.error || `HTTP ${response.status}`);
      error.code = 'scan_http_error';
      throw error;
    }
    return data.report;
  } catch (error) {
    if (error.name === 'AbortError') {
      const timeout = new Error(`Scan timed out after ${timeoutMs}ms`);
      timeout.code = 'timeout';
      throw timeout;
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

function printTable(rows) {
  const cols = ['id', 'ok', 'ready', 'acct', 'links', 'frames', 'groups', 'ms', 'fail'];
  const lines = [cols.join('\t')];
  for (const row of rows) {
    lines.push([
      row.id,
      row.scanComplete && !row.failures.length ? 'pass' : 'FAIL',
      row.resultReady ? 'yes' : 'no',
      row.accountingOk ? 'ok' : 'bad',
      `${row.links.attempted}/${row.links.eligible}`,
      `${row.frames.sameOriginChecked}/${row.frames.sameOriginEligible}`,
      `${row.frank.uiShown}/${row.frank.materialGroupCount} omit=${row.frank.groupsOmitted}`,
      String(row.scanTimings.elapsedMs),
      row.failures.map((f) => f.code).join(',') || '-'
    ].join('\t'));
  }
  console.log(lines.join('\n'));
}

async function main() {
  const buildRevision = readBuildRevision();
  const startedAt = new Date().toISOString();
  const corpus = JSON.parse(fs.readFileSync(path.join(root, 'fixtures/benchmark-corpus/corpus.json'), 'utf8'));
  const fixtures = await startFixtureServer();
  const renderer = await ensureRenderer();
  const pages = resolveCorpusPages(corpus, { origin: fixtures.origin, includeLive });
  const outDir = outFlag >= 0
    ? path.resolve(String(process.argv[outFlag + 1] || ''))
    : path.join(root, 'qa-runs', 'benchmark', stamp());
  fs.mkdirSync(path.join(outDir, 'pages'), { recursive: true });

  console.log(`benchmark corpus  pages=${pages.length}  live=${includeLive}  buildRevision=${buildRevision}`);
  console.log(`fixture origin    ${fixtures.origin}`);
  console.log(`renderer          ${renderer.url}`);
  console.log(`output            ${outDir}`);

  const rows = [];
  try {
    for (const page of pages) {
      const t0 = Date.now();
      let report = null;
      let fatal = null;
      try {
        const raw = await scanUrl(renderer.url, renderer.token, page.url, page.maxElapsedMs);
        report = finalizeBenchmarkReport(raw);
      } catch (error) {
        fatal = { message: error.message, code: error.code || 'fatal_error' };
      }
      const elapsedMs = Date.now() - t0;
      const row = summarizeBenchmarkPage(report, {
        ...page,
        elapsedMs,
        maxElapsedMs: page.maxElapsedMs,
        fatal
      });
      rows.push(row);
      fs.writeFileSync(path.join(outDir, 'pages', `${page.id}.json`), `${JSON.stringify(row, null, 2)}\n`);
      if (saveReports && report) {
        const stripped = { ...report, page: { ...(report.page || {}) } };
        delete stripped.page.documentHtmlSample;
        fs.writeFileSync(path.join(outDir, 'pages', `${page.id}.report.json`), `${JSON.stringify(stripped, null, 2)}\n`);
      }
      const mark = row.failures.length ? 'FAIL' : 'pass';
      console.log(`  ${mark}  ${page.id}  ${elapsedMs}ms  failures=${row.failures.map((f) => f.code).join(',') || 'none'}`);
    }
  } finally {
    fixtures.server.close();
    if (renderer.child) renderer.child.kill();
  }

  const finishedAt = new Date().toISOString();
  const summary = aggregateBenchmark(rows, { buildRevision, startedAt, finishedAt });
  fs.writeFileSync(path.join(outDir, 'summary.json'), `${JSON.stringify(summary, null, 2)}\n`);
  console.log('');
  printTable(rows);
  console.log('');
  console.log(`passed ${summary.passedPageCount}/${summary.pageCount}`);
  for (const [cause, items] of Object.entries(summary.failuresByRootCause)) {
    if (!items.length) continue;
    console.log(`\n${cause} (${items.length})`);
    for (const item of items) console.log(`  - ${item.id}: ${item.code} — ${item.detail}`);
  }
  if (summary.failedPageCount) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
