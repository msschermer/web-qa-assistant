# Lumen (Web QA Assistant)

Lumen is an evidence-first web QA and site-auditing product, built for **agencies and independent consultants auditing sites they do not own** — repeatedly, and with a client waiting for the output. In-house developers, implementation teams and technical SEO work are compatible audiences, not the design target.

It works at two scales. **Page Scan** inspects the current page in the real browser: axe-core accessibility, browser rules, verified link checks, live element highlighting. **Site Audit** crawls a whole site from the assistant gateway — a cheap static fetch, never a server-side render — and then offers an optional per-page browser pass for the checks that need a real browser. Walkthroughs turn a verified finding into a clear sequence of evidence, impact, remediation and re-verification.

The project evolved from an earlier **Preflight** prototype, which it no longer depends on in any form. That prototype is not part of this repository and none of its history is carried here; this tree begins at the first Lumen commit.

## Product rule

**Deterministic systems establish whether an issue exists. Walkthroughs explain and assist. AI is not the scanner.**

A finding follows this path:

```text
observation
  -> verification
  -> confidence
  -> environment-aware materiality
  -> finding
  -> relevant connected evidence
  -> walkthrough
  -> remediation
  -> recheck
```

The scanner may retain lower-priority observations, but the default view is intentionally selective. Inconclusive evidence never becomes a defect. A timeout, blocked checker or unavailable integration is reported as a coverage limitation instead of an issue.

## Recent releases

Per-release detail lives in `docs/releases/`, newest first — see `RELEASE_NOTES_1.7.5.md`. `BUILD_STATUS.md` records what is released, what the next target is, and the known gaps as they stand today.

## Deterministic and connected systems

Local browser-side inspection uses:

- browser rules for metadata, canonical state, document structure, implementation and security signals
- `axe-core` for automated accessibility findings
- staged same-origin link verification with independent confirmation before 404/5xx findings are admitted
- verified target IDs for walkthrough highlighting

The site crawl runs on the gateway and parses HTML with jsdom without executing JavaScript, which is what keeps it cheap at any site size — so any absence it reports is `inferred`, never confirmed. The checks that genuinely need a browser (accessibility, JavaScript-dependent content, image and performance sizing) run afterwards in the operator's own browser, one page at a time. **The crawl path never calls the renderer or server-side Chromium**; that boundary is load-bearing for the cost model, not an implementation detail.

Connected context is routed through the assistant gateway:

- **Meta State** for published metadata, indexing/crawler directives, redirects and structured-data state
- **Performance Monitor** for historical mobile/desktop context
- **WCAG Translator** when accessibility findings need standards mapping
- **Chrome built-in Prompt API** for preferred on-device reasoning in supported Chrome versions
- **OpenAI Responses API** only as an optional, explicitly enabled metered cloud fallback

The extension does not need direct host permissions to those specialized services.

For normal distribution, the gateway can enable **managed installation access**. The extension then receives an expiring per-install signed token automatically, so users do not paste a shared gateway key. No reusable gateway secret is bundled in the extension. Managed public access is intentionally opt-in and rate/quota limited; private deployments can continue to require a developer access key.

Normal extension scans and normal walkthroughs do **not** call a metered model provider. `EXTENSION_CLOUD_AI_ENABLED=false` is the server default, and the extension's Cloud AI fallback toggle is off by default. `PUBLIC_AI_ENABLED=false` keeps the portfolio web scanner deterministic as well.

## Walkthrough

A walkthrough uses a strict structured plan. Depending on the finding, steps may include:

1. what the evidence means
2. corroborating comparison/trend when supported
3. why it matters here
4. what to change
5. how to verify

Visual findings use a deterministic target registry. Document-level, historical and page-level findings do not fake a spotlight. If a visual target disappears after scanning, the guide falls back to page-level evidence.

The UI explicitly distinguishes:

- **On-device reasoning**: Chrome built-in AI improved the deterministic guidance locally. Page evidence was not sent to an AI provider.
- **Cloud reasoning**: the user explicitly enabled the optional metered cloud fallback and the gateway returned a valid evidence-contracted walkthrough.
- **Verified guidance**: deterministic guidance remains actionable when on-device AI is unsupported, still downloading, fails quality checks, or is intentionally unavailable. The UI states the reason instead of implying AI ran.

