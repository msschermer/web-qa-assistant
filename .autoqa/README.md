# .autoqa — QA harness working directory

This is scratch space for the browser QA harness, not a product surface.

- **`chrome-profile/`** — the persistent Chrome profile the harness drives, with
  the unpacked extension loaded and its optional host grants already accepted.
  Gitignored and regenerable: `node tools/autoqa/chrome-profile-bootstrap.mjs`
  rebuilds it, at the cost of re-accepting permissions once.
- **`runs/`** — screenshots and run artifacts, including everything
  `.claude/skills/run-web-qa-assistant/driver.mjs` writes to `runs/driver/`.
  Gitignored, disposable, and worth deleting whenever it gets large.
- **`knowledge/`** — hand-written lessons about the crawler, Frank, evaluation
  and known limitations. These are tracked, and they are the only thing in here
  worth keeping.

Everything else that used to live here belonged to a single-repo autonomous
improvement loop — `state.json`, `accepted/`, `baseline/`, and the activate /
deactivate / cycle machinery under `tools/autoqa/`. It ran three cycles in
August 2026, recorded zero accepted and zero rejected investigations, and was
removed once the Claude and Cursor skills had taken over the same work. Its
history is in git if it is ever wanted back.

What remains under `tools/autoqa/` is the live harness the driver depends on:
Chrome launch and profile handling, the extension-persistence helpers, the
fixture server, and the dogfood session used to bootstrap the profile.
