import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { afterAll, afterEach, beforeEach, expect, test } from "vitest";
import { briefing } from "./briefing";
import { deleteItem } from "./corrections";
import { db } from "./db";
import { putSettings } from "./settings";
import type { FileInput, FileModel, Suggestion } from "./file-model";
import {
  createShareKey,
  discardFile,
  listPending,
  pendingCount,
  pruneFiles,
  readFile,
  resumeReading,
  retryFile,
  revokeShareKey,
  fileContent,
  shareFile,
  viewerFromShareKey,
} from "./files";
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

const suggestion = (people: Suggestion["people"], summary = "Anna war in Lissabon im Urlaub"): Suggestion => ({ summary, people });
const answering = (r: Suggestion | { error: string }): FileModel & { seen: FileInput[] } => {
  const seen: FileInput[] = [];
  return { seen, read: async (i) => (seen.push(i), r) };
};
const status = async (id: string) => (await (await db()).selectFrom("files").select("status").where("id", "=", id).executeTakeFirstOrThrow()).status;
// A fact filed from a file, as remember with fileId files it.
async function factFrom(fileId: string, visibility: "shared" | "private" = "shared") {
  const id = `f-${fileId}`;
  await (await db())
    .insertInto("facts")
    .values({ id, person_id: s.anna, text: "Urlaub in Lissabon", category: "travel", status: "current", visibility, recorded_by: s.a.userId, conversation_id: null, created_at: Date.now(), source: "Instagram", happened_on: "2026-10-12", file_id: fileId })
    .execute();
  await (await db()).updateTable("files").set({ status: "filed" }).where("id", "=", fileId).execute();
  return id;
}

test("an image is shrunk to 1080 px WebP and pre-read into a suggestion that waits, filing nothing, with a push to it", async () => {
  const shot = await shareFile(s.a, await image());
  expect(shot).toMatchObject({ status: "reading", duplicate: false });
  const model = answering(suggestion([{ name: "Anna", personId: s.anna }]));
  expect(await readFile(shot.id, model)).toBe("pending");
  expect(model.seen[0].type).toBe("image/webp");
  expect((await sharp(Buffer.from(model.seen[0].bytes)).metadata()).width).toBe(1080);
  expect(model.seen[0].people.map((p) => p.name)).toContain("Anna");
  // Even a sure suggestion only waits.
  expect(await (await db()).selectFrom("facts").selectAll().where("file_id", "=", shot.id).execute()).toEqual([]);
  expect(await listPending(s.a)).toEqual([
    {
      id: shot.id,
      status: "pending",
      createdAt: expect.any(Number),
      url: `/api/files/${shot.id}`,
      type: "image/webp",
      summary: "Anna war in Lissabon im Urlaub",
      people: [{ name: "Anna", person: { id: s.anna, name: "Anna", url: `/p/${s.anna}` }, candidates: [] }],
      error: null,
    },
  ]);
  expect(sent).toEqual([expect.objectContaining({ title: "📎 Neu unter „Prüfen“", body: "Anna war in Lissabon im Urlaub", click: `https://f.example/pruefen#${shot.id}` })]);
});

test("a person id that doesn't exist becomes candidates of those that do", async () => {
  const shot = await shareFile(s.a, await image());
  await readFile(shot.id, answering(suggestion([{ name: "Anna B.", personId: "nope", candidates: [s.anna, "gone"] }])));
  expect((await listPending(s.a))[0].people).toEqual([{ name: "Anna B.", person: null, candidates: [{ id: s.anna, name: "Anna", url: `/p/${s.anna}` }] }]);
});

test("the same file shared twice is read once", async () => {
  const bytes = await image();
  const first = await shareFile(s.a, bytes);
  expect(await shareFile(s.a, bytes)).toEqual({ id: first.id, status: "reading", duplicate: true });
});

test("not an image is refused before anything is stored", async () => {
  await expect(shareFile(s.a, new TextEncoder().encode("hello"), "image/png")).rejects.toThrow(/not an image/);
  await expect(shareFile(s.a, new Uint8Array())).rejects.toThrow(/empty/);
  expect(await (await db()).selectFrom("files").selectAll().execute()).toEqual([]);
});

test("a failed pre-read keeps its reason and pushes; retry reads it again", async () => {
  const shot = await shareFile(s.a, await image());
  expect(await readFile(shot.id, answering({ error: "400 tool_choice not supported" }))).toBe("failed");
  expect((await listPending(s.a))[0]).toMatchObject({ status: "failed", summary: null, error: "400 tool_choice not supported" });
  expect(sent.map((m) => m.title)).toEqual(["📎 Die Datei konnte nicht gelesen werden"]);
  await retryFile(s.a, shot.id, answering(suggestion([{ name: "Anna", personId: s.anna }])));
  await new Promise((r) => setTimeout(r, 50));
  expect(await status(shot.id)).toBe("pending");
  expect((await listPending(s.a))[0].error).toBeNull();
});