## Environment intelligence

The extension infers `production`, `staging`, `preview`, `local` or `unknown` with a confidence level. Environment changes interpretation, not scanner coverage. A staging `noindex` can remain quiet while the same signal on a primary production page becomes critical. Ambiguous public subdomains remain `unknown` instead of being promoted to production without stronger evidence.

The user can override the inferred environment per origin.

## Link verification

Internal link checking is evidence-driven:

```text
initial GET
  -> healthy: done
  -> suspected failure: independent retry
  -> mixed failure/inconclusive: third confirmation when required
  -> confirmed 404/410/5xx: finding
  -> repeated timeout/block: coverage only
```

Repeated links to the same destination are grouped into one underlying problem while preserving source locations. Confirmed issues in prominent navigation can be prioritized more strongly than tertiary links.

## Privacy boundary

The extension sends a sanitized, bounded report to the assistant gateway for connected service context. It does not send a whole DOM. Preferred AI improvement runs on-device with Chrome built-in AI. If the optional cloud fallback is explicitly enabled, an even narrower AI Evidence Contract is applied before any finding evidence leaves the product boundary.

Excluded from connected AI include:

- form values and password values
- cookies
- local/session storage
- authentication tokens and secrets
- arbitrary `data-*` attributes
- complete DOM snapshots
- query-string values

Private/local environments remain local-only.

See `docs/PRIVACY.md` and `docs/AI-EVIDENCE-CONTRACT.md`.

## Local development

```powershell
npm ci
npm run build:extension
npm run check
npm test
npm run dev
```

Web app: `http://localhost:3000/`

API health: `http://localhost:3000/api/health`

Renderer health: `http://localhost:8790/health`

If Chromium is not available:

```powershell
npx playwright install chromium
```

Build the Chrome extension with:

```powershell
npm run build:extension
```

Then load `dist/extension` from `chrome://extensions` using **Load unpacked**.

### Driving the running product

Most of Lumen is a Chrome extension and is invisible to `npm test`. A committed
harness builds, launches and screenshots the real thing:

```powershell
node tools/autoqa/driver.mjs audit https://example.com/ --max-pages 3
node tools/autoqa/driver.mjs ui https://example.com/
```

It starts the gateway if one is not already running, and writes screenshots to
`.autoqa/runs/driver/`. See
`tools/autoqa/driver.mjs`
for all commands, the one-time Chrome profile bootstrap, and the Chrome/Playwright
gotchas.

### Working in this repository

`AGENTS.md` is the operating contract, and it is the only one. It carries the
whole method: scope discipline, how to approach a regression, a scanner change or
a broad product pass, the required gates, and what counts as verification.

Everything you are told to run lives in the repository. The verification harness
is `tools/autoqa/driver.mjs`.

## Production

Production deployment is designed around `assistant.msschermer.us` as the controlled gateway. The renderer and egress proxy remain internal; only the API is bound to host loopback for the reverse proxy.

Detailed procedures:

- `docs/INSTALLATION.md`
- `docs/DEPLOYMENT.md`
- `docs/QA-1.7.0.md`
- `docs/RELEASE-CHECKLIST.md`

## Release workflow

`main` is the known-good release branch. Development happens on feature/fix branches. GitHub Actions runs the extension build, static checks and tests on every PR. A `v*` tag validates version alignment and packages both the clean extension zip and full source zip for the GitHub Release.

Current delivery candidate: **1.7.5**.


## How Optimize reasons

Before the plan is built, Lumen reads a **page-group model** from the crawl:
which URLs form families, how strongly those families cohere, and which of them
look like one template. Groups named by a path are something the site states;
groups found by similarity are something Lumen measured, and the two carry
different confidence. It is visible under **Optimize → Site model**, with the
measurement behind every claim.

That model then does two things no single scanner can:

- **Template actions.** Several *different* kinds of change landing on one page
  family is usually one file opened once, not several jobs. The proposal names
  the changes it covers and never replaces them, so the plan still reconciles
  against Findings.
