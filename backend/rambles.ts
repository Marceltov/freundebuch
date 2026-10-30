// Reading rambles: what the user told in one go, and the parts filed from it (conversations, journal entries, items). A ramble
// exists for a viewer only through a part they may see, so the other user never learns of one that holds only a private
// journal entry; its transcript they read only when nothing told in it is private.
import { listConversations, type ConversationSummary } from "./conversations";
import { db } from "./db";
import { ForbiddenError, NotFoundError } from "./errors";
import { listExperiences, type ExperienceView } from "./experiences";
import { pruneFiles } from "./files";
import { journalEntries, type JournalEntry } from "./journal";
import type { Viewer } from "./types";
import { personPath, ramblePath } from "./urls";
import { visible } from "./visibility";

/** An item filed with the ramble alone, not with one of its conversations. */
export type RambleItem = { table: "facts" | "promises" | "dates" | "exchanges"; id: string; text: string; person: { id: string; name: string; url: string } };
export type RambleSummary = {
  id: string;
  date: string;
  url: string;
  conversations: ConversationSummary[];
  experiences: ExperienceView[];
  journal: JournalEntry[];
  items: RambleItem[];
};
export type RambleView = RambleSummary & { transcript: string | null; recordedBy: string };

const EVER = "0000-01-01";

/** The items the viewer may see that were filed with a ramble but with none of its conversations. */
async function rambleItems(v: Viewer): Promise<Array<RambleItem & { rambleId: string }>> {
  const d = await db(v);
  const out: Array<RambleItem & { rambleId: string }> = [];
  for (const table of ["facts", "promises", "dates", "exchanges"] as const) {
    const rows = await d
      .selectFrom(table as "facts")
      .innerJoin("persons", "persons.id", `${table as "facts"}.person_id`)
      .select([`${table as "facts"}.id as id`, `${table as "facts"}.ramble_id as ramble_id`, "persons.id as personId", "persons.name as name"])
      .$if(table === "dates", (qb) => qb.select((eb) => eb.fn.coalesce(eb.ref("dates.label" as "facts.text"), eb.ref("dates.date" as "facts.text")).as("text")))
      .$if(table !== "dates", (qb) => qb.select(`${table as "facts"}.text as text`))
      .where(`${table as "facts"}.ramble_id`, "is not", null)
      .where(`${table as "facts"}.conversation_id`, "is", null)
      .$call((qb) => visible(qb, v, table as "facts"))
      .orderBy(`${table as "facts"}.created_at`)
      .execute();
    for (const r of rows as Array<{ id: string; ramble_id: string; personId: string; name: string; text: string }>)
      out.push({ table, id: r.id, rambleId: r.ramble_id, text: r.text, person: { id: r.personId, name: r.name, url: personPath(r.personId) } });
  }
  return out;
}

/** Every ramble the viewer may see a part of, newest first, with those parts. */
export async function listRambles(v: Viewer): Promise<RambleSummary[]> {
  const [conversations, journal, items, experiences] = await Promise.all([
    listConversations(v),
    journalEntries(v, { from: EVER, to: "9999-12-31" }),
    rambleItems(v),
    listExperiences(v),
  ]);
  const ids = [
    ...new Set([
      ...conversations.map((c) => c.rambleId),
      ...journal.map((j) => j.rambleId),
      ...items.map((i) => i.rambleId),
      ...experiences.map((e) => e.rambleId),
    ]),
  ];
  if (!ids.length) return [];
  const d = await db(v);
  const rows = await d
    .selectFrom("rambles")
    .select(["id", "date"])
    .where("id", "in", ids)
    .$call((qb) => visible(qb, v, "rambles"))
    .orderBy("date", "desc")
    .orderBy("created_at", "desc")
    .execute();
  return rows.map((r) => ({
    id: r.id,
    date: r.date,
    url: ramblePath(r.id),
    conversations: conversations.filter((c) => c.rambleId === r.id),
    experiences: experiences.filter((e) => e.rambleId === r.id),
    journal: journal.filter((j) => j.rambleId === r.id),
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    items: items.filter((i) => i.rambleId === r.id).map(({ rambleId, ...i }) => i),
  }));
}

/** One ramble with its parts the viewer may see, and its transcript when they may read it. */
export async function getRamble(v: Viewer, id: string): Promise<RambleView> {
  const summary = (await listRambles(v)).find((r) => r.id === id);
  if (!summary) throw new NotFoundError("No such ramble");
  const d = await db(v);
  const r = await d.selectFrom("rambles").select(["transcript", "transcript_private", "recorded_by"]).where("id", "=", id).executeTakeFirstOrThrow();
  return { ...summary, transcript: r.recorded_by === v.userId || !r.transcript_private ? r.transcript : null, recordedBy: r.recorded_by };
}

/** A ramble's verbatim transcript, for get_transcript by the ramble's id: null while it is private to the other user. */
export async function rambleTranscript(v: Viewer, id: string): Promise<{ rambleId: string; date: string; url: string; transcript: string | null }> {
  const r = await getRamble(v, id);
  return { rambleId: r.id, date: r.date, url: r.url, transcript: r.transcript };
}

/** Deletes a ramble the viewer recorded, and with it everything told in it: its conversations, journal entries and items. */
export async function deleteRamble(v: Viewer, id: string): Promise<void> {
  const r = await getRamble(v, id);
  if (r.recordedBy !== v.userId) throw new ForbiddenError("Only the person who recorded a ramble may delete it");
  await (await db(v)).deleteFrom("rambles").where("id", "=", id).execute();
  // A fact filed from a shared file takes the file with it once nothing else names it.
  await pruneFiles(v);
}
