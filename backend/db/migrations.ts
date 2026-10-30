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
  // The same relationship recorded twice by one user (a chat that filed it again, parent and child both ways) is kept once:
  // the oldest, with a note taken from a dropped one if it had none. Self-contained, as the rules may change later.
  "005_relationship_duplicates": {
    async up(db) {
      const symmetric = new Set(["partner", "spouse", "sibling", "friend", "colleague", "other"]);
      const key = (r: { from_id: string; to_id: string; type: string }) =>
        r.type === "child" ? `parent:${r.to_id}:${r.from_id}` : symmetric.has(r.type) ? `${r.type}:${[r.from_id, r.to_id].sort().join(":")}` : `${r.type}:${r.from_id}:${r.to_id}`;
      const norm = (n: string | null) => (n ?? "").trim().toLowerCase();
      const rows: { id: string; from_id: string; to_id: string; type: string; note: string | null; recorded_by: string; visibility: string }[] = await db
        .selectFrom("relationships")
        .select(["id", "from_id", "to_id", "type", "note", "recorded_by", "visibility"])
        .orderBy("created_at")
        .orderBy("id")
        .execute();
      const kept: typeof rows = [];
      for (const r of rows) {
        const same = kept.find(
          (k) => k.recorded_by === r.recorded_by && k.visibility === r.visibility && key(k) === key(r) && (r.type !== "other" || !norm(k.note) || !norm(r.note) || norm(k.note) === norm(r.note)),
        );
        if (!same) {
          kept.push(r);
          continue;
        }
        if (!norm(same.note) && norm(r.note)) {
          same.note = r.note;
          await db.updateTable("relationships").set({ note: r.note }).where("id", "=", same.id).execute();
        }
        await db.deleteFrom("relationships").where("id", "=", r.id).execute();
      }
    },
  },
  // `calendar_key_hash`: the sha256 of the user's calendar key, the secret in their ICS feed's URL; null when they have none.
  "006_calendar_key": {
    async up(db) {
      await db.schema.alterTable("user_settings").addColumn("calendar_key_hash", "text").execute();
      await db.schema.createIndex("user_settings_calendar_key").on("user_settings").column("calendar_key_hash").unique().execute();
    },
  },
  // A relationship says in words what each end is: `label` what `from` is to `to` ("Vermieterin"), `inverse` what `to` is to
  // `from` ("Mieter"), so a role to the household ("our landlady") needs no fixed type. relationships is rebuilt without `type`;
  // each old type becomes its gender-neutral words, an `other` its note (what it was in words), and nothing
  // references relationships.id. Facts are lasting or a situation with a day to ask again (`check_after`); every existing fact
  // is lasting. Persons get an optional gender, which Claude writes the labels in.
  "007_roles_situations_gender": {
    async up(db) {
      const person = (c: any) => c.notNull().references("persons.id").onDelete("cascade");
      const words = (column: string) => sql`${sql.ref(column)} is not null and length(trim(${sql.ref(column)})) > 0`;
      await db.schema
        .createTable("relationships_007")
        .addColumn("id", "text", (c) => c.primaryKey())
        .addColumn("from_id", "text", person)
        .addColumn("to_id", "text", person)
        .addColumn("label", "text", (c) => c.notNull().check(words("label")))
        .addColumn("inverse", "text", (c) => c.notNull().check(words("inverse")))
        .addColumn("note", "text")
        .addColumn("visibility", "text", (c) => c.notNull().check(oneOf("visibility", VISIBILITY)))
        .addColumn("recorded_by", "text", (c) => c.notNull().references("users.id"))
        .addColumn("conversation_id", "text", (c) => c.references("conversations.id").onDelete("cascade"))
        .addColumn("created_at", "bigint", (c) => c.notNull())
        .execute();
      // The words of each type 006 knew; an `other` is what its note says.
      const old: Record<string, [string, string]> = {
        partner: ["Partner:in", "Partner:in"],
        spouse: ["Ehepartner:in", "Ehepartner:in"],
        parent: ["Elternteil", "Kind"],
        child: ["Kind", "Elternteil"],
        sibling: ["Geschwister", "Geschwister"],
        friend: ["Freund:in", "Freund:in"],
        colleague: ["Kolleg:in", "Kolleg:in"],
        introduced_by: ["vorgestellt", "hat vorgestellt"],
        other: ["Bekannte:r", "Bekannte:r"],
      };
      const rows = await db.selectFrom("relationships").selectAll().execute();
      for (const r of rows) {
        const said = r.type === "other" ? r.note?.trim() || null : null;
        const [label, inverse] = said ? [said, said] : old[r.type];
        await db
          .insertInto("relationships_007")
          .values({
            id: r.id,
            from_id: r.from_id,
            to_id: r.to_id,
            label,
            inverse,
            note: said ? null : r.note,
            visibility: r.visibility,
            recorded_by: r.recorded_by,
            conversation_id: r.conversation_id,
            created_at: r.created_at,
          })
          .execute();
      }
      await db.schema.dropTable("relationships").execute();
      await db.schema.alterTable("relationships_007").renameTo("relationships").execute();
      await db.schema.createIndex("relationships_by_from").on("relationships").column("from_id").execute();
      await db.schema.createIndex("relationships_by_to").on("relationships").column("to_id").execute();

      await db.schema
        .alterTable("facts")
        .addColumn("kind", "text", (c) => c.notNull().defaultTo("lasting").check(oneOf("kind", ["lasting", "situation"])))
        .execute();
      await db.schema.alterTable("facts").addColumn("check_after", "text").execute();
      await db.schema
        .alterTable("persons")
        .addColumn("gender", "text", (c) => c.check(oneOf("gender", ["female", "male", "nonbinary"])))
        .execute();
    },
  },

  // A fact may also be a trait: a need to plan around or how the person is. SQLite can't change a CHECK, so `facts` is rebuilt.
  // Dropping the old table sets every `superseded_by` pointing into it to null, so the links are written back after the rename.
  "008_traits": {
    async up(db) {
      // SQLite keeps DDL in a transaction, but the Migrator doesn't open one: a failure must not leave facts half rebuilt.
      await db.transaction().execute(async (tx) => {
        await tx.schema
          .createTable("facts_008")
          .addColumn("id", "text", (c) => c.primaryKey())
          .addColumn("person_id", "text", (c) => c.notNull().references("persons.id").onDelete("cascade"))
          .addColumn("text", "text", (c) => c.notNull())
          .addColumn("category", "text", (c) => c.notNull())
          .addColumn("status", "text", (c) => c.notNull().defaultTo("current").check(oneOf("status", ["current", "outdated"])))
          .addColumn("superseded_by", "text", (c) => c.references("facts.id").onDelete("set null"))
          .addColumn("visibility", "text", (c) => c.notNull().check(oneOf("visibility", VISIBILITY)))
          .addColumn("recorded_by", "text", (c) => c.notNull().references("users.id"))
          .addColumn("conversation_id", "text", (c) => c.references("conversations.id").onDelete("cascade"))
          .addColumn("created_at", "bigint", (c) => c.notNull())
          .addColumn("source", "text")
          .addColumn("happened_on", "text")
          .addColumn("screenshot_id", "text", (c) => c.references("screenshots.id").onDelete("set null"))
          .addColumn("kind", "text", (c) => c.notNull().defaultTo("lasting").check(oneOf("kind", ["lasting", "situation", "need", "personality"])))
          .addColumn("check_after", "text")
          .execute();
        const links = await tx.selectFrom("facts").select(["id", "superseded_by"]).where("superseded_by", "is not", null).execute();
        await sql`insert into facts_008 (id, person_id, text, category, status, superseded_by, visibility, recorded_by, conversation_id, created_at, source, happened_on, screenshot_id, kind, check_after)
          select id, person_id, text, category, status, null, visibility, recorded_by, conversation_id, created_at, source, happened_on, screenshot_id, kind, check_after from facts`.execute(tx);
        await tx.schema.dropTable("facts").execute();
        await tx.schema.alterTable("facts_008").renameTo("facts").execute();
        for (const l of links) await tx.updateTable("facts").set({ superseded_by: l.superseded_by }).where("id", "=", l.id).execute();
        await tx.schema.createIndex("facts_by_person").on("facts").column("person_id").execute();
      });
    },
  },

  // Haushalt: the group of everyone who signs in, so the partner is in a group like anyone else. It may be renamed (Herziis),
  // never deleted, merged away or emptied of a household person. A group already called Haushalt becomes it.
  "009_household_group": {
    async up(db) {
      await db.transaction().execute(async (tx) => {
        await tx.schema.alterTable("groups").addColumn("household", "integer", (c) => c.notNull().defaultTo(0)).execute();
        const t = Date.now();
        const existing = await tx.selectFrom("groups").select(["id", "name"]).orderBy("created_at").execute();
        let id = existing.find((g) => norm(g.name) === norm(HOUSEHOLD_GROUP))?.id;
        if (!id) {
          id = randomUUID();
          await tx.insertInto("groups").values({ id, name: HOUSEHOLD_GROUP, created_by: null, created_at: t, seeded: 1, household: 1 }).execute();
        } else await tx.updateTable("groups").set({ seeded: 1, household: 1 }).where("id", "=", id).execute();
        const users = await tx.selectFrom("users").select(["id", "person_id"]).where("person_id", "is not", null).execute();
        for (const u of users)
          await tx
            .insertInto("group_members")
            .values({ group_id: id, person_id: u.person_id, visibility: "shared", recorded_by: u.id, conversation_id: null })
            .onConflict((oc) => oc.doNothing())
            .execute();
      });
    },
  },

  // Shared files, not only screenshots: the table and the facts' link are renamed, and each file says its type and where its
  // blob is. Blobs already stored stay under their key (screenshots/<id>.webp); new ones go to files/<id>.<ext>.
  "010_files": {
    async up(db) {
      await db.transaction().execute(async (tx) => {
        await tx.schema.alterTable("screenshots").renameTo("files").execute();
        await tx.schema.alterTable("facts").renameColumn("screenshot_id", "file_id").execute();
        await tx.schema.alterTable("files").addColumn("media_type", "text", (c) => c.notNull().defaultTo("image/webp")).execute();
        await tx.schema.alterTable("files").addColumn("blob_key", "text").execute();
        await sql`update files set blob_key = 'screenshots/' || id || '.webp'`.execute(tx);
      });
    },
  },


  // A ramble (what the user told, word for word) is its own record, so one can be split into journal entries, conversations
  // and items that all point to it. Each conversation's transcript moves into a ramble of its own, under the conversation's
  // id. No rebuild of conversations: other tables cascade from it, so its columns are added and dropped in place.
  "011_rambles": {
    async up(db) {
      await db.transaction().execute(async (tx) => {
        await tx.schema
          .createTable("rambles")
          .addColumn("id", "text", (c) => c.primaryKey())
          .addColumn("date", "text", (c) => c.notNull())
          .addColumn("transcript", "text", (c) => c.notNull())
          .addColumn("transcript_private", "integer", (c) => c.notNull().defaultTo(0))
          .addColumn("visibility", "text", (c) => c.notNull().check(oneOf("visibility", VISIBILITY)))
          .addColumn("recorded_by", "text", (c) => c.notNull().references("users.id"))
          .addColumn("created_at", "bigint", (c) => c.notNull())
          .execute();
        await sql`insert into rambles (id, date, transcript, transcript_private, visibility, recorded_by, created_at)
          select id, date, transcript, transcript_private, visibility, recorded_by, created_at from conversations`.execute(tx);
        await tx.schema.alterTable("conversations").addColumn("ramble_id", "text", (c) => c.references("rambles.id").onDelete("cascade")).execute();
        await sql`update conversations set ramble_id = id`.execute(tx);
        await tx.schema.alterTable("conversations").dropColumn("transcript").execute();
        await tx.schema.alterTable("conversations").dropColumn("transcript_private").execute();
        await tx.schema.createIndex("conversations_by_ramble").on("conversations").column("ramble_id").execute();
      });
    },
  },

  // The journal: entries about the user's own life, cut from a ramble, private unless shared, and the people they name.
  "012_journal": {
    async up(db) {
      await db.schema
        .createTable("journal_entries")
        .addColumn("id", "text", (c) => c.primaryKey())
        .addColumn("ramble_id", "text", (c) => c.notNull().references("rambles.id").onDelete("cascade"))
        .addColumn("date", "text", (c) => c.notNull())
        .addColumn("text", "text", (c) => c.notNull())
        .addColumn("visibility", "text", (c) => c.notNull().check(oneOf("visibility", VISIBILITY)))
        .addColumn("recorded_by", "text", (c) => c.notNull().references("users.id"))
        .addColumn("created_at", "bigint", (c) => c.notNull())
        .execute();
      await db.schema.createIndex("journal_by_date").on("journal_entries").columns(["recorded_by", "date"]).execute();
      await db.schema
        .createTable("journal_mentions")
        .addColumn("entry_id", "text", (c) => c.notNull().references("journal_entries.id").onDelete("cascade"))
        .addColumn("person_id", "text", (c) => c.notNull().references("persons.id").onDelete("cascade"))
        .addPrimaryKeyConstraint("journal_mentions_pk", ["entry_id", "person_id"])
        .execute();
    },
  },

  // The weekly reflection on the journal: the weekday (0 Sunday … 6 Saturday) and hour it comes; both null, it is off.
  "013_reflection": {
    async up(db) {
      await db.schema.alterTable("user_settings").addColumn("reflection_day", "integer").execute();
      await db.schema.alterTable("user_settings").addColumn("reflection_hour", "integer").execute();
    },
  },

  // Every item points to the ramble it was told in, with a conversation or without one (null: filed outside a ramble, with
  // remember or relate). A ramble's transcript privacy and its deletion reach every item through it.
  "014_ramble_items": {
    async up(db) {
      for (const t of ["facts", "promises", "dates", "exchanges", "relationships", "group_members"]) {
        await db.schema
          .alterTable(t)
          .addColumn("ramble_id", "text", (c) => c.references("rambles.id").onDelete("cascade"))
          .execute();
        await sql`update ${sql.table(t)} set ramble_id = (select ramble_id from conversations where conversations.id = ${sql.ref(`${t}.conversation_id`)}) where conversation_id is not null`.execute(db);
        await db.schema.createIndex(`${t}_by_ramble`).on(t).column("ramble_id").execute();
      }
    },
  },

  // Places are records of their own, with other names as people have: each recorder's free-text conversation places become
  // one place per distinct name, and conversations point to it.
  "015_places": {
    async up(db) {
      await db.schema
        .createTable("places")
        .addColumn("id", "text", (c) => c.primaryKey())
        .addColumn("name", "text", (c) => c.notNull())
        .addColumn("created_by", "text", (c) => c.notNull().references("users.id"))
        .addColumn("created_at", "bigint", (c) => c.notNull())
        .execute();
      await db.schema
        .createTable("place_aliases")
        .addColumn("place_id", "text", (c) => c.notNull().references("places.id").onDelete("cascade"))
        .addColumn("alias", "text", (c) => c.notNull())
        .addColumn("norm", "text", (c) => c.notNull())
        .addPrimaryKeyConstraint("place_aliases_pk", ["place_id", "norm"])
        .execute();
      await db.schema
        .alterTable("conversations")
        .addColumn("place_id", "text", (c) => c.references("places.id").onDelete("set null"))
        .execute();
      const rows = await db.selectFrom("conversations").select(["id", "recorded_by", "place", "created_at"]).where("place", "is not", null).orderBy("created_at").execute();
      const made = new Map<string, string>();
      for (const r of rows as Array<{ id: string; recorded_by: string; place: string; created_at: number }>) {
        const name = r.place.trim();
        if (!name) continue;
        const key = `${r.recorded_by}\u0000${norm(name)}`;
        let id = made.get(key);
        if (!id) {
          id = crypto.randomUUID();
          made.set(key, id);
          await db.insertInto("places").values({ id, name, created_by: r.recorded_by, created_at: r.created_at }).execute();
        }
        await db.updateTable("conversations").set({ place_id: id }).where("id", "=", r.id).execute();
      }
      await db.schema.alterTable("conversations").dropColumn("place").execute();
    },
  },

  // What the user lived through: experiences, parts of a ramble, optionally sessions of a series (a course, a weekly
  // training) with a rhythm in days. A series has no ramble: it stays a memory until the user deletes it, and its sessions
  // then stay as single experiences. A conversation may say which experience it happened at.
  "016_experiences": {
    async up(db) {
      await db.schema
        .createTable("series")
        .addColumn("id", "text", (c) => c.primaryKey())
        .addColumn("name", "text", (c) => c.notNull())
        .addColumn("kind", "text", (c) => c.notNull())
        .addColumn("rhythm_days", "integer", (c) => c.check(sql`rhythm_days is null or rhythm_days between 1 and 366`))
        .addColumn("starts_on", "text")
        .addColumn("ends_on", "text")
        .addColumn("place_id", "text", (c) => c.references("places.id").onDelete("set null"))
        .addColumn("visibility", "text", (c) => c.notNull().check(oneOf("visibility", VISIBILITY)))
        .addColumn("recorded_by", "text", (c) => c.notNull().references("users.id"))
        .addColumn("created_at", "bigint", (c) => c.notNull())
        .execute();
      await db.schema
        .createTable("series_skips")
        .addColumn("series_id", "text", (c) => c.notNull().references("series.id").onDelete("cascade"))
        .addColumn("date", "text", (c) => c.notNull())
        .addPrimaryKeyConstraint("series_skips_pk", ["series_id", "date"])
        .execute();
      await db.schema
        .createTable("experiences")
        .addColumn("id", "text", (c) => c.primaryKey())
        .addColumn("ramble_id", "text", (c) => c.notNull().references("rambles.id").onDelete("cascade"))
        .addColumn("series_id", "text", (c) => c.references("series.id").onDelete("set null"))
        .addColumn("place_id", "text", (c) => c.references("places.id").onDelete("set null"))
        .addColumn("date", "text", (c) => c.notNull())
        .addColumn("kind", "text", (c) => c.notNull())
        .addColumn("title", "text", (c) => c.notNull())
        .addColumn("summary", "text")
        .addColumn("visibility", "text", (c) => c.notNull().check(oneOf("visibility", VISIBILITY)))
        .addColumn("recorded_by", "text", (c) => c.notNull().references("users.id"))
        .addColumn("created_at", "bigint", (c) => c.notNull())
        .execute();
      await db.schema.createIndex("experiences_by_date").on("experiences").columns(["recorded_by", "date"]).execute();
      await db.schema.createIndex("experiences_by_series").on("experiences").column("series_id").execute();
      await db.schema
        .createTable("experience_people")
        .addColumn("experience_id", "text", (c) => c.notNull().references("experiences.id").onDelete("cascade"))
        .addColumn("person_id", "text", (c) => c.notNull().references("persons.id").onDelete("cascade"))
        .addPrimaryKeyConstraint("experience_people_pk", ["experience_id", "person_id"])
        .execute();
      await db.schema
        .alterTable("conversations")
        .addColumn("experience_id", "text", (c) => c.references("experiences.id").onDelete("set null"))
        .execute();
    },
  },
  // Files shared in one go carry the client's batch id: a hint that groups and pre-selects them under Prüfen, nothing more.
  "017_file_batches": {
    async up(db) {
      await db.schema.alterTable("files").addColumn("batch_id", "text").execute();
    },
  },

  // A place may sit inside another (the Olympiahalle in München), have an address in words, and be someone's home. Whose home it
  // is can be told in confidence, so an ownership carries a visibility and its recorder like any item; each user files their own.
  "018_place_nesting": {
    async up(db) {
      await db.schema
        .alterTable("places")
        .addColumn("parent_id", "text", (c) => c.references("places.id").onDelete("set null"))
        .execute();
      await db.schema.alterTable("places").addColumn("address", "text").execute();
      await db.schema.createIndex("places_by_parent").on("places").column("parent_id").execute();
      await db.schema
        .createTable("place_owners")
        .addColumn("place_id", "text", (c) => c.notNull().references("places.id").onDelete("cascade"))
        .addColumn("person_id", "text", (c) => c.notNull().references("persons.id").onDelete("cascade"))
        .addColumn("visibility", "text", (c) => c.notNull().check(oneOf("visibility", VISIBILITY)))
        .addColumn("recorded_by", "text", (c) => c.notNull().references("users.id"))
        .addColumn("created_at", "bigint", (c) => c.notNull())
        .addPrimaryKeyConstraint("place_owners_pk", ["place_id", "person_id", "recorded_by"])
        .execute();
      await db.schema.createIndex("place_owners_by_person").on("place_owners").column("person_id").execute();
    },
  },
};

/** The name the household's own group starts with. */
export const HOUSEHOLD_GROUP = "Haushalt";

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
