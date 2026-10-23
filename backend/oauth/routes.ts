// freundebuch as its own OAuth 2.1 authorization server for /mcp (and /api/v1): metadata (RFC 9728, RFC 8414), dynamic
// client registration (RFC 7591), the authorize step, which is a sign-in through authentik (oidc/routes.ts), and the token
// endpoint (authorization code with PKCE S256, rotating refresh tokens). Everything is a signed token (../auth/tokens), so
// there is nothing to store (ADR 0003).
import { createHash } from "node:crypto";
import { cid, newJti, sign, spendOnce, TTL, verify } from "../auth/tokens";
import { parseForm, readCapped, seeOther } from "../http/request";
import { logger } from "../log";
import { mcpResource, publicUrl, resources } from "../urls";

const log = logger("oauth");

// Browser-based MCP clients call the metadata, register and token endpoints cross-origin. None of them
// reads a cookie, so any origin may.
const cors = { "Access-Control-Allow-Origin": "*" };
const noStore = { ...cors, "Cache-Control": "no-store" };
const oauthError = (error: string, status = 400) => Response.json({ error }, { status, headers: noStore });

// OPTIONS for the metadata documents and /oauth/register. /oauth/token takes a plain form POST, which needs no preflight.
const preflight = (method: string) => (): Response =>
  new Response(null, { status: 204, headers: { ...cors, "Access-Control-Allow-Methods": method, "Access-Control-Allow-Headers": "content-type, mcp-protocol-version" } });
export const metadataPreflight = preflight("GET");
export const registerPreflight = preflight("POST");

export function protectedResourceRoute(req: Request): Response {
  const body = { resource: mcpResource(req.headers), authorization_servers: [publicUrl(req.headers)], bearer_methods_supported: ["header"] };
  return Response.json(body, { headers: cors });
}

export function authServerRoute(req: Request): Response {
  const base = publicUrl(req.headers);
  return Response.json(
    {
      issuer: base,
      authorization_endpoint: `${base}/oauth/authorize`,
      token_endpoint: `${base}/oauth/token`,
      registration_endpoint: `${base}/oauth/register`,
      response_types_supported: ["code"],
      grant_types_supported: ["authorization_code", "refresh_token"],
      code_challenge_methods_supported: ["S256"],
      token_endpoint_auth_methods_supported: ["none"],
      authorization_response_iss_parameter_supported: true,
    },
    { headers: cors },
  );
}

// https anywhere, plain http only on loopback (native and CLI clients). No fragment, even an empty one.
// Also the rule for the OIDC provider's issuer and endpoints (oidc/flow.ts).
export function redirectUriOk(u: unknown): u is string {
  if (typeof u !== "string" || u.length > 512 || u.includes("#") || !URL.canParse(u)) return false;
  const { protocol, hostname } = new URL(u);
  return protocol === "https:" || (protocol === "http:" && (hostname === "localhost" || hostname === "127.0.0.1"));
}

export async function registerRoute(req: Request): Promise<Response> {
  const bytes = await readCapped(req, 16 * 1024);
  let body: { client_name?: unknown; redirect_uris?: unknown } | null = null;
  try {
    if (bytes) body = JSON.parse(new TextDecoder().decode(bytes));
  } catch {}
  if (!body || typeof body !== "object" || Array.isArray(body)) return oauthError("invalid_client_metadata");
  const { client_name, redirect_uris } = body;
  if (!Array.isArray(redirect_uris) || redirect_uris.length < 1 || redirect_uris.length > 5 || !redirect_uris.every(redirectUriOk))
    return oauthError("invalid_redirect_uri");
  // The name is shown on the authorize page: no control or format characters (a bidi override could disguise it).
  if (client_name !== undefined && (typeof client_name !== "string" || client_name.length > 100 || /[\p{Cc}\p{Cf}]/u.test(client_name)))
    return oauthError("invalid_client_metadata");
  // Only these two fields are signed into the client_id; anything else the client sent is dropped.
  const client = client_name === undefined ? { redirect_uris } : { client_name, redirect_uris };
  const client_id = sign("client", client);
  return Response.json(
    { client_id, ...client, token_endpoint_auth_method: "none", grant_types: ["authorization_code", "refresh_token"], response_types: ["code"] },
    { status: 201, headers: noStore },
  );
}

// `reason` is for the page to word (in German); nothing here is shown as it is.
export type Checked =
  | { kind: "page"; clientName: string; redirectHost: string; fields: Record<string, string> }
  | { kind: "redirect"; location: string }
  | { kind: "error"; reason: "unknown_client" | "bad_redirect_uri" };

const CHALLENGE_RE = /^[A-Za-z0-9_-]{43}$/; // base64url of a SHA-256

