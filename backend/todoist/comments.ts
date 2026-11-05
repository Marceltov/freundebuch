// Comments the user wrote on freundebuch's Todoist tasks (a line of text, a photo, a voice message) go to Prüfen, as files they
// shared, dated by the comment and carrying the task they came from, so Claude can work them through with the user. Nothing is
// filed or ticked from a comment (V5). Only the account's own comments on tasks freundebuch made count (V3), and each lands in
// the task's book, as that user's file (V2). A note is taken in once: it is claimed first, and a part that can't be taken (a
// download Todoist refuses, a type freundebuch doesn't read, a file too large) is logged and left out, never retried, so the sync
// goes on. Without a file model (no Anthropic key) nothing is taken: the comments wait in Todoist until there is one.
import { fileModel, MAX_UPLOAD, queueRead, shareFile, type FileContext } from "../conversations/files";
import { NotFoundError } from "../core/errors";
import { errorFields, logger } from "../core/log";
import type { Viewer } from "../core/types";
import { instance } from "../db/scope";
import { inBook } from "../people/books";
import { todoist, type TodoistNote } from "./client";

const log = logger("todoist");

/** Takes the user's new comments on known tasks into Prüfen; returns how many files that made. */
export async function takeComments(all: Viewer, token: string, notes: TodoistNote[], userId: string, fetchFn: typeof fetch = fetch): Promise<number> {
  const model = fileModel();
  if (!model) return 0;
  const own = notes.filter((n) => !n.deleted && n.postedUid === userId);
  if (!own.length) return 0;
  const i = await instance();
  // The user's tasks, matched here rather than in the query: a full read can bring thousands of notes.
  const tasks = new Map((await i.from("todoist_tasks").selectAll().where("user_id", "=", all.userId).execute()).map((t) => [t.task_id, t]));
  let made = 0;
  for (const note of own) {
    const task = tasks.get(note.itemId);
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
    } catch (e) {
      if (e instanceof NotFoundError) continue; // the book is gone, or the user left it
      // Anything else (the database, say): let the note go, so the next pull (the sync position isn't saved) takes it.
      await i.delete("todoist_notes").where("user_id", "=", all.userId).where("note_id", "=", note.id).execute();
      throw e;
    }
    const context: FileContext = {
      source: "todoist",
      taskTitle: task.title ?? task.kind,
      kind: task.kind,
      personId: task.person_id,
      itemId: task.item_id,
      taskId: task.task_id,
    };
    const opts = { createdAt: Date.parse(note.postedAt) || Date.now(), context, dedup: false };
    // One comment is one batch (its text and its voice message together); comments on one task stay apart.
    const batch = `todoist-${note.id}`.slice(0, 64);
    const parts: (() => Promise<{ bytes: Uint8Array; type: string }>)[] = [];
    if (note.content.trim()) parts.push(async () => ({ bytes: new TextEncoder().encode(note.content), type: "text/plain" }));
    const file = note.attachment;
    if (file && file.size > MAX_UPLOAD) log.warn({ size: file.size }, "a todoist comment's file is too large; left out");
    else if (file) parts.push(() => todoist(token, fetchFn).download(file.url, MAX_UPLOAD));
    for (const part of parts) {
      try {
        const { bytes, type } = await part();
        const shared = await shareFile(v, bytes, type, batch, opts);
        made++;
        void queueRead(v, shared.id, model);
      } catch (e) {
        log.warn({ err: { type: errorFields(e).type } }, "a todoist comment could not be taken in");
      }
    }
  }
  return made;
}
