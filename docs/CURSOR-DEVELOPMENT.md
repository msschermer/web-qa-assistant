# Web QA Assistant — Cursor Development Environment

## Purpose

This workspace makes Cursor the primary development and QA control plane for Web QA Assistant while preserving a familiar VS Code-style editor workflow.

The intended daily model is:

```text
You
 ↓
Cursor Editor + parent Agent
 ↓
AGENTS.md / project Rules / explicit Skills
 ↓
selected read-only specialist reviewers
 ↓
WebQA MCP + Cursor native Browser
 ↓
source, tests, deployed deterministic scanner, browser evidence, Report Bug
```

Claude Code, Claude Agent SDK, OpenAI Agents SDK, provider BYOK, a second browser framework, and a hosted MCP service are deliberately excluded from the initial setup. Add one only after a real limitation is demonstrated.

---

# 1. Why Cursor is the primary environment

Cursor is based on VS Code, so the migration can preserve the editor, terminal, Git workflow, settings, keybindings, and most extensions already used for WebQA.

For this project Cursor has four roles:

1. **IDE** — files, terminal, Git, extensions, debugging.
2. **Lead Agent** — inspect, diagnose, plan, implement, test, and coordinate review.
3. **Reviewer orchestrator** — delegate selected independent reviews into isolated subagent contexts.
4. **Tool client** — call the project WebQA MCP and Cursor's built-in Browser.

The repository contains the operating contract. A fresh Agent conversation should not depend on remembering a giant prompt from another chat.

---

# 2. Repository is the canonical Cursor configuration

Clone or use the existing checkout with its `.git` directory intact. The committed repository is now the canonical source for Cursor development configuration:

```text
AGENTS.md
.cursor/mcp.json
.cursor/permissions.json
.cursor/rules/**
.cursor/agents/**
.cursor/skills/**
.cursor/webqa.env.example
.cursorignore
.cursorindexingignore
tools/cursor-webqa/**       # except node_modules
docs/CURSOR-*.md
```

Local-only files:

```text
.cursor/webqa.env
qa-runs/
tools/cursor-webqa/node_modules/
overlay/                    # migration artifact; not required after commit
INSTALL.ps1                 # migration artifact; not required after commit
```

After this commit lands on `main`, new developers clone the repository and run `tools/cursor-webqa/setup.ps1`. They do not need `overlay/` or `INSTALL.ps1`.

The first successful MCP dependency install creates `tools/cursor-webqa/package-lock.json`. Commit that lockfile so later installs can use `npm ci --prefix tools/cursor-webqa` reproducibly.

---

# 3. Cursor installation and VS Code migration

## Install and sign in

Install/update Cursor for Windows and sign in to Cursor Pro.

## Import VS Code

First use Cursor's built-in **VS Code Import**. It is intended to copy extensions, themes, settings, and keybindings.

After import, verify the extensions you actually use. If import is incomplete, use the more controlled profile route:

1. In VS Code, open **Preferences: Open Profiles (UI)**.
2. Export the desired profile to a local file.
3. In Cursor, open **Preferences: Open Profiles (UI)**.
4. Import that file and activate the profile.

Do not maintain two divergent IDE profiles indefinitely.

## Keep the Editor layout

Use Cursor's **Editor** layout as the default so Explorer/editor/terminal/source control remain primary. The Agent remains available from this layout.

A useful mental model:

```text
Editor layout  = normal desk
Agent          = lead engineer beside you
Agents Window  = optional operations room
```

If Cursor keeps opening the Agents Window on startup, disable that startup preference. There is no requirement to live in the Agents Window for this workflow.

---

# 4. One-time repository setup

From the repository root:

```powershell
powershell -ExecutionPolicy Bypass -File .\tools\cursor-webqa\setup.ps1
```

You can run setup again manually at any time. Local Windows Docker is not required for Cursor development; production Docker validation occurs on the droplet.

## Existing WebQA dependencies

The script does **not** automatically wipe/reinstall an existing root `node_modules` directory.

If `node_modules` is absent, it runs:

```powershell
npm ci
```

If you explicitly want to refresh the WebQA dependency tree from the lockfile:

```powershell
powershell -ExecutionPolicy Bypass -File .\tools\cursor-webqa\setup.ps1 -RefreshRepoDependencies
```

