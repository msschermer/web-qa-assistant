# Boss delivery summary: Web QA Assistant 1.5.1

## Decision

**PASS as the 1.5.1 delivery candidate, with real-browser/production deployment acceptance still required.**

1.5.1 preserves the complete 1.5.0 product revision and improves the areas raised in acceptance: multi-discipline prioritization, Frank recommendation quality, browser performance evidence, integration health, visual hierarchy, compact in-page guidance, and release/deployment hygiene.

## What remains from 1.5.0

- six-class impact model and round-robin attention composer
- duplicate grouping and cross-discipline impact ledger
- conservative image-purpose classifier
- interpretation-first Frank recommendation contract
- browser performance discipline
- distinct integration health/auth states with capability-level probes
- redesigned side panel and compact orientation overlay
- portfolio Docker/Caddy deployment override

## 1.5.1 quality improvements

- the actual image classifier -> semantic context -> evidence -> Frank path retains adjacent text, closing the motivating decorative-image regression
- LCP uses a buffered `PerformanceObserver` and can identify the observed LCP element
- transfer weight is explicitly labelled as a lower bound when cached/cross-origin transfer sizes are unavailable
- Frank has separate evidence-led TTFB, LCP, and payload guidance
- deterministic guidance is expanded across SEO, structure, security, web-platform, and social findings
- outbound Frank evidence uses an explicit allowlist and nested URL sanitization
- the server-side renderer now loads the same image-purpose classifier as the extension
- release metadata consistency and synthetic fixture hygiene are automated gates
- integration health now exercises each tool's real capability endpoint instead of assuming a `/health` route
- the acceptance fixture uses reserved example domains and synthetic identities only

## Automated result

- 113/113 tests PASS
- `npm run check` PASS
- `npm run build:extension` PASS
- `RELEASE_TAG=v1.5.1 npm run release:validate` PASS

The current environment did not complete a fresh `npm ci` within the execution window, so dependency installation from the registry is not represented as a pass here. The built extension itself was regenerated successfully using the locked axe-core artifact already present from the prior verified build, and source installation remains reproducible from `package-lock.json`.

## Remaining manual gates

Use `docs/QA-1.5.1.md` for Chrome acceptance and verify the production gateway/deployment. Do not treat the unavailable headless-browser smoke in this environment as a product failure or as a completed browser acceptance pass.
