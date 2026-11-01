// Files shared into freundebuch (a screenshot, a photo, a PDF, a text such as a chat export, a voice note), from the phone or
// from Erzählen. One goes: stored (images shrunk to WebP, the rest as it came, in the blob store) → a voice note transcribed by
// the household's own Whisper (transcribe.ts) → pre-read by Claude (file-model.ts) into a suggestion and a transcript (its text
// word for word, what a photo shows, what a voice note says) → waits under "Prüfen" until the user works it
// through with Claude (Erzählen opened on it, or the MCP tool inbox). Filing it with record keeps only its
// transcript, in the conversation's; the file itself goes once it is reviewed (filed, done or discarded). Nothing is filed
// unattended. Waiting files belong to the user who shared them. Facts filed by the screenshot reading before files still show
// their image, to whoever may see the fact.
import { eachBook, instance, scope, type Scope } from "../db/scope";
import { viewerIn } from "../people/books";
import { createHash, randomBytes } from "node:crypto";
import sharp from "sharp";
import { config } from "../core/config";
import { today } from "../people/dates";
import { newId, now } from "../db";
import { InvalidInputError, NotFoundError } from "../core/errors";
import { decodeHeic } from "./heic";
import { logger } from "../core/log";
import { notifyCopy, type NotifyCopy } from "../notify/copy";
import { sendWebhook } from "../notify/webhook";
import { anthropicFileModel, fakeFileModel, type FileModel, type KnownPerson, type Suggestion } from "./file-model";
import { getSettings, userLanguage } from "../core/settings";
import { transcriber, type Transcriber } from "./transcribe";
import { processState } from "../core/state";
import { store } from "./storage";
import { spend } from "../chat/usage";
import type { Viewer } from "../core/types";
import { filePath, personPath } from "../core/urls";
import { viewerById } from "../core/users";
import { visible } from "../visibility";

const log = logger("files");

/** The largest upload taken: a phone screenshot or a letter as PDF is a few MB. */
export const MAX_UPLOAD = 15 * 1024 * 1024;
const WIDTH = 1080;
/** Images are stored shrunk, as WebP; PDFs, text and voice notes as they came. */
const EXT: Record<string, string> = {
  "image/webp": "webp",
  "application/pdf": "pdf",
  "text/plain": "txt",
  "audio/ogg": "ogg",
  "audio/mp4": "m4a",
  "audio/mpeg": "mp3",
  "audio/wav": "wav",
  "audio/webm": "webm",
  "audio/flac": "flac",
};
export const NOT_TAKEN = "freundebuch takes images, PDFs, text files and voice notes";
export const NO_AUDIO = "This freundebuch takes no voice notes: it has no transcription server (FREUNDEBUCH_TRANSCRIBE_URL)";
export const NOT_AUDIO = "That is not a voice note freundebuch can read";
export const isAudio = (type: string) => type.startsWith("audio/");

/** The audio format by its first bytes: Ogg (a WhatsApp voice note's Opus), MP4/M4A (an iPhone voice memo), MP3, WAV, WebM, FLAC. */
function audioType(bytes: Uint8Array): string | null {
  const head = new TextDecoder("latin1").decode(bytes.subarray(0, 12));
  if (head.startsWith("OggS")) return "audio/ogg";
  if (/^ftyp(M4A |M4B |mp42|isom|3gp)/.test(head.slice(4))) return "audio/mp4";
  if (head.startsWith("ID3") || (bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0)) return "audio/mpeg";
  if (head.startsWith("RIFF") && head.slice(8) === "WAVE") return "audio/wav";
  if (bytes[0] === 0x1a && bytes[1] === 0x45 && bytes[2] === 0xdf && bytes[3] === 0xa3) return "audio/webm";
  if (head.startsWith("fLaC")) return "audio/flac";
  return null;
}
/** The longest text file taken: about 250,000 tokens, which Claude reads whole in one request. */
export const MAX_TEXT = 1024 * 1024;
export const PENDING_PATH = "/pruefen";

export type FileStatus = "reading" | "pending" | "filed" | "failed";

