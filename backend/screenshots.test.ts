import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { afterAll, afterEach, beforeEach, expect, test } from "vitest";
import { briefing } from "./briefing";
import { deleteItem } from "./corrections";
import { db } from "./db";
import { putSettings } from "./settings";
import type { Reading, ScreenshotInput, ScreenshotModel } from "./screenshot-model";
import {
  createShareKey,
  discardScreenshot,
  listPending,
  pendingCount,
  pruneScreenshots,
  readScreenshot,
  resolveScreenshot,
  resumeReading,
  retryScreenshot,
  revokeShareKey,
  screenshotImage,
  shareScreenshot,
  viewerFromShareKey,
} from "./screenshots";
import { seed, type Seed } from "./testing/fixtures";

const dir = mkdtempSync(join(tmpdir(), "fb-shots-"));
let s: Seed;
const sent: { url: string; title: string; body: string; click?: string }[] = [];
const realFetch = globalThis.fetch;

beforeEach(async () => {
  process.env.DATA_DIR = dir;
  process.env.PUBLIC_URL = "https://f.example";
  s = await seed();
  sent.length = 0;
  globalThis.fetch = (async (url: string, init: RequestInit) => {
    const h = init.headers as Record<string, string>;
    sent.push({ url, title: decode(h.Title), body: init.body as string, click: h.Click });
    return new Response(null, { status: 200 });
  }) as typeof fetch;
  await putSettings(s.a, { webhookUrl: "https://ntfy.example/a" });
});
afterEach(() => {
  globalThis.fetch = realFetch;
  delete process.env.PUBLIC_URL;
});
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const decode = (v: string) => (v.startsWith("=?UTF-8?B?") ? Buffer.from(v.slice(10, -2), "base64").toString("utf8") : v);
let colour = 0;
/** A different small PNG each call, so no two count as the same screenshot. */
const image = async (width = 2000) => new Uint8Array(await sharp({ create: { width, height: 40, channels: 3, background: { r: colour++ % 256, g: 10, b: 20 } } }).png().toBuffer());

const post = (people: Reading["people"], extra: Partial<Reading> = {}): Reading => ({
  kind: "post",
  platform: "Instagram",
  text: "Urlaub in Lissabon",
  category: "travel",
  happenedOn: "2026-10-12",
  sensitive: false,
  people,
  ...extra,
});
const answering = (r: Reading | null): ScreenshotModel & { seen: ScreenshotInput[] } => {
  const seen: ScreenshotInput[] = [];
  return { seen, read: async (i) => (seen.push(i), r) };
};

test("a screenshot is shrunk to 1080 px WebP and read; a sure one becomes a fact with source, day and image", async () => {
  const shot = await shareScreenshot(s.a, await image());
  expect(shot).toMatchObject({ status: "reading", duplicate: false });
  const model = answering(post([{ name: "Anna", handle: "anna.reist", personId: s.anna }]));
  expect(await readScreenshot(shot.id, model)).toBe("filed");
  expect(model.seen[0].type).toBe("image/webp");
  expect((await sharp(Buffer.from(model.seen[0].bytes)).metadata()).width).toBe(1080);
  expect(model.seen[0].people.map((p) => p.name)).toContain("Anna");

  const fact = await (await db()).selectFrom("facts").selectAll().where("screenshot_id", "=", shot.id).executeTakeFirstOrThrow();
  expect(fact).toMatchObject({ person_id: s.anna, text: "Urlaub in Lissabon", category: "travel", source: "Instagram", happened_on: "2026-10-12", visibility: "shared", recorded_by: s.a.userId });
  expect(sent).toEqual([]); // sure: no push
  expect(await listPending(s.a)).toEqual([]);
});

test("a person named twice in one post gets one fact", async () => {
  const shot = await shareScreenshot(s.a, await image());
  await readScreenshot(shot.id, answering(post([{ name: "Anna", personId: s.anna }, { name: "anna", handle: "anna", personId: s.anna }])));
  expect(await (await db()).selectFrom("facts").selectAll().where("screenshot_id", "=", shot.id).execute()).toHaveLength(1);
});

test("the same image shared twice is read once", async () => {
  const bytes = await image();
  const first = await shareScreenshot(s.a, bytes);
  expect(await shareScreenshot(s.a, bytes)).toEqual({ id: first.id, status: "reading", duplicate: true });
});

