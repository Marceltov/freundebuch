import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { afterAll, afterEach, beforeEach, expect, test, vi } from "vitest";
import { IDENTITY_COOKIE } from "./auth/session";
import { sign } from "./auth/tokens";
import { db } from "./db";
import { createShareKey, listPending, setFileModelForTests } from "./files";
import { fileRoute, rangeOf, shareRoute } from "./share-route";
import { resetSecretForTests } from "./secret";
import { seed, type Seed } from "./testing/fixtures";

const BASE = "http://localhost:3000";
const dir = mkdtempSync(join(tmpdir(), "fb-share-"));
let s: Seed;

beforeEach(async () => {
  vi.stubEnv("FREUNDEBUCH_SECRET", "s".repeat(40));
  vi.stubEnv("DATA_DIR", dir);
  resetSecretForTests();
  s = await seed();
  // Never resolves: these tests are about the door, not the reading.
  setFileModelForTests({ read: () => new Promise(() => undefined) });
});
afterEach(() => {
  vi.unstubAllEnvs();
  resetSecretForTests();
  setFileModelForTests(null);
});
afterAll(() => rmSync(dir, { recursive: true, force: true }));

let colour = 0;
const png = async () =>
  new Uint8Array(
    await sharp({ create: { width: 30, height: 30, channels: 3, background: { r: colour++, g: 0, b: 0 } } })
      .png()
      .toBuffer(),
  );
const cookie = (uid: string) => ({ cookie: `${IDENTITY_COOKIE}=${sign("identity", { uid })}`, origin: BASE });
const share = (body: BodyInit, headers: Record<string, string>) =>
  shareRoute(new Request(`${BASE}/api/share`, { method: "POST", headers: { host: "localhost:3000", ...headers }, body }));

test("the Shortcut sends the image as the body with its share key: 202, stored as the key's user", async () => {
  const key = await createShareKey(s.a);
  const res = await share((await png()) as BodyInit, { authorization: `Bearer ${key}`, "content-type": "image/png" });
  expect(res.status).toBe(202);
  const body = await res.json();
  expect(body).toMatchObject({ status: "reading", duplicate: false, message: "Danke! freundebuch liest die Datei, sie wartet unter „Prüfen“." });
  expect((await (await db()).selectFrom("files").select("user_id").where("id", "=", body.id).executeTakeFirstOrThrow()).user_id).toBe(s.a.userId);
});

test("the share page sends a form with the cookie", async () => {
  const form = new FormData();
  form.set("image", new Blob([(await png()) as BlobPart], { type: "image/png" }), "shot.png");
  const res = await share(form, cookie(s.b.userId));
  expect(res.status).toBe(202);
});

test("no credentials, a wrong key, or a cookie without Origin: 401", async () => {
  const img = await png();
  expect((await share(img as BodyInit, { "content-type": "image/png" })).status).toBe(401);
  expect((await share(img as BodyInit, { authorization: "Bearer fbs_nope", "content-type": "image/png" })).status).toBe(401);
  expect((await share(img as BodyInit, { cookie: cookie(s.a.userId).cookie, "content-type": "image/png" })).status).toBe(401);
});

test("a PDF or a text file comes in as the body or as the form field file, and the answer links to Prüfen", async () => {
  vi.stubEnv("PUBLIC_URL", "https://f.example");
  const key = await createShareKey(s.a);
  const pdf = await share(new TextEncoder().encode("%PDF-1.4\n1 0 obj") as BodyInit, { authorization: `Bearer ${key}`, "content-type": "application/pdf" });
  expect(pdf.status).toBe(202);
  const { id, url } = await pdf.json();
  expect(url).toBe(`https://f.example/pruefen#${id}`);
  const form = new FormData();
  form.set("file", new Blob(["Patrick: Wochenende war gut"], { type: "text/plain" }), "chat.txt");
  expect((await share(form, { authorization: `Bearer ${key}` })).status).toBe(202);
  const types = await (await db()).selectFrom("files").select("media_type").orderBy("media_type").execute();
  expect(types.map((t) => t.media_type)).toEqual(["application/pdf", "text/plain"]);
});

