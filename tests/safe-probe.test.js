import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import https from 'node:https';
import fs from 'node:fs';
import { Agent, fetch as undiciFetch } from 'undici';
import {
  isPrivateIpAddress,
  isPrivateProbeHost,
  sanitizeProbeUrl,
  assertPublicProbeDestination,
  probeExternalDestination,
  probeExternalCandidates,
  mapExternalProbeRows,
  pinnedLookup,
  isTlsErrorCode,
  evidenceUrl
} from '../packages/security/safe-probe.js';

function listen(handler) {
  const server = http.createServer(handler);
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      resolve({
        server,
        port,
        origin: `http://127.0.0.1:${port}`,
        url: (path = '/') => `http://127.0.0.1:${port}${path}`
      });
    });
  });
}

// Throwaway self-signed cert issued for CN=wrong-host.example — deliberately
// does not match whatever hostname a client connects with, so any client
// that verifies TLS the normal way gets a real ERR_TLS_CERT_ALTNAME_INVALID.
// No secret material: this key signs nothing but this test fixture.
const TLS_FIXTURE_KEY = `-----BEGIN PRIVATE KEY-----
MIIEvQIBADANBgkqhkiG9w0BAQEFAASCBKcwggSjAgEAAoIBAQDSvm/K5CiXIv5R
wwofSECITEKj83dOTGW/OufjGM15fkMMO6J0H8RPwuJvJE+qzqYQkfsUsGq2jTXD
rdKOK9nP7HCNNDv/alOSQH28MSZBUP60RLxsBGhqhPH0feaDxUZulwakEdv2uoxp
NXnUWB5sFLyIO+cg0UwwIiYu0p/3oTBtQBQoeJuaOarcWj4NLh1eNYAMMrmj4gDA
cvxXA2aegY5fKh3OcSALXgYZDWGpuU2dMmgUjH/Ix4ZRlC/Lvi7xpFwfPZKovgn/
G2doZrYekiYSyG/2tq19Q6nGTjejn3G5/7c2no2aRePFUN9EBQV28dwjS/IIqfvl
ORyfRkrPAgMBAAECggEAMVCvCGNrvDJMIQXrEHbv4vU1gvguKvxlsuIt8U6UhqGt
PueVlGb6oU+RfUCaA/ZnlekTQDwoPJ++vROn+ez5A1bo36IhiBtxgv/kbG1z7kTt
1XFgRkahyItjszri/mLjoG1m+G3Vc18kDFqfL7mPJOuVUqvx4hQYKAtVtA9Fr8Rz
w3RjzGTR4hEE05ZNULPE2OSupVX5vOHKIAn2zb4ODXs0QMEqfBzWzNVF0Rj5hxZB
4j6ia60BsLb3pTmSPKuYhT5CtGDpNocCgXbMZtqqtPSfVQdV25LzSgRqAi/1jTJ7
mhuT7XMH3ZDEKs3l3Rx7y3g2kGUAE6U/VTB/dXO9wQKBgQDonMYOxXWB2EAxubqU
1wOJtHEkGQVpXIw1NsFLYC/8JjB6jKWWnwMIeGNSCNjRER2YqVrNu4yvQ8HLhfmq
ZxXOw9MZPoC19Jg69IQiGrUeXps+AS9zOQ/CiuPc744oZO8eN5xY3Td+XbckzJyg
aCEwOXeT/vD9Zm0sdOca+HuOOwKBgQDn7snCEYqKfFnGg0F/slefEed9CN4BTsEt
7YPn2tWfbVhkrsWCSiZU141JyoQ+3g28SffXmthUf0TjltWOPH9s2fkw8G9yrkSj
xA8X8DrZDuYkZvQDxR3sMwN0l0jxx5GZJEE27+v6hxBAtveKIFua4hFq2lBDrgit
4QhY44AIfQKBgQCHEdmz5Bbaod6MwUNFgCDOyldUVa8dwh6sG7Jb+WuDqA1Ia/kP
ICBbv8Q0c2yq4Zxk9BoFEp2be+XBL3eM6jTwjic7Jl8IyRHIUgmT4BxBmT/d3kRW
TNEI7ytnNDdA33M2AaaotzOtDe/1z1Y3kp+K6CO2bTg0fFBymyNDNvxP1wKBgFG/
FTekrRrwh0fznVNfzYhQbDHivTTiyC3i6DoBJIgjpyMdgpnQfsAqlS7sBT6PT3IM
9CD2/8aQcPxyfmS6qAL6tNzt8aoPCDxcbyF115gHq1ArRVhK0qgcttwSMnCdcZDz
eVTerWLI1g6pLohtrTvi8FakCeRA4+g9R47k6IyVAoGATBVqBhs1LepzMLi86QUJ
RIWT9xiqqXWQ8twgHiivJ1TM5pjmaFQtOZASGrDkU8NxPyo484f0EgTQ1dAa0IZP
zDp10ux3xLvkz6Op+sD2OrSiCrt9GQfUYUM5jrgIvjfsgmDy5PzwVjXd1HGJUonr
NWlgabS1OMSa/1jwNFa+hMg=
-----END PRIVATE KEY-----`;
const TLS_FIXTURE_CERT = `-----BEGIN CERTIFICATE-----
MIIDGzCCAgOgAwIBAgIUabSK7AoUVu+sMrzBa/VPagqlqbUwDQYJKoZIhvcNAQEL
BQAwHTEbMBkGA1UEAwwSd3JvbmctaG9zdC5leGFtcGxlMB4XDTI2MDgyOTA0MTYw
NFoXDTM2MDgyNjA0MTYwNFowHTEbMBkGA1UEAwwSd3JvbmctaG9zdC5leGFtcGxl
MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA0r5vyuQolyL+UcMKH0hA
iExCo/N3Tkxlvzrn4xjNeX5DDDuidB/ET8LibyRPqs6mEJH7FLBqto01w63SjivZ
z+xwjTQ7/2pTkkB9vDEmQVD+tES8bARoaoTx9H3mg8VGbpcGpBHb9rqMaTV51Fge
bBS8iDvnINFMMCImLtKf96EwbUAUKHibmjmq3Fo+DS4dXjWADDK5o+IAwHL8VwNm
noGOXyodznEgC14GGQ1hqblNnTJoFIx/yMeGUZQvy74u8aRcHz2SqL4J/xtnaGa2
HpImEshv9ratfUOpxk43o59xuf+3Np6NmkXjxVDfRAUFdvHcI0vyCKn75Tkcn0ZK
zwIDAQABo1MwUTAdBgNVHQ4EFgQUKVooy86W2+T+HDx4Gm5K8NQSslwwHwYDVR0j
BBgwFoAUKVooy86W2+T+HDx4Gm5K8NQSslwwDwYDVR0TAQH/BAUwAwEB/zANBgkq
hkiG9w0BAQsFAAOCAQEACZtugVUEkTEHhZuRQCn95T5EV23Tj/zt89s1ZFvTL91z
1sxRp1WplPP/26Os5lOyaIQGEdIPNCQf1rBl/BccashI4msZTDV5s6DZ3cmM1+co
M1drMa3mp041qcsH1T/vLQ9gSF2mpqKFi2xt12/U13qTYpbfKxS1u1QjrJS42MN2
d+B+KanqcMbPovyowybcW/EP4I+cQGVjdFdXpMbYw7WomWC+5NrcvNNpoFdsUQMW
HeuFmXBUXN/R/AAbl3DPDzpxeqi+hPYx0Oy5uK70kN/3eRI+3qnjDxQUq3dCuLit
AJng4iAoK/qC4YJlasLNv8GeJKuZ4CamHY34MlXg6g==
-----END CERTIFICATE-----`;

