/**
 * Cheap, no-browser page collection for the site crawl's default (and only
 * server-side) tier. A GET request plus jsdom parsing (JavaScript execution
 * disabled) costs a handful of milliseconds of CPU and no GPU/compositor
 * work — nothing like a full Chromium page load. That is the whole point:
 * a 300-page audit must not mean 300 headless-browser renders on our own
 * infrastructure. The real cost of that choice is honest and explicit: a
 * page whose title, canonical, or content is injected by client-side
 * JavaScript will look different here than it would after rendering. Every
 * finding this module produces is confidence:'inferred' for exactly that
 * reason — see packages/crawl/crawler.js's staticFindings(). Deeper,
 * JS-dependent and visual checks (axe, runtime errors, image sizing) come
 * from the optional local render pass, which runs the existing single-page
 * scan pipeline in the user's own browser instead (apps/extension's
 * SITE_AUDIT_RENDER_* flow) — that is where the CPU cost of a real render
 * belongs once a site is large enough that our server can't absorb it.
 */
import { JSDOM } from 'jsdom';
import { isPrivateProbeHost } from '../security/safe-probe.js';
import { collectSchemaItems } from './schema-items.js';

const MAX_BODY_BYTES = 3 * 1024 * 1024;
const MAX_REDIRECTS = 8;

function absoluteUrl(href, base) {
  try { return new URL(href, base).toString(); } catch { return null; }
}

