# Build status: Web QA Assistant 1.7.4

## Delivery candidate

1.7.4 is the cross-discipline QA release on top of the 1.7.3 product-quality baseline. It adds workspace redesign, issue correlation, expanded navigation/runtime QA, safe external probing, Ask Frank focus mode, Report Bug v2 diagnostics, and read-only MCP diagnostic inspection.

Production is live on **v1.7.4** at commit `ccdcddcacd2ec67ee0d814e784c767fab9d0fb78` (`origin/main`). Tag `v1.7.4` (`e3ad225`) is the release metadata commit but omits the post-release `undici` dependency hotfix required for renderer boot — do not deploy from the tag alone until a patch tag supersedes it.

## Frozen product commit

`f7965b2fd811ab69df90d237870dc23ec6643f66`

Release metadata and packaging updates are layered on this frozen HEAD. Post-release commit `ccdcddc` adds only the root `undici` dependency required by `packages/security/safe-probe.js`.

## Release objectives

- Present a page-level QA assessment before scanner details.
- Correlate findings across QA disciplines with honest Recommended Order.
- Expand links, navigation, performance, SEO, forms, and runtime coverage.
- Keep Frank focused on interpretation and action with focus-mode walkthrough.
- Generate privacy-safe Report Bug v2 diagnostics reviewable via MCP.
- Preserve on-device AI, deterministic fallback, managed gateway access, and zero-metered-AI defaults.

## Validation

Exact final test/check/build/release results are recorded in `RELEASE_PROVENANCE.txt`.

Diagnostic MCP acceptance: **PASS** — live catalog exposes `webqa_latest_diagnostic`, `webqa_diagnostic_section`, and `webqa_read_report_bug`; v2 artifact read successfully with bounded sections and privacy checks. Release prep includes a one-line hardening fix so MCP re-read preserves timeline `coverage_degraded` area names (340/340 tests).

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

- PSI / field CWV enrichment not implemented.
- Shadow-root and iframe targeting limits from earlier releases remain.
- Cloudflare-gated sites may remain blocked at the gateway renderer while a normal browser session reaches the real page.
- Conservative runtime-failure correlation for cross-origin assets.
- Extension runtime capture may begin post-injection; empty failedResources is not proof of a clean network pass.
