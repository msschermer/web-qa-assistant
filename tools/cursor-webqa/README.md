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
- `webqa_scan_url` — deployed deterministic public WebQA scan plus a sanitized local QA artifact. This performs network activity and writes under `qa-runs/`; it is not a read-only operation.
- `webqa_repo_gates` — repository test/check/build/release-validation wrapper plus local QA artifact.
- `webqa_latest_run` — newest local QA artifact.
- `webqa_read_report_bug` — intentionally exported Report Bug JSON under `qa-runs/` inside the repo.

For scans, the actual target URL retains its query string when required by the page; query/fragment contents are removed from returned/stored URL evidence. Finding text is sanitized for embedded URL query strings before being returned or written.

Local artifacts are written to `qa-runs/` and should remain uncommitted unless deliberately sanitized into a neutral fixture.

## Browser automation

Use **Cursor's native Browser** first for ordinary public-page interaction, screenshots, console, and network evidence. It requires no additional dependency.

The separate `playwright-live` MCP is optional and exists only for cases where acceptance specifically requires an existing Chrome profile/session/extensions. It is not required for the base Cursor migration and should not be enabled until needed.

Neither browser path alone proves WebQA side-panel/toolbar behavior or Chrome built-in Prompt API behavior inside the extension. Use Report Bug plus explicit human observation until a development-only extension bridge is added.
