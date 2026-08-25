import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { diagnosticSectionFromArtifact, latestDiagnostic, latestRun, readReportBugFile, resolveReportBugPath } from '../tools/cursor-webqa/lib.mjs';
import { buildBugReport, DIAGNOSTIC_KIND } from '../packages/support/bug-report.js';

async function withFixture(run) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'webqa-report-bug-'));
  const qaRuns = path.join(root, 'qa-runs');
  await fs.mkdir(qaRuns, { recursive: true });
  await fs.mkdir(path.join(root, '.cursor'), { recursive: true });
  await fs.writeFile(path.join(root, '.cursor', 'webqa.env'), 'PLAYWRIGHT_MCP_EXTENSION_TOKEN=secret-token\n', 'utf8');
  try {
    await run({ root, qaRuns });
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
}

test('resolveReportBugPath accepts a valid qa-runs JSON file', async () => {
  await withFixture(async ({ root, qaRuns }) => {
    const file = path.join(qaRuns, 'report.json');
    await fs.writeFile(file, '{"schema":"web-qa-assistant-bug-report/v1","generatedAt":"2026-08-01T00:00:00.000Z"}\n', 'utf8');
    const resolved = await resolveReportBugPath('qa-runs/report.json', { root });
    assert.equal(resolved.repoRelative, 'qa-runs/report.json');
    const read = await readReportBugFile('qa-runs/report.json', { root });
    assert.equal(read.schema, 'web-qa-assistant-bug-report/v1');
    assert.equal(read.report.schema, 'web-qa-assistant-bug-report/v1');
  });
});

test('resolveReportBugPath rejects ../ traversal', async () => {
  await withFixture(async ({ root }) => {
    await assert.rejects(
      () => resolveReportBugPath('qa-runs/../.cursor/webqa.env', { root }),
      /secret or dependency|must be JSON under qa-runs/
    );
  });
});

test('resolveReportBugPath rejects .cursor/webqa.env', async () => {
  await withFixture(async ({ root }) => {
    await assert.rejects(
      () => resolveReportBugPath('.cursor/webqa.env', { root }),
      /secret or dependency|must be JSON under qa-runs/
    );
  });
});

test('resolveReportBugPath rejects non-JSON files under qa-runs', async () => {
  await withFixture(async ({ root, qaRuns }) => {
    await fs.writeFile(path.join(qaRuns, 'notes.txt'), 'not json\n', 'utf8');
    await assert.rejects(
      () => resolveReportBugPath('qa-runs/notes.txt', { root }),
      /must be JSON under qa-runs/
    );
  });
});

test('resolveReportBugPath rejects oversized files', async () => {
  await withFixture(async ({ root, qaRuns }) => {
    const file = path.join(qaRuns, 'huge.json');
    const handle = await fs.open(file, 'w');
    try {
      await handle.writeFile('{"pad":"');
      await handle.write(Buffer.alloc(2_000_001, 0x61));
      await handle.writeFile('"}\n');
    } finally {
      await handle.close();
    }
    await assert.rejects(
      () => resolveReportBugPath('qa-runs/huge.json', { root }),
      /smaller than 2 MB/
    );
  });
});

test('resolveReportBugPath rejects symlink inside qa-runs that points outside', async (t) => {
  await withFixture(async ({ root, qaRuns }) => {
    const outsideDir = path.join(root, 'outside');
    const outsideFile = path.join(outsideDir, 'secret.json');
    await fs.mkdir(outsideDir, { recursive: true });
    await fs.writeFile(outsideFile, '{"secret":true}\n', 'utf8');

    const link = path.join(qaRuns, 'escape.json');
    let linked = false;
    for (const type of [undefined, 'file', 'junction']) {
      try {
        if (type === 'junction') {
          // Windows junctions are directory-only; link a dir then request a nested path.
          const linkDir = path.join(qaRuns, 'escape-dir');
          await fs.symlink(outsideDir, linkDir, 'junction');
          await assert.rejects(
            () => resolveReportBugPath('qa-runs/escape-dir/secret.json', { root }),
            /cannot follow links outside qa-runs/
          );
          linked = true;
          break;
        }
        await fs.symlink(outsideFile, link, type);
        await assert.rejects(
          () => resolveReportBugPath('qa-runs/escape.json', { root }),
          /cannot follow links outside qa-runs/
        );
        linked = true;
        break;
      } catch (error) {
        if (/cannot follow links outside qa-runs/.test(String(error?.message || error))) throw error;
        // try next link strategy
      }
    }
    if (!linked) t.skip('symlinks/junctions unavailable on this platform');
  });
});

