import { beforeEach, expect, test } from "vitest";
import { briefing } from "./briefing";
import { markOutdated } from "./corrections";
import { recordConversation, remember } from "./conversations";
import { addRelationship } from "./relationships";
import { buildNetwork } from "./network";
import { testDb } from "./db/testing";
import { NotFoundError } from "./errors";
import { setCheckInInterval } from "./intervals";
import { seed, type Seed } from "./testing/fixtures";
import type { Viewer } from "./types";

let s: Seed;

beforeEach(async () => {
  s = await seed();
});

const record = (v: Viewer, over: Partial<Parameters<typeof recordConversation>[1]>) =>
  recordConversation(v, {
    date: "2026-10-21",
    kind: "call",
    summary: "s",
    transcript: "t",
    visibility: "shared",
    people: [{ id: s.anna, present: true }],
    ...over,
  });

test("A's briefing on Anna holds everything, B's only the shared part", async () => {
  const a = await briefing(s.a, s.anna, "2026-10-23");
  expect(a.person).toEqual({ id: s.anna, name: "Anna", gender: null, aliases: [], url: `/p/${s.anna}`, birthday: null, look: null });
  expect(a.known.map((f) => f.text).sort()).toEqual(["divorce", "likes hiking", "new job"]);
  expect(a.relationships).toEqual([
    {
      id: expect.any(String),
      personId: s.tom,
      name: "Tom",
      label: "Partner:in",
      inverse: "Partner:in",
      note: null,
      direction: "out",
      url: `/p/${s.tom}`,
      visibility: "private",
      mine: true,
    },
  ]);
  expect(a.freshness).toEqual({ lastSeen: "2026-10-20", intervalDays: null, ratio: null });
  const b = await briefing(s.b, s.anna, "2026-10-23");
  expect(b.known.map((f) => f.text).sort()).toEqual(["likes hiking", "new job"]);
  expect(b.relationships).toEqual([]);
  expect(b.freshness.lastSeen).toBe("2026-10-15");
});

test("B's briefing on Anna and Tom never contains A's private items", async () => {
  for (const id of [s.anna, s.tom]) {
    const text = JSON.stringify(await briefing(s.b, id, "2026-10-23"));
    for (const secret of ["divorce", "partner", "--10-24", "2026-10-24", "Luigi"]) expect(text, `${id} ${secret}`).not.toContain(secret);
  }
  expect((await briefing(s.b, s.tom, "2026-10-23")).nextDates).toEqual([]);
  expect((await briefing(s.a, s.tom, "2026-10-23")).nextDates).toEqual([
    {
      id: expect.any(String),
      personId: s.tom,
      kind: "birthday",
      label: null,
      date: "2026-10-24",
      inDays: 1,
      age: null,
      url: expect.stringMatching(`^/p/${s.tom}#dates-`),
    },
  ]);
});

test("the birthday shows however far away it is, with the age when the year is known", async () => {
  const r = await record(s.a, { people: [{ name: "Sarah", present: true }], dates: [{ person: 0, kind: "birthday", date: "1990-03-15", yearly: true }] });
  const sarah = r.people[0].id;
  const a = await briefing(s.a, sarah, "2026-10-23");
  expect(a.nextDates).toEqual([]); // months away: beyond the 60 days of nextDates
  expect(a.person.birthday).toEqual({ id: expect.any(String), date: "1990-03-15", next: "2027-03-15", age: 37 });
  expect((await briefing(s.b, sarah, "2026-10-23")).person.birthday).toEqual({ id: expect.any(String), date: "1990-03-15", next: "2027-03-15", age: 37 });
  expect((await briefing(s.a, s.tom, "2026-10-23")).person.birthday).toEqual({ id: expect.any(String), date: "--10-24", next: "2026-10-24", age: null });
  expect((await briefing(s.b, s.tom, "2026-10-23")).person.birthday).toBeNull();
});

