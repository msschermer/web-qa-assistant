import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = path.resolve(__dirname, '../../..');
export const AUTOQA_DIR = path.join(REPO_ROOT, '.autoqa');
export const STATE_PATH = path.join(AUTOQA_DIR, 'state.json');
export const RUNS_DIR = path.join(AUTOQA_DIR, 'runs');
export const ACCEPTED_DIR = path.join(AUTOQA_DIR, 'accepted');
export const KNOWLEDGE_DIR = path.join(AUTOQA_DIR, 'knowledge');
export const BASELINE_DIR = path.join(AUTOQA_DIR, 'baseline');
export const REPORTS_DIR = path.join(AUTOQA_DIR, 'reports');
export const QA_SITES_DIR = path.join(REPO_ROOT, 'qa-sites');
export const STATUS_MD = path.join(REPO_ROOT, 'AUTOQA_STATUS.md');
export const LOG_MD = path.join(REPO_ROOT, 'AUTOQA_LOG.md');
export const EXTENSION_DIR = path.join(REPO_ROOT, 'dist', 'extension');

export const EXPECTED_REMOTE = 'msschermer/web-qa-assistant';
export const EXPECTED_BRANCH = 'main';
export const BASELINE_TAG = 'v1.7.5';

export function ensureAutoqaDirs() {
  for (const dir of [AUTOQA_DIR, RUNS_DIR, ACCEPTED_DIR, KNOWLEDGE_DIR, BASELINE_DIR, REPORTS_DIR, QA_SITES_DIR]) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

/** Sanitize a site/host label for filesystem paths (no traversal). */
export function safeSiteName(urlOrHost = '') {
  let host = String(urlOrHost || 'unknown');
  try {
    if (/^https?:/i.test(host)) host = new URL(host).hostname;
  } catch { /* keep raw */ }
  return host
    .toLowerCase()
    .replace(/\.\./g, '.')
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^\.+|\.+$/g, '')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || 'unknown';
}

export function cycleDirName(cycle) {
  return `cycle-${String(Number(cycle) || 0).padStart(4, '0')}`;
}
