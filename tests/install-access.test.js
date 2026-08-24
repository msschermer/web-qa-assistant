import test from 'node:test';
import assert from 'node:assert/strict';
import { issueInstallationToken, verifyInstallationToken } from '../packages/auth/install-access.js';

const secret = 'this-is-a-long-random-test-signing-secret-value';
const installationId = 'install_0123456789abcdef';

test('managed installation tokens are signed, scoped to an install id, and expire', () => {
  const now = 1_700_000_000_000;
  const issued = issueInstallationToken({ installationId, secret, ttlMs: 60_000, now });
  assert.match(issued.token, /^wqai\./);
  assert.deepEqual(verifyInstallationToken(issued.token, { secret, now: now + 1_000 }), { ok: true, installationId, expiresAt: now + 60_000 });
  assert.equal(verifyInstallationToken(issued.token, { secret, now: now + 60_001 }).reason, 'expired');
});

test('managed installation tokens reject tampering and can be revoked by installation id', () => {
  const issued = issueInstallationToken({ installationId, secret, ttlMs: 60_000, now: 10_000 });
  assert.equal(verifyInstallationToken(`${issued.token}x`, { secret, now: 20_000 }).ok, false);
  assert.equal(verifyInstallationToken(issued.token, { secret, now: 20_000, revokedInstallationIds: [installationId] }).reason, 'revoked');
});
