# Architecture decisions (AutoQA memory)

Concise ADR-style notes. Future cycles must consult these before undoing them.

## AD-001 — Primary coverage vs refinement
Primary link coverage is separate from refinement confidence. Queue drain is normal completion.

## AD-002 — Cross-origin iframe scope
Cross-origin iframe interiors are scope limitations, not degraded coverage failures.

## AD-003 — Highlight correctness
Wrong Highlight is worse than no Highlight. Never invent a target.

## AD-004 — Frank readiness vs review
Model readiness ≠ model review completion. Deterministic guidance must identify itself.

## AD-005 — Environment vs index-control
Environment classification and index-control evidence are independent. Absence of noindex evidence ≠ indexable. robots.txt Disallow ≠ noindex.

## AD-006 — Performance synthesis
TTFB is diagnostic, not a Core Web Vital. Prefer synthesized assessment over raw metric dumping.

## AD-007 — Visible errors
Visible user-facing application errors are valuable browser QA evidence when corroborated.

## AD-008 — Finding titles
Titles should explain the actual problem, not merely repeat scanner rule names.

## AD-009 — Single-repo AutoQA
Candidates mutate the working tree against last accepted `main`. REJECT restores `preCycleSha`. No forks or permanent experiment branches.

## AD-010 — Chrome-only AutoQA dogfood
AutoQA launches installed Google Chrome (detected executable; Playwright is the controller only) with unpacked `dist/extension`. Branded Chrome 137+ loads the extension via CDP `Extensions.loadUnpacked` + `--enable-unsafe-extension-debugging`. Bundled Chromium is neither required nor preferred.

## AD-011 — Corpus membership authorizes dogfood
URLs listed in golden/rotating/adversarial/discoveries are intentionally authorized for bounded AutoQA dogfood when enabled. Do not pause for per-site approval on those members.
