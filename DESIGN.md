---
name: Lumen
description: A site-audit tool executed at category standard — Sitebulb's density and severity discipline with Semrush's polish and colour confidence, light theme only.
colors:
  canvas: "#F6F7F9"
  surface: "#FFFFFF"
  sunken: "#F9FAFB"
  ink: "#101828"
  ink-soft: "#475467"
  ink-faint: "#667085"
  line: "#EAECF0"
  line-strong: "#D0D5DD"
  brand: "#4F46E5"
  brand-strong: "#4338CA"
  brand-soft: "#EEF2FF"
  brand-line: "#C7D2FE"
  focus: "#4F46E5"
  critical: "#B42318"
  critical-soft: "#FEF3F2"
  warn: "#B54708"
  warn-soft: "#FFFAEB"
  ok: "#067647"
  ok-soft: "#ECFDF3"
  info: "#4F46E5"
  info-soft: "#EEF2FF"
  sev-critical: "#912018"
  sev-high: "#D92D20"
  sev-medium: "#DC6803"
  sev-low: "#F79009"
  sev-info: "#667085"
typography:
  display:
    fontFamily: "Inter, system-ui, -apple-system, Segoe UI, Roboto, Helvetica Neue, sans-serif"
    fontSize: "26px"
    fontWeight: 650
    lineHeight: 1.1
    letterSpacing: "-0.02em"
  headline:
    fontFamily: "Inter, system-ui, -apple-system, Segoe UI, Roboto, Helvetica Neue, sans-serif"
    fontSize: "22px"
    fontWeight: 650
    lineHeight: 1.2
    letterSpacing: "-0.02em"
  title:
    fontFamily: "Inter, system-ui, -apple-system, Segoe UI, Roboto, Helvetica Neue, sans-serif"
    fontSize: "13.5px"
    fontWeight: 600
    lineHeight: 1.35
    letterSpacing: "normal"
  body:
    fontFamily: "Inter, system-ui, -apple-system, Segoe UI, Roboto, Helvetica Neue, sans-serif"
    fontSize: "13.5px"
    fontWeight: 400
    lineHeight: 1.55
    letterSpacing: "normal"
  meta:
    fontFamily: "Inter, system-ui, -apple-system, Segoe UI, Roboto, Helvetica Neue, sans-serif"
    fontSize: "12.5px"
    fontWeight: 500
    lineHeight: 1.45
    letterSpacing: "normal"
  label:
    fontFamily: "Inter, system-ui, -apple-system, Segoe UI, Roboto, Helvetica Neue, sans-serif"
    fontSize: "11px"
    fontWeight: 600
    lineHeight: 1.2
    letterSpacing: "0.06em"
  mono:
    fontFamily: "ui-monospace, SFMono-Regular, SF Mono, Menlo, Consolas, monospace"
    fontSize: "12px"
    fontWeight: 400
    lineHeight: 1.5
    letterSpacing: "normal"
rounded:
  xs: "6px"
  sm: "6px"
  md: "8px"
  lg: "12px"
  pill: "999px"
spacing:
  1: "4px"
  2: "8px"
  3: "12px"
  4: "16px"
  5: "24px"
