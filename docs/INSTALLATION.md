# Installation

## Requirements

- Node.js 22+
- npm
- Chrome 116+
- Git
- Chromium/Chrome for the standalone public renderer

## Install from the repository

```powershell
git clone https://github.com/msschermer/web-qa-assistant.git
cd web-qa-assistant
npm ci
npm run build:extension
npm run check
npm test
```

If Playwright cannot find a browser:

```powershell
npx playwright install chromium
```

## Install the Chrome extension

1. Run `npm run build:extension`.
2. Open `chrome://extensions`.
3. Enable **Developer mode**.
4. Choose **Load unpacked**.
5. Select `web-qa-assistant\dist\extension`.
6. Open a normal HTTP/HTTPS page and click the Web QA Assistant toolbar icon.

The extension requests current-page access through the toolbar user gesture. **Watch this site** separately requests a persistent permission for that origin.

## Configure the assistant gateway

The default production gateway is `https://assistant.msschermer.us`. For a protected team deployment:

1. Expand **Connection settings** in the side panel.
2. Enter the gateway URL if you are overriding the default.
3. Enter the team access key configured as `ASSISTANT_ACCESS_TOKEN` on the server.
4. Click **Save connection**.
5. Click **Test connection**.

If a custom gateway origin is used, the extension requests permission only for that selected origin.

A successful test shows the gateway version, whether connected AI is configured and how many specialized integrations are currently reachable.

## Local stack

From the repository root:

```powershell
Copy-Item .env.example .env
npm run dev
```

The dev script starts:

- web/API: `http://localhost:3000`
- renderer: `http://localhost:8790`
- restricted egress proxy: `http://localhost:8899`

Set environment variables in your shell or `.env`-loading process as appropriate. `npm run dev` itself does not parse `.env` automatically.

## Apply the 1.4 full source zip to the existing Git repo

The delivery zip intentionally contains no `.git`, no `.env` and no `node_modules`. Keep the existing Git repository as the source of truth.

First create the feature branch from clean `main`:

```powershell
cd C:\Users\mike\dev\web-qa-assistant
git checkout main
git pull
git status
git checkout -b feature/final-product-pass
```

Extract the current release source zip to a temporary folder. Then mirror the extracted project into the repository while explicitly preserving Git metadata, installed dependencies and local secrets:

```powershell
robocopy `
  "C:\path\to\extracted\web-qa-assistant" `
  "C:\Users\mike\dev\web-qa-assistant" `
  /MIR /XD .git node_modules /XF .env .env.local
```

Then validate:

```powershell
npm ci
npm run build:extension
npm run check
npm test
git status
```

Do not merge to `main` until the real-browser acceptance checklist in `docs/QA-1.7.0.md` passes.

## Branch -> main delivery

After browser acceptance:

```powershell
git add -A
git commit -m "feat: productize Frank for team delivery"
git push -u origin feature/final-product-pass
```

Open a pull request. GitHub CI must pass. After merging:

```powershell
git checkout main
git pull
git tag v1.7.0
git push origin v1.7.0
```

The release workflow validates tag/package/manifest alignment and publishes the extension and full-source release artifacts.
