import { createHash, randomBytes } from "node:crypto";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { viewerFromRequest } from "../auth/session";
import { TTL, cid, resetTokensForTests, verify } from "../auth/tokens";
import { resetDbForTests } from "../db/testing";
import { logsOf } from "../log";
import { resetSecretForTests } from "../secret";
import type { Viewer } from "../types";
import { userFromOidc } from "../users";
import {
  GRANT_TTL,
  authServerRoute,
  checkAuthorize,
  issueCode,
  metadataPreflight,
  protectedResourceRoute,
  registerPreflight,
  registerRoute,
  tokenRoute,
} from "./routes";

const BASE = "http://localhost:3000";
const RESOURCE = `${BASE}/mcp`;
const API = `${BASE}/api/v1`;
const CB = "https://claude.ai/api/mcp/auth_callback";
const H = { host: "localhost:3000" };
let ann: Viewer;

beforeEach(async () => {
  vi.stubEnv("FREUNDEBUCH_SECRET", "test-secret-".padEnd(32, "x"));
  resetSecretForTests();
  resetTokensForTests();
  await resetDbForTests();
  ann = await userFromOidc({ sub: "ann", name: "Ann" });
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  resetSecretForTests();
});

const pkce = () => {
  const verifier = randomBytes(32).toString("base64url");
  return { verifier, challenge: createHash("sha256").update(verifier).digest("base64url") };
};

const post = (path: string, body: BodyInit, type: string) => new Request(BASE + path, { method: "POST", headers: { ...H, "content-type": type }, body });
const register = (body: unknown) => registerRoute(post("/oauth/register", JSON.stringify(body), "application/json"));
const form = (path: string, fields: Record<string, string>) => post(path, new URLSearchParams(fields), "application/x-www-form-urlencoded");
const token = (fields: Record<string, string>) => tokenRoute(form("/oauth/token", fields));

async function clientId(redirect_uris = [CB]) {
  const res = await register({ client_name: "Claude", redirect_uris });
  expect(res.status).toBe(201);
  return (await res.json()).client_id as string;
}

function authParams(client_id: string, challenge: string, extra: Record<string, string> = {}) {
  return new URLSearchParams({
    response_type: "code",
    client_id,
    redirect_uri: CB,
    code_challenge: challenge,
    code_challenge_method: "S256",
    state: "a b&c",
    resource: RESOURCE,
    ...extra,
  });
}

// Registers, checks the authorize request and issues the code a sign-in would; returns what the token request needs.
async function code(extra: Record<string, string> = {}) {
  const id = await clientId();
  const { verifier, challenge } = pkce();
  const checked = checkAuthorize(authParams(id, challenge, extra), new Headers(H));
  if (checked.kind !== "page") throw new Error(`not a page: ${checked.kind}`);
  const res = issueCode(checked.fields, new Headers(H), ann.userId);
  expect(res.status).toBe(303);
  const loc = new URL(res.headers.get("location")!);
  return { id, verifier, code: loc.searchParams.get("code")!, loc };
}
const exchange = (c: { id: string; verifier: string; code: string }, extra: Record<string, string> = {}) =>
  token({ grant_type: "authorization_code", code: c.code, client_id: c.id, redirect_uri: CB, code_verifier: c.verifier, resource: RESOURCE, ...extra });

// The access token as /mcp (or, for an /api/v1 token, the API) would check it.
const asBearer = (t: string, surface: "mcp" | "api" = "mcp") =>
  viewerFromRequest(new Request(RESOURCE, { method: "POST", headers: { ...H, authorization: `Bearer ${t}` } }), surface);

