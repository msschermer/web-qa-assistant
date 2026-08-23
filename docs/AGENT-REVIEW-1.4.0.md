# Four-agent delivery review: Web QA Assistant 1.4.0

## SEO / QA specialist

**Gate: PASS for delivery candidate, subject to real-browser acceptance.**

The product now separates inability to verify from evidence of failure. Confidence and environment are first-class inputs to materiality. Production indexing/crawl defects can be prioritized strongly while expected staging states and low-value optimization heuristics stay quiet. Link checking requires independent confirmation before 404/5xx findings are admitted.

The specialist recommends no rule-count expansion for this release. Trust remains more valuable than breadth.

## Senior Developer

**Gate: PASS for delivery candidate, subject to deployment and browser acceptance.**

1.4 removes the active legacy Preflight service dependency and routes connected systems through one assistant gateway. The extension now sends a sanitized gateway context envelope rather than raw runtime findings, and sends a separately sanitized Frank graph for connected reasoning. OpenAI still receives the narrower AI Evidence Contract server-side.

A trust bug identified during review was fixed: Recheck for a connected-only finding now performs connected enrichment instead of falsely concluding the issue is resolved from local-only evidence.

Custom gateway setup now requests permission only for the selected origin and includes a Test connection flow. Request IDs, protected extension routes, integration health and public-AI opt-in improve operability/security. The recommended Docker topology exposes only the API on host loopback; renderer/proxy stay internal.

Automated CI/release workflows are present. Real Chrome acceptance cannot be replaced by Node tests.

## Product Manager

**Gate: PASS for delivery candidate.**

The default experience now answers “what deserves attention?” rather than presenting every scanner observation equally. Healthy, attention, blocker and incomplete-coverage states are distinct. Findings support Ask Frank, Highlight, Recheck and Copy issue. Site session and resolved lifecycle provide QA progress without introducing a crawler.

The PM approves the scope because each addition improves trust, speed-to-understanding, ability to act or maintainability. New detector breadth was intentionally deprioritized.

## UI / UX / Brand specialist

**Gate: PASS for delivery candidate, with real side-panel review required.**

The extension and web surface now share the portfolio paper/ink/blue design tokens. Frank judgment is the primary hierarchy. Finding cards put human meaning, priority/confidence and actions before rule IDs/selectors/raw evidence. Technical material is available under progressive disclosure.

Frank's two modes are presented as **Connected reasoning** and **Standard guidance** instead of exposing implementation jargon. The walkthrough includes an assessment/limitations block and a predictable evidence -> impact -> fix -> verify grammar. The verification step can recheck eligible issues.

Focus management, Escape behavior, live status messages and non-color status labels are included. The designer requires a final manual narrow-side-panel and keyboard pass before broad handoff.

## Boss gate

**Gate: APPROVED as a delivery candidate after the final acceptance pass.**

Boss criteria:

- Trust: uncertainty is not promoted to a defect.
- Understanding: the UI leads with a judgment and evidence strength.
- Actionability: Frank gives remediation, handoff and re-verification.
- Maintainability: GitHub CI/releases, one connected gateway, health checks and request IDs are in place.
- AI discipline: AI explains already-admitted evidence and receives bounded sanitized inputs.

The boss does not require additional QA rule count before delivery. The remaining gate is real browser/client-site acceptance plus production gateway deployment verification.
