# Agent review: Web QA Assistant 1.5.0

Four review lenses were applied to the 1.4.0 acceptance findings and then re-applied
to the resulting implementation. This document records what each lens asked for,
what was built, and — where the lens's original request was not implemented as
stated — why.

---

## SEO / QA lens

**Finding.** The issue feed was skewed toward accessibility. Individual axe findings
consumed the attention budget, so broken links, indexing and performance signals
could be crowded out entirely.

**Built.**
- `packages/findings/impact.js` assigns every finding an impact class describing
  what it threatens (availability, discoverability, accessibility, performance,
  implementation, coverage) rather than which tool produced it.
- `packages/findings/compose.js` groups duplicates, then interleaves across classes
  so every represented class contributes its strongest group before any class
  contributes a second.
- Materiality is class-blind. A category cannot buy rank by producing more rows.

**Deliberate constraint.** Classes are never padded. If nothing material exists in
a class, it does not appear. Guaranteed *representation* was implemented; guaranteed
*quota* was rejected, because showing "one of each" would make the feed mechanical
and would imply a problem exists where none was found.

**Regression locked in.** `tests/attention-composer.test.js` asserts that five axe
findings plus one confirmed navigation 404 produces a feed where availability leads.

---

## Senior developer lens

**Finding.** Frank's evidence graph was technically grounded but semantically
shallow. It knew the failed rule and element, but not enough about surrounding
meaning, accessible naming, page role or live performance.

**Built.**
- `semanticContextFor()` in `packages/rules/browser-rules.js` captures accessible
  naming (role, aria-label, labelledby text, associated label, interactive ancestor,
  containing landmark) and parent container context.
- `packages/rules/image-purpose.js` classifies image purpose deterministically from
  DOM relationships, rendered size, naming hints and adjacent text.
- `performanceSignals()` adds current-page Navigation Timing, paint timing, transfer
  weight and heaviest resources.
- All of it flows into the evidence graph as `browser` / `browser-performance`
  sourced evidence, so any recommendation built on it is auditable.

**Requested but not implemented: target screenshot crops sent to multimodal reasoning.**

This was evaluated and rejected on three grounds:

1. **Permission model.** `chrome.tabs.captureVisibleTab` requires `<all_urls>` or
   broad host permissions. `scripts/check.mjs` currently fails the build if `tabs`
   appears in the manifest and pins `host_permissions` to exactly three entries.
   Implementing capture would mean deleting an existing release gate that exists to
   keep the extension's permission surface minimal.
2. **Data boundary.** The AI Evidence Contract is built on explicit rules:
   `wholeDomAllowed: false`, `formValuesAllowed: false`, `cookiesAllowed: false`.
   A viewport capture carries all three as pixels. Cropping happens after capture,
   so the full-viewport image exists in the extension regardless of what is sent.
3. **Marginal value on the motivating case.** The regression that prompted the
   request is resolvable from the DOM alone: a sibling text node already states what the icon means.
   Vision adds nothing the accessible-name computation does not already have.

A build gate now fails if `captureVisibleTab`, `getDisplayMedia` or `html2canvas`
appear in extension source, so this decision does not silently erode.

**Requested but deferred: live PageSpeed Insights on demand.** A live PSI call takes
10–30s, requires an API key, and measures the public URL rather than the page being
inspected — so it fails on staging, authenticated and preview pages, which is exactly
where this tool is used. Browser-side measurement was implemented instead. Live PSI
remains a reasonable future addition for confirmed public URLs.

---

## Product manager lens

**Finding.** Five nearly identical axe findings made the product feel like an
accessibility extension rather than a web QA assistant.

**Built.**
- Repeated instances of one rule collapse into one group with an instance count and
  an expandable list of affected selectors. Six controls missing accessible names is
  one problem with six instances, not six problems.
- Two different broken destinations remain two problems, because they are.
- The brief now reads across areas: *"3 issues need attention across 3 areas. Start
  with …"*
- The side panel's headline metric shows grouping honestly: `N grouped from M findings`
  when they differ.

**Signature surface.** The impact ledger under the brief shows counts per area and
filters the feed on click. It is the visible answer to "why is this not just axe".

---

## UI / UX / brand lens

**Finding.** The build looked like an engineering prototype. The duplicated
side-panel plus floating Frank remediation card was the worst offender.

**Built.**
- New token system: quiet neutral canvas, elevated white surfaces, restrained navy
  brand, 6–12px radii, semantic soft-tint chips, left-edge severity accents replacing
  top severity bars, substantially reduced visible chrome.
- IBM Plex Sans carries everything a person reads. Mono is reserved for what a person
  copies: selectors, rule IDs, HTTP codes, scores.
- The page overlay is now orientation only — brand mark, progress, one short line,
  Back/Next. Narrative, evidence and remediation live in the side panel. A build gate
  fails if the overlay starts rendering both a headline and a body again.
- Sentence-case copy throughout. Active voice on controls. Empty and failure states
  say what happened and what to do.

**Known limitation.** IBM Plex is referenced but not bundled, and no webfont is
loaded. On a machine without Plex installed the stack falls back to `system-ui`.
The fallback stack was tuned so this still reads as deliberate, but bundling the
woff2 subset is the correct fix if brand consistency matters. See release notes.

---

## Boss lens

**Bar set:** *"Frank should not merely know what rule failed. Frank should understand
enough of the page to tell an engineer what to do about it."*

**Met on the known-answer case.** The acceptance regression — a small check icon
beside visible text that already states its meaning — now produces:

> **What this element is doing.** This image reinforces the adjacent text
> "<adjacent label>" and does not appear to carry information of its own.
>
> **What I would change.** Set `alt=""` on this image so assistive technology skips
> it. Do not write descriptive text here, because the adjacent visible text already
> communicates the meaning and announcing both would repeat content.
>
> **What I ruled out.** A descriptive alt would be correct only if this image conveys
> something the surrounding text does not. The evidence does not support that here.

No fork.

**Safety property that constrains the above.** Wrongly recommending `alt=""` deletes
meaning from a page — an accessibility regression caused by our own tool, which is
worse than presenting a choice. The classifier therefore requires corroborating
signals and the absence of any contradicting signal before returning a confident
verdict. An icon-named image rendered at content size returns `uncertain`, and Frank
keeps the fork. This is asserted directly in `tests/image-purpose.test.js`.

---

## Defects carried in from 1.4.0 acceptance

| Defect | Status |
| --- | --- |
| Integration health reported HTTP 404 as `available` | Fixed. `available` / `unauthorized` / `not-found` / `degraded` / `unavailable`, each with an actionable detail string. |
| Test connection could not distinguish public reachability from protected auth | Fixed. Reachability and authorisation are probed and reported separately, with per-integration rows in the panel. |

Both are covered by `tests/integration-health.test.js`, including a negative
assertion against the original `res.ok || res.status < 500` expression.

---

## Release decision

Version incremented to **1.5.0** rather than continuing on 1.4.0. The prior guidance
was that 1.4.0 had never been merged so no increment was needed. That reasoning does
not hold once a 1.4.0 candidate is deployed to the droplet and loaded in Chrome: with
both builds in circulation and materially different behaviour, a shared version
number makes it impossible to tell which artifact is running from `/api/health` or
`chrome://extensions`.

`feature/final-product-pass` still should not merge to `main` until
`docs/QA-1.5.0.md` passes in a real browser.
