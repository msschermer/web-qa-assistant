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

## Production deployment (post-tag)

After the release tag is pushed, deploy the **exact tag** on the production droplet:

1. `ssh portfolio` — WebQA production SSH uses the local alias `portfolio`. **`assistant.msschermer.us` is not the SSH target.**
2. `cd ~/web-qa-assistant`
3. `git fetch origin --tags && git switch --detach vX.Y.Z`
4. `docker compose -f docker-compose.yml -f docker-compose.portfolio.yml up -d --build`
5. Confirm `https://assistant.msschermer.us/api/health` reports the deployed version.

See `docs/DEPLOYMENT.md` for full topology, rollback, and health checks.

Do not force a green result by weakening existing tests, omitting failures, or treating unavailable runtime acceptance as a pass.
