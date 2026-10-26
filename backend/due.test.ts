import { beforeEach, expect, test } from "vitest";
import { recordConversation } from "./conversations";
import { setCheckInInterval } from "./intervals";
import { whatsDue } from "./due";
import { seed, type Seed } from "./testing/fixtures";
import type { Viewer } from "./types";

let s: Seed;

beforeEach(async () => {
  s = await seed();
});

const record = (v: Viewer, over: Partial<Parameters<typeof recordConversation>[1]>) =>
  recordConversation(v, { date: "2026-10-21", kind: "call", summary: "s", transcript: "t", visibility: "shared", people: [{ id: s.anna, present: true }], ...over });

test("a person without an interval is never overdue", async () => {
  expect(await whatsDue(s.a, "2027-06-01")).toEqual([]);
});

test("an interval of 7 and last seen 10 days ago is overdue with ratio 10/7", async () => {
  await setCheckInInterval(s.a, s.anna, 7, true);
  const due = await whatsDue(s.a, "2026-10-30");
  expect(due).toHaveLength(1);
  expect(due[0]).toMatchObject({ kind: "overdue", personId: s.anna, name: "Anna" });
  expect(due[0].ratio).toBeCloseTo(1.43, 2);
  expect(await whatsDue(s.a, "2026-10-27")).toEqual([]); // exactly on the interval is not yet overdue
});

test("someone never seen is not overdue, even with an interval", async () => {
  await setCheckInInterval(s.b, s.lena, 7, true);
  expect(await whatsDue(s.b, "2027-01-01")).toEqual([]);
});

test("Tom's private birthday is due for A and absent for B", async () => {
  expect(await whatsDue(s.a, "2026-10-23")).toEqual([{ kind: "date", personId: s.tom, name: "Tom", date: "2026-10-24", text: "birthday", itemId: expect.any(String), url: expect.stringMatching(`^/p/${s.tom}#dates-`) }]);
  expect(await whatsDue(s.b, "2026-10-23")).toEqual([]);
});

test("dates outside the horizon are not due; yearly dates recur, one-off dates only once", async () => {
  expect(await whatsDue(s.a, "2026-10-09")).toEqual([]);
  expect((await whatsDue(s.a, "2026-10-10")).map((i) => i.date)).toEqual(["2026-10-24"]);
  expect((await whatsDue(s.a, "2027-10-20")).map((i) => i.date)).toEqual(["2027-10-24"]);
  await record(s.a, { dates: [{ person: 0, kind: "custom", date: "2026-11-01", label: "Housewarming", yearly: false }] });
  expect((await whatsDue(s.a, "2026-10-30")).map((i) => `${i.date} ${i.text}`)).toEqual(["2026-11-01 Housewarming"]);
  expect(await whatsDue(s.a, "2026-11-02")).toEqual([]);
});

test("promises: open ones due within the horizon, past due included; done, undated and far ones are left out", async () => {
  const r = await record(s.a, {
    promises: [
      { person: 0, text: "send photos", byMe: true, due: "2026-10-25" },
      { person: 0, text: "return the book", byMe: true, due: "2026-10-01" },
      { person: 0, text: "visit", byMe: true, due: "2027-01-01" },
      { person: 0, text: "someday", byMe: true },
      { person: 0, text: "already done", byMe: true, due: "2026-10-24" },
    ],
  });
  expect(r.counts.promises).toBe(5);
  const { db } = await import("./db/testing");
  await (await db()).updateTable("promises").set({ done: 1 }).where("text", "=", "already done").execute();
  expect((await whatsDue(s.a, "2026-10-23")).filter((i) => i.kind === "promise").map((i) => `${i.date} ${i.text}`)).toEqual([
    "2026-10-01 return the book",
    "2026-10-25 send photos",
  ]);
});

