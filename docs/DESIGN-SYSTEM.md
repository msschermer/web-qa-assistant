# Product language and interaction contract

**The visual system is not here.** Colour, type, spacing, elevation, shape and every
component live in [`DESIGN.md`](../DESIGN.md), written from the world that shipped;
`packages/ui/tokens.css` is the one place a value is named. This document holds what
`DESIGN.md` does not: the words the product uses, the order it says things in, the
shape of a walkthrough, and the accessibility floor its interactions must clear.

> This file used to describe the visual system too, and by the time anyone read it
> again it described a retired one — a light blue-grey canvas, a `#143E63` brand, a
> teal accent, a Tailwind pipeline authored in `packages/ui/lumen.css`, and a claim
> that no webfont was bundled. Every one of those was false: the world is dark and
> violet, Tailwind was removed, and the test suite asserts `packages/ui/lumen.css`
> is gone. Two documents describing one design system drift for the same reason nine
> pill implementations did. There is now one.

## Product posture

**Lumen** should feel like a calm engineering review tool, not a scanner dump and not
a chatbot. There is no named persona. The product shows what the page is actually
doing. **Frank** is the name of the reasoning layer, not a character: it explains
verified evidence and never creates, upgrades or replaces a finding.

### Punctuation

The product's voice does not use the em dash. Sentences carry their own
punctuation: a comma, a semicolon, a colon, or a full stop, whichever the
sentence actually needs. Where a dash was doing the work of a separator between
a label and its value, use a colon; where it separated two counts or two facts
of equal weight, use the middle dot the plan already uses ("6 changes · 32
findings").

This is a build failure rather than a preference. `scripts/check.mjs` scans
every string and template in `apps/`, `packages/` and `services/` and fails on
an em dash outside a comment, because the character arrives one paste at a time
and a surface that carries it in nine places out of ten reads as inconsistent
rather than as deliberate. Comments are exempt: they are notes to ourselves, not
copy. The single exemption in source is the character class in
`packages/rules/image-purpose.js`, which has to contain the character in order
to detect it in alt text.

An en dash still marks an empty cell in a table, which is the conventional "no
value" mark and a different character from the one being avoided.

## Information hierarchy

The order a finding is presented in, on every surface that presents one:

1. **Assessment** — what deserves attention now
2. **Recommended order** — the human-readable problem, its confidence, its context
3. **Actions** — Walk through, Highlight, Recheck, Copy issue
4. **Coverage** — what was and was not successfully checked
5. **Technical detail** — rule ids, selectors and bounded raw evidence, behind
   progressive disclosure

## State language

These strings are load-bearing; each one makes a different claim about where a
sentence came from, and swapping them silently changes what the product asserts.

| Phrase | Means |
| --- | --- |
| `Evidence-backed assessment` / `Evidence summary` | the scan overview. Deliberately does **not** imply that any AI request occurred. |
| `On-device reasoning` | Chrome's built-in `LanguageModel` improved a walkthrough locally. |
| `Cloud reasoning` | the optional metered cloud fallback was explicitly enabled *and* succeeded. Never shown otherwise. |
| `Verified guidance` | a deterministic walkthrough, because local AI is unavailable, still preparing, or failed evidence-quality validation. |
| `Confirmed`, `Corroborated`, `Inferred`, `Inconclusive` | evidence strength, and the only four words allowed for it (`packages/findings/confidence.js`). |
| `Observed`, `Needs attention`, `Not established` | the three states of a site condition. |
| `Not run` | a pass that has not been asked for yet — an offer, not a fault. |

**Do not turn inability to verify into a defect.** "Unavailable" and "not applicable"
are coverage facts. Expressing one as a confidence level is not a softer phrasing, it
is a false claim: `normalizeConfidence()` coerces an unrecognised word to a fallback
that defaults to `confirmed`, so inventing a gentler term *upgrades* the finding.

## Walkthrough

Two surfaces stay split, and the split is the presentation contract:

- **Side panel — Evidence:** the stable deterministic inspection record. Finding
  status, confidence, environment, selector or target, measured values, tool
  provenance, verification attempts, current-step evidence, full bounded evidence,
  utility actions. It answers *what did the tools actually find?*
- **On-page card — walkthrough:** interpretation, impact, remediation, verification.
  It answers *what do these facts mean and what should I do?* It may carry a short
  heading and several concise sentences, because the rest of the page is dimmed to
  make a dedicated focus surface.

The conceptual grammar is predictable on purpose:

`Interpret → Impact → Fix → Verify`

Comparison and trend steps are inserted only when the evidence supports them. Recheck
appears at the verification step when the product can actually test that condition
again. The target element stays spotlighted; the card tries right, left, below and
above so it does not cover the element when a reasonable alternative exists. The
deterministic walkthrough opens on interpretation rather than a redundant "locate"
step. Current-step evidence is treated more strongly in the sidebar so a reader can
trace a statement back to its facts without the whole explanation being duplicated
there.

## Accessibility requirements

No formal conformance claim has been made for Lumen's own interface, and none may be
implied. These are the floor its interactions are held to anyway — a tool that audits
accessibility failing the checks it reports on others is a credibility problem before
it is a compliance one.

- Every action is reachable from the keyboard, with a visible focus state.
- No status is communicated by colour alone. Severity carries a 3px rail *and* text;
  conditions carry a ringed dot *and* a word.
- Walkthrough dialogs and overlays trap focus while active and restore it on close;
  Escape exits.
- Status changes are announced through appropriate live regions.
- Narrow side-panel widths stay usable (300px minimum).
- Reduced-motion preferences are respected wherever animation is used.
- Interactive controls are never nested — a button inside a button is invalid and
  unreachable for much of assistive technology.

## Signature: the impact ledger

A compact strip showing counts per impact area, the leading area marked, each cell
acting as a filter. It encodes something true rather than decorating: the
cross-discipline balance of the current scan. It is the direct answer to the
acceptance finding that the product felt like an accessibility extension — when a scan
finds a broken link, an indexing problem and three accessibility groups, the ledger
says so before the reader scrolls.

Empty areas are omitted, never shown as zero. A zero implies a check ran and passed,
which is not always what happened.
