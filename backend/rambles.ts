// Reading rambles: what the user told in one go, and the parts filed from it (conversations, journal entries). A ramble
// exists for a viewer only through a part they may see, so the other user never learns of one that holds only a private
// journal entry; its transcript they read only when nothing filed from it is private.
import { listConversations, type ConversationSummary } from "./conversations";
import { db } from "./db";
import { NotFoundError } from "./errors";
import { journalEntries, type JournalEntry } from "./journal";
import type { Viewer } from "./types";
import { ramblePath } from "./urls";
import { visible } from "./visibility";

export type RambleSummary = { id: string; date: string; url: string; conversations: ConversationSummary[]; journal: JournalEntry[] };
export type RambleView = RambleSummary & { transcript: string | null; recordedBy: string };

const EVER = "0000-01-01";

/** Every ramble the viewer may see a part of, newest first, with those parts. */
export async function listRambles(v: Viewer): Promise<RambleSummary[]> {
  const [conversations, journal] = await Promise.all([listConversations(v), journalEntries(v, { from: EVER, to: "9999-12-31" })]);
  const ids = [...new Set([...conversations.map((c) => c.rambleId), ...journal.map((j) => j.rambleId)])];
  if (!ids.length) return [];
  const d = await db();
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
    journal: journal.filter((j) => j.rambleId === r.id),
  }));
}

/** One ramble with its parts the viewer may see, and its transcript when they may read it. */
export async function getRamble(v: Viewer, id: string): Promise<RambleView> {
  const summary = (await listRambles(v)).find((r) => r.id === id);
  if (!summary) throw new NotFoundError("No such ramble");
  const d = await db();
  const r = await d.selectFrom("rambles").select(["transcript", "transcript_private", "recorded_by"]).where("id", "=", id).executeTakeFirstOrThrow();
  return { ...summary, transcript: r.recorded_by === v.userId || !r.transcript_private ? r.transcript : null, recordedBy: r.recorded_by };
}
