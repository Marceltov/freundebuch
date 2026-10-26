import { sql } from "kysely";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { sign } from "./auth/tokens";
import { db } from "./db/testing";
import { logTo } from "./log";
import { mcpRoute } from "./mcp";
import { resetSecretForTests } from "./secret";
import { DINNER_TRANSCRIPT, seed, type Seed } from "./testing/fixtures";
import type { Viewer } from "./types";

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- the tests read tool results by shape, which the output schemas check
type Json = any;

// Log lines, captured per test.
let logs: string[] = [];
let restoreLog = () => {};
let s: Seed;
beforeEach(async () => {
  vi.stubEnv("FREUNDEBUCH_SECRET", "s".repeat(40));
  resetSecretForTests();
  s = await seed();
  logs = [];
  restoreLog = logTo((l) => void logs.push(l));
});
afterEach(() => {
  restoreLog();
  vi.unstubAllEnvs();
  resetSecretForTests();
});

const V = "2026-07-28";
const META = { "io.modelcontextprotocol/clientInfo": { name: "t", version: "0" }, "io.modelcontextprotocol/clientCapabilities": {} };
const RESOURCE = "http://localhost:3000/mcp";
const bearer = (v: Viewer, aud = RESOURCE) => ({ authorization: `Bearer ${sign("access", { aud, uid: v.userId })}` });

// A request as `as` (null: no token). `headers` override the defaults.
async function rpc(as: Viewer | null, method: string, params: Record<string, unknown> = {}, headers: Record<string, string> = {}, withMeta = true) {
  const name: Record<string, string> = typeof params.name === "string" ? { "mcp-name": params.name } : {};
  const _meta = { "io.modelcontextprotocol/protocolVersion": V, ...META };
  return mcpRoute(
    new Request(RESOURCE, {
      method: "POST",
      headers: {
        host: "localhost:3000",
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
        "mcp-protocol-version": V,
        "mcp-method": method,
        ...name,
        ...(as && bearer(as)),
        ...headers,
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params: withMeta ? { ...params, _meta } : params }),
    }),
  );
}
const call = async (as: Viewer, tool: string, args: Record<string, unknown>): Promise<Json> => (await (await rpc(as, "tools/call", { name: tool, arguments: args })).json()).result;

const ramble = (over: object = {}) => ({
  date: "2026-10-22",
  kind: "in_person",
  summary: "Lunch with Anna.",
  transcript: "Lunch with Anna. She is training for a marathon. Between us: she is worried about money.",
  visibility: "shared",
  people: [{ id: s.anna, present: true }],
  facts: [
    { person: 0, text: "training for a marathon", category: "hobby" },
    { person: 0, text: "worried about money", category: "other", private: true },
  ],
  ...over,
});