test("groups: the names of the groups the viewer may see the person in, each once", async () => {
  await record(s.a, {
    groups: [
      { name: "Uni", members: [0] },
      { name: "Climbing", members: [0], private: true },
    ],
  });
  await record(s.b, {
    groups: [
      { name: "Uni", members: [0] },
      { name: "Choir", members: [0] },
    ],
  });
  const names = async (v: Viewer) => (await briefing(v, s.anna, "2026-10-23")).groups.map((g) => g.name);
  expect(await names(s.a)).toEqual(["Choir", "Climbing", "Uni"]);
  expect(await names(s.b)).toEqual(["Choir", "Uni"]);
  for (const g of (await briefing(s.a, s.anna, "2026-10-23")).groups) expect(g.url).toBe(`/g/${g.id}`);
  // A sees which of their memberships only they can see: Climbing is A's private one; Uni is shared by B as well.
  expect((await briefing(s.a, s.anna, "2026-10-23")).groups.map((g) => [g.name, g.private])).toEqual([
    ["Choir", false],
    ["Climbing", true],
    ["Uni", false],
  ]);
  expect((await briefing(s.b, s.tom, "2026-10-23")).groups).toEqual([]);
});

test("superseded facts are not current", async () => {
  const old = (await (await testDb()).selectFrom("facts").select("id").where("text", "=", "new job").executeTakeFirstOrThrow()).id;
  await record(s.a, { facts: [{ person: 0, text: "started at the museum", category: "work", supersedes: old }] });
  const texts = (await briefing(s.a, s.anna, "2026-10-23")).known.map((f) => f.text);
  expect(texts).toContain("started at the museum");
  expect(texts).not.toContain("new job");
});

test("recent: the last 5 visible conversations, newest first, with the other participants' names but no items", async () => {
  for (let i = 1; i <= 5; i++) await record(s.b, { date: `2026-09-0${i}`, summary: `call ${i}` });
  const b = await briefing(s.b, s.anna, "2026-10-23");
  expect(b.recent.map((c) => c.date)).toEqual(["2026-10-20", "2026-10-15", "2026-09-05", "2026-09-04", "2026-09-03"]);
  expect(Object.keys(b.recent[0]).sort()).toEqual(["date", "id", "kind", "summary", "url", "withOthers"]);
  expect(b.recent[0].url).toBe(`/c/${b.recent[0].id}`);
  // The dinner had Alice (the viewer's partner, who recorded it) and Anna; Tom was only mentioned.
  expect(b.recent[0]).toMatchObject({ id: s.dinner, summary: "Dinner with Anna; she has a new job.", withOthers: ["Alice"] });
  expect(b.recent[1].withOthers).toEqual([]);
  const a = await briefing(s.a, s.anna, "2026-10-23");
  expect(a.recent[0].withOthers).toEqual([]); // the viewer is not "others"
});

test("recent lists others who were there, and hides a private conversation from the partner", async () => {
  await record(s.a, {
    date: "2026-10-22",
    people: [
      { id: s.anna, present: true },
      { id: s.tom, present: true },
      { id: s.lena, present: true },
    ],
  });
  await record(s.a, { date: "2026-10-22", summary: "private chat", visibility: "private" });
  const b = await briefing(s.b, s.anna, "2026-10-23");
  expect(b.recent[0].withOthers).toEqual(["Alice", "Lena", "Tom"]);
  expect(b.recent.map((c) => c.summary)).not.toContain("private chat");
  expect((await briefing(s.a, s.anna, "2026-10-23")).recent.map((c) => c.summary)).toContain("private chat");
});

