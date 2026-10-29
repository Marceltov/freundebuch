import { Kysely, SqliteDialect, sql } from "kysely";
import Database from "better-sqlite3";
import { beforeEach, expect, test } from "vitest";
import { MIGRATION_NAMES, NEWER, migrate, migrateTo } from "./migrations";
import { CONVERSATION_KINDS, EXCHANGE_KINDS } from "../types";
import { db, newId, now, resetDbForTests } from "./index";

// A ramble for a conversation inserted by hand, returning its id.
const ramble = async (d: { insertInto: (t: "rambles") => any }, id: string, by: string) => ( // eslint-disable-line @typescript-eslint/no-explicit-any
  await d.insertInto("rambles").values({ id, date: "2026-01-01", transcript: "", transcript_private: 0, visibility: "shared", recorded_by: by, created_at: 0 }).execute(), id
);

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
  await d.insertInto("conversations").values({ id: conv, date: "2026-01-01", kind: "in_person", summary: "", ramble_id: await ramble(d, conv, user), visibility: "private", recorded_by: user, created_at: t }).execute();
  const base = { person_id: person, visibility: "private", recorded_by: user, created_at: t };
  await d.insertInto("facts").values([{ ...base, id: newId(), text: "a", category: "c", status: "current", conversation_id: conv }, { ...base, id: newId(), text: "b", category: "c", status: "current", conversation_id: null }]).execute();
  await d.deleteFrom("conversations").where("id", "=", conv).execute();
  expect((await d.selectFrom("facts").select("text").execute()).map((r) => r.text)).toEqual(["b"]);
});

// The vocabularies are checked by the database too, so a write path that forgets oneOf() still can't store a bad value.
test("CHECK constraints refuse values outside the vocabularies", async () => {
  const d = await db();
  const t = now();
  const user = newId();
  const person = newId();
  const conv = newId();
  await d.insertInto("users").values({ id: user, oidc_sub: "s", name: "Me", email: null, person_id: null, created_at: t }).execute();
  await d.insertInto("persons").values({ id: person, name: "Anna", created_by: user, created_from: null, created_at: t }).execute();
  const conversation = { id: conv, date: "2026-01-01", kind: "call", summary: "", ramble_id: await ramble(d, conv, user), visibility: "shared", recorded_by: user, created_at: t };
  const base = { person_id: person, visibility: "shared", recorded_by: user, conversation_id: null, created_at: t };
  const fact = { ...base, text: "a", category: "work", status: "current" as const };
  const promise = { ...base, text: "a", by_me: 1 };
  const date = { ...base, kind: "birthday" as const, date: "--01-01", label: null, yearly: 1 };
  const exchange = { ...base, kind: "gift", direction: "to_them" as const, text: "a", amount: null, currency: null };
  const rel = { from_id: person, to_id: person, label: "Freundin", inverse: "Freundin", note: null, visibility: "shared", recorded_by: user, conversation_id: null, created_at: t };
  const bad: Array<[string, () => Promise<unknown>]> = [
    ["conversations.visibility", () => d.insertInto("conversations").values({ ...conversation, id: newId(), visibility: "secret" }).execute()],
    ["conversations.kind", () => d.insertInto("conversations").values({ ...conversation, id: newId(), kind: "meeting" }).execute()],
    ["facts.visibility", () => d.insertInto("facts").values({ ...fact, id: newId(), visibility: "Private" }).execute()],
    ["facts.status", () => d.insertInto("facts").values({ ...fact, id: newId(), status: "old" as "current" }).execute()],
    ["promises.visibility", () => d.insertInto("promises").values({ ...promise, id: newId(), visibility: "" }).execute()],
    ["dates.visibility", () => d.insertInto("dates").values({ ...date, id: newId(), visibility: "x" }).execute()],
    ["dates.kind", () => d.insertInto("dates").values({ ...date, id: newId(), kind: "nameday" as "custom" }).execute()],
    ["exchanges.visibility", () => d.insertInto("exchanges").values({ ...exchange, id: newId(), visibility: "x" }).execute()],
    ["exchanges.kind", () => d.insertInto("exchanges").values({ ...exchange, id: newId(), kind: "loan" }).execute()],
    ["exchanges.direction", () => d.insertInto("exchanges").values({ ...exchange, id: newId(), direction: "both" as "to_them" }).execute()],
    ["relationships.visibility", () => d.insertInto("relationships").values({ ...rel, id: newId(), visibility: "x" }).execute()],
    ["relationships.label", () => d.insertInto("relationships").values({ ...rel, id: newId(), label: " " }).execute()],
    ["relationships.inverse", () => d.insertInto("relationships").values({ ...rel, id: newId(), inverse: "" }).execute()],
  ];
  await d.insertInto("conversations").values(conversation).execute();
  for (const [what, insert] of bad) await expect(insert(), what).rejects.toThrow(/CHECK constraint failed/);
  const group = newId();
  await d.insertInto("groups").values({ id: group, name: "Uni", created_at: 0 }).execute();
  await expect(d.insertInto("group_members").values({ group_id: group, person_id: person, visibility: "x", recorded_by: user, conversation_id: null }).execute()).rejects.toThrow(
    /CHECK constraint failed/,
  );
  // Every value of every vocabulary is accepted.
  for (const kind of CONVERSATION_KINDS) await d.insertInto("conversations").values({ ...conversation, id: newId(), kind, visibility: "private" }).execute();
  for (const kind of EXCHANGE_KINDS) for (const direction of ["to_them", "from_them"] as const) await d.insertInto("exchanges").values({ ...exchange, id: newId(), kind, direction }).execute();
  await d.insertInto("relationships").values({ ...rel, id: newId() }).execute();
  for (const kind of ["birthday", "anniversary", "custom"] as const) await d.insertInto("dates").values({ ...date, id: newId(), kind }).execute();
  await d.insertInto("facts").values({ ...fact, id: newId(), status: "outdated", visibility: "private" }).execute();
});

