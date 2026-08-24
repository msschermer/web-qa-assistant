# Web QA Assistant 1.5.1

1.5.1 is a trust-and-correctness release built on the complete 1.5.0 redesign. No 1.5.0 product improvement was removed.

## Highlights

- closes the image-purpose semantic propagation gap so Frank receives adjacent text on the real runtime path
- corrects browser LCP collection using buffered PerformanceObserver
- reports transfer weight as a known lower bound when browser timing cannot expose every resource
- adds TTFB-, LCP-, and payload-specific Frank recommendations
- replaces spread-based AI finding serialization with a strict allowlist and nested URL sanitization
- broadens rule-specific guidance outside accessibility
- introduces a synthetic known-answer acceptance fixture and stronger contamination gates
- enforces release metadata consistency

See `docs/QA-1.5.1.md` for acceptance.
## Connection hardening refresh

- Protected-gateway 401/403 responses are no longer collapsed into the generic connected-services outage warning. The panel now distinguishes a missing access key from a rejected one and opens Connection settings automatically.
- Test connection validates the gateway URL and access key currently visible in the form, even before Save is clicked. Saving connection settings now immediately runs the same validation.
- A custom gateway is authoritative when configured rather than silently falling back to another gateway after a failure.
- The extension manifest now carries a stable public key so future unpacked builds retain the same extension identity and local settings when loaded from different directories. Existing pre-refresh unpacked installs still require the access key to be entered once because Chrome storage cannot be read across the previous extension ID.


## Capability-health refresh

- Integration health no longer assumes each specialized service implements a guessed `/health` route. It validates the same capability contract used during a real scan: Meta State inspect, Performance Monitor data, and WCAG Translator translate.
- HTTP 404 remains a hard `not-found` state. `available` now requires a successful capability response.
- Optional `*_HEALTH_PATH` environment overrides are available for deployments that later expose dedicated health endpoints.
- Connection acceptance now requires the gateway itself to report v1.5.1 before this release is considered fully deployed.

## Frank reliability and managed-access refresh

- Frank no longer silently converts a failed connected-AI request into an apparently normal walkthrough. The gateway returns an explicit reasoning state and failure code, and the extension labels fallback guidance visibly.
- Connection health now distinguishes **AI configured** from **Frank AI operational** using a cached, bounded Responses API probe.
- The deterministic fallback no longer inserts the generic "evidence behind the finding" walkthrough step. Evidence remains available in the expandable evidence panel while the walkthrough focuses on interpretation, impact, remediation, and verification.
- Axe contrast evidence now preserves observed/required ratios and relevant computed color data when the scanner supplies them. Frank can explain the affected text and the smallest relevant correction rather than repeating rule provenance.
- Normal installs can use opt-in managed installation access. The extension generates an installation ID, obtains a signed expiring token from the gateway, and refreshes it automatically. No shared gateway secret is embedded in the extension.
- Managed installation access is disabled by default on the server and carries per-install request limits. A developer access key remains available as an override for private gateways.
