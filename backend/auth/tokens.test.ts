import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { resetSecretForTests } from "../core/secret";
import { TTL, cid, newJti, resetTokensForTests, sign, spendOnce, verify } from "./tokens";

beforeEach(() => {
  process.env.FREUNDEBUCH_SECRET = "s".repeat(40);
  resetSecretForTests();
  resetTokensForTests();
});
afterEach(() => {
  delete process.env.FREUNDEBUCH_SECRET;
  resetSecretForTests();
});

const NOW = 1_700_000_000_000;
const samples = {
  client: { client_name: "c", redirect_uris: ["http://x/cb"] },
  code: { cid: "a", redirect_uri: "http://x/cb", code_challenge: "ch", resource: "http://x/mcp", jti: "j", uid: "u1", until: 1 },
  access: { aud: "http://x/mcp", uid: "u1" },
  refresh: { cid: "a", aud: "http://x/mcp", jti: "j", uid: "u1", until: 1 },
  identity: { uid: "u1" },
  oidc: { state: "s", nonce: "n", verifier: "v", next: "/x", authorize: { client_id: "c" } },
};
const kinds = Object.keys(samples) as (keyof typeof samples)[];

describe("sign/verify", () => {
  test.each(kinds)("round trip %s", (k) => {
    const out = verify(k, sign(k, samples[k] as never, NOW), NOW) as Record<string, unknown>;
    expect(out).toMatchObject(samples[k]);
    expect(out.exp).toBe(k === "client" ? undefined : NOW / 1000 + TTL[k]);
  });

  test("wrong kind", () => expect(verify("access", sign("refresh", samples.refresh, NOW), NOW)).toBeNull());

  test("expiry", () => {
    const t = sign("access", samples.access, NOW);
    const exp = NOW / 1000 + TTL.access;
    expect(verify("access", t, exp * 1000)).not.toBeNull();
    expect(verify("access", t, exp * 1000 + 1)).toBeNull();
  });

  test("identity lasts 7 days, oidc 600 s", () => {
    expect(TTL.identity).toBe(7 * 24 * 3600);
    expect(TTL.oidc).toBe(600);
    for (const k of ["identity", "oidc"] as const) {
      const t = sign(k, samples[k] as never, NOW);
      expect(verify(k, t, NOW + TTL[k] * 1000)).not.toBeNull();
      expect(verify(k, t, NOW + TTL[k] * 1000 + 1)).toBeNull();
    }
  });

  test("an identity token is no access token and vice versa", () => {
    expect(verify("access", sign("identity", samples.identity, NOW), NOW)).toBeNull();
    expect(verify("identity", sign("access", samples.access, NOW), NOW)).toBeNull();
  });

  test("client has no expiry", () => expect(verify("client", sign("client", samples.client, NOW), NOW + 1e13)).not.toBeNull());

  test("a flipped character in payload or MAC is rejected", () => {
    const t = sign("access", samples.access, NOW);
    for (const i of [0, 5, t.length - 1, t.length - 5]) {
      const bad = t.slice(0, i) + (t[i] === "A" ? "B" : "A") + t.slice(i + 1);
      expect(verify("access", bad, NOW)).toBeNull();
    }
  });

  test("a token signed under another secret is refused; rotating the secret back accepts it again", () => {
    const t = sign("access", samples.access, NOW);
    process.env.FREUNDEBUCH_SECRET = "z".repeat(40);
    resetSecretForTests();
    expect(verify("access", t, NOW)).toBeNull();
    expect(verify("identity", sign("identity", samples.identity, NOW), NOW)).not.toBeNull();
    process.env.FREUNDEBUCH_SECRET = "s".repeat(40);
    resetSecretForTests();
    expect(verify("access", t, NOW)).not.toBeNull();
  });

  test("the key is HMAC(secret, freundebuch-oauth-v1), not the secret itself", async () => {
    const { createHmac } = await import("node:crypto");
    const t = sign("identity", samples.identity, NOW);
    const [body, sig] = t.split(".");
    const key = createHmac("sha256", "s".repeat(40)).update("freundebuch-oauth-v1").digest();
    expect(createHmac("sha256", key).update(body).digest("base64url")).toBe(sig);
    expect(createHmac("sha256", "s".repeat(40)).update(body).digest("base64url")).not.toBe(sig);
  });

  test.each(["", "a.b.c", ".", "a.", "!!!.???", "e30.e30", "%%%"])("garbage %j", (g) => expect(verify("access", g, NOW)).toBeNull());
});

describe("helpers", () => {
  test("cid", () => {
    expect(cid("x")).toHaveLength(22);
    expect(cid("x")).toBe(cid("x"));
    expect(cid("x")).not.toBe(cid("y"));
  });
  test("newJti is unique base64url", () => {
    expect(newJti()).toMatch(/^[\w-]{22}$/);
    expect(newJti()).not.toBe(newJti());
  });
  test("spendOnce", () => {
    expect(spendOnce("j", 100, 0)).toBe(true);
    expect(spendOnce("j", 100, 100_000)).toBe(false);
    expect(spendOnce("j", 100, 50_000)).toBe(false);
    expect(spendOnce("j", 300, 200_000)).toBe(true); // the old entry expired and was pruned
  });
});
