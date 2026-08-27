# Web QA Assistant — v1.7.5

## Identity contract

| Concept | Value on `main` after this release |
|---------|-------------------------------------|
| Production release | **1.7.5** |
| Next human production target | **1.7.6** |
| Package / extension manifest version | **1.7.5** |
| Build / dogfood identity | **`buildRevision`** = short git SHA from `npm run build:extension` |

1.7.5 is a released product identity. Do not treat later `main` commits as 1.7.6 until that version is prepared.

## Branch policy

- `main` / `origin/main` — canonical development line after 1.7.5.
- `release/1.7.1` — historical release branch; keep; do not merge into `main` for product work.
- Tags `v1.7.x` — historical; never delete for cleanup convenience. Tag `v1.7.5` must not be moved.

## Provenance

Report Bug v2 and MCP diagnostic readers expose `buildRevision` so unpacked dogfood can be matched to source without waiting for the next release number.
