// The Todoist sync, per user: ticks come in, then what is due goes out as tasks, then tasks whose item was resolved in freundebuch
// are closed. Each user's tasks come from their own dueAcross, like the push, so nothing of the partner's private items reaches
// their Todoist (V2). A tick files nothing on its own (V5): a promise is marked done, someone overdue, a situation or a missed
// session gets an open follow-up Claude asks about. Every task made is kept in todoist_tasks under a key for its item and day, so
// an item gets one task, and a task ticked, deleted or closed is never made again.
import { markDone } from "../conversations/corrections";
import { config } from "../core/config";
import { errorFields, logger } from "../core/log";
import { getSettings, userLanguage } from "../core/settings";
import type { Viewer } from "../core/types";
import { viewerById } from "../core/users";
import { instance, scope } from "../db/scope";
import { NotFoundError } from "../core/errors";
import { notifyCopy } from "../notify/copy";
import { dueMessage, withBook } from "../notify/message";
import { inBook } from "../people/books";
import { daysBetween, today } from "../people/dates";
import { dueAcross, type InBook } from "../reading/across";
import type { DueItem } from "../reading/due";
import { addFollowUp } from "../reading/followups";
import { visible } from "../visibility";
import { TodoistAuthError, todoist } from "./client";
import { todoistStatus, type DueKind } from "./settings";

const log = logger("todoist");

type TaskRow = {
  user_id: string;
  key: string;
  task_id: string;
  book_id: string;
  kind: DueItem["kind"];
  item_id: string | null;
  person_id: string;
  day: string;
};

/** The task's key: its item and, where a new one makes a new task, its day (a new conversation, a new checkAfter). */
export function itemKey(item: InBook<DueItem>): string {
  const b = item.book.id;
  switch (item.kind) {
    case "date":
      return `date|${b}|${item.itemId}|${item.date}`;
    case "promise":
      return `promise|${b}|${item.itemId}`;
    case "overdue":
      return `overdue|${b}|${item.personId}|${item.lastSeen ?? "never"}`;
    case "situation":
      return `situation|${b}|${item.itemId}|${item.date}`;
    case "session":
      return `session|${b}|${item.itemId}|${item.date}`;
  }
}

/** The lead-time kind of a date or promise; null for what is due now (overdue, situation, session). */
export function kindOf(item: DueItem): DueKind | null {
  if (item.kind === "promise") return "promise";
  if (item.kind !== "date") return null;
  return item.dateKind === "birthday" ? "birthday" : item.dateKind === "anniversary" ? "anniversary" : "date";
}

/** What a tick means for the item behind the task. An item that is gone (its person deleted, the book left) takes the tick as is. */
export async function applyTick(all: Viewer, row: TaskRow, now = Date.now()): Promise<void> {
  if (row.kind === "date") return;
  try {
    const v = await inBook(all, row.book_id);
    if (row.kind === "promise") return await markDone(v, "promises", row.item_id!);
    const person = await (await scope(v)).from("persons").select("id").where("id", "=", row.person_id).executeTakeFirst();
    if (!person) return;
    const day = today(now);
    if (row.kind === "overdue") await addFollowUp(v, { kind: "overdue", personId: row.person_id, day });
    else if (row.kind === "situation") await addFollowUp(v, { kind: "situation", personId: row.person_id, factId: row.item_id!, day });
    else await addFollowUp(v, { kind: "session", personId: row.person_id, seriesId: row.item_id!, sessionDay: row.day, day });
  } catch (e) {
    if (!(e instanceof NotFoundError)) throw e;
  }
}

async function connection(userId: string) {
  return (await instance()).from("todoist_connections").selectAll().where("user_id", "=", userId).executeTakeFirst();
}

/** Step 1: ticks and deletions since the last sync land on the open tasks; the position is saved once they all have. */
async function pull(all: Viewer, token: string, syncToken: string | null, now: number, fetchFn: typeof fetch): Promise<void> {
  const i = await instance();
  const res = await todoist(token, fetchFn).sync(syncToken);
  const changed = new Map(res.items.map((x) => [x.id, x]));
  if (changed.size) {
    const rows = await i.from("todoist_tasks").selectAll().where("user_id", "=", all.userId).where("state", "=", "open").execute();
    for (const row of rows) {
      const item = changed.get(row.task_id);
      if (!item) continue;
      if (item.deleted) {
        await setState(all.userId, row.key, "gone");
      } else if (item.checked) {
        // Claimed first, so a pull running at the same time (pullNow next to the scheduler) doesn't apply the same tick again.
        if (!(await claim(all.userId, row.key))) continue;
        try {
          await applyTick(all, row, now);
        } catch (e) {
          // Back to open, so the next pull (the sync position isn't saved) applies it.
          await (await instance()).update("todoist_tasks").set({ state: "open" }).where("user_id", "=", all.userId).where("key", "=", row.key).execute();
          throw e;
        }
      }
    }
  }
  await i.update("todoist_connections").set({ sync_token: res.syncToken }).where("user_id", "=", all.userId).execute();
}

/** Moves an open task to ticked; false when it was not open any more. */
async function claim(userId: string, key: string): Promise<boolean> {
  const r = await (
    await instance()
  )
    .update("todoist_tasks")
    .set({ state: "ticked" })
    .where("user_id", "=", userId)
    .where("key", "=", key)
    .where("state", "=", "open")
    .executeTakeFirst();
  return Number(r.numUpdatedRows) > 0;
}

