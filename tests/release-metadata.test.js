import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeReleaseText, provenanceMatchesVersion } from '../scripts/release-metadata.mjs';

test('normalizeReleaseText converts CRLF to LF for cross-platform release checks', () => {
  assert.equal(normalizeReleaseText('line\r\nnext'), 'line\nnext');
  assert.equal(normalizeReleaseText('line\nnext'), 'line\nnext');
});

test('provenanceMatchesVersion accepts CRLF or LF provenance headers', () => {
  const version = '1.7.2';
  assert.equal(provenanceMatchesVersion(`Web QA Assistant ${version}\n\nAutomated validation`, version), true);
  assert.equal(provenanceMatchesVersion(`Web QA Assistant ${version}\r\n\r\nAutomated validation`, version), true);
  assert.equal(provenanceMatchesVersion(`Web QA Assistant 1.7.1\n\nAutomated validation`, version), false);
});
