import { beforeEach, expect, test } from "vitest";
import { briefing } from "./briefing";
import { getPerson } from "./people";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getConversation, recordConversation, remember } from "./conversations";
import { fileContent, shareFile } from "./files";
import { db } from "./db/testing";
import { InvalidInputError, NotFoundError } from "./errors";
import { addDays, today } from "./dates";
import { findPlaces } from "./places";
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
  await expect(remember(s.a, { visibility: "shared", dates: [{ person: s.anna, kind: "birthday", date: "7.2.2024", yearly: true }] })).rejects.toThrow(
    InvalidInputError,
  );
  await expect(remember(s.a, { visibility: "shared" })).rejects.toThrow(InvalidInputError);
});

const fact = async (text: string) =>
  (await db()).selectFrom("facts").select(["id", "kind", "check_after", "status"]).where("text", "=", text).executeTakeFirstOrThrow();

test("a situation gets a nudge date, six weeks out by default", async () => {
  await remember(s.a, { visibility: "shared", facts: [{ person: s.anna, text: "sucht ein Auto", category: "other", kind: "situation" }] });
  expect(await fact("sucht ein Auto")).toMatchObject({ kind: "situation", check_after: addDays(today(), 42) });
  await remember(s.a, {
    visibility: "shared",
    facts: [{ person: s.anna, text: "sucht eine Wohnung", category: "home", kind: "situation", checkAfter: "2026-12-01" }],
  });
  expect(await fact("sucht eine Wohnung")).toMatchObject({ kind: "situation", check_after: "2026-12-01" });
  await remember(s.a, { visibility: "shared", facts: [{ person: s.anna, text: "mag Riesling", category: "other" }] });
  expect(await fact("mag Riesling")).toMatchObject({ kind: "lasting", check_after: null });
  await expect(
    remember(s.a, { visibility: "shared", facts: [{ person: s.anna, text: "x", category: "other", checkAfter: "2026-12-01" }] }),
  ).rejects.toBeInstanceOf(InvalidInputError);
  await expect(
    remember(s.a, { visibility: "shared", facts: [{ person: s.anna, text: "x", category: "other", kind: "situation", checkAfter: "soon" }] }),
  ).rejects.toBeInstanceOf(InvalidInputError);
  await expect(
    remember(s.a, { visibility: "shared", facts: [{ person: s.anna, text: "x", category: "other", kind: "rumour" as "lasting" }] }),
  ).rejects.toBeInstanceOf(InvalidInputError);
});

test("superseding keeps a situation going and resets its nudge, unless it is lasting", async () => {
  await remember(s.a, { visibility: "shared", facts: [{ person: s.anna, text: "sucht ein Auto", category: "other", kind: "situation" }] });
  const old = await fact("sucht ein Auto");
  await remember(s.a, {
    visibility: "shared",
    facts: [{ person: s.anna, text: "hat zwei Autos in der engeren Wahl", category: "other", supersedes: old.id, checkAfter: addDays(today(), 10) }],
  });
  expect(await fact("hat zwei Autos in der engeren Wahl")).toMatchObject({ kind: "situation", check_after: addDays(today(), 10) });
  expect(await fact("sucht ein Auto")).toMatchObject({ status: "outdated" });
  const news = await fact("hat zwei Autos in der engeren Wahl");
  await remember(s.a, { visibility: "shared", facts: [{ person: s.anna, text: "fährt einen Golf", category: "other", kind: "lasting", supersedes: news.id }] });
  expect(await fact("fährt einen Golf")).toMatchObject({ kind: "lasting", check_after: null });
  // Superseding a lasting fact without a kind keeps it lasting.
  await remember(s.a, {
    visibility: "shared",
    facts: [{ person: s.anna, text: "fährt einen Polo", category: "other", supersedes: (await fact("fährt einen Golf")).id }],
  });
  expect(await fact("fährt einen Polo")).toMatchObject({ kind: "lasting", check_after: null });
});

