# Installing Web QA Assistant 1.6.0

## Chrome extension

1. Unzip the 1.6.0 extension package.
2. Open `chrome://extensions`.
3. Enable Developer mode.
4. Remove or disable the prior unpacked build.
5. Choose **Load unpacked** and select the unzipped 1.6.0 extension folder.
6. Open Web QA Assistant and verify the version in extension details if needed.

Normal users do not need an OpenAI key. Chrome built-in AI is Frank's preferred reasoning layer; Verified guidance remains available when the local model is unsupported or unavailable. Cloud AI remains optional and metered.

## Server update

From the existing deployment checkout:

```bash
git pull
docker compose -f docker-compose.yml -f docker-compose.portfolio.yml up -d --build
curl -s http://127.0.0.1:8787/api/health
```

The health response should report `"version":"1.6.0"`. Existing `.env` managed-access and integration configuration remains server-side.

## First-use Frank behavior

A compatible Chrome installation may need to prepare its on-device model the first time a user asks Frank. 1.6.0 keeps that preparation independent from the page scan. The user may continue reviewing deterministic evidence, may choose **Use verified guidance now**, and should not need to Rescan merely to make Frank become ready.

See `docs/QA-1.6.0.md` for release-candidate acceptance.
