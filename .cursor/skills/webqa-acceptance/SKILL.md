---
name: webqa-acceptance
description: Run cross-discipline Web QA Assistant acceptance against real public sites using the local MCP harness.
disable-model-invocation: true
---
# WebQA acceptance

The parent Agent collects deterministic evidence with the `webqa` MCP. Use Cursor's native Browser tool for ordinary public-page interaction/screenshots. Use `playwright-live` only when an existing Chrome tab/profile is specifically needed.

Label every claim with exactly one source:

| Label | Meaning |
|-------|---------|
| `webqa_evidence` | Deterministic scanner/gateway `/api/scan` fields sanitized into the review artifact (findings, coverage, integrity, link aggregates, lab perf) |
| `frank_deterministic` | Production deterministic Frank from `webqa_frank_plan` (`packages/frank`) — **not** returned by `/api/scan` |
| `browser_observation` | Independent Cursor Browser (or playwright-live) observation — **never** stored in the review artifact |
| `reviewer_inference` | Human/agent judgment — never silently promoted into WebQA findings |

Also treat review-bundle `provenance.attention` / `provenance.priority` as **`mcp_local_recompose`**: Recommended Order and priority brief are recomposed locally via `composeAttention` / `composedBrief`. Do **not** imply they came directly from gateway `/api/scan`.

Browser observations must never become WebQA findings.

`webqa_review_run` defaults to a **compact index** (`responseShape: compact_index`). Do not request `section=full` unless necessary; prefer `findings` / `attention` / `provenance` drill-downs.

## Smoke (quick)

1. `webqa_health`
2. `webqa_scan_url` — concise summary + artifact path
3. `webqa_review_run(artifact)` — evidence index (attention, coverage, integrity)
4. Optionally open the same URL in Cursor Browser for corroboration

## Milestone acceptance (full)

For each requested site:

1. `webqa_health`
2. `webqa_scan_url` — keep the concise summary; note `artifact` path and `hasReview`
3. `webqa_review_run(artifact, section=index)` then drill `attention` / `targetIntegrity` / `coverage` / `findings` as needed
4. `webqa_review_finding(artifact, findingId)` for representative material findings (prefer a non-accessibility Recommended Order lead when another class is represented)
5. `webqa_frank_plan(artifact, findingId)` where Frank is eligible — deterministic only; no Chrome AI / cloud AI
6. Use Cursor native Browser independently on the same target for corroboration or challenge
7. Hand collected evidence to read-only `adversarial-qa`, then `frank-reviewer`, then `product-reviewer` (and `browser-acceptance` when UI proof is required)
8. Return an acceptance verdict that separates the four evidence labels above

### Blocked / challenge targets

- Target-integrity success can **PASS** when the product correctly detects blocked/interstitial/inconclusive reachability.
- Page audit itself remains incomplete / not performed (`pageQaWithheld`).
- When `pageQaWithheld` / `findings.pageDerivedSuppressed` is true, do **not** treat residual findings as target-page QA — page-derived findings are suppressed in the review bundle.
- Frank must **not** recommend page fixes from substituted/challenge content (`webqa_frank_plan` returns `withheld: true`).

### Frank selection

- Prefer a high-confidence finding from Recommended Order.
- Prefer a non-accessibility class when Navigation, Discoverability, Performance, Security, Web quality, or Coverage is represented.
- Treat MCP Frank as deterministic-only with `targetContextPresent: false` (no extension DOM snapshot) unless a later bridge exists.

### Depth note

Do not equate finding count with importance. Across a release sample, cover several of Navigation, Discoverability, Performance, Accessibility, Security/Web quality and Coverage.

Save outputs under `qa-runs/`; never commit those artifacts unless they are intentionally sanitized fixtures. Prefer explicit artifact paths from `webqa_scan_url` over `webqa_latest_run` for review/Frank (latest-run is a thin pointer only).

When a Report Bug diagnostic exists for the tested page/run, inspect it with `webqa_latest_diagnostic` / `webqa_diagnostic_section` before asking for raw logs. Do not require a diagnostic for every review. Treat a stale or different-page diagnostic as unrelated.
