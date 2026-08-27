import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {
  applyPrivilegedProbeAccounting,
  buildCoverageAccounting,
  finalizeLinkAudit
} from '../packages/findings/coverage.js';

function abortError(message = 'timed out') {
  const error = new Error(message);
  error.name = 'AbortError';
  return error;
}

function anchor(href, text = 'Link') {
  return {
    href,
    innerText: text,
    className: '',
    nodeType: 1,
    localName: 'a',
    tagName: 'A',
    id: '',
    classList: [],
    parentElement: null,
    outerHTML: `<a href="${href}">${text}</a>`,
    getAttribute(name) { if (name === 'href') return href; return null; },
    hasAttribute() { return false; },
    closest() { return null; }
  };
}

function makeAnchors(n, { host = 'example.com', prefix = 'page' } = {}) {
  const anchors = [];
  const sequences = {};
  for (let i = 0; i < n; i++) {
    const url = `https://${host}/${prefix}-${i}/`;
    anchors.push(anchor(url, `Link ${i}`));
    sequences[url] = [{ status: 200 }];
  }
  return { anchors, sequences };
}

function delayedFetch({ sequences, delays = {}, statusFor, track }) {
  const queues = new Map(Object.entries(sequences || {}).map(([url, rows]) => [url, [...rows]]));
  const lastByUrl = new Map();
  return async (url, opts) => {
    const host = (() => { try { return new URL(String(url)).host; } catch { return ''; } })();
    const delay = Number(delays[String(url)] ?? delays[host] ?? 0);
    track?.start(host);
    try {
      if (delay) {
        await new Promise((resolve, reject) => {
          const timer = setTimeout(resolve, delay);
          opts?.signal?.addEventListener('abort', () => {
            clearTimeout(timer);
            reject(abortError());
          });
        });
      }
      if (opts?.signal?.aborted) throw abortError();
      if (typeof statusFor === 'function') {
        const row = statusFor(String(url), host);
        if (row instanceof Error) throw row;
        return { status: row.status, url: row.url || String(url), redirected: Boolean(row.redirected) };
      }
      const queue = queues.get(String(url)) || [];
      const next = queue.length ? queue.shift() : (lastByUrl.get(String(url)) || { status: 200 });
      lastByUrl.set(String(url), next);
      if (next instanceof Error) throw next;
      if (next?.throw) throw next.throw;
      return { status: next.status ?? 200, url: next.url || String(url), redirected: Boolean(next.redirected) };
    } finally {
      track?.end(host);
    }
  };
}

function concurrencyTrack() {
  const global = { inFlight: 0, max: 0 };
  const hosts = new Map();
  return {
    start(host) {
      global.inFlight += 1;
      global.max = Math.max(global.max, global.inFlight);
      const row = hosts.get(host) || { inFlight: 0, max: 0 };
      row.inFlight += 1;
      row.max = Math.max(row.max, row.inFlight);
      hosts.set(host, row);
    },
    end(host) {
      global.inFlight -= 1;
      const row = hosts.get(host);
      if (row) row.inFlight -= 1;
    },
    snapshot() {
      return {
        maxGlobal: global.max,
        maxByHost: Object.fromEntries([...hosts].map(([host, row]) => [host, row.max]))
      };
    }
  };
}

function harness(anchors, { sequences = {}, delays = {}, statusFor, track } = {}) {
  const context = {
    URL, AbortController, setTimeout, clearTimeout, performance,
    CSS: { escape: (v) => String(v) },
    location: { href: 'https://example.com/source/', origin: 'https://example.com', protocol: 'https:', hostname: 'example.com' },
    document: {
      querySelectorAll(selector) { return selector === 'a[href]' ? anchors : []; },
      querySelector() { return null; },
      head: { contains() { return false; } },
      body: { contains() { return true; } },
      documentElement: {},
      links: anchors, forms: [], images: []
    },
    fetch: delayedFetch({ sequences, delays, statusFor, track })
  };
  vm.createContext(context);
  vm.runInContext(fs.readFileSync('packages/rules/browser-rules.js', 'utf8'), context, { filename: 'browser-rules.js' });
  return context.WebQARules;
}

