// Files shared into freundebuch (a screenshot, a photo, a PDF, a text such as a chat export), from the phone or from Erzählen.
// One goes: stored (images shrunk to WebP, the rest as it came, in the blob store) → pre-read by Claude (file-model.ts) into a
// suggestion → waits under "Prüfen" until the user works it through with Claude (Erzählen opened on it, or the MCP tool inbox),
// which files with the usual tools and links the facts to it (`file_id`), then marks it done. Nothing is filed unattended.
// Waiting files belong to the user who shared them; a file is shown to anyone else only through a fact they may see.
import { createHash, randomBytes } from "node:crypto";
import sharp from "sharp";
import { config } from "./config";
import { today } from "./dates";
import type { Kysely } from "kysely";
import { db, newId, now, type Schema } from "./db";
import { InvalidInputError, NotFoundError } from "./errors";
import { logger } from "./log";
import { copy } from "./notify/copy";
import { sendWebhook } from "./notify/webhook";
import { anthropicFileModel, fakeFileModel, type FileModel, type KnownPerson, type Suggestion } from "./file-model";
import { getSettings } from "./settings";
import { processState } from "./state";
import { store } from "./storage";
import { spend } from "./usage";
import type { Viewer } from "./types";
import { filePath, personPath } from "./urls";
import { viewerById } from "./users";
import { visible } from "./visibility";

const log = logger("files");

/** The largest upload taken: a phone screenshot or a letter as PDF is a few MB. */
export const MAX_UPLOAD = 15 * 1024 * 1024;
const WIDTH = 1080;
/** Images are stored shrunk, as WebP; PDFs and text as they came. */
const EXT: Record<string, string> = { "image/webp": "webp", "application/pdf": "pdf", "text/plain": "txt" };
const NOT_TAKEN = "freundebuch takes images, PDFs and text files";
/** The longest text file taken: about 250,000 tokens, which Claude reads whole in one request. */
export const MAX_TEXT = 1024 * 1024;
export const PENDING_PATH = "/pruefen";

export type FileStatus = "reading" | "pending" | "filed" | "failed";

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
function kindOf(bytes: Uint8Array, sent: string): "pdf" | "text" | "image" | null {
  const type = sent.split(";")[0].trim().toLowerCase();
  if (type === "application/pdf") return "pdf";
  if (type.startsWith("text/")) return "text";
  if (type.startsWith("image/")) return "image";
  if (type && type !== "application/octet-stream") return null;
  if (new TextDecoder().decode(bytes.subarray(0, 5)) === "%PDF-") return "pdf";
  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    if (!text.includes("\0")) return "text";
  } catch {}
  return "image";
}

/** An iPhone photo in HEIC/HEIF, by its type or its `ftyp` box; the bundled image library doesn't decode it. */
const isHeic = (bytes: Uint8Array, type: string) =>
  /^image\/hei[cf]/.test(type) || /^ftyp(heic|heix|hevc|mif1|msf1)$/.test(new TextDecoder().decode(bytes.subarray(4, 12)));

/** Stores a file `v` shared and returns its entry; the same bytes shared again return the first one (`duplicate`). `type` is
 * what it was sent as ("" when unknown). Reading it is queued (`queueRead`); the caller doesn't wait for it. */
export async function shareFile(v: Viewer, bytes: Uint8Array, type = ""): Promise<{ id: string; status: FileStatus; duplicate: boolean }> {
  if (bytes.byteLength === 0) throw new InvalidInputError("The file is empty");
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const d = await db();
  const seen = await d.selectFrom("files").select(["id", "status"]).where("user_id", "=", v.userId).where("sha256", "=", sha256).executeTakeFirst();
  // An old pre-read that found "nothing" dropped its blob and filed nothing: sharing it again starts afresh.
  if (seen?.status === "nothing") await d.deleteFrom("files").where("id", "=", seen.id).execute();
  else if (seen) return { id: seen.id, status: seen.status, duplicate: true };
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
    try {
      stored = new Uint8Array(await sharp(bytes).rotate().resize({ width: WIDTH, withoutEnlargement: true }).webp({ quality: 80 }).toBuffer());
    } catch {
      if (isHeic(bytes, type)) throw new InvalidInputError("iPhone photos in HEIC can't be read yet: share them as JPEG (in the Shortcut: Bild konvertieren, JPEG)");
      throw new InvalidInputError(type.startsWith("image/") ? "That is not an image freundebuch can read" : NOT_TAKEN);
    }
    mediaType = "image/webp";
  } else throw new InvalidInputError(NOT_TAKEN);
  const id = newId();
  const key = `files/${id}.${EXT[mediaType]}`;
  await store().put(key, stored, mediaType);
  try {
    await d.insertInto("files").values({ id, user_id: v.userId, sha256, status: "reading", reading: null, created_at: now(), media_type: mediaType, blob_key: key }).execute();
  } catch (e) {
    await store().delete(key);
    throw e;
  }
  return { id, status: "reading", duplicate: false };
}

