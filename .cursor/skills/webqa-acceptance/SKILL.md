---
name: webqa-acceptance
description: Run cross-discipline Web QA Assistant acceptance against real public sites using the local MCP harness.
disable-model-invocation: true
---
# WebQA acceptance

The parent Agent collects deterministic evidence with the `webqa` MCP. Use Cursor's native Browser tool for ordinary public-page interaction/screenshots. Use `playwright-live` only when an existing Chrome tab/profile is specifically needed.

For each requested site:
1. Check WebQA/gateway health.
2. Run a deterministic API scan.
3. Review Page Assessment / QA-area coverage / Recommended Order. Treat blocked/WAF/challenge responses as valid integrity outcomes, not successful page audits.
4. When useful, use Cursor's native Browser on the same target. Do not substitute curl or web search when browser evidence is required. Use `playwright-live` against a deliberately selected real-Chrome tab only when profile/session parity matters; neither path proves side-panel UI behavior.
5. Exercise Frank on a representative high-confidence finding, not necessarily accessibility.
6. Capture screenshots/runtime artifacts with the parent Agent, then hand the collected evidence to the read-only `browser-acceptance` reviewer.
7. Evaluate evidence fidelity, target resolution, explanation, remediation and verification.

Across a release sample, cover several of Navigation, Discoverability, Performance, Accessibility, Security/Web quality and Coverage. Do not equate finding count with importance.

Save outputs under `qa-runs/`; never commit those artifacts unless they are intentionally sanitized fixtures.
