/**
 * AutoQA browser resolution: installed Google Chrome only.
 * Playwright is the controller; bundled Chromium is not required or preferred.
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { AUTOQA_DIR, ensureAutoqaDirs } from './paths.mjs';

export const BROWSER_CAPABILITY_PATH = path.join(AUTOQA_DIR, 'browser-capability.json');

const WINDOWS_CANDIDATES = () => [
  process.env.CHROME_PATH,
  process.env.PROGRAMFILES ? path.join(process.env.PROGRAMFILES, 'Google', 'Chrome', 'Application', 'chrome.exe') : '',
  process.env['ProgramFiles(x86)']
    ? path.join(process.env['ProgramFiles(x86)'], 'Google', 'Chrome', 'Application', 'chrome.exe')
    : '',
  process.env.LOCALAPPDATA
    ? path.join(process.env.LOCALAPPDATA, 'Google', 'Chrome', 'Application', 'chrome.exe')
    : ''
].filter(Boolean);

const DARWIN_CANDIDATES = () => [
  process.env.CHROME_PATH,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
].filter(Boolean);

const LINUX_CANDIDATES = () => [
  process.env.CHROME_PATH,
  '/usr/bin/google-chrome-stable',
  '/usr/bin/google-chrome',
  '/usr/bin/chrome'
].filter(Boolean);

function candidateExecutables() {
  if (process.platform === 'win32') return WINDOWS_CANDIDATES();
  if (process.platform === 'darwin') return DARWIN_CANDIDATES();
  return LINUX_CANDIDATES();
}

function firstExisting(paths) {
  return (paths || []).find((p) => {
    try {
      return p && fs.existsSync(p);
    } catch {
      return false;
    }
  }) || null;
}

function readChromeVersion(executablePath) {
  if (!executablePath) return null;
  try {
    if (process.platform === 'win32') {
      const ps = spawnSync(
        'powershell.exe',
        [
          '-NoProfile',
          '-Command',
          `(Get-Item -LiteralPath '${String(executablePath).replace(/'/g, "''")}').VersionInfo.ProductVersion`
        ],
        { encoding: 'utf8', timeout: 8000, windowsHide: true }
      );
      const ver = String(ps.stdout || '').trim();
      if (/^\d+\.\d+/.test(ver)) return ver;
      const appDir = path.dirname(executablePath);
      const sibling = fs.readdirSync(appDir).find((name) => /^\d+\.\d+\.\d+\.\d+$/.test(name));
      if (sibling) return sibling;
    }
    const r = spawnSync(executablePath, ['--version'], {
      encoding: 'utf8',
      timeout: 8000,
      windowsHide: true
    });
    const text = `${r.stdout || ''} ${r.stderr || ''}`.trim();
    if (/opening in existing browser session/i.test(text)) return null;
    const m = text.match(/(\d+\.\d+\.\d+\.\d+|\d+\.\d+\.\d+)/);
    return m ? m[1] : null;
  } catch {
    return null;
  }
}

export function readBrowserCapability() {
  ensureAutoqaDirs();
  if (!fs.existsSync(BROWSER_CAPABILITY_PATH)) return null;
  try {
    return JSON.parse(fs.readFileSync(BROWSER_CAPABILITY_PATH, 'utf8'));
  } catch {
    return null;
  }
}

export function writeBrowserCapability(capability) {
  ensureAutoqaDirs();
  const payload = {
    browser: 'chrome',
    status: capability?.status || 'unknown',
    version: capability?.version || null,
    resolutionMethod: capability?.resolutionMethod || null,
    channel: capability?.channel || null,
    executablePath: capability?.executablePath || null,
    lastVerifiedAt: capability?.lastVerifiedAt || new Date().toISOString(),
    lastError: capability?.lastError || null
  };
  fs.writeFileSync(BROWSER_CAPABILITY_PATH, `${JSON.stringify(payload, null, 2)}\n`);
  return payload;
}

/**
 * Resolve installed Google Chrome for AutoQA.
 * Prefer Playwright channel "chrome"; fall back to a detected executable.
 * Never requires Playwright's bundled Chromium.
 */
