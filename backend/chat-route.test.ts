import Anthropic from "@anthropic-ai/sdk";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { IDENTITY_COOKIE } from "./auth/session";
import { sign } from "./auth/tokens";
import { chatRoute, setChatModelForTests } from "./chat-route";
import { resetSecretForTests } from "./secret";
import { seed, type Seed } from "./testing/fixtures";

const BASE = "http://localhost:3000";
let s: Seed;

beforeEach(async () => {
  vi.stubEnv("FREUNDEBUCH_SECRET", "s".repeat(40));
  vi.stubEnv("FREUNDEBUCH_ANTHROPIC_API_KEY", "sk-test");
  resetSecretForTests();
  s = await seed();
  setChatModelForTests({
    create: async () =>
      ({ id: "m", type: "message", role: "assistant", model: "fake", usage: {}, stop_reason: "end_turn", content: [{ type: "text", text: "Hallo!", citations: null }] }) as unknown as Anthropic.Beta.BetaMessage,
  });
});
afterEach(() => {
  vi.unstubAllEnvs();
  resetSecretForTests();
  setChatModelForTests(null);
});

const post = (body: unknown, headers: Record<string, string> = { cookie: `${IDENTITY_COOKIE}=${sign("identity", { uid: s.a.userId })}` }) =>
  chatRoute(new Request(`${BASE}/api/chat`, { method: "POST", headers: { host: "localhost:3000", origin: BASE, "content-type": "application/json", ...headers }, body: JSON.stringify(body) }));

test("a signed-in browser gets Claude's reply", async () => {
  const res = await post({ turns: [{ role: "user", content: "Hallo" }] });
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({ reply: "Hallo!", links: [], filed: false });
});

test("without an API key there is no chat", async () => {
  vi.stubEnv("FREUNDEBUCH_ANTHROPIC_API_KEY", "");
  setChatModelForTests(null);
  expect((await post({ turns: [{ role: "user", content: "Hallo" }] })).status).toBe(404);
});

test("only the web app's own cookie: an access token, another site or nobody gets 401", async () => {
  expect((await post({ turns: [{ role: "user", content: "x" }] }, { authorization: `Bearer ${sign("access", { aud: `${BASE}/api/v1`, uid: s.a.userId })}` })).status).toBe(401);
  expect((await post({ turns: [{ role: "user", content: "x" }] }, { cookie: `${IDENTITY_COOKIE}=${sign("identity", { uid: s.a.userId })}`, origin: "https://evil.example" })).status).toBe(401);
  expect((await post({ turns: [{ role: "user", content: "x" }] }, {})).status).toBe(401);
});

test("a malformed or oversized conversation is a 400", async () => {
  expect((await post({ turns: [] })).status).toBe(400);
  expect((await post({ turns: [{ role: "user", content: "x" }], context: { personId: 3 } })).status).toBe(400);
  expect((await post({ turns: Array.from({ length: 41 }, () => ({ role: "user", content: "x" })) })).status).toBe(400);
  expect((await post({ turns: [{ role: "user", content: "x".repeat(200_001) }] })).status).toBe(400);
  expect((await post({ turns: [{ role: "assistant", content: "x" }] })).status).toBe(400);
  // At most 250,000 characters a message, all turns together.
  expect((await post({ turns: [{ role: "user", content: "x".repeat(150_000) }, { role: "assistant", content: "y" }, { role: "user", content: "z".repeat(150_000) }] })).status).toBe(400);
  expect((await post({ turns: [{ role: "assistant", content: "Erfasst.", filed: true }, { role: "user", content: "x" }] })).status).toBe(200);
});

test("an unreachable Claude is a 502 with its code; the limit a 429", async () => {
  setChatModelForTests({ create: () => Promise.reject(new Anthropic.APIConnectionError({ message: "down" })) });
  const res = await post({ turns: [{ role: "user", content: "x" }] });
  expect(res.status).toBe(502);
  expect(await res.json()).toEqual({ code: "chat_unavailable" });
  vi.stubEnv("FREUNDEBUCH_CHAT_DAILY_LIMIT", "0");
  expect((await post({ turns: [{ role: "user", content: "x" }] })).status).toBe(429);
});

test("an unknown file is no error: the chat goes on without it", async () => {
  const res = await post({ turns: [{ role: "user", content: "?" }], context: { fileId: "nope" } });
  expect(res.status).toBe(200);
});