/** The header (and the share page's form field) a client sends the same id in with every file of one share. */
export const BATCH_HEADER = "x-freundebuch-batch";
/** A batch id as sent, or null when there is none or it isn't one (8–64 of A–Z, a–z, 0–9, _ and -): a hint is never an error. */
export const batchOf = (value: string | null | undefined): string | null => (value && /^[A-Za-z0-9_-]{8,64}$/.test(value) ? value : null);

// The model in use: a test's stand-in, Claude with the API key, the e2e stand-in, or none (sharing is off).
const state = processState("files", () => ({ override: null as FileModel | null, queue: Promise.resolve() as Promise<unknown> }));
export const setFileModelForTests = (m: FileModel | null) => {
  state.override = m;
};
export function fileModel(): FileModel | null {
  if (state.override) return state.override;
  const key = config.anthropicKey();
  if (key) return anthropicFileModel(key, config.anthropicModel());
  return config.e2e() ? fakeFileModel : null;
}

/** What `bytes` are, by the type they were sent with, or by their first bytes when that says nothing: a PDF, text (UTF-8
 * without NUL), else an image for sharp to try. */
function kindOf(bytes: Uint8Array, sent: string): "pdf" | "text" | "image" | "audio" | null {
  const type = sent.split(";")[0].trim().toLowerCase();
  if (type === "application/pdf") return "pdf";
  if (type.startsWith("text/")) return "text";
  if (type.startsWith("image/")) return "image";
  // An Opus voice note may come as audio/opus, or as video/ogg or video/mp4 from a share sheet that can't tell.
  if (type.startsWith("audio/") || ((type === "video/ogg" || type === "video/mp4") && audioType(bytes))) return "audio";
  if (type && type !== "application/octet-stream") return null;
  if (new TextDecoder().decode(bytes.subarray(0, 5)) === "%PDF-") return "pdf";
  if (audioType(bytes) && !isHeic(bytes, "")) return "audio";
  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    if (!text.includes("\0")) return "text";
  } catch {}
  return "image";
}

/** An iPhone photo in HEIC/HEIF, by its type or its `ftyp` box; sharp's bundled libvips doesn't decode it, heic.ts does. */
const isHeic = (bytes: Uint8Array, type: string) =>
  /^image\/hei[cf]/.test(type) || /^ftyp(heic|heix|hevc|mif1|msf1)$/.test(new TextDecoder().decode(bytes.subarray(4, 12)));

/** Stores a file `v` shared and returns its entry; the same bytes shared again return the first one (`duplicate`, which keeps its
 * batch, unless it comes with a new share: then it joins that). `type` is what it was sent as ("" when unknown); `batch` the id of the share it came in with (batchOf).
 * Reading it is queued (`queueRead`); the caller doesn't wait for it. */
