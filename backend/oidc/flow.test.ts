import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { AuthError } from "../errors";
import { logTo } from "../log";
import type { Provider } from "./config";
import { authorizeUrl, discover, exchange, resetDiscoveryForTests } from "./flow";

const ISS = "https://idp.example/app";
const META = { issuer: ISS, authorization_endpoint: "https://idp.example/authorize", token_endpoint: "https://idp.example/token" };
const NOW = 1_800_000_000_000;
const P = { code: "the-code", redirectUri: "https://fb.example/api/oidc/callback", verifier: "the-verifier", nonce: "the-nonce" };
const PROV: Provider = { issuer: ISS, clientId: "id", clientSecret: "client-secret", allow: ["ann@x.com"] };
const at = (issuer: string) => ({ ...PROV, issuer });
const GOOD = { iss: ISS, aud: "id", sub: "u-1", exp: NOW / 1000 + 300, nonce: "the-nonce", name: " Ann ", email: "ann@x.com", email_verified: true };
const ANN = { sub: "u-1", name: "Ann", email: "ann@x.com" };

const b64 = (v: unknown) => Buffer.from(JSON.stringify(v)).toString("base64url");
const jwt = (claims: unknown) => `${b64({ alg: "RS256" })}.${b64(claims)}.c2ln`;

// A stub issuer: the discovery document and a token endpoint answering with `claims` in the id_token.
function issuer(o: { doc?: unknown; claims?: unknown; tokenStatus?: number } = {}) {
  return vi.fn<typeof fetch>(async (url) => {
    if (String(url) === `${ISS}/.well-known/openid-configuration`) return Response.json(o.doc ?? META);
    if (String(url) === META.token_endpoint) {
      if (o.tokenStatus && o.tokenStatus !== 200) return Response.json({ error: "invalid_grant" }, { status: o.tokenStatus });
      return Response.json({ access_token: "at", token_type: "Bearer", id_token: jwt(o.claims ?? GOOD) });
    }
    return new Response("not found", { status: 404 });
  });
}

// Log lines are captured (logTo) and read back by logged() as `oidc: <reason> key=value ...`, the warn lines only.
let lines: string[];
let restore: () => void;
const entries = () => lines.map((l) => JSON.parse(l) as Record<string, unknown>);
const logged = () =>
  entries()
    .filter((e) => e.level === "warn")
    .map(
      ({ component, msg, ...d }) =>
        `${component}: ${msg}${Object.entries(d)
          .flatMap(([k, v]) => (k === "level" || k === "time" ? [] : [` ${k}=${JSON.stringify(v)}`]))
          .join("")}`,
    );
// From here on, every log write throws.
const breakLog = () => {
  restore();
  restore = logTo(() => {
    throw new Error("log down");
  });
};
beforeEach(() => {
  resetDiscoveryForTests();
  lines = [];
  restore = logTo((l) => void lines.push(l));
});
afterEach(() => restore());

