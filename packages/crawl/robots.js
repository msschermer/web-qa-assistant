/**
 * Minimal robots.txt + sitemap.xml discovery for the site crawler.
 * Deliberately simple: exact/prefix Disallow matching for User-agent: * (no
 * wildcard/$-anchor robots.txt grammar), and <loc> extraction from sitemaps
 * via regex rather than a full XML parser — sitemaps are simple, well-formed
 * documents in practice, and this avoids a new parsing dependency for a
 * narrow, well-understood shape.
 */

export function parseRobotsTxt(text = '') {
  const lines = String(text || '').split(/\r?\n/);
  const disallow = [];
  const sitemaps = [];
  let applies = false;
  for (const raw of lines) {
    const line = raw.split('#')[0].trim();
    if (!line) continue;
    const idx = line.indexOf(':');
    if (idx < 0) continue;
    const key = line.slice(0, idx).trim().toLowerCase();
    const value = line.slice(idx + 1).trim();
    if (key === 'sitemap' && value) { sitemaps.push(value); continue; }
    if (key === 'user-agent') { applies = value === '*'; continue; }
    if (!applies) continue;
    if (key === 'disallow' && value) disallow.push(value);
  }
  return { disallow, sitemaps };
}

export async function fetchRobotsRules(origin, { fetchImpl = fetch, userAgent = 'Lumen-WebQA-SiteAudit' } = {}) {
  try {
    const res = await fetchImpl(`${origin}/robots.txt`, { headers: { 'user-agent': userAgent } });
    if (!res.ok) return { disallow: [], sitemaps: [] };
    return parseRobotsTxt(await res.text());
  } catch {
    return { disallow: [], sitemaps: [] };
  }
}

export function isDisallowed(pathname, disallowRules = []) {
  return disallowRules.some((rule) => rule === '/' || (rule && pathname.startsWith(rule)));
}

export async function fetchSitemapUrls(sitemapUrl, { fetchImpl = fetch, maxUrls = 2000, depth = 0 } = {}) {
  if (depth > 2 || maxUrls <= 0) return [];
  try {
    const res = await fetchImpl(sitemapUrl);
    if (!res.ok) return [];
    const text = await res.text();
    const locs = [...text.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/gi)].map((m) => m[1].trim());
    if (/<sitemapindex/i.test(text)) {
      const out = [];
      for (const childSitemap of locs.slice(0, 50)) {
        out.push(...await fetchSitemapUrls(childSitemap, { fetchImpl, maxUrls: maxUrls - out.length, depth: depth + 1 }));
        if (out.length >= maxUrls) break;
      }
      return out.slice(0, maxUrls);
    }
    return locs.slice(0, maxUrls);
  } catch {
    return [];
  }
}
