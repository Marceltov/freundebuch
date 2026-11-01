import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { IDENTITY_COOKIE } from "../auth/session";
import { sign } from "../auth/tokens";
import { resetSecretForTests } from "../core/secret";
import { asRamble, seed, seedWorkBook, type Seed } from "../testing/fixtures";
import type { Viewer } from "../core/types";
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
  const res = await dispatch(
    new Request(`${BASE}/api/v1${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) }),
    path.slice(1).split("?")[0].split("/"),
  );
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
    expect(found.json[0]).toMatchObject({ id: s.tom, name: "Tom", context: ["Partner:in of Anna"] });
    expect((await call(s.a, "GET", `/people/${s.anna}`)).json).toMatchObject({ id: s.anna, name: "Anna" });
    expect((await call(s.a, "GET", "/people/nope")).status).toBe(404);
  });

  test("search finds only what the caller may see", async () => {
    const res = await call(s.a, "GET", "/search?q=divorce");
    expect(res.status).toBe(200);
    expect(res.json.hits.map((h: { kind: string }) => h.kind).sort()).toEqual(["fact", "transcript"]);
    expect((await call(s.b, "GET", "/search?q=divorce")).json).toEqual({ hits: [] });
    expect((await call(s.a, "GET", "/search?q=%20")).status).toBe(400);
    expect((await call(s.a, "GET", "/search")).status).toBe(400);
  });

  test("rename a person", async () => {
    expect((await call(s.a, "PATCH", `/people/${s.lena}`, { name: "Lena Hoffmann" })).status).toBe(204);
    expect((await call(s.b, "GET", `/people/${s.lena}`)).json.name).toBe("Lena Hoffmann");
    expect((await call(s.a, "PATCH", `/people/${s.lena}`, { name: " " })).status).toBe(400);
  });

  test("set a person's look, which the other user sees too", async () => {
    const look = { face: "round", skin: "fair", hair: "curly", hairColor: "red", glasses: "round", beard: "none" };
    expect((await call(s.a, "PATCH", `/people/${s.lena}`, { look })).status).toBe(204);
    expect((await call(s.b, "GET", `/people/${s.lena}`)).json.look).toEqual({ ...look, description: null });
    expect((await call(s.a, "PATCH", `/people/${s.lena}`, { look: { ...look, hair: "mohawk" } })).status).toBe(400);
    expect((await call(s.a, "PATCH", `/people/${s.lena}`, { look: null })).status).toBe(204);
    expect((await call(s.b, "GET", `/people/${s.lena}`)).json.look).toBeNull();
  });

  test("briefing", async () => {
    const res = await call(s.a, "GET", `/people/${s.anna}/briefing`);
    expect(res.status).toBe(200);
    expect(res.json.person.url).toBe(`${BASE}/p/${s.anna}`);
    expect(res.json.known[0].url).toBe(`${BASE}/p/${s.anna}#facts-${res.json.known[0].id}`);
    expect(res.json.person.name).toBe("Anna");
    expect(res.json.known.map((f: { text: string }) => f.text).sort()).toEqual(["divorce", "likes hiking", "new job"]);
  });

  test("traits of people and groups; nothing named is 400", async () => {
    const res = await call(s.a, "GET", `/traits?people=${s.anna},${s.tom}`);
    expect(res.status).toBe(200);
    expect(res.json.people.map((p: { name: string }) => p.name)).toEqual(["Anna", "Tom"]);
    expect(res.json.people[0]).toMatchObject({ url: `${BASE}/p/${s.anna}`, needs: [], personality: [] });
    expect((await call(s.a, "GET", "/traits")).status).toBe(400);
    expect((await call(s.a, "GET", "/traits?groups=nope")).status).toBe(404);
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
    const rec = await call(
      s.a,
      "POST",
      "/rambles",
      asRamble(
        lunch({
          people: [
            { name: "Maxi", present: true },
            { name: "Max", present: false },
          ],
        }),
      ),
    );
    const [maxi, max] = rec.json.people.map((p: { id: string }) => p.id);
    expect((await call(s.a, "POST", `/people/${max}/merge`, { drop: maxi })).status).toBe(204);
    expect((await call(s.a, "GET", `/people/${maxi}`)).status).toBe(404);
    expect((await call(s.a, "POST", `/people/${max}/merge`, { drop: max })).status).toBe(400);
    expect((await call(s.a, "POST", `/people/${max}/merge`, {})).json.code).toBe("invalid_request");
  });

  test("orbit", async () => {
    await call(s.a, "POST", "/rambles", asRamble(lunch({ visibility: "private" }))); // the open promise keeps Max in the orbit
    const res = await call(s.a, "GET", "/orbit");
    expect(res.status).toBe(200);
    expect(res.json.find((f: { name: string }) => f.name === "Max")).toMatchObject({
      ring: expect.any(Number),
      angle: expect.any(Number),
      badges: ["promise"],
    });
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
    const rec = await call(s.a, "POST", "/rambles", asRamble(lunch()));
    expect(rec.status).toBe(201);
    expect(rec.json).toMatchObject({
      people: [{ ref: 0, name: "Max", created: true }],
      counts: { facts: 1, promises: 1, dates: 0, exchanges: 0, relationships: 0, groups: 0 },
    });
    const got = await call(s.a, "GET", `/conversations/${rec.json.conversations[0].id}`);
    expect(got.status).toBe(200);
    expect(got.json).toMatchObject({ summary: "Lunch with Max.", transcript: "Lunch with Max. He likes chess.", facts: [{ text: "likes chess" }] });
  });

  test("a new person named like an existing one is 409 ambiguous; confirmedNew creates them", async () => {
    const res = await call(s.a, "POST", "/rambles", asRamble(lunch({ people: [{ name: "Anna", present: true }] })));
    expect([res.status, res.json.code]).toEqual([409, "ambiguous"]);
    expect(res.json.error).toContain(s.anna);
    const ok = await call(s.a, "POST", "/rambles", asRamble(lunch({ people: [{ name: "Anna", present: true, confirmedNew: true }] })));
    expect(ok.status).toBe(201);
  });

  test("a conversation is recorded as a ramble now: POST /conversations is gone", async () => {
    expect((await call(s.a, "POST", "/conversations", lunch())).status).toBe(404);
  });

  test("the domain's validation answers: bad day, unknown person, nothing is written", async () => {
    const day = await call(s.a, "POST", "/rambles", asRamble(lunch({ date: "2026-13-40" })));
    expect([day.status, day.json.code]).toEqual([400, "invalid_input"]);
    const ref = await call(s.a, "POST", "/rambles", asRamble(lunch({ facts: [{ person: 5, text: "x", category: "work" }] })));
    expect([ref.status, ref.json.code]).toEqual([400, "invalid_input"]);
    const who = await call(s.a, "POST", "/rambles", asRamble(lunch({ people: [{ id: "nope", present: true }] })));
    expect(who.status).toBe(404);
    const shape = await call(s.a, "POST", "/rambles", { date: "2026-10-22" });
    expect([shape.status, shape.json.code]).toEqual([400, "invalid_request"]);
    expect((await call(s.a, "GET", "/people?q=Max")).json).toEqual([]);
  });

  async function recorded() {
    const rec = (await call(s.a, "POST", "/rambles", asRamble(lunch()))).json.conversations[0].id;
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

  test("B edits and deletes A's shared fact, marks a shared promise done, but can't change visibility or A's conversation", async () => {
    const r = await recorded();
    expect((await call(s.b, "PATCH", `/items/facts/${r.fact}`, { patch: { text: "x" } })).status).toBe(204);
    const vis = await call(s.b, "PATCH", `/items/facts/${r.fact}`, { visibility: "private" });
    expect([vis.status, vis.json.code]).toEqual([403, "forbidden"]);
    expect((await call(s.b, "PATCH", `/items/conversations/${r.conversation}`, { patch: { summary: "x" } })).status).toBe(403);
    expect((await call(s.b, "PATCH", `/items/promises/${r.promise}`, { done: true })).status).toBe(204);
    expect((await call(s.b, "DELETE", `/items/facts/${r.fact}`)).status).toBe(204);
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
      const res = await call(
        null,
        method.toUpperCase(),
        path.replace("/api/v1", "").replace(/\{\w+\}/g, "x"),
        method === "get" || method === "delete" ? undefined : {},
      );
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
    expect(anna.json.known.map((f: { text: string }) => f.text).sort()).toEqual(["likes hiking", "new job"]);
    expect(tom.json.person.name).toBe("Tom");
    expect(search.json.map((p: { id: string }) => p.id)).toEqual([s.tom]);
    expect(due.json).toEqual([]);
    for (const body of [anna.json, tom.json, search.json, due.json]) for (const secret of secrets) expect(JSON.stringify(body), secret).not.toContain(secret);
    expect((await call(s.b, "GET", `/people/${s.lena}/briefing`)).json.known).toEqual([]);
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
    expect((await call(s.a, "GET", "/me/settings")).json).toEqual({ webhookUrl: null, language: "de" });
    expect((await call(s.a, "PUT", "/me/settings", { webhookUrl: "https://ntfy.example/a" })).status).toBe(204);
    expect((await call(s.a, "GET", "/me/settings")).json).toEqual({ webhookUrl: "https://ntfy.example/a", language: "de" });
    expect((await call(s.b, "GET", "/me/settings")).json).toEqual({ webhookUrl: null, language: "de" });
    expect((await call(s.a, "PUT", "/me/settings", { webhookUrl: "ftp://x.example/" })).status).toBe(400);
    expect((await call(null, "GET", "/me/settings")).status).toBe(401);
  });

  test("a user sets their own language", async () => {
    expect((await call(s.a, "PUT", "/me/language", { language: "en" })).status).toBe(204);
    expect((await call(s.a, "GET", "/me/settings")).json.language).toBe("en");
    expect((await call(s.b, "GET", "/me/settings")).json.language).toBe("de");
    expect((await call(s.a, "PUT", "/me/language", { language: "fr" })).status).toBe(400);
  });

  test("testing without a webhook sends nothing", async () => {
    expect((await call(s.b, "POST", "/me/settings/test")).json).toEqual({ sent: false });
  });
});