function listenTls(handler) {
  const server = https.createServer({ key: TLS_FIXTURE_KEY, cert: TLS_FIXTURE_CERT }, handler);
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      resolve({ server, port });
    });
  });
}

/** Map public-looking host to the local fixture while SSRF still sees a public DNS answer. */
function fixtureOptions(origin) {
  return {
    lookup: async () => [{ address: '93.184.216.34', family: 4 }],
    fetch: async (input, init = {}) => {
      const u = new URL(String(input));
      const rewritten = `${origin}${u.pathname}${u.search}`;
      return fetch(rewritten, init);
    }
  };
}

test('SSRF host policy blocks private, localhost, CGNAT, metadata, userinfo', () => {
  for (const ip of ['127.0.0.1', '10.2.3.4', '172.16.0.1', '192.168.1.1', '169.254.169.254', '100.64.1.2', '0.0.0.0']) {
    assert.equal(isPrivateIpAddress(ip), true, ip);
  }
  assert.equal(isPrivateIpAddress('8.8.8.8'), false);
  assert.equal(isPrivateIpAddress('::ffff:7f00:1'), true);
  assert.equal(isPrivateIpAddress('::ffff:127.0.0.1'), true);
  assert.equal(isPrivateProbeHost('localhost'), true);
  assert.equal(isPrivateProbeHost('::1'), true);
  assert.equal(sanitizeProbeUrl('http://user:pass@example.com/x'), null);
  assert.equal(sanitizeProbeUrl('ftp://example.com/x'), null);
  assert.equal(sanitizeProbeUrl('http://127.0.0.1/secret'), null);
  assert.equal(sanitizeProbeUrl('http://10.0.0.1/'), null);
  const ok = sanitizeProbeUrl('https://example.com/a?token=secret#frag');
  assert.match(ok, /^https:\/\/example\.com\/a\?token=secret$/);
  assert.doesNotMatch(ok, /#/);
  assert.match(evidenceUrl('https://example.com/a?token=secret'), /redacted|value/i);
});

test('direct private destinations are blocked before network', async () => {
  const blocked = await assertPublicProbeDestination('http://127.0.0.1/secret');
  assert.equal(blocked.ok, false);
  assert.equal(blocked.error, 'destination-not-allowed');
  const row = await probeExternalDestination('http://127.0.0.1/secret');
  assert.equal(row.status, 0);
  assert.equal(row.error, 'destination-not-allowed');
});

test('userinfo destinations are blocked', async () => {
  const row = await probeExternalDestination('http://user:pass@example.com/');
  assert.equal(row.error, 'destination-not-allowed');
});

test('HEAD/GET fixture classifies 200/404/410/403/429 conservatively', async () => {
  const counts = { missing: 0 };
  const { server, origin } = await listen((req, res) => {
    if (req.method === 'HEAD') {
      if (req.url === '/head-fail') {
        res.writeHead(405, { allow: 'GET' });
        return void res.end();
      }
      if (req.url === '/head-lie') {
        res.writeHead(404).end();
        return;
      }
    }
    if (req.url === '/ok') return void res.writeHead(200).end('ok');
    if (req.url === '/missing') {
      counts.missing += 1;
      return void res.writeHead(404).end('no');
    }
    if (req.url === '/gone') return void res.writeHead(410).end('gone');
    if (req.url === '/deny') return void res.writeHead(403).end('no');
    if (req.url === '/slow') return void res.writeHead(429).end('wait');
    if (req.url === '/head-fail') return void res.writeHead(404).end('no');
    if (req.url === '/head-lie') return void res.writeHead(200).end('alive');
    res.writeHead(404).end();
  });
  const opts = fixtureOptions(origin);
  try {
    const ok = await probeExternalDestination('https://probe.example.com/ok', opts);
    assert.equal(ok.status, 200);
    assert.equal(ok.method, 'HEAD');
    const missing = await probeExternalDestination('https://probe.example.com/missing', opts);
    assert.equal(missing.status, 404);
    assert.equal(missing.method, 'GET');
    assert.equal(missing.attempts, 2);
    assert.ok(counts.missing >= 2, '404 requires dual GET confirmation');
    assert.equal((await probeExternalDestination('https://probe.example.com/gone', opts)).status, 410);
    assert.equal((await probeExternalDestination('https://probe.example.com/deny', opts)).status, 403);
    assert.equal((await probeExternalDestination('https://probe.example.com/slow', opts)).status, 429);
    const viaGet = await probeExternalDestination('https://probe.example.com/head-fail', opts);
    assert.equal(viaGet.status, 404);
    assert.equal(viaGet.method, 'GET');
    const headLie = await probeExternalDestination('https://probe.example.com/head-lie', opts);
    assert.equal(headLie.status, 200);
    assert.equal(headLie.method, 'GET');
  } finally {
    server.close();
  }
});

test('mapExternalProbeRows collapses duplicates and keeps 403/429 inconclusive', () => {
  const candidates = [
    { url: 'https://example.com/missing', text: 'A', occurrences: 2 },
    { url: 'https://example.com/deny', text: 'B', occurrences: 1 },
    { url: 'https://example.com/ok', text: 'C', occurrences: 1 }
  ];
  const rows = [
    { url: candidates[0].url, status: 404, durationMs: 1, method: 'GET', attempts: 2 },
    { url: candidates[1].url, status: 403, durationMs: 1, method: 'GET', attempts: 1 },
    { url: candidates[2].url, status: 200, durationMs: 1, method: 'HEAD', attempts: 1 }
  ];
  const mapped = mapExternalProbeRows(candidates, rows);
  assert.equal(mapped.findings.length, 2);
  assert.equal(mapped.findings[0].ruleId, 'navigation.link-404-external');
  assert.equal(mapped.findings[0].verification.method, 'privileged external GET');
  assert.equal(mapped.findings[0].verification.attempts, 2);
  assert.equal(mapped.findings[0].count, 2);
  assert.equal(mapped.findings.some((f) => /403/.test(f.ruleId)), false);
  assert.ok(mapped.findings.some((f) => f.ruleId === 'navigation.link-review-external' && f.confidence === 'inconclusive'));
  assert.ok(mapped.incompleteChecks.some((c) => c.reason === 'http-403'));
});

test('one struggling host never sees more than the per-host probe concurrency', async () => {
  let inFlight = 0;
  let peak = 0;
  const { server, origin } = await listen(async (req, res) => {
    inFlight += 1;
    peak = Math.max(peak, inFlight);
    await new Promise((resolve) => setTimeout(resolve, 40));
    inFlight -= 1;
    res.writeHead(200).end('ok');
  });
  try {
    const candidates = Array.from({ length: 16 }, (_, i) => ({ url: `https://probe.example.com/slow-${i}` }));
    const rows = await probeExternalCandidates(candidates, {
      ...fixtureOptions(origin),
      concurrency: 12,
      perHostConcurrency: 2,
      totalBudgetMs: 20000
    });
    assert.equal(rows.length, 16);
    assert.equal(rows.every((r) => r.status === 200), true);
    assert.ok(peak <= 2, `expected at most 2 concurrent requests to one host, saw ${peak}`);
  } finally {
    server.close();
  }
});

test('many hosts still use the full global concurrency', async () => {
  let inFlight = 0;
  let peak = 0;
  const { server, origin } = await listen(async (req, res) => {
    inFlight += 1;
    peak = Math.max(peak, inFlight);
    await new Promise((resolve) => setTimeout(resolve, 40));
    inFlight -= 1;
    res.writeHead(200).end('ok');
  });
  try {
    const candidates = Array.from({ length: 24 }, (_, i) => ({ url: `https://host-${i}.example.com/page` }));
    const rows = await probeExternalCandidates(candidates, {
      ...fixtureOptions(origin),
      concurrency: 12,
      perHostConcurrency: 2,
      totalBudgetMs: 20000
    });
    assert.equal(rows.length, 24);
    assert.ok(peak > 2, `per-host cap must not throttle distinct hosts, peak was ${peak}`);
  } finally {
    server.close();
  }
});

test('duplicate candidate URLs share one network probe', async () => {
  let hits = 0;
  const { server, origin } = await listen((req, res) => {
    hits += 1;
    res.writeHead(404).end('x');
  });
  const opts = { ...fixtureOptions(origin), concurrency: 2 };
  try {
    const candidates = [
      { url: 'https://probe.example.com/dup' },
      { url: 'https://probe.example.com/dup' },
      { url: 'https://probe.example.com/dup#section' }
    ];
    const rows = await probeExternalCandidates(candidates, opts);
    assert.equal(rows.length, 3);
    assert.equal(rows.every((r) => r.status === 404), true);
    // One shared destination: HEAD preflight + dual GET confirmation.
    assert.equal(hits, 3);
  } finally {
    server.close();
  }
});

test('mismatched dual GET stays inconclusive', async () => {
  let gets = 0;
  const { server, origin } = await listen((req, res) => {
    if (req.method === 'HEAD') return void res.writeHead(404).end();
    gets += 1;
    res.writeHead(gets === 1 ? 404 : 200).end(gets === 1 ? 'no' : 'ok');
  });
  const opts = fixtureOptions(origin);
  try {
    const row = await probeExternalDestination('https://probe.example.com/flaky', opts);
    assert.equal(row.status, 0);
    assert.equal(row.error, 'inconclusive-mismatch');
    assert.equal(row.attempts, 2);
  } finally {
    server.close();
  }
});

test('redirect to private IP is blocked after hop revalidation', async () => {
  const { server, origin } = await listen((req, res) => {
    if (req.url === '/to-private') {
      res.writeHead(302, { location: 'http://127.0.0.1/' });
      return void res.end();
    }
    if (req.url === '/to-ok') {
      res.writeHead(302, { location: 'https://probe.example.com/final' });
      return void res.end();
    }
    if (req.url === '/final') return void res.writeHead(200).end('ok');
    res.writeHead(404).end();
  });
  const opts = fixtureOptions(origin);
  try {
    const blocked = await probeExternalDestination('https://probe.example.com/to-private', opts);
    assert.equal(blocked.error, 'destination-not-allowed');
    const ok = await probeExternalDestination('https://probe.example.com/to-ok', opts);
    assert.equal(ok.status, 200);
    assert.equal(ok.redirected, true);
  } finally {
    server.close();
  }
});

test('DNS answer to private IP is blocked', async () => {
  const row = await probeExternalDestination('https://evil.example.com/', {
    lookup: async () => [{ address: '169.254.169.254', family: 4 }]
  });
  assert.equal(row.error, 'destination-not-allowed');
});

test('an invalid TLS certificate is reported with a structured errorCode, not lost inside a generic "fetch failed"', async () => {
  const { server, port } = await listenTls((req, res) => res.writeHead(200).end('should never be read'));
  try {
    const row = await probeExternalDestination('https://probe.example.com/', {
      lookup: async () => [{ address: '93.184.216.34', family: 4 }],
      fetch: async (input, init = {}) => {
        const u = new URL(String(input));
        return fetch(`https://127.0.0.1:${port}${u.pathname}${u.search}`, init);
      }
    });
    assert.equal(row.status, 0);
    assert.equal(row.error, 'fetch failed');
    assert.ok(isTlsErrorCode(row.errorCode), `expected a TLS error code, got ${row.errorCode}`);
  } finally {
    server.close();
  }
});

test('a confirmed invalid-certificate destination becomes its own finding, not a generic broken link or a silently trusted connection', () => {
  const candidate = { url: 'https://healthland.example.com/eyebrow-threading', text: 'Time', occurrences: 1 };
  const row = { url: candidate.url, status: 0, error: 'fetch failed', errorCode: 'ERR_TLS_CERT_ALTNAME_INVALID', durationMs: 20, method: 'GET', attempts: 1 };
  const mapped = mapExternalProbeRows([candidate], [row]);
  assert.equal(mapped.findings.length, 1);
  assert.equal(mapped.findings[0].ruleId, 'navigation.link-insecure-external');
  assert.equal(mapped.findings[0].confidence, 'confirmed');
  assert.match(mapped.findings[0].detail, /ERR_TLS_CERT_ALTNAME_INVALID/);
  assert.equal(mapped.incompleteChecks.length, 0, 'a confirmed TLS finding must not also linger as an unresolved/inconclusive check');
  assert.ok(mapped.resolvedUrls.includes(candidate.url));
});

test('timeout and network errors stay inconclusive', async () => {
  const timed = await probeExternalDestination('https://probe.example.com/hang', {
    lookup: async () => [{ address: '93.184.216.34', family: 4 }],
    timeoutMs: 50,
    fetch: async () => {
      await new Promise((r) => setTimeout(r, 200));
      throw new Error('timeout');
    }
  });
  assert.equal(timed.status, 0);
  assert.match(String(timed.error), /timeout/i);
});

test('query values sanitized in mapped evidence; fragment stripped from sanitizeProbeUrl', () => {
  const candidates = [{ url: 'https://example.com/x?token=abc', text: 'A', occurrences: 3, selector: '#a' }];
  const rows = [{ url: candidates[0].url, status: 404, durationMs: 2, method: 'GET', attempts: 2 }];
  const mapped = mapExternalProbeRows(candidates, rows);
  assert.equal(mapped.findings[0].count, 3);
  assert.doesNotMatch(mapped.findings[0].detail, /token=abc/);
  assert.equal(sanitizeProbeUrl('https://example.com/x#frag'), 'https://example.com/x');
});

test('mapExternalProbeRows refuses under-attempted 404 confirmation', () => {
  const candidates = [{ url: 'https://example.com/missing', text: 'A', occurrences: 1 }];
  const under = mapExternalProbeRows(candidates, [{ url: candidates[0].url, status: 404, method: 'HEAD', attempts: 1, durationMs: 1 }]);
  assert.equal(under.findings.length, 0);
  assert.ok(under.incompleteChecks.some((c) => c.reason === 'http-404'));
  const ok = mapExternalProbeRows(candidates, [{ url: candidates[0].url, status: 404, method: 'GET', attempts: 2, durationMs: 1 }]);
  assert.equal(ok.findings.length, 1);
  assert.equal(ok.findings[0].verification.attempts, 2);
});

function envelopeFor(count) {
  return {
    page: { url: 'https://example.com/', hostname: 'example.com', pathname: '/' },
    findings: [],
    coverage: { links: 'partial' },
    linkAudit: { checked: count, inconclusive: count, reachedLimit: true },
    externalLinkCandidates: Array.from({ length: count }, (_, i) => ({ url: `https://example.com/x${i}`, text: `L${i}`, occurrences: 1 })),
    externalLinkCandidateTotal: count
  };
}

test('gateway envelope does not discard external candidates the gateway could still probe', async () => {
  const { gatewayContextEnvelope, GATEWAY_EXTERNAL_CANDIDATE_CAP } = await import('../packages/ai/evidence-contract.js');
  assert.equal(GATEWAY_EXTERNAL_CANDIDATE_CAP, 80);
  const envelope = gatewayContextEnvelope(envelopeFor(40));
  // 40 fits inside the prober's capacity, so every destination must survive the envelope.
  assert.equal(envelope.externalLinkCandidates.length, 40);
  assert.equal(envelope.externalLinkCandidateTotal, 40);
  assert.doesNotMatch(JSON.stringify(envelope), /incompleteChecks/);
});

test('gateway envelope keeps external candidate total when sliced at the prober cap', async () => {
  const { gatewayContextEnvelope } = await import('../packages/ai/evidence-contract.js');
  const envelope = gatewayContextEnvelope(envelopeFor(95));
  assert.equal(envelope.externalLinkCandidates.length, 80);
  assert.equal(envelope.externalLinkCandidateTotal, 95);
});

test('privileged probe concurrency can drain the candidate cap inside the budget', async () => {
  const sources = ['services/api/server.js', 'services/renderer/server.js'];
  for (const file of sources) {
    const src = fs.readFileSync(file, 'utf8');
    const call = src.match(/probeExternalCandidates\([^)]*\{([^}]*)\}/);
    assert.ok(call, `${file} should configure probeExternalCandidates`);
    const maxCandidates = Number(call[1].match(/maxCandidates:\s*(\d+)/)?.[1]);
    const concurrency = Number(call[1].match(/concurrency:\s*(\d+)/)?.[1]);
    const totalBudgetMs = Number(call[1].match(/totalBudgetMs:\s*(\d+)/)?.[1]);
    // Worst case a confirmable failure costs two sequential timeouts.
    const worstCaseProbeMs = 4500 * 2;
    const waves = Math.ceil(maxCandidates / concurrency);
    assert.ok(
      waves * worstCaseProbeMs <= totalBudgetMs * 4,
      `${file}: ${maxCandidates} candidates at concurrency ${concurrency} cannot drain within ${totalBudgetMs}ms`
    );
    assert.ok(concurrency >= 12, `${file}: concurrency ${concurrency} is too low for ${maxCandidates} candidates`);
  }
});