describe("protocol", () => {
  test("tools/list names the ten tools with their annotations", async () => {
    const tools = (await (await rpc(s.a, "tools/list")).json()).result.tools;
    expect(tools.map((t: { name: string }) => t.name).sort()).toEqual([
      "briefing",
      "correct",
      "find_person",
      "get_transcript",
      "groups",
      "record_conversation",
      "relate",
      "remember",
      "set_interval",
      "whats_due",
    ]);
    for (const t of tools) {
      expect(t.annotations?.readOnlyHint === true, t.name).toBe(["find_person", "briefing", "whats_due", "get_transcript", "groups"].includes(t.name));
      // Not read-only means destructive unless said otherwise, and a client asks before a destructive call: only correct is.
      const writes = ["record_conversation", "relate", "remember", "set_interval"].includes(t.name);
      expect(t.annotations?.destructiveHint, t.name).toBe(t.name === "correct" ? true : writes ? false : undefined);
      expect(t.annotations?.idempotentHint === true, t.name).toBe(t.name === "set_interval");
      expect(t.outputSchema?.type, t.name).toBe("object");
      // The Anthropic API refuses a tool whose input schema combines schemas at its root.
      expect(t.inputSchema.type, t.name).toBe("object");
      for (const k of ["oneOf", "anyOf", "allOf"]) expect(t.inputSchema, t.name).not.toHaveProperty(k);
    }
    const find = tools.find((t: { name: string }) => t.name === "find_person");
    expect(find.description).toContain("always call this before referring to a person by id");
    // Not every client passes the server instructions on, so the ask-first rules are in the descriptions too.
    const description = (name: string) => tools.find((t: { name: string }) => t.name === name).description;
    for (const phrase of ["resolve every person with find_person", "ask the user when a name fits more than one person or resembles an existing one", "keep it out of the summary"])
      expect(description("record_conversation")).toContain(phrase);
    expect(description("correct")).toContain("the conversation was on another day");
    expect(description("record_conversation")).toContain("when the user says when it happened");
    for (const name of ["record_conversation", "relate"]) {
      expect(description(name), name).toContain("health, relationship trouble, money, anything said in confidence");
      expect(description(name), name).toContain("ask the user whether it should be private before calling");
    }
  });

  test("server/discover carries the instructions", async () => {
    const res = await rpc(s.a, "server/discover");
    expect(res.status).toBe(200);
    const text = JSON.stringify(await res.json());
    expect(text).toContain(V);
    expect(text).toContain("Pass the ramble verbatim as transcript, never a summary.");
    expect(text).toContain("When a briefing has suggestedInterval, offer it to the user");
    expect(text).toContain("with the day it happened");
    expect(text).toContain("Prefer an existing group, by name or other name, over a new one");
  });

  test("initialize is refused with 400", async () => {
    const res = await rpc(s.a, "initialize", { protocolVersion: "2025-11-25" }, { "mcp-protocol-version": "", "mcp-method": "" }, false);
    expect(res.status).toBe(400);
  });

  test("no token, or a token that isn't for /mcp, is 401 pointing at the resource metadata", async () => {
    const metadata = 'resource_metadata="http://localhost:3000/.well-known/oauth-protected-resource/mcp"';
    const none = await rpc(null, "tools/list");
    expect(none.status).toBe(401);
    expect(none.headers.get("www-authenticate")).toBe(`Bearer ${metadata}`);
    const garbage = await rpc(null, "tools/list", {}, { authorization: "Bearer nope" });
    expect(garbage.status).toBe(401);
    // One we signed for the API, or one that has expired: the client should refresh.
    for (const token of [sign("access", { aud: "http://localhost:3000/api/v1", uid: s.a.userId }), sign("access", { aud: RESOURCE, uid: s.a.userId }, Date.now() - 7200_000)]) {
      const res = await rpc(null, "tools/list", {}, { authorization: `Bearer ${token}` });
      expect(res.status).toBe(401);
      expect(res.headers.get("www-authenticate")).toBe(`Bearer error="invalid_token", ${metadata}`);
    }
  });

  test("a foreign Origin is 403, the own one passes", async () => {
    expect((await rpc(s.a, "tools/list", {}, { origin: "https://evil.example" })).status).toBe(403);
    expect((await rpc(s.a, "tools/list", {}, { origin: "not a url" })).status).toBe(403);
    expect((await rpc(s.a, "tools/list", {}, { origin: "http://localhost:3000" })).status).toBe(200);
  });
});

