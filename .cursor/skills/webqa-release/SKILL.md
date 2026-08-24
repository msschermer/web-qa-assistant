---
name: webqa-release
description: Validate a Web QA Assistant release candidate without silently changing release criteria.
disable-model-invocation: true
---
# WebQA release gate workflow

1. Confirm working tree and intended version.
2. Run `npm test`.
3. Run `npm run check`.
4. Run `npm run build:extension`.
5. Run release validation with the intended `RELEASE_TAG`.
6. The parent Agent must collect runtime evidence first using `webqa` and Cursor Browser (or optional `playwright-live` when existing-profile parity is required), then delegate the collected evidence to the read-only `browser-acceptance` reviewer.
7. Have security/privacy and adversarial reviewers inspect the candidate.
8. Have `release-gate` independently APPROVE or BLOCK.
9. Only after approval create release archives/checksums.

Do not force a green result by weakening existing tests, omitting failures, or treating unavailable runtime acceptance as a pass.
