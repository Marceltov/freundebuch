import { beforeEach, expect, test } from "vitest";
import { briefing } from "./briefing";
import { getPerson } from "./people";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { recordConversation, remember } from "./conversations";
import { markFiled, shareFile } from "./files";
import { db } from "./db/testing";
import { InvalidInputError, NotFoundError } from "./errors";
import { addDays, today } from "./dates";
import { seed, type Seed } from "./testing/fixtures";

let s: Seed;

beforeEach(async () => {
  s = await seed();
});

const conversations = async () => (await (await db()).selectFrom("conversations").select("id").execute()).length;

test("a birthday and a fact are filed about known people without making up a conversation", async () => {
  const before = await conversations();
  const r = await remember(s.a, {
    visibility: "shared",
    dates: [{ person: s.lena, kind: "birthday", date: "2024-02-07", yearly: true }],
    facts: [{ person: s.lena, text: "Patenkind von Anna", category: "family" }],
  });
  expect(r.counts).toMatchObject({ dates: 1, facts: 1, promises: 0, exchanges: 0 });
  expect(r.people).toEqual([{ id: s.lena, name: "Lena", url: `/p/${s.lena}` }]);
  expect(await conversations()).toBe(before);
  const b = await briefing(s.b, s.lena, "2026-10-25");
  expect(b.person.birthday).toMatchObject({ date: "2024-02-07", next: "2027-02-07" });
  expect(b.known.map((f) => f.text)).toContain("Patenkind von Anna");
});

test("a private item stays the recorder's", async () => {
  await remember(s.a, { visibility: "shared", facts: [{ person: s.anna, text: "worried about money", category: "other", private: true }] });
  expect((await briefing(s.a, s.anna)).known.map((f) => f.text)).toContain("worried about money");
  expect(JSON.stringify(await briefing(s.b, s.anna))).not.toContain("worried about money");
});

test("an unknown person or a bad date is refused, and nothing is filed", async () => {
  await expect(remember(s.a, { visibility: "shared", facts: [{ person: "nope", text: "x", category: "other" }] })).rejects.toThrow(NotFoundError);
  await expect(remember(s.a, { visibility: "shared", dates: [{ person: s.anna, kind: "birthday", date: "7.2.2024", yearly: true }] })).rejects.toThrow(InvalidInputError);
  await expect(remember(s.a, { visibility: "shared" })).rejects.toThrow(InvalidInputError);
});

const fact = async (text: string) => (await db()).selectFrom("facts").select(["id", "kind", "check_after", "status"]).where("text", "=", text).executeTakeFirstOrThrow();

test("a situation gets a nudge date, six weeks out by default", async () => {
  await remember(s.a, { visibility: "shared", facts: [{ person: s.anna, text: "sucht ein Auto", category: "other", kind: "situation" }] });
  expect(await fact("sucht ein Auto")).toMatchObject({ kind: "situation", check_after: addDays(today(), 42) });
  await remember(s.a, { visibility: "shared", facts: [{ person: s.anna, text: "sucht eine Wohnung", category: "home", kind: "situation", checkAfter: "2026-12-01" }] });
  expect(await fact("sucht eine Wohnung")).toMatchObject({ kind: "situation", check_after: "2026-12-01" });
  await remember(s.a, { visibility: "shared", facts: [{ person: s.anna, text: "mag Riesling", category: "other" }] });
  expect(await fact("mag Riesling")).toMatchObject({ kind: "lasting", check_after: null });
  await expect(remember(s.a, { visibility: "shared", facts: [{ person: s.anna, text: "x", category: "other", checkAfter: "2026-12-01" }] })).rejects.toBeInstanceOf(InvalidInputError);
  await expect(remember(s.a, { visibility: "shared", facts: [{ person: s.anna, text: "x", category: "other", kind: "situation", checkAfter: "soon" }] })).rejects.toBeInstanceOf(InvalidInputError);
  await expect(remember(s.a, { visibility: "shared", facts: [{ person: s.anna, text: "x", category: "other", kind: "rumour" as "lasting" }] })).rejects.toBeInstanceOf(InvalidInputError);
});

test("superseding keeps a situation going and resets its nudge, unless it is lasting", async () => {
  await remember(s.a, { visibility: "shared", facts: [{ person: s.anna, text: "sucht ein Auto", category: "other", kind: "situation" }] });
  const old = await fact("sucht ein Auto");
  await remember(s.a, { visibility: "shared", facts: [{ person: s.anna, text: "hat zwei Autos in der engeren Wahl", category: "other", supersedes: old.id, checkAfter: addDays(today(), 10) }] });
  expect(await fact("hat zwei Autos in der engeren Wahl")).toMatchObject({ kind: "situation", check_after: addDays(today(), 10) });
  expect(await fact("sucht ein Auto")).toMatchObject({ status: "outdated" });
  const news = await fact("hat zwei Autos in der engeren Wahl");
  await remember(s.a, { visibility: "shared", facts: [{ person: s.anna, text: "fährt einen Golf", category: "other", kind: "lasting", supersedes: news.id }] });
  expect(await fact("fährt einen Golf")).toMatchObject({ kind: "lasting", check_after: null });
  // Superseding a lasting fact without a kind keeps it lasting.
  await remember(s.a, { visibility: "shared", facts: [{ person: s.anna, text: "fährt einen Polo", category: "other", supersedes: (await fact("fährt einen Golf")).id }] });
  expect(await fact("fährt einen Polo")).toMatchObject({ kind: "lasting", check_after: null });
});