test('an external 404 beyond the old 12-candidate slice reaches the gateway and is confirmed broken', async () => {
  const { gatewayContextEnvelope } = await import('../packages/ai/evidence-contract.js');
  const candidates = Array.from({ length: 20 }, (_, i) => ({
    url: `https://example.net/doc-${i}/`,
    text: `Doc ${i}`,
    occurrences: 1
  }));
  const brokenUrl = candidates[19].url;
  const envelope = gatewayContextEnvelope({
    page: { url: 'https://example.com/', hostname: 'example.com', pathname: '/' },
    findings: [],
    coverage: { links: 'partial' },
    externalLinkCandidates: candidates,
    externalLinkCandidateTotal: 20
  });
  const shipped = envelope.externalLinkCandidates;
  assert.ok(shipped.some((c) => c.url === brokenUrl), 'the broken destination must survive the envelope');

  const rows = shipped.map((c) => (c.url === brokenUrl
    ? { url: c.url, status: 404, method: 'GET', attempts: 2, durationMs: 5 }
    : { url: c.url, status: 200, method: 'GET', attempts: 1, durationMs: 5 }));
  const applied = mapExternalProbeRows(shipped, rows);
  assert.equal(applied.findings.length, 1);
  assert.match(applied.findings[0].ruleId, /link-404/);
  assert.equal(applied.findings[0].confidence, 'confirmed');
});

