#!/usr/bin/env node
/**
 * One-time AutoQA Chrome profile permission bootstrap.
 * Human clicks Grant/Allow once in Chrome. No terminal Enter handshake.
 * Success requires persistence across a second Chrome session.
 *
 * Chrome 151+ deletes CDP loadUnpacked installs on the next startup
 * (INSTALLED_VIA_CDP). After Session 1 we clear that flag and Session 2
 * converts the install via developerPrivate.reload so grants survive.
 */
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { EXTENSION_DIR } from './lib/paths.mjs';
import {
  ensureAutoqaChromeProfile,
  writePermissionState,
  chromePermissionsWin,
  AUTOQA_CHROME_PROFILE_DIR
} from './lib/chrome-profile.mjs';
import {
  clearInstalledViaCdpFlag,
  persistUnpackedExtensionViaReload,
  reattachExtensionSidePanel,
  readProfileExtensionState,
  profileHasDurableExtension,
  readExpectedExtensionId
} from './lib/chrome-extension-persist.mjs';
import { openDogfoodSession, closeDogfoodSession } from './dogfood.mjs';

const EXPECTED_PROFILE = path.resolve(AUTOQA_CHROME_PROFILE_DIR);
const GRANT_TIMEOUT_MS = Number(process.env.WEBQA_AUTOQA_BOOTSTRAP_TIMEOUT_MS || 10 * 60 * 1000);

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function fail(payload, code = 1) {
  const err = new Error(payload?.error || 'bootstrap failed');
  err.bootstrapPayload = payload;
  err.exitCode = code;
  throw err;
}

async function readPermissionSnapshot(panel) {
  return panel.evaluate(async () => {
    try {
      const all = await chrome.permissions.getAll();
      const http = await chrome.permissions.contains({ origins: ['http://*/*'] });
      const https = await chrome.permissions.contains({ origins: ['https://*/*'] });
      return {
        ok: Boolean(http && https),
        http,
        https,
        origins: all?.origins || []
      };
    } catch (error) {
      return { ok: false, http: false, https: false, error: String(error?.message || error) };
    }
  });
}

async function verifyPermissionsStable(panel, { rounds = 3, gapMs = 400 } = {}) {
  const samples = [];
  for (let i = 0; i < rounds; i++) {
    const snap = await readPermissionSnapshot(panel);
    samples.push(snap);
    if (!snap.ok) {
      return { ok: false, samples, http: snap.http, https: snap.https, error: snap.error || 'permission check failed' };
    }
    if (i < rounds - 1) await sleep(gapMs);
  }
  return {
    ok: samples.every((s) => s.ok),
    http: true,
    https: true,
    samples
  };
}

async function installGrantButton(panel) {
  await panel.evaluate(() => {
    let root = document.getElementById('autoqa-bootstrap-root');
    if (!root) {
      root = document.createElement('div');
      root.id = 'autoqa-bootstrap-root';
      root.style.cssText = 'position:fixed;inset:12px;z-index:999999;background:#111;color:#fff;padding:16px;font:14px/1.4 system-ui;border-radius:8px;';
      document.body.appendChild(root);
    }
    root.innerHTML = `
      <strong>AutoQA one-time permission bootstrap</strong>
      <p style="margin:8px 0;">Click the button below. If Chrome shows a permission dialog, click <b>Allow</b> once.</p>
      <p style="margin:8px 0;opacity:.85;">No need to return to the terminal — this page will continue automatically.</p>
      <button id="autoqa-bootstrap-grant" style="padding:10px 14px;font-weight:600;cursor:pointer;">
        Grant http://*/* and https://*/* for AutoQA
      </button>
      <p id="autoqa-bootstrap-status" style="margin-top:10px;opacity:.85;">Waiting for grant…</p>
    `;
    const btn = document.getElementById('autoqa-bootstrap-grant');
    const status = document.getElementById('autoqa-bootstrap-status');
    btn.onclick = async () => {
      status.textContent = 'Permission dialog should appear — click Allow if prompted…';
      try {
        const ok = await chrome.permissions.request({
          origins: ['http://*/*', 'https://*/*']
        });
        const http = await chrome.permissions.contains({ origins: ['http://*/*'] });
        const https = await chrome.permissions.contains({ origins: ['https://*/*'] });
        window.__autoqaBootstrapResult = { ok: Boolean(ok) || (http && https), http, https };
        status.textContent = window.__autoqaBootstrapResult.ok
          ? 'Permission granted. Verifying persistence…'
          : 'Not granted. Click again or Allow in the Chrome dialog.';
      } catch (error) {
        window.__autoqaBootstrapResult = { ok: false, error: String(error?.message || error) };
        status.textContent = `Error: ${window.__autoqaBootstrapResult.error}`;
      }
    };
  });
}