test("002 seeds Freunde, Familie and Arbeit with their other names", async () => {
  const d = fresh();
  await migrateTo(d, "002_groups");
  const groups = await d.selectFrom("groups").select(["id", "name", "created_by"]).orderBy("name").execute();
  expect(groups.map((g) => [g.name, g.created_by])).toEqual([
    ["Arbeit", null],
    ["Familie", null],
    ["Freunde", null],
  ]);
  const arbeit = groups.find((g) => g.name === "Arbeit")!.id;
  const norms = await d.selectFrom("group_aliases").select("norm").where("group_id", "=", arbeit).orderBy("norm").execute();
  expect(norms.map((n) => n.norm)).toEqual(["job", "kollegen"]);
});

test("002 keeps an existing group of a seeded name and gives it the seeded other names", async () => {
  const d = fresh();
  await migrateTo(d, "001_initial");
  await d.insertInto("groups").values({ id: "g", name: "familie" }).execute();
  await migrate(d);
  const familie = await d.selectFrom("groups").select(["id", "name"]).where("name", "in", ["Familie", "familie"]).execute();
  expect(familie).toEqual([{ id: "g", name: "familie" }]);
  expect((await d.selectFrom("group_aliases").select("alias").where("group_id", "=", "g").execute()).map((a) => a.alias)).toEqual(["Verwandte"]);
});

test("002 folds groups whose names differ only in case or spacing into one, keeping every membership", async () => {
  const d = fresh();
  await migrateTo(d, "001_initial");
  const t = Date.now();
  await d.insertInto("users").values({ id: "u", oidc_sub: "s", name: "Me", email: null, person_id: null, created_at: t }).execute();
  for (const p of ["p1", "p2"]) await d.insertInto("persons").values({ id: p, name: p, created_by: "u", created_from: null, created_at: t }).execute();
  await d.insertInto("groups").values([{ id: "g1", name: "Uni" }, { id: "g2", name: " uni" }]).execute();
  const m = (group_id: string, person_id: string, visibility: string) => ({ group_id, person_id, visibility, recorded_by: "u", conversation_id: null });
  await d.insertInto("group_members").values([m("g1", "p1", "private"), m("g2", "p1", "shared"), m("g2", "p2", "shared")]).execute();
  await migrate(d);
  expect(await d.selectFrom("groups").select("id").where("id", "in", ["g1", "g2"]).execute()).toEqual([{ id: "g1" }]);
  const rows = await d.selectFrom("group_members").select(["group_id", "person_id", "visibility"]).orderBy("person_id").execute();
  expect(rows).toEqual([
    { group_id: "g1", person_id: "p1", visibility: "shared" },
    { group_id: "g1", person_id: "p2", visibility: "shared" },
  ]);
});