function assertPrimaryIdentity(result) {
  assert.equal(result.attempted, result.verifiedHealthy + result.confirmedIssues + result.inconclusive);
  assert.equal(result.eligible, result.attempted + result.unprobed + (result.explicitlySkipped || 0));
  const byCause = result.inconclusiveByCause || {};
  const causeSum = Number(byCause.scannerBudgetAborted || 0)
    + Number(byCause.scannerTimeout || 0)
    + Number(byCause.scannerCancelled || 0)
    + Number(byCause.remoteBlocked || 0)
    + Number(byCause.rateLimited || 0)
    + Number(byCause.corsOrOpaque || 0)
    + Number(byCause.networkFailure || 0)
    + Number(byCause.unsupportedProbe || 0)
    + Number(byCause.ambiguousResponse || 0)
    + Number(byCause.other || 0);
  assert.equal(causeSum, result.inconclusive);
  assert.equal(result.scannerAborted || 0, Number(byCause.scannerBudgetAborted || 0));
}

async function completeQueue(n, extra = {}) {
  const { anchors, sequences } = makeAnchors(n);
  const started = performance.now();
  const result = await harness(anchors, { sequences }).auditLinks({
    concurrency: 10,
    perHostConcurrency: 2,
    timeoutMs: 150,
    retryTimeoutMs: 150,
    emergencyMs: 20000,
    ...extra
  });
  return { result, durationMs: Math.round(performance.now() - started) };
}

test('queue completes for 1, 36, 134, and 200 unique current-page links', async () => {
  for (const n of [1, 36, 134, 200]) {
    const { result, durationMs } = await completeQueue(n);
    assert.equal(result.discovered, n, `${n} discovered`);
    assert.equal(result.eligible, n);
    assert.equal(result.attempted, n);
    assert.equal(result.unprobed, 0);
    assert.equal(result.scannerAborted, 0);
    assert.equal(result.status, 'complete');
    assert.equal(result.probeBudgetPreventedCoverage, false);
    assert.equal(result.queueMetrics?.completion, 'queue-empty');
    assertPrimaryIdentity(result);
    assert.ok(durationMs < 8000, `${n} links took ${durationMs}ms`);
  }
});

test('300 unique links complete under the 500 emergency ceiling', async () => {
  const { result, durationMs } = await completeQueue(300, { timeoutMs: 80, retryTimeoutMs: 80 });
  assert.equal(result.discovered, 300);
  assert.equal(result.attempted, 300);
  assert.equal(result.unprobed, 0);
  assert.equal(result.status, 'complete');
  assertPrimaryIdentity(result);
  assert.ok(durationMs < 12000, `300 links took ${durationMs}ms`);
});

test('beyond the unique-URL ceiling retains full discovery and unprobed remainder', async () => {
  const { anchors, sequences } = makeAnchors(520);
  const result = await harness(anchors, { sequences }).auditLinks({
    limit: 500,
    concurrency: 10,
    perHostConcurrency: 2,
    timeoutMs: 80,
    retryTimeoutMs: 80,
    emergencyMs: 20000
  });
  assert.equal(result.discovered, 520);
  assert.equal(result.eligible, 520);
  assert.equal(result.attempted, 500);
  assert.equal(result.unprobed, 20);
  assert.equal(result.status, 'partial');
  assert.equal(result.probeBudgetPreventedCoverage, true);
  assert.equal(result.reachedLimit, true);
  assertPrimaryIdentity(result);
});

