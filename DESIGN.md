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
  on-primary: "#FFFFFF"
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
    fontFamily: "IBM Plex Sans, system-ui, -apple-system, Segoe UI, Roboto, Helvetica Neue, sans-serif"
    fontSize: "26px"
    fontWeight: 650
    lineHeight: 1.1
    letterSpacing: "-0.03em"
  display-compact:
    fontFamily: "IBM Plex Sans, system-ui, -apple-system, Segoe UI, Roboto, Helvetica Neue, sans-serif"
    fontSize: "22px"
    fontWeight: 650
    lineHeight: 1.1
    letterSpacing: "-0.02em"
  headline:
    fontFamily: "IBM Plex Sans, system-ui, -apple-system, Segoe UI, Roboto, Helvetica Neue, sans-serif"
    fontSize: "18px"
    fontWeight: 650
    lineHeight: 1.2
    letterSpacing: "-0.02em"
  title:
    fontFamily: "IBM Plex Sans, system-ui, -apple-system, Segoe UI, Roboto, Helvetica Neue, sans-serif"
    fontSize: "13.5px"
    fontWeight: 600
    lineHeight: 1.35
    letterSpacing: "normal"
  body:
    fontFamily: "IBM Plex Sans, system-ui, -apple-system, Segoe UI, Roboto, Helvetica Neue, sans-serif"
    fontSize: "13px"
    fontWeight: 400
    lineHeight: 1.55
    letterSpacing: "normal"
  body-public:
    fontFamily: "IBM Plex Sans, system-ui, -apple-system, Segoe UI, Roboto, Helvetica Neue, sans-serif"
    fontSize: "16px"
    fontWeight: 400
    lineHeight: 1.55
    letterSpacing: "normal"
  headline-panel:
    fontFamily: "IBM Plex Sans, system-ui, -apple-system, Segoe UI, Roboto, Helvetica Neue, sans-serif"
    fontSize: "15px"
    fontWeight: 650
    lineHeight: 1.25
    letterSpacing: "-0.01em"
  display-panel:
    fontFamily: "IBM Plex Sans, system-ui, -apple-system, Segoe UI, Roboto, Helvetica Neue, sans-serif"
    fontSize: "20px"
    fontWeight: 650
    lineHeight: 1.15
    letterSpacing: "-0.02em"
  body-coach:
    fontFamily: "IBM Plex Sans, system-ui, -apple-system, Segoe UI, Roboto, Helvetica Neue, sans-serif"
    fontSize: "14.5px"
    fontWeight: 400
    lineHeight: 1.55
    letterSpacing: "normal"
  meta:
    fontFamily: "IBM Plex Sans, system-ui, -apple-system, Segoe UI, Roboto, Helvetica Neue, sans-serif"
    fontSize: "12.5px"
    fontWeight: 500
    lineHeight: 1.45
    letterSpacing: "normal"
  label:
    fontFamily: "IBM Plex Sans, system-ui, -apple-system, Segoe UI, Roboto, Helvetica Neue, sans-serif"
    fontSize: "11px"
    fontWeight: 650
    lineHeight: 1.3
    letterSpacing: "0.09em"
  mono:
    fontFamily: "IBM Plex Mono, ui-monospace, SFMono-Regular, SF Mono, Menlo, Consolas, monospace"
    fontSize: "11.5px"
    fontWeight: 400
    lineHeight: 1.5
    letterSpacing: "normal"
rounded:
  xxs: "2px"
  xs: "6px"
  sm: "8px"
  md: "10px"
  float: "12px"
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
    textColor: "{colors.brand-text}"
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
    rounded: "{rounded.md}"
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
- One self-hosted superfamily — IBM Plex Sans and its own monospace sibling — across every surface
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

