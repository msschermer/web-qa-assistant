/**
 * Where the Lumen brief's wording can come from.
 *
 * Three tiers, one contract. Whichever answers, the response passes through
 * exactly the same gate — packages/findings/brief-phrasing.js — and lands in
 * exactly the same place: the prose fields of a brief whose ranking, counts,
 * severity and confidence were already decided. A provider is a source of
 * sentences, never a source of conclusions.
 *
 *   on-device  Chrome's built-in model. Default, private, free, and absent on
 *              most machines. Handled in the overlay itself; it needs no
 *              network and so needs nothing here.
 *   byo        The operator's own OpenAI-compatible endpoint. Their key, their
 *              model, their egress. This exists because the people who audit
 *              client sites are often the people least able to send client
 *              data to a vendor they did not choose.
 *   gateway    Lumen's managed cloud path, already gated behind a server flag
 *              and a per-user toggle.
 *
 * "OpenAI-compatible" is the pragmatic choice rather than a preference: the
 * same request shape reaches OpenAI, Azure OpenAI, OpenRouter, Together,
 * vLLM, Ollama and LM Studio. One shape, most of the field.
 *
 * Nothing here decides *what* is sent. The envelope is built and sanitised by
 * packages/findings/brief-envelope.js before any of this is reached, and it
 * carries no URL, host, page title or markup by construction.
 */

export const BRIEF_PROVIDERS = ['off', 'on-device', 'byo', 'gateway'];

/** Trailing slashes and a pasted `/chat/completions` are the two things people
 * actually get wrong when copying a base URL out of a dashboard. */
export function normalizeBaseUrl(value) {
  const raw = String(value || '').trim().replace(/\/+$/, '');
  if (!raw) return '';
  return raw.replace(/\/chat\/completions$/, '').replace(/\/+$/, '');
}

/**
 * Is this endpoint one we are willing to send an envelope to?
 *
 * https is required for anything that is not loopback. A key travelling in
 * clear text to a third-party host is not a trade-off a QA tool should make on
 * an operator's behalf, and a tool that audits sites for mixed content has no
 * business being the exception.
 */
export function validateByoEndpoint(baseUrl) {
  const normalized = normalizeBaseUrl(baseUrl);
  if (!normalized) return { ok: false, code: 'BYO_AI_NO_ENDPOINT', message: 'No endpoint is configured.' };
  let url;
  try { url = new URL(normalized); }
  catch { return { ok: false, code: 'BYO_AI_BAD_URL', message: 'That endpoint is not a valid URL.' }; }
  if (!/^https?:$/.test(url.protocol)) {
    return { ok: false, code: 'BYO_AI_BAD_SCHEME', message: 'The endpoint must be an http or https URL.' };
  }
  const loopback = /^(localhost|127\.0\.0\.1|\[::1\])$/i.test(url.hostname);
  if (url.protocol === 'http:' && !loopback) {
    return { ok: false, code: 'BYO_AI_INSECURE', message: 'Use https, or a local endpoint. A key sent over http is a key in clear text.' };
  }
  return { ok: true, code: '', message: '', origin: url.origin, normalized };
}

/** The origin an optional host permission must be granted for. */
export function byoOriginPattern(baseUrl) {
  const check = validateByoEndpoint(baseUrl);
  return check.ok ? `${check.origin}/*` : '';
}

/**
 * The request an OpenAI-compatible endpoint expects.
 *
 * `temperature` is low and `max_tokens` bounded because this is a rewriting
 * task with a fixed skeleton, not open generation: a long, imaginative answer
 * is a failing answer here and would only be rejected downstream.
 */
export function buildByoRequest({ baseUrl, apiKey, model, system, user }) {
  const check = validateByoEndpoint(baseUrl);
  if (!check.ok) throw new Error(check.message);
  return {
    url: `${check.normalized}/chat/completions`,
    init: {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {})
      },
      body: JSON.stringify({
        model: String(model || '').trim() || 'gpt-4o-mini',
        temperature: 0.2,
        max_tokens: 900,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: String(system || '') },
          { role: 'user', content: String(user || '') }
        ]
      })
    }
  };
}

/** Pull the text out of an OpenAI-compatible response without assuming more
 * of the shape than every implementation actually agrees on. */
