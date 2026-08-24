# Final multi-role review — Web QA Assistant 1.5.2

## Lead engineering result

The implementation keeps deterministic browser/tool evidence authoritative and moves Frank's preferred language-reasoning layer to Chrome built-in AI. Normal scans contain no model-provider call. Optional cloud reasoning is a separate, double-opt-in fallback.

## Specialist findings

### Frontend / product UX
- Corrected scan labels that implied AI had already run.
- Added explicit on-device/cloud/verified-guidance states.
- Bounded first-use model preparation so Frank remains responsive.
- Restored focus after walkthrough exit and added live-region announcements for changing steps.

### Backend / API
- `/api/context` explicitly disables AI.
- Cloud Frank endpoints are gated by `EXTENSION_CLOUD_AI_ENABLED` and existing extension authentication.
- Integration health no longer treats cloud AI as a required dependency.

### Accessibility
- Deterministic findings remain the source of truth.
- Contrast evidence carries observed/required ratios and colors when available.
- Decorative-image decisions remain classifier-gated and cannot be reversed by local AI.
- A ratio-formatting defect in deterministic contrast guidance was found during review and fixed.

### Performance
- Local AI starts only on **Ask Frank**, not during scans.
- First-use model preparation has a bounded wait and late sessions are destroyed.
- LCP remains explicitly a browser lab observation; AI output that upgrades it into a field regression is rejected.

### Security / privacy
- Local Frank contains no network or model-provider API call.
- Page-derived evidence is treated as untrusted prompt data.
- Provider/shared secrets remain outside the extension.
- AI output that invents URLs or unsupported standards is rejected.
- Existing cloud-evidence sanitization and private-host restrictions remain intact.

### SEO / web quality
- Existing deterministic SEO, broken-link, environment, integration, and performance findings remain unchanged by the AI architecture.
- AI cannot add or remove findings or change their priority/assessment state.

## Adversarial QA outcomes

Adversarial cases covered generic filler, invalid structured output, unavailable local AI, first-use activation failure, slow model preparation, decorative-image reversal, LCP overclaim, invented WCAG criteria, invented contrast ratios, invented URLs, cloud-cost leakage, and previously working scanner regressions.

Material defects found during review were returned to implementation and fixed before the final regression pass.

## Remaining acceptance boundary

The execution environment could not load the unpacked extension with a usable Chrome built-in Prompt API runtime. The API contract is implemented against current Chrome documentation and covered with contract-level tests, but one acceptance run on a qualifying real desktop Chrome installation remains required before calling on-device inference runtime-verified.
