// Screenshots of social media posts, shared in from a phone. One goes: stored (shrunk, in the blob store) → read by Claude
// (screenshot-model.ts) → filed as a fact on the person, with where it was posted and when it happened. When Claude isn't sure
// whom it is about, or it looks sensitive, it waits on the sharing user's "Zu prüfen" page and they get a push. Pending
// screenshots belong to the user who shared them; an image is shown to anyone else only through a fact they may see.
import { createHash, randomBytes } from "node:crypto";
import sharp from "sharp";
import { config } from "./config";
import { isDay, today } from "./dates";
import type { Kysely } from "kysely";
import { db, newId, now, type Schema } from "./db";
import { InvalidInputError, NotFoundError } from "./errors";
import { logger } from "./log";
import { copy } from "./notify/copy";
import { sendWebhook } from "./notify/webhook";
import { insertAlias, insertPerson } from "./people";
import { anthropicScreenshotModel, fakeScreenshotModel, type KnownPerson, type Reading, type ScreenshotModel } from "./screenshot-model";
import { getSettings } from "./settings";
import { processState } from "./state";
import { store } from "./storage";
import { spend } from "./usage";
import { FACT_CATEGORIES, VISIBILITIES, type FactCategory, type Viewer, type Visibility } from "./types";
import { itemPath, personPath, screenshotPath } from "./urls";
import { viewerById } from "./users";
import { visible } from "./visibility";

const log = logger("screenshots");

/** The largest upload taken: a phone screenshot is a few MB. */
export const MAX_UPLOAD = 15 * 1024 * 1024;
const WIDTH = 1080;
const TYPE = "image/webp";
const keyOf = (id: string) => `screenshots/${id}.webp`;
export const PENDING_PATH = "/pruefen";

export type ScreenshotStatus = "reading" | "pending" | "filed" | "nothing" | "failed";

// The model in use: a test's stand-in, Claude with the API key, the e2e stand-in, or none (sharing is off).
const state = processState("screenshots", () => ({ override: null as ScreenshotModel | null, queue: Promise.resolve() as Promise<unknown> }));
export const setScreenshotModelForTests = (m: ScreenshotModel | null) => {
  state.override = m;
};
export function screenshotModel(): ScreenshotModel | null {
  if (state.override) return state.override;
  const key = config.anthropicKey();
  if (key) return anthropicScreenshotModel(key, config.anthropicModel());
  return config.e2e() ? fakeScreenshotModel : null;
}

/** Stores a shared image for `v` and returns its entry; the same image shared again returns the first one (`duplicate`).
 * Reading it is queued (`queueRead`); the caller doesn't wait for it. */
export async function shareScreenshot(v: Viewer, bytes: Uint8Array): Promise<{ id: string; status: ScreenshotStatus; duplicate: boolean }> {
  if (bytes.byteLength === 0) throw new InvalidInputError("The image is empty");
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const d = await db();
  const seen = await d.selectFrom("screenshots").select(["id", "status"]).where("user_id", "=", v.userId).where("sha256", "=", sha256).executeTakeFirst();
  if (seen) return { ...seen, duplicate: true };
  let small: Uint8Array;
  try {
    small = new Uint8Array(await sharp(bytes).rotate().resize({ width: WIDTH, withoutEnlargement: true }).webp({ quality: 80 }).toBuffer());
  } catch {
    throw new InvalidInputError("That is not an image freundebuch can read");
  }
  const id = newId();
  await store().put(keyOf(id), small, TYPE);
  try {
    await d.insertInto("screenshots").values({ id, user_id: v.userId, sha256, status: "reading", reading: null, created_at: now() }).execute();
  } catch (e) {
    await store().delete(keyOf(id));
    throw e;
  }
  return { id, status: "reading", duplicate: false };
}

/** Reads the screenshots one after another, so a burst of shares doesn't become a burst of requests. */
export function queueRead(id: string, model: ScreenshotModel): Promise<void> {
  const run = state.queue.then(async () => void (await readScreenshot(id, model))).catch((e) => log.error({ err: e }, "reading a screenshot failed"));
  state.queue = run;
  return run;
}