/** Reads the files one after another, so a burst of shares doesn't become a burst of requests. */
export function queueRead(id: string, model: FileModel): Promise<void> {
  const run = state.queue.then(async () => void (await readFile(id, model))).catch((e) => log.error({ err: e }, "reading a file failed"));
  state.queue = run;
  return run;
}

/** At start-up: reads again what a restart interrupted, and drops images no fact needs any more. */
export async function resumeReading(model: FileModel | null = fileModel()): Promise<void> {
  try {
    await pruneFiles();
    if (!model) return;
    const rows = await (await db()).selectFrom("files").select("id").where("status", "=", "reading").orderBy("created_at").execute();
    for (const r of rows) void queueRead(r.id, model);
  } catch (e) {
    log.error({ err: e }, "resuming the files failed");
  }
}

async function knownPeople(): Promise<KnownPerson[]> {
  const d = await db();
  const [people, aliases] = await Promise.all([d.selectFrom("persons").select(["id", "name"]).orderBy("name").execute(), d.selectFrom("aliases").select(["person_id", "alias"]).execute()]);
  return people.map((p) => ({ id: p.id, name: p.name, aliases: aliases.filter((a) => a.person_id === p.id).map((a) => a.alias) }));
}

/** Claude's suggestion as freundebuch keeps it: a person id that doesn't exist becomes a candidate list of the ids that do. */
function clean(r: Suggestion, known: Set<string>): Suggestion {
  return {
    summary: r.summary.trim(),
    people: r.people.map((p) =>
      p.personId && known.has(p.personId) ? { name: p.name, personId: p.personId } : { name: p.name, candidates: [...new Set(p.candidates ?? [])].filter((c) => known.has(c)) },
    ),
  };
}

/** Pre-reads a file: its suggestion (`pending`), or why not (`failed`). Either way the user hears of it and it waits. */
export async function readFile(id: string, model: FileModel): Promise<FileStatus> {
  const d = await db();
  const row = await d.selectFrom("files").selectAll().where("id", "=", id).executeTakeFirst();
  if (!row || row.status !== "reading") return row && row.status !== "nothing" ? row.status : "failed";
  const v = await viewerById(row.user_id);
  const bytes = await store().get(row.blob_key);
  const set = (status: FileStatus, reading: Suggestion | { error: string }) =>
    d.updateTable("files").set({ status, reading: JSON.stringify(reading) }).where("id", "=", id).where("status", "=", "reading").execute();
  const click = `${PENDING_PATH}#${id}`;
  if (!v || !bytes) {
    await set("failed", { error: "the file is gone" });
    return "failed";
  }
  const day = today();
  if (!(await spend(v, day))) {
    await set("failed", { error: "daily limit reached" });
    await push(v, { title: copy.fileLimit, body: "", click });
    return "failed";
  }
  const people = await knownPeople();
  const read = await model.read({ bytes, type: row.media_type, people, today: day });
  if ("error" in read) {
    await set("failed", read);
    await push(v, { title: copy.fileFailed, body: "", click });
    return "failed";
  }
  const suggestion = clean(read, new Set(people.map((p) => p.id)));
  await set("pending", suggestion);
  await push(v, { title: copy.fileReady, body: suggestion.summary, click });
  return "pending";
}

async function push(v: Viewer, m: { title: string; body: string; click?: string }): Promise<void> {
  const { webhookUrl } = await getSettings(v);
  if (!webhookUrl) return;
  const base = config.publicUrl();
  await sendWebhook(webhookUrl, { title: m.title, body: m.body, tags: ["paperclip"], click: base && m.click ? `${base}${m.click}` : base });
}

export type PendingCandidate = { id: string; name: string; url: string };
export type PendingFile = {
  id: string;
  status: "reading" | "pending" | "failed";
  createdAt: number;
  /** The file itself (sign-in required). */
  url: string;
  /** image/webp, application/pdf or text/plain. */
  type: string;
  /** What Claude suggests to file; null while reading or when it failed. */
  summary: string | null;
  people: Array<{ name: string; person: PendingCandidate | null; candidates: PendingCandidate[] }>;
  /** Why the pre-read failed, when it did. */
  error: string | null;
};

