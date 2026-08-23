# Architecture

## Core rule

Deterministic systems establish facts. Frank explains, prioritizes and sequences those facts. AI is not the scanner and cannot create a finding that the QA engine did not admit.

```text
Current browser page
  -> browser rules + axe + target registry
  -> same-origin link verifier
  -> confidence + environment-aware policy
  -> sanitized gateway context envelope
      -> assistant gateway
          -> capability router
              -> Meta State
              -> Performance Monitor
              -> WCAG Translator (when relevant)
          -> correlation
          -> materiality
  -> local finding merge
  -> Frank evidence graph
      -> sanitized Frank gateway graph
          -> OpenAI structured reasoning when available
      -> deterministic Frank fallback
  -> Frank runtime
      -> evidence / spotlight / comparison / impact / remediation / verification
      -> targeted recheck
```

## Browser/local boundary

Browser inspection, axe execution, target registration and same-origin link verification happen in the extension. Private/local pages do not use connected services.

The extension has static host access only to the production assistant gateway and local-development gateways. Broad page access remains optional and is granted only for the inspected/watched site.

## Assistant gateway

The assistant gateway is the single connected boundary for the extension. It owns specialized-service URLs, OpenAI credentials, connector timeouts, request IDs and integration health.

The old Preflight service is no longer an active dependency. Its useful product ideas were absorbed into the current deterministic scanner, correlation and policy layers.

## Tool routing

`packages/connectors/connectors.js` exposes a capability registry. Meta State and Performance Monitor provide baseline connected context; WCAG Translator is invoked only when accessibility signals make it relevant. Frank's evidence graph further filters connected results by signal family so unrelated tool output is not presented as evidence for a selected finding.

## Confidence and materiality

Every normalized finding carries a confidence state:

- `confirmed`
- `corroborated`
- `inferred`
- `inconclusive`

Inconclusive observations are never admitted to Frank's default issue feed. Severity answers “how serious if true”; confidence answers “how sure are we that it is true.”

## Target registry

Visual findings receive a target ID during deterministic scanning. Frank may only reference an existing target ID. A stale/missing target is downgraded to page-level evidence rather than producing an empty spotlight. Document, historical and page-level signals do not receive fake visual targets.

## Frank evidence graph

Each Frank session is scoped to one selected finding. The graph contains bounded evidence with stable IDs, provenance, scope, confidence and optional target IDs. Plan evidence references must point to IDs that actually exist in the graph.

## AI boundary

The extension sanitizes the graph before it crosses the gateway boundary. The backend applies the AI Evidence Contract again before OpenAI. Structured output is requested through JSON schema and validated after generation.

AI can:

- explain verified evidence
- clarify impact
- propose a bounded remediation path
- state limitations
- provide a verification plan

AI cannot:

- create a new finding
- upgrade deterministic severity or confidence
- invent selectors/targets
- execute browser code
- modify production
- receive whole DOM, cookies or form values

## Public web scanner

The web scanner uses the hardened Playwright renderer and public-only egress policy. Connected AI for the public web surface is **opt-in** with `PUBLIC_AI_ENABLED`; deterministic guidance is the default even when the backend has an OpenAI key.

## Observability

A Web QA request ID is propagated from the extension/API into connectors and renderer calls. Error diagnostics include operation and request context so failures can be traced without exposing technical exceptions as the primary UI message.
