import { createHash } from "node:crypto";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { IDENTITY_COOKIE, viewerFromRequest } from "../auth/session";
import { resetTokensForTests, sign, verify } from "../auth/tokens";
import { db, resetDbForTests } from "../db/testing";
import { resetRateLimitsForTests } from "../limits";
import { logTo } from "../log";
import { registerRoute } from "../oauth/routes";
import { resetSecretForTests } from "../secret";
import { resetDiscoveryForTests } from "./flow";
import { oidcCallbackRoute, oidcStartRoute } from "./routes";

const BASE = "http://localhost:3000";
const H = { host: "localhost:3000" };
const ISS = "https://idp.example";
const META = { issuer: ISS, authorization_endpoint: `${ISS}/authorize`, token_endpoint: `${ISS}/token` };
const CB = "https://claude.ai/api/mcp/auth_callback";
const CHALLENGE = "a".repeat(43);

// The stub issuer signs whoever `person` names into an id_token carrying the nonce of the last start.
let person: Record<string, unknown>;
let lastNonce = "";
const b64 = (v: unknown) => Buffer.from(JSON.stringify(v)).toString("base64url");
const stubImpl: typeof fetch = async (url) => {
  if (String(url) === `${ISS}/.well-known/openid-configuration`) return Response.json(META);
  if (String(url) === META.token_endpoint) {
    const claims = { iss: ISS, aud: "id", exp: Math.floor(Date.now() / 1000) + 300, nonce: lastNonce, ...person };
    return Response.json({ id_token: `${b64({ alg: "RS256" })}.${b64(claims)}.c2ln` });
  }
  return new Response("not found", { status: 404 });
};
const fetchStub = vi.fn<typeof fetch>(stubImpl);

beforeEach(async () => {
  vi.stubEnv("FREUNDEBUCH_SECRET", "test-secret-".padEnd(32, "x"));
  vi.stubEnv("FREUNDEBUCH_OIDC_ISSUER", ISS);
  vi.stubEnv("FREUNDEBUCH_OIDC_CLIENT_ID", "id");
  vi.stubEnv("FREUNDEBUCH_OIDC_CLIENT_SECRET", "client-secret");
  vi.stubEnv("FREUNDEBUCH_OIDC_ALLOW", "");
  vi.stubGlobal("fetch", fetchStub);
  fetchStub.mockClear();
  person = { sub: "ann-sub", name: "Ann", email: "ann@x.com", email_verified: true };
  resetSecretForTests();
  await resetDbForTests();
  resetRateLimitsForTests();
  resetTokensForTests();
  resetDiscoveryForTests();
  lines = [];
  restore = logTo((l) => void lines.push(l));
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  resetSecretForTests();
  restore();
});
// Log lines are captured (logTo) and read back by logged() as `oidc: <reason> key=value ...`, the warn lines only.
let lines: string[];
let restore: () => void;
const entries = () => lines.map((l) => JSON.parse(l) as Record<string, unknown>);
const logged = () =>
  entries()
    .filter((e) => e.level === "warn")
    .map(({ component, msg, ...d }) => `${component}: ${msg}${Object.entries(d).flatMap(([k, v]) => (k === "level" || k === "time" ? [] : [` ${k}=${JSON.stringify(v)}`])).join("")}`);
// From here on, every log write throws.
const breakLog = () => {
  restore();
  restore = logTo(() => {
    throw new Error("log down");
  });
};

const get = (path: string, cookie?: string) => new Request(BASE + path, { headers: { ...H, ...(cookie ? { cookie } : {}) } });
const setCookie = (res: Response, name: string) => res.headers.getSetCookie().find((c) => c.startsWith(`${name}=`));
const valueOf = (c: string | undefined) => c?.slice(c.indexOf("=") + 1).split(";")[0];

// A string is the web GET's query; fields are the MCP authorize page's POST (from `origin`).
const postStart = (fields: Record<string, string>, origin: string | null = BASE) =>
  oidcStartRoute(
    new Request(`${BASE}/api/oidc/start`, {
      method: "POST",
      headers: { ...H, "content-type": "application/x-www-form-urlencoded", ...(origin ? { origin } : {}) },
      body: new URLSearchParams(fields),
    }),
  );
