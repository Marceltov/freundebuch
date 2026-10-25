import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { IDENTITY_COOKIE } from "../auth/session";
import { sign } from "../auth/tokens";
import { resetSecretForTests } from "../secret";
import { seed, type Seed } from "../testing/fixtures";
import type { Viewer } from "../types";
import { dispatch } from "./api";

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- the tests read response bodies by shape, which the API tests check
type Json = any;

const BASE = "http://localhost:3000";
let s: Seed;

beforeEach(async () => {
  vi.stubEnv("FREUNDEBUCH_SECRET", "s".repeat(40));
  resetSecretForTests();
  s = await seed();
});
afterEach(() => {
  vi.unstubAllEnvs();
  resetSecretForTests();
});

// A request as `viewer` (null: signed out), from the app's own pages.
async function call(viewer: Viewer | null, method: string, path: string, body?: unknown): Promise<{ status: number; json: Json }> {
  const headers: Record<string, string> = { host: "localhost:3000", origin: BASE };
  if (viewer) headers.cookie = `${IDENTITY_COOKIE}=${sign("identity", { uid: viewer.userId })}`;
  if (body !== undefined) headers["content-type"] = "application/json";
  const res = await dispatch(new Request(`${BASE}/api/v1${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) }), path.slice(1).split("?")[0].split("/"));
  const text = await res.text();
  return { status: res.status, json: text ? JSON.parse(text) : undefined };
}

const lunch = (over: object = {}) => ({
  date: "2026-10-22",
  kind: "in_person",
  summary: "Lunch with Max.",
  transcript: "Lunch with Max. He likes chess.",
  visibility: "shared",
  people: [{ name: "Max", present: true }],
  facts: [{ person: 0, text: "likes chess", category: "hobby" }],
  promises: [{ person: 0, text: "send the book", byMe: true }],
  ...over,
});

describe("people", () => {
  test("list, search, get", async () => {
    const all = await call(s.a, "GET", "/people");
    expect(all.status).toBe(200);
    expect(all.json.map((p: { name: string }) => p.name)).toEqual(expect.arrayContaining(["Alice", "Anna", "Tom", "Lena"]));
    const found = await call(s.a, "GET", "/people?q=Tom");
    expect(found.json[0]).toMatchObject({ id: s.tom, name: "Tom", context: ["partner of Anna"] });
    expect((await call(s.a, "GET", `/people/${s.anna}`)).json).toMatchObject({ id: s.anna, name: "Anna" });
    expect((await call(s.a, "GET", "/people/nope")).status).toBe(404);
  });

  test("rename a person", async () => {
    expect((await call(s.a, "PATCH", `/people/${s.lena}`, { name: "Lena Hoffmann" })).status).toBe(204);
    expect((await call(s.b, "GET", `/people/${s.lena}`)).json.name).toBe("Lena Hoffmann");
    expect((await call(s.a, "PATCH", `/people/${s.lena}`, { name: " " })).status).toBe(400);
  });

  test("briefing", async () => {
    const res = await call(s.a, "GET", `/people/${s.anna}/briefing`);
    expect(res.status).toBe(200);
    expect(res.json.person.url).toBe(`${BASE}/p/${s.anna}`);
    expect(res.json.current[0].url).toBe(`${BASE}/p/${s.anna}#facts-${res.json.current[0].id}`);
    expect(res.json.person.name).toBe("Anna");
    expect(res.json.current.map((f: { text: string }) => f.text).sort()).toEqual(["divorce", "likes hiking", "new job"]);
  });

  test("interval: set, then it shows in the briefing; out-of-range is 400", async () => {
    expect((await call(s.a, "PUT", `/people/${s.anna}/interval`, { days: 28, confirmed: true })).status).toBe(204);
    expect((await call(s.a, "GET", `/people/${s.anna}/briefing`)).json.freshness.intervalDays).toBe(28);
    const bad = await call(s.a, "PUT", `/people/${s.anna}/interval`, { days: 0 });
    expect([bad.status, bad.json.code]).toEqual([400, "invalid_input"]);
    expect((await call(s.a, "PUT", `/people/${s.anna}/interval`, { days: "x" })).json.code).toBe("invalid_request");
    expect((await call(s.a, "PUT", "/people/nope/interval", { days: 7 })).status).toBe(404);
  });

  test("aliases: add one, then the person is found by it", async () => {
    expect((await call(s.a, "POST", `/people/${s.anna}/aliases`, { alias: "Anni" })).status).toBe(204);
    expect((await call(s.b, "GET", "/people?q=Anni")).json[0]).toMatchObject({ id: s.anna, aliases: ["Anni"] });
    expect((await call(s.a, "POST", `/people/${s.anna}/aliases`, { alias: " " })).json.code).toBe("invalid_input");
    expect((await call(s.a, "POST", `/people/${s.anna}/aliases`, {})).json.code).toBe("invalid_request");
    expect((await call(s.a, "POST", "/people/nope/aliases", { alias: "x" })).status).toBe(404);
  });

  test("merge moves a duplicate into the person and deletes it", async () => {
    const rec = await call(s.a, "POST", "/conversations", lunch({ people: [{ name: "Maxi", present: true }, { name: "Max", present: false }] }));
    const [maxi, max] = rec.json.people.map((p: { id: string }) => p.id);
    expect((await call(s.a, "POST", `/people/${max}/merge`, { drop: maxi })).status).toBe(204);
    expect((await call(s.a, "GET", `/people/${maxi}`)).status).toBe(404);
    expect((await call(s.a, "POST", `/people/${max}/merge`, { drop: max })).status).toBe(400);
    expect((await call(s.a, "POST", `/people/${max}/merge`, {})).json.code).toBe("invalid_request");
  });

  test("orbit", async () => {
    await call(s.a, "POST", "/conversations", lunch({ visibility: "private" })); // the open promise keeps Max in the orbit
    const res = await call(s.a, "GET", "/orbit");
    expect(res.status).toBe(200);
    expect(res.json.find((f: { name: string }) => f.name === "Max")).toMatchObject({ ring: expect.any(Number), angle: expect.any(Number), badges: ["promise"] });
    // For B, Max is only someone B never met: no promise badge.
    expect((await call(s.b, "GET", "/orbit")).json.find((f: { name: string }) => f.name === "Max")).toMatchObject({ unseen: true, badges: [] });
    expect((await call(null, "GET", "/orbit")).status).toBe(401);
  });

  test("due", async () => {
    const res = await call(s.a, "GET", "/due");
    expect(res.status).toBe(200);
    expect(Array.isArray(res.json)).toBe(true);
  });
});

