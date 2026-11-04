// The daily reminders: once a day, after NOTIFY_AT, every user with a webhook gets what is due today or tomorrow. Each user's
// list comes from whatsDue(viewer), so nobody is ever told about the partner's private items.
import { instance } from "../db/scope";
import { notifyCopy, type NotifyCopy } from "./copy";
import { userLanguage } from "../core/settings";
import { config } from "../core/config";
import { refreshCards } from "../sharing/cards";
import { addDays, today } from "../people/dates";
import { lastSeen } from "../people/intervals";
import { errorFields, logger } from "../core/log";
import { processState } from "../core/state";
import { upcomingDates, type DueItem } from "../reading/due";
import { dueAcross } from "../reading/across";
import { viewerById } from "../core/users";
import { inBook } from "../people/books";
import type { Viewer } from "../core/types";
import { sendWebhook, type WebhookMessage } from "./webhook";
import { runReflectionsDue } from "../journal/reflection";
import { syncAll } from "../todoist/sync";

const log = logger("notify");
const MAX_PER_USER = 10;
const fill = (t: string, v: Record<string, string | number>) => t.replace(/\{(\w+)\}/g, (_, k) => String(v[k]));

/**
 * The text of one due item, for the push and for its Todoist task. `from`: the day it is sent, so a date reads "today" or
 * "tomorrow"; null names the date's day instead (a task stays open over several days).
 */
export async function dueMessage(
  v: Viewer,
  copy: NotifyCopy,
  item: DueItem,
  from: string | null,
  click: (id: string) => string | undefined,
): Promise<WebhookMessage> {
  const base = { click: click(item.personId) };
  if (item.kind === "overdue") {
    const seen = await lastSeen(v, item.personId);
    return {
      ...base,
      title: fill(copy.overdue, { name: item.name }),
      body: seen ? fill(copy.overdueBody, { date: seen }) : "",
      tags: ["hourglass_flowing_sand"],
    };
  }
  if (item.kind === "situation") return { ...base, title: fill(copy.situation, { name: item.name, text: item.text! }), body: "", tags: ["speech_balloon"] };
  if (item.kind === "session") {
    const base = config.publicUrl();
    return {
      title: fill(copy.sessionMissed, { name: item.name, day: dayMonth(copy, item.date!) }),
      body: "",
      tags: ["paw_prints"],
      click: base ? `${base}${item.url}` : undefined,
    };
  }
  if (item.kind === "promise")
    return item.byMe
      ? { ...base, title: fill(copy.promise, { text: item.text! }), body: fill(copy.promiseBody, { name: item.name }), tags: ["pushpin"] }
      : { ...base, title: fill(copy.promiseTheirs, { name: item.name, text: item.text! }), body: "", tags: ["pushpin"] };
  const when = from === null ? fill(copy.onDay, { day: dayMonth(copy, item.date!) }) : item.date === from ? copy.today : copy.tomorrow;
  const found = (await upcomingDates(v, item.date!, 0)).find((u) =>
    item.itemId ? u.id === item.itemId : u.personId === item.personId && (u.label ?? u.kind) === item.text,
  );
  if (found?.kind === "birthday") {
    const title = found.age === null ? copy.birthday : copy.birthdayAge;
    return { ...base, title: fill(title, { name: item.name, when, age: found.age ?? "" }), body: "", tags: ["birthday"] };
  }
  const label = found?.kind === "anniversary" && !found.label ? copy.anniversary : (found?.label ?? item.text!);
  return { ...base, title: fill(copy.date, { label, when, name: item.name }), body: "", tags: ["calendar"] };
}

const dayMonth = (copy: NotifyCopy, day: string) => {
  const [, m, d] = day.split("-");
  return fill(copy.dayMonth, { d, m });
};

/** The title with its book named, when the user keeps several. */
export const withBook = (copy: NotifyCopy, all: Viewer, book: string, title: string) => (all.books.length > 1 ? fill(copy.inBook, { book, title }) : title);

/** Whether the user's daily items go to their Todoist instead of the push: they chose Todoist alone and it can take them. Without
 * a usable Todoist (none, no project, the token refused) the push goes out, so nothing due is lost. */
async function todoistOnly(userId: string): Promise<boolean> {
  const d = await instance();
  const s = await d.from("user_settings").select("delivery").where("user_id", "=", userId).executeTakeFirst();
  if (s?.delivery !== "todoist") return false;
  const c = await d.from("todoist_connections").select(["project_id", "broken"]).where("user_id", "=", userId).executeTakeFirst();
  return !!c?.project_id && c.broken === 0;
}

const doneKey = (userId: string) => `last_notify_date:${userId}`;

