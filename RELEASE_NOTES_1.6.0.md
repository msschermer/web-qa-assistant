# Web QA Assistant 1.6.0

## Reliable Frank

Frank's Chrome built-in AI lifecycle is now independent from scanning. A first-use model download or warm-up is shown as preparation, progresses in place, and can continue the pending finding automatically once Chrome is ready. **Rescan remains strictly a page-QA action.**

A single trusted system-only Prompt API session may stay warm while the side panel is active. Every finding is evaluated through a fresh cloned task session and destroyed afterward so evidence and conversational state cannot leak between findings or sites.

## Evidence and reasoning separation

Frank focus mode now gives the two interfaces distinct jobs:

- **Sidebar:** deterministic finding facts, measurements, selectors, provenance, verification, and evidence.
- **Centered Frank card:** plain-language interpretation, why it matters, what to change, and how to verify.

The page remains dimmed while the actual affected element is spotlighted. The old standalone “this is the affected element” walkthrough step is gone; interpretation now leads.

## Recommendation quality and safety

- evidence-derived contrast suggestions are numerically rechecked after RGB rounding before they are described as passing
- unsupported ordinal/page-position and component labels are rejected
- unsupported business/user-behavior claims are rejected
- invented measurements are rejected
- local AI wording that drifts materially from verified deterministic guidance is rejected
- hostile page text cannot authorize destructive or secret-handling remediation
- cross-site task isolation is regression-tested

## UI direction

1.6.0 strengthens Frank's focus card, evidence-ledger hierarchy, status language, and readiness feedback using the existing design-token system. Tailwind was evaluated and deliberately deferred because a framework migration did not solve the actual product-design problem and would add release risk without measurable user benefit.

## Build/release hardening

The extension build now preserves the vendored axe-core runtime if a release source package is rebuilt without `node_modules`, preventing failed builds from deleting required bundled assets.

All previously shipped multi-discipline scanners, impact balancing, image-purpose conservatism, performance observations, integration health, managed gateway access, privacy boundaries, and optional-cloud-AI cost controls remain intact.
