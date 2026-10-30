import { beforeEach, expect, test } from "vitest";
import { getConversation, record, type NewRamble } from "./conversations";
import { testDb } from "./db/testing";
import { InvalidInputError, NotFoundError } from "./errors";
import { briefing } from "./briefing";
import { deleteItem, editItem, setVisibility, skipSession } from "./corrections";
import { getPlace, getSeries, listExperiences } from "./experiences";
import { ForbiddenError } from "./errors";
import { findPlaces } from "./places";
import { seed, type Seed } from "./testing/fixtures";

let s: Seed;
beforeEach(async () => {
  s = await seed();
});

// The dog school: a new weekly series, a place, the first lesson with Bob's person (the partner) and Anna, a private journal
// entry, and a conversation at the lesson.
const dogSchool = (over: Partial<NewRamble> = {}) =>
  record(s.a, {
    date: "2026-10-28",
    transcript: "Heute erste Stunde Hundeschule bei Pfotenglück mit Anna. Ich war nervös.",
    visibility: "shared",
    people: [{ id: s.b.personId }, { id: s.anna }],
    experiences: [
      {
        kind: "Kurs",
        title: "Erste Stunde Hundeschule",
        summary: "Sitz und Platz geübt",
        place: "Hundeschule Pfotenglück",
        present: [0, 1],
        series: { name: "Hundeschule mit Toffee", rhythmDays: 7 },
      },
    ],
    conversations: [{ kind: "in_person", summary: "Mit Anna nach der Stunde geredet", present: [1], at: 0 }],
    journal: [{ text: "Ich war nervös." }],
    ...over,
  });
const row = async (table: "experiences" | "series", id: string) =>
  (await testDb()).selectFrom(table).selectAll().where("id", "=", id).executeTakeFirstOrThrow();

test("the dog-school ramble files a session in a new series at a place, a conversation at it, and a journal entry", async () => {
  const r = await dogSchool();
  expect(r.experiences).toEqual([expect.objectContaining({ visibility: "shared", seriesId: expect.any(String) })]);
  const e = await row("experiences", r.experiences[0].id);
  expect(e).toMatchObject({
    ramble_id: r.rambleId,
    date: "2026-10-28",
    kind: "Kurs",
    title: "Erste Stunde Hundeschule",
    summary: "Sitz und Platz geübt",
    visibility: "shared",
  });
  const series = await row("series", r.experiences[0].seriesId!);
  expect(series).toMatchObject({
    name: "Hundeschule mit Toffee",
    rhythm_days: 7,
    starts_on: "2026-10-28",
    ends_on: null,
    visibility: "shared",
    place_id: e.place_id,
  });
  const people = await (await testDb()).selectFrom("experience_people").select("person_id").where("experience_id", "=", e.id).execute();
  expect(people.map((p) => p.person_id).sort()).toEqual([s.a.personId, s.b.personId, s.anna].sort());
  expect((await getConversation(s.a, r.conversations[0].id)).experienceId).toBe(e.id);
  expect((await findPlaces(s.a, "Pfotenglück")).map((p) => p.id)).toEqual([e.place_id]);
});

test("a second session joins the series by its id or its name", async () => {
  const first = await dogSchool();
  const seriesId = first.experiences[0].seriesId!;
  const byId = await record(s.a, {
    date: "2026-10-28",
    transcript: "t",
    visibility: "shared",
    people: [],
    experiences: [{ kind: "Kurs", title: "Zweite Stunde", series: seriesId }],
  });
  const byName = await record(s.a, {
    date: "2026-10-28",
    transcript: "t",
    visibility: "shared",
    people: [],
    experiences: [{ kind: "Kurs", title: "Dritte Stunde", series: { name: "hundeschule mit toffee" } }],
  });
  expect([byId.experiences[0].seriesId, byName.experiences[0].seriesId]).toEqual([seriesId, seriesId]);
});

