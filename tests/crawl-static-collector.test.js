import test from 'node:test';
import assert from 'node:assert/strict';
import { collectStaticPage } from '../packages/crawl/static-collector.js';

function htmlResponse(html, { status = 200, headers = {} } = {}) {
  return new Response(html, { status, headers: { 'content-type': 'text/html', ...headers } });
}
function fakeFetch(responder) {
  return async (url) => responder(String(url));
}

test('headingLevels is scoped to a <main>/<article>/[role=main] landmark, excluding nav/sidebar/footer headings that would falsely look like a skipped level', async () => {
  // Reproduced live against a real WordPress site: scanning the whole
  // document (nav H2 -> sidebar widget H4 -> footer H3, none of it a real
  // content hierarchy) produced a "heading skip" on 100% of pages. Headings
  // outside the main content landmark must not count at all.
  const html = `<!doctype html><html><body>
    <nav><h2>nav heading</h2></nav>
    <main><h1>main heading</h1><h2>section</h2></main>
    <aside><h4>sidebar heading</h4></aside>
    <footer><h3>footer heading</h3></footer>
    </body></html>`;
  const fetchImpl = fakeFetch(() => htmlResponse(html));
  const result = await collectStaticPage('https://example.com/page', { fetchImpl });
  assert.deepEqual(result.headingLevels, [1, 2], 'only headings inside <main> should count — the nav H2, aside H4, and footer H3 must be excluded');
});

test('headingLevels is empty when the page declares no main-content landmark, rather than guessing at document structure from the whole page', async () => {
  const html = `<!doctype html><html><body><h1>Title</h1><h3>Skips to H3</h3></body></html>`;
  const fetchImpl = fakeFetch(() => htmlResponse(html));
  const result = await collectStaticPage('https://example.com/page', { fetchImpl });
  assert.deepEqual(result.headingLevels, [], 'with no <main>/<article>/[role=main] to scope to, the heading-order check should have nothing to work from rather than a whole-document guess');
});

test('security response headers are captured as booleans the scanner can check, independent of the markup', async () => {
  const fetchImpl = fakeFetch(() => htmlResponse('<title>x</title>', { headers: {
    'strict-transport-security': 'max-age=31536000', 'x-content-type-options': 'nosniff',
    'x-frame-options': 'DENY', 'referrer-policy': 'strict-origin-when-cross-origin'
  } }));
  const result = await collectStaticPage('https://example.com/', { fetchImpl });
  assert.equal(result.hasHsts, true);
  assert.equal(result.hasXContentTypeOptions, true);
  assert.equal(result.hasXFrameOptions, true);
  assert.equal(result.hasReferrerPolicy, true);

  const bare = await collectStaticPage('https://example.com/', { fetchImpl: fakeFetch(() => htmlResponse('<title>x</title>')) });
  assert.equal(bare.hasHsts, false);
  assert.equal(bare.hasXContentTypeOptions, false);
  assert.equal(bare.hasXFrameOptions, false);
  assert.equal(bare.hasReferrerPolicy, false);
});

test('a CSP frame-ancestors directive is recognized as clickjacking protection separately from X-Frame-Options', async () => {
  const fetchImpl = fakeFetch(() => htmlResponse('<title>x</title>', { headers: { 'content-security-policy': "frame-ancestors 'self'" } }));
  const result = await collectStaticPage('https://example.com/', { fetchImpl });
  assert.equal(result.hasFrameAncestorsCsp, true);
});

test('doctype presence and meta-refresh are detected from the raw markup', async () => {
  const withDoctype = await collectStaticPage('https://example.com/', { fetchImpl: fakeFetch(() => htmlResponse('<!doctype html><title>x</title>')) });
  assert.equal(withDoctype.hasDoctype, true);
  const withoutDoctype = await collectStaticPage('https://example.com/', { fetchImpl: fakeFetch(() => htmlResponse('<title>x</title>')) });
  assert.equal(withoutDoctype.hasDoctype, false);

  const refreshed = await collectStaticPage('https://example.com/', { fetchImpl: fakeFetch(() => htmlResponse('<meta http-equiv="refresh" content="5;url=/new">')) });
  assert.equal(refreshed.hasMetaRefresh, true);
  const noRefresh = await collectStaticPage('https://example.com/', { fetchImpl: fakeFetch(() => htmlResponse('<title>x</title>')) });
  assert.equal(noRefresh.hasMetaRefresh, false);
});

