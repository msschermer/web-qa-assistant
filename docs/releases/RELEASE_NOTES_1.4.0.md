# Web QA Assistant 1.4.0

## Final productization release

1.4 turns the working Frank prototype into a team-delivery candidate focused on trust, usability, connected architecture and deployment.

### Experience

- Frank judgment now leads both extension and web UI.
- Finding cards prioritize human meaning, confidence and actions; rule IDs/selectors move under technical details.
- Added targeted **Recheck** and closed-loop resolution feedback.
- Added Site session progress for pages the user actually scans.
- Added visible **Resolved this scan** lifecycle.
- Added **Copy issue** handoff format.
- Connected AI is labeled **Connected reasoning**; deterministic fallback is **Standard guidance**.
- Extension/web share design tokens aligned with the portfolio visual system.

### Trust and verification

- Inconclusive checks remain coverage-only.
- Link verifier retains multi-stage confirmation and grouping.
- Connected-only Recheck now re-runs connected enrichment, preventing false “resolved” results.
- Frank plan schema includes assessment status, statement and limitations.

### AI and privacy

- Added AI Evidence Contract.
- Added a separate sanitized gateway context envelope before connected context leaves the extension.
- Gateway Frank requests are sanitized before transmission and sanitized again before OpenAI.
- Form values, cookies, arbitrary data attributes and URL query values are excluded/redacted.
- Public web AI is opt-in with `PUBLIC_AI_ENABLED=false` by default.

### Integration architecture

- Removed active legacy Preflight connector/service dependency.
- Extension now talks to one assistant gateway for connected services.
- Added capability/tool registry and relevant WCAG routing.
- Added custom gateway permission flow and Test connection UI.
- Added protected integration-health endpoint.

### Deployment and operations

- Added request IDs across extension/gateway/connectors/renderer.
- Added GitHub CI for PR/push validation.
- Added tag-based GitHub Release packaging.
- Added tag/package/manifest release validation.
- Docker API binds only to `127.0.0.1:8787` for host reverse proxy.
- Renderer receives a healthcheck and remains internal with the egress proxy.
- Added complete installation, deployment, privacy and AI-contract documentation.

### Automated validation

- extension build: PASS
- static checks: PASS
- unit/regression tests: 58/58 PASS
- service-worker relative import graph: PASS
- local API: HTTP 200
- local renderer: HTTP 200
- local Chromium detected: yes

Real Chrome/client-site acceptance is still required before merging the delivery branch to `main`.
