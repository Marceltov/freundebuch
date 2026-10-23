import { NextRequest } from "next/server";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { IDENTITY_COOKIE } from "@/backend";
import { sign } from "@/backend/auth/tokens";
import { resetSecretForTests } from "@/backend/secret";
import { config, proxy } from "./proxy";

beforeEach(() => {
  vi.stubEnv("FREUNDEBUCH_SECRET", "a".repeat(40));
  resetSecretForTests();
});
afterEach(() => {
  vi.unstubAllEnvs();
  resetSecretForTests();
});

const req = (path: string, init: { method?: string; headers?: Record<string, string> } = {}) =>
  new NextRequest(`http://localhost:3000${path}`, { method: init.method, headers: { host: "localhost:3000", ...init.headers } });
const isNext = (res: Response) => res.headers.get("x-middleware-next") === "1";

test("pages without the identity cookie redirect to the absolute public /login", () => {
  const res = proxy(req("/p/x"));
  expect(res.status).toBe(307);
  expect(res.headers.get("location")).toBe("http://localhost:3000/login?next=%2Fp%2Fx");
});

test("the redirect keeps the query in next, and / needs none", () => {
  expect(proxy(req("/p/x?a=1")).headers.get("location")).toBe("http://localhost:3000/login?next=%2Fp%2Fx%3Fa%3D1");
  expect(proxy(req("/")).headers.get("location")).toBe("http://localhost:3000/login");
});

test("a signed identity cookie passes; a forged, expired or other-secret one does not", () => {
  const cookie = (v: string) => ({ headers: { cookie: `${IDENTITY_COOKIE}=${v}` } });
  expect(isNext(proxy(req("/p/x", cookie(sign("identity", { uid: "u" })))))).toBe(true);
  expect(isNext(proxy(req("/p/x", cookie("x.y"))))).toBe(false);
  expect(isNext(proxy(req("/p/x", cookie(sign("identity", { uid: "u" }, Date.now() - 604_801_000)))))).toBe(false);
  expect(isNext(proxy(req("/p/x", cookie(sign("access", { aud: "http://localhost:3000/mcp", uid: "u" })))))).toBe(false);
  const signed = sign("identity", { uid: "u" });
  vi.stubEnv("FREUNDEBUCH_SECRET", "b".repeat(40));
  resetSecretForTests();
  expect(isNext(proxy(req("/p/x", cookie(signed))))).toBe(false);
});

test.each([
  "/login",
  "/logout",
  "/health",
  "/mcp",
  "/api/v1/people",
  "/api/oidc/start",
  "/api/oidc/callback?code=x",
  "/oauth/authorize?x=1",
  "/oauth/token",
  "/oauth/register",
  "/.well-known/oauth-authorization-server",
  "/.well-known/oauth-protected-resource/mcp",
  "/_next/static/x.js",
  "/favicon.ico",
  "/icon.svg",
  "/apple-icon.png",
  "/manifest.webmanifest",
])("%s is not sent to /login", (p) => {
  expect(isNext(proxy(req(p)))).toBe(true);
  expect(isNext(proxy(req(p, { method: "POST" })))).toBe(true);
});

test.each(["/loginx", "/login/x", "/mcpx", "/healthz", "/apix", "/oauthx", "/p/x", "/einstellungen", "/c/1"])("%s needs the cookie", (p) => {
  expect(proxy(req(p)).status).toBe(307);
});

// Next's proxy runtime rejects a relative Location ("Invalid URL" → 500), so it must be absolute
// and point at the public address, not the internal one.
test("redirects to the public /login behind a trusted reverse proxy", () => {
  vi.stubEnv("FREUNDEBUCH_TRUST_PROXY", "1");
  const res = proxy(new NextRequest("http://internal:3000/p/x", { headers: { "x-forwarded-proto": "https", "x-forwarded-host": "fb.example" } }));
  expect(res.status).toBe(307);
  expect(res.headers.get("location")).toBe("https://fb.example/login?next=%2Fp%2Fx");
});

test("X-Forwarded-* is ignored without FREUNDEBUCH_TRUST_PROXY", () => {
  const res = proxy(new NextRequest("http://internal:3000/p/x", { headers: { host: "internal:3000", "x-forwarded-proto": "https", "x-forwarded-host": "evil.example" } }));
  expect(res.headers.get("location")).toBe("http://internal:3000/login?next=%2Fp%2Fx");
});

test("PUBLIC_URL wins for the redirect", () => {
  vi.stubEnv("PUBLIC_URL", "https://freundebuch.example.com");
  const res = proxy(new NextRequest("http://internal:3000/", { headers: { host: "internal:3000" } }));
  expect(res.headers.get("location")).toBe("https://freundebuch.example.com/login");
});

test("matcher skips /_next/ and the favicon", () => {
  const re = new RegExp(`^${config.matcher}$`);
  for (const p of ["/_next/static/x.js", "/favicon.ico"]) expect(re.test(p)).toBe(false);
  for (const p of ["/", "/p/x", "/login", "/nextthing"]) expect(re.test(p)).toBe(true);
});
