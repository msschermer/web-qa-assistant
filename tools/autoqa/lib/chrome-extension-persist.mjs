/**
 * Persist AutoQA unpacked extension across Chrome restarts.
 *
 * Chrome 151+ marks Extensions.loadUnpacked installs with INSTALLED_VIA_CDP and
 * deletes those prefs on the next startup — wiping optional host grants.
 * After a CDP install + clean exit we clear that flag, relaunch without
 * loadUnpacked, then chrome.developerPrivate.reload so Chrome rewrites prefs
 * with a valid MAC and without INSTALLED_VIA_CDP.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

/** Chromium extensions::Extension::INSTALLED_VIA_CDP (1 << 15). */
export const INSTALLED_VIA_CDP = 1 << 15;

export function computeExtensionIdFromManifestKey(publicKeyBase64) {
  const der = Buffer.from(publicKeyBase64, 'base64');
  const hash = crypto.createHash('sha256').update(der).digest();
  let id = '';
  for (let i = 0; i < 16; i++) {
    id += String.fromCharCode(97 + (hash[i] >> 4));
    id += String.fromCharCode(97 + (hash[i] & 0xf));
  }
  return id;
}

export function readExpectedExtensionId(extensionDir) {
  const manifestPath = path.join(extensionDir, 'manifest.json');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  if (!manifest.key) {
    throw new Error(`Extension manifest missing stable key: ${manifestPath}`);
  }
  return computeExtensionIdFromManifestKey(manifest.key);
}

function securePreferencesPath(profileDir) {
  return path.join(profileDir, 'Default', 'Secure Preferences');
}

function preferencesPath(profileDir) {
  return path.join(profileDir, 'Default', 'Preferences');
}

export function readProfileExtensionState(profileDir, extensionId) {
  const securePath = securePreferencesPath(profileDir);
  if (!fs.existsSync(securePath)) {
    return { present: false, durable: false, viaCdp: false, path: null, hosts: [] };
  }
  try {
    const secure = JSON.parse(fs.readFileSync(securePath, 'utf8'));
    const entry = secure.extensions?.settings?.[extensionId];
    if (!entry) {
      return { present: false, durable: false, viaCdp: false, path: null, hosts: [] };
    }
    const flags = Number(entry.creation_flags || 0);
    const viaCdp = Boolean(flags & INSTALLED_VIA_CDP);
    const extPath = entry.path ? path.resolve(String(entry.path)) : null;
    const hosts = entry.granted_permissions?.explicit_host || [];
    return {
      present: true,
      durable: Boolean(extPath) && !viaCdp,
      viaCdp,
      path: extPath,
      hosts,
      creation_flags: flags,
      keyCount: Object.keys(entry).length
    };
  } catch {
    return { present: false, durable: false, viaCdp: false, path: null, hosts: [] };
  }
}

export function profileHasDurableExtension(profileDir, extensionId, extensionDir) {
  const state = readProfileExtensionState(profileDir, extensionId);
  if (!state.durable || !state.path) return false;
  return state.path.toLowerCase() === path.resolve(extensionDir).toLowerCase();
}

/**
 * Clear INSTALLED_VIA_CDP so the next Chrome startup will not DeleteExtensionPrefs.
 * Must run while Chrome is not using this profile. Follow with a live
 * developerPrivate.reload so Chrome re-signs Secure Preferences.
 */
export function clearInstalledViaCdpFlag(profileDir, extensionId) {
  const securePath = securePreferencesPath(profileDir);
  if (!fs.existsSync(securePath)) {
    return { ok: false, error: 'Secure Preferences missing' };
  }
  const secure = JSON.parse(fs.readFileSync(securePath, 'utf8'));
  const entry = secure.extensions?.settings?.[extensionId];
  if (!entry?.path) {
    return { ok: false, error: 'extension install entry missing or incomplete' };
  }
  const before = Number(entry.creation_flags || 0);
  entry.creation_flags = before & ~INSTALLED_VIA_CDP;
  fs.writeFileSync(securePath, `${JSON.stringify(secure)}\n`);

  const prefsFile = preferencesPath(profileDir);
  if (fs.existsSync(prefsFile)) {
    const prefs = JSON.parse(fs.readFileSync(prefsFile, 'utf8'));
    prefs.extensions = prefs.extensions || {};
    prefs.extensions.ui = prefs.extensions.ui || {};
    prefs.extensions.ui.developer_mode = true;
    fs.writeFileSync(prefsFile, `${JSON.stringify(prefs)}\n`);
  }

  return {
    ok: true,
    before,
    after: entry.creation_flags,
    cleared: Boolean(before & INSTALLED_VIA_CDP)
  };
}

export async function ensureDeveloperMode(page) {
  await page.goto('chrome://extensions/', { waitUntil: 'domcontentloaded', timeout: 20000 });
  await page.waitForTimeout(400);
  return page.evaluate(() => {
    const mgr = document.querySelector('extensions-manager');
    const toolbar = mgr?.shadowRoot?.querySelector('extensions-toolbar');
    const toggle = toolbar?.shadowRoot?.querySelector('#devMode');
    if (!toggle) return { ok: false, error: 'developer mode toggle not found' };
    const before = Boolean(toggle.checked);
    if (!before) toggle.click();
    return { ok: true, before, after: true };
  });
}

/**
 * Ask Chrome to reload the unpacked extension via developerPrivate so prefs are
 * rewritten without INSTALLED_VIA_CDP and with a valid integrity MAC.
 */
export async function persistUnpackedExtensionViaReload(browser, extensionId) {
  const context = browser.contexts()[0];
  if (!context) throw new Error('No browser context for extension persist reload');
  const page = await context.newPage();
  try {
    await ensureDeveloperMode(page);
    const result = await page.evaluate(async (id) => {
      try {
        if (!chrome.developerPrivate?.reload) {
          return {
            ok: false,
            error: 'chrome.developerPrivate.reload unavailable'
          };
        }
        await chrome.developerPrivate.reload(id, { failQuietly: false });
        return { ok: true };
      } catch (error) {
        return { ok: false, error: String(error?.message || error) };
      }
    }, extensionId);
    await page.waitForTimeout(800);
    return result;
  } finally {
    await page.close().catch(() => {});
  }
}

/**
 * developerPrivate.reload destroys existing extension pages. Re-open the
 * side panel so later permissions.contains checks have a live target.
 */
export async function reattachExtensionSidePanel(session) {
  const context = session?.browser?.contexts?.()[0] || session?.context;
  if (!context || !session?.extensionId) {
    throw new Error('Cannot reattach side panel without browser context and extensionId');
  }
  if (session.panel && !session.panel.isClosed()) {
    await session.panel.close().catch(() => {});
  }
  const panel = await context.newPage();
  await panel.goto(`chrome-extension://${session.extensionId}/sidepanel.html`, {
    waitUntil: 'domcontentloaded',
    timeout: 20000
  });
  const started = Date.now();
  const want = `chrome-extension://${session.extensionId}/`;
  while (Date.now() - started < 20000) {
    if (context.serviceWorkers().some((w) => w.url().startsWith(want))) break;
    await panel.waitForTimeout(250);
  }
  session.panel = panel;
  return panel;
}