describe("flow", () => {
  test("register, authorize, sign in, exchange, use the access token", async () => {
    const id = await clientId();
    const { challenge } = pkce();
    expect(checkAuthorize(authParams(id, challenge), new Headers(H))).toMatchObject({ kind: "page", clientName: "Claude", redirectHost: "claude.ai" });

    const c = await code();
    expect(`${c.loc.origin}${c.loc.pathname}`).toBe(CB);
    expect(c.loc.search).toMatch(/^\?code=[^&]+&state=a\+b%26c&iss=http%3A%2F%2Flocalhost%3A3000$/);
    expect(c.loc.searchParams.get("state")).toBe("a b&c");

    const res = await exchange(c);
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const body = await res.json();
    expect(body).toMatchObject({ token_type: "Bearer", expires_in: 3600 });
    expect(Object.keys(body).sort()).toEqual(["access_token", "expires_in", "refresh_token", "token_type"]);
    expect(verify("access", body.access_token)).toMatchObject({ aud: RESOURCE, uid: ann.userId });
    expect(await asBearer(body.access_token)).toEqual(ann);
    expect(await asBearer(body.access_token, "api")).toBeNull();
  });

  test("the resource decides the audience: /api/v1 is accepted, none means /mcp", async () => {
    const api = await code({ resource: API });
    const { access_token } = await (await exchange(api, { resource: API })).json();
    expect(verify("access", access_token)!.aud).toBe(API);
    expect(await asBearer(access_token, "api")).toEqual(ann);
    expect(await asBearer(access_token, "mcp")).toBeNull();

    const id = await clientId();
    const { verifier, challenge } = pkce();
    const p = authParams(id, challenge);
    p.delete("resource");
    const checked = checkAuthorize(p, new Headers(H));
    if (checked.kind !== "page") throw new Error("not a page");
    const plain = new URL(issueCode(checked.fields, new Headers(H), ann.userId).headers.get("location")!).searchParams.get("code")!;
    const res = await token({ grant_type: "authorization_code", code: plain, client_id: id, redirect_uri: CB, code_verifier: verifier });
    expect(verify("access", (await res.json()).access_token)!.aud).toBe(RESOURCE);
  });

  test("refresh rotates; the old refresh token is spent", async () => {
    const c = await code();
    const first = await (await exchange(c)).json();
    const res = await token({ grant_type: "refresh_token", refresh_token: first.refresh_token, client_id: c.id });
    expect(res.status).toBe(200);
    const second = await res.json();
    expect(second.refresh_token).not.toBe(first.refresh_token);
    expect(await asBearer(second.access_token)).toEqual(ann);
    const again = await token({ grant_type: "refresh_token", refresh_token: first.refresh_token, client_id: c.id });
    expect(again.status).toBe(400);
    expect(await again.json()).toEqual({ error: "invalid_grant" });
  });

  test("the code's user and sign-in limit are carried into the tokens and through refresh", async () => {
    const c = await code();
    const until = verify("code", c.code)!.until;
    expect(Math.abs(until - (Math.floor(Date.now() / 1000) + GRANT_TTL))).toBeLessThanOrEqual(1);
    const first = await (await exchange(c)).json();
    expect(verify("access", first.access_token)?.uid).toBe(ann.userId);
    expect(verify("refresh", first.refresh_token)).toMatchObject({ uid: ann.userId, until });
    const second = await (await token({ grant_type: "refresh_token", refresh_token: first.refresh_token, client_id: c.id })).json();
    expect(verify("access", second.access_token)?.uid).toBe(ann.userId);
    expect(verify("refresh", second.refresh_token)).toMatchObject({ uid: ann.userId, until });
  });

  test("the refresh chain outlives the browser's 7 days and ends after 90", async () => {
    expect(GRANT_TTL).toBe(90 * 24 * 3600);
    const c = await code();
    let { refresh_token } = await (await exchange(c)).json();
    const start = Date.now();
    // Refreshed every 29 days (a refresh token itself lasts 30), the chain carries on past the identity cookie's lifetime...
    for (const day of [29, 58, 87]) {
      vi.spyOn(Date, "now").mockReturnValue(start + day * 86400_000);
      const res = await token({ grant_type: "refresh_token", refresh_token, client_id: c.id });
      expect(res.status, `day ${day}`).toBe(200);
      ({ refresh_token } = await res.json());
    }
    expect(TTL.identity).toBeLessThan(29 * 86400);
    // ...until the grant's 90 days are up.
    vi.spyOn(Date, "now").mockReturnValue(start + (GRANT_TTL + 2) * 1000);
    let res = new Response();
    expect(await logsOf(async () => (res = await token({ grant_type: "refresh_token", refresh_token, client_id: c.id })))).toEqual([
      { level: "warn", component: "oauth", msg: "refresh refused", reason: "sign-in past its lifetime" },
    ]);
    expect((await res.json()).error).toBe("invalid_grant");
  });

  test("a refresh token is bound to its client", async () => {
    const c = await code();
    const { refresh_token } = await (await exchange(c)).json();
    const other = await clientId(["https://other.example/cb"]);
    expect((await (await token({ grant_type: "refresh_token", refresh_token, client_id: other })).json()).error).toBe("invalid_grant");
  });
});