async function waitForGrant(panel, timeoutMs = GRANT_TIMEOUT_MS) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const snap = await readPermissionSnapshot(panel);
    if (snap.ok) return snap;
    const ui = await panel.evaluate(() => window.__autoqaBootstrapResult || null).catch(() => null);
    if (ui?.ok) {
      const again = await readPermissionSnapshot(panel);
      if (again.ok) return again;
    }
    await sleep(500);
  }
  return { ok: false, error: `timed out after ${timeoutMs}ms waiting for grant` };
}

function assertSameProfile(session) {
  const actual = path.resolve(session.profileDir || '');
  if (actual.toLowerCase() !== EXPECTED_PROFILE.toLowerCase()) {
    throw new Error(`AutoQA profile mismatch: ${actual} !== ${EXPECTED_PROFILE}`);
  }
  return actual;
}

async function main() {
  if (!fs.existsSync(path.join(EXTENSION_DIR, 'manifest.json'))) {
    throw new Error('Missing dist/extension; run npm run build:extension first');
  }
  ensureAutoqaChromeProfile();
  const expectedExtensionId = readExpectedExtensionId(EXTENSION_DIR);

  console.log(JSON.stringify({
    message: 'Opening dedicated AutoQA Chrome profile for permission bootstrap',
    profile: EXPECTED_PROFILE,
    expectedExtensionId
  }, null, 2));

  let session1 = null;
  let session2 = null;
  let shutdown1 = null;
  let shutdown2 = null;
  let session1Stable = null;
  let session2Snap = null;
  let session1ExtensionId = null;
  let alreadyPresent = false;
  let cdpCleared = null;
  let persistReload = null;

  try {
    // ---------- Session 1 ----------
    // Prefer durable profile install; only force CDP load when nothing durable exists.
    const durableAlready = profileHasDurableExtension(EXPECTED_PROFILE, expectedExtensionId, EXTENSION_DIR);
    session1 = await openDogfoodSession({ forceCdpLoad: !durableAlready });
    assertSameProfile(session1);
    session1ExtensionId = session1.extensionId;
    const initial = await readPermissionSnapshot(session1.panel);
    chromePermissionsWin(initial);

    if (initial.ok) {
      alreadyPresent = true;
      session1Stable = await verifyPermissionsStable(session1.panel);
      if (!session1Stable.ok) {
        writePermissionState({
          optionalHttp: false,
          optionalHttps: false,
          persistenceVerified: false,
          lastVerifiedAt: new Date().toISOString(),
          lastError: 'initial permissions unstable'
        });
        fail({ ok: false, error: 'Permissions unstable at startup', session1Stable });
      }
      console.log(JSON.stringify({
        phase: 'session1',
        alreadyPresent: true,
        extensionId: session1.extensionId,
        profileDir: session1.profileDir,
        loadedViaCdp: session1.loadedViaCdp,
        permissions: { http: true, https: true }
      }, null, 2));
    } else {
      await installGrantButton(session1.panel);
      console.log(JSON.stringify({
        actionRequired: true,
        steps: [
          'In the AutoQA Chrome side panel, click Grant http://*/* and https://*/* for AutoQA',
          'If Chrome shows “Read and change all your data on all websites”, click Allow',
          'Do not return to the terminal — bootstrap continues automatically'
        ]
      }, null, 2));

      const granted = await waitForGrant(session1.panel);
      if (!granted.ok) {
        writePermissionState({
          optionalHttp: Boolean(granted.http),
          optionalHttps: Boolean(granted.https),
          persistenceVerified: false,
          lastVerifiedAt: new Date().toISOString(),
          lastError: granted.error || 'grant timed out'
        });
        fail({ ok: false, error: 'Permissions not granted', granted });
      }

      await session1.panel.evaluate(() => {
        const status = document.getElementById('autoqa-bootstrap-status');
        if (status) status.textContent = 'Permission granted. Verifying persistence…';
      }).catch(() => {});

      session1Stable = await verifyPermissionsStable(session1.panel);
      if (!session1Stable.ok) {
        writePermissionState({
          optionalHttp: Boolean(session1Stable.http),
          optionalHttps: Boolean(session1Stable.https),
          persistenceVerified: false,
          lastVerifiedAt: new Date().toISOString(),
          lastError: 'post-grant verification failed'
        });
        fail({ ok: false, error: 'Post-grant verification failed', session1Stable });
      }
    }

    await sleep(750);
    const session1WasCdp = Boolean(session1.loadedViaCdp);
    shutdown1 = await closeDogfoodSession(session1);
    session1 = null;

    if (shutdown1?.forcedKill) {
      writePermissionState({
        optionalHttp: true,
        optionalHttps: true,
        persistenceVerified: false,
        extensionId: session1ExtensionId,
        profileDir: EXPECTED_PROFILE,
        lastShutdown: shutdown1,
        lastVerifiedAt: new Date().toISOString(),
        lastError: 'session1 forced kill — permission persistence not trustworthy yet'
      });
      fail({
        ok: false,
        error: 'Session 1 Chrome did not exit naturally; refusing to claim persistence',
        shutdown1
      });
    }

    // Convert CDP session install into a durable unpacked install.
    if (session1WasCdp || readProfileExtensionState(EXPECTED_PROFILE, session1ExtensionId).viaCdp) {
      cdpCleared = clearInstalledViaCdpFlag(EXPECTED_PROFILE, session1ExtensionId);
      if (!cdpCleared.ok) {
        fail({
          ok: false,
          error: 'Failed to clear INSTALLED_VIA_CDP after Session 1',
          cdpCleared,
          hint: 'Chrome 151+ deletes CDP-loaded extensions on restart; clearing this flag is required for permission persistence'
        });
      }
      console.log(JSON.stringify({
        phase: 'convert-cdp-install',
        cdpCleared,
        profileState: readProfileExtensionState(EXPECTED_PROFILE, session1ExtensionId)
      }, null, 2));
    }

    // ---------- Session 2 (persistence proof + durable rewrite) ----------
    await sleep(500);
    session2 = await openDogfoodSession({ forceCdpLoad: false });
    assertSameProfile(session2);

    if (session2.extensionId !== session1ExtensionId) {
      writePermissionState({
        persistenceVerified: false,
        lastVerifiedAt: new Date().toISOString(),
        lastError: 'extension ID changed across sessions',
        extensionId: session2.extensionId
      });
      fail({
        ok: false,
        error: 'Extension ID changed across Chrome restart — bootstrap incomplete',
        session1: { extensionId: session1ExtensionId, profileDir: EXPECTED_PROFILE },
        session2: { extensionId: session2.extensionId, profileDir: session2.profileDir },
        extensionPath: EXTENSION_DIR,
        manifestKeyPresent: Boolean(JSON.parse(fs.readFileSync(path.join(EXTENSION_DIR, 'manifest.json'), 'utf8')).key)
      });
    }

    if (session2.loadedViaCdp) {
      fail({
        ok: false,
        error: 'Session 2 unexpectedly used CDP loadUnpacked — durable profile install missing',
        session2Launch: session2.launch,
        profileState: readProfileExtensionState(EXPECTED_PROFILE, session1ExtensionId)
      });
    }

    session2Snap = await verifyPermissionsStable(session2.panel);
    chromePermissionsWin(session2Snap);

    if (!session2Snap.ok) {
      writePermissionState({
        optionalHttp: Boolean(session2Snap.http),
        optionalHttps: Boolean(session2Snap.https),
        persistenceVerified: false,
        extensionId: session2.extensionId,
        profileDir: EXPECTED_PROFILE,
        lastShutdown: shutdown1,
        lastVerifiedAt: new Date().toISOString(),
        lastError: 'AUTOQA permission was granted but did not survive Chrome restart'
      });
      fail({
        ok: false,
        error: 'AUTOQA permission was granted but did not survive Chrome restart.',
        rootCauseHint: 'Chrome deletes Extensions.loadUnpacked installs marked INSTALLED_VIA_CDP on the next startup',
        session1: {
          extensionId: session1ExtensionId,
          profileDir: EXPECTED_PROFILE,
          permissions: session1Stable,
          shutdown: shutdown1,
          cdpCleared
        },
        session2: {
          extensionId: session2.extensionId,
          profileDir: session2.profileDir,
          permissions: session2Snap
        }
      });
    }

    // Reload only when converting a CDP install. A durable profile install
    // already survived restart; developerPrivate.reload destroys the panel.
    if (cdpCleared?.cleared) {
      persistReload = await persistUnpackedExtensionViaReload(session2.browser, session2.extensionId);
      if (!persistReload.ok) {
        fail({
          ok: false,
          error: 'developerPrivate.reload failed — cannot finalize durable install',
          persistReload
        });
      }
      await reattachExtensionSidePanel(session2);
      session2Snap = await verifyPermissionsStable(session2.panel);
      if (!session2Snap.ok) {
        fail({
          ok: false,
          error: 'Permissions lost after developerPrivate.reload',
          session2Snap,
          persistReload
        });
      }
    } else {
      persistReload = { ok: true, skipped: true, reason: 'install already durable' };
    }

    await sleep(500);
    shutdown2 = await closeDogfoodSession(session2);
    const session2ExtensionId = session2.extensionId;
    session2 = null;

    const finalProfileState = readProfileExtensionState(EXPECTED_PROFILE, session2ExtensionId);
    if (!finalProfileState.durable) {
      fail({
        ok: false,
        error: 'Profile install is not durable after Session 2 close',
        finalProfileState,
        persistReload,
        cdpCleared
      });
    }

    const finalState = writePermissionState({
      optionalHttp: true,
      optionalHttps: true,
      persistenceVerified: true,
      extensionId: session2ExtensionId,
      profileDir: EXPECTED_PROFILE,
      bootstrappedAt: new Date().toISOString(),
      lastVerifiedAt: new Date().toISOString(),
      lastError: null,
      lastShutdown: { session1: shutdown1, session2: shutdown2 },
      cdpCleared,
      persistReload,
      profileInstall: finalProfileState
    });

    console.log('AUTOQA PUBLIC CORPUS PERMISSION: READY');
    console.log('Permission persisted across browser restart.');
    console.log('No further permission approval is required for this profile.');
    console.log(JSON.stringify({
      ok: true,
      alreadyGranted: alreadyPresent,
      persistenceVerified: true,
      extensionId: session2ExtensionId,
      profileDir: EXPECTED_PROFILE,
      session1: {
        extensionId: session1ExtensionId,
        permissions: { http: true, https: true },
        shutdown: shutdown1
      },
      session2: {
        extensionId: session2ExtensionId,
        permissions: { http: true, https: true },
        shutdown: shutdown2,
        persistReload
      },
      profileInstall: finalProfileState,
      state: finalState
    }, null, 2));
  } catch (error) {
    if (session1) {
      try { shutdown1 = await closeDogfoodSession(session1); } catch { /* ignore */ }
      session1 = null;
    }
    if (session2) {
      try { shutdown2 = await closeDogfoodSession(session2); } catch { /* ignore */ }
      session2 = null;
    }
    if (error?.bootstrapPayload) {
      console.error(JSON.stringify(error.bootstrapPayload, null, 2));
      process.exit(error.exitCode || 1);
    }
    throw error;
  }
}

if (import.meta.url === pathToFileURL(path.resolve(process.argv[1] || '')).href) {
  main().catch((err) => {
    console.error(JSON.stringify({ ok: false, error: String(err?.stack || err) }));
    process.exit(1);
  });
}
