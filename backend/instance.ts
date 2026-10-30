// The instance around the books (ADR 0022): which households there are, who signs in to which, and the invitations into one.
// Kept in instance.db, apart from every book: nothing here is about the people in a book, so nothing here can leak one.
// An instance with FREUNDEBUCH_HOUSEHOLDS=one (the default) has only "home", and everyone who signs in is in it, as always.
// With many, a first sign-in joins the household its invitation is for, or starts a household of its own.
import { createHash, randomBytes } from "node:crypto";
import { join } from "node:path";
import { Kysely } from "kysely";
import { Migrator, type Migration } from "kysely/migration";
import { config } from "./config";
import { connect } from "./db/connect";
import { HOME, isHouseholdId, newId, now } from "./db";
import { InvalidInputError, NotFoundError } from "./errors";
import { processState } from "./state";
import type { Viewer } from "./types";

export type InstanceSchema = {
  households: { id: string; created_at: number };
  /** One per sign-in identity: the user it is in its household's book, and that household. */
  accounts: { oidc_sub: string; user_id: string; household_id: string; created_at: number };
  /** An invitation into a household; only its hash is kept. Used once, or not after `expires_at`. */
  invites: { hash: string; household_id: string; created_by: string; expires_at: number; used_at: number | null };
};

// Shipped migrations are never edited; add the next.
const migrations: Record<string, Migration> = {
  "001_households": {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    async up(db: Kysely<any>) {
      await db.schema
        .createTable("households")
        .addColumn("id", "text", (c) => c.primaryKey())
        .addColumn("created_at", "integer", (c) => c.notNull())
        .execute();
      await db.schema
        .createTable("accounts")
        .addColumn("oidc_sub", "text", (c) => c.primaryKey())
        .addColumn("user_id", "text", (c) => c.notNull().unique())
        .addColumn("household_id", "text", (c) => c.notNull().references("households.id"))
        .addColumn("created_at", "integer", (c) => c.notNull())
        .execute();
      await db.schema
        .createTable("invites")
        .addColumn("hash", "text", (c) => c.primaryKey())
        .addColumn("household_id", "text", (c) => c.notNull().references("households.id"))
        .addColumn("created_by", "text", (c) => c.notNull())
        .addColumn("expires_at", "integer", (c) => c.notNull())
        .addColumn("used_at", "integer")
        .execute();
    },
  },
};

const state = processState("instance", () => ({ db: undefined as Promise<Kysely<InstanceSchema>> | undefined }));

async function open(file: string): Promise<Kysely<InstanceSchema>> {
  const d = (await connect(file)) as unknown as Kysely<InstanceSchema>;
  const { error } = await new Migrator({ db: d, provider: { getMigrations: async () => migrations } }).migrateToLatest();
  if (error) {
    await d.destroy();
    throw error;
  }
  return d;
}

/** The instance database: `${DATA_DIR}/instance.db`, opened and migrated on first use. */
export function instanceDb(): Promise<Kysely<InstanceSchema>> {
  if (!state.db) {
    const p = open(join(config.dataDir(), "instance.db"));
    state.db = p;
    p.catch(() => {
      if (state.db === p) state.db = undefined;
    });
  }
  return state.db;
}

/** Test only: a fresh, in-memory instance database. */
export async function resetInstanceForTests(): Promise<void> {
  const old = state.db;
  state.db = open(":memory:");
  await state.db;
  if (old) await (await old.catch(() => undefined))?.destroy();
}

/** The household a user is in. A user from before households were kept here is in home. */
export async function householdOf(userId: string): Promise<string> {
  const r = await (await instanceDb()).selectFrom("accounts").select("household_id").where("user_id", "=", userId).executeTakeFirst();
  return r?.household_id ?? HOME;
}

/** Every household, home first, then oldest first. For what runs for each book (reminders, clean-up). Home is always one: its
 * users may not have signed in since households were kept here. */
export async function households(): Promise<string[]> {
  const rows = await (await instanceDb()).selectFrom("households").select("id").where("id", "!=", HOME).orderBy("created_at").execute();
  return [HOME, ...rows.map((r) => r.id)];
}

