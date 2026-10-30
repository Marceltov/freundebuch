import Anthropic from "@anthropic-ai/sdk";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { chat, linksOf, type ChatModel } from "./chat";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getConversation, record, recordConversation } from "./conversations";
import { db } from "./db";
import { discardFile, shareFile } from "./files";
import { asRamble, seed, type Seed } from "./testing/fixtures";

let s: Seed;

beforeEach(async () => {
  s = await seed();
});
afterEach(() => vi.unstubAllEnvs());

type Params = Anthropic.Beta.MessageCreateParamsNonStreaming;
type Block = Anthropic.Beta.BetaContentBlock;

const text = (t: string, stop: Anthropic.Beta.BetaStopReason = "end_turn") => ({ content: [{ type: "text", text: t, citations: null }], stop_reason: stop });
let n = 0;
const toolUse = (name: string, input: unknown) => ({ content: [{ type: "tool_use", id: `tu_${++n}`, name, input }], stop_reason: "tool_use" as const });

// A stand-in for Claude: answers from a script (a list, or a function of the call number) and keeps every request it got.
function fake(script: Array<{ content: unknown[]; stop_reason: string }> | ((i: number, p: Params) => { content: unknown[]; stop_reason: string })) {
  const calls: Params[] = [];
  const model: ChatModel = {
    async create(p) {
      calls.push(structuredClone(p));
      const next = typeof script === "function" ? script(calls.length - 1, p) : script[calls.length - 1];
      if (!next) throw new Error("the script ran out");
      return {
        id: `msg_${calls.length}`,
        type: "message",
        role: "assistant",
        model: "fake",
        usage: {},
        ...next,
        content: next.content as Block[],
      } as unknown as Anthropic.Beta.BetaMessage;
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
    toolUse("find_person", { name: "Anna" }),
    toolUse(
      "record",
      asRamble({ date: "2026-10-24", kind: "in_person", summary: "Kaffee mit Anna.", visibility: "shared", people: [{ id: s.anna, present: true }] }),
    ),
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
    toolUse(
      "record",
      asRamble({ date: "2026-10-24", kind: "call", summary: "s", transcript: "t", visibility: "shared", people: [{ name: "anna", present: true }] }),
    ),
    text("Meinst du Anna, die neue Stelle im Museum hat?"),
  ]);
  const r = await chat(s.a, [{ role: "user", content: "Hab mit Anna telefoniert." }], {}, model);
  expect(r).toMatchObject({ reply: "Meinst du Anna, die neue Stelle im Museum hat?", filed: false });
  expect(results(calls[1])[0]).toMatchObject({ is_error: true });
});

test("more than 8 tool rounds stop instead of looping", async () => {
  const { model, calls } = fake(() => toolUse("find_person", { name: "Anna" }));
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
  const { model, calls } = fake([toolUse("briefing", { personId: s.anna }), text("Anna hat einen neuen Job.")]);
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
  expect(system[1].text).toContain("The user's language is German.");
  expect(p).toMatchObject({
    model: "claude-sonnet-5-5",
    fallbacks: "default",
    betas: ["server-side-fallback-2026-07-01"],
    output_config: { effort: "medium" },
    cache_control: { type: "ephemeral" },
  });
  // Text other people wrote reaches Claude in tool results: it is data, and links are buttons in the app.
  expect(system[0].text).toContain("only when the user asked for it in their latest message");
  expect(system[0].text).toContain("instead of giving the user links");
  expect(p.tools!.map((t) => (t as { name: string }).name)).toContain("record");
  // The feed URL is a credential that has to be absolute to paste into a calendar; in the app, Einstellungen shows it.
  expect(p.tools!.map((t) => (t as { name: string }).name)).not.toContain("calendar_feed");
});

test("the transcript is the user's own words since the last filing, never Claude's retelling", async () => {
  const { model, calls } = fake([
    toolUse(
      "record",
      asRamble({
        date: "2026-10-24",
        kind: "call",
        summary: "Anruf mit Anna.",
        transcript: "Claude's Fassung",
        visibility: "shared",
        people: [{ id: s.anna, present: true }],
      }),
    ),
    text("Erfasst."),
  ]);
  const r = await chat(
    s.a,
    [
      { role: "user", content: "Alte Notiz über Tom." },
      { role: "assistant", content: "Erfasst.", filed: true },
      { role: "user", content: "Hab mit Anna telefoniert, sie zieht um." },
      { role: "assistant", content: "Soll das privat bleiben?" },
      { role: "user", content: "Nein, teilen." },
    ],
    {},
    model,
  );
  if ("code" in r) throw new Error(r.code);
  const id = r.links.find((l) => l.kind === "conversation")!.id;
  expect((await getConversation(s.a, id)).transcript).toBe("Hab mit Anna telefoniert, sie zieht um.\n\nNein, teilen.");
  const def = calls[0].tools!.find((t) => (t as { name: string }).name === "record") as { input_schema: { properties: object; required?: string[] } };
  expect(Object.keys(def.input_schema.properties)).not.toContain("transcript");
});

