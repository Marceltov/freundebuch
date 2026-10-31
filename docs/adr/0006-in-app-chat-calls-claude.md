---
status: accepted
date: 2026-10-25
decision-makers: Marcel Bruckner
---

# The in-app chat calls Claude from the server, with an API key

## Context and Problem Statement

ADR 0001 made freundebuch AI-first with the AI in the client: Claude, connected over MCP, does the understanding, and the server never calls a model. In practice the user is often already in the web app when something comes up worth filing, and wants to tell it there instead of switching to the Claude app. The same text field should answer questions about people. Both household members use it.

## Considered Options

* **A separate service running the Claude Agent SDK, logged in with a Claude Pro plan,** which the web app sends text to. Anthropic's terms don't allow a Claude.ai login to power a product other people use.
* **The server calls the Claude API with an API key, with the MCP tools, as the signed-in user.** (chosen)
* **Keep the web app read-only and send the user to the Claude app.** No cost, but the friction the user wants gone.

## Decision Outcome

Chosen option: "The server calls the Claude API with an API key", because it is the supported way and needs no extra service.

* `FREUNDEBUCH_ANTHROPIC_API_KEY` turns the chat on; without it the app shows none. The model is settable (`FREUNDEBUCH_ANTHROPIC_MODEL`, default Claude Sonnet 5.5).
* The tools live in one table (`backend/mcp/tools.ts`) that MCP and the chat share, with the MCP instructions, so the chat behaves like Claude over MCP: ask before filing anything sensitive as shared, resolve every person, read back what was filed.
* Every tool call runs as the signed-in user, through the same domain functions; nothing about people goes into the prompt except through tools. Privacy (ADR 0002) holds unchanged.
* `POST /api/chat` takes only the web app's cookie; scripts and Claude keep REST and MCP.
* The conversation lives on the device and arrives whole with each message; the server stores only what the tools file.
* Cost guards: at most 8 tool rounds per message and a daily message limit per user (`FREUNDEBUCH_CHAT_DAILY_LIMIT`, default 100).

### Consequences

* Good, because filing and asking work without leaving the app, for both users, with one key.
* Bad, because the instance owner pays per message, and the server now sends people's data to the Claude API when the chat is used, as the Claude app already does over MCP.