test('a full external candidate payload stays inside the gateway body limit', async () => {
  const { gatewayContextEnvelope } = await import('../packages/ai/evidence-contract.js');
  const candidates = Array.from({ length: 80 }, (_, i) => ({
    url: `https://example.com/${'segment/'.repeat(20)}${i}`,
    text: `Link label ${i} `.repeat(12),
    occurrences: 4,
    prominence: 'main',
    location: 'body',
    selector: `main > div:nth-child(${i}) > a`,
    sources: Array.from({ length: 8 }, (_, s) => ({ selector: `a.s${s}`, text: `anchor ${s}` }))
  }));
  // The envelope also carries up to 120 findings; the combined worst case must fit, because a
  // 413 would kill the whole context enrichment rather than just the link portion.
  const findings = Array.from({ length: 120 }, (_, i) => ({
    id: `rule.example-${i}`,
    ruleId: `rule.example-${i}`,
    title: `Finding ${i} `.repeat(6),
    detail: `Detail text for finding ${i}. `.repeat(20),
    category: 'fix',
    severity: 'high',
    confidence: 'confirmed',
    evidence: `evidence blob ${i} `.repeat(10),
    selector: `main > section:nth-child(${i}) > div > a`,
    count: 3
  }));
  const envelope = gatewayContextEnvelope({
    page: { url: 'https://example.com/', hostname: 'example.com', pathname: '/' },
    findings,
    coverage: { links: 'partial' },
    externalLinkCandidates: candidates,
    externalLinkCandidateTotal: 80
  });
  assert.equal(envelope.externalLinkCandidates.length, 80);
  // services/api/server.js enforces express.json({ limit: '700kb' }).
  const bytes = Buffer.byteLength(JSON.stringify(envelope), 'utf8');
  assert.ok(bytes < 700 * 1024, `envelope was ${bytes} bytes`);
});