describe("conversations and items", () => {
  test("record answers 201 with the Recorded shape, and the conversation reads back", async () => {
    const rec = await call(s.a, "POST", "/conversations", lunch());
    expect(rec.status).toBe(201);
    expect(rec.json).toMatchObject({ people: [{ ref: 0, name: "Max", created: true }], counts: { facts: 1, promises: 1, dates: 0, exchanges: 0, relationships: 0, groups: 0 } });
    const got = await call(s.a, "GET", `/conversations/${rec.json.conversationId}`);
    expect(got.status).toBe(200);
    expect(got.json).toMatchObject({ summary: "Lunch with Max.", transcript: "Lunch with Max. He likes chess.", facts: [{ text: "likes chess" }] });
  });

  test("a new person named like an existing one is 409 ambiguous; confirmedNew creates them", async () => {
    const res = await call(s.a, "POST", "/conversations", lunch({ people: [{ name: "Anna", present: true }] }));
    expect([res.status, res.json.code]).toEqual([409, "ambiguous"]);
    expect(res.json.error).toContain(s.anna);
    const ok = await call(s.a, "POST", "/conversations", lunch({ people: [{ name: "Anna", present: true, confirmedNew: true }] }));
    expect(ok.status).toBe(201);
  });

  test("the domain's validation answers: bad day, unknown person, nothing is written", async () => {
    const day = await call(s.a, "POST", "/conversations", lunch({ date: "2026-13-40" }));
    expect([day.status, day.json.code]).toEqual([400, "invalid_input"]);
    const ref = await call(s.a, "POST", "/conversations", lunch({ facts: [{ person: 5, text: "x", category: "work" }] }));
    expect([ref.status, ref.json.code]).toEqual([400, "invalid_input"]);
    const who = await call(s.a, "POST", "/conversations", lunch({ people: [{ id: "nope", present: true }] }));
    expect(who.status).toBe(404);
    const shape = await call(s.a, "POST", "/conversations", { date: "2026-10-22" });
    expect([shape.status, shape.json.code]).toEqual([400, "invalid_request"]);
    expect((await call(s.a, "GET", "/people?q=Max")).json).toEqual([]);
  });

  async function recorded() {
    const rec = (await call(s.a, "POST", "/conversations", lunch())).json.conversationId;
    const c = (await call(s.a, "GET", `/conversations/${rec}`)).json;
    return { conversation: rec as string, fact: c.facts[0].id as string, promise: c.promises[0].id as string };
  }

  test("PATCH: done, outdated, visibility, patch", async () => {
    const r = await recorded();
    expect((await call(s.a, "PATCH", `/items/promises/${r.promise}`, { done: true })).status).toBe(204);
    expect((await call(s.a, "PATCH", `/items/facts/${r.fact}`, { outdated: true })).status).toBe(204);
    expect((await call(s.a, "PATCH", `/items/facts/${r.fact}`, { patch: { text: "plays chess" } })).status).toBe(204);
    expect((await call(s.a, "PATCH", `/items/facts/${r.fact}`, { visibility: "private" })).status).toBe(204);
    const c = (await call(s.a, "GET", `/conversations/${r.conversation}`)).json;
    expect(c.promises[0].done).toBe(true);
    expect(c.facts[0]).toMatchObject({ status: "outdated", text: "plays chess", visibility: "private" });
  });

  test("PATCH needs exactly one action, and the right table for it", async () => {
    const r = await recorded();
    for (const body of [{}, { done: true, visibility: "private" }, { outdated: true, patch: {} }]) {
      const res = await call(s.a, "PATCH", `/items/promises/${r.promise}`, body);
      expect([res.status, res.json.code], JSON.stringify(body)).toEqual([400, "invalid_request"]);
    }
    expect((await call(s.a, "PATCH", `/items/promises/${r.promise}`, { done: false })).json.code).toBe("invalid_request");
    expect((await call(s.a, "PATCH", `/items/facts/${r.fact}`, { done: true })).json.code).toBe("invalid_input");
    expect((await call(s.a, "PATCH", `/items/promises/${r.promise}`, { outdated: true })).json.code).toBe("invalid_input");
    expect((await call(s.a, "PATCH", `/items/widgets/${r.fact}`, { patch: {} })).json.code).toBe("invalid_input");
  });

  test("PATCH transcriptShared on a conversation: the recorder's only way to share a transcript", async () => {
    const r = await recorded();
    expect((await call(s.a, "PATCH", `/items/facts/${r.fact}`, { visibility: "private" })).status).toBe(204);
    expect((await call(s.b, "GET", `/conversations/${r.conversation}`)).json.transcript).toBeNull();
    expect((await call(s.a, "PATCH", `/items/facts/${r.fact}`, { visibility: "shared" })).status).toBe(204);
    expect((await call(s.b, "GET", `/conversations/${r.conversation}`)).json.transcript).toBeNull();
    expect((await call(s.b, "PATCH", `/items/conversations/${r.conversation}`, { transcriptShared: true })).status).toBe(403);
    expect((await call(s.a, "PATCH", `/items/facts/${r.fact}`, { transcriptShared: true })).json.code).toBe("invalid_input");
    expect((await call(s.a, "PATCH", `/items/conversations/${r.conversation}`, { transcriptShared: true, done: true })).json.code).toBe("invalid_request");
    expect((await call(s.a, "PATCH", `/items/conversations/${s.dinner}`, { transcriptShared: true })).json.code).toBe("invalid_input"); // still holds private items
    expect((await call(s.a, "PATCH", `/items/conversations/${r.conversation}`, { transcriptShared: true })).status).toBe(204);
    expect((await call(s.b, "GET", `/conversations/${r.conversation}`)).json.transcript).toBe("Lunch with Max. He likes chess.");
  });

  test("only the recorder edits: B gets 403 on A's shared fact, and may mark a shared promise done", async () => {
    const r = await recorded();
    const edit = await call(s.b, "PATCH", `/items/facts/${r.fact}`, { patch: { text: "x" } });
    expect([edit.status, edit.json.code]).toEqual([403, "forbidden"]);
    expect((await call(s.b, "DELETE", `/items/facts/${r.fact}`)).status).toBe(403);
    expect((await call(s.b, "PATCH", `/items/promises/${r.promise}`, { done: true })).status).toBe(204);
  });

  test("DELETE removes the item", async () => {
    const r = await recorded();
    expect((await call(s.a, "DELETE", `/items/facts/${r.fact}`)).status).toBe(204);
    expect((await call(s.a, "GET", `/conversations/${r.conversation}`)).json.facts).toEqual([]);
    expect((await call(s.a, "DELETE", `/items/facts/${r.fact}`)).status).toBe(404);
  });
});