async function start(query: string | Record<string, string> = "next=/p/x") {
  const res = await (typeof query === "string" ? oidcStartRoute(get(`/api/oidc/start?${query}`)) : postStart(query));
  const cookie = valueOf(setCookie(res, "fb_oidc"))!;
  const loc = res.headers.get("location") ? new URL(res.headers.get("location")!, BASE) : null;
  if (loc) lastNonce = loc.searchParams.get("nonce") ?? "";
  return { res, loc, cookie, state: loc?.searchParams.get("state") ?? "" };
}
// A registered client's checked authorize fields.
async function mcpFields(extra: Record<string, string> = {}): Promise<Record<string, string>> {
  const reg = await registerRoute(new Request(`${BASE}/oauth/register`, { method: "POST", headers: { ...H, "content-type": "application/json" }, body: JSON.stringify({ redirect_uris: [CB] }) }));
  const client_id = (await reg.json()).client_id;
  return { response_type: "code", client_id, redirect_uri: CB, code_challenge: CHALLENGE, code_challenge_method: "S256", ...extra };
}
const callback = (query: string, cookie?: string) => oidcCallbackRoute(get(`/api/oidc/callback?${query}`, cookie && `fb_oidc=${cookie}`));
const failed = (res: Response) => {
  expect(res.status).toBe(303);
  expect(res.headers.get("location")).toMatch(/^\/login\?error=sign_in_failed/);
  expect(setCookie(res, IDENTITY_COOKIE)).toBeUndefined();
  expect(setCookie(res, "fb_oidc")).toMatch(/^fb_oidc=; Path=\/api\/oidc; Max-Age=0; HttpOnly; SameSite=Lax/);
};
const users = async () => (await db()).selectFrom("users").select(["id", "oidc_sub", "name", "email"]).execute();

describe("not configured", () => {
  test("start goes back to the login page, naming the missing variables in the log; nothing is fetched", async () => {
    vi.stubEnv("FREUNDEBUCH_OIDC_CLIENT_SECRET", "");
    const res = await oidcStartRoute(get("/api/oidc/start?next=/p/x"));
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe("/login?error=sign_in_failed&next=%2Fp%2Fx");
    expect(res.headers.getSetCookie()).toEqual([]);
    expect(logged()).toEqual(['oidc: sign-in is not configured missing="FREUNDEBUCH_OIDC_CLIENT_SECRET"']);
    expect(fetchStub).not.toHaveBeenCalled();
  });

  test("a callback signs nobody in and counts as a failure", async () => {
    vi.stubEnv("FREUNDEBUCH_RATE_LIMIT", "1");
    const s = await start("");
    vi.stubEnv("FREUNDEBUCH_OIDC_ISSUER", "");
    fetchStub.mockClear();
    failed(await callback(`code=c&state=${s.state}`, s.cookie));
    expect(fetchStub).not.toHaveBeenCalled();
    vi.stubEnv("FREUNDEBUCH_OIDC_ISSUER", ISS);
    expect((await callback(`code=c&state=${s.state}`, s.cookie)).headers.get("location")).toMatch(/^\/login\?error=too_many_attempts/);
  });
});

