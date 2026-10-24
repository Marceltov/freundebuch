---
status: accepted
date: 2026-10-23
decision-makers: Marcel Bruckner
---

# Sign-in through authentik only, and freundebuch as its own stateless OAuth server

## Context and Problem Statement

Two household members use one freundebuch, each from a browser and each from their own Claude app. Every request has to say who is asking, because privacy (ADR 0002) is enforced from the viewer's identity, never left to Claude. The homelab already has authentik, and its rule is "authentik decides who gets in". The Claude app connects to remote MCP servers only through the OAuth flow of the MCP authorization spec: it discovers an authorization server, registers itself, and sends the user through an authorize page. How do people sign in, and how does a Claude app get a token that names its user?

## Decision Drivers

* One identity per person, the same in the browser and in Claude, so a private item stays with whoever recorded it on every surface.
* No second credential to manage: no instance password, no per-user API keys.
* Who may use the instance is decided in authentik, not in freundebuch's configuration.
* Nothing extra to run or store: one container, one SQLite file.
* notefeed (ADR 0007 there) already solved the OAuth half; port it rather than invent.

## Considered Options

* **authentik as the OAuth server for MCP clients.** Claude would register with authentik and present authentik's tokens to `/mcp`.
* **freundebuch as its own stateless OAuth server, whose authorize step is a sign-in through authentik.** (chosen)
* **An instance password or per-user API keys**, as notefeed allows.

## Decision Outcome

Chosen option: "freundebuch as its own stateless OAuth server, whose authorize step is a sign-in through authentik", because it gives the Claude app exactly the flow it expects, keeps authentik as the only place that decides who gets in, and needs no storage.

* **Sign-in is authentik only (OIDC).** One provider, from `FREUNDEBUCH_OIDC_{ISSUER,CLIENT_ID,CLIENT_SECRET}`. The code flow uses PKCE `S256`, state and nonce; the flight rides in a short-lived signed cookie (`fb_oidc`, path `/api/oidc`). The id_token is checked as notefeed checks it: issuer, audience (and `azp`), expiry, nonce, plus a non-empty `sub`. Its signature is not verified against JWKS: it comes straight from the token endpoint over TLS, which OIDC Core 3.1.3.7 lets stand in for it, and the issuer and its endpoints must be https (plain http only on loopback). `FREUNDEBUCH_OIDC_ALLOW` defaults to `*`: authentik decides. It can still narrow the set to verified addresses or `@domain`s. The first sign-in creates the user and their own person (`userFromOidc`), keyed on `sub`.
* **Sessions.** A successful browser sign-in sets `fb_identity`, a signed `{ uid }` valid for 7 days (`HttpOnly`, `SameSite=Lax`, `Secure` when `PUBLIC_URL` is https). `proxy.ts` sends every page without a valid cookie to `/login`. `viewerFromRequest(req, surface)` knows which surface it guards. On `/mcp` it accepts only an access token (`Authorization: Bearer`) for the resource `${PUBLIC_URL}/mcp`, never the cookie. On the REST API it accepts an access token for `${PUBLIC_URL}/api/v1`, or the cookie: on GET and HEAD always, on other methods only from this instance's own pages (Origin check). So a token works only where its audience says, and an `/api/v1` token is refused on `/mcp` and vice versa. Pages read the cookie through `viewerFromCookie`. Whichever one is used must name a user that still exists.
* **OAuth server.** As in notefeed: RFC 8414 and RFC 9728 metadata, Dynamic Client Registration (RFC 7591), public clients, authorization code with PKCE `S256`, rotating refresh tokens, CORS on the endpoints browser clients call. The authorize page shows the client's self-chosen name and the host it returns to, and offers one button, "Mit authentik anmelden". That sign-in is the consent. The button is a same-origin form POST, so a cross-site link can't get a code issued. The `resource` parameter (RFC 8707) picks the token's audience, `/mcp` (the default) or `/api/v1`, and the token is honoured only on that surface; anything else is `invalid_target`.
* **Nothing is stored.** Client ids, codes, access and refresh tokens, the identity cookie and the flight cookie are all `base64url(payload).base64url(HMAC-SHA256)`. The key is `HMAC(secret, "freundebuch-oauth-v1")`, from `FREUNDEBUCH_SECRET` or the secret generated once into `DATA_DIR`. Each value carries its type, so one kind can't pass as another. Codes last 5 minutes, access tokens 1 hour, and refresh tokens 30 days, but never past the end of the grant that started the chain: 90 days after the sign-in on the authorize page. That is longer than the browser's 7 days on purpose, so a connected Claude app doesn't ask for a sign-in every week; after 90 days it does.
* **Revocation means rotating `FREUNDEBUCH_SECRET`.** That signs out every browser and every connected Claude at once. It is also the only way to end a grant before its 90 days: a lost device's Claude app keeps access until then otherwise. Deleting a user also ends their tokens, because a token for an unknown user gives no viewer.
* **Failed sign-ins are limited per IP**, as in notefeed (60 per minute by default, `FREUNDEBUCH_RATE_LIMIT`), and checked before anything is fetched. `X-Forwarded-*` headers are believed only with `FREUNDEBUCH_TRUST_PROXY=1`.
* **No password path at all.** Nothing reads a password, and there is no open mode: without the OIDC variables nobody can sign in, and the start route logs which ones are missing.

Not done, on purpose: authentik as the MCP authorization server (the Claude app would need a client registered in authentik for every connection, authentik's tokens would not carry freundebuch's user id, and `/mcp` would have to validate a foreign token format); a password or API keys (a second credential that authentik wouldn't govern); scopes; a revocation endpoint; CIMD (it needs fetches of client-chosen URLs).

### Consequences

* Good, because the browser and every Claude app of a person resolve to the same user, so privacy holds the same everywhere.
* Good, because whoever authentik lets in can use freundebuch, and nobody else; there is nothing to configure in freundebuch for a new household member.
* Good, because there is no token table: a restart, or a second instance with the same secret, keeps everyone signed in.
* Bad, because single use of codes and refresh-token rotation rest on an in-memory set of used `jti` values, inherited from notefeed. After a restart, a code or refresh token that was already used can be replayed once within its lifetime (5 minutes, 30 days). Persisting the set in `DATA_DIR` would close that.
* Bad, because tokens can't be revoked one by one. The only revocation is rotating the secret, which signs everyone out. Logout only drops the browser's cookie.
* Bad, because open registration lets anyone mint a client with a name and redirect URIs of their choosing, and send a household member an authorize link that shows that name. The page shows the client's name and its redirect host, and is sent with `frame-ancestors 'none'`. A person who signs in for a client they don't recognize still hands it a code.
* Bad, because the id_token's signature is trusted to TLS, not checked against the provider's keys (as in notefeed). That holds only while the token comes straight from the token endpoint.

### Confirmation

Vitest runs the whole flow in-process: `backend/auth/` (signing, rotating the secret, the cookie and bearer rules per surface, a token refused on the other surface, a user that is gone), `backend/oidc/` (discovery, the id_token checks, the callback creating the user, the failed-attempt limit, the failure logs that never name a person), `backend/oauth/` (registration, authorize checks, code and refresh refusals, resources), and `proxy.test.ts` (which paths need the cookie). A Claude app connecting to the deployed instance is checked by hand.
