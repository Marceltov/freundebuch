import { beforeEach, expect, test } from "vitest";
import { record } from "./conversations";
import { setLanguage } from "./settings";
import { getReflection, putReflection, runReflection, runReflectionsDue, type ReflectionInput, type ReflectionModel } from "./reflection";
import { putSettings } from "./settings";
import { seed, type Seed } from "./testing/fixtures";

let s: Seed;
const sent: Array<{ url: string; title: string; body: string; click?: string }> = [];
const fetchFn = (async (url: string, init: RequestInit) => {
  const h = init.headers as Record<string, string>;
  const decode = (x: string) => (x.startsWith("=?UTF-8?B?") ? Buffer.from(x.slice(10, -2), "base64").toString("utf8") : x);
  sent.push({ url, title: decode(h.Title), body: init.body as string, click: h.Click });
  return new Response(null, { status: 200 });
}) as unknown as typeof fetch;

beforeEach(async () => {
  s = await seed();
  sent.length = 0;
  process.env.PUBLIC_URL = "https://f.example";
  await putSettings(s.a, { webhookUrl: "https://ntfy.example/a" });
});

const seen: ReflectionInput[] = [];
const model: ReflectionModel = { reflect: async (i) => (seen.push(i), "Diese Woche ging es oft um deinen Job.") };
// Thursday 2026-10-29, 19:00 in Berlin.
const THU_19 = Date.parse("2026-10-29T18:00:00Z");

test("off by default; a day and an hour turn it on, null turns it off", async () => {
  expect(await getReflection(s.a)).toBeNull();
  await putReflection(s.a, { day: 4, hour: 19 });
  expect(await getReflection(s.a)).toEqual({ day: 4, hour: 19 });
  await putReflection(s.a, null);
  expect(await getReflection(s.a)).toBeNull();
  await expect(putReflection(s.a, { day: 7, hour: 19 })).rejects.toThrow();
});

test("a week with journal entries gets a push with Claude's reflection, linking the Tagebuch", async () => {
  await record(s.a, { date: "2026-10-27", transcript: "t", visibility: "shared", people: [], journal: [{ text: "Viel Stress im Job." }] });
  expect(await runReflection(s.a, THU_19, model, fetchFn)).toBe(true);
  expect(sent).toEqual([{ url: "https://ntfy.example/a", title: "🪞 Deine Woche", body: "Diese Woche ging es oft um deinen Job.", click: "https://f.example/tagebuch" }]);
  expect(JSON.stringify(seen)).toContain("Viel Stress im Job.");
  expect(seen.at(-1)?.language).toBe("de");
});

test("the reflection and its push come in the user's language", async () => {
  await setLanguage(s.a, "en");
  await record(s.a, { date: "2026-10-27", transcript: "t", visibility: "shared", people: [], journal: [{ text: "A lot of stress at work." }] });
  expect(await runReflection(s.a, THU_19, model, fetchFn)).toBe(true);
  expect(seen.at(-1)?.language).toBe("en");
  expect(sent.at(-1)?.title).toBe("🪞 Your week");
});

test("a week without entries: no call to Claude, no push", async () => {
  seen.length = 0;
  expect(await runReflection(s.a, THU_19, model, fetchFn)).toBe(false);
  expect(seen).toEqual([]);
  expect(sent).toEqual([]);
});

test("the scheduler reflects for whoever chose this day and hour, once", async () => {
  await record(s.a, { date: "2026-10-27", transcript: "t", visibility: "shared", people: [], journal: [{ text: "Gute Woche." }] });
  await putReflection(s.a, { day: 4, hour: 19 });
  expect(await runReflectionsDue(THU_19, model, fetchFn)).toBe(1);
  expect(await runReflectionsDue(THU_19 + 60_000, model, fetchFn)).toBe(0);
  expect(await runReflectionsDue(THU_19 + 24 * 3600_000, model, fetchFn)).toBe(0);
});

test("without a webhook the hour isn't used up: one added later that hour still gets this week's reflection", async () => {
  await record(s.a, { date: "2026-10-27", transcript: "t", visibility: "shared", people: [], journal: [{ text: "Gute Woche." }] });
  await putReflection(s.a, { day: 4, hour: 19 });
  await putSettings(s.a, { webhookUrl: null });
  expect(await runReflectionsDue(THU_19, model, fetchFn)).toBe(0);
  await putSettings(s.a, { webhookUrl: "https://ntfy.example/a" });
  expect(await runReflectionsDue(THU_19 + 10 * 60_000, model, fetchFn)).toBe(1);
});