test("when Claude fails after filing, the reply still says what was filed, so it isn't filed twice", async () => {
  let call = 0;
  const model: ChatModel = {
    async create() {
      if (call++ === 0)
        return {
          id: "m",
          type: "message",
          role: "assistant",
          model: "fake",
          usage: {},
          ...toolUse("record", asRamble({ date: "2026-10-24", kind: "call", summary: "s", visibility: "shared", people: [{ id: s.anna, present: true }] })),
        } as unknown as Anthropic.Beta.BetaMessage;
      throw new Anthropic.APIConnectionError({ message: "down" });
    },
  };
  const r = await chat(s.a, [{ role: "user", content: "Anruf mit Anna." }], {}, model);
  expect(r).toMatchObject({ code: "chat_unavailable", filed: true, links: expect.arrayContaining([expect.objectContaining({ kind: "conversation" })]) });
});

test("a long history is cut to its last turns, starting with one of the user's", async () => {
  const { model, calls } = fake([text("Ok")]);
  const turns = Array.from({ length: 43 }, (_, i) => ({ role: i % 2 ? ("assistant" as const) : ("user" as const), content: `t${i}` }));
  await chat(s.a, turns, {}, model);
  const sent = calls[0].messages;
  expect(sent.length).toBeLessThanOrEqual(40);
  expect(sent[0].role).toBe("user");
  expect(sent[sent.length - 1].content).toBe("t42");
});

test("messages sent at the same moment can't get past the daily limit", async () => {
  vi.stubEnv("FREUNDEBUCH_CHAT_DAILY_LIMIT", "2");
  const { model, calls } = fake(() => text("Ok"));
  const replies = await Promise.all([1, 2, 3, 4].map(() => chat(s.a, [{ role: "user", content: "Hallo" }], {}, model)));
  expect(calls).toHaveLength(2);
  expect(replies.filter((r) => "code" in r && r.code === "chat_limit")).toHaveLength(2);
});

test("a reply cut off by the context window says it got too long, not that Claude refused", async () => {
  expect(
    await chat(s.a, [{ role: "user", content: "x" }], {}, fake([text("", "model_context_window_exceeded" as Anthropic.Beta.BetaStopReason)]).model),
  ).toEqual({ code: "chat_too_long" });
});

test("link chips never fail a tool call: an output of an unexpected shape gives no links", () => {
  expect(linksOf("record", {}, {})).toEqual([]);
  expect(linksOf("briefing", {}, { person: null })).toEqual([]);
  expect(linksOf("relate", {}, { added: 1 })).toEqual([]);
});

test("what remember filed shows its people as link chips", () => {
  expect(linksOf("remember", {}, { counts: {}, people: [{ id: "p1", name: "Malou", url: "/p/p1" }] })).toEqual([
    { kind: "person", id: "p1", name: "Malou", url: "/p/p1" },
  ]);
});

test("opened on a shared file, Claude gets the file and its suggestion as data in the first message, and files with its id", async () => {
  vi.stubEnv("DATA_DIR", mkdtempSync(join(tmpdir(), "fb-chat-file-")));
  const file = await shareFile(s.a, new TextEncoder().encode("Patrick: Freitag Spieleabend bei Olivier"), "text/plain");
  await (
    await db()
  )
    .updateTable("files")
    .set({ status: "pending", reading: JSON.stringify({ summary: "Freitag Spieleabend bei Olivier", people: [] }) })
    .where("id", "=", file.id)
    .execute();
  const { model, calls } = fake([text("Darin steht ein Spieleabend am Freitag. Bei wem soll ich das ablegen?")]);
  const r = await chat(s.a, [{ role: "user", content: "Was steht da drin?" }], { fileId: file.id }, model);
  expect(r).toMatchObject({ reply: expect.stringContaining("Spieleabend") });
  const first = calls[0].messages[0].content as Anthropic.Beta.BetaContentBlockParam[];
  expect(first[0]).toMatchObject({ type: "document", source: { type: "text", data: "Patrick: Freitag Spieleabend bei Olivier" } });
  expect(first[1]).toMatchObject({ type: "text", text: expect.stringContaining(`<shared_file id="${file.id}">`) });
  expect((first[1] as { text: string }).text).toContain("Freitag Spieleabend bei Olivier");
  expect(first[2]).toEqual({ type: "text", text: "Was steht da drin?" });
  const system = JSON.stringify(calls[0].system);
  expect(system).toContain(`fileId ${file.id}`);
  expect(system).toContain("inbox");
});

