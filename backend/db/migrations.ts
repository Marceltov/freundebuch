// Schema changes, in order. Never edit one that has shipped; add the next. Kept in code, not files, so the standalone build has
// nothing extra to trace. Kysely's Migrator records what ran in `kysely_migration`.
// The migrations run against whatever the schema was when they were written, so the database is untyped here. They use only the
// schema builder, so the same migration compiles for Postgres; its checks (json_valid, length(trim())) are SQLite's and change with a move.
/* eslint-disable @typescript-eslint/no-explicit-any */
import { Kysely, sql, type CreateTableBuilder } from "kysely";
import { Migrator, type Migration } from "kysely/migration";

// The vocabularies of backend/core/types.ts as they were when this migration was written, checked by the database as well: a
// write path that forgets to check a value still can't store a bad one.
const oneOf = (column: string, values: readonly string[]) => sql`${sql.ref(column)} in (${sql.join(values.map((v) => sql.lit(v)))})`;
const VISIBILITY = ["shared", "private"];
const notBlank = (column: string) => sql`length(trim(${sql.ref(column)})) > 0`;
const jsonOrNull = (column: string) => sql`${sql.ref(column)} is null or json_valid(${sql.ref(column)})`;

type Table = CreateTableBuilder<any, any>;

// A book table: its rows belong to one book and go with it.
const bookTable = (db: Kysely<any>, name: string): Table =>
  db.schema.createTable(name).addColumn("book_id", "text", (c) => c.notNull().references("books.id").onDelete("cascade"));

// A book table's own rows: an id, and (book_id, id) for the composite keys pointing at them.
const keyed = (t: Table, name: string): Table => t.addColumn("id", "text", (c) => c.primaryKey()).addUniqueConstraint(`${name}_in_book`, ["book_id", "id"]);

/**
 * A reference to another row of the same book: (book_id, column) → target(book_id, id), so nothing points into another book.
 * `set null` needs a single-column key of its own, since SQLite would null book_id too on a composite one; the composite key
 * then has no action and holds as soon as the column is null.
 */
const ref = (t: Table, table: string, column: string, target: string, onDelete: "cascade" | "set null" | "restrict", notNull = false): Table => {
  const withColumn = t.addColumn(column, "text", (c) => {
    const n = notNull ? c.notNull() : c;
    return onDelete === "set null" ? n.references(`${target}.id`).onDelete("set null") : n;
  });
  return withColumn.addForeignKeyConstraint(`${table}_${column}_in_book`, ["book_id", column], target, ["book_id", "id"], (k) =>
    onDelete === "cascade" ? k.onDelete("cascade") : k,
  );
};

// What every item carries: who recorded it, shared or private, and the conversation and ramble it came from (cascading).
const item = (t: Table, table: string): Table =>
  ref(
    ref(
      t
        .addColumn("visibility", "text", (c) => c.notNull().check(oneOf("visibility", VISIBILITY)))
        .addColumn("recorded_by", "text", (c) => c.notNull().references("users.id")),
      table,
      "conversation_id",
      "conversations",
      "cascade",
    ),
    table,
    "ramble_id",
    "rambles",
    "cascade",
  ).addColumn("created_at", "bigint", (c) => c.notNull());