test('in-page fragment links are collected alongside every id/name they could resolve against, skipping bare "#" and "#top"', async () => {
  const html = `<a href="#real">Jump</a><a href="#missing">Broken</a><a href="#">No-op</a><a href="#top">Back to top</a>
    <div id="real">Target</div><a name="legacy-anchor">Old style</a>`;
  const fetchImpl = fakeFetch(() => htmlResponse(html));
  const result = await collectStaticPage('https://example.com/', { fetchImpl });
  assert.deepEqual(result.fragmentLinks.map((f) => f.id).sort(), ['missing', 'real']);
  assert.ok(result.elementIds.includes('real'));
  assert.ok(result.elementIds.includes('legacy-anchor'), 'an a[name] target must count as a valid fragment destination too');
});

test('form controls are checked for an accessible name via label[for], wrapping <label>, aria-label, or aria-labelledby, and hidden/submit/button controls are excluded', async () => {
  const html = `
    <label for="email">Email</label><input id="email" type="text">
    <input type="text" id="phone">
    <label><input type="checkbox" id="agree"> I agree</label>
    <input type="text" aria-label="Search">
    <input type="hidden" name="csrf" value="x">
    <button type="submit">Send</button>`;
  const fetchImpl = fakeFetch(() => htmlResponse(html));
  const result = await collectStaticPage('https://example.com/', { fetchImpl });
  assert.equal(result.formControlsTotal, 4, 'hidden input and submit button must not count as form controls needing a label');
  assert.equal(result.formControlsMissingLabel, 1, 'only the #phone input has no label, aria-label, aria-labelledby, or wrapping <label>');
});

test('extracts title, description, canonical, robots, h1s, and resolved absolute links', async () => {
  const html = `<!doctype html><html><head>
    <title>My Page</title>
    <meta name="description" content="A description">
    <link rel="canonical" href="/canonical-path">
    <meta name="robots" content="noindex,follow">
    </head><body>
    <h1>Main heading</h1>
    <a href="/relative">Relative</a>
    <a href="https://example.com/absolute">Absolute</a>
    <a href="mailto:test@example.com">Mail</a>
    <a href="javascript:void(0)">JS</a>
    <a href="#section">Fragment only</a>
    </body></html>`;
  const fetchImpl = fakeFetch(() => htmlResponse(html));
  const result = await collectStaticPage('https://example.com/page', { fetchImpl });
  assert.equal(result.ok, true);
  assert.equal(result.isHtml, true);
  assert.equal(result.title, 'My Page');
  assert.equal(result.description, 'A description');
  assert.equal(result.canonical, 'https://example.com/canonical-path');
  assert.equal(result.robots, 'noindex,follow');
  assert.deepEqual(result.h1s, ['Main heading']);
  assert.deepEqual(result.links.map((l) => l.url).sort(), ['https://example.com/absolute', 'https://example.com/relative'].sort());
});

test('follows a bounded redirect chain and reports the final URL', async () => {
  const fetchImpl = fakeFetch((url) => {
    if (url === 'https://example.com/old') return new Response(null, { status: 301, headers: { location: '/new' } });
    if (url === 'https://example.com/new') return htmlResponse('<title>New</title>');
    return new Response(null, { status: 404 });
  });
  const result = await collectStaticPage('https://example.com/old', { fetchImpl });
  assert.equal(result.ok, true);
  assert.equal(result.finalUrl, 'https://example.com/new');
  assert.equal(result.redirected, true);
  assert.equal(result.title, 'New');
});

test('a redirect loop fails closed instead of hanging', async () => {
  const fetchImpl = fakeFetch((url) => new Response(null, { status: 302, headers: { location: url === 'https://example.com/a' ? '/b' : '/a' } }));
  const result = await collectStaticPage('https://example.com/a', { fetchImpl });
  assert.equal(result.ok, false);
  assert.equal(result.error, 'redirect-loop');
});

