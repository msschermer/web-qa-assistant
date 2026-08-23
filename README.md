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

## What 1.4 adds

- redesigned extension and web UI led by Frank's judgment rather than raw scanner counts
- progressive-disclosure finding cards with human meaning first and technical evidence second
- `confirmed`, `corroborated`, `inferred` and `inconclusive` confidence states
- targeted **Recheck** flow for issue verification after a fix
- site-session history for pages the user actually scans, without turning the extension into a crawler
- visible resolved-issue lifecycle
- **Copy issue** handoff for Slack, GitHub, Monday, Jira or other ticket workflows
- one assistant gateway for connected services instead of direct extension access to every tool
- AI Evidence Contract and gateway sanitization before page evidence leaves the extension
- request IDs, diagnostics and integration-health checks
- public web AI disabled by default even when OpenAI is configured
- GitHub CI and tag-based release packaging
- shared UI design tokens across extension and web surfaces

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
- **OpenAI Responses API** for optional connected reasoning after deterministic evidence exists

The extension does not need direct host permissions to those specialized services.

## Frank

A Frank walkthrough uses a strict structured plan. Depending on the finding, steps may include:

1. location or evidence
2. corroborating evidence/comparison
3. why it matters here
4. what to change
5. how to verify

Visual findings use a deterministic target registry. Document-level, historical and page-level findings do not fake a spotlight. If a visual target disappears after scanning, Frank falls back to page-level evidence.

The UI explicitly distinguishes:

- **Connected reasoning**: OpenAI is available and used only after the QA engine establishes the finding.
- **Standard guidance**: deterministic Frank guidance using the same verified evidence, with no cloud AI dependency.

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

The extension sends a sanitized, bounded report to the assistant gateway for connected context. It does not send a whole DOM. Before cloud AI is used, Frank applies an even narrower AI Evidence Contract.

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
- `docs/QA-1.5.1.md`
- `docs/RELEASE-CHECKLIST.md`

## Release workflow

`main` is the known-good release branch. Development happens on feature/fix branches. GitHub Actions runs the extension build, static checks and tests on every PR. A `v*` tag validates version alignment and packages both the clean extension zip and full source zip for the GitHub Release.

Current delivery candidate: **1.5.1**.


## Documentation

- `docs/BOSS-DELIVERY-SUMMARY.md` - final four-agent and boss delivery gate
