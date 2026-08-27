# Web QA Assistant 1.7.5

## Scan acceleration, Frank integrity, and published-coverage honesty

1.7.5 keeps current-page link coverage complete while making large inventories finish sooner, separates model readiness from Frank review completion, and reports published-index checks as checked versus not checked instead of implying a published confirmation.

## Links / crawler

- Adaptive target-origin concurrency (6 → 8 → 10 → 12, ceiling 16; 12 when externals are in flight) with reserved target versus external worker pools.
- Primary-first probing: every eligible current-page URL is attempted before refinement work consumes workers.
- HEAD then GET, body cancel, `cache: 'no-cache'`, and keepalive. 401/403/429 skip refinement.
- Short-lived session cache for healthy/broken/redirect results. Inconclusive results are not cached. Recheck bypasses the cache.
- Cache snapshots share external statuses globally but only this page origin’s internal URLs. Hydrate rejects non-finite expiry and inconclusive rows.
- `sms:` and other local-only hrefs are skipped from the HTTP queue.
- Report Bug and `linkAudit` expose `linkExecution` and honest `primaryLinkMs` / `refinementLinkMs` / `linkProbeMs`.

## Frank / guidance

- Scan guidance source is deterministic until Ask Frank actually completes a model review. AI priority briefs are not labeled `frank-model`.
- Ask Frank records `frankReview` without overwriting scan-level `guidanceSource`.
- Structured remediation composition collapses adjacent duplicate sentences (including the persistent-underline primary sentence).
- Wait copy describes composing scan guidance, not “Frank’s initial review.”
- Published-unavailable copy is finding-specific (noindex vs canonical vs robots) and does not require Meta State when those checks were not run.

## Environment / discoverability

- `publishedCoverage` records whether published HTML / X-Robots-Tag / robots.txt were actually checked.
- Environment notices say “Not checked in this scan” instead of “Unavailable.”
- Rendered-only production homepage noindex is high/review when published coverage is incomplete; confirmed published noindex on a primary page remains a blocker.

## Diagnostics / privacy

- Default Report Bug omits visible-error page text. Opt-in context redacts excerpts.
- `publishedCoverage` and `linkExecution` are projected rather than copied through.
- Visible-error and injected-UI detectors remain corroboration-based.

## Known limits

- HEAD 200 is trusted without a GET confirm (reduces false-broken; false-healthy remains possible).
- Session cache stores query-bearing URLs until TTL or browser exit. Chrome profiles are isolated; the extension still spans incognito.
- Related hosts share the external pool of 4. Host grouping uses last-two labels, not a PSL.
- After repeated 429s, remaining URLs on that host may be inferred inconclusive rather than probed.
- The 120s emergency deadline does not abort in-flight probes.
- Chrome HTTP/1.1 typically allows about six connections per host, so 12–16 in-flight is a queue ceiling, not a guarantee of that many parallel sockets.
- Live Chrome toolbar / Prompt API behavior is not proven by unit tests; reload unpacked `dist/extension` for dogfood.

## Validation

See `RELEASE_PROVENANCE.txt`. This tag includes the renderer `undici` dependency that tag `v1.7.4` omitted.