export async function shareFile(
  v: Viewer,
  bytes: Uint8Array,
  type = "",
  batch: string | null = null,
): Promise<{ id: string; status: FileStatus; duplicate: boolean }> {
  if (bytes.byteLength === 0) throw new InvalidInputError("The file is empty");
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const d = await scope(v);
  const seen = await d.from("files").select(["id", "status"]).where("user_id", "=", v.userId).where("sha256", "=", sha256).executeTakeFirst();
  // An old pre-read that found "nothing" dropped its blob and filed nothing: sharing it again starts afresh. One the screenshot
  // reading filed stays for its fact, under a retired hash, so the same bytes can wait under Prüfen again.
  if (seen?.status === "nothing") await d.delete("files").where("id", "=", seen.id).execute();
  else if (seen?.status === "filed")
    await d
      .update("files")
      .set({ sha256: `${sha256}:${seen.id}` })
      .where("id", "=", seen.id)
      .execute();
  else if (seen) {
    // Shared again along with a new share: it joins that one, so Prüfen opens on what was just sent.
    if (batchOf(batch))
      await d
        .update("files")
        .set({ batch_id: batchOf(batch) })
        .where("id", "=", seen.id)
        .execute();
    return { id: seen.id, status: seen.status, duplicate: true };
  }
  const kind = kindOf(bytes, type);
  let stored: Uint8Array;
  let mediaType: string;
  if (kind === "pdf" && new TextDecoder().decode(bytes.subarray(0, 5)) === "%PDF-") [stored, mediaType] = [bytes, "application/pdf"];
  else if (kind === "text") {
    try {
      new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    } catch {
      throw new InvalidInputError(NOT_TAKEN);
    }
    if (bytes.byteLength > MAX_TEXT) throw new InvalidInputError("The text file is too long (at most 1 MB): share a shorter part");
    [stored, mediaType] = [bytes, "text/plain"];
  } else if (kind === "image") {
    const shrink = (img: ReturnType<typeof sharp>) => img.resize({ width: WIDTH, withoutEnlargement: true }).webp({ quality: 80 }).toBuffer();
    try {
      stored = new Uint8Array(await shrink(sharp(bytes).rotate()));
    } catch {
      if (!isHeic(bytes, type)) throw new InvalidInputError(type.startsWith("image/") ? "That is not an image freundebuch can read" : NOT_TAKEN);
      try {
        const { width, height, rgba } = await decodeHeic(bytes);
        stored = new Uint8Array(await shrink(sharp(Buffer.from(rgba.buffer, rgba.byteOffset, rgba.byteLength), { raw: { width, height, channels: 4 } })));
      } catch (e) {
        if (e instanceof InvalidInputError) throw e;
        throw new InvalidInputError("That is not an image freundebuch can read");
      }
    }
    mediaType = "image/webp";
  } else if (kind === "audio") {
    if (!transcriber()) throw new InvalidInputError(NO_AUDIO);
    const sniffed = audioType(bytes);
    if (!sniffed) throw new InvalidInputError(NOT_AUDIO);
    [stored, mediaType] = [bytes, sniffed];
  } else throw new InvalidInputError(NOT_TAKEN);
  const id = newId();
  const key = `files/${id}.${EXT[mediaType]}`;
  await store().put(key, stored, mediaType);
  try {
    await d
      .insert("files", {
        id,
        user_id: v.userId,
        sha256,
        status: "reading",
        reading: null,
        created_at: now(),
        media_type: mediaType,
        blob_key: key,
        batch_id: batchOf(batch),
      })
      .execute();
  } catch (e) {
    await store().delete(key);
    throw e;
  }
  return { id, status: "reading", duplicate: false };
}

/** Reads the files one after another, so a burst of shares doesn't become a burst of requests. */
export function queueRead(v: Viewer, id: string, model: FileModel): Promise<void> {
  const run = state.queue.then(async () => void (await readFile(v, id, model))).catch((e) => log.error({ err: e }, "reading a file failed"));
  state.queue = run;
  return run;
}

/** At start-up: reads again what a restart interrupted, and drops images no fact needs any more. */
export async function resumeReading(model: FileModel | null = fileModel()): Promise<void> {
  try {
    await pruneFiles();
    if (!model) return;
    await eachBook(async (s) => {
      const rows = await s.from("files").select(["id", "user_id"]).where("status", "=", "reading").orderBy("created_at").execute();
      for (const r of rows) {
        const v = await viewerIn(s.instance, r.user_id, s.v.bookId);
        // Its user left the book: nobody is left to read it for.
        if (!v)
          await s
            .update("files")
            .set({ status: "failed", reading: JSON.stringify({ error: "its user left the book" }) })
            .where("id", "=", r.id)
            .execute();
        else void queueRead(v, r.id, model);
      }
    });
  } catch (e) {
    log.error({ err: e }, "resuming the files failed");
  }
}

async function knownPeople(d: Scope): Promise<KnownPerson[]> {
  const [people, aliases] = await Promise.all([
    d.from("persons").select(["id", "name"]).orderBy("name").execute(),
    d.from("aliases").select(["person_id", "alias"]).execute(),
  ]);
  return people.map((p) => ({ id: p.id, name: p.name, aliases: aliases.filter((a) => a.person_id === p.id).map((a) => a.alias) }));
}

