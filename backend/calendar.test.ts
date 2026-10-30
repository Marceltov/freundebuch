import { beforeEach, expect, test } from "vitest";
import { calendarFeed, calendarRoute, createCalendarKey, feedPath, hasCalendarKey, revokeCalendarKey, viewerFromCalendarKey } from "./calendar";
import { remember } from "./conversations";
import { seed, type Seed } from "./testing/fixtures";

let s: Seed;

beforeEach(async () => {
  s = await seed();
});

const BASE = "https://fb.example";
const NOW = Date.parse("2026-10-26T12:00:00Z");

// The events of a feed as { DTSTART, SUMMARY, … }, with folded lines joined back.
function events(ics: string): Record<string, string>[] {
  const lines = ics.replace(/\r\n /g, "").split("\r\n");
  const out: Record<string, string>[] = [];
  let cur: Record<string, string> | null = null;
  for (const l of lines) {
    if (l === "BEGIN:VEVENT") cur = {};
    else if (l === "END:VEVENT") {
      out.push(cur!);
      cur = null;
    } else if (cur) {
      const i = l.indexOf(":");
      cur[l.slice(0, i)] = l.slice(i + 1);
    }
  }
  return out;
}

test("a calendar key names its user until it is replaced or revoked", async () => {
  expect(await hasCalendarKey(s.a)).toBe(false);
  const key = await createCalendarKey(s.a);
  expect(key).toMatch(/^fbc_[\w-]{43}$/);
  expect(await hasCalendarKey(s.a)).toBe(true);
  expect(await viewerFromCalendarKey(key)).toEqual(s.a);
  expect(await viewerFromCalendarKey("fbc_wrong")).toBeNull();
  expect(await viewerFromCalendarKey("fbs_" + key.slice(4))).toBeNull();
  const next = await createCalendarKey(s.a);
  expect(await viewerFromCalendarKey(key)).toBeNull();
  expect(await viewerFromCalendarKey(next)).toEqual(s.a);
  await revokeCalendarKey(s.a);
  expect(await viewerFromCalendarKey(next)).toBeNull();
  expect(await hasCalendarKey(s.a)).toBe(false);
  expect(feedPath(next)).toBe(`/api/calendar/${next}.ics`);
});

test("birthdays recur every year, with the age when the year is known, as whole-day events linking to the person", async () => {
  await remember(s.a, {
    visibility: "shared",
    dates: [
      { person: s.anna, kind: "birthday", date: "1990-03-14", yearly: true },
      { person: s.lena, kind: "birthday", date: "--02-29", yearly: true },
    ],
  });
  const all = events(await calendarFeed(s.a, BASE, NOW));
  const anna = all.filter((e) => e.SUMMARY.includes("Anna"));
  expect(anna.map((e) => e["DTSTART;VALUE=DATE"])).toEqual(["20250314", "20260314", "20270314", "20280314", "20290314", "20300314", "20310314"]);
  expect(anna[1].SUMMARY).toBe("🎂 Anna wird 36");
  expect(anna[1]["DTEND;VALUE=DATE"]).toBe("20260315");
  expect(anna[1].URL).toMatch(new RegExp(`^${BASE}/p/${s.anna}#dates-`));
  expect(anna[1].DESCRIPTION).toBe(anna[1].URL);
  expect(anna[1].TRANSP).toBe("TRANSPARENT");
  expect(new Set(anna.map((e) => e.UID)).size).toBe(anna.length);

  // No year: every year, without an age; 29 February falls on the 28th outside leap years.
  const lena = all.filter((e) => e.SUMMARY.includes("Lena"));
  expect(lena[0].SUMMARY).toBe("🎂 Lena");
  expect(lena.map((e) => e["DTSTART;VALUE=DATE"])).toEqual(["20250228", "20260228", "20270228", "20280229", "20290228", "20300228", "20310228"]);
});

test("other dates, one-off or yearly, and the viewer's open promises with a due date are in it", async () => {
  await remember(s.a, {
    visibility: "shared",
    dates: [
      { person: s.anna, kind: "custom", date: "2026-12-05", label: "Housewarming", yearly: false },
      { person: s.anna, kind: "anniversary", date: "2019-06-01", yearly: true },
    ],
    promises: [
      { person: s.anna, text: "Send the movers' number", byMe: true, due: "2026-11-02" },
      { person: s.anna, text: "Bring the drill back", byMe: false, due: "2026-11-09" },
      { person: s.anna, text: "No date", byMe: true },
    ],
  });
  const all = events(await calendarFeed(s.a, BASE, NOW));
  expect(all.filter((e) => e.SUMMARY === "📅 Housewarming: Anna").map((e) => e["DTSTART;VALUE=DATE"])).toEqual(["20261205"]);
  expect(all.filter((e) => e.SUMMARY === "📅 Jahrestag: Anna")).toHaveLength(7);
  const promise = all.find((e) => e.SUMMARY === "📌 Versprochen: Send the movers' number (Anna)")!;
  expect(promise["DTSTART;VALUE=DATE"]).toBe("20261102");
  expect(promise.URL).toMatch(new RegExp(`^${BASE}/p/${s.anna}#promises-`));
  expect(all.find((e) => e.SUMMARY === "📌 Anna wollte: Bring the drill back")).toBeDefined();
  expect(all.some((e) => e.SUMMARY.includes("No date"))).toBe(false);
});

test("the partner's private dates never show up, not even as a busy slot; the recorder sees their own", async () => {
  // The fixture's Tom birthday (--10-24) is A's private item.
  const forB = await calendarFeed(s.b, BASE, NOW);
  expect(events(forB).some((e) => e.SUMMARY.includes("Tom"))).toBe(false);
  expect(forB).not.toContain(s.tom);
  expect(events(forB)).toHaveLength(0);
  expect(events(await calendarFeed(s.a, BASE, NOW)).filter((e) => e.SUMMARY === "🎂 Tom")).toHaveLength(7);
});

test("the feed is valid iCalendar: CRLF, escaped text, lines folded at 75 octets", async () => {
  await remember(s.a, {
    visibility: "shared",
    dates: [{ person: s.anna, kind: "custom", date: "--05-01", label: "Party; with friends, and a very long label that goes on and on and on", yearly: true }],
  });
  const ics = await calendarFeed(s.a, BASE, NOW);
  expect(ics.startsWith("BEGIN:VCALENDAR\r\nVERSION:2.0\r\n")).toBe(true);
  expect(ics.endsWith("END:VCALENDAR\r\n")).toBe(true);
  for (const line of ics.split("\r\n")) expect(Buffer.byteLength(line)).toBeLessThanOrEqual(75);
  expect(events(ics)[0].SUMMARY).toBe("📅 Party\\; with friends\\, and a very long label that goes on and on and on: Anna");
});

test("the route answers a live key with the feed and anything else with 404", async () => {
  const key = await createCalendarKey(s.a);
  const res = await calendarRoute(new Request(`${BASE}/api/calendar/${key}.ics`), `${key}.ics`);
  expect(res.status).toBe(200);
  expect(res.headers.get("content-type")).toBe("text/calendar; charset=utf-8");
  expect(await res.text()).toContain("BEGIN:VCALENDAR");
  expect((await calendarRoute(new Request(`${BASE}/api/calendar/x.ics`), "fbc_nope.ics")).status).toBe(404);
  await revokeCalendarKey(s.a);
  expect((await calendarRoute(new Request(`${BASE}/api/calendar/${key}.ics`), `${key}.ics`)).status).toBe(404);
});