/**
 * Sends every user with a webhook their due items (at most 10 messages: past nine, the tenth is "+N weitere"). Returns how many were sent.
 * With `onlyNew`, a user already served on this day (meta `last_notify_date:<userId>`) is skipped, and each user is marked right after
 * their messages were attempted: a failure for one user is logged and leaves the others alone, and a restart never resends.
 */
export async function runDaily(now = Date.now(), fetchFn: typeof fetch = fetch, onlyNew = false): Promise<number> {
  const from = today(now);
  // A background job has no request to take the address from.
  const base = config.publicUrl();
  const click = (id: string) => (base ? `${base}/p/${id}` : undefined);
  const d = await instance();
  const rows = await d.from("user_settings").select(["user_id", "webhook_url"]).where("webhook_url", "is not", null).execute();
  let sent = 0;
  let users = 0;
  for (const row of rows) {
    try {
      if (onlyNew) {
        const mark = await d.from("meta").select("value").where("key", "=", doneKey(row.user_id)).executeTakeFirst();
        if (mark?.value === from) continue;
      }
      if (await todoistOnly(row.user_id)) continue;
      const all = await viewerById(row.user_id);
      if (!all) continue;
      users++;
      const copy = notifyCopy(await userLanguage(all));
      // Each book is read on its own and the lists merged, someone in several books once (dueAcross); with several books,
      // every message says which book it is from.
      const items: { v: Viewer; book: string; item: DueItem }[] = [];
      const viewers = new Map<string, Viewer>();
      for (const item of await dueAcross(all, from, 1)) {
        // A missed session goes out once, the morning after its day.
        if (item.kind === "session" && item.date !== addDays(from, -1)) continue;
        if (!viewers.has(item.book.id)) viewers.set(item.book.id, await inBook(all, item.book.id));
        items.push({ v: viewers.get(item.book.id)!, book: item.book.name, item });
      }
      const shown = items.length > MAX_PER_USER ? items.slice(0, MAX_PER_USER - 1) : items;
      const messages = await Promise.all(
        shown.map(async ({ v, book, item }) => {
          const m = await dueMessage(v, copy, item, from, click);
          return { ...m, title: withBook(copy, all, book, m.title) };
        }),
      );
      if (items.length > MAX_PER_USER) messages.push({ title: fill(copy.more, { n: items.length - shown.length }), body: "", tags: ["bell"], click: base });
      for (const m of messages) if (await sendWebhook(row.webhook_url!, m, fetchFn)) sent++;
      if (onlyNew)
        await d
          .insert("meta", { key: doneKey(row.user_id), value: from })
          .onConflict((oc) => oc.column("key").doUpdateSet({ value: from }))
          .execute();
    } catch (e) {
      log.error({ err: errorFields(e) }, "daily reminders failed for a user");
    }
  }
  // The scheduler ticks every minute: a tick that served nobody says nothing.
  if (users) log.info({ users, sent }, "daily reminders sent");
  return sent;
}

const localTime = (now: number) =>
  new Intl.DateTimeFormat("en-GB", { timeZone: config.timeZone(), hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(now);

const running = processState("notify", () => ({ busy: false, cards: false, todoist: false, ticks: 0, timer: null as NodeJS.Timeout | null }));

/** One tick of the scheduler: from NOTIFY_AT on, serves each user who hasn't had today's reminders yet. */
export async function runDailyIfDue(now = Date.now(), fetchFn: typeof fetch = fetch): Promise<void> {
  if (running.busy || localTime(now) < config.notifyAt()) return;
  running.busy = true;
  try {
    await runDaily(now, fetchFn, true);
  } finally {
    running.busy = false;
  }
}

// A tick refreshes the cards that are due (cards.ts); a slow run isn't joined by the next tick.
async function refreshCardsOnce(): Promise<void> {
  if (running.cards) return;
  running.cards = true;
  try {
    await refreshCards();
  } finally {
    running.cards = false;
  }
}

// Every fifth tick (about five minutes) syncs Todoist: ticks in, new tasks out; a slow sync isn't joined by the next one.
async function syncTodoistOnce(): Promise<void> {
  if (running.todoist) return;
  running.todoist = true;
  try {
    await syncAll(Date.now());
  } finally {
    running.todoist = false;
  }
}

/** Checks every minute. Safe to call twice; the timer doesn't keep the process alive. */
export function startScheduler(): void {
  if (running.timer) return;
  running.timer = setInterval(() => {
    runDailyIfDue().catch((e) => log.error(e, "daily reminders failed"));
    runReflectionsDue().catch((e) => log.error(e, "weekly reflections failed"));
    refreshCardsOnce().catch((e) => log.error(e, "refreshing cards failed"));
    if (running.ticks++ % 5 === 0) syncTodoistOnce().catch((e) => log.error(e, "syncing Todoist failed"));
  }, 60_000);
  running.timer.unref();
}
