// The calendar feed: birthdays, other dates and the viewer's own promises with a due date as an ICS file that Google Calendar or
// any other calendar app subscribes to. Calendar apps fetch a subscribed feed without signing in, so the feed is reached by a
// secret URL per user (ADR 0008). Only the key's hash is stored; the feed is read as its user, through `visible`, so the partner's
// private items are never in it, not even as a busy slot.
import { createHash, randomBytes } from "node:crypto";
import { ageOn, nextOccurrence, today } from "./dates";
import { db } from "./db";
import { notifyCopy } from "./notify/copy";
import { userLanguage } from "./settings";
import type { Viewer } from "./types";
import { itemPath, personPath, publicUrl } from "./urls";
import { viewerById } from "./users";
import { visible } from "./visibility";

// The key: a credential that can only read this one feed. A new key replaces the old one, which stops working at once.
const KEY_PREFIX = "fbc_";
const hashKey = (key: string) => createHash("sha256").update(key).digest("hex");

/** Where the feed of `key` is served, as a path. */
export const feedPath = (key: string) => `/api/calendar/${key}.ics`;

/** A new calendar key for the viewer; the previous one stops working. Shown once: only its hash is kept. */
export async function createCalendarKey(v: Viewer): Promise<string> {
  const key = KEY_PREFIX + randomBytes(32).toString("base64url");
  const hash = hashKey(key);
  await (
    await db()
  )
    .insertInto("user_settings")
    .values({ user_id: v.userId, webhook_url: null, calendar_key_hash: hash })
    .onConflict((oc) => oc.column("user_id").doUpdateSet({ calendar_key_hash: hash }))
    .execute();
  return key;
}

export async function hasCalendarKey(v: Viewer): Promise<boolean> {
  const r = await (await db()).selectFrom("user_settings").select("calendar_key_hash").where("user_id", "=", v.userId).executeTakeFirst();
  return !!r?.calendar_key_hash;
}

export async function revokeCalendarKey(v: Viewer): Promise<void> {
  await (await db()).updateTable("user_settings").set({ calendar_key_hash: null }).where("user_id", "=", v.userId).execute();
}

/** The user a calendar key belongs to, or null. */
export async function viewerFromCalendarKey(key: string): Promise<Viewer | null> {
  if (!key.startsWith(KEY_PREFIX)) return null;
  const r = await (await db()).selectFrom("user_settings").select("user_id").where("calendar_key_hash", "=", hashKey(key)).executeTakeFirst();
  return r ? viewerById(r.user_id) : null;
}

// A yearly date is written out year by year, from last year to five years ahead, so each birthday can carry the age it is.
// Calendar apps fetch the feed again every few hours, so the window moves along by itself.
const YEARS_BACK = 1;
const YEARS_AHEAD = 5;

type Event = { uid: string; day: string; summary: string; url: string };

const fill = (t: string, v: Record<string, string | number>) => t.replace(/\{(\w+)\}/g, (_, k) => String(v[k]));

