# How it works

freundebuch is one Next.js app with a SQLite database. There is no sidecar: the MCP endpoint, the REST API and the web pages all call the same framework-free domain layer in `backend/`.

```mermaid
flowchart LR
  claude["Claude app<br/>(voice ramble)"] -- "MCP, OAuth token" --> mcp["/mcp"]
  phone["Browser"] -- "cookie" --> pages["Pages"]
  client["Scripts"] -- "OAuth token" --> rest["/api/v1"]
  mcp --> domain["Domain layer<br/>backend/"]
  pages --> domain
  rest --> domain
  domain --> db[("SQLite<br/>/data/freundebuch.db")]
  domain -- "daily" --> hook["Webhook (ntfy)"]
  authentik["authentik"] -. "OIDC sign-in" .- pages
```

The domain returns plain data. Over MCP and in the in-app chat, the tool layer (`backend/tools.ts`) adds `next` to every result: what Claude should do now, worked out from what the call did ([ADR 0010](../adr/0010-tool-results-tell-claude-what-to-do-next.md)).

## Sign-in

- **Pages** use a sign-in cookie set after the authentik (OIDC) sign-in.
- **Claude** connects through freundebuch's own OAuth server: dynamic client registration, PKCE, and the authorize step is that same authentik sign-in.
- Tokens are stateless HMAC-signed values tied to one surface: an MCP token doesn't work on REST, a REST token doesn't work on MCP, and the browser cookie never works on MCP.

## Privacy

Every row a person can see is either shared or recorded by them. That single rule is one function in the query layer, and every read path goes through it, including counts, hints, the graph and notifications. [ADR 0002](../adr/0002-privacy-model.md) explains the details.

## Notifications

A timer in the server process checks once per minute whether it's past `FREUNDEBUCH_NOTIFY_AT`. Then it sends each person their own due list to their webhook. Progress is tracked per person, so one broken webhook doesn't block or repeat anyone else's reminders.

## Design decisions

- [AI-first app with a built-in MCP](../adr/0001-ai-first-app-with-built-in-mcp.md)
- [Privacy model](../adr/0002-privacy-model.md)
- [authentik sign-in and own OAuth server](../adr/0003-authentik-sign-in-and-own-oauth-server.md)
