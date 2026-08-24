# Web QA Assistant 1.6.1 acceptance

## Automated gates

- [x] `npm test` — 177/177 pass
- [x] `npm run check` — 56 JavaScript files checked
- [x] `npm run build:extension`
- [x] `RELEASE_TAG=v1.6.1 npm run release:validate`
- [x] source-only rebuild with no `node_modules`
- [ ] contamination/security scan of final ZIP contents — completed during packaging

## Real Chrome acceptance

- [ ] Target-size finding opens without requiring Rescan for Frank readiness.
- [ ] Center card identifies **On-device reasoning** when Chrome AI passes validation.
- [ ] If local AI is rejected, center card identifies **Verified guidance** rather than implying AI ran.
- [ ] Interpretation includes the observed failing target measurement and 24px requirement.
- [ ] Impact focuses on pointer/touch activation and does not introduce keyboard or low-vision boilerplate.
- [ ] Remediation gives a concrete clickable-area or spacing fix rather than dumping raw Axe diagnostics.
- [ ] Sidebar highlights target dimensions/spacing for the interpretation/remediation steps.
- [ ] Sidebar distinguishes **Observed by** from **Reference context**.
- [ ] Single Axe execution does not display a meaningless `Verification attempts: 1` fact.
- [ ] Finding identity remains visible while scrolling Frank evidence.
