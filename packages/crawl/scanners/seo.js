/**
 * SEO discipline: titles, descriptions, canonicals, robots/noindex,
 * hreflang, and the cross-page checks that need the whole crawl (duplicate
 * title/description, sitemap reconciliation).
 *
 * ruleIds are deliberately reused verbatim from packages/rules/browser-rules.js
 * (the rendered tier) wherever the same fact is checkable statically —
 * seo.canonical-cross-host, seo.hreflang-invalid, seo.hreflang-duplicate-target
 * — so that a page which later gets the optional render pass produces a
 * finding under the SAME ruleId the static tier already used, rather than a
 * parallel static-only name the rest of the system (policy quieting,
 * reporting buckets, guidance text) doesn't recognize.
 */
import { STATIC_EVIDENCE_NOTE } from './shared.js';
import { isDisallowed } from '../robots.js';

const TITLE_MIN = 15;
const TITLE_MAX = 65;
const DESCRIPTION_MIN = 50;
const DESCRIPTION_MAX = 160;

function perPage(meta, pageUrl) {
  const out = [];
  if (!meta.title) {
    out.push({ ruleId: 'seo.title-missing', title: 'Page title is missing', detail: `No <title> element was found in the static HTML for ${pageUrl}. ${STATIC_EVIDENCE_NOTE}`, category: 'fix', severity: 'high', confidence: 'inferred' });
  } else {
    if (meta.titleCount > 1) out.push({ ruleId: 'seo.title-multiple', title: 'Multiple title elements are present', detail: `${meta.titleCount} <title> elements were found in the static HTML. ${STATIC_EVIDENCE_NOTE}`, category: 'fix', severity: 'medium', confidence: 'inferred', count: meta.titleCount });
    const len = meta.title.length;
    if (len < TITLE_MIN) out.push({ ruleId: 'seo.title-short', title: 'Title is unusually short', detail: `The title "${meta.title}" is ${len} characters. Short titles often under-describe the page to search engines and searchers.`, category: 'review', severity: 'low', confidence: 'confirmed', count: len });
    else if (len > TITLE_MAX) out.push({ ruleId: 'seo.title-long', title: 'Title is unusually long', detail: `The title "${meta.title}" is ${len} characters and is likely to be truncated in search results (typical display limit is around ${TITLE_MAX}).`, category: 'review', severity: 'low', confidence: 'confirmed', count: len });
  }

  if (!meta.description) {
    out.push({ ruleId: 'seo.description-missing', title: 'Meta description is missing', detail: `No meta description was found in the static HTML for ${pageUrl}. ${STATIC_EVIDENCE_NOTE}`, category: 'review', severity: 'medium', confidence: 'inferred' });
  } else {
    if (meta.descriptionCount > 1) out.push({ ruleId: 'seo.description-multiple', title: 'Multiple meta descriptions are present', detail: `${meta.descriptionCount} description meta tags were found in the static HTML. ${STATIC_EVIDENCE_NOTE}`, category: 'fix', severity: 'medium', confidence: 'inferred', count: meta.descriptionCount });
    const len = meta.description.length;
    if (len < DESCRIPTION_MIN) out.push({ ruleId: 'seo.description-short', title: 'Meta description is unusually short', detail: `The meta description is ${len} characters. A short description gives search engines little to work with when composing a results snippet.`, category: 'review', severity: 'low', confidence: 'confirmed', count: len });
    else if (len > DESCRIPTION_MAX) out.push({ ruleId: 'seo.description-long', title: 'Meta description is unusually long', detail: `The meta description is ${len} characters and is likely to be truncated in search results (typical display limit is around ${DESCRIPTION_MAX}).`, category: 'review', severity: 'low', confidence: 'confirmed', count: len });
  }

  if (meta.canonicalCount > 1) {
    out.push({ ruleId: 'seo.canonical-multiple', title: 'Multiple canonicals are declared', detail: `${meta.canonicalCount} canonical links were found in the static HTML. ${STATIC_EVIDENCE_NOTE}`, category: 'fix', severity: 'high', confidence: 'inferred', count: meta.canonicalCount });
  } else if (!meta.canonical) {
    out.push({ ruleId: 'seo.canonical-missing', title: 'Canonical is not declared', detail: `No canonical link was found in the static HTML for ${pageUrl}. ${STATIC_EVIDENCE_NOTE}`, category: 'review', severity: 'medium', confidence: 'inferred' });
  } else {
    try {
      const canonicalHost = new URL(meta.canonical).hostname;
      const pageHost = new URL(pageUrl).hostname;
      if (canonicalHost !== pageHost) out.push({ ruleId: 'seo.canonical-cross-host', title: 'Canonical points to another host', detail: `The static canonical for ${pageUrl} points to ${canonicalHost}. Confirm this cross-host canonical is intentional. ${STATIC_EVIDENCE_NOTE}`, category: 'review', severity: 'medium', confidence: 'inferred' });
    } catch {}
  }

  if (/\bnoindex\b/i.test(meta.robots || '')) out.push({ ruleId: 'seo.noindex', title: 'Page requests noindex', detail: `The robots meta directive on ${pageUrl} contains noindex ("${meta.robots}").`, category: 'context', severity: 'info', confidence: 'confirmed' });

  out.push(...hreflangFindings(meta, pageUrl));
  return out;
}