/** What a sign-in identity already is: its household and user, or null on its first sign-in to this instance. */
export async function accountOf(sub: string): Promise<{ householdId: string; userId: string } | null> {
  const r = await (await instanceDb()).selectFrom("accounts").select(["household_id", "user_id"]).where("oidc_sub", "=", sub).executeTakeFirst();
  return r ? { householdId: r.household_id, userId: r.user_id } : null;
}

/** Records a sign-in identity as `userId` in the household; the household is recorded too when it is new. */
export async function addAccount(sub: string, userId: string, householdId: string): Promise<void> {
  const d = await instanceDb();
  await d.transaction().execute(async (tx) => {
    await tx
      .insertInto("households")
      .values({ id: householdId, created_at: now() })
      .onConflict((oc) => oc.column("id").doNothing())
      .execute();
    await tx.insertInto("accounts").values({ oidc_sub: sub, user_id: userId, household_id: householdId, created_at: now() }).execute();
  });
}

/**
 * The household a first sign-in goes to. With one household, home. With many: the invitation's household when `invite` is a
 * good one (it is spent), else a new household of its own (home while no one is in it yet). A bad invitation is an error,
 * not a new household: whoever followed it meant to join someone.
 */
export async function householdForNewAccount(invite: string | undefined, homeIsEmpty: boolean): Promise<string> {
  if (config.households() === "one") return HOME;
  if (invite) return spendInvite(invite);
  return homeIsEmpty ? HOME : newId();
}

/** Whether this instance invites into households (FREUNDEBUCH_HOUSEHOLDS=many). */
export const invitesEnabled = (): boolean => config.households() === "many";

// ---- invitations ----------------------------------------------------------------------------------------------------------

const INVITE_PREFIX = "fbi_";
const INVITE_DAYS = 7;
const hash = (s: string) => createHash("sha256").update(s).digest("hex");

/** A new invitation into the viewer's household, good once for a week. Shown once: only its hash is kept. */
export async function createInvite(v: Viewer): Promise<{ code: string; expiresAt: number }> {
  if (config.households() === "one")
    throw new InvalidInputError("This instance has one household, which everyone who signs in joins: there is no one to invite");
  const code = INVITE_PREFIX + randomBytes(24).toString("base64url");
  const expiresAt = now() + INVITE_DAYS * 86_400_000;
  await (
    await instanceDb()
  )
    .insertInto("invites")
    .values({ hash: hash(code), household_id: v.householdId, created_by: v.userId, expires_at: expiresAt, used_at: null })
    .execute();
  return { code, expiresAt };
}

/** Whether `code` is an invitation that can still be used. */
export async function inviteOk(code: string): Promise<boolean> {
  const r = await (await instanceDb()).selectFrom("invites").select(["expires_at", "used_at"]).where("hash", "=", hash(code)).executeTakeFirst();
  return !!r && r.used_at === null && r.expires_at > now();
}

async function spendInvite(code: string): Promise<string> {
  const d = await instanceDb();
  const r = await d
    .updateTable("invites")
    .set({ used_at: now() })
    .where("hash", "=", hash(code))
    .where("used_at", "is", null)
    .where("expires_at", ">", now())
    .returning("household_id")
    .executeTakeFirst();
  if (!r) throw new NotFoundError("This invitation is used up or has expired; ask for a new one");
  return r.household_id;
}

// ---- keys that name their household -----------------------------------------------------------------------------------------

// A calendar or share key is looked up before anyone is signed in, so it carries its household: `<prefix><household>~<secret>`.
// Home's keys carry none, so the keys made before households were kept go on working.

/** A new key with `prefix` for the household. */
export const householdKey = (prefix: string, householdId: string): string =>
  prefix + (householdId === HOME ? "" : `${householdId}~`) + randomBytes(32).toString("base64url");

/** The household a key with `prefix` names, or null when it is no such key. */
export function householdOfKey(prefix: string, key: string): string | null {
  if (!key.startsWith(prefix)) return null;
  const rest = key.slice(prefix.length);
  const at = rest.indexOf("~");
  if (at < 0) return HOME;
  const id = rest.slice(0, at);
  return isHouseholdId(id) ? id : null;
}