describe("files", () => {
  test("list, close and discard the caller's waiting files; the share key is made and revoked", async () => {
    const { mkdtempSync } = await import("node:fs");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");
    const sharp = (await import("sharp")).default;
    const { readFile, shareFile } = await import("../conversations/files");
    vi.stubEnv("DATA_DIR", mkdtempSync(join(tmpdir(), "fb-api-")));
    const img = async (r: number) =>
      new Uint8Array(
        await sharp({ create: { width: 20, height: 20, channels: 3, background: { r, g: 0, b: 0 } } })
          .png()
          .toBuffer(),
      );
    const unsure = {
      read: async () => ({ summary: "Anna hat einen neuen Job", transcript: "Anna: Neuer Job!", people: [{ name: "Anna", candidates: [s.anna] }] }),
    };
    const one = await shareFile(s.a, await img(1));
    const two = await shareFile(s.a, await img(2));
    await readFile(s.a, one.id, unsure);
    await readFile(s.a, two.id, unsure);

    const list = await call(s.a, "GET", "/files");
    expect(list.status).toBe(200);
    expect(list.json).toHaveLength(2);
    expect(list.json[0]).toMatchObject({ url: `${BASE}/api/files/${two.id}`, type: "image/webp", summary: "Anna hat einen neuen Job", error: null });
    expect(list.json[0].people[0].candidates[0]).toEqual({ id: s.anna, name: "Anna", url: `${BASE}/p/${s.anna}` });
    expect((await call(s.b, "GET", "/files")).json).toEqual([]);

    expect((await call(s.a, "POST", `/files/${one.id}/resolve`, { personId: s.anna })).status).toBe(404);
    expect((await call(s.b, "POST", `/files/${one.id}/done`)).status).toBe(404);
    expect((await call(s.a, "POST", `/files/${one.id}/done`)).status).toBe(204);
    expect((await call(s.b, "DELETE", `/files/${two.id}`)).status).toBe(404);
    expect((await call(s.a, "DELETE", `/files/${two.id}`)).status).toBe(204);
    expect((await call(s.a, "GET", "/files")).json).toEqual([]);

    const key = await call(s.a, "POST", "/me/share-key");
    expect(key.json.key).toMatch(/^fbs_/);
    expect((await call(s.a, "DELETE", "/me/share-key")).status).toBe(204);
  });
});