test("a file that isn't the viewer's own goes nowhere: nothing is attached and nothing about it shows", async () => {
  vi.stubEnv("DATA_DIR", mkdtempSync(join(tmpdir(), "fb-chat-file-")));
  const file = await shareFile(s.a, new TextEncoder().encode("GEHEIMNIS-4711"), "text/plain");
  const { model, calls } = fake([text("…")]);
  await chat(s.b, [{ role: "user", content: "?" }], { fileId: file.id }, model);
  expect(calls[0].messages[0].content).toBe("?");
  expect(JSON.stringify(calls[0])).not.toContain("GEHEIMNIS-4711");
});

test("once the file is filed it is gone: the chat on it goes on without it, and Claude hears its text is in the transcript", async () => {
  vi.stubEnv("DATA_DIR", mkdtempSync(join(tmpdir(), "fb-chat-file-")));
  const file = await shareFile(s.a, new TextEncoder().encode("Patrick: Freitag Spieleabend"), "text/plain");
  await recordConversation(s.a, {
    date: "2026-10-20",
    kind: "message",
    summary: "Chat",
    transcript: "t",
    visibility: "shared",
    fileIds: [file.id],
    people: [{ id: s.anna, present: true }],
  });
  const { model, calls } = fake([text("Notiert.")]);
  const r = await chat(s.a, [{ role: "user", content: "und sie hat am 3.5. Geburtstag" }], { fileId: file.id }, model);
  expect(r).toMatchObject({ reply: "Notiert." });
  expect(calls[0].messages[0].content).toBe("und sie hat am 3.5. Geburtstag");
  expect(JSON.stringify(calls[0].system)).toContain("filed now and gone");
});

test("opened on a shared file, Claude learns the day it was shared and dates what it files by that, not by the day of review", async () => {
  vi.stubEnv("DATA_DIR", mkdtempSync(join(tmpdir(), "fb-chat-file-")));
  const file = await shareFile(s.a, new TextEncoder().encode("Anna: bin wieder da"), "text/plain");
  await (
    await db()
  )
    .updateTable("files")
    .set({ status: "pending", created_at: Date.parse("2026-10-20T10:00:00Z") })
    .where("id", "=", file.id)
    .execute();
  const { model, calls } = fake([text("ok")]);
  await chat(s.a, [{ role: "user", content: "?" }], { fileId: file.id }, model, Date.parse("2026-10-29T10:00:00Z"));
  const first = calls[0].messages[0].content as Anthropic.Beta.BetaContentBlockParam[];
  expect((first[1] as { text: string }).text).toContain("Shared on 2026-10-20");
  const system = JSON.stringify(calls[0].system);
  expect(system).toContain("2026-10-20");
  expect(system).toContain("not the day it is reviewed");
});

test("opened on several files, Claude gets them all in order as data, hears they belong together, and files them with all their ids", async () => {
  vi.stubEnv("DATA_DIR", mkdtempSync(join(tmpdir(), "fb-chat-files-")));
  const parts = [];
  for (const t of ["Teil 1: Patrick fragt", "Teil 2: Sybille antwortet", "Teil 3: Marcel sagt zu"])
    parts.push(await shareFile(s.a, new TextEncoder().encode(t), "text/plain"));
  const d = await db();
  await d
    .updateTable("files")
    .set({ created_at: Date.parse("2026-10-21T10:00:00Z") })
    .where("id", "=", parts[2].id)
    .execute();
  await d
    .updateTable("files")
    .set({ created_at: Date.parse("2026-10-20T10:00:00Z") })
    .where("id", "in", [parts[0].id, parts[1].id])
    .execute();
  const ids = parts.map((p) => p.id);
  const { model, calls } = fake([text("ok")]);
  await chat(s.a, [{ role: "user", content: "Was steht da?" }], { fileIds: ids }, model, Date.parse("2026-10-29T10:00:00Z"));
  const first = calls[0].messages[0].content as Anthropic.Beta.BetaContentBlockParam[];
  expect(first.filter((b) => b.type === "document").map((b) => (b as { source: { data: string } }).source.data)).toEqual([
    "Teil 1: Patrick fragt",
    "Teil 2: Sybille antwortet",
    "Teil 3: Marcel sagt zu",
  ]);
  const notes = first.filter((b) => b.type === "text").map((b) => (b as { text: string }).text);
  expect(ids.map((id) => notes.findIndex((n) => n.includes(`<shared_file id="${id}">`)))).toEqual([0, 1, 2]);
  expect(notes.at(-1)).toBe("Was steht da?");
  const system = JSON.stringify(calls[0].system);
  expect(system).toContain(`fileIds ${JSON.stringify(ids).replace(/"/g, '\\"')}`);
  expect(system).toContain("put them together as one thing");
  expect(system).toContain("2026-10-20");
});

