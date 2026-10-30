import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { db, resetDbForTests } from "../db/testing";
import { AuthError } from "../errors";
import { resetSecretForTests } from "../secret";
import { userFromOidc } from "../users";
import type { Viewer } from "../types";
import { IDENTITY_COOKIE, identityOk, logoutRoute, requireViewer, viewerFromCookie, viewerFromRequest } from "./session";
import { sign } from "./tokens";

const BASE = "http://localhost:3000";
const H = { host: "localhost:3000" };
let a: Viewer;
let b: Viewer;

beforeEach(async () => {
  vi.stubEnv("FREUNDEBUCH_SECRET", "s".repeat(40));
  resetSecretForTests();
  await resetDbForTests();
  a = await userFromOidc({ sub: "a", name: "Alice" });
  b = await userFromOidc({ sub: "b", name: "Bob" });
});
afterEach(() => {
  vi.unstubAllEnvs();
  resetSecretForTests();
});

const req = (headers: Record<string, string> = {}, method = "GET") => new Request(`${BASE}/x`, { method, headers: { ...H, ...headers } });
const withCookie = (uid: string, extra: Record<string, string> = {}, method = "GET") =>
  req({ cookie: `other=1; ${IDENTITY_COOKIE}=${sign("identity", { uid })}`, ...extra }, method);
const bearer = (token: string) => req({ authorization: `Bearer ${token}` });

const MCP = `${BASE}/mcp`;
const API = `${BASE}/api/v1`;
const access = (aud: string, uid: string) => sign("access", { aud, uid });

describe("viewerFromRequest", () => {
  test("on the API, the identity cookie for user A resolves to A's viewer, for B to B's", async () => {
    expect(await viewerFromRequest(withCookie(a.userId), "api")).toEqual(a);
    expect(await viewerFromRequest(withCookie(b.userId), "api")).toEqual(b);
  });

  test("each surface takes only the access token for its own resource", async () => {
    expect(await viewerFromRequest(bearer(access(MCP, a.userId)), "mcp")).toEqual(a);
    expect(await viewerFromRequest(bearer(access(API, b.userId)), "api")).toEqual(b);
    expect(await viewerFromRequest(req({ authorization: `bearer  ${access(MCP, a.userId)}` }), "mcp")).toEqual(a);
    expect(await viewerFromRequest(bearer(access(API, a.userId)), "mcp")).toBeNull(); // an /api/v1 token on /mcp
    expect(await viewerFromRequest(bearer(access(MCP, a.userId)), "api")).toBeNull(); // an /mcp token on the API
  });

  test("the identity cookie is refused on /mcp, whatever the method or origin", async () => {
    expect(await viewerFromRequest(withCookie(a.userId), "mcp")).toBeNull();
    expect(await viewerFromRequest(withCookie(a.userId, { origin: BASE }, "POST"), "mcp")).toBeNull();
  });

  test("an access token for another resource, or for this one under another public URL, is refused", async () => {
    for (const surface of ["mcp", "api"] as const)
      for (const aud of [`${BASE}/other`, "https://evil.example/mcp", `${BASE}/mcp/`, `${API}/`])
        expect(await viewerFromRequest(bearer(access(aud, a.userId)), surface)).toBeNull();
    vi.stubEnv("PUBLIC_URL", "https://freundebuch.example");
    expect(await viewerFromRequest(bearer(access(MCP, a.userId)), "mcp")).toBeNull();
    expect(await viewerFromRequest(bearer(access("https://freundebuch.example/mcp", a.userId)), "mcp")).toEqual(a);
  });

  test("an access token for a uid whose user row is gone gives null; so does the cookie", async () => {
    const token = access(MCP, a.userId);
    const d = await db();
    await d.deleteFrom("persons").where("created_by", "=", a.userId).execute();
    await d.deleteFrom("users").where("id", "=", a.userId).execute();
    expect(await viewerFromRequest(bearer(token), "mcp")).toBeNull();
    expect(await viewerFromRequest(withCookie(a.userId), "api")).toBeNull();
    expect(await viewerFromRequest(withCookie("never-existed"), "api")).toBeNull();
  });

  test("a token or cookie signed under another secret is refused", async () => {
    const token = access(MCP, a.userId);
    const cookie = withCookie(a.userId);
    vi.stubEnv("FREUNDEBUCH_SECRET", "z".repeat(40));
    resetSecretForTests();
    expect(await viewerFromRequest(bearer(token), "mcp")).toBeNull();
    expect(await viewerFromRequest(cookie, "api")).toBeNull();
  });

  test("other kinds of token are refused as a bearer and as the cookie", async () => {
    expect(await viewerFromRequest(bearer(sign("identity", { uid: a.userId })), "api")).toBeNull();
    expect(await viewerFromRequest(bearer(sign("refresh", { cid: "c", aud: MCP, jti: "j", uid: a.userId, until: 2e9 })), "mcp")).toBeNull();
    expect(await viewerFromRequest(req({ cookie: `${IDENTITY_COOKIE}=${access(API, a.userId)}` }), "api")).toBeNull();
  });

  test("an Authorization header decides alone: a bad bearer is not rescued by a good cookie", async () => {
    expect(await viewerFromRequest(withCookie(a.userId, { authorization: "Bearer nope" }), "api")).toBeNull();
    expect(await viewerFromRequest(withCookie(a.userId, { authorization: "Basic eA==" }), "api")).toBeNull();
  });

  test("the cookie counts on a POST only from this instance's own pages", async () => {
    expect(await viewerFromRequest(withCookie(a.userId, { origin: BASE }, "POST"), "api")).toEqual(a);
    expect(await viewerFromRequest(withCookie(a.userId, { origin: "https://evil.example" }, "POST"), "api")).toBeNull();
    expect(await viewerFromRequest(withCookie(a.userId, {}, "POST"), "api")).toBeNull();
    expect(await viewerFromRequest(withCookie(a.userId, {}, "HEAD"), "api")).toEqual(a);
  });

  test("nothing at all, or an expired cookie, is no viewer", async () => {
    expect(await viewerFromRequest(req(), "api")).toBeNull();
    expect(await viewerFromRequest(req(), "mcp")).toBeNull();
    const old = sign("identity", { uid: a.userId }, Date.now() - 604_801_000);
    expect(await viewerFromRequest(req({ cookie: `${IDENTITY_COOKIE}=${old}` }), "api")).toBeNull();
  });
});

