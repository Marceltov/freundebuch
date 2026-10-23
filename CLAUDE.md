# CLAUDE.md

freundebuch: a personal CRM for one household, AI-first (capture happens through the built-in MCP endpoint). Next.js + SQLite, modelled on `notefeed/notefeed`.

## Commands

- `npm run dev` / `npm run build` / `npm start`
- `npm run typecheck` (next typegen + tsc), `npm run lint`
- `npm test` (vitest), `npx vitest run <file>` for one file; `npm run test:e2e` (Playwright)
- `docker build -t freundebuch .`

## Rules

- Code, identifiers, API, tool names/descriptions, logs and docs are English. Every UI string is German, all in `components/copy.ts`.
- Never commit superpowers artifacts (`.superpowers/`, specs, plans). Architectural decisions go to `docs/adr/NNNN-*.md` (MADR).
- `backend/` is framework-free and the frontend imports it only through `backend/index.ts` (enforced by eslint).
- Env vars are `FREUNDEBUCH_*`, except `PUBLIC_URL`, `DATA_DIR`, `PORT`, `TZ`.
- Private items must never leak to the other user through any read path, including counts and summaries.