This avoids an unnecessary full reinstall merely to migrate IDEs.

## Local WebQA MCP dependency

The custom helper is an isolated Node package under:

```text
tools/cursor-webqa/
```

It adds one direct development dependency:

```text
@modelcontextprotocol/server 2.0.0
```

If a tool-local lockfile already exists, setup uses:

```powershell
npm ci --prefix tools/cursor-webqa
```

On the first installation, if no lockfile exists, it uses:

```powershell
npm install --prefix tools/cursor-webqa
```

and creates the lockfile to commit afterward.

This does not add Express, Python, Docker services, Claude SDK, OpenAI SDK, a database, or a hosted MCP service.

## Local environment file

Setup creates this if absent:

```text
.cursor/webqa.env
```

from:

```text
.cursor/webqa.env.example
```

Initial contents:

```text
WEBQA_GATEWAY_URL=https://assistant.msschermer.us
PLAYWRIGHT_MCP_EXTENSION_TOKEN=
```

No model-provider API secret is required.

The Playwright token is optional and should stay blank unless the optional existing-Chrome-profile bridge is deliberately enabled later.

---

# 6. Setup doctor

Run:

```powershell
node .\tools\cursor-webqa\doctor.mjs
```

Required checks:

- Node.js 22+
- correct WebQA repository/package
- Cursor MCP config present
- project `AGENTS.md` present
- project Rule present
- MCP SDK installed
- Git works in the checkout

Advisory checks:

- deployed WebQA gateway reachability/version
- optional existing-Chrome bridge configuration

A temporary gateway outage does **not** mean the Cursor development environment is broken. The doctor exits non-zero only when a required local setup check fails.

---

# 7. What the Cursor project files do

## `AGENTS.md`

Human-readable project operating contract. It establishes:

- evidence hierarchy
- full multi-role engineering loop
- cross-discipline product requirement
- Frank boundaries
- browser/runtime truth rules
- release gates
- Git/release safety
- completion-report format

## `.cursor/rules/`

Persistent, focused project rules.

`00-project-guardrails.mdc` applies everywhere.

`10-extension-runtime.mdc` applies when extension/Frank/rules/findings/tests are in context.

Keep Rules short. Put long procedures in Skills and long reference material in normal docs.

## `.cursor/skills/`

Explicit reusable workflows:

```text
/webqa-full-loop
/webqa-acceptance
/webqa-release
```

They use `disable-model-invocation: true`; therefore they behave as explicit slash workflows rather than unexpectedly activating on routine questions.

## `.cursor/agents/`

Read-only independent reviewers:

- `product-reviewer`
- `web-quality-reviewer`
- `frank-reviewer`
- `security-privacy-reviewer`
- `adversarial-qa`
- `browser-acceptance`
- `release-gate`

Each is configured with:

```text
model: inherit
readonly: true
```

`readonly` prevents the reviewer from silently editing the implementation it is judging.

### Important tool-access design

Current Cursor documentation says subagents inherit parent tools, including MCP tools, but read-only/tool behavior has had edge cases and Cursor currently offers no granular per-MCP-tool whitelist in subagent frontmatter.

Therefore the WebQA workflow does **not depend on reviewers operating external tools directly**.

The robust pattern is:

```text
Parent Agent
  ↓
collect scan/browser/Report Bug/test evidence
  ↓
pass bounded evidence to read-only reviewer
  ↓
reviewer judges independently
```

This keeps the review useful even if a particular Cursor release restricts MCP access in read-only mode.

## `.cursor/permissions.json`

Project-specific steering for Cursor's **Auto-review** run mode.

It lowers friction for normal local read/test/build work and authorized AutoQA corpus dogfood while asking for review before:

- browser automation / scans of origins **outside** AutoQA corpus membership (and outside local fixture origins), unless the user explicitly requested that origin
- push or destructive Git
- SSH/deployment
- production changes
- secret access
- destructive file operations

Corpus membership in `qa-sites/golden.json`, `rotating.json`, `adversarial.json`, and `discoveries.json` is intentional authorization for bounded AutoQA dogfood when autonomous mode is enabled. This is best-effort approval steering, not a security boundary.

## `.cursorignore`

