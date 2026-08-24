# Privacy and data boundary

Web QA Assistant is designed to inspect only the page state required for a user-requested QA action.

## Local inspection

The extension performs browser rules, axe, target registration and same-origin link verification locally. Localhost, private IP ranges and `.local` / `.internal` environments remain local-only.

## Gateway context contract

For public pages, connected context receives a sanitized report rather than the raw browser runtime. The gateway envelope intentionally excludes raw axe node payloads, target markup, form state and per-URL incomplete-check lists. URL query values are replaced before transmission.

The gateway may receive bounded metadata needed to correlate a finding, including rule IDs, titles/details, confidence, sanitized selectors, status codes, environment and high-level page metadata.

## AI Evidence Contract

Frank prefers Chrome built-in AI, which runs the reasoning step on the user device. For that path, finding evidence is not sent to an AI provider. If the optional cloud fallback is explicitly enabled, evidence is narrowed again to the selected finding and relevant supporting facts before the provider is called. The contract explicitly excludes:

- whole DOM snapshots
- form/input values
- passwords
- cookies
- localStorage/sessionStorage
- authentication tokens, nonces and credentials
- arbitrary `data-*` attributes
- query-string values
- unrelated page content

A bounded markup excerpt may be used only for the selected target and is attribute-sanitized first. The on-device Frank module excludes markup from its compact prompt and has no network/model-provider API calls.

## Connected services

Meta State, Performance Monitor and WCAG Translator are called server-side through the assistant gateway. The extension does not directly expose those service URLs or require host permissions for them.

## Public renderer

The public scanner accepts HTTP/HTTPS URLs only. Its browser is isolated from the application network and uses the dedicated egress proxy, which rejects private/local destinations. Renderer and proxy services are not exposed publicly in the recommended deployment.

## Gateway access

`ASSISTANT_ACCESS_TOKEN` can protect private/team extension routes and remains an optional developer override. It is never bundled into the extension. When managed installation access is enabled, the browser creates an installation identifier and receives a signed, expiring token from the gateway. The signing secret remains server-side. Managed installation tokens support expiration, per-install accounting and quotas, but they should not be treated as proof of a human identity; account/OAuth authentication is the appropriate next step when user entitlements are required.

## Logging

Request IDs may be logged to correlate failures. Do not add raw page bodies, form submissions, cookies or full evidence graphs to production logs.
