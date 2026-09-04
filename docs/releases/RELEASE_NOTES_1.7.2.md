# Web QA Assistant 1.7.2

## Target integrity for blocked and substituted pages

1.7.2 fixes a regression where Cloudflare challenge pages and similar substituted documents produced false SEO findings (noindex, robots mismatch, title issues) and caused Frank and Recommended Order to reason from interstitial HTML instead of the requested site.

### Deterministic target-integrity classification

- Detect challenge/interstitial and blocked renderer responses using multi-signal evidence (title patterns, challenge DOM markers, HTTP status, thin-page heuristics).
- Classify targets as `reached`, `probable_interstitial`, `blocked`, or `inconclusive`.
- Vendor/CDN markers alone do not trigger a mismatch on content-rich pages.

### Safe suppression and honest coverage

- Suppress page-derived findings when target integrity is not `reached`.
- Replace SEO/accessibility ordering with a withholding brief when the requested page was not confirmed.
- Mark coverage honestly: `browser: blocked` or `substituted`, `links/axe: not_applicable`, instead of complete-with-zero-links.
- Preserve non-page-derived coverage signals where appropriate.

### Deployment and packaging

- Package integrity runtime modules in the renderer Docker image so target-integrity logic is available in production scans.
- Declare stable shared-network alias `web-qa-api` on `portfolio_web` so Caddy can route `reverse_proxy web-qa-api:8787` across container recreates.

### Acceptance evidence

- `example.com` scans normally as reached.
- `nascar.com` renderer receives Cloudflare block; target integrity reports blocked; false noindex/robots/title findings are gone; page-derived findings and Recommended Order are withheld.
- Independent browser evidence may still reach the real page; that divergence is an acceptance concern, not a scan-conclusion error.

### Known limitations (non-blocking)

- Extension generic HTTP 403 parity remains a separate follow-up.
- Browser/gateway divergence is not yet a first-class in-product UX signal.
- Public scan path performance remains unmonitored.
