// The daily reminders: once a day, after NOTIFY_AT, every user with a webhook gets what is due today or tomorrow. Each user's
// list comes from whatsDue(viewer), so nobody is ever told about the partner's private items.
import { copy } from "./copy";
import { config } from "../config";
import { db } from "../db";
import { addDays, today } from "../dates";
import { lastSeen } from "../intervals";
import { errorFields, logger } from "../log";
import { processState } from "../state";
import { upcomingDates, whatsDue, type DueItem } from "../due";
import { viewerById } from "../users";
import type { Viewer } from "../types";
import { sendWebhook, type WebhookMessage } from "./webhook";
import { runReflectionsDue } from "../reflection";

const log = logger("notify");
const MAX_PER_USER = 10;
const fill = (t: string, v: Record<string, string | number>) => t.replace(/\{(\w+)\}/g, (_, k) => String(v[k]));

async function message(v: Viewer, item: DueItem, from: string, click: (id: string) => string | undefined): Promise<WebhookMessage> {
  const base = { click: click(item.personId) };
  if (item.kind === "overdue") {
    const seen = await lastSeen(v, item.personId);
    return { ...base, title: fill(copy.overdue, { name: item.name }), body: seen ? fill(copy.overdueBody, { date: seen }) : "", tags: ["hourglass_flowing_sand"] };
  }
  if (item.kind === "situation") return { ...base, title: fill(copy.situation, { name: item.name, text: item.text! }), body: "", tags: ["speech_balloon"] };
  if (item.kind === "session") {
    const [, m, d] = item.date!.split("-");
    const base = config.publicUrl();
    return { title: fill(copy.sessionMissed, { name: item.name, day: `${d}.${m}.` }), body: "", tags: ["paw_prints"], click: base ? `${base}${item.url}` : undefined };
  }
  if (item.kind === "promise")
    return item.byMe
      ? { ...base, title: fill(copy.promise, { text: item.text! }), body: fill(copy.promiseBody, { name: item.name }), tags: ["pushpin"] }
      : { ...base, title: fill(copy.promiseTheirs, { name: item.name, text: item.text! }), body: "", tags: ["pushpin"] };
  const when = item.date === from ? copy.today : copy.tomorrow;
  const found = (await upcomingDates(v, from, 1)).find((u) => u.personId === item.personId && u.date === item.date && (u.label ?? u.kind) === item.text);
  if (found?.kind === "birthday") {
    const title = found.age === null ? copy.birthday : copy.birthdayAge;
    return { ...base, title: fill(title, { name: item.name, when, age: found.age ?? "" }), body: "", tags: ["birthday"] };
  }
  const label = found?.kind === "anniversary" && !found.label ? copy.anniversary : (found?.label ?? item.text!);
  return { ...base, title: fill(copy.date, { label, when, name: item.name }), body: "", tags: ["calendar"] };
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
  const d = await db();
  const rows = await d.selectFrom("user_settings").select(["user_id", "webhook_url"]).where("webhook_url", "is not", null).execute();
  let sent = 0;
  let users = 0;
  for (const row of rows) {
    try {
      if (onlyNew) {
        const mark = await d.selectFrom("meta").select("value").where("key", "=", doneKey(row.user_id)).executeTakeFirst();
        if (mark?.value === from) continue;
      }
      const v = await viewerById(row.user_id);
      if (!v) continue;
      users++;
      // A missed session goes out once, the morning after its day.
      const items = (await whatsDue(v, from, 1)).filter((i) => i.kind !== "session" || i.date === addDays(from, -1));
      const shown = items.length > MAX_PER_USER ? items.slice(0, MAX_PER_USER - 1) : items;
      const messages = await Promise.all(shown.map((i) => message(v, i, from, click)));
      if (items.length > MAX_PER_USER) messages.push({ title: fill(copy.more, { n: items.length - shown.length }), body: "", tags: ["bell"], click: base });
      for (const m of messages) if (await sendWebhook(row.webhook_url!, m, fetchFn)) sent++;
      if (onlyNew) await d.insertInto("meta").values({ key: doneKey(row.user_id), value: from }).onConflict((oc) => oc.column("key").doUpdateSet({ value: from })).execute();
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

const running = processState("notify", () => ({ busy: false, timer: null as NodeJS.Timeout | null }));

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

/** Checks every minute. Safe to call twice; the timer doesn't keep the process alive. */
export function startScheduler(): void {
  if (running.timer) return;
  running.timer = setInterval(() => {
    runDailyIfDue().catch((e) => log.error(e, "daily reminders failed"));
    runReflectionsDue().catch((e) => log.error(e, "weekly reflections failed"));
  }, 60_000);
  running.timer.unref();
}