test("requireViewer returns the viewer or throws AuthError", async () => {
  expect(await requireViewer(withCookie(a.userId), "api")).toEqual(a);
  expect(await requireViewer(bearer(access(MCP, a.userId)), "mcp")).toEqual(a);
  for (const [r, surface] of [
    [req(), "api"],
    [withCookie(a.userId), "mcp"],
  ] as const) {
    const e = await requireViewer(r, surface).catch((x) => x);
    expect(e).toBeInstanceOf(AuthError);
    expect(e.code).toBe("unauthorized");
  }
});

test("viewerFromCookie: the cookie's value as pages read it, for a user that still exists", async () => {
  expect(await viewerFromCookie(sign("identity", { uid: a.userId }))).toEqual(a);
  expect(await viewerFromCookie(sign("identity", { uid: "never-existed" }))).toBeNull();
  expect(await viewerFromCookie(access(API, a.userId))).toBeNull();
  expect(await viewerFromCookie("x.y")).toBeNull();
  expect(await viewerFromCookie(undefined)).toBeNull();
});

test("identityOk checks the cookie's signature and expiry only", () => {
  expect(identityOk(sign("identity", { uid: "anyone" }))).toBe(true);
  expect(identityOk(undefined)).toBe(false);
  expect(identityOk("x.y")).toBe(false);
  expect(identityOk(sign("access", { aud: `${BASE}/mcp`, uid: "u" }))).toBe(false);
});

test("logout clears the identity cookie and goes to /login", () => {
  const res = logoutRoute();
  expect(res.status).toBe(303);
  expect(res.headers.get("location")).toBe("/login");
  expect(res.headers.getSetCookie()).toEqual([`${IDENTITY_COOKIE}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax`]);
});
