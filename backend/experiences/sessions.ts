// Missed sessions: a series with a rhythm has a session day every rhythm_days from its start. When one has passed and nothing
// was told of it, freundebuch asks, through whats_due, the daily notification and the chat. Only days after the series was
// filed count (no backlog for a series "since January"), and only the latest; a day is told when a session of the series the
// viewer may see falls on it, the day before, or within half a rhythm after it. Whoever was at a session of the series (that they may see) is
// asked; a skipped day, an ended series and a series without a rhythm never are. Nothing here files anything.
import { addDays, daysBetween, today as todayOf } from "../people/dates";
import { db } from "../db";
import type { Viewer } from "../core/types";
import { seriesPath } from "../core/urls";
import { visible } from "../visibility";

export type MissedSession = { seriesId: string; name: string; date: string; url: string };

/** The latest session day of each series the viewer is part of that passed before `today` untold. */
export async function missedSessions(v: Viewer, today: string): Promise<MissedSession[]> {
  const d = await db();
  const series = await d
    .selectFrom("series")
    .selectAll()
    .where("rhythm_days", "is not", null)
    .$call((qb) => visible(qb, v, "series"))
    .where(
      "id",
      "in",
      (eb) =>
        eb
          .selectFrom("experiences")
          .innerJoin("experience_people", "experience_people.experience_id", "experiences.id")
          .select("experiences.series_id")
          .where("experience_people.person_id", "=", v.personId)
          .where("experiences.series_id", "is not", null)
          .$call((qb) => visible(qb, v, "experiences")) as never,
    )
    .orderBy("name")
    .execute();
  const out: MissedSession[] = [];
  for (const s of series) {
    const rhythm = s.rhythm_days!;
    const start = s.starts_on ?? todayOf(s.created_at);
    const filed = todayOf(s.created_at);
    // The latest session day before today, and none on or before the day it was filed or after it ended.
    const yesterday = addDays(today, -1);
    if (daysBetween(start, yesterday) < 0) continue;
    const day = addDays(start, Math.floor(daysBetween(start, yesterday) / rhythm) * rhythm);
    if (daysBetween(filed, day) <= 0 || (s.ends_on && daysBetween(day, s.ends_on) < 0)) continue;
    const skipped = await d.selectFrom("series_skips").select("date").where("series_id", "=", s.id).where("date", "=", day).executeTakeFirst();
    if (skipped) continue;
    const told = await d
      .selectFrom("experiences")
      .select("id")
      .where("series_id", "=", s.id)
      // A session held a day early (on rhythms of two days or more) counts too.
      .where("date", ">=", addDays(day, rhythm >= 2 ? -1 : 0))
      .where("date", "<=", addDays(day, Math.floor(rhythm / 2)))
      .$call((qb) => visible(qb, v, "experiences"))
      .executeTakeFirst();
    if (!told) out.push({ seriesId: s.id, name: s.name, date: day, url: seriesPath(s.id) });
  }
  return out;
}
