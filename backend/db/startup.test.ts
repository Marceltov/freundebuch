import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, test } from "vitest";
import { connect } from "./connect";
import { NEWER, migrate } from "./migrations";
import { closeDatabaseForTests, db, openDatabase } from "./index";

const dirs: string[] = [];
const dir = () => {
  const d = mkdtempSync(join(tmpdir(), "fb-start-"));
  dirs.push(d);
  return d;
};
afterEach(async () => {
  await closeDatabaseForTests();
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

test("before the server opened the database, nothing reaches it", async () => {
  await expect(db()).rejects.toThrow("database not opened");
});

test("opening an empty data directory creates the database with the baseline", async () => {
  const file = join(dir(), "freundebuch.db");
  await openDatabase(file);
  expect(await (await db()).selectFrom("books").select("id").execute()).toEqual([]);
});

test("a database from a newer freundebuch stops the start with NEWER", async () => {
  const file = join(dir(), "freundebuch.db");
  const d = await connect(file);
  await migrate(d);
  await d
    .insertInto("kysely_migration" as never)
    .values({ name: "999_future", timestamp: new Date().toISOString() } as never)
    .execute();
  await d.destroy();
  await expect(openDatabase(file)).rejects.toThrow(NEWER);
  await expect(db()).rejects.toThrow("database not opened");
});