test('global in-flight stays within configured concurrency across hosts', async () => {
  const anchors = [];
  const sequences = {};
  for (let h = 0; h < 8; h++) {
    for (let i = 0; i < 6; i++) {
      const url = `https://host-${h}.example.com/p-${i}/`;
      anchors.push(anchor(url));
      sequences[url] = [{ status: 200 }];
    }
  }
  const track = concurrencyTrack();
  const delays = {};
  for (const a of anchors) delays[a.href] = 25;
  const result = await harness(anchors, { sequences, delays, track }).auditLinks({
    concurrency: 8,
    perHostConcurrency: 3,
    timeoutMs: 400,
    retryTimeoutMs: 400,
    emergencyMs: 8000
  });
  const snap = track.snapshot();
  assert.equal(result.attempted, 48);
  assert.ok(snap.maxGlobal <= 8, `global in-flight ${snap.maxGlobal}`);
  assert.ok(snap.maxGlobal >= 4, `expected overlapping workers, got ${snap.maxGlobal}`);
  for (const max of Object.values(snap.maxByHost)) {
    assert.ok(max <= 3, `per-host in-flight ${max}`);
  }
});

test('per-host concurrency stays bounded while other hosts keep workers busy', async () => {
  const anchors = [];
  const sequences = {};
  const delays = {};
  for (let i = 0; i < 20; i++) {
    const fast = `https://fast.example.com/p-${i}/`;
    const slow = `https://slow.example.com/p-${i}/`;
    anchors.push(anchor(fast), anchor(slow));
    sequences[fast] = [{ status: 200 }];
    sequences[slow] = [{ status: 200 }];
    delays[fast] = 10;
    delays[slow] = 80;
  }
  const track = concurrencyTrack();
  const result = await harness(anchors, { sequences, delays, track }).auditLinks({
    concurrency: 10,
    perHostConcurrency: 2,
    timeoutMs: 400,
    retryTimeoutMs: 400,
    emergencyMs: 8000
  });
  const snap = track.snapshot();
  assert.equal(result.attempted, 40);
  assert.equal(result.status, 'complete');
  assert.ok(snap.maxByHost['slow.example.com'] <= 2);
  assert.ok(snap.maxByHost['fast.example.com'] <= 2);
  assert.ok(snap.maxGlobal <= 10);
  assert.ok(snap.maxGlobal >= 3, 'slow host must not monopolize the worker pool');
  assertPrimaryIdentity(result);
});

test('slow host timeouts do not block fast hosts or break accounting', async () => {
  const anchors = [];
  const sequences = {};
  const delays = {};
  for (let i = 0; i < 90; i++) {
    const url = `https://example.com/fast-${i}/`;
    anchors.push(anchor(url));
    sequences[url] = [{ status: 200 }];
    delays[url] = 4;
  }
  for (let i = 0; i < 10; i++) {
    const url = `https://slow.example.net/slow-${i}/`;
    anchors.push(anchor(url));
    sequences[url] = [{ status: 200 }];
    delays[url] = 300;
  }
  const track = concurrencyTrack();
  const result = await harness(anchors, { sequences, delays, track }).auditLinks({
    concurrency: 10,
    perHostConcurrency: 2,
    timeoutMs: 50,
    retryTimeoutMs: 50,
    emergencyMs: 8000
  });
  const snap = track.snapshot();
  assert.equal(result.discovered, 100);
  assert.equal(result.attempted, 100);
  assert.equal(result.unprobed, 0);
  assert.equal(result.scannerAborted, 0);
  assert.equal(result.status, 'complete');
  assert.ok(result.verifiedHealthy >= 90);
  assert.ok(result.inconclusive >= 10);
  assert.ok(snap.maxByHost['slow.example.net'] <= 2);
  assert.ok(snap.maxGlobal <= 10);
  assertPrimaryIdentity(result);
});

test('repeated 429s are rate-limited, not broken, and do not abort the queue', async () => {
  const anchors = [];
  const sequences = {};
  for (let i = 0; i < 24; i++) {
    const url = `https://limited.example.com/item-${i}/`;
    anchors.push(anchor(url));
    sequences[url] = [{ status: 429 }];
  }
  const result = await harness(anchors, { sequences }).auditLinks({
    concurrency: 10,
    perHostConcurrency: 2,
    timeoutMs: 150,
    retryTimeoutMs: 150,
    emergencyMs: 8000
  });
  assert.equal(result.attempted, 24);
  assert.equal(result.confirmedIssues, 0);
  assert.equal(result.unprobed, 0);
  assert.equal(result.scannerAborted, 0);
  assert.equal(result.status, 'complete');
  assert.equal(result.probeBudgetPreventedCoverage, false);
  assert.ok(result.inconclusiveByCause.rateLimited >= 3);
  assert.equal(result.findings.filter((f) => /link-404/.test(f.ruleId)).length, 0);
  assert.equal(result.findings.filter((f) => /Independent requests received HTTP 429/.test(f.detail || '') && (f.verification?.attempts || 0) === 0).length, 0);
  assertPrimaryIdentity(result);
});