// Every id is a text UUID, every time a bigint in ms. Deleting a book takes everything in it; deleting a conversation or a person
// takes their items with them.
const migrations: Record<string, Migration> = {
  "001_baseline": {
    async up(db: Kysely<any>) {
      // ---- the instance ---------------------------------------------------------------------------------------------------
      await db.schema
        .createTable("users")
        .addColumn("id", "text", (c) => c.primaryKey())
        .addColumn("oidc_sub", "text", (c) => c.notNull().unique())
        .addColumn("name", "text", (c) => c.notNull())
        .addColumn("email", "text")
        .addColumn("created_at", "bigint", (c) => c.notNull())
        .addColumn("language", "text", (c) =>
          c
            .notNull()
            .defaultTo("de")
            .check(oneOf("language", ["de", "en"])),
        )
        .execute();
      await db.schema
        .createTable("user_settings")
        .addColumn("user_id", "text", (c) => c.primaryKey().references("users.id").onDelete("cascade"))
        .addColumn("webhook_url", "text")
        .addColumn("share_key_hash", "text", (c) => c.unique())
        .addColumn("calendar_key_hash", "text", (c) => c.unique())
        .addColumn("reflection_day", "integer")
        .addColumn("reflection_hour", "integer")
        .execute();
      await db.schema
        .createTable("own_cards")
        .addColumn("id", "text", (c) => c.primaryKey())
        .addColumn("user_id", "text", (c) => c.notNull().references("users.id").onDelete("cascade"))
        .addColumn("label", "text", (c) => c.notNull())
        .addColumn("card", "text", (c) => c.notNull().check(sql`json_valid(card)`))
        .addColumn("key_hash", "text", (c) => c.unique())
        .addColumn("created_at", "bigint", (c) => c.notNull())
        .addColumn("updated_at", "bigint", (c) => c.notNull())
        .addUniqueConstraint("own_cards_label", ["user_id", "label"])
        .execute();
      await db.schema
        .createTable("chat_usage")
        .addColumn("user_id", "text", (c) => c.notNull().references("users.id").onDelete("cascade"))
        .addColumn("day", "text", (c) => c.notNull())
        .addColumn("count", "integer", (c) => c.notNull())
        .addPrimaryKeyConstraint("chat_usage_pk", ["user_id", "day"])
        .execute();
      await db.schema
        .createTable("meta")
        .addColumn("key", "text", (c) => c.primaryKey())
        .addColumn("value", "text", (c) => c.notNull())
        .execute();
      await db.schema
        .createTable("books")
        .addColumn("id", "text", (c) => c.primaryKey())
        .addColumn("name", "text", (c) => c.notNull().check(notBlank("name")))
        .addColumn("created_by", "text", (c) => c.notNull().references("users.id"))
        .addColumn("created_at", "bigint", (c) => c.notNull())
        .execute();

      // ---- a book ---------------------------------------------------------------------------------------------------------
      await keyed(bookTable(db, "rambles"), "rambles")
        .addColumn("date", "text", (c) => c.notNull())
        .addColumn("transcript", "text", (c) => c.notNull())
        .addColumn("transcript_private", "integer", (c) => c.notNull().defaultTo(0))
        .addColumn("visibility", "text", (c) => c.notNull().check(oneOf("visibility", VISIBILITY)))
        .addColumn("recorded_by", "text", (c) => c.notNull().references("users.id"))
        .addColumn("created_at", "bigint", (c) => c.notNull())
        .execute();
      await keyed(bookTable(db, "places"), "places")
        .addColumn("name", "text", (c) => c.notNull())
        .addColumn("created_by", "text", (c) => c.notNull().references("users.id"))
        .addColumn("created_at", "bigint", (c) => c.notNull())
        .$call((t) => ref(t, "places", "parent_id", "places", "set null"))
        .addColumn("address", "text")
        .execute();
      await keyed(bookTable(db, "series"), "series")
        .addColumn("name", "text", (c) => c.notNull())
        .addColumn("kind", "text", (c) => c.notNull())
        .addColumn("rhythm_days", "integer", (c) => c.check(sql`rhythm_days is null or rhythm_days between 1 and 366`))
        .addColumn("starts_on", "text")
        .addColumn("ends_on", "text")
        .$call((t) => ref(t, "series", "place_id", "places", "set null"))
        .addColumn("visibility", "text", (c) => c.notNull().check(oneOf("visibility", VISIBILITY)))
        .addColumn("recorded_by", "text", (c) => c.notNull().references("users.id"))
        .addColumn("created_at", "bigint", (c) => c.notNull())
        .execute();
      await keyed(bookTable(db, "experiences"), "experiences")
        .$call((t) => ref(t, "experiences", "ramble_id", "rambles", "cascade", true))
        .$call((t) => ref(t, "experiences", "series_id", "series", "set null"))
        .$call((t) => ref(t, "experiences", "place_id", "places", "set null"))
        .addColumn("date", "text", (c) => c.notNull())
        .addColumn("kind", "text", (c) => c.notNull())
        .addColumn("title", "text", (c) => c.notNull())
        .addColumn("summary", "text")
        .addColumn("visibility", "text", (c) => c.notNull().check(oneOf("visibility", VISIBILITY)))
        .addColumn("recorded_by", "text", (c) => c.notNull().references("users.id"))
        .addColumn("created_at", "bigint", (c) => c.notNull())
        .execute();
      await keyed(bookTable(db, "conversations"), "conversations")
        .addColumn("date", "text", (c) => c.notNull())
        .addColumn("kind", "text", (c) => c.notNull().check(oneOf("kind", ["in_person", "call", "message", "video", "event"])))
        .addColumn("summary", "text", (c) => c.notNull())
        .addColumn("visibility", "text", (c) => c.notNull().check(oneOf("visibility", VISIBILITY)))
        .addColumn("recorded_by", "text", (c) => c.notNull().references("users.id"))
        .addColumn("created_at", "bigint", (c) => c.notNull())
        .$call((t) => ref(t, "conversations", "ramble_id", "rambles", "cascade"))
        .$call((t) => ref(t, "conversations", "place_id", "places", "set null"))
        .$call((t) => ref(t, "conversations", "experience_id", "experiences", "set null"))
        .execute();
      await keyed(bookTable(db, "persons"), "persons")
        .addColumn("name", "text", (c) => c.notNull())
        .addColumn("created_by", "text", (c) => c.notNull().references("users.id"))
        .$call((t) => ref(t, "persons", "created_from", "conversations", "set null"))
        .addColumn("created_at", "bigint", (c) => c.notNull())
        .addColumn("gender", "text", (c) => c.check(oneOf("gender", ["female", "male", "nonbinary"])))
        .addColumn("look", "text", (c) => c.check(jsonOrNull("look")))
        .execute();
      await db.schema
        .createTable("members")
        .addColumn("book_id", "text", (c) => c.notNull().references("books.id").onDelete("cascade"))
        .addColumn("user_id", "text", (c) => c.notNull().references("users.id").onDelete("cascade"))
        .addColumn("person_id", "text", (c) => c.notNull())
        .addColumn("created_at", "bigint", (c) => c.notNull())
        .addPrimaryKeyConstraint("members_pk", ["book_id", "user_id"])
        .addUniqueConstraint("members_person", ["book_id", "person_id"])
        .addForeignKeyConstraint("members_person_in_book", ["book_id", "person_id"], "persons", ["book_id", "id"])
        .execute();
      await bookTable(db, "aliases")
        .$call((t) => ref(t, "aliases", "person_id", "persons", "cascade", true))
        .addColumn("alias", "text", (c) => c.notNull())
        .addColumn("norm", "text", (c) => c.notNull())
        .addPrimaryKeyConstraint("aliases_pk", ["person_id", "norm"])
        .execute();
      await bookTable(db, "person_settings")
        .addColumn("user_id", "text", (c) => c.notNull().references("users.id").onDelete("cascade"))
        .$call((t) => ref(t, "person_settings", "person_id", "persons", "cascade", true))
        .addColumn("interval_days", "integer")
        .addColumn("interval_confirmed", "integer", (c) => c.notNull().defaultTo(0))
        .addPrimaryKeyConstraint("person_settings_pk", ["user_id", "person_id"])
        .execute();
      await bookTable(db, "participants")
        .$call((t) => ref(t, "participants", "conversation_id", "conversations", "cascade", true))
        .$call((t) => ref(t, "participants", "person_id", "persons", "cascade", true))
        .addPrimaryKeyConstraint("participants_pk", ["conversation_id", "person_id"])
        .execute();
      await bookTable(db, "place_owners")
        .$call((t) => ref(t, "place_owners", "place_id", "places", "cascade", true))
        .$call((t) => ref(t, "place_owners", "person_id", "persons", "cascade", true))
        .addColumn("visibility", "text", (c) => c.notNull().check(oneOf("visibility", VISIBILITY)))
        .addColumn("recorded_by", "text", (c) => c.notNull().references("users.id"))
        .$call((t) => ref(t, "place_owners", "ramble_id", "rambles", "cascade"))
        .addColumn("created_at", "bigint", (c) => c.notNull())
        .addPrimaryKeyConstraint("place_owners_pk", ["place_id", "person_id", "recorded_by"])
        .execute();
      await bookTable(db, "place_aliases")
        .$call((t) => ref(t, "place_aliases", "place_id", "places", "cascade", true))
        .addColumn("alias", "text", (c) => c.notNull())
        .addColumn("norm", "text", (c) => c.notNull())
        .addPrimaryKeyConstraint("place_aliases_pk", ["place_id", "norm"])
        .execute();
      await bookTable(db, "series_skips")
        .$call((t) => ref(t, "series_skips", "series_id", "series", "cascade", true))
        .addColumn("date", "text", (c) => c.notNull())
        .addPrimaryKeyConstraint("series_skips_pk", ["series_id", "date"])
        .execute();
      await bookTable(db, "experience_people")
        .$call((t) => ref(t, "experience_people", "experience_id", "experiences", "cascade", true))
        .$call((t) => ref(t, "experience_people", "person_id", "persons", "cascade", true))
        .addPrimaryKeyConstraint("experience_people_pk", ["experience_id", "person_id"])
        .execute();
      await keyed(bookTable(db, "journal_entries"), "journal_entries")
        .$call((t) => ref(t, "journal_entries", "ramble_id", "rambles", "cascade", true))
        .addColumn("date", "text", (c) => c.notNull())
        .addColumn("text", "text", (c) => c.notNull())
        .addColumn("visibility", "text", (c) => c.notNull().check(oneOf("visibility", VISIBILITY)))
        .addColumn("recorded_by", "text", (c) => c.notNull().references("users.id"))
        .addColumn("created_at", "bigint", (c) => c.notNull())
        .execute();
      await bookTable(db, "journal_mentions")
        .$call((t) => ref(t, "journal_mentions", "entry_id", "journal_entries", "cascade", true))
        .$call((t) => ref(t, "journal_mentions", "person_id", "persons", "cascade", true))
        .addPrimaryKeyConstraint("journal_mentions_pk", ["entry_id", "person_id"])
        .execute();
      await keyed(bookTable(db, "files"), "files")
        .addColumn("user_id", "text", (c) => c.notNull().references("users.id").onDelete("cascade"))
        .addColumn("sha256", "text", (c) => c.notNull())
        .addColumn("status", "text", (c) => c.notNull().check(oneOf("status", ["reading", "pending", "filed", "nothing", "failed"])))
        .addColumn("reading", "text")
        .addColumn("created_at", "bigint", (c) => c.notNull())
        .addColumn("media_type", "text", (c) => c.notNull().defaultTo("image/webp"))
        .addColumn("blob_key", "text")
        .addColumn("batch_id", "text")
        .addUniqueConstraint("files_user_sha", ["book_id", "user_id", "sha256"])
        .execute();
      await keyed(bookTable(db, "facts"), "facts")
        .$call((t) => ref(t, "facts", "person_id", "persons", "cascade", true))
        .addColumn("text", "text", (c) => c.notNull())
        .addColumn("category", "text", (c) => c.notNull())
        .addColumn("status", "text", (c) =>
          c
            .notNull()
            .defaultTo("current")
            .check(oneOf("status", ["current", "outdated"])),
        )
        .$call((t) => ref(t, "facts", "superseded_by", "facts", "set null"))
        .$call((t) => item(t, "facts"))
        .addColumn("source", "text")
        .addColumn("happened_on", "text")
        .$call((t) => ref(t, "facts", "file_id", "files", "set null"))
        .addColumn("kind", "text", (c) =>
          c
            .notNull()
            .defaultTo("lasting")
            .check(oneOf("kind", ["lasting", "situation", "need", "personality"])),
        )
        .addColumn("check_after", "text")
        .execute();
      await keyed(bookTable(db, "promises"), "promises")
        .$call((t) => ref(t, "promises", "person_id", "persons", "cascade", true))
        .addColumn("text", "text", (c) => c.notNull())
        .addColumn("by_me", "integer", (c) => c.notNull())
        .addColumn("due", "text")
        .addColumn("done", "integer", (c) => c.notNull().defaultTo(0))
        .$call((t) => item(t, "promises"))
        .execute();
      await keyed(bookTable(db, "dates"), "dates")
        .$call((t) => ref(t, "dates", "person_id", "persons", "cascade", true))
        .addColumn("kind", "text", (c) => c.notNull().check(oneOf("kind", ["birthday", "anniversary", "custom"])))
        .addColumn("date", "text", (c) => c.notNull())
        .addColumn("label", "text")
        .addColumn("yearly", "integer", (c) => c.notNull().defaultTo(1))
        .$call((t) => item(t, "dates"))
        .execute();
      await keyed(bookTable(db, "exchanges"), "exchanges")
        .$call((t) => ref(t, "exchanges", "person_id", "persons", "cascade", true))
        .addColumn("kind", "text", (c) => c.notNull().check(oneOf("kind", ["gift_idea", "gift", "money", "lent", "help"])))
        .addColumn("direction", "text", (c) => c.notNull().check(oneOf("direction", ["to_them", "from_them"])))
        .addColumn("text", "text", (c) => c.notNull())
        .addColumn("amount", "real")
        .addColumn("currency", "text")
        .addColumn("settled", "integer", (c) => c.notNull().defaultTo(0))
        .$call((t) => item(t, "exchanges"))
        .execute();
      await keyed(bookTable(db, "relationships"), "relationships")
        .$call((t) => ref(t, "relationships", "from_id", "persons", "cascade", true))
        .$call((t) => ref(t, "relationships", "to_id", "persons", "cascade", true))
        .addColumn("label", "text", (c) => c.notNull().check(notBlank("label")))
        .addColumn("inverse", "text", (c) => c.notNull().check(notBlank("inverse")))
        .addColumn("note", "text")
        .$call((t) => item(t, "relationships"))
        .execute();
      // `household`: the book's own group (Haushalt), its members' persons in it.
      await keyed(bookTable(db, "groups"), "groups")
        .addColumn("name", "text", (c) => c.notNull())
        .addColumn("created_by", "text", (c) => c.references("users.id").onDelete("set null"))
        .addColumn("created_at", "bigint", (c) => c.notNull().defaultTo(0))
        .addColumn("seeded", "integer", (c) => c.notNull().defaultTo(0))
        .addColumn("household", "integer", (c) => c.notNull().defaultTo(0))
        .execute();
      await bookTable(db, "group_aliases")
        .$call((t) => ref(t, "group_aliases", "group_id", "groups", "cascade", true))
        .addColumn("alias", "text", (c) => c.notNull())
        .addColumn("norm", "text", (c) => c.notNull())
        .addPrimaryKeyConstraint("group_aliases_pk", ["group_id", "norm"])
        .execute();
      await bookTable(db, "group_members")
        .$call((t) => ref(t, "group_members", "group_id", "groups", "cascade", true))
        .$call((t) => ref(t, "group_members", "person_id", "persons", "cascade", true))
        .addColumn("visibility", "text", (c) => c.notNull().check(oneOf("visibility", VISIBILITY)))
        .addColumn("recorded_by", "text", (c) => c.notNull().references("users.id"))
        .$call((t) => ref(t, "group_members", "conversation_id", "conversations", "cascade"))
        .$call((t) => ref(t, "group_members", "ramble_id", "rambles", "cascade"))
        .addPrimaryKeyConstraint("group_members_pk", ["group_id", "person_id", "recorded_by"])
        .execute();
      await bookTable(db, "card_subscriptions")
        .$call((t) => ref(t, "card_subscriptions", "person_id", "persons", "cascade", true))
        .addColumn("url", "text", (c) => c.notNull())
        .addColumn("card", "text", (c) => c.check(jsonOrNull("card")))
        .addColumn("fetched_at", "bigint")
        .addColumn("tried_at", "bigint")
        .addColumn("failed", "text")
        .addColumn("added_by", "text", (c) => c.notNull().references("users.id"))
        .addColumn("created_at", "bigint", (c) => c.notNull())
        .addPrimaryKeyConstraint("card_subscriptions_pk", ["person_id"])
        .execute();

      // ---- indexes --------------------------------------------------------------------------------------------------------
      const index = (name: string, table: string, columns: string[]) => db.schema.createIndex(name).on(table).columns(columns).execute();
      await db.schema.createIndex("groups_household").unique().on("groups").column("book_id").where(sql.ref("household"), "=", 1).execute();
      await index("members_by_user", "members", ["user_id"]);
      await index("aliases_by_norm", "aliases", ["book_id", "norm"]);
      await index("conversations_by_ramble", "conversations", ["ramble_id"]);
      await index("experiences_by_date", "experiences", ["recorded_by", "date"]);
      await index("experiences_by_series", "experiences", ["series_id"]);
      await index("journal_by_date", "journal_entries", ["recorded_by", "date"]);
      await index("place_owners_by_person", "place_owners", ["person_id"]);
      await index("places_by_parent", "places", ["parent_id"]);
      for (const t of ["facts", "promises", "dates", "exchanges"]) {
        await index(`${t}_by_person`, t, ["person_id"]);
        await index(`${t}_by_ramble`, t, ["ramble_id"]);
      }
      await index("relationships_by_from", "relationships", ["from_id"]);
      await index("relationships_by_to", "relationships", ["to_id"]);
      await index("relationships_by_ramble", "relationships", ["ramble_id"]);
      await index("group_members_by_ramble", "group_members", ["ramble_id"]);
    },
  },
  "002_books": {
    // A role for each member, and the calendar key per book and member: whoever made a book owns it, everyone else who is in it
    // already is an admin. A user's key from before is their oldest book's, so a subscribed calendar keeps working.
    async up(db: Kysely<any>) {
      await db.schema
        .alterTable("members")
        .addColumn("role", "text", (c) =>
          c
            .notNull()
            .defaultTo("member")
            .check(oneOf("role", ["owner", "admin", "member"])),
        )
        .execute();
      await db.schema.alterTable("members").addColumn("calendar_key_hash", "text").execute();
      await db.schema.createIndex("members_calendar_key").unique().on("members").column("calendar_key_hash").execute();
      await db.updateTable("members").set({ role: "admin" }).execute();
      for (const b of await db.selectFrom("books").select(["id", "created_by"]).execute())
        await db.updateTable("members").set({ role: "owner" }).where("book_id", "=", b.id).where("user_id", "=", b.created_by).execute();

      const members = await db.selectFrom("members").select(["user_id", "book_id"]).orderBy("created_at").orderBy("book_id").execute();
      const oldest = new Map<string, string>();
      for (const m of members) if (!oldest.has(m.user_id)) oldest.set(m.user_id, m.book_id);
      for (const k of await db.selectFrom("user_settings").select(["user_id", "calendar_key_hash"]).where("calendar_key_hash", "is not", null).execute()) {
        const book = oldest.get(k.user_id);
        if (book)
          await db
            .updateTable("members")
            .set({ calendar_key_hash: k.calendar_key_hash })
            .where("user_id", "=", k.user_id)
            .where("book_id", "=", book)
            .execute();
      }

      // SQLite can't drop a UNIQUE column, so user_settings is made again without it.
      const kept = ["user_id", "webhook_url", "share_key_hash", "reflection_day", "reflection_hour"];
      await db.schema
        .createTable("user_settings_new")
        .addColumn("user_id", "text", (c) => c.primaryKey().references("users.id").onDelete("cascade"))
        .addColumn("webhook_url", "text")
        .addColumn("share_key_hash", "text", (c) => c.unique())
        .addColumn("reflection_day", "integer")
        .addColumn("reflection_hour", "integer")
        .execute();
      await db.insertInto("user_settings_new").columns(kept).expression(db.selectFrom("user_settings").select(kept)).execute();
      await db.schema.dropTable("user_settings").execute();
      await db.schema.alterTable("user_settings_new").renameTo("user_settings").execute();
    },
  },
};

/** The migrations themselves, for the Postgres compile test. */
export const MIGRATIONS: Readonly<Record<string, Migration>> = migrations;

/** Every migration's name, in order; the tests check the count the migrator recorded against it, so a new one changes no test. */
export const MIGRATION_NAMES: readonly string[] = Object.keys(migrations);

// A migration table that names one this code does not have: the database was made by a newer freundebuch.
export const NEWER = "the database was made by a newer freundebuch than this one; upgrade freundebuch, do not point an older one at it";

/** Migrates up to and including `name`; for tests of a later migration against data an earlier one left. */
export async function migrateTo(db: Kysely<any>, name: string): Promise<void> {
  const { error } = await new Migrator({ db, provider: { getMigrations: async () => migrations } }).migrateTo(name);
  if (error) throw error;
}

export async function migrate(db: Kysely<any>): Promise<void> {
  const migrator = new Migrator({ db, provider: { getMigrations: async () => migrations } });
  const { error } = await migrator.migrateToLatest();
  if (!error) return;
  if (error instanceof Error && /migration/i.test(error.message) && /missing/i.test(error.message)) throw new Error(NEWER);
  throw error;
}