Protects local/sensitive files from Cursor's normal Agent/Tab/Inline-Edit access. The reviewed file intentionally ignores `.env` variants while re-allowing safe `.env.example`:

```text
.env
.env.*
!.env.example
.cursor/webqa.env
qa-runs/
/tools/cursor-webqa/node_modules/
```

Terminal and MCP execution are separate and can still access paths that the normal AI file surfaces ignore. Keep secrets outside the workspace when possible and keep MCP tools narrow.

## `.cursorindexingignore`

Keeps large/generated material such as vendored Axe, archives, lockfiles, and local QA artifacts out of semantic indexing while allowing explicit access when needed.

---

# 8. WebQA MCP architecture

The project-local server is configured in `.cursor/mcp.json` as a stdio server:

```text
node tools/cursor-webqa/mcp-server.mjs
```

Cursor launches it locally. No port, hosted service, separate daemon, or API-provider key is required.

The server uses `WEBQA_GATEWAY_URL` from `.cursor/webqa.env` for deployed WebQA calls.

## `webqa_health`

Reads deployed `/api/health` and reports gateway/version/Frank configuration. It does **not** directly prove renderer health.

## `webqa_scan_url`

Runs the deployed public deterministic WebQA `/api/scan` against the requested public HTTP/HTTPS URL. This is the normal end-to-end renderer evidence path.

A blocked, WAF, or challenge response is a valid target-integrity outcome. When target integrity is blocked, page-derived findings and Recommended Order should be withheld rather than treated as a successful audit of the requested site.

Important semantics:

- The **actual scan target retains its query string** when the requested page depends on query parameters.
- The URL stored/returned in the QA summary has its query and fragment removed.
- Embedded URLs in summarized finding text are sanitized before artifacts are written or returned.
- The tool writes a local artifact under `qa-runs/`, so it is intentionally **not** marked read-only.
- It is open-world network activity; initial Cursor permissions should ask you to approve the destination.

This scan is real deployed WebQA backend evidence, but it is **not identical to executing the Chrome extension content script/side panel**. Do not use it as proof of extension-only behavior.

## `webqa_repo_gates`

Runs the project's real commands:

```text
npm test
npm run check
npm run build:extension
```

and optional release validation with `RELEASE_TAG`.

It writes an ignored local QA artifact for reviewer handoff.

## `webqa_latest_run`

Reads the newest JSON QA artifact under `qa-runs/` that is not a Report Bug diagnostic.

## `webqa_latest_diagnostic`

Compact pointer to the newest valid Report Bug diagnostic under `qa-runs/`. Skips `api-scan`, invalid kinds, oversize files, and symlink escapes. This is the newest **exported** file, not the page currently open. Save the extension Report Bug JSON under `qa-runs/` first.

## `webqa_diagnostic_section`

Reads one bounded section of a v2 diagnostic (`scan`, `coverage`, `pageDiagnostics`, `webqaDiagnostics`, `frank`, `timeline`, …). Does not dump the full bundle. If `artifact` is omitted, uses the latest valid diagnostic.

## `webqa_read_report_bug`

Reads only an intentionally exported Report Bug JSON inside `qa-runs/` and below the size limit. Legacy v1 returns the sanitized report. v2 returns a compact index and tells the agent to use `webqa_diagnostic_section`. It does not search Chrome storage or arbitrary filesystem locations.

Returned paths are repository-relative rather than exposing the full local Windows path to the model.

---

# 9. Enable the WebQA MCP in Cursor

Open the repository in Cursor, then open:

```text
Customize → MCPs
```

Approve/enable only:

```text
webqa
```

for the first setup pass.

Use this prompt:

```text
Read AGENTS.md and the applicable Cursor rules. Do not edit files. Use webqa_health and tell me whether the Web QA Assistant development environment is healthy. Separate local setup status from external gateway status.
```

Then deliberately approve a neutral external scan:

```text
Use webqa_scan_url on https://example.com. Do not edit files. Review the result as a cross-discipline QA product. Separate confirmed findings from incomplete or inconclusive coverage.
```

If `webqa` is missing:

```powershell
node .\tools\cursor-webqa\doctor.mjs
```

If the SDK is missing:

```powershell
npm install --prefix tools/cursor-webqa
```

