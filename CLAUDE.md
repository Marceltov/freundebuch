# CLAUDE.md

freundebuch: a personal CRM for one household, AI-first (capture happens through the built-in MCP endpoint). Next.js + SQLite, modelled on `notefeed/notefeed`.

## Commands

- `npm run dev` / `npm run build` / `npm start`
- `npm run typecheck` (next typegen + tsc), `npm run lint`
- `npm test` (vitest), `npx vitest run <file>` for one file
- `npm run test:e2e` (Playwright, needs `npx playwright install chromium` once). It runs against `next dev`, not the built app: the e2e sign-in (`FREUNDEBUCH_E2E=1`) is compiled out of production builds.
- `npm run generate` rewrites `openapi.json` from the route table (`backend/http/api.ts`); commit the result, CI fails on any difference.
- `docker build -t freundebuch .`

## Rules

- Code, identifiers, API, tool names/descriptions, logs and docs are English. Every UI string is German: `components/copy.ts` for the web UI, `backend/notify/copy.ts` for the notifications.
- Never commit superpowers artifacts (`.superpowers/`, specs, plans). Architectural decisions go to `docs/adr/NNNN-*.md` (MADR).
- `next dev` appends a "nextjs-agent-rules" block to this file. Don't commit it.
- `backend/` is framework-free and the frontend imports it only through `backend/index.ts` (enforced by eslint).
- Env vars are `FREUNDEBUCH_*`, except `PUBLIC_URL`, `DATA_DIR`, `PORT`, `TZ`. Keep `backend/config.ts`, `.env.example`, `compose.yaml` and the README table in step.
- Private items must never leak to the other user through any read path, including counts and summaries.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
