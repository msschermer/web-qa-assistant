import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

test('toolbar action opens side panel so activeTab is granted by the user gesture',()=>{
  const bg=fs.readFileSync('apps/extension/background.js','utf8');
  assert.match(bg,/chrome\.action\.onClicked\.addListener/);
  assert.match(bg,/chrome\.sidePanel\.open/);
  assert.doesNotMatch(bg,/openPanelOnActionClick:true/);
});

test('extension keeps broad host access optional',()=>{
  const manifest=JSON.parse(fs.readFileSync('apps/extension/manifest.json','utf8'));
  assert.equal(manifest.permissions.includes('tabs'),false);
  assert.equal(manifest.host_permissions.includes('<all_urls>'),false);
  assert.deepEqual(manifest.optional_host_permissions,['http://*/*','https://*/*']);
});
