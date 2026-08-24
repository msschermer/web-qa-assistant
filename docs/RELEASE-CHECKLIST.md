# Release checklist

## Automated gate

- [ ] `npm ci`
- [ ] `npm run build:extension`
- [ ] `npm run check`
- [ ] `npm test`
- [ ] `RELEASE_TAG=v1.5.2 npm run release:validate` (PowerShell: `$env:RELEASE_TAG="v1.5.2"; npm run release:validate`)
- [ ] package and manifest versions agree
- [ ] service-worker relative-module graph resolves
- [ ] no active legacy Preflight runtime dependency

## Product / browser gate

- [ ] first extension scan succeeds on a normal production page
- [ ] environment inference and manual override behave correctly
- [ ] confirmed broken link appears; timeout/inconclusive link does not appear as a defect
- [ ] visual Frank finding highlights the correct element
- [ ] document-level Frank finding does not fake a spotlight
- [ ] Recheck resolves/still-present/inconclusive correctly
- [ ] connected finding recheck uses connected evidence
- [ ] clean scan has an intentional healthy state
- [ ] incomplete coverage is separated from findings
- [ ] Copy issue produces a usable handoff
- [ ] resolved lifecycle and Site session behave correctly
- [ ] Evidence summary, On-device reasoning, Cloud reasoning, and Verified guidance states are clear; any fallback reason is visible
- [ ] keyboard/focus/Escape behavior passes on the Frank UI

## Integration / deployment gate

- [ ] `assistant.msschermer.us/api/health` healthy
- [ ] `/api/health/integrations` checked with managed installation access and developer-key override
- [ ] normal scan verified with `EXTENSION_CLOUD_AI_ENABLED=false` and no provider request
- [ ] Chrome built-in AI availability/download/fallback state checked on a supported desktop Chrome install
- [ ] custom/default gateway Test connection passes in extension
- [ ] Meta State behavior checked on a relevant published-state case
- [ ] Performance Monitor behavior checked on a monitored site
- [ ] WCAG Translator routing checked on an axe finding
- [ ] on-device operational, model-download, unsupported-device, invalid-output, timeout, and deterministic fallback flows tested
- [ ] optional cloud operational/provider failure/quota/invalid-plan flows tested when cloud fallback is intentionally enabled
- [ ] `PUBLIC_AI_ENABLED=false` unless public AI usage was intentionally approved
- [ ] renderer and egress proxy not publicly exposed

## Delivery gate

- [ ] multi-role specialist review PASS
- [ ] adversarial QA PASS
- [ ] final product review PASS
- [ ] feature branch PR CI green
- [ ] merge to `main`
- [ ] tag `v1.5.2`
- [ ] GitHub Release contains clean extension zip and full-source zip
