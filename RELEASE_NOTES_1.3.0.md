# Web QA Assistant 1.3.0

## Trust and verification release

1.3.0 changes the scanner's core philosophy from **rule fired → finding** to **observation → verification → confidence → finding**.

### Link verifier v2
- same-origin link checks now use browser `GET` requests, matching normal navigation behavior more closely than HEAD-first probing
- initial probes use a larger timeout and lower request pressure
- suspected failures receive an independent retry
- one conclusive failure plus one inconclusive result requires a third confirming request
- 404/410 and 5xx findings are created only after repeated failure evidence
- timeout, blocked, rate-limited and unavailable responses do not create broken-link findings
- repeated source links to the same destination are grouped into one issue
- source text, location, prominence and all observed occurrences are retained
- a short-lived verification cache reduces repeated requests during rescans
- the audit has a total time budget so one slow site cannot stall the extension indefinitely
- when many probes are uncertain, retries automatically become more conservative

### Confidence model
Findings now carry one of:
- `confirmed`
- `corroborated`
- `inferred`
- `inconclusive`

Frank never surfaces inconclusive observations in the default issue feed. Low-severity inferred observations also remain quiet by default.

### Coverage is not an issue
Incomplete link checks now live under **Scan coverage**. The UI reports:
- internal URLs checked
- verified healthy
- confirmed link issues
- incomplete verification

If verification is incomplete, Frank explicitly states that those URLs were **not counted as broken links**.

### Frank trust improvements
- finding cards show confidence
- Frank's evidence graph includes confidence, verification method and attempt count
- AI priority briefs are instructed to distinguish confirmed/corroborated findings from inferred reviews and incomplete coverage
- Frank must not call a timeout or unverified URL broken
- confirmed broken-link guidance now accounts for repeated occurrences on the page
- confirmed redirect failures have dedicated remediation and verification guidance

### Noise reduction
Additional low-value observations are retained in the full scan but do not enter Frank by default, including:
- missing canonical as a standalone best-practice review
- multiple/missing H1 structure observations
- duplicate meta descriptions
- existing title/description length heuristics
- Open Graph gaps
- minor/manual-review accessibility results

High-impact deterministic issues remain visible.

### Standalone parity
The public scanner uses the same staged verifier and confidence model with a bounded verification budget.

## Validation
- extension build: PASS
- static check: PASS
- tests: 48/48 PASS
- service-worker module graph: PASS
- real Chrome acceptance is still required on client sites
