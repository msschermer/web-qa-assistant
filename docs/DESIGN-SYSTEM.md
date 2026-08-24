# UI / UX / brand system

## Product posture

Web QA Assistant should feel like a senior engineering review surface, not a generic scanner dashboard or AI chatbot. Frank is a restrained guided-investigation layer, not a mascot.

## Visual language

The extension and web app share `packages/ui/tokens.css` and the portfolio visual system:

- paper background
- near-white surfaces
- dark ink typography
- restrained engineering blue
- green for resolved/healthy states
- status colors supplemented by text so color is never the only meaning
- IBM Plex Sans and IBM Plex Mono fallbacks

## Information hierarchy

1. **Frank judgment**: what deserves attention now
2. **material findings**: human-readable problem, confidence and context
3. **actions**: Ask Frank, Highlight, Recheck, Copy issue
4. **coverage**: what was and was not successfully checked
5. **technical details**: rule IDs, selectors and raw bounded evidence behind progressive disclosure

## State language

Use:

- `Evidence summary` for the scan overview, which does not imply that an AI request occurred
- `On-device reasoning` when Chrome built-in AI improved a walkthrough locally
- `Cloud reasoning` only when the optional metered cloud fallback was explicitly enabled and succeeded
- `Verified guidance` for deterministic Frank when local AI is unavailable, still preparing, or fails evidence-quality validation
- `Confirmed`, `Corroborated`, `Inferred` for evidence strength
- `Incomplete coverage` for checker uncertainty

Do not turn inability to verify into a defect.

## Frank walkthrough

The predictable conceptual grammar is:

`Found / Evidence -> Impact -> Fix -> Verify`

Comparison/trend steps are inserted only when supported. Recheck is available at the verification step when the product can test the selected condition again.

## Accessibility requirements

- all actions keyboard accessible
- visible focus state
- no status communicated only by color
- Frank dialogs/overlays trap focus while active and restore focus on close
- Escape exits Frank
- status changes use appropriate live regions
- narrow side-panel widths remain usable
- reduced-motion preferences are respected where animation is used


---

# 1.5.0 revision

The 1.4.0 skin read as an engineering prototype: monospace headings, 2px radii,
hairline borders around every component, all-caps micro-labels, and top severity bars.
1.5.0 replaces it.

## Tokens

Defined in `packages/ui/tokens.css`, copied into the extension build as
`ui-tokens.css`. Legacy `--wqa-*` aliases are retained so any unmigrated rule degrades
to the new palette rather than to an unstyled browser default.

| Role | Token | Value |
| --- | --- | --- |
| Canvas | `--wqa-canvas` | `#F1F4F8` |
| Elevated surface | `--wqa-surface` | `#FFFFFF` |
| Sunken surface | `--wqa-sunken` | `#F7F9FB` |
| Primary ink | `--wqa-ink` | `#101828` |
| Secondary ink | `--wqa-ink-soft` | `#475467` |
| Tertiary ink | `--wqa-ink-faint` | `#8A94A6` |
| Hairline | `--wqa-line` | `#E4E9F0` |
| Brand | `--wqa-brand` | `#12395E` |
| Critical | `--wqa-critical` | `#B42318` |
| Warning | `--wqa-warn` | `#B54708` |
| Healthy | `--wqa-ok` | `#067647` |

Radii: `6px` controls, `8px` cards, `12px` the brief and overlay, `999px` chips.

## Typography

IBM Plex Sans carries everything a person reads, including headings. IBM Plex Mono is
reserved for what a person copies or compares character by character: selectors, rule
IDs, HTTP codes, scores, evidence values, diagnostics.

Moving headings out of mono is the single largest contributor to the change in
character. Mono headings were the main reason the panel read as a debug surface.

Plex is not bundled and no webfont is loaded, so the stack falls back to `system-ui`
where Plex is not installed. The fallback order was chosen so this still reads as
deliberate.

## Structure

- **Severity is a left-edge accent**, 3px, not a top bar. It reads as a margin marker
  rather than as a warning banner across the card.
- **Chips are soft-tinted pills in sentence case.** All-caps monospace labels were
  removed; they added visual weight without adding information.
- **Panels are collapsed by default** with a summary note on the right, so secondary
  detail is reachable without occupying the primary reading column.

## Signature: the impact ledger

A compact strip beneath the brief showing counts per impact area, with the leading
area marked and each cell acting as a filter.

It encodes something true rather than decorating: the cross-discipline balance of the
current scan. It is the direct visual answer to the acceptance finding that the product
felt like an accessibility extension. When a scan finds a broken link, an indexing
problem and three accessibility groups, the ledger says so before the reader scrolls.

Empty areas are omitted, never shown as zero. A zero would imply a check ran and
passed, which is not always what happened.

## Overlay

The page overlay is orientation only: brand mark, progress, one short line, Back and
Next. Its job is to answer "which thing on the page is Frank pointing at". The side
panel answers everything else.

The 1.4.0 overlay duplicated the full remediation card over the page, which meant the
same text appeared twice on screen. `scripts/check.mjs` now fails the build if the
overlay renders both a headline and a body again.
