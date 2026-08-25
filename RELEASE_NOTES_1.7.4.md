# Web QA Assistant 1.7.4

## Cross-discipline QA, workspace redesign, and diagnostic tooling

1.7.4 delivers a page-assessment-first workspace, cross-discipline issue correlation, expanded navigation and runtime QA, safe external link probing, Ask Frank focus mode, and a privacy-bounded Report Bug v2 diagnostic bundle with read-only MCP inspection.

## QA workspace / UX

- Redesigned side panel as a SaaS-style page-assessment workspace with clearer hierarchy between page summary, Recommended Order, and technical evidence.
- Recommended Order interleaves material findings across QA areas instead of letting the noisiest scanner dominate.
- Cross-discipline presentation keeps Navigation, Discoverability, Performance, Accessibility, Security, Web quality, and Coverage visible as first-class areas.
- Loading, blocked, and partial-coverage states report honestly instead of implying a clean pass.

## Ask Frank

- Focus mode closes the side panel while Frank guides on-page, with Return to QA restoring the prior workspace state.
- Element spotlight, document-level, and markup guidance paths with explicit handling when targets cannot be highlighted.
- Accessibility and focus improvements in the walkthrough card; sidebar remains the evidence ledger while the center card owns explanation.
- Non-highlightable, hidden, ambiguous, and document-level targets are explained rather than silently skipped.

## Cross-discipline correlation

- Shared issue correlation model groups duplicate occurrences by root cause while keeping distinct problems separate.
- Scope and targetability flow into Recommended Order and Frank planning.
- Worth Checking Further surfaces review-lane items—including inconclusive link review—without treating them as confirmed defects.
- Markup and document-level Frank guidance for SEO, language, and structural findings.

## Links / navigation

- Internal, external, fragment, and malformed URL checks with duplicate-destination grouping.
- Navigation and CTA context raise materiality for prominent links.
- Conservative 403/429 handling: inconclusive review findings, never labeled broken.
- Safe gateway external destination probing with SSRF/DNS protections, redirect validation, and private-address rejection.
- Dual-GET confirmation before confirming external broken links.
- Universal host access is not required for privileged link checking when connected to the gateway.

## Performance

- Current-page lab observations for LCP, TTFB, transfer bytes, and resource counts when renderer metrics exist.
- LCP element/resource correlation and oversized-image detection using rendered and intrinsic dimensions where available.
- Broken-image and transfer-context findings tied to verified evidence.
- Lab cumulative layout shift detection where implemented; coverage reports `current-page` or `partial` honestly.

These are **current-page lab observations**, not field Core Web Vitals or real-user data.

## SEO / dev / UX / forms / runtime

- Mixed-content detection for insecure subresources on HTTPS pages.
- Runtime script/stylesheet/preload failure correlation with conservative same-origin classification.
- Form QA: missing submit controls, nested forms, and related UX signals.
- Hreflang validation including relative and x-default handling.
- Viewport overflow correlation with document-level root-cause grouping.
- Inert-link and javascript:void handling with role-aware exceptions.
- Discoverability contradictions and markup findings with sanitized evidence.

## Report Bug / diagnostics

- Report Bug v2 sanitized diagnostic bundle with bounded sections and explicit scan/coverage metadata.
- Page errors (`page_error`, `resource_failure`) separated from WebQA errors (`webqa_error`).
- Coverage degradation includes machine-readable reasons (for example probe-budget-exhausted, runtime-not-captured-in-extension).
- Frank diagnostic metadata exposes provenance and fallback state only—no prompts or full plans by default.
- Bounded, ordered timeline with truncation metadata.
- Read-only MCP tools: `webqa_latest_diagnostic`, `webqa_diagnostic_section`, and `webqa_read_report_bug` for Cursor agent inspection.

## Security / privacy

- Safe external probing with DNS pinning, redirect revalidation, and private/local/metadata address blocking.
- URL sanitization strips query values, fragments, and userinfo while preserving useful origin/path context.
- Diagnostic exports exclude cookies, credentials, form values, selectors, raw HTML, and local filesystem paths.
- Narrow Cursor auto-run allowlist for exact diagnostic tool names only.

## Known limitations

- PageSpeed Insights (PSI) diagnostic enrichment is **not** implemented.
- No full field Core Web Vitals or paid performance API integration.
- Soft-404 detection remains limited; HTTP status alone may not distinguish empty shells from real content.
- Shadow-DOM and iframe fragment targets have known resolution limits.
- Runtime-failure correlation for cross-origin CSS/JS remains conservative.
- Private/local service-worker probe behavior may differ from gateway probing.
- Extension runtime error capture may begin after content-script injection.
- An empty `failedResources` list is not proof of a perfect network pass.
- Cloudflare-gated sites may remain blocked at the gateway renderer while a normal browser session reaches the real page; target integrity handles this safely but does not guarantee scan completion.

- Target-integrity behavior for blocked, challenge, and substituted pages from 1.7.2–1.7.3 remains intact.
- Production deployment: live on v1.7.4 at `ccdcddc` (post-release `undici` hotfix on `origin/main`). Tag `v1.7.4` alone omits that dependency fix.
