// Follow-ups: a ticked Todoist task about someone overdue, a situation or a missed session. Ticking it says the user got in touch,
// not what came of it, so nothing is filed: the follow-up stays open and Claude asks how it went. It closes on its own once what
// it is about changes (a conversation newer than the last seen the task was made from, in any of the person's books; a new
// checkAfter or the situation's end; the session told or skipped), or as a plain contact on the ticked day when nothing was worth
// noting. A follow-up is private to the user who ticked it.
import { newId, now } from "../db";
import { instance, scope } from "../db/scope";
import { NotFoundError } from "../core/errors";
import type { Viewer } from "../core/types";
import { itemPath, personPath, seriesPath } from "../core/urls";
import { missedSessions } from "../experiences/sessions";
import { viewerIn, viewerOf } from "../people/books";
import { addDays } from "../people/dates";
import { lastSeen } from "../people/intervals";
import { partsOf } from "../people/links";
import { visible } from "../visibility";

export type FollowUpKind = "overdue" | "situation" | "session";

/** `name`: the person's, or on a session the series'. `text`: a situation's. `day`: the day it was ticked. */
export type FollowUp = {
  id: string;
  kind: FollowUpKind;
  personId: string;
  name: string;
  factId: string | null;
  seriesId: string | null;
  sessionDay: string | null;
  day: string;
  text: string | null;
  url: string;
};

/** `lastSeen` (overdue): the person's last seen the task was made from; now's when left out. */
export type NewFollowUp = {
  kind: FollowUpKind;
  personId: string;
  factId?: string;
  seriesId?: string;
  sessionDay?: string;
  day: string;
  lastSeen?: string | null;
};

/** When the user last saw the person in any of their books: the newest last seen of the person's parts (one when not linked). */
export async function lastSeenAcross(v: Viewer, personId: string): Promise<string | null> {
  const i = await instance();
  const all = (await viewerOf(i, v.userId))!;
  const parts = await partsOf(all, personId);
  const seen = await Promise.all(parts.map(async (p) => lastSeen((await viewerIn(i, v.userId, p.book.id))!, p.id)));
  return (
    seen
      .filter((x): x is string => !!x)
      .sort()
      .at(-1) ?? null
  );
}

/** Opens a follow-up in the viewer's book; when one for the same thing is open already, that one's id. */
export async function addFollowUp(v: Viewer, f: NewFollowUp): Promise<string> {
  const same = (await openFollowUps(v, f.personId)).find(
    (o) =>
      o.kind === f.kind &&
      (f.kind === "overdue" ||
        (f.kind === "situation" && o.factId === (f.factId ?? null)) ||
        (f.kind === "session" && o.seriesId === (f.seriesId ?? null) && o.sessionDay === (f.sessionDay ?? null))),
  );
  if (same) return same.id;
  const seen = f.kind === "overdue" ? (f.lastSeen !== undefined ? f.lastSeen : await lastSeenAcross(v, f.personId)) : null;
  const id = newId();
  await (
    await scope(v)
  )
    .insert("follow_ups", {
      id,
      kind: f.kind,
      person_id: f.personId,
      fact_id: f.factId ?? null,
      series_id: f.seriesId ?? null,
      session_day: f.sessionDay ?? null,
      day: f.day,
      last_seen: seen,
      visibility: "private",
      recorded_by: v.userId,
      created_at: now(),
    })
    .execute();
  return id;
}

/** The viewer's open follow-ups (about `personId`, if given), oldest first; those whose cause has changed are closed on the way. */
export async function openFollowUps(v: Viewer, personId?: string): Promise<FollowUp[]> {
  const d = await scope(v);
  let q = d
    .from("follow_ups")
    .innerJoin("persons", "persons.id", "follow_ups.person_id")
    .select([
      "follow_ups.id",
      "follow_ups.kind",
      "follow_ups.person_id",
      "follow_ups.fact_id",
      "follow_ups.series_id",
      "follow_ups.session_day",
      "follow_ups.day",
      "follow_ups.last_seen",
      "persons.name",
    ])
    .where("follow_ups.closed_at", "is", null)
    .$call((qb) => visible(qb, v, "follow_ups"))
    .orderBy("follow_ups.day")
    .orderBy("follow_ups.created_at");
  if (personId) q = q.where("follow_ups.person_id", "=", personId);
  const rows = await q.execute();
  const ids = (k: "fact_id" | "series_id") => [...new Set(rows.flatMap((r) => (r[k] ? [r[k]] : [])))];
  const factIds = ids("fact_id");
  const seriesIds = ids("series_id");
  const facts = new Map(
    factIds.length
      ? (await visible(d.from("facts").select(["id", "text", "status", "check_after"]).where("id", "in", factIds), v, "facts").execute()).map((f) => [f.id, f])
      : [],
  );
  const series = new Map(
    seriesIds.length
      ? (await visible(d.from("series").select(["id", "name"]).where("id", "in", seriesIds), v, "series").execute()).map((x) => [x.id, x.name])
      : [],
  );

  const open: FollowUp[] = [];
  const resolved: string[] = [];
  for (const r of rows) {
    const fact = r.fact_id ? facts.get(r.fact_id) : undefined;
    let done: boolean;
    // Seen since the task was made, in any of the person's books: a call the day before the tick, filed after it, counts too.
    if (r.kind === "overdue") {
      const seen = await lastSeenAcross(v, r.person_id);
      done = !!seen && (r.last_seen === null || seen > r.last_seen);
    }
    // A fact that is gone, or that the viewer may no longer see, has ended for them.
    else if (r.kind === "situation") done = !fact || fact.status !== "current" || (fact.check_after ?? "") > r.day;
    else done = !(await missedSessions(v, addDays(r.session_day!, 1))).some((m) => m.seriesId === r.series_id && m.date === r.session_day);
    if (done) {
      resolved.push(r.id);
      continue;
    }
    open.push({
      id: r.id,
      kind: r.kind,
      personId: r.person_id,
      name: r.kind === "session" ? (series.get(r.series_id!) ?? "") : r.name,
      factId: r.fact_id,
      seriesId: r.series_id,
      sessionDay: r.session_day,
      day: r.day,
      text: fact?.text ?? null,
      url:
        r.kind === "situation"
          ? itemPath(personPath(r.person_id), "facts", r.fact_id!)
          : r.kind === "session"
            ? seriesPath(r.series_id!)
            : personPath(r.person_id),
    });
  }
  if (resolved.length) await d.update("follow_ups").set({ closed_at: now() }).where("id", "in", resolved).execute();
  return open;
}

/**
 * Closes a follow-up as a plain contact on the day it was ticked: the person's last seen moves to it, nothing else is filed. One
 * that closed already (its situation got a new checkAfter just before) still counts as the contact.
 */
export async function closeAsContact(v: Viewer, id: string): Promise<void> {
  const d = await scope(v);
  const row = await d
    .from("follow_ups")
    .select(["id", "closed_at"])
    .where("id", "=", id)
    .$call((qb) => visible(qb, v, "follow_ups"))
    .executeTakeFirst();
  if (!row) throw new NotFoundError("No such follow-up");
  await d
    .update("follow_ups")
    .set({ contact: 1, closed_at: row.closed_at ?? now() })
    .where("id", "=", id)
    .execute();
}
