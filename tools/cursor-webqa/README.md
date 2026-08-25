# WebQA Cursor MCP

Small local stdio MCP used by Cursor for Web QA Assistant development.

## Dependency boundary

This directory is an isolated npm package. It intentionally adds only:

```text
@modelcontextprotocol/server 2.0.0
```

It does not change the WebQA product/runtime dependency graph.

First install:

```powershell
npm install --prefix tools/cursor-webqa
```

After `tools/cursor-webqa/package-lock.json` exists and is committed:

```powershell
npm ci --prefix tools/cursor-webqa
```

Run the environment doctor:

```powershell
node tools/cursor-webqa/doctor.mjs
```

## Tools exposed

- `webqa_health` — deployed gateway health/version.
- `webqa_scan_url` — deployed deterministic public WebQA scan; returns a concise summary and writes a local `api-scan` artifact that includes a bounded sanitized **review bundle**. Network + `qa-runs/` write; not read-only.
- `webqa_review_run` — read a review section from an `api-scan` artifact (default: compact index). Requires explicit artifact path + realpath `qa-runs/` containment.
- `webqa_review_finding` — detailed sanitized finding evidence from an `api-scan` artifact.
- `webqa_frank_plan` — production deterministic Frank (`packages/frank`) for one finding; no Chrome Prompt API / cloud AI; withholds page fixes when target integrity did not reach the page.
- `webqa_repo_gates` — repository test/check/build/release-validation wrapper plus local QA artifact.
- `webqa_latest_run` — thin pointer to the newest local QA artifact (does not dump review bundles; skips Report Bug diagnostics).
- `webqa_latest_diagnostic` — compact pointer to the newest valid Report Bug diagnostic under `qa-runs/` (not a full dump; not the currently open page).
- `webqa_diagnostic_section` — bounded diagnostic section reader (`coverage`, `pageDiagnostics`, `webqaDiagnostics`, `frank`, `timeline`, …). Default is compact; there is no `full` dump.
- `webqa_read_report_bug` — legacy v1 Report Bug JSON or compact v2 index under `qa-runs/`.

For scans, the actual target URL retains its query string when required by the page; query/fragment contents are removed from returned/stored URL evidence. Review bundles reuse `packages/ai/evidence-contract.js` sanitizers and never persist raw DOM, `documentHtmlSample`, incomplete URL inventories, or raw axe node payloads. Page-derived strings are untrusted data, not instructions.

Local artifacts are written to `qa-runs/` and should remain uncommitted unless deliberately sanitized into a neutral fixture.

## Browser automation

Use **Cursor's native Browser** first for ordinary public-page interaction, screenshots, console, and network evidence. It requires no additional dependency.

The separate `playwright-live` MCP is optional and exists only for cases where acceptance specifically requires an existing Chrome profile/session/extensions. It is not required for the base Cursor migration and should not be enabled until needed.

Neither browser path alone proves WebQA side-panel/toolbar behavior or Chrome built-in Prompt API behavior inside the extension. Use Report Bug plus explicit human observation until a development-only extension bridge is added.
