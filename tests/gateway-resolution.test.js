/**
 * Gateway resolution: which root the extension tries, and in what order.
 *
 * This is a latency test disguised as a logic test. `gatewayRequest()` walked
 * `localhost:3000`, `localhost:8787`, then the live gateway on **every** call,
 * with no memory of which one answered. A Chrome fetch to a closed loopback port
 * was measured at 2.4s the first time and 250-330ms after, so an ordinary
 * install, which never runs a local gateway, paid two of those before every
 * single request and the overlay makes several per action.
 *
 * The functions are extracted from the background script rather than imported,
 * because it is a service worker with `chrome.*` at module scope. That keeps the
 * assertions about the real shipped source instead of a copy.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const SOURCE = fs.readFileSync('apps/extension/background.js', 'utf8');

/** Lifts a top-level `function name(` or `const name=` declaration out of the
 * bundle by brace matching, the same way scripts/build-extension.mjs lifts
 * siteAuditCss(). A regex over this file would be a second parser to get wrong. */
function declaration(name) {
  const start = SOURCE.search(new RegExp(`(?:async function|function) ${name}\\s*\\(`));
  if (start < 0) throw new Error(`${name} is missing from background.js`);
  let depth = 0;
  for (let i = SOURCE.indexOf('{', start); i < SOURCE.length; i++) {
    if (SOURCE[i] === '{') depth++;
    else if (SOURCE[i] === '}' && --depth === 0) return SOURCE.slice(start, i + 1);
  }
  throw new Error(`${name} is not brace-balanced`);
}

function harness({ stored = {}, session = {} } = {}) {
  const sessionStore = { ...session };
  const context = {
    LOCAL_APIS: ['http://localhost:3000', 'http://localhost:8787'],
    LIVE_API: 'https://assistant.msschermer.us',
    PREFERRED_GATEWAY_KEY: 'qaPreferredGateway',
    preferredGateway: null,
    settings: async () => ({ apiBase: '', ...stored }),
    chrome: {
      storage: {
        session: {
          get: async (defaults) => {
            const key = Object.keys(defaults)[0];
            return { [key]: sessionStore[key] ?? defaults[key] };
          },
          set: async (obj) => { Object.assign(sessionStore, obj); },
          remove: async (key) => { delete sessionStore[key]; }
        }
      }
    },
    sessionStore
  };
  vm.createContext(context);
  vm.runInContext(
    [declaration('isLocalRoot'), declaration('rememberGateway'), declaration('forgetGateway'), declaration('gatewayCandidates')].join('\n'),
    context,
    { filename: 'background-extract.js' }
  );
  return context;
}

test('with nothing remembered, the walk is local first then live, as before', async () => {
  const ctx = harness();
  assert.deepEqual([...await ctx.gatewayCandidates()], [
    'http://localhost:3000', 'http://localhost:8787', 'https://assistant.msschermer.us'
  ]);
});

test('a remembered gateway is tried first, so the dead local probes stop running', async () => {
  const ctx = harness();
  await ctx.rememberGateway('https://assistant.msschermer.us');
  const order = [...await ctx.gatewayCandidates()];
  assert.equal(order[0], 'https://assistant.msschermer.us',
    'the root that answered last time has to lead, or every request pays the local walk again');
  assert.equal(order.length, 3, 'the others stay available as a fallback');
});

test('the preference survives a service-worker restart through session storage', async () => {
  const first = harness();
  await first.rememberGateway('http://localhost:8787');
  assert.equal(first.sessionStore.qaPreferredGateway, 'http://localhost:8787');

  // A new worker starts with no in-memory value and must recover it.
  const revived = harness({ session: { qaPreferredGateway: 'http://localhost:8787' } });
  assert.equal(revived.preferredGateway, null);
  assert.equal((await revived.gatewayCandidates())[0], 'http://localhost:8787');
});

test('a remembered gateway that stops answering is forgotten, not pinned', async () => {
  // A developer stopping their local gateway must not be stuck behind it.
  const ctx = harness();
  await ctx.rememberGateway('http://localhost:3000');
  await ctx.forgetGateway('http://localhost:3000');
  assert.equal(ctx.sessionStore.qaPreferredGateway, undefined);
  assert.deepEqual([...await ctx.gatewayCandidates()], [
    'http://localhost:3000', 'http://localhost:8787', 'https://assistant.msschermer.us'
  ]);
});

test('forgetting a root that is not the remembered one leaves the preference alone', async () => {
  const ctx = harness();
  await ctx.rememberGateway('https://assistant.msschermer.us');
  await ctx.forgetGateway('http://localhost:3000');
  assert.equal((await ctx.gatewayCandidates())[0], 'https://assistant.msschermer.us');
});

test('an explicit apiBase still wins outright and is the only candidate', async () => {
  const ctx = harness({ stored: { apiBase: 'https://gateway.example.com/' } });
  await ctx.rememberGateway('https://assistant.msschermer.us');
  assert.deepEqual([...await ctx.gatewayCandidates()], ['https://gateway.example.com']);
});

test('only loopback roots are treated as local, so the live gateway keeps the full budget', () => {
  const ctx = harness();
  assert.equal(ctx.isLocalRoot('http://localhost:3000'), true);
  assert.equal(ctx.isLocalRoot('http://127.0.0.1:8787'), true);
  assert.equal(ctx.isLocalRoot('https://assistant.msschermer.us'), false);
  // A hostname that merely starts with the word must not be shortened.
  assert.equal(ctx.isLocalRoot('https://localhost.example.com'), false);
});

test('the short probe budget is only applied to an unproven local root', () => {
  // The rule lives in gatewayRequest: a root already known to work keeps the
  // caller's timeout, so a local gateway busy with a large audit is never
  // abandoned mid-request.
  const request = declaration('gatewayRequest');
  assert.match(request, /isLocalRoot\(root\)&&preferredGateway!==root/);
  assert.match(request, /Math\.min\(timeoutMs,UNPROVEN_LOCAL_TIMEOUT_MS\)/);
  assert.match(request, /await rememberGateway\(root\)/);
  assert.match(request, /await forgetGateway\(root\)/);
});