components:
  button-primary:
    backgroundColor: "{colors.brand}"
    textColor: "#FFFFFF"
    typography: "{typography.title}"
    rounded: "{rounded.sm}"
    padding: "8px 14px"
    height: "36px"
  button-primary-hover:
    backgroundColor: "{colors.brand-strong}"
    textColor: "#FFFFFF"
  button-secondary:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    typography: "{typography.title}"
    rounded: "{rounded.sm}"
    padding: "8px 14px"
    height: "36px"
  button-secondary-hover:
    backgroundColor: "{colors.sunken}"
    textColor: "{colors.ink}"
  button-danger:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.sev-high}"
    typography: "{typography.title}"
    rounded: "{rounded.sm}"
    padding: "8px 14px"
  nav-item:
    backgroundColor: "transparent"
    textColor: "{colors.ink-soft}"
    typography: "{typography.title}"
    rounded: "{rounded.sm}"
    padding: "8px 10px"
  nav-item-active:
    backgroundColor: "{colors.brand-soft}"
    textColor: "{colors.brand}"
    rounded: "{rounded.sm}"
    padding: "8px 10px"
  chip:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink-soft}"
    typography: "{typography.meta}"
    rounded: "{rounded.pill}"
    padding: "6px 13px"
    height: "32px"
  chip-active:
    backgroundColor: "{colors.brand-soft}"
    textColor: "{colors.brand}"
    rounded: "{rounded.pill}"
    padding: "6px 13px"
  input:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    typography: "{typography.body}"
    rounded: "{rounded.sm}"
    padding: "9px 12px"
  card:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.md}"
    padding: "14px 16px"
  stat-tile:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    typography: "{typography.display}"
    rounded: "{rounded.md}"
    padding: "14px 16px"
  badge-severity-high:
    backgroundColor: "{colors.critical-soft}"
    textColor: "{colors.sev-high}"
    typography: "{typography.label}"
    rounded: "{rounded.pill}"
    padding: "2px 9px"
  badge-severity-critical:
    backgroundColor: "{colors.sev-critical}"
    textColor: "#FFFFFF"
    typography: "{typography.label}"
    rounded: "{rounded.pill}"
    padding: "2px 9px"
  status-pill-healthy:
    backgroundColor: "{colors.ok-soft}"
    textColor: "{colors.ok}"
    typography: "{typography.label}"
    rounded: "{rounded.pill}"
    padding: "2px 9px"
---

# Design System: Lumen

## Overview

**Creative North Star: "The Category Standard, Played Straight"**

Lumen looks like the professional site-audit tool a consultant already trusts. In an Impeccable direction round the operator took the standing exit and named the bar: **Sitebulb** for density and severity discipline, **Semrush** for polish and colour confidence. `PRODUCT.md` records that as a brand commitment — the convention is executed at full fidelity, without irony and without smuggled quirk. This document describes the world as it actually shipped.

