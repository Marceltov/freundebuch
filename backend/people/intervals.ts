// "Last seen" and the check-in interval, both per viewer: only conversations the viewer can see and their own person took
// part in count, so the partner's calls with Anna never change how long it has been for me.
import { db } from "../db";
import { daysBetween, today } from "./dates";
import { InvalidInputError, NotFoundError } from "../core/errors";
import type { Viewer } from "../core/types";
import { visible } from "../visibility";

const WINDOW = 6;
const MIN_CONVERSATIONS = 3;
const WEEK = 7;
const MAX_INTERVAL_DAYS = 3650;

/** Dates (newest first) of the visible conversations with the person that the viewer's own person also took part in. */
async function datesSeen(v: Viewer, personId: string, limit: number): Promise<string[]> {
  const rows = await (
    await db()
  )
    .selectFrom("conversations")
    .innerJoin("participants as them", "them.conversation_id", "conversations.id")
    .innerJoin("participants as me", "me.conversation_id", "conversations.id")
    .select("conversations.date")
    .where("them.person_id", "=", personId)
    .where("me.person_id", "=", v.personId)
    .$call((qb) => visible(qb, v, "conversations"))
    .orderBy("conversations.date", "desc")
    .limit(limit)
    .execute();
  return rows.map((r) => r.date);
}

export async function lastSeen(v: Viewer, personId: string): Promise<string | null> {
  return (await datesSeen(v, personId, 1))[0] ?? null;
}

/** The median gap between the last 6 conversations, rounded to whole weeks (at least one); null with fewer than 3 conversations. */
export async function suggestInterval(v: Viewer, personId: string): Promise<number | null> {
  const dates = (await datesSeen(v, personId, WINDOW)).reverse();
  if (dates.length < MIN_CONVERSATIONS) return null;
  const gaps = dates
    .slice(1)
    .map((d, i) => daysBetween(dates[i], d))
    .sort((a, b) => a - b);
  const mid = gaps.length >> 1;
  const median = gaps.length % 2 ? gaps[mid] : (gaps[mid - 1] + gaps[mid]) / 2;
  return Math.max(WEEK, Math.round(median / WEEK) * WEEK);
}

/** Stores the viewer's own interval for a person; `null` days means no check-in wanted. `confirmed` says the viewer agreed to it. */
export async function setCheckInInterval(v: Viewer, personId: string, days: number | null, confirmed: boolean): Promise<void> {
  if (days !== null && (!Number.isInteger(days) || days < 1 || days > MAX_INTERVAL_DAYS))
    throw new InvalidInputError(`The interval must be a whole number of days from 1 to ${MAX_INTERVAL_DAYS}`);
  const d = await db();
  if (!(await d.selectFrom("persons").select("id").where("id", "=", personId).executeTakeFirst())) throw new NotFoundError("No such person");
  const values = { interval_days: days, interval_confirmed: confirmed ? 1 : 0 };
  await d
    .insertInto("person_settings")
    .values({ user_id: v.userId, person_id: personId, ...values })
    .onConflict((oc) => oc.columns(["user_id", "person_id"]).doUpdateSet(values))
    .execute();
}

export type Freshness = { lastSeen: string | null; intervalDays: number | null; ratio: number | null };

/** `ratio` is the days since last seen divided by the interval; null without either. 1 means the check-in falls due today. */
export async function freshness(v: Viewer, personId: string, from = today()): Promise<Freshness> {
  const [seen, setting] = await Promise.all([
    lastSeen(v, personId),
    (await db()).selectFrom("person_settings").select("interval_days").where("user_id", "=", v.userId).where("person_id", "=", personId).executeTakeFirst(),
  ]);
  const intervalDays = setting?.interval_days ?? null;
  return { lastSeen: seen, intervalDays, ratio: seen && intervalDays ? daysBetween(seen, from) / intervalDays : null };
}