test("news about a situation needs its new day, agreed with the user; nothing is filed without one", async () => {
  await remember(s.a, {
    visibility: "shared",
    facts: [{ person: s.anna, text: "baut ein Haus", category: "home", kind: "situation", checkAfter: addDays(today(), 120) }],
  });
  const old = await fact("baut ein Haus");
  await expect(
    remember(s.a, { visibility: "shared", facts: [{ person: s.anna, text: "der Rohbau steht", category: "home", supersedes: old.id }] }),
  ).rejects.toThrow(/needs a new checkAfter/);
  expect(await fact("baut ein Haus")).toMatchObject({ status: "current" });
  expect(await (await db()).selectFrom("facts").select("id").where("text", "=", "der Rohbau steht").execute()).toEqual([]);
  await remember(s.a, {
    visibility: "shared",
    facts: [{ person: s.anna, text: "zieht im Mai ein", category: "home", supersedes: old.id, checkAfter: "2027-05-15" }],
  });
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

test("a conversation filed from shared files keeps their transcripts, word for word, and the files are gone", async () => {
  process.env.DATA_DIR = mkdtempSync(join(tmpdir(), "fb-remember-"));
  const one = await shareFile(s.a, new TextEncoder().encode("Bild 1"), "text/plain");
  const two = await shareFile(s.a, new TextEncoder().encode("Bild 2"), "text/plain");
  const read = (id: string, transcript: string) =>
    db().then((d) =>
      d
        .updateTable("files")
        .set({ status: "pending", reading: JSON.stringify({ summary: "s", transcript, people: [] }) })
        .where("id", "=", id)
        .execute(),
    );
  await read(one.id, "[19:20] Patrick: Freitag Spieleabend bei Olivier");
  await read(two.id, "Foto: Anna und Tom auf dem Hochzeitsfest");
  await expect(
    recordConversation(s.b, {
      date: "2026-10-20",
      kind: "message",
      summary: "x",
      transcript: "t",
      visibility: "shared",
      fileIds: [one.id],
      people: [{ id: s.anna, present: true }],
    }),
  ).rejects.toThrow(NotFoundError);
  const c = await recordConversation(s.a, {
    date: "2026-10-20",
    kind: "message",
    summary: "Chat",
    transcript: "Marcel: Schau mal, was in der Gruppe steht.",
    visibility: "shared",
    fileIds: [one.id, two.id],
    people: [{ id: s.anna, present: true }],
    facts: [{ person: 0, text: "plant einen Spieleabend", category: "hobby" }],
  });
  const conv = await getConversation(s.a, c.conversationId);
  expect(conv.transcript).toBe(
    "Marcel: Schau mal, was in der Gruppe steht.\n\n--- Aus einer geteilten Datei ---\n[19:20] Patrick: Freitag Spieleabend bei Olivier\n\n--- Aus einer geteilten Datei ---\nFoto: Anna und Tom auf dem Hochzeitsfest",
  );
  expect(await (await db()).selectFrom("files").select("id").where("id", "in", [one.id, two.id]).execute()).toEqual([]);
  expect(await fileContent(s.a, one.id)).toBeNull();
  expect((await (await db()).selectFrom("facts").select("file_id").where("text", "=", "plant einen Spieleabend").executeTakeFirstOrThrow()).file_id).toBeNull();
  // A file already filed is gone: it can't be taken again.
  await expect(
    recordConversation(s.a, {
      date: "2026-10-20",
      kind: "message",
      summary: "x",
      transcript: "t",
      visibility: "shared",
      fileIds: [one.id],
      people: [{ id: s.anna, present: true }],
    }),
  ).rejects.toThrow(NotFoundError);
});

test("a home told outside a conversation files a place owned by the person", async () => {
  const r = await remember(s.a, {
    visibility: "shared",
    homes: [{ person: s.anna, place: { name: "Annas Wohnung", in: "Nürnberg", address: "Hauptstraße 5" } }],
  });
  expect(r.counts.homes).toBe(1);
  const [p] = await findPlaces(s.b, "Annas Wohnung");
  expect(p).toMatchObject({ address: "Hauptstraße 5", owners: [{ id: s.anna }], parents: [{ name: "Nürnberg" }] });
});