test("a fact keeps its source, day and file; deleting the file leaves the fact without one (004, 010)", async () => {
  const d = await db();
  const t = now();
  const user = newId();
  const person = newId();
  const shot = newId();
  await d.insertInto("users").values({ id: user, oidc_sub: "s", name: "Me", email: null, person_id: null, created_at: t }).execute();
  await d.insertInto("persons").values({ id: person, name: "Anna", created_by: user, created_from: null, created_at: t }).execute();
  await d.insertInto("files").values({ id: shot, user_id: user, sha256: "h", status: "filed", reading: null, created_at: t, blob_key: "k" }).execute();
  await expect(d.insertInto("files").values({ id: newId(), user_id: user, sha256: "h", status: "pending", reading: null, created_at: t, blob_key: "k" }).execute()).rejects.toThrow(/UNIQUE/);
  await expect(d.insertInto("files").values({ id: newId(), user_id: user, sha256: "x", status: "lost" as never, reading: null, created_at: t, blob_key: "k" }).execute()).rejects.toThrow(/CHECK/);
  const fact = newId();
  await d
    .insertInto("facts")
    .values({ id: fact, person_id: person, text: "Urlaub in Lissabon", category: "travel", status: "current", visibility: "shared", recorded_by: user, conversation_id: null, created_at: t, source: "Instagram", happened_on: "2026-10-12", file_id: shot })
    .execute();
  await d.deleteFrom("files").where("id", "=", shot).execute();
  expect(await d.selectFrom("facts").select(["source", "happened_on", "file_id"]).where("id", "=", fact).executeTakeFirst()).toEqual({ source: "Instagram", happened_on: "2026-10-12", file_id: null });
});

test("005 keeps one of the same relationship recorded twice by one user, with the note of a dropped one", async () => {
  const d = fresh();
  await migrateTo(d, "004_screenshots");
  const t = Date.now();
  for (const u of ["u", "w"]) await d.insertInto("users").values({ id: u, oidc_sub: u, name: u, email: null, person_id: null, created_at: t }).execute();
  for (const p of ["syb", "mal", "ram"]) await d.insertInto("persons").values({ id: p, name: p, created_by: "u", created_from: null, created_at: t }).execute();
  let n = 0;
  const r = (from_id: string, to_id: string, type: string, note: string | null, recorded_by = "u", visibility = "shared") => ({
    id: `r${++n}`,
    from_id,
    to_id,
    type,
    note,
    recorded_by,
    visibility,
    conversation_id: null,
    created_at: t + n,
  });
  // Written with a type, as before 007.
  await d
    .insertInto("relationships")
    .values([
      r("syb", "mal", "other", null),
      r("syb", "mal", "other", "Patentante"), // r2: the same, its note goes to r1
      r("mal", "syb", "other", "patentante"), // r3: the same, read the other way
      r("syb", "mal", "other", "Nachbarin"), // r4: another one
      r("ram", "mal", "parent", null),
      r("mal", "ram", "child", null), // r6: the same as r5
      r("ram", "mal", "parent", null, "w"), // r7: the partner's own
      r("ram", "mal", "parent", null, "u", "private"), // r8: private, kept apart
    ])
    .execute();
  await migrateTo(d, "005_relationship_duplicates");
  const rows = await d.selectFrom("relationships").select(["id", "note"]).orderBy("id").execute();
  expect(rows).toEqual([
    { id: "r1", note: "Patentante" },
    { id: "r4", note: "Nachbarin" },
    { id: "r5", note: null },
    { id: "r7", note: null },
    { id: "r8", note: null },
  ]);
});