describe("start", () => {
  test("redirects to the provider with PKCE S256, state and nonce, all kept in a signed cookie", async () => {
    const { res, loc, cookie, state } = await start();
    expect(res.status).toBe(303);
    expect(loc!.origin + loc!.pathname).toBe(META.authorization_endpoint);
    const flight = verify("oidc", cookie)!;
    expect(flight).toMatchObject({ state, nonce: lastNonce, next: "/p/x" });
    expect(flight.authorize).toBeUndefined();
    expect(state).toMatch(/^[\w-]{22,}$/);
    expect(lastNonce).toMatch(/^[\w-]{22,}$/);
    expect(loc!.searchParams.get("client_id")).toBe("id");
    expect(loc!.searchParams.get("code_challenge_method")).toBe("S256");
    expect(loc!.searchParams.get("code_challenge")).toBe(createHash("sha256").update(flight.verifier).digest("base64url"));
    expect(loc!.searchParams.get("redirect_uri")).toBe(`${BASE}/api/oidc/callback`);
    expect(setCookie(res, "fb_oidc")).toMatch(/; Path=\/api\/oidc; Max-Age=600; HttpOnly; SameSite=Lax$/);
  });

  test("a fresh state and nonce each time", async () => {
    const [a, b] = [await start(), await start()];
    expect(a.state).not.toBe(b.state);
    expect(verify("oidc", a.cookie)!.nonce).not.toBe(verify("oidc", b.cookie)!.nonce);
  });

  test("the cookie is Secure when the public URL is https, and the redirect URI uses it", async () => {
    vi.stubEnv("PUBLIC_URL", "https://fb.example");
    const { res, loc } = await start();
    expect(setCookie(res, "fb_oidc")).toMatch(/; Secure$/);
    expect(loc!.searchParams.get("redirect_uri")).toBe("https://fb.example/api/oidc/callback");
  });

  test.each(["next=//evil.example", "next=https://evil.example", "next=/\\evil.example", ""])("%j keeps next at /", async (q) => {
    expect(verify("oidc", (await start(q)).cookie)!.next).toBe("/");
  });

  test("a same-origin MCP POST keeps only the checked fields and goes to the provider", async () => {
    const fields = await mcpFields({ state: "s1" });
    const { res, loc, cookie } = await start({ ...fields, extra: "x", next: "/p/x" });
    expect(res.status).toBe(303);
    expect(loc!.origin + loc!.pathname).toBe(META.authorization_endpoint);
    expect(verify("oidc", cookie)!.authorize).toEqual(fields);
  });

  const refused = (res: Response, status: number) => {
    expect(res.status).toBe(status);
    expect(res.headers.get("location")).toBeNull();
    expect(setCookie(res, "fb_oidc")).toBeUndefined();
    expect(fetchStub).not.toHaveBeenCalled();
  };

  test.each([["another site", "https://evil.example"], ["no Origin", null]])("an MCP POST from %s never reaches the provider", async (_, origin) => {
    refused(await postStart(await mcpFields(), origin), 403);
  });

  test("a GET carrying MCP authorize fields is refused, even valid ones", async () => {
    refused(await oidcStartRoute(get(`/api/oidc/start?${new URLSearchParams(await mcpFields())}`)), 400);
    for (const k of ["client_id", "redirect_uri", "code_challenge", "response_type", "state"]) refused(await oidcStartRoute(get(`/api/oidc/start?${k}=x`)), 400);
  });

  test("an MCP POST that doesn't check out never reaches the provider", async () => {
    refused(await postStart({ client_id: "forged", redirect_uri: CB }), 400);
    refused(await postStart({}), 400);
  });

  test("an unreachable provider is a plain error", async () => {
    fetchStub.mockImplementationOnce(async () => Promise.reject(new TypeError("fetch failed")));
    const res = await oidcStartRoute(get("/api/oidc/start"));
    expect(res.headers.get("location")).toBe("/login?error=sign_in_failed");
  });
});