test('pinnedLookup answers a dual-stack {all:true} DNS request with an address array, not the legacy 3-arg shape', () => {
  // This is the actual root cause behind every external probe failing instantly as
  // a generic "fetch failed": Node's connect layer calls the custom lookup with
  // {all:true} for its default Happy-Eyeballs/dual-stack connection strategy, and
  // answering in the legacy (err, address, family) shape regardless makes Node
  // misread the pinned IP string as an addresses array, throwing
  // ERR_INVALID_IP_ADDRESS before any real network attempt is made.
  const lookup = pinnedLookup('93.184.216.34', 4);

  let allResult;
  lookup('probe.example.com', { all: true, hints: 0 }, (err, addresses) => { allResult = { err, addresses }; });
  assert.equal(allResult.err, null);
  assert.deepEqual(allResult.addresses, [{ address: '93.184.216.34', family: 4 }]);

  let legacyResult;
  lookup('probe.example.com', {}, (err, address, family) => { legacyResult = { err, address, family }; });
  assert.equal(legacyResult.err, null);
  assert.equal(legacyResult.address, '93.184.216.34');
  assert.equal(legacyResult.family, 4);
});

test('the all/legacy dual-stack dispatch shape completes a real connection under Node\'s actual connect logic', async () => {
  // Unlike every other test in this file, this does NOT override options.fetch —
  // it exercises the same Agent + custom lookup wiring pinnedFetch actually builds
  // (minus the SSRF gate, which is a separate, already-covered policy concern),
  // against Node's real net/tls connect internals. Every other test here stubs
  // fetch entirely, which is exactly why the {all:true} defect above shipped
  // without any test catching it: this is the one code path that touches Node's
  // real dual-stack connect logic instead of mocking around it.
  const { server, port } = await listen((req, res) => { res.writeHead(200).end('ok'); });
  try {
    const agent = new Agent({
      connect: {
        lookup(_host, options, callback) {
          if (options && options.all) callback(null, [{ address: '127.0.0.1', family: 4 }]);
          else callback(null, '127.0.0.1', 4);
        }
      }
    });
    const res = await undiciFetch(`http://probe.example.com:${port}/`, { dispatcher: agent });
    assert.equal(res.status, 200);
  } finally {
    server.close();
  }
});

