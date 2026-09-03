# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Primary: **agencies and independent consultants auditing client sites.** They run
audits across many sites they do not own, on a repeating basis, and are judged on
what they can hand back to the client. That situation drives three things the
design must serve: output a non-engineer can be shown, workflows that survive
being repeated on a new site next week, and evidence strong enough to defend a
recommendation the client will be billed for.

Lumen is intended to ship to external users, not only to its author. Future work
must assume the operator did not build the codebase and has not read it.

Secondary audiences named in `README.md` (in-house developers, implementation
teams, technical SEO) are real but were not confirmed as the design target in the
product interview. Treat them as compatible, not as the surface's brief.

## Product Purpose

Lumen finds, explains, prioritizes and proves web quality problems across a page
or an entire site — broken links, indexability and SEO, accessibility,
performance, security and web-quality signals, analytics/tracking, and technical
implementation defects.

Deterministic scanners establish whether an issue exists. A reasoning layer
("Frank" walkthroughs) explains meaning, impact, remediation and verification.

Success is that a consultant can open a site they have never audited, get a
trustworthy prioritized picture of what is wrong, understand why it matters, and
show a client the evidence.

## Positioning

The mechanism a neighboring scanner could not truthfully copy is **evidence
discipline**:

- Every finding carries an explicit confidence and provenance.
- AI never creates, upgrades, downgrades or replaces a finding; it may only
  explain verified deterministic evidence.
- Evidence that could not settle a question is reported as a coverage
  limitation, never as a defect. A blocked, WAF'd or challenged target is a valid
  outcome, not a clean scan.
- Volume from one easy-to-detect scanner is not allowed to dominate priority.

A second differentiator is where the work runs. A site crawl is a cheap static
fetch on the gateway; deeper browser-level checks execute in the user's own
browser; and the walkthrough layer reasons **on-device by default**, through
Chrome's built-in `LanguageModel` API. Metered cloud reasoning exists but is
strictly optional and double opt-in — a server-side gate plus an explicit
per-user extension setting — so an ordinary extension scan never invokes it.
Audit cost therefore does not scale with the vendor's infrastructure, and on the
default path the audited page and its evidence never leave the operator's
machine.

## Operating Context

- The product surface is a **Chrome extension**: a side panel plus a full-window
  Site Audit overlay injected into the page.
