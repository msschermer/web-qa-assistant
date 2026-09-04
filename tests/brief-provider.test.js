import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeBaseUrl, validateByoEndpoint, byoOriginPattern,
  buildByoRequest, extractByoText, describeBriefProviders, BRIEF_PROVIDERS
} from '../packages/ai/brief-provider.js';

test('a base URL survives the two mistakes people actually make', () => {
  assert.equal(normalizeBaseUrl('https://api.openai.com/v1/'), 'https://api.openai.com/v1');
  assert.equal(normalizeBaseUrl('https://api.openai.com/v1/chat/completions'), 'https://api.openai.com/v1');
  assert.equal(normalizeBaseUrl('  https://api.openai.com/v1  '), 'https://api.openai.com/v1');
  assert.equal(normalizeBaseUrl(''), '');
});

test('a key is never sent over plain http to a remote host', () => {
  // A tool that reports mixed content on client sites does not get to make an
  // exception for its own traffic.
  const insecure = validateByoEndpoint('http://ai.example.com/v1');
  assert.equal(insecure.ok, false);
  assert.equal(insecure.code, 'BYO_AI_INSECURE');

  // Loopback is the exception, because there is no network to intercept.
  for (const local of ['http://localhost:11434/v1', 'http://127.0.0.1:1234/v1']) {
    assert.equal(validateByoEndpoint(local).ok, true, local + ' should be allowed');
  }
  assert.equal(validateByoEndpoint('https://ai.example.com/v1').ok, true);
});

test('a malformed or non-http endpoint is refused with a reason', () => {
  assert.equal(validateByoEndpoint('').code, 'BYO_AI_NO_ENDPOINT');
  assert.equal(validateByoEndpoint('not a url').code, 'BYO_AI_BAD_URL');
  assert.equal(validateByoEndpoint('ftp://files.example.com').code, 'BYO_AI_BAD_SCHEME');
  assert.equal(validateByoEndpoint('javascript:alert(1)').ok, false);
});

test('the origin pattern is what an optional host permission is requested for', () => {
  assert.equal(byoOriginPattern('https://ai.example.com/v1/'), 'https://ai.example.com/*');
  assert.equal(byoOriginPattern('http://localhost:11434/v1'), 'http://localhost:11434/*');
  assert.equal(byoOriginPattern('nonsense'), '');
});

test('the request is OpenAI-compatible and bounded', () => {
  const { url, init } = buildByoRequest({
    baseUrl: 'https://ai.example.com/v1/',
    apiKey: 'sk-test',
    model: 'my-model',
    system: 'rules here',
    user: 'evidence here'
  });
  assert.equal(url, 'https://ai.example.com/v1/chat/completions');
  assert.equal(init.headers.authorization, 'Bearer sk-test');
  const body = JSON.parse(init.body);
  assert.equal(body.model, 'my-model');
  assert.equal(body.response_format.type, 'json_object');
  // A rewriting task with a fixed skeleton does not want an imaginative answer.
  assert.ok(body.temperature <= 0.3, 'temperature should stay low');
  assert.ok(body.max_tokens <= 1200, 'the reply is a few sentences, not an essay');
  assert.deepEqual(body.messages.map((m) => m.role), ['system', 'user']);
});

test('a keyless endpoint sends no authorization header', () => {
  // Local runtimes such as Ollama take no key, and sending an empty bearer
  // token makes some of them refuse the request outright.
  const { init } = buildByoRequest({ baseUrl: 'http://localhost:11434/v1', model: 'llama', system: 's', user: 'u' });
  assert.equal('authorization' in init.headers, false);
});

test('a bad endpoint throws before any request is shaped', () => {
  assert.throws(() => buildByoRequest({ baseUrl: 'http://ai.example.com/v1', model: 'm', system: 's', user: 'u' }));
});

test('the reply text is read without over-assuming the response shape', () => {
  assert.equal(extractByoText({ choices: [{ message: { content: '{"ok":1}' } }] }), '{"ok":1}');
  assert.equal(extractByoText({ choices: [{ text: 'legacy' }] }), 'legacy');
  assert.equal(extractByoText({ choices: [{ message: { content: [{ text: 'a' }, { text: 'b' }] } }] }), 'ab');
  assert.equal(extractByoText({}), '');
  assert.equal(extractByoText(null), '');
});

