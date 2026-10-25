import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { afterAll, afterEach, beforeEach, expect, test, vi } from "vitest";
import { IDENTITY_COOKIE } from "./auth/session";
import { sign } from "./auth/tokens";
import { db } from "./db";
import { createShareKey, setScreenshotModelForTests } from "./screenshots";
import { screenshotRoute, shareRoute } from "./share-route";
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
  setScreenshotModelForTests({ read: () => new Promise(() => undefined) });
});
afterEach(() => {
  vi.unstubAllEnvs();
  resetSecretForTests();
  setScreenshotModelForTests(null);
});
afterAll(() => rmSync(dir, { recursive: true, force: true }));

let colour = 0;
const png = async () => new Uint8Array(await sharp({ create: { width: 30, height: 30, channels: 3, background: { r: colour++, g: 0, b: 0 } } }).png().toBuffer());
const cookie = (uid: string) => ({ cookie: `${IDENTITY_COOKIE}=${sign("identity", { uid })}`, origin: BASE });
const share = (body: BodyInit, headers: Record<string, string>) => shareRoute(new Request(`${BASE}/api/share`, { method: "POST", headers: { host: "localhost:3000", ...headers }, body }));

test("the Shortcut sends the image as the body with its share key: 202, stored as the key's user", async () => {
  const key = await createShareKey(s.a);
  const res = await share((await png()) as BodyInit, { authorization: `Bearer ${key}`, "content-type": "image/png" });
  expect(res.status).toBe(202);
  const body = await res.json();
  expect(body).toMatchObject({ status: "reading", duplicate: false, message: "Danke! freundebuch liest den Screenshot." });
  expect((await (await db()).selectFrom("screenshots").select("user_id").where("id", "=", body.id).executeTakeFirstOrThrow()).user_id).toBe(s.a.userId);
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

test("not an image, text, or too large: refused, nothing stored", async () => {
  const key = await createShareKey(s.a);
  const auth = { authorization: `Bearer ${key}` };
  expect((await share("hello", { ...auth, "content-type": "text/plain" })).status).toBe(400);
  expect((await share("hello", { ...auth, "content-type": "image/png" })).status).toBe(400);
  expect((await share(new Uint8Array(16 * 1024 * 1024) as BodyInit, { ...auth, "content-type": "image/png" })).status).toBe(413);
  expect(await (await db()).selectFrom("screenshots").selectAll().execute()).toEqual([]);
});

test("without an API key there is no sharing", async () => {
  setScreenshotModelForTests(null);
  vi.stubEnv("FREUNDEBUCH_ANTHROPIC_API_KEY", "");
  expect((await share((await png()) as BodyInit, cookie(s.a.userId))).status).toBe(404);
});

test("the image is served to its user and refused to the partner and to the signed-out", async () => {
  const key = await createShareKey(s.a);
  const { id } = await (await share((await png()) as BodyInit, { authorization: `Bearer ${key}`, "content-type": "image/png" })).json();
  const get = (headers: Record<string, string>) => screenshotRoute(new Request(`${BASE}/api/screenshots/${id}`, { headers: { host: "localhost:3000", ...headers } }), id);
  const mine = await get(cookie(s.a.userId));
  expect(mine.status).toBe(200);
  expect(mine.headers.get("content-type")).toBe("image/webp");
  expect(mine.headers.get("cache-control")).toBe("private, max-age=86400");
  expect((await get(cookie(s.b.userId))).status).toBe(404);
  expect((await get({})).status).toBe(401);
  // the share key opens nothing but the door
  expect((await get({ authorization: `Bearer ${key}` })).status).toBe(401);
});