test('a true redirect cycle is confirmed as a loop instead of exhausting the hop limit', async () => {
  const { server, origin } = await listen((req, res) => {
    if (req.url === '/loop-a') {
      res.writeHead(302, { location: 'https://probe.example.com/loop-b' });
      return void res.end();
    }
    if (req.url === '/loop-b') {
      res.writeHead(302, { location: 'https://probe.example.com/loop-a' });
      return void res.end();
    }
    res.writeHead(404).end();
  });
  const opts = fixtureOptions(origin);
  try {
    const row = await probeExternalDestination('https://probe.example.com/loop-a', opts);
    assert.equal(row.error, 'redirect-loop');
    assert.equal(row.redirected, true);
    assert.ok(row.attempts >= 1, 'a loop is a real, attempted probe, not an unattempted one');
  } finally {
    server.close();
  }
});

test('destination-not-allowed and redirect-limit rows are never silently dropped from accounting', async () => {
  const blocked = await probeExternalDestination('http://127.0.0.1/secret');
  assert.equal(blocked.error, 'destination-not-allowed');
  assert.ok(blocked.attempts >= 1, 'a refused destination was still evaluated, so it must count as attempted');

  const candidate = { url: 'http://127.0.0.1/secret', text: 'internal admin', occurrences: 1 };
  const mapped = mapExternalProbeRows([candidate], [blocked]);
  assert.equal(mapped.incompleteChecks.length, 1, 'a refused destination must still surface, not vanish from the report');
  assert.equal(mapped.incompleteChecks[0].reason, 'destination-not-allowed');
  assert.notEqual(mapped.incompleteChecks[0].cause, 'network-failure', 'a deliberate safety refusal is not a network failure');
});
