# Crawler lessons

- Completeness first: eligible URLs must be attempted (or explicitly skipped) before duration claims.
- Adaptive concurrency with reserved external pools; do not starve target-origin work.
- Primary-first, then refinement. Skip refinement for 401/403/429.
- Session cache: healthy/broken/redirect only; inconclusive never cached; Recheck bypasses cache.
- Origin-scope internal SNAPSHOT sharing; keep query URLs out of privacy claims.
- HEAD 200 without GET is an accepted false-healthy risk; do not reverse without evidence.