/** Claude's suggestion as freundebuch keeps it: a person id that doesn't exist becomes a candidate list of the ids that do. */
function clean(r: Suggestion, known: Set<string>): Suggestion {
  return {
    summary: r.summary.trim(),
    transcript: r.transcript.trim(),
    people: r.people.map((p) =>
      p.personId && known.has(p.personId)
        ? { name: p.name, personId: p.personId }
        : { name: p.name, candidates: [...new Set(p.candidates ?? [])].filter((c) => known.has(c)) },
    ),
  };
}

/** Pre-reads one of the viewer's files: its suggestion (`pending`), or why not (`failed`). Either way the user hears of it and it waits. A voice
 * note is transcribed first, and Claude reads the transcript; a transcript made before a failed pre-read is kept for the retry. */
export async function readFile(v: Viewer, id: string, model: FileModel, whisper: Transcriber | null = transcriber()): Promise<FileStatus> {
  const d = await scope(v);
  const row = await d.from("files").selectAll().where("id", "=", id).where("user_id", "=", v.userId).executeTakeFirst();
  if (!row || row.status !== "reading") return row && row.status !== "nothing" ? row.status : "failed";
  const bytes = await store().get(row.blob_key);
  const set = (status: FileStatus, reading: Suggestion | { error: string; transcript?: string }) =>
    d
      .update("files")
      .set({ status, reading: JSON.stringify(reading) })
      .where("id", "=", id)
      .where("status", "=", "reading")
      .execute();
  const click = `${PENDING_PATH}#${id}`;
  if (!bytes) {
    await set("failed", { error: "the file is gone" });
    return "failed";
  }
  const day = today();
  if (!(await spend(v, day))) {
    await set("failed", { error: "daily limit reached" });
    await push(v, (copy) => ({ title: copy.fileLimit, body: "", click }));
    return "failed";
  }
  let input = { bytes, type: row.media_type };
  let heard: string | null = null;
  if (isAudio(row.media_type)) {
    const before = (row.reading ? JSON.parse(row.reading) : null) as { transcript?: string } | null;
    const said = before?.transcript
      ? { text: before.transcript }
      : whisper
        ? await whisper.transcribe(bytes, row.media_type)
        : { error: "no transcription server is set up" };
    if ("error" in said) {
      await set("failed", said);
      await push(v, (copy) => ({ title: copy.fileNotTranscribed, body: "", click }));
      return "failed";
    }
    heard = said.text;
    input = { bytes: new TextEncoder().encode(`A voice note, transcribed:\n\n${heard}`), type: "text/plain" };
  }
  const people = await knownPeople(d);
  const read = await model.read({ ...input, people, today: day, language: await userLanguage(v) });
  if ("error" in read) {
    await set("failed", heard ? { ...read, transcript: heard } : read);
    await push(v, (copy) => ({ title: copy.fileFailed, body: "", click }));
    return "failed";
  }
  // A voice note's transcript is Whisper's, word for word, not Claude's retelling of it.
  const suggestion = clean(heard ? { ...read, transcript: heard } : read, new Set(people.map((p) => p.id)));
  await set("pending", suggestion);
  await push(v, (copy) => ({ title: copy.fileReady, body: suggestion.summary, click }));
  return "pending";
}

// `message` is given the viewer's notification text, in their language.
async function push(v: Viewer, message: (copy: NotifyCopy) => { title: string; body: string; click?: string }): Promise<void> {
  const { webhookUrl, language } = await getSettings(v);
  if (!webhookUrl) return;
  const m = message(notifyCopy(language));
  const base = config.publicUrl();
  await sendWebhook(webhookUrl, { title: m.title, body: m.body, tags: ["paperclip"], click: base && m.click ? `${base}${m.click}` : base });
}

export type PendingCandidate = { id: string; name: string; url: string };
export type PendingFile = {
  id: string;
  status: "reading" | "pending" | "failed";
  createdAt: number;
  /** The day it was shared (YYYY-MM-DD, in the configured time zone): what it shows is dated by it, not by the day of review. */
  sharedOn: string;
  /** The file itself (sign-in required). */
  url: string;
  /** image/webp, application/pdf, text/plain, or audio/* for a voice note. */
  type: string;
  /** What Claude suggests to file; null while reading or when it failed. */
  summary: string | null;
  /** What the file says, word for word (or what a photo shows): all that is kept of it once filed. */
  transcript: string | null;
  people: Array<{ name: string; person: PendingCandidate | null; candidates: PendingCandidate[] }>;
  /** Why the pre-read failed, when it did. */
  error: string | null;
  /** The id of the share it came in with: files with the same one were shared together (null when shared alone). */
  batchId: string | null;
};

