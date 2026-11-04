// Every test file keeps its data (the blob store, a database file) in a temporary directory of its own, never in the default
// DATA_DIR (/data): on a dev machine that folder can belong to other apps, and in CI it isn't writable. A test that sets its own
// DATA_DIR still may; this is set again before each test, so one that changed or deleted it doesn't leak into the next.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeEach } from "vitest";

const dir = mkdtempSync(join(tmpdir(), "freundebuch-test-"));
process.env.DATA_DIR = dir;
beforeEach(() => {
  process.env.DATA_DIR = dir;
});
afterAll(() => rmSync(dir, { recursive: true, force: true }));