function hreflangFindings(meta, pageUrl) {
  const tags = Array.isArray(meta.hreflangTags) ? meta.hreflangTags : [];
  if (!tags.length) return [];
  const out = [];
  for (const tag of tags) {
    const lang = String(tag.lang || '');
    if (lang && lang.toLowerCase() !== 'x-default') {
      try { new Intl.Locale(lang); } catch {
        out.push({ ruleId: 'seo.hreflang-invalid', title: 'hreflang language tag is invalid', detail: `An alternate link on ${pageUrl} uses hreflang="${lang.slice(0, 80)}", which is not a valid BCP 47 language tag or x-default.`, category: 'fix', severity: 'medium', confidence: 'confirmed' });
        continue;
      }
    }
    if (!tag.href) {
      out.push({ ruleId: 'seo.hreflang-invalid', title: 'hreflang href is empty', detail: `An alternate hreflang link on ${pageUrl} has no href, so the language annotation cannot identify a URL.`, category: 'fix', severity: 'medium', confidence: 'confirmed' });
    }
  }
  const targets = new Map();
  for (const tag of tags) {
    if (!tag.href) continue;
    const key = tag.href.split('#')[0];
    if (!targets.has(key)) targets.set(key, []);
    targets.get(key).push((tag.lang || '').toLowerCase());
  }
  for (const [target, langs] of targets) {
    const distinct = [...new Set(langs.filter((l) => l && l !== 'x-default'))];
    if (distinct.length > 1) out.push({ ruleId: 'seo.hreflang-duplicate-target', title: 'Multiple hreflang tags point to the same URL', detail: `Alternate hreflang links on ${pageUrl} reuse ${target} for more than one language tag (${distinct.slice(0, 4).join(', ')}). Search engines expect distinct URLs per language variant.`, category: 'review', severity: 'medium', confidence: 'inferred' });
  }
  return out;
}

/** Findings that require comparing pages against each other, or against
 * data the crawl gathered but that isn't per-page (the sitemap). */
