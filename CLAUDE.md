# Lumen Development Contract

## Product

Lumen is a web QA and site auditing product.

Its primary user experience is a Chrome extension that allows users to scan a page or an entire site and understand problems across areas such as:

- broken links
- accessibility
- performance
- SEO and web quality
- analytics and tracking
- UX and interaction behavior
- technical implementation issues

Lumen is also the reasoning layer that translates raw scanner findings into useful explanations, prioritization, and remediation guidance.

The product must feel like a polished professional QA tool, not an engineering demo.

## Related contracts

This file is the Claude Code entry point. It does not replace the two documents
that already govern this repository — read them rather than re-deriving them:

- **`AGENTS.md`** — the operating contract: product truth hierarchy, the
  lead-engineer workflow, Frank rules, required gates, git/release safety, and
  the completion-report format. It is authoritative wherever this file is silent.
- **`.claude/skills/run-web-qa-assistant/SKILL.md`** — how to actually build,
  launch, and drive the running product.

`.cursor/skills/` holds Cursor-specific workflow skills (acceptance, release,
full-loop, autonomous improvement). They are for that tool; the `.claude/skills/`
set below is the Claude Code equivalent. Do not port one into the other.

## User Intent Is the Highest Priority

Always solve the task the user actually requested.

Do not expand scope merely because other issues are discovered.

If the user requests UI or design work:
- prioritize visual design, layout, information hierarchy, interaction design, states, density, usability, and polish
- do not spend the task refactoring unrelated scanner logic
- do not replace the requested design work with accessibility cleanup, test cleanup, type cleanup, architecture work, or generic code quality improvements
- fix underlying functionality only when necessary for the requested UI behavior

If the user requests scanner or functionality work:
- prioritize the requested capability and its actual runtime behavior
- do not turn the task into an unsolicited visual redesign

If the user requests a broad Lumen overhaul:
- evaluate product, UX, scanner capability, reasoning quality, and technical architecture
- rank work by visible user value
- do not prioritize code cleanliness over product impact

## Scope Discipline

Before making changes, internally identify:

1. What outcome did the user request?
2. What surfaces directly affect that outcome?
3. What must change?
4. What should explicitly remain unchanged?

Do not opportunistically modify unrelated systems.

Finding an unrelated problem does not make that problem part of the task.

Avoid large refactors unless they are required to achieve the requested result.

## Skills

Use the narrowest skill that matches the task:

| Request | Skill |
|---|---|
| design / layout / polish / results presentation | `/lumen-ui` |
| scanner capability, crawling, findings, coverage | `/lumen-functionality` |
| something is wrong or regressed | `/lumen-bugfix` |
| explicit broad overhaul | `/lumen-product-pass` |
| final verification after meaningful work | `/lumen-qa` |
| build / launch / screenshot the running product | `/run-web-qa-assistant` |

`/lumen-product-pass` intentionally grants the widest scope. It is not the default.

## UI Quality Standard

Lumen should have deliberate visual hierarchy and product density.

Avoid:
- giant empty areas
- placeholder-looking layouts
- excessive cards inside cards
- unnecessary borders
- generic dashboard design
- excessive explanatory copy
- repetitive status labels
- UI that exposes implementation details instead of user meaning
- adding visual elements merely to fill space

Prefer:
- strong hierarchy
- compact but readable information density
- clear primary actions
- progressive disclosure
- meaningful states
- strong typography
- consistent spacing
- useful controls
- obvious scan progress
- actionable results
- clear prioritization
- polished empty, loading, error, partial, and completed states

When improving an existing design, inspect the whole relevant surface before editing individual components.

Detection without a usable path to read, filter, and drill into the results is
not a finished feature.

## Product Behavior

Raw scanner data is not the product.

Lumen should transform scanner data into useful answers:

What happened?
Why does it matter?
How confident are we?
What should the user do?
What should they prioritize?

Do not let minor accessibility findings dominate results simply because they are easy to detect.

Confirmed functional failures and high-impact web quality issues should receive appropriate priority.

### Confidence is a fixed vocabulary

Findings may only use the four levels in `packages/findings/confidence.js`:
`confirmed`, `corroborated`, `inferred`, `inconclusive`.

`normalizeConfidence()` coerces anything else to its fallback — which defaults to
`confirmed`. Inventing a "softer" word therefore *upgrades* a finding to
confirmed and manufactures false certainty. Express "unavailable" or "not
applicable" as coverage, never as a confidence level.

## Preserve Working Behavior

Do not remove functioning capabilities while redesigning their presentation.

Before replacing or substantially restructuring an existing system, understand why it exists and what consumes it.

Prefer extending working architecture over unnecessary rewrites.

## Evidence

Do not claim something works because:
- code compiles
- tests pass
- types pass
- the implementation looks correct

For user-facing changes, verify the behavior in the running product whenever possible.

Tests support verification. They do not replace runtime verification.

### Verifying in the running product

The gates (`AGENTS.md` requires all three before a release candidate):

```bash
npm test
npm run check
npm run build:extension
```

Most of Lumen is invisible to those. Drive the real thing:

```bash
node .claude/skills/run-web-qa-assistant/driver.mjs audit https://example.com/ --max-pages 3
node .claude/skills/run-web-qa-assistant/driver.mjs ui https://example.com/
node .claude/skills/run-web-qa-assistant/driver.mjs panel
node .claude/skills/run-web-qa-assistant/driver.mjs web
```

Screenshots land in `.autoqa/runs/driver/` (gitignored). **Open them and look.**
Rebuild the extension before any `ui`/`panel` run or you are reviewing stale UI.
See that skill's Gotchas before debugging the harness itself.

## Completion

A task is complete when the requested user outcome is demonstrably improved.

Do not continue making unrelated improvements merely because context or token budget remains.