describe("calendar feed", () => {
  test("make, look at and revoke the caller's feed URL", async () => {
    expect((await call(s.a, "GET", "/me/calendar-feed")).json).toEqual({ active: false, created: false, url: null });
    const made = await call(s.a, "POST", "/me/calendar-feed");
    expect(made.status).toBe(200);
    expect(made.json).toMatchObject({ active: true, created: true });
    expect(made.json.url).toMatch(new RegExp(`^${BASE}/api/calendar/fbc_[\\w-]{43}\\.ics$`));
    expect((await call(s.a, "GET", "/me/calendar-feed")).json).toEqual({ active: true, created: false, url: null });
    expect((await call(s.b, "GET", "/me/calendar-feed")).json.active).toBe(false);
    expect((await call(s.a, "DELETE", "/me/calendar-feed")).status).toBe(204);
    expect((await call(s.a, "GET", "/me/calendar-feed")).json.active).toBe(false);
    expect((await call(null, "POST", "/me/calendar-feed")).status).toBe(401);
  });
});

describe("roles and situations", () => {
  test("PATCH a person's gender, and the briefing carries it", async () => {
    expect((await call(s.a, "PATCH", `/people/${s.anna}`, { gender: "female" })).status).toBe(204);
    expect((await call(s.b, "GET", `/people/${s.anna}/briefing`)).json.person.gender).toBe("female");
    expect((await call(s.b, "GET", `/people/${s.anna}`)).json.gender).toBe("female");
    expect((await call(s.a, "PATCH", `/people/${s.anna}`, { gender: null, name: "Anna B." })).status).toBe(204);
    expect((await call(s.a, "GET", `/people/${s.anna}`)).json).toMatchObject({ name: "Anna B.", gender: null });
    expect((await call(s.a, "PATCH", `/people/${s.anna}`, {})).status).toBe(400);
    expect((await call(s.a, "PATCH", `/people/${s.anna}`, { gender: "x" })).status).toBe(400);
  });

  test("a fact becomes a relationship to us; a fact's kind is patched; a conversation files a role", async () => {
    const r = await call(s.a, "POST", "/rambles", asRamble(lunch({ facts: [{ person: 0, text: "unser Vermieter", category: "home" }] })));
    expect(r.status).toBe(201);
    const max = r.json.people[0].id;
    const fact = (await call(s.a, "GET", `/people/${max}/briefing`)).json.known[0].id;
    const moved = await call(s.a, "POST", `/items/facts/${fact}/relationship`, { from: max, to: "us", label: "Vermieter:in", inverse: "Mieter:in" });
    expect(moved.status).toBe(201);
    expect(moved.json.ids).toHaveLength(2);
    expect((await call(s.b, "GET", `/people/${max}/briefing`)).json.roles).toMatchObject([{ label: "Vermieter:in", with: "us" }]);
    expect((await call(s.b, "POST", `/items/facts/${fact}/relationship`, { from: max, to: "us", label: "Vermieter:in", inverse: "Mieter:in" })).status).toBe(
      404,
    );

    const again = await call(
      s.a,
      "POST",
      "/rambles",
      asRamble(
        lunch({
          people: [{ id: max, present: true }],
          facts: [{ person: 0, text: "sucht ein Auto", category: "other" }],
          relationships: [{ from: 0, to: "me", label: "Nachbar:in", inverse: "Nachbar:in" }],
        }),
      ),
    );
    expect(again.json.counts.relationships).toBe(1);
    const car = (await call(s.a, "GET", `/people/${max}/briefing`)).json.known.find((f: { text: string }) => f.text === "sucht ein Auto").id;
    expect((await call(s.a, "PATCH", `/items/facts/${car}`, { patch: { kind: "situation", checkAfter: "2026-10-01" } })).status).toBe(204);
    const b = (await call(s.a, "GET", `/people/${max}/briefing`)).json;
    expect(b.situations).toMatchObject([{ text: "sucht ein Auto", checkAfter: "2026-10-01", nudge: true }]);
    expect((await call(s.a, "GET", "/due")).json.find((i: { kind: string }) => i.kind === "situation")).toMatchObject({
      text: "sucht ein Auto",
      url: `${BASE}/p/${max}#facts-${car}`,
    });
  });
});