describe("token refusals", () => {
  test("wrong code_verifier", async () => {
    const c = await code();
    const res = await exchange({ ...c, verifier: pkce().verifier });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("invalid_grant");
    expect((await exchange(c)).status).toBe(200); // a failed attempt doesn't spend the code
  });
  test("code reused", async () => {
    const c = await code();
    expect((await exchange(c)).status).toBe(200);
    expect((await (await exchange(c)).json()).error).toBe("invalid_grant");
  });
  test("code after 301 s", async () => {
    const c = await code();
    vi.spyOn(Date, "now").mockReturnValue(Date.now() + 301_000);
    expect((await (await exchange(c)).json()).error).toBe("invalid_grant");
  });
  test("redirect_uri differing from the code's", async () => {
    const c = await code();
    expect((await (await exchange(c, { redirect_uri: `${CB}/` })).json()).error).toBe("invalid_grant");
  });
  test("another resource, even the other one we serve", async () => {
    const c = await code();
    expect((await (await exchange(c, { resource: `${BASE}/other` })).json()).error).toBe("invalid_grant");
    expect((await (await exchange(c, { resource: API })).json()).error).toBe("invalid_grant");
  });
  test("another resource on refresh", async () => {
    const c = await code();
    const { refresh_token } = await (await exchange(c)).json();
    expect((await (await token({ grant_type: "refresh_token", refresh_token, client_id: c.id, resource: API })).json()).error).toBe("invalid_grant");
  });
  test("another client's id", async () => {
    const c = await code();
    expect((await (await exchange({ ...c, id: await clientId(["https://other.example/cb"]) })).json()).error).toBe("invalid_grant");
  });
  test("a forged client_id is invalid_client", async () => {
    const c = await code();
    expect((await (await exchange({ ...c, id: "x.y" })).json()).error).toBe("invalid_client");
  });
  test("missing parameters, unknown grant", async () => {
    expect((await (await token({ grant_type: "authorization_code" })).json()).error).toBe("invalid_request");
    expect((await (await token({ grant_type: "password" })).json()).error).toBe("unsupported_grant_type");
    expect((await (await token({})).json()).error).toBe("invalid_request");
  });
});

describe("checkAuthorize", () => {
  test.each([
    [
      "a tampered client_id",
      "unknown_client",
      (p: URLSearchParams) =>
        p.set(
          "client_id",
          p.get("client_id")!.replace(/.$/, (c) => (c === "A" ? "B" : "A")),
        ),
    ],
    ["a redirect_uri with a trailing slash", "bad_redirect_uri", (p: URLSearchParams) => p.set("redirect_uri", `${CB}/`)],
    ["a duplicated redirect_uri", "bad_redirect_uri", (p: URLSearchParams) => p.append("redirect_uri", CB)],
  ])("%s: an error, never a redirect", async (_, reason, change) => {
    const p = authParams(await clientId(), pkce().challenge);
    change(p);
    expect(checkAuthorize(p, new Headers(H))).toEqual({ kind: "error", reason });
  });

  test.each([
    ["code_challenge", "invalid_request"],
    ["code_challenge_method", "invalid_request"],
    ["response_type", "unsupported_response_type"],
  ])("missing %s redirects with %s, state and iss", async (name, error) => {
    const p = authParams(await clientId(), pkce().challenge);
    p.delete(name);
    const r = checkAuthorize(p, new Headers(H));
    expect(r.kind).toBe("redirect");
    const loc = new URL((r as { location: string }).location);
    expect(`${loc.origin}${loc.pathname}`).toBe(CB);
    expect(Object.fromEntries(loc.searchParams)).toEqual({ error, state: "a b&c", iss: BASE });
  });

  test("plain PKCE and a foreign resource redirect with an error", async () => {
    const id = await clientId();
    expect(checkAuthorize(authParams(id, pkce().challenge, { code_challenge_method: "plain" }), new Headers(H)).kind).toBe("redirect");
    for (const resource of ["https://evil.example/mcp", `${BASE}/other`, `${BASE}/mcp/`]) {
      const r = checkAuthorize(authParams(id, pkce().challenge, { resource }), new Headers(H));
      expect(new URL((r as { location: string }).location).searchParams.get("error")).toBe("invalid_target");
    }
  });

  test("fields carry only the OAuth parameters", async () => {
    const r = checkAuthorize(authParams(await clientId(), pkce().challenge, { password: "x", scope: "all" }), new Headers(H));
    expect(Object.keys((r as { fields: Record<string, string> }).fields).sort()).toEqual([
      "client_id",
      "code_challenge",
      "code_challenge_method",
      "redirect_uri",
      "resource",
      "response_type",
      "state",
    ]);
  });

  test("a client without a name is shown by its redirect host", async () => {
    const id = (await (await register({ redirect_uris: [CB] })).json()).client_id;
    expect(checkAuthorize(authParams(id, pkce().challenge), new Headers(H))).toMatchObject({ clientName: "claude.ai", redirectHost: "claude.ai" });
  });
});