test('a provider is only offered when it could actually answer', () => {
  const none = describeBriefProviders({}, { localAvailable: false });
  assert.equal(none['on-device'].ready, false);
  assert.equal(none.byo.ready, false);
  assert.equal(none.gateway.ready, false);
  assert.match(none.byo.note, /No endpoint/);

  const configured = describeBriefProviders(
    { byoAiBaseUrl: 'https://ai.example.com/v1', byoAiModel: 'my-model', cloudAiFallback: true },
    { localAvailable: true }
  );
  assert.equal(configured['on-device'].ready, true);
  assert.equal(configured.byo.ready, true);
  assert.equal(configured.gateway.ready, true);
  // The operator is told where their evidence would go before they pick it.
  assert.match(configured.byo.note, /ai\.example\.com/);

  const noModel = describeBriefProviders({ byoAiBaseUrl: 'https://ai.example.com/v1' }, {});
  assert.equal(noModel.byo.ready, false, 'an endpoint without a model cannot answer');
  assert.match(noModel.byo.note, /model/i);
});

test('off is a first-class choice', () => {
  assert.ok(BRIEF_PROVIDERS.includes('off'), 'an operator can decline model wording entirely');
  assert.deepEqual(BRIEF_PROVIDERS, ['off', 'on-device', 'byo', 'gateway']);
});

// --- the promise made in the settings panel must be true of the payload -----

test('what the settings panel promises is what actually leaves the browser', async () => {
  const fs = await import('node:fs');
  const { briefEnvelope } = await import('../packages/findings/brief-envelope.js');

  const panel = fs.readFileSync('apps/extension/sidepanel.html', 'utf8');
  assert.match(panel, /Never a URL, a page title, page markup or the site's name/,
    'the panel should state what is withheld');
  assert.match(panel, /does not pass through Lumen's servers/,
    'the panel should state where the request goes');

  // Now hold the payload to it, using evidence that carries every kind of
  // client content the audit collects.
  const envelope = briefEnvelope({
    summary: 'Start with the destinations that fail for a visitor.',
    totalInstances: 12,
    groups: [{
      area: 'availability',
      title: 'Repair confirmed broken destinations',
      severity: 'high', pages: 2, leadPages: 2, instances: 2, rules: [{}],
      lead: {
        rule_id: 'navigation.link-404-external',
        confidence: 'confirmed',
        // None of the following may survive into the envelope.
        url: 'https://example.com/private/pricing-deck',
        title: 'Client Portal — Confidential Pricing',
        detail: 'The link "Board deck" points to https://example.com/board',
        evidence: '<a href="/board">Board deck</a>',
        selector: '#nav > a.board-link'
      }
    }]
  }, { fetched: 2, queued: 3 });

  const wire = JSON.stringify(envelope);
  for (const secret of ['example.com', 'pricing-deck', 'Confidential', 'Board deck', 'board-link', '<a href', 'https://', 'http://']) {
    assert.ok(!wire.includes(secret), `"${secret}" must not reach a model`);
  }
  // And what does survive is enough to write a sentence from.
  assert.equal(envelope.areas[0].leadRule, 'navigation.link-404-external');
  assert.equal(envelope.areas[0].severity, 'high');
  assert.equal(envelope.areas[0].confidence, 'confirmed');
  assert.equal(envelope.scope.fetched, 2);
});

test('the background never forwards anything the overlay did not sanitise', async () => {
  const fs = await import('node:fs');
  const background = fs.readFileSync('apps/extension/background.js', 'utf8');
  const handler = background.slice(background.indexOf('async function briefAiPhrase('));
  const body = handler.slice(0, handler.indexOf('\nasync function ', 10));
  // The handler is a courier: it forwards the system and user strings it was
  // handed and reads nothing out of the scan itself.
  assert.match(body, /msg\?\.system/, 'it forwards the prompt it was given');
  assert.match(body, /msg\?\.user/, 'it forwards the evidence it was given');
  for (const name of ['report.findings', 'auditStore', 'page.url']) {
    assert.ok(!body.includes(name), `the handler must not read ${name}`);
  }
});
