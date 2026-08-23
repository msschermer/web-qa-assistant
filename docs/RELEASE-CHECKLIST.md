# Release checklist

## Automated gate

- [ ] `npm ci`
- [ ] `npm run build:extension`
- [ ] `npm run check`
- [ ] `npm test`
- [ ] `RELEASE_TAG=v1.5.1 npm run release:validate` (PowerShell: `$env:RELEASE_TAG="v1.5.1"; npm run release:validate`)
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
- [ ] Connected reasoning and Standard guidance states are clear
- [ ] keyboard/focus/Escape behavior passes on the Frank UI

## Integration / deployment gate

- [ ] `assistant.msschermer.us/api/health` healthy
- [ ] protected `/api/health/integrations` checked with team access key
- [ ] custom/default gateway Test connection passes in extension
- [ ] Meta State behavior checked on a relevant published-state case
- [ ] Performance Monitor behavior checked on a monitored site
- [ ] WCAG Translator routing checked on an axe finding
- [ ] OpenAI available and unavailable flows both tested
- [ ] `PUBLIC_AI_ENABLED=false` unless public AI usage was intentionally approved
- [ ] renderer and egress proxy not publicly exposed

## Delivery gate

- [ ] four-agent review PASS
- [ ] boss gate PASS
- [ ] feature branch PR CI green
- [ ] merge to `main`
- [ ] tag `v1.5.1`
- [ ] GitHub Release contains clean extension zip and full-source zip