test("openapi.json is served, with this host as the server", async () => {
  const res = await call(s.a, "GET", "/openapi.json");
  expect(res.status).toBe(200);
  expect(res.json.openapi).toBe("3.1.1");
  expect(res.json.servers).toEqual([{ url: "http://localhost:3000" }]);
});

test("every route needs a sign-in", async () => {
  const doc = (await call(s.a, "GET", "/openapi.json")).json as { paths: Record<string, Record<string, unknown>> };
  for (const [path, item] of Object.entries(doc.paths))
    for (const method of Object.keys(item)) {
      const res = await call(null, method.toUpperCase(), path.replace("/api/v1", "").replace(/\{\w+\}/g, "x"), method === "get" || method === "delete" ? undefined : {});
      expect([res.status, method, path]).toEqual([401, method, path]);
    }
});

describe("privacy through the API: B never sees A's private items", () => {
  test("A's private conversation and private facts are 404 for B, on every route that takes them", async () => {
    const dinner = (await call(s.a, "GET", `/conversations/${s.dinner}`)).json;
    const divorce = dinner.facts.find((f: { text: string }) => f.text === "divorce").id;
    const quitting = (await call(s.a, "GET", `/conversations/${s.coffee}`)).json.facts[0].id;
    expect((await call(s.b, "GET", `/conversations/${s.coffee}`)).status).toBe(404);
    for (const id of [divorce, quitting]) {
      expect((await call(s.b, "PATCH", `/items/facts/${id}`, { outdated: true })).status).toBe(404);
      expect((await call(s.b, "PATCH", `/items/facts/${id}`, { visibility: "shared" })).status).toBe(404);
      expect((await call(s.b, "PATCH", `/items/facts/${id}`, { patch: { text: "x" } })).status).toBe(404);
      expect((await call(s.b, "DELETE", `/items/facts/${id}`)).status).toBe(404);
    }
    expect((await call(s.b, "PATCH", `/items/conversations/${s.coffee}`, { visibility: "shared" })).status).toBe(404);
    // Still there for A, untouched.
    expect((await call(s.a, "GET", `/conversations/${s.coffee}`)).json.facts[0].status).toBe("current");
  });

  test("B's dinner has the shared part only, and no transcript", async () => {
    const res = await call(s.b, "GET", `/conversations/${s.dinner}`);
    expect(res.status).toBe(200);
    expect(res.json.transcript).toBeNull();
    expect(res.json.summary).toBe("Dinner with Anna; she has a new job.");
    expect(res.json.facts.map((f: { text: string }) => f.text)).toEqual(["new job"]);
    const text = JSON.stringify(res.json);
    for (const secret of ["divorce", "partner", "--10-24", "Tom's birthday", "getting divorced"]) expect(text, secret).not.toContain(secret);
  });

  test("B's briefings, searches and due list hold none of A's private strings", async () => {
    const secrets = ["divorce", "partner", "--10-24", "2026-10-24", "Tom's birthday", "quitting", "Lena"];
    const [anna, tom, search, due] = await Promise.all([
      call(s.b, "GET", `/people/${s.anna}/briefing`),
      call(s.b, "GET", `/people/${s.tom}/briefing`),
      call(s.b, "GET", "/people?q=Tom"),
      call(s.b, "GET", "/due"),
    ]);
    // Each answered for real (not an error body that trivially lacks the secrets), with the shared part present.
    expect([anna.status, tom.status, search.status, due.status]).toEqual([200, 200, 200, 200]);
    expect(anna.json.current.map((f: { text: string }) => f.text).sort()).toEqual(["likes hiking", "new job"]);
    expect(tom.json.person.name).toBe("Tom");
    expect(search.json.map((p: { id: string }) => p.id)).toEqual([s.tom]);
    expect(due.json).toEqual([]);
    for (const body of [anna.json, tom.json, search.json, due.json]) for (const secret of secrets) expect(JSON.stringify(body), secret).not.toContain(secret);
    expect((await call(s.b, "GET", `/people/${s.lena}/briefing`)).json.current).toEqual([]);
  });
});

