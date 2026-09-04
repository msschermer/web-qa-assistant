# Web QA Assistant 1.2.1

## Scan runtime and diagnostics hotfix

This release fixes a production runtime regression that prevented the extension from completing its first page scan.

### Fixed
- `localScan()` no longer declares the scan report as `const` before contextualizing it. The report is intentionally mutable through the scan pipeline.
- Added a regression test and build-time guard for this exact const-reassignment failure.
- Rebuilt `dist/extension` from the corrected source.

### Better failure UX
- Unexpected extension errors no longer display raw JavaScript text as the primary user-facing message.
- Failures return a friendly action-level message plus structured technical diagnostics.
- The side panel now exposes a collapsed **Technical details** section with:
  - diagnostic ID
  - failing operation
  - extension version
  - technical error
  - copyable stack/details
- Local scan failures, connected-check failures, and Frank startup failures can all surface diagnostics without replacing the useful product message.
- Service-worker failures are also logged to the extension console with operation context.

### Scope
No environment, SEO, materiality, broken-link, axe, Frank targeting, or connected-tool policy behavior was intentionally changed in this hotfix.

## Validation
- `npm run build:extension`: PASS
- `npm run check`: PASS
- `npm test`: 36/36 PASS
- local web root: HTTP 200
- API health: HTTP 200
- renderer health: HTTP 200
