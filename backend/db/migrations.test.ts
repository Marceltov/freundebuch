import { sql, type Kysely } from "kysely";
import { expect, test } from "vitest";
import { connect } from "./connect";
import { MIGRATION_NAMES, NEWER, migrate, migrateTo } from "./migrations";
import { INSTANCE_TABLES, KEYED_TABLES, REFS } from "./tables";
import { now } from "./index";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const fresh = async (): Promise<Kysely<any>> => {
  const d = await connect(":memory:");
  await migrate(d);
  return d;
};
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const tables = async (d: Kysely<any>) =>
  (await sql<{ name: string }>`select name from sqlite_master where type = 'table' and name not like 'kysely%'`.execute(d)).rows.map((r) => r.name);
const bookTables = async (d: Kysely<any>) => (await tables(d)).filter((t) => !(INSTANCE_TABLES as readonly string[]).includes(t)); // eslint-disable-line @typescript-eslint/no-explicit-any

test("migrate on a fresh database records every migration, and a second run is a no-op", async () => {
  const d = await fresh();
  await migrate(d);
  const rows = await d.selectFrom("kysely_migration").select("name").orderBy("name").execute();
  expect(rows.map((r) => r.name)).toEqual([...MIGRATION_NAMES]);
});

test("the baseline makes every table either an instance table or a book table", async () => {
  const d = await fresh();
  expect(await tables(d)).toEqual(expect.arrayContaining([...INSTANCE_TABLES]));
  for (const t of await bookTables(d)) {
    const cols = (await sql<{ name: string; notnull: number }>`select name, "notnull" from pragma_table_info(${t})`.execute(d)).rows;
    expect(
      cols.find((c) => c.name === "book_id"),
      t,
    ).toMatchObject({ notnull: 1 });
  }
});

test("every reference between book tables carries the book", async () => {
  const d = await fresh();
  const books = await bookTables(d);
  for (const t of books) {
    const fks = (await sql<{ id: number; seq: number; table: string; from: string; to: string }>`select * from pragma_foreign_key_list(${t})`.execute(d)).rows;
    const byKey = Map.groupBy(
      fks.filter((f) => books.includes(f.table)),
      (f) => f.id,
    );
    // Each referenced book table is reached through one composite key (book_id, x) → (book_id, id); a single-column key next to it
    // only carries an `on delete set null`, which SQLite can't apply to one column of a composite key.
    const composite = new Set(
      [...byKey.values()].filter((k) => k.length === 2 && k[0].from === "book_id" && k[0].to === "book_id").map((k) => `${k[1].table}.${k[1].from}`),
    );
    for (const k of byKey.values()) {
      if (k.length === 2) expect(k[0].from, `${t} → ${k[0].table}`).toBe("book_id");
      else expect(composite.has(`${k[0].table}.${k[0].from}`), `${t}.${k[0].from} → ${k[0].table} has no composite key`).toBe(true);
    }
  }
});

test("a row can't point into another book", async () => {
  const d = await fresh();
  await d.insertInto("users").values({ id: "u", oidc_sub: "u", name: "U", created_at: 0 }).execute();
  await d
    .insertInto("books")
    .values([
      { id: "b1", name: "1", created_by: "u", created_at: 0 },
      { id: "b2", name: "2", created_by: "u", created_at: 0 },
    ])
    .execute();
  await d.insertInto("persons").values({ id: "p", book_id: "b1", name: "Anna", created_by: "u", created_at: 0 }).execute();
  const fact = (book: string) =>
    d
      .insertInto("facts")
      .values({ id: `f-${book}`, book_id: book, person_id: "p", text: "x", category: "other", visibility: "shared", recorded_by: "u", created_at: 0 })
      .execute();
  await fact("b1");
  await expect(fact("b2")).rejects.toThrow(/FOREIGN KEY constraint failed/);
});

test("a book has one household group", async () => {
  const d = await fresh();
  await d.insertInto("users").values({ id: "u", oidc_sub: "u", name: "U", created_at: 0 }).execute();
  await d.insertInto("books").values({ id: "b", name: "1", created_by: "u", created_at: 0 }).execute();
  const group = (id: string) => d.insertInto("groups").values({ id, book_id: "b", name: "Haushalt", created_at: 0, household: 1 }).execute();
  await group("g1");
  await expect(group("g2")).rejects.toThrow(/UNIQUE constraint failed/);
});

test("deleting a place keeps the conversation at it, without the place", async () => {
  const d = await fresh();
  await d.insertInto("users").values({ id: "u", oidc_sub: "u", name: "U", created_at: 0 }).execute();
  await d.insertInto("books").values({ id: "b", name: "1", created_by: "u", created_at: 0 }).execute();
  await d.insertInto("places").values({ id: "pl", book_id: "b", name: "Luigi's", created_by: "u", created_at: 0 }).execute();
  await d
    .insertInto("rambles")
    .values({ id: "r", book_id: "b", date: "2026-01-01", transcript: "", visibility: "shared", recorded_by: "u", created_at: 0 })
    .execute();
  await d
    .insertInto("conversations")
    .values({
      id: "c",
      book_id: "b",
      date: "2026-01-01",
      kind: "call",
      summary: "",
      ramble_id: "r",
      place_id: "pl",
      visibility: "shared",
      recorded_by: "u",
      created_at: 0,
    })
    .execute();
  await d.deleteFrom("places").where("id", "=", "pl").execute();
  expect(await d.selectFrom("conversations").select(["book_id", "place_id"]).executeTakeFirst()).toEqual({ book_id: "b", place_id: null });
});

