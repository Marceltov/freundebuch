import { beforeEach, expect, test } from "vitest";
import { markOutdated } from "./corrections";
import { remember } from "./conversations";
import { InvalidInputError, NotFoundError } from "./errors";
import { addToGroup } from "./relationships";
import { traitsFor } from "./traits";
import { seed, type Seed } from "./testing/fixtures";

let s: Seed;

beforeEach(async () => {
  s = await seed();
});

const texts = (fs: { text: string }[]) => fs.map((f) => f.text);

test("people and groups are listed once each, the people named first, each with needs and personality apart", async () => {
  const g = await addToGroup(s.a, { name: "Laufgruppe", members: [s.tom, s.anna], visibility: "shared" });
  await remember(s.a, {
    visibility: "shared",
    facts: [
      { person: s.anna, text: "vegetarian", category: "health", kind: "need" },
      { person: s.anna, text: "shy in big groups", category: "other", kind: "personality" },
    ],
  });
  const r = await traitsFor(s.a, { people: [s.anna], groups: [g.id] });
  expect(r.map((p) => p.name)).toEqual(["Anna", "Tom"]);
  expect(r[0]).toMatchObject({ id: s.anna, url: `/p/${s.anna}` });
  expect(texts(r[0].needs)).toEqual(["vegetarian"]);
  expect(texts(r[0].personality)).toEqual(["shy in big groups"]);
  expect(r[1]).toMatchObject({ id: s.tom, needs: [], personality: [] });
});

test("the partner's private membership doesn't bring its person into B's lookup", async () => {
  const g = await addToGroup(s.b, { name: "Chor", members: [s.anna], visibility: "shared" });
  await addToGroup(s.a, { name: "Chor", members: [s.lena], visibility: "private" });
  expect((await traitsFor(s.b, { groups: [g.id] })).map((p) => p.name)).toEqual(["Anna"]);
});

test("B never sees A's private trait", async () => {
  await remember(s.a, { visibility: "private", facts: [{ person: s.tom, text: "needs a wheelchair", category: "health", kind: "need" }] });
  const [tom] = await traitsFor(s.b, { people: [s.tom] });
  expect(tom.needs).toEqual([]);
  expect(JSON.stringify(tom)).not.toContain("wheelchair");
  expect(texts((await traitsFor(s.a, { people: [s.tom] }))[0].needs)).toEqual(["needs a wheelchair"]);
});

test("an empty lookup is refused; an unknown person or a group the viewer can't see is not found", async () => {
  await expect(traitsFor(s.a, {})).rejects.toThrow(InvalidInputError);
  await expect(traitsFor(s.a, { people: ["nobody"] })).rejects.toThrow(NotFoundError);
  const mine = await addToGroup(s.a, { name: "Geheim", members: [s.anna], visibility: "private" });
  await expect(traitsFor(s.b, { groups: [mine.id] })).rejects.toThrow(NotFoundError);
});

test("someone named and in a group keeps the place they were named at", async () => {
  const g = await addToGroup(s.a, { name: "Laufgruppe", members: [s.anna, s.tom], visibility: "shared" });
  expect((await traitsFor(s.a, { people: [s.tom], groups: [g.id] })).map((p) => p.name)).toEqual(["Tom", "Anna"]);
});

test("an outdated trait is gone from the lookup", async () => {
  const r = await remember(s.a, { visibility: "shared", facts: [{ person: s.anna, text: "nut allergy", category: "health", kind: "need" }] });
  await markOutdated(s.a, r.filed.facts[0].id);
  expect((await traitsFor(s.a, { people: [s.anna] }))[0].needs).toEqual([]);
});
