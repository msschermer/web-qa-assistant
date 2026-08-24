# Web QA Assistant 1.5.2 acceptance

## Automated release gate

Run from the repository root:

```bash
npm test
npm run check
npm run build:extension
RELEASE_TAG=v1.5.2 npm run release:validate
```

All four commands must pass before packaging.

## Frank architecture acceptance

- [ ] A normal scan completes without invoking a cloud model provider.
- [ ] Connection settings show the three QA integrations independently from Frank's AI mode.
- [ ] With Cloud AI fallback unchecked, no OpenAI health/model request is made by the extension connection test.
- [ ] **Ask Frank** attempts Chrome built-in AI from the user click on supported Chrome.
- [ ] If Chrome reports the model `downloadable` or `downloading`, progress is surfaced and the walkthrough can fall back to verified guidance rather than hanging indefinitely.
- [ ] Successful local reasoning is labelled **On-device reasoning**.
- [ ] Unsupported/unavailable local AI is labelled **Verified guidance** with a reason; it is never presented as AI output.
- [ ] Cloud reasoning occurs only when the extension toggle is enabled and the server has `EXTENSION_CLOUD_AI_ENABLED=true`.
- [ ] Cloud failure is explicit and never silently relabelled as successful AI.

## Evidence-quality cases

Use the neutral known-answer fixture plus representative public pages.

- [ ] Contrast: observed ratio, required ratio, and available colors survive into Frank; AI guidance may not omit the ratios or introduce a ratio not present in evidence.
- [ ] Decorative image: when deterministic purpose is resolved as decorative, Frank gives one `alt=""` remediation and local AI cannot reintroduce meaningful alt text.
- [ ] Model output cannot introduce an unsupported WCAG criterion or a new URL.
- [ ] Uncertain image: Frank preserves the uncertainty instead of forcing a decorative verdict.
- [ ] Broken internal destination: confirmed HTTP failure can outrank repeated accessibility findings; timeouts remain coverage-only.
- [ ] LCP: one browser observation stays labelled as lab evidence and cannot become a claimed field regression.
- [ ] Transfer weight: incomplete resource timing remains a lower-bound measurement.
- [ ] SEO/implementation findings retain rule-specific guidance rather than generic scanner narration.

## UX/accessibility acceptance

- [ ] Scan overview uses **Evidence summary**; it does not imply an AI request occurred during scanning.
- [ ] Frank walkthrough opens with focus on its title.
- [ ] Step changes are announced by the walkthrough live region.
- [ ] Exiting Frank restores focus to the originating **Ask Frank** button.
- [ ] Connection Save reaches a terminal verified/warning/error state without reopening the panel.
- [ ] Cloud fallback is visibly labelled **optional · metered** and is unchecked by default.
- [ ] Side-panel layout remains usable at narrow Chrome side-panel widths.

## Real Chrome built-in AI acceptance

Chrome's Prompt API is available for extensions in supported Chrome versions, but local model availability also depends on the user's device and model download state. On a qualifying desktop Chrome installation:

1. Load `dist/extension` unpacked.
2. Open Connection settings and confirm **On-device Frank** reports `available`, `downloadable`, or `downloading` rather than an extension error.
3. Click **Ask Frank** on a material finding.
4. If Chrome downloads the model, wait for or repeat Ask Frank after the download completes.
5. Confirm a successful walkthrough shows **On-device reasoning** and evidence-specific language.
6. Confirm no cloud fallback is enabled and no provider billing is required for that walkthrough.

If the device does not meet Chrome's local-model requirements, deterministic **Verified guidance** is an expected supported state rather than a release failure.

## Contamination/security gate

- [ ] No real test-site/client/person identity is present in source, tests, fixtures, docs, or built extension.
- [ ] Fixtures use reserved example domains and neutral synthetic labels only.
- [ ] No reusable gateway token or model-provider secret is bundled in extension files.
- [ ] `local-ai.js` has no network/model-provider API calls.
- [ ] Cloud-bound evidence still passes the AI Evidence Contract and private environments remain local-only.
