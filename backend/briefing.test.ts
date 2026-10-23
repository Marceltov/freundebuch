import { beforeEach, expect, test } from "vitest";
import { briefing } from "./briefing";
import { recordConversation } from "./conversations";
import { db } from "./db/testing";
import { NotFoundError } from "./errors";
import { setCheckInInterval } from "./intervals";
import { seed, type Seed } from "./testing/fixtures";
import type { Viewer } from "./types";

let s: Seed;

beforeEach(async () => {
  s = await seed();
});

const record = (v: Viewer, over: Partial<Parameters<typeof recordConversation>[1]>) =>
  recordConversation(v, { date: "2026-10-21", kind: "call", summary: "s", transcript: "t", visibility: "shared", people: [{ id: s.anna, present: true }], ...over });

test("A's briefing on Anna holds everything, B's only the shared part", async () => {
  const a = await briefing(s.a, s.anna, "2026-10-23");
  expect(a.person).toEqual({ id: s.anna, name: "Anna", aliases: [] });
  expect(a.current.map((f) => f.text).sort()).toEqual(["divorce", "likes hiking", "new job"]);
  expect(a.relationships).toEqual([{ personId: s.tom, name: "Tom", type: "partner", direction: "out" }]);
  expect(a.freshness).toEqual({ lastSeen: "2026-10-20", intervalDays: null, ratio: null });
  const b = await briefing(s.b, s.anna, "2026-10-23");
  expect(b.current.map((f) => f.text).sort()).toEqual(["likes hiking", "new job"]);
  expect(b.relationships).toEqual([]);
  expect(b.freshness.lastSeen).toBe("2026-10-15");
});

test("B's briefing on Anna and Tom never contains A's private items", async () => {
  for (const id of [s.anna, s.tom]) {
    const text = JSON.stringify(await briefing(s.b, id, "2026-10-23"));
    for (const secret of ["divorce", "partner", "--10-24", "2026-10-24", "Luigi"]) expect(text, `${id} ${secret}`).not.toContain(secret);
  }
  expect((await briefing(s.b, s.tom, "2026-10-23")).nextDates).toEqual([]);
  expect((await briefing(s.a, s.tom, "2026-10-23")).nextDates).toEqual([{ id: expect.any(String), personId: s.tom, kind: "birthday", label: null, date: "2026-10-24", inDays: 1, age: null }]);
});

test("superseded facts are not current", async () => {
  const old = (await (await db()).selectFrom("facts").select("id").where("text", "=", "new job").executeTakeFirstOrThrow()).id;
  await record(s.a, { facts: [{ person: 0, text: "started at the museum", category: "work", supersedes: old }] });
  const texts = (await briefing(s.a, s.anna, "2026-10-23")).current.map((f) => f.text);
  expect(texts).toContain("started at the museum");
  expect(texts).not.toContain("new job");
});

test("recent: the last 5 visible conversations, newest first, with the other participants' names but no items", async () => {
  for (let i = 1; i <= 5; i++) await record(s.b, { date: `2026-09-0${i}`, summary: `call ${i}` });
  const b = await briefing(s.b, s.anna, "2026-10-23");
  expect(b.recent.map((c) => c.date)).toEqual(["2026-10-20", "2026-10-15", "2026-09-05", "2026-09-04", "2026-09-03"]);
  expect(Object.keys(b.recent[0]).sort()).toEqual(["date", "id", "kind", "summary", "withOthers"]);
  // The dinner had Alice (the viewer's partner, who recorded it) and Anna; Tom was only mentioned.
  expect(b.recent[0]).toMatchObject({ id: s.dinner, summary: "Dinner with Anna; she has a new job.", withOthers: ["Alice"] });
  expect(b.recent[1].withOthers).toEqual([]);
  const a = await briefing(s.a, s.anna, "2026-10-23");
  expect(a.recent[0].withOthers).toEqual([]); // the viewer is not "others"
});

test("recent lists others who were there, and hides a private conversation from the partner", async () => {
  await record(s.a, { date: "2026-10-22", people: [{ id: s.anna, present: true }, { id: s.tom, present: true }, { id: s.lena, present: true }] });
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
  const d = await db();
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

test("nextDates look 60 days ahead; a birthday with a year carries the age", async () => {
  await record(s.a, { dates: [{ person: 0, kind: "birthday", date: "1990-12-20", yearly: true }, { person: 0, kind: "custom", date: "--12-23", label: "far", yearly: true }] });
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

test("an unknown person is not found", async () => {
  await expect(briefing(s.a, "nobody")).rejects.toBeInstanceOf(NotFoundError);
});

test("each item says whether it is the viewer's own and how visible it is, so only the recorder is offered edit, visibility and delete", async () => {
  await record(s.a, { promises: [{ person: 0, text: "return the tent", byMe: true, private: true }], exchanges: [{ person: 0, kind: "gift_idea", direction: "to_them", text: "a map" }] });
  const facts = (v: Viewer) => briefing(v, s.anna, "2026-10-23").then((b) => Object.fromEntries(b.current.map((f) => [f.text, [f.mine, f.visibility]])));
  expect(await facts(s.a)).toEqual({ "new job": [true, "shared"], divorce: [true, "private"], "likes hiking": [false, "shared"] });
  expect(await facts(s.b)).toEqual({ "new job": [false, "shared"], "likes hiking": [true, "shared"] });
  const a = await briefing(s.a, s.anna, "2026-10-23");
  expect(a.open.promises).toMatchObject([{ text: "return the tent", mine: true, visibility: "private" }]);
  expect(a.open.giftIdeas).toMatchObject([{ text: "a map", mine: true, visibility: "shared" }]);
  expect((await briefing(s.b, s.anna, "2026-10-23")).open.giftIdeas).toMatchObject([{ text: "a map", mine: false, visibility: "shared" }]);
});