test("open: undone promises, unsettled exchanges and gift ideas, each shown per visibility", async () => {
  await record(s.a, {
    promises: [
      { person: 0, text: "send photos", byMe: true, due: "2026-10-30" },
      { person: 0, text: "secret", byMe: false, private: true },
    ],
    exchanges: [
      { person: 0, kind: "lent", direction: "to_them", text: "my drill" },
      { person: 0, kind: "gift_idea", direction: "to_them", text: "a hiking book" },
      { person: 0, kind: "gift_idea", direction: "to_them", text: "secret gift", private: true },
    ],
  });
  const d = await testDb();
  await d.updateTable("promises").set({ done: 1 }).where("text", "=", "send photos").execute();
  await record(s.a, { promises: [{ person: 0, text: "call back", byMe: true }] });
  const a = (await briefing(s.a, s.anna, "2026-10-23")).open;
  expect(a.promises.map((p) => p.text).sort()).toEqual(["call back", "secret"]);
  expect(a.exchanges.map((e) => e.text)).toEqual(["my drill"]);
  expect(a.giftIdeas.map((g) => g.text).sort()).toEqual(["a hiking book", "secret gift"]);
  await d.updateTable("exchanges").set({ settled: 1 }).where("text", "=", "my drill").execute();
  expect((await briefing(s.a, s.anna, "2026-10-23")).open.exchanges).toEqual([]);
  const b = (await briefing(s.b, s.anna, "2026-10-23")).open;
  expect(b.promises.map((p) => p.text)).toEqual(["call back"]);
  expect(b.giftIdeas.map((g) => g.text)).toEqual(["a hiking book"]);
});

test("promises and exchanges read from the viewer's side: the partner's are theirs, by name", async () => {
  await record(s.a, {
    promises: [
      { person: 0, text: "send photos", byMe: true },
      { person: 0, text: "lend me her tent", byMe: false },
    ],
    exchanges: [{ person: 0, kind: "lent", direction: "to_them", text: "my drill" }],
  });
  const a = (await briefing(s.a, s.anna, "2026-10-23")).open;
  expect(a.promises.map((p) => [p.text, p.byMe, p.by])).toEqual([
    ["send photos", true, undefined],
    ["lend me her tent", false, undefined],
  ]);
  expect(a.exchanges.map((e) => [e.text, e.direction, e.by])).toEqual([["my drill", "to_them", undefined]]);
  // For B, Alice promised the photos and lent the drill; Anna's promise was to Alice.
  const b = (await briefing(s.b, s.anna, "2026-10-23")).open;
  expect(b.promises.map((p) => [p.text, p.byMe, p.by])).toEqual([
    ["send photos", false, "Alice"],
    ["lend me her tent", false, undefined],
  ]);
  expect(b.exchanges.map((e) => [e.text, e.direction, e.by])).toEqual([["my drill", "to_them", "Alice"]]);
});

test("nextDates look 60 days ahead; a birthday with a year carries the age", async () => {
  await record(s.a, {
    dates: [
      { person: 0, kind: "birthday", date: "1990-12-20", yearly: true },
      { person: 0, kind: "custom", date: "--12-23", label: "far", yearly: true },
    ],
  });
  const dates = (await briefing(s.a, s.anna, "2026-10-23")).nextDates;
  expect(dates.map((x) => [x.date, x.age])).toEqual([["2026-12-20", 36]]);
  expect((await briefing(s.a, s.anna, "2026-10-21")).nextDates.map((x) => x.date)).toEqual(["2026-12-20"]);
  expect((await briefing(s.a, s.anna, "2026-10-20")).nextDates).toEqual([]);
});

test("the suggested interval appears until the interval is confirmed", async () => {
  for (const date of ["2026-08-01", "2026-08-15", "2026-08-29"]) await record(s.b, { date });
  expect((await briefing(s.b, s.anna, "2026-10-23")).suggestedInterval).toBe(14);
  await setCheckInInterval(s.b, s.anna, 21, false);
  expect((await briefing(s.b, s.anna, "2026-10-23")).suggestedInterval).toBe(14);
  await setCheckInInterval(s.b, s.anna, 21, true);
  expect("suggestedInterval" in (await briefing(s.b, s.anna, "2026-10-23"))).toBe(false);
  expect("suggestedInterval" in (await briefing(s.a, s.tom, "2026-10-23"))).toBe(false);
});

test("no interval is suggested for one of the household: the viewer's own person or the partner's", async () => {
  for (const date of ["2026-08-01", "2026-08-15", "2026-08-29"]) await record(s.a, { date });
  expect((await briefing(s.a, s.anna, "2026-10-23")).suggestedInterval).toBe(14);
  expect("suggestedInterval" in (await briefing(s.a, s.a.personId, "2026-10-23"))).toBe(false);
  expect("suggestedInterval" in (await briefing(s.b, s.b.personId, "2026-10-23"))).toBe(false);
  expect("suggestedInterval" in (await briefing(s.b, s.a.personId, "2026-10-23"))).toBe(false);
});

