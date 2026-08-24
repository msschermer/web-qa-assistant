# Connected tool contracts

The extension no longer connects directly to specialized portfolio services. The assistant gateway owns these integrations.

## Meta State

Purpose: published metadata/crawler state, canonical, redirects, robots and structured-data context.

Default endpoint: `POST ${META_STATE_URL}/api/inspect` with `{ "url": "..." }`.

Relevant signal families: indexing, canonical, redirect, metadata, schema.

## Performance Monitor

Purpose: historical performance context and meaningful regressions.

Default data endpoint: `GET ${PERFORMANCE_MONITOR_URL}/api/data`, with per-site history fetched only after the inspected hostname is matched to a monitored site.

Relevant signal family: performance.

## WCAG Translator

Purpose: map axe rules to WCAG criteria and standards context.

Default endpoint: `POST ${WCAG_TRANSLATOR_URL}/v1/translate`.

It is routed only when non-inconclusive axe findings make accessibility standards context relevant.

## Chrome built-in Prompt API

Purpose: preferred Frank wording/interpretation improvement after deterministic findings and evidence exist.

The Prompt API runs in the Chrome extension on the user device. The local model receives a compact evidence object plus deterministic guidance and returns structured text fields. It cannot create findings, targets, evidence references, metrics, or assessment state; those remain deterministic and are locally validated before the walkthrough starts.

## Optional cloud AI

Purpose: explicit metered fallback when on-device AI is unavailable and the user/deployment intentionally enables it.

The OpenAI Responses API is called server-side only when both the extension's Cloud AI fallback toggle and `EXTENSION_CLOUD_AI_ENABLED=true` permit it. The model receives only the AI Evidence Contract. It cannot create findings or selectors and its structured plan must validate against existing evidence/target IDs.

## Routing

`TOOL_REGISTRY` describes capability and relevant signal families. Connected context should be evidence-relevant, not an indiscriminate dump of every system into every Frank investigation.

## Legacy Preflight

The original Preflight service is historical and is not an active runtime dependency. The old code is preserved in Git on `legacy-preflight` and `preflight-legacy` for lineage/reference.