test("not an image, PDF or text, or too large: refused, nothing stored", async () => {
  const key = await createShareKey(s.a);
  const auth = { authorization: `Bearer ${key}` };
  expect((await share(new Uint8Array([0x50, 0x4b, 3, 4, 0, 0]) as BodyInit, { ...auth, "content-type": "application/zip" })).status).toBe(400);
  expect((await share("hello", { ...auth, "content-type": "image/png" })).status).toBe(400);
  expect((await share(new Uint8Array(16 * 1024 * 1024) as BodyInit, { ...auth, "content-type": "image/png" })).status).toBe(413);
  expect(await (await db()).selectFrom("files").selectAll().execute()).toEqual([]);
});

test("without an API key there is no sharing", async () => {
  setFileModelForTests(null);
  vi.stubEnv("FREUNDEBUCH_ANTHROPIC_API_KEY", "");
  expect((await share((await png()) as BodyInit, cookie(s.a.userId))).status).toBe(404);
});

test("the image is served to its user and refused to the partner and to the signed-out", async () => {
  const key = await createShareKey(s.a);
  const { id } = await (await share((await png()) as BodyInit, { authorization: `Bearer ${key}`, "content-type": "image/png" })).json();
  const get = (headers: Record<string, string>) => fileRoute(new Request(`${BASE}/api/files/${id}`, { headers: { host: "localhost:3000", ...headers } }), id);
  const mine = await get(cookie(s.a.userId));
  expect(mine.status).toBe(200);
  expect(mine.headers.get("content-type")).toBe("image/webp");
  expect(mine.headers.get("cache-control")).toBe("private, max-age=86400");
  expect((await get(cookie(s.b.userId))).status).toBe(404);
  expect((await get({})).status).toBe(401);
  // the share key opens nothing but the door
  expect((await get({ authorization: `Bearer ${key}` })).status).toBe(401);
});

test("a text file is served as UTF-8, so umlauts show", async () => {
  const key = await createShareKey(s.a);
  const { id } = await (
    await share(new TextEncoder().encode("Grüße von Jürgen") as BodyInit, { authorization: `Bearer ${key}`, "content-type": "text/plain" })
  ).json();
  const res = await fileRoute(new Request(`${BASE}/api/files/${id}`, { headers: { host: "localhost:3000", ...cookie(s.a.userId) } }), id);
  expect(res.headers.get("content-type")).toBe("text/plain; charset=utf-8");
});

test("files sent with one batch id wait side by side, in the order they came; a malformed id is ignored", async () => {
  const key = await createShareKey(s.a);
  const send = async (batch?: string) =>
    (await (
      await share((await png()) as BodyInit, {
        authorization: `Bearer ${key}`,
        "content-type": "image/png",
        ...(batch ? { "x-freundebuch-batch": batch } : {}),
      })
    ).json()) as { id: string };
  const first = await send("run-20261030-1");
  const alone = await send();
  const second = await send("run-20261030-1");
  const third = await send("run-20261030-1");
  const odd = await send("a b c d e f g h");
  const short = await send("x");
  const list = await listPending(s.a);
  expect(list.map((f) => f.id)).toEqual([short.id, odd.id, first.id, second.id, third.id, alone.id]);
  expect(list.map((f) => f.batchId)).toEqual([null, null, "run-20261030-1", "run-20261030-1", "run-20261030-1", null]);
  expect(await listPending(s.b)).toEqual([]);
});

