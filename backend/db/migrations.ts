// Schema changes, in order. Never edit one that has shipped; add the next. Kept in code, not files, so the standalone build has
// nothing extra to trace. Kysely's Migrator records what ran in `kysely_migration`.
// The migrations run against whatever the schema was when they were written, so the database is untyped here.
/* eslint-disable @typescript-eslint/no-explicit-any */
import { Kysely, sql } from "kysely";
import { Migrator, type Migration } from "kysely/migration";
import { randomUUID } from "node:crypto";
import { norm } from "../names";

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

  // Groups you manage: who made one (null when that isn't known, as for groups from before), whether every household starts
  // with it, and other names that resolve to it, like a person's aliases.
  "002_groups": {
    async up(db: Kysely<any>) {
      await db.schema.alterTable("groups").addColumn("created_by", "text", (c) => c.references("users.id").onDelete("set null")).execute();
      await db.schema.alterTable("groups").addColumn("created_at", "integer", (c) => c.notNull().defaultTo(0)).execute();
      await db.schema.alterTable("groups").addColumn("seeded", "integer", (c) => c.notNull().defaultTo(0)).execute();
      const t = Date.now();
      await db.updateTable("groups").set({ created_at: t }).execute();
      await db.schema
        .createTable("group_aliases")
        .addColumn("group_id", "text", (c) => c.notNull().references("groups.id").onDelete("cascade"))
        .addColumn("alias", "text", (c) => c.notNull())
        .addColumn("norm", "text", (c) => c.notNull())
        .addPrimaryKeyConstraint("group_aliases_pk", ["group_id", "norm"])
        .execute();
      // Names are compared normalised from now on, so groups whose names differ only in case or spacing ("Uni", " uni") become
      // one, the oldest row: memberships move over, one row per person and recorder, and shared beats private.
      const all = await db.selectFrom("groups").select(["id", "name"]).orderBy(sql`rowid`).execute();
      const kept = new Map<string, string>();
      for (const g of all) {
        const keep = kept.get(norm(g.name));
        if (!keep) {
          kept.set(norm(g.name), g.id);
          continue;
        }
        for (const m of await db.selectFrom("group_members").selectAll().where("group_id", "=", g.id).execute()) {
          const there = await db
            .selectFrom("group_members")
            .select("visibility")
            .where("group_id", "=", keep)
            .where("person_id", "=", m.person_id)
            .where("recorded_by", "=", m.recorded_by)
            .executeTakeFirst();
          if (!there) await db.insertInto("group_members").values({ ...m, group_id: keep }).execute();
          else if (there.visibility === "private" && m.visibility === "shared")
            await db
              .updateTable("group_members")
              .set({ visibility: "shared" })
              .where("group_id", "=", keep)
              .where("person_id", "=", m.person_id)
              .where("recorded_by", "=", m.recorded_by)
              .execute();
        }
        await db.deleteFrom("groups").where("id", "=", g.id).execute();
      }

      // A seeded name that a group already has (however it was typed) gives that group the other names instead of a second group.
      const existing = await db.selectFrom("groups").select(["id", "name"]).execute();
      for (const g of SEEDED_GROUPS) {
        let id = existing.find((e) => norm(e.name) === norm(g.name))?.id;
        if (!id) {
          id = randomUUID();
          await db.insertInto("groups").values({ id, name: g.name, created_by: null, created_at: t, seeded: 1 }).execute();
        } else await db.updateTable("groups").set({ seeded: 1 }).where("id", "=", id).execute();
        for (const alias of g.aliases)
          await db.insertInto("group_aliases").values({ group_id: id, alias, norm: norm(alias) }).onConflict((oc) => oc.doNothing()).execute();
      }
    },
  },

  // How many messages each user sent the in-app chat on a day, for its daily limit.
  "003_chat_usage": {
    async up(db: Kysely<any>) {
      await db.schema
        .createTable("chat_usage")
        .addColumn("user_id", "text", (c) => c.notNull().references("users.id").onDelete("cascade"))
        .addColumn("day", "text", (c) => c.notNull())
        .addColumn("count", "integer", (c) => c.notNull())
        .addPrimaryKeyConstraint("chat_usage_pk", ["user_id", "day"])
        .execute();
    },
  },

  // Screenshots of social media posts that a user shared in (screenshots.ts). The image itself is in the blob store under
  // `screenshots/<id>.webp`. `reading` is what Claude read from it, as JSON, once it has. The same image shared twice by one
  // user (same sha256) is one row. A fact filed from a screenshot names it, with where it was posted and when it happened.
  // `share_key_hash`: the sha256 of the user's share key, the credential of the iPhone Shortcut; null when they have none.
  "004_screenshots": {
    async up(db: Kysely<any>) {
      await db.schema
        .createTable("screenshots")
        .addColumn("id", "text", (c) => c.primaryKey())
        .addColumn("user_id", "text", (c) => c.notNull().references("users.id").onDelete("cascade"))
        .addColumn("sha256", "text", (c) => c.notNull())
        .addColumn("status", "text", (c) => c.notNull().check(oneOf("status", ["reading", "pending", "filed", "nothing", "failed"])))
        .addColumn("reading", "text")
        .addColumn("created_at", "bigint", (c) => c.notNull())
        .addUniqueConstraint("screenshots_user_sha", ["user_id", "sha256"])
        .execute();
      await db.schema.alterTable("facts").addColumn("source", "text").execute();
      await db.schema.alterTable("facts").addColumn("happened_on", "text").execute();
      await db.schema
        .alterTable("facts")
        .addColumn("screenshot_id", "text", (c) => c.references("screenshots.id").onDelete("set null"))
        .execute();
      await db.schema.alterTable("user_settings").addColumn("share_key_hash", "text").execute();
      await db.schema.createIndex("user_settings_share_key").on("user_settings").column("share_key_hash").unique().execute();
    },
  },
};

/** The groups every household starts with, and their other names. */
export const SEEDED_GROUPS: readonly { name: string; aliases: string[] }[] = [
  { name: "Freunde", aliases: ["Freundeskreis"] },
  { name: "Familie", aliases: ["Verwandte"] },
  { name: "Arbeit", aliases: ["Kollegen", "Job"] },
];

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