/** The viewer's own files that wait for them, newest first; files shared together sit side by side, in the order they came,
 * where the batch's newest one would be. The partner's never show. */
export async function listPending(v: Viewer): Promise<PendingFile[]> {
  const d = await scope(v);
  const all = await d
    .from("files")
    .selectAll()
    .where("user_id", "=", v.userId)
    .where("status", "in", ["reading", "pending", "failed"])
    .orderBy("created_at", "desc")
    .orderBy("id", "desc")
    .execute();
  const rows: typeof all = [];
  for (const r of all) {
    if (!r.batch_id) rows.push(r);
    else if (!rows.some((x) => x.batch_id === r.batch_id)) rows.push(...all.filter((x) => x.batch_id === r.batch_id).reverse());
  }
  const names = new Map((await d.from("persons").select(["id", "name"]).execute()).map((p) => [p.id, p.name]));
  const cand = (id: string): PendingCandidate | null => (names.has(id) ? { id, name: names.get(id)!, url: personPath(id) } : null);
  return rows.map((r) => {
    // A pre-read from before files (a social media `Reading`) has `text` where a suggestion has `summary`.
    const read = (r.reading ? JSON.parse(r.reading) : null) as (Partial<Suggestion> & { text?: string; error?: string }) | null;
    return {
      id: r.id,
      status: r.status as PendingFile["status"],
      createdAt: r.created_at,
      sharedOn: today(r.created_at),
      url: filePath(r.id),
      type: r.media_type,
      summary: read?.summary ?? read?.text ?? null,
      transcript: read?.transcript ?? read?.text ?? null,
      people: (read?.people ?? []).map((p) => ({
        name: p.name,
        person: p.personId ? cand(p.personId) : null,
        candidates: (p.candidates ?? []).map(cand).filter((c): c is PendingCandidate => c !== null),
      })),
      error: r.status === "failed" ? (read?.error ?? null) : null,
      batchId: r.batch_id,
    };
  });
}

/** How many of the viewer's files wait for them (the badge in the navigation). */
export async function pendingCount(v: Viewer): Promise<number> {
  const r = await (
    await scope(v)
  )
    .from("files")
    .select((eb) => eb.fn.countAll<number>().as("n"))
    .where("user_id", "=", v.userId)
    .where("status", "in", ["pending", "failed"])
    .executeTakeFirst();
  return Number(r?.n ?? 0);
}

export type ChatFile = { id: string; bytes: Uint8Array; type: string; summary: string | null; sharedOn: string };

/** The viewer's own waiting files among `ids`, for a chat on them, in the order given, each with its content and suggestion.
 * Any other (someone else's, or gone: filed, closed or thrown away) is left out without a word. */
export async function chatFiles(v: Viewer, ids: string[]): Promise<ChatFile[]> {
  const unique = [...new Set(ids)];
  if (!unique.length) return [];
  const rows = await (
    await scope(v)
  )
    .from("files")
    .selectAll()
    .where("id", "in", unique)
    .where("user_id", "=", v.userId)
    .where("status", "in", ["reading", "pending", "failed"])
    .execute();
  const out: ChatFile[] = [];
  for (const id of unique) {
    const row = rows.find((r) => r.id === id);
    const bytes = row ? await store().get(row.blob_key) : null;
    if (!row || !bytes) continue;
    const read = (row.reading ? JSON.parse(row.reading) : null) as { summary?: string; text?: string; transcript?: string } | null;
    const summary = read?.summary ?? read?.text ?? null;
    // Claude takes no audio: a voice note comes as its transcript, and not at all before it has one.
    if (isAudio(row.media_type)) {
      if (read?.transcript)
        out.push({
          id,
          bytes: new TextEncoder().encode(`A voice note, transcribed:\n\n${read.transcript}`),
          type: "text/plain",
          summary,
          sharedOn: today(row.created_at),
        });
      continue;
    }
    out.push({ id, bytes, type: row.media_type, summary, sharedOn: today(row.created_at) });
  }
  return out;
}

