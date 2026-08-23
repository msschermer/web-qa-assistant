import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

test('built service worker resolves every relative module import', () => {
  const root = process.cwd();
  const seen = new Set();
  const stack = [path.join(root, 'dist/extension/background.js')];
  while (stack.length) {
    const file = stack.pop();
    assert.ok(fs.existsSync(file), `missing module ${path.relative(root, file)}`);
    const abs = path.resolve(file);
    if (seen.has(abs)) continue;
    seen.add(abs);
    const source = fs.readFileSync(abs, 'utf8');
    const specs = [...source.matchAll(/(?:import|export)\s+(?:[^'\"]*?\s+from\s+)?['\"](\.[^'\"]+)['\"]/g)].map(m => m[1]);
    for (const spec of specs) {
      let target = path.resolve(path.dirname(abs), spec);
      if (!path.extname(target)) target += '.js';
      assert.ok(fs.existsSync(target), `${path.relative(root, abs)} imports missing ${spec}`);
      stack.push(target);
    }
  }
});
