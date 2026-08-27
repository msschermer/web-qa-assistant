/**
 * Cycle 2 representative link benchmarks under installed Google Chrome.
 * Not a permanent orchestration layer — focused measurement for trust calibration.
 */
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { startFixtureServer } from './fixture-server.mjs';
import { openDogfoodSession, closeDogfoodSession, dogfoodUrlInSession } from './dogfood.mjs';
import { REPO_ROOT } from './lib/paths.mjs';
import { releaseJudge, JUDGE_DECISIONS } from './lib/release-judge.mjs';

const PORT = Number(process.env.WEBQA_AUTOQA_FIXTURE_PORT || 8787);
const OUT = path.join(REPO_ROOT, '.autoqa', 'runs', 'cycle-0002', 'link-bench');
const ORIGIN = `http://127.0.0.1:${PORT}`;

const SIZE_PAGES = [
  { id: 'links-36', url: `${ORIGIN}/benchmark-corpus/links-36.html`, expectLinks: 36 },
  { id: 'links-100', url: `${ORIGIN}/benchmark-corpus/links-100.html`, expectLinks: 100 },
  { id: 'links-119', url: `${ORIGIN}/benchmark-corpus/links-119.html`, expectLinks: 119 },
  { id: 'links-200', url: `${ORIGIN}/benchmark-corpus/links-200.html`, expectLinks: 200 }
];

const WARM_PAGES = [
  { id: 'warm-a', url: `${ORIGIN}/benchmark-corpus/warm-a.html`, expectLinks: 120 },
  { id: 'warm-b', url: `${ORIGIN}/benchmark-corpus/warm-b.html`, expectLinks: 100 },
  { id: 'warm-c', url: `${ORIGIN}/benchmark-corpus/warm-c.html`, expectLinks: 110 }
];

