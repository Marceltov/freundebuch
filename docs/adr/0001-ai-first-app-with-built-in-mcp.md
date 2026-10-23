---
status: accepted
date: 2026-10-23
decision-makers: Marcel Bruckner
---

# freundebuch is an AI-first app with a built-in MCP endpoint, on Next.js and SQLite

## Context and Problem Statement

Marcel forgets what people told him, and the next time he meets them he feels like a bad friend. He set up Monica to fix that and never used it, because filling in forms is exactly the work he does not do. What he does do is talk: after meeting someone he can ramble about it by voice in the Claude app. The system has to turn that ramble into structured records (who, what was said, what is promised, what is coming up), keep the verbatim transcript, and brief him before the next meeting. Two people share one instance, and some of what is said must stay private to the one who said it.

## Decision Drivers

* Capture is by voice ramble through Claude, not by forms. Nobody types structured data.
* Structured questions ("who is overdue?", "what did I promise Anna?") must be answered reliably, not by searching free text.
* Privacy between the two household members is enforced by the server on every read path, never left to the AI's discretion.
* One small thing to run in the homelab, with one data volume and no extra services.
* The same domain logic serves Claude (MCP), scripts (REST) and the web pages.

## Considered Options

* **Monica plus a sidecar MCP server.** Monica v4 is frozen, has no OpenAPI spec, and v5 never shipped. A sidecar would have to track an undocumented API of a product we cannot influence, and Monica has no per-item visibility between two users.
* **Trilium plus Todoist.** Notes and tasks already exist and Claude can reach both. But structured queries such as "who is overdue" or "what is open between me and Anna" are unreliable over free-text notes, and privacy would be a convention, not a rule.
* **Twenty.** A modern CRM with an API, but it is a sales CRM (companies, deals, pipelines). Bending it to friendships costs more than it saves, and it brings a Postgres, a Redis and a worker.
* **Build our own, AI-first, with the MCP endpoint built in.** (chosen)

## Decision Outcome

Chosen option: "Build our own, AI-first, with the MCP endpoint built in", because it is the only option where the data model fits the job, privacy is a property of the query layer, and Claude talks to the app directly.

* **Capture happens through the built-in MCP endpoint** (`POST /mcp`). There is no sidecar and no ingestion of messages, mail or contacts. People come into existence by being talked about.
* **Stack:** one Next.js app (standalone output, one Docker image) with SQLite (better-sqlite3, kysely) on one volume. Pages, a REST API and the MCP endpoint are thin surfaces over the same domain functions in `backend/`.
* **Reference implementation:** `notefeed/notefeed` (Next.js, official MCP SDK, stateless OAuth server). Its structure, conventions and tests are the model; what freundebuch does not need is left out.
* **Language:** code, API, tool names and docs in English; every UI string in German.
* **Pinned exactly:** `next` (with `eslint-config-next`) and `@modelcontextprotocol/server` are pinned to exact versions, because the app leans on their behaviour (the MCP SDK's handler and schema conversion, Next's standalone output). A pin moves only on purpose: tests, `npm run build` and `npm audit --omit=dev` after every bump. On 2026-10-23 they moved to `next@16.4.3` and `@modelcontextprotocol/server@2.3.1`, which clear the critical Next advisories (image optimizer RCE via SVG, among others) and the high MCP SDK advisories; `images.unoptimized` stays on, since nothing uses next/image and the optimizer is attack surface.

### Consequences

* Good, because capture is one conversation and the records are structured, so briefings and "who is overdue" are queries, not guesses.
* Good, because privacy is enforced from the viewer's identity in the query layer, for every surface.
* Good, because there is one container and one volume to back up.
* Bad, because we maintain a whole app instead of configuring an existing one.
* Bad, because the quality of capture depends on the tool descriptions and on the client's AI asking when a name is ambiguous or a topic sensitive.

### Confirmation

Vitest covers the domain, including a privacy test that runs one fixture through every read function as the other user. The image is built in CI and probed through `GET /health`.