test('latestDiagnostic finds newest valid v2 and ignores api-scan, invalid kind, and oversize files', async () => {
  await withFixture(async ({ root, qaRuns }) => {
    await fs.writeFile(path.join(qaRuns, 'zzz-api-scan.json'), JSON.stringify({
      kind: 'api-scan', createdAt: '2099-01-01T00:00:00.000Z', summary: { title: 'do not use' }
    }), 'utf8');
    await fs.writeFile(path.join(qaRuns, 'invalid.json'), JSON.stringify({ kind: 'nope', createdAt: '2099-02-01T00:00:00.000Z' }), 'utf8');
    const oldV2 = buildBugReport({
      version: '1.7.3',
      createdAt: '2026-08-01T00:00:00.000Z',
      report: { scanId: 'old', page: { url: 'https://example.com/old' }, coverage: { browser: 'complete' }, findings: [] }
    });
    const newV2 = buildBugReport({
      version: '1.7.3',
      createdAt: '2026-08-25T18:00:00.000Z',
      report: { scanId: 'new', page: { url: 'https://example.com/new?token=secret' }, coverage: { browser: 'complete' }, findings: [{ id: 'f1', ruleId: 'runtime.uncaught-error' }] }
    });
    await fs.writeFile(path.join(qaRuns, 'older.json'), JSON.stringify(oldV2), 'utf8');
    await fs.writeFile(path.join(qaRuns, 'newer.json'), JSON.stringify(newV2), 'utf8');
    await fs.mkdir(path.join(qaRuns, 'manual'), { recursive: true });
    const nested = buildBugReport({
      version: '1.7.3',
      createdAt: '2026-08-25T19:00:00.000Z',
      report: { scanId: 'nested', page: { url: 'https://example.com/nested' }, coverage: { browser: 'complete' }, findings: [] }
    });
    await fs.writeFile(path.join(qaRuns, 'manual', 'nested.json'), JSON.stringify(nested), 'utf8');
    const huge = path.join(qaRuns, 'huge-diagnostic.json');
    const handle = await fs.open(huge, 'w');
    try {
      await handle.writeFile('{"kind":"report-bug-diagnostic","schema":"web-qa-assistant-bug-report/v2","pad":"');
      await handle.write(Buffer.alloc(2_000_001, 0x61));
      await handle.writeFile('"}\n');
    } finally { await handle.close(); }

    const latest = await latestDiagnostic({ root });
    assert.equal(latest.found, true);
    assert.equal(latest.file, 'qa-runs/manual/nested.json');
    assert.equal(latest.kind, DIAGNOSTIC_KIND);
    assert.doesNotMatch(JSON.stringify(latest), /token=secret|do not use/);
    assert.ok(latest.note);

    const run = await latestRun({ root });
    assert.equal(run.kind, 'api-scan');

    const section = await diagnosticSectionFromArtifact(latest.file, 'scan', { root });
    assert.equal(section.diagnostic.sanitizedUrl, 'https://example.com/nested');
    await assert.rejects(
      () => diagnosticSectionFromArtifact('qa-runs/zzz-api-scan.json', 'scan', { root }),
      /api-scan|not a diagnostic|Expected a Report Bug/
    );
  });
});

