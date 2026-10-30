// Experiences: what the user lived through on a day (a concert, a trip, a dog-school lesson), as parts of a ramble, and series
// of them (a course, a weekly training). Claude files them with record (conversations.ts); nothing here interprets. A series
// stays a memory: nothing removes it on its own. Every read goes through visible().
import { sql, type Kysely } from "kysely";
import { assertDay, notFuture, today as todayOf } from "./dates";
import { missedSessions } from "./sessions";
import { db, newId, type Schema } from "./db";
import { InvalidInputError, NotFoundError } from "./errors";
import { norm } from "./names";
import { describePlace, fileOwnersOf, ownersOf, placeAndInsideIds, resolvePlace, type PlaceCandidate, type PlaceRef } from "./places";
import type { Viewer, Visibility } from "./types";
import { conversationPath, personPath, placePath, ramblePath, seriesPath } from "./urls";
import { visible } from "./visibility";

export const MAX_TITLE = 200;
export const MAX_KIND = 40;
export const MAX_EXPERIENCE = 4_000;

/** A new series, or an existing one by its id or exact name. */
export type SeriesRef = string | { name: string; kind?: string; rhythmDays?: number; startsOn?: string; endsOn?: string };
export type NewExperience = {
  date?: string;
  /** A German word ("Konzert", "Kurs", "Reise"); reuse the kinds already in use. */
  kind: string;
  title: string;
  summary?: string;
  place?: PlaceRef<number>;
  /** The people who were there, as refs into the ramble's people; the user always is. */
  present?: number[];
  series?: SeriesRef;
  private?: boolean;
};
export type RecordedExperience = { id: string; url: string; seriesId: string | null; visibility: Visibility };

const words = (x: string | undefined, what: string, max: number): string => {
  const t = (x ?? "").trim();
  if (!t || t.length > max) throw new InvalidInputError(`${what} needs 1 to ${max} characters`);
  return t;
};

/** Checks experiences before anything is filed: kinds, titles, days, people refs and a new series' rhythm. */
export function validateExperiences(xs: NewExperience[], people: number): void {
  for (const x of xs) {
    words(x.kind, "An experience's kind", MAX_KIND);
    words(x.title, "An experience's title", MAX_TITLE);
    if (x.summary !== undefined && x.summary.length > MAX_EXPERIENCE) throw new InvalidInputError(`An experience's summary holds at most ${MAX_EXPERIENCE} characters`);
    if (x.date !== undefined) {
      assertDay(x.date, "The experience's date");
      notFuture(x.date, "The experience's date");
    }
    for (const p of [...(x.present ?? []), ...ownersOf(x.place).filter((o) => o !== "me" && o !== "us")])
      if (!Number.isInteger(p) || (p as number) < 0 || (p as number) >= people) throw new InvalidInputError(`Person ${p} is not in people`);
    if (x.series && typeof x.series === "object") {
      words(x.series.name, "A series' name", MAX_TITLE);
      const r = x.series.rhythmDays;
      if (r !== undefined && (!Number.isInteger(r) || r < 1 || r > 366)) throw new InvalidInputError("rhythmDays is a whole number of days from 1 to 366");
      for (const d of [x.series.startsOn, x.series.endsOn]) if (d !== undefined) assertDay(d, "A series' day");
    }
  }
}

/** The series an experience names, in `tx`: one the viewer may see by id or exact name, else a new one, private in a private ramble. */
async function resolveSeries(tx: Kysely<Schema>, v: Viewer, ref: SeriesRef, x: NewExperience, day: string, rambleVisibility: Visibility, t: number, placeId: string | null) {
  const seen = () => tx.selectFrom("series").selectAll().$call((qb) => visible(qb, v, "series"));
  if (typeof ref === "string") {
    const s = await seen().where("id", "=", ref).executeTakeFirst();
    if (!s) throw new NotFoundError(`No such series: ${ref}`);
    return s;
  }
  const n = norm(ref.name);
  const same = (await seen().execute()).find((s) => norm(s.name) === n);
  if (same) return same;
  const row = {
    id: newId(),
    name: ref.name.trim(),
    kind: (ref.kind ?? x.kind).trim(),
    rhythm_days: ref.rhythmDays ?? null,
    starts_on: ref.startsOn ?? day,
    ends_on: ref.endsOn ?? null,
    place_id: placeId,
    visibility: rambleVisibility,
    recorded_by: v.userId,
    created_at: t,
  };
  await tx.insertInto("series").values(row).execute();
  return row;
}

/**
 * Files a ramble's experiences in `tx`, with their places, series and people (`personIds[ref]`). An experience is private when
 * the ramble, its series or the experience itself is.
 */