describe("discover", () => {
  test("reads the issuer's openid-configuration", async () => {
    const f = issuer();
    expect(await discover(PROV, f)).toEqual(META);
    expect(f).toHaveBeenCalledWith(`${ISS}/.well-known/openid-configuration`, expect.anything());
  });

  test("a trailing slash on the issuer is not doubled", async () => {
    const f = issuer({ doc: { ...META, issuer: `${ISS}/` } });
    await discover(at(`${ISS}/`), f);
    expect(f).toHaveBeenCalledWith(`${ISS}/.well-known/openid-configuration`, expect.anything());
  });

  test("is cached for an hour", async () => {
    const f = issuer();
    await discover(PROV, f, NOW);
    await discover(PROV, f, NOW + 3599_000);
    expect(f).toHaveBeenCalledTimes(1);
    await discover(PROV, f, NOW + 3601_000);
    expect(f).toHaveBeenCalledTimes(2);
    resetDiscoveryForTests();
    await discover(PROV, f, NOW + 3601_000);
    expect(f).toHaveBeenCalledTimes(3);
  });

  test("a changed issuer is discovered afresh", async () => {
    const B = "https://other.example";
    const metaB = { issuer: B, authorization_endpoint: `${B}/authorize`, token_endpoint: `${B}/token` };
    const f = vi.fn<typeof fetch>(async (url) => Response.json(String(url).startsWith(B) ? metaB : META));
    expect(await discover(PROV, f, NOW)).toEqual(META);
    expect(await discover(at(B), f, NOW)).toEqual(metaB);
    expect(f).toHaveBeenCalledTimes(2);
  });

  test.each([
    ["an issuer mismatch", { ...META, issuer: "https://evil.example" }],
    ["an issuer on another host", { ...META, issuer: "https://other.example/app" }],
    ["an issuer with another path", { ...META, issuer: `${ISS}/x` }],
    ["an issuer with another scheme", { ...META, issuer: "http://idp.example/app" }],
    ["an issuer with two trailing slashes", { ...META, issuer: `${ISS}//` }],
    ["no token endpoint", { ...META, token_endpoint: undefined }],
    ["an endpoint that isn't a URL", { ...META, authorization_endpoint: "nope" }],
    ["not an object", "x"],
  ])("refuses %s", async (_, doc) => {
    await expect(discover(PROV, issuer({ doc }))).rejects.toBeInstanceOf(AuthError);
  });

  test.each([
    ["without a slash, the document with one", ISS, `${ISS}/`],
    ["with a slash, the document without one", `${ISS}/`, ISS],
  ])("the issuer configured %s matches", async (_, configured, inDoc) => {
    const f = issuer({ doc: { ...META, issuer: inDoc } });
    const meta = await discover(at(configured), f);
    expect(f).toHaveBeenCalledWith(`${ISS}/.well-known/openid-configuration`, expect.anything());
    for (const iss of [ISS, `${ISS}/`]) expect(await exchange(at(configured), meta, P, issuer({ claims: { ...GOOD, iss } }), NOW)).toEqual(ANN);
  });

  test("a plain http issuer is refused before anything is fetched", async () => {
    const f = issuer();
    await expect(discover(at("http://idp.example/app"), f)).rejects.toBeInstanceOf(AuthError);
    expect(f).not.toHaveBeenCalled();
  });

  test.each(["token_endpoint", "authorization_endpoint"])("a plain http %s is refused", async (k) => {
    await expect(discover(PROV, issuer({ doc: { ...META, [k]: "http://idp.example/x" } }))).rejects.toBeInstanceOf(AuthError);
  });

  test("plain http is fine on loopback", async () => {
    const local = {
      issuer: "http://localhost:9000/app",
      authorization_endpoint: "http://localhost:9000/authorize",
      token_endpoint: "http://127.0.0.1:9000/token",
    };
    const f = vi.fn<typeof fetch>(async () => Response.json(local));
    expect(await discover(at(local.issuer), f)).toEqual(local);
    expect(f).toHaveBeenCalledWith("http://localhost:9000/app/.well-known/openid-configuration", expect.anything());
  });

  test("an unreachable provider or a non-200 refuses", async () => {
    await expect(
      discover(
        PROV,
        vi.fn(async () => Promise.reject(new TypeError("fetch failed"))),
      ),
    ).rejects.toBeInstanceOf(AuthError);
    await expect(
      discover(
        PROV,
        vi.fn(async () => new Response("down", { status: 503 })),
      ),
    ).rejects.toBeInstanceOf(AuthError);
    await expect(
      discover(
        PROV,
        vi.fn(async () => new Response("<html>")),
      ),
    ).rejects.toBeInstanceOf(AuthError);
  });
});

test("authorizeUrl asks for a code with PKCE S256, state and nonce", () => {
  const u = new URL(authorizeUrl(PROV, META, { redirectUri: P.redirectUri, state: "st", nonce: "no", challenge: "ch" }));
  expect(u.origin + u.pathname).toBe(META.authorization_endpoint);
  expect(Object.fromEntries(u.searchParams)).toEqual({
    response_type: "code",
    client_id: "id",
    redirect_uri: P.redirectUri,
    scope: "openid profile email",
    state: "st",
    nonce: "no",
    code_challenge: "ch",
    code_challenge_method: "S256",
  });
});

