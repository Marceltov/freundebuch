// The one-off conversion of 162: an old-format database (the migrations before books) becomes one book, nothing lost, nothing
// private changing hands.
import Database from "better-sqlite3";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, test } from "vitest";
import { connect } from "../backend/db/connect";
import { closeDatabaseForTests, openDatabase } from "../backend/db";
import { viewerById } from "../backend/core/users";
import { briefing } from "../backend/reading/briefing";
import { getConversation } from "../backend/conversations/conversations";
import { MIGRATION_NAMES as OLD_MIGRATIONS, migrate as migrateOld, migrateTo } from "./fixtures/old-migrations";
import { convert } from "./convert-to-books";

const dirs: string[] = [];
afterEach(async () => {
  await closeDatabaseForTests();
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

// Alice and Bob as the old schema kept them: a shared dinner with Anna holding Alice's private fact, a ramble whose
// transcript is Alice's own, and relationships recorded in the same millisecond.
async function oldDatabase(file: string): Promise<void> {
  const k = await connect(file);
  await migrateOld(k);
  await k.destroy();
  const d = new Database(file);
  const run = (q: string, ...p: unknown[]) => d.prepare(q).run(...p);
  run("insert into users (id, oidc_sub, name, created_at) values ('ua', 'a', 'Alice', 1), ('ub', 'b', 'Bob', 2)");
  run("insert into persons (id, name, created_by, created_at) values ('pa', 'Alice', 'ua', 1), ('pb', 'Bob', 'ub', 2), ('anna', 'Anna', 'ua', 3)");
  run("update users set person_id = 'pa' where id = 'ua'");
  run("update users set person_id = 'pb' where id = 'ub'");
  const household = (d.prepare("select id from groups where household = 1").get() as { id: string }).id;
  run(
    "insert into group_members (group_id, person_id, visibility, recorded_by) values (?, 'pa', 'shared', 'ua'), (?, 'pb', 'shared', 'ub')",
    household,
    household,
  );
  run(
    "insert into rambles (id, date, transcript, transcript_private, visibility, recorded_by, created_at) values ('r1', '2026-10-20', 'Dinner with Anna, in confidence: divorce.', 1, 'shared', 'ua', 10)",
  );
  run(
    "insert into conversations (id, date, kind, summary, ramble_id, visibility, recorded_by, created_at) values ('c1', '2026-10-20', 'in_person', 'Dinner with Anna.', 'r1', 'shared', 'ua', 10)",
  );
  run("insert into participants (conversation_id, person_id) values ('c1', 'anna'), ('c1', 'pa')");
  run(
    "insert into facts (id, person_id, text, category, visibility, recorded_by, conversation_id, ramble_id, created_at) values ('f1', 'anna', 'new job', 'work', 'shared', 'ua', 'c1', 'r1', 10), ('f2', 'anna', 'divorce', 'family', 'private', 'ua', 'c1', 'r1', 10)",
  );
  run(
    "insert into relationships (id, from_id, to_id, label, inverse, visibility, recorded_by, created_at) values ('z-rel', 'anna', 'pa', 'Freundin', 'Freundin', 'shared', 'ua', 20), ('a-rel', 'anna', 'pb', 'Freundin', 'Freund', 'shared', 'ua', 20)",
  );
  d.close();
}

test("the old database becomes one book with both users as members, every row kept and nothing private shared", async () => {
  const dir = mkdtempSync(join(tmpdir(), "fb-convert-"));
  dirs.push(dir);
  const [oldFile, newFile] = [join(dir, "old.db"), join(dir, "new.db")];
  await oldDatabase(oldFile);

  const report = await convert(oldFile, newFile);
  expect(report.mismatches).toEqual([]);
  expect(report.tables.facts).toEqual({ old: 2, new: 2 });
  expect(report.tables.relationships).toEqual({ old: 2, new: 2 });

  await openDatabase(newFile);
  const [a, b] = [await viewerById("ua"), await viewerById("ub")];
  expect(a).toMatchObject({ userId: "ua", personId: "pa" });
  expect(b).toMatchObject({ userId: "ub", personId: "pb", bookId: a!.bookId });
  expect((await briefing(b!, "anna")).known.map((f) => f.text)).toEqual(["new job"]);
  expect((await briefing(a!, "anna")).known.map((f) => f.text).sort()).toEqual(["divorce", "new job"]);
  expect((await getConversation(b!, "c1")).transcript).toBeNull();
  // Relationships told in the same millisecond keep the order they were told in (z-rel first).
  const order = new Database(newFile).prepare("select id from relationships order by created_at, id").all() as { id: string }[];
  expect(order.map((r) => r.id)).toEqual(["z-rel", "a-rel"]);
});

test("an old database that isn't at the last migration before books is refused, nothing written", async () => {
  const dir = mkdtempSync(join(tmpdir(), "fb-convert-"));
  dirs.push(dir);
  const [oldFile, newFile] = [join(dir, "old.db"), join(dir, "new.db")];
  const k = await connect(oldFile);
  await migrateTo(k, OLD_MIGRATIONS[OLD_MIGRATIONS.length - 2]);
  await k.destroy();
  await expect(convert(oldFile, newFile)).rejects.toThrow(/not at the last migration before books/);
  expect(existsSync(newFile)).toBe(false);
});