describe("callback", () => {
  test("creates the user, signs them in and returns to next; the flight cookie is cleared", async () => {
    const s = await start("next=/p/x?y=1");
    const res = await callback(`code=c&state=${s.state}`, s.cookie);
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe("/p/x?y=1");
    const id = setCookie(res, IDENTITY_COOKIE)!;
    expect(id).toMatch(/^fb_identity=[^;]+; Path=\/; Max-Age=604800; HttpOnly; SameSite=Lax$/);
    const [user] = await users();
    expect(user).toMatchObject({ oidc_sub: "ann-sub", name: "Ann", email: "ann@x.com" });
    expect(verify("identity", valueOf(id)!)).toMatchObject({ uid: user.id });
    expect((await viewerFromRequest(get("/", `fb_identity=${valueOf(id)}`)))?.userId).toBe(user.id);
    expect(setCookie(res, "fb_oidc")).toMatch(/^fb_oidc=; Path=\/api\/oidc; Max-Age=0/);
    const body = new URLSearchParams(String(fetchStub.mock.calls.find(([u]) => String(u) === META.token_endpoint)![1]!.body));
    expect(body.get("code")).toBe("c");
    expect(body.get("code_verifier")).toBe(verify("oidc", s.cookie)!.verifier);
  });

  test("a second sign-in of the same sub is the same user", async () => {
    let s = await start("");
    await callback(`code=c&state=${s.state}`, s.cookie);
    person = { ...person, name: "Ann B." };
    s = await start("");
    const res = await callback(`code=c&state=${s.state}`, s.cookie);
    const all = await users();
    expect(all).toHaveLength(1);
    expect(all[0].name).toBe("Ann B.");
    expect(verify("identity", valueOf(setCookie(res, IDENTITY_COOKIE))!)!.uid).toBe(all[0].id);
  });

  test("the identity cookie is Secure on https", async () => {
    vi.stubEnv("PUBLIC_URL", "https://fb.example");
    const s = await start();
    const res = await callback(`code=c&state=${s.state}`, s.cookie);
    expect(setCookie(res, IDENTITY_COOKIE)).toMatch(/; Secure$/);
    expect(setCookie(res, "fb_oidc")).toMatch(/; Secure$/);
  });

  test("an MCP sign-in goes back to the client with a code carrying the user", async () => {
    const s = await start(await mcpFields({ state: "s1" }));
    const res = await callback(`code=c&state=${s.state}`, s.cookie);
    const loc = new URL(res.headers.get("location")!);
    expect(loc.origin + loc.pathname).toBe(CB);
    expect(loc.searchParams.get("state")).toBe("s1");
    const [user] = await users();
    expect(verify("code", loc.searchParams.get("code")!)!.uid).toBe(user.id);
    expect(setCookie(res, IDENTITY_COOKIE)).toBeUndefined();
    expect(setCookie(res, "fb_oidc")).toMatch(/Max-Age=0/);
    expect(entries().map(({ component, msg }) => ({ component, msg }))).toEqual([
      { component: "oidc", msg: "sign-in succeeded" },
      { component: "oauth", msg: "authorization granted" },
    ]);
  });

  test("a failed MCP sign-in goes back to the authorize page", async () => {
    const fields = await mcpFields();
    const s = await start(fields);
    const res = await callback(`error=access_denied&state=${s.state}`, s.cookie);
    expect(res.headers.get("location")).toBe(`/oauth/authorize?${new URLSearchParams(fields)}&error=sign_in_failed`);
  });

  test("a failed web sign-in keeps next", async () => {
    const s = await start("next=/p/x");
    const res = await callback(`code=c&state=wrong`, s.cookie);
    expect(res.headers.get("location")).toBe("/login?error=sign_in_failed&next=%2Fp%2Fx");
  });

  test.each([
    ["a wrong state", (s: { state: string; cookie: string }) => callback(`code=c&state=${s.state}x`, s.cookie)],
    ["no state", (s: { state: string; cookie: string }) => callback(`code=c`, s.cookie)],
    ["no code", (s: { state: string; cookie: string }) => callback(`state=${s.state}`, s.cookie)],
    ["no cookie", (s: { state: string; cookie: string }) => callback(`code=c&state=${s.state}`)],
    ["a forged cookie", (s: { state: string; cookie: string }) => callback(`code=c&state=${s.state}`, `${s.cookie}x`)],
    ["an error from the provider", (s: { state: string; cookie: string }) => callback(`error=access_denied&state=${s.state}`, s.cookie)],
  ])("%s signs nobody in", async (_, call) => {
    failed(await call(await start("")));
    expect(await users()).toEqual([]);
  });

  test("an expired flight cookie signs nobody in", async () => {
    const cookie = sign("oidc", { state: "st", nonce: "no", verifier: "v", next: "/" }, Date.now() - 601_000);
    failed(await callback("code=c&state=st", cookie));
  });

  test("someone off a configured allow-list is refused, and no user is created", async () => {
    vi.stubEnv("FREUNDEBUCH_OIDC_ALLOW", "ann@x.com");
    person = { sub: "bob-sub", name: "Bob", email: "bob@x.com", email_verified: true };
    const s = await start("");
    failed(await callback(`code=c&state=${s.state}`, s.cookie));
    expect(await users()).toEqual([]);
  });

  test("failed callbacks count toward the failed-attempt limit", async () => {
    vi.stubEnv("FREUNDEBUCH_RATE_LIMIT", "2");
    const s = await start("");
    for (let i = 0; i < 2; i++) failed(await callback(`code=c&state=wrong`, s.cookie));
    fetchStub.mockClear();
    const res = await callback(`code=c&state=${s.state}`, s.cookie);
    expect(res.headers.get("location")).toMatch(/^\/login\?error=too_many_attempts&retry=\d+/);
    expect(setCookie(res, IDENTITY_COOKIE)).toBeUndefined();
    expect(setCookie(res, "fb_oidc")).toMatch(/Max-Age=0/);
    expect(fetchStub).not.toHaveBeenCalled();
  });
});

