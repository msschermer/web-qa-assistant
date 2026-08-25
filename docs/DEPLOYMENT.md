# Production deployment

Recommended production topology:

```text
Chrome extension / public web
        |
        v
assistant.msschermer.us (Caddy / TLS)
        |
        v
127.0.0.1:8787  Web QA Assistant API
        |
        +--> Meta State
        +--> Performance Monitor
        +--> WCAG Translator
        +--> OpenAI (optional)
        |
        v
internal renderer --> internal egress proxy --> public internet only
```

Only the API is bound to host loopback. The renderer and egress proxy stay on internal Docker networks.

## 1. Prepare the server

On the Linux host:

```bash
git clone https://github.com/msschermer/web-qa-assistant.git
cd web-qa-assistant
git checkout v1.7.4
cp .env.example .env
```

Generate independent random values:

```bash
openssl rand -hex 32   # RENDERER_TOKEN
openssl rand -hex 32   # ASSISTANT_ACCESS_TOKEN (developer/team override)
openssl rand -hex 32   # INSTALL_TOKEN_SECRET (managed installation signing)
```

Edit `.env`.

Recommended team configuration:

```dotenv
RENDERER_TOKEN=<random-renderer-token>
ASSISTANT_ACCESS_TOKEN=<random-team-access-token>
PUBLIC_EXTENSION_ACCESS_ENABLED=true
INSTALL_TOKEN_SECRET=<random-install-signing-secret>
INSTALL_TOKEN_TTL_MS=2592000000
INSTALL_AI_DAILY_LIMIT=200
EXTENSION_CLOUD_AI_ENABLED=false
OPENAI_API_KEY=
OPENAI_MODEL=gpt-5.6-terra
PUBLIC_AI_ENABLED=false
ALLOWED_ORIGINS=chrome-extension://<installed-extension-id>

META_STATE_URL=https://meta-state.msschermer.us
PERFORMANCE_MONITOR_URL=https://psi.msschermer.us
WCAG_TRANSLATOR_URL=https://wcag-translator.msschermer.us
```

`ASSISTANT_ACCESS_TOKEN` remains a developer/team override. With `PUBLIC_EXTENSION_ACCESS_ENABLED=true`, normal installs can register for an expiring signed installation token and do not need the shared value. `INSTALL_TOKEN_SECRET` stays server-side and signs those tokens. Managed access is public distribution access with per-install limits; it is not a hidden browser secret.

`PUBLIC_AI_ENABLED=false` and `EXTENSION_CLOUD_AI_ENABLED=false` are recommended for a zero-provider-charge deployment. Normal extension Frank uses Chrome built-in AI on the user device when available, and verified deterministic guidance otherwise. Configure `OPENAI_API_KEY` only if you intentionally enable a metered cloud path.

## 2. Start the Docker stack

```bash
docker compose up -d --build
```

Check:

```bash
docker compose ps
curl http://127.0.0.1:8787/api/health
```

Expected API fields include version `1.7.4`, OpenAI configuration state and `publicAiEnabled`.

The renderer has a Docker healthcheck. The API waits for a healthy renderer before the normal container dependency is considered ready.

## 2b. Shared portfolio network (recommended on the existing droplet)

The droplet already runs a shared Caddy on the external network created by the
`portfolio-infra` stack. Earlier releases required hand-editing `docker-compose.yml`
on the server to join that network, which meant the change could be lost on every
upgrade. `docker-compose.portfolio.yml` removes that step.

```bash
docker compose \
  -f docker-compose.yml \
  -f docker-compose.portfolio.yml \
  up -d --build
```

Confirm the external network exists first:

```bash
docker network ls | grep portfolio-infra_web
```

If the name differs on your droplet, change `name:` in `docker-compose.portfolio.yml`
rather than editing the base file.

With the override in place, Caddy reaches the gateway by service name:

```caddy
assistant.msschermer.us {
  encode zstd gzip
  reverse_proxy web-qa-api:8787
}
```

The loopback publish in the base file stays. It binds only to `127.0.0.1`, so it
remains useful for `curl` checks on the droplet without being externally reachable.

## 3. Configure DNS and Caddy

Create/confirm DNS for:

```text
assistant.msschermer.us -> deployment server
```

