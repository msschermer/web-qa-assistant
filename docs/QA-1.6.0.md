# Web QA Assistant 1.6.0 acceptance

## Automated release gate

Run from the repository root:

```bash
npm test
npm run check
npm run build:extension
RELEASE_TAG=v1.6.0 npm run release:validate
```

All commands must pass before packaging.

## Frank readiness lifecycle

- [ ] Browser QA completes independently of Chrome AI readiness.
- [ ] If `LanguageModel.availability()` is `downloadable`, Frank shows a first-use preparation state only after clear Ask Frank intent.
- [ ] `downloadprogress` is surfaced when Chrome reports it.
- [ ] If the model is preparing, the selected finding remains intact and the user can continue reviewing evidence.
- [ ] When Chrome becomes ready, the pending Frank request can continue without Browser QA Rescan, page reload, extension restart, or settings action.
- [ ] **Use verified guidance now** remains available while preparation is in progress.
- [ ] Rescan contains no Prompt API preparation/recovery behavior and remains a page-inspection action only.
- [ ] Page navigation, finding changes, panel close, or a newer Ask Frank request invalidates stale pending work.
- [ ] A warm system-only base session is retained only while the panel is active; task clones are destroyed after each finding.

## Cross-site/task isolation

- [ ] Scan Site A and ask Frank, then Site B and ask Frank.
- [ ] Site B guidance contains no Site A text, selector, URL, recommendation, or other page evidence.
- [ ] The retained base Prompt API session receives system instructions only; page evidence is supplied only to per-finding clones.

## Evidence and reasoning UI

- [ ] Sidebar is an evidence ledger: finding facts, confidence, environment, target/selector, measurements, sources, verification, current-step evidence, full evidence, utilities.
- [ ] Frank-generated interpretation/remediation is not duplicated as the primary sidebar content.
- [ ] Center focus card contains the complete current Frank step body, not only a step title.
- [ ] Walkthrough begins with interpretation; spotlighting is presentation rather than a standalone narration step.
- [ ] The actual affected element remains spotlighted and visible while Frank explains it.
- [ ] Center-card placement avoids covering the highlighted element when a reasonable alternative exists.
- [ ] Current-step evidence is visibly traceable in the ledger.
- [ ] Generic VERIFIED status does not outrank the actual evidence or Frank recommendation.

## Frank recommendation quality

Use at least accessibility, link/SEO, performance, and image-purpose cases.

- [ ] Contrast guidance retains observed/required ratios and available colors.
- [ ] If a nearby passing contrast color is suggested, the rounded RGB/hex value independently satisfies the threshold.
- [ ] Confirmed broken links receive destination/action-specific guidance; timeouts remain coverage-only.
- [ ] Browser performance observations remain labelled as lab observations unless monitored history independently establishes a trend.
- [ ] Resolved decorative images produce one `alt=""` recommendation; uncertain image purpose remains an explicit fork.
- [ ] Frank does not invent ordinal position (for example, “first article”), component names, business outcomes, URLs, standards, or measurements absent from evidence.
- [ ] Frank wording that materially drifts from verified deterministic remediation is rejected.
- [ ] Hostile page content cannot cause Frank to recommend destructive actions, secret access, credential handling, or data exfiltration.

## UI/accessibility acceptance

- [ ] Focus card has accessible dialog labelling/description and traps keyboard focus while active.
- [ ] Escape exits Frank and focus returns to the originating Ask Frank action.
- [ ] Step content changes are announced by a live region.
- [ ] Page interaction is blocked consistently while the modal focus treatment is active.
- [ ] Reduced-motion preference is respected.
- [ ] Test narrow side panel, wide side panel, 200% zoom, long title/selector, edge-position target, fixed/sticky content.
- [ ] Frank readiness/progress is understandable without relying on color alone.

## Cost/privacy acceptance

- [ ] Routine scan invokes no metered model provider.
- [ ] Chrome on-device reasoning is the preferred Frank path.
- [ ] Optional cloud Frank remains double opt-in and visibly metered.
- [ ] Raw DOM, forms, cookies, storage, credentials, and query values remain outside AI payloads.
- [ ] Page-derived strings are untrusted model data, never system instructions.

## Release integrity

- [ ] Source and built extension both report 1.6.0.
- [ ] A release-source rebuild succeeds even when `node_modules` is absent, provided the packaged vendored axe runtime exists.
- [ ] Icons and `vendor/axe.min.js` survive the rebuild.
- [ ] No real test-site/company/person identities or copied external-site content are present in source, tests, fixtures, docs, or built extension.
- [ ] No reusable assistant/provider secret is bundled.

## Real Chrome release-candidate acceptance

On a qualifying desktop Chrome installation:

1. Load the final `dist/extension` unpacked.
2. Scan a page while Frank is not yet warmed; confirm scanning remains usable.
3. Trigger Ask Frank and, if preparation is required, observe preparation/progress in place.
4. Without rescanning, confirm the pending finding opens with **On-device reasoning** after Chrome becomes ready.
5. Navigate to a different site and repeat; confirm no first-site context is referenced and no Rescan workaround is necessary.
6. Test at least one contrast/accessibility finding, one performance finding, and one link or SEO finding.
7. Confirm no cloud fallback is enabled and no metered provider request is required.