/**
 * Takes the viewer's waiting files for a conversation filed now (in `tx`): their rows go, and their transcripts come back in
 * the order given, for the conversation's transcript. The blobs are for the caller to delete once `tx` has committed.
 * NotFoundError when any isn't the viewer's own waiting file.
 */
export async function takeFiles(tx: Scope, v: Viewer, ids: string[]): Promise<{ transcripts: string[]; blobs: string[] }> {
  const unique = [...new Set(ids)];
  if (!unique.length) return { transcripts: [], blobs: [] };
  const rows = await tx
    .from("files")
    .select(["id", "reading", "blob_key"])
    .where("id", "in", unique)
    .where("user_id", "=", v.userId)
    .where("status", "in", ["reading", "pending", "failed"])
    .execute();
  if (rows.length !== unique.length) throw new NotFoundError("No such file waiting");
  await tx.delete("files").where("id", "in", unique).execute();
  const byId = new Map(rows.map((r) => [r.id, r]));
  const transcripts = unique.map((id) => {
    const read = (byId.get(id)!.reading ? JSON.parse(byId.get(id)!.reading!) : null) as { transcript?: string; summary?: string; text?: string } | null;
    return (read?.transcript ?? read?.summary ?? read?.text ?? "").trim();
  });
  return { transcripts: transcripts.filter(Boolean), blobs: rows.map((r) => r.blob_key) };
}

/**
 * Brings the user's waiting files into the viewer's book, from whichever of their books they wait in (a shared file lands in the
 * oldest), so a ramble filed in another book can take them. Files that aren't the user's waiting ones stay where they are.
 */
export async function moveFiles(v: Viewer, ids: string[]): Promise<void> {
  if (!ids.length) return;
  const all = await viewerById(v.userId);
  if (!all) return;
  await (
    await scope(all)
  )
    .update("files")
    .set({ book_id: v.bookId })
    .where("id", "in", [...new Set(ids)])
    .where("user_id", "=", v.userId)
    .where("status", "in", ["reading", "pending", "failed"])
    .execute();
}

/** Deletes blobs whose rows are gone; a failure leaves a stray blob, never a broken row. */
export async function dropBlobs(keys: string[]): Promise<void> {
  for (const k of keys)
    await store()
      .delete(k)
      .catch((e) => log.warn({ err: e }, "deleting a file's blob failed"));
}

/**
 * Of the files `ids`, those the viewer may not open although they may see a fact filed from them: another user's file that a
 * private fact was filed from too. (Only facts filed by the screenshot reading before files name a file.)
 */
export async function hiddenFiles(v: Viewer, ids: string[]): Promise<Set<string>> {
  const unique = [...new Set(ids)];
  if (!unique.length) return new Set();
  const d = await scope(v);
  const others = await d.from("files").select("id").where("id", "in", unique).where("user_id", "!=", v.userId).execute();
  if (!others.length) return new Set();
  const viaFact = await d
    .from("facts")
    .select("file_id")
    .where(
      "file_id",
      "in",
      others.map((o) => o.id),
    )
    .where("visibility", "=", "private")
    .execute();
  return new Set(viaFact.map((f) => f.file_id!));
}

async function ownPending(v: Viewer, id: string) {
  const row = await (await scope(v)).from("files").selectAll().where("id", "=", id).where("user_id", "=", v.userId).executeTakeFirst();
  if (!row || !["reading", "pending", "failed"].includes(row.status)) throw new NotFoundError("No such file waiting");
  return row;
}

/** Reads a file again whose pre-read failed. */
export async function retryFile(v: Viewer, id: string, model: FileModel): Promise<void> {
  const row = await ownPending(v, id);
  if (row.status !== "failed") throw new InvalidInputError("Only a file that couldn't be read is read again");
  await (await scope(v)).update("files").set({ status: "reading" }).where("id", "=", id).execute();
  void queueRead(v, id, model);
}