describe("journal", () => {
  test("GET /journal lists the caller's entries; the partner's private ones never", async () => {
    await call(s.a, "POST", "/rambles", {
      date: "2026-10-20",
      transcript: "t",
      visibility: "shared",
      people: [],
      journal: [{ text: "Privat" }, { text: "Geteilt", shared: true }],
    });
    const a = await call(s.a, "GET", "/journal?from=2026-10-01&to=2026-10-31");
    expect(a.status).toBe(200);
    expect(a.json.entries.map((e: { text: string }) => e.text).sort()).toEqual(["Geteilt", "Privat"]);
    expect(a.json.entries[0].url).toMatch(new RegExp(`^${BASE}/tagebuch#journal-`));
    const b = await call(s.b, "GET", "/journal?from=2026-10-01&to=2026-10-31");
    expect(b.json.entries.map((e: { text: string }) => e.text)).toEqual(["Geteilt"]);
  });
});

describe("reflection", () => {
  test("GET and PUT /me/reflection: off by default, a day and an hour, null to turn it off", async () => {
    expect((await call(s.a, "GET", "/me/reflection")).json).toEqual({ reflection: null });
    expect((await call(s.a, "PUT", "/me/reflection", { reflection: { day: 0, hour: 18 } })).status).toBe(204);
    expect((await call(s.a, "GET", "/me/reflection")).json).toEqual({ reflection: { day: 0, hour: 18 } });
    expect((await call(s.a, "PUT", "/me/reflection", { reflection: { day: 9, hour: 18 } })).status).toBe(400);
    expect((await call(s.a, "PUT", "/me/reflection", { reflection: null })).status).toBe(204);
    expect((await call(s.b, "GET", "/me/reflection")).json).toEqual({ reflection: null });
  });
});

