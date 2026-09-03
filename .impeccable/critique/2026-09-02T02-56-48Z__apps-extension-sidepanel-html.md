---
target: apps/extension/sidepanel.html
total_score: 18
max_score: 40
na_heuristics: 
p0_count: 1
p1_count: 3
timestamp: 2026-09-02T02-56-48Z
slug: apps-extension-sidepanel-html
---
Method: dual-agent (A: a86f94d40a6dea722 · B: a4e4868449d7377b0). Target: apps/extension/sidepanel.html + .css + .js. Mode: Operate.

## Design Health Score

| # | Heuristic | Score | Key Issue |
|---|---|---|---|
| 1 | Visibility of System Status | 2 | `#notice`, the single global status channel, has zero CSS in source and dist. No persistent scan timestamp. |
| 2 | Match System / Real World | 2 | "Target integrity" jargon, raw coverage keys rendered verbatim, retired "WebQA" name in three user-facing strings. |
| 3 | User Control and Freedom | 1 | Scan against client production cannot be stopped. Both escalations call window.close(). Ignore-rule has no undo. |
| 4 | Consistency and Standards | 2 | Impact class named differently at idle vs results. Button spec drifts on four properties. "Scan page" vs "Scan Site". |
| 5 | Error Prevention | 2 | Borderless transparent select triggers full production rescan with no confirm (sidepanel.js:1423-1430). |
| 6 | Recognition Rather Than Recall | 2 | Confidence chip has no tooltip (sidepanel.js:627-635) though the class chip does; contradicts DESIGN.md Confidence Dot spec. |
| 7 | Flexibility and Efficiency | 1 | Zero keyboard shortcuts, no manifest commands, no keydown handlers, no presets, no cross-site history. |
| 8 | Aesthetic and Minimalist Design | 2 | Coherent and token-driven, but the default view is ~65% empty canvas and a warn chip sits permanently on the verdict card. |
| 9 | Error Recovery | 2 | Targeted auth recovery, but no inline retry and every message lands in the invisible #notice. |
| 10 | Help and Documentation | 2 | No confidence-vocabulary explanation. Privacy fine print ships Cursor developer instructions (sidepanel.html:199). |
| **Total** | | **18/40** | **Poor — major UX work required** |

Assessment A scored heuristic 8 a 3; lowered to 2 on screenshot evidence A did not have.

## Design Specificity Verdict

Specific in its language, generic in its composition. Identity lives in the copy and data model, not the design.

Unfakeable: the coverage render treats attempted/eligible/unprobed/inconclusive as first-class; refuses to infer a historical monitor from lab coverage; states its own limits in plain English. The scan-lifecycle gate structurally forbids rendering partial results.

Category-interchangeable: sticky translucent header with backdrop-filter blur and radial-gradient ring brand mark; 2x2 icon-tile quick-actions grid giving "Report bug" the same weight as "Copy report"; six section heads in one identical 13px uppercase treatment.

DESIGN.md nominates Metric Tile and Severity Rail as the identity components. The panel has zero metric tiles and zero instances of the 19px Metric type, in a tool whose job is counting. tabular-nums appears twice in 27.5KB of CSS, so performance decimals do not align. --wqa-violet is declared in tokens and consumed nowhere, though DESIGN.md reserves it for reasoning affordances (Principle 1 as a color).

