# AutoQA operator reference

## Commands

```bash
node tools/autoqa/activate.mjs
node tools/autoqa/activate.mjs --full
node tools/autoqa/deactivate.mjs
node tools/autoqa/bootstrap-proof.mjs
node tools/autoqa/dogfood.mjs https://example.com/ .autoqa/runs/manual
```

## Release Judge decisions

- `ACCEPT` — commit + push main
- `REJECT` — restore `preCycleSha`, keep artifacts
- `NEEDS_MORE_EVIDENCE` — more dogfood/tests, then re-judge

## Website load

Back off on 429/503/connection strain. Quarantine sites in corpus JSON (`quarantined: true`). Current-page scans only — no recursive site crawl.