/** The viewer's own files that wait for them, newest first. The partner's never show. */
export async function listPending(v: Viewer): Promise<PendingFile[]> {
  const d = await db();
  const rows = await d.selectFrom("files").selectAll().where("user_id", "=", v.userId).where("status", "in", ["reading", "pending", "failed"]).orderBy("created_at", "desc").execute();
  const names = new Map((await d.selectFrom("persons").select(["id", "name"]).execute()).map((p) => [p.id, p.name]));
  const cand = (id: string): PendingCandidate | null => (names.has(id) ? { id, name: names.get(id)! , url: personPath(id) } : null);
  return rows.map((r) => {
    // A pre-read from before files (a social media `Reading`) has `text` where a suggestion has `summary`.
    const read = (r.reading ? JSON.parse(r.reading) : null) as (Partial<Suggestion> & { text?: string; error?: string }) | null;
    return {
      id: r.id,
      status: r.status as PendingFile["status"],
      createdAt: r.created_at,
      url: filePath(r.id),
      type: r.media_type,
      summary: read?.summary ?? read?.text ?? null,
      people: (read?.people ?? []).map((p) => ({
        name: p.name,
        person: p.personId ? cand(p.personId) : null,
        candidates: (p.candidates ?? []).map(cand).filter((c): c is PendingCandidate => c !== null),
      })),
      error: r.status === "failed" ? (read?.error ?? null) : null,
    };
  });
}

/** How many of the viewer's files wait for them (the badge in the navigation). */
export async function pendingCount(v: Viewer): Promise<number> {
  const r = await (await db()).selectFrom("files").select((eb) => eb.fn.countAll<number>().as("n")).where("user_id", "=", v.userId).where("status", "in", ["pending", "failed"]).executeTakeFirst();
  return Number(r?.n ?? 0);
}

/** The viewer's own file for a chat on it, waiting or already filed, with its content and suggestion; NotFoundError for any
 * other (someone else's, thrown away, or gone). */
export async function chatFile(v: Viewer, id: string): Promise<{ id: string; bytes: Uint8Array; type: string; summary: string | null; filed: boolean }> {
  const row = await (await db()).selectFrom("files").selectAll().where("id", "=", id).where("user_id", "=", v.userId).executeTakeFirst();
  const bytes = row && row.status !== "nothing" ? await store().get(row.blob_key) : null;
  if (!row || !bytes) throw new NotFoundError("No such file");
  const read = (row.reading ? JSON.parse(row.reading) : null) as { summary?: string; text?: string } | null;
  return { id, bytes, type: row.media_type, summary: read?.summary ?? read?.text ?? null, filed: row.status === "filed" };
}

/** Marks the viewer's waiting file done: worked through and filed, so it leaves Prüfen. Its blob stays while a fact names it. */
export async function markFiled(v: Viewer, id: string): Promise<void> {
  await ownPending(v, id);
  await (await db()).updateTable("files").set({ status: "filed" }).where("id", "=", id).execute();
}

/** Takes the viewer's waiting files for what is filed now (in `tx`): they are done, and `conversationId` links them to the
 * conversation filed with them. NotFoundError when any isn't the viewer's own waiting file. */
export async function claimFiles(tx: Kysely<Schema>, v: Viewer, ids: string[], conversationId: string | null): Promise<void> {
  const unique = [...new Set(ids)];
  if (!unique.length) return;
  const rows = await tx.selectFrom("files").select("id").where("id", "in", unique).where("user_id", "=", v.userId).where("status", "in", ["reading", "pending", "failed"]).execute();
  if (rows.length !== unique.length) throw new NotFoundError("No such file waiting");
  await tx.updateTable("files").set({ status: "filed", conversation_id: conversationId }).where("id", "in", unique).execute();
}

/**
 * Of the files `ids`, those the viewer may not open although they may see something filed from them: another user's file that
 * was filed together with anything private (a private fact from it, or a conversation whose transcript is private because
 * something recorded with it is). Such a file is evidence of that private item, so it stays its recorder's.
 */
export async function hiddenFiles(v: Viewer, ids: string[]): Promise<Set<string>> {
  const unique = [...new Set(ids)];
  if (!unique.length) return new Set();
  const d = await db();
  const others = await d.selectFrom("files").select(["id", "conversation_id"]).where("id", "in", unique).where("user_id", "!=", v.userId).execute();
  if (!others.length) return new Set();
  const viaFact = await d.selectFrom("facts").select("file_id").where("file_id", "in", others.map((o) => o.id)).where("visibility", "=", "private").execute();
  const convs = others.map((o) => o.conversation_id).filter((c): c is string => !!c);
  const privateConvs = convs.length ? await d.selectFrom("conversations").select("id").where("id", "in", convs).where("transcript_private", "=", 1).execute() : [];
  const hidden = new Set(viaFact.map((f) => f.file_id!));
  for (const o of others) if (o.conversation_id && privateConvs.some((c) => c.id === o.conversation_id)) hidden.add(o.id);
  return hidden;
}

export type ConversationFile = { id: string; url: string; type: string };

/** The files a conversation was filed with, oldest first, that the viewer may open. The caller has checked they may see the
 * conversation. */
