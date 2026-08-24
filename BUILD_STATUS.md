# Build status: Web QA Assistant 1.7.2

## Delivery candidate

1.7.2 is the target-integrity patch release on top of the 1.7.1 cross-discipline workspace. It keeps deterministic evidence authoritative when the renderer receives a Cloudflare challenge or other substituted document instead of the requested page.

## Release objectives

- Present a page-level QA assessment before scanner details.
- Give Navigation, Discoverability, Performance, Accessibility, Security, Web quality, and Coverage clear first-class roles.
- Translate scanner evidence into useful product language while retaining auditable technical evidence.
- Keep Frank focused on interpretation and action rather than scanner restatement.
- Generate privacy-safe Report bug artifacts that make real-Chrome runtime behavior reviewable without direct browser access.
- Prevent the noisiest scanner from owning the priority queue.
- Preserve on-device AI, deterministic fallback, managed gateway access, and zero-metered-AI defaults.

## Validation

Exact final test/check/build/release results are recorded during packaging in `RELEASE_PROVENANCE.txt` and `docs/QA-1.7.0.md`.

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
