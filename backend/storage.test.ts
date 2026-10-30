import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, test } from "vitest";
import { config } from "./config";
import { fileStore, s3Store, store } from "./storage";

const S3_VARS = [
  "FREUNDEBUCH_STORAGE",
  "FREUNDEBUCH_S3_ENDPOINT",
  "FREUNDEBUCH_S3_BUCKET",
  "FREUNDEBUCH_S3_REGION",
  "FREUNDEBUCH_S3_ACCESS_KEY_ID",
  "FREUNDEBUCH_S3_SECRET_ACCESS_KEY",
  "FREUNDEBUCH_S3_PATH_STYLE",
  "DATA_DIR",
];
afterEach(() => {
  for (const k of S3_VARS) delete process.env[k];
});

const bytes = new Uint8Array([1, 2, 3]);

test("the file store keeps, returns and deletes a blob; a missing one is null", async () => {
  const dir = mkdtempSync(join(tmpdir(), "fb-store-"));
  try {
    const s = fileStore(dir);
    await s.put("screenshots/a.webp", bytes, "image/webp");
    expect(await s.get("screenshots/a.webp")).toEqual(bytes);
    await s.delete("screenshots/a.webp");
    expect(await s.get("screenshots/a.webp")).toBeNull();
    await s.delete("screenshots/a.webp"); // deleting twice is fine
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("the file store refuses a key that leaves its directory", async () => {
  const s = fileStore("/tmp/nowhere");
  await expect(s.put("../x", bytes, "image/webp")).rejects.toThrow();
});

const opts = { endpoint: "https://s3.example.com", bucket: "fb", region: "eu-central-1", accessKeyId: "AK", secretAccessKey: "SK", pathStyle: true };

test("S3 signs a PUT to endpoint/bucket/key in path style, and to bucket.endpoint/key otherwise", async () => {
  const seen: Request[] = [];
  const fetchFn = (async (r: Request) => (seen.push(r), new Response(null, { status: 200 }))) as typeof fetch;
  await s3Store(opts, fetchFn).put("screenshots/a.webp", bytes, "image/webp");
  await s3Store({ ...opts, pathStyle: false }, fetchFn).put("screenshots/a.webp", bytes, "image/webp");
  expect(seen.map((r) => [r.method, r.url])).toEqual([
    ["PUT", "https://s3.example.com/fb/screenshots/a.webp"],
    ["PUT", "https://fb.s3.example.com/screenshots/a.webp"],
  ]);
  expect(seen[0].headers.get("authorization")).toMatch(/^AWS4-HMAC-SHA256 Credential=AK\/\d{8}\/eu-central-1\/s3\/aws4_request/);
  expect(seen[0].headers.get("content-type")).toBe("image/webp");
});

test("S3 get answers null for a 404 and throws for other errors", async () => {
  const answer = (status: number) => (async () => new Response(status === 200 ? bytes : "x", { status })) as unknown as typeof fetch;
  expect(await s3Store(opts, answer(200)).get("k")).toEqual(bytes);
  expect(await s3Store(opts, answer(404)).get("k")).toBeNull();
  await expect(s3Store(opts, answer(403)).get("k")).rejects.toThrow(/403/);
  await expect(s3Store(opts, answer(500)).put("k", bytes, "image/webp")).rejects.toThrow(/500/);
});

test("config.storage is files by default and s3 with all its values; s3 without a bucket names the variable", () => {
  expect(config.storage()).toEqual({ kind: "files" });
  process.env.FREUNDEBUCH_STORAGE = "s3";
  expect(() => config.storage()).toThrow(/FREUNDEBUCH_S3_BUCKET/);
  Object.assign(process.env, {
    FREUNDEBUCH_S3_ENDPOINT: "https://s3.example.com/",
    FREUNDEBUCH_S3_BUCKET: "fb",
    FREUNDEBUCH_S3_ACCESS_KEY_ID: "AK",
    FREUNDEBUCH_S3_SECRET_ACCESS_KEY: "SK",
    FREUNDEBUCH_S3_PATH_STYLE: "1",
  });
  expect(config.storage()).toEqual({
    kind: "s3",
    endpoint: "https://s3.example.com",
    bucket: "fb",
    region: "us-east-1",
    accessKeyId: "AK",
    secretAccessKey: "SK",
    pathStyle: true,
  });
  process.env.FREUNDEBUCH_STORAGE = "ftp";
  expect(() => config.storage()).toThrow(/FREUNDEBUCH_STORAGE/);
});

test("store() follows the config", async () => {
  const dir = mkdtempSync(join(tmpdir(), "fb-store-"));
  try {
    process.env.DATA_DIR = dir;
    await store().put("screenshots/b.webp", bytes, "image/webp");
    expect(await fileStore(dir).get("screenshots/b.webp")).toEqual(bytes);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