export async function insertExperiences(
  tx: Kysely<Schema>,
  v: Viewer,
  r: { rambleId: string; date: string; visibility: Visibility },
  xs: NewExperience[],
  personIds: string[],
  t: number,
): Promise<RecordedExperience[]> {
  const out: RecordedExperience[] = [];
  for (const x of xs) {
    const day = x.date ?? r.date;
    const levels: string[] = [];
    const placeId = x.place === undefined || x.place === "" ? null : await resolvePlace(tx, v, x.place, r.visibility === "private" || x.private ? "private" : "shared", levels);
    // A new series started by a private experience is private too, or its name and place would reach the other user.
    const series = x.series === undefined ? null : await resolveSeries(tx, v, x.series, x, day, x.private ? "private" : r.visibility, t, placeId);
    const visibility: Visibility = r.visibility === "private" || x.private || series?.visibility === "private" ? "private" : "shared";
    await fileOwnersOf(tx, v, x.place, levels, (o) => (o === "me" || o === "us" ? o : personIds[o]), visibility, r.rambleId);
    const id = newId();
    await tx
      .insertInto("experiences")
      .values({ id, ramble_id: r.rambleId, series_id: series?.id ?? null, place_id: placeId, date: day, kind: x.kind.trim(), title: x.title.trim(), summary: x.summary?.trim() || null, visibility, recorded_by: v.userId, created_at: t })
      .execute();
    for (const personId of new Set([v.personId, ...(x.present ?? []).map((p) => personIds[p])]))
      await tx.insertInto("experience_people").values({ experience_id: id, person_id: personId }).execute();
    out.push({ id, url: series ? `${seriesPath(series.id)}#experience-${id}` : `/r/${r.rambleId}#experience-${id}`, seriesId: series?.id ?? null, visibility });
  }
  return out;
}

export type ExperienceView = {
  id: string;
  date: string;
  kind: string;
  title: string;
  summary: string | null;
  place: { id: string; name: string; url: string } | null;
  series: { id: string; name: string; url: string } | null;
  people: Array<{ id: string; name: string; url: string }>;
  rambleId: string;
  visibility: Visibility;
  /** The viewer recorded it: they may change or delete it. */
  mine: boolean;
  url: string;
};
export type SeriesSummary = { id: string; name: string; kind: string; rhythmDays: number | null; startsOn: string | null; endsOn: string | null; url: string };
export type ExperienceQuery = { from?: string; to?: string; kind?: string; placeId?: string; seriesId?: string; personId?: string; ids?: string[]; limit?: number };

/** The experiences the viewer may see, newest first, narrowed by period, kind (any case), place, series or a person who was there. */
export async function listExperiences(v: Viewer, q: ExperienceQuery = {}): Promise<ExperienceView[]> {
  const d = await db();
  let query = d
    .selectFrom("experiences")
    .selectAll()
    .$call((qb) => visible(qb, v, "experiences"))
    .orderBy("date", "desc")
    .orderBy("created_at", "desc");
  if (q.from) query = query.where("date", ">=", q.from);
  if (q.to) query = query.where("date", "<=", q.to);
  if (q.kind) query = query.where(sql<string>`lower(kind)`, "=", q.kind.trim().toLowerCase());
  if (q.placeId) query = query.where("place_id", "in", placeAndInsideIds(d, v, q.placeId));
  if (q.seriesId) query = query.where("series_id", "=", q.seriesId);
  if (q.personId) query = query.where("id", "in", (eb) => eb.selectFrom("experience_people").select("experience_id").where("person_id", "=", q.personId!));
  if (q.ids) query = query.where("id", "in", q.ids.length ? q.ids : [""]);
  if (q.limit) query = query.limit(q.limit);
  const rows = await query.execute();
  if (!rows.length) return [];
  const ids = rows.map((r) => r.id);
  const [people, places, series] = await Promise.all([
    d
      .selectFrom("experience_people")
      .innerJoin("persons", "persons.id", "experience_people.person_id")
      .select(["experience_people.experience_id", "persons.id", "persons.name"])
      .where("experience_id", "in", ids)
      .where("persons.id", "!=", v.personId)
      .orderBy("persons.name")
      .execute(),
    d.selectFrom("places").select(["id", "name"]).where("id", "in", [...new Set(rows.flatMap((r) => (r.place_id ? [r.place_id] : [])))].concat([""])).execute(),
    d.selectFrom("series").select(["id", "name"]).where("id", "in", [...new Set(rows.flatMap((r) => (r.series_id ? [r.series_id] : [])))].concat([""])).$call((qb) => visible(qb, v, "series")).execute(),
  ]);
  const placeById = new Map(places.map((p) => [p.id, p]));
  const seriesById = new Map(series.map((s) => [s.id, s]));
  return rows.map((r) => {
    const p = r.place_id ? placeById.get(r.place_id) : undefined;
    const s = r.series_id ? seriesById.get(r.series_id) : undefined;
    return {
      id: r.id,
      date: r.date,
      kind: r.kind,
      title: r.title,
      summary: r.summary,
      place: p ? { id: p.id, name: p.name, url: placePath(p.id) } : null,
      series: s ? { id: s.id, name: s.name, url: seriesPath(s.id) } : null,
      people: people.filter((x) => x.experience_id === r.id).map((x) => ({ id: x.id, name: x.name, url: personPath(x.id) })),
      rambleId: r.ramble_id,
      visibility: r.visibility as Visibility,
      mine: r.recorded_by === v.userId,
      url: s ? `${seriesPath(s.id)}#experience-${r.id}` : `${ramblePath(r.ramble_id)}#experience-${r.id}`,
    };
  });
}