test('a non-HTML response is reported as a terminal result, not an error', async () => {
  const fetchImpl = fakeFetch(() => new Response('binary', { status: 200, headers: { 'content-type': 'application/pdf' } }));
  const result = await collectStaticPage('https://example.com/file.pdf', { fetchImpl });
  assert.equal(result.ok, true);
  assert.equal(result.isHtml, false);
  assert.equal(result.httpStatus, 200);
});

test('a 404 response is reported as a terminal result carrying its real status', async () => {
  const fetchImpl = fakeFetch(() => new Response('not found', { status: 404, headers: { 'content-type': 'text/html' } }));
  const result = await collectStaticPage('https://example.com/missing', { fetchImpl });
  assert.equal(result.ok, true);
  assert.equal(result.isHtml, false);
  assert.equal(result.httpStatus, 404);
});

test('private/loopback hosts are refused before any fetch happens', async () => {
  let called = false;
  const fetchImpl = async () => { called = true; return htmlResponse('<title>x</title>'); };
  const result = await collectStaticPage('http://127.0.0.1/admin', { fetchImpl });
  assert.equal(result.ok, false);
  assert.equal(result.error, 'destination-not-allowed');
  assert.equal(called, false);
});

test('a network failure is reported without throwing', async () => {
  const fetchImpl = async () => { throw new Error('getaddrinfo ENOTFOUND'); };
  const result = await collectStaticPage('https://example.com/', { fetchImpl });
  assert.equal(result.ok, false);
  assert.match(result.error, /ENOTFOUND/);
});

test('duplicate links to the same target (fragment aside) are only reported once', async () => {
  const html = `<a href="/same">One</a><a href="/same#top">Two</a><a href="/same">Three</a>`;
  const fetchImpl = fakeFetch(() => htmlResponse(html));
  const result = await collectStaticPage('https://example.com/', { fetchImpl });
  assert.equal(result.links.length, 1);
});

test('valid JSON-LD structured data is parsed for its @type, deduped, and counted', async () => {
  const html = `
    <script type="application/ld+json">{"@context":"https://schema.org","@type":"Organization","name":"Acme"}</script>
    <script type="application/ld+json">{"@context":"https://schema.org","@type":["WebPage","Organization"]}</script>
  `;
  const fetchImpl = fakeFetch(() => htmlResponse(html));
  const result = await collectStaticPage('https://example.com/', { fetchImpl });
  assert.equal(result.schemaBlockCount, 2);
  assert.equal(result.schemaInvalidCount, 0);
  assert.deepEqual(result.schemaTypes.sort(), ['Organization', 'WebPage']);
});

test('a malformed JSON-LD block is counted as invalid rather than silently ignored', async () => {
  const html = `<script type="application/ld+json">{not valid json</script>`;
  const fetchImpl = fakeFetch(() => htmlResponse(html));
  const result = await collectStaticPage('https://example.com/', { fetchImpl });
  assert.equal(result.schemaBlockCount, 1);
  assert.equal(result.schemaInvalidCount, 1);
  assert.deepEqual(result.schemaTypes, []);
});

test('a page with no structured data reports zero blocks, not an error', async () => {
  const fetchImpl = fakeFetch(() => htmlResponse('<title>No schema here</title>'));
  const result = await collectStaticPage('https://example.com/', { fetchImpl });
  assert.equal(result.schemaBlockCount, 0);
  assert.equal(result.schemaInvalidCount, 0);
  assert.deepEqual(result.schemaTypes, []);
});

test('multiple titles, descriptions, and canonicals are all counted, not just the first', async () => {
  const html = `<title>One</title><title>Two</title>
    <meta name="description" content="A"><meta name="description" content="B">
    <link rel="canonical" href="/a"><link rel="canonical" href="/b">`;
  const fetchImpl = fakeFetch(() => htmlResponse(html));
  const result = await collectStaticPage('https://example.com/', { fetchImpl });
  assert.equal(result.titleCount, 2);
  assert.equal(result.descriptionCount, 2);
  assert.equal(result.canonicalCount, 2);
});