test("a private ramble or a private series makes its experiences private, and a private experience the transcript", async () => {
  const p = await dogSchool({ visibility: "private" });
  expect(p.experiences[0].visibility).toBe("private");
  expect((await row("series", p.experiences[0].seriesId!)).visibility).toBe("private");
  const later = await record(s.a, {
    date: "2026-10-28",
    transcript: "t",
    visibility: "shared",
    people: [],
    experiences: [{ kind: "Kurs", title: "Zweite", series: p.experiences[0].seriesId! }],
  });
  expect(later.experiences[0].visibility).toBe("private");
  const own = await record(s.a, {
    date: "2026-10-28",
    transcript: "Arzttermin",
    visibility: "shared",
    people: [],
    experiences: [{ kind: "Termin", title: "Arzt", private: true }],
  });
  expect(own.experiences[0].visibility).toBe("private");
  expect(
    (await (await testDb()).selectFrom("rambles").select("transcript_private").where("id", "=", own.rambleId).executeTakeFirstOrThrow()).transcript_private,
  ).toBe(1);
});

test("at or series naming something that isn't there is refused, and nothing is filed", async () => {
  const before = (await (await testDb()).selectFrom("rambles").select("id").execute()).length;
  await expect(dogSchool({ conversations: [{ kind: "in_person", summary: "x", present: [], at: 3 }] })).rejects.toThrow(InvalidInputError);
  await expect(
    record(s.a, {
      date: "2026-10-28",
      transcript: "t",
      visibility: "shared",
      people: [],
      experiences: [{ kind: "Kurs", title: "x", series: "no-such-series" }],
    }),
  ).rejects.toThrow(NotFoundError);
  await expect(
    record(s.a, { date: "2026-10-28", transcript: "t", visibility: "shared", people: [], experiences: [{ kind: " ", title: "x" }] }),
  ).rejects.toThrow(InvalidInputError);
  expect((await (await testDb()).selectFrom("rambles").select("id").execute()).length).toBe(before);
});

test("the partner sees a shared session, never a private one, and no place through it", async () => {
  const shared = await dogSchool();
  const priv = await record(s.a, {
    date: "2026-10-28",
    transcript: "t",
    visibility: "shared",
    people: [],
    experiences: [{ kind: "Termin", title: "Therapie", place: "Praxis am Markt", private: true }],
  });
  expect(await findPlaces(s.b, "Pfotenglück")).toHaveLength(1);
  expect(await findPlaces(s.b, "Praxis am Markt")).toEqual([]);
  void shared;
  // B can't attach a session to A's private series by its id.
  const course = await record(s.a, {
    date: "2026-10-28",
    transcript: "t",
    visibility: "private",
    people: [],
    experiences: [{ kind: "Kurs", title: "Erste Stunde", series: { name: "Gesprächsgruppe", rhythmDays: 7 } }],
  });
  await expect(
    record(s.b, {
      date: "2026-10-28",
      transcript: "t",
      visibility: "shared",
      people: [],
      experiences: [{ kind: "Kurs", title: "x", series: course.experiences[0].seriesId! }],
    }),
  ).rejects.toThrow(NotFoundError);
  void priv;
});

test("memories stay: deleting a series' last session keeps the series; deleting the series keeps its sessions", async () => {
  const r = await dogSchool();
  const seriesId = r.experiences[0].seriesId!;
  const second = await record(s.a, {
    date: "2026-10-28",
    transcript: "t",
    visibility: "shared",
    people: [],
    experiences: [{ kind: "Kurs", title: "Zweite Stunde", series: seriesId }],
  });
  await deleteItem(s.a, "experiences", r.experiences[0].id);
  await deleteItem(s.a, "experiences", second.experiences[0].id);
  expect((await getSeries(s.a, seriesId)).sessions).toEqual([]);
  const third = await record(s.a, {
    date: "2026-10-28",
    transcript: "t",
    visibility: "shared",
    people: [],
    experiences: [{ kind: "Kurs", title: "Dritte Stunde", series: seriesId }],
  });
  await deleteItem(s.a, "series", seriesId);
  const [kept] = await listExperiences(s.a, { kind: "Kurs" });
  expect(kept).toMatchObject({ id: third.experiences[0].id, series: null });
});