describe("tools", () => {
  test("record_conversation without visibility is an error and records nothing", async () => {
    const { visibility, ...rest } = ramble();
    void visibility;
    const r = await call(s.a, "record_conversation", rest);
    expect(r.isError).toBe(true);
    expect(await (await db()).selectFrom("conversations").select("id").where("summary", "=", "Lunch with Anna.").execute()).toEqual([]);
  });

  test("record, read back as structured content and JSON text", async () => {
    const r = await call(s.a, "record_conversation", ramble());
    expect(r.isError).toBeUndefined();
    expect(r.structuredContent).toMatchObject({ people: [{ ref: 0, id: s.anna, name: "Anna", created: false }], counts: { facts: 2 } });
    expect(JSON.parse(r.content[0].text)).toEqual(r.structuredContent);
  });

  test("every person and conversation comes with an absolute link into the web app", async () => {
    const r = (await call(s.a, "record_conversation", ramble())).structuredContent;
    expect(r.url).toBe(`http://localhost:3000/c/${r.conversationId}`);
    expect(r.people[0].url).toBe(`http://localhost:3000/p/${s.anna}`);
    expect((await call(s.a, "find_person", { name: "Anna" })).structuredContent.people[0].url).toBe(`http://localhost:3000/p/${s.anna}`);
    const b = (await call(s.a, "briefing", { personId: s.anna })).structuredContent;
    for (const f of b.current) expect(f.url).toBe(`http://localhost:3000/p/${s.anna}#facts-${f.id}`);
    expect(b.recent[0].url).toBe(`http://localhost:3000/c/${b.recent[0].id}`);
    expect((await call(s.a, "get_transcript", { conversationId: r.conversationId })).structuredContent.url).toBe(r.url);
  });

  test("a domain refusal is a readable tool error", async () => {
    const r = await call(s.a, "briefing", { personId: "nope" });
    expect(r).toMatchObject({ isError: true, content: [{ text: "No such person" }] });
  });

  test("a 40,000-character transcript round-trips verbatim", async () => {
    const transcript = "Anna erzählt vom Umzug nach Köln, über Ärger mit dem Vermieter. ".repeat(700).slice(0, 40_000);
    expect(transcript).toHaveLength(40_000);
    const rec = await call(s.a, "record_conversation", ramble({ transcript, facts: [] }));
    const got = await call(s.a, "get_transcript", { conversationId: rec.structuredContent.conversationId });
    expect(got.structuredContent.transcript).toBe(transcript);
  });

  test("get_transcript: null when the transcript is private to the recorder", async () => {
    expect((await call(s.a, "get_transcript", { conversationId: s.dinner })).structuredContent.transcript).toBe(DINNER_TRANSCRIPT);
    expect((await call(s.b, "get_transcript", { conversationId: s.dinner })).structuredContent.transcript).toBeNull();
    expect((await call(s.b, "get_transcript", { conversationId: s.coffee })).isError).toBe(true);
  });

  test("record_conversation refuses a new person named like an existing one, listing who it may be", async () => {
    const r = await call(s.a, "record_conversation", ramble({ people: [{ name: "anna", present: true }], facts: [] }));
    expect(r.isError).toBe(true);
    expect(r.content[0].text).toContain(s.anna);
    expect(r.content[0].text).toContain("confirmedNew");
  });

  test("find_person with two Annas returns both", async () => {
    await call(s.a, "record_conversation", ramble({ people: [{ name: "Anna", present: true, confirmedNew: true }], facts: [] }));
    const r = await call(s.a, "find_person", { name: "anna" });
    expect(r.structuredContent.people.map((p: { name: string }) => p.name)).toEqual(["Anna", "Anna"]);
  });

  test("whats_due and set_interval", async () => {
    expect((await call(s.a, "whats_due", { from: "2026-10-23" })).structuredContent.items.map((i: { date: string }) => i.date)).toEqual(["2026-10-24"]);
    const set = await call(s.a, "set_interval", { personId: s.anna, days: 14 });
    expect(set.structuredContent).toEqual({ personId: s.anna, days: 14, confirmed: true, url: `http://localhost:3000/p/${s.anna}` });
    expect((await call(s.a, "briefing", { personId: s.anna })).structuredContent.freshness.intervalDays).toBe(14);
  });

  test("relate: a relationship and a group membership without a conversation", async () => {
    const rel = await call(s.a, "relate", { kind: "relationship", from: s.lena, to: s.anna, type: "colleague", visibility: "shared" });
    expect(rel.isError).toBeUndefined();
    expect((await call(s.b, "briefing", { personId: s.anna })).structuredContent.relationships).toEqual([
      { id: expect.any(String), personId: s.lena, name: "Lena", type: "colleague", note: null, direction: "in", url: `http://localhost:3000/p/${s.lena}`, visibility: "shared", mine: false },
    ]);
    expect(rel.structuredContent.url).toBe(`http://localhost:3000/p/${s.lena}`);
    const group = await call(s.a, "relate", { kind: "group", name: "Uni", members: [s.anna, s.lena], visibility: "shared" });
    expect(group.structuredContent).toMatchObject({ added: 2, name: "Uni" });
    expect((await call(s.a, "relate", { kind: "group", name: "Uni", members: [s.anna], visibility: "shared" })).structuredContent).toMatchObject({ added: 0 });
    // The briefing's output schema carries the groups and the birthday.
    expect((await call(s.b, "briefing", { personId: s.anna })).structuredContent.groups.map((g: { name: string }) => g.name)).toEqual(["Uni"]);
    expect((await call(s.a, "briefing", { personId: s.tom })).structuredContent.person.birthday).toMatchObject({ date: "--10-24", age: null });
    expect((await call(s.b, "briefing", { personId: s.tom })).structuredContent.person.birthday).toBeNull();
    expect((await call(s.a, "relate", { kind: "relationship", from: s.anna, to: s.anna, type: "friend", visibility: "shared" })).isError).toBe(true);
    // The flat schema lets any field through; the handler checks the shape of the kind.
    expect(await call(s.a, "relate", { kind: "relationship", from: s.anna, type: "friend", visibility: "shared" })).toMatchObject({ isError: true, content: [{ text: expect.stringMatching(/^to: /) }] });
    expect(await call(s.a, "relate", { kind: "group", name: "Uni", visibility: "shared" })).toMatchObject({ isError: true, content: [{ text: expect.stringMatching(/^members: /) }] });
  });

  test("correct maps each action to its correction", async () => {
    await call(s.a, "record_conversation", ramble({ promises: [{ person: 0, text: "send the playlist", byMe: true }] }));
    const d = await db();
    const promise = (await d.selectFrom("promises").select("id").where("text", "=", "send the playlist").executeTakeFirstOrThrow()).id;
    const marathon = (await d.selectFrom("facts").select("id").where("text", "=", "training for a marathon").executeTakeFirstOrThrow()).id;
    const ok = { structuredContent: { corrected: true } };
    expect(await call(s.b, "correct", { action: "done", table: "promises", id: promise })).toMatchObject(ok);
    expect(await call(s.a, "correct", { action: "edit", table: "facts", id: marathon, patch: { text: "ran a marathon" } })).toMatchObject(ok);
    expect(await call(s.a, "correct", { action: "outdated", id: marathon })).toMatchObject(ok);
    expect(await call(s.b, "correct", { action: "visibility", table: "facts", id: marathon, visibility: "private" })).toMatchObject({ isError: true });
    expect(await call(s.a, "correct", { action: "delete", table: "promises", id: promise })).toMatchObject(ok);
    expect(await call(s.a, "correct", { action: "rename", id: s.lena, name: "Lena M." })).toMatchObject(ok);
    expect(await call(s.b, "correct", { action: "alias", id: s.lena, alias: "Leni" })).toMatchObject(ok);
    expect((await call(s.a, "find_person", { name: "Leni" })).structuredContent.people[0]).toMatchObject({ id: s.lena, aliases: ["Leni"] });
    expect(await call(s.a, "correct", { action: "alias", id: s.lena })).toMatchObject({ isError: true, content: [{ text: expect.stringMatching(/^alias: /) }] });
    expect(await call(s.a, "correct", { action: "merge", id: s.anna, drop: s.tom })).toMatchObject(ok);
    expect(await d.selectFrom("persons").select("id").where("id", "=", s.tom).execute()).toEqual([]);
    // The dinner still holds private items, so its transcript stays private; the coffee is B's to never see.
    expect(await call(s.a, "correct", { action: "share_transcript", id: s.dinner })).toMatchObject({ isError: true, content: [{ text: expect.stringContaining("private") }] });
    expect(await call(s.b, "correct", { action: "share_transcript", id: s.coffee })).toMatchObject({ isError: true });
    expect(await call(s.a, "correct", { action: "share_transcript", id: s.call })).toMatchObject({ isError: true }); // B recorded it
    expect((await call(s.a, "correct", { action: "done", table: "facts", id: marathon })).isError).toBe(true);
    expect(await call(s.a, "correct", { action: "merge", id: s.anna })).toMatchObject({ isError: true, content: [{ text: expect.stringMatching(/^drop: /) }] });
  });

  test("an unexpected failure is logged, and the client only gets 'internal error'", async () => {
    await sql`drop table person_settings`.execute(await db());
    const r = await call(s.a, "whats_due", {});
    expect(r).toMatchObject({ isError: true, content: [{ text: "internal error" }] });
    expect(logs.map((l) => JSON.parse(l))).toEqual([expect.objectContaining({ level: "error", component: "mcp", msg: "tool failed", err: expect.objectContaining({ type: "SqliteError" }) })]);
  });
});