// A database at 006 with two users, two persons and one relationship and fact, for the tests of 007.
async function at006() {
  const d = fresh();
  await migrateTo(d, "006_calendar_key");
  const t = Date.now();
  await d.insertInto("users").values({ id: "u", oidc_sub: "u", name: "u", email: null, person_id: null, created_at: t }).execute();
  for (const p of ["anna", "tom"]) await d.insertInto("persons").values({ id: p, name: p, created_by: "u", created_from: null, created_at: t }).execute();
  // Written as 006 had them: a type, and a note that said what an `other` is.
  const old = [
    ["r1", "friend", "Uni"],
    ["r2", "parent", null],
    ["r3", "other", "Patentante"],
    ["r4", "other", null],
  ] as const;
  for (const [id, type, note] of old)
    await sql`insert into relationships (id, from_id, to_id, type, note, visibility, recorded_by, conversation_id, created_at) values (${id}, 'anna', 'tom', ${type}, ${note}, 'private', 'u', null, ${t})`.execute(d);
  await d
    .insertInto("facts")
    .values({ id: "f1", person_id: "anna", text: "a", category: "work", status: "current", visibility: "shared", recorded_by: "u", conversation_id: null, created_at: t })
    .execute();
  await migrate(d);
  return d;
}
test("007 turns each relationship's type into what each end is, in words, and keeps the notes that aren't the words", async () => {
  const d = await at006();
  expect(await d.selectFrom("relationships").select(["id", "label", "inverse", "note", "visibility"]).orderBy("id").execute()).toEqual([
    { id: "r1", label: "Freund:in", inverse: "Freund:in", note: "Uni", visibility: "private" },
    { id: "r2", label: "Elternteil", inverse: "Kind", note: null, visibility: "private" },
    { id: "r3", label: "Patentante", inverse: "Patentante", note: null, visibility: "private" },
    { id: "r4", label: "Bekannte:r", inverse: "Bekannte:r", note: null, visibility: "private" },
  ]);
  const row = { from_id: "anna", to_id: "tom", note: null, visibility: "shared", recorded_by: "u", conversation_id: null, created_at: 0 };
  await d.insertInto("relationships").values({ ...row, id: "r7", label: "Hebamme", inverse: "Mutter" }).execute();
  await expect(d.insertInto("relationships").values({ ...row, id: "r8", label: "", inverse: "Mutter" }).execute()).rejects.toThrow(/CHECK constraint failed/);
  const { rows } = await sql<{ name: string }>`pragma index_list(relationships)`.execute(d);
  expect(rows.map((r) => r.name).filter((n) => !n.startsWith("sqlite_")).sort()).toEqual(["relationships_by_from", "relationships_by_ramble", "relationships_by_to"]);
});

test("007 makes every existing fact lasting", async () => {
  const d = await at006();
  expect(await d.selectFrom("facts").select(["kind", "check_after"]).execute()).toEqual([{ kind: "lasting", check_after: null }]);
  const f = { person_id: "anna", text: "a", category: "work", status: "current", visibility: "shared", recorded_by: "u", conversation_id: null, created_at: 0 };
  await d.insertInto("facts").values({ ...f, id: "f2", kind: "situation", check_after: "2026-12-01" }).execute();
  await expect(d.insertInto("facts").values({ ...f, id: "f3", kind: "rumour" }).execute()).rejects.toThrow(/CHECK constraint failed/);
});

test("007 adds an optional gender", async () => {
  const d = await at006();
  expect(await d.selectFrom("persons").select("gender").where("id", "=", "anna").executeTakeFirst()).toEqual({ gender: null });
  await d.updateTable("persons").set({ gender: "nonbinary" }).where("id", "=", "anna").execute();
  await expect(d.updateTable("persons").set({ gender: "other" }).where("id", "=", "tom").execute()).rejects.toThrow(/CHECK constraint failed/);
});

