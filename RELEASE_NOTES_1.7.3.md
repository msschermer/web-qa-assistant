# Web QA Assistant 1.7.3

## Product-quality attention and coverage honesty

1.7.3 improves how Recommended Order and coverage reflect verified evidence across QA areas. Accessibility volume no longer automatically dominates priority, performance coverage reports current-page lab measurements honestly, and Frank guidance stays specific without inventing certainty.

### Balanced Recommended Order

- Uncertain image-alt findings remain visible for review but are no longer treated as blockers.
- Title and document-language overlaps between browser rules and axe are collapsed so the same underlying issue is not double-counted.
- Confirmed blank-opener issues can appear as low-weight Security items without overpowering higher-materiality work.
- Sticky impact-class values from older artifacts are recomputed when local policy is re-applied.

### Honest performance coverage

- When renderer lab metrics exist (LCP, TTFB, or transfer), coverage reports `current-page` instead of being overwritten by a connector `not monitored` state.
- Incomplete lab availability is reported as `partial` rather than pretending full current-page coverage.

### Frank guidance and assessment

- Contrast remediation stays free of raw axe failureSummary jargon while retaining observed ratios and colors.
- Uncertain-image Frank assessments preserve review status and remediation limitations when image purpose is unresolved.
- Viewport-missing and lang-missing guidance include concrete deterministic interpretations.

### Privacy in lab performance evidence

- Browser performance resource URLs for LCP and heaviest assets drop query-string and fragment values while keeping useful origin/path context.

### MCP / review consistency

- Local review recomposition applies current finding policy before composing Recommended Order, so validation against gateway scans reflects the shipping product rules even when the deployed gateway is still on an earlier patch.

### Unchanged and deferred

- Target-integrity behavior for blocked, challenge, and substituted pages remains intact from 1.7.2.
- Deferred (not included): UI redesign, LCP/TTFB threshold retuning, broader duplicate-family suppression, per-node image-purpose for aggregated axe rows, and field CWV / paid performance APIs.
