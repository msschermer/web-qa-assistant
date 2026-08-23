# AI Evidence Contract

## Purpose

Frank may use cloud AI to improve explanation and sequencing, but the model is not allowed to decide whether a QA defect exists. The evidence contract limits what information is eligible to leave the product boundary and what facts the model may use.

## Two boundaries

### 1. Extension -> assistant gateway

`gatewayContextEnvelope()` creates a sanitized report for connected context. It preserves only the fields required for correlation and policy. Raw target context, axe node payloads, form state and incomplete destination lists are excluded.

`gatewayFrankGraph()` creates a graph-like sanitized copy for a selected Frank finding while preserving evidence/target IDs needed for validation.

### 2. Assistant gateway -> OpenAI

`aiEvidenceEnvelope()` narrows the selected graph again. The model receives only the finding, page/environment context, relevant evidence and validated targets.

## Never allowed

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
- bounded sanitized markup for the selected visual target
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

Frank uses a strict structured walkthrough schema. Evidence references and target IDs are validated against the supplied graph. Invalid model output falls back to deterministic guidance.