describe("groups", () => {
  test("list, create through another name, add and remove a member", async () => {
    const list = await call(s.a, "GET", "/groups");
    expect(list.status).toBe(200);
    const arbeit = list.json.find((g: { name: string }) => g.name === "Arbeit");
    expect(arbeit).toMatchObject({ aliases: ["Job", "Kollegen"], count: 0, url: `${BASE}/g/${arbeit.id}` });
    const created = await call(s.a, "POST", "/groups", { name: "kollegen" });
    expect(created.status).toBe(201);
    expect(created.json.id).toBe(arbeit.id);
    expect((await call(s.a, "PUT", `/groups/${arbeit.id}/members/${s.anna}`)).status).toBe(204);
    const one = await call(s.b, "GET", `/groups/${arbeit.id}`);
    expect(one.json.members.map((m: { name: string; url: string }) => [m.name, m.url])).toEqual([["Anna", `${BASE}/p/${s.anna}`]]);
    expect((await call(s.b, "DELETE", `/groups/${arbeit.id}/members/${s.anna}`)).status).toBe(204);
    expect((await call(s.a, "GET", `/groups/${arbeit.id}`)).json.members).toEqual([]);
  });

  test("rename, other names, merge and delete", async () => {
    const id = (await call(s.a, "POST", "/groups", { name: "Chor" })).json.id;
    expect((await call(s.a, "PATCH", `/groups/${id}`, { name: "Singen" })).status).toBe(204);
    expect((await call(s.a, "POST", `/groups/${id}/aliases`, { alias: "Choir" })).status).toBe(204);
    expect((await call(s.a, "POST", `/groups/${id}/aliases`, { alias: "Familie" })).status).toBe(400);
    expect((await call(s.a, "DELETE", `/groups/${id}/aliases/Choir`)).status).toBe(204);
    expect((await call(s.a, "GET", `/groups/${id}`)).json.aliases).toEqual(["Chor"]);
    const freunde = (await call(s.a, "GET", "/groups")).json.find((g: { name: string }) => g.name === "Freunde").id;
    expect((await call(s.a, "POST", `/groups/${freunde}/merge`, { drop: id })).status).toBe(204);
    expect((await call(s.a, "GET", `/groups/${id}`)).status).toBe(404);
    expect((await call(s.a, "DELETE", `/groups/${freunde}`)).status).toBe(204);
  });

  test("a group A made and filled with nobody B may see is a 404 for B", async () => {
    const id = (await call(s.a, "POST", "/groups", { name: "Therapie" })).json.id;
    expect((await call(s.b, "GET", `/groups/${id}`)).status).toBe(404);
    expect((await call(s.b, "GET", "/groups")).json.map((g: { name: string }) => g.name)).not.toContain("Therapie");
  });
});