/** The kinds the viewer's visible experiences use, most used first, so Claude keeps "Konzert" "Konzert". */
export async function experienceKinds(v: Viewer): Promise<string[]> {
  const rows = await (await db())
    .selectFrom("experiences")
    .select(["kind", (eb) => eb.fn.countAll<number>().as("n")])
    .$call((qb) => visible(qb, v, "experiences"))
    .groupBy("kind")
    .orderBy("n", "desc")
    .orderBy("kind")
    .execute();
  return rows.map((r) => r.kind);
}

/** The series the viewer may see, by name. */
export async function listSeries(v: Viewer): Promise<SeriesSummary[]> {
  const rows = await (await db()).selectFrom("series").selectAll().$call((qb) => visible(qb, v, "series")).orderBy("name").execute();
  return rows.map((s) => ({ id: s.id, name: s.name, kind: s.kind, rhythmDays: s.rhythm_days, startsOn: s.starts_on, endsOn: s.ends_on, url: seriesPath(s.id) }));
}

export type SeriesView = SeriesSummary & {
  place: { id: string; name: string; url: string } | null;
  /** Its sessions the viewer may see, oldest first. */
  sessions: ExperienceView[];
  skipped: string[];
  /** The latest session day that passed untold (sessions.ts), if any. */
  missed: string[];
  visibility: Visibility;
  mine: boolean;
};

/** One series the viewer may see, with its sessions by date and the days skipped. */
export async function getSeries(v: Viewer, id: string, today = todayOf()): Promise<SeriesView> {
  const d = await db();
  const s = await d.selectFrom("series").selectAll().where("id", "=", id).$call((qb) => visible(qb, v, "series")).executeTakeFirst();
  if (!s) throw new NotFoundError("No such series");
  const [sessions, skips, place] = await Promise.all([
    listExperiences(v, { seriesId: id }),
    d.selectFrom("series_skips").select("date").where("series_id", "=", id).orderBy("date").execute(),
    s.place_id ? d.selectFrom("places").select(["id", "name"]).where("id", "=", s.place_id).executeTakeFirst() : undefined,
  ]);
  return {
    id: s.id,
    name: s.name,
    kind: s.kind,
    rhythmDays: s.rhythm_days,
    startsOn: s.starts_on,
    endsOn: s.ends_on,
    url: seriesPath(s.id),
    place: place ? { id: place.id, name: place.name, url: placePath(place.id) } : null,
    sessions: sessions.reverse(),
    skipped: skips.map((x) => x.date),
    missed: (await missedSessions(v, today)).filter((m) => m.seriesId === s.id).map((m) => m.date),
    visibility: s.visibility as Visibility,
    mine: s.recorded_by === v.userId,
  };
}

export type PlaceView = PlaceCandidate & {
  /** The places directly inside it the viewer may see. */
  inside: PlaceCandidate[];
  experiences: ExperienceView[];
  conversations: Array<{ id: string; date: string; summary: string; url: string }>;
  series: SeriesSummary[];
};

/** One place the viewer may see, with everything at it or inside it they may see, newest first. */
export async function getPlace(v: Viewer, id: string): Promise<PlaceView> {
  const d = await db();
  const p = await describePlace(d, v, id);
  const at = placeAndInsideIds(d, v, id);
  const [experiences, conversations, series] = await Promise.all([
    listExperiences(v, { placeId: id }),
    d.selectFrom("conversations").select(["id", "date", "summary"]).where("place_id", "in", at).$call((qb) => visible(qb, v, "conversations")).orderBy("date", "desc").execute(),
    d.selectFrom("series").selectAll().where("place_id", "in", at).$call((qb) => visible(qb, v, "series")).orderBy("name").execute(),
  ]);
  return {
    ...p,
    experiences,
    conversations: conversations.map((c) => ({ ...c, url: conversationPath(c.id) })),
    series: series.map((s) => ({ id: s.id, name: s.name, kind: s.kind, rhythmDays: s.rhythm_days, startsOn: s.starts_on, endsOn: s.ends_on, url: seriesPath(s.id) })),
  };
}
