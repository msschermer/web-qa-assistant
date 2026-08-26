# Build status: Web QA Assistant 1.7.4 / development toward 1.7.5

## Release vs development

| Role | Version | Notes |
|------|---------|--------|
| **Production release** | **1.7.4** | Live deploy identity. Tag `v1.7.4` plus post-tag `undici` hotfix — see prior 1.7.4 notes below. |
| **Development target** | **1.7.5** | `main` accumulates unreleased product work toward this release. |
| **Package / manifest / runtime version** | **1.7.4** | Remains at the last released version until explicit release preparation. |
| **Source / build identity** | **git revision** | Authoritative for unpacked and CI development builds via `buildRevision` (short commit SHA). |

Do **not** treat `main` commits as a released 1.7.5 product. Do **not** bump package/manifest version until release prep.

## Current development HEAD

See `git rev-parse HEAD` / `origin/main`. Extension builds embed `buildRevision` from that commit at `npm run build:extension` time.

## 1.7.5 development intent (accumulating)

- Async-safe interaction verification and honest coverage accounting
- Same-origin iframe activation and bounded resource ownership
- Report Bug / diagnostic contract coherence (timeline, lab vs monitor performance, buildRevision)
- Restrained side-panel coverage communication
- PSI / CrUX remain deferred (`docs/DEV-BATCH-PSI.md`)

## Delivery candidate (released)

1.7.4 is the cross-discipline QA release on top of the 1.7.3 product-quality baseline. It adds workspace redesign, issue correlation, expanded navigation/runtime QA, safe external probing, Ask Frank focus mode, Report Bug v2 diagnostics, and read-only MCP diagnostic inspection.

Production is live on **v1.7.4**. Tag `v1.7.4` (`e3ad225`) is the release metadata commit but omits the post-release `undici` dependency hotfix required for renderer boot — do not deploy from the tag alone until a patch tag supersedes it.

## Frozen product commit (1.7.4 packaging baseline)

`f7965b2fd811ab69df90d237870dc23ec6643f66`

Release metadata and packaging updates are layered on this frozen HEAD. Post-release commit `ccdcddc` adds only the root `undici` dependency required by `packages/security/safe-probe.js`.

## Release objectives (1.7.4)

- Present a page-level QA assessment before scanner details.
- Correlate findings across QA disciplines with honest Recommended Order.
- Expand links, navigation, performance, SEO, forms, and runtime coverage.
- Keep Frank focused on interpretation and action with focus-mode walkthrough.
- Generate privacy-safe Report Bug v2 diagnostics reviewable via MCP.
- Preserve on-device AI, deterministic fallback, managed gateway access, and zero-metered-AI defaults.

## Validation

Exact final test/check/build/release results for 1.7.4 are recorded in `RELEASE_PROVENANCE.txt`.

Diagnostic MCP acceptance: **PASS** — live catalog exposes `webqa_latest_diagnostic`, `webqa_diagnostic_section`, and `webqa_read_report_bug`; v2 artifact read successfully with bounded sections and privacy checks.

## 1.7.4 product milestones

- SaaS-style workspace layout and cross-discipline presentation.
- Ask Frank focus mode with Return to QA state restoration.
- Shared correlation model, root-cause grouping, and Worth Checking Further.
- Safe gateway external link probing with SSRF/DNS protections and dual-GET confirmation.
- Expanded QA families: mixed content, runtime failures, forms, hreflang, viewport overflow, lab CLS.
- Report Bug v2 diagnostic bundle and read-only MCP diagnostic readers.
- Cursor permissions allowlist for exact diagnostic tool names.

## Prior baselines retained

- **1.7.3** product-quality attention balance, honest current-page performance coverage, uncertain image-alt demotion, title/lang duplicate quieting, blank-opener security representation.
- **1.7.2** target integrity for blocked, challenge, and substituted pages.
- **1.7.1** staged target resolution with fingerprint disambiguation.

## Known gaps

- PSI / field CWV enrichment not implemented (see `docs/DEV-BATCH-PSI.md` for deferral rationale).
- Runtime observable window: document_start diagnostics when host permission allows; extension scans mark `runtime: extension-partial` when early errors are captured; renderer remains authoritative for uncaught-error findings.
- Embedded context: open shadow roots and same-origin iframe documents are included in fragment/disclosure resolution; cross-origin iframe interiors and closed shadow roots remain not observable.
- Shadow-root and iframe targeting limits from earlier releases remain.
- Cloudflare-gated sites may remain blocked at the gateway renderer while a normal browser session reaches the real page.
- Conservative runtime-failure correlation for cross-origin assets.
- Extension runtime capture may begin post-injection; empty failedResources is not proof of a clean network pass.
- Manual Chrome Frank → Report Bug acceptance remains a human unpacked-extension checklist item.
