import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
export const projectRoot = path.resolve(here, '..', '..');
export const qaRunsDir = path.join(projectRoot, 'qa-runs');

export function repoRelativePath(value) {
  return path.relative(projectRoot, path.resolve(value)).replace(/\\/g, '/');
}

export function gatewayUrl() {
  return String(process.env.WEBQA_GATEWAY_URL || 'https://assistant.msschermer.us').trim().replace(/\/$/, '');
}

export function safeUrl(value) {
  try {
    const u = new URL(String(value || ''));
    u.search = '';
    u.hash = '';
    return u.toString();
  } catch {
    return '[invalid-url]';
  }
}


export function scanTargetUrl(value) {
  const u = new URL(String(value || ''));
  if (!['http:', 'https:'].includes(u.protocol)) throw new Error('A public HTTP or HTTPS URL is required.');
  u.hash = '';
  return u.toString();
}

export function sanitizeText(value, max = 700) {
  return String(value || '')
    .replace(/https?:\/\/[^\s\"'<>]+/gi, match => safeUrl(match))
    .slice(0, max);
}

export async function fetchJson(url, options = {}, timeoutMs = 45000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { ...options, signal: controller.signal });
    const text = await response.text();
    let data = {};
    try { data = text ? JSON.parse(text) : {}; }
    catch { throw new Error(`Invalid JSON from ${url} (HTTP ${response.status})`); }
    if (!response.ok || data?.ok === false) throw new Error(data?.error || `HTTP ${response.status}`);
    return data;
  } finally { clearTimeout(timer); }
}

export async function gatewayHealth() {
  return fetchJson(`${gatewayUrl()}/api/health`, {}, 12000);
}

export function findingSummary(f = {}) {
  return {
    id: f.id || '',
    ruleId: f.ruleId || '',
    title: sanitizeText(f.title || '', 220),
    detail: sanitizeText(f.detail || '', 700),
    category: f.category || '',
    severity: f.severity || '',
    confidence: f.confidence || '',
    impactClass: f.impactClass || '',
    targetType: f.targetType || '',
    link: f.link?.url ? { url: safeUrl(f.link.url), status: f.link.status || f.status || null } : null,
    verification: f.verification ? {
      method: f.verification.method || '',
      attempts: Number(f.verification.attempts || 0),
      state: f.verification.state || f.verificationState || ''
    } : null,
    sources: Array.isArray(f.sources) ? f.sources.slice(0, 8) : []
  };
}

export function summarizeReport(report = {}, { maxFindings = 12 } = {}) {
  const groups = (report.attention?.groups || []).slice(0, maxFindings).map(g => ({
    area: report.attention?.classLabels?.[g.impactClass] || g.impactClass || '',
    impactClass: g.impactClass || '',
    title: g.title || g.lead?.title || '',
    instanceCount: Number(g.instanceCount || 1),
    score: Number(g.score || 0),
    lead: findingSummary(g.lead || {})
  }));
  return {
    page: {
      url: safeUrl(report.page?.url),
      hostname: report.page?.hostname || '',
      title: sanitizeText(report.page?.title || '', 220),
      environment: report.environment?.type || report.page?.environment?.type || report.page?.environment || 'unknown',
      targetIntegrity: report.page?.targetIntegrity?.state || 'reached'
    },
    assessment: report.priorityBrief || '',
    connectedMode: report.connectedMode || '',
    coverage: report.coverage || {},
    attention: {
      materialGroupCount: Number(report.attention?.materialGroupCount || 0),
      materialFindingCount: Number(report.attention?.materialFindingCount || 0),
      representedClasses: report.attention?.representedClasses || [],
      classCounts: report.attention?.classCounts || {},
      groups
    },
    linkAudit: report.linkAudit ? {
      checked: Number(report.linkAudit.checked || 0),
      confirmedIssues: Number(report.linkAudit.confirmedIssues || 0),
      inconclusive: Number(report.linkAudit.inconclusive || 0),
      reachedLimit: Boolean(report.linkAudit.reachedLimit)
    } : null,
    scannedAt: report.scannedAt || null
  };
}

export async function apiScan(url, { maxFindings = 12 } = {}) {
  const target = scanTargetUrl(url);
  const data = await fetchJson(`${gatewayUrl()}/api/scan`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ url: target })
  }, 60000);
  return { requestId: data.requestId || '', gateway: gatewayUrl(), summary: summarizeReport(data.report || {}, { maxFindings }) };
}

const REPORT_BUG_MAX_BYTES = 2_000_000;
const REPORT_BUG_BLOCKED_PREFIXES = ['.env', '.cursor/webqa.env', 'node_modules/', 'tools/cursor-webqa/node_modules/'];