describe("rambles", () => {
  test("DELETE /rambles/{id}: the recorder deletes a ramble with every part; the partner can't, an unknown one is 404", async () => {
    const r = (
      await call(s.a, "POST", "/rambles", {
        date: "2026-10-29",
        transcript: "t",
        visibility: "shared",
        people: [{ id: s.anna }],
        conversations: [{ kind: "call", summary: "Anruf", present: [0] }],
      })
    ).json;
    expect((await call(s.b, "DELETE", `/rambles/${r.rambleId}`)).status).toBe(403);
    expect((await call(s.a, "DELETE", `/rambles/${r.rambleId}`)).status).toBe(204);
    expect((await call(s.a, "GET", `/conversations/${r.conversations[0].id}`)).status).toBe(404);
    expect((await call(s.a, "DELETE", `/rambles/${r.rambleId}`)).status).toBe(404);
  });
});

describe("experiences", () => {
  test("GET /experiences lists the caller's and shared ones; the partner never sees a private one", async () => {
    const ramble = (v: typeof s.a, title: string, extra: object = {}) =>
      call(v, "POST", "/rambles", {
        date: "2026-10-28",
        transcript: title,
        visibility: "shared",
        people: [],
        experiences: [{ kind: "Konzert", title, ...extra }],
      });
    expect((await ramble(s.a, "Wanda")).status).toBe(201);
    expect((await ramble(s.a, "Geheim", { private: true })).status).toBe(201);
    expect((await call(s.a, "GET", "/experiences?kind=Konzert")).json.experiences.map((e: { title: string }) => e.title).sort()).toEqual(["Geheim", "Wanda"]);
    expect((await call(s.b, "GET", "/experiences")).json.experiences.map((e: { title: string }) => e.title)).toEqual(["Wanda"]);
  });
});

