# Build status: Web QA Assistant 1.5.2

## Delivery candidate

1.5.2 is the Frank reasoning and cost-control overhaul layered on the complete 1.5.1 trust/correctness release. All 1.5.0 and 1.5.1 scanner, prioritization, performance, integration-health, privacy, UI, compact-overlay, and deployment improvements remain in place.

## 1.5.2 improvements

- Chrome built-in Prompt API is Frank's preferred reasoning layer in supported Chrome versions
- on-device model work begins only from the explicit **Ask Frank** user gesture and uses structured JSON output
- deterministic findings, targets, evidence references, assessment state, metrics, and verification remain authoritative; local AI may improve wording but cannot replace the plan structure
- adversarial quality gates reject generic AI filler, contrast guidance that drops or invents measured ratios, unsupported standards/URLs, decorative-image alt regressions, and performance claims that overstate a one-browser lab observation
- first-use model download no longer blocks Frank indefinitely; verified deterministic guidance remains immediately usable while Chrome finishes preparing the local model
- routine extension scans explicitly disable metered model calls on the gateway
- optional cloud Frank requires both an extension user opt-in and the server `EXTENSION_CLOUD_AI_ENABLED=true` gate; both default off
- managed installation access remains independent from AI and normal users do not paste a shared gateway key
- connection health treats on-device Frank and optional cloud fallback separately from the three connected QA integrations
- Frank's UI labels now distinguish **Evidence summary**, **On-device reasoning**, **Cloud reasoning**, and **Verified guidance** instead of implying that every scan ran AI
- keyboard focus returns to the originating finding after a Frank walkthrough and changing walkthrough content is announced as a live region
- a pre-existing contrast-evidence defect that could format `4.5:1` as `4.5:1:1` was found during adversarial review and fixed

## Validation

Exact test/check/build results are recorded during packaging. See `RELEASE_PROVENANCE.txt` and `docs/QA-1.5.2.md`.