function crossPage(fetchedUrls, ctx) {
  const findingsByUrl = new Map();
  function push(url, finding) {
    if (!findingsByUrl.has(url)) findingsByUrl.set(url, []);
    findingsByUrl.get(url).push(finding);
  }
  function othersLabel(all, url) {
    const others = all.filter((u) => u !== url);
    return `${others.slice(0, 3).join(', ')}${others.length > 3 ? `, and ${others.length - 3} more` : ''}`;
  }

  const byTitle = new Map();
  const byDescription = new Map();
  for (const row of fetchedUrls) {
    const title = (row.title || '').trim();
    if (title) { if (!byTitle.has(title)) byTitle.set(title, []); byTitle.get(title).push(row.url); }
    const description = (row.meta_description || '').trim();
    if (description) { if (!byDescription.has(description)) byDescription.set(description, []); byDescription.get(description).push(row.url); }
  }
  for (const [titleText, urls] of byTitle) {
    if (urls.length < 2) continue;
    for (const url of urls) push(url, { ruleId: 'seo.duplicate-title', title: 'Title is duplicated on other pages', detail: `The <title> "${titleText}" is used on ${urls.length} pages, including ${othersLabel(urls, url)}. Each page should have a unique title so search engines and users can tell them apart.`, category: 'fix', severity: 'medium', confidence: 'confirmed', count: urls.length });
  }
  for (const [descText, urls] of byDescription) {
    if (urls.length < 2) continue;
    for (const url of urls) push(url, { ruleId: 'seo.duplicate-description', title: 'Meta description is duplicated on other pages', detail: `The meta description is identical on ${urls.length} pages, including ${othersLabel(urls, url)}. A shared description gives search engines no way to distinguish these pages in results.`, category: 'review', severity: 'low', confidence: 'confirmed', count: urls.length });
  }

  // Sitemap reconciliation. Both directions need the FULL sitemap, not the
  // maxPages-scaled slice the crawl used to seed its frontier — reconciling
  // against a truncated set would manufacture "never reached" findings that
  // are purely an artifact of this audit's own page budget, on exactly the
  // large sites where this check matters most. Gate each direction on
  // whether the data it needs is actually complete.
  if (ctx?.sitemapFetched && !ctx.sitemapTruncated) {
    // Compare normalized forms on both sides — ctx.sitemapUrls is already
    // normalized (see crawler.js), and a raw fetched URL commonly differs
    // from its normalized form by exactly a trailing slash or default port,
    // which would otherwise make nearly every real page look "unreached".
    const crawledSet = new Set(fetchedUrls.map((r) => r.normalized_url || r.url));
    let unreachedCount = 0;
    for (const sitemapUrl of ctx.sitemapUrls) {
      if (!crawledSet.has(sitemapUrl)) unreachedCount++;
    }
    if (unreachedCount > 0 && !ctx.maxPagesReached) {
      // Only meaningful when the crawl actually finished (frontier exhausted,
      // not cut off by maxPages) — otherwise "unreached" just means "not
      // gotten to yet", not a real gap.
      let flagged = 0;
      for (const sitemapUrl of ctx.sitemapUrls) {
        if (crawledSet.has(sitemapUrl) || flagged >= 50) continue;
        flagged++;
        push(sitemapUrl, { ruleId: 'seo.sitemap-unreached', title: 'Sitemap URL was never reached by the crawl', detail: `${sitemapUrl} is listed in the sitemap but the crawl (which finished exploring all discoverable internal links) never reached it — it may be an orphan page with no internal links pointing to it, or a stale sitemap entry.`, category: 'review', severity: 'medium', confidence: 'confirmed' });
      }
    }
  }
  if (ctx?.sitemapFetched) {
    // The reverse direction is safe regardless of truncation — a crawled
    // page missing from even a truncated sitemap read is still a real fact.
    for (const row of fetchedUrls) {
      if (row.status !== 'fetched' || (row.http_status && row.http_status >= 400)) continue;
      if (!ctx.sitemapUrls.has(row.normalized_url || row.url)) {
        push(row.url, { ruleId: 'seo.sitemap-orphan', title: 'Page is not listed in the sitemap', detail: `${row.url} was reached by the crawl but does not appear in the site's sitemap. If this page should be discoverable/indexed, add it to the sitemap.`, category: 'context', severity: 'info', confidence: 'inferred' });
      }
    }
  }

  // A URL the sitemap asks search engines to index, but robots.txt disallows
  // crawling — an internally inconsistent, self-defeating setup regardless
  // of how much of the sitemap was read or whether the crawl finished, so
  // this direction isn't gated on sitemapTruncated/maxPagesReached the way
  // the "never reached" check above is.
  if (Array.isArray(ctx?.robotsDisallow) && ctx.robotsDisallow.length && ctx?.sitemapUrls) {
    let flagged = 0;
    for (const sitemapUrl of ctx.sitemapUrls) {
      if (flagged >= 50) break;
      let pathname;
      try { pathname = new URL(sitemapUrl).pathname; } catch { continue; }
      if (isDisallowed(pathname, ctx.robotsDisallow)) {
        flagged++;
        push(sitemapUrl, { ruleId: 'seo.sitemap-blocked-by-robots', title: 'Sitemap URL is blocked by robots.txt', detail: `${sitemapUrl} is listed in the sitemap (asking search engines to index it), but robots.txt disallows crawling its path. Search engines that respect robots.txt cannot access this URL to index it, making the sitemap entry ineffective.`, category: 'fix', severity: 'high', confidence: 'confirmed' });
      }
    }
  }

  return findingsByUrl;
}

export default { id: 'seo', perPage, crossPage };
