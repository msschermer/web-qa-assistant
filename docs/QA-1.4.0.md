# Web QA Assistant 1.4.0 acceptance

This is the real-browser gate before the delivery branch is merged to `main`.

## Known-answer matrix

| Case | Expected result |
|---|---|
| healthy production page | no material Frank findings when evidence is healthy |
| staging page with `noindex` | observation retained but quiet by default |
| primary production page with `noindex` | critical/blocker Frank finding |
| production thank-you/utility page with intentional noindex pattern | quiet/review as policy dictates, not blocker by default |
| internal link returns 404 twice | confirmed broken-link finding |
| internal link times out then returns 200 | healthy; no finding |
| internal link repeatedly times out | incomplete coverage only |
| internal 5xx confirmed | material finding, strong priority |
| duplicate source links to same broken URL | one grouped issue with multiple occurrences |
| serious axe accessible-name violation | confirmed visual finding; correct highlight |
| axe incomplete/manual result | quiet/inconclusive; not a confirmed defect |
| canonical browser/published mismatch | correlated review/fix with document evidence, no fake spotlight |
| performance regression on monitored site | historical context only when material policy admits it |
| connected tool unavailable | coverage limitation; no invented site defect |
| AI unavailable | Standard guidance works without breaking scan/Frank |
| AI available | Connected reasoning stays grounded to existing evidence IDs |

## Extension acceptance

1. Load `dist/extension` in Chrome.
2. Open a normal production site and click the toolbar icon.
3. Confirm the initial local scan renders before connected enrichment completes.
4. Confirm Frank overview clearly states healthy / attention / blocker / incomplete status.
5. Confirm quiet observations only appear after **Show all checks**.
6. Confirm Environment shows inference and allows an override.
7. Confirm Scan coverage reports unavailable/inconclusive checks separately.
8. Confirm Site session adds only pages the user actually scans.
9. Fix an issue, rescan and confirm it appears under **Resolved this scan**.
10. Use **Copy issue** and verify the handoff includes page, environment, confidence, problem, evidence and acceptance criteria.

## Link verification acceptance

Use at least one real slow WordPress/Elementor site and one controlled failing URL.

- slow-but-healthy team/profile page must not be called broken
- repeated timeout must remain coverage-only
- confirmed 404 must produce one finding
- source anchor Highlight must locate the actual navigation/content link
- **Recheck** after correcting a link must report Resolved when it returns successfully

## Frank acceptance

### Visual finding

- actual element is spotlighted
- page overlay remains aligned on scroll/resize
- Back/Next works from page and side panel
- Escape closes Frank
- focus returns after close
- evidence IDs/sources are readable
- remediation is concrete
- verification step offers Recheck when eligible

### Document/historical/page finding

- no fake element highlight
- Frank explicitly explains that evidence is document/page/history level
- connected comparison/trend appears only when relevant

### AI modes

With `OPENAI_API_KEY` absent or gateway unavailable:

- Standard guidance works
- scan does not fail
- no missing-data facts are invented

With OpenAI configured:

- UI says Connected reasoning
- AI does not alter deterministic confidence/severity
- AI plan includes assessment, limitations and verification
- no unknown target/evidence IDs appear

## Gateway/privacy acceptance

1. In extension Connection settings, save a custom gateway and confirm Chrome requests only that origin permission.
2. Test connection and confirm gateway version/AI/integration state renders.
3. Inspect a gateway request in DevTools/network or server logs for a controlled page containing:
   - query token
   - input value
   - `data-*` attribute
4. Confirm those values are absent/redacted in the transmitted context.
5. Confirm private/local pages do not call the assistant gateway.

## Accessibility of Web QA Assistant

- Tab through all controls in side panel
- visible focus is apparent
- details/summary controls are keyboard operable
- Frank modal/overlay traps focus while active
- Escape exits
- focus restores to prior control
- status text is understandable without color
- narrow side panel remains usable

## Standalone/public web acceptance

```powershell
npm run dev
```

Verify:

- `http://localhost:3000/`
- `http://localhost:3000/api/health`
- `http://localhost:8790/health`

Public AI should remain disabled when `PUBLIC_AI_ENABLED=false`, even if `OPENAI_API_KEY` is configured. The public scanner should still provide deterministic Frank guidance.

## Release decision

Do not merge if a failed verification can become a defect solely because the checker timed out, if a connected-only finding falsely resolves during Recheck, if a visual target regularly points to nothing, or if connected AI receives values prohibited by the AI Evidence Contract.
