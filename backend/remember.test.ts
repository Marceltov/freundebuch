import { beforeEach, expect, test } from "vitest";
import { briefing } from "./briefing";
import { remember } from "./conversations";
import { db } from "./db/testing";
import { InvalidInputError, NotFoundError } from "./errors";
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
  expect(b.current.map((f) => f.text)).toContain("Patenkind von Anna");
});

test("a private item stays the recorder's", async () => {
  await remember(s.a, { visibility: "shared", facts: [{ person: s.anna, text: "worried about money", category: "other", private: true }] });
  expect((await briefing(s.a, s.anna)).current.map((f) => f.text)).toContain("worried about money");
  expect(JSON.stringify(await briefing(s.b, s.anna))).not.toContain("worried about money");
});

test("an unknown person or a bad date is refused, and nothing is filed", async () => {
  await expect(remember(s.a, { visibility: "shared", facts: [{ person: "nope", text: "x", category: "other" }] })).rejects.toThrow(NotFoundError);
  await expect(remember(s.a, { visibility: "shared", dates: [{ person: s.anna, kind: "birthday", date: "7.2.2024", yearly: true }] })).rejects.toThrow(InvalidInputError);
  await expect(remember(s.a, { visibility: "shared" })).rejects.toThrow(InvalidInputError);
});
