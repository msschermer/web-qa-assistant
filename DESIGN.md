---
name: Lumen
description: The operator's console — a dark instrument surface for site auditing, with violet as the single product voice and one sealed severity ramp.
colors:
  backdrop: "#07070B"
  canvas: "#0E0E14"
  surface: "#15151E"
  surface-raised: "#22222E"
  sunken: "#1B1B25"
  ink: "#E9E9F2"
  ink-soft: "#A8A8BD"
  ink-faint: "#8B8BA3"
  line: "#2E2E3D"
  line-strong: "#3A3A4C"
  brand: "#7350F5"
  brand-strong: "#6741E8"
  brand-soft: "#1E1838"
  brand-line: "#3A2E6B"
  brand-text: "#A896FF"
  focus: "#7350F5"
  critical: "#FF6B78"
  critical-soft: "#2A1418"
  warn: "#F0A93A"
  warn-soft: "#2A1F0F"
  ok: "#45D68F"
  ok-soft: "#0F2419"
  info: "#A896FF"
  info-soft: "#1E1838"
  sev-critical: "#E14356"
  sev-high: "#FF5C6C"
  sev-medium: "#F0A93A"
  sev-low: "#D8873C"
  sev-info: "#7A7A94"
typography:
  display:
    fontFamily: "Inter, system-ui, -apple-system, Segoe UI, Roboto, Helvetica Neue, sans-serif"
    fontSize: "26px"
    fontWeight: 650
    lineHeight: 1.1
    letterSpacing: "-0.03em"
  headline:
    fontFamily: "Inter, system-ui, -apple-system, Segoe UI, Roboto, Helvetica Neue, sans-serif"
    fontSize: "19px"
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
    fontSize: "13px"
    fontWeight: 400
    lineHeight: 1.55
    letterSpacing: "normal"
  body-public:
    fontFamily: "Inter, system-ui, -apple-system, Segoe UI, Roboto, Helvetica Neue, sans-serif"
    fontSize: "16px"
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
    fontWeight: 650
    lineHeight: 1.3
    letterSpacing: "0.09em"
  mono:
    fontFamily: "ui-monospace, SFMono-Regular, SF Mono, Menlo, Consolas, monospace"
    fontSize: "11.5px"
    fontWeight: 400
    lineHeight: 1.5
    letterSpacing: "normal"
rounded:
  xxs: "2px"
  xs: "6px"
  sm: "8px"
  md: "10px"
  lg: "14px"
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
    padding: "7px 12px"
    height: "34px"
  button-primary-hover:
    backgroundColor: "{colors.brand-strong}"
    textColor: "#FFFFFF"
  button-secondary:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    typography: "{typography.title}"
    rounded: "{rounded.sm}"
    padding: "7px 12px"
    height: "34px"
  button-secondary-hover:
    backgroundColor: "{colors.sunken}"
    textColor: "{colors.ink}"
  button-danger:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.critical}"
    typography: "{typography.title}"
    rounded: "{rounded.sm}"
    padding: "7px 12px"
  nav-item:
    backgroundColor: "transparent"
    textColor: "{colors.ink-soft}"
    typography: "{typography.title}"
    rounded: "{rounded.sm}"
    padding: "8px 10px"
  nav-item-active:
    backgroundColor: "{colors.brand-soft}"
    textColor: "{colors.ink}"
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
    textColor: "{colors.brand-text}"
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
    rounded: "{rounded.sm}"
    padding: "13px 15px"
  badge-severity-high:
    backgroundColor: "{colors.critical-soft}"
    textColor: "{colors.critical}"
    typography: "{typography.meta}"
    rounded: "{rounded.pill}"
    padding: "2px 9px"
  badge-severity-critical:
    backgroundColor: "{colors.sev-critical}"
    textColor: "#FFFFFF"
    typography: "{typography.meta}"
    rounded: "{rounded.pill}"
    padding: "2px 9px"
  status-pill-healthy:
    backgroundColor: "{colors.ok-soft}"
    textColor: "{colors.ok}"
    typography: "{typography.meta}"
    rounded: "{rounded.pill}"
    padding: "2px 9px"