test('primary coverage stays complete when refinement is truncated', () => {
  const incompleteChecks = Array.from({ length: 20 }, (_, i) => ({
    kind: 'external-link',
    url: `https://cdn.example.net/asset-${i}`,
    reason: 'unavailable',
    cause: 'network-failure',
    status: 0,
    attempts: [{ attempt: 1, state: 'unavailable', status: 0 }]
  }));
  const report = applyPrivilegedProbeAccounting({
    coverage: { links: 'complete', browser: 'complete' },
    findings: [],
    linkAudit: {
      discovered: 100,
      eligible: 100,
      attempted: 100,
      checked: 100,
      verifiedHealthy: 80,
      confirmedIssues: 0,
      inconclusive: 20,
      unprobed: 0,
      explicitlySkipped: 0,
      scannerAborted: 0,
      inconclusiveByCause: {
        total: 20,
        scannerBudgetAborted: 0,
        scannerTimeout: 0,
        remoteBlocked: 0,
        rateLimited: 0,
        corsOrOpaque: 0,
        networkFailure: 20,
        unsupportedProbe: 0,
        ambiguousResponse: 0,
        other: 0
      },
      incompleteChecks,
      unprobedChecks: [],
      probeBudgetPreventedCoverage: false
    }
  }, {
    applied: {
      findings: [],
      incompleteChecks: incompleteChecks.slice(0, 15),
      resolvedUrls: incompleteChecks.slice(0, 15).map((row) => row.url)
    },
    truncated: true,
    candidateTotal: 20,
    candidatesProbed: 15
  });
  assert.equal(report.coverage.links, 'complete');
  assert.equal(report.linkAudit.unprobed, 0);
  assert.equal(report.linkAudit.scannerAborted, 0);
  assert.equal(report.linkAudit.probeBudgetPreventedCoverage, false);
  assert.equal(report.linkAudit.privilegedFallback.eligible, 20);
  assert.equal(report.linkAudit.privilegedFallback.attempted, 15);
  assert.equal(report.linkAudit.privilegedFallback.notAttempted, 5);
  assert.equal(report.linkAudit.refinement.notAttempted, 5);
  assert.equal(report.linkAudit.accountingOk, true);
  const accounting = buildCoverageAccounting(report);
  assert.equal(accounting.links.probeBudgetPreventedCoverage, false);
  assert.equal(accounting.degradedAreas.includes('links'), false);
});

test('privileged fallback eligible equals attempted plus notAttempted', () => {
  const finalized = finalizeLinkAudit({
    discovered: 36,
    eligible: 36,
    attempted: 36,
    verifiedHealthy: 36,
    confirmedIssues: 0,
    inconclusive: 0,
    unprobed: 0,
    scannerAborted: 0,
    privilegedFallback: { mode: 'none', eligible: 27, attempted: 0, notAttempted: 0, stillInconclusive: 27 }
  });
  assert.equal(finalized.linkAudit.privilegedFallback.eligible, 27);
  assert.equal(finalized.linkAudit.privilegedFallback.attempted, 0);
  assert.equal(finalized.linkAudit.privilegedFallback.notAttempted, 27);
  assert.equal(finalized.linkAudit.privilegedFallback.mode, 'queued');
  assert.equal(finalized.linkAudit.accountingOk, true);
});

