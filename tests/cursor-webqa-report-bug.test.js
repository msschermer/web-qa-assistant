import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { readReportBugFile, resolveReportBugPath } from '../tools/cursor-webqa/lib.mjs';

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
    await fs.writeFile(file, '{"ok":true}\n', 'utf8');
    const resolved = await resolveReportBugPath('qa-runs/report.json', { root });
    assert.equal(resolved.repoRelative, 'qa-runs/report.json');
    const read = await readReportBugFile('qa-runs/report.json', { root });
    assert.deepEqual(read.report, { ok: true });
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