Then reload the Cursor window.

---

# 10. Browser testing: use Cursor's native Browser first

Cursor already includes a native Browser tool. It can navigate, click, type, scroll, screenshot, inspect console output, and observe network traffic. It requires no extra browser automation dependency.

This should be the **default browser path** for ordinary public-page product evaluation.

Browser availability can be session-specific. If native Browser tools are missing in a chat, start a fresh Agent conversation or reload Cursor before substituting curl, web search, or other proxies when browser evidence is required.

Example:

```text
Use webqa_scan_url on https://example.com, then use Cursor Browser on the same page. Do not edit code. Compare deterministic WebQA findings with what is actually visible and interactive. Capture screenshots where they materially support the conclusion.
```

Start with manual browser approvals, especially on unfamiliar sites.

## What native Browser proves well

- rendered page behavior
- dynamic/hydrated DOM
- visible layout
- page interactions
- screenshots
- console symptoms
- network symptoms
- responsive public-page behavior

## What it does not prove by itself

- Chrome toolbar action behavior
- WebQA Chrome side-panel focus/click state
- Chrome extension-management UI
- Chrome built-in Prompt API execution inside WebQA's side-panel context
- a human's subjective comprehension

Use Report Bug plus human observation for those until a development-only extension bridge exists.

---

# 11. Optional advanced browser path: existing Chrome profile

Only install/enable `playwright-live` when the test genuinely requires your **existing Chrome profile**, for example authenticated session parity or behavior that depends on installed Chrome extensions.

The default `.cursor/mcp.json` intentionally contains **only `webqa`**. If existing-profile parity is later required, copy the provided example entry from `.cursor/examples/playwright-live.mcp.json` into `.cursor/mcp.json`. It uses:

```text
npx -y @playwright/mcp@latest --extension
```

This path requires Microsoft's Playwright MCP Bridge extension in Chrome.

## Why it is optional

The bridge has had recent profile-discovery edge cases, particularly with non-default Chrome profiles. It should not be a prerequisite for ordinary Cursor/WebQA development.

If you enable it:

1. Install the official bridge in the Chrome profile you intend to use.
2. Enable `playwright-live` under Cursor MCPs.
3. Start with manual tab/profile approval and no persistent token.
4. Use a dedicated test tab.
5. Disable the bridge when you are not doing profile-specific acceptance.

If a non-default Chrome profile fails detection, treat that first as a Playwright bridge/profile issue, not a WebQA manifest bug.

`@playwright/mcp@latest` is kept only for this optional exploratory bridge because the bridge is changing quickly. If it becomes part of a reproducible release gate, pin a known-good version after validating it on your workstation.

---

# 12. Parent Agent and reviewer workflow

The **parent Agent is the Lead Engineer**. Talk to it most of the time.

For a material feature:

```text
/webqa-full-loop

<describe the feature or bug>
```

The intended workflow is:

```text
Inspect
→ Diagnose
→ Plan
→ independent plan review
→ Gate
→ Implement
→ targeted tests
→ full tests/check/build
→ runtime evidence
→ adversarial review
→ revise
→ regression
→ product/release review
```

For investigations, make the no-edit boundary explicit:

```text
Do not edit code. Collect WebQA MCP evidence and Cursor Browser evidence for the requested sites. Then give the bounded evidence independently to product-reviewer, web-quality-reviewer, and frank-reviewer as relevant. Identify systemic weaknesses, not just accessibility issues.
```

Reviewers should ask the parent Agent for missing reproductions rather than silently inventing runtime results.

---

# 13. Use fewer subagents than the maximum

Seven reviewer definitions exist because WebQA has several distinct concerns. That does **not** mean seven should run on every task.

Cursor itself recommends starting with a small number of focused subagents and adding more only when they have distinct value. Subagents have independent contexts and therefore additional token usage.

Typical selections:

### Small copy/UI adjustment

Parent Agent only, perhaps product-reviewer if needed.

### Frank reasoning change

- frank-reviewer
- adversarial-qa
- security-privacy-reviewer only if evidence/privacy/external calls change

### Scanner/prioritization change

- web-quality-reviewer
- adversarial-qa
- product-reviewer when Recommended Order/UI changes

### Browser targeting/runtime change

