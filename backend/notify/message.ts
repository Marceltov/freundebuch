// The text of one due item: the push's message, and the title and link of its Todoist task (todoist/sync.ts).
import { config } from "../core/config";
import type { Viewer } from "../core/types";
import { lastSeen } from "../people/intervals";
import { upcomingDates, type DueItem } from "../reading/due";
import type { NotifyCopy } from "./copy";
import type { WebhookMessage } from "./webhook";

/** Fills the `{name}` placeholders of a copy text. */
export const fill = (t: string, v: Record<string, string | number>) => t.replace(/\{(\w+)\}/g, (_, k) => String(v[k]));

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