function isPathInside(parent, child) {
  const rel = path.relative(parent, child);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

/**
 * Resolve a Report Bug JSON path that must be a real regular file inside qa-runs/.
 * Lexical checks reject traversal/secrets; realpath containment rejects symlink escape.
 */
export async function resolveReportBugPath(file, { root = projectRoot } = {}) {
  const absolute = path.resolve(root, String(file || ''));
  const rel = path.relative(root, absolute).replace(/\\/g, '/');
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    throw new Error('Report Bug files must be inside the current repository workspace.');
  }
  if (REPORT_BUG_BLOCKED_PREFIXES.some(prefix => rel === prefix.replace(/\/$/, '') || rel.startsWith(prefix))) {
    throw new Error('Report Bug reads cannot target secret or dependency paths.');
  }
  if (!rel.startsWith('qa-runs/') || !rel.endsWith('.json')) {
    throw new Error('Report Bug files must be JSON under qa-runs/ in the repository workspace.');
  }

  let realRoot;
  let realQaRuns;
  let realFile;
  try {
    realRoot = await fs.realpath(root);
    realQaRuns = await fs.realpath(path.join(root, 'qa-runs'));
    realFile = await fs.realpath(absolute);
  } catch {
    throw new Error('Report Bug file must be a JSON file smaller than 2 MB.');
  }

  if (!isPathInside(realQaRuns, realFile) || !isPathInside(realRoot, realFile)) {
    throw new Error('Report Bug reads cannot follow links outside qa-runs.');
  }

  const stat = await fs.stat(realFile);
  if (!stat.isFile() || stat.size > REPORT_BUG_MAX_BYTES) {
    throw new Error('Report Bug file must be a JSON file smaller than 2 MB.');
  }

  return {
    absolute: realFile,
    repoRelative: path.relative(realRoot, realFile).replace(/\\/g, '/')
  };
}

export async function readReportBugFile(file, { root = projectRoot } = {}) {
  const resolved = await resolveReportBugPath(file, { root });
  const data = JSON.parse(await fs.readFile(resolved.absolute, 'utf8'));
  return { file: resolved.repoRelative, report: data };
}

export async function ensureRunsDir() { await fs.mkdir(qaRunsDir, { recursive: true }); return qaRunsDir; }

export async function writeRunArtifact(prefix, data) {
  await ensureRunsDir();
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const file = path.join(qaRunsDir, `${prefix}-${stamp}.json`);
  await fs.writeFile(file, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
  return file;
}

export async function latestRun() {
  await ensureRunsDir();
  const files = (await fs.readdir(qaRunsDir)).filter(x => x.endsWith('.json')).sort().reverse();
  if (!files.length) return null;
  const file = path.join(qaRunsDir, files[0]);
  return { file: repoRelativePath(file), data: JSON.parse(await fs.readFile(file, 'utf8')) };
}

export function runCommand(command, args, { cwd = projectRoot, env = process.env, timeoutMs = 180000 } = {}) {
  return new Promise(resolve => {
    const started = Date.now();
    const child = spawn(command, args, { cwd, env, shell: process.platform === 'win32', windowsHide: true });
    let stdout = '', stderr = '', timedOut = false;
    const timer = setTimeout(() => { timedOut = true; child.kill(); }, timeoutMs);
    child.stdout?.on('data', d => { stdout += d.toString(); if (stdout.length > 500000) stdout = stdout.slice(-500000); });
    child.stderr?.on('data', d => { stderr += d.toString(); if (stderr.length > 500000) stderr = stderr.slice(-500000); });
    child.on('close', code => {
      clearTimeout(timer);
      resolve({ command: [command, ...args].join(' '), code: code ?? -1, ok: code === 0 && !timedOut, timedOut, durationMs: Date.now() - started, stdout: stdout.slice(-20000), stderr: stderr.slice(-20000) });
    });
    child.on('error', error => {
      clearTimeout(timer);
      resolve({ command: [command, ...args].join(' '), code: -1, ok: false, timedOut, durationMs: Date.now() - started, stdout: stdout.slice(-20000), stderr: `${stderr}\n${error.message}`.slice(-20000) });
    });
  });
}

export async function runRepoGates({ releaseTag = '', includeBuild = true } = {}) {
  const rows = [];
  rows.push(await runCommand('npm', ['test'], { timeoutMs: 180000 }));
  if (rows.at(-1).ok) rows.push(await runCommand('npm', ['run', 'check'], { timeoutMs: 120000 }));
  if (includeBuild && rows.at(-1).ok) rows.push(await runCommand('npm', ['run', 'build:extension'], { timeoutMs: 120000 }));
  if (releaseTag && rows.at(-1).ok) rows.push(await runCommand('npm', ['run', 'release:validate'], { env: { ...process.env, RELEASE_TAG: releaseTag }, timeoutMs: 120000 }));
  return { ok: rows.every(r => r.ok), releaseTag, results: rows };
}
