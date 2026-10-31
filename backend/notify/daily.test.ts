import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { record } from "../conversations/conversations";
import { db } from "../db";
import { logsOf } from "../core/log";
import { seed, type Seed } from "../testing/fixtures";
import { getSettings, putSettings, setLanguage, testWebhook } from "../core/settings";
import { runDaily, runDailyIfDue } from "./daily";

type Sent = { url: string; title: string; body: string; click?: string };
let sent: Sent[];
const fetchFn = (async (url: string, init: RequestInit) => {
  const h = init.headers as Record<string, string>;
  const decode = (t: string) => (t.startsWith("=?UTF-8?B?") ? Buffer.from(t.slice(10, -2), "base64").toString("utf8") : t);
  sent.push({ url, title: decode(h.Title), body: init.body as string, click: h.Click });
  return new Response(null, { status: 200 });
}) as unknown as typeof fetch;

let s: Seed;
// 23 Oct 2026, 08:30 in Europe/Berlin: Tom's birthday (24 Oct) is tomorrow.
const NOW = Date.parse("2026-10-23T06:30:00Z");

beforeEach(async () => {
  vi.stubEnv("TZ", "Europe/Berlin");
  vi.stubEnv("PUBLIC_URL", "https://f.example/");
  s = await seed();
  sent = [];
});
afterEach(() => vi.unstubAllEnvs());

describe("runDaily", () => {
  test("A hears about Tom's private birthday, B does not", async () => {
    await putSettings(s.a, { webhookUrl: "https://ntfy.example/a" });
    await putSettings(s.b, { webhookUrl: "https://ntfy.example/b" });
    const n = await runDaily(NOW, fetchFn);
    const toA = sent.filter((m) => m.url.endsWith("/a"));
    const toB = sent.filter((m) => m.url.endsWith("/b"));
    expect(toA.map((m) => m.title)).toContain("🎂 Tom hat morgen Geburtstag");
    expect(toA.find((m) => m.title.includes("Tom"))?.click).toBe(`https://f.example/p/${s.tom}`);
    expect(JSON.stringify(toB)).not.toContain("Tom");
    expect(n).toBe(sent.length);
  });

  test("each user hears in their own language", async () => {
    await putSettings(s.a, { webhookUrl: "https://ntfy.example/a" });
    await setLanguage(s.a, "en");
    await runDaily(NOW, fetchFn);
    expect(sent.map((m) => m.title)).toContain("🎂 Tom's birthday is tomorrow");
    expect(await testWebhook(s.a, fetchFn)).toBe(true);
    expect(sent.at(-1)?.title).toBe("🔔 freundebuch test");
    await expect(setLanguage(s.a, "fr")).rejects.toThrow(/language must be one of de, en/);
  });

  test("a user without a webhook gets nothing", async () => {
    expect(await runDaily(NOW, fetchFn)).toBe(0);
    expect(sent).toEqual([]);
  });

  test("without PUBLIC_URL there is no Click header", async () => {
    vi.stubEnv("PUBLIC_URL", "");
    await putSettings(s.a, { webhookUrl: "https://ntfy.example/a" });
    await runDaily(NOW, fetchFn);
    expect(sent.length).toBeGreaterThan(0);
    expect(sent.every((m) => m.click === undefined)).toBe(true);
  });

  test("overdue people and promises are announced", async () => {
    await putSettings(s.a, { webhookUrl: "https://ntfy.example/a" });
    const d = await db();
    await d.updateTable("persons").set({ name: "Anna" }).where("id", "=", s.anna).execute();
    await d
      .insertInto("promises")
      .values({
        id: "pr1",
        person_id: s.anna,
        text: "Buch leihen",
        due: "2026-10-23",
        by_me: 1,
        done: 0,
        visibility: "shared",
        recorded_by: s.a.userId,
        conversation_id: null,
        created_at: 1,
      })
      .execute();
    await runDaily(NOW, fetchFn);
    const p = sent.find((m) => m.title === "📌 Versprochen: Buch leihen");
    expect(p?.body).toBe("für Anna");
  });

  test("a promise the person made reads as theirs; the partner's promises are never announced", async () => {
    await putSettings(s.a, { webhookUrl: "https://ntfy.example/a" });
    const d = await db();
    const promise = (id: string, text: string, by_me: number, recorded_by: string) =>
      d
        .insertInto("promises")
        .values({ id, person_id: s.anna, text, due: "2026-10-23", by_me, done: 0, visibility: "shared", recorded_by, conversation_id: null, created_at: 1 })
        .execute();
    await promise("pr1", "das Zelt leihen", 0, s.a.userId);
    await promise("pr2", "Bobs Besorgung", 1, s.b.userId);
    await runDaily(NOW, fetchFn);
    expect(sent.map((m) => m.title)).toContain("📌 Anna wollte: das Zelt leihen");
    expect(JSON.stringify(sent)).not.toContain("Bobs Besorgung");
  });

  test("a situation past its day nudges to ask", async () => {
    await putSettings(s.a, { webhookUrl: "https://ntfy.example/a" });
    await (
      await db()
    )
      .insertInto("facts")
      .values({
        id: "f1",
        person_id: s.anna,
        text: "sucht ein Auto",
        category: "other",
        kind: "situation",
        check_after: "2026-10-20",
        visibility: "shared",
        recorded_by: s.a.userId,
        conversation_id: null,
        created_at: 1,
      })
      .execute();
    await runDaily(NOW, fetchFn);
    expect(sent.map((m) => m.title)).toContain("💬 Frag mal nach: Anna – sucht ein Auto");
  });

  test("more than 10 items: nine singles and a '+N weitere' summary", async () => {
    await putSettings(s.a, { webhookUrl: "https://ntfy.example/a" });
    const d = await db();
    for (let i = 0; i < 12; i++)
      await d
        .insertInto("promises")
        .values({
          id: `pr${i}`,
          person_id: s.anna,
          text: `P${i}`,
          due: "2026-10-23",
          by_me: 1,
          done: 0,
          visibility: "shared",
          recorded_by: s.a.userId,
          conversation_id: null,
          created_at: i,
        })
        .execute();
    const total = (await import("../reading/due")).whatsDue;
    const items = (await total(s.a, "2026-10-23", 1)).length;
    expect(items).toBeGreaterThan(10);
    const n = await runDaily(NOW, fetchFn);
    expect(n).toBe(10);
    expect(sent).toHaveLength(10);
    expect(sent[9].title).toBe(`+${items - 9} weitere`);
  });
});