describe("settings", () => {
  test("a user reads and sets their own webhook; another scheme is rejected; signed out is 401", async () => {
    expect((await call(s.a, "GET", "/me/settings")).json).toEqual({ webhookUrl: null });
    expect((await call(s.a, "PUT", "/me/settings", { webhookUrl: "https://ntfy.example/a" })).status).toBe(204);
    expect((await call(s.a, "GET", "/me/settings")).json).toEqual({ webhookUrl: "https://ntfy.example/a" });
    expect((await call(s.b, "GET", "/me/settings")).json).toEqual({ webhookUrl: null });
    expect((await call(s.a, "PUT", "/me/settings", { webhookUrl: "ftp://x.example/" })).status).toBe(400);
    expect((await call(null, "GET", "/me/settings")).status).toBe(401);
  });

  test("testing without a webhook sends nothing", async () => {
    expect((await call(s.b, "POST", "/me/settings/test")).json).toEqual({ sent: false });
  });
});

describe("screenshots", () => {
  test("list, resolve and discard the caller's waiting screenshots; the share key is made and revoked", async () => {
    const { mkdtempSync } = await import("node:fs");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");
    const sharp = (await import("sharp")).default;
    const { readScreenshot, shareScreenshot } = await import("../screenshots");
    vi.stubEnv("DATA_DIR", mkdtempSync(join(tmpdir(), "fb-api-")));
    const img = async (r: number) => new Uint8Array(await sharp({ create: { width: 20, height: 20, channels: 3, background: { r, g: 0, b: 0 } } }).png().toBuffer());
    const unsure = { read: async () => ({ kind: "post" as const, platform: "LinkedIn", text: "Neuer Job", category: "work" as const, happenedOn: null, sensitive: false, people: [{ name: "Anna", candidates: [s.anna] }] }) };
    const one = await shareScreenshot(s.a, await img(1));
    const two = await shareScreenshot(s.a, await img(2));
    await readScreenshot(one.id, unsure);
    await readScreenshot(two.id, unsure);

    const list = await call(s.a, "GET", "/screenshots");
    expect(list.status).toBe(200);
    expect(list.json).toHaveLength(2);
    expect(list.json[0].imageUrl).toBe(`${BASE}/api/screenshots/${two.id}`);
    expect(list.json[0].reading.people[0].candidates[0]).toEqual({ id: s.anna, name: "Anna", url: `${BASE}/p/${s.anna}` });
    expect((await call(s.b, "GET", "/screenshots")).json).toEqual([]);

    const done = await call(s.a, "POST", `/screenshots/${one.id}/resolve`, { personId: s.anna });
    expect(done.status).toBe(200);
    expect(done.json.url).toBe(`${BASE}/p/${s.anna}#facts-${done.json.factId}`);
    expect((await call(s.b, "DELETE", `/screenshots/${two.id}`)).status).toBe(404);
    expect((await call(s.a, "DELETE", `/screenshots/${two.id}`)).status).toBe(204);
    expect((await call(s.a, "GET", "/screenshots")).json).toEqual([]);

    const key = await call(s.a, "POST", "/me/share-key");
    expect(key.json.key).toMatch(/^fbs_/);
    expect((await call(s.a, "DELETE", "/me/share-key")).status).toBe(204);
  });
});