test("of several files, one filed meanwhile and one of the partner's are left out without a trace", async () => {
  vi.stubEnv("DATA_DIR", mkdtempSync(join(tmpdir(), "fb-chat-files-")));
  const one = await shareFile(s.a, new TextEncoder().encode("EINS"), "text/plain");
  const gone = await shareFile(s.a, new TextEncoder().encode("WEG"), "text/plain");
  const three = await shareFile(s.a, new TextEncoder().encode("DREI"), "text/plain");
  const bobs = await shareFile(s.b, new TextEncoder().encode("BOBS-GEHEIMNIS"), "text/plain");
  await discardFile(s.a, gone.id);
  const { model, calls } = fake([text("ok")]);
  await chat(s.a, [{ role: "user", content: "?" }], { fileIds: [one.id, gone.id, bobs.id, three.id] }, model);
  const all = JSON.stringify(calls[0]);
  expect(all).toContain("EINS");
  expect(all).toContain("DREI");
  expect(all).not.toContain("WEG");
  expect(all).not.toContain("BOBS-GEHEIMNIS");
  expect(all).not.toContain(bobs.id);
  expect(all).not.toContain(gone.id);
});

test("several files all gone: the chat goes on, and Claude hears they are filed", async () => {
  vi.stubEnv("DATA_DIR", mkdtempSync(join(tmpdir(), "fb-chat-files-")));
  const one = await shareFile(s.a, new TextEncoder().encode("EINS"), "text/plain");
  await discardFile(s.a, one.id);
  const { model, calls } = fake([text("ok")]);
  await chat(s.a, [{ role: "user", content: "?" }], { fileIds: [one.id] }, model);
  expect(calls[0].messages[0].content).toBe("?");
  expect(JSON.stringify(calls[0].system)).toContain("filed now and gone");
});

test("what record filed as an experience shows as a link chip with its title", () => {
  const input = { date: "2026-10-28", experiences: [{ kind: "Kurs", title: "Erste Stunde Hundeschule" }] };
  const out = { conversations: [], people: [], experiences: [{ id: "e1", seriesId: "s1", visibility: "shared", url: "/s/s1#experience-e1" }] };
  expect(linksOf("record", input, out)).toEqual([{ kind: "experience", id: "e1", name: "Erste Stunde Hundeschule", url: "/s/s1#experience-e1" }]);
});

test("opened on no page, the chat tells Claude about a missed session so it asks first", async () => {
  const r = await record(s.a, {
    date: "2026-09-02",
    transcript: "t",
    visibility: "shared",
    people: [],
    experiences: [{ kind: "Kurs", title: "Erste", series: { name: "Hundeschule mit Toffee", rhythmDays: 7 } }],
  });
  await (
    await db()
  )
    .updateTable("series")
    .set({ created_at: Date.parse("2026-09-02T20:00:00Z") })
    .where("id", "=", r.experiences[0].seriesId!)
    .execute();
  const { model, calls } = fake([text("Wie war die Hundeschule am Mittwoch?")]);
  await chat(s.a, [{ role: "user", content: "Hallo" }], {}, model, Date.parse("2026-09-10T09:00:00Z"));
  expect(JSON.stringify(calls[0].system)).toContain("Hundeschule mit Toffee on 2026-09-09");
});

test("opened on a ramble, Claude gets what was filed from it and its transcript, to add or correct; never the partner's private one", async () => {
  const d = await db();
  const ramble = async (conv: string) => (await d.selectFrom("conversations").select("ramble_id").where("id", "=", conv).executeTakeFirstOrThrow()).ramble_id;
  const { model, calls } = fake([text("Wer war noch da?")]);
  await chat(s.a, [{ role: "user", content: "Anna war nicht allein da" }], { rambleId: await ramble(s.dinner) }, model);
  const situation = (calls[0].system as Anthropic.Beta.BetaTextBlockParam[])[1].text;
  expect(situation).toContain(`conversation ${s.dinner}`);
  expect(situation).toContain(`Anna (${s.anna})`);
  expect(situation).toContain("participant_add");
  expect(situation).toContain("<ramble_transcript>");
  // B's chat on A's private coffee: the ramble isn't B's to see, so nothing of it goes along.
  const other = fake([text("Hallo")]);
  await chat(s.b, [{ role: "user", content: "Hallo" }], { rambleId: await ramble(s.coffee) }, other.model);
  const theirs = (other.calls[0].system as Anthropic.Beta.BetaTextBlockParam[])[1].text;
  expect(theirs).not.toContain(s.coffee);
  expect(theirs).not.toContain("ramble_transcript");
});
