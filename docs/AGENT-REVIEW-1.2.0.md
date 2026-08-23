# Three-agent release review: 1.2.0

The next release was reviewed from three separate product lenses before packaging.

## SEO / technical search agent

### Gate
PASS

### Findings that changed the build
- Environment must affect interpretation, but Frank must not become a launch-only checklist.
- `noindex` cannot have one global severity. It is expected on clear staging/preview/local environments, severe on primary production pages, and often intentional on utility/transactional pages.
- A staging canonical pointing to the related production domain can be expected. A canonical pointing to a different site family must not be automatically suppressed.
- Broken internal links are higher-value than length heuristics and many metadata optimization observations.
- Automated link failures must distinguish confirmed HTTP failures from checker timeouts.
- Slight title/description length issues should remain quiet rather than dominating Frank.

### Release conclusion
The policy layer now reflects these distinctions. SEO signals remain visible in the full scan even when Frank suppresses them.

## Senior developer agent

### Gate
PASS, with real-browser acceptance required

### Findings that changed the build
- Public subdomains such as `app.example.com` should not be guessed as production when the hostname provides no strong environment signal.
- Link auditing inside the first `SCAN` call could exceed the side-panel timeout on slow pages. Link validation now runs during enrichment.
- Persisting lifecycle before connected enrichment caused connected findings to appear resolved and then new again. State is now persisted after full enrichment.
- Frank target IDs remain the source of truth for visual elements; stale targets downgrade to page-level guidance.
- The obsolete Explain API/runtime increased regression surface and was removed.
- The standalone renderer should not require a Playwright-managed browser when a compatible local Chrome/Chromium is already installed.
- A crashed renderer browser must be restartable instead of leaving a permanently rejected browser promise.

### Release conclusion
Static checks, extension build checks and the automated suite pass. Outbound public rendering remains a manual/deployment QA item because the build sandbox blocks browser navigation.

## Product / PM agent

### Gate
PASS

### Findings that changed the build
- Frank should be selective. The scanner may be exhaustive, but the default UI should emphasize material, actionable issues.
- Users still need access to quiet observations, so Show all checks remains explicit on both extension and web surfaces.
- Environment inference should be visible but low-friction, with a correction control rather than a setup wizard.
- Finding cards need clear blocker/high priority cues.
- A no-material-findings state is better than an empty panel.
- Broken-link findings should tell the user which link failed and where it appears, not simply return an HTTP code.
- Exported reports should preserve environment context.

### Release conclusion
The product still presents Frank as a general QA assistant. Environment is context, not a workflow mode.

## Release gate summary

- SEO agent: PASS
- Senior developer agent: PASS
- Product/PM agent: PASS
- Automated tests: 34/34 PASS
- Extension build: PASS
- Manual Chrome/deployment acceptance: REQUIRED
