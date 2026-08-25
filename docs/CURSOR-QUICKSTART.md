# Web QA Assistant — Cursor Quickstart

This is the normal development path for Web QA Assistant in Cursor after cloning the repository.

## What this setup changes

- Cursor becomes the primary IDE and lead-agent interface.
- The existing Git repository stays exactly where it is; do **not** replace the project folder for this migration.
- Project instructions live in `AGENTS.md` and `.cursor/rules/`.
- Independent read-only reviewers live in `.cursor/agents/`.
- Repeatable workflows live in `.cursor/skills/`.
- A local `webqa` MCP server exposes WebQA health, deterministic public scans, repository gates, local QA artifacts, and Report Bug reads.
- Cursor's native Browser is the default browser-automation path for ordinary public-page inspection.
- An optional Playwright existing-Chrome-profile bridge can be added later from the provided example only when profile/session parity is specifically needed; it is not enabled in the default MCP config.
- No OpenAI or Anthropic API key is required for the initial setup.

## 1. Install Cursor and import VS Code

Install/sign in to Cursor with the existing Cursor Pro account.

Try Cursor's VS Code import first. If extensions do not migrate correctly, use VS Code/Cursor **Profiles** export/import instead; Cursor has had recent extension-import regressions, so verify the Extensions panel rather than assuming the import completed.

If Cursor opens into its agent-first window and you want the familiar VS Code experience:

- set **Window Layout → Editor**
- turn **Open Agents Window on startup** off if needed

The Agent remains available from Editor layout with `Ctrl+I`.

## 2. Clone and open the repository

Clone the repository, then open that folder in Cursor. The committed `.cursor/` files, `AGENTS.md`, and `tools/cursor-webqa/` are the canonical development configuration. Do not replace the checkout or delete `.git`.

## 3. Run one-time setup

From the repository root:

```powershell
powershell -ExecutionPolicy Bypass -File .\tools\cursor-webqa\setup.ps1
```

The script:

- creates local `.cursor/webqa.env` from the safe template if needed
- keeps that file and `qa-runs/` out of Git
- leaves an existing root `node_modules` intact; it runs root `npm ci` only when dependencies are absent (or when explicitly requested)
- installs the one isolated MCP SDK dependency under `tools/cursor-webqa`
- generates the MCP package lock on first setup; commit that lockfile afterward
- runs the setup doctor

The doctor treats the local workspace/Git/MCP checks as required. Deployed-gateway and optional browser checks are advisory, so a temporary external outage does not make the IDE migration fail.

Rerun the doctor at any time:

```powershell
node .\tools\cursor-webqa\doctor.mjs
```

## 4. Enable project MCP in Cursor

Cursor should discover the project rules, skills, subagents and `.cursor/mcp.json` automatically when the repository root is open.

Open **Customize → MCPs** and approve/enable `webqa`.

Then ask the main Agent:

```text
Read AGENTS.md. Do not edit anything. Use webqa_health and tell me whether this workspace is ready for Web QA Assistant development.
```

Next, intentionally approve one neutral test scan:

```text
Use webqa_scan_url on https://example.com. Do not change code. Explain what WebQA actually observed and distinguish confirmed findings from incomplete coverage.
```

`webqa_scan_url` saves a sanitized local QA artifact under ignored `qa-runs/`, so it is correctly treated as a non-destructive state-changing MCP action rather than a purely read-only call.

## 5. Verify gateway and renderer evidence

`webqa_health` confirms the deployed gateway and version. It does **not** directly prove renderer health.

Use `webqa_scan_url` on a neutral public URL such as `https://example.com` for end-to-end renderer evidence. A blocked or WAF/challenge response is a valid target-integrity outcome: withhold page-derived conclusions rather than treating it as a successful page audit.

Recommended Cursor run mode: **Auto-review** (not Run Everything).

## 6. Browser testing: start with Cursor's native Browser

For ordinary public-page inspection, use Cursor's native Browser first. It requires no additional Chrome extension or MCP package and is adequate for page navigation, screenshots, console/network inspection and dynamic-page QA.

Browser availability can be session-specific. If native Browser tools are missing, start a fresh Agent chat or reload Cursor before substituting curl, web search, or other proxies for required browser evidence.

Example:

```text
Use Cursor Browser to inspect https://example.com while webqa_scan_url scans the same URL. Do not edit code. Compare what the page actually exposes with WebQA's deterministic result.
```

This still does **not** prove WebQA's Chrome side-panel UI or Chrome's on-device Prompt API inside the extension.

## 7. Optional later: connect to an existing real Chrome tab

Only add this when you specifically need the user's existing Chrome profile/session/extensions.

Install Microsoft's official Playwright Extension / MCP Bridge in the Chrome profile used for the test. The default MCP configuration does not enable this bridge. A ready example is stored at:

```text
.cursor/examples/playwright-live.mcp.json
```

When deliberately added to `.cursor/mcp.json`, it runs:

```text
npx -y @playwright/mcp@latest --extension
```

Start with manual tab/connection approval and leave `PLAYWRIGHT_MCP_EXTENSION_TOKEN` blank. Select only a dedicated test tab. Playwright extension-mode profile discovery changes frequently, so treat this as an optional compatibility layer rather than a prerequisite for Cursor development.

Important boundary: the bridge can operate the selected webpage/tab; it does not reliably operate Chrome browser chrome or the WebQA side panel itself.

## 8. First real workflow

For a material bug or feature:

```text
/webqa-full-loop
```

For cross-discipline product acceptance:

```text
/webqa-acceptance
```

Acceptance requires both `webqa_scan_url` gateway evidence and Cursor native Browser evidence for the same target when browser proof is in scope. Do not substitute curl or web search when native Browser evidence is required.

For a release candidate:

```text
/webqa-release
```

The parent Agent gathers runtime/tool evidence. Read-only specialist subagents review the supplied evidence independently; do not depend on read-only reviewers being able to operate MCP/browser tools themselves.

## 9. Cost/model setting

Start with Cursor Pro and **no provider API keys**.

For multi-agent work, prefer a Cursor first-party model such as Composer 2.5, or Auto Cost, because subagents consume their own context/usage. Cursor Pro includes a generous Cursor Models pool plus an Other Models allowance, but heavy multi-agent use can exceed included usage if on-demand billing is enabled.

Recommended initial posture:

- parent Agent: Composer 2.5 or Auto Cost for routine work
- project subagents: `model: inherit`
- on-demand usage: keep disabled initially if you want a hard cost ceiling
- monitor Cursor's Spending/Usage dashboard
- provider BYOK: none

Use a stronger/third-party model deliberately for difficult architecture or final release review, not by default for every specialist.

## Operational notes

- Use `webqa_health` to confirm the deployed gateway version at `https://assistant.msschermer.us`.
- Local Windows Docker is not required for Cursor development. Production Docker validation happens on the droplet.
- Stage Cursor tooling deliberately. Do not use `git add .`; keep product release files and workspace tooling in separate intentional commits.