const ANALYTICS_PATTERNS = [
  { name: 'Google Analytics (GA4)', test: /googletagmanager\.com\/gtag\/js|gtag\(['"]config['"]/ },
  { name: 'Google Tag Manager', test: /googletagmanager\.com\/gtm\.js/ },
  { name: 'Meta Pixel', test: /connect\.facebook\.net\/[^"']*\/fbevents\.js/ },
  { name: 'Plausible', test: /plausible\.io\/js\/(script|plausible)/ },
  { name: 'Fathom', test: /usefathom\.com\/script\.js|cdn\.usefathom\.com/ },
  { name: 'Hotjar', test: /static\.hotjar\.com/ },
  { name: 'Segment', test: /cdn\.segment\.com\/analytics\.js/ }
];

/** Positive-only detection: reports what WAS found, never claims analytics
 * is absent. Modern, compliant implementations (consent-gated loaders,
 * server-side tag managers, first-party proxy subdomains) leave nothing
 * recognizable in raw HTML — an "absence" claim here would be inverted,
 * penalizing exactly the sites doing tracking most responsibly. */
function detectAnalyticsSignals(document) {
  const haystacks = [
    ...[...document.querySelectorAll('script[src]')].map((s) => s.getAttribute('src') || ''),
    ...[...document.querySelectorAll('script:not([src])')].map((s) => s.textContent || '')
  ].join('\n');
  const found = [];
  for (const { name, test } of ANALYTICS_PATTERNS) if (test.test(haystacks)) found.push(name);
  return found;
}

function extractFromHtml(html, pageUrl, { httpStatus, redirected, contentType, redirectHops, hadInsecureHop, cspHeader, hstsHeader, xContentTypeOptionsHeader, xFrameOptionsHeader, referrerPolicyHeader }) {
  let dom;
  try {
    dom = new JSDOM(html, { url: pageUrl });
  } catch (error) {
    return { ok: false, error: `parse-failed: ${String(error?.message || error).slice(0, 200)}` };
  }
  try {
    const document = dom.window.document;
    const titleEls = document.querySelectorAll('title');
    const descEls = document.querySelectorAll('meta[name="description" i]');
    const canonicalEls = document.querySelectorAll('link[rel="canonical" i]');
    const canonicalHref = canonicalEls[0] ? absoluteUrl(canonicalEls[0].getAttribute('href') || '', pageUrl) : '';
    const robotsEl = document.querySelector('meta[name="robots" i]');
    const viewportEl = document.querySelector('meta[name="viewport" i]');
    const hasCharset = Boolean(document.querySelector('meta[charset], meta[http-equiv="content-type" i]'));
    const ogTitle = document.querySelector('meta[property="og:title" i]');
    const ogDescription = document.querySelector('meta[property="og:description" i]');
    const hreflangTags = [...document.querySelectorAll('link[rel~="alternate"][hreflang]')].map((el) => ({
      lang: el.getAttribute('hreflang') || '', href: absoluteUrl(el.getAttribute('href') || '', pageUrl) || ''
    }));
    // Heading-order/skip only makes sense within ONE logical content flow.
    // Scanning the whole document mixes headings from unrelated regions —
    // nav, sidebar widgets, footer — that have nothing to do with the main
    // content's hierarchy, and reliably manufactures a "skip" on the vast
    // majority of real templated sites (confirmed live: 100% false-positive
    // rate on a real WordPress site with sidebar/footer widget headings).
    // Scope to a main-content landmark when the page declares one; when it
    // doesn't, skip the check entirely rather than guess at document
    // structure this tier has no reliable way to determine.
    const mainRoot = document.querySelector('main, [role="main"], article');
    const headingLevels = mainRoot ? [...mainRoot.querySelectorAll('h1,h2,h3,h4,h5,h6')].map((h) => Number(h.tagName[1])) : [];
    const htmlLang = document.documentElement?.getAttribute('lang') || '';
    const imagesTotal = document.querySelectorAll('img').length;
    const imagesMissingAlt = [...document.querySelectorAll('img')].filter((img) => !img.hasAttribute('alt')).length;
    const insecureResourceRefs = [];
    for (const el of document.querySelectorAll('script[src],link[rel="stylesheet" i][href]')) {
      const attr = el.tagName === 'SCRIPT' ? 'src' : 'href';
      const raw = el.getAttribute(attr) || '';
      if (/^http:\/\//i.test(raw)) insecureResourceRefs.push(raw);
    }
    const hasCspUpgradeInsecure = /upgrade-insecure-requests/i.test(cspHeader || '');
    const analyticsSignals = detectAnalyticsSignals(document);
    const h1s = [...document.querySelectorAll('h1')].map((h) => h.textContent.trim()).filter(Boolean);
    const bodyText = document.body?.textContent || '';
    const wordCount = (bodyText.match(/\S+/g) || []).length;

    // Transport-layer facts, unaffected by whatever JS the page runs — these
    // are 'confirmed' in the scanner, not 'inferred', the same way a directly
    // measured title length is confirmed while a title's mere presence isn't.
    const hasHsts = Boolean(hstsHeader);
    const hasXContentTypeOptions = /nosniff/i.test(xContentTypeOptionsHeader || '');
    const hasXFrameOptions = Boolean(xFrameOptionsHeader);
    const hasFrameAncestorsCsp = /frame-ancestors/i.test(cspHeader || '');
    const hasReferrerPolicy = Boolean(referrerPolicyHeader);
    const hasDoctype = Boolean(dom.window.document.doctype);
    const hasMetaRefresh = Boolean(document.querySelector('meta[http-equiv="refresh" i]'));

    // In-page fragment links (href="#id") and every id/name a fragment could
    // resolve against — used to find links that point at nothing, the same
    // fact packages/rules/browser-rules.js's fragmentFindings() checks in
    // the rendered tier (ruleId navigation.fragment-missing), just without
    // that tier's ability to see ids added by JavaScript after load.
    const elementIds = new Set([...document.querySelectorAll('[id]')].map((el) => el.id));
    for (const a of document.querySelectorAll('a[name]')) {
      const n = a.getAttribute('name');
      if (n) elementIds.add(n);
    }
    const fragmentLinks = [];
    for (const a of document.querySelectorAll('a[href^="#"]')) {
      const raw = a.getAttribute('href') || '';
      if (!raw || raw === '#' || /^#top$/i.test(raw)) continue;
      let id;
      try { id = decodeURIComponent(raw.slice(1)); } catch { id = raw.slice(1); }
      if (!id) continue;
      fragmentLinks.push({ id, text: (a.textContent || '').trim().slice(0, 200) });
    }

    // Form controls with no accessible name in the static markup. Skips
    // control types whose name doesn't come from a label (submit/button/
    // image/hidden get their name from value/alt/nothing respectively).
    const labelForTargets = new Set([...document.querySelectorAll('label[for]')].map((l) => l.getAttribute('for')));
    let formControlsTotal = 0;
    let formControlsMissingLabel = 0;
    for (const el of document.querySelectorAll('input:not([type=hidden]):not([type=submit]):not([type=button]):not([type=reset]):not([type=image]), select, textarea')) {
      formControlsTotal++;
      const id = el.getAttribute('id');
      const hasLabelFor = Boolean(id) && labelForTargets.has(id);
      const wrappedByLabel = Boolean(el.closest('label'));
      const hasAriaLabel = Boolean((el.getAttribute('aria-label') || '').trim());
      const hasAriaLabelledby = Boolean((el.getAttribute('aria-labelledby') || '').trim());
      if (!hasLabelFor && !wrappedByLabel && !hasAriaLabel && !hasAriaLabelledby) formControlsMissingLabel++;
    }

    // The items themselves, not just the names of their types: an audit that
    // can only say "structured data is present" cannot say what is wrong with it.
    const schema = collectSchemaItems(document);
    const { schemaBlockCount, schemaInvalidCount, schemaTypes } = schema;

    const links = [];
    const seen = new Set();
    for (const a of document.querySelectorAll('a[href]')) {
      const href = a.getAttribute('href') || '';
      if (!href || /^(javascript:|mailto:|tel:|#)/i.test(href.trim())) continue;
      const target = absoluteUrl(href, pageUrl);
      if (!target) continue;
      let scheme;
      try { scheme = new URL(target).protocol; } catch { continue; }
      if (!/^https?:$/.test(scheme)) continue;
      const key = target.split('#')[0];
      if (seen.has(key)) continue;
      seen.add(key);
      const nofollow = /\bnofollow\b/i.test(a.getAttribute('rel') || '');
      links.push({ url: key, text: (a.textContent || '').trim().slice(0, 200), nofollow });
    }

    return {
      ok: true, httpStatus, finalUrl: pageUrl, redirected, contentType, isHtml: true,
      redirectHops: redirectHops || 0, hadInsecureHop: Boolean(hadInsecureHop),
      title: titleEls[0]?.textContent?.trim() || '', titleCount: titleEls.length,
      description: descEls[0]?.getAttribute('content') || '', descriptionCount: descEls.length,
      canonical: canonicalHref || '', canonicalCount: canonicalEls.length,
      robots: robotsEl?.getAttribute('content') || '',
      h1s, wordCount, links,
      schemaBlockCount, schemaInvalidCount, schemaTypes: [...new Set(schemaTypes)],
      schemaItems: schema.items, schemaInvalidBlocks: schema.invalidBlocks, schemaTruncated: schema.truncated,
      hasViewport: Boolean(viewportEl), viewport: viewportEl?.getAttribute('content') || '',
      hasCharset, hasOgTitle: Boolean(ogTitle), hasOgDescription: Boolean(ogDescription),
      hreflangTags, headingLevels, htmlLang, h1Text: h1s[0] || '',
      imagesTotal, imagesMissingAlt,
      insecureResourceRefs, hasCspUpgradeInsecure,
      analyticsSignals,
      hasHsts, hasXContentTypeOptions, hasXFrameOptions, hasFrameAncestorsCsp, hasReferrerPolicy,
      hasDoctype, hasMetaRefresh,
      fragmentLinks, elementIds: [...elementIds],
      formControlsTotal, formControlsMissingLabel
    };
  } finally {
    dom.window.close();
  }
}

/**
 * Fetches one page with a bounded, manually-followed redirect chain (so
 * every hop can be SSRF-checked, matching packages/security/safe-probe.js's
 * discipline) and returns either parsed HTML evidence or a terminal
 * non-HTML/error result. Never throws — callers get `{ok:false, error}`.
 */
export async function collectStaticPage(url, { fetchImpl = fetch, userAgent = 'Lumen-WebQA-SiteAudit/1.0', timeoutMs = 15000 } = {}) {
  let current = String(url);
  const visited = new Set();
  let hadInsecureHop = false;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    let u;
    try { u = new URL(current); } catch { return { ok: false, error: 'invalid-url' }; }
    if (!/^https?:$/.test(u.protocol)) return { ok: false, error: 'unsupported-protocol' };
    if (u.protocol === 'http:') hadInsecureHop = true;
    if (isPrivateProbeHost(u.hostname)) return { ok: false, error: 'destination-not-allowed' };
    if (visited.has(current)) return { ok: false, error: 'redirect-loop' };
    visited.add(current);

    let response;
    try {
      response = await fetchImpl(current, {
        redirect: 'manual',
        headers: { 'user-agent': userAgent, accept: 'text/html,application/xhtml+xml' },
        signal: AbortSignal.timeout(timeoutMs)
      });
    } catch (error) {
      return { ok: false, error: String(error?.message || error).slice(0, 300) };
    }

    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get('location');
      if (!location) return { ok: false, error: 'redirect-without-location', httpStatus: response.status };
      const next = absoluteUrl(location, current);
      if (!next) return { ok: false, error: 'redirect-malformed', httpStatus: response.status };
      current = next;
      continue;
    }

    const httpStatus = response.status;
    const redirected = hop > 0;
    const contentType = String(response.headers.get('content-type') || '');
    if (httpStatus < 200 || httpStatus >= 300 || !/text\/html|application\/xhtml/i.test(contentType)) {
      try { await response.body?.cancel?.(); } catch {}
      return { ok: true, httpStatus, finalUrl: current, redirected, isHtml: false, contentType, redirectHops: hop, hadInsecureHop };
    }

    let html;
    const reader = response.body?.getReader ? response.body.getReader() : null;
    if (reader) {
      let received = 0, chunks = '';
      const decoder = new TextDecoder();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        received += value.byteLength;
        if (received > MAX_BODY_BYTES) { try { await reader.cancel(); } catch {} break; }
        chunks += decoder.decode(value, { stream: true });
      }
      html = chunks;
    } else {
      html = await response.text();
    }
    const cspHeader = String(response.headers.get('content-security-policy') || '');
    const hstsHeader = String(response.headers.get('strict-transport-security') || '');
    const xContentTypeOptionsHeader = String(response.headers.get('x-content-type-options') || '');
    const xFrameOptionsHeader = String(response.headers.get('x-frame-options') || '');
    const referrerPolicyHeader = String(response.headers.get('referrer-policy') || '');
    return extractFromHtml(html, current, { httpStatus, redirected, contentType, redirectHops: hop, hadInsecureHop, cspHeader, hstsHeader, xContentTypeOptionsHeader, xFrameOptionsHeader, referrerPolicyHeader });
  }
  return { ok: false, error: 'redirect-loop' };
}