/** At start-up: reads again what a restart interrupted, and drops images no fact needs any more. */
export async function resumeReading(model: ScreenshotModel | null = screenshotModel()): Promise<void> {
  try {
    await pruneScreenshots();
    if (!model) return;
    const rows = await (await db()).selectFrom("screenshots").select("id").where("status", "=", "reading").orderBy("created_at").execute();
    for (const r of rows) void queueRead(r.id, model);
  } catch (e) {
    log.error({ err: e }, "resuming the screenshots failed");
  }
}

async function knownPeople(): Promise<KnownPerson[]> {
  const d = await db();
  const [people, aliases] = await Promise.all([d.selectFrom("persons").select(["id", "name"]).orderBy("name").execute(), d.selectFrom("aliases").select(["person_id", "alias"]).execute()]);
  return people.map((p) => ({ id: p.id, name: p.name, aliases: aliases.filter((a) => a.person_id === p.id).map((a) => a.alias) }));
}

/** Claude's answer as freundebuch takes it: a date that isn't a real past day is dropped, and a person id that doesn't exist
 * becomes a candidate list of the ids that do. */
function clean(r: Reading, known: Set<string>, day: string): Reading {
  const category: FactCategory = (FACT_CATEGORIES as readonly string[]).includes(r.category) ? r.category : "other";
  return {
    ...r,
    text: r.text.trim(),
    category,
    happenedOn: r.happenedOn && isDay(r.happenedOn) && r.happenedOn <= day ? r.happenedOn : null,
    people: r.people.map((p) => {
      const handle = p.handle ? { handle: p.handle.replace(/^@/, "") } : {};
      if (p.personId && known.has(p.personId)) return { name: p.name, ...handle, personId: p.personId };
      return { name: p.name, ...handle, candidates: [...new Set(p.candidates ?? [])].filter((c) => known.has(c)) };
    }),
  };
}

/** Sure: something happened, nothing sensitive, and every person in it is one known person. */
const sure = (r: Reading) => r.kind === "post" && !!r.text && !r.sensitive && r.people.length > 0 && r.people.every((p) => p.personId);

export async function readScreenshot(id: string, model: ScreenshotModel): Promise<ScreenshotStatus> {
  const d = await db();
  const row = await d.selectFrom("screenshots").selectAll().where("id", "=", id).executeTakeFirst();
  if (!row || row.status !== "reading") return row?.status ?? "failed";
  const v = await viewerById(row.user_id);
  const bytes = await store().get(keyOf(id));
  const set = (status: ScreenshotStatus, reading: Reading | null = null) =>
    d.updateTable("screenshots").set({ status, reading: reading && JSON.stringify(reading) }).where("id", "=", id).where("status", "=", "reading").execute();
  if (!v || !bytes) {
    await set("failed");
    return "failed";
  }
  const day = today();
  if (!(await spend(v, day))) {
    await set("failed");
    await push(v, { title: copy.shotLimit, body: "", click: PENDING_PATH });
    return "failed";
  }
  const people = await knownPeople();
  const raw = await model.read({ bytes, type: TYPE, people, today: day });
  if (!raw) {
    await set("failed");
    await push(v, { title: copy.shotFailed, body: "", click: PENDING_PATH });
    return "failed";
  }
  const reading = clean(raw, new Set(people.map((p) => p.id)), day);
  if (reading.kind === "nothing" || !reading.text) {
    await set("nothing", reading);
    await store().delete(keyOf(id));
    await push(v, { title: copy.shotNothing, body: "" });
    return "nothing";
  }
  if (!sure(reading)) {
    await set("pending", reading);
    const names = reading.people.map((p) => p.name).join(", ");
    await push(v, { title: reading.sensitive ? copy.shotSensitive : copy.shotWho, body: names ? `${names}: ${reading.text}` : reading.text, click: `${PENDING_PATH}#${id}` });
    return "pending";
  }
  await d.transaction().execute(async (tx) => {
    for (const p of reading.people) await insertFact(tx, v, id, reading, p.personId!, "shared");
    await tx.updateTable("screenshots").set({ status: "filed", reading: JSON.stringify(reading) }).where("id", "=", id).execute();
  });
  return "filed";
}

