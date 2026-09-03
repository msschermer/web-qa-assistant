import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { parseRobotsTxt, isDisallowed, fetchRobotsRules, fetchSitemapUrls } from '../packages/crawl/robots.js';

function listen(handler) {
  const server = http.createServer(handler);
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      resolve({ server, origin: `http://127.0.0.1:${port}` });
    });
  });
}

test('parseRobotsTxt reads Disallow rules only for the wildcard user-agent, and collects Sitemap lines regardless of section', () => {
  const text = `
    User-agent: Googlebot
    Disallow: /googlebot-only/

    User-agent: *
    Disallow: /admin/
    Disallow: /cart

    Sitemap: https://example.com/sitemap.xml
  `;
  const parsed = parseRobotsTxt(text);
  assert.deepEqual(parsed.disallow, ['/admin/', '/cart']);
  assert.deepEqual(parsed.sitemaps, ['https://example.com/sitemap.xml']);
});

test('isDisallowed matches by path prefix, and a bare "/" blocks everything', () => {
  assert.equal(isDisallowed('/admin/users', ['/admin/']), true);
  assert.equal(isDisallowed('/about', ['/admin/']), false);
  assert.equal(isDisallowed('/anything', ['/']), true);
  assert.equal(isDisallowed('/about', []), false);
});

test('fetchRobotsRules tolerates a missing robots.txt instead of failing the crawl', async () => {
  const { server, origin } = await listen((req, res) => res.writeHead(404).end());
  try {
    const rules = await fetchRobotsRules(origin);
    assert.deepEqual(rules, { disallow: [], sitemaps: [] });
  } finally { server.close(); }
});

test('fetchSitemapUrls extracts <loc> entries from a plain urlset', async () => {
  const body = `<?xml version="1.0"?><urlset><url><loc>https://example.com/a</loc></url><url><loc>https://example.com/b</loc></url></urlset>`;
  const { server, origin } = await listen((req, res) => res.writeHead(200, { 'content-type': 'application/xml' }).end(body));
  try {
    const urls = await fetchSitemapUrls(`${origin}/sitemap.xml`);
    assert.deepEqual(urls, ['https://example.com/a', 'https://example.com/b']);
  } finally { server.close(); }
});

test('fetchSitemapUrls follows a sitemap index into its child sitemaps', async () => {
  const { server, origin } = await listen((req, res) => {
    if (req.url === '/sitemap.xml') {
      return void res.writeHead(200).end(`<sitemapindex><sitemap><loc>${origin}/sitemap-posts.xml</loc></sitemap></sitemapindex>`);
    }
    if (req.url === '/sitemap-posts.xml') {
      return void res.writeHead(200).end(`<urlset><url><loc>${origin}/post-1</loc></url></urlset>`);
    }
    res.writeHead(404).end();
  });
  try {
    const urls = await fetchSitemapUrls(`${origin}/sitemap.xml`);
    assert.deepEqual(urls, [`${origin}/post-1`]);
  } finally { server.close(); }
});

test('fetchSitemapUrls fails closed (empty list) on network errors rather than throwing', async () => {
  const urls = await fetchSitemapUrls('https://this-host-does-not-resolve.invalid/sitemap.xml');
  assert.deepEqual(urls, []);
});
