// What needs attention for a viewer: dates coming up, promises with a due date, and people not seen for longer than their
// interval. Everything is read through `visible` and the viewer's own interval, so the partner's private items never show up.
import { missedSessions } from "./sessions";
import { db } from "./db";
import { ageOn, daysBetween, nextOccurrence, today } from "./dates";
import { freshness } from "./intervals";
import type { Viewer } from "./types";
import { itemPath, personPath } from "./urls";
import { visible } from "./visibility";

/**
 * `byMe`, on a promise: the viewer made it; false when the person promised it to the viewer. `itemId`: the date's, promise's or
 * situation's id; on a situation, `date` is its checkAfter, the day it turned into a nudge to ask how it went.
 * `lastSeen` and `intervalDays`: for someone overdue.
 */
export type DueItem = {
  /** `session`: a missed session of a series (name: the series, itemId: its id, date: the day; personId: the viewer's own). */
  kind: "date" | "promise" | "overdue" | "situation" | "session";
  personId: string;
  name: string;
  date?: string;
  text?: string;
  ratio?: number;
  byMe?: boolean;
  itemId?: string;
  lastSeen?: string | null;
  intervalDays?: number | null;
  url: string;
};

export type UpcomingDate = {
  id: string;
  personId: string;
  kind: "birthday" | "anniversary" | "custom";
  label: string | null;
  /** The day it falls on next. */
  date: string;
  inDays: number;
  /** The age reached, for a birthday with a year. */
  age: number | null;
  /** Its row on the person's page. */
  url: string;
};

/** The viewer's visible dates that fall within `horizonDays` of `from`, soonest first; a yearly date recurs, a one-off date only counts once. */
export async function upcomingDates(v: Viewer, from: string, horizonDays: number, personId?: string): Promise<UpcomingDate[]> {
  let q = (await db(v))
    .selectFrom("dates")
    .selectAll()
    .$call((qb) => visible(qb, v, "dates"));
  if (personId) q = q.where("person_id", "=", personId);
  const out: UpcomingDate[] = [];
  for (const d of await q.execute()) {
    const date = d.yearly ? nextOccurrence(d.date, from) : d.date;
    const inDays = daysBetween(from, date);
    if (inDays < 0 || inDays > horizonDays) continue;
    out.push({
      id: d.id,
      personId: d.person_id,
      kind: d.kind,
      label: d.label,
      date,
      inDays,
      age: d.kind === "birthday" ? ageOn(d.date, date) : null,
      url: itemPath(personPath(d.person_id), "dates", d.id),
    });
  }
  return out.sort((a, b) => a.inDays - b.inDays || a.id.localeCompare(b.id));
}

/**
 * Dates by closeness, then people past their interval by how far past (ratio, largest first), then situations to ask about (their
 * checkAfter has come, oldest first), then promises by due date. Only the viewer's own promises count: one the partner recorded is
 * between them and the person, even when it is shared. A shared situation nudges both users, a private one only its recorder.
 */
export async function whatsDue(v: Viewer, from = today(), horizonDays = 14): Promise<DueItem[]> {
  const d = await db(v);
  const names = new Map((await d.selectFrom("persons").select(["id", "name"]).execute()).map((p) => [p.id, p.name]));
  const name = (id: string) => names.get(id) ?? "";

  const dates: DueItem[] = (await upcomingDates(v, from, horizonDays)).map((u) => ({
    kind: "date",
    personId: u.personId,
    name: name(u.personId),
    date: u.date,
    text: u.label ?? u.kind,
    itemId: u.id,
    url: u.url,
  }));

  const overdue: DueItem[] = [];
  for (const id of names.keys()) {
    if (id === v.personId) continue;
    const { ratio, lastSeen, intervalDays } = await freshness(v, id, from);
    if (ratio !== null && ratio > 1) overdue.push({ kind: "overdue", personId: id, name: name(id), ratio, lastSeen, intervalDays, url: personPath(id) });
  }
  overdue.sort((a, b) => b.ratio! - a.ratio! || a.name.localeCompare(b.name));

  // Promises that are open and due within the horizon, including those already past due.
  const limit = new Date(`${from}T00:00:00Z`);
  limit.setUTCDate(limit.getUTCDate() + horizonDays);
  const promises: DueItem[] = (
    await d
      .selectFrom("promises")
      .select(["id", "person_id", "text", "due", "by_me"])
      .where("done", "=", 0)
      .where("due", "is not", null)
      .where("due", "<=", limit.toISOString().slice(0, 10))
      .$call((qb) => visible(qb, v, "promises"))
      .where("recorded_by", "=", v.userId)
      .orderBy("due")
      .orderBy("created_at")
      .execute()
  ).map((p) => ({
    kind: "promise",
    personId: p.person_id,
    name: name(p.person_id),
    date: p.due!,
    text: p.text,
    byMe: !!p.by_me,
    itemId: p.id,
    url: itemPath(personPath(p.person_id), "promises", p.id),
  }));

  const situations: DueItem[] = (
    await d
      .selectFrom("facts")
      .select(["id", "person_id", "text", "check_after"])
      .where("kind", "=", "situation")
      .where("status", "=", "current")
      .where("check_after", "<=", from)
      .$call((qb) => visible(qb, v, "facts"))
      .orderBy("check_after")
      .orderBy("created_at")
      .execute()
  ).map((f) => ({
    kind: "situation",
    personId: f.person_id,
    name: name(f.person_id),
    date: f.check_after!,
    text: f.text,
    itemId: f.id,
    url: itemPath(personPath(f.person_id), "facts", f.id),
  }));

  const sessions: DueItem[] = (await missedSessions(v, from)).map((m) => ({
    kind: "session",
    personId: v.personId,
    name: m.name,
    date: m.date,
    itemId: m.seriesId,
    url: m.url,
  }));

  return [...dates, ...overdue, ...situations, ...sessions, ...promises];
}