test("only the viewer's own promises are due: the partner's shared ones are theirs to keep", async () => {
  await record(s.b, { promises: [{ person: 0, text: "bob's errand", byMe: true, due: "2026-10-24" }] });
  await record(s.a, { promises: [{ person: 0, text: "lend me the tent", byMe: false, due: "2026-10-24" }] });
  expect((await whatsDue(s.a, "2026-10-23")).filter((i) => i.kind === "promise")).toEqual([
    { kind: "promise", personId: s.anna, name: "Anna", date: "2026-10-24", text: "lend me the tent", byMe: false, itemId: expect.any(String), url: expect.stringMatching(`^/p/${s.anna}#promises-`) },
  ]);
  expect((await whatsDue(s.b, "2026-10-23")).filter((i) => i.kind === "promise")).toEqual([
    { kind: "promise", personId: s.anna, name: "Anna", date: "2026-10-24", text: "bob's errand", byMe: true, itemId: expect.any(String), url: expect.stringMatching(`^/p/${s.anna}#promises-`) },
  ]);
});

test("a private promise is due for its recorder only", async () => {
  await record(s.a, { promises: [{ person: 0, text: "secret errand", byMe: true, due: "2026-10-24", private: true }] });
  expect((await whatsDue(s.a, "2026-10-23")).map((i) => i.text)).toContain("secret errand");
  expect((await whatsDue(s.b, "2026-10-23")).map((i) => i.text)).not.toContain("secret errand");
});

test("sorted: dates by closeness, then overdue by ratio descending, then promises by due date", async () => {
  await setCheckInInterval(s.a, s.anna, 2, true);
  await setCheckInInterval(s.a, s.lena, 2, true); // last seen 2026-10-18 at the private coffee: ratio 2.5 against Anna's 1.5
  await record(s.a, {
    date: "2026-10-01",
    people: [{ id: s.lena, present: true }],
    promises: [{ person: 0, text: "p2", byMe: true, due: "2026-10-28" }],
    dates: [{ person: 0, kind: "custom", date: "2026-10-26", label: "d2", yearly: false }],
  });
  await record(s.a, { date: "2026-10-10", promises: [{ person: 0, text: "p1", byMe: true, due: "2026-10-24" }] });
  const due = await whatsDue(s.a, "2026-10-23");
  expect(due.map((i) => i.kind + ":" + (i.text ?? i.name))).toEqual(["date:birthday", "date:d2", "overdue:Lena", "overdue:Anna", "promise:p1", "promise:p2"]);
});

test("due items carry what the Bald page shows: a promise's id, and for someone overdue, last seen and the interval", async () => {
  await record(s.a, { promises: [{ person: 0, text: "bring the wine", byMe: true, due: "2026-10-24" }] });
  await setCheckInInterval(s.a, s.anna, 1, true);
  const items = await whatsDue(s.a, "2026-10-23");
  const promise = items.find((i) => i.kind === "promise")!;
  expect(promise.itemId).toBe(promise.url.split("#promises-")[1]);
  expect(items.find((i) => i.kind === "date")!.itemId).toEqual(expect.any(String));
  expect(items.find((i) => i.kind === "overdue" && i.personId === s.anna)).toMatchObject({ lastSeen: expect.any(String), intervalDays: 1 });
});

test("a situation past its nudge date is due, for whoever may see it", async () => {
  const before = (await whatsDue(s.b, "2026-11-10")).length;
  await record(s.a, { facts: [{ person: 0, text: "sucht ein Auto", category: "other", kind: "situation", checkAfter: "2026-11-01" }] });
  await record(s.a, { facts: [{ person: 0, text: "sucht heimlich einen Job", category: "work", kind: "situation", checkAfter: "2026-11-01", private: true }] });
  await record(s.a, { facts: [{ person: 0, text: "renoviert", category: "home", kind: "situation", checkAfter: "2026-12-01" }] });
  const mine = (await whatsDue(s.a, "2026-11-10")).filter((i) => i.kind === "situation");
  expect(mine.map((i) => i.text).sort()).toEqual(["sucht ein Auto", "sucht heimlich einen Job"]);
  expect(mine[0]).toMatchObject({ personId: s.anna, name: "Anna", date: "2026-11-01", url: `/p/${s.anna}#facts-${mine[0].itemId}` });
  const theirs = (await whatsDue(s.b, "2026-11-10")).filter((i) => i.kind === "situation");
  expect(theirs.map((i) => i.text)).toEqual(["sucht ein Auto"]);
  expect((await whatsDue(s.b, "2026-11-10")).length).toBe(before + 1);
  // Not before its day, and never once it is outdated.
  expect((await whatsDue(s.a, "2026-10-31")).filter((i) => i.kind === "situation")).toEqual([]);
});
