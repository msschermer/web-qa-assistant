# AutoQA log

Concise chronological cycle history. Details live under `.autoqa/runs/`.

## Bootstrap

Single-repo AutoQA initialized against immutable baseline `v1.7.5`.
No fork. No permanent autonomous branch. `enabled=false` until activation.

## 2026-08-27T06:52:17.047Z

Bootstrap proof cycle 1: Release Judge REJECT; restored e3a1c57c5b68. enabled=false.

## 2026-08-27T14:29:40.085Z

Activated autonomous improvement. Baseline v1.7.5 @ 33e378fd18de. HEAD 479e3bbc03f4.

## 2026-08-27T14:31:20.823Z

Cycle 1 begun @ d0441385c10a: activation handoff + corpus dogfood.

## 2026-08-27T16:26:00.000Z

Cycle 1 ACCEPT: Chrome-default AutoQA (CDP Extensions.loadUnpacked), corpus dogfood authorization, activate→beginCycle handoff, 127.0.0.1 host permissions. Local + public Chrome smoke PASS. Release Judge ACCEPT.

## 2026-08-27T16:30:04.724Z

Cycle 2 begun @ dd6288dc7923: link scan speed under real Chrome.

## 2026-08-27T16:57:49.155Z

Cycle 2 NO_CHANGE_JUSTIFIED. Max primaryLinkMs 633ms on ~187-link page; dogfood wall dominated by harness/artifacts not link subsystem. Warm-cache B/C: 66/75 hits. Persistent `.autoqa/chrome-profile/` + no auto permissions.request.

## 2026-08-27T22:32:00.000Z

Infra: persist optional hosts across Chrome restart. Chrome 151+ deletes CDP `loadUnpacked` installs (`INSTALLED_VIA_CDP`). Durable unpacked profile + skip reload when already durable.

## 2026-08-27T22:44:00.000Z

Cycle 3 NO_CHANGE_JUSTIFIED. 7/7 Chrome dogfood (3 golden + 4 rotating including MDN and W3/TR) on `profile-durable-unpacked`, optional hosts persisted, natural shutdown. Invariants and Frank Critic clean. W3/TR 500/3021 probe budget; MDN highlight stale after SPA churn.
