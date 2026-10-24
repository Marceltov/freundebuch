# freundebuch

A personal CRM for one household. You ramble about the people in your life to Claude; freundebuch remembers, and briefs you before the next meeting.

Capture happens through a built-in MCP endpoint (`/mcp`), so there is nothing to fill in by hand; the web UI (German) is for looking things up. Items can be private to the person who recorded them. Next.js and SQLite, one container, one file of data. Licensed AGPL-3.0-only.

**Documentation: <https://marceltov.github.io/freundebuch/>**

## Run it

```bash
cp .env.example .env   # fill in PUBLIC_URL and the FREUNDEBUCH_OIDC_* variables
docker compose up -d   # compose.yaml in this repo
```

Then add `${PUBLIC_URL}/mcp` as a custom connector in claude.ai. The docs cover [getting started](https://marceltov.github.io/freundebuch/getting-started/), [configuration](https://marceltov.github.io/freundebuch/self-hosting/configuration/), [sign-in with authentik](https://marceltov.github.io/freundebuch/self-hosting/sign-in/) and [privacy](https://marceltov.github.io/freundebuch/using/privacy/).

## Development

```bash
npm ci
npm run dev        # http://localhost:3000, needs the variables above
npm test           # unit tests
npm run test:e2e   # Playwright against `next dev`
```

The docs site is built from `docs/` with Material for MkDocs. Architectural decisions are in `docs/adr`.