test("what the Shortcut shows when a file doesn't arrive is German, and says why", async () => {
  const msg = async (r: Response) => ((await r.json()) as { message: string }).message;
  const img = await png();
  expect(await msg(await share(img as BodyInit, { authorization: "Bearer fbs_nope", "content-type": "image/png" }))).toBe(
    "Der Teilen-Schlüssel stimmt nicht: erzeug in den freundebuch-Einstellungen einen neuen und trag ihn im Kurzbefehl ein.",
  );
  const auth = { authorization: `Bearer ${await createShareKey(s.a)}` };
  expect(await msg(await share(new Uint8Array(16 * 1024 * 1024) as BodyInit, { ...auth, "content-type": "image/png" }))).toBe(
    "Die Datei ist größer als 15 MB.",
  );
  expect(await msg(await share(new Uint8Array([0x50, 0x4b, 3, 4, 0, 0]) as BodyInit, { ...auth, "content-type": "application/zip" }))).toBe(
    "freundebuch nimmt Bilder, PDFs, Textdateien und Sprachnachrichten.",
  );
  expect(await msg(await share("hello", { ...auth, "content-type": "image/png" }))).toBe("Diese Datei kann freundebuch nicht lesen.");
});

test("without PUBLIC_URL the answer's url is still a whole address, from the request", async () => {
  vi.stubEnv("PUBLIC_URL", "");
  const key = await createShareKey(s.a);
  const r = await share((await png()) as BodyInit, { authorization: `Bearer ${key}`, "content-type": "image/png" });
  expect(((await r.json()) as { url: string }).url).toMatch(/^http:\/\/localhost:3000\/pruefen#/);
});

test("a file shared again with a new share joins it, so Prüfen opens on the share that was just sent", async () => {
  const key = await createShareKey(s.a);
  const bytes = await png();
  const send = async (b: Uint8Array, batch: string) =>
    (await (await share(b as BodyInit, { authorization: `Bearer ${key}`, "content-type": "image/png", "x-freundebuch-batch": batch })).json()) as {
      id: string;
      duplicate: boolean;
    };
  const old = await send(bytes, "share-old-1234");
  const fresh = await send(await png(), "share-new-1234");
  const again = await send(bytes, "share-new-1234");
  expect(again).toMatchObject({ id: old.id, duplicate: true });
  const list = await listPending(s.a);
  expect(
    list
      .filter((f) => f.batchId === "share-new-1234")
      .map((f) => f.id)
      .sort(),
  ).toEqual([fresh.id, old.id].sort());
});

test("files of one share that came in the same millisecond keep the order they came in", async () => {
  const key = await createShareKey(s.a);
  const ids: string[] = [];
  for (let i = 0; i < 6; i++)
    ids.push(
      (
        (await (
          await share((await png()) as BodyInit, { authorization: `Bearer ${key}`, "content-type": "image/png", "x-freundebuch-batch": "same-ms-1234" })
        ).json()) as { id: string }
      ).id,
    );
  await (await db()).updateTable("files").set({ created_at: 5 }).where("id", "in", ids).execute();
  expect((await listPending(s.a)).map((f) => f.id)).toEqual(ids);
});

test("a byte range of a file is served as 206, for Safari to play a voice note", async () => {
  const key = await createShareKey(s.a);
  const text = new TextEncoder().encode("0123456789");
  const { id } = await (await share(text as BodyInit, { authorization: `Bearer ${key}`, "content-type": "text/plain" })).json();
  const get = (range?: string) =>
    fileRoute(new Request(`${BASE}/api/files/${id}`, { headers: { host: "localhost:3000", ...cookie(s.a.userId), ...(range ? { range } : {}) } }), id);
  const part = await get("bytes=2-4");
  expect([part.status, part.headers.get("content-range"), await part.text()]).toEqual([206, "bytes 2-4/10", "234"]);
  expect((await get("bytes=20-")).status).toBe(416);
  const whole = await get();
  expect([whole.status, whole.headers.get("accept-ranges")]).toEqual([200, "bytes"]);
  expect(rangeOf("bytes=-3", 10)).toEqual({ start: 7, end: 9 });
  expect(rangeOf("bytes=5-", 10)).toEqual({ start: 5, end: 9 });
  expect(rangeOf("bytes=0-99", 10)).toEqual({ start: 0, end: 9 });
  expect(rangeOf("bytes=1-2,4-5", 10)).toBeNull();
});