async function insertFact(tx: Kysely<Schema>, v: Viewer, shotId: string, r: Pick<Reading, "text" | "category" | "platform" | "happenedOn">, personId: string, visibility: Visibility): Promise<string> {
  const id = newId();
  await tx
    .insertInto("facts")
    .values({ id, person_id: personId, text: r.text, category: r.category, visibility, recorded_by: v.userId, conversation_id: null, created_at: now(), source: r.platform, happened_on: r.happenedOn, screenshot_id: shotId })
    .execute();
  return id;
}

async function push(v: Viewer, m: { title: string; body: string; click?: string }): Promise<void> {
  const { webhookUrl } = await getSettings(v);
  if (!webhookUrl) return;
  const base = config.publicUrl();
  await sendWebhook(webhookUrl, { title: m.title, body: m.body, tags: ["camera"], click: base && m.click ? `${base}${m.click}` : base });
}

export type PendingCandidate = { id: string; name: string; url: string };
export type PendingScreenshot = {
  id: string;
  status: "reading" | "pending" | "failed";
  createdAt: number;
  imageUrl: string;
  /** What Claude read; null while reading or when it failed. */
  reading: (Omit<Reading, "people"> & { people: Array<{ name: string; handle?: string; person: PendingCandidate | null; candidates: PendingCandidate[] }> }) | null;
};

/** The viewer's own screenshots that wait for them, newest first. The partner's never show. */
export async function listPending(v: Viewer): Promise<PendingScreenshot[]> {
  const d = await db();
  const rows = await d.selectFrom("screenshots").selectAll().where("user_id", "=", v.userId).where("status", "in", ["reading", "pending", "failed"]).orderBy("created_at", "desc").execute();
  const names = new Map((await d.selectFrom("persons").select(["id", "name"]).execute()).map((p) => [p.id, p.name]));
  const cand = (id: string): PendingCandidate | null => (names.has(id) ? { id, name: names.get(id)!, url: personPath(id) } : null);
  return rows.map((r) => {
    const reading = r.reading ? (JSON.parse(r.reading) as Reading) : null;
    return {
      id: r.id,
      status: r.status as PendingScreenshot["status"],
      createdAt: r.created_at,
      imageUrl: screenshotPath(r.id),
      reading: reading && {
        ...reading,
        people: reading.people.map((p) => ({
          name: p.name,
          ...(p.handle ? { handle: p.handle } : {}),
          person: p.personId ? cand(p.personId) : null,
          candidates: (p.candidates ?? []).map(cand).filter((c): c is PendingCandidate => c !== null),
        })),
      },
    };
  });
}

/** How many of the viewer's screenshots wait for them (the badge in the navigation). */
export async function pendingCount(v: Viewer): Promise<number> {
  const r = await (await db()).selectFrom("screenshots").select((eb) => eb.fn.countAll<number>().as("n")).where("user_id", "=", v.userId).where("status", "in", ["pending", "failed"]).executeTakeFirst();
  return Number(r?.n ?? 0);
}

async function ownPending(v: Viewer, id: string) {
  const row = await (await db()).selectFrom("screenshots").selectAll().where("id", "=", id).where("user_id", "=", v.userId).executeTakeFirst();
  if (!row || !["reading", "pending", "failed"].includes(row.status)) throw new NotFoundError("No such screenshot waiting");
  return row;
}

export type Resolution = {
  /** An existing person, or `name` for a new one. */
  personId?: string;
  name?: string;
  /** Replaces what Claude read. */
  text?: string;
  visibility?: Visibility;
};