Parent Agent gathers browser/Report Bug evidence, then:

- browser-acceptance
- adversarial-qa

### Release

Use relevant earlier specialists, then `release-gate` as the final independent judge.

---

# 14. Cost-effective model strategy

## Initial setting

Do **not** add OpenAI or Anthropic API keys merely to make this setup work.

Start with Cursor Pro's included usage pools and keep all project reviewers at:

```text
model: inherit
```

For routine work, prefer Cursor's cost-efficient first-party pool such as Composer 2.5 or an appropriate Auto/Cost setting available in your account. Use an expensive third-party model deliberately when a task actually benefits from it.

## Important pricing reality

Cursor Pro does not mean unlimited arbitrary multi-agent frontier-model work. Current Pro includes a generous Cursor Models pool plus a finite Other Models allowance; multiple subagents each consume their own model/context usage.

Therefore:

- keep **on-demand billing off initially** unless you intentionally want pay-as-you-go
- check the Cursor **Spending/Usage** dashboard during the first week
- do not run every reviewer for trivial work
- use the strongest/most expensive model for release disputes or hard architecture, not routine scans
- keep independent reviewers concise and evidence-bounded

This setup avoids a new fixed provider subscription/API requirement. It does not make model compute literally free.

## BYOK later

Cursor supports OpenAI, Anthropic, Google, Azure OpenAI, and Bedrock keys in **Cursor Settings → Models**. BYOK is provider API billing and is separate from ChatGPT Plus or Claude Pro.

If you later use BYOK, configure it in Cursor's model settings—not in `.cursor/webqa.env` or the repository.

---

# 15. Recommended Cursor security posture

Use **Auto-review**, not Run Everything, while the workflow is new.

Recommended posture:

```text
Local read/test/build           lower friction
WebQA health                    lower friction
AutoQA corpus dogfood           authorized when enabled
Non-corpus external scan        approval
Git push                        approval
SSH/deployment                  approval
Secrets                         approval
Destructive Git/file actions    approval
```

Cursor's `.cursor/permissions.json` steers Auto-review but is not a hard security boundary.

Cursor's native Browser also has its own protections/approvals. Do not enable unrestricted browser auto-run on unfamiliar websites.

Use Git for durable rollback. Cursor checkpoints are useful convenience snapshots, but they are not a replacement for commits/history.

---

# 16. Git workflow in Cursor

Cursor uses the same existing Git checkout.

Before material work:

```powershell
git status
git pull
```

Review Agent work with Cursor's diff and normal Git:

```powershell
git diff
git status
```

Stage Cursor workspace tooling deliberately. Do not use `git add .`. Keep product release files and Cursor development tooling in separate intentional commits.

The parent Agent may run local tests/builds. Push/deploy should remain explicit user intent.

Do not enable multiple writable agents/worktrees until the simpler **one writable parent + read-only reviewers** workflow feels predictable.

---

# 17. Daily workflows

## Small change

```text
Change X. Inspect the current implementation first. Preserve existing behavior. Run targeted tests and npm run check. Do not launch the full reviewer team unless you discover systemic risk.
```

## Material feature/bug

```text
/webqa-full-loop
```

then describe the goal and evidence.

## Real-site product evaluation

```text
/webqa-acceptance
```

The parent should use:

- `webqa` for deployed deterministic scanner evidence
- Cursor native Browser for ordinary page evidence on the same target when browser proof is in scope
- `playwright-live` only if existing-profile parity is specifically needed
- Report Bug for extension runtime/Frank diagnosis

Do not substitute curl or web search when native Browser evidence is required.

Acceptance should cover multiple QA disciplines, not search for a convenient accessibility issue.

## Release

```text
/webqa-release
```

This requires repository gates plus independent release review. Runtime acceptance that cannot be executed must be stated as unavailable, not silently counted as passing.

## Runtime bug from Chrome

Export **Report Bug** and place it under an ignored path such as:

```text
qa-runs/manual/
```

Then ask:

```text
Use webqa_latest_diagnostic, then webqa_diagnostic_section for coverage, pageDiagnostics, webqaDiagnostics, frank, and timeline. Reconstruct the runtime sequence. Distinguish page errors from WebQA errors. Do not edit until the failing subsystem and supporting evidence are identified.
```

---