**The Fill Is Not The Ink Rule.** `--wqa-brand` (#7350F5) is a fill: backgrounds, borders, focus rings, bars. As text it measures about 4.1:1 on the surface and 4.4:1 on the canvas, and both fail. `--wqa-brand-text` (#A896FF, 7.3:1) is the primary as text and is the only one of the two that may follow `color:`. This was violated in sixteen places across three surfaces before a sidecar regeneration compared the build against this document and found them.

**The Sealed Ramp Rule.** `--wqa-sev-*` exists for severity and nothing else. Nothing outside a severity bar, rail, dot or legend swatch may take a value from it, and severity may not be expressed in any colour outside it. `scripts/check.mjs` fails the build on `color:var(--sa-sev-*)`.

**The Computed Contrast Rule.** Every text token clears 4.5:1 on backdrop, canvas, surface and sunken. `--wqa-ink-faint` (#8B8BA3, 5.5:1) is the floor — it must not be darkened, and no new text token may land below it. Each semantic *text* colour clears 4.5:1 on its own wash, which is why critical text is #FF6B78 rather than the ramp's #E14356.

**The One Palette Rule.** `packages/ui/tokens.css` is the only place a colour is named. First-party pages link the compiled sheet. The three surfaces that cannot — the Site Audit overlay and the walkthrough coach (injected under `:host{all:initial}` into pages whose CSP we do not control) and the exported report (opened from `file://` or an email client) — have the token block injected at build or render time. `scripts/check.mjs` fails the build if the overlay redeclares any value tokens.css already names. This replaced four private copies, two of which had already drifted a severity step.

**The Browser Chrome Rule.** Scrollbars, carets, checkboxes and select menus are part of the design or they are a light rectangle sitting in the middle of a near-black one. `packages/ui/tokens.css` declares `color-scheme:dark`, `accent-color:var(--wqa-brand)` and `scrollbar-color:var(--wqa-ink-faint) transparent` inside `:root`, and because all three are inherited properties they reach every surface that inherits that block. The two injected surfaces cannot take them that way — their host elements carry `all:initial` as an inline style, and an inline declaration outranks `:host` — so the overlay's `.workspace` and the coach's `.coach` alias the same three on the first element that inline style does not reach. `scrollbar-width:thin` is the one of the four that does not inherit, so each surface sets it on the universal rule it already has. The thumb is `--wqa-ink-faint` because it is the only palette grey that clears 3:1 on the canvas; `--wqa-line-strong` measures 1.75:1 and is invisible.

**The No Bare Anchor Rule.** Both injected surfaces sit under :host{all:initial}, where an unstyled <a> still takes the browser's link colours — and :visited paints a second one, so a plain list of URLs arrives in two colours, neither of them the product's, differing only by which pages the operator had already opened. Each injected surface therefore declares a base anchor rule as its floor, and scripts/check.mjs fails the build without one. Links are --wqa-brand-text, never the brand fill.

This was found in the findings inspector's Instances tab, which rendered its URLs at #0000EE, underlined, 16px, in the sans face — four departures at once — because the rule that dresses those links had been written as `.finding-detail .url-item`, and the second place that builds them is not inside `.finding-detail`. The lesson is the pill lesson again: **a component styled through an ancestor is a component that will be wrong in the second place it is used.** `.url-list` and `.url-item` carry no ancestor now.

**The Gutter Is Ground Rule.** The workspace is inset, so the audited page shows through a 24px scrim on all four sides. That scrim has to read as ground. At 72% over a light site it computed to a mid grey that ran the full height of the right edge at a scrollbar's width and in a scrollbar's tone — and once the overlay stopped drawing its own bar and the page stopped drawing one, it was the only thing left at that edge and read as a stray rail. It is 93%: enough that the page still comes through as shape and colour, never enough to be mistaken for chrome. A translucent backdrop over an arbitrary site inherits that site's colours, so the test is not how it looks over one page — it is whether any page can make the gutter read as a control.

**The Modal Locks The Page Rule.** While the Site Audit overlay is open the audited page does not scroll. The overlay is a modal — role=dialog, aria-modal, a backdrop, the whole viewport — and leaving the document underneath live cost two things: its scrollbar sat nine pixels to the right of the overlays own, so the right edge read as a pair of parallel bars, one of them the browsers default light grey on a near-black surface and none of it ours to theme; and a wheel gesture over the backdrop scrolled a page the operator could not see. The width the scrollbar occupied is handed straight back as padding so the page does not reflow the instant it locks, and every value is captured per axis from the inline style and restored exactly on close. Lumen styles its own surfaces and never the page it is auditing, so the only way to stop that second scrollbar being wrong is to stop drawing it.

**The Hatch Rule.** What was not surveyed is drawn with the 45° hatch (`repeating-linear-gradient(45deg,transparent 0 6px,rgba(233,233,242,.07) 6px 7px)`), not greyed out and not coloured as a failure. Not knowing is not the same as being broken, and that distinction stays visual.

## Typography

**Display / Body Font:** **IBM Plex Sans**, self-hosted, variable on the weight axis 400–700, falling back to the platform UI face (`system-ui, -apple-system, Segoe UI, Roboto, Helvetica Neue, sans-serif`)
**Mono Font:** **IBM Plex Mono**, self-hosted at 400 and 600 — URLs, rule ids, selectors, evidence values, timestamps

**Character:** One superfamily doing all the work. Plex was drawn for a technical products company and reads as engineered rather than generic: open apertures and a slightly mechanical skeleton that suits an instrument, with none of the neutrality-by-default of the grotesques every tool in this category reaches for. Its monospace is the same design at a fixed width, so a rule id sitting beside a sentence is one voice, not two families in a room together. Type is tightened at the top of the ramp (−0.02 to −0.03em on headings and figures) and left alone at reading sizes. Weight, not size, carries most of the hierarchy: 650 for headings and figures, 600 for titles and labels, 500 for navigation and meta, 400 for prose — and because the sans is the variable build, 650 is a real weight rather than a synthetic bold rounded up to 700.

This replaced Inter, which was serviceable and anonymous: it is on every tool in the category and on the detector's own list of faces that no longer read as a choice.

### Hierarchy
- **Display** (650, 26px, 1.1, −0.03em, tabular): the figure in a strip where the figure is the point — the Overview and Findings stat strips.
- **Display, compact** (650, 22px, 1.1, −0.02em, tabular): the same figure where it shares a dense grid — the progress view's six tiles, the discipline section stats. The largest type in the product is still a number.
- **Headline** (650, 18px, 1.2, −0.02em): the page title in the main column, the inspected pattern's title, the side panel's idle heading, the exported report's masthead. One step: the build carried 17px, 18px and 19px within two pixels of each other, which is an accumulation rather than a hierarchy.
- **Title** (600, 13–13.5px, 1.35): card heads, section headings, finding titles, button labels.
- **Body** (400, 12.5–13px, 1.55–1.6): lede and descriptive copy in the console surfaces, capped at 74ch.
- **Body, public** (400, 16px, 1.55): the public scanner at `apps/web/public/`, and the finding headlines on it at 16px. A landing page is read at arm's length by someone deciding whether to use the product; an operator console is scanned by someone working. The two densities are deliberate and the public page does not inherit the console's 13px.
- **Panel headline** (650, 15px) and **panel display** (650, 20px): the side panel is a 300–420px column and cannot spend 19px and 26px on a heading and a figure, so it has its own two steps at the top of the ramp. Everything below the top is shared with the console.
- **Coach body** (400, 14.5px, 1.55): the walkthrough is read, not scanned — one step up from the console’s working density.

**The Panel Conforms Rule.** The side panel uses seven steps and invents none of them: 11 label, 12.5 meta, 13 body, 13.5 title, 15 panel headline, 18 headline, 20 panel display. It had accumulated four of its own — 11.5, 12, 14 and 14.5 — none doing a job the ramp could not already do, half a pixel from a step that existed. When a dense surface needs separation it takes it from weight, which is why meta at 500 and title at 600 can sit a pixel apart and still read as different things. A surface that needs a size the ramp lacks changes the ramp; it does not keep a private one.
- **Meta** (500, 11.5–12.5px, 1.45): counts, hints, table heads, foot notes.
- **Label** (650, 11px, 0.07–0.09em, uppercase): provenance micro-labels only — SCANNER EVIDENCE, LUMEN INTERPRETATION, RECOMMENDED NEXT MOVE, EXPLORE, VALIDATE.
- **Mono** (400, 11–12.5px): URLs, rule ids, coverage detail, evidence values.

### Named Rules
**The Provenance Label Rule.** The uppercase tracked micro-label exists for one job: marking whether the sentence under it is measurement or reading. On this surface a reader must always be able to tell the scanner's words from Lumen's. It is not a decorative eyebrow, and it is not used above ordinary headings.

**The One Face Rule.** One superfamily, declared once in `packages/ui/tokens.css` and inherited everywhere else. There is no second family anywhere in the product.

**The Self-Hosted Rule.** The faces ship with the product (`packages/ui/fonts/`, SIL OFL 1.1) and are never fetched from a font CDN. Lumen audits sites for third-party requests and privacy exposure; a tool that does that while calling out to Google Fonts to render its own name has not taken its own advice. Self-hosting also means the extension works offline and a client's exported report renders correctly on a plane.

**The Three Delivery Paths Rule.** Same files, three ways of reaching them, because three surfaces have genuinely different constraints:

1. **Document surfaces** — the public scanner and the side panel — link a compiled sheet that sits beside its own `fonts/` directory, so a relative URL resolves. `scripts/build-css.mjs` writes both.
2. **Injected surfaces** — the Site Audit overlay and the walkthrough coach — cannot use a relative URL, and cannot declare `@font-face` inside their shadow root at all: font faces resolve against the document, never the shadow tree. So the content script registers one inert `<style>` on the host page with `chrome.runtime.getURL()` paths, and removes it when the last Lumen root closes. The host page's CSP decides whether the files actually load, which is exactly why the fallback stack is load-bearing rather than decoration.
3. **The emailed report** — `packages/crawl/report.js` embeds the four latin subsets as `data:` URIs, about 140KB. It is opened from `file://` months later on a machine that has never seen Lumen; a relative URL would resolve to nothing and a CDN URL would resolve to nothing offline.

No surface may be the only place a `src` is written: `packages/ui/fonts.css` holds the rules and each path substitutes its own base.

**The Tabular Figures Rule.** Any number a reader might compare against another number carries `font-variant-numeric: tabular-nums` — stat strips, counts, table cells, pager labels, history rows.

**The Sentence Case Rule.** Headings, badges and buttons are sentence case or capitalised, never letterspaced uppercase. Uppercase at 0.07–0.09em tracking is reserved for the provenance micro-label. The progress view's phase badge wore that uppercase for three releases and now reads "Phase 1 of 4" like everything else. Casing lives in the string, not in `text-transform`: `capitalize` capitalises every word, so it turned "high priority" into title case and would turn "Needs attention" into "Needs Attention". One `sentenceCase()` helper puts the capital on the front of the scanner's lowercase vocabulary, and technical literals — `noindex`, an HTTP code — are left exactly as the web writes them.

**The 11px Floor Rule.** 11px is the smallest type in the product, and the provenance label sits exactly on it. Functional text below 11px fails on high-DPI screens and small viewports, and a letterspaced micro-label is functional text — it names where a sentence came from. Being on the documented ramp is not an exemption: lowering the ramp step to legitimise an 8px label launders the token, not the legibility. The label step was 10.5px until a detector pass called it, and moving the step was the right answer rather than exempting the one surface that got measured.

## Layout

The Site Audit overlay is a fixed workspace inset 24px from the viewport (10px below 900px), 12px radius, over a backdrop of the backdrop token at 93% with a 2px blur. Inside it: a top bar (brand mark, name, device label, close), then a row of **216px left navigation** and a scrolling main column padded 20px / 24px / 28px. The navigation carries the site identity, the grouped destinations with counts, and the primary action pinned to the nav foot by `margin-top:auto`. Prose blocks cap at 74ch.

**The Setup Fits Rule.** The scan configuration is the screen an operator uses every time and reads once, so it is two columns inside 960px: the form on the left, the explanation of where the crawl runs and what the browser pass costs in a card on the right. Stacked in one 820px column it ran to roughly 900px and pushed *Start audit* below the fold on any ordinary window. Side by side it is 587px, which fits every window down to about 730px tall with the resume banner showing; below 880px wide the aside stacks above the form. Opening Advanced options is the one thing that may scroll — a disclosure the operator chose to open is allowed to cost height.

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

**The One Pill Rule.** There is one pill in the overlay — `.pill` — and everything that reads as a pill composes it. It carries the mechanics: `inline-flex`, `align-items:center`, the 999px radius, a 1px transparent hairline, `nowrap` with `word-break:normal`, and `line-height:normal` so an ancestor's paragraph leading cannot change its height. Nothing else may restate those.

This rule was bought. The overlay had implemented the component **nine times** — `.badge`, `.status-pill`, `.signal-badge`, `.cond-state`, `.cond-confidence`, `.phase-badge`, `.render-state`, `.sheet-scale` and `.state-chip` — each restating the radius, the padding and the type, and only three of the nine seating their own label. A pill is a box drawn round one line of text, and any flex or grid row can stretch it taller than that line, so the six that did not centre their own text were one taller sibling away from sitting high inside themselves. The confidence chip in the findings inspector is where it surfaced, beside a larger area chip. `scripts/check.mjs` now fails the build on any rule that declares the pill silhouette (a 999px or `--wqa-r-pill` radius) *and* carries text (a font-size and a padding) unless its base selector is one of the documented primitives.

**Sizes — two.** The dense default (2px 9px, 11.5px/600) for pills in table cells, badge rows and beside headings; `.roomy` (4px 11px, 12.5px/400) for a chip that sits on a row of its own. There is no third; the build previously carried 2/9, 3/10 and 4/11 within a pixel of each other, which is an accumulation rather than a hierarchy.

**Tones — one vocabulary, set with `data-tone`.** `ok`, `warn`, `critical`, `critical-solid`, `brand`, `muted`, `outline`, and the untoned default (sunken wash, ink-soft). These are the same words the side panel's own `.chip[data-tone]` uses, so the two surfaces name the same state the same way. Three tables in `content.js` — `SEVERITY_TONE`, `STATUS_TONE`, `CONDITION_STATE_TONE` — are the only places a state becomes a tone.

- **Severity badge:** `critical` → `critical-solid`, the one solid fill (#E14356 under white) and the only pill whose ground comes from the ramp; `high` → `critical`; `medium` and `low` → `warn`; `info` → `muted`. All but the solid take the semantic wash-and-text pair with a ramp-tinted hairline, never ramp-coloured text. One `severityPill()` builds it, because six call sites used to.
- **Status pill:** healthy = OK wash / OK text; broken = the **critical wash** with critical text and a high-ramp hairline — not the solid ramp fill, which is reserved for critical severity; blocked and inconclusive = info wash with a strong hairline. Blocked is never coloured as broken *or* as a warning: a destination that refuses an automated request is a limit on what Lumen could check, not a defect in the site. Status pills are never sentence-cased — they carry HTTP codes and literals such as `noindex`.
- **Filter chip / lens tab:** `.chip` — a control, not a pill: 32px minimum, cursor, hover, transparent by default with an ink-soft 12.5px/600 label; active flips to violet wash + violet hairline + violet-text label. It shares the silhouette and nothing else, which is why it is a documented primitive of its own rather than a `.pill` variant.
- **Count badge:** right-aligned 11–12px tabular numeral in ink-faint inside a nav row.

### Cards and containers
- **Corner:** 10px. **Background:** surface on canvas. **Border:** 1px #2E2E3D, strengthening to #3A3A4C on hover for interactive cards. **Padding:** 12–16px; card heads 13px/15px with a hairline beneath.
- **Stat strip:** a hairlined grid whose cells are surface over a line ground, so the strip reads as one instrument rather than four floating tiles. A 12.5px/500 sentence-case faint label over a 22–26px tabular figure, with an optional 11.5px faint sub-line ("of 114 discovered"). The label names a cell; it does not mark provenance, so it takes no tracking.

### Inputs and fields
Surface, 1px #3A3A4C border, 8px radius, 9px/12px padding, 13px text, faint placeholder. Field labels are 12–13px/600 above the control; hints are 12px faint below it. Focus adds the 2px violet ring and a violet border. Disabled fields fill sunken with faint text.

### Navigation
- **Overlay side nav:** 216px column on `--sa-nav`, hairline on the right, 14px/12px padding. Above the destinations sit the site identity (13px/600 host, 11.5px tabular meta). Rows are 13.5px/500 ink-soft with 8px/10px padding and a right-aligned count; hover fills sunken; active fills violet wash. Below 900px it becomes a horizontal strip.
- **The destinations are Overview, Findings, then Explore (Pages, Links), then Validate (Browser checks)** — and only those. They are grouped by what the reader is doing: reading the audit, interrogating its rows, and asking for evidence that must be collected on request. A destination is added when there is real collected data behind it, never to make the rail look fuller. The Pages destination keeps the internal id `urls`; the label is "Pages" because that is what the reader is looking at, and "URLs" is the codebase's word, not theirs.
- **Detail tabs:** underline navigation — a transparent 2px bottom border that goes violet on the active tab, with faint 12.5px/600 labels.

### Data tables
12.5px, fully collapsed borders inside a 10px rounded, hairlined, overflow-hidden shell. Heads are 12px/600 sentence-case faint on sunken with a hairline beneath — a column head names a column, it does not mark provenance, so it takes no tracking; cells are 9px/11px, top-aligned, ink-soft, tabular. Row hover fills sunken; there is no zebra striping. Sortable heads darken on hover and append ▲/▼. Wide tables scroll inside their own shell — the page body never scrolls horizontally.

### Results tables (Findings, Pages, Links)

**The Shortened URL Rule.** No results table prints the crawled site's own origin. Same-site URLs render as their path (`/burglary-vs-robbery/`, root as `/`); external URLs keep host plus path, because there the host *is* the information. The host is stated once, at the top of the report. Every shortened cell carries the full URL in its `title`, and links still navigate to the absolute URL — shortening is a display rule, never a loss of data. One helper, `shortUrl()`, does this for all three tables.

- **Pages:** `Page · Status · Title · Words · Structured data`. Status is a pill, not a number in a cell, so one 404 among two hundred 200s is found by scanning rather than by reading. Rows expand into a detail row. The section index above the table renders **only when it actually groups**: at least two sections, at least one holding several pages, no more than twelve, and fewer sections than there are pages. On a flat site an index maps 1:1 onto the rows beneath it, which is not navigation — so it is hidden.
- **Links:** `Source page · Links to · Anchor text · Status`. Above the table sit status chips carrying their own counts (All / Broken / Blocked / Unverified / Healthy); a chip is never offered when no links sit behind it. Consecutive rows sharing a source blank the source cell and drop the row's top border, so fifteen links out of one page read as one block instead of that page's URL restated fifteen times.
- **Findings (signature):** a master–detail inspector. The left pane is a pattern table — `Issue · Area · Affected · Evidence`, with Instances and Rule id available from a columns chooser — over a stat strip, a search box, four filters and four lenses (Lumen priority, All patterns, Sitewide, Needs confirmation). The right pane inspects one pattern across Summary (Lumen's reading plus the scanner's own evidence), Instances (the affected pages) and Guidance (the fix, its scope, how to confirm it, and the rule id). The footer keeps the observation count visible beneath the pattern count so nothing looks quietly reduced.

**The Lens, Not Verdict Rule.** Lumen priority is presented as a lens over the scanner's labels and says so on the screen, in a standing note beside the tabs. Ordering may change; severity, confidence and counts render exactly as recorded. The order itself is one deterministic comparator in `packages/findings/priority.js`: a confirmed availability failure first, then the scanner's severity, then breadth, with anything inconclusive sinking. No discipline is promoted for being easy to detect.

### Audit in progress
A single centred column, no side nav — the report's destinations do not exist yet and a rail of dead tabs is a worse answer than no rail. Head carries "Auditing the site", the target, and the live actions (view partial results, pause/resume, raise the page budget, cancel). Below it: the phase label with a right-aligned percentage over the progress bar, a six-tile stat grid at 22px numerals (Discovered, Crawled, Links checked, Findings, Errors, Elapsed) collapsing to three then two columns, a recent-activity feed, and the standing reassurance that the crawl runs on the gateway and survives closing the tab.

### Site conditions readout (signature)
A single hairlined card whose rows are `22px | 150px | 1fr | auto | 12px` grids: state mark, item label, the observed headline, a state pill, and a caret that rotates when the row opens. The mark is an 18px ringed dot — OK wash with a green core, critical wash with a red core, or a dashed ring for "not established". Expanding a row reveals 12.5px evidence lines closed by one footer line holding the confidence pill, drawn from the product's closed vocabulary.

**The Proof Goes With The Proof Rule.** The three rows backed by a document the reader can check — robots.txt, the sitemap, llms.txt — offer it *inside* the evidence, on that footer line beside the confidence, named rather than left as a bare "Open". The row states the condition; the file that proves it belongs with the rest of the proof rather than sitting on the row as a second column. It is never a child of the row's own toggle: a button inside a button is invalid and unreachable for half of assistive technology, and that constraint is what had pushed the link out onto the row in the first place. Because the link is now behind a disclosure, the caret is load-bearing — it is the row's only promise that there is something underneath.

**The No Score Rule.** The conditions readout carries no score, grade or index — in the overlay or in the exported report. Each row states what was observed plus the confidence that observation supports. A single number would hide the evidence behind it, and the exported report says exactly that in its own footnote copy.

**The Closed Vocabulary Rule.** Confidence is rendered only as one of the four levels defined in `packages/findings/confidence.js`: `confirmed`, `corroborated`, `inferred`, `inconclusive`. Never invent a fifth word to soften a finding — `normalizeConfidence()` coerces an unknown word to its fallback, so inventing one *upgrades* the finding and manufactures certainty. Never express "unavailable" or "not applicable" as confidence; that is coverage. *Gap in the build:* only three of the four levels have a drawn dot (`confirmed` green, `inferred` medium, `inconclusive` hairline-strong); `corroborated` has none and falls through unstyled. Draw it before relying on the dot alone.

**The Withheld-Is-Not-Zero Rule.** When a comparison cannot be made — a sitemap coverage figure the page limit made meaningless, a destination a platform refused to serve — the readout prints an em dash and the reason, never a zero. A withheld number rendered as 0 reads as agreement, which is the most expensive lie this product can tell.

### The Optimize inputs screen

Before a plan exists, Optimize shows what it will be built from and asks for the two things the crawl cannot know. It was a button in an empty page, which is the shape of a screen with nothing to say — and this one had plenty it could truthfully show.

Two columns. **Evidence this plan will use** is a ledger of counts the audit can already defend: findings, pages read, structured data, links checked, browser checks, coverage gaps, off-site research. Absent evidence is stated in faint ink rather than omitted, because *not run* is a fact about the plan. **What the crawl cannot know** carries the operator inputs.

**The Two Fields Rule.** Exactly two inputs, and each one has to demonstrably move the output or it does not exist. Site type changes the site model and the wording; template access changes the sequence. A third field that felt thorough and changed nothing would be fake configuration, which this product does not ship.

**The Stated Is Not Measured Rule.** Anything the operator types is labelled as their statement wherever it appears, carries **no scanner confidence at all**, and can never create, remove or re-rate a finding. The closed confidence vocabulary describes evidence; borrowing one of its four words for something a person typed is the same conflation the product refuses everywhere else. Where the crawl independently read the same thing, the plan says the two agree rather than presenting one as the other. When an operator statement reorders the plan, the group says the operator moved it and that the evidence did not.

### Waiting on a model

**The Bounded Request Rule.** No request to a model is awaited without a deadline. Chromes built-in model can accept a request and never answer, and an unbounded await left the Lumen brief reading *asking AI for wording* for as long as the overlay stayed open. The deterministic wording is already on screen, so waiting longer buys nothing but a label that never resolves. Twelve seconds, shared by every surface that asks.

**The Four Outcomes Rule.** AI turned off, the model unavailable, the model still downloading, the model timed out, and the model answer rejected for breaking the evidence rules are five different things, and they used to render one sentence. Each now names itself in the provenance line. A surface that falls back silently teaches the reader that the fallback is the finished article.

**The working indicator.** Three violet dots on the provenance line while a request is out. Under reduced motion they stop moving and stay visible rather than disappearing: the state still has to be legible, it just stops animating. This exists because the deterministic wording renders immediately either way, so without motion there is nothing to say that better wording may still arrive.

**The sequence never waits for the words.** Optimize renders its plan first and asks for wording afterwards. The order, counts, severity and confidence are decided from the evidence before a model is consulted, and the model may only set phrased titles and summaries, matched by id so a reordered reply cannot reorder the plan. Gating the plan on the model would make the products headline planning surface unavailable on every machine without the on-device model downloaded, for an input that by contract may never change a conclusion.

### Optimize (signature)

A coverage banner, a four-tile strip (changes, shared fixes, site model, connected research), a *why this order* card carrying the numbered sequence, then three lenses: Priorities, Site model, Evidence trail. Inside Priorities, each phase holds its areas of work, and each area holds the **changes** it asks for.

**Every Surface That Shows A Problem Routes To The Work.** The link graph was one-directional: Optimize opened Findings from every rule chip, and nothing opened Optimize. Overview reached Findings, Pages, Links and Browser checks; Structured data reached nothing at all. A reader looking at a confirmed fault had no way to ask the question the product exists to answer, and the flagship surface was reachable only from the nav. Findings and Structured data now route into the plan, the Overview brief offers it as its closing action, and the plan focuses on the rule the reader arrived with, saying so and offering the whole plan back. Where a rule became no work at all, the plan says that rather than opening an empty result: an observation asking for no change is an answer.

**The site model reaches the table.** Pages listed every URL as an independent thing, which is the framing the model exists to correct. It now carries the family each page belongs to, from its own endpoint rather than by building a whole Action Plan to read one field. Pages the crawl never fetched carry no group, because the model only knows what was read.

**The Site Is Made Of Templates, Not Pages.** Lumen reads a page-group model before it reasons about work, because the difference between "47 pages have a heading problem" and "one template emits a bad heading" is the difference between forty-seven jobs and one. A group is named by the site's **own path segment, verbatim** (`/attorneys/*`, because the site publishes that path) and never by what the pages might be *for*: guessing "attorney profiles" from a slug is right often enough to be dangerous, and naming the wrong template to a client is the confident error this product exists not to make. Where a site is flat and its URLs say nothing, pages are clustered by measured similarity instead, and that group carries the weaker claim explicitly: membership in a path family is `confirmed` because the URLs demonstrably share it, membership in a shape cluster is `inferred` because nothing but a measurement says so. Cohesion is published with its signals so a reader can check the claim, and pages that fit nowhere are named rather than quietly assigned.

**One Template Edit Means Different Things Wrong, Not One Thing Wrong Repeatedly.** Changes merge into a template action when their URLs are substantially the same set, that set covers most of one page group, **and they are different kinds of work**. That last condition took a wrong answer to find: overlap alone merged three broken links that appeared on every page, because everything in a shared header overlaps with everything else in it. Three dead hrefs are three dead hrefs. What makes something one file opened once is the heading *and* the title *and* the structured data being wrong together. A merge never replaces what it covers: it names the change ids, so the plan still reconciles against Findings and the evidence stays one click away.

**A Check That Cannot Finish Is Not Run.** Shape clustering compares every candidate page with every other, which is quadratic: 600 flat pages took 617 ms and nothing stops an operator raising the page budget and resuming. Past a ceiling the search is not attempted, and the model reports that it was skipped, because "looked and found no structure" and "did not look" would otherwise render identically and only one of them is a fact about the site. Path families are unaffected, being one pass whatever the size.

**Refusing To Answer Is An Answer.** Where the site's own signals disagree — a canonical pointing one way, the sitemap listing another, the internal links preferring a third — every individual scanner is silent, because each signal is valid on its own. Lumen states the contradiction as a **question**, with what it will not decide and what would settle it, and never as a recommendation. Consolidating the wrong way round costs a client the rankings on the page they meant to keep. The same discipline governs the checks themselves: sitemap membership needs the crawl's own URL normaliser, and without it the check does not run at all. A naive comparison reported eleven of twelve pages missing from a sitemap that listed all twelve, differing only by a trailing slash, and that sentence in a client report is worse than saying nothing.

**Compression is reported, never optimised.** `findings → jobs` is on the strip because it is the plan's claim, and in the export because a recipient should be able to check it. Fewer actions is not the goal; the smallest defensible set is. A compression figure with no template actions behind it is just the grouping that was always there, and it says so.

**Priority Is Not Severity.** Severity says how bad the thing found is; priority says how soon it should be done, and the two come apart constantly. A medium-severity title pattern on every page outranks a high-severity fault on one page nobody reaches. Priority is a base the evidence sets, plus the only two adjustments that change what a person would do first: inferred evidence drops a band, and a confirmed change reaching three or more pages through one edit gains one. A confirmed indexing directive is the one thing called a **Blocker**, deliberately, because everything else in the plan is measured on pages that can be indexed, and calling a dozen things blockers empties the word. Every priority carries the sentence that produced it, stated on the change, because a rule nobody can restate cannot be defended to a client. Within a phase, areas and rows order by priority; the sequence *between* phases stays a dependency order and priority never touches it.

**Four facts, closed.** A change row answers, without being opened: how soon (priority), what kind of work (category), what to edit (location), what it says now, and how far it reaches (scope). That is what someone deciding whether to open a row is asking, and it is why the row is scannable as a column of priorities rather than a list of sentences.

**Evidence Lumen computes and does not record is evidence nothing can act on.** Structured-data validation existed for one screen: a site could publish conflicting identities, an incomplete address and a type missing from three templates, and none of it reached Findings, the plan or the export. It now runs as a cross-page pass in the schema discipline, so it arrives as findings like everything else and needs no special handling downstream. Wiring it in unfiltered made the plan worse, not better, which is the same lesson from the other side: it reported "CommentAction is on most pages but not all" and recorded one site-level fact ten times. Types that are a CMS's plumbing are excluded from template-gap checks, and a statement about the site is recorded once.

**Now, Next, Then, Later.** The plan opens on a map of its phases, labelled by when they happen rather than by what number they are. `01 / 02 / 03` is accurate and reads exactly like the Findings table, which is the complaint that produced this: a reader could see three headings and still not know what to start on this afternoon. A dependency order has a shape, and those are the words for it.

The labels describe the sequence that actually exists, so a two-phase plan says Now and Next and stops. There is no fourth slot to fill and padding one would be inventing work. Position is **one hue getting quieter**, never the severity ramp: the first attempt gave Now a critical-red pill and Next amber, which in this product means something entirely different, because "do this first" is not "this is worse". Each row carries the disciplines the phase touches and its change count in the unit the rows, the totals and the export all share, and the whole row navigates to the work. The phase cards below use the same word the map used, so a reader never translates between them.

**Every State On One Page.** The states that matter most are the ones a real audit will not conveniently produce, and those are the ones that rot: `corroborated` is one of four sealed confidence levels and drew an invisible dot for long enough to be written into a known-gaps file and forgotten, because nothing in the database ever carried that value. The template action and the open question needed a hand-built synthetic audit before anyone could look at them, so their interface was written blind. **`apps/web/public/gallery.html` renders every one of them at once**, ordered by how hard a state is to reach rather than how common it is.

It renders what ships. `scripts/build-extension.mjs` emits `dist/extension/site-audit.css` from the same `siteAuditCss()` the extension injects, after token injection, and the gallery loads that file into a shadow root carrying the overlay's own host contract, **inline `all:initial` included**. That inline declaration outranks `:host`, which is why the overlay sets `color-scheme`, `accent-color` and `scrollbar-color` on `.workspace` instead; a gallery that skipped it would render correctly while the product did not, which is worse than no gallery.

`npm run gallery` screenshots it and computes contrast for every text node in every specimen in one pass. Its first run found white ink on the critical fill at 4.09:1, under the floor for text that size, on a component that had shipped: the sealed ramp stayed exactly as it is and the solid pill deepened its own ground from it. `scripts/check.mjs` fails the build when the confidence specimens stop reading the sealed vocabulary from `packages/findings/confidence.js`, when a `data-tone` value has no specimen, when one of the four surfaces has none, or when the gallery loads an asset no route serves, so the page cannot quietly fall behind the thing it is meant to watch.

**Four Surfaces, One Page.** Lumen ships four of them and they are never on screen together: the Site Audit overlay is a shadow root on somebody else's page, the side panel is a Chrome panel, the web app is a tab, and the exported report is a file that arrives by email months later. Nothing compared them, so they drifted, and the gallery now puts them beside each other one idea at a time. Confidence, severity, the identity mark, one finding and the empty state each get a row of four cells, and reading across the row is the whole point.

**Each surface renders in the context it really renders in.** The overlay stays a shadow root; the other three are documents and render in same-origin iframes, because their stylesheets open with `html{...}` and `body{...}` rules that set the canvas, the base type size and the line height, and inside a shadow root those selectors match nothing. A panel specimen in a shadow root would inherit the gallery's 14px instead of the panel's 12.5px and look right while shipping wrong, which is the same failure as skipping the overlay's inline `all:initial`. The side panel frame is a real 360px, the width Chrome gives it and the width its own 300px floor was written for; the other three have no canonical width and share the row. The ancestor matters too: the web app's title is sized by `.masthead h1`, so a lockup lifted out of its header renders at a size the product never draws.

**No specimen renders against a copy of a stylesheet.** `packages/crawl/report.js` now names its stylesheet `reportCss()` and exports it, the way `scripts/build-extension.mjs` already emitted the overlay's, and the gateway serves all four sheets from the files or functions the surfaces themselves use. A specimen rendered against a second copy only ever proves the two copies agree.

The first cross-surface run paid for itself. **Confidence is drawn as four levels in one place out of four**: the overlay separates all four, the side panel and the exported report each collapse them onto two colours, and the web app writes `inconclusive` out as the empty string, so a level the reasoning layer treats as meaningful reaches three of the four surfaces as something else. **The identity mark is three tiles and a letter**: the contract stated in `apps/extension/sidepanel.css` is one mark everywhere, the violet tile with the lens ring, and the exported report, the one artifact that reaches a client, draws an `L`. **The empty state says what would fill it on three surfaces and "Nothing to show here." on the fourth.** And the report carried the identical white-on-critical fill at 4.09:1 that the overlay had already fixed, unfixed, because until the gallery rendered a report specimen nothing had put the two pills side by side. That last one is repaired the same way the overlay's was, by deepening the pill's own ground rather than touching the sealed ramp; the other three are recorded here as drift, not yet closed.

**The Sequence Is Not A Ranking Rule.** Optimize orders work by **dependency**, and says so on the screen in those words. Group 1 is first because everything after it is measured on pages that resolve — not because it matters most. Each group states what it unblocks, which is the only defensible reason to put one body of work before another, and the last group says in as many words that being last in a dependency order is not being least important. Severity and confidence are shown on every group exactly as the scanner recorded them; nothing here re-rates a finding. A reader who mistakes a sequence for a ranking will deprioritise a confirmed high-severity fault, so the distinction is stated rather than implied.

**The Change Is The Unit Rule.** A findings table answers *what is wrong*. A plan answers *what do we change, where exactly, what does it say now, and how will we know it is done* — and the gap between those two documents is the translation a reader would otherwise redo for every finding. So the row of a plan is a change, not a finding: an id you can cite in a ticket (`C01`), the thing on the page you edit (`The <title> tag`, not "the page"), the value that thing holds now, a scope pill, the instruction, an observable done-when, and the pages it lands on. Closed, the row answers the three questions someone *assigning* work asks; open, the three the person *doing* it asks.

**The Scope Decides The Count Rule.** The single most important thing the plan computes is scope, because nothing in a findings count separates one template edit from many page edits. Twenty-seven pages missing a meta description is one job; the same twenty-seven findings on twenty-seven unrelated pages is twenty-seven. Scope is measured against pages **fetched**, never discovered, so a crawl that stopped early still reports it honestly. Where a rule can fire for different subjects on the same page — a link's destination, a duplicated heading — the rows are split by that subject *before* reach is measured: three pages carrying one dead href is one edit, three pages carrying three different dead hrefs is three. Getting this wrong either frightens a client with a number or hides a day of work behind a single line.

**Absent, never plausible.** A change never invents a location, a current value, or an outcome it cannot verify. Where the crawl recorded no value the row says so, and it distinguishes *not present* — the element is missing, which is the finding — from *value not recorded*, which is a limit of the crawl. An empty cell in a plan is honest; a plausible guess in one is what gets a consultant caught in front of a client. Where a change covers several pages and the value could differ between them, the row says the value shown is a sample.

**The Traceable Action Rule.** Every action names the rules behind it, how many findings and pages those cover, the weakest confidence among them, and how to verify the fix. The rule chips open the findings they came from. An action with no findings behind it is never emitted — there is no library of generic SEO advice waiting to fill a quiet plan, and a plan with nothing in it says so.

**The Reconcilable Totals Rule.** Every count on the plan adds up to the one above it: an area's tally equals the rows under it, a phase's equals its areas, and the strip's `46 → 12` equals the actionable findings in the Findings section. Instances are counted one recorded row per instance — the stored `count` column is rule-dependent (`seo.title-long` puts the title's character length in it), and summing it once reported 383 instances of a single long title. The Evidence trail lens then accounts for every finding the audit recorded: the ones sequenced, and the ones deliberately not. Informational observations — that a site uses GA4, say — are facts about the site rather than work, so they are excluded from the actions and counted where the reader can see the exclusion. The two numbers add back up to the Findings total. A plan whose arithmetic cannot be checked against the section it came from has to be taken on trust.

**The Model Drafts, It Does Not Narrate.** A model is asked for one thing Lumen cannot produce on its own: the replacement string a change asks for, in the Action Plan's "Change it to" column. Everything else it was previously asked to do was rewriting sentences the product had already written, which is safe, cheap, and invisible to whoever receives the audit. A drafted value is checkable in a way a rewritten sentence is not: it has a length the search result will honour, it must differ from the value it replaces and from every sibling page's, it may carry no superlative or unverifiable claim, and it must be **grounded** in the page's own vocabulary. That last check is the one that matters, because a model asked to write a title for a page it cannot see will invent a plausible service, city or credential, and it will read perfectly. A draft is a proposal: it is never applied to the site, never merged into a finding, and it travels into the spreadsheet in its own column labelled as unchecked.

**Readiness picks the provider, and absence is not a failure.** Lumen used to prefer Chrome's built-in model and fall back only after it refused. On most machines `LanguageModel.availability()` returns `unavailable` and cannot be made to return anything else, so a configured endpoint was reached only after a guaranteed failure and every surface reported the built-in model's error. The provider is now resolved from what can actually answer, in the worker, and the interface names whoever will be asked. A screen with no model configured says only who wrote the words: nothing went wrong, and badging it is how a working product comes to look broken. A model that *was* configured and then timed out, or whose reply was discarded for breaking the evidence rules, still states that, because unavailable reasoning is a coverage fact.

**The label names the author, never the mechanism.** "Written by Lumen from scan evidence", "written by your model". Never "AI wording": it describes the machinery instead of the result, and it was most prominent exactly where the model contributed least.

**The No Em Dash Rule.** Copy uses a comma, a semicolon, a colon or a full stop, never an em dash; a label and its value are separated by a colon, and two facts of equal weight by the middle dot the plan already uses. `scripts/check.mjs` fails the build on an em dash in any string or template under `apps/`, `packages/` or `services/`, exempting comments and the one character class that has to contain it. An en dash still marks an empty cell, which is a different character doing a conventional job. See `docs/DESIGN-SYSTEM.md` for the full statement.

**The Deliverable Says What It Is Rule.** An audit leaves the screen as one spreadsheet, and the operator chooses what goes in it: the action plan, the scan results, or both. Whatever they choose, the first tab is a cover that names the site, the audit, what the crawl covered and — in the file itself, not only in the interface it was exported from — what it could not see. A spreadsheet is forwarded, renamed and read months later; a partial crawl that does not say so becomes a complete-looking document the moment it is emailed on. The cover's arithmetic reconciles the same way the screen's does: findings recorded = findings the plan covers + informational observations excluded from it.

**The plan exports as a tracker, not as a report.** One row per change, in plan order, carrying the id, the element to edit, the value it holds now, the instruction, the done-when, the scope, the pages, and the rule behind it — then three empty columns, *Owner*, *Status* and *Notes*, which Lumen writes into and reads back never. A deliverable that has to be restructured before anyone can assign a row is a deliverable that gets rebuilt by hand, and then the audit's own ids stop matching the tracker the work is actually done in.

**Clustered by cause, not by discipline.** Findings are grouped by what you would change to fix them — the remediation locus — because that is the axis that turns hundreds of findings into a day's work. Twenty broken links across ten pages is one job; a missing title and a missing description are two edits in one template. Discipline grouping cannot say that. Each area also carries **why it matters** in the consequence the site owner feels, not a restatement of the rule: that is the line a non-technical reader actually reads, and it is written per cause rather than generated.

**The site model is read, never guessed.** What the site appears to be comes from its own published structured data — `LegalService` on twelve pages is the site saying so in machine-readable form — and is labelled `corroborated`, because the markup is confirmed while the reading of it is not. Where that evidence is missing the model is reported as not established and drawn with the hatch. Nothing infers an industry from page wording. Off-site research is reported as *not connected* rather than omitted: a missing row implies it was considered.

### Structured data (signature)

A scope line, a five-tile strip, an entity-conflict card, then four lenses: Validation, Schema types, Pages, Opportunities.

**The Three Statements Rule.** This section makes three different kinds of claim and never blurs them into one list of issues. An **error** is a fault in an item the crawl parsed and is `confirmed`, because the item is in hand. A **conflict** is two pages describing one entity differently and is `confirmed`, because both descriptions were parsed. An **opportunity** is markup a page does not appear to carry, and is `inferred` and never a defect — the static tier runs no JavaScript, so absence is a statement about what could be read. They get separate tiles, separate lenses and separate wording; the navigation badge counts errors and conflicts only, because a number beside a destination is read as a defect count.

Opportunities are drawn with the 45 degree hatch and never with a severity colour, for the reason the Hatch Rule already gives: not knowing is not the same as being broken.

The conflict card draws the shape of the disagreement — each identity beside the number of pages asserting it — rather than summarising it as a count. The disagreement is the evidence.

### Coverage plan
A 10px pill-shaped bar: the surveyed portion is a solid violet fill, the remainder is the 45° hatch on the neutral track, with a tabular readout beneath. Same device, same meaning, everywhere it appears.

### Walkthrough coach (signature)
An injected 468px card (max 78vh) with a 12px radius and a deep shadow, pinned above a scrim, with the spotlight ring on the element under discussion. Its head carries the brand mark, a name/device stack and a verdict pill (OK / review / neutral context); a step rail of 3px segment bars sits below, filling violet as steps complete. Body copy is 14.5px; anchor, metric, code and source blocks are 8px-radius sunken panels. The code block is canvas-on-surface with mono at 11px — on this ground the darkest surface is the quietest one, so no special code theme is needed.

### Exported client report
`packages/crawl/report.js` renders one self-contained HTML file that must survive being emailed or opened from `file://`. It **inlines `packages/ui/tokens.css` at render time** rather than restating any value, and it imports the same discipline taxonomy, priority comparator and guidance sentences the overlay uses. It carries the same five destinations in the same grouped order, the scope banner a partial crawl deserves, findings grouped into patterns by discipline with availability first, and an explicit "not run" state for browser checks.

**The Paper Half Rule.** The report ships a print stylesheet that redefines the palette tokens inside `@media print` — one override, not a patch per class, because every rule already reads a token. On paper the ground is white, the inks are the light-world semantic values, every destination is shown at once (tabs are a screen affordance, not a document one), and the severity fills carry `print-color-adjust:exact` so meaning survives the browser stripping backgrounds. A client-facing document gets printed, and light text on a background the browser strips is not a document.

**The Document Cannot Contradict The Screen Rule.** Four things are shared modules with exactly one definition each, because each of them once existed as two copies that disagreed: the palette (`packages/ui/tokens.css`), the discipline taxonomy (`packages/findings/disciplines.js`, injected into the content script at build time), the priority order (`packages/findings/priority.js`), and the fix sentences (`packages/findings/rule-guidance.js`). A consultant walks a client through the screen and then sends them this file; it may not call the same finding by a different name, file it under a different area, or put something else first.

## The craft floor

These came from an external design skill that is no longer installed. They are
kept because the project lives by them and each one caught something real here;
a rule a project depends on belongs to the project, not to a tool that can be
uninstalled. Where one is mechanical it is enforced in `scripts/check.mjs`;
the rest are judgement, and the committed world above overrides any of them.

**Verify on the built result, not the intention.** Contrast measured rather than
eyeballed: body and placeholder text at 4.5:1, large text at 3:1. Read the
computed spacing. Run the real copy at every breakpoint and fix what overflows.

**Section numbers only when the sequence carries information a reader needs.**
The plan's phases earn a sequence and use words for it; a numbered list of cards
does not, and reads as a table of contents nobody asked for.

**No kicker or eyebrow above a heading.** The heading carries its own weight.
The uppercase `.crumb` above panel titles was deleted for this reason.

**Cards are the lazy container, and nested cards are always wrong.** Four
same-size cards of heading-plus-text is the scaffold to reach for when the
structure has not been decided. The plan's phase map is rows inside one object
for exactly this reason.

**A coloured rule down the side of a card, callout or list item, heavier than a
hairline, is usually a distinction that belongs to the ground.** Four were
removed from the overlay on that reasoning. Two survive deliberately: the Lumen
brief's violet rail and the web app's Frank assessment, where the accent is the
component's identity rather than a variant marker. This is judgement, and a
mechanical gate for it was written and then removed for flagging both of those.

**The browser surfaces you did not draw still carry the design.** Selection, the
caret, scrollbars, focus rings, and the numerals in tabular data all ship with
defaults belonging to no design system. `color-scheme`, `accent-color` and
`scrollbar-color` are set on every injected surface, and `font-variant-numeric:
tabular-nums` on every column of figures.

**Monospace is for code, data and measurement, never as a costume for
"technical".** It marks values quoted from the audited page: a title, an href, a
URL.

**States are part of the work.** Hover, disabled, loading, error and empty, with
real content and working controls. An empty state says what would fill it.

**Copy is the product's own language.** Controls name their action; errors name
the problem and the recovery.

## What each colour is for

Recorded here rather than in a generated sidecar. The palette in the front
matter is the single source of the values; this is what each one means, so a
reader choosing a token is choosing a role rather than a hex.

| Token | Value | Role |
|---|---|---|
| `--wqa-backdrop` | `#07070B` | What the overlay dims the host page to. |
| `--wqa-canvas` | `#0E0E14` | The ground behind panels: overlay body, main column, exported report body. |
| `--wqa-surface` | `#15151E` | Cards, tables, panels, the side navigation, the top bar. |
| `--wqa-surface-raised` | `#22222E` | Menus and popovers that sit above a card. |
| `--wqa-sunken` | `#1B1B25` | Table heads, inset rows, hover fills. |
| `--wqa-ink` | `#E9E9F2` | Primary text; 15.0:1 on surface. |
| `--wqa-ink-soft` | `#A8A8BD` | Secondary text and table cells; 7.8:1. |
| `--wqa-ink-faint` | `#8B8BA3` | Meta, hints, placeholders; 5.5:1 and the documented floor. |
| `--wqa-line` | `#2E2E3D` | The 1px hairline between rows and around cards. |
| `--wqa-line-strong` | `#3A3A4C` | Control borders and panel edges. |
| `--wqa-brand` | `#7350F5` | Active navigation, primary buttons, focus ring, progress fill, surveyed coverage, the brand mark. Never severity. |
| `--wqa-brand-strong` | `#6741E8` | The hover and pressed state of every violet fill; hover deepens rather than lightens. |
| `--wqa-brand-soft` | `#1E1838` | The tinted ground for selected navigation, active lenses, the scope banner and the selected row. |
| `--wqa-brand-line` | `#3A2E6B` | The hairline that pairs with the violet wash. |
| `--wqa-brand-text` | `#A896FF` | The primary as text; 7.3:1 on surface. The fill value is never used as text. |
| `--wqa-focus` | `#7350F5` | The 2px focus outline on every interactive element. |
| `--wqa-on-primary` | `#FFFFFF` | The ink that sits on a violet fill and on the solid critical severity badge. White is the only value that clears 4.5:1 on #7350F5, which is why the primary is this violet and not a brighter one. |
| `--wqa-critical` | `#FF6B78` | Failure notices, danger buttons, broken status, the high-severity badge label. |
| `--wqa-critical-soft` | `#2A1418` | The wash beneath critical text. |
| `--wqa-warn` | `#F0A93A` | Review notices, partial coverage, unestablished evidence. |
| `--wqa-warn-soft` | `#2A1F0F` | The wash beneath warn text. |
| `--wqa-ok` | `#45D68F` | Healthy status, established confidence, resolved findings. |
| `--wqa-ok-soft` | `#0F2419` | The wash beneath OK text. |
| `--wqa-info` | `#A896FF` | Informational chips; deliberately the same violet as primary-as-text. |
| `--wqa-info-soft` | `#1E1838` | The wash beneath info text, and the neutral track under severity and coverage bars. |
| `--wqa-sev-critical` | `#E14356` | Severity fill, top of the ramp; the one solid severity badge fill, white on it. |
| `--wqa-sev-high` | `#FF5C6C` | Severity fill: bars, rails, dots, legend swatches. |
| `--wqa-sev-medium` | `#F0A93A` | Severity fill. |
| `--wqa-sev-low` | `#D8873C` | Severity fill. |
| `--wqa-sev-info` | `#7A7A94` | Severity fill, bottom of the ramp. |

## Motion

One named transition per kind of state change, so nothing is animated twice in
two ways.

- **control** — `background .12s ease, border-color .12s ease`. Button, chip, lens and table-row state changes.
- **disclosure** — `transform .15s ease`. Chevron and details-marker rotation on expand.
- **progress** — `transform .3s ease, scaleX from a left origin`. Crawl progress and coverage fills. Animating transform rather than width keeps the fill off the layout path; the script sets style.transform = scaleX(pct/100).
- **spotlight** — `opacity .22s ease, transform .22s ease, top .16s ease, left .16s ease, width .16s ease, height .16s ease`. The coach spotlight travelling between elements.
- **reduced-motion** — `@media(prefers-reduced-motion:reduce){transition:none}`. Honoured in the overlay, the coach, the side panel and the web surface.

## Where the system is expressed

- **Site Audit overlay** (`apps/extension/content.js (siteAuditCss)`) — The fullest expression: 216px side nav, scrolling main column, stat strips, findings inspector, sortable data tables.
- **Side panel** (`apps/extension/sidepanel.css`) — The same system compressed to a 300-420px column; 14px gutters, 18px section gaps.
- **Public scanner** (`packages/ui/web.css, apps/web/public/`) — A single column inside a 1440px sheet; 16px body, read at arm’s length.
- **Exported client report** (`packages/crawl/report.js`) — One self-contained HTML file that inlines tokens.css and redefines the palette inside @media print.

## Deliberately not canonized

Things seen in the build that are **not** system rules, recorded so nobody
promotes them into one by finding them twice.

- The primary fill, or its deep hover value, used as text on the violet wash: a contrast defect, not a token pairing. Recorded as a gap so the remaining three sites get fixed, never as a sanctioned pairing.
- The uppercase .crumb kicker above panel titles, prohibited by The Provenance Label Rule and the craft floor: it has been deleted from apps/extension/content.js, so it is neither a documented component nor a live gap.
- Values seen once in the build — the 16px and 18px strays in the side panel, the 1180px and 720px reflows of the progress stat grid — are layout facts, not system steps.

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
- **Don't** fetch the typeface from a CDN on any surface, and don't let an injected or emailed surface depend on a stylesheet it cannot link. The faces ship with the product.
- **Don't** restate a palette value anywhere outside `packages/ui/tokens.css`. The exception is the print block in `packages/crawl/report.js`, which is the documented paper palette and exists because paper has its own inks.
- **Don't** add kickers or eyebrow labels above headings. The uppercase micro-label marks provenance and nothing else. The overlay carried an uppercase "Site audit / Findings" line directly above an `<h1>` reading "Findings", inside a workspace whose header and left nav already said both — three statements of one fact, removed.
- **Don't** ship hard offset shadows, glyph or emoji icons, or a system display face; icons are inline SVG stroked in `currentColor`.
- **Don't** revert to **The Category Standard, Played Straight** (light #F6F7F9 canvas, white cards, indigo #4F46E5, `color-scheme:light`), and don't revive **The Drawing Set** (diazo paper, blueprint navy, condensed uppercase drawing type, keynote numbering, title-block rails) or **The Control Room** before it. All three are retired.
