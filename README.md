# freundebuch

A personal CRM for one household. You ramble about the people in your life to Claude; freundebuch remembers, and briefs you before the next meeting.

Capture happens through a built-in MCP endpoint (`/mcp`), so there is nothing to fill in by hand; the web UI (German) is for looking things up. Items can be private to the person who recorded them. Next.js and SQLite, one container, one file of data. Licensed AGPL-3.0-only.

## Run it

```yaml
# compose.yaml (also in this repo)
services:
  freundebuch:
    image: ghcr.io/marceltov/freundebuch:main
    restart: unless-stopped
    ports:
      - "3000:3000"
    environment:
      PUBLIC_URL: https://freundebuch.example.com
      FREUNDEBUCH_OIDC_ISSUER: https://authentik.example.com/application/o/freundebuch/
      FREUNDEBUCH_OIDC_CLIENT_ID: ...
      FREUNDEBUCH_OIDC_CLIENT_SECRET: ...
      FREUNDEBUCH_TRUST_PROXY: "1"
    volumes:
      - freundebuch-data:/data
volumes:
  freundebuch-data:
```

`cp .env.example .env`, fill it in, `docker compose up -d`. `GET /health` answers 200 when the instance can reach its database; the image's health check uses it.

## Configuration

Everything is an environment variable. `.env.example` has the same list with comments.

| Variable | Default | Meaning |
| --- | --- | --- |
| `PUBLIC_URL` | derived from the request | The address clients reach freundebuch at (OAuth issuer, links). Set it behind a reverse proxy. |
| `DATA_DIR` | `/data` | Where the database (`freundebuch.db`) and the generated secret live. Mount a volume here. |
| `PORT` | `3000` | Port the server listens on. |
| `TZ` | `Europe/Berlin` | Birthdays and "today" are computed in this IANA time zone. |
| `FREUNDEBUCH_SECRET` | generated into `${DATA_DIR}/secret` | Signs OAuth tokens and sign-in cookies; at least 32 bytes (`openssl rand -hex 32`). Changing it signs out every browser and every connected Claude. |
| `FREUNDEBUCH_OIDC_ISSUER` | none, required | OIDC issuer URL (authentik). |
| `FREUNDEBUCH_OIDC_CLIENT_ID` | none, required | Client ID. |
| `FREUNDEBUCH_OIDC_CLIENT_SECRET` | none, required | Client secret. |
| `FREUNDEBUCH_OIDC_ALLOW` | `*` | Optional extra restriction, comma-separated: addresses or `@domain` (verified email). By default authentik alone decides who gets in. |
| `FREUNDEBUCH_NOTIFY_AT` | `08:00` | Time of day (HH:MM, `TZ`) the daily reminders go out. |
| `FREUNDEBUCH_TRUST_PROXY` | off | Set to `1` behind a reverse proxy that sets `X-Forwarded-For/-Proto/-Host`. Without it those headers are ignored and every client shares one failed-sign-in bucket. |
| `FREUNDEBUCH_RATE_LIMIT` | `60` | Failed sign-ins per minute and client IP; `0` turns the limit off. |
| `FREUNDEBUCH_LOG_LEVEL` | `info` | `error`, `warn`, `info`, `debug` or `silent`. |

## Sign-in with authentik

There is no password and no open mode: without the OIDC variables nobody can sign in. In authentik, create an OAuth2/OpenID provider and an application for it, and register this redirect URI (strict):

```
${PUBLIC_URL}/api/oidc/callback
```

Put the provider's issuer URL (`https://authentik.example.com/application/o/<slug>/`), client ID and client secret into the `FREUNDEBUCH_OIDC_*` variables. Who may use the instance is decided in authentik (bind the application to the household's users or group). The first sign-in creates the user.

## Connect Claude

freundebuch is its own OAuth server; the authorize step is the same authentik sign-in.

- **claude.ai or the Claude apps:** add a custom connector with the URL `${PUBLIC_URL}/mcp` and sign in with authentik when asked.
- **Claude Code:** `claude mcp add --transport http freundebuch ${PUBLIC_URL}/mcp`, then `/mcp` to authenticate.

## REST API

The same domain functions are available over REST at `${PUBLIC_URL}/api/v1`, with an OAuth access token for that URL (resource `${PUBLIC_URL}/api/v1`) or, from the instance's own pages, the sign-in cookie. The OpenAPI description is served at `/api/v1/openapi.json` and committed as `openapi.json`.

## Development

```bash
npm ci
npm run dev        # http://localhost:3000, needs the variables above (or see CLAUDE.md for tests)
npm test           # unit tests
npm run test:e2e   # Playwright against `next dev`
```

Architectural decisions are in `docs/adr`.
