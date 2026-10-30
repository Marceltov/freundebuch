import Anthropic from "@anthropic-ai/sdk";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { IDENTITY_COOKIE } from "./auth/session";
import { sign } from "./auth/tokens";
import { chatRoute, setChatModelForTests, voiceEnabled, voiceRoute } from "./chat-route";
import { setTranscriberForTests } from "./transcribe";
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

test("a chat on more than 50 files goes on with the first 50, not refused", async () => {
  const res = await post({ turns: [{ role: "user", content: "?" }], context: { fileIds: Array.from({ length: 60 }, (_, i) => `f${i}`) } });
  expect(res.status).toBe(200);
});

const speak = (body: BodyInit, headers: Record<string, string> = { cookie: `${IDENTITY_COOKIE}=${sign("identity", { uid: s.a.userId })}`, "content-type": "audio/webm" }) =>
  voiceRoute(new Request(`${BASE}/api/chat/voice`, { method: "POST", headers: { host: "localhost:3000", origin: BASE, ...headers }, body }));

test("a message spoken into Erzählen comes back as its words, from the transcription server; nothing is stored", async () => {
  const heard: string[] = [];
  setTranscriberForTests({ transcribe: async (_b, type) => (heard.push(type), { text: "Ich war heute mit Anna essen." }) });
  try {
    expect(voiceEnabled()).toBe(true);
    const res = await speak(new Uint8Array([1, 2, 3]));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ text: "Ich war heute mit Anna essen." });
    expect(heard).toEqual(["audio/webm"]);
    expect((await speak(new Uint8Array([1]), { "content-type": "audio/webm" })).status).toBe(401);
    expect((await speak(new Uint8Array([1]), { cookie: `${IDENTITY_COOKIE}=${sign("identity", { uid: s.a.userId })}`, "content-type": "text/plain" })).status).toBe(400);
    setTranscriberForTests({ transcribe: async () => ({ error: "transcription failed (HTTP 500)" }) });
    const failed = await speak(new Uint8Array([1, 2, 3]));
    expect([failed.status, (await failed.json()).code]).toEqual([502, "voice_unavailable"]);
  } finally {
    setTranscriberForTests(null);
  }
});

test("without a transcription server Erzählen takes no spoken messages", async () => {
  expect(voiceEnabled()).toBe(false);
  expect((await speak(new Uint8Array([1, 2, 3]))).status).toBe(404);
});
