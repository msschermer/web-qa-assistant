# Installing Web QA Assistant 1.5.1

Two artifacts ship in this handoff:

| File | Use |
| --- | --- |
| `web-qa-assistant-1.5.1-source.zip` | Full repository. Server deployment, development, review. |
| `web-qa-assistant-1.5.1-extension.zip` | Built Chrome extension only. Load this in the browser. |

## Chrome extension

1. Unzip `web-qa-assistant-1.5.1-extension.zip`.
2. Open `chrome://extensions`.
3. Turn on **Developer mode**.
4. Click **Load unpacked** and select the unzipped folder containing `manifest.json`.
5. Confirm the card reads **Web QA Assistant 1.5.1** with no error badge.

If you previously loaded another unpacked build, disable/remove it before testing so two builds do not compete for the toolbar action and side panel.

## Connection behavior

For a gateway with managed installation access enabled, a normal user does **not** need to paste an access key. The extension creates an installation identifier, requests a signed expiring token, stores it in `chrome.storage.local`, and refreshes it automatically.

Connection settings remain available for development and private deployments:

- **Assistant gateway** — leave blank to use `https://assistant.msschermer.us`, or enter a custom gateway.
- **Developer access key (optional)** — overrides managed installation access when a private gateway requires `ASSISTANT_ACCESS_TOKEN`.
- **Test connection** — verifies reachability, managed/shared authorization, the three integrations, and whether Frank AI is actually operational.

A healthy connection should report gateway **v1.5.1**, **Frank AI operational**, and successful integration capability probes. "AI configured" by itself is not treated as proof that Frank can complete a model request.

## Managed server access

Managed access is opt-in. On the gateway set:

```text
PUBLIC_EXTENSION_ACCESS_ENABLED=true
INSTALL_TOKEN_SECRET=<long-random-signing-secret>
INSTALL_TOKEN_TTL_MS=2592000000
INSTALL_AI_DAILY_LIMIT=200
```

`ASSISTANT_ACCESS_TOKEN` may remain configured as a developer/team override. Never bundle either server secret in the extension.

Managed installation tokens provide per-install expiration/accounting and quota enforcement. They are intended for controlled public distribution, not as an unextractable browser secret. For a product requiring user identity/entitlements, add account sign-in/OAuth rather than attempting to hide a permanent secret in the extension.

## First run

1. Open a site you are authorized to test.
2. Click the toolbar icon.
3. Let the local scan finish, then connected enrichment completes.
4. Open **Connection settings → Test connection** if you want to verify gateway status explicitly.
5. Use **Ask Frank** on a material finding.

A successful AI walkthrough is labelled **Connected reasoning**. If the model request fails or is unavailable, Frank is labelled **Fallback guidance** and the UI gives the reason instead of silently presenting deterministic text as AI output.

## Frank acceptance

For a contrast finding, the walkthrough should explain the affected text/component and, when Axe supplies the data, show the observed and required contrast ratios and relevant colors. The old generic "evidence behind the finding" walkthrough step is intentionally removed; detailed provenance remains under **Evidence used**.