test('webqa_read_report_bug keeps v1 readable and returns compact v2 index', async () => {
  await withFixture(async ({ root, qaRuns }) => {
    await fs.writeFile(path.join(qaRuns, 'legacy.json'), JSON.stringify({
      schema: 'web-qa-assistant-bug-report/v1',
      generatedAt: '2026-07-01T00:00:00.000Z',
      extension: { version: '1.7.0' }
    }), 'utf8');
    const v2 = buildBugReport({ version: '1.7.3', createdAt: '2026-08-25T00:00:00.000Z', report: { page: { url: 'https://example.com/' } } });
    await fs.writeFile(path.join(qaRuns, 'v2.json'), JSON.stringify(v2), 'utf8');
    const legacy = await readReportBugFile('qa-runs/legacy.json', { root });
    assert.equal(legacy.schema, 'web-qa-assistant-bug-report/v1');
    assert.equal(legacy.report.extension.version, '1.7.0');
    const compact = await readReportBugFile('qa-runs/v2.json', { root });
    assert.equal(compact.kind, DIAGNOSTIC_KIND);
    assert.ok(compact.index);
    assert.equal(compact.report, undefined);
    await assert.rejects(
      () => diagnosticSectionFromArtifact('qa-runs/legacy.json', 'timeline', { root }),
      /v2 report-bug-diagnostic|legacy/
    );
  });
});

test('latestDiagnostic rejects symlink escape the same as explicit path reads', async (t) => {
  await withFixture(async ({ root, qaRuns }) => {
    const outsideDir = path.join(root, 'outside');
    await fs.mkdir(outsideDir, { recursive: true });
    const v2 = buildBugReport({ version: '1.7.3', createdAt: '2026-08-25T12:00:00.000Z', report: { page: { url: 'https://example.com/escape' } } });
    await fs.writeFile(path.join(outsideDir, 'secret.json'), JSON.stringify(v2), 'utf8');
    try {
      await fs.symlink(path.join(outsideDir, 'secret.json'), path.join(qaRuns, 'escape.json'));
    } catch {
      try { await fs.symlink(outsideDir, path.join(qaRuns, 'escape-dir'), 'junction'); }
      catch { t.skip('symlinks/junctions unavailable on this platform'); return; }
    }
    const latest = await latestDiagnostic({ root });
    assert.equal(latest.found, false);
  });
});

test('diagnostic section cannot read arbitrary JSON outside the contract', async () => {
  await withFixture(async ({ root, qaRuns }) => {
    await fs.writeFile(path.join(qaRuns, 'random.json'), JSON.stringify({ hello: 'world', cookies: 'sid=1' }), 'utf8');
    await assert.rejects(
      () => diagnosticSectionFromArtifact('qa-runs/random.json', 'scan', { root }),
      /Expected a Report Bug|Not a WebQA Report Bug/
    );
  });
});

test('latestDiagnostic prefers v2 over a newer v1', async () => {
  await withFixture(async ({ root, qaRuns }) => {
    const v2 = buildBugReport({
      version: '1.7.3',
      createdAt: '2026-08-01T00:00:00.000Z',
      report: { scanId: 'v2', page: { url: 'https://example.com/v2' }, findings: [] }
    });
    await fs.writeFile(path.join(qaRuns, 'older-v2.json'), JSON.stringify(v2), 'utf8');
    await fs.writeFile(path.join(qaRuns, 'newer-v1.json'), JSON.stringify({
      schema: 'web-qa-assistant-bug-report/v1',
      generatedAt: '2099-01-01T00:00:00.000Z',
      extension: { version: '1.7.0' }
    }), 'utf8');
    const latest = await latestDiagnostic({ root });
    assert.equal(latest.kind, DIAGNOSTIC_KIND);
    assert.equal(latest.file, 'qa-runs/older-v2.json');
    const section = await diagnosticSectionFromArtifact(latest.file, 'scan', { root });
    assert.equal(section.diagnostic.sanitizedUrl, 'https://example.com/v2');
  });
});