Deterministic scan: 0 findings on HTML (exit 0), 19 on HTML+CSS (exit 2) — 3 warnings, 16 advisory, all in CSS. Ran DEGRADED: htmlparser2, css-select, domutils missing, so contrast was never evaluated, var() never resolved, selector matching never ran. An independent css-tree parse showed the detector reported 8 off-ramp font-size declarations across 3 values where the reality is 53 across 8 values; it missed 12px used 34 times, and two undocumented colors (#EEF4F8, #C5D6E6). Treat 19 as a sample, not a census.

False positives discarded: the 2 side-tab warnings are the DESIGN.md-mandated Severity Rail; layout-transition at :142 is a 3px determinate progress bar with no child content, neutralized by prefers-reduced-motion at :183; the 2px radius flag is on a 3px decorative stripe. Line 173 is 1,759 characters, so six findings collapse onto one useless locator.

Runtime: extension rebuilt (buildRevision=f7756f799ae6), real Chrome 151, panel captured at .autoqa/runs/driver/sidepanel.png (420x900). No script injection attempted, so no user-visible overlay.

## Overall Impression

Real craft, in an unusual place: the honesty layer. Coverage accounting, refusal to render partial results, hiding actions that would lie about capability. Then the design drops it — the flagship view is a title, a sentence, seven chips, and ~590px of empty canvas out of 900, violating DESIGN.md's own Earned Space Rule. Biggest opportunity: the differentiator is built and then withheld at every moment it would pay off.

## What's Working

1. Result gating as evidence discipline — results structurally forbidden until shouldRevealResults() passes; CSS hides both export buttons during a scan, making a partial result impossible to copy or screenshot.
2. The coverage render is the positioning made literal, including honest labelling of lab measurements.
3. Actions are hidden when they would lie (recheckButton.hidden for inconclusive, highlight.hidden when nothing is targetable).

## Priority Issues

### [P0] The error channel is invisible, and a failed rescan silently republishes stale results

#notice is the target of ~30 notice() calls; no #notice selector exists in source or dist. notice() sets dataset.kind='error' and nothing consumes it. At sidepanel.js:1280-1297, when enrichment fails and a prior report exists, the failure goes to the invisible notice and the previous report is re-rendered, with no timestamp and no staleness marker. The user hands a stale report to a paying client without knowing. #notice is aria-live="polite", so failures announce at the same urgency as progress.

Fix: style #notice[data-kind] with the four tonal treatments in the tokens, text label plus icon; role="alert" for errors; a persistent banner naming the real scan time on the stale path; permanent "Scanned HH:MM" in .brief-meta.
Command: /impeccable harden

### [P1] A scan running against a client's production site cannot be stopped

rescan() only disables #scan, with 45s scan and 120s enrichment timeouts. No cancel control exists in the markup. The panel also hides recommendations, coverage, session and export regions during the scan. DESIGN.md's Button spec defines a Danger variant for "Cancel audit, Stop" and the panel has none.

Fix: a Danger-variant "Stop scan" replacing the disabled button, aborting the in-flight request and dropping back to idle with the prior report intact; determinate progress from the completed/queued numbers the link phase already reports.
Command: /impeccable harden

### [P1] The client deliverable drops the one thing that makes Lumen defensible

markdown() (sidepanel.js:380-393) emits no coverage, no limitations, no timestamp. Everything the coverage panel builds is absent from the handoff artifact. The button is labelled "Plain-language handoff" but outputs Markdown with ### headers and backticked selectors.

Fix: add a "Coverage and limitations" section from the same accounting data, plus a timestamp; give "Copy report" a preview dialog.
Command: /impeccable harden

### [P1] Both escalations destroy the panel, and the in-panel walkthrough is only reachable when a storage call fails

"Walk through" and "Scan Site" both call window.close() with no label warning. enterFrank() is defined at sidepanel.js:893 and called at exactly one site, sidepanel.js:1102, inside if (!snapshot.ok). The entire in-panel walkthrough view (~16% of the markup, with evidence blocks, role="progressbar", step counter, four utility buttons) is dead code in the happy path.

Fix: label the transition on the control with a departure glyph; make the in-panel walkthrough the default for single-finding review; reserve the page takeover for steps that need the page.
Command: /impeccable clarify

### [P2] The layout inverts the product's own priority model, and the default view is mostly empty

#performance-card renders above the page assessment, placing one scanner above the whole-page judgment (Principle 4). All six section heads are identical 13px/700/uppercase. No Metric type anywhere; tabular-nums used twice. The idle state is ~310px of content in a 900px panel.

Fix: move Performance below the assessment and demote it to a metric-tile row; give the assessment Display-level dominance; add tabular-nums to every count; fill the idle view with recent scans / last result / what changed, or make the panel shorter.
Command: /impeccable layout

## Persona Red Flags

Alex (impatient power user): no keyboard path at all — no manifest commands, zero keydown handlers, no Enter-to-scan, no j/k navigation. "Copy report" buried in Workspace tools below the entire findings list, styled identically to "Report bug". Changing Environment forces a full rescan to re-sort a list. No recent-scans list, no saved config, no per-client profile. One win: pointerenter prewarms the local AI runtime.

Sam (accessibility-dependent): .dialog-close ~22px (under 24x24), .btn-text ~20px, .linkish ~17px with up to 36 instances. Pressing "Scan page" disables the focused button, dropping focus to body for up to 2.5 minutes with no restore. #ledger is a div with aria-label and no role, so the name is dropped, while .tool-grid five lines below uses role="group" correctly. .ledger-dot carries severity by hue alone. Filtering 12 findings to 3 is announced to nobody. Foundations are good: global :focus-visible never removed, correct .sr-only, prefers-reduced-motion honored, native dialog. Credibility risk: Lumen ships a check named "Clickable target is too small or tightly spaced".

Priya (consultant defending a billed recommendation): the confidence chip has no title while the class chip does, so the closed vocabulary is displayed and never defined. The evidence surface is a details block with raw ruleId, CSS selector and JSON.stringify(evidence), all monospace — not client-showable. "Did you check everything?" is a collapsed panel reading "22/30 accounted" over Object.entries(report.coverage) dumped verbatim. No provable scan time. Retired "WebQA" name in three user-facing strings. Privacy fine print instructs her "For Cursor debugging, download the JSON and save it under qa-runs/" — the development workflow shipped to a paying external user.

## Minor Observations

- Real bug: const notice = env.notice || null at sidepanel.js:567 shadows the global notice() for the body of renderUnsafe(), so the .ignore handler at :744 throws. "Ignore this rule on site" applies a persistent, site-wide, undoable suppression with zero confirmation, and there is no un-ignore path.
- Rail color and priority label derive from different rules; a severity 'high' finding can show a neutral info rail beside a "High priority" chip.
- .brief has a box-shadow (violation) while the two sticky headers the Ambient-rest shadow is reserved for have none.
- The brief's 3px rail is teal by default then severity-colored by state — Two-Voice broken on one selector. The walkthrough progress bar is brand blue where DESIGN.md assigns Instrument Teal.
- A blocked/WAF'd target paints its rail --wqa-critical, the same red as a confirmed defect, contradicting Principle 2.
- Two bordered-inside-bordered violations: .settings-toggle in .panel, .context-optin in .bug-card.
- Off-scale spacing (18, 7, 9, 11, 13px) against a 4/8/12/16/24 commitment; .idle-state padding 28px exceeds the ceiling.
- .app-id p truncates the hostname to 220px with an ellipsis — the one string identifying which client site is under audit.
- The Environment select is focusable and changeable pre-scan but silently does nothing, and is styled border:0/transparent despite triggering a production rescan.
- confidenceLabel() accepts 'observed' and 'needs-review' — two invented confidence words in the display layer.
- Smallest text is 10px (6 declarations) plus 4 at 10.5px, below every documented step in the type ramp.
- No dark mode; deliberately committed to light via color-scheme:light. A decision to make consciously.

## Questions to Consider

1. Why does the panel close itself on the two actions users take most? Home, or launcher?
2. The entire in-panel walkthrough is only reachable when a storage write fails. Fallback, or the walkthrough you actually wanted before the overlay won?
3. Coverage is the best in the category and is absent from the export. Is it for the operator's confidence or the client's?
4. DESIGN.md reserves violet for reasoning so interpretation stays distinct from evidence. The tokens are used nowhere. Did the principle lose to convenience?
5. What color is "we could not see"? A blocked target currently gets critical red; the palette has Info Blue and Muted Steel.
6. Lumen audits target size, color-only meaning and accessible names, and its own UI fails all three. What does that cost the first time a client runs Lumen on Lumen?