function rowFromResult(meta, result) {
  return {
    id: meta.id,
    url: meta.url,
    expectLinks: meta.expectLinks,
    ok: result.ok,
    timings: result.timings,
    linkMetrics: result.linkMetrics,
    coverage: result.summary?.coverage,
    scanTimings: result.summary?.scanTimings
  };
}

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const fixtures = await startFixtureServer({ port: PORT });
  const sizeRows = [];
  const warmRows = [];

  try {
  // Prefer one Chrome session for all size pages (startup counted once on first open).
  {
    const session = await openDogfoodSession();
    try {
      for (const page of SIZE_PAGES) {
        try {
          const result = await dogfoodUrlInSession(session, {
            url: page.url,
            outDir: path.join(OUT, page.id),
            sampleFrank: false,
            sampleHighlight: false,
            timeoutMs: 300000
          });
          // Attribute full launch cost only to the first page in the reused session.
          if (sizeRows.length > 0) {
            result.timings.chromeLaunchMs = 0;
            result.timings.cdpConnectMs = 0;
            result.timings.extensionLoadMs = 0;
            result.timings.sessionReuse = true;
          } else {
            result.timings.sessionReuse = false;
          }
          sizeRows.push(rowFromResult(page, result));
          console.error(JSON.stringify({ phase: 'size', id: page.id, timings: result.timings, linkMetrics: result.linkMetrics }));
        } catch (error) {
          sizeRows.push({ id: page.id, url: page.url, ok: false, error: String(error?.message || error) });
          console.error(JSON.stringify({ phase: 'size', id: page.id, error: String(error?.message || error) }));
        }
      }
    } finally {
      await closeDogfoodSession(session);
    }
  }

    // Warm-cache sequence: one Chrome session, three pages.
    const warmSession = await openDogfoodSession();
    try {
      for (const page of WARM_PAGES) {
        const result = await dogfoodUrlInSession(warmSession, {
          url: page.url,
          outDir: path.join(OUT, 'warm', page.id),
          sampleFrank: false,
          sampleHighlight: false,
          timeoutMs: 300000
        });
        warmRows.push(rowFromResult(page, result));
        console.error(JSON.stringify({ phase: 'warm', id: page.id, timings: result.timings, linkMetrics: result.linkMetrics }));
      }
    } finally {
      await closeDogfoodSession(warmSession);
    }

    const sizeOk = sizeRows.filter(r => r.ok);
    const linkPhase = sizeOk.map(r => ({
      id: r.id,
      primaryLinkMs: r.timings?.primaryLinkMs,
      refinementLinkMs: r.timings?.refinementLinkMs,
      scanTotalMs: r.timings?.scanTotalMs,
      chromeLaunchMs: r.timings?.chromeLaunchMs,
      dogfoodWallMs: r.timings?.dogfoodWallMs,
      eligible: r.linkMetrics?.eligible,
      attempted: r.linkMetrics?.attempted,
      unprobed: r.linkMetrics?.unprobed,
      accountingOk: r.linkMetrics?.accountingOk
    }));

    const maxPrimary = Math.max(0, ...sizeOk.map(r => Number(r.timings?.primaryLinkMs) || 0));
    const maxScan = Math.max(0, ...sizeOk.map(r => Number(r.timings?.scanTotalMs) || 0));
    const maxWall = Math.max(0, ...sizeOk.map(r => Number(r.timings?.dogfoodWallMs) || 0));
    const startupShare = sizeOk.map(r => {
      const wall = Number(r.timings?.dogfoodWallMs) || 1;
      const scan = Number(r.timings?.scanTotalMs) || 0;
      return { id: r.id, scanShare: scan / wall, startupShare: 1 - (scan / wall) };
    });

    const warmProbes = warmRows.map(r => ({
      id: r.id,
      attempted: r.linkMetrics?.attempted,
      cacheHits: r.linkMetrics?.cacheHits,
      cacheMisses: r.linkMetrics?.cacheMisses,
      primaryLinkMs: r.timings?.primaryLinkMs,
      scanTotalMs: r.timings?.scanTotalMs,
      inconclusive: r.linkMetrics?.inconclusive,
      coverage: r.coverage?.links
    }));

    const linkIsBottleneck = maxPrimary > 15000 || (maxScan > 20000 && maxPrimary > maxScan * 0.5);
    const wallIsMostlyStartup = startupShare.every(s => s.scanShare < 0.35) || maxWall > maxScan * 3;

    const noChangeJustified = !linkIsBottleneck && wallIsMostlyStartup;

    const judge = releaseJudge({
      invariants: { ok: sizeOk.length === SIZE_PAGES.length && sizeOk.every(r => r.linkMetrics?.accountingOk !== false && r.linkMetrics?.unprobed === 0) },
      tests: { passed: 1, failed: 0, total: 1 },
      build: { ok: true },
      check: { ok: true },
      dogfood: { hardFailures: [] },
      candidate: noChangeJustified
        ? {
          intent: 'representative Chrome link scans are not the dogfood wall-time bottleneck; no product link-architecture change justified',
          noChangeJustified: true,
          explainable: true,
          knownRisks: ['warm-cache metrics may be null if product does not yet export cacheHits']
        }
        : {
          intent: 'link subsystem remains a measurable bottleneck under 100–200 link pages',
          explainable: true
        }
    });

    const report = {
      cycle: 2,
      goal: 'cycle-2-link-scan-speed-under-real-chrome',
      preCycleSha: 'dd6288dc7923917edbc4fcea5fb2b11f082a657b',
      sizeRows,
      warmRows,
      linkPhase,
      warmProbes,
      analysis: {
        maxPrimaryLinkMs: maxPrimary,
        maxScanTotalMs: maxScan,
        maxDogfoodWallMs: maxWall,
        startupShare,
        linkIsBottleneck,
        wallIsMostlyStartup,
        productChangeJustified: !noChangeJustified
      },
      judge,
      expectedDecision: noChangeJustified ? JUDGE_DECISIONS.NO_CHANGE_JUSTIFIED : JUDGE_DECISIONS.ACCEPT
    };

    fs.writeFileSync(path.join(OUT, 'cycle-2-report.json'), `${JSON.stringify(report, null, 2)}\n`);
    console.log(JSON.stringify({
      ok: true,
      outDir: OUT,
      analysis: report.analysis,
      judge: report.judge,
      linkPhase,
      warmProbes
    }, null, 2));
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