test("an unknown person is not found", async () => {
  await expect(briefing(s.a, "nobody")).rejects.toBeInstanceOf(NotFoundError);
});

test("each item says whether it is the viewer's own and how visible it is, so only the recorder is offered edit, visibility and delete", async () => {
  await record(s.a, {
    promises: [{ person: 0, text: "return the tent", byMe: true, private: true }],
    exchanges: [{ person: 0, kind: "gift_idea", direction: "to_them", text: "a map" }],
  });
  const facts = (v: Viewer) => briefing(v, s.anna, "2026-10-23").then((b) => Object.fromEntries(b.known.map((f) => [f.text, [f.mine, f.visibility]])));
  expect(await facts(s.a)).toEqual({ "new job": [true, "shared"], divorce: [true, "private"], "likes hiking": [false, "shared"] });
  expect(await facts(s.b)).toEqual({ "new job": [false, "shared"], "likes hiking": [true, "shared"] });
  const a = await briefing(s.a, s.anna, "2026-10-23");
  expect(a.open.promises).toMatchObject([{ text: "return the tent", mine: true, visibility: "private" }]);
  expect(a.open.giftIdeas).toMatchObject([{ text: "a map", mine: true, visibility: "shared" }]);
  expect((await briefing(s.b, s.anna, "2026-10-23")).open.giftIdeas).toMatchObject([{ text: "a map", mine: false, visibility: "shared" }]);
});

test("the role reads from the viewer's side, in the person's own words", async () => {
  await addRelationship(s.a, { from: s.anna, to: s.a.personId, label: "Vermieterin", inverse: "Mieter", visibility: "shared" });
  await addRelationship(s.b, { from: s.b.personId, to: s.anna, label: "Mieterin", inverse: "Vermieter:in", visibility: "shared" });
  // Filed to each of us, the other way round and in other forms: still one role, to us.
  const roles = (await briefing(s.a, s.anna)).roles;
  expect(roles).toEqual([{ label: "Vermieterin", with: "us", ids: expect.any(Array) }]);
  expect(roles[0].ids).toHaveLength(2);
  expect((await briefing(s.b, s.anna)).roles).toMatchObject([{ label: "Vermieterin", with: "us" }]);

  await addRelationship(s.a, { from: s.lena, to: "me", label: "Kollegin", inverse: "Kollege", visibility: "shared" });
  expect((await briefing(s.a, s.lena)).roles).toMatchObject([{ label: "Kollegin", with: "me" }]);
  const b = (await briefing(s.b, s.lena)).roles;
  expect(b).toMatchObject([{ label: "Kollegin", with: "partner", partnerName: "Alice" }]);
  expect((await briefing(s.a, s.lena)).roles[0]).not.toHaveProperty("partnerName");
  // A role the other way round: the viewer's person is `from`, the person's word is the inverse.
  await addRelationship(s.b, { from: "me", to: s.tom, label: "Ärztin", inverse: "Patient", visibility: "shared" });
  expect((await briefing(s.b, s.tom)).roles).toMatchObject([{ label: "Patient", with: "me" }]);
});

test("Gerade los holds situations only, nudging ones flagged", async () => {
  await remember(s.a, {
    visibility: "shared",
    facts: [
      { person: s.anna, text: "sucht ein Auto", category: "other", kind: "situation", checkAfter: "2026-10-22" },
      { person: s.anna, text: "renoviert das Bad", category: "home", kind: "situation", checkAfter: "2026-12-01" },
      { person: s.anna, text: "mag Riesling", category: "other" },
    ],
  });
  const b = await briefing(s.a, s.anna, "2026-10-23");
  expect(b).not.toHaveProperty("current");
  expect(b.situations.map((f) => [f.text, f.checkAfter, f.nudge])).toEqual([
    ["sucht ein Auto", "2026-10-22", true],
    ["renoviert das Bad", "2026-12-01", false],
  ]);
  expect(b.situations[0].since).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  // Lasting facts by category, then as filed.
  expect(b.known.map((f) => f.text)).toEqual(["new job", "divorce", "likes hiking", "mag Riesling"]);
});

