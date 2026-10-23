// Schema changes, in order. Never edit one that has shipped; add the next. Kept in code, not files, so the standalone build has
// nothing extra to trace. Kysely's Migrator records what ran in `kysely_migration`.
// The migrations run against whatever the schema was when they were written, so the database is untyped here.
/* eslint-disable @typescript-eslint/no-explicit-any */
import { Kysely, sql } from "kysely";
import { Migrator, type Migration } from "kysely/migration";

// The vocabularies of backend/types.ts as they were when this migration was written, checked by the database as well: a write
// path that forgets to check a value still can't store a bad one.
const oneOf = (column: string, values: readonly string[]) => sql`${sql.ref(column)} in (${sql.join(values.map((v) => sql.lit(v)))})`;
const VISIBILITY = ["shared", "private"];

// Every id is a text UUID, every time a bigint in ms. An item's `conversation_id` is null for what no conversation recorded
// (a relationship or group set directly); deleting a conversation or a person takes their items with them.
const migrations: Record<string, Migration> = {
  "001_initial": {
    async up(db: Kysely<any>) {
      await db.schema
        .createTable("users")
        .addColumn("id", "text", (c) => c.primaryKey())
        .addColumn("oidc_sub", "text", (c) => c.notNull().unique())
        .addColumn("name", "text", (c) => c.notNull())
        .addColumn("email", "text")
        .addColumn("person_id", "text") // the user's own person; set once it exists
        .addColumn("created_at", "bigint", (c) => c.notNull())
        .execute();
      await db.schema
        .createTable("conversations")
        .addColumn("id", "text", (c) => c.primaryKey())
        .addColumn("date", "text", (c) => c.notNull())
        .addColumn("kind", "text", (c) => c.notNull().check(oneOf("kind", ["in_person", "call", "message", "video", "event"])))
        .addColumn("place", "text")
        .addColumn("summary", "text", (c) => c.notNull())
        .addColumn("transcript", "text", (c) => c.notNull())
        .addColumn("transcript_private", "integer", (c) => c.notNull().defaultTo(0))
        .addColumn("visibility", "text", (c) => c.notNull().check(oneOf("visibility", VISIBILITY)))
        .addColumn("recorded_by", "text", (c) => c.notNull().references("users.id"))
        .addColumn("created_at", "bigint", (c) => c.notNull())
        .execute();
      await db.schema
        .createTable("persons")
        .addColumn("id", "text", (c) => c.primaryKey())
        .addColumn("name", "text", (c) => c.notNull())
        .addColumn("created_by", "text", (c) => c.notNull().references("users.id"))
        .addColumn("created_from", "text", (c) => c.references("conversations.id").onDelete("set null"))
        .addColumn("created_at", "bigint", (c) => c.notNull())
        .execute();
      await db.schema
        .createTable("aliases")
        .addColumn("person_id", "text", (c) => c.notNull().references("persons.id").onDelete("cascade"))
        .addColumn("alias", "text", (c) => c.notNull())
        .addColumn("norm", "text", (c) => c.notNull())
        .execute();
      await db.schema.createIndex("aliases_by_norm").on("aliases").column("norm").execute();
      await db.schema.createIndex("aliases_unique").unique().on("aliases").columns(["person_id", "norm"]).execute();
      await db.schema
        .createTable("person_settings")
        .addColumn("user_id", "text", (c) => c.notNull().references("users.id").onDelete("cascade"))
        .addColumn("person_id", "text", (c) => c.notNull().references("persons.id").onDelete("cascade"))
        .addColumn("interval_days", "integer")
        .addColumn("interval_confirmed", "integer", (c) => c.notNull().defaultTo(0))
        .addPrimaryKeyConstraint("person_settings_pk", ["user_id", "person_id"])
        .execute();
      await db.schema
        .createTable("participants")
        .addColumn("conversation_id", "text", (c) => c.notNull().references("conversations.id").onDelete("cascade"))
        .addColumn("person_id", "text", (c) => c.notNull().references("persons.id").onDelete("cascade"))
        .addPrimaryKeyConstraint("participants_pk", ["conversation_id", "person_id"])
        .execute();

      // The item tables share these columns (after their own); `item` adds them.
      const item = (t: any) =>
        t
          .addColumn("visibility", "text", (c: any) => c.notNull().check(oneOf("visibility", VISIBILITY)))
          .addColumn("recorded_by", "text", (c: any) => c.notNull().references("users.id"))
          .addColumn("conversation_id", "text", (c: any) => c.references("conversations.id").onDelete("cascade"))
          .addColumn("created_at", "bigint", (c: any) => c.notNull());
      const person = (c: any) => c.notNull().references("persons.id").onDelete("cascade");

      await item(
        db.schema
          .createTable("facts")
          .addColumn("id", "text", (c) => c.primaryKey())
          .addColumn("person_id", "text", person)
          .addColumn("text", "text", (c) => c.notNull())
          .addColumn("category", "text", (c) => c.notNull())
          .addColumn("status", "text", (c) => c.notNull().defaultTo("current").check(oneOf("status", ["current", "outdated"])))
          // On an outdated fact: the fact that replaced it, so that one can't turn private later and leave the old one without a successor.
          .addColumn("superseded_by", "text", (c) => c.references("facts.id").onDelete("set null")),
      ).execute();
      await item(
        db.schema
          .createTable("promises")
          .addColumn("id", "text", (c) => c.primaryKey())
          .addColumn("person_id", "text", person)
          .addColumn("text", "text", (c) => c.notNull())
          .addColumn("by_me", "integer", (c) => c.notNull())
          .addColumn("due", "text")
          .addColumn("done", "integer", (c) => c.notNull().defaultTo(0)),
      ).execute();
      await item(
        db.schema
          .createTable("dates")
          .addColumn("id", "text", (c) => c.primaryKey())
          .addColumn("person_id", "text", person)
          .addColumn("kind", "text", (c) => c.notNull().check(oneOf("kind", ["birthday", "anniversary", "custom"])))
          .addColumn("date", "text", (c) => c.notNull())
          .addColumn("label", "text")
          .addColumn("yearly", "integer", (c) => c.notNull().defaultTo(1)),
      ).execute();
      await item(
        db.schema
          .createTable("exchanges")
          .addColumn("id", "text", (c) => c.primaryKey())
          .addColumn("person_id", "text", person)
          .addColumn("kind", "text", (c) => c.notNull().check(oneOf("kind", ["gift_idea", "gift", "money", "lent", "help"])))
          .addColumn("direction", "text", (c) => c.notNull().check(oneOf("direction", ["to_them", "from_them"])))
          .addColumn("text", "text", (c) => c.notNull())
          .addColumn("amount", "real")
          .addColumn("currency", "text")
          .addColumn("settled", "integer", (c) => c.notNull().defaultTo(0)),
      ).execute();
      await item(
        db.schema
          .createTable("relationships")
          .addColumn("id", "text", (c) => c.primaryKey())
          .addColumn("from_id", "text", person)
          .addColumn("to_id", "text", person)
          .addColumn("type", "text", (c) =>
            c.notNull().check(oneOf("type", ["partner", "spouse", "parent", "child", "sibling", "friend", "colleague", "introduced_by", "other"])),
          )
          .addColumn("note", "text"),
      ).execute();
      for (const t of ["facts", "promises", "dates", "exchanges"]) await db.schema.createIndex(`${t}_by_person`).on(t).column("person_id").execute();
      await db.schema.createIndex("relationships_by_from").on("relationships").column("from_id").execute();
      await db.schema.createIndex("relationships_by_to").on("relationships").column("to_id").execute();

      await db.schema
        .createTable("groups")
        .addColumn("id", "text", (c) => c.primaryKey())
        .addColumn("name", "text", (c) => c.notNull())
        .execute();
      await db.schema
        .createTable("group_members")
        .addColumn("group_id", "text", (c) => c.notNull().references("groups.id").onDelete("cascade"))
        .addColumn("person_id", "text", person)
        .addColumn("visibility", "text", (c) => c.notNull().check(oneOf("visibility", VISIBILITY)))
        .addColumn("recorded_by", "text", (c) => c.notNull().references("users.id"))
        .addColumn("conversation_id", "text", (c) => c.references("conversations.id").onDelete("cascade")) // null when set directly
        // One row per recorder: each user's membership keeps its own visibility, so a private one never blocks or reveals itself
        // to the partner's shared one. Reads dedupe per viewer.
        .addPrimaryKeyConstraint("group_members_pk", ["group_id", "person_id", "recorded_by"])
        .execute();
      await db.schema
        .createTable("user_settings")
        .addColumn("user_id", "text", (c) => c.primaryKey().references("users.id").onDelete("cascade"))
        .addColumn("webhook_url", "text")
        .execute();
      await db.schema
        .createTable("meta")
        .addColumn("key", "text", (c) => c.primaryKey())
        .addColumn("value", "text", (c) => c.notNull())
        .execute();
    },
  },
};

/** Every migration's name, in order; the tests check the count the migrator recorded against it, so a new one changes no test. */
export const MIGRATION_NAMES: readonly string[] = Object.keys(migrations);

// A migration table that names one this code does not have: the database was made by a newer freundebuch.
export const NEWER = "the database was made by a newer freundebuch than this one; upgrade freundebuch, do not point an older one at it";

export async function migrate(db: Kysely<any>): Promise<void> {
  const migrator = new Migrator({ db, provider: { getMigrations: async () => migrations } });
  const { error } = await migrator.migrateToLatest();
  if (!error) return;
  if (error instanceof Error && /migration/i.test(error.message) && /missing/i.test(error.message)) throw new Error(NEWER);
  throw error;
}
