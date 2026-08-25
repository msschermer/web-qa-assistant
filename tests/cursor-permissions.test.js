import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

test('Cursor auto-run allowlist names exact diagnostic tools and not webqa:*', () => {
  const raw = fs.readFileSync('.cursor/permissions.json', 'utf8');
  const permissions = JSON.parse(raw);
  const allow = JSON.stringify(permissions.autoRun?.allow_instructions || []);
  const block = JSON.stringify(permissions.autoRun?.block_instructions || []);
  assert.match(allow, /webqa_latest_diagnostic/);
  assert.match(allow, /webqa_diagnostic_section/);
  assert.match(allow, /webqa_read_report_bug/);
  assert.doesNotMatch(allow, /webqa:\*/);
  assert.doesNotMatch(allow, /webqa_scan_url/);
  assert.doesNotMatch(allow, /"git"/);
  assert.match(block, /git push|force push|production deployment/i);
});