/** Files a waiting screenshot on the person the viewer picked. The handle Claude read becomes one of their other names, so the
 * next post of theirs is filed without asking. */
export async function resolveScreenshot(v: Viewer, id: string, r: Resolution): Promise<{ factId: string; personId: string; url: string }> {
  const row = await ownPending(v, id);
  if (row.status !== "pending" || !row.reading) throw new InvalidInputError("This screenshot hasn't been read yet");
  if (!r.personId === !r.name?.trim()) throw new InvalidInputError("Give either personId or name");
  const visibility = r.visibility ?? "shared";
  if (!(VISIBILITIES as readonly string[]).includes(visibility)) throw new InvalidInputError("visibility must be shared or private");
  const reading = JSON.parse(row.reading) as Reading;
  const text = r.text?.trim() || reading.text;
  if (!text) throw new InvalidInputError("Give the text to file");
  const d = await db();
  return d.transaction().execute(async (tx) => {
    let personId = r.personId;
    let name: string;
    if (personId) {
      const p = await tx.selectFrom("persons").select("name").where("id", "=", personId).executeTakeFirst();
      if (!p) throw new NotFoundError("No such person");
      name = p.name;
    } else {
      name = r.name!.trim();
      personId = await insertPerson(tx, v, { name });
    }
    // The handle of the one person Claude couldn't place; with several unplaced, which handle is whose is unknown.
    const open = reading.people.filter((p) => !p.personId);
    if (open.length === 1 && open[0].handle) await insertAlias(tx, personId, name, open[0].handle);
    const factId = await insertFact(tx, v, id, { ...reading, text }, personId, visibility);
    await tx.updateTable("screenshots").set({ status: "filed" }).where("id", "=", id).execute();
    return { factId, personId, url: itemPath(personPath(personId), "facts", factId) };
  });
}

/** Reads a screenshot again that failed. */
export async function retryScreenshot(v: Viewer, id: string, model: ScreenshotModel): Promise<void> {
  const row = await ownPending(v, id);
  if (row.status !== "failed") throw new InvalidInputError("Only a screenshot that couldn't be read is read again");
  await (await db()).updateTable("screenshots").set({ status: "reading" }).where("id", "=", id).execute();
  void queueRead(id, model);
}

/** Throws a waiting screenshot away, image and all. */
export async function discardScreenshot(v: Viewer, id: string): Promise<void> {
  await ownPending(v, id);
  await (await db()).deleteFrom("screenshots").where("id", "=", id).execute();
  await store().delete(keyOf(id));
}

/** The image, for the user who shared it or for a viewer who may see a fact filed from it; null otherwise. */
export async function screenshotImage(v: Viewer, id: string): Promise<{ bytes: Uint8Array; type: string } | null> {
  const d = await db();
  const row = await d.selectFrom("screenshots").select(["user_id", "status"]).where("id", "=", id).executeTakeFirst();
  if (!row) return null;
  const mine = row.user_id === v.userId;
  const viaFact = !mine && !!(await d.selectFrom("facts").select("id").where("screenshot_id", "=", id).$call((qb) => visible(qb, v, "facts")).executeTakeFirst());
  if (!mine && !viaFact) return null;
  const bytes = await store().get(keyOf(id));
  return bytes && { bytes, type: TYPE };
}

/** Drops filed screenshots no fact names any more (the fact was deleted, or its person), image and row. */
export async function pruneScreenshots(): Promise<number> {
  const d = await db();
  const rows = await d
    .selectFrom("screenshots")
    .select("id")
    .where("status", "=", "filed")
    .where(({ not, exists, selectFrom }) => not(exists(selectFrom("facts").select("facts.id").whereRef("facts.screenshot_id", "=", "screenshots.id"))))
    .execute();
  for (const r of rows) {
    await store().delete(keyOf(r.id));
    await d.deleteFrom("screenshots").where("id", "=", r.id).execute();
  }
  return rows.length;
}

// The share key: the credential of the iPhone Shortcut. It can only hand in screenshots, nothing else, so it is no second way
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