- Two related workflows: **Page Scan** (the current page, in the real browser —
  axe-core plus browser rules, live element highlighting) and **Site Scan** (a
  server-side crawl of the whole site, with an optional per-page render pass that
  runs in the user's own browser).
- An Express gateway persists audits (SQLite) so a crawl survives the panel
  closing, the tab navigating, or the service worker being recycled.
- A public single-URL web scanner exists at the gateway root.
- A headless-Chromium renderer service (`services/renderer/`) and a hardened
  egress proxy (`services/egress-proxy/`, which refuses private, loopback,
  link-local and other non-public destinations) back that public scanner and the
  element-snapshot endpoint. They sit outside the crawl path.
- Audits run against real, third-party production sites — including sites behind
  WAFs and bot protection, and sites the operator cannot modify.
- Existing outputs: CSV exports (findings, urls, urls-summary, links), an HTML
  report, and a privacy-bounded debug/bug-report artifact.

## Capabilities and Constraints

- **Confidence is a closed vocabulary**: `confirmed`, `corroborated`, `inferred`,
  `inconclusive` (`packages/findings/confidence.js`). Unrecognized values are
  coerced to a fallback that defaults to `confirmed`, so inventing a softer word
  silently manufactures certainty. "Unavailable" and "not applicable" are
  expressed as coverage, never as confidence.
- **Impact classes** (`packages/findings/impact.js`): availability,
  discoverability, accessibility, performance, security, web quality, coverage.
- The static crawl tier parses HTML with jsdom and **does not execute
  JavaScript**, so any absence-claim from that tier is `inferred`, not confirmed.
- The crawler refuses private and loopback hosts, so local fixtures cannot be
  audited end-to-end.
- Crawl limits: max 300 pages, max concurrency 6, one running audit per owner.
- **The crawl path must never call the renderer or server-side Chromium.** The
  boundary is deliberate and load-bearing for the cost model: server-side
  rendering is reachable only from the public single-URL scan and the snapshot
  endpoint. A capability that renders during a crawl violates Principle 3 and is
  not an acceptable implementation, however convenient.
- Reasoning runs **on-device by default** through Chrome's built-in
  `LanguageModel` API, which the gateway advertises as
  `preferredFrankAi: 'chrome-built-in'`. Cloud reasoning (OpenAI, model set by `OPENAI_MODEL`) is
  metered and requires *both* a server-side gate and a per-user extension
  setting. It is never a required integration and gateway health must not report
  it as one. Reasoning that is unconfigured or unavailable is a coverage fact,
  never a defect and never a silent omission.
- Site Scan configuration that genuinely exists today: start URL, max pages,
  concurrency, respect robots.txt, include subdomains, max depth, include/exclude
  path patterns, external-link checking, respect nofollow, request delay.
- Explicitly undecided / not yet built, and not to be presented as existing:
  XLSX and PDF export, crawl-over-time comparison and diffing, authenticated or
  cookie-based crawling, scheduled/unattended runs.

## Brand Commitments

- The product name is **Lumen** (formerly "Web QA Assistant"; the earlier
  prototype was "Preflight"). Tagline in use: "See what the page is actually
  doing."
- **Frank** is the name of the walkthrough/reasoning layer. It explains verified
  evidence; it is not a chatbot and not the scanner.
- Presentation contract: the sidebar is the deterministic evidence/audit record;
  the centered card owns interpretation and action.
- **Interface convention is a deliberate commitment.** Lumen follows the
  category standard for site-audit tools rather than a distinctive visual
  world. Offered a rolled direction and the standing exit, the operator took
  the exit and named the products Lumen should sit alongside: **Sitebulb** and
  **Semrush** — Sitebulb's density and severity discipline with Semrush's
  polish and colour confidence. Future design work executes that convention at
  full fidelity, without irony and without smuggled quirk, and must not
  reintroduce a distinctive visual direction unless the operator asks for one.
- A design system already exists and is authoritative: `packages/ui/tokens.css`,
  `packages/ui/lumen.css`, and `docs/DESIGN-SYSTEM.md`.
- Voice: plain-English translation of scanner output, with raw scanner language
  demoted to "Technical evidence". Never claim a measurement, standard, URL,
  component identity, user behavior, traffic effect or business outcome without
  evidence.

## Evidence on Hand

- Real project documentation: `README.md`, `AGENTS.md`, `CLAUDE.md`,
  `docs/DESIGN-SYSTEM.md`, `docs/PRIVACY.md`, `docs/DEPLOYMENT.md`, and versioned
  release notes.
- A synthetic fixture corpus under `fixtures/` and `qa-sites/`. Fixtures must
  stay neutral and synthetic — real client or test-site names and copied content
  must not enter them (enforced by `scripts/check.mjs`).
- Live verification is available through the run driver
  (`.claude/skills/run-web-qa-assistant/`), including real audits and screenshots
  of the actual extension UI.
- **Absences future work must not fabricate:** there are no testimonials,
  named customers, case studies, benchmarks, press, pricing, licensing terms, or
  user counts. There is no accessibility conformance claim. Do not invent them,
  including as placeholder copy.

## Product Principles

1. **Deterministic evidence decides what exists.** Reasoning explains it and
   never overrides it.
2. **Never manufacture certainty.** Unverifiable is a coverage fact, not a
   defect, and not silence either.
3. **Cost lands on the operator's machine, not the vendor's.** Anything that
   would make infrastructure scale with the audited site's size is suspect.
4. **No discipline wins on volume.** A scanner that emits many cheap findings
   must not crowd out a confirmed functional failure.
5. **A finding is only finished when it is presentable.** What was detected,
   where, the evidence, impact, confidence, and the recommended action — legible
   to someone who has never seen the codebase, and defensible to a client.

## Accessibility & Inclusion

No formal accessibility commitment has been established for Lumen's own
interface. This is explicitly undecided, not an omission: future work must not
state or imply WCAG conformance for the product UI.

Note the standing irony to resolve deliberately rather than by accident: Lumen
audits accessibility, so its own interface failing checks it reports on others is
a product credibility risk even without a formal claim.
