# Installing Web QA Assistant 1.5.0

Two artifacts ship in this handoff:

| File | Use |
| --- | --- |
| `web-qa-assistant-1.5.0-source.zip` | Full repository. Server deployment, development, review. |
| `web-qa-assistant-1.5.0-extension.zip` | Built Chrome extension only. Load this in the browser. |

## Chrome extension

1. Unzip `web-qa-assistant-1.5.0-extension.zip`. It expands to a folder containing
   `manifest.json` at the top level.
2. Open `chrome://extensions`.
3. Turn on **Developer mode** (top right).
4. Click **Load unpacked** and select the unzipped folder.
5. Confirm the card reads **Web QA Assistant 1.5.0** with no error badge.

If you previously loaded 1.4.0, remove it first. Two builds of the same extension
will both claim the toolbar action and the side panel.

### Connect the gateway

Open any normal HTTP or HTTPS page, click the toolbar icon, then expand
**Connection settings**:

- **Assistant gateway** — leave blank to use `https://assistant.msschermer.us`, or
  enter it explicitly
- **Access key** — your `ASSISTANT_ACCESS_TOKEN` value, if the gateway is protected
- **Save connection**, then **Test connection**

Test connection now reports reachability and authorisation separately:

| Result | Meaning |
| --- | --- |
| `Gateway reachable, v1.5.0, …` | Working. Per-integration rows appear below. |
| `reachable, but the access key was rejected` | Gateway is up; the key value is wrong. |
| `reachable, but it is protected and no access key is saved` | Gateway is up; save the key. |
| `Gateway did not respond` | Network, DNS or container problem. |

Per-integration rows show `available`, `unauthorized`, `not-found`, `degraded` or
`unavailable`. Hover a row for the detail string.

`not-found` means the host answered but the health endpoint is not at that path —
check the configured URL. In 1.4.0 this incorrectly reported as `available`, so an
integration reading `not-found` after upgrade was already misconfigured.

### Permissions

The extension requests only `activeTab`, `scripting`, `sidePanel` and `storage`.
Host access to a site is requested per-origin, and only when you turn on **Watch this
site**. Gateway origins are requested when you save a custom gateway URL.

There is no page-capture permission. Screenshot capture was evaluated and rejected;
`npm run check` fails the build if a capture API is reintroduced.

## Server

See `docs/DEPLOYMENT.md`. Short version for the existing droplet:

```bash
git fetch --tags
git checkout v1.5.0
docker compose -f docker-compose.yml -f docker-compose.portfolio.yml up -d --build
curl -s http://127.0.0.1:8787/api/health | grep 1.5.0
```

## First run

1. Open a client site in Chrome
2. Click the toolbar icon
3. The panel scans locally, then enriches through the gateway

You should see the Frank brief, then the impact ledger showing counts per area, then
grouped findings. If everything in the ledger is accessibility, that is the page, not
the product — check a page with a known broken link to confirm composition is working.

Use **Ask Frank** on any finding. The walkthrough opens with an interpretation step
saying what the element is doing before it recommends anything.
