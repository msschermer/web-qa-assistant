import fs from 'node:fs';
import path from 'node:path';
import { RUNS_DIR, ensureAutoqaDirs } from './paths.mjs';

const MAX_PASS_AGE_DAYS = 14;
const KEEP_RECENT_PASS = 10;

/**
 * Classify and optionally prune PASS run screenshot bulk.
 * FAIL/REGRESSION/INTERESTING are retained.
 */
export function retainRuns({ now = Date.now() } = {}) {
  ensureAutoqaDirs();
  if (!fs.existsSync(RUNS_DIR)) return { pruned: 0 };
  let pruned = 0;
  const cycles = fs.readdirSync(RUNS_DIR, { withFileTypes: true })
    .filter(d => d.isDirectory() && d.name.startsWith('cycle-'))
    .map(d => d.name)
    .sort();

  const passCycles = [];
  for (const name of cycles) {
    const summaryPath = path.join(RUNS_DIR, name, 'cycle-summary.json');
    if (!fs.existsSync(summaryPath)) continue;
    let summary;
    try { summary = JSON.parse(fs.readFileSync(summaryPath, 'utf8')); } catch { continue; }
    const cls = String(summary.classification || summary.result || 'INTERESTING').toUpperCase();
    if (cls === 'PASS') passCycles.push({ name, summary, mtime: fs.statSync(summaryPath).mtimeMs });
  }

  passCycles.sort((a, b) => b.mtime - a.mtime);
  const stale = passCycles.slice(KEEP_RECENT_PASS).filter(c => (now - c.mtime) > MAX_PASS_AGE_DAYS * 86400000);
  for (const row of stale) {
    const dir = path.join(RUNS_DIR, row.name);
    pruneScreenshots(dir);
    pruned++;
  }
  return { pruned, passKept: Math.min(KEEP_RECENT_PASS, passCycles.length) };
}

function pruneScreenshots(dir) {
  if (!fs.existsSync(dir)) return;
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, ent.name);
    if (ent.isDirectory()) {
      pruneScreenshots(full);
      continue;
    }
    if (/\.(png|jpg|jpeg|webp)$/i.test(ent.name)) {
      try { fs.unlinkSync(full); } catch { /* ignore */ }
    }
  }
}