test("a series page lists its sessions by date and the days skipped; a place page what happened there", async () => {
  const r = await dogSchool();
  const seriesId = r.experiences[0].seriesId!;
  await skipSession(s.a, seriesId, "2026-11-04");
  const series = await getSeries(s.a, seriesId);
  expect(series).toMatchObject({
    name: "Hundeschule mit Toffee",
    rhythmDays: 7,
    startsOn: "2026-10-28",
    skipped: ["2026-11-04"],
    place: expect.objectContaining({ name: "Hundeschule Pfotenglück" }),
  });
  expect(series.sessions.map((x) => x.title)).toEqual(["Erste Stunde Hundeschule"]);
  const place = await getPlace(s.a, series.place!.id);
  expect(place.experiences.map((x) => x.id)).toEqual([r.experiences[0].id]);
  expect(place.conversations.map((c) => c.id)).toEqual([]);
  expect(place.series.map((x) => x.id)).toEqual([seriesId]);
});

test("a briefing lists the experiences the viewer had with the person", async () => {
  await dogSchool();
  expect((await briefing(s.a, s.anna)).experiences.map((e) => e.title)).toEqual(["Erste Stunde Hundeschule"]);
});

test("edit an experience's date, kind and place; only the recorder changes who sees it; the partner can't touch a private one", async () => {
  const r = await dogSchool();
  const id = r.experiences[0].id;
  await editItem(s.a, "experiences", id, {
    date: "2026-10-27",
    kind: "Hundeschule",
    place: { name: "Hundeschule am See", confirmedNew: true },
    title: "Probestunde",
  });
  const [e] = await listExperiences(s.a, { kind: "Hundeschule" });
  expect(e).toMatchObject({ date: "2026-10-27", title: "Probestunde", place: expect.objectContaining({ name: "Hundeschule am See" }) });
  await expect(setVisibility(s.b, "experiences", id, "private")).rejects.toThrow(ForbiddenError);
  await setVisibility(s.a, "experiences", id, "private");
  await expect(editItem(s.b, "experiences", id, { title: "x" })).rejects.toThrow(NotFoundError);
  await expect(getSeries(s.b, "no-such")).rejects.toThrow(NotFoundError);
});

test("a series made private takes its sessions with it, and a session of a private series can't be shared", async () => {
  const r = await dogSchool();
  const seriesId = r.experiences[0].seriesId!;
  await setVisibility(s.a, "series", seriesId, "private");
  expect((await listExperiences(s.b, {})).map((e) => e.id)).not.toContain(r.experiences[0].id);
  await expect(setVisibility(s.a, "experiences", r.experiences[0].id, "shared")).rejects.toThrow(InvalidInputError);
});

test("review C1: a private experience that starts a new series makes the series private, and its place stays hidden", async () => {
  await record(s.a, {
    date: "2026-10-28",
    transcript: "t",
    visibility: "shared",
    people: [],
    experiences: [{ kind: "Gruppe", title: "Erste Sitzung", private: true, place: "Tagesklinik Nord", series: { name: "Gruppentherapie", rhythmDays: 7 } }],
  });
  const { listSeries } = await import("./experiences");
  expect((await listSeries(s.b)).map((x) => x.name)).not.toContain("Gruppentherapie");
  expect(await findPlaces(s.b, "Tagesklinik Nord")).toEqual([]);
});

test("review I2: merging two people keeps the experiences of the one merged away", async () => {
  const { mergePeople } = await import("./corrections");
  const r = await record(s.a, {
    date: "2026-10-28",
    transcript: "t",
    visibility: "shared",
    people: [{ name: "Anni" }],
    experiences: [{ kind: "Konzert", title: "Wanda", present: [0] }],
  });
  await mergePeople(s.a, s.anna, r.people[0].id);
  expect((await listExperiences(s.a, { personId: s.anna })).map((e) => e.title)).toEqual(["Wanda"]);
});

test("minor: listExperiences narrows to the ids asked for", async () => {
  const a = await record(s.a, {
    date: "2026-10-28",
    transcript: "t",
    visibility: "shared",
    people: [],
    experiences: [
      { kind: "Konzert", title: "Wanda" },
      { kind: "Konzert", title: "Seeed" },
    ],
  });
  expect((await listExperiences(s.a, { ids: [a.experiences[1].id] })).map((e) => e.title)).toEqual(["Seeed"]);
});
