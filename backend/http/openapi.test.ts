import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, test } from "vitest";
import { openApiDocument } from "./api";

// The committed description. `npm run generate` rewrites it (UPDATE_OPENAPI=1); CI fails when it's stale.
const FILE = join(import.meta.dirname, "../../openapi.json");
const URL = "https://freundebuch.example";
const generated = () => JSON.stringify(openApiDocument(URL), null, 2) + "\n";

test("openapi.json is up to date with the route table", async () => {
  if (process.env.UPDATE_OPENAPI === "1") await writeFile(FILE, generated());
  expect(await readFile(FILE, "utf8").catch(() => "missing")).toBe(generated());
});

test("every $ref points at a component", () => {
  const doc = openApiDocument(URL);
  const refs = [...JSON.stringify(doc).matchAll(/"\$ref":"#\/components\/schemas\/([^"]+)"/g)].map((m) => m[1]);
  expect(refs.length).toBeGreaterThan(0);
  for (const r of refs) expect((doc.components as { schemas: object }).schemas).toHaveProperty(r);
});

test("operation ids are unique and every operation needs a sign-in", () => {
  const doc = openApiDocument(URL) as { paths: Record<string, Record<string, { operationId: string; security: unknown[] }>> };
  const ops = Object.values(doc.paths).flatMap((item) => Object.values(item));
  expect(new Set(ops.map((o) => o.operationId)).size).toBe(ops.length);
  for (const o of ops) expect(o.security).toEqual([{ bearer: [] }, { cookie: [] }]);
});
