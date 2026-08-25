# Web QA Assistant — Cursor Setup Evaluation

## Decision

**Proceed with Cursor as the primary WebQA development environment, but use the reviewed setup pack, not the original pack.**

The architecture is sound and is the lowest-complexity path that meets the goal:

```text
Cursor Editor + one writable parent Agent
+ selected read-only reviewers
+ one small local WebQA MCP
+ Cursor native Browser
```

Claude Code, Claude Agent SDK, OpenAI Agents SDK, provider BYOK, Playwright MCP, hosted MCP infrastructure, and cloud agent runners are not required for initial migration.

## What was independently verified

- Cursor supports project-local `.cursor/mcp.json` stdio servers, `${workspaceFolder}`, and `envFile`.
- Cursor supports project subagents in `.cursor/agents/` with isolated contexts, `model: inherit`, and `readonly: true`.
- Cursor supports explicit Skills in `.cursor/skills/<name>/SKILL.md` with `disable-model-invocation: true`.
- Cursor supports `.cursor/rules/*.mdc` plus root/nested `AGENTS.md`.
- Cursor supports project `.cursor/permissions.json` and Auto-review steering.
- Cursor supports `.cursorignore` and `.cursorindexingignore`; terminal/MCP remain separate execution boundaries.
- Cursor has a native Browser with navigation, interaction, screenshots, console, and network evidence and requires no extra dependency.
- Cursor's VS Code import is officially supported, with profile export/import as a controlled fallback.
- MCP TypeScript SDK v2 uses the `@modelcontextprotocol/server` package and the server pattern used in this setup (`McpServer`, `fromJsonSchema`, `serveStdio(createServer)`).

## Material corrections made after review

### 1. Browser strategy

Original: Playwright existing-Chrome bridge was presented too prominently.

Reviewed: Cursor native Browser is the default. Playwright extension mode is an optional later compatibility path only when the existing Chrome profile/session/extensions are specifically required. It is no longer enabled in default `.cursor/mcp.json`; a separate example is supplied.

Reason: native Browser is supported directly by Cursor and removes an unnecessary dependency. Playwright extension mode has had recent profile-discovery edge cases.

### 2. Read-only reviewer tool assumptions

Original: some read-only reviewers were instructed to operate MCP/browser tools themselves.

Reviewed: the parent Agent gathers tool/runtime evidence and passes bounded evidence to read-only reviewers.

Reason: Cursor documents MCP inheritance for subagents, but read-only/tool behavior has had product edge cases and granular per-MCP-tool restrictions are not available. The workflow should not depend on a fragile capability.

### 3. External scan semantics

Original: `webqa_scan_url` was described as read-only despite writing a local artifact; it also stripped query parameters before the actual scan.

Reviewed:

- actual scan target preserves query parameters and removes only fragments
- returned/stored URL evidence strips query/fragment
- embedded URLs in finding text are sanitized
- tool is marked non-read-only/non-destructive/open-world
- external scans require review initially

Reason: query-bearing pages must be scanned as requested, while artifacts sent to models should not retain query secrets.

### 4. Local-path privacy

Original: some MCP results exposed absolute artifact paths.

Reviewed: artifact paths returned to the model are repository-relative.

### 5. Setup doctor

Original: deployed gateway reachability could make local IDE setup appear failed.

Reviewed: local repo/MCP/Git requirements are hard checks; deployed gateway and optional browser bridge are advisory.

Reason: an external outage is not a broken Cursor installation.

### 6. Dependency installation

Original: setup always ran root `npm ci`.

Reviewed: an existing root `node_modules` is preserved by default. Root `npm ci` runs only when dependencies are absent or when `-RefreshRepoDependencies` is explicitly requested.

The tool-local package uses `npm install` only on the first run to create its lockfile, then uses `npm ci --prefix` after the lockfile exists.

### 7. Installer safety

Original: overlay installation was effectively a copy operation.

Reviewed installer:

- requires `.git`
- hashes conflicts before changing anything
- aborts on differing existing files by default
- supports explicit `-Force`
- backs conflicting originals up outside the repo before forced replacement
- does not delete the checkout

### 8. Ignore rules

Original: `.cursorignore` used `.env.*`, which also hid the safe root `.env.example`.

Reviewed:

```text
.env
.env.*
!.env.example
```

### 9. Cost claims

Original: wording could imply that multi-agent work is effectively free under Cursor Pro.

Reviewed: no additional provider API key or fixed subscription is required, but subagents consume independent model/context usage. Start with cost-efficient Cursor models/Auto Cost, keep on-demand billing off initially if a hard ceiling is desired, and monitor Cursor Spending/Usage.

## What is now verified on the committed setup

The following were validated on the post-v1.7.2 Cursor workspace:

1. Cursor discovers the project-local `webqa` MCP from `.cursor/mcp.json`.
2. `webqa_health` reports gateway health and version (use it to confirm the deployed release at `https://assistant.msschermer.us`).
3. `webqa_scan_url` provides end-to-end renderer evidence; blocked/WAF outcomes correctly withhold page-derived QA.
4. Cursor native Browser works for ordinary public-page evidence when available in the Agent session.
5. `node tools/cursor-webqa/doctor.mjs` passes required local checks.

## What remains intentionally optional or unproven until needed

1. The optional Playwright existing-profile bridge, if ever enabled, connecting to the intended Chrome profile.
2. Side-panel/toolbar/Prompt-API behavior inside the extension (requires Report Bug plus human acceptance).
3. A development-only extension test bridge (future phase only).

## Final recommendation

Proceed with the reviewed pack in phases:

1. Cursor Editor migration + VS Code profile verification.
2. Install/verify only the `webqa` MCP.
3. Use one parent Agent for a small task.
4. Add selective read-only reviewers.
5. Use Cursor native Browser for real-page acceptance.
6. Add Playwright existing-profile mode only if native Browser cannot reproduce a required profile-specific condition.
7. Consider a development-only WebQA extension bridge only after the workflow proves that side-panel automation is still a meaningful bottleneck.

This gives the best balance of cost, reliability, safety, and learning curve.
