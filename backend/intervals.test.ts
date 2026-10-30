import { beforeEach, expect, test } from "vitest";
import { recordConversation } from "./conversations";
import { testDb } from "./db/testing";
import { InvalidInputError, NotFoundError } from "./errors";
import { freshness, lastSeen, setCheckInInterval, suggestInterval } from "./intervals";
import { seed, type Seed } from "./testing/fixtures";
import type { Viewer } from "./types";

let s: Seed;

beforeEach(async () => {
  s = await seed();
});

const meet = (v: Viewer, personId: string, date: string, over: Partial<Parameters<typeof recordConversation>[1]> = {}) =>
  recordConversation(v, { date, kind: "call", summary: "s", transcript: "t", visibility: "shared", people: [{ id: personId, present: true }], ...over });

/** Conversations with Lena (nobody else has met her, so the fixture's own do not interfere) on day offsets from 2026-01-01. */
async function lenaAt(v: Viewer, offsets: number[]) {
  for (const o of offsets) await meet(v, s.lena, new Date(Date.UTC(2026, 0, 1 + o)).toISOString().slice(0, 10));
}

test("B's call with Anna does not change A's last seen; each sees their own", async () => {
  expect(await lastSeen(s.a, s.anna)).toBe("2026-10-20");
  expect(await lastSeen(s.b, s.anna)).toBe("2026-10-15");
  await meet(s.b, s.anna, "2026-10-22");
  expect(await lastSeen(s.a, s.anna)).toBe("2026-10-20");
  expect(await lastSeen(s.b, s.anna)).toBe("2026-10-22");
});

test("a private conversation of the partner is not last seen, and none at all is null", async () => {
  expect(await lastSeen(s.b, s.lena)).toBeNull();
  await meet(s.a, s.anna, "2026-10-22", { visibility: "private" });
  expect(await lastSeen(s.b, s.anna)).toBe("2026-10-15");
  expect(await lastSeen(s.a, s.anna)).toBe("2026-10-22");
});

test("a conversation the viewer's person did not take part in is not last seen", async () => {
  // Alice mentions Tom without him or Bob being there: Bob has not seen him.
  expect(await lastSeen(s.b, s.tom)).toBeNull();
  expect(await lastSeen(s.a, s.tom)).toBeNull();
});

test("conversations at days 0, 14, 28 and 42 suggest 14", async () => {
  await lenaAt(s.b, [0, 14, 28, 42]);
  expect(await suggestInterval(s.b, s.lena)).toBe(14);
});

test("fewer than 3 conversations suggest nothing", async () => {
  await lenaAt(s.b, [0, 14]);
  expect(await suggestInterval(s.b, s.lena)).toBeNull();
});

test("the suggestion is the median gap of the last 6, in whole weeks, at least a week", async () => {
  await lenaAt(s.b, [0, 100, 110, 120, 130, 140, 150]); // the last 6 are 5 gaps of 10 days → 10 → 7
  expect(await suggestInterval(s.b, s.lena)).toBe(7);
  await lenaAt(s.a, [200, 220, 240]); // A's view is separate: gaps of 20 → 21
  expect(await suggestInterval(s.a, s.lena)).toBe(21);
  await lenaAt(s.b, [151, 152, 153]);
  expect(await suggestInterval(s.b, s.lena)).toBe(7);
});

test("a gap of a few days rounds up to one week", async () => {
  await lenaAt(s.b, [0, 2, 4]);
  expect(await suggestInterval(s.b, s.lena)).toBe(7);
});

test("the interval is stored per user and can be changed", async () => {
  await setCheckInInterval(s.a, s.anna, 30, true);
  expect((await freshness(s.a, s.anna, "2026-10-30")).intervalDays).toBe(30);
  expect((await freshness(s.b, s.anna, "2026-10-30")).intervalDays).toBeNull();
  await setCheckInInterval(s.a, s.anna, 14, false);
  expect((await freshness(s.a, s.anna, "2026-10-30")).intervalDays).toBe(14);
  const rows = await (await testDb()).selectFrom("person_settings").selectAll().where("user_id", "=", s.a.userId).execute();
  expect(rows).toHaveLength(1);
  expect(rows[0].interval_confirmed).toBe(0);
});

test("freshness: ratio is days since last seen over the interval; null without either", async () => {
  expect(await freshness(s.a, s.anna, "2026-10-30")).toEqual({ lastSeen: "2026-10-20", intervalDays: null, ratio: null });
  await setCheckInInterval(s.a, s.anna, 5, true);
  expect(await freshness(s.a, s.anna, "2026-10-30")).toEqual({ lastSeen: "2026-10-20", intervalDays: 5, ratio: 2 });
  await setCheckInInterval(s.a, s.lena, 5, true);
  await setCheckInInterval(s.b, s.lena, 5, true);
  expect((await freshness(s.b, s.lena, "2026-10-30")).ratio).toBeNull();
  await setCheckInInterval(s.a, s.anna, null, true);
  expect((await freshness(s.a, s.anna, "2026-10-30")).ratio).toBeNull();
});

test("rejects a bad interval or an unknown person", async () => {
  for (const days of [0, -7, 1.5, 4000]) await expect(setCheckInInterval(s.a, s.anna, days, true)).rejects.toBeInstanceOf(InvalidInputError);
  await expect(setCheckInInterval(s.a, "nobody", 7, true)).rejects.toBeInstanceOf(NotFoundError);
});
