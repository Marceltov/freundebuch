import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { db, resetDbForTests } from "../db/testing";
import { AuthError } from "../errors";
import { resetSecretForTests } from "../secret";
import { userFromOidc } from "../users";
import type { Viewer } from "../types";
import { IDENTITY_COOKIE, identityOk, logoutRoute, requireViewer, viewerFromRequest } from "./session";
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
const withCookie = (uid: string, extra: Record<string, string> = {}, method = "GET") => req({ cookie: `other=1; ${IDENTITY_COOKIE}=${sign("identity", { uid })}`, ...extra }, method);
const bearer = (token: string) => req({ authorization: `Bearer ${token}` });

describe("viewerFromRequest", () => {
  test("the identity cookie for user A resolves to A's viewer, for B to B's", async () => {
    expect(await viewerFromRequest(withCookie(a.userId))).toEqual(a);
    expect(await viewerFromRequest(withCookie(b.userId))).toEqual(b);
  });

  test("an access token for the MCP or the API resource resolves to its user", async () => {
    expect(await viewerFromRequest(bearer(sign("access", { aud: `${BASE}/mcp`, uid: a.userId })))).toEqual(a);
    expect(await viewerFromRequest(bearer(sign("access", { aud: `${BASE}/api/v1`, uid: b.userId })))).toEqual(b);
    expect(await viewerFromRequest(req({ authorization: `bearer  ${sign("access", { aud: `${BASE}/mcp`, uid: a.userId })}` }))).toEqual(a);
  });

  test("an access token for another resource, or for this one under another public URL, is refused", async () => {
    for (const aud of [`${BASE}/other`, "https://evil.example/mcp", `${BASE}/mcp/`]) expect(await viewerFromRequest(bearer(sign("access", { aud, uid: a.userId })))).toBeNull();
    vi.stubEnv("PUBLIC_URL", "https://freundebuch.example");
    expect(await viewerFromRequest(bearer(sign("access", { aud: `${BASE}/mcp`, uid: a.userId })))).toBeNull();
    expect(await viewerFromRequest(bearer(sign("access", { aud: "https://freundebuch.example/mcp", uid: a.userId })))).toEqual(a);
  });

  test("an access token for a uid whose user row is gone gives null; so does the cookie", async () => {
    const token = sign("access", { aud: `${BASE}/mcp`, uid: a.userId });
    const d = await db();
    await d.deleteFrom("persons").where("created_by", "=", a.userId).execute();
    await d.deleteFrom("users").where("id", "=", a.userId).execute();
    expect(await viewerFromRequest(bearer(token))).toBeNull();
    expect(await viewerFromRequest(withCookie(a.userId))).toBeNull();
    expect(await viewerFromRequest(withCookie("never-existed"))).toBeNull();
  });

  test("a token or cookie signed under another secret is refused", async () => {
    const token = sign("access", { aud: `${BASE}/mcp`, uid: a.userId });
    const cookie = withCookie(a.userId);
    vi.stubEnv("FREUNDEBUCH_SECRET", "z".repeat(40));
    resetSecretForTests();
    expect(await viewerFromRequest(bearer(token))).toBeNull();
    expect(await viewerFromRequest(cookie)).toBeNull();
  });

  test("other kinds of token are refused as a bearer and as the cookie", async () => {
    expect(await viewerFromRequest(bearer(sign("identity", { uid: a.userId })))).toBeNull();
    expect(await viewerFromRequest(bearer(sign("refresh", { cid: "c", aud: `${BASE}/mcp`, jti: "j", uid: a.userId, until: 2e9 })))).toBeNull();
    expect(await viewerFromRequest(req({ cookie: `${IDENTITY_COOKIE}=${sign("access", { aud: `${BASE}/mcp`, uid: a.userId })}` }))).toBeNull();
  });

  test("an Authorization header decides alone: a bad bearer is not rescued by a good cookie", async () => {
    expect(await viewerFromRequest(withCookie(a.userId, { authorization: "Bearer nope" }))).toBeNull();
    expect(await viewerFromRequest(withCookie(a.userId, { authorization: "Basic eA==" }))).toBeNull();
  });

  test("the cookie counts on a POST only from this instance's own pages", async () => {
    expect(await viewerFromRequest(withCookie(a.userId, { origin: BASE }, "POST"))).toEqual(a);
    expect(await viewerFromRequest(withCookie(a.userId, { origin: "https://evil.example" }, "POST"))).toBeNull();
    expect(await viewerFromRequest(withCookie(a.userId, {}, "POST"))).toBeNull();
    expect(await viewerFromRequest(withCookie(a.userId, {}, "HEAD"))).toEqual(a);
  });

  test("nothing at all, or an expired cookie, is no viewer", async () => {
    expect(await viewerFromRequest(req())).toBeNull();
    const old = sign("identity", { uid: a.userId }, Date.now() - 604_801_000);
    expect(await viewerFromRequest(req({ cookie: `${IDENTITY_COOKIE}=${old}` }))).toBeNull();
  });
});

test("requireViewer returns the viewer or throws AuthError", async () => {
  expect(await requireViewer(withCookie(a.userId))).toEqual(a);
  const e = await requireViewer(req()).catch((x) => x);
  expect(e).toBeInstanceOf(AuthError);
  expect(e.code).toBe("unauthorized");
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
