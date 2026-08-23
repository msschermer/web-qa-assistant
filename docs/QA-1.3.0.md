# Web QA Assistant 1.3.0 acceptance checklist

## Link verification

### Slow but healthy page
Use a known internal URL that loads successfully but sometimes responds slowly.

Expected:
- no broken-link finding
- if Frank cannot verify it within the bounded audit, it appears only under Scan coverage
- coverage explicitly says incomplete URLs were not counted as broken

### Confirmed 404
Use a source page with a known same-origin 404 link.

Expected:
- one finding for the destination
- confidence: `confirmed`
- verification attempt count >= 2
- the real source anchor highlights
- Frank shows destination/status evidence and gives specific remediation + verification

### Duplicate references
Place the same broken URL in navigation and body content.

Expected:
- one underlying finding
- occurrence count reflects both locations
- Frank explains that every occurrence/shared component must be corrected

### Temporary failure
Test a URL that fails once and then succeeds.

Expected:
- no finding

### Timeout / WAF uncertainty
Use a URL that is slow, challenged, or blocked to automated fetch.

Expected:
- no broken-link finding
- coverage may become partial
- no language implying the page is actually broken

## Confidence

Check at least:
- confirmed browser/axe finding
- corroborated Browser + Meta State mismatch
- inferred structural review
- inconclusive/manual review

Expected:
- confirmed/corroborated can enter Frank when material
- low-value inferred observations remain quiet
- inconclusive observations do not enter Frank's default feed

## Frank

For a confirmed broken link:
- spotlight exact source anchor
- show confidence
- show verification attempt count/evidence
- explain impact
- give concrete remediation
- end with a verification step

For a document-level issue:
- no fake spotlight
- evidence panel explains the document signal

## Environment
Confirm:
- staging noindex remains quiet
- same production noindex is elevated appropriately
- environment override still persists by origin

## Regression
- initial scan works
- Rescan works
- Highlight works
- Ask Frank works
- Copy diagnostics works after a forced failure
- Show all checks still exposes quiet observations
- Watch this site still works
