# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

freundebuch: a personal CRM for one household, AI-first (capture happens through the built-in MCP endpoint). Next.js + SQLite, modelled on `notefeed/notefeed`.

## Commands

- `npm run dev` / `npm run build` / `npm start`
- `npm run typecheck` (next typegen + tsc), `npm run lint`, `npm run format` / `npm run format:check` (Prettier, 160 columns); `uvx ruff check` and `uvx ruff format` for `docs_hooks/`
- `npm test` (vitest), `npx vitest run <file>` for one file
- `npm run test:e2e` (Playwright, needs `npx playwright install chromium` once). It runs against `next dev`, not the built app: the e2e sign-in (`FREUNDEBUCH_E2E=1`) is compiled out of production builds. Its server starts from a fresh database and a fresh `.next/dev`; if pages still reload mid-test (`ERR_ABORTED`, "navigation interrupted"), run `rm -rf .next` and retry, and don't run `next typegen` by hand while e2e runs.
- `npm run generate` rewrites `openapi.json` from the route table (`backend/http/api.ts`); commit the result, CI fails on any difference.
- `docker build -t freundebuch .`
- Release: push a tag `vX.Y.Z` on main. CI tags the image (`X.Y.Z`, `X.Y`, `latest`), makes the GitHub release from the merged PRs and posts it to notefeed (secrets `NOTEFEED_FEED`, `NOTEFEED_FEED_PASSWORD`).
- Docs: `uvx --with mkdocs-material==9.7.7 --with 'mkdocs<2' mkdocs serve` (`build --strict` in CI); published to GitHub Pages from `main`.

## Architecture

- Three surfaces call the same domain layer in `backend/`: `/mcp` (`backend/mcp.ts`), `/api/v1` (route table in `backend/http/api.ts`) and the pages in `app/(app)`. Tokens are bound to one surface; an MCP token fails on REST and vice versa. See `docs/internals/how-it-works.md` and `docs/adr/`.
- Privacy is one function: `visible()` in `backend/visibility.ts`. Every read of a table with `visibility`/`recorded_by` goes through it. Privacy tests use the household seed in `backend/testing/fixtures.ts`.
- Migrations live in code (`backend/db/migrations.ts`). Never edit one that has shipped; add the next.
- Next.js is 16.x with breaking changes; check `node_modules/next/dist/docs/` before relying on remembered APIs.

## Rules

- What freundebuch stands for is `docs/values.md`: changes are judged against it, and a review names the point it touches ("this breaks V2").
- The roadmap is data: `docs/roadmap.yml`, rendered as a timeline by `docs_hooks/roadmap.py`. The pull request that finishes or changes a step updates it (`status: done`, a `date`, the PR link).
- AI-native: MCP is the main interface. Every feature works over MCP first (tools, their descriptions, what the briefing returns); the REST API and the web UI follow.
- Code, identifiers, API, tool names/descriptions, logs and docs are English. Every UI string is in `components/copy.ts` (web UI) or `backend/notify/copy.ts` (notifications), in German and English with the same keys; German is the default. Server components read it with `getCopy()` after `pageViewer()`, client components with `useCopy()` (ADR 0021).
- Never commit superpowers artifacts (`.superpowers/`, specs, plans). Architectural decisions go to `docs/adr/NNNN-*.md` (MADR).
- `next dev` writes a "nextjs-agent-rules" block (into `AGENTS.md`). Don't commit it.
- `backend/` is framework-free and the frontend imports it only through `backend/index.ts` (enforced by eslint).
- Env vars are `FREUNDEBUCH_*`, except `PUBLIC_URL`, `DATA_DIR`, `PORT`, `TZ`. Keep `backend/config.ts`, `.env.example`, `compose.yaml` and `docs/self-hosting/configuration.md` in step.
- Private items must never leak to the other user through any read path, including counts and summaries.