describe("failure logs", () => {
  test.each([
    ["a wrong state", (s: { state: string; cookie: string }) => callback(`code=the-code&state=${s.state}x`, s.cookie), "oidc: state mismatch or missing sign-in cookie"],
    ["no cookie", (s: { state: string; cookie: string }) => callback(`code=the-code&state=${s.state}`), "oidc: state mismatch or missing sign-in cookie"],
    ["no code", (s: { state: string; cookie: string }) => callback(`state=${s.state}`, s.cookie), "oidc: no code in the callback"],
    ["a denial", (s: { state: string; cookie: string }) => callback(`error=access_denied&error_description=ann%40x.com+said+no&state=${s.state}`, s.cookie), 'oidc: provider denied the sign-in error="access_denied"'],
    ["a denial whose error isn't a short code", (s: { state: string; cookie: string }) => callback(`error=no%0Aoidc%3A+forged&state=${s.state}`, s.cookie), "oidc: provider denied the sign-in"],
    [
      "someone off the allow-list",
      (s: { state: string; cookie: string }) => (vi.stubEnv("FREUNDEBUCH_OIDC_ALLOW", "x@y.z"), (person = { sub: "bob-sub", name: "Bob", email: "bob@x.com", email_verified: true }), callback(`code=the-code&state=${s.state}`, s.cookie)),
      "oidc: person not on the allow-list",
    ],
  ])("%s logs one line saying why, and the browser sees only the plain failure", async (_, call, line) => {
    const s = await start("");
    failed(await call(s));
    expect(logged()).toEqual([line]);
    for (const secret of ["client-secret", "the-code", s.state, s.cookie, lastNonce, "ann@x.com", "bob@x.com", "Bob", "bob-sub"]) expect(lines.join("\n")).not.toContain(secret);
  });

  test("an unreachable provider at the start is logged", async () => {
    fetchStub.mockImplementationOnce(async () => Promise.reject(Object.assign(new TypeError("fetch failed"), { cause: { code: "ENOTFOUND" } })));
    expect((await oidcStartRoute(get("/api/oidc/start"))).headers.get("location")).toBe("/login?error=sign_in_failed");
    expect(logged()).toEqual(['oidc: discovery failed error="ENOTFOUND"']);
  });

  test("a discovery issuer that can't be turned into a string still gives the plain failure", async () => {
    fetchStub.mockImplementation(async () => Response.json({ ...META, issuer: { toString: 1 } }));
    vi.stubEnv("FREUNDEBUCH_RATE_LIMIT", "1");
    try {
      expect((await oidcStartRoute(get("/api/oidc/start"))).headers.get("location")).toBe("/login?error=sign_in_failed");
      const cookie = sign("oidc", { state: "st", nonce: "no", verifier: "v", next: "/" });
      failed(await callback("code=c&state=st", cookie));
      expect((await callback("code=c&state=st", cookie)).headers.get("location")).toMatch(/^\/login\?error=too_many_attempts/);
    } finally {
      fetchStub.mockReset();
      fetchStub.mockImplementation(stubImpl);
    }
  });

  test("a log output that throws changes nothing the browser sees, and the failure still counts", async () => {
    breakLog();
    vi.stubEnv("FREUNDEBUCH_RATE_LIMIT", "1");
    const s = await start("");
    failed(await callback(`code=c&state=${s.state}x`, s.cookie));
    expect((await callback(`code=c&state=${s.state}`, s.cookie)).headers.get("location")).toMatch(/^\/login\?error=too_many_attempts/);
    resetDiscoveryForTests();
    fetchStub.mockImplementationOnce(async () => Promise.reject(new TypeError("fetch failed")));
    expect((await oidcStartRoute(get("/api/oidc/start"))).headers.get("location")).toBe("/login?error=sign_in_failed");
  });

  test("a sign-in that works logs one info line, never who signed in", async () => {
    const s = await start("");
    expect(setCookie(await callback(`code=c&state=${s.state}`, s.cookie), IDENTITY_COOKIE)).toBeDefined();
    expect(entries()).toEqual([{ level: "info", time: expect.any(String), component: "oidc", msg: "sign-in succeeded" }]);
    for (const s of ["Ann", "ann@x.com", "ann-sub"]) expect(lines.join("\n")).not.toContain(s);
  });
});
