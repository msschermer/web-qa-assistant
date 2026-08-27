/**
 * Dedicated persistent Chrome profile for AutoQA dogfood.
 * Local-only, gitignored, never the operator's personal profile.
 */
import fs from 'node:fs';
import path from 'node:path';
import { AUTOQA_DIR, ensureAutoqaDirs } from './paths.mjs';

export const AUTOQA_CHROME_PROFILE_DIR = path.join(AUTOQA_DIR, 'chrome-profile');
export const AUTOQA_PERMISSION_STATE_PATH = path.join(AUTOQA_DIR, 'chrome-permission-state.json');

/** Origins covered by required host_permissions in the production manifest. */
export const BUILTIN_HOST_PERMISSION_PATTERNS = Object.freeze([
  'https://assistant.msschermer.us/*',
  'http://localhost:3000/*',
  'http://localhost:8787/*',
  'http://127.0.0.1:3000/*',
  'http://127.0.0.1:8787/*'
]);

export function ensureAutoqaChromeProfile() {
  ensureAutoqaDirs();
  fs.mkdirSync(AUTOQA_CHROME_PROFILE_DIR, { recursive: true });
  // Discourage Chrome sign-in / sync for this throwaway automation profile.
  const firstRun = path.join(AUTOQA_CHROME_PROFILE_DIR, 'First Run');
  if (!fs.existsSync(firstRun)) fs.writeFileSync(firstRun, '');
  return AUTOQA_CHROME_PROFILE_DIR;
}

export function readPermissionState() {
  if (!fs.existsSync(AUTOQA_PERMISSION_STATE_PATH)) return null;
  try {
    return JSON.parse(fs.readFileSync(AUTOQA_PERMISSION_STATE_PATH, 'utf8'));
  } catch {
    return null;
  }
}

export function writePermissionState(partial = {}) {
  ensureAutoqaDirs();
  const next = {
    browser: 'chrome',
    optionalHttp: false,
    optionalHttps: false,
    bootstrappedAt: null,
    lastVerifiedAt: null,
    lastError: null,
    ...readPermissionState(),
    ...partial
  };
  fs.writeFileSync(AUTOQA_PERMISSION_STATE_PATH, `${JSON.stringify(next, null, 2)}\n`);
  return next;
}

export function urlNeedsOptionalHostPermission(url) {
  try {
    const u = new URL(String(url));
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return false;
    const originPattern = `${u.protocol}//${u.host}/*`;
    if (BUILTIN_HOST_PERMISSION_PATTERNS.includes(originPattern)) return false;
    // Local fixtures on the default AutoQA ports are covered by host_permissions.
    if (
      (u.hostname === '127.0.0.1' || u.hostname === 'localhost') &&
      (u.port === '8787' || u.port === '3000' || u.port === '')
    ) {
      return false;
    }
    return true;
  } catch {
    return true;
  }
}

export function bootstrapRequiredMessage() {
  return [
    'AutoQA Chrome profile is missing optional host access for public corpus dogfood.',
    'Run a one-time bootstrap (human Allow click once):',
    '  node tools/autoqa/chrome-profile-bootstrap.mjs',
    `Profile: ${AUTOQA_CHROME_PROFILE_DIR}`,
    'Do not re-run corpus dogfood until bootstrap reports optionalHttp/optionalHttps ready.'
  ].join('\n');
}
