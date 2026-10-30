# Development

```bash
npm ci
npm run dev        # http://localhost:3000, needs the OIDC variables
npm test           # unit tests (vitest)
npm run typecheck
npm run lint
npm run test:e2e   # Playwright against `next dev`; run `npx playwright install chromium` once
```

- `npm run generate` rewrites `openapi.json` from the route table (`backend/http/api.ts`). Commit the result; CI fails on any difference.
- The end-to-end tests sign in through a test-only route that exists only with `FREUNDEBUCH_E2E=1` in `next dev`. It is compiled out of production builds.
- `docker build -t freundebuch .` builds the image.

## Conventions

- Code, API, tool descriptions, logs and these docs are English. Every UI string is in `components/copy.ts` for the web app and `backend/notify/copy.ts` for notifications, in German and English with the same keys (TypeScript checks the English has every German key). Server components read the viewer's with `getCopy()` once `pageViewer()` has run, client components with `useCopy()`; see [ADR 0021](../adr/0021-a-language-per-user.md).
- `backend/` is framework-free; the frontend imports it only through `backend/index.ts`.
- Private items must never reach the other person through any read path, including counts and summaries. Every new read goes through `visible()`.
- Architectural decisions are recorded as ADRs in `docs/adr/` (MADR).

## Docs

This site is built with Material for MkDocs from `docs/` and published to GitHub Pages on every push to `main`. To preview it locally:

```bash
uvx --with mkdocs-material==9.7.7 --with 'mkdocs<2' mkdocs serve
```
