# Web QA Assistant 1.5.2

## Frank reasoning overhaul

Frank now prefers Chrome built-in AI from the explicit **Ask Frank** interaction. The local model is used only to improve the wording of an already-verified deterministic walkthrough; it cannot replace the finding, target, evidence references, metrics, assessment, or verification structure.

If Chrome's local model is unavailable or still preparing, Frank remains fully usable with **Verified guidance**. First-use model preparation is time-bounded so the UI does not hang. Optional metered cloud reasoning is off by default and requires both a user opt-in in the extension and `EXTENSION_CLOUD_AI_ENABLED=true` on the gateway.

## Evidence and recommendation safeguards

- local AI output uses a strict structured response contract
- page-derived strings are explicitly treated as untrusted data rather than model instructions
- generic filler is rejected
- unsupported WCAG references, invented URLs, and invented contrast ratios are rejected
- observed and required contrast ratios must survive AI rewriting
- decorative-image guidance cannot be rewritten away from the verified `alt=""` outcome
- one-browser LCP observations cannot be upgraded into claims about field regressions
- cloud fallback plans still pass the existing local Frank plan validation before display

## Product and UX changes

- normal scans no longer imply that AI ran; the overview is labelled **Evidence summary**
- Frank distinguishes **On-device reasoning**, **Cloud reasoning**, and **Verified guidance**
- Chrome built-in AI readiness is reported separately from gateway integrations
- the cloud fallback control is visibly **optional · metered** and defaults off
- keyboard focus returns to the originating **Ask Frank** control when the walkthrough closes
- changing walkthrough steps use a polite live region for assistive-technology users
- failed Frank startup paths release pending local-model sessions instead of leaving them alive

## Cost and privacy boundary

Routine extension scans never call a metered model provider. With `EXTENSION_CLOUD_AI_ENABLED=false` and `PUBLIC_AI_ENABLED=false`, no OpenAI API call is required for the extension's normal Frank experience. Provider keys and installation-signing secrets remain server-side and are never bundled into the extension.

## Review-found fixes

The production-readiness review also found and corrected a pre-existing contrast-formatting defect that could render a required ratio already expressed as `4.5:1` as `4.5:1:1` in deterministic Frank guidance.

All scanner, prioritization, image-purpose, integration-health, browser-performance, privacy, UI, compact-overlay, and deployment improvements from 1.5.0 and 1.5.1 remain in place.
