# Web QA Assistant 1.2.0

## Highlights

- Safer environment inference: clear staging/preview/local hosts are recognized automatically, real apex/`www` business domains are production, and ambiguous public subdomains stay unknown.
- Smarter noindex handling: staging noindex is quiet; primary production noindex is blocker-level; common utility-page noindex is treated as likely intentional.
- Canonical policy now distinguishes same-site staging canonicals from genuinely cross-site canonicals.
- Broken-link checks moved out of the first scan path so the extension becomes responsive sooner.
- Confirmed 404/410 and 5xx findings retain link text, page location, prominence, destination, status and occurrence count.
- Prominent broken production navigation/CTA links can become blockers.
- Link timeouts no longer masquerade as confirmed broken links.
- Finding lifecycle now persists after connected enrichment, preventing connected results from flipping resolved/new on every rescan.
- Legacy Explain code/API removed.
- Frank link walkthroughs now show concrete destination/status metrics.
- Extension and standalone web tool both default to material Frank findings while preserving quiet observations.
- Standalone renderer can use an installed Chrome/Chromium executable and recover after a browser disconnect.

## Validation

- 34 automated tests passed
- syntax/release checks passed
- extension build passed
- service-worker import graph passed
- local web/API health passed
- renderer health passed

See `docs/AGENT-REVIEW-1.2.0.md` and `docs/QA-1.2.0.md`.
