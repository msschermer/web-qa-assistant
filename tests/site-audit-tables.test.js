import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const content = fs.readFileSync('apps/extension/content.js', 'utf8');

/** content.js is one content-script IIFE with no exports, so lift the pure
 * helper out of the source and run the real thing rather than a copy of it. */
function loadShortUrl(siteOrigin) {
  const m = content.match(/ {2}function shortUrl\(url\) \{[\s\S]*?\r?\n {2}\}/);
  assert.ok(m, 'shortUrl should exist in content.js');
  return new Function('siteAudit', `${m[0]}\nreturn shortUrl;`)({ siteOrigin });
}

test('same-site URLs collapse to a path so a table column carries the difference, not the origin', () => {
  const shortUrl = loadShortUrl('https://example.com');
  assert.equal(shortUrl('https://example.com/burglary-vs-robbery/'), '/burglary-vs-robbery/');
  assert.equal(shortUrl('https://example.com/'), '/');
  assert.equal(shortUrl('https://example.com'), '/');
  assert.equal(shortUrl('https://example.com/?page_id=13313'), '/?page_id=13313');
});

test('external URLs keep their host, because there the host is the information', () => {
  const shortUrl = loadShortUrl('https://example.com');
  assert.equal(shortUrl('https://example.org/directory/x'), 'example.org/directory/x');
  assert.equal(shortUrl('https://example.org/'), 'example.org');
  // A different scheme or port is a different origin and must not be shortened
  // as if it were the same site.
  assert.equal(shortUrl('http://example.com/a'), 'example.com/a');
});

test('shortening never throws and never invents a value it cannot parse', () => {
  const shortUrl = loadShortUrl('https://example.com');
  assert.equal(shortUrl('not a url'), 'not a url');
  assert.equal(shortUrl(''), '');
  // Before an audit has an origin, every URL is simply shown in full host form.
  assert.equal(loadShortUrl('')('https://example.com/a'), 'example.com/a');
});

test('every results table shortens its URLs and keeps the full URL reachable', () => {
  for (const call of ['shortUrl(u.url)', 'shortUrl(l.target_url)', 'shortUrl(f.url)']) {
    assert.ok(content.includes(call), `${call} should shorten its cell`);
  }
  // Shortening is only safe if the whole URL is still available on the row.
  for (const title of ['tr.cells[0].title = u.url', 'tr.cells[1].title = l.target_url', 'a.title = f.url']) {
    assert.ok(content.includes(title), `${title} should preserve the full URL`);
  }
});

test('the Pages section index only renders when it actually groups pages', () => {
  // A flat site gives every URL its own section, so a plain `counts.size < 2`
  // guard let the index render one chip per page and push the table off screen.
  // An index that maps 1:1 onto the rows beneath it is not navigation.
  assert.match(
    content,
    /const useful = counts\.size >= 2 && counts\.size <= 12 && grouped >= 1 && counts\.size < pageCount;/,
    'the section index needs a usefulness guard, not just a minimum section count'
  );
  assert.match(content, /if \(!useful\) \{ nav\.hidden = true;/);
});

test('link status filters are offered only when they would return rows', () => {
  assert.match(
    content,
    /if \(value && !count\) continue;/,
    'a status chip with no links behind it is a dead end'
  );
});