/** Closes a waiting file: worked through with nothing to file, or thrown away. Row and blob go. */
export async function discardFile(v: Viewer, id: string): Promise<void> {
  await discardFiles(v, [id]);
}

/** Closes several waiting files at once; none when any isn't the viewer's own waiting file (NotFoundError). */
export async function discardFiles(v: Viewer, ids: string[]): Promise<void> {
  const rows = await Promise.all([...new Set(ids)].map((id) => ownPending(v, id)));
  await (
    await scope(v)
  )
    .delete("files")
    .where(
      "id",
      "in",
      rows.map((r) => r.id),
    )
    .execute();
  await dropBlobs(rows.map((r) => r.blob_key));
}

/** The file, for the user who shared it, or for a viewer who may see a fact filed from it; null otherwise. */
export async function fileContent(v: Viewer, id: string): Promise<{ bytes: Uint8Array; type: string } | null> {
  const d = await scope(v);
  const row = await d.from("files").select(["user_id", "status", "blob_key", "media_type"]).where("id", "=", id).executeTakeFirst();
  if (!row) return null;
  const mine = row.user_id === v.userId;
  if (!mine && (await hiddenFiles(v, [id])).has(id)) return null;
  const viaFact =
    !mine &&
    !!(await d
      .from("facts")
      .select("id")
      .where("file_id", "=", id)
      .$call((qb) => visible(qb, v, "facts"))
      .executeTakeFirst());
  if (!mine && !viaFact) return null;
  const bytes = await store().get(row.blob_key);
  return bytes && { bytes, type: row.media_type };
}

/** Drops filed files no fact names any more (the fact was deleted, or its person), blob and row. */
export async function pruneFiles(): Promise<number> {
  let pruned = 0;
  await eachBook(async (d) => {
    const rows = await d
      .from("files")
      .select(["id", "blob_key"])
      .where("status", "=", "filed")
      .where(({ not, exists, selectFrom }) =>
        not(exists(selectFrom("facts").select("facts.id").whereRef("facts.file_id", "=", "files.id").whereRef("facts.book_id", "=", "files.book_id"))),
      )
      .execute();
    for (const r of rows) {
      await store().delete(r.blob_key);
      await d.delete("files").where("id", "=", r.id).execute();
    }
    pruned += rows.length;
  });
  return pruned;
}

// The share key: the credential of the iPhone Shortcut. It can only hand in files, nothing else, so it is no second way
// into the data (ADR 0007). Only its hash is stored; a new key replaces the old one.
const KEY_PREFIX = "fbs_";
const hashKey = (key: string) => createHash("sha256").update(key).digest("hex");

/** A new share key for the viewer; the previous one stops working. Shown once. */
export async function createShareKey(v: Viewer): Promise<string> {
  const key = KEY_PREFIX + randomBytes(32).toString("base64url");
  const hash = hashKey(key);
  await (
    await scope(v)
  ).instance
    .insert("user_settings", { user_id: v.userId, webhook_url: null, share_key_hash: hash })
    .onConflict((oc) => oc.column("user_id").doUpdateSet({ share_key_hash: hash }))
    .execute();
  return key;
}

export async function hasShareKey(v: Viewer): Promise<boolean> {
  const r = await (await scope(v)).instance.from("user_settings").select("share_key_hash").where("user_id", "=", v.userId).executeTakeFirst();
  return !!r?.share_key_hash;
}

export async function revokeShareKey(v: Viewer): Promise<void> {
  await (await scope(v)).instance.update("user_settings").set({ share_key_hash: null }).where("user_id", "=", v.userId).execute();
}

/** The user a share key belongs to, or null. */
export async function viewerFromShareKey(key: string): Promise<Viewer | null> {
  if (!key.startsWith(KEY_PREFIX)) return null;
  const r = await (await instance()).from("user_settings").select("user_id").where("share_key_hash", "=", hashKey(key)).executeTakeFirst();
  return r ? viewerById(r.user_id) : null;
}