export function resolveSystemChrome() {
  const envPath = process.env.CHROME_PATH && fs.existsSync(process.env.CHROME_PATH)
    ? process.env.CHROME_PATH
    : null;
  if (envPath) {
    return {
      ok: true,
      browser: 'chrome',
      resolutionMethod: 'env:CHROME_PATH',
      channel: null,
      executablePath: envPath,
      version: readChromeVersion(envPath)
    };
  }

  // Playwright channel resolution is the normal Windows/macOS path.
  const exe = firstExisting(candidateExecutables());
  if (exe) {
    return {
      ok: true,
      browser: 'chrome',
      resolutionMethod: 'channel:chrome+executable',
      channel: 'chrome',
      executablePath: exe,
      version: readChromeVersion(exe)
    };
  }

  // Channel-only: Playwright may still locate Chrome via OS registration.
  return {
    ok: true,
    browser: 'chrome',
    resolutionMethod: 'channel:chrome',
    channel: 'chrome',
    executablePath: null,
    version: null,
    note: 'No common Chrome path found; launch will use Playwright channel "chrome".'
  };
}

export function chromeLaunchOptions(resolved = resolveSystemChrome()) {
  if (!resolved?.ok) {
    throw new Error(resolved?.error || 'Google Chrome is not available for AutoQA');
  }
  const opts = {};
  // Prefer channel when available — Playwright resolves installed Chrome.
  if (resolved.channel) opts.channel = resolved.channel;
  // executablePath overrides channel when both set; use only for env override
  // or when channel is unavailable.
  if (resolved.resolutionMethod === 'env:CHROME_PATH' && resolved.executablePath) {
    delete opts.channel;
    opts.executablePath = resolved.executablePath;
  } else if (!resolved.channel && resolved.executablePath) {
    opts.executablePath = resolved.executablePath;
  }
  return opts;
}

/**
 * Return a cached ready capability when still valid; otherwise re-resolve.
 */
export function ensureChromeReady({ force = false, markFailed = null } = {}) {
  const cached = readBrowserCapability();
  if (!force && !markFailed && cached?.status === 'ready' && cached.browser === 'chrome') {
    const stillThere = !cached.executablePath || fs.existsSync(cached.executablePath);
    if (stillThere || cached.channel === 'chrome') {
      return {
        ok: true,
        fromCache: true,
        ...cached,
        launchOptions: chromeLaunchOptions({
          ok: true,
          channel: cached.channel,
          executablePath: cached.executablePath,
          resolutionMethod: cached.resolutionMethod
        })
      };
    }
  }

  if (markFailed) {
    const failed = writeBrowserCapability({
      status: 'failed',
      version: cached?.version || null,
      resolutionMethod: cached?.resolutionMethod || null,
      channel: cached?.channel || null,
      executablePath: cached?.executablePath || null,
      lastVerifiedAt: new Date().toISOString(),
      lastError: String(markFailed).slice(0, 500)
    });
    return { ok: false, ...failed };
  }

  const resolved = resolveSystemChrome();
  if (!resolved.ok) {
    const written = writeBrowserCapability({
      status: 'unavailable',
      lastError: resolved.error || 'Chrome not found',
      lastVerifiedAt: new Date().toISOString()
    });
    return { ok: false, ...written, error: resolved.error };
  }

  // If we have neither channel nor executable, treat as blocker.
  if (!resolved.channel && !resolved.executablePath) {
    const written = writeBrowserCapability({
      status: 'unavailable',
      lastError: 'Installed Google Chrome was not found',
      lastVerifiedAt: new Date().toISOString()
    });
    return { ok: false, ...written, error: written.lastError };
  }

  const written = writeBrowserCapability({
    status: 'ready',
    version: resolved.version,
    resolutionMethod: resolved.resolutionMethod,
    channel: resolved.channel,
    executablePath: resolved.executablePath,
    lastVerifiedAt: new Date().toISOString(),
    lastError: null
  });

  return {
    ok: true,
    fromCache: false,
    ...written,
    launchOptions: chromeLaunchOptions(resolved)
  };
}

export function markChromeLaunchFailed(error) {
  return ensureChromeReady({ markFailed: error });
}

export function markChromeLaunchSucceeded(extra = {}) {
  const current = readBrowserCapability() || resolveSystemChrome();
  return writeBrowserCapability({
    status: 'ready',
    version: extra.version || current.version || null,
    resolutionMethod: extra.resolutionMethod || current.resolutionMethod || 'cdp:Extensions.loadUnpacked',
    channel: extra.channel !== undefined ? extra.channel : (current.channel || null),
    executablePath: extra.executablePath || current.executablePath || null,
    lastVerifiedAt: new Date().toISOString(),
    lastError: null
  });
}
