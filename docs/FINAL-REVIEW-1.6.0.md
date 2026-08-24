# Final multi-role review — Web QA Assistant 1.6.0

## Lead engineering

The implementation keeps deterministic scanning authoritative and moves Chrome AI readiness into an independent runtime manager. A trusted system-only base session may remain warm while the side panel is active; unrelated findings use isolated clones. The scan lifecycle contains no AI recovery behavior.

## Frontend / accessibility review

The sidebar and focus overlay now have distinct jobs: evidence in the ledger, Frank reasoning in the centered card. Review identified two focus-mode defects during implementation: the modal treatment still allowed page pointer interaction and sidebar focus could steal attention from the central dialog. Both were corrected. The center card owns dialog focus, page interaction is blocked while active, live updates and focus restoration remain in place, and reduced-motion support is preserved.

## Product / UX review

The previous standalone locate step spent the strongest visual moment saying little more than “this is the affected element.” It was removed. Interpretation now leads, while the spotlight provides location context. The large generic VERIFIED block was also reduced so deterministic evidence and actionable guidance receive the visual priority. Tailwind was reviewed and deferred because the existing token/CSS system can support this redesign without framework migration risk.

## Performance review

Repeated model creation was replaced with a warm base-session + per-task clone design consistent with Chrome's intended repeated-prompt pattern. Task clones are destroyed after use and the base is destroyed when the panel unloads. Model preparation does not block Browser QA.

## Security / adversarial QA

The review deliberately tested prompt injection, cross-site carryover, unsupported page positions/components, unsupported business claims, invented values, semantic drift, and unsafe remediation. A material issue was found: hostile page text containing a destructive instruction could have been mistaken for supporting evidence for the same destructive model suggestion. The validator now permits high-risk actions only when the trusted deterministic plan itself supports them; untrusted page evidence can never authorize them.

A separate numerical adversarial test found that a contrast color produced by binary search could round to a hex value microscopically below the promised threshold. The algorithm now validates the rounded color and steps toward the passing extreme until the actual emitted value satisfies the requirement. Seeded regression cases cover the rounding boundary.

Cross-site tests prove page evidence is supplied only to independent task clones and never to the retained base session or another site's prompt.

## Release engineering review

A prior packaging failure could clear `dist/extension` and then fail because `node_modules/axe-core/axe.min.js` was missing, deleting the vendored runtime from the working tree. The builder now caches the installed or already-vendored axe runtime before clearing `dist`, so a release source package remains rebuildable without a local dependency directory.

Final automated counts and runtime limitations are recorded in `RELEASE_PROVENANCE.txt` after the release gate completes.