---

# Design System: Lumen

## Overview

**Creative North Star: "The Operator's Console"**

An audit is an investigation in progress, not a report that appears at the end. This world refuses the light document page the category ships — Sitebulb's and Semrush's white sheet of tables — and commits to the dark instrument surface a consultant leaves open on a second monitor while a crawl runs. Evidence glows against it; the ground itself never competes.

This direction was pinned by the operator, who supplied six mockups and asked for the product to be rebuilt against them. It replaces the light "category standard, played straight" world recorded in the previous version of this document, which had explicitly reserved that exit for them. Sitebulb and Semrush remain the bar for density, severity discipline and completeness; they are no longer the reference for how Lumen looks.

The surface is a near-black canvas (#0E0E14) with slightly lighter panels on it, hairlines a shade above the ground doing the structural work, and one violet primary carrying the product's own voice. Density is high and deliberate: 12.5–13.5px body text, 11–12.5px table cells, 8px and 14px gaps, tabular figures everywhere a number can be compared to another number. The Site Audit overlay is the fullest expression — a 216px left navigation grouped into destinations, a scrolling main column, stat strips, the site-conditions readout, a master–detail findings inspector and sortable data tables. The side panel is the same system compressed to a 300–420px column, and the exported client report is the same system in one emailable file.

**Key Characteristics:**
- One violet primary (#7350F5) that never means severity
- A sealed five-step severity ramp used only for severity
- Contrast computed, not eyeballed: every text token clears 4.5:1 on all four grounds
- One sans and one mono across every surface, fetched on first-party pages and falling back on injected ones
- Depth from the ground stepping lighter and from hairlines, not from shadow
- Left navigation grouped into destinations, a scrolling main column, a 900px fold to a horizontal strip
- Tabular figures, and hatching for what was not surveyed
- No composite score, anywhere

## Colors

A near-black neutral field carrying one saturated accent, with semantic colour admitted only where it states a fact about the site under audit. `packages/ui/tokens.css` is the single definition; every surface either links the compiled sheet or has that block injected into it at build time.

### Primary
- **Violet** (#7350F5): the product's own voice — active navigation item, primary buttons, focus rings, progress fill, surveyed coverage, selected chips and rows, the brand mark. It is the only saturated colour that appears for a product reason rather than an audit reason. It is this violet and not a brighter one because white must clear 4.5:1 on it; every lighter candidate fails its own button.
- **Violet Deep** (#6741E8): the hover/pressed state of every violet fill. Hover deepens rather than lightens, for the same contrast reason.
- **Violet Wash** (#1E1838) and **Violet Hairline** (#3A2E6B): the tinted ground and border for selected navigation, active chips, the scope banner and the selected table row.
- **Violet Text** (#A896FF): the primary *as text* — priority kickers, active tab labels, inline links. 7.3:1 on surface. The primary fill value is never used as text.

### Secondary
None. Lumen has exactly one accent. The semantic and severity colours below are not accents and must never be recruited as one.

### Neutral
- **Backdrop** (#07070B): what the overlay dims the host page to.
- **App Canvas** (#0E0E14): the ground behind panels — overlay body, main column, exported report body.
- **Surface** (#15151E): cards, tables, panels, the side navigation, the top bar.
- **Surface Raised** (#22222E): menus and popovers that sit above a card.
- **Sunken** (#1B1B25): table heads, inset rows, hover states.
- **Ink** (#E9E9F2): primary text, headings, table figures. 15.0:1 on surface.
- **Ink Soft** (#A8A8BD): secondary text, table cells, descriptions, lede copy. 7.8:1.
- **Ink Faint** (#8B8BA3): meta, labels, placeholders, counts, hints. 5.5:1 — the floor.
- **Hairline** (#2E2E3D): row dividers, card borders, section rules.
- **Hairline Strong** (#3A3A4C): control borders, panel edges, the info-severity rail.

### Semantic text colours (safe on their own wash)
- **Critical Text** (#FF6B78) on **Critical Wash** (#2A1418): failure notices, danger buttons, broken status, the high-severity badge.
- **Warn Text** (#F0A93A) on **Warn Wash** (#2A1F0F): review notices, partial coverage, unestablished evidence.
- **OK Text** (#45D68F) on **OK Wash** (#0F2419): healthy status, established confidence, resolved findings.
- **Info Text** (#A896FF) on **Info Wash** (#1E1838): informational chips — deliberately the same violet as the primary-as-text.
- **Muted** (#8B8BA3): the neutral tone chip; the same value as ink-faint.

### Severity ramp (fills only)
- **Critical** (#E14356), **High** (#FF5C6C), **Medium** (#F0A93A), **Low** (#D8873C), **Info** (#7A7A94): severity bars, distribution rails, the 3px inset finding rail, legend swatches, severity dots. These are fills, cleared to 3:1 against the surface. They are not cleared for text on a tint.

### Named Rules
**The One Voice Rule.** Violet is the product speaking — navigation, primary actions, focus, selection, progress. It never means severity. A red button that is not destructive is a bug; a violet element that encodes an audit result is the same bug in the other direction.

**The Sealed Ramp Rule.** `--wqa-sev-*` exists for severity and nothing else. Nothing outside a severity bar, rail, dot or legend swatch may take a value from it, and severity may not be expressed in any colour outside it. `scripts/check.mjs` fails the build on `color:var(--sa-sev-*)`.

**The Computed Contrast Rule.** Every text token clears 4.5:1 on backdrop, canvas, surface and sunken. `--wqa-ink-faint` (#8B8BA3, 5.5:1) is the floor — it must not be darkened, and no new text token may land below it. Each semantic *text* colour clears 4.5:1 on its own wash, which is why critical text is #FF6B78 rather than the ramp's #E14356.

**The One Palette Rule.** `packages/ui/tokens.css` is the only place a colour is named. First-party pages link the compiled sheet. The three surfaces that cannot — the Site Audit overlay and the walkthrough coach (injected under `:host{all:initial}` into pages whose CSP we do not control) and the exported report (opened from `file://` or an email client) — have the token block injected at build or render time. `scripts/check.mjs` fails the build if the overlay redeclares any value tokens.css already names. This replaced four private copies, two of which had already drifted a severity step.

**The Hatch Rule.** What was not surveyed is drawn with the 45° hatch (`repeating-linear-gradient(45deg,transparent 0 6px,rgba(233,233,242,.07) 6px 7px)`), not greyed out and not coloured as a failure. Not knowing is not the same as being broken, and that distinction stays visual.

## Typography

**Display / Body Font:** Inter where it resolves, the platform UI face otherwise (`system-ui, -apple-system, Segoe UI, Roboto, Helvetica Neue, sans-serif`)
**Mono Font:** `ui-monospace, SFMono-Regular, SF Mono, Menlo, Consolas, monospace` — URLs, rule ids, selectors, evidence values, timestamps

**Character:** One neutral grotesque doing all the work, tightened at the top of the ramp (−0.02 to −0.03em on headings and figures) and left alone at reading sizes. Weight, not size, carries most of the hierarchy: 650 for headings and figures, 600 for titles and labels, 500 for navigation and meta, 400 for prose.

### Hierarchy
- **Display** (650, 24–26px, 1.1, −0.03em, tabular): stat-strip figures. The largest type in the product is a number.
- **Headline** (650, 17–19px, 1.2, −0.02em): the page title in the main column, the inspected pattern's title.
- **Title** (600, 13–13.5px, 1.35): card heads, section headings, finding titles, button labels.
- **Body** (400, 12.5–13px, 1.55–1.6): lede and descriptive copy in the console surfaces, capped at 74ch.
- **Body, public** (400, 16px, 1.55): the public scanner at `apps/web/public/`, and the finding headlines on it at 16px. A landing page is read at arm's length by someone deciding whether to use the product; an operator console is scanned by someone working. The two densities are deliberate and the public page does not inherit the console's 13px.
- **Meta** (500, 11.5–12.5px, 1.45): counts, hints, table heads, foot notes.
- **Label** (650, 11px, 0.07–0.09em, uppercase): provenance micro-labels only — SCANNER EVIDENCE, LUMEN INTERPRETATION, RECOMMENDED NEXT MOVE, EXPLORE, VALIDATE.
- **Mono** (400, 11–12.5px): URLs, rule ids, coverage detail, evidence values.

### Named Rules
**The Provenance Label Rule.** The uppercase tracked micro-label exists for one job: marking whether the sentence under it is measurement or reading. On this surface a reader must always be able to tell the scanner's words from Lumen's. It is not a decorative eyebrow, and it is not used above ordinary headings.

**The One Face Rule.** One sans and one mono, declared identically in `packages/ui/tokens.css` and inherited everywhere else. There is no second family anywhere in the product.

**The Two Delivery Paths Rule.** Same face, two ways of getting it. The public scanner (`apps/web/public/index.html`) is an ordinary page and fetches Inter from Google Fonts with `preconnect` and `display=swap`. The overlay, the coach and the exported report never fetch: they take Inter if the host already has it and the platform UI face otherwise. An injected or emailed surface may never depend on a webfont; a first-party page may.

**The Tabular Figures Rule.** Any number a reader might compare against another number carries `font-variant-numeric: tabular-nums` — stat strips, counts, table cells, pager labels, history rows.

**The Sentence Case Rule.** Headings, badges and buttons are sentence case or capitalised, never letterspaced uppercase. Uppercase at 0.07–0.09em tracking is reserved for the provenance micro-label.

**The 11px Floor Rule.** 11px is the smallest type in the product, and the provenance label sits exactly on it. Functional text below 11px fails on high-DPI screens and small viewports, and a letterspaced micro-label is functional text — it names where a sentence came from. Being on the documented ramp is not an exemption: lowering the ramp step to legitimise an 8px label launders the token, not the legibility. The label step was 10.5px until a detector pass called it, and moving the step was the right answer rather than exempting the one surface that got measured.

## Layout

The Site Audit overlay is a fixed workspace inset 24px from the viewport (10px below 900px), 12px radius, over a `rgba(7,7,11,.72)` backdrop with a 2px blur. Inside it: a top bar (brand mark, name, device label, close), then a row of **216px left navigation** and a scrolling main column padded 20px / 24px / 28px. The navigation carries the site identity, the grouped destinations with counts, and the primary action pinned to the nav foot by `margin-top:auto`. Single-column form views constrain to 820px; prose blocks cap at 74ch.

Grids are auto-fit and content-driven: stat tiles at `minmax(160px,1fr)`, overview panels at `minmax(320px,1fr)`, both with 14px gaps. The findings inspector is a `minmax(0,1.15fr) minmax(0,1fr)` split that collapses to one column at 1040px. The spacing rhythm is 4 / 8 / 12 / 16 / 24, with 14px and 18px appearing as the card-padding and section-gap steps.

The side panel is a genuinely narrower density target (min-width 300px, typical 320–420px): 14px gutters, 18px section gaps, 12–14.5px type, a two-column tool grid that collapses to one at 360px. The public web scanner is a single column inside a 1440px sheet — the promise, then the scan field as the page's primary control, then a coverage schedule beside the extension card, collapsing at 860px.

**The 900px Fold Rule.** At `max-width:900px` the overlay's side navigation becomes a horizontal scrolling strip above the content: destinations go inline, the group labels hide, the nav foot moves to the row end, and the site-conditions row drops from a four-column grid to label-over-detail. The fold changes arrangement, never content.

## Elevation & Depth

On a dark ground a drop shadow reads as smudge, so **elevation is carried by the ground stepping lighter and by a hairline** — canvas → surface → sunken → surface-raised. Shadow survives only for the few elements that genuinely float above a document.

### Shadow Vocabulary
- **Ambient** (`0 1px 2px rgba(0,0,0,.40)`): cards, tiles, buttons, inputs. Barely visible by design; the tonal step is doing the work.
- **Raised** (`0 2px 6px rgba(0,0,0,.45), 0 1px 2px rgba(0,0,0,.35)`): the marginally lifted step.
- **Floating** (`0 28px 64px -16px rgba(0,0,0,.72)`): the fixed overlay workspace, the columns menu, modal shells.
- **Spotlight** (`0 0 0 99999px rgba(7,7,11,.78), 0 0 0 5px rgba(115,80,245,.34)`): the coach's element spotlight — a full-viewport scrim punched by a 2px white ring and a 5px violet ring. The ring states which element is under discussion; there is no wide bloom behind it.

### Named Rules
**The Tonal-Step-First Rule.** Structure comes from the ground stepping and from 1px #2E2E3D hairlines. A shadow never substitutes for a border, and no surface takes a second border where a hairline divider will do.

**The Ring, Not the Bloom Rule.** The spotlight's violet ring carries meaning: this is the element. A soft wide glow behind it carries none and is not drawn.

**The Floating-Means-Floating Rule.** The deep shadow is reserved for elements actually detached from the document — the fixed workspace, the coach, popovers, dialogs. A card in the flow never takes it.

## Shapes

Softly rounded, not pill-happy. The default corner is 10px for cards, tables, panels and callouts; controls (buttons, inputs, selects, nav items) take 8px; small inset chrome takes 6px; shells that float — the workspace, the coach — take 12–14px. Fully round (999px) is reserved for counters, status pills, severity badges, progress and coverage bars, and filter chips: things read as tokens rather than containers. 2px exists for one job only: capping the outer end of the 3px severity rail, where any larger radius would round a 3px bar into a lozenge.

Three recurring silhouettes define the system:
- **The inset left rail** (sanctioned). Finding rows carry severity as an inset 3px rail on the leading edge; the selected row in the findings inspector carries a 2px violet one over the violet wash. Resolved findings switch their border to dashed. Automated craft detectors read the rail as a side tab, and that reading is wrong here — the rail is how severity is legible without colour-coding the whole row.
- **The dot.** Confidence and state are 6–8px circles; the site-conditions mark is an 18px ringed dot with a 5px inset core, and "not established" swaps that core for a 2px dashed ring.
- **The distribution rail.** A 6px pill-shaped bar segmented by the severity ramp with a tabular key beneath it. Same device, same meaning, in the overlay's Overview and in the exported report.

Icons are inline SVG stroked at 1.35–1.6 in `currentColor`.

**The One Mark Rule.** The brand mark is a single construction everywhere: a 26–30px violet tile at 7–8px radius with a 2px white ring inset inside it — a lens. The side panel and the public scanner previously drew a bare violet annulus instead; three near-variants of a logo read as three products, so there is now one.

## Components

### Buttons
- **Shape:** 8px radius, minimum 34px tall; 12.5px/600 labels.
- **Primary:** violet fill (#7350F5), white text, matching border. Hover deepens to #6741E8.
- **Secondary (default):** surface, #3A3A4C border, ink text; hover fills sunken.
- **Danger:** surface with a critical border and critical text; hover fills the critical wash. Never a solid red fill.
- **Quiet brand:** violet wash background, transparent border, violet text — for secondary product actions.
- **Focus:** `outline: 2px solid #7350F5` at 1–2px offset on every interactive element; fields also shift their border to violet.
- **Disabled:** opacity 0.48, default cursor.

### Chips and pills
- **Filter chip / lens tab:** pill or 8px tab, transparent by default with an ink-soft 12.5px/600 label; active flips to violet wash + violet hairline + violet-text label.
- **Severity badge:** pill, 11.5px/600, capitalised. High / medium / low use the semantic wash with a ramp-tinted hairline; **critical is the one solid fill** (#E14356, white text), which is how the top of the ramp announces itself.
- **Status pill:** healthy = OK wash / OK text; broken = the critical ramp fill under white; blocked = warn wash / warn text; inconclusive = info wash with a strong hairline. Blocked is never coloured as broken.
- **Count badge:** right-aligned 11–12px tabular numeral in ink-faint inside a nav row.

### Cards and containers
- **Corner:** 10px. **Background:** surface on canvas. **Border:** 1px #2E2E3D, strengthening to #3A3A4C on hover for interactive cards. **Padding:** 12–16px; card heads 13px/15px with a hairline beneath.
- **Stat strip:** a 1px-gap grid whose cells are surface over a hairline ground, so the strip reads as one instrument rather than four floating tiles. A 10.5px uppercase label over a 24–26px tabular figure, with an optional 11.5px faint sub-line ("of 114 discovered").

### Inputs and fields
Surface, 1px #3A3A4C border, 8px radius, 9px/12px padding, 13px text, faint placeholder. Field labels are 12–13px/600 above the control; hints are 12px faint below it. Focus adds the 2px violet ring and a violet border. Disabled fields fill sunken with faint text.

### Navigation
- **Overlay side nav:** 216px column on `--sa-nav`, hairline on the right, 14px/12px padding. Above the destinations sit the site identity (13px/600 host, 11.5px tabular meta). Rows are 13.5px/500 ink-soft with 8px/10px padding and a right-aligned count; hover fills sunken; active fills violet wash. Below 900px it becomes a horizontal strip.
- **The destinations are Overview, Findings, then Explore (Pages, Links), then Validate (Browser checks)** — and only those. They are grouped by what the reader is doing: reading the audit, interrogating its rows, and asking for evidence that must be collected on request. A destination is added when there is real collected data behind it, never to make the rail look fuller. The Pages destination keeps the internal id `urls`; the label is "Pages" because that is what the reader is looking at, and "URLs" is the codebase's word, not theirs.
- **Detail tabs:** underline navigation — a transparent 2px bottom border that goes violet on the active tab, with faint 12.5px/600 labels.

### Data tables
12.5px, fully collapsed borders inside a 10px rounded, hairlined, overflow-hidden shell. Heads are 10.5px/650 uppercase faint on sunken with a hairline beneath; cells are 9px/11px, top-aligned, ink-soft, tabular. Row hover fills sunken; there is no zebra striping. Sortable heads darken on hover and append ▲/▼. Wide tables scroll inside their own shell — the page body never scrolls horizontally.

### Results tables (Findings, Pages, Links)

**The Shortened URL Rule.** No results table prints the crawled site's own origin. Same-site URLs render as their path (`/burglary-vs-robbery/`, root as `/`); external URLs keep host plus path, because there the host *is* the information. The host is stated once, at the top of the report. Every shortened cell carries the full URL in its `title`, and links still navigate to the absolute URL — shortening is a display rule, never a loss of data. One helper, `shortUrl()`, does this for all three tables.

- **Pages:** `Page · Status · Title · Words · Structured data`. Status is a pill, not a number in a cell, so one 404 among two hundred 200s is found by scanning rather than by reading. Rows expand into a detail row. The section index above the table renders **only when it actually groups**: at least two sections, at least one holding several pages, no more than twelve, and fewer sections than there are pages. On a flat site an index maps 1:1 onto the rows beneath it, which is not navigation — so it is hidden.
- **Links:** `Source page · Links to · Anchor text · Status`. Above the table sit status chips carrying their own counts (All / Broken / Blocked / Unverified / Healthy); a chip is never offered when no links sit behind it. Consecutive rows sharing a source blank the source cell and drop the row's top border, so fifteen links out of one page read as one block instead of that page's URL restated fifteen times.
- **Findings (signature):** a master–detail inspector. The left pane is a pattern table — `Issue · Area · Affected · Evidence`, with Instances and Rule id available from a columns chooser — over a stat strip, a search box, four filters and four lenses (Lumen priority, All patterns, Sitewide, Needs confirmation). The right pane inspects one pattern across Summary (Lumen's reading plus the scanner's own evidence), Instances (the affected pages) and Guidance (the fix, its scope, how to confirm it, and the rule id). The footer keeps the observation count visible beneath the pattern count so nothing looks quietly reduced.

**The Lens, Not Verdict Rule.** Lumen priority is presented as a lens over the scanner's labels and says so on the screen, in a standing note beside the tabs. Ordering may change; severity, confidence and counts render exactly as recorded. The order itself is one deterministic comparator in `packages/findings/priority.js`: a confirmed availability failure first, then the scanner's severity, then breadth, with anything inconclusive sinking. No discipline is promoted for being easy to detect.

### Audit in progress
A single centred column, no side nav — the report's destinations do not exist yet and a rail of dead tabs is a worse answer than no rail. Head carries "Auditing the site", the target, and the live actions (view partial results, pause/resume, raise the page budget, cancel). Below it: the phase label with a right-aligned percentage over the progress bar, a six-tile stat grid at 22px numerals (Discovered, Crawled, Links checked, Findings, Errors, Elapsed) collapsing to three then two columns, a recent-activity feed, and the standing reassurance that the crawl runs on the gateway and survives closing the tab.

### Site conditions readout (signature)
A single hairlined card whose rows are `22px | 150px | 1fr | auto` grids: state mark, item label, the observed headline, and a state pill. The mark is an 18px ringed dot — OK wash with a green core, critical wash with a red core, or a dashed ring for "not established". Expanding a row reveals 12.5px evidence lines and a confidence pill drawn from the product's closed vocabulary, followed by a faint coverage note.

**The No Score Rule.** The conditions readout carries no score, grade or index — in the overlay or in the exported report. Each row states what was observed plus the confidence that observation supports. A single number would hide the evidence behind it, and the exported report says exactly that in its own footnote copy.

**The Closed Vocabulary Rule.** Confidence is rendered only as one of the four levels defined in `packages/findings/confidence.js`: `confirmed`, `corroborated`, `inferred`, `inconclusive`. Never invent a fifth word to soften a finding — `normalizeConfidence()` coerces an unknown word to its fallback, so inventing one *upgrades* the finding and manufactures certainty. Never express "unavailable" or "not applicable" as confidence; that is coverage. *Gap in the build:* only three of the four levels have a drawn dot (`confirmed` green, `inferred` medium, `inconclusive` hairline-strong); `corroborated` has none and falls through unstyled. Draw it before relying on the dot alone.

**The Withheld-Is-Not-Zero Rule.** When a comparison cannot be made — a sitemap coverage figure the page limit made meaningless, a destination a platform refused to serve — the readout prints an em dash and the reason, never a zero. A withheld number rendered as 0 reads as agreement, which is the most expensive lie this product can tell.

### Coverage plan
A 10px pill-shaped bar: the surveyed portion is a solid violet fill, the remainder is the 45° hatch on the neutral track, with a tabular readout beneath. Same device, same meaning, everywhere it appears.

### Walkthrough coach (signature)
An injected 468px card (max 78vh) with a 12px radius and a deep shadow, pinned above a scrim, with the spotlight ring on the element under discussion. Its head carries the brand mark, a name/device stack and a verdict pill (OK / review / neutral context); a step rail of 3px segment bars sits below, filling violet as steps complete. Body copy is 14.5px; anchor, metric, code and source blocks are 8px-radius sunken panels. The code block is canvas-on-surface with mono at 11px — on this ground the darkest surface is the quietest one, so no special code theme is needed.

### Exported client report
`packages/crawl/report.js` renders one self-contained HTML file that must survive being emailed or opened from `file://`. It **inlines `packages/ui/tokens.css` at render time** rather than restating any value, and it imports the same discipline taxonomy, priority comparator and guidance sentences the overlay uses. It carries the same five destinations in the same grouped order, the scope banner a partial crawl deserves, findings grouped into patterns by discipline with availability first, and an explicit "not run" state for browser checks.

**The Paper Half Rule.** The report ships a print stylesheet that redefines the palette tokens inside `@media print` — one override, not a patch per class, because every rule already reads a token. On paper the ground is white, the inks are the light-world semantic values, every destination is shown at once (tabs are a screen affordance, not a document one), and the severity fills carry `print-color-adjust:exact` so meaning survives the browser stripping backgrounds. A client-facing document gets printed, and light text on a background the browser strips is not a document.

**The Document Cannot Contradict The Screen Rule.** Four things are shared modules with exactly one definition each, because each of them once existed as two copies that disagreed: the palette (`packages/ui/tokens.css`), the discipline taxonomy (`packages/findings/disciplines.js`, injected into the content script at build time), the priority order (`packages/findings/priority.js`), and the fix sentences (`packages/findings/rule-guidance.js`). A consultant walks a client through the screen and then sends them this file; it may not call the same finding by a different name, file it under a different area, or put something else first.

## Do's and Don'ts

### Do:
- **Do** use violet (#7350F5) for navigation, primary action, focus, selection and progress — and only for those.
- **Do** carry elevation with the tonal step and a hairline. On this ground a drop shadow reads as smudge.
- **Do** keep the scroll container full-width and centre content with padding. A `max-width` + `margin:0 auto` column that is *also* the scroller renders its scrollbar mid-panel against the column edge, which reads as a stray second scrollbar.
- **Do** take severity colour from `--wqa-sev-*` and semantic *text* colour from `--wqa-critical` / `--wqa-warn` / `--wqa-ok`, which are contrast-cleared on their own washes.
- **Do** treat `--wqa-ink-faint` (#8B8BA3, 5.5:1) as the lightest-duty text in the product and never go below it.
- **Do** hatch what was not surveyed, and state coverage limits in words next to it.
- **Do** give every comparable number `font-variant-numeric: tabular-nums`.
- **Do** carry severity as the 3px inset leading rail, and confidence as a dot plus a word from the closed vocabulary.
- **Do** keep the 4 / 8 / 12 / 16 / 24 spacing rhythm and the 10px-card / 8px-control / 999px-token radius split.
- **Do** put a `2px solid #7350F5` focus ring on every interactive element.
- **Do** reach for the shared module when two surfaces need the same fact — palette, taxonomy, priority, guidance. A second copy is how they start disagreeing.

### Don't:
- **Don't** darken `--wqa-ink-faint` or introduce a text token below 4.5:1 on any of the four grounds.
- **Don't** set a severity ramp value as text on a tint — the ramp is fills only.
- **Don't** use red, amber or green for anything that is not a statement about the audited site; and don't use violet to encode an audit result.
- **Don't** add a score, grade, index or single health number to the conditions readout or the report.
- **Don't** invent a confidence word outside `confirmed` / `corroborated` / `inferred` / `inconclusive`.
- **Don't** render a withheld comparison as a zero, or an unrun check as an empty section that reads clean.
- **Don't** let an injected or emailed surface depend on a fetched webfont, or on a stylesheet it cannot link. First-party pages may fetch Inter.
- **Don't** restate a palette value anywhere outside `packages/ui/tokens.css`. The exception is the print block in `packages/crawl/report.js`, which is the documented paper palette and exists because paper has its own inks.
- **Don't** add kickers or eyebrow labels above headings. The uppercase micro-label marks provenance and nothing else.
- **Don't** ship hard offset shadows, glyph or emoji icons, or a system display face; icons are inline SVG stroked in `currentColor`.
- **Don't** revert to **The Category Standard, Played Straight** (light #F6F7F9 canvas, white cards, indigo #4F46E5, `color-scheme:light`), and don't revive **The Drawing Set** (diazo paper, blueprint navy, condensed uppercase drawing type, keynote numbering, title-block rails) or **The Control Room** before it. All three are retired.