describe("series and places", () => {
  test("GET /series/{id} and /places/{id}: the caller's, 404 for one the partner can't see", async () => {
    const r = (
      await call(s.a, "POST", "/rambles", {
        date: "2026-10-28",
        transcript: "t",
        visibility: "private",
        people: [],
        experiences: [{ kind: "Kurs", title: "Erste", place: "Praxis am Markt", series: { name: "Gruppe", rhythmDays: 7 } }],
      })
    ).json;
    const seriesId = r.experiences[0].seriesId;
    const series = await call(s.a, "GET", `/series/${seriesId}`);
    expect(series.status).toBe(200);
    expect(series.json.sessions).toHaveLength(1);
    const placeId = series.json.place.id;
    expect((await call(s.a, "GET", `/places/${placeId}`)).json.experiences).toHaveLength(1);
    expect((await call(s.b, "GET", `/series/${seriesId}`)).status).toBe(404);
    expect((await call(s.b, "GET", `/places/${placeId}`)).status).toBe(404);
  });

  test("GET /places by person and inside a place, and exactly one of q, person, inside", async () => {
    await call(s.a, "POST", "/rambles", {
      date: "2026-10-28",
      transcript: "t",
      visibility: "shared",
      people: [{ id: s.anna }],
      conversations: [{ kind: "in_person", summary: "Konzert", present: [0], place: { name: "Olympiahalle", in: "München" } }],
    });
    const byPerson = await call(s.a, "GET", `/places?person=${s.anna}`);
    const oly = byPerson.json.find((p: { name: string }) => p.name === "Olympiahalle");
    expect(oly).toMatchObject({ times: 1, last: "2026-10-28", parents: [{ name: "München" }] });
    const inside = await call(s.a, "GET", `/places?inside=${oly.parents[0].id}`);
    expect(inside.json.map((p: { name: string }) => p.name)).toEqual(["Olympiahalle"]);
    expect((await call(s.a, "GET", "/places")).status).toBe(400);
    expect((await call(s.a, "GET", `/places?q=x&person=${s.anna}`)).status).toBe(400);
  });
});

test("a REST call on an Arbeit person works, and lists show the oldest book unless a book is named", async () => {
  const w = await seedWorkBook(s);
  expect((await call(s.a, "GET", `/people/${w.boss}`)).status).toBe(200);
  const names = async (path: string) => ((await call(s.a, "GET", path)).json as { name: string }[]).map((p) => p.name);
  expect(await names("/people")).not.toContain("Chefin");
  expect(await names("/people?book=Arbeit")).toContain("Chefin");
  expect((await call(s.a, "GET", "/people?book=Nope")).status).toBe(404);
  expect((await call(s.b, "GET", `/people/${w.boss}`)).status).toBe(404);
});