The surface is a light application canvas (#F6F7F9) with white cards on it, hairline borders doing most of the structural work, and one indigo primary carrying the product's own voice. Density is high and deliberate: 13–13.5px body text, 10–12px table cells, 8px and 14px gaps, tabular figures everywhere a number can be compared to another number. Nothing decorative competes with the data. The Site Audit overlay is the fullest expression — a 216px left navigation, a scrolling main column, stat tiles, the site-conditions readout, severity-railed finding cards, sortable data tables — and the side panel is the same system compressed to a 300–420px column.

Light theme only, by decision. `html{color-scheme:light}` is declared; there is no dark variant anywhere in the build.

**Key Characteristics:**
- One indigo primary (#4F46E5) that never means severity
- A sealed five-step severity ramp used only for severity
- Contrast computed, not eyeballed: every text token clears 4.5:1 on all three grounds
- One sans and one mono across every surface, fetched on first-party pages and falling back on injected ones
- Hairline structure with a 1px ambient shadow; deep shadow reserved for elements that actually float
- Left navigation, scrolling main column, a 900px fold to a horizontal nav strip
- Tabular figures, and hatching for what was not surveyed
- No composite score, anywhere

## Colors

A restrained neutral field carrying one saturated accent, with semantic colour admitted only where it states a fact about the site under audit.

### Primary
- **Indigo** (#4F46E5): the product's own voice — active navigation item, primary buttons, focus rings, progress fill, surveyed coverage, selected chips and impact rows, links inside finding detail, the brand mark. It is the only saturated colour that appears for a product reason rather than an audit reason.
- **Indigo Deep** (#4338CA): the hover/pressed state of every indigo fill, and the text colour of quiet brand buttons on the indigo wash.
- **Indigo Wash** (#EEF2FF) and **Indigo Hairline** (#C7D2FE): the tinted ground and border for selected navigation, active chips, the render-pass callout, the resume banner and the tier note.

### Secondary
None. Lumen has exactly one accent. The semantic and severity colours below are not accents and must never be recruited as one.

### Neutral
- **App Canvas** (#F6F7F9): the ground behind panels — overlay body, main column, exported report body.
- **Card White** (#FFFFFF): cards, tables, panels, the side navigation, the top bar, the foot note.
- **Sunken** (#F9FAFB): table heads, inset rows, hover states, the deliver strip, help panels.
- **Ink** (#101828): primary text, headings, table figures. 17.8:1 on white.
- **Ink Soft** (#475467): secondary text, table cells, descriptions, lede copy. 7.7:1.
- **Ink Faint** (#667085): meta, labels, placeholders, counts, hints. 4.97:1 on white — the floor.
- **Hairline** (#EAECF0): row dividers, card borders, section rules.
- **Hairline Strong** (#D0D5DD): control borders, panel edges, the info-severity rail, the inconclusive confidence dot.

### Semantic text colours (safe on their own wash)
- **Critical Text** (#B42318) on **Critical Wash** (#FEF3F2): failure notices, danger buttons, broken status.
- **Warn Text** (#B54708) on **Warn Wash** (#FFFAEB): review notices, partial coverage, degraded integrations.
- **OK Text** (#067647) on **OK Wash** (#ECFDF3): healthy status, confirmed confidence, resolved findings.
- **Info Text** (#4F46E5) on **Info Wash** (#EEF2FF): informational chips — deliberately the same indigo as the primary.
- **Muted** (#667085): the neutral tone chip; the same value as ink-faint.

### Severity ramp (fills only)
- **Critical** (#912018), **High** (#D92D20), **Medium** (#DC6803), **Low** (#F79009), **Info** (#667085): severity bars, the 3px inset finding rail, legend swatches, severity dots. These are fills. They are bright by design and are not cleared for text on a tint.

### Named Rules
**The One Voice Rule.** Indigo is the product speaking — navigation, primary actions, focus, selection, progress. It never means severity. A red button that is not destructive is a bug; an indigo element that encodes an audit result is the same bug in the other direction.

**The Sealed Ramp Rule.** `--wqa-sev-*` exists for severity and nothing else. Nothing outside a severity bar, rail, dot or legend swatch may take a value from it, and severity may not be expressed in any colour outside it.

**The Computed Contrast Rule.** Every text token clears 4.5:1 on canvas, surface and sunken. `--wqa-ink-faint` (#667085) sits at 4.97:1 on white and is the floor — it must not be lightened, and no new text token may land above it. Each semantic *text* colour clears 4.5:1 on its own wash, which is why critical text is #B42318 and warn text is #B54708 rather than the brighter ramp values.

**The Hatch Rule.** What was not surveyed is drawn with the 45° hatch (`repeating-linear-gradient(45deg,transparent 0 6px,rgba(16,24,40,.06) 6px 7px)`), not greyed out and not coloured as a failure. Not knowing is not the same as being broken, and that distinction stays visual.

## Typography

**Display / Body Font:** Inter where it resolves, the platform UI face otherwise (`system-ui, -apple-system, Segoe UI, Roboto, Helvetica Neue, sans-serif`)
**Mono Font:** `ui-monospace, SFMono-Regular, SF Mono, Menlo, Consolas, monospace` — URLs, selectors, evidence values, technical detail

**Character:** One neutral grotesque doing all the work, tightened at the top of the ramp (−0.02em on headings and figures) and left alone at reading sizes. Weight, not size, carries most of the hierarchy: 650 for headings and figures, 600 for titles and labels, 500 for navigation and meta, 400 for prose.

### Hierarchy
- **Display** (650, 26px, 1.1, −0.02em, tabular): stat-tile figures. The largest type in the product is a number.
- **Headline** (650, 22px, 1.2, −0.02em; 19px below 900px): the page title in the main column.
- **Title** (600, 13.5–14px, 1.35): card heads, section headings, finding titles, button labels.
- **Body** (400, 13–13.5px, 1.55–1.6): lede and descriptive copy, capped at 76–84ch.
- **Meta** (500, 12–12.5px, 1.45): counts, hints, table heads, deliver labels, foot notes.
- **Label** (600, 11px, 0.06em, uppercase): the navigation section label and equivalent micro-labels only.
- **Mono** (400, 11–12.5px): URLs, selectors, coverage detail, evidence values.

### Named Rules
**The One Face Rule.** One sans and one mono, declared identically in `packages/ui/tokens.css`, `packages/ui/lumen.css`, `packages/ui/coach.css`, `frankCss()` and `packages/crawl/report.js`. There is no second family anywhere in the product.

**The Two Delivery Paths Rule.** Same face, two ways of getting it. The public scanner (`apps/web/public/index.html`) is an ordinary page and fetches Inter from Google Fonts with `preconnect` and `display=swap`. The overlay and coach are injected into third-party documents whose CSP we do not control, so they never fetch: they take Inter if the host already has it and the platform UI face otherwise. An injected surface may never depend on a webfont; a first-party page may.

**The Tabular Figures Rule.** Any number a reader might compare against another number carries `font-variant-numeric: tabular-nums` — stat tiles, counts, table cells, pager labels, history rows.

**The Sentence Case Rule.** Headings, badges and buttons are sentence case or capitalised, never letterspaced uppercase. Uppercase at 0.04–0.06em tracking is reserved for the 11px micro-label.


## Layout

The Site Audit overlay is a fixed workspace inset 24px from the viewport (10px below 900px), 12px radius, over a `rgba(16,24,40,.55)` backdrop with a 2px blur. Inside it: a 56px top bar (brand mark, name, device label, close), then a row of **216px left navigation** and a scrolling main column padded 20px / 24px / 28px. The navigation carries the site identity, the section tabs with counts, and the primary action pinned to the nav foot by `margin-top:auto`. Single-column form views constrain to 820px; prose blocks cap at 76–84ch.

Grids are auto-fit and content-driven: stat tiles at `minmax(180px,1fr)`, overview panels at `minmax(320px,1fr)`, both with 14px gaps. Finding cards stack in a 10px grid. The spacing rhythm is 4 / 8 / 12 / 16 / 24, with 14px and 18px appearing as the card-padding and section-gap steps.

The side panel is a genuinely narrower density target (min-width 300px, typical 320–420px): 14px gutters, 18px section gaps, 12–14.5px type, a two-column tool grid that collapses to one at 360px. The public web scanner uses a 230px left title block beside a fluid body inside a 1440px sheet, collapsing to a single column at 860px.

**The 900px Fold Rule.** At `max-width:900px` the overlay's side navigation becomes a horizontal scrolling strip above the content: tabs go inline, the section label hides, the nav foot moves to the row end, and the site-conditions row drops from a four-column grid to label-over-detail. The fold changes arrangement, never content.

## Elevation & Depth

Depth comes from hairlines and tonal layering first; shadow is ambient, not structural. Every card is `1px solid #EAECF0` on white over the #F6F7F9 canvas, plus a 1px shadow that reads as a hint of lift rather than a drop. The only heavy shadows belong to elements that genuinely float above a page: the fixed audit workspace, the coach card, dialogs.

### Shadow Vocabulary
- **Ambient** (`box-shadow: 0 1px 2px rgba(16,24,40,.06)`): cards, stat tiles, buttons, chips, inputs, panels. The default.
- **Raised** (`box-shadow: 0 1px 3px rgba(16,24,40,.10), 0 1px 2px rgba(16,24,40,.06)`): the marginally lifted step.
- **Floating** (`box-shadow: 0 24px 48px -12px rgba(16,24,40,.18)`): the fixed overlay workspace and modal shells only.
- **Coach card** (`box-shadow: 0 22px 56px rgba(16,33,51,.28), 0 3px 10px rgba(16,33,51,.1)`): the injected walkthrough card, which must read above an unknown host page.
- **Spotlight** (`box-shadow: 0 0 0 99999px rgba(16,24,40,.62), 0 0 0 5px rgba(79,70,229,.34)`): the coach's element spotlight — a full-viewport scrim punched by a 2px white ring and a 5px indigo ring. The ring states which element is under discussion; there is no wide bloom behind it.

### Named Rules
**The Hairline-First Rule.** Structure comes from 1px #EAECF0 borders and the canvas/surface tonal step. A shadow never substitutes for a border, and no surface takes a second border where a hairline divider will do.

**The Ring, Not the Bloom Rule.** The spotlight's indigo ring carries meaning: this is the element. A soft wide glow behind it carries none and is not drawn.

**The Floating-Means-Floating Rule.** The deep shadow is reserved for elements actually detached from the document — the fixed workspace, the coach, dialogs. A card in the flow never takes it.

## Shapes

Softly rounded, not pill-happy. The default corner is 8px for cards, tables, panels and callouts; controls (buttons, inputs, selects, nav items, small dismiss targets) take 6px; shells that float — the workspace, the coach, the assessment brief, the scanbox, the web overlay — take 12px; dialogs take 16px. Fully round (999px) is reserved for counters, status pills, severity badges, progress and coverage bars, and filter chips: things read as tokens rather than containers.

Two recurring silhouettes define the system:
- **The 3px left rail** (sanctioned). Finding cards carry severity as an inset 3px rail on the leading edge (`box-shadow: inset 3px 0 0 <severity>` composed with the ambient shadow in the overlay; a `::before` bar in the panel and on the web). Resolved findings switch their border to dashed. This silhouette is deliberate and stays: automated craft detectors read the rail as a side tab, and that reading is wrong here — the rail is how severity is legible without colour-coding the whole card.
- **The dot.** Confidence and state are 8px circles; the site-conditions mark is an 18px ringed dot with a 5px inset core, and "not established" swaps that core for a 2px dashed ring.

Icons are inline SVG stroked at 1.35–1.6 in `currentColor`. The brand mark is a geometric construction — a 26–28px indigo square with a 7px radius and an inset white ring in the overlay, a radial-gradient annulus in the panel and on the web.

## Components

### Buttons
- **Shape:** gently rounded (6px), minimum 36px tall in the overlay; 12.5px/600 labels in the panel.
- **Primary:** indigo fill (#4F46E5), white text, matching border, 8px/14px padding. Hover deepens to #4338CA.
- **Secondary (default):** white surface, #D0D5DD border, ink text, ambient shadow; hover fills sunken.
- **Danger:** white surface with a #FDA29B border and critical text; hover fills the critical wash. Never a solid red fill.
- **Quiet brand:** indigo wash background, transparent border, #4338CA text — for "Ask Frank"-class secondary actions.
- **Focus:** `outline: 2px solid #4F46E5` at 1–2px offset on every interactive element; fields also shift their border to indigo.
- **Disabled:** opacity 0.5 (0.48 in the panel), default cursor.

### Chips and pills
- **Filter chip / section cut:** pill, white surface, #D0D5DD border, 12.5px/500 ink-soft label, 32px tall; active flips to indigo wash + indigo hairline + indigo label and drops its shadow.
- **Severity badge:** pill, 11.5px/600, capitalised. High / medium / low use the semantic wash with a matching tinted border; **critical is the one solid fill** (#912018, white text), which is how the top of the ramp announces itself.
- **Status pill:** healthy = OK wash / OK text / #ABEFC6 border; broken = critical wash / #D92D20 text / #FECDCA border; inconclusive and blocked = neutral #F2F4F7 with a strong hairline. Blocked is never coloured as broken.
- **Count badge:** pill on sunken, 11.5px/600 tabular; inside an active nav item it inverts to white with an indigo numeral.

### Cards and containers
- **Corner:** 8px. **Background:** white on canvas. **Border:** 1px #EAECF0, strengthening to #D0D5DD on hover for interactive cards. **Shadow:** ambient. **Padding:** 12–16px; card heads 12px/14px with a hairline beneath.
- **Finding card:** severity rail on the leading edge, a full-width toggle header (title, meta row, right-aligned confidence, rotating chevron), and an expanded detail block separated by a hairline.
- **Stat tile:** 12.5px/500 faint label over a 26px/650 tabular figure, with an optional 12px faint sub-line.

### Inputs and fields
White surface, 1px #D0D5DD border, 6px radius, 9px/12px padding, 13.5px text, ambient shadow, faint placeholder. Field labels are 13px/600 ink above the control; hints are 12.5px faint below it. Focus adds the 2px indigo ring and an indigo border. Disabled fields fill sunken with faint text.

### Navigation
- **Overlay side nav:** 216px white column, hairline on the right, 14px/12px padding. Above the tabs sit the site identity (13px/600 host, 11.5px tabular meta) and an 11px uppercase section label. Tabs are 13.5px/500 ink-soft rows with 8px/10px padding and a right-aligned count; hover fills sunken; active fills indigo wash with a 600 indigo label. Below 900px it becomes a horizontal strip.
- **The four report sections are Overview, Findings, Pages and Links** — and only those four. A section is added when there is real collected data behind it, never to make the rail look fuller. The Pages tab keeps the internal id `urls`; the label is "Pages" because that is what the reader is looking at, and "URLs" is the codebase's word, not theirs.
- **Report tabs:** underline navigation — a transparent 2px bottom border that goes indigo on the active tab, with faint 13px/600 labels.

### Data tables
13px, fully collapsed borders inside an 8px rounded, hairlined, overflow-hidden shell. Heads are 12px/600 faint on sunken with a hairline beneath; cells are 10px/12px, top-aligned, ink-soft, tabular. Row hover fills sunken; there is no zebra striping in the app surfaces (`nth-child(even)` is explicitly transparent). Sortable heads darken on hover and append ▲/▼. Expanded detail rows sit on sunken.

### Results tables (Findings, Pages, Links)

**The Shortened URL Rule.** No results table prints the crawled site's own origin. Same-site URLs render as their path (`/burglary-vs-robbery/`, root as `/`); external URLs keep host plus path, because there the host *is* the information. The host is stated once, at the top of the report. Every shortened cell carries the full URL in its `title`, and links still navigate to the absolute URL — shortening is a display rule, never a loss of data. One helper, `shortUrl()`, does this for all three tables.

- **Pages:** `Page · Status · Title · Words · Structured data`. Status is a pill, not a number in a cell, so one 404 among two hundred 200s is found by scanning rather than by reading. Rows expand into a detail row. The section index above the table renders **only when it actually groups**: at least two sections, at least one holding several pages, no more than twelve, and fewer sections than there are pages. On a flat site an index maps 1:1 onto the rows beneath it, which is not navigation — so it is hidden.
- **Links:** `Source page · Links to · Anchor text · Status`. Above the table sit status chips carrying their own counts (All / Broken / Blocked / Unverified / Healthy); a chip is never offered when no links sit behind it. Consecutive rows sharing a source blank the source cell and drop the row's top border, so fifteen links out of one page read as one block instead of that page's URL restated fifteen times. The plain status `<select>` is retained in the DOM but hidden — the chips are the control.
- **Findings:** severity badge, title, breadth and confidence sit on one four-column grid so they read as columns down the list rather than drifting with each title's length. A sort control offers severity (default), pages affected, instances and area; the default sorts severity first and breadth second, because a high on forty pages outranks a high on one. Expanding a row states the evidence basis in the open, names the scanner rule, and puts the affected pages in a 220px scrolling sunken box rather than a wall of forty links.

### Audit in progress
A single centred column, no side nav — the report's sections do not exist yet and a rail of dead tabs is a worse answer than no rail. Head carries "Auditing the site", the target, and the two live actions (view partial results, cancel). Below it: the phase label with a right-aligned percentage over the standard progress bar, a six-tile stat grid at 22px numerals (Discovered, Crawled, Links checked, Findings, Errors, Elapsed) collapsing to three then two columns, a recent-activity feed, and the standing reassurance that the crawl runs on the gateway and survives closing the tab.

### Site conditions readout (signature)
A single hairlined card whose rows are `22px | 150px | 1fr | auto` grids: state mark, item label, the observed headline, and a state pill. The mark is an 18px ringed dot — OK wash with a green core, critical wash with a red core, or a dashed ring for "not established". Expanding a row reveals 12.5px evidence lines and a confidence pill drawn from the product's closed vocabulary (`confirmed`, `corroborated`, `inferred`, `inconclusive`), followed by a faint coverage note.

**The No Score Rule.** The conditions readout carries no score, grade or index — in the overlay or in the exported report. Each row states what was observed plus the confidence that observation supports. A single number would hide the evidence behind it, and the exported report says exactly that in its own footnote copy.

**The Closed Vocabulary Rule.** Confidence is rendered only as one of the four levels defined in `packages/findings/confidence.js`. Never invent a fifth word to soften a finding, and never express "unavailable" or "not applicable" as confidence — that is coverage. *Gap in the build:* only three of the four levels currently have a drawn dot (`confirmed` green, `inferred` medium, `inconclusive` hairline-strong); `corroborated` has none and falls through unstyled. Draw it before relying on the dot alone.

### Coverage plan
A 10px pill-shaped bar: the surveyed portion is a solid indigo fill, the remainder is the 45° hatch on the neutral track, with a tabular readout beneath. Same device, same meaning, everywhere it appears.

### Walkthrough coach (signature)
An injected 468px card (max 78vh) with a 12px radius and a deep shadow, pinned above a scrim, with the spotlight ring on the element under discussion. Its head carries the brand mark, a name/device stack and a verdict pill (OK / review / neutral context); a step rail of 3px segment bars sits below, filling indigo as steps complete and going ink at the current step. Body copy is 14.5px; anchor, metric, code and source blocks are 8px-radius sunken panels inset 17px. The code block is the only dark surface in the system (#0B2B48 with #E2E8F0 text).

### Exported client report
`packages/crawl/report.js` writes its tokens out **longhand on purpose** — the file must survive being emailed or opened from `file://`, so it imports nothing. Its duplicated values are exactly: brand #4F46E5, ink #101828, ink-soft #475467, ink-faint #667085, line #EAECF0, line-strong #D0D5DD, sunken #F9FAFB, sheet #FFFFFF, board #F6F7F9, ok #067647, warn #B54708, crit #B42318, plus the same Inter and mono stacks written out in full. **Do not "fix" this by importing `tokens.css`.** When a palette value changes, change it in both places.

The report is the same system in a single file: underline tab navigation, stat tiles, the conditions table with sentence-case labels and a mono confidence column, and a priority list that is an ordinary hairlined card list — no counter numbering, no letterspaced uppercase, no texture overlay.

## Do's and Don'ts

### Do:
- **Do** use indigo (#4F46E5) for navigation, primary action, focus, selection and progress — and only for those.
- **Do** keep the scroll container full-width and centre content with padding. A `max-width` + `margin:0 auto` column that is *also* the scroller renders its scrollbar mid-panel against the column edge, which reads as a stray second scrollbar.
- **Do** take severity colour from `--wqa-sev-*` and semantic *text* colour from `--wqa-critical` / `--wqa-warn` / `--wqa-ok`, which are contrast-cleared on their own washes.
- **Do** treat `--wqa-ink-faint` (#667085, 4.97:1 on white) as the lightest text in the product.
- **Do** hatch what was not surveyed, and state coverage limits in words next to it. The hatch is a sanctioned gradient: it is how "not surveyed" stays visually distinct from "broken".
- **Do** give every comparable number `font-variant-numeric: tabular-nums`.
- **Do** carry severity as the 3px inset leading rail on finding cards, and confidence as a dot plus a word from the closed vocabulary.
- **Do** keep the 4 / 8 / 12 / 16 / 24 spacing rhythm and the 8px-card / 6px-control / 999px-token radius split.
- **Do** put a `2px solid #4F46E5` focus ring on every interactive element.
- **Do** duplicate palette values longhand in `packages/crawl/report.js` and keep them in sync by hand.

### Don't:
- **Don't** lighten `--wqa-ink-faint` or introduce a text token below 4.5:1 on canvas, surface or sunken.
- **Don't** set a bright severity ramp value as text on a tint — the ramp is fills only.
- **Don't** use red, amber or green for anything that is not a statement about the audited site; and don't use indigo to encode an audit result.
- **Don't** add a score, grade, index or single health number to the conditions readout or the report.
- **Don't** invent a confidence word outside `confirmed` / `corroborated` / `inferred` / `inconclusive`.
- **Don't** let an injected surface depend on a fetched webfont; the overlay and coach must render under a hostile CSP. First-party pages may fetch Inter.
- **Don't** add a dark theme or a `prefers-color-scheme` branch. Light theme only, by decision.
- **Don't** reintroduce a violet role: `--wqa-violet` / `--wqa-violet-soft` are aliases of the primary and carry no distinct meaning.
- **Don't** add kickers or eyebrow labels above headings. The rule holds on every surface: `.section-kicker`, `.eyebrow` and `.env-kicker` are all `display:none`, and `.launch-cat` is sentence case at 12px/600 with no letterspacing.
- **Don't** ship hard offset shadows, glyph or emoji icons, or a system display face; icons are inline SVG stroked in `currentColor`.
- **Don't** revive **The Drawing Set** (diazo paper #DDE3E7 / #F7F9FA, blueprint navy #16283D, condensed uppercase drawing type, 2–3px radii, keynote numbering, title-block rails) or **The Control Room** before it (cool blue-grey, engineering blue #143E63, instrument teal #087C89, pill chips). Both are retired.