/** Whether a date task's date still stands: its book, its person and the date itself, as the user sees it. */
async function dateStands(all: Viewer, row: TaskRow): Promise<boolean> {
  try {
    const v = await inBook(all, row.book_id);
    const d = await scope(v);
    const date = await d
      .from("dates")
      .select("id")
      .where("id", "=", row.item_id!)
      .where("person_id", "=", row.person_id)
      .$call((qb) => visible(qb, v, "dates"))
      .executeTakeFirst();
    return !!date;
  } catch (e) {
    if (e instanceof NotFoundError) return false;
    throw e;
  }
}

async function setState(userId: string, key: string, state: "ticked" | "closed" | "gone") {
  await (await instance()).update("todoist_tasks").set({ state }).where("user_id", "=", userId).where("key", "=", key).execute();
}

/** Whether a task is wanted on `from`: what is due now always, a date or promise from its lead time on (a promise past due too). */
function wanted(item: InBook<DueItem>, from: string, kinds: Record<DueKind, { leadDays: number }>): boolean {
  if (item.kind === "session") return item.date! < from; // the morning after its day, as the push sends it
  const kind = kindOf(item);
  if (!kind) return true;
  return daysBetween(from, item.date!) <= kinds[kind].leadDays;
}

/** Syncs one user: ticks in, new tasks out, resolved tasks closed. Throws on the first failure; what was done stays done. */
export async function syncUser(userId: string, now: number, fetchFn: typeof fetch = fetch): Promise<void> {
  const conn = await connection(userId);
  if (!conn?.project_id || conn.broken) return;
  const all = await viewerById(userId);
  if (!all) return;
  await pull(all, conn.token, conn.sync_token, now, fetchFn);

  const status = await todoistStatus(all);
  if (!status.connected) return;
  const from = today(now);
  const i = await instance();
  const client = todoist(conn.token, fetchFn);
  const known = new Map((await i.from("todoist_tasks").selectAll().where("user_id", "=", userId).execute()).map((r) => [r.key, r]));
  // Everything still due within the longest lead time, and as far ahead as the furthest open task (a lead time lowered since);
  // a task whose item has left this list was resolved in freundebuch.
  const furthest = Math.max(0, ...[...known.values()].filter((r) => r.state === "open").map((r) => daysBetween(from, r.day)));
  const due = await dueAcross(all, from, Math.max(furthest, ...Object.values(status.kinds).map((k) => k.leadDays)));
  const present = new Set(due.map(itemKey));

  if ((await getSettings(all)).delivery !== "push") {
    const copy = notifyCopy(await userLanguage(all));
    const base = config.publicUrl();
    const click = (id: string) => (base ? `${base}/p/${id}` : undefined);
    const viewers = new Map<string, Viewer>();
    for (const item of due) {
      const key = itemKey(item);
      if (known.has(key) || !wanted(item, from, status.kinds)) continue;
      if (!viewers.has(item.book.id)) viewers.set(item.book.id, await inBook(all, item.book.id));
      const m = await dueMessage(viewers.get(item.book.id)!, copy, item, null, click);
      // The item's day: a date's or promise's, a situation's checkAfter, a session's day; for someone overdue, today.
      const day = item.date ?? from;
      const kind = kindOf(item);
      // What is due now is due on the day it came up; a date or promise on its own day, or with its day as the deadline.
      const deadline = !!kind && status.kinds[kind].placement === "deadline" && day > from;
      const taskId = await client.createTask({
        content: withBook(copy, all, item.book.name, m.title),
        description: m.click ?? "",
        projectId: conn.project_id,
        dueDate: !kind || deadline ? from : day,
        ...(deadline ? { deadlineDate: day } : {}),
      });
      await i
        .insert("todoist_tasks", {
          user_id: userId,
          key,
          task_id: taskId,
          book_id: item.book.id,
          kind: item.kind,
          item_id: item.itemId ?? null,
          person_id: item.personId,
          day,
          state: "open",
          created_at: now,
        })
        .execute();
    }
  }

  // The others close once their item is resolved (or gone, with its person); a date's task only by its tick, unless the date
  // itself is gone (deleted, or with its person).
  for (const row of known.values()) {
    if (row.state !== "open" || present.has(row.key)) continue;
    if (row.kind === "date" && (await dateStands(all, row))) continue;
    await client.closeTask(row.task_id);
    await setState(userId, row.key, "closed");
  }
}

async function markBroken(userId: string) {
  await (await instance()).update("todoist_connections").set({ broken: 1 }).where("user_id", "=", userId).execute();
}

/** Syncs every user with a usable Todoist; one user's failure is logged and leaves the others. A refused token marks the
 * connection broken, and it is left alone until the user connects again. */
export async function syncAll(now = Date.now(), fetchFn: typeof fetch = fetch): Promise<void> {
  const users = await (await instance()).from("todoist_connections").select("user_id").where("project_id", "is not", null).where("broken", "=", 0).execute();
  for (const { user_id } of users) {
    try {
      await syncUser(user_id, now, fetchFn);
    } catch (e) {
      if (e instanceof TodoistAuthError) await markBroken(user_id);
      log.warn({ err: { type: errorFields(e).type } }, "todoist sync failed for a user");
    }
  }
}

/** Brings the viewer's ticks in right away (before whats_due or a briefing answers); a failure is logged and swallowed. */
export async function pullNow(v: Viewer, fetchFn: typeof fetch = fetch): Promise<void> {
  try {
    const conn = await connection(v.userId);
    if (!conn?.project_id || conn.broken) return;
    const all = await viewerById(v.userId);
    if (all) await pull(all, conn.token, conn.sync_token, Date.now(), fetchFn);
  } catch (e) {
    if (e instanceof TodoistAuthError) await markBroken(v.userId).catch(() => undefined);
    log.warn({ err: { type: errorFields(e).type } }, "todoist pull failed");
  }
}