/** The viewer's feed as iCalendar text, its links absolute against `base`. */
export async function calendarFeed(v: Viewer, base: string, now = Date.now()): Promise<string> {
  const d = await db();
  const copy = notifyCopy(await userLanguage(v));
  const names = new Map((await d.selectFrom("persons").select(["id", "name"]).execute()).map((p) => [p.id, p.name]));
  const name = (id: string) => names.get(id) ?? "";
  const year = +today(now).slice(0, 4);
  const events: Event[] = [];

  for (const r of await d
    .selectFrom("dates")
    .selectAll()
    .$call((qb) => visible(qb, v, "dates"))
    .execute()) {
    const url = base + itemPath(personPath(r.person_id), "dates", r.id);
    const label = r.kind === "anniversary" && !r.label ? copy.anniversary : (r.label ?? "");
    const summary = (day: string) => {
      if (r.kind !== "birthday") return fill(copy.calendarDate, { label, name: name(r.person_id) });
      const age = ageOn(r.date, day);
      return age ? fill(copy.calendarBirthdayAge, { name: name(r.person_id), age }) : fill(copy.calendarBirthday, { name: name(r.person_id) });
    };
    if (!r.yearly && !r.date.startsWith("--")) {
      events.push({ uid: r.id, day: r.date, summary: summary(r.date), url });
      continue;
    }
    for (let y = year - YEARS_BACK; y <= year + YEARS_AHEAD; y++) {
      const day = nextOccurrence(`--${r.date.slice(-5)}`, `${y}-01-01`);
      // A birthday with a year starts on the day itself, not in the years before it.
      if (!r.date.startsWith("--") && day < r.date) continue;
      events.push({ uid: `${r.id}-${y}`, day, summary: summary(day), url });
    }
  }

  // Like whatsDue: only the viewer's own open promises; one the partner recorded is between them and the person.
  const promises = await d
    .selectFrom("promises")
    .select(["id", "person_id", "text", "due", "by_me"])
    .where("done", "=", 0)
    .where("due", "is not", null)
    .$call((qb) => visible(qb, v, "promises"))
    .where("recorded_by", "=", v.userId)
    .execute();
  for (const p of promises)
    events.push({
      uid: p.id,
      day: p.due!,
      summary: fill(p.by_me ? copy.calendarPromise : copy.calendarPromiseTheirs, { text: p.text, name: name(p.person_id) }),
      url: base + itemPath(personPath(p.person_id), "promises", p.id),
    });

  events.sort((a, b) => a.day.localeCompare(b.day) || a.summary.localeCompare(b.summary));
  const stamp = new Date(now).toISOString().replace(/[-:]/g, "").replace(/\.\d+/, "");
  const host = new URL(base).host;
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//freundebuch//DE",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    `X-WR-CALNAME:${text(copy.calendarName)}`,
    "REFRESH-INTERVAL;VALUE=DURATION:PT4H",
    "X-PUBLISHED-TTL:PT4H",
    ...events.flatMap((e) => [
      "BEGIN:VEVENT",
      `UID:${e.uid}@${host}`,
      `DTSTAMP:${stamp}`,
      `DTSTART;VALUE=DATE:${compact(e.day)}`,
      `DTEND;VALUE=DATE:${compact(nextDay(e.day))}`,
      `SUMMARY:${text(e.summary)}`,
      `URL:${e.url}`,
      `DESCRIPTION:${text(e.url)}`,
      "TRANSP:TRANSPARENT",
      "END:VEVENT",
    ]),
    "END:VCALENDAR",
  ];
  return lines.map(fold).join("\r\n") + "\r\n";
}

const compact = (day: string) => day.replaceAll("-", "");

function nextDay(day: string): string {
  const t = new Date(`${day}T00:00:00Z`);
  t.setUTCDate(t.getUTCDate() + 1);
  return t.toISOString().slice(0, 10);
}

// TEXT values (RFC 5545 3.3.11): backslash, semicolon, comma and line breaks escaped.
const text = (s: string) => s.replace(/[\\;,]/g, (c) => `\\${c}`).replace(/\r?\n/g, "\\n");

// Lines longer than 75 octets go on in continuation lines that start with a space (RFC 5545 3.1), never inside a character.
function fold(line: string): string {
  const out: string[] = [];
  let cur = "";
  let bytes = 0;
  for (const ch of line) {
    const n = Buffer.byteLength(ch);
    if (bytes + n > 75) {
      out.push(cur);
      cur = " ";
      bytes = 1;
    }
    cur += ch;
    bytes += n;
  }
  out.push(cur);
  return out.join("\r\n");
}

/** GET /api/calendar/{key}.ics: the feed of the key's user, or 404 for a key that is wrong, replaced or revoked. */
export async function calendarRoute(req: Request, file: string): Promise<Response> {
  const v = file.endsWith(".ics") ? await viewerFromCalendarKey(file.slice(0, -4)) : null;
  if (!v) return new Response("not found", { status: 404, headers: { "content-type": "text/plain; charset=utf-8" } });
  return new Response(await calendarFeed(v, publicUrl(req.headers)), {
    headers: {
      "content-type": "text/calendar; charset=utf-8",
      "content-disposition": 'inline; filename="freundebuch.ics"',
      "cache-control": "private, no-store",
      "x-robots-tag": "noindex",
    },
  });
}
