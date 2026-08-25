import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  buildReviewBundle,
  frankPlanFromReview,
  getReviewFinding,
  hardenStoredReview,
  reviewBundleIndex,
  REVIEW_BUNDLE_CONTRACT_VERSION,
  summarizeFromReview
} from '../../packages/ai/review-bundle.js';

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

/** @deprecated Prefer summarizeFromReview after buildReviewBundle; kept for tests/compat. */
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

/** @deprecated Prefer summarizeFromReview; composes attention when missing. */
export function summarizeReport(report = {}, { maxFindings = 12 } = {}) {
  const review = buildReviewBundle(report, { maxGroups: maxFindings });
  return summarizeFromReview(review, { maxFindings });
}

export async function apiScan(url, { maxFindings = 12 } = {}) {
  const target = scanTargetUrl(url);
  const data = await fetchJson(`${gatewayUrl()}/api/scan`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ url: target })
  }, 60000);
  const report = data.report || {};
  const review = buildReviewBundle(report, {
    requestId: data.requestId || '',
    gateway: gatewayUrl(),
    requestedUrl: safeUrl(url),
    maxGroups: maxFindings
  });
  const summary = summarizeFromReview(review, { maxFindings });
  return {
    requestId: data.requestId || '',
    gateway: gatewayUrl(),
    summary,
    review
  };
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
  if (data?.kind === 'api-scan') {
    throw new Error('api-scan artifacts must be read with webqa_review_run / webqa_review_finding / webqa_frank_plan, not webqa_read_report_bug.');
  }
  return { file: resolved.repoRelative, report: data };
}

export async function readQaRunsJson(file, { root = projectRoot } = {}) {
  const resolved = await resolveReportBugPath(file, { root });
  const data = JSON.parse(await fs.readFile(resolved.absolute, 'utf8'));
  return { file: resolved.repoRelative, report: data };
}

export async function readApiScanArtifact(file, { root = projectRoot } = {}) {
  const { file: repoRelative, report: data } = await readQaRunsJson(file, { root });
  if (data?.kind !== 'api-scan') {
    throw new Error('Expected an api-scan QA artifact (kind=api-scan).');
  }
  if (!data.review || data.review.contractVersion !== REVIEW_BUNDLE_CONTRACT_VERSION) {
    throw new Error(`Expected api-scan artifact with review contractVersion ${REVIEW_BUNDLE_CONTRACT_VERSION}.`);
  }
  return {
    file: repoRelative,
    data: {
      ...data,
      review: hardenStoredReview(data.review),
      summary: data.summary || null
    }
  };
}

export function selectReviewSection(review, section = 'index') {
  const key = String(section || 'index');
  if (key === 'index' || key === '' || key === 'default') return reviewBundleIndex(review);
  if (key === 'full') {
    return {
      ...review,
      responseShape: 'full_review_bundle',
      note: 'Explicit full-section drill-down. Prefer section=index or section=findings/attention/… for smaller payloads.',
      untrustedPageEvidence: true
    };
  }
  if (key === 'run') return review.run;
  if (key === 'page') return review.page;
  if (key === 'targetIntegrity') return review.targetIntegrity;
  if (key === 'coverage') return review.coverage;
  if (key === 'attention') return { provenance: review.attention?.provenance, ...review.attention };
  if (key === 'findings') {
    return {
      provenance: review.findings?.provenance,
      index: review.findings?.index,
      detail: review.findings?.detail,
      truncated: review.findings?.truncated,
      omittedMaterialCount: review.findings?.omittedMaterialCount,
      detailCount: review.findings?.detailCount,
      indexCount: review.findings?.indexCount,
      pageDerivedSuppressed: review.findings?.pageDerivedSuppressed,
      responseShape: 'findings_drilldown',
      note: 'Explicit findings drill-down (includes detail envelopes). Default index omits detail.'
    };
  }
  if (key === 'links') return review.links;
  if (key === 'performance') return review.performance;
  if (key === 'priority') return review.priority;
  if (key === 'frank') return review.frank;
  if (key === 'provenance') return review.provenance;
  throw new Error(`Unknown review section "${key}". Use index|full|run|page|targetIntegrity|coverage|attention|findings|links|performance|priority|frank|provenance.`);
}

export async function reviewRunFromArtifact(file, { section = 'index', root = projectRoot } = {}) {
  const { file: repoRelative, data } = await readApiScanArtifact(file, { root });
  return {
    file: repoRelative,
    untrustedPageEvidence: true,
    section,
    review: selectReviewSection(data.review, section)
  };
}

export async function reviewFindingFromArtifact(file, findingId, { root = projectRoot } = {}) {
  const { file: repoRelative, data } = await readApiScanArtifact(file, { root });
  const finding = getReviewFinding(data.review, findingId);
  if (!finding) throw new Error(`Finding "${findingId}" was not found in this review artifact.`);
  return {
    file: repoRelative,
    untrustedPageEvidence: true,
    rules: data.review.rules,
    finding
  };
}

export async function frankPlanFromArtifact(file, findingId, { root = projectRoot } = {}) {
  const { file: repoRelative, data } = await readApiScanArtifact(file, { root });
  const result = frankPlanFromReview(data.review, findingId);
  return { file: repoRelative, ...result };
}

export async function ensureRunsDir() { await fs.mkdir(qaRunsDir, { recursive: true }); return qaRunsDir; }

export async function writeRunArtifact(prefix, data) {
  await ensureRunsDir();
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const file = path.join(qaRunsDir, `${prefix}-${stamp}.json`);
  await fs.writeFile(file, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
  return file;
}

/** Thin pointer to newest artifact — never dumps embedded review bundles. */
export async function latestRun() {
  await ensureRunsDir();
  const files = (await fs.readdir(qaRunsDir)).filter(x => x.endsWith('.json')).sort().reverse();
  if (!files.length) return null;
  const file = path.join(qaRunsDir, files[0]);
  const data = JSON.parse(await fs.readFile(file, 'utf8'));
  return {
    file: repoRelativePath(file),
    kind: data.kind || 'unknown',
    createdAt: data.createdAt || null,
    requestedUrl: data.requestedUrl || null,
    hasReview: Boolean(data.review),
    reviewContractVersion: data.review?.contractVersion || null,
    summary: data.summary || null,
    ok: data.ok,
    message: data.review
      ? 'Use webqa_review_run / webqa_review_finding / webqa_frank_plan with this artifact path for rich evidence.'
      : undefined
  };
}

/** Resolve Windows shims without shell:true (avoids DEP0190 and argv concatenation). */
export function resolveExecutable(command) {
  const raw = String(command || '');
  if (process.platform !== 'win32') return raw;
  if (path.extname(raw)) return raw;
  if (raw === 'npm') return 'npm.cmd';
  if (raw === 'npx') return 'npx.cmd';
  if (raw === 'git') return 'git.exe';
  return `${raw}.cmd`;
}

export function runCommand(command, args, { cwd = projectRoot, env = process.env, timeoutMs = 180000 } = {}) {
  return new Promise(resolve => {
    const started = Date.now();
    const executable = resolveExecutable(command);
    const child = spawn(executable, args, { cwd, env, shell: false, windowsHide: true });
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
