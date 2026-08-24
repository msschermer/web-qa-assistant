# Web QA Assistant 1.7.0

## Cross-discipline QA workspace

1.7.0 broadens Web QA Assistant from a technically capable scanner panel into a clearer cross-discipline QA workspace. Accessibility remains an important input, but navigation, discoverability, performance, security, implementation quality, and coverage now receive first-class presentation and prioritization.

### Consumer presentation layer

- Primary finding cards now translate scanner output into a concise title, plain-language explanation, and recommended next step.
- Raw rule IDs, selectors, scanner diagnostics, and provenance are retained under **Technical evidence** rather than serving as the primary product copy.
- Frank uses the same evidence-first contract but is presented through **What I found**, **Why it matters**, **What to change**, and **How to verify**.
- QA areas use stable product language: Navigation, Discoverability, Performance, Accessibility, Security, Web quality, and Coverage.

### SaaS workspace redesign

- The side panel is organized around **Page assessment**, **QA areas**, **Recommended order**, and **Workspace tools**.
- Frank remains the focused reasoning surface on the inspected page while the side panel retains scanner facts and evidence.
- Visual hierarchy, spacing, surfaces, status treatment, and responsive behavior were revised as one workspace system rather than another card-by-card skin pass.
- Tooltips are supplemental; essential meaning is visible without hover.

### Report bug

- **Report bug** replaces developer-centric diagnostic language with a consumer-facing support workflow.
- Reports are generated locally; nothing is transmitted automatically.
- Default reports contain extension/browser state, timing, readiness, validation codes, and bounded runtime events without page content, selectors, Frank wording, form values, cookies, raw DOM, or credentials.
- Users may explicitly include bounded current-finding measurements and Frank wording. Even then, selectors and secret-bearing data remain excluded and URLs/contact values are sanitized.
- Reports can be copied or downloaded as JSON for support and real-Chrome acceptance review.

### Cross-discipline Frank quality

- Deterministic guidance was expanded for confirmed broken destinations, server errors, redirects, indexing directives, canonical state, performance metrics, opener security, meta refresh, character encoding, and accessibility families.
- On-device validation now checks the relevant remediation family across disciplines instead of relying on wording similarity.
- Performance reasoning must retain its observed metric and may not turn a one-run lab observation into a historical regression claim.
- URLs already present in verified evidence may be referenced; invented URLs are rejected.
- Security findings have a dedicated impact class and QA area.

### Acceptance and trust

- Mixed-discipline acceptance fixtures verify that a noisy accessibility scanner cannot crowd out confirmed navigation, discoverability, performance, or security issues.
- Page-derived text remains untrusted model input.
- Chrome built-in AI remains the preferred Frank reasoning path. Normal scans and normal Frank usage still do not require a metered cloud model.
- Cloud AI remains optional, explicitly enabled, and labelled metered.
