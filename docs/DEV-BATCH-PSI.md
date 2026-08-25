# PSI / CrUX enrichment — deferred (development batch)

## Decision

Optional live **PageSpeed Insights (PSI)** and **CrUX field CWV** enrichment remain **deferred** for this development batch.

## Why not implemented now

1. **No existing PSI API plumbing** — the repo integrates with the historical Performance Monitor (`PERFORMANCE_MONITOR_URL`) for trend context, not on-demand PSI/Lighthouse API calls.
2. **Unique value vs lab evidence** — current-page lab signals (LCP, CLS, TTFB, transfer weight, image oversize, LCP-resource correlation) already cover the highest-value *current-page* performance questions without an external API key or scan latency.
3. **Architecture cost** — PSI adds server-side API key management, timeout/budget handling, normalization of a large audit surface, and deduplication against native findings. CrUX adds field-data availability windows and must never be conflated with lab observations.
4. **Product rule** — Frank and Recommended Order must not treat lab evidence as field CWV; PSI failure must degrade gracefully and never block scan success.

## What would be required for a future batch

- Env: `PSI_API_KEY` (server-only), strict timeout (~15s), optional enable flag default **off**
- Connector in `packages/connectors/` returning normalized audit diagnostics only (render-blocking, unused JS/CSS, image delivery) with explicit `evidenceKind: psi-audit`
- Separate CrUX field block with availability metadata when Google returns field data; omit when unavailable
- Policy: Worth Checking / context lane, never auto-blocker from PSI alone
- Tests: normalization fixtures, no API key in extension, dedupe against `performance.browser.*` lab findings

## Current production performance path

- **CURRENT-PAGE LAB** — extension + renderer PerformanceObserver / navigation timing
- **HISTORICAL MONITOR** — Performance Monitor connector (when configured)
- **PSI / FIELD** — not implemented
