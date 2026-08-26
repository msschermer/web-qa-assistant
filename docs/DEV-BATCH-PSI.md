# PSI / CrUX enrichment — deferred (re-evaluated)

## Decision

Optional live **PageSpeed Insights (PSI)** and **CrUX field CWV** enrichment remain **deferred**.
This document records the **re-evaluation** after the iframe / interaction / resource-policy batch.

## What unique information would PSI provide that WebQA does not already have?

| Candidate unique value | Already covered by WebQA? | Verdict |
|---|---|---|
| Current-page LCP / CLS / TTFB / transfer weight | Yes — lab PerformanceObserver + navigation timing | Duplicate |
| LCP element URL/selector + oversize/heavy correlation | Yes — `performance.browser.lcp*`, weight-dominant composition | Duplicate for highest-value cases |
| Historical host score / trend | Yes — Performance Monitor connector when configured | Partial substitute |
| **CrUX field p75 CWV** | No — lab evidence must never claim field CWV | **Unique**, but only for public URLs with field data |
| Lighthouse render-blocking / unused JS-CSS / image-delivery recipes | No — WebQA does not emit audit opportunity trees | **Unique recipes**, high dedupe/noise cost |
| Main-thread / third-party impact breakdown | No | Unique but large normalization surface |
| Google device/network lab profile | Different from inspecting browser | Unique comparability, not higher truth |

## Why still not implemented

1. **Highest-value current-page questions are already answered by native lab** (LCP element, oversize, weight composition, TTFB, CLS).
2. **Staging / auth / preview pages** (core WebQA use) often cannot be measured by public PSI.
3. Architecture cost remains high: `PSI_API_KEY`, timeouts, budgets, normalization, dedupe against `performance.browser.*`, and strict `evidenceKind` separation (`current-page-lab` vs `psi-audit` vs `crux-field`).
4. Product rule: PSI failure must never block scan success; Frank must not treat lab as field CWV.
5. This batch delivered more user value via **iframe QA**, **safe interaction checks**, and **cross-origin resource policy** than an optional PSI connector would.

## If revisited later

- Env only: `PSI_ENABLED=false` (default), `PSI_API_KEY` server-side secret
- Never extension-side; never client-visible secret
- Timeout (~15s), request budget, graceful degrade
- Bounded normalized output only — no raw PSI payload in Frank / Report Bug
- CrUX block omitted when unavailable (say unavailable; do not invent field metrics)
- Policy: Worth Checking / context lane; never auto-blocker from PSI alone
- Dedupe against native lab findings before Recommended Order

## Current production performance path

- **current-page-lab** — extension + renderer PerformanceObserver / navigation timing
- **historical-monitor** — Performance Monitor connector (when configured)
- **psi-audit / crux-field** — not implemented (`psi.unavailableReason: deferred-native-lab-sufficient`)
