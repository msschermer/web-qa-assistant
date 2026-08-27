# Known limitations (baseline v1.7.5)

- HEAD 200 trusted without GET confirm (false-healthy risk).
- Session cache stores query-bearing URLs until TTL/session end; extension spans incognito.
- Related hosts share external pool of 4; last-two-label grouping is not a PSL.
- After repeated 429s, remaining host URLs may be inferred inconclusive.
- 120s emergency does not abort in-flight probes.
- Chrome HTTP/1.1 ~6 connections/host vs concurrency ceiling 12–16.
- Cross-origin iframe interiors and closed shadow roots not observable.
- PSI / field CWV not implemented.
- Live Chrome toolbar / Prompt API not proven by unit tests alone.
- Cursor AutoQA is session-resumable, not a permanent daemon unless an external runner is added.
- Activation readiness `build:extension` stamps `dist/`; those must be restored before beginCycle, and control-plane bookkeeping must be committed, or the next cycle refuses a dirty tree.
- AutoQA requires installed Google Chrome; Playwright bundled Chromium absence is irrelevant when Chrome is present.
- Cursor Auto-review `.cursor/permissions.json` must not treat approved corpus members as “external site needs review.”
