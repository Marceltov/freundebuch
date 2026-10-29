// The journal: what the user thinks, feels and plans about their own life, cut from their rambles (conversations.ts, record).
// Entries are private unless the user shared one; every read goes through visible(), so another user never learns that a
// private entry exists. Claude reads the journal and interprets it (the MCP tool journal); nothing here interprets.
import { addDays, today } from "./dates";
import { db } from "./db";
import type { Viewer, Visibility } from "./types";
import { journalPath, personPath } from "./urls";
import { visible } from "./visibility";

/** The days read when no period is given. */
export const JOURNAL_DAYS = 30;

export type JournalEntry = {
  id: string;
  date: string;
  text: string;
  people: Array<{ id: string; name: string; url: string }>;
  rambleId: string;
  visibility: Visibility;
  /** `mine`: the viewer wrote it, so they may edit, share or delete it. */
  mine: boolean;
  url: string;
};

/**
 * The viewer's journal entries, and the other user's they shared, from `from` to `to` (the last JOURNAL_DAYS days when left
 * out), newest first; `personId` narrows them to the entries that name that person. `own` leaves out the other user's.
 */
export async function journalEntries(v: Viewer, q: { from?: string; to?: string; personId?: string; own?: boolean; limit?: number } = {}): Promise<JournalEntry[]> {
  const to = q.to ?? today();
  const from = q.from ?? addDays(to, -JOURNAL_DAYS);
  const d = await db();
  let query = d
    .selectFrom("journal_entries")
    .selectAll()
    .where("date", ">=", from)
    .where("date", "<=", to)
    .$call((qb) => visible(qb, v, "journal_entries"))
    .orderBy("date", "desc")
    .orderBy("created_at", "desc");
  if (q.own) query = query.where("recorded_by", "=", v.userId);
  if (q.personId) query = query.where("id", "in", (eb) => eb.selectFrom("journal_mentions").select("entry_id").where("person_id", "=", q.personId!));
  if (q.limit) query = query.limit(q.limit);
  const rows = await query.execute();
  const mentions = rows.length
    ? await d
        .selectFrom("journal_mentions")
        .innerJoin("persons", "persons.id", "journal_mentions.person_id")
        .select(["journal_mentions.entry_id", "persons.id", "persons.name"])
        .where("journal_mentions.entry_id", "in", rows.map((r) => r.id))
        .orderBy("persons.name")
        .execute()
    : [];
  return rows.map((r) => ({
    id: r.id,
    date: r.date,
    text: r.text,
    people: mentions.filter((m) => m.entry_id === r.id).map((m) => ({ id: m.id, name: m.name, url: personPath(m.id) })),
    rambleId: r.ramble_id,
    visibility: r.visibility as Visibility,
    mine: r.recorded_by === v.userId,
    url: journalPath(r.id),
  }));
}