test('synthetic queue timings stay bounded for crawler-scale current-page inventories', async () => {
  const samples = {};
  for (const n of [36, 100, 134, 200, 300]) {
    const { result, durationMs } = await completeQueue(n, { timeoutMs: 80, retryTimeoutMs: 80 });
    samples[n] = {
      durationMs,
      maxGlobal: result.queueMetrics?.maxGlobalInFlight || 0,
      maxPerHost: result.queueMetrics?.maxPerHostInFlight || 0,
      inconclusive: result.inconclusive,
      timeouts: result.inconclusiveByCause?.scannerTimeout || 0
    };
    assert.equal(result.status, 'complete');
    assert.ok(durationMs < 12000, `${n} took ${durationMs}ms`);
  }
  assert.ok(samples[36].durationMs <= samples[300].durationMs + 50);
});

test('86 same-origin slow links drain with target-origin concurrency instead of stalling unprobed', async () => {
  const conservativeSet = makeAnchors(86, { host: 'example.com', prefix: 'page' });
  const adaptedSet = makeAnchors(86, { host: 'example.com', prefix: 'page' });
  const delays = {};
  for (const a of adaptedSet.anchors) delays[a.href] = 18;
  const conservativeDelays = {};
  for (const a of conservativeSet.anchors) conservativeDelays[a.href] = 18;
  const track = concurrencyTrack();
  const conservative = await harness(conservativeSet.anchors, { sequences: conservativeSet.sequences, delays: conservativeDelays }).auditLinks({
    concurrency: 12,
    targetOriginConcurrency: 2,
    externalPerHostConcurrency: 2,
    timeoutMs: 400,
    retryTimeoutMs: 400,
    emergencyMs: 8000
  });
  const result = await harness(adaptedSet.anchors, { sequences: adaptedSet.sequences, delays, track }).auditLinks({
    concurrency: 12,
    targetOriginConcurrency: 6,
    externalPerHostConcurrency: 2,
    timeoutMs: 400,
    retryTimeoutMs: 400,
    emergencyMs: 8000
  });
  const snap = track.snapshot();
  assert.equal(result.eligible, 86);
  assert.equal(result.attempted, 86);
  assert.equal(result.unprobed, 0);
  assert.equal(result.status, 'complete');
  assert.equal(result.queueMetrics?.terminationReason, 'queue-drained');
  assert.equal(result.linksByOriginClass.targetOrigin.eligible, 86);
  assert.equal(result.linksByOriginClass.targetOrigin.attempted, 86);
  assert.equal(result.linksByOriginClass.targetOrigin.unprobed, 0);
  assert.ok((result.queueMetrics?.maxTargetOriginInFlight || 0) >= 4);
  assert.ok((result.queueMetrics?.maxTargetOriginInFlight || 0) <= 16);
  assert.ok((result.queueMetrics?.targetOriginConcurrencyEnd || 0) >= (result.queueMetrics?.targetOriginConcurrencyStart || 0));
  assert.ok(snap.maxByHost['example.com'] >= 4);
  assert.ok(conservative.primaryLinkMs >= result.primaryLinkMs - 5);
  assertPrimaryIdentity(result);
});

test('target-origin workers stay busier than conservative external per-host limits', async () => {
  const anchors = [];
  const sequences = {};
  const delays = {};
  for (let i = 0; i < 70; i++) {
    const url = `https://example.com/t-${i}/`;
    anchors.push(anchor(url));
    sequences[url] = [{ status: 200 }];
    delays[url] = 20;
  }
  for (let h = 0; h < 8; h++) {
    for (let i = 0; i < 2; i++) {
      const url = `https://third-${h}.cdn.test/e-${i}/`;
      anchors.push(anchor(url));
      sequences[url] = [{ status: 200 }];
      delays[url] = h === 0 ? 120 : 20;
    }
  }
  const track = concurrencyTrack();
  const result = await harness(anchors, { sequences, delays, track }).auditLinks({
    concurrency: 12,
    targetOriginConcurrency: 6,
    externalPerHostConcurrency: 2,
    timeoutMs: 400,
    retryTimeoutMs: 400,
    emergencyMs: 8000
  });
  const snap = track.snapshot();
  assert.equal(result.eligible, 86);
  assert.equal(result.attempted, 86);
  assert.equal(result.unprobed, 0);
  assert.ok(result.queueMetrics.maxTargetOriginInFlight >= 4);
  assert.ok(result.queueMetrics.maxTargetOriginInFlight > (result.queueMetrics.maxExternalPerHostInFlight || 0));
  assert.ok(snap.maxByHost['third-0.cdn.test'] <= 2);
  assert.ok(snap.maxByHost['example.com'] >= 4);
  assert.equal(result.linksByOriginClass.targetOrigin.eligible, 70);
  assert.equal(result.linksByOriginClass.external.eligible, 16);
  assertPrimaryIdentity(result);
});

