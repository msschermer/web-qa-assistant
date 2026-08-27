/**
 * Non-interactive verification of persistent AutoQA Chrome profile behavior.
 * Local fixture uses required host_permissions (no optional grant needed).
 * Public corpus pages require prior bootstrap for optional http(s) access.
 */
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { startFixtureServer } from './fixture-server.mjs';
import { openDogfoodSession, closeDogfoodSession, dogfoodUrlInSession } from './dogfood.mjs';
import { REPO_ROOT } from './lib/paths.mjs';
import {
  AUTOQA_CHROME_PROFILE_DIR,
  urlNeedsOptionalHostPermission,
  readPermissionState
} from './lib/chrome-profile.mjs';

const OUT = path.join(REPO_ROOT, '.autoqa', 'runs', 'chrome-profile-verify');

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const fixtures = await startFixtureServer({ port: 8787 });
  const report = {
    profileDir: AUTOQA_CHROME_PROFILE_DIR,
    permissionStateBefore: readPermissionState(),
    session1: {},
    session2: {}
  };

  try {
    const localUrl = 'http://127.0.0.1:8787/qa-matrix/clean.html';
    const publicA = 'https://example.com/';
    const publicB = 'https://www.example.org/';

    report.localNeedsOptional = urlNeedsOptionalHostPermission(localUrl);
    report.publicNeedsOptional = urlNeedsOptionalHostPermission(publicA);

    const s1 = await openDogfoodSession();
    const t0 = Date.now();
    try {
      report.session1.permissionSnapshot = s1.permissionSnapshot;
      report.session1.launchTimings = s1.launchTimings;
      const local = await dogfoodUrlInSession(s1, {
        url: localUrl,
        outDir: path.join(OUT, 'session1-local'),
        sampleFrank: true,
        sampleHighlight: true
      });
      report.session1.local = {
        ok: local.ok,
        timings: local.timings,
        invariantsOk: local.invariants?.ok
      };

      if (s1.permissionSnapshot?.ok) {
        const a = await dogfoodUrlInSession(s1, {
          url: publicA,
          outDir: path.join(OUT, 'session1-example-com'),
          sampleFrank: true,
          sampleHighlight: false
        });
        const b = await dogfoodUrlInSession(s1, {
          url: publicB,
          outDir: path.join(OUT, 'session1-example-org'),
          sampleFrank: false,
          sampleHighlight: false
        });
        report.session1.public = {
          exampleCom: { ok: a.ok, timings: a.timings },
          exampleOrg: { ok: b.ok, timings: b.timings }
        };
      } else {
        report.session1.public = {
          skipped: true,
          reason: 'optional host permissions not bootstrapped yet'
        };
      }
      report.session1.wallMs = Date.now() - t0;
      report.session1.noPermissionPromptExpected = true;
    } finally {
      await closeDogfoodSession(s1);
    }

    // Second session: same profile must retain optional grants if previously bootstrapped.
    const s2 = await openDogfoodSession();
    try {
      report.session2.permissionSnapshot = s2.permissionSnapshot;
      report.session2.launchTimings = s2.launchTimings;
      const local2 = await dogfoodUrlInSession(s2, {
        url: localUrl,
        outDir: path.join(OUT, 'session2-local'),
        sampleFrank: false,
        sampleHighlight: false
      });
      report.session2.local = { ok: local2.ok, timings: local2.timings };
      report.session2.permissionsPersisted = Boolean(s2.permissionSnapshot?.ok) || !report.session1.permissionSnapshot?.ok;
    } finally {
      await closeDogfoodSession(s2);
    }

    report.permissionStateAfter = readPermissionState();
    report.ok = Boolean(report.session1.local?.ok && report.session2.local?.ok);
    fs.writeFileSync(path.join(OUT, 'verify-report.json'), `${JSON.stringify(report, null, 2)}\n`);
    console.log(JSON.stringify(report, null, 2));
    process.exit(report.ok ? 0 : 1);
  } finally {
    fixtures.server.close();
  }
}

if (import.meta.url === pathToFileURL(path.resolve(process.argv[1] || '')).href) {
  main().catch((err) => {
    console.error(JSON.stringify({ ok: false, error: String(err?.stack || err) }));
    process.exit(1);
  });
}