describe("exchange", () => {
  test("posts the code with the client secret and verifier, and returns sub, name and email", async () => {
    const f = issuer();
    expect(await exchange(PROV, META, P, f, NOW)).toEqual(ANN);
    const [url, init] = f.mock.calls[0];
    expect(url).toBe(META.token_endpoint);
    expect(init?.method).toBe("POST");
    expect(Object.fromEntries(new URLSearchParams(String(init?.body)))).toEqual({
      grant_type: "authorization_code",
      code: "the-code",
      redirect_uri: P.redirectUri,
      code_verifier: "the-verifier",
      client_id: "id",
      client_secret: "client-secret",
    });
  });

  test("the name falls back to preferred_username, then the email", async () => {
    expect(await exchange(PROV, META, P, issuer({ claims: { ...GOOD, name: undefined, preferred_username: "ann" } }), NOW)).toEqual({ ...ANN, name: "ann" });
    expect(await exchange(PROV, META, P, issuer({ claims: { ...GOOD, name: undefined } }), NOW)).toEqual({ ...ANN, name: "ann@x.com" });
  });

  test("no email claim: none is returned", async () => {
    expect(await exchange({ ...PROV, allow: ["*"] }, META, P, issuer({ claims: { ...GOOD, email: undefined, email_verified: undefined } }), NOW)).toEqual({
      sub: "u-1",
      name: "Ann",
    });
  });

  test("aud may be an array holding the client id; with several entries azp must be the client id", async () => {
    expect(await exchange(PROV, META, P, issuer({ claims: { ...GOOD, aud: ["id"] } }), NOW)).toEqual(ANN);
    expect(await exchange(PROV, META, P, issuer({ claims: { ...GOOD, aud: ["id", "other"], azp: "id" } }), NOW)).toEqual(ANN);
  });

  test("anyone on a * list, even without an email", async () => {
    expect((await exchange({ ...PROV, allow: ["*"] }, META, P, issuer({ claims: { ...GOOD, email: "bob@y.com", email_verified: false } }), NOW)).sub).toBe(
      "u-1",
    );
  });

  test.each([
    ["wrong iss", { ...GOOD, iss: "https://evil.example" }],
    ["iss on another host", { ...GOOD, iss: "https://other.example/app" }],
    ["iss with another path", { ...GOOD, iss: `${ISS}/x` }],
    ["iss with another scheme", { ...GOOD, iss: "http://idp.example/app" }],
    ["iss with two trailing slashes", { ...GOOD, iss: `${ISS}//` }],
    ["wrong aud", { ...GOOD, aud: "other" }],
    ["aud array without the client id", { ...GOOD, aud: ["other"] }],
    ["several audiences and no azp", { ...GOOD, aud: ["id", "other"] }],
    ["several audiences and another azp", { ...GOOD, aud: ["id", "other"], azp: "other" }],
    ["azp of another client", { ...GOOD, azp: "other" }],
    ["expired", { ...GOOD, exp: NOW / 1000 - 1 }],
    ["no exp", { ...GOOD, exp: undefined }],
    ["wrong nonce", { ...GOOD, nonce: "other" }],
    ["no nonce", { ...GOOD, nonce: undefined }],
    ["no sub", { ...GOOD, sub: undefined }],
    ["an empty sub", { ...GOOD, sub: "" }],
    ["a sub that isn't a string", { ...GOOD, sub: 5 }],
    ["email not verified", { ...GOOD, email_verified: false }],
    ["email_verified as a string", { ...GOOD, email_verified: "true" }],
    ["off the allow-list", { ...GOOD, email: "bob@x.com" }],
    ["no name, username or email", { ...GOOD, name: undefined, email: undefined }],
    ["a name that isn't a string", { ...GOOD, name: 5, email: undefined }],
    ["a payload that isn't an object", "x"],
  ])("refuses %s", async (_, claims) => {
    const prov = _.startsWith("no name") || _ === "a name that isn't a string" ? { ...PROV, allow: ["*"] } : PROV;
    await expect(exchange(prov, META, P, issuer({ claims }), NOW)).rejects.toBeInstanceOf(AuthError);
  });

  test("a token endpoint error, a missing or malformed id_token refuses", async () => {
    await expect(exchange(PROV, META, P, issuer({ tokenStatus: 400 }), NOW)).rejects.toBeInstanceOf(AuthError);
    for (const body of [{}, { id_token: 5 }, { id_token: "a.b" }, { id_token: "a.!!.c" }])
      await expect(
        exchange(
          PROV,
          META,
          P,
          vi.fn(async () => Response.json(body)),
          NOW,
        ),
      ).rejects.toBeInstanceOf(AuthError);
    await expect(
      exchange(
        PROV,
        META,
        P,
        vi.fn(async () => Promise.reject(new TypeError("fetch failed"))),
        NOW,
      ),
    ).rejects.toBeInstanceOf(AuthError);
  });
});

