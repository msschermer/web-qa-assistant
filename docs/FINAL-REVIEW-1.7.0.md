# Final review: Web QA Assistant 1.7.0

## Gate decision

The 1.7 plan was approved only after two revisions to scope:

1. **Report bug** had to become a privacy-bounded support workflow with useful runtime tracing, not a renamed developer diagnostics control.
2. The interface had to adopt a real workspace hierarchy and translation layer, not another palette/card restyle.

## Lead engineering review

The implementation keeps deterministic scanners as the truth authority and introduces presentation/support layers without moving detection logic into AI. Security now has its own impact class. Frank's on-device validator covers fix families across navigation, discoverability, performance, security, web quality, and accessibility.

## Product/UX review

The primary workflow is now page assessment → QA areas → recommended order → finding → Frank. Raw technical details are intentionally demoted. Frank's centered card owns reasoning; the side panel owns audit evidence. Tooltips support unfamiliar concepts but do not hide required explanations.

## Security/privacy review

Report bug is local-only by default and uses allowlisted/bounded context. Runtime tracing records operational state and validation codes without using it as an excuse to collect page content. Explicit context remains sanitized. Existing AI evidence and high-risk-action safeguards remain required release invariants.

## Adversarial review

Release tests must challenge noisy-category dominance, inconclusive link failures, invented URLs/metrics/standards, cross-site leakage, hostile page instructions, model remediation drift, performance overclaims, and Report bug secret leakage.

## Runtime limitation

Repository tests cannot substitute for Chrome's real built-in Prompt API. Final acceptance therefore includes real desktop Chrome plus a Report bug export, which provides enough bounded runtime evidence for post-test review without remote browser access.
