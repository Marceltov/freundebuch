// Experiences: what the user lived through on a day (a concert, a trip, a dog-school lesson), as parts of a ramble, and series
// of them (a course, a weekly training). Claude files them with record (conversations.ts); nothing here interprets. A series
// stays a memory: nothing removes it on its own. Every read goes through visible().
import type { Kysely } from "kysely";
import { assertDay, notFuture } from "./dates";
import { newId, type Schema } from "./db";
import { InvalidInputError, NotFoundError } from "./errors";
import { norm } from "./names";
import { resolvePlace, type PlaceRef } from "./places";
import type { Viewer, Visibility } from "./types";
import { seriesPath } from "./urls";
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
  place?: PlaceRef;
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
    for (const p of x.present ?? []) if (!Number.isInteger(p) || p < 0 || p >= people) throw new InvalidInputError(`Person ${p} is not in people`);
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
    const placeId = x.place === undefined || x.place === "" ? null : await resolvePlace(tx, v, x.place);
    const series = x.series === undefined ? null : await resolveSeries(tx, v, x.series, x, day, r.visibility, t, placeId);
    const visibility: Visibility = r.visibility === "private" || x.private || series?.visibility === "private" ? "private" : "shared";
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
