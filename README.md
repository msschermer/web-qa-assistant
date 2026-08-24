# Web QA Assistant with Frank

Web QA Assistant is an evidence-first browser QA product for developers, implementation teams and technical SEO work. It combines deterministic browser inspection, verified internal-link checks, accessibility testing, published-state context and historical performance context. **Frank** is the guided investigation layer that turns a verified finding into a clear sequence of evidence, impact, remediation and re-verification.

The project evolved from the original **Preflight** prototype. The legacy implementation is preserved in Git on the `legacy-preflight` branch and `preflight-legacy` tag. The active product no longer depends on the old Preflight service.

## Product rule

**Deterministic systems establish whether an issue exists. Frank explains and assists. AI is not the scanner.**

A finding follows this path:

```text
observation
  -> verification
  -> confidence
  -> environment-aware materiality
  -> finding
  -> relevant connected evidence
  -> Frank
  -> remediation
  -> recheck
```

The scanner may retain lower-priority observations, but Frank's default view is intentionally selective. Inconclusive evidence never becomes a defect. A timeout, blocked checker or unavailable integration is reported as a coverage limitation instead of an issue.

## What 1.7.0 adds

- a real cross-discipline QA workspace organized around **Page assessment**, **QA areas**, **Recommended order**, and **Workspace tools**
- consumer-facing finding translation across Navigation, Discoverability, Performance, Accessibility, Security, and Web quality while preserving raw scanner output under **Technical evidence**
- a dedicated Security impact class so security findings are not hidden inside generic availability/implementation buckets
- a privacy-bounded **Report bug** workflow that records runtime/readiness/validation state locally, exports JSON, sends nothing automatically, and keeps page/Frank content excluded by default
- explicit context opt-in for bounded current-finding measurements and Frank wording, still excluding selectors, raw DOM, form values, cookies, and credentials
- broader on-device Frank validation for links, indexing/robots, canonicals, LCP/TTFB/transfer weight, opener security, meta refresh, charset, and accessibility families
- mixed-discipline acceptance tests that prevent a noisy scanner from crowding out higher-confidence navigation, discoverability, performance, or security issues
- a presentation hierarchy where Frank explains meaning/action while the sidebar remains the auditable evidence record

## What 1.6.1 adds

- rule-specific Frank guidance for `axe.target-size`, using structured size and spacing evidence instead of generic accessibility boilerplate
- target-size impact language grounded in pointer/touch activation rather than unrelated keyboard or low-vision claims
- claim/fix-family validation for on-device rewrites so Chrome AI can substantially improve wording without being forced to echo deterministic prose
- explicit reasoning-mode disclosure in the centered Frank card: **On-device reasoning**, **Verified guidance**, or **Cloud reasoning · metered**
- step-specific evidence selection so Frank highlights the measurements that actually support the current explanation
- evidence-ledger source semantics that separate observed evidence from standards/reference context and suppress meaningless single-pass verification counts
- a compact sticky finding identity in Frank mode plus scroll reset so the finding title is not lost when the walkthrough opens
- the failed real-world 24px target-size scenario promoted into the automated acceptance suite

## What 1.6.0 adds

- a dedicated Chrome built-in AI readiness manager that is independent from page scanning
- visible `downloadable`, `downloading`, `warming`, `ready`, `unavailable`, and error states for Frank
- first-use preparation that resumes the pending **Ask Frank** request automatically when Chrome becomes ready; **Rescan** is never an AI-recovery action
- one warm system-only Prompt API base session with isolated cloned sessions per finding, preventing cross-site or cross-finding conversation carryover
- an evidence-led focus mode: the sidebar is the deterministic evidence ledger while the centered Frank card contains interpretation, impact, remediation, and verification
- a stronger Frank visual identity without adding a Tailwind migration or build dependency
- more specific deterministic remediation, including evidence-derived passing contrast-color suggestions when they can be calculated safely
- additional adversarial AI guards for unsupported page positions/components, business claims, invented measurements, semantic drift, and destructive/secret-handling instructions embedded in hostile page text
- self-contained extension rebuilds that preserve the vendored axe runtime even when a release source package is used without `node_modules`
- all 1.5.0–1.5.2 scanner, prioritization, performance, integration-health, privacy, managed-auth, and zero-metered-AI defaults remain in place

## Deterministic and connected systems

Local browser-side inspection uses:

- browser rules for metadata, canonical state, document structure, implementation and security signals
- `axe-core` for automated accessibility findings
- staged same-origin link verification with independent confirmation before 404/5xx findings are admitted
- verified target IDs for Frank highlighting

Connected context is routed through the assistant gateway:

- **Meta State** for published metadata, indexing/crawler directives, redirects and structured-data state
- **Performance Monitor** for historical mobile/desktop context
- **WCAG Translator** when accessibility findings need standards mapping
- **Chrome built-in Prompt API** for Frank's preferred on-device reasoning in supported Chrome versions
- **OpenAI Responses API** only as an optional, explicitly enabled metered cloud fallback

The extension does not need direct host permissions to those specialized services.

For normal distribution, the gateway can enable **managed installation access**. The extension then receives an expiring per-install signed token automatically, so users do not paste a shared gateway key. No reusable gateway secret is bundled in the extension. Managed public access is intentionally opt-in and rate/quota limited; private deployments can continue to require a developer access key.

Normal extension scans and normal Frank walkthroughs do **not** call a metered model provider. `EXTENSION_CLOUD_AI_ENABLED=false` is the server default, and the extension's Cloud AI fallback toggle is off by default. `PUBLIC_AI_ENABLED=false` keeps the portfolio web scanner deterministic as well.

## Frank

A Frank walkthrough uses a strict structured plan. Depending on the finding, steps may include:

1. what the evidence means
2. corroborating comparison/trend when supported
3. why it matters here
4. what to change
5. how to verify

Visual findings use a deterministic target registry. Document-level, historical and page-level findings do not fake a spotlight. If a visual target disappears after scanning, Frank falls back to page-level evidence.

The UI explicitly distinguishes:

- **On-device reasoning**: Chrome built-in AI improved the deterministic guidance locally. Page evidence was not sent to an AI provider.
- **Cloud reasoning**: the user explicitly enabled the optional metered cloud fallback and the gateway returned a valid evidence-contracted walkthrough.
- **Verified guidance**: deterministic Frank guidance remains actionable when on-device AI is unsupported, still downloading, fails quality checks, or is intentionally unavailable. The UI states the reason instead of implying AI ran.

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

The extension sends a sanitized, bounded report to the assistant gateway for connected service context. It does not send a whole DOM. Frank's preferred AI improvement runs on-device with Chrome built-in AI. If the optional cloud fallback is explicitly enabled, Frank applies an even narrower AI Evidence Contract before any finding evidence leaves the product boundary.

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

## Production

Production deployment is designed around `assistant.msschermer.us` as the controlled gateway. The renderer and egress proxy remain internal; only the API is bound to host loopback for the reverse proxy.

Detailed procedures:

- `docs/INSTALLATION.md`
- `docs/DEPLOYMENT.md`
- `docs/QA-1.7.0.md`
- `docs/RELEASE-CHECKLIST.md`

## Release workflow

`main` is the known-good release branch. Development happens on feature/fix branches. GitHub Actions runs the extension build, static checks and tests on every PR. A `v*` tag validates version alignment and packages both the clean extension zip and full source zip for the GitHub Release.

Current delivery candidate: **1.7.1**.


## Documentation

- `RELEASE_NOTES_1.7.0.md` - current release changes
- `docs/FINAL-REVIEW-1.7.0.md` - final multi-role, adversarial, security, and product review gate