describe("groups over MCP", () => {
  test("groups lists them with other names; relate finds Arbeit through Kollegen; correct takes someone out", async () => {
    const list = (await call(s.a, "groups", {})).structuredContent.groups;
    const arbeit = list.find((g: { name: string }) => g.name === "Arbeit");
    expect(arbeit).toMatchObject({ aliases: ["Job", "Kollegen"], url: `http://localhost:3000/g/${arbeit.id}` });
    const rel = (await call(s.a, "relate", { kind: "group", name: "Kollegen", members: [s.anna], visibility: "shared" })).structuredContent;
    expect(rel).toEqual({ added: 1, id: arbeit.id, name: "Arbeit", url: arbeit.url });
    const out = await call(s.a, "correct", { action: "ungroup", id: arbeit.id, person: s.anna });
    expect(out.isError).toBeUndefined();
    expect((await call(s.a, "groups", {})).structuredContent.groups.find((g: { name: string }) => g.name === "Arbeit").count).toBe(0);
  });

  test("correct renames, adds and drops other names, merges and deletes groups", async () => {
    const id = (await call(s.a, "relate", { kind: "group", name: "Chor", members: [s.anna], visibility: "shared" })).structuredContent.id;
    for (const [action, extra] of [
      ["group_rename", { name: "Singen" }],
      ["group_alias", { alias: "Choir" }],
      ["group_unalias", { alias: "choir" }],
    ] as const)
      expect((await call(s.a, "correct", { action, id, ...extra })).isError, action).toBeUndefined();
    const freunde = (await call(s.a, "groups", {})).structuredContent.groups.find((g: { name: string }) => g.name === "Freunde");
    expect((await call(s.a, "correct", { action: "group_merge", id: freunde.id, drop: id })).isError).toBeUndefined();
    expect((await call(s.a, "groups", {})).structuredContent.groups.find((g: { name: string }) => g.name === "Freunde").aliases).toEqual(["Chor", "Freundeskreis", "Singen"]);
    expect((await call(s.a, "correct", { action: "group_delete", id: freunde.id })).isError).toBeUndefined();
  });

  test("B's groups never list a group only A's private membership fills", async () => {
    await call(s.a, "relate", { kind: "group", name: "Therapie", members: [s.anna], visibility: "private" });
    expect(JSON.stringify((await call(s.b, "groups", {})).structuredContent)).not.toContain("Therapie");
  });
});

