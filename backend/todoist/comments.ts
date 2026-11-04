// Comments the user wrote on freundebuch's Todoist tasks (a line of text, a photo, a voice message) go to Prüfen, as files they
// shared, dated by the comment and carrying the task they came from, so Claude can work them through with the user. Nothing is
// filed or ticked from a comment (V5). Only the account's own comments on tasks freundebuch made count (V3), and each lands in
// the task's book, as that user's file (V2). A note is taken in once: it is claimed first, and a part that can't be taken (a
// download Todoist refuses, a type freundebuch doesn't read) is logged and left out, never retried, so the sync goes on.
import { fileModel, MAX_UPLOAD, queueRead, shareFile, type FileContext } from "../conversations/files";
import { errorFields, logger } from "../core/log";
import type { Viewer } from "../core/types";
import { instance } from "../db/scope";
import { inBook } from "../people/books";
import { todoist, type TodoistNote } from "./client";

const log = logger("todoist");

/** Takes the user's new comments on known tasks into Prüfen; returns how many files that made. */
export async function takeComments(all: Viewer, token: string, notes: TodoistNote[], userId: string, fetchFn: typeof fetch = fetch): Promise<number> {
  const own = notes.filter((n) => !n.deleted && n.postedUid === userId);
  if (!own.length) return 0;
  const i = await instance();
  const tasks = await i
    .from("todoist_tasks")
    .selectAll()
    .where("user_id", "=", all.userId)
    .where(
      "task_id",
      "in",
      own.map((n) => n.itemId),
    )
    .execute();
  const model = fileModel();
  let made = 0;
  for (const note of own) {
    const task = tasks.find((t) => t.task_id === note.itemId);
    if (!task) continue;
    // Claimed first: a pull running at the same time (pullNow next to the scheduler) leaves it alone.
    const claimed = await i
      .insert("todoist_notes", { user_id: all.userId, note_id: note.id, created_at: Date.now() })
      .onConflict((oc) => oc.columns(["user_id", "note_id"]).doNothing())
      .executeTakeFirst();
    if (!Number(claimed.numInsertedOrUpdatedRows ?? 0)) continue;
    let v: Viewer;
    try {
      v = await inBook(all, task.book_id);
    } catch {
      continue; // the book is gone, or the user left it
    }
    const context: FileContext = { source: "todoist", taskTitle: task.title ?? task.kind, kind: task.kind, personId: task.person_id, itemId: task.item_id };
    const opts = { createdAt: Date.parse(note.postedAt) || Date.now(), context, dedup: false };
    const batch = `todoist-${task.task_id}`.slice(0, 64);
    const parts: (() => Promise<{ bytes: Uint8Array; type: string }>)[] = [];
    if (note.content.trim()) parts.push(async () => ({ bytes: new TextEncoder().encode(note.content), type: "text/plain" }));
    if (note.attachment) parts.push(() => todoist(token, fetchFn).download(note.attachment!.url, MAX_UPLOAD));
    for (const part of parts) {
      try {
        const { bytes, type } = await part();
        const file = await shareFile(v, bytes, type, batch, opts);
        made++;
        if (model) void queueRead(v, file.id, model);
      } catch (e) {
        log.warn({ err: { type: errorFields(e).type } }, "a todoist comment could not be taken in");
      }
    }
  }
  return made;
}
