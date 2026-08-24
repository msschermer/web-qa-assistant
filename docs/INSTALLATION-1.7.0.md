# Web QA Assistant 1.7.0 installation and deployment

## Local validation

From the project root:

```powershell
npm ci
npm run build:extension
npm test
npm run check
$env:RELEASE_TAG="v1.7.0"
npm run release:validate
Remove-Item Env:RELEASE_TAG
```

Load `dist/extension` from `chrome://extensions` using Developer mode → Load unpacked.

## Whole-folder replacement workflow

If the project folder was replaced and `.git` was removed, reconnect without overwriting the new working files:

```powershell
git init
git branch -M main
git remote add origin https://github.com/msschermer/web-qa-assistant.git
git fetch origin
git reset --mixed origin/main
git status
```

Then stage, commit, and push after validation.

## Production deployment

On the server:

```bash
cd ~/web-qa-assistant
git status
cp .env ~/.env.backup-1.7.0
git pull
grep '"version"' package.json
docker compose -f docker-compose.yml -f docker-compose.portfolio.yml up -d --build
docker compose -f docker-compose.yml -f docker-compose.portfolio.yml ps
curl -s http://127.0.0.1:8787/api/health
```

Expected health includes `"version":"1.7.0"`, `"preferredFrankAi":"chrome-built-in"`, managed extension access according to deployment configuration, and cloud extension AI disabled unless explicitly enabled.

Complete the real-browser matrix in `docs/QA-1.7.0.md` before treating the release as accepted.