test("the network is one hop with us on top", async () => {
  await addRelationship(s.a, { from: s.anna, to: "us", label: "Vermieter:in", inverse: "Mieter:in", visibility: "shared" });
  const n = (await briefing(s.a, s.anna)).network;
  expect(n.nodes.map((x) => [x.id, x.role])).toEqual([
    [s.anna, "self"],
    [s.a.personId, "household"],
    [s.b.personId, "household"],
    [s.tom, "other"],
  ]);
  expect(n.nodes[0]).toMatchObject({ name: "Anna", url: `/p/${s.anna}` });
  expect(n.edges).toHaveLength(3);
  expect(n.edges.find((e) => e.to === s.tom)).toMatchObject({ from: s.anna, label: "Partner:in", inverse: "Partner:in" });
});

test("buildNetwork leaves out household persons without an edge and keeps each person once", () => {
  const rel = (id: string, from_id: string, to_id: string, label = "Freundin") => ({ id, from_id, to_id, label, inverse: label });
  const n = buildNetwork(
    "p",
    [rel("1", "p", "x"), rel("2", "x", "p", "Kollegin"), rel("3", "h2", "p")],
    ["h1", "h2"],
    new Map([
      ["p", "P"],
      ["x", "X"],
      ["h2", "H"],
    ]),
    new Map(),
  );
  expect(n.nodes.map((x) => x.id)).toEqual(["p", "h2", "x"]);
  expect(n.edges.map((e) => e.id)).toEqual(["1", "2", "3"]);
});

test("traits come in their own field, needs and personality apart, and leave known", async () => {
  await remember(s.a, {
    visibility: "shared",
    facts: [
      { person: s.anna, text: "vegetarian", category: "health", kind: "need" },
      { person: s.anna, text: "shy in big groups", category: "other", kind: "personality" },
    ],
  });
  const b = await briefing(s.a, s.anna, "2026-10-23");
  expect(b.traits.needs.map((f) => f.text)).toEqual(["vegetarian"]);
  expect(b.traits.personality.map((f) => f.text)).toEqual(["shy in big groups"]);
  expect(b.traits.needs[0]).toMatchObject({ category: "health", url: expect.stringMatching(`^/p/${s.anna}#facts-`), mine: true });
  expect(b.known.map((f) => f.text)).not.toContain("vegetarian");
  expect(b.known.map((f) => f.text)).not.toContain("shy in big groups");
});

test("B never sees A's private trait, and an outdated trait is gone", async () => {
  await remember(s.a, { visibility: "private", facts: [{ person: s.anna, text: "needs a wheelchair", category: "health", kind: "need" }] });
  const r = await remember(s.a, { visibility: "shared", facts: [{ person: s.anna, text: "nut allergy", category: "health", kind: "need" }] });
  await markOutdated(s.a, r.filed.facts[0].id);
  expect((await briefing(s.a, s.anna, "2026-10-23")).traits.needs.map((f) => f.text)).toEqual(["needs a wheelchair"]);
  const b = await briefing(s.b, s.anna, "2026-10-23");
  expect(b.traits).toEqual({ needs: [], personality: [] });
  expect(JSON.stringify(b)).not.toContain("wheelchair");
});

test("the briefing says where someone lives, and a home told in confidence only to whoever told it", async () => {
  await remember(s.a, { visibility: "shared", homes: [{ person: s.anna, place: { name: "Annas Wohnung", in: "Nürnberg", address: "Hauptstraße 5" } }] });
  expect((await briefing(s.b, s.anna)).homes).toMatchObject([{ name: "Annas Wohnung", address: "Hauptstraße 5", parents: [{ name: "Nürnberg" }] }]);
  await remember(s.a, { visibility: "private", homes: [{ person: s.tom, place: "Toms neue Wohnung" }] });
  expect((await briefing(s.a, s.tom)).homes.map((h) => h.name)).toEqual(["Toms neue Wohnung"]);
  expect((await briefing(s.b, s.tom)).homes).toEqual([]);
});