test("008 lets a fact be a need or a personality trait and keeps every fact as it was", async () => {
  const database = new Database(":memory:");
  database.pragma("foreign_keys = ON");
  const d = new Kysely<any>({ dialect: new SqliteDialect({ database }) }); // eslint-disable-line @typescript-eslint/no-explicit-any
  await migrateTo(d, "007_roles_situations_gender");
  const t = Date.now();
  await d.insertInto("users").values({ id: "u", oidc_sub: "u", name: "u", email: null, person_id: null, created_at: t }).execute();
  await d.insertInto("persons").values({ id: "anna", name: "anna", created_by: "u", created_from: null, created_at: t }).execute();
  const f = { person_id: "anna", category: "home", visibility: "shared", recorded_by: "u", conversation_id: null, created_at: t };
  await d.insertInto("facts").values({ ...f, id: "f2", text: "moved", status: "current", kind: "situation", check_after: "2026-12-01" }).execute();
  await d.insertInto("facts").values({ ...f, id: "f1", text: "moving", status: "outdated", superseded_by: "f2", source: "Instagram", happened_on: "2026-10-01" }).execute();
  const before = await d.selectFrom("facts").selectAll().orderBy("id").execute();
  await migrateTo(d, "008_traits");
  expect(await d.selectFrom("facts").selectAll().orderBy("id").execute()).toEqual(before);
  await d.insertInto("facts").values({ ...f, id: "f3", text: "vegetarian", status: "current", kind: "need" }).execute();
  await d.insertInto("facts").values({ ...f, id: "f4", text: "shy", status: "current", kind: "personality" }).execute();
  await expect(d.insertInto("facts").values({ ...f, id: "f5", text: "x", status: "current", kind: "rumour" }).execute()).rejects.toThrow(/CHECK constraint failed/);
  await d.deleteFrom("facts").where("id", "=", "f2").execute();
  expect(await d.selectFrom("facts").select("superseded_by").where("id", "=", "f1").executeTakeFirst()).toEqual({ superseded_by: null });
  await d.deleteFrom("persons").where("id", "=", "anna").execute();
  expect(await d.selectFrom("facts").selectAll().execute()).toEqual([]);
  const { rows } = await sql<{ name: string }>`select name from sqlite_master where type = 'index' and tbl_name = 'facts' and name = 'facts_by_person'`.execute(d);
  expect(rows).toHaveLength(1);
});

test("008 that fails partway leaves facts as they were, and runs once the cause is gone", async () => {
  const database = new Database(":memory:");
  const d = new Kysely<any>({ dialect: new SqliteDialect({ database }) }); // eslint-disable-line @typescript-eslint/no-explicit-any
  await migrateTo(d, "007_roles_situations_gender");
  const t = Date.now();
  await d.insertInto("users").values({ id: "u", oidc_sub: "u", name: "u", email: null, person_id: null, created_at: t }).execute();
  // A fact of a person who no longer exists, written while foreign keys were off: copying it fails once they are on.
  const f = { category: "home", status: "current", visibility: "shared", recorded_by: "u", conversation_id: null, created_at: t, text: "x" };
  database.pragma("foreign_keys = OFF");
  await d.insertInto("facts").values({ ...f, id: "f1", person_id: "gone" }).execute();
  database.pragma("foreign_keys = ON");
  await expect(migrateTo(d, "008_traits")).rejects.toThrow();
  const { rows } = await sql<{ name: string }>`select name from sqlite_master where type = 'table' and name like 'facts%' order by name`.execute(d);
  expect(rows.map((r) => r.name)).toEqual(["facts"]);
  expect(await d.selectFrom("facts").select("id").execute()).toEqual([{ id: "f1" }]);
  await d.deleteFrom("facts").execute();
  await migrateTo(d, "008_traits");
});

test("009 makes Haushalt, a group of everyone who signed in, reusing a group of that name", async () => {
  const d = fresh();
  await migrateTo(d, "008_traits");
  const t = Date.now();
  for (const u of ["u", "w"]) {
    await d.insertInto("users").values({ id: u, oidc_sub: u, name: u, email: null, person_id: null, created_at: t }).execute();
    await d.insertInto("persons").values({ id: `p-${u}`, name: u, created_by: u, created_from: null, created_at: t }).execute();
    await d.updateTable("users").set({ person_id: `p-${u}` }).where("id", "=", u).execute();
  }
  await d.insertInto("groups").values({ id: "g", name: "haushalt ", created_by: "u", created_at: t, seeded: 0 }).execute();
  await migrateTo(d, "009_household_group");
  expect(await d.selectFrom("groups").select(["id", "seeded", "household"]).where("household", "=", 1).execute()).toEqual([{ id: "g", seeded: 1, household: 1 }]);
  const members = await d.selectFrom("group_members").select(["person_id", "recorded_by", "visibility"]).where("group_id", "=", "g").orderBy("person_id").execute();
  expect(members).toEqual([
    { person_id: "p-u", recorded_by: "u", visibility: "shared" },
    { person_id: "p-w", recorded_by: "w", visibility: "shared" },
  ]);
});

