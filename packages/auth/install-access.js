import crypto from 'node:crypto';

function b64url(value) {
  return Buffer.from(value).toString('base64url');
}
function unb64url(value) {
  return Buffer.from(String(value || ''), 'base64url').toString('utf8');
}
function validInstallationId(value) {
  return /^[A-Za-z0-9_-]{16,128}$/.test(String(value || ''));
}
function signature(payload, secret) {
  return crypto.createHmac('sha256', secret).update(payload).digest('base64url');
}
function safeEqual(a, b) {
  const left = Buffer.from(String(a || ''));
  const right = Buffer.from(String(b || ''));
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

export function issueInstallationToken({ installationId, secret, ttlMs = 30 * 24 * 60 * 60 * 1000, now = Date.now() } = {}) {
  if (!validInstallationId(installationId)) throw new Error('A valid installation ID is required.');
  if (!secret || String(secret).length < 24) throw new Error('Installation token signing secret is not configured.');
  const expiresAt = now + Math.max(60_000, Number(ttlMs) || 0);
  const payload = b64url(JSON.stringify({ v: 1, iid: installationId, exp: expiresAt }));
  return { token: `wqai.${payload}.${signature(payload, String(secret))}`, expiresAt };
}

export function verifyInstallationToken(token, { secret, now = Date.now(), revokedInstallationIds = [] } = {}) {
  const raw = String(token || '');
  if (!raw.startsWith('wqai.') || !secret) return { ok: false, reason: 'format' };
  const parts = raw.split('.');
  if (parts.length !== 3) return { ok: false, reason: 'format' };
  const [, payload, suppliedSignature] = parts;
  if (!safeEqual(suppliedSignature, signature(payload, String(secret)))) return { ok: false, reason: 'signature' };
  let data;
  try { data = JSON.parse(unb64url(payload)); } catch { return { ok: false, reason: 'payload' }; }
  if (data?.v !== 1 || !validInstallationId(data?.iid) || !Number.isFinite(Number(data?.exp))) return { ok: false, reason: 'payload' };
  if (Number(data.exp) <= now) return { ok: false, reason: 'expired', installationId: data.iid };
  if (new Set(revokedInstallationIds.map(String)).has(String(data.iid))) return { ok: false, reason: 'revoked', installationId: data.iid };
  return { ok: true, installationId: data.iid, expiresAt: Number(data.exp) };
}
