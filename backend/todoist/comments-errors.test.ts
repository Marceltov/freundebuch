import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeEach, expect, test, vi } from "vitest";
import { instance } from "../db/scope";
import { listPending, setFileModelForTests } from "../conversations/files";
import { seed, type Seed } from "../testing/fixtures";
import { DEFAULT_KINDS } from "./settings";
import { takeComments } from "./comments";

// inBook failing for another reason than a book that's gone (the database, say): the note is let go, so the next pull takes it.
const fail = vi.hoisted(() => ({ once: false }));
vi.mock("../people/books", async (orig) => {
  const real = await orig<typeof import("../people/books")>();
  return {
    ...real,
    inBook: async (...a: Parameters<typeof real.inBook>) => {
      if (fail.once) {
        fail.once = false;
        throw new Error("database is locked");
      }
      return real.inBook(...a);
    },
  };
});

// Shared files go to the blob store under DATA_DIR: a directory of the test's own, never /data.
const dir = mkdtempSync(join(tmpdir(), "fb-todoist-comments-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

let s: Seed;
beforeEach(async () => {
  process.env.DATA_DIR = dir;
  s = await seed();
  setFileModelForTests({ read: () => new Promise(() => undefined) });
  await (
    await instance()
  )
    .insert("todoist_connections", {
      user_id: s.a.userId,
      token: "ta",
      project_id: "p1",
      project_name: "F",
      kinds: JSON.stringify(DEFAULT_KINDS),
      broken: 0,
      created_at: 1,
    })
    .execute();
  await (
    await instance()
  )
    .insert("todoist_tasks", {
      user_id: s.a.userId,
      key: "k1",
      task_id: "t1",
      book_id: s.a.bookId,
      kind: "situation",
      item_id: null,
      person_id: s.anna,
      day: "2026-11-01",
      state: "open",
      title: "Frag Anna",
      created_at: 1,
    })
    .execute();
});
afterEach(() => setFileModelForTests(null));

test("an unexpected error placing a comment lets the note go, so the next pull takes it in", async () => {
  const notes = [{ id: "n1", itemId: "t1", postedUid: "u", postedAt: "2026-11-04T09:00:00Z", content: "Hallo", deleted: false, attachment: null }];
  fail.once = true;
  await expect(takeComments(s.a, "ta", notes, "u")).rejects.toThrow(/locked/);
  expect(await listPending(s.a)).toEqual([]);
  expect(await takeComments(s.a, "ta", notes, "u")).toBe(1);
});