describe("runDailyIfDue (the scheduler's tick)", () => {
  beforeEach(async () => {
    await putSettings(s.a, { webhookUrl: "https://ntfy.example/a" });
    // B has something due too (A's private birthday is not B's).
    await (
      await db()
    )
      .insertInto("promises")
      .values({
        id: "pb",
        person_id: s.anna,
        text: "Anruf",
        due: "2026-10-23",
        by_me: 1,
        done: 0,
        visibility: "shared",
        recorded_by: s.b.userId,
        conversation_id: null,
        created_at: 1,
      })
      .execute();
  });

  test("sends once per day, however often it ticks", async () => {
    await runDailyIfDue(NOW, fetchFn);
    const first = sent.length;
    expect(first).toBeGreaterThan(0);
    await runDailyIfDue(NOW + 60_000, fetchFn);
    expect(sent).toHaveLength(first);
    await runDailyIfDue(NOW + 24 * 3600_000, fetchFn); // the next day
    expect(sent.length).toBeGreaterThan(first);
  });

  test("logs only on the tick that served someone", async () => {
    const said = async (at: number) => (await logsOf(() => runDailyIfDue(at, fetchFn))).filter((l) => l.msg === "daily reminders sent");
    expect(await said(NOW)).toEqual([expect.objectContaining({ users: 1, sent: sent.length })]);
    expect(await said(NOW + 60_000)).toEqual([]);
  });

  test("a failing receiver for A doesn't stop B, and neither is sent to again", async () => {
    await putSettings(s.b, { webhookUrl: "https://ntfy.example/b" });
    await putSettings(s.a, { webhookUrl: "https://ntfy.example/a" });
    const mixed = (async (url: string, init: RequestInit) => {
      const res = await fetchFn(url, init);
      return url.endsWith("/a") ? new Response(null, { status: 500 }) : res;
    }) as unknown as typeof fetch;
    await runDailyIfDue(NOW, mixed);
    const once = sent.length;
    expect(sent.some((m) => m.url.endsWith("/b"))).toBe(true);
    await runDailyIfDue(NOW + 60_000, fetchFn);
    expect(sent).toHaveLength(once);
  });

  test("a user whose processing throws is retried, the others are not resent", async () => {
    await putSettings(s.b, { webhookUrl: "https://ntfy.example/b" });
    const due = await import("../reading/due");
    const real = due.whatsDue;
    const spy = vi.spyOn(due, "whatsDue").mockImplementation(async (v, ...rest) => {
      if (v.userId === s.a.userId) throw new Error("boom");
      return real(v, ...rest);
    });
    await runDailyIfDue(NOW, fetchFn);
    const toB = sent.filter((m) => m.url.endsWith("/b")).length;
    expect(sent.filter((m) => m.url.endsWith("/a"))).toHaveLength(0);
    spy.mockRestore();
    await runDailyIfDue(NOW + 60_000, fetchFn);
    expect(sent.filter((m) => m.url.endsWith("/a")).length).toBeGreaterThan(0);
    expect(sent.filter((m) => m.url.endsWith("/b"))).toHaveLength(toB);
  });

  test("a restart after A was served sends only to B", async () => {
    await putSettings(s.b, { webhookUrl: "https://ntfy.example/b" });
    const d = await db();
    await d
      .insertInto("meta")
      .values({ key: `last_notify_date:${s.a.userId}`, value: "2026-10-23" })
      .execute();
    await runDailyIfDue(NOW, fetchFn);
    expect(sent.length).toBeGreaterThan(0);
    expect(sent.every((m) => m.url.endsWith("/b"))).toBe(true);
  });

  test("waits until the configured time", async () => {
    vi.stubEnv("FREUNDEBUCH_NOTIFY_AT", "09:00");
    await runDailyIfDue(NOW, fetchFn); // 08:30
    expect(sent).toEqual([]);
    await runDailyIfDue(NOW + 31 * 60_000, fetchFn); // 09:01
    expect(sent.length).toBeGreaterThan(0);
  });
});

