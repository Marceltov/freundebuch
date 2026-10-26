import { beforeEach, expect, test } from "vitest";
import { briefing } from "./briefing";
import { remember } from "./conversations";
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
  await remember(s.a, { visibility: "shared", facts: [{ person: s.anna, text: "hat zwei Autos in der engeren Wahl", category: "other", supersedes: old.id }] });
  expect(await fact("hat zwei Autos in der engeren Wahl")).toMatchObject({ kind: "situation", check_after: addDays(today(), 42) });
  expect(await fact("sucht ein Auto")).toMatchObject({ status: "outdated" });
  const news = await fact("hat zwei Autos in der engeren Wahl");
  await remember(s.a, { visibility: "shared", facts: [{ person: s.anna, text: "fährt einen Golf", category: "other", kind: "lasting", supersedes: news.id }] });
  expect(await fact("fährt einen Golf")).toMatchObject({ kind: "lasting", check_after: null });
  // Superseding a lasting fact without a kind keeps it lasting.
  await remember(s.a, { visibility: "shared", facts: [{ person: s.anna, text: "fährt einen Polo", category: "other", supersedes: (await fact("fährt einen Golf")).id }] });
  expect(await fact("fährt einen Polo")).toMatchObject({ kind: "lasting", check_after: null });
});

test("news without a new date keeps the situation's interval", async () => {
  await remember(s.a, { visibility: "shared", facts: [{ person: s.anna, text: "baut ein Haus", category: "home", kind: "situation", checkAfter: addDays(today(), 120) }] });
  const old = await fact("baut ein Haus");
  await remember(s.a, { visibility: "shared", facts: [{ person: s.anna, text: "der Rohbau steht", category: "home", supersedes: old.id }] });
  expect(await fact("der Rohbau steht")).toMatchObject({ kind: "situation", check_after: addDays(today(), 120) });
  await remember(s.a, { visibility: "shared", facts: [{ person: s.anna, text: "zieht im Mai ein", category: "home", supersedes: (await fact("der Rohbau steht")).id, checkAfter: "2027-05-15" }] });
  expect(await fact("zieht im Mai ein")).toMatchObject({ kind: "situation", check_after: "2027-05-15" });
});
