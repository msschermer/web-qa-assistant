import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

// The classifier ships as a plain script injected into the page, so it is tested
// against the exact shipped source rather than a Node-only copy.
const context = vm.createContext({ CSS: { escape: s => s } });
vm.runInContext(fs.readFileSync('packages/rules/image-purpose.js', 'utf8'), context);
const { classifyDescriptor } = context.WebQAImagePurpose;

function descriptor(overrides = {}) {
  return {
    tag: 'img', role: '', ariaHidden: false, hasAriaLabel: false, hasDescribedBy: false,
    iconHint: false, decorHint: false, complexHint: false, logoHint: false,
    width: 0, height: 0, small: false, large: false,
    interactive: false, interactiveTag: '', soleContentOfInteractive: false,
    siblingText: '', inFigure: false, hasFigcaption: false, inContentRegion: false,
    ...overrides
  };
}

// This is the exact regression from browser acceptance: a small check icon that
// sits beside visible "Verified" text. Frank previously offered a
// decorative/informative fork here; it should now resolve.
test('acceptance regression: check icon beside "Verified" resolves to decorative', () => {
  const verdict = classifyDescriptor(descriptor({
    iconHint: true, small: true, width: 32, height: 32, siblingText: 'Verified'
  }));
  assert.equal(verdict.purpose, 'decorative');
  assert.equal(verdict.confidence, 'high');
  assert.equal(verdict.recommendedAlt, '');
  assert.match(verdict.rationale, /adjacent text/i);
  assert.ok(verdict.signals.some(s => /Verified/.test(s)), 'rationale should cite the adjacent text it relied on');
});

test('an image that is the whole content of a link is functional, never decorative', () => {
  const verdict = classifyDescriptor(descriptor({
    logoHint: true, interactive: true, interactiveTag: 'a', soleContentOfInteractive: true, small: true, iconHint: true
  }));
  assert.equal(verdict.purpose, 'functional');
  assert.equal(verdict.recommendedAlt, null, 'a functional image must not be given an empty alt');
});

test('a large content image with no adjacent text is informative', () => {
  const verdict = classifyDescriptor(descriptor({
    width: 800, height: 500, large: true, inContentRegion: true
  }));
  assert.equal(verdict.purpose, 'informative');
  assert.equal(verdict.recommendedAlt, null);
});

test('charts and captioned figures are treated as complex, not as a short-alt case', () => {
  assert.equal(classifyDescriptor(descriptor({ complexHint: true, large: true })).purpose, 'complex');
  assert.equal(classifyDescriptor(descriptor({ inFigure: true, hasFigcaption: true })).purpose, 'complex');
});

test('explicitly presentational markup resolves to decorative', () => {
  assert.equal(classifyDescriptor(descriptor({ role: 'presentation' })).purpose, 'decorative');
  assert.equal(classifyDescriptor(descriptor({ ariaHidden: true })).purpose, 'decorative');
});

// Safety property. Wrongly recommending alt="" deletes meaning from the page,
// so a decorative verdict requires corroboration and no contradicting signal.
test('a single weak signal is never enough to call an image decorative', () => {
  assert.equal(classifyDescriptor(descriptor({ small: true, width: 40, height: 40 })).purpose, 'uncertain');
  assert.equal(classifyDescriptor(descriptor({ iconHint: true })).purpose, 'uncertain');
});

test('an icon-named image that is also rendered at content size stays uncertain', () => {
  const verdict = classifyDescriptor(descriptor({
    iconHint: true, small: false, large: true, width: 600, height: 400, inContentRegion: true
  }));
  assert.equal(verdict.purpose, 'uncertain', 'contradicting signals must not produce a confident verdict');
  assert.equal(verdict.recommendedAlt, null);
});

test('a described image is informative even when it looks like an icon', () => {
  const verdict = classifyDescriptor(descriptor({ hasDescribedBy: true, iconHint: true, small: true }));
  assert.equal(verdict.purpose, 'informative');
});

test('every verdict carries a rationale and bounded signal list', () => {
  for (const d of [descriptor({ iconHint: true, small: true, siblingText: 'Verified' }), descriptor({ large: true }), descriptor()]) {
    const verdict = classifyDescriptor(d);
    assert.ok(verdict.rationale.length > 0, 'a verdict without a rationale cannot be shown to an engineer');
    assert.ok(verdict.signals.length <= 6);
    assert.ok(['decorative', 'informative', 'functional', 'complex', 'uncertain'].includes(verdict.purpose));
  }
});
