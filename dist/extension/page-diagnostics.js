(() => {
  if (globalThis.__WEBQA_PAGE_DIAG_BOUND__) return;
  globalThis.__WEBQA_PAGE_DIAG_BOUND__ = true;
  const bucket = globalThis.__WEBQA_PAGE_DIAGNOSTICS__ || (globalThis.__WEBQA_PAGE_DIAGNOSTICS__ = { errors: [], startedAt: Date.now() });
  const clip = (value, max = 240) => {
    const s = String(value ?? '').replace(/\s+/g, ' ').trim();
    return s.length > max ? s.slice(0, max - 1) + '…' : s;
  };
  const isExtensionNoise = source => /^(chrome-extension:|moz-extension:|safari-extension:)/i.test(String(source || ''));
  const remember = (kind, payload) => {
    if (bucket.errors.length >= 25) return;
    const source = String(payload.source || '');
    if (isExtensionNoise(source)) return;
    bucket.errors.push({
      kind,
      message: clip(payload.message),
      source: clip(source.split(/[?#]/)[0], 220),
      line: Number(payload.line) || 0
    });
  };
  addEventListener('error', event => {
    remember('page_error', { message: event.message || '', source: event.filename || '', line: event.lineno || 0 });
  }, true);
  addEventListener('unhandledrejection', event => {
    const reason = event.reason;
    const message = reason && typeof reason === 'object' ? (reason.message || String(reason)) : String(reason || 'unhandledrejection');
    remember('unhandled_rejection', { message, source: '', line: 0 });
  }, true);
})();