describe("settings", () => {
  test("round-trips, rejects other schemes, and clears with null", async () => {
    expect(await getSettings(s.a)).toEqual({ webhookUrl: null, language: "de" });
    await putSettings(s.a, { webhookUrl: "https://ntfy.example/a" });
    expect(await getSettings(s.a)).toEqual({ webhookUrl: "https://ntfy.example/a", language: "de" });
    expect(await getSettings(s.b)).toEqual({ webhookUrl: null, language: "de" });
    await expect(putSettings(s.a, { webhookUrl: "file:///etc/passwd" })).rejects.toMatchObject({ code: "invalid_input" });
    await expect(putSettings(s.a, { webhookUrl: "not a url" })).rejects.toMatchObject({ code: "invalid_input" });
    await putSettings(s.a, { webhookUrl: null });
    expect(await getSettings(s.a)).toEqual({ webhookUrl: null, language: "de" });
  });

  test("testWebhook sends the sample message, or reports nothing sent without a webhook", async () => {
    expect(await testWebhook(s.a, fetchFn)).toBe(false);
    await putSettings(s.a, { webhookUrl: "https://ntfy.example/a" });
    expect(await testWebhook(s.a, fetchFn)).toBe(true);
    expect(sent).toMatchObject([{ title: "🔔 freundebuch-Test", body: "So sehen Benachrichtigungen aus." }]);
  });
});

describe("missed sessions", () => {
  test("the morning after a session day, once, a line says it wasn't told yet", async () => {
    await putSettings(s.a, { webhookUrl: "https://ntfy.example/a" });
    const r = await record(s.a, {
      date: "2026-09-02",
      transcript: "t",
      visibility: "shared",
      people: [],
      experiences: [{ kind: "Kurs", title: "Erste", series: { name: "Hundeschule mit Toffee", rhythmDays: 7 } }],
    });
    await (
      await db()
    )
      .updateTable("series")
      .set({ created_at: Date.parse("2026-09-02T20:00:00Z") })
      .where("id", "=", r.experiences[0].seriesId!)
      .execute();
    await runDaily(Date.parse("2026-09-10T08:00:00Z"), fetchFn);
    expect(sent.map((m) => m.title)).toContain("🐾 Hundeschule mit Toffee am 09.09.: noch nicht erzählt");
    sent = [];
    await runDaily(Date.parse("2026-09-11T08:00:00Z"), fetchFn);
    expect(sent.map((m) => m.title).join()).not.toContain("Hundeschule");
  });
});