test('emergency deadline still leaves genuine pathological work as limited coverage', async () => {
  const { anchors, sequences } = makeAnchors(40, { prefix: 'hang' });
  const delays = {};
  for (const a of anchors) delays[a.href] = 400;
  const result = await harness(anchors, { sequences, delays }).auditLinks({
    concurrency: 8,
    targetOriginConcurrency: 6,
    externalPerHostConcurrency: 2,
    timeoutMs: 80,
    retryTimeoutMs: 80,
    emergencyMs: 60
  });
  assert.equal(result.discovered, 40);
  assert.ok(result.unprobed > 0 || result.scannerAborted > 0);
  assert.equal(result.status, 'partial');
  assert.equal(result.queueMetrics?.terminationReason, 'emergency-deadline');
  assert.equal(result.eligible, result.attempted + result.unprobed);
  assertPrimaryIdentity(result);
});

test('AbortError from the probe timer is scanner-timeout, not network-failure', async () => {
  const url = 'https://example.com/aborted/';
  const result = await harness([anchor(url)], {
    sequences: { [url]: [abortError(), abortError()] }
  }).auditLinks({
    concurrency: 1,
    timeoutMs: 40,
    retryTimeoutMs: 40,
    emergencyMs: 2000
  });
  assert.equal(result.attempted, 1);
  assert.equal(result.unprobed, 0);
  assert.equal(result.inconclusiveByCause.networkFailure || 0, 0);
  assert.ok((result.inconclusiveByCause.scannerTimeout || 0) >= 1);
});

test('target-origin jobs are claimed before related and external URLs, and all still complete', async () => {
  const anchors = [];
  const sequences = {};
  const delays = {};
  for (let i = 0; i < 70; i++) {
    const url = `https://example.com/t-${i}/`;
    anchors.push(anchor(url));
    sequences[url] = [{ status: 200 }];
    delays[url] = 8;
  }
  for (let i = 0; i < 10; i++) {
    const url = `https://blog.example.com/r-${i}/`;
    anchors.push(anchor(url));
    sequences[url] = [{ status: 200 }];
    delays[url] = 8;
  }
  for (let i = 0; i < 20; i++) {
    const url = `https://cdn-${i}.example.net/e/`;
    anchors.push(anchor(url));
    sequences[url] = [{ status: 200 }];
    delays[url] = i === 0 ? 80 : 8;
  }
  const result = await harness(anchors, { sequences, delays }).auditLinks({
    concurrency: 12,
    targetOriginConcurrency: 6,
    externalPerHostConcurrency: 2,
    timeoutMs: 400,
    retryTimeoutMs: 400,
    emergencyMs: 8000
  });
  assert.equal(result.eligible, 100);
  assert.equal(result.attempted, 100);
  assert.equal(result.unprobed, 0);
  assert.equal(result.status, 'complete');
  assert.equal(result.linksByOriginClass.targetOrigin.eligible, 70);
  assert.equal(result.linksByOriginClass.related.eligible, 10);
  assert.equal(result.linksByOriginClass.external.eligible, 20);
  const claimed = result.queueMetrics?.claimOrder || [];
  const firstTarget = claimed.indexOf('target');
  const firstExternal = claimed.indexOf('external');
  assert.ok(firstTarget !== -1);
  assert.ok(firstExternal === -1 || firstTarget < firstExternal);
  assertPrimaryIdentity(result);
});