export function extractByoText(payload) {
  const choice = payload?.choices?.[0];
  const content = choice?.message?.content ?? choice?.text ?? '';
  if (typeof content === 'string') return content;
  // Some providers return content as an array of parts.
  if (Array.isArray(content)) {
    return content.map((part) => (typeof part === 'string' ? part : part?.text || '')).join('');
  }
  return '';
}

/**
 * The endpoints people actually have.
 *
 * Two of these are local runtimes that need no key and no account, which is
 * the fastest honest answer to "I want this to work today". They are offered
 * as presets rather than documentation because the failure this replaces was
 * an empty text field next to a feature that never ran.
 */
export const BYO_PRESETS = [
  { id: 'ollama', label: 'Ollama (this machine)', baseUrl: 'http://localhost:11434/v1', model: 'llama3.2', needsKey: false,
    note: 'Runs locally. Install Ollama, then: ollama pull llama3.2' },
  { id: 'lmstudio', label: 'LM Studio (this machine)', baseUrl: 'http://localhost:1234/v1', model: '', needsKey: false,
    note: 'Runs locally. Start the LM Studio server and load a model.' },
  { id: 'openai', label: 'OpenAI', baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o-mini', needsKey: true,
    note: 'Sends the audit summary to OpenAI under your own key.' },
  { id: 'openrouter', label: 'OpenRouter', baseUrl: 'https://openrouter.ai/api/v1', model: 'openai/gpt-4o-mini', needsKey: true,
    note: 'Sends the audit summary to OpenRouter under your own key.' }
];

/** A provider is only offered when it could actually answer. An option that
 * cannot work is worse than no option: it turns a settings screen into a
 * guessing game. */
export function describeBriefProviders(settings = {}, { localAvailable = false } = {}) {
  // Kept as one table so the picker, the resolver and the status line cannot
  // disagree about which providers could answer right now.
  const byo = validateByoEndpoint(settings.byoAiBaseUrl);
  return {
    'on-device': {
      id: 'on-device',
      label: 'On-device (Chrome built-in)',
      ready: Boolean(localAvailable),
      note: localAvailable
        ? 'Runs on this machine. Nothing leaves the browser.'
        : 'Not available on this device or browser.'
    },
    byo: {
      id: 'byo',
      label: 'Your own endpoint',
      ready: byo.ok && Boolean(String(settings.byoAiModel || '').trim()),
      note: byo.ok
        ? (String(settings.byoAiModel || '').trim() ? `Sends the audit summary to ${byo.origin}.` : 'Set a model name.')
        : byo.message
    },
    gateway: {
      id: 'gateway',
      label: 'Lumen managed cloud',
      ready: Boolean(settings.cloudAiFallback),
      note: settings.cloudAiFallback
        ? 'Uses the assistant gateway, which is metered.'
        : 'Off. Enable cloud AI fallback to use this.'
    }
  };
}

/**
 * Which provider will actually be asked.
 *
 * The old behaviour was a fixed preference for Chrome's built-in model, which
 * on most machines reports "unavailable" and cannot be made to report anything
 * else. Preferring a provider that cannot answer, and only then falling back,
 * is how a feature comes to look broken while every part of it works.
 *
 * So readiness decides. An explicit choice is honoured when it can answer; when
 * it cannot, the next ready provider takes it and the caller is told which and
 * why, so the interface can say so instead of failing silently.
 */
const PROVIDER_FALLBACK_ORDER = ['byo', 'on-device', 'gateway'];

export function resolveBriefProvider(settings = {}, { localAvailable = false } = {}) {
  const chosen = String(settings.briefAiProvider || 'byo');
  if (chosen === 'off') return { id: 'off', ready: false, substituted: false, reason: 'Wording by a model is turned off.' };
  const providers = describeBriefProviders(settings, { localAvailable });
  if (providers[chosen]?.ready) {
    return { id: chosen, ready: true, substituted: false, reason: providers[chosen].note, providers };
  }
  const next = PROVIDER_FALLBACK_ORDER.find((id) => id !== chosen && providers[id]?.ready);
  if (next) {
    return {
      id: next, ready: true, substituted: true, providers,
      reason: `${providers[chosen]?.label || chosen} cannot answer here, so ${providers[next].label} is being used.`
    };
  }
  return {
    id: 'none', ready: false, substituted: false, providers,
    reason: providers[chosen]?.note || 'No model is configured.'
  };
}