test("a database from a newer freundebuch stops with NEWER", async () => {
  const d = await fresh();
  await d.insertInto("kysely_migration").values({ name: "999_future", timestamp: new Date().toISOString() }).execute();
  await expect(migrate(d)).rejects.toThrow(NEWER);
});

test("now() never repeats", () => {
  const t = Array.from({ length: 1000 }, () => now());
  for (let i = 1; i < t.length; i++) expect(t[i]).toBeGreaterThan(t[i - 1]);
});

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function atBaseline(): Promise<Kysely<any>> {
  const d = await connect(":memory:");
  await migrateTo(d, "001_baseline");
  await d
    .insertInto("users")
    .values([
      { id: "a", oidc_sub: "a", name: "A", created_at: 0 },
      { id: "b", oidc_sub: "b", name: "B", created_at: 0 },
    ])
    .execute();
  const book = async (id: string, by: string, users: string[], t: number) => {
    await d.insertInto("books").values({ id, name: id, created_by: by, created_at: t }).execute();
    for (const u of users) {
      await d
        .insertInto("persons")
        .values({ id: `${id}-${u}`, book_id: id, name: u, created_by: u, created_at: t })
        .execute();
      await d
        .insertInto("members")
        .values({ book_id: id, user_id: u, person_id: `${id}-${u}`, created_at: t })
        .execute();
    }
  };
  await book("home", "a", ["a", "b"], 1);
  await book("work", "a", ["a"], 2);
  return d;
}

test("002 makes the book's creator its owner and every other member an admin", async () => {
  const d = await atBaseline();
  await migrate(d);
  const rows = await d.selectFrom("members").select(["book_id", "user_id", "role"]).orderBy("book_id").orderBy("user_id").execute();
  expect(rows).toEqual([
    { book_id: "home", user_id: "a", role: "owner" },
    { book_id: "home", user_id: "b", role: "admin" },
    { book_id: "work", user_id: "a", role: "owner" },
  ]);
});

test("002 moves a calendar key to the member row of the user's oldest book", async () => {
  const d = await atBaseline();
  await d.insertInto("user_settings").values({ user_id: "a", webhook_url: "https://x", calendar_key_hash: "h" }).execute();
  await migrate(d);
  const keys = await d.selectFrom("members").select(["book_id", "calendar_key_hash"]).where("user_id", "=", "a").orderBy("book_id").execute();
  expect(keys).toEqual([
    { book_id: "home", calendar_key_hash: "h" },
    { book_id: "work", calendar_key_hash: null },
  ]);
  const cols = (await sql<{ name: string }>`select name from pragma_table_info('user_settings')`.execute(d)).rows.map((c) => c.name);
  expect(cols).not.toContain("calendar_key_hash");
  expect(await d.selectFrom("user_settings").select("webhook_url").executeTakeFirst()).toEqual({ webhook_url: "https://x" });
});

test("KEYED_TABLES are the book tables with an id of their own", async () => {
  const d = await fresh();
  const keyed: string[] = [];
  for (const t of await bookTables(d)) {
    const cols = (await sql<{ name: string; pk: number }>`select name, pk from pragma_table_info(${t})`.execute(d)).rows;
    if (cols.some((c) => c.name === "id" && c.pk === 1)) keyed.push(t);
  }
  expect(keyed.sort()).toEqual([...KEYED_TABLES].sort());
});

test("REFS matches the schema's references between book tables", async () => {
  const d = await fresh();
  const books = await bookTables(d);
  const found: Record<string, Record<string, string>> = {};
  for (const t of books) {
    const fks = (await sql<{ table: string; from: string }>`select * from pragma_foreign_key_list(${t})`.execute(d)).rows;
    found[t] = Object.fromEntries(fks.filter((f) => f.from !== "book_id" && books.includes(f.table)).map((f) => [f.from, f.table]));
  }
  expect(found).toEqual(REFS);
});

test("003 makes invitations an instance table with a unique token", async () => {
  expect(INSTANCE_TABLES).toContain("invitations");
  const d = await fresh();
  await d.insertInto("users").values({ id: "u", oidc_sub: "u", name: "U", created_at: 0 }).execute();
  await d.insertInto("books").values({ id: "b", name: "1", created_by: "u", created_at: 0 }).execute();
  const invite = (id: string) =>
    d.insertInto("invitations").values({ id, book_id: "b", token_hash: "h", role: "member", created_by: "u", created_at: 0, expires_at: 1 }).execute();
  await invite("i1");
  await expect(invite("i2")).rejects.toThrow(/UNIQUE constraint failed/);
  await expect(
    d.insertInto("invitations").values({ id: "i3", book_id: "b", token_hash: "h3", role: "owner", created_by: "u", created_at: 0, expires_at: 1 }).execute(),
  ).rejects.toThrow(/CHECK constraint failed/);
});
