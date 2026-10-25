import { beforeEach, expect, test } from "vitest";
import { recordConversation } from "./conversations";
import { markDone } from "./corrections";
import { db, resetDbForTests } from "./db/testing";
import { addToGroupById, listGroups } from "./groups";
import { setCheckInInterval } from "./intervals";
import { orbit, type OrbitFace } from "./orbit";
import type { Viewer } from "./types";
import { userFromOidc } from "./users";

// Every test looks from 23 Oct 2026, midday in Berlin.
const NOW = Date.parse("2026-10-23T10:00:00Z");
let me: Viewer;

beforeEach(async () => {
  await resetDbForTests();
  me = await userFromOidc({ sub: "me", name: "Marcel" });
});

type Extra = Partial<Parameters<typeof recordConversation>[1]>;

// A new person the viewer met on `date` (null: only mentioned, never met); returns their id.
async function met(name: string, date: string | null, extra: Extra = {}): Promise<string> {
  const r = await recordConversation(me, {
    date: date ?? "2026-01-01",
    kind: "call",
    summary: "s",
    transcript: "t",
    visibility: "shared",
    people: [{ name, present: date !== null }],
    ...extra,
  });
  return r.people[0].id;
}

const byName = (faces: OrbitFace[]) => new Map(faces.map((f) => [f.name, f]));

test("with an interval: ring 0 below half of it, ring 1 below all of it, ring 2 from then on", async () => {
  const people = { r04: "2026-10-19", r05: "2026-10-18", r09: "2026-10-14", r10: "2026-10-13" };
  for (const [name, date] of Object.entries(people)) await setCheckInInterval(me, await met(name, date), 10, true);
  const faces = byName(await orbit(me, NOW));
  expect(Object.keys(people).map((n) => faces.get(n)?.ring)).toEqual([0, 1, 1, 2]);
});

test("without an interval: ring 0 within 14 days, ring 1 within 45, ring 2 after that or never seen", async () => {
  // A promise keeps the farther ones in the subset.
  const promise = { promises: [{ person: 0, text: "call back", byMe: true }] };
  const people = { d14: "2026-10-09", d15: "2026-10-08", d45: "2026-09-08", d46: "2026-09-07", never: null };
  for (const [name, date] of Object.entries(people)) await met(name, date, promise);
  const faces = byName(await orbit(me, NOW));
  expect(Object.keys(people).map((n) => faces.get(n)?.ring)).toEqual([0, 1, 1, 2, 2]);
});

test("the subset: overdue, nearly due, seen within 14 days, a birthday within 14 days or an open promise", async () => {
  await setCheckInInterval(me, await met("overdue", "2026-09-01"), 30, true);
  await setCheckInInterval(me, await met("nearlyDue", "2026-09-25"), 36, true); // 28/36 ≈ 0.78
  await setCheckInInterval(me, await met("fine", "2026-09-25"), 100, true); // 0.28, 28 days ago
  await met("recent", "2026-10-10");
  await met("faded", "2026-10-01");
  await met("birthday", null, { dates: [{ person: 0, kind: "birthday", date: "--11-05", yearly: true }] });
  await met("laterBirthday", null, { dates: [{ person: 0, kind: "birthday", date: "--11-07", yearly: true }] });
  await met("promised", null, { promises: [{ person: 0, text: "send the photos", byMe: false }] });
  await met("donePromise", null, { promises: [{ person: 0, text: "done already", byMe: true }] });
  await markDone(me, "promises", (await (await db()).selectFrom("promises").select("id").where("text", "=", "done already").executeTakeFirstOrThrow()).id);
  await met("giftOnly", null, { exchanges: [{ person: 0, kind: "gift_idea", direction: "to_them", text: "a book" }] });
  const names = (await orbit(me, NOW)).map((f) => f.name).sort();
  expect(names).toEqual(["birthday", "nearlyDue", "overdue", "promised", "recent"]);
});

test("badges: birthday soon, open promise, gift idea; the viewer is never a face", async () => {
  await met("Anna", "2026-10-20", {
    dates: [{ person: 0, kind: "birthday", date: "1990-10-30", yearly: true }],
    promises: [{ person: 0, text: "lend the tent", byMe: true }],
    exchanges: [{ person: 0, kind: "gift_idea", direction: "to_them", text: "a book" }],
  });
  await met("Ben", "2026-10-21");
  const faces = await orbit(me, NOW);
  expect(faces.map((f) => [f.name, f.badges])).toEqual([
    ["Anna", ["birthday", "promise", "gift"]],
    ["Ben", []],
  ]);
  expect(faces.map((f) => f.personId)).not.toContain(me.personId);
});

test("most urgent first, at most 24: the 25th is dropped", async () => {
  await met("calm", "2026-10-22");
  for (let i = 0; i < 24; i++) await met(`p${String(i).padStart(2, "0")}`, "2026-10-22", { promises: [{ person: 0, text: "x", byMe: true }] });
  const faces = await orbit(me, NOW);
  expect(faces).toHaveLength(24);
  expect(faces.map((f) => f.name)).not.toContain("calm");
});

test("angles are stable and spread evenly within a ring", async () => {
  await met("Anna", "2026-10-20");
  await met("Ben", "2026-10-21");
  await met("Cleo", "2026-10-22");
  const first = await orbit(me, NOW);
  expect(await orbit(me, NOW)).toEqual(first);
  const angles = first.map((f) => f.angle).sort((a, b) => a - b);
  expect(angles[1] - angles[0]).toBeCloseTo(120);
  expect(angles[2] - angles[1]).toBeCloseTo(120);
  for (const a of angles) expect(a >= 0 && a < 360).toBe(true);
});

test("filtered by a group: its members come first and are marked, even when nothing else would show them", async () => {
  const anna = await met("Anna", "2026-10-20");
  await met("Lena", "2026-10-21");
  const tom = await met("Tom", "2025-01-01"); // a long time ago and no interval: not on the unfiltered orbit
  for (let i = 0; i < 24; i++) await met(`Recent ${i}`, "2026-10-22");
  expect(byName(await orbit(me, NOW)).has("Tom")).toBe(false);
  const familie = (await listGroups(me)).find((g) => g.name === "Familie")!.id;
  for (const id of [anna, tom]) await addToGroupById(me, familie, id, "shared");
  const faces = byName(await orbit(me, NOW, familie));
  expect(faces.get("Anna")?.inGroup).toBe(true);
  expect(faces.get("Tom")?.inGroup).toBe(true);
  expect([...faces.values()].filter((f) => f.inGroup === false).length).toBeGreaterThan(0);
  expect(faces.get("Lena")?.inGroup ?? false).toBe(false);
  expect([...byName(await orbit(me, NOW)).values()].every((f) => f.inGroup === undefined)).toBe(true);
});
