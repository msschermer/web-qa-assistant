# Build status: Web QA Assistant 1.7.3

## Delivery candidate

1.7.3 is the product-quality attention and coverage-honesty release on top of the 1.7.2 target-integrity baseline. It keeps deterministic evidence authoritative while balancing Recommended Order across QA areas and reporting lab performance coverage honestly.

## Release objectives

- Present a page-level QA assessment before scanner details.
- Give Navigation, Discoverability, Performance, Accessibility, Security, Web quality, and Coverage clear first-class roles.
- Translate scanner evidence into useful product language while retaining auditable technical evidence.
- Keep Frank focused on interpretation and action rather than scanner restatement.
- Generate privacy-safe Report bug artifacts that make real-Chrome runtime behavior reviewable without direct browser access.
- Prevent the noisiest scanner from owning the priority queue.
- Preserve on-device AI, deterministic fallback, managed gateway access, and zero-metered-AI defaults.
- Keep performance coverage honest when current-page lab metrics exist.
- Preserve uncertainty for unresolved image purpose without blocker inflation.

## Validation

Exact final test/check/build/release results are recorded during packaging in `RELEASE_PROVENANCE.txt`. Candidate product commits on frozen `main` before this metadata bump: `d1edd41`, `f82f50b`, `bf14fa2`, `d3aa3b9`.

## 1.7.3 product quality

- Demote uncertain image-alt from blocker materiality while keeping informative/functional cases strong.
- Suppress title/lang axe twins when the clearer browser finding is already visible.
- Represent blank-opener as visible low-priority security in Recommended Order.
- Resolve lab performance coverage to `current-page` when renderer metrics exist.
- Re-apply local finding policy in review-bundle recomposition for MCP validation consistency.
- Sanitize query/hash from browser performance resource URLs.
- Tighten Frank contrast and uncertain-image guidance without inventing certainty.

## 1.7.2 target integrity

- Detect when the renderer receives a challenge/interstitial or blocked response instead of the requested page.
- Withhold page-derived SEO, accessibility, link, and Recommended Order conclusions for blocked or substituted targets.
- Report honest coverage (`blocked`, `not_applicable`, `incomplete`) instead of complete-with-zero-links false positives.
- Package integrity runtime modules in the renderer Docker image.
- Declare stable shared-network alias `web-qa-api` for durable Caddy routing across container recreates.

## 1.7.1 target resolution

Merged from the alternate 1.6.1 branch and revised in review.

- Resolution is a staged chain: live reference, selector with fingerprint
  disambiguation, relaxed ancestor paths, structural fingerprint. Open shadow
  roots are searched on the miss path.
- Several matches with no way to tell them apart resolve to nothing. The old
  first-match floor was removed: a confident wrong highlight is worse than none.
- Nothing is written to the inspected page. The persistent marker attribute
  proposed in the alternate branch was dropped as unnecessary.
- Steps retry a failed resolution at 300ms, 800ms and 1600ms, cancelled on step
  change, and offer a manual retry.
- Unresolved, hidden and document-level targets are distinguished and explained
  in the focus card rather than failing silently.
- resolvedTargetState reports which stage resolved a target, for Report bug.

### Known gaps

- A shadow-root element that is replaced after the scan is still unresolvable:
  the fingerprint stage searches only the main document and the relaxed path
  splitter does not parse axe's `>>>` format.
- Shadow-root discovery is uncached and runs per resolution attempt.
- Iframe content remains untargetable; the content script runs in the top frame.
- Cloudflare-gated sites may remain blocked at the gateway renderer while a normal browser session reaches the real page; target integrity now handles that safely but does not guarantee scan completion.
- Deferred from 1.7.3: UI redesign, LCP/TTFB threshold retuning, broader duplicate-family work, per-node image-purpose for aggregated axe rows, field CWV / paid performance APIs.
