# AI Evidence Contract

## Purpose

Deterministic systems decide whether a QA finding exists. Frank may improve explanation and sequencing, but no model is allowed to create, upgrade, downgrade, or replace the underlying finding.

1.5.2 has two AI paths with different data boundaries.

## On-device Frank

Chrome built-in AI is the preferred path in supported desktop Chrome installations.

`local-ai.js` receives a compact object containing the selected deterministic finding, relevant evidence, environment context, and the existing deterministic guidance. It intentionally excludes target markup and does not use network/model-provider APIs.

The local model may return only these text fields:

- summary
- interpretation
- impact
- remediation
- verification

The extension keeps deterministic plan structure, evidence references, target IDs, metrics, assessment state, and verification actions. Local AI output is rejected if it is generic or contradicts protected evidence rules such as contrast ratios, decorative-image purpose, or lab-vs-field performance claims.

## Cloud fallback boundaries

Cloud AI is optional and metered. It is off by default in both the extension and server.

### 1. Extension -> assistant gateway

`gatewayContextEnvelope()` creates a sanitized report for connected non-AI context. It preserves only the fields required for correlation and policy. Raw target context, axe node payloads, form state and incomplete destination lists are excluded.

`gatewayFrankGraph()` creates a sanitized selected-finding graph only when the user has enabled Cloud AI fallback.

### 2. Assistant gateway -> model provider

`aiEvidenceEnvelope()` narrows the selected graph again. The provider receives only the finding, page/environment context, relevant evidence and validated targets. The cloud route is disabled unless `EXTENSION_CLOUD_AI_ENABLED=true`.

## Never allowed to cloud AI

- whole page DOM
- form values
- password values
- cookie values
- local/session storage
- auth/session/CSRF/JWT/credential values
- arbitrary `data-*` attributes
- unredacted URL query values
- unrelated hidden application state

## Allowed when relevant

- rule ID and signal
- severity and confidence
- verification method/attempt count
- HTTP status
- sanitized URL/path
- WCAG criterion
- performance metric/history for performance findings
- canonical/robots/published-state facts for relevant findings
- sanitized selector
- bounded sanitized markup for the selected visual target on the cloud path
- a small allowlist of computed styles

## Model responsibilities

Frank can explain, compare, clarify impact, propose a safe next action, state limitations and explain verification.

Frank cannot:

- invent a new defect
- override environment/materiality policy
- upgrade confidence/severity
- invent a selector or target ID
- claim causality not supported by evidence
- execute JavaScript or change production

## Output validation

Both AI paths use structured output and local validation. Invalid, generic, contradictory, or overconfident model output is discarded and Frank keeps verified deterministic guidance with an explicit reason.
