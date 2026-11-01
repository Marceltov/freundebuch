import { today } from "../people/dates";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { afterAll, afterEach, beforeEach, expect, test } from "vitest";
import { briefing } from "../reading/briefing";
import { deleteItem } from "./corrections";
import { unchecked, firstBook } from "../db/testing";
import { putSettings } from "../core/settings";
import type { FileInput, FileModel, Suggestion } from "./file-model";
import { setTranscriberForTests, type Transcriber } from "./transcribe";
import {
  chatFiles,
  NO_AUDIO,
  NOT_AUDIO,
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
import { seed, seedWorkBook, type Seed } from "../testing/fixtures";
import { getConversation, recordConversation } from "./conversations";

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
const image = async (width = 2000) =>
  new Uint8Array(
    await sharp({ create: { width, height: 40, channels: 3, background: { r: colour++ % 256, g: 10, b: 20 } } })
      .png()
      .toBuffer(),
  );

const suggestion = (people: Suggestion["people"], summary = "Anna war in Lissabon im Urlaub"): Suggestion => ({
  summary,
  transcript: "Anna: Urlaub in Lissabon!",
  people,
});
const answering = (r: Suggestion | { error: string }): FileModel & { seen: FileInput[] } => {
  const seen: FileInput[] = [];
  return { seen, read: async (i) => (seen.push(i), r) };
};
const status = async (id: string) => (await unchecked().selectFrom("files").select("status").where("id", "=", id).executeTakeFirstOrThrow()).status;
// A fact filed from a file, as remember with fileId files it.
async function factFrom(fileId: string, visibility: "shared" | "private" = "shared") {
  const id = `f-${fileId}`;
  await (
    await firstBook()
  )
    .insert("facts", {
      id,
      person_id: s.anna,
      text: "Urlaub in Lissabon",
      category: "travel",
      status: "current",
      visibility,
      recorded_by: s.a.userId,
      conversation_id: null,
      created_at: Date.now(),
      source: "Instagram",
      happened_on: "2026-10-12",
      file_id: fileId,
    })
    .execute();
  await unchecked().updateTable("files").set({ status: "filed" }).where("id", "=", fileId).execute();
  return id;
}

test("an image is shrunk to 1080 px WebP and pre-read into a suggestion that waits, filing nothing, with a push to it", async () => {
  const shot = await shareFile(s.a, await image());
  expect(shot).toMatchObject({ status: "reading", duplicate: false });
  const model = answering(suggestion([{ name: "Anna", personId: s.anna }]));
  expect(await readFile(s.a, shot.id, model)).toBe("pending");
  expect(model.seen[0].type).toBe("image/webp");
  expect((await sharp(Buffer.from(model.seen[0].bytes)).metadata()).width).toBe(1080);
  expect(model.seen[0].people.map((p) => p.name)).toContain("Anna");
  // Even a sure suggestion only waits.
  expect(await unchecked().selectFrom("facts").selectAll().where("file_id", "=", shot.id).execute()).toEqual([]);
  expect(await listPending(s.a)).toEqual([
    {
      id: shot.id,
      status: "pending",
      createdAt: expect.any(Number),
      sharedOn: today(),
      url: `/api/files/${shot.id}`,
      type: "image/webp",
      summary: "Anna war in Lissabon im Urlaub",
      transcript: "Anna: Urlaub in Lissabon!",
      people: [{ name: "Anna", person: { id: s.anna, name: "Anna", url: `/p/${s.anna}` }, candidates: [] }],
      error: null,
      batchId: null,
    },
  ]);
  expect(sent).toEqual([
    expect.objectContaining({ title: "📎 Neu unter „Prüfen“", body: "Anna war in Lissabon im Urlaub", click: `https://f.example/pruefen#${shot.id}` }),
  ]);
});

test("a person id that doesn't exist becomes candidates of those that do", async () => {
  const shot = await shareFile(s.a, await image());
  await readFile(s.a, shot.id, answering(suggestion([{ name: "Anna B.", personId: "nope", candidates: [s.anna, "gone"] }])));
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
  expect(await unchecked().selectFrom("files").selectAll().execute()).toEqual([]);
});

test("a failed pre-read keeps its reason and pushes; retry reads it again", async () => {
  const shot = await shareFile(s.a, await image());
  expect(await readFile(s.a, shot.id, answering({ error: "400 tool_choice not supported" }))).toBe("failed");
  expect((await listPending(s.a))[0]).toMatchObject({ status: "failed", summary: null, error: "400 tool_choice not supported" });
  expect(sent.map((m) => m.title)).toEqual(["📎 Die Datei konnte nicht gelesen werden"]);
  await retryFile(s.a, shot.id, answering(suggestion([{ name: "Anna", personId: s.anna }])));
  await new Promise((r) => setTimeout(r, 50));
  expect(await status(shot.id)).toBe("pending");
  expect((await listPending(s.a))[0].error).toBeNull();
});

test("a pre-read from before files lists its text as the summary", async () => {
  const shot = await shareFile(s.a, await image());
  const old = {
    kind: "post",
    platform: "Instagram",
    text: "Urlaub in Lissabon",
    category: "travel",
    happenedOn: null,
    sensitive: false,
    people: [{ name: "Anna", candidates: [s.anna] }],
  };
  await unchecked()
    .updateTable("files")
    .set({ status: "pending", reading: JSON.stringify(old) })
    .where("id", "=", shot.id)
    .execute();
  expect((await listPending(s.a))[0]).toMatchObject({ summary: "Urlaub in Lissabon", people: [{ name: "Anna", person: null, candidates: [{ id: s.anna }] }] });
});

test("the partner sees neither the waiting file, its content, nor can act on it", async () => {
  const shot = await shareFile(s.a, await image());
  await readFile(s.a, shot.id, answering(suggestion([{ name: "Anna B.", candidates: [s.anna] }])));
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
  await readFile(s.a, one.id, answering(suggestion([{ name: "X" }])));
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

test("after a restart, a file whose user left the book fails instead of waiting to be read", async () => {
  const shot = await shareFile(s.b, await image());
  await (await firstBook()).instance.delete("members").where("user_id", "=", s.b.userId).execute();
  await resumeReading(answering(suggestion([{ name: "Anna", personId: s.anna }])));
  await new Promise((r) => setTimeout(r, 50));
  expect(await status(shot.id)).toBe("failed");
});

test("a file a pre-read once found nothing in is stored afresh when shared again", async () => {
  const bytes = await image();
  const first = await shareFile(s.a, bytes);
  await unchecked().updateTable("files").set({ status: "nothing" }).where("id", "=", first.id).execute();
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
  expect((await unchecked().selectFrom("user_settings").select("webhook_url").where("user_id", "=", s.b.userId).executeTakeFirstOrThrow()).webhook_url).toBe(
    "https://ntfy.example/b",
  );
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
  await expect(shareFile(s.a, new Uint8Array([0x50, 0x4b, 3, 4, 0, 0, 9]), "application/zip")).rejects.toThrow(
    "freundebuch takes images, PDFs, text files and voice notes",
  );
  await expect(shareFile(s.a, new Uint8Array([0, 1, 2, 0xff, 0xfe]), "")).rejects.toThrow("freundebuch takes images, PDFs, text files and voice notes");
  const keys = await unchecked().selectFrom("files").select(["id", "blob_key"]).execute();
  expect(keys.find((k) => k.id === a.id)!.blob_key).toBe(`files/${a.id}.pdf`);
  expect(keys.find((k) => k.id === b.id)!.blob_key).toBe(`files/${b.id}.txt`);
});

test("a file a private fact was filed from too stays its recorder's: the shared fact neither opens nor shows it (from before files)", async () => {
  const shot = await shareFile(s.a, await image());
  await factFrom(shot.id);
  await (
    await firstBook()
  )
    .insert("facts", {
      id: "f-private",
      person_id: s.anna,
      text: "Trennung",
      category: "family",
      status: "current",
      visibility: "private",
      recorded_by: s.a.userId,
      conversation_id: null,
      created_at: Date.now(),
      file_id: shot.id,
    })
    .execute();
  expect(await fileContent(s.b, shot.id)).toBeNull();
  expect((await briefing(s.b, s.anna, "2026-10-25")).known.find((f) => f.text === "Urlaub in Lissabon")?.imageUrl).toBeUndefined();
  expect((await briefing(s.a, s.anna, "2026-10-25")).known.find((f) => f.text === "Urlaub in Lissabon")?.imageUrl).toBe(`/api/files/${shot.id}`);
});

test("a pre-read keeps the file's transcript, which the listing shows", async () => {
  const shot = await shareFile(s.a, await image());
  await readFile(s.a, shot.id, answering({ summary: "s", transcript: "[19:20] Patrick: Freitag Spieleabend", people: [] }));
  expect((await listPending(s.a))[0].transcript).toBe("[19:20] Patrick: Freitag Spieleabend");
});

test("a text file over 1 MB is refused: too long to hand to Claude whole", async () => {
  await expect(shareFile(s.a, new TextEncoder().encode("a".repeat(1024 * 1024 + 1)), "text/plain")).rejects.toThrow(
    "The text file is too long (at most 1 MB): share a shorter part",
  );
  expect(await unchecked().selectFrom("files").selectAll().execute()).toEqual([]);
});

const heicFixture = (name: string) => new Uint8Array(readFileSync(join(__dirname, "..", "testing", "heic", `${name}.heic`)));
const storedSize = async (id: string) => {
  const c = await fileContent(s.a, id);
  expect(c?.type).toBe("image/webp");
  const m = await sharp(Buffer.from(c!.bytes)).metadata();
  return { width: m.width, height: m.height };
};

test("an iPhone photo in HEIC is read on the server and kept as WebP, by its type or by its first bytes", async () => {
  const shot = await shareFile(s.a, heicFixture("small"), "image/heic");
  expect(shot.status).toBe("reading");
  expect(await storedSize(shot.id)).toEqual({ width: 120, height: 60 });
  const untyped = await shareFile(s.b, heicFixture("small"), "");
  expect(untyped.status).toBe("reading");
});

test("a turned iPhone photo is kept the right way up", async () => {
  expect(await storedSize((await shareFile(s.a, heicFixture("rotated"), "image/heic")).id)).toEqual({ width: 60, height: 120 });
});

test("a HEIC holding several images (a burst, a Live Photo) keeps its main one", async () => {
  expect(await storedSize((await shareFile(s.a, heicFixture("multi"), "image/heic")).id)).toEqual({ width: 80, height: 40 });
});

test("a HEIC whose main image isn't its first keeps the main one", async () => {
  expect(await storedSize((await shareFile(s.a, heicFixture("primary-second"), "image/heic")).id)).toEqual({ width: 40, height: 80 });
});

test("a HEIC over 25 megapixels is refused before it is decoded, saying what to do", async () => {
  await expect(shareFile(s.a, heicFixture("huge"), "image/heic")).rejects.toThrow(
    "This photo is too large (over 25 megapixels): share a smaller one, or a screenshot of it",
  );
});

test("a broken HEIC is refused as an image freundebuch can't read", async () => {
  const heic = new Uint8Array([0, 0, 0, 24, ...new TextEncoder().encode("ftypheic"), 0, 0, 0, 0, ...new TextEncoder().encode("mif1heic")]);
  await expect(shareFile(s.a, heic, "image/heic")).rejects.toThrow("That is not an image freundebuch can read");
  await expect(shareFile(s.a, heic, "")).rejects.toThrow("That is not an image freundebuch can read");
});

test("a file filed by the screenshot reading before files can be shared again: it is stored afresh", async () => {
  const bytes = await image();
  const first = await shareFile(s.a, bytes);
  await unchecked().updateTable("files").set({ status: "filed" }).where("id", "=", first.id).execute();
  const again = await shareFile(s.a, bytes);
  expect(again).toMatchObject({ status: "reading", duplicate: false });
  expect(again.id).not.toBe(first.id);
  // The old row stays for the fact that may still show it.
  expect(await unchecked().selectFrom("files").select("id").where("id", "=", first.id).execute()).toHaveLength(1);
});

// A voice note as WhatsApp shares it: Ogg (Opus). Only its first bytes matter here; Whisper is a stand-in.
const voiceNote = (n = colour++) => new Uint8Array([...new TextEncoder().encode("OggS"), 0, 2, n % 256, 0, 0, 0, 0, 0, 1, 2, 3]);
const hearing = (r: { text: string } | { error: string }): Transcriber & { heard: string[] } => {
  const heard: string[] = [];
  return { heard, transcribe: async (_b, type) => (heard.push(type), r) };
};

test("a voice note is stored as it came, transcribed, and Claude pre-reads the transcript, which is kept word for word", async () => {
  const whisper = hearing({ text: "Hi, hier ist Anna. Wir sind gut in Lissabon angekommen!" });
  setTranscriberForTests(whisper);
  try {
    const bytes = voiceNote();
    const shot = await shareFile(s.a, bytes, "audio/ogg; codecs=opus");
    expect(await fileContent(s.a, shot.id)).toEqual({ bytes, type: "audio/ogg" });
    const model = answering(suggestion([{ name: "Anna", personId: s.anna }]));
    expect(await readFile(s.a, shot.id, model, whisper)).toBe("pending");
    expect(whisper.heard).toEqual(["audio/ogg"]);
    expect(model.seen[0].type).toBe("text/plain");
    expect(new TextDecoder().decode(model.seen[0].bytes)).toContain("Wir sind gut in Lissabon angekommen!");
    expect((await listPending(s.a))[0]).toMatchObject({
      type: "audio/ogg",
      summary: "Anna war in Lissabon im Urlaub",
      transcript: "Hi, hier ist Anna. Wir sind gut in Lissabon angekommen!",
    });
    // Erzählen gets the words, not the audio.
    const [chat] = await chatFiles(s.a, [shot.id]);
    expect(chat.type).toBe("text/plain");
    expect(new TextDecoder().decode(chat.bytes)).toContain("Wir sind gut in Lissabon angekommen!");
  } finally {
    setTranscriberForTests(null);
  }
});

test("a voice note is known by its first bytes when it comes without a type, and refused without a transcription server", async () => {
  await expect(shareFile(s.a, voiceNote(), "audio/ogg")).rejects.toThrow(NO_AUDIO);
  setTranscriberForTests(hearing({ text: "x" }));
  try {
    const shot = await shareFile(s.a, voiceNote(), "application/octet-stream");
    expect((await fileContent(s.a, shot.id))!.type).toBe("audio/ogg");
    const m4a = new Uint8Array([0, 0, 0, 0x20, ...new TextEncoder().encode("ftypM4A "), 0, 0, 0, 0]);
    expect((await fileContent(s.a, (await shareFile(s.a, m4a, "")).id))!.type).toBe("audio/mp4");
    await expect(shareFile(s.a, new TextEncoder().encode("not audio at all"), "audio/ogg")).rejects.toThrow(NOT_AUDIO);
  } finally {
    setTranscriberForTests(null);
  }
});

test("a voice note that can't be transcribed fails saying so; one Claude couldn't read keeps its transcript for the retry", async () => {
  setTranscriberForTests(hearing({ text: "x" }));
  try {
    const a = await shareFile(s.a, voiceNote());
    expect(await readFile(s.a, a.id, answering(suggestion([])), hearing({ error: "transcription failed (HTTP 500)" }))).toBe("failed");
    expect((await listPending(s.a))[0]).toMatchObject({ status: "failed", transcript: null, error: "transcription failed (HTTP 500)" });
    expect(sent.map((m) => m.title)).toEqual(["🎙️ Die Sprachnachricht konnte nicht transkribiert werden"]);

    const b = await shareFile(s.a, voiceNote());
    const first = hearing({ text: "Anna kommt Freitag" });
    expect(await readFile(s.a, b.id, answering({ error: "overloaded" }), first)).toBe("failed");
    expect((await listPending(s.a)).find((f) => f.id === b.id)).toMatchObject({ status: "failed", transcript: "Anna kommt Freitag", error: "overloaded" });
    await unchecked().updateTable("files").set({ status: "reading" }).where("id", "=", b.id).execute();
    const again = hearing({ text: "never asked" });
    expect(await readFile(s.a, b.id, answering(suggestion([])), again)).toBe("pending");
    expect(again.heard).toEqual([]);
    expect((await listPending(s.a)).find((f) => f.id === b.id)!.transcript).toBe("Anna kommt Freitag");
  } finally {
    setTranscriberForTests(null);
  }
});

test("a shared file waits in the oldest book and is filed into Arbeit", async () => {
  const w = await seedWorkBook(s);
  const f = await shareFile(w.a, new TextEncoder().encode("Chefin: Launch am Montag"), "text/plain");
  await unchecked()
    .updateTable("files")
    .set({ status: "pending", reading: JSON.stringify({ summary: "s", transcript: "Chefin: Launch am Montag", people: [] }) })
    .where("id", "=", f.id)
    .execute();
  expect((await listPending(s.a)).map((x) => x.id)).toEqual([f.id]);
  const c = await recordConversation(w.work, {
    date: "2026-10-30",
    kind: "message",
    summary: "Launch date",
    transcript: "Message from the boss.",
    visibility: "shared",
    fileIds: [f.id],
    people: [{ id: w.boss, present: true }],
  });
  expect((await getConversation(w.work, c.conversationId)).transcript).toContain("Chefin: Launch am Montag");
  expect(await fileContent(w.a, f.id)).toBeNull();
});

test("a refused record leaves its files where they waited", async () => {
  const w = await seedWorkBook(s);
  const f = await shareFile(w.a, new TextEncoder().encode("Chefin: Launch"), "text/plain");
  await unchecked()
    .updateTable("files")
    .set({ status: "pending", reading: JSON.stringify({ summary: "s", transcript: "Chefin: Launch", people: [] }) })
    .where("id", "=", f.id)
    .execute();
  const home = (await unchecked().selectFrom("files").select("book_id").where("id", "=", f.id).executeTakeFirstOrThrow()).book_id;
  await expect(
    recordConversation(w.work, {
      date: "2026-10-30",
      kind: "message",
      summary: "x",
      transcript: "x",
      visibility: "shared",
      fileIds: [f.id],
      people: [{ id: "nope", present: true }],
    }),
  ).rejects.toThrow();
  expect((await unchecked().selectFrom("files").select("book_id").where("id", "=", f.id).executeTakeFirstOrThrow()).book_id).toBe(home);
});

test("the inbox is the user's: it lists and closes files of every book at once", async () => {
  const w = await seedWorkBook(s);
  const one = await shareFile(w.a, new TextEncoder().encode("eins"), "text/plain");
  const two = await shareFile(w.a, new TextEncoder().encode("zwei"), "text/plain");
  await unchecked().updateTable("files").set({ book_id: w.work.bookId }).where("id", "=", two.id).execute();
  const { toolByName } = await import("../mcp/tools");
  const listed = await toolByName("inbox")!.run(w.a, { action: "list" });
  expect(((listed.files ?? []) as { id: string }[]).map((x) => x.id).sort()).toEqual([one.id, two.id].sort());
  await toolByName("inbox")!.run(w.a, { action: "done", ids: [one.id, two.id] });
  expect(await listPending(w.a)).toEqual([]);
});