test("not an image is refused before anything is stored", async () => {
  await expect(shareScreenshot(s.a, new TextEncoder().encode("hello"))).rejects.toThrow(/not an image/);
  await expect(shareScreenshot(s.a, new Uint8Array())).rejects.toThrow(/empty/);
  expect(await (await db()).selectFrom("screenshots").selectAll().execute()).toEqual([]);
});

test("unsure (no id, or an id that doesn't exist) waits on the check page and pushes, with a link to it", async () => {
  const one = await shareScreenshot(s.a, await image());
  expect(await readScreenshot(one.id, answering(post([{ name: "Anna B.", handle: "annab", candidates: [s.anna, "nobody"] }])))).toBe("pending");
  const two = await shareScreenshot(s.a, await image());
  expect(await readScreenshot(two.id, answering(post([{ name: "Tom", personId: "made-up" }])))).toBe("pending");

  expect(sent.map((m) => [m.url, m.title, m.click])).toEqual([
    ["https://ntfy.example/a", "📷 Wer ist das?", `https://f.example/pruefen#${one.id}`],
    ["https://ntfy.example/a", "📷 Wer ist das?", `https://f.example/pruefen#${two.id}`],
  ]);
  const pending = await listPending(s.a);
  expect(pending.map((p) => p.id)).toEqual([two.id, one.id]);
  expect(pending[1].reading!.people[0]).toEqual({ name: "Anna B.", handle: "annab", person: null, candidates: [{ id: s.anna, name: "Anna", url: `/p/${s.anna}` }] });
  expect(pending[0].reading!.people[0]).toMatchObject({ person: null, candidates: [] });
  expect(await pendingCount(s.a)).toBe(2);
  expect(await (await db()).selectFrom("facts").selectAll().where("screenshot_id", "is not", null).execute()).toEqual([]);
});

test("a sensitive post waits even when the person is certain", async () => {
  const shot = await shareScreenshot(s.a, await image());
  expect(await readScreenshot(shot.id, answering(post([{ name: "Anna", personId: s.anna }], { sensitive: true, text: "Im Krankenhaus" })))).toBe("pending");
  expect(sent[0].title).toBe("📷 Bitte kurz ansehen, bevor es abgelegt wird");
});

test("nothing personal: no fact, the image goes, a short push", async () => {
  const shot = await shareScreenshot(s.a, await image());
  expect(await readScreenshot(shot.id, answering(post([], { kind: "nothing", text: "" })))).toBe("nothing");
  expect(sent[0].title).toBe("📷 Auf dem Screenshot war nichts für freundebuch");
  expect(await screenshotImage(s.a, shot.id)).toBeNull();
});

test("a date in the future or not a day is dropped", async () => {
  const shot = await shareScreenshot(s.a, await image());
  await readScreenshot(shot.id, answering(post([{ name: "Anna", personId: s.anna }], { happenedOn: "2999-01-01" })));
  expect((await (await db()).selectFrom("facts").select("happened_on").where("screenshot_id", "=", shot.id).executeTakeFirstOrThrow()).happened_on).toBeNull();
});

test("Claude failing marks it failed and pushes; retry reads it again", async () => {
  const shot = await shareScreenshot(s.a, await image());
  expect(await readScreenshot(shot.id, answering(null))).toBe("failed");
  expect(sent[0].title).toBe("📷 Der Screenshot konnte nicht gelesen werden");
  await retryScreenshot(s.a, shot.id, answering(post([{ name: "Anna", personId: s.anna }])));
  await new Promise((r) => setTimeout(r, 50));
  expect(await listPending(s.a)).toEqual([]);
});

test("resolving files it on the picked person and keeps the handle as one of their other names", async () => {
  const shot = await shareScreenshot(s.a, await image());
  await readScreenshot(shot.id, answering(post([{ name: "Anna B.", handle: "anna.reist", candidates: [s.anna] }])));
  const r = await resolveScreenshot(s.a, shot.id, { personId: s.anna });
  expect(r.url).toBe(`/p/${s.anna}#facts-${r.factId}`);
  const d = await db();
  expect((await d.selectFrom("aliases").select("alias").where("person_id", "=", s.anna).execute()).map((a) => a.alias)).toContain("anna.reist");
  expect(await listPending(s.a)).toEqual([]);
  // filed now: resolving again is refused
  await expect(resolveScreenshot(s.a, shot.id, { personId: s.anna })).rejects.toThrow(/No such screenshot/);
});