export async function filesOf(v: Viewer, conversationId: string): Promise<ConversationFile[]> {
  const rows = await (await db()).selectFrom("files").select(["id", "media_type"]).where("conversation_id", "=", conversationId).orderBy("created_at").execute();
  const hidden = await hiddenFiles(v, rows.map((r) => r.id));
  return rows.filter((r) => !hidden.has(r.id)).map((r) => ({ id: r.id, url: filePath(r.id), type: r.media_type }));
}

async function ownPending(v: Viewer, id: string) {
  const row = await (await db()).selectFrom("files").selectAll().where("id", "=", id).where("user_id", "=", v.userId).executeTakeFirst();
  if (!row || !["reading", "pending", "failed"].includes(row.status)) throw new NotFoundError("No such file waiting");
  return row;
}

/** Reads a file again whose pre-read failed. */
export async function retryFile(v: Viewer, id: string, model: FileModel): Promise<void> {
  const row = await ownPending(v, id);
  if (row.status !== "failed") throw new InvalidInputError("Only a file that couldn't be read is read again");
  await (await db()).updateTable("files").set({ status: "reading" }).where("id", "=", id).execute();
  void queueRead(id, model);
}

/** Throws a waiting file away, blob and all. */
export async function discardFile(v: Viewer, id: string): Promise<void> {
  const row = await ownPending(v, id);
  await (await db()).deleteFrom("files").where("id", "=", id).execute();
  await store().delete(row.blob_key);
}

/** The file, for the user who shared it, or for a viewer who may see a fact or the conversation filed from it; null otherwise. */
export async function fileContent(v: Viewer, id: string): Promise<{ bytes: Uint8Array; type: string } | null> {
  const d = await db();
  const row = await d.selectFrom("files").select(["user_id", "status", "blob_key", "media_type", "conversation_id"]).where("id", "=", id).executeTakeFirst();
  if (!row) return null;
  const mine = row.user_id === v.userId;
  if (!mine && (await hiddenFiles(v, [id])).has(id)) return null;
  const viaFact = !mine && !!(await d.selectFrom("facts").select("id").where("file_id", "=", id).$call((qb) => visible(qb, v, "facts")).executeTakeFirst());
  const viaConversation =
    !mine && !viaFact && !!row.conversation_id && !!(await d.selectFrom("conversations").select("id").where("id", "=", row.conversation_id).$call((qb) => visible(qb, v, "conversations")).executeTakeFirst());
  if (!mine && !viaFact && !viaConversation) return null;
  const bytes = await store().get(row.blob_key);
  return bytes && { bytes, type: row.media_type };
}

/** Drops filed files nothing names any more (no fact, no conversation: they were deleted), blob and row. */
export async function pruneFiles(): Promise<number> {
  const d = await db();
  const rows = await d
    .selectFrom("files")
    .select(["id", "blob_key"])
    .where("status", "=", "filed")
    .where("conversation_id", "is", null)
    .where(({ not, exists, selectFrom }) => not(exists(selectFrom("facts").select("facts.id").whereRef("facts.file_id", "=", "files.id"))))
    .execute();
  for (const r of rows) {
    await store().delete(r.blob_key);
    await d.deleteFrom("files").where("id", "=", r.id).execute();
  }
  return rows.length;
}

// The share key: the credential of the iPhone Shortcut. It can only hand in files, nothing else, so it is no second way
// into the data (ADR 0007). Only its hash is stored; a new key replaces the old one.
const KEY_PREFIX = "fbs_";
const hashKey = (key: string) => createHash("sha256").update(key).digest("hex");

/** A new share key for the viewer; the previous one stops working. Shown once. */
export async function createShareKey(v: Viewer): Promise<string> {
  const key = KEY_PREFIX + randomBytes(32).toString("base64url");
  const hash = hashKey(key);
  await (await db())
    .insertInto("user_settings")
    .values({ user_id: v.userId, webhook_url: null, share_key_hash: hash })
    .onConflict((oc) => oc.column("user_id").doUpdateSet({ share_key_hash: hash }))
    .execute();
  return key;
}

export async function hasShareKey(v: Viewer): Promise<boolean> {
  const r = await (await db()).selectFrom("user_settings").select("share_key_hash").where("user_id", "=", v.userId).executeTakeFirst();
  return !!r?.share_key_hash;
}

export async function revokeShareKey(v: Viewer): Promise<void> {
  await (await db()).updateTable("user_settings").set({ share_key_hash: null }).where("user_id", "=", v.userId).execute();
}

/** The user a share key belongs to, or null. */
export async function viewerFromShareKey(key: string): Promise<Viewer | null> {
  if (!key.startsWith(KEY_PREFIX)) return null;
  const r = await (await db()).selectFrom("user_settings").select("user_id").where("share_key_hash", "=", hashKey(key)).executeTakeFirst();
  return r ? viewerById(r.user_id) : null;
}
