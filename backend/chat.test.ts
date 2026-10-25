import Anthropic from "@anthropic-ai/sdk";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { chat, type ChatModel } from "./chat";
import { getConversation } from "./conversations";
import { seed, type Seed } from "./testing/fixtures";

let s: Seed;

beforeEach(async () => {
  s = await seed();
});
afterEach(() => vi.unstubAllEnvs());

type Params = Anthropic.Beta.MessageCreateParamsNonStreaming;
type Block = Anthropic.Beta.BetaContentBlock;

const text = (t: string, stop: Anthropic.Beta.BetaStopReason = "end_turn") => ({ content: [{ type: "text", text: t, citations: null }], stop_reason: stop });
let n = 0;
const use = (name: string, input: unknown) => ({ content: [{ type: "tool_use", id: `tu_${++n}`, name, input }], stop_reason: "tool_use" as const });

// A stand-in for Claude: answers from a script (a list, or a function of the call number) and keeps every request it got.
function fake(script: Array<{ content: unknown[]; stop_reason: string }> | ((i: number, p: Params) => { content: unknown[]; stop_reason: string })) {
  const calls: Params[] = [];
  const model: ChatModel = {
    async create(p) {
      calls.push(structuredClone(p));
      const next = typeof script === "function" ? script(calls.length - 1, p) : script[calls.length - 1];
      if (!next) throw new Error("the script ran out");
      return { id: `msg_${calls.length}`, type: "message", role: "assistant", model: "fake", usage: {}, ...next, content: next.content as Block[] } as unknown as Anthropic.Beta.BetaMessage;
    },
  };
  return { model, calls };
}

// The tool results Claude got in a request: the last user message's tool_result blocks.
const results = (p: Params) => {
  const last = p.messages[p.messages.length - 1];
  return (Array.isArray(last.content) ? last.content : []).filter((b) => b.type === "tool_result") as Anthropic.Beta.BetaToolResultBlockParam[];
};
const resultText = (r: Anthropic.Beta.BetaToolResultBlockParam) => (typeof r.content === "string" ? r.content : JSON.stringify(r.content));

test("a ramble is filed as the viewer, with the verbatim transcript, and the reply links the conversation", async () => {
  const ramble = "Kaffee mit Anna. Sie erzählt vom Umzug nach Köln. ".repeat(800).slice(0, 40_000);
  const { model, calls } = fake([
    use("find_person", { name: "Anna" }),
    use("record_conversation", { date: "2026-10-24", kind: "in_person", summary: "Kaffee mit Anna.", transcript: ramble, visibility: "shared", people: [{ id: s.anna, present: true }] }),
    text("Erfasst am Sa., 24. Okt."),
  ]);
  const r = await chat(s.a, [{ role: "user", content: ramble }], {}, model);
  if ("code" in r) throw new Error(r.code);
  expect(r.reply).toBe("Erfasst am Sa., 24. Okt.");
  expect(r.filed).toBe(true);
  const conv = r.links.find((l) => l.kind === "conversation")!;
  expect(conv).toMatchObject({ date: "2026-10-24", url: `/c/${conv.id}` });
  expect(r.links).toContainEqual(expect.objectContaining({ kind: "person", id: s.anna, name: "Anna" }));
  expect((await getConversation(s.a, conv.id)).transcript).toBe(ramble);
  expect(resultText(results(calls[1])[0])).toContain(s.anna);
});

test("a tool's refusal goes back to Claude as an error result, and Claude's question reaches the user", async () => {
  const { model, calls } = fake([
    use("record_conversation", { date: "2026-10-24", kind: "call", summary: "s", transcript: "t", visibility: "shared", people: [{ name: "anna", present: true }] }),
    text("Meinst du Anna, die neue Stelle im Museum hat?"),
  ]);
  const r = await chat(s.a, [{ role: "user", content: "Hab mit Anna telefoniert." }], {}, model);
  expect(r).toMatchObject({ reply: "Meinst du Anna, die neue Stelle im Museum hat?", filed: false });
  expect(results(calls[1])[0]).toMatchObject({ is_error: true });
});

test("more than 8 tool rounds stop instead of looping", async () => {
  const { model, calls } = fake(() => use("find_person", { name: "Anna" }));
  expect(await chat(s.a, [{ role: "user", content: "Wer ist Anna?" }], {}, model)).toEqual({ code: "chat_too_long" });
  expect(calls).toHaveLength(8);
});

test("a refusal or a cut-off answer gives a code, never an empty reply", async () => {
  expect(await chat(s.a, [{ role: "user", content: "x" }], {}, fake([text("", "refusal")]).model)).toEqual({ code: "chat_refused" });
  expect(await chat(s.a, [{ role: "user", content: "x" }], {}, fake([text("halb", "max_tokens")]).model)).toEqual({ code: "chat_too_long" });
});

test("the Claude API being unreachable is chat_unavailable, and nothing is claimed as filed", async () => {
  const model: ChatModel = { create: () => Promise.reject(new Anthropic.APIConnectionError({ message: "down" })) };
  expect(await chat(s.a, [{ role: "user", content: "x" }], {}, model)).toEqual({ code: "chat_unavailable" });
});

test("B's chat about Anna never sees A's private items", async () => {
  const { model, calls } = fake([use("briefing", { personId: s.anna }), text("Anna hat einen neuen Job.")]);
  await chat(s.b, [{ role: "user", content: "Was ist mit Anna?" }], {}, model);
  const seen = resultText(results(calls[1])[0]);
  expect(seen).toContain("new job");
  expect(seen).not.toContain("divorce");
});

test("the daily limit answers chat_limit without calling Claude", async () => {
  vi.stubEnv("FREUNDEBUCH_CHAT_DAILY_LIMIT", "1");
  const { model, calls } = fake([text("Hallo"), text("Nochmal")]);
  await chat(s.a, [{ role: "user", content: "Hallo" }], {}, model);
  expect(await chat(s.a, [{ role: "user", content: "Nochmal" }], {}, model)).toEqual({ code: "chat_limit" });
  expect(calls).toHaveLength(1);
  // B has a limit of their own.
  await chat(s.b, [{ role: "user", content: "Hallo" }], {}, fake([text("Hallo")]).model);
});

test("the system prompt has a cached stable block, and names today, the user and the page they are on", async () => {
  const { model, calls } = fake([text("Hallo")]);
  await chat(s.a, [{ role: "user", content: "Hallo" }], { personId: s.anna }, model, Date.parse("2026-10-24T10:00:00Z"));
  const p = calls[0];
  const system = p.system as Anthropic.Beta.BetaTextBlockParam[];
  expect(system[0]).toMatchObject({ cache_control: { type: "ephemeral" } });
  expect(system[0].text).toContain("Pass the ramble verbatim");
  expect(system[1].text).toContain("2026-10-24");
  expect(system[1].text).toContain("Alice");
  expect(system[1].text).toContain(`Anna (${s.anna})`);
  expect(p).toMatchObject({ model: "claude-sonnet-5-5", fallbacks: "default", betas: ["server-side-fallback-2026-07-01"], output_config: { effort: "medium" } });
  expect(p.tools!.map((t) => (t as { name: string }).name)).toContain("record_conversation");
});
