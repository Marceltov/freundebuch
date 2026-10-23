import { Kysely, SqliteDialect, sql } from "kysely";
import Database from "better-sqlite3";
import { beforeEach, expect, test } from "vitest";
import { MIGRATION_NAMES, NEWER, migrate } from "./migrations";
import { db, newId, now, resetDbForTests } from "./index";

const fresh = () => new Kysely<any>({ dialect: new SqliteDialect({ database: new Database(":memory:") }) }); // eslint-disable-line @typescript-eslint/no-explicit-any

test("migrate on a fresh database records every migration", async () => {
  const d = fresh();
  await migrate(d);
  const rows = await d.selectFrom("kysely_migration").select("name").orderBy("name").execute();
  expect(rows.map((r) => r.name)).toEqual([...MIGRATION_NAMES]);
});

test("running it twice is a no-op", async () => {
  const d = fresh();
  await migrate(d);
  await migrate(d);
  const rows = await d.selectFrom("kysely_migration").select("name").execute();
  expect(rows).toHaveLength(MIGRATION_NAMES.length);
});

test("a database with an unknown migration throws NEWER", async () => {
  const d = fresh();
  await migrate(d);
  await sql`insert into kysely_migration (name, timestamp) values ('999_from_the_future', 'x')`.execute(d);
  await expect(migrate(d)).rejects.toThrow(NEWER);
});

beforeEach(() => resetDbForTests());

test("foreign keys are on", async () => {
  const d = await db();
  const { rows } = await sql<{ foreign_keys: number }>`pragma foreign_keys`.execute(d);
  expect(rows[0].foreign_keys).toBe(1);
});

test("deleting a person cascades to its facts", async () => {
  const d = await db();
  const t = now();
  const user = newId();
  const person = newId();
  await d.insertInto("users").values({ id: user, oidc_sub: "s", name: "Me", email: null, person_id: null, created_at: t }).execute();
  await d.insertInto("persons").values({ id: person, name: "Anna", created_by: user, created_from: null, created_at: t }).execute();
  await d.insertInto("facts").values({ id: newId(), person_id: person, text: "likes tea", category: "taste", status: "current", visibility: "private", recorded_by: user, conversation_id: null, created_at: t }).execute();
  await d.deleteFrom("persons").where("id", "=", person).execute();
  expect(await d.selectFrom("facts").selectAll().execute()).toEqual([]);
});

test("items may have no conversation, and deleting a conversation cascades to its items", async () => {
  const d = await db();
  const t = now();
  const user = newId();
  const person = newId();
  const conv = newId();
  await d.insertInto("users").values({ id: user, oidc_sub: "s", name: "Me", email: null, person_id: null, created_at: t }).execute();
  await d.insertInto("persons").values({ id: person, name: "Anna", created_by: user, created_from: null, created_at: t }).execute();
  await d.insertInto("conversations").values({ id: conv, date: "2026-01-01", kind: "meeting", place: null, summary: "", transcript: "", transcript_private: 0, visibility: "private", recorded_by: user, created_at: t }).execute();
  const base = { person_id: person, visibility: "private", recorded_by: user, created_at: t };
  await d.insertInto("facts").values([{ ...base, id: newId(), text: "a", category: "c", status: "current", conversation_id: conv }, { ...base, id: newId(), text: "b", category: "c", status: "current", conversation_id: null }]).execute();
  await d.deleteFrom("conversations").where("id", "=", conv).execute();
  expect((await d.selectFrom("facts").select("text").execute()).map((r) => r.text)).toEqual(["b"]);
});