# 18. First-week migration plan

## Day 1 — Cursor as VS Code replacement

- import VS Code settings/profile
- verify extensions
- use Editor layout
- open existing checkout
- run setup and doctor
- continue using normal Explorer, terminal, and Git

## Day 2 — Parent Agent

- ask one read-only architecture question
- make one small code change
- review every diff and terminal action

## Day 3 — Project workflow

- run `/webqa-full-loop` on a bounded issue
- use only 1–2 relevant reviewers

## Day 4 — WebQA MCP

- call `webqa_health`
- deliberately approve one neutral `webqa_scan_url`
- run `webqa_repo_gates`

## Day 5 — Cursor native Browser

- evaluate one public page with Browser + WebQA MCP
- capture screenshots only when useful
- compare observed page behavior to WebQA evidence

## Later — existing-profile bridge

Only if native Browser cannot reproduce an important authenticated/profile-specific condition, enable `playwright-live`.

---

# 19. Troubleshooting

## MCP server does not start

```powershell
node .\tools\cursor-webqa\doctor.mjs
```

If SDK missing:

```powershell
npm install --prefix tools/cursor-webqa
```

Then reload Cursor.

## Gateway health is WARN

Check `.cursor/webqa.env` and independently confirm the deployed service. A temporary external outage should not trigger source changes.

## Cursor cannot see `.env.example`

The reviewed `.cursorignore` explicitly re-allows root `.env.example` after ignoring `.env.*`. If you changed ignore rules, restore:

```text
.env
.env.*
!.env.example
```

Never unignore real `.env` files for convenience.

## Browser requires unexpected approval

That is intentional initially. External browser/scanner actions are open-world operations. Approve only the requested test origin.

## Playwright bridge extension not found

This affects only the optional existing-profile path. Use Cursor native Browser unless exact Chrome-profile state is required. If profile parity is required, verify the bridge is installed in the profile Playwright actually detects; recent versions have had non-default-profile issues.

Do not change WebQA permissions to fix a Playwright profile-discovery problem.

## Cursor feels too agent-centric

Return to Editor layout and disable automatic Agents Window startup. Agent remains available from the editor.

## Agent wants to deploy unexpectedly

Reject the action. Deployments are explicit release/deployment workflows, never a side effect of ordinary feature work.

---

# 20. What not to install yet

Do not add these solely for this migration:

- Claude Code
- Claude Agent SDK
- OpenAI Agents SDK
- OpenAI API key
- Anthropic API key
- another browser automation framework
- a database/vector database
- a hosted MCP service
- a cloud agent runner

First prove that this is sufficient:

```text
Cursor Pro
+ one writable parent Agent
+ selected read-only reviewers
+ one small local WebQA MCP
+ Cursor native Browser
```

---

# 21. Future optional phase: development-only extension bridge

The remaining major automation boundary is the actual WebQA Chrome side panel and Chrome-owned Prompt API context.

If human side-panel acceptance remains a bottleneck, build a **development-only** extension test bridge with bounded operations such as:

```text
get sanitized extension state
start scan on current test tab
open finding by stable test id
request Frank
advance Frank step
return sanitized focus/side-panel state
export Report Bug trace
```

Then the parent Agent could combine:

```text
webqa MCP          → backend/extension bridge state
Cursor Browser     → real page/screenshots/console/network
Report Bug         → actual extension runtime trace
```

Do not expose that control surface in the consumer build without a separate security/product review.

---

# 22. Definition of a successful migration

The migration is successful when:

- WebQA is primarily opened/edited in Cursor Editor layout.
- Existing Git history/remotes remain intact.
- `doctor.mjs` passes required local checks.
- Cursor recognizes project Rules, Skills, and reviewers.
- `webqa_health` works when the gateway is reachable.
- `webqa_scan_url` can scan an intentionally approved neutral public URL.
- Cursor native Browser can inspect a public page without an extra dependency.
- `/webqa-full-loop` coordinates a material task without a giant pasted workflow prompt.
- parent Agent collects runtime/tool evidence; reviewers remain independent/read-only.
- provider API keys are not required.
- Report Bug can be handed directly to Cursor for runtime diagnosis.
- releases still depend on real tests/build/validation and runtime evidence, never Agent opinion alone.
