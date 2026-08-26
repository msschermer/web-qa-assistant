# Web QA Assistant — v1.7.5 development line

## Identity contract

| Concept | Value while developing on `main` |
|---------|----------------------------------|
| Production release | **1.7.4** |
| Development target | **1.7.5** |
| Package / extension manifest version | **1.7.4** (unchanged until release prep) |
| Build / dogfood identity | **`buildRevision`** = short git SHA from `npm run build:extension` |

`main` may contain unreleased 1.7.5 product work. That does **not** mean 1.7.5 is released.

## Branch policy

- `main` / `origin/main` — canonical development line for 1.7.5.
- `release/1.7.1` — historical release branch; keep; do not merge into `main` for product work.
- Tags `v1.7.x` — historical; never delete for cleanup convenience.

## Provenance

Report Bug v2 and MCP diagnostic readers expose `buildRevision` so unpacked dogfood can be matched to source without bumping the release version number.
