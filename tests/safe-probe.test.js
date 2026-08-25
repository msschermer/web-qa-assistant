import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import {
  isPrivateIpAddress,
  isPrivateProbeHost,
  sanitizeProbeUrl,
  assertPublicProbeDestination,
  probeExternalDestination,
  probeExternalCandidates,
  mapExternalProbeRows,
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
  assert.equal(mapped.findings.length, 1);
  assert.equal(mapped.findings[0].ruleId, 'navigation.link-404-external');
  assert.equal(mapped.findings[0].verification.method, 'privileged external GET');
  assert.equal(mapped.findings[0].verification.attempts, 2);
  assert.equal(mapped.findings[0].count, 2);
  assert.equal(mapped.findings.some((f) => /403/.test(f.ruleId)), false);
  assert.ok(mapped.incompleteChecks.some((c) => c.reason === 'http-403'));
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

test('gateway envelope keeps external candidate total when sliced to 12', async () => {
  const { gatewayContextEnvelope } = await import('../packages/ai/evidence-contract.js');
  const candidates = Array.from({ length: 15 }, (_, i) => ({ url: `https://example.com/x${i}`, text: `L${i}`, occurrences: 1 }));
  const envelope = gatewayContextEnvelope({
    page: { url: 'https://example.com/', hostname: 'example.com', pathname: '/' },
    findings: [],
    coverage: { links: 'partial' },
    linkAudit: { checked: 15, inconclusive: 15, reachedLimit: true },
    externalLinkCandidates: candidates,
    externalLinkCandidateTotal: 15
  });
  assert.equal(envelope.externalLinkCandidates.length, 12);
  assert.equal(envelope.externalLinkCandidateTotal, 15);
  assert.doesNotMatch(JSON.stringify(envelope), /incompleteChecks/);
});
