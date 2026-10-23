import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { db } from "../db";
import { seed, type Seed } from "../testing/fixtures";
import { getSettings, putSettings, testWebhook } from "../settings";
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
      .values({ id: "pr1", person_id: s.anna, text: "Buch leihen", due: "2026-10-23", by_me: 1, done: 0, visibility: "shared", recorded_by: s.a.userId, conversation_id: null, created_at: 1 })
      .execute();
    await runDaily(NOW, fetchFn);
    const p = sent.find((m) => m.title === "📌 Versprochen: Buch leihen");
    expect(p?.body).toBe("für Anna");
  });

  test("more than 10 items: nine singles and a '+N weitere' summary", async () => {
    await putSettings(s.a, { webhookUrl: "https://ntfy.example/a" });
    const d = await db();
    for (let i = 0; i < 12; i++)
      await d
        .insertInto("promises")
        .values({ id: `pr${i}`, person_id: s.anna, text: `P${i}`, due: "2026-10-23", by_me: 1, done: 0, visibility: "shared", recorded_by: s.a.userId, conversation_id: null, created_at: i })
        .execute();
    const total = (await import("../due")).whatsDue;
    const items = (await total(s.a, "2026-10-23", 1)).length;
    expect(items).toBeGreaterThan(10);
    const n = await runDaily(NOW, fetchFn);
    expect(n).toBe(10);
    expect(sent).toHaveLength(10);
    expect(sent[9].title).toBe(`+${items - 9} weitere`);
  });
});

describe("runDailyIfDue (the scheduler's tick)", () => {
  beforeEach(async () => putSettings(s.a, { webhookUrl: "https://ntfy.example/a" }));

  test("sends once per day, however often it ticks", async () => {
    await runDailyIfDue(NOW, fetchFn);
    const first = sent.length;
    expect(first).toBeGreaterThan(0);
    await runDailyIfDue(NOW + 60_000, fetchFn);
    expect(sent).toHaveLength(first);
    await runDailyIfDue(NOW + 24 * 3600_000, fetchFn); // the next day
    expect(sent.length).toBeGreaterThan(first);
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
    expect(await getSettings(s.a)).toEqual({ webhookUrl: null });
    await putSettings(s.a, { webhookUrl: "https://ntfy.example/a" });
    expect(await getSettings(s.a)).toEqual({ webhookUrl: "https://ntfy.example/a" });
    expect(await getSettings(s.b)).toEqual({ webhookUrl: null });
    await expect(putSettings(s.a, { webhookUrl: "file:///etc/passwd" })).rejects.toMatchObject({ code: "invalid_input" });
    await expect(putSettings(s.a, { webhookUrl: "not a url" })).rejects.toMatchObject({ code: "invalid_input" });
    await putSettings(s.a, { webhookUrl: null });
    expect(await getSettings(s.a)).toEqual({ webhookUrl: null });
  });

  test("testWebhook sends the sample message, or reports nothing sent without a webhook", async () => {
    expect(await testWebhook(s.a, fetchFn)).toBe(false);
    await putSettings(s.a, { webhookUrl: "https://ntfy.example/a" });
    expect(await testWebhook(s.a, fetchFn)).toBe(true);
    expect(sent).toMatchObject([{ title: "🔔 freundebuch-Test", body: "So sehen Benachrichtigungen aus." }]);
  });
});