// The authorize request, for the page (GET) and the sign-in's POST alike. Until client_id and redirect_uri
// check out, nothing redirects: an unchecked redirect_uri would make this an open redirector.
export function checkAuthorize(params: URLSearchParams, h: Headers): Checked {
  // A repeated parameter counts as missing (RFC 6749 3.1).
  const one = (k: string) => {
    const v = params.getAll(k);
    return v.length === 1 ? v[0] : undefined;
  };
  const clientId = one("client_id") ?? "";
  const client = verify("client", clientId);
  if (!client) return { kind: "error", reason: "unknown_client" };
  const redirectUri = one("redirect_uri");
  if (redirectUri === undefined || !client.redirect_uris.includes(redirectUri)) return { kind: "error", reason: "bad_redirect_uri" };

  const state = one("state");
  const fail = (error: string) => {
    const to = new URL(redirectUri);
    to.searchParams.set("error", error);
    if (state !== undefined) to.searchParams.set("state", state);
    to.searchParams.set("iss", publicUrl(h));
    return { kind: "redirect" as const, location: to.href };
  };
  if (one("response_type") !== "code") return fail("unsupported_response_type");
  const challenge = one("code_challenge");
  if (one("code_challenge_method") !== "S256" || challenge === undefined || !CHALLENGE_RE.test(challenge)) return fail("invalid_request");
  // RFC 8707: the MCP endpoint or the REST API; none means the MCP endpoint.
  const resource = one("resource");
  if (params.has("resource") && (resource === undefined || !resources(h).includes(resource))) return fail("invalid_target");

  // Exactly the parameters the POST needs back, never whatever else the URL carried.
  const fields: Record<string, string> = { response_type: "code", client_id: clientId, redirect_uri: redirectUri, code_challenge: challenge, code_challenge_method: "S256" };
  if (state !== undefined) fields.state = state;
  if (resource !== undefined) fields.resource = resource;
  return { kind: "page", clientName: client.client_name || new URL(redirectUri).host, redirectHost: new URL(redirectUri).host, fields };
}

/**
 * How long one OAuth grant (a connected Claude app or API client) lasts: its refresh chain ends this long after the sign-in, so a
 * connector doesn't need a weekly sign-in like the browser's identity cookie (7 days). Revoking one means rotating FREUNDEBUCH_SECRET.
 */
export const GRANT_TTL = 90 * 24 * 3600;

// Back to the client with a code, after the sign-in of user `uid`. `fields` must come from checkAuthorize, never from a request.
export function issueCode(fields: Record<string, string>, h: Headers, uid: string): Response {
  const code = sign("code", {
    cid: cid(fields.client_id),
    redirect_uri: fields.redirect_uri,
    code_challenge: fields.code_challenge,
    resource: fields.resource ?? mcpResource(h),
    jti: newJti(),
    uid,
    until: Math.floor(Date.now() / 1000) + GRANT_TTL,
  });
  const to = new URL(fields.redirect_uri);
  to.searchParams.set("code", code);
  if (fields.state !== undefined) to.searchParams.set("state", fields.state);
  to.searchParams.set("iss", publicUrl(h));
  return seeOther(to.href);
}

// The user goes from the code into both tokens, and from each refresh token into the next; the grant's `until` goes into
// each refresh token, so the chain ends GRANT_TTL after the sign-in that started it.
function issue(clientHash: string, aud: string, uid: string, until: number): Response {
  return Response.json(
    { access_token: sign("access", { aud, uid }), token_type: "Bearer", expires_in: TTL.access, refresh_token: sign("refresh", { cid: clientHash, aud, jti: newJti(), uid, until }) },
    { headers: noStore },
  );
}

const refusedRefresh = (reason: string) => {
  log.warn({ reason }, "refresh refused");
  return oauthError("invalid_grant");
};

// POST /oauth/token. Every check runs before the code or refresh token is spent, so a failed attempt
// (a wrong verifier from someone who intercepted the code) can't burn the legitimate client's grant.
export async function tokenRoute(req: Request): Promise<Response> {
  const bytes = await readCapped(req, 16 * 1024);
  const form = bytes ? await parseForm(bytes, req.headers).catch(() => null) : null;
  const get = (k: string) => {
    const v = form?.getAll(k) ?? [];
    return v.length === 1 && typeof v[0] === "string" ? v[0] : undefined;
  };
  const grant = get("grant_type");
  const clientId = get("client_id");
  const resource = get("resource");

  if (grant === "authorization_code") {
    const [code, redirectUri, verifier] = [get("code"), get("redirect_uri"), get("code_verifier")];
    if (!code || !clientId || !redirectUri || !verifier) return oauthError("invalid_request");
    const c = verify("code", code);
    if (!c) return oauthError("invalid_grant");
    if (!verify("client", clientId)) return oauthError("invalid_client");
    if (c.cid !== cid(clientId) || c.redirect_uri !== redirectUri) return oauthError("invalid_grant");
    if (createHash("sha256").update(verifier).digest("base64url") !== c.code_challenge) return oauthError("invalid_grant");
    if (resource !== undefined && resource !== c.resource) return oauthError("invalid_grant");
    if (!spendOnce(c.jti, c.exp!)) return oauthError("invalid_grant");
    return issue(c.cid, c.resource, c.uid, c.until);
  }

  if (grant === "refresh_token") {
    const refresh = get("refresh_token");
    if (!refresh || !clientId) return oauthError("invalid_request");
    // The grant first: after a rotated secret both fail, and invalid_grant tells the client to sign in again.
    const r = verify("refresh", refresh);
    if (!r) return oauthError("invalid_grant");
    if (!verify("client", clientId)) return oauthError("invalid_client");
    if (r.cid !== cid(clientId)) return oauthError("invalid_grant");
    if (resource !== undefined && resource !== r.aud) return oauthError("invalid_grant");
    if (!(Date.now() <= r.until * 1000)) return refusedRefresh("sign-in past its lifetime");
    if (!spendOnce(r.jti, r.exp!)) return oauthError("invalid_grant");
    return issue(r.cid, r.aud, r.uid, r.until);
  }

  return oauthError(grant === undefined ? "invalid_request" : "unsupported_grant_type");
}