test("010 renames screenshots to files and keeps every row, link and blob", async () => {
  const database = new Database(":memory:");
  database.pragma("foreign_keys = ON");
  const d = new Kysely<any>({ dialect: new SqliteDialect({ database }) }); // eslint-disable-line @typescript-eslint/no-explicit-any
  await migrateTo(d, "009_household_group");
  const t = Date.now();
  await d.insertInto("users").values({ id: "u", oidc_sub: "u", name: "u", email: null, person_id: null, created_at: t }).execute();
  await d.insertInto("persons").values({ id: "anna", name: "anna", created_by: "u", created_from: null, created_at: t }).execute();
  await d.insertInto("screenshots").values({ id: "s1", user_id: "u", sha256: "x", status: "filed", reading: null, created_at: t }).execute();
  const f = { person_id: "anna", category: "travel", status: "current", visibility: "shared", recorded_by: "u", conversation_id: null, created_at: t };
  await d.insertInto("facts").values({ ...f, id: "f1", text: "Lissabon", screenshot_id: "s1" }).execute();
  await migrateTo(d, "010_files");
  expect(await d.selectFrom("files").select(["id", "media_type", "blob_key", "status"]).execute()).toEqual([{ id: "s1", media_type: "image/webp", blob_key: "screenshots/s1.webp", status: "filed" }]);
  expect(await d.selectFrom("facts").select("file_id").execute()).toEqual([{ file_id: "s1" }]);
  await d.deleteFrom("files").where("id", "=", "s1").execute();
  expect(await d.selectFrom("facts").select("file_id").execute()).toEqual([{ file_id: null }]);
});

test("011 moves each conversation's transcript into a ramble of its own and keeps every link", async () => {
  const database = new Database(":memory:");
  database.pragma("foreign_keys = ON");
  const d = new Kysely<any>({ dialect: new SqliteDialect({ database }) }); // eslint-disable-line @typescript-eslint/no-explicit-any
  await migrateTo(d, "010_files");
  const t = Date.now();
  await d.insertInto("users").values({ id: "u", oidc_sub: "u", name: "u", email: null, person_id: null, created_at: t }).execute();
  await d.insertInto("persons").values({ id: "anna", name: "anna", created_by: "u", created_from: null, created_at: t }).execute();
  const c = { kind: "call", place: null, summary: "s", visibility: "shared", recorded_by: "u" };
  await d.insertInto("conversations").values({ ...c, id: "c1", date: "2026-10-20", transcript: "eins", transcript_private: 0, created_at: t }).execute();
  await d.insertInto("conversations").values({ ...c, id: "c2", date: "2026-10-21", transcript: "zwei privat", transcript_private: 1, created_at: t + 1 }).execute();
  await d.insertInto("participants").values({ conversation_id: "c1", person_id: "anna" }).execute();
  await d.insertInto("facts").values({ id: "f1", person_id: "anna", text: "x", category: "other", status: "current", visibility: "shared", recorded_by: "u", conversation_id: "c1", created_at: t }).execute();
  await migrateTo(d, "011_rambles");
  const rows = await d.selectFrom("conversations").innerJoin("rambles", "rambles.id", "conversations.ramble_id").select(["conversations.id", "rambles.date", "rambles.transcript", "rambles.transcript_private", "rambles.recorded_by", "rambles.created_at"]).orderBy("conversations.id").execute();
  expect(rows).toEqual([
    { id: "c1", date: "2026-10-20", transcript: "eins", transcript_private: 0, recorded_by: "u", created_at: t },
    { id: "c2", date: "2026-10-21", transcript: "zwei privat", transcript_private: 1, recorded_by: "u", created_at: t + 1 },
  ]);
  const cols = (await sql<{ name: string }>`pragma table_info(conversations)`.execute(d)).rows.map((r) => r.name);
  expect(cols).not.toContain("transcript");
  expect(await d.selectFrom("participants").selectAll().execute()).toHaveLength(1);
  expect(await d.selectFrom("facts").select("conversation_id").execute()).toEqual([{ conversation_id: "c1" }]);
  // A ramble takes its conversations with it.
  const r1 = rows[0];
  await d.deleteFrom("rambles").where("id", "=", (await d.selectFrom("conversations").select("ramble_id").where("id", "=", r1.id).executeTakeFirstOrThrow()).ramble_id).execute();
  expect(await d.selectFrom("conversations").select("id").execute()).toEqual([{ id: "c2" }]);
  expect(await d.selectFrom("facts").selectAll().execute()).toEqual([]);
});