describe("privacy over MCP", () => {
  test("get_transcript stays null for B after A shares the private items, until A uses share_transcript", async () => {
    const r = await call(s.a, "record_conversation", ramble());
    const id = r.structuredContent.conversationId;
    const d = await db();
    const money = (await d.selectFrom("facts").select("id").where("text", "=", "worried about money").executeTakeFirstOrThrow()).id;
    expect(await call(s.a, "correct", { action: "visibility", table: "facts", id: money, visibility: "shared" })).toMatchObject({ structuredContent: { corrected: true } });
    expect((await call(s.b, "get_transcript", { conversationId: id })).structuredContent.transcript).toBeNull();
    expect(await call(s.a, "correct", { action: "share_transcript", id })).toMatchObject({ structuredContent: { corrected: true } });
    expect((await call(s.b, "get_transcript", { conversationId: id })).structuredContent.transcript).toContain("worried about money");
  });

  test("B's briefing never shows A's private item from a ramble recorded through MCP", async () => {
    await call(s.a, "record_conversation", ramble());
    const mine = JSON.stringify((await call(s.a, "briefing", { personId: s.anna })).structuredContent);
    expect(mine).toContain("worried about money");
    const r = await call(s.b, "briefing", { personId: s.anna });
    const theirs = JSON.stringify(r);
    expect(r.structuredContent.current.map((f: { text: string }) => f.text).sort()).toEqual(["likes hiking", "new job", "training for a marathon"]);
    for (const secret of ["worried about money", "divorce", "partner"]) expect(theirs).not.toContain(secret);
  });

  test("B never sees A's private relationship or group membership through find_person or briefing", async () => {
    await call(s.a, "relate", { kind: "relationship", from: s.lena, to: s.anna, type: "sibling", visibility: "private" });
    await call(s.a, "relate", { kind: "group", name: "Therapy group", members: [s.anna, s.lena], visibility: "private" });
    expect((await call(s.a, "find_person", { name: "Lena" })).structuredContent.people[0].context).toContain("sibling of Anna");
    const seen = JSON.stringify([await call(s.b, "find_person", { name: "Lena" }), await call(s.b, "find_person", { name: "Anna" }), await call(s.b, "briefing", { personId: s.anna }), await call(s.b, "briefing", { personId: s.lena })]);
    for (const secret of ["sibling", "Therapy"]) expect(seen).not.toContain(secret);
  });

  test("structured content carries only the fields of the output schema", async () => {
    const r = await call(s.b, "find_person", { name: "Tom" });
    expect(Object.keys(r.structuredContent)).toEqual(["people"]);
    expect(Object.keys(r.structuredContent.people[0]).sort()).toEqual(["aliases", "context", "id", "name", "url"]);
  });
});
