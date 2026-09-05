# Build status: Lumen 1.7.5

## Release vs development

| Role | Version | Notes |
|------|---------|--------|
| **Production release** | **1.7.5** | Tag `v1.7.5`. Includes the renderer `undici` dependency that tag `v1.7.4` omitted. |
| **Next human production target** | **1.7.6** | Do not bump package/manifest until that release is prepared. |
| **Package / manifest / runtime version** | **1.7.5** | Extension, API health, and Report Bug `webqaVersion`. |
| **Source / build identity** | **git revision** | Authoritative for unpacked and CI builds via `buildRevision` (short commit SHA). |

## Current release HEAD

See tag `v1.7.5` / `git rev-parse HEAD` after this release commit. Extension builds embed `buildRevision` from that commit at `npm run build:extension` time.

## 1.7.5 product intent

- Complete current-page link verification with adaptive concurrency, reserved pools, primary-first execution, and a short-lived session cache.
- Separate model readiness from Frank review completion; keep scan guidance source honest.
- Report published-index checks as checked versus not checked; do not treat rendered-only noindex as a confirmed published blocker.
- Keep Report Bug default output free of visible-error page text.

## Validation

Exact final test/check/build/release results for 1.7.5 are recorded in `RELEASE_PROVENANCE.txt`.

## 1.7.5 product milestones

- Adaptive target-origin concurrency with reserved external pools and primary-first probing.
- Session link-status cache with origin-scoped snapshots, Recheck bypass, and no inconclusive reuse.
- Frank `frankReview` vs scan `guidanceSource`; structured remediation without duplicated primary sentences.
- Published coverage object, checked-scope notices, and rendered-only noindex policy honesty.
- Visible-error corroboration, performance-assessment clarity, and Report Bug projection for new fields.

## Prior baselines retained

- **1.7.4** cross-discipline workspace, correlation, Ask Frank focus mode, Report Bug v2, read-only MCP diagnostics. Tag `v1.7.4` (`e3ad225`) omitted the post-release `undici` hotfix (`ccdcddc`); 1.7.5 restores exact-tag server deployability for that dependency.
- **1.7.3** product-quality attention balance, honest current-page performance coverage, uncertain image-alt demotion, title/lang duplicate quieting, blank-opener security representation.
- **1.7.2** target integrity for blocked, challenge, and substituted pages.
- **1.7.1** staged target resolution with fingerprint disambiguation.

## Known gaps

- PSI / field CWV enrichment not implemented. Field data needs a Chrome UX Report key and a site with enough traffic to have one, so a lab observation is what Lumen can honestly report today; the deferral note that used to sit in `docs/` was pruned with the rest of the historical batch planning.
- HEAD 200 without GET confirm can hide a GET 404 on HEAD-deaf or method-asymmetric origins.
- Session cache stores query-bearing URLs until TTL or browser exit; the extension spans incognito.
- Chrome HTTP/1.1 typically allows about six connections per host.
- Runtime observable window: document_start diagnostics when host permission allows; extension scans set `coverage.runtime: complete` with `coverageScope.runtime: post-injection-extension` when early diagnostics bind; renderer remains authoritative for uncaught-error findings.
- Cross-origin iframe interiors and closed shadow roots remain not observable.
- Cloudflare-gated sites may remain blocked at the gateway renderer while a normal browser session reaches the real page.
- Manual Chrome Frank → Report Bug acceptance remains a human unpacked-extension checklist item.