- **Open questions.** Where the canonical, the sitemap and the internal links
  disagree, there is a real problem and no defensible instruction. Lumen states
  the question, what it will not decide, and what would settle it.

Both reach the exported Action Plan, on their own tabs, and the cover explains
what they are. `findings → jobs` is reported so it can be checked; the goal is
the smallest defensible set of changes, not the smallest number.

## Using a model

Lumen decides everything from evidence before a model is asked anything. What a
model is for is the **drafting** of replacement text: open a change in Optimize
that asks for one specific value, press **Draft a replacement**, and the model
writes a candidate title, meta description, heading or link text from that
page's own words. The draft is checked for length, for difference from the value
it replaces and from every sibling page, for unsupported claims, and for whether
it uses the page's vocabulary at all. It is never applied to the site; it lands
in the Action Plan export in its own column, labelled unchecked.

Configure one under **Writing** in the side panel. Any OpenAI-compatible
endpoint works, and the presets cover the common cases:

| Preset | Endpoint | Key |
|---|---|---|
| Ollama | `http://localhost:11434/v1` | none |
| LM Studio | `http://localhost:1234/v1` | none |
| OpenAI | `https://api.openai.com/v1` | yours |
| OpenRouter | `https://openrouter.ai/api/v1` | yours |

**Test endpoint** makes a real request and reports what answered. Chrome's
built-in model is offered when the browser can actually run it, which on most
machines it cannot; the picker says so rather than offering an option that
fails later. Nothing is metered by Lumen and no request passes through its
servers: the call goes from your browser to the endpoint you named.

Two different envelopes leave the machine, and they are not the same size. The
brief and the plan send discipline names, rule ids, severity, confidence and
counts, with no URL, host, page title or markup by construction. **Drafting
sends the page's own title, heading, description and address**, because that is
what drafting a title for it means. That is why drafting is a per-change button
and never something that runs on its own.

## Looking at the interface

```bash
npm run build:extension   # emits dist/extension/site-audit.css
npm run dev               # or: node services/api/server.js
npm run gallery           # screenshots and contrast-checks every state
```

`/gallery.html` renders every state of the Site Audit overlay on one page, from
the stylesheet the extension actually injects, inside a shadow root reproducing
its host contract. It leads with the states a real audit will not conveniently
produce, which are the ones that go unseen: all four confidence levels, the
priority bands, the scopes, an open question, a template action, the hatch, and
the empty states a healthy site produces.

`npm run gallery` is the machine reading of the same page: it computes contrast
for every text node in every specimen and fails on anything under its floor.

## Exporting an audit

The **Download** control in the Site Audit sidebar builds a single `.xlsx` from
whichever of the two deliverables you tick:

| Tick | Tabs you get |
|---|---|
| Action plan | About this report, Action plan, Plan phases |
| Scan results | About this report, Findings, Pages, Links |
| Both | all six, plan first |

The file is assembled by the local gateway from data that is already on the
machine, and handed straight back to the browser — nothing is uploaded to build
it. The same audit exports byte-identical twice, so the file can be checksummed
by whoever receives it. The HTML client report is still available from inside
the same control, and the per-dataset CSV exports are unchanged.

The writer is `packages/report/workbook.js` — hand-written rather than a
dependency, because a spreadsheet is a well-specified format plus a zip
container and this repository runs on five runtime dependencies with no build
step.

## Documentation

- `docs/releases/` - release notes, newest `RELEASE_NOTES_1.7.5.md`
- `docs/ARCHITECTURE.md` - how the extension, gateway and renderer fit together
- `docs/TOOL-CONTRACTS.md` - the contract each connected tool is held to
- `DESIGN.md` - the visual system as built; `docs/DESIGN-SYSTEM.md` - the product's language, walkthrough grammar and accessibility floor
- `PRODUCT.md` - product truth, audience and brand commitments
- `AGENTS.md` - the operating contract for contributors and agents
- `docs/FINAL-REVIEW-1.7.0.md` and `docs/QA-1.7.0.md` - the recorded multi-role, adversarial, security and product review gate for 1.7.0, kept as the worked example of what that gate looks like
