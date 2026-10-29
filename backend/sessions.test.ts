import { beforeEach, expect, test } from "vitest";
import { record } from "./conversations";
import { skipSession, editItem } from "./corrections";
import { db } from "./db/testing";
import type { SeriesRef } from "./experiences";
import { whatsDue } from "./due";
import { getSeries } from "./experiences";
import { missedSessions } from "./sessions";
import { seed, type Seed } from "./testing/fixtures";

let s: Seed;
beforeEach(async () => {
  s = await seed();
});

const FILED = Date.parse("2026-09-02T20:00:00Z");
// The dog school, filed on 2026-09-02 with its first lesson that day, Bob's person (the partner) and Anna there.
async function dogSchool(series: SeriesRef = { name: "Hundeschule mit Toffee", rhythmDays: 7 }) {
  const r = await record(s.a, { date: "2026-09-02", transcript: "t", visibility: "shared", people: [{ id: s.b.personId }, { id: s.anna }], experiences: [{ kind: "Kurs", title: "Erste Stunde", present: [0, 1], series }] });
  const id = r.experiences[0].seriesId!;
  await (await db()).updateTable("series").set({ created_at: FILED }).where("id", "=", id).execute();
  return id;
}
const lesson = (v: Seed["a"], seriesId: string, date: string, extra: object = {}) =>
  record(v, { date: "2026-10-29", transcript: "t", visibility: "shared", people: [], experiences: [{ date, kind: "Kurs", title: `Stunde am ${date}`, series: seriesId, ...extra }] });
const days = async (v: Seed["a"], today: string) => (await missedSessions(v, today)).map((m) => m.date);

test("a session day that passed untold is missed, for everyone who was at a session of the series", async () => {
  const id = await dogSchool();
  expect(await days(s.a, "2026-09-10")).toEqual(["2026-09-09"]);
  expect(await days(s.b, "2026-09-10")).toEqual(["2026-09-09"]);
  expect((await missedSessions(s.a, "2026-09-10"))[0]).toMatchObject({ seriesId: id, name: "Hundeschule mit Toffee", url: `/s/${id}` });
  // The day itself hasn't passed yet.
  expect(await days(s.a, "2026-09-09")).toEqual([]);
});

test("a session told within half the rhythm after its day counts; a skipped day and an ended series never remind", async () => {
  const id = await dogSchool();
  await lesson(s.a, id, "2026-09-12");
  expect(await days(s.a, "2026-09-13")).toEqual([]);
  expect(await days(s.b, "2026-09-13")).toEqual([]);
  expect(await days(s.a, "2026-09-17")).toEqual(["2026-09-16"]);
  await skipSession(s.b, id, "2026-09-16");
  expect(await days(s.a, "2026-09-17")).toEqual([]);
  await editItem(s.a, "series", id, { endsOn: "2026-09-20" });
  expect(await days(s.a, "2026-09-30")).toEqual([]);
});

test("a series filed with a start long ago brings no backlog: only the latest day after it was filed", async () => {
  await dogSchool({ name: "Yoga", rhythmDays: 7, startsOn: "2026-01-05" });
  expect(await days(s.a, "2026-09-10")).toEqual(["2026-09-07"]);
  // A series without a rhythm never reminds.
  await dogSchool({ name: "Konzerte" });
  expect((await missedSessions(s.a, "2026-09-10")).map((m) => m.name)).toEqual(["Yoga"]);
});

test("a private session clears only its recorder's reminder, and says nothing of itself to the partner", async () => {
  const id = await dogSchool();
  await lesson(s.a, id, "2026-09-09", { private: true, title: "Geheime Stunde" });
  expect(await days(s.a, "2026-09-10")).toEqual([]);
  expect(await days(s.b, "2026-09-10")).toEqual(["2026-09-09"]);
  expect(JSON.stringify(await whatsDue(s.b, "2026-09-10"))).not.toContain("Geheime");
});

test("whoever wasn't at any session of a series isn't reminded of it", async () => {
  await record(s.a, { date: "2026-09-02", transcript: "t", visibility: "shared", people: [], experiences: [{ kind: "Kurs", title: "Allein", series: { name: "Laufgruppe", rhythmDays: 7 } }] });
  expect(await days(s.b, "2026-09-10")).toEqual([]);
});

test("whats_due carries a missed session as kind session, linking the series", async () => {
  const id = await dogSchool();
  const due = await whatsDue(s.a, "2026-09-10");
  expect(due.filter((i) => i.kind === "session")).toEqual([expect.objectContaining({ kind: "session", name: "Hundeschule mit Toffee", date: "2026-09-09", itemId: id, url: `/s/${id}` })]);
});

test("a series page knows its missed day", async () => {
  const id = await dogSchool();
  expect((await getSeries(s.a, id, "2026-09-10")).missed).toEqual(["2026-09-09"]);
});