The provided `Caddyfile.snippet` assumes Caddy runs on the host:

```caddy
assistant.msschermer.us {
  encode zstd gzip
  reverse_proxy 127.0.0.1:8787
}
```

Reload Caddy using the method appropriate to the host, for example:

```bash
sudo caddy validate --config /etc/caddy/Caddyfile
sudo systemctl reload caddy
```

Then verify:

```bash
curl https://assistant.msschermer.us/api/health
```

## 4. Verify protected integration health

With `ASSISTANT_ACCESS_TOKEN` configured:

```bash
curl \
  -H "x-web-qa-key: <team-access-token>" \
  https://assistant.msschermer.us/api/health/integrations
```

The response reports gateway-side availability for Meta State, Performance Monitor and WCAG Translator. Cloud AI is not probed unless the server enables it and the extension explicitly requests the optional cloud check. On-device Frank availability is checked by Chrome in the extension, not by the gateway.

A connector marked unavailable does not automatically mean a client site has a problem. It is a service/coverage condition.

## 5. Configure the extension

Load the release extension. With managed installation access enabled, no access key entry is required; the extension registers and refreshes its installation token automatically. Under **Connection settings** you can still:

- leave Gateway blank to use `https://assistant.msschermer.us`, or enter a custom gateway
- enter the optional **Developer access key** (`ASSISTANT_ACCESS_TOKEN`) to override managed access for a private gateway
- run **Test connection** to verify authorization, connector capability health, Chrome on-device Frank availability, and the optional cloud fallback state

For an unpacked extension, find the extension ID at `chrome://extensions` and use `chrome-extension://<id>` in `ALLOWED_ORIGINS` if you are enforcing exact CORS origins.

## 6. Security requirements

- Do not expose renderer port `8790` or egress proxy `8899` publicly.
- Keep the API published only to `127.0.0.1:8787`; Caddy is the public entry point.
- Never place `OPENAI_API_KEY` in extension source or Chrome storage.
- Keep `PUBLIC_AI_ENABLED=false` unless public web AI usage is intentionally enabled and cost/abuse controls are accepted.
- Keep `EXTENSION_CLOUD_AI_ENABLED=false` unless extension users are intentionally allowed to make metered provider requests.
- Do not log raw page bodies, form values, cookies or unsanitized evidence graphs.
- Rotate `ASSISTANT_ACCESS_TOKEN` if team access changes, and rotate `INSTALL_TOKEN_SECRET` when all managed installation tokens should be invalidated.
- Keep specialized integration credentials/URLs server-side.

## 7. Observability

Requests carry `X-Web-QA-Request-ID`. Extension diagnostics and API responses include the request ID where possible. Use it to correlate:

```text
extension -> assistant gateway -> connector / renderer
Ask Frank -> Chrome built-in AI on device
optional cloud fallback -> assistant gateway -> provider
```

Useful commands:

```bash
docker compose logs -f web-qa-api
docker compose logs -f renderer
docker compose logs -f egress-proxy
```

## 8. Upgrade

After a tested release tag is published:

```bash
git fetch --tags
git checkout v1.7.4
docker compose -f docker-compose.yml -f docker-compose.portfolio.yml up -d --build
curl http://127.0.0.1:8787/api/health
```

Drop the `-f` flags if you are not using the shared portfolio network.

Confirm the upgrade landed:

```bash
curl -s http://127.0.0.1:8787/api/health | grep 1.7.4
curl -s -H "x-web-qa-key: <team-access-token>" \
  http://127.0.0.1:8787/api/health/integrations
```

Integration health since 1.6.0 reports `available`, `unauthorized`, `not-found`,
`degraded` or `unavailable`. Earlier releases reported any response under HTTP 500
as `available`, so a misconfigured integration URL returning 404 looked healthy.
If an integration that previously read as available now reads as `not-found`, the
URL was already wrong; the status is newly accurate, not newly broken.

Install/reload the matching extension artifact from the same release tag.

## 9. Rollback

Server rollback:

```bash
git checkout v1.7.3
docker compose -f docker-compose.yml -f docker-compose.portfolio.yml up -d --build
```

Extension rollback: load the extension artifact from the same previous release. Keep server and extension versions aligned when validating behavior.
