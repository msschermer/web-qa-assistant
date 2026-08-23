# Web QA Assistant 1.5.0

Delivery candidate on `feature/final-product-pass`. Not merged to `main`.
Gate: `docs/QA-1.5.0.md` must pass in a real browser first.

This release answers two acceptance findings from 1.4.0: Frank was reasoning from
rules rather than from the page, and the issue feed was dominated by whichever
scanner produced the most rows.

---

## Frank understands the page, not just the rule

**Semantic context.** Findings now carry accessible-naming context (role, aria-label,
labelledby text, associated label, interactive ancestor, containing landmark) and
parent container context, gathered deterministically from the DOM.

**Image purpose classification.** A new deterministic classifier resolves whether an
image is decorative, informative, functional, complex or uncertain, using DOM
relationships, rendered size, naming hints and adjacent visible text.

**Recommendation contract.** Frank's walkthrough now leads with an interpretation
step — what the element is doing on this page — before impact, recommendation, ruled-out
alternatives and verification.

The acceptance case: a check icon beside visible text that already states its meaning
now produces a
single recommendation to set `alt=""`, with the adjacent text cited as the reason.
Previously it produced an unnecessary decorative/informative fork.

**The fork is kept when it is correct.** Recommending `alt=""` on a genuinely
informative image would delete meaning from the page — a regression caused by our own
tool, and worse than offering a choice. A confident verdict therefore requires
corroborating signals and no contradicting signal. An icon-named image rendered at
content size returns uncertain, and both branches are presented.

Axe's `failureSummary` is no longer used as a remediation. It is a diagnostic, and
treating it as an instruction was the rule-first behaviour this release removes. It
remains available as evidence.

## The feed reads like a QA brief

**Impact classes.** Every finding is classified by what it threatens — availability,
discoverability, accessibility, performance, implementation, coverage — rather than by
which tool found it.

**Grouping.** Repeated instances of one rule collapse into one finding with an
instance count and an expandable list of affected selectors. Two different broken
destinations remain two findings.

**Cross-discipline composition.** Every represented class contributes its strongest
group before any class contributes a second. Materiality scoring is class-blind, so a
category cannot buy rank by producing more rows.

Classes are never padded. A class with nothing material does not appear.

## Current-page performance

Navigation Timing, paint timing, transfer weight and heaviest resources are collected
from the inspecting browser. This is labelled as a lab observation everywhere it
surfaces, with deliberately loose thresholds, so machine and network variance cannot
manufacture a false regression. Monitored history remains the only basis for a
regression claim.

## New interface

Quiet neutral canvas, elevated white surfaces, restrained navy brand accent, 6–12px
radii, semantic soft-tint chips, left-edge severity accents in place of top bars, and
substantially less visible chrome. IBM Plex Sans carries everything a person reads;
mono is reserved for selectors, rule IDs, HTTP codes and scores.

The impact ledger sits under the brief, showing counts per area and filtering the
feed on click.

The page overlay is now orientation only — mark, progress, one line, Back and Next.
Narrative, evidence and remediation live in the side panel. The duplicated
remediation card is gone.

## Defects fixed

**Integration health reported HTTP 404 as available.** Any response under HTTP 500
was treated as healthy, so a misconfigured integration URL looked fine. Status is now
`available`, `unauthorized`, `not-found`, `degraded` or `unavailable`, each with an
actionable detail string.

If an integration that previously read as available now reads as `not-found`, the URL
was already wrong. The status is newly accurate, not newly broken.

**Test connection could not distinguish reachability from authorisation.** `/api/health`
is public by design, so a reachable response proved nothing about the access key.
Reachability and authorisation are now probed and reported separately, with
per-integration rows in the panel. A rejected key renders as a warning, never as a
healthy connection.

## Deployment

`docker-compose.portfolio.yml` joins the existing external `portfolio-infra_web`
network, so the shared Caddy reaches the gateway by service name and the base compose
file no longer needs hand-editing on the droplet.

```bash
docker compose -f docker-compose.yml -f docker-compose.portfolio.yml up -d --build
```

## Release gates added

`npm run check` now fails on:

- image-purpose.js not injected before browser-rules.js
- any page-capture API (`captureVisibleTab`, `getDisplayMedia`, `html2canvas`) in
  extension source
- integration health equating reachability with availability
- the brief bypassing cross-discipline composition
- axe `failureSummary` standing in as image remediation
- the page overlay rendering both a headline and a body
- missing `impact.js`, `compose.js`, `image-purpose.js`, or a stale dist build

## Considered and not implemented

**Target screenshot crops to multimodal reasoning.** Rejected on three grounds:
`captureVisibleTab` requires broad host permissions and would mean deleting an
existing permission-minimisation gate; a viewport capture carries whole-DOM, form-value
and cookie content past the AI Evidence Contract as pixels; and the motivating case is
fully resolvable from DOM semantics. A build gate now prevents this from reappearing
silently.

**Live PageSpeed Insights on demand.** Deferred. A live call takes 10–30 seconds,
requires an API key, and measures the public URL rather than the inspected page — so it
fails on staging, authenticated and preview pages, which is where this tool is used.
Reasonable to add later for confirmed public URLs.

## Known limitation

IBM Plex is referenced in the token system but is not bundled and no webfont is
loaded. On a machine without Plex installed, the stack falls back to `system-ui`. The
fallback was tuned to still read as deliberate. Bundling a woff2 subset is the correct
fix if brand consistency matters; it adds roughly 200KB to the extension.

## Validation

- `npm run check` — pass, 38 files
- `npm test` — 91/91 pass, up from 58
- `npm run build:extension` — pass
- Service-worker relative module graph — pass
- package / lock / manifest / dist manifest — all 1.5.0

New test coverage: `tests/image-purpose.test.js`, `tests/attention-composer.test.js`,
`tests/recommendation-contract.test.js`, `tests/integration-health.test.js`.

## Version

Incremented from 1.4.0 rather than continuing on it. With a 1.4.0 candidate already
deployed to the droplet and loaded in Chrome, and materially different behaviour in
this build, a shared version number would make it impossible to tell which artifact is
running from `/api/health` or `chrome://extensions`.

## Repository hygiene

External test-site identity was removed from tests and documentation. Fixtures use
reserved `example.com` domains and synthetic labels throughout.

No external test-site identity is permitted in shipped runtime code or release
fixtures. `npm run check` enforces this with an infrastructure/domain allowlist rather
than storing a blocklist of real organizations. Any absolute URL in source, tests or
docs pointing at a host outside `ALLOWED_HOSTS` fails the build. Add genuine
infrastructure hosts to that list; use reserved example domains for fixtures.