describe("failure logs", () => {
  const netError = (code?: string) => vi.fn(async () => Promise.reject(Object.assign(new TypeError("fetch failed"), code ? { cause: { code } } : {})));
  test.each<[string, () => Promise<unknown>, string]>([
    ["a plain http issuer", () => discover(at("http://idp.example/app"), issuer()), `oidc: issuer is not an https URL issuer="http://idp.example/app"`],
    ["an unknown host", () => discover(PROV, netError("ENOTFOUND")), `oidc: discovery failed error="ENOTFOUND"`],
    ["a network error without a code", () => discover(PROV, netError()), `oidc: discovery failed error="TypeError"`],
    [
      "a non-200 discovery",
      () =>
        discover(
          PROV,
          vi.fn(async () => new Response("down", { status: 503 })),
        ),
      `oidc: discovery failed status=503`,
    ],
    [
      "a discovery document that isn't JSON",
      () =>
        discover(
          PROV,
          vi.fn(async () => new Response("<html>")),
        ),
      `oidc: discovery failed status=200 error="not a JSON object"`,
    ],
    [
      "another issuer in the document",
      () => discover(PROV, issuer({ doc: { ...META, issuer: "https://evil.example" } })),
      `oidc: issuer does not match the discovery document issuer="${ISS}" document="https://evil.example"`,
    ],
    [
      "a plain http token endpoint",
      () => discover(PROV, issuer({ doc: { ...META, token_endpoint: "http://idp.example/token" } })),
      `oidc: discovery endpoint is not https endpoint="token_endpoint"`,
    ],
    [
      "a missing authorize endpoint",
      () => discover(PROV, issuer({ doc: { ...META, authorization_endpoint: undefined } })),
      `oidc: discovery endpoint is not https endpoint="authorization_endpoint"`,
    ],
    [
      "a token request refused",
      () => exchange(PROV, META, P, issuer({ tokenStatus: 400 }), NOW),
      `oidc: token request rejected status=400 error="invalid_grant"`,
    ],
    ["a token request unreachable", () => exchange(PROV, META, P, netError("ECONNREFUSED"), NOW), `oidc: token request rejected error="ECONNREFUSED"`],
    [
      "no id_token",
      () =>
        exchange(
          PROV,
          META,
          P,
          vi.fn(async () => Response.json({ access_token: "at" })),
          NOW,
        ),
      `oidc: token response has no id_token`,
    ],
    [
      "a malformed id_token",
      () =>
        exchange(
          PROV,
          META,
          P,
          vi.fn(async () => Response.json({ id_token: "a.b" })),
          NOW,
        ),
      `oidc: id_token invalid check="malformed"`,
    ],
    ["an id_token payload that isn't an object", () => exchange(PROV, META, P, issuer({ claims: "x" }), NOW), `oidc: id_token invalid check="malformed"`],
    ["a wrong iss", () => exchange(PROV, META, P, issuer({ claims: { ...GOOD, iss: "https://evil.example" } }), NOW), `oidc: id_token invalid check="iss"`],
    ["a wrong aud", () => exchange(PROV, META, P, issuer({ claims: { ...GOOD, aud: "other" } }), NOW), `oidc: id_token invalid check="aud"`],
    [
      "several audiences and no azp",
      () => exchange(PROV, META, P, issuer({ claims: { ...GOOD, aud: ["id", "other"] } }), NOW),
      `oidc: id_token invalid check="azp"`,
    ],
    ["an expired id_token", () => exchange(PROV, META, P, issuer({ claims: { ...GOOD, exp: NOW / 1000 - 1 } }), NOW), `oidc: id_token invalid check="exp"`],
    ["a wrong nonce", () => exchange(PROV, META, P, issuer({ claims: { ...GOOD, nonce: "other" } }), NOW), `oidc: id_token invalid check="nonce"`],
    ["no sub", () => exchange(PROV, META, P, issuer({ claims: { ...GOOD, sub: undefined } }), NOW), `oidc: id_token invalid check="sub"`],
    [
      "someone off the allow-list",
      () => exchange(PROV, META, P, issuer({ claims: { ...GOOD, email: "bob@x.com", name: "Bob" } }), NOW),
      `oidc: person not on the allow-list`,
    ],
    [
      "an unverified address",
      () => exchange(PROV, META, P, issuer({ claims: { ...GOOD, email_verified: false } }), NOW),
      `oidc: address needs a verified email`,
    ],
    ["no address", () => exchange(PROV, META, P, issuer({ claims: { ...GOOD, email: undefined } }), NOW), `oidc: address needs a verified email`],
    [
      "no name claim",
      () => exchange({ ...PROV, allow: ["*"] }, META, P, issuer({ claims: { ...GOOD, name: undefined, email: undefined } }), NOW),
      `oidc: no name claim in the id_token`,
    ],
  ])("%s logs one line saying why", async (_, run, line) => {
    await expect(run()).rejects.toBeInstanceOf(AuthError);
    expect(logged()).toEqual([line]);
  });

  test("the token endpoint's error_description and an error that isn't a short code are left out", async () => {
    const answer = (body: unknown) => vi.fn(async () => Response.json(body, { status: 401 }));
    await expect(
      exchange(PROV, META, P, answer({ error: "invalid_client", error_description: "client-secret is wrong for ann@x.com" }), NOW),
    ).rejects.toBeInstanceOf(AuthError);
    await expect(exchange(PROV, META, P, answer({ error: "bad client\noidc: forged" }), NOW)).rejects.toBeInstanceOf(AuthError);
    expect(logged()).toEqual([`oidc: token request rejected status=401 error="invalid_client"`, `oidc: token request rejected status=401`]);
  });

  test("a document issuer that can't be turned into a string is refused like any mismatch", async () => {
    await expect(discover(PROV, issuer({ doc: { ...META, issuer: { toString: 1 } } }))).rejects.toBeInstanceOf(AuthError);
    expect(logged()).toEqual([`oidc: issuer does not match the discovery document issuer="${ISS}" document="object"`]);
  });

  test("a log output that throws changes nothing", async () => {
    breakLog();
    await expect(discover(PROV, issuer({ doc: { ...META, issuer: "https://evil.example" } }))).rejects.toBeInstanceOf(AuthError);
    await expect(exchange(PROV, META, P, issuer({ tokenStatus: 400 }), NOW)).rejects.toBeInstanceOf(AuthError);
  });

  test("an issuer is logged without userinfo, query or fragment", async () => {
    const bad = "http://user:pass@idp.example/x?token=abc#frag";
    await expect(discover(at(bad), issuer())).rejects.toBeInstanceOf(AuthError);
    await expect(
      discover(
        at("https://user:pass@idp.example/app?token=abc"),
        vi.fn(async () => Response.json({ ...META, issuer: "https://u:pass@other.example/y?token=abc" })),
      ),
    ).rejects.toBeInstanceOf(AuthError);
    await expect(discover(at("not a url"), issuer())).rejects.toBeInstanceOf(AuthError);
    expect(logged()).toEqual([
      `oidc: issuer is not an https URL issuer="http://idp.example/x"`,
      `oidc: issuer does not match the discovery document issuer="https://idp.example/app" document="https://other.example/y"`,
      `oidc: issuer is not an https URL issuer="(not a URL)"`,
    ]);
    for (const s of ["pass", "token=abc", "frag"]) expect(lines.join("\n")).not.toContain(s);
  });

  test("a sign-in that works logs nothing", async () => {
    const f = issuer();
    expect(await exchange(PROV, await discover(PROV, f), P, f, NOW)).toEqual(ANN);
    expect(lines).toEqual([]);
  });

  test("no secret, code, verifier, nonce, sub, address or name ever reaches the log", async () => {
    const claims = [
      { ...GOOD, email: "bob@x.com", name: "Bob" },
      { ...GOOD, email_verified: false },
      { ...GOOD, nonce: "other" },
      { ...GOOD, iss: "https://evil.example" },
    ];
    for (const c of claims) await exchange(PROV, META, P, issuer({ claims: c }), NOW).catch(() => {});
    await exchange({ ...PROV, allow: ["*"] }, META, P, issuer({ claims: { ...GOOD, name: undefined, email: undefined } }), NOW).catch(() => {});
    await exchange(PROV, META, P, issuer({ tokenStatus: 400 }), NOW).catch(() => {});
    const all = lines.join("\n");
    expect(logged()).toHaveLength(6);
    for (const s of ["client-secret", "the-code", "the-verifier", "the-nonce", "u-1", "ann@x.com", "bob@x.com", "Ann", "Bob", "c2ln"])
      expect(all).not.toContain(s);
  });
});
