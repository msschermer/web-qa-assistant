/**
 * Cross-platform release metadata helpers.
 * Normalizes CRLF/LF before prefix checks so Windows working copies do not fail release gates.
 */

export function normalizeReleaseText(value) {
  return String(value ?? '').replace(/\r\n/g, '\n');
}

export function provenanceMatchesVersion(source, version) {
  return normalizeReleaseText(source).startsWith(`Web QA Assistant ${version}\n`);
}
