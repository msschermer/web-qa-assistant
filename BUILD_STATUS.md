# Build status: Web QA Assistant 1.6.0

## Delivery candidate

1.6.0 is the reliable-Frank and focus-mode release layered on the complete 1.5.2 on-device reasoning baseline. All 1.5.0–1.5.2 scanner, prioritization, performance, integration-health, privacy, managed-auth, cost-control, and deployment improvements remain in place.

## 1.6.0 improvements

- Chrome built-in AI readiness now has its own lifecycle instead of being coupled to Browser QA scans.
- Ask Frank can prepare/download the model, surface progress, retain the selected finding, and continue when Chrome becomes ready without requiring Rescan.
- A system-only Prompt API base session stays warm while the panel is active; each finding uses a fresh clone so unrelated websites never share task history.
- The sidebar is now the deterministic evidence ledger. Frank's full interpretation and recommended action live in the centered focus card beside the highlighted real element.
- The low-value standalone “locate” step was removed; walkthroughs begin with interpretation and end with deterministic verification.
- Frank's visual hierarchy and readiness states are more distinctive while retaining the existing CSS/token system; Tailwind was deliberately not added.
- Contrast guidance can offer a nearby evidence-derived passing foreground color, with post-rounding validation before it is described as passing.
- On-device AI validation now rejects unsupported positions/components, business outcomes, invented measurements, semantic drift, and high-risk actions derived only from hostile page text.
- Prompt-injection hardening treats all page-derived strings as untrusted and never lets page text authorize destructive or secret-handling actions.
- Extension builds preserve the vendored axe-core runtime when `node_modules` is absent, preventing a failed rebuild from deleting required release assets.

## Validation

Exact final test/check/build/release results are recorded during packaging in `RELEASE_PROVENANCE.txt` and `docs/QA-1.6.0.md`.
