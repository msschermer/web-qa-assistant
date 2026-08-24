# Installing Web QA Assistant 1.5.2

## Chrome extension

1. Unzip the 1.5.2 extension package.
2. Open `chrome://extensions`.
3. Enable Developer mode.
4. Remove or disable the older unpacked Web QA Assistant build.
5. Choose **Load unpacked** and select the unzipped 1.5.2 extension folder.

The extension keeps a stable development identity so Chrome local settings can survive unpacked upgrades when the same identity is used.

## Normal gateway access

With managed installation access enabled on the gateway, users leave **Developer access key** blank. The extension obtains and refreshes its own expiring per-install credential. The server-side signing secret is never bundled in Chrome.

Recommended server settings:

```text
PUBLIC_EXTENSION_ACCESS_ENABLED=true
INSTALL_TOKEN_SECRET=<random server-side secret>
INSTALL_TOKEN_TTL_MS=2592000000
INSTALL_AI_DAILY_LIMIT=200
EXTENSION_CLOUD_AI_ENABLED=false
PUBLIC_AI_ENABLED=false
```

`ASSISTANT_ACCESS_TOKEN` remains an optional private/team override. It is not required for a normal managed installation.

## Frank AI behavior

Normal Frank walkthroughs prefer Chrome built-in AI on the user's device. No OpenAI or Anthropic API key is placed in the extension, and no metered cloud request is required for the on-device path.

Chrome built-in AI may initially report `downloadable` or `downloading`. The first **Ask Frank** interaction can start that browser-managed download. If the local model is not ready quickly enough, Frank uses verified deterministic guidance for the current walkthrough rather than blocking indefinitely; retrying after the download completes enables on-device reasoning.

The optional **Cloud AI fallback** control is off by default and is visibly marked metered. Cloud fallback requires the user to enable it and the server to set:

```text
EXTENSION_CLOUD_AI_ENABLED=true
OPENAI_API_KEY=<server-side provider key>
```

For a zero-provider-charge extension deployment, leave `EXTENSION_CLOUD_AI_ENABLED=false`. To keep the public portfolio scanner from using cloud AI as well, leave `PUBLIC_AI_ENABLED=false`.

## Connection test

A normal healthy connection should report gateway v1.5.2, managed installation access, and successful capability checks for Meta State, Performance Monitor, and WCAG Translator. On-device Frank is reported separately because its availability is a property of the user's Chrome/device, not the gateway.
