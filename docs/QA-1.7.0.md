# Web QA Assistant 1.7.0 QA gate

1.7.0 is accepted as a cross-discipline QA product, not as an accessibility extension with extra checks.

## Automated gate

The release must pass all repository regression tests, static checks, extension build, release-version validation, source-only rebuild, import-graph validation, privacy/contamination scans, and archive integrity checks.

### Mixed-discipline prioritization

A synthetic acceptance page/report must contain simultaneous material findings across several areas, including:

- a confirmed broken internal destination
- a production discoverability/indexing problem
- a browser performance observation
- a security/web-platform issue
- multiple accessibility findings
- at least one inconclusive coverage observation

The recommended order must represent distinct material QA areas before repeating a noisy category. Inconclusive coverage never becomes a defect.

### Finding translation

Primary finding cards must answer:

1. What happened?
2. Why is it relevant?
3. What should be done next?

Raw rule IDs, selectors, status payloads, and scanner diagnostics remain available as Technical evidence but must not be the primary explanation.

Golden cases cover Navigation, Discoverability, Performance, Accessibility, Security, and Web quality.

### Frank

For every supported family, verify:

- deterministic evidence remains the truth authority
- the highlighted/selected evidence is relevant to the current Frank step
- interpretation does not merely restate scanner provenance
- impact does not invent users, business outcomes, historical regressions, page regions, or causes
- remediation remains within an evidence-supported fix family
- verification describes a concrete completion condition
- on-device output may improve wording without replacing finding IDs, targets, measurements, or evidence references
- invented URLs, measurements, standards, structure, and destructive/secret-handling actions are rejected

Performance responses must preserve observed metrics and retain lab-observation uncertainty. Broken-link guidance must distinguish confirmed failures from timeout-only coverage. Discoverability guidance must respect environment policy.

### Report bug privacy

Default report:

- local generation only
- no automatic network send
- no page content
- no selectors
- no Frank/model wording
- no cookies, form values, raw DOM, credentials, tokens, or query values
- bounded runtime events and diagnostic codes only

Explicit context opt-in may add bounded current-finding measurements and Frank wording, but still excludes selectors/raw DOM/form values/credentials and sanitizes URLs/contact-like values.

### UI/product gate

Review at narrow side-panel widths and browser zoom. Confirm:

- Page assessment is the first product judgment
- QA areas make scanner breadth immediately understandable
- Recommended order is visually stronger than technical details
- Workspace tools are secondary
- essential labels do not depend on tooltips
- Frank evidence sidebar and centered reasoning card have distinct roles
- focus, keyboard navigation, live-region behavior, and reduced motion remain usable
- long titles/selectors do not cause horizontal overflow

## Final automated result

- 193/193 repository tests pass.
- Static check passes across 61 JavaScript files.
- Extension build passes.
- `v1.7.0` release-version validation passes.
- A copy of the release source rebuilds the extension without `node_modules` while retaining Axe, icons, presentation, and Report bug runtime modules.
- Static component previews at 420px and 360px show no horizontal overflow.
- Final source/dist contamination and secret-pattern scan passes.

## Real Chrome acceptance

Use at least two unrelated public sites. The runtime portfolio should include, where available:

- Navigation/broken destination
- Discoverability/SEO
- Performance
- Accessibility
- Security or Web quality

Also verify:

1. Ask Frank while Chrome is preparing the local model; do not Rescan. Readiness must resolve independently.
2. On-device reasoning versus Verified guidance is explicit.
3. A second site never receives first-site evidence or wording.
4. Export a default Report bug artifact and inspect it for privacy boundaries.
5. Repeat with explicit context opt-in and confirm the bounded context is useful without leaking selectors/secrets.
6. Evaluate usefulness, not only correctness: Frank should explain the issue simply, recommend a concrete action, and give a meaningful verification step.

The release is not accepted merely because Axe findings work.