test("news about a situation needs its new day, agreed with the user; nothing is filed without one", async () => {
  await remember(s.a, { visibility: "shared", facts: [{ person: s.anna, text: "baut ein Haus", category: "home", kind: "situation", checkAfter: addDays(today(), 120) }] });
  const old = await fact("baut ein Haus");
  await expect(remember(s.a, { visibility: "shared", facts: [{ person: s.anna, text: "der Rohbau steht", category: "home", supersedes: old.id }] })).rejects.toThrow(/needs a new checkAfter/);
  expect(await fact("baut ein Haus")).toMatchObject({ status: "current" });
  expect(await (await db()).selectFrom("facts").select("id").where("text", "=", "der Rohbau steht").execute()).toEqual([]);
  await remember(s.a, { visibility: "shared", facts: [{ person: s.anna, text: "zieht im Mai ein", category: "home", supersedes: old.id, checkAfter: "2027-05-15" }] });
  expect(await fact("zieht im Mai ein")).toMatchObject({ kind: "situation", check_after: "2027-05-15" });
});

test("remember sets a gender, shared like the name, and checks it", async () => {
  const r = await remember(s.a, { visibility: "private", genders: [{ person: s.anna, gender: "female" }] });
  expect(r.counts).toMatchObject({ genders: 1, facts: 0 });
  expect(r.people.map((p) => p.id)).toEqual([s.anna]);
  expect((await getPerson(s.b, s.anna)).gender).toBe("female");
  await remember(s.b, { visibility: "shared", genders: [{ person: s.anna, gender: null }] });
  expect((await getPerson(s.a, s.anna)).gender).toBeNull();
  await expect(remember(s.a, { visibility: "shared", genders: [{ person: s.anna, gender: "other" as "female" }] })).rejects.toBeInstanceOf(InvalidInputError);
  await expect(remember(s.a, { visibility: "shared", genders: [{ person: "nope", gender: "male" }] })).rejects.toBeInstanceOf(NotFoundError);
});

test("a need and a personality trait are filed with their kind and no day to ask", async () => {
  const r = await remember(s.a, {
    visibility: "shared",
    facts: [
      { person: s.anna, text: "needs a wheelchair", category: "health", kind: "need" },
      { person: s.anna, text: "gets angry quickly", category: "other", kind: "personality" },
    ],
  });
  expect(r.filed.facts.map((f) => [f.kind, f.checkAfter])).toEqual([
    ["need", null],
    ["personality", null],
  ]);
});

test("a trait with a checkAfter is refused", async () => {
  await expect(
    remember(s.a, { visibility: "shared", facts: [{ person: s.anna, text: "vegetarian", category: "health", kind: "need", checkAfter: "2026-12-01" }] }),
  ).rejects.toThrow(InvalidInputError);
});

test("facts remembered from a shared file link to it; only the user's own waiting file is taken", async () => {
  process.env.DATA_DIR = mkdtempSync(join(tmpdir(), "fb-remember-"));
  const file = await shareFile(s.a, new TextEncoder().encode("Patrick: Wochenende war gut"), "text/plain");
  const r = await remember(s.a, { visibility: "shared", fileId: file.id, facts: [{ person: s.anna, text: "war am Wochenende wandern", category: "hobby" }] });
  const row = await (await db()).selectFrom("facts").select("file_id").where("id", "=", r.filed.facts[0].id).executeTakeFirstOrThrow();
  expect(row.file_id).toBe(file.id);
  await expect(remember(s.b, { visibility: "shared", fileId: file.id, facts: [{ person: s.anna, text: "x", category: "other" }] })).rejects.toThrow(NotFoundError);
  await expect(remember(s.a, { visibility: "shared", fileId: "nope", facts: [{ person: s.anna, text: "x", category: "other" }] })).rejects.toThrow(NotFoundError);
  await recordConversation(s.a, {
    date: "2026-10-20",
    kind: "message",
    summary: "Chat",
    transcript: "t",
    visibility: "shared",
    fileId: file.id,
    people: [{ id: s.anna, present: true }],
    facts: [{ person: 0, text: "plant einen Spieleabend", category: "hobby" }],
  });
  expect((await (await db()).selectFrom("facts").select("file_id").where("text", "=", "plant einen Spieleabend").executeTakeFirstOrThrow()).file_id).toBe(file.id);
  await markFiled(s.a, file.id);
  expect((await (await db()).selectFrom("files").select("status").where("id", "=", file.id).executeTakeFirstOrThrow()).status).toBe("filed");
  await expect(markFiled(s.a, file.id)).rejects.toThrow(NotFoundError);
});