describe("register", () => {
  test.each([
    ["no redirect_uris", { redirect_uris: [] }],
    ["http on a public host", { redirect_uris: ["http://example.com/cb"] }],
    ["a fragment", { redirect_uris: ["https://x/cb#f"] }],
    ["six URIs", { redirect_uris: Array.from({ length: 6 }, (_, i) => `https://x/${i}`) }],
    ["a long URI", { redirect_uris: [`https://x/${"a".repeat(503)}`] }],
    ["a long client_name", { client_name: "x".repeat(101), redirect_uris: [CB] }],
    ["a non-string client_name", { client_name: 1, redirect_uris: [CB] }],
    ["a bidi override in client_name", { client_name: "Claude\u202eevil", redirect_uris: [CB] }],
    ["a control character in client_name", { client_name: "a\nb", redirect_uris: [CB] }],
    ["not an object", [CB]],
  ])("%s: 400", async (_, body) => {
    const res = await register(body);
    expect(res.status).toBe(400);
    expect(["invalid_redirect_uri", "invalid_client_metadata"]).toContain((await res.json()).error);
  });

  test("not JSON: 400", async () => {
    expect((await registerRoute(post("/oauth/register", "{", "application/json"))).status).toBe(400);
  });

  test("loopback http is accepted; extra fields are not signed", async () => {
    const res = await register({ redirect_uris: ["http://127.0.0.1:5555/cb", "http://localhost/cb"], scope: "x", client_secret: "s" });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body).toEqual({
      client_id: body.client_id,
      redirect_uris: ["http://127.0.0.1:5555/cb", "http://localhost/cb"],
      token_endpoint_auth_method: "none",
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
    });
    expect(Buffer.from(body.client_id.split(".")[0], "base64url").toString()).not.toContain("scope");
  });
});

test("issueCode sends the browser back with a code carrying the user", async () => {
  const id = await clientId();
  const fields = Object.fromEntries(authParams(id, pkce().challenge));
  const loc = new URL(issueCode(fields, new Headers(H), ann.userId).headers.get("location")!);
  expect(loc.searchParams.get("state")).toBe("a b&c");
  expect(loc.searchParams.get("iss")).toBe(BASE);
  expect(verify("code", loc.searchParams.get("code")!)).toMatchObject({ cid: cid(id), redirect_uri: CB, resource: RESOURCE, uid: ann.userId });
});

test("a rotated secret invalidates access and refresh tokens", async () => {
  const c = await code();
  const { access_token, refresh_token } = await (await exchange(c)).json();
  vi.stubEnv("FREUNDEBUCH_SECRET", "rotated-".padEnd(32, "y"));
  resetSecretForTests();
  expect(await asBearer(access_token)).toBeNull();
  expect((await (await token({ grant_type: "refresh_token", refresh_token, client_id: c.id })).json()).error).toBe("invalid_grant");
});

describe("CORS for browser-based clients", () => {
  const get = (path: string) => new Request(BASE + path, { headers: H });
  test("metadata, register and token answer with Access-Control-Allow-Origin: *", async () => {
    const c = await code();
    for (const res of [
      protectedResourceRoute(get("/.well-known/oauth-protected-resource/mcp")),
      authServerRoute(get("/.well-known/oauth-authorization-server")),
      await register({ redirect_uris: [CB] }),
      await register({ redirect_uris: [] }),
      await exchange(c),
      await token({ grant_type: "nope" }),
    ])
      expect(res.headers.get("access-control-allow-origin")).toBe("*");
  });
  test("preflights", () => {
    for (const [res, method] of [
      [metadataPreflight(), "GET"],
      [registerPreflight(), "POST"],
    ] as const) {
      expect(res.status).toBe(204);
      expect(res.headers.get("access-control-allow-origin")).toBe("*");
      expect(res.headers.get("access-control-allow-methods")).toBe(method);
      expect(res.headers.get("access-control-allow-headers")).toBe("content-type, mcp-protocol-version");
    }
  });
});

test("metadata documents", async () => {
  const get = (path: string) => new Request(BASE + path, { headers: H });
  expect(await protectedResourceRoute(get("/.well-known/oauth-protected-resource/mcp")).json()).toEqual({
    resource: RESOURCE,
    authorization_servers: [BASE],
    bearer_methods_supported: ["header"],
  });
  expect(await authServerRoute(get("/.well-known/oauth-authorization-server")).json()).toEqual({
    issuer: BASE,
    authorization_endpoint: `${BASE}/oauth/authorize`,
    token_endpoint: `${BASE}/oauth/token`,
    registration_endpoint: `${BASE}/oauth/register`,
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    code_challenge_methods_supported: ["S256"],
    token_endpoint_auth_methods_supported: ["none"],
    authorization_response_iss_parameter_supported: true,
  });
});