test("a pre-read from before files lists its text as the summary", async () => {
  const shot = await shareFile(s.a, await image());
  const old = { kind: "post", platform: "Instagram", text: "Urlaub in Lissabon", category: "travel", happenedOn: null, sensitive: false, people: [{ name: "Anna", candidates: [s.anna] }] };
  await (await db()).updateTable("files").set({ status: "pending", reading: JSON.stringify(old) }).where("id", "=", shot.id).execute();
  expect((await listPending(s.a))[0]).toMatchObject({ summary: "Urlaub in Lissabon", people: [{ name: "Anna", person: null, candidates: [{ id: s.anna }] }] });
});

test("the partner sees neither the waiting file, its content, nor can act on it", async () => {
  const shot = await shareFile(s.a, await image());
  await readFile(shot.id, answering(suggestion([{ name: "Anna B.", candidates: [s.anna] }])));
  expect(await listPending(s.b)).toEqual([]);
  expect(await pendingCount(s.b)).toBe(0);
  expect(await fileContent(s.b, shot.id)).toBeNull();
  expect(await fileContent(s.a, shot.id)).toMatchObject({ type: "image/webp" });
  await expect(discardFile(s.b, shot.id)).rejects.toThrow(/No such file/);
});

test("the file of a shared fact is visible to the partner, of a private one it isn't", async () => {
  const shared = await shareFile(s.a, await image());
  await factFrom(shared.id);
  expect(await fileContent(s.b, shared.id)).not.toBeNull();
  const priv = await shareFile(s.a, await image());
  await factFrom(priv.id, "private");
  expect(await fileContent(s.b, priv.id)).toBeNull();
  const b = await briefing(s.b, s.anna, "2026-10-25");
  expect(b.known.filter((f) => f.source)).toEqual([expect.objectContaining({ text: "Urlaub in Lissabon", imageUrl: `/api/files/${shared.id}` })]);
});

test("discarding drops row and blob; deleting the fact prunes a filed file", async () => {
  const one = await shareFile(s.a, await image());
  await readFile(one.id, answering(suggestion([{ name: "X" }])));
  await discardFile(s.a, one.id);
  expect(await fileContent(s.a, one.id)).toBeNull();
  const two = await shareFile(s.a, await image());
  const fact = await factFrom(two.id);
  await deleteItem(s.a, "facts", fact);
  expect(await fileContent(s.a, two.id)).toBeNull();
  expect(await pruneFiles()).toBe(0);
});

test("after a restart, what was still being read is read again", async () => {
  const shot = await shareFile(s.a, await image());
  await resumeReading(answering(suggestion([{ name: "Anna", personId: s.anna }])));
  await new Promise((r) => setTimeout(r, 50));
  expect(await status(shot.id)).toBe("pending");
});

test("a file a pre-read once found nothing in is stored afresh when shared again", async () => {
  const bytes = await image();
  const first = await shareFile(s.a, bytes);
  await (await db()).updateTable("files").set({ status: "nothing" }).where("id", "=", first.id).execute();
  const again = await shareFile(s.a, bytes);
  expect(again).toMatchObject({ status: "reading", duplicate: false });
  expect(again.id).not.toBe(first.id);
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

test("a PDF and a text file are stored as they are, with their type; anything else is refused", async () => {
  const pdf = new TextEncoder().encode("%PDF-1.4\nEinladung zur Hochzeit");
  const a = await shareFile(s.a, pdf, "application/pdf");
  expect(await fileContent(s.a, a.id)).toEqual({ bytes: pdf, type: "application/pdf" });
  const text = new TextEncoder().encode("[19:20] Patrick: Wochenende war gut, Freitag Spieleabend");
  const b = await shareFile(s.a, text, "text/plain; charset=utf-8");
  expect(await fileContent(s.a, b.id)).toEqual({ bytes: text, type: "text/plain" });
  // Without a type, the bytes tell.
  const c = await shareFile(s.a, new TextEncoder().encode("%PDF-1.7 other"), "");
  expect((await fileContent(s.a, c.id))!.type).toBe("application/pdf");
  await expect(shareFile(s.a, new Uint8Array([0x50, 0x4b, 3, 4, 0, 0, 9]), "application/zip")).rejects.toThrow("freundebuch takes images, PDFs and text files");
  await expect(shareFile(s.a, new Uint8Array([0, 1, 2, 0xff, 0xfe]), "")).rejects.toThrow("freundebuch takes images, PDFs and text files");
  const keys = await (await db()).selectFrom("files").select(["id", "blob_key"]).execute();
  expect(keys.find((k) => k.id === a.id)!.blob_key).toBe(`files/${a.id}.pdf`);
  expect(keys.find((k) => k.id === b.id)!.blob_key).toBe(`files/${b.id}.txt`);
});