test("014 links every item of a conversation to the conversation's ramble", async () => {
  const database = new Database(":memory:");
  database.pragma("foreign_keys = ON");
  const d = new Kysely<any>({ dialect: new SqliteDialect({ database }) }); // eslint-disable-line @typescript-eslint/no-explicit-any
  await migrateTo(d, "013_reflection");
  const t = Date.now();
  await d.insertInto("users").values({ id: "u", oidc_sub: "u", name: "u", email: null, person_id: null, created_at: t }).execute();
  await d.insertInto("persons").values({ id: "anna", name: "anna", created_by: "u", created_from: null, created_at: t }).execute();
  await d.insertInto("rambles").values({ id: "r1", date: "2026-10-20", transcript: "t", transcript_private: 0, visibility: "shared", recorded_by: "u", created_at: t }).execute();
  await d.insertInto("conversations").values({ id: "c1", ramble_id: "r1", kind: "call", place: null, summary: "s", visibility: "shared", recorded_by: "u", date: "2026-10-20", created_at: t }).execute();
  const f = { person_id: "anna", text: "x", category: "other", status: "current", visibility: "shared", recorded_by: "u", created_at: t };
  await d.insertInto("facts").values({ ...f, id: "f1", conversation_id: "c1" }).execute();
  await d.insertInto("facts").values({ ...f, id: "f2", conversation_id: null }).execute();
  await migrateTo(d, "014_ramble_items");
  expect(await d.selectFrom("facts").select(["id", "ramble_id"]).orderBy("id").execute()).toEqual([
    { id: "f1", ramble_id: "r1" },
    { id: "f2", ramble_id: null },
  ]);
});

test("015 turns each recorder's free-text places into place records and links the conversations", async () => {
  const database = new Database(":memory:");
  database.pragma("foreign_keys = ON");
  const d = new Kysely<any>({ dialect: new SqliteDialect({ database }) }); // eslint-disable-line @typescript-eslint/no-explicit-any
  await migrateTo(d, "014_ramble_items");
  const t = Date.now();
  for (const u of ["u", "w"]) await d.insertInto("users").values({ id: u, oidc_sub: u, name: u, email: null, person_id: null, created_at: t }).execute();
  await d.insertInto("rambles").values({ id: "r", date: "2026-10-20", transcript: "t", transcript_private: 0, visibility: "shared", recorded_by: "u", created_at: t }).execute();
  const c = { ramble_id: "r", kind: "in_person", summary: "s", visibility: "shared", date: "2026-10-20", created_at: t };
  await d.insertInto("conversations").values({ ...c, id: "c1", recorded_by: "u", place: "Olympiahalle" }).execute();
  await d.insertInto("conversations").values({ ...c, id: "c2", recorded_by: "u", place: "Olympiahalle" }).execute();
  await d.insertInto("conversations").values({ ...c, id: "c3", recorded_by: "w", place: "Olympiahalle" }).execute();
  await d.insertInto("conversations").values({ ...c, id: "c4", recorded_by: "u", place: null }).execute();
  await d.insertInto("conversations").values({ ...c, id: "c5", recorded_by: "u", place: "Café Lisa" }).execute();
  await d.insertInto("conversations").values({ ...c, id: "c6", recorded_by: "u", place: "Cafe Lisa" }).execute();
  await migrateTo(d, "015_places");
  const rows = await d.selectFrom("conversations").leftJoin("places", "places.id", "conversations.place_id").select(["conversations.id", "places.id as placeId", "places.name", "places.created_by"]).orderBy("conversations.id").execute();
  expect(rows.map((r) => r.name)).toEqual(["Olympiahalle", "Olympiahalle", "Olympiahalle", null, "Café Lisa", "Café Lisa"]);
  // Names match as at runtime (norm): "Cafe Lisa" is the same place as "Café Lisa".
  expect(rows[4].placeId).toBe(rows[5].placeId);
  expect(rows[0].placeId).toBe(rows[1].placeId);
  expect(rows[2].placeId).not.toBe(rows[0].placeId);
  expect(rows[2].created_by).toBe("w");
  const cols = (await sql<{ name: string }>`pragma table_info(conversations)`.execute(d)).rows.map((r) => r.name);
  expect(cols).not.toContain("place");
});
