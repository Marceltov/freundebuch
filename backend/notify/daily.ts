// The daily reminders: once a day, after NOTIFY_AT, every user with a webhook gets what is due today or tomorrow. Each user's
// list comes from whatsDue(viewer), so nobody is ever told about the partner's private items.
import { copy } from "./copy";
import { config } from "../config";
import { db } from "../db";
import { today } from "../dates";
import { lastSeen } from "../intervals";
import { logger } from "../log";
import { processState } from "../state";
import { upcomingDates, whatsDue, type DueItem } from "../due";
import { viewerById } from "../users";
import type { Viewer } from "../types";
import { sendWebhook, type WebhookMessage } from "./webhook";

const log = logger("notify");
const MAX_PER_USER = 10;
const fill = (t: string, v: Record<string, string | number>) => t.replace(/\{(\w+)\}/g, (_, k) => String(v[k]));

async function message(v: Viewer, item: DueItem, from: string, click: (id: string) => string | undefined): Promise<WebhookMessage> {
  const base = { click: click(item.personId) };
  if (item.kind === "overdue") {
    const seen = await lastSeen(v, item.personId);
    return { ...base, title: fill(copy.overdue, { name: item.name }), body: seen ? fill(copy.overdueBody, { date: seen }) : "", tags: ["hourglass_flowing_sand"] };
  }
  if (item.kind === "promise") return { ...base, title: fill(copy.promise, { text: item.text! }), body: fill(copy.promiseBody, { name: item.name }), tags: ["pushpin"] };
  const when = item.date === from ? copy.today : copy.tomorrow;
  const found = (await upcomingDates(v, from, 1)).find((u) => u.personId === item.personId && u.date === item.date && (u.label ?? u.kind) === item.text);
  if (found?.kind === "birthday") {
    const title = found.age === null ? copy.birthday : copy.birthdayAge;
    return { ...base, title: fill(title, { name: item.name, when, age: found.age ?? "" }), body: "", tags: ["birthday"] };
  }
  const label = found?.kind === "anniversary" && !found.label ? copy.anniversary : (found?.label ?? item.text!);
  return { ...base, title: fill(copy.date, { label, when, name: item.name }), body: "", tags: ["calendar"] };
}

/** Sends every user with a webhook their due items (at most 10 messages: past nine, the tenth is "+N weitere"). Returns how many were sent. */
export async function runDaily(now = Date.now(), fetchFn: typeof fetch = fetch): Promise<number> {
  const from = today(now);
  // A background job has no request to take the address from.
  const base = config.publicUrl();
  const click = (id: string) => (base ? `${base}/p/${id}` : undefined);
  const rows = await (await db()).selectFrom("user_settings").select(["user_id", "webhook_url"]).where("webhook_url", "is not", null).execute();
  let sent = 0;
  for (const row of rows) {
    const v = await viewerById(row.user_id);
    if (!v) continue;
    const items = await whatsDue(v, from, 1);
    const shown = items.length > MAX_PER_USER ? items.slice(0, MAX_PER_USER - 1) : items;
    const messages = await Promise.all(shown.map((i) => message(v, i, from, click)));
    if (items.length > MAX_PER_USER) messages.push({ title: fill(copy.more, { n: items.length - shown.length }), body: "", tags: ["bell"], click: base });
    for (const m of messages) if (await sendWebhook(row.webhook_url!, m, fetchFn)) sent++;
  }
  log.info({ sent }, "daily reminders sent");
  return sent;
}

const localTime = (now: number) =>
  new Intl.DateTimeFormat("en-GB", { timeZone: config.timeZone(), hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(now);

const running = processState("notify", () => ({ busy: false, timer: null as NodeJS.Timeout | null }));

/** One tick of the scheduler: runs the day's reminders when it is NOTIFY_AT or later and they haven't gone out yet today. */
export async function runDailyIfDue(now = Date.now(), fetchFn: typeof fetch = fetch): Promise<void> {
  if (running.busy || localTime(now) < config.notifyAt()) return;
  const day = today(now);
  const d = await db();
  const last = await d.selectFrom("meta").select("value").where("key", "=", "last_notify_date").executeTakeFirst();
  if (last?.value === day) return;
  running.busy = true;
  try {
    await runDaily(now, fetchFn);
    await d.insertInto("meta").values({ key: "last_notify_date", value: day }).onConflict((oc) => oc.column("key").doUpdateSet({ value: day })).execute();
  } finally {
    running.busy = false;
  }
}

/** Checks every minute. Safe to call twice; the timer doesn't keep the process alive. */
export function startScheduler(): void {
  if (running.timer) return;
  running.timer = setInterval(() => {
    runDailyIfDue().catch((e) => log.error(e, "daily reminders failed"));
  }, 60_000);
  running.timer.unref();
}
