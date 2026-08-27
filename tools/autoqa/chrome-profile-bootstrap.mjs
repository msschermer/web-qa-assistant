#!/usr/bin/env node
/**
 * One-time AutoQA Chrome profile permission bootstrap.
 * Human clicks Grant/Allow once. Dogfood never auto-clicks the dialog.
 */
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { pathToFileURL } from 'node:url';
import { EXTENSION_DIR } from './lib/paths.mjs';
import {
  ensureAutoqaChromeProfile,
  writePermissionState,
  AUTOQA_CHROME_PROFILE_DIR
} from './lib/chrome-profile.mjs';
import { openDogfoodSession, closeDogfoodSession } from './dogfood.mjs';

function ask(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(String(answer || '').trim());
    });
  });
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
      return { ok: false, error: String(error?.message || error) };
    }
  });
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
          ? 'Granted. You can return to the terminal.'
          : 'Not granted. Click again or Allow in the Chrome dialog.';
      } catch (error) {
        window.__autoqaBootstrapResult = { ok: false, error: String(error?.message || error) };
        status.textContent = `Error: ${window.__autoqaBootstrapResult.error}`;
      }
    };
  });
}

async function main() {
  if (!fs.existsSync(path.join(EXTENSION_DIR, 'manifest.json'))) {
    throw new Error('Missing dist/extension; run npm run build:extension first');
  }
  ensureAutoqaChromeProfile();
  console.log(JSON.stringify({
    message: 'Opening dedicated AutoQA Chrome profile for one-time permission bootstrap',
    profile: AUTOQA_CHROME_PROFILE_DIR
  }, null, 2));

  const session = await openDogfoodSession({ allowBootstrapUi: true });
  try {
    await installGrantButton(session.panel);
    let snap = await readPermissionSnapshot(session.panel);
    if (snap.ok) {
      writePermissionState({
        optionalHttp: true,
        optionalHttps: true,
        bootstrappedAt: new Date().toISOString(),
        lastVerifiedAt: new Date().toISOString(),
        lastError: null
      });
      console.log(JSON.stringify({ ok: true, alreadyGranted: true, snapshot: snap, profile: AUTOQA_CHROME_PROFILE_DIR }, null, 2));
      return;
    }

    console.log('\nACTION REQUIRED (one time):');
    console.log('1. In the AutoQA Chrome window side panel, click "Grant http://*/* and https://*/* for AutoQA".');
    console.log('2. If Chrome shows "Read and change all your data on all websites", click Allow.');
    console.log('3. Return here and press Enter.\n');
    await ask('Press Enter after granting permissions… ');

    // Poll briefly in case the click just completed.
    for (let i = 0; i < 20; i++) {
      snap = await readPermissionSnapshot(session.panel);
      if (snap.ok) break;
      await new Promise((r) => setTimeout(r, 500));
    }

    if (!snap.ok) {
      writePermissionState({
        optionalHttp: Boolean(snap.http),
        optionalHttps: Boolean(snap.https),
        lastVerifiedAt: new Date().toISOString(),
        lastError: 'bootstrap incomplete — optional host permissions not granted'
      });
      console.error(JSON.stringify({ ok: false, error: 'Permissions not granted', snapshot: snap }, null, 2));
      process.exit(1);
    }

    writePermissionState({
      optionalHttp: true,
      optionalHttps: true,
      bootstrappedAt: new Date().toISOString(),
      lastVerifiedAt: new Date().toISOString(),
      lastError: null
    });
    console.log(JSON.stringify({
      ok: true,
      bootstrapped: true,
      snapshot: snap,
      profile: AUTOQA_CHROME_PROFILE_DIR,
      note: 'Normal AutoQA dogfood will reuse this profile and must not prompt again.'
    }, null, 2));
  } finally {
    await closeDogfoodSession(session);
  }
}

if (import.meta.url === pathToFileURL(path.resolve(process.argv[1] || '')).href) {
  main().catch((err) => {
    console.error(JSON.stringify({ ok: false, error: String(err?.stack || err) }));
    process.exit(1);
  });
}
