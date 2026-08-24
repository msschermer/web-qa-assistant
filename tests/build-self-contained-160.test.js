import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const build = fs.readFileSync('scripts/build-extension.mjs', 'utf8');

test('extension rebuild preserves vendored axe when node_modules is absent', () => {
  const cache = build.indexOf("const axeBytes=");
  const remove = build.indexOf('fs.rmSync(out');
  assert.ok(cache >= 0 && remove > cache, 'axe bytes must be captured before dist is cleared');
  assert.match(build, /fs\.existsSync\(vendoredAxe\)\?fs\.readFileSync\(vendoredAxe\)/);
  assert.match(build, /fs\.writeFileSync\(path\.join\(out,'vendor\/axe\.min\.js'\),axeBytes\)/);
  assert.ok(fs.existsSync('dist/extension/vendor/axe.min.js'), 'release source must retain the vendored axe runtime');
  for (const size of ['16', '32', '48', '128']) assert.ok(fs.existsSync(`dist/extension/icons/${size}.png`), `built ${size}px icon must exist`);
});