test("resolving with a new name creates the person; private and edited text are kept", async () => {
  const shot = await shareScreenshot(s.a, await image());
  await readScreenshot(shot.id, answering(post([{ name: "Jana", handle: "jana_k" }], { sensitive: true })));
  const r = await resolveScreenshot(s.a, shot.id, { name: "Jana Klein", text: "Kurz im Krankenhaus", visibility: "private" });
  const fact = await (await db()).selectFrom("facts").selectAll().where("id", "=", r.factId).executeTakeFirstOrThrow();
  expect(fact).toMatchObject({ person_id: r.personId, text: "Kurz im Krankenhaus", visibility: "private", source: "Instagram" });
  await expect(resolveScreenshot(s.a, shot.id, {})).rejects.toThrow();
});

test("the partner sees neither the pending screenshot, its image, nor can act on it", async () => {
  const shot = await shareScreenshot(s.a, await image());
  await readScreenshot(shot.id, answering(post([{ name: "Anna B.", candidates: [s.anna] }])));
  expect(await listPending(s.b)).toEqual([]);
  expect(await pendingCount(s.b)).toBe(0);
  expect(await screenshotImage(s.b, shot.id)).toBeNull();
  expect(await screenshotImage(s.a, shot.id)).toMatchObject({ type: "image/webp" });
  await expect(resolveScreenshot(s.b, shot.id, { personId: s.anna })).rejects.toThrow(/No such screenshot/);
  await expect(discardScreenshot(s.b, shot.id)).rejects.toThrow(/No such screenshot/);
});

test("the image of a shared fact is visible to the partner, of a private one it isn't", async () => {
  const shared = await shareScreenshot(s.a, await image());
  await readScreenshot(shared.id, answering(post([{ name: "Anna", personId: s.anna }])));
  expect(await screenshotImage(s.b, shared.id)).not.toBeNull();

  const priv = await shareScreenshot(s.a, await image());
  await readScreenshot(priv.id, answering(post([{ name: "Anna", candidates: [s.anna] }])));
  await resolveScreenshot(s.a, priv.id, { personId: s.anna, visibility: "private" });
  expect(await screenshotImage(s.b, priv.id)).toBeNull();
  // and the briefing shows the partner only the shared one, with its source and image
  const b = await briefing(s.b, s.anna, "2026-10-25");
  const fromShots = b.known.filter((f) => f.source);
  expect(fromShots).toEqual([expect.objectContaining({ text: "Urlaub in Lissabon", source: "Instagram", happenedOn: "2026-10-12", imageUrl: `/api/screenshots/${shared.id}` })]);
});

test("discarding drops row and image; deleting the fact prunes a filed screenshot", async () => {
  const one = await shareScreenshot(s.a, await image());
  await readScreenshot(one.id, answering(post([{ name: "X" }])));
  await discardScreenshot(s.a, one.id);
  expect(await screenshotImage(s.a, one.id)).toBeNull();

  const two = await shareScreenshot(s.a, await image());
  await readScreenshot(two.id, answering(post([{ name: "Anna", personId: s.anna }])));
  const fact = await (await db()).selectFrom("facts").select("id").where("screenshot_id", "=", two.id).executeTakeFirstOrThrow();
  await deleteItem(s.a, "facts", fact.id);
  expect(await screenshotImage(s.a, two.id)).toBeNull();
  expect(await pruneScreenshots()).toBe(0);
});

test("after a restart, what was still being read is read again", async () => {
  const shot = await shareScreenshot(s.a, await image());
  await resumeReading(answering(post([{ name: "Anna", personId: s.anna }])));
  await new Promise((r) => setTimeout(r, 50));
  expect((await (await db()).selectFrom("screenshots").select("status").where("id", "=", shot.id).executeTakeFirstOrThrow()).status).toBe("filed");
});

test("a share key names its user until it is replaced or revoked", async () => {
  const key = await createShareKey(s.a);
  expect(key).toMatch(/^fbs_/);
  expect(await viewerFromShareKey(key)).toEqual(s.a);
  expect(await viewerFromShareKey("fbs_wrong")).toBeNull();
  expect(await viewerFromShareKey("not-a-key")).toBeNull();
  const next = await createShareKey(s.a);
  expect(await viewerFromShareKey(key)).toBeNull();
  expect(await viewerFromShareKey(next)).toEqual(s.a);
  await revokeShareKey(s.a);
  expect(await viewerFromShareKey(next)).toBeNull();
  // the webhook survives a new key
  await putSettings(s.b, { webhookUrl: "https://ntfy.example/b" });
  await createShareKey(s.b);
  expect((await (await db()).selectFrom("user_settings").select("webhook_url").where("user_id", "=", s.b.userId).executeTakeFirstOrThrow()).webhook_url).toBe("https://ntfy.example/b");
});
