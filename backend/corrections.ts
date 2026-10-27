// Corrections after the fact: marking things done or outdated, editing, changing visibility, deleting, renaming and merging
// persons. Who may do what is decided here (docs/adr/0002): an item the viewer can't see is not_found, so its existence is never
// revealed; one they can see but someone else recorded is forbidden to edit, re-share or delete. Marking done is open to either
// user for a shared item, and a private item is only ever visible to its recorder anyway.
import type { Kysely } from "kysely";
import { addDays, assertDay, isDay, isYearless, notFuture, today } from "./dates";
import { moveMembership } from "./groups";
import { checkLabel, checkRelationship, insertRelationships, MAX_SUMMARY, MAX_TRANSCRIPT, PRIVATE_REPLACES_SHARED, SITUATION_DAYS, type FiledRelationship } from "./conversations";
import { resolveTarget, type Target } from "./household";
import { db, now, type Schema } from "./db";
import { ForbiddenError, InvalidInputError, NotFoundError } from "./errors";
import { norm } from "./names";
import { CONVERSATION_KINDS, EXCHANGE_KINDS, FACT_CATEGORIES, FACT_KINDS, VISIBILITIES, type FactKind, type Viewer, type Visibility } from "./types";
import { visible } from "./visibility";
import { pruneScreenshots } from "./screenshots";

export type ItemTable = "facts" | "promises" | "dates" | "exchanges" | "relationships" | "conversations";

export const ITEM_TABLES = ["facts", "promises", "dates", "exchanges", "relationships", "conversations"] as const;
/** The tables whose items belong to a conversation and weigh on its transcript privacy. */
const CONVERSATION_ITEMS = ["facts", "promises", "dates", "exchanges", "relationships"] as const;

function assertTable(table: string): asserts table is ItemTable {
  if (!ITEM_TABLES.includes(table as ItemTable)) throw new InvalidInputError(`Unknown item type "${table}"`);
}

type Row = {
  id: string;
  visibility: string;
  recorded_by: string;
  conversation_id?: string | null;
};

/** The row, when the viewer can see it (else not_found); with `own`, also when they recorded it (else forbidden). */
async function load(d: Kysely<Schema>, v: Viewer, table: ItemTable, id: string, own: boolean): Promise<Row> {
  assertTable(table);
  // One query shape for every table; the columns read here exist on all of them (a conversation has no conversation_id).
  const t = table as "facts";
  const row = (await d
    .selectFrom(t)
    .selectAll()
    .where("id", "=", id)
    .$call((qb) => visible(qb, v, t))
    .executeTakeFirst()) as Row | undefined;
  if (!row) throw new NotFoundError("Not found");
  if (own && row.recorded_by !== v.userId) throw new ForbiddenError("Only the person who recorded this may change it");
  return row;
}

const DONE_COLUMN = { promises: "done", exchanges: "settled" } as const;

/** Marks a promise done or an exchange settled. A shared one may be marked by either user; a private one is invisible to the other. */
export async function markDone(v: Viewer, table: "promises" | "exchanges", id: string): Promise<void> {
  if (!(table in DONE_COLUMN)) throw new InvalidInputError(`Only promises and exchanges can be marked done, not "${table}"`);
  const d = await db();
  await load(d, v, table, id, false);
  await d
    .updateTable(table as "promises")
    .set({ [DONE_COLUMN[table]]: 1 } as { done: number })
    .where("id", "=", id)
    .execute();
}

/** A fact as it stands after a correction, with the name of the person it is about. */
export type FactState = { id: string; personId: string; name: string; text: string; kind: FactKind; checkAfter: string | null; status: "current" | "outdated" };

async function factState(d: Kysely<Schema>, id: string): Promise<FactState> {
  const f = await d
    .selectFrom("facts")
    .innerJoin("persons", "persons.id", "facts.person_id")
    .select(["facts.id", "facts.person_id", "persons.name", "facts.text", "facts.kind", "facts.check_after", "facts.status"])
    .where("facts.id", "=", id)
    .executeTakeFirstOrThrow();
  return { id: f.id, personId: f.person_id, name: f.name, text: f.text, kind: f.kind as FactKind, checkAfter: f.check_after, status: f.status as FactState["status"] };
}

/** Marks a fact outdated. A shared fact may be marked by either user. */
export async function markOutdated(v: Viewer, factId: string): Promise<FactState> {
  const d = await db();
  await load(d, v, "facts", factId, false);
  await d.updateTable("facts").set({ status: "outdated" }).where("id", "=", factId).execute();
  return factState(d, factId);
}

// What each table lets its recorder edit: the patch key, the column it writes and the check on the value. Who or what an item is
// about (person, conversation) and its visibility are not editable here; visibility has its own call.
type Field = {
  column: string;
  check: (value: unknown, what: string) => unknown;
};

const text = (value: unknown, what: string): string => {
  if (typeof value !== "string" || !value.trim()) throw new InvalidInputError(`${what} must be a non-empty string`);
  return value;
};
const optionalText = (value: unknown, what: string): string | null => (value === null ? null : text(value, what).trim());
const flag = (value: unknown, what: string): number => {
  if (typeof value !== "boolean") throw new InvalidInputError(`${what} must be true or false`);
  return value ? 1 : 0;
};
const oneOf =
  (allowed: readonly string[]) =>
  (value: unknown, what: string): string => {
    if (typeof value !== "string" || !allowed.includes(value)) throw new InvalidInputError(`${what} must be one of ${allowed.join(", ")}`);
    return value;
  };
const day = (value: unknown, what: string): string => {
  if (typeof value !== "string") throw new InvalidInputError(`${what} must be a date as YYYY-MM-DD`);
  assertDay(value, what);
  return value;
};
const conversationDay = (value: unknown, what: string): string => {
  const d = day(value, what);
  notFuture(d, what);
  return d;
};
const upTo =
  (max: number) =>
  (value: unknown, what: string): string => {
    const s = text(value, what);
    if (s.length > max) throw new InvalidInputError(`${what} holds at most ${max} characters`);
    return s;
  };
// What one end of a relationship is, in words; trimmed.
const words = (which: string) => (value: unknown): string => {
  checkLabel(value, which);
  return (value as string).trim();
};

const FIELDS: Record<ItemTable, Record<string, Field>> = {
  facts: {
    text: { column: "text", check: text },
    category: { column: "category", check: oneOf(FACT_CATEGORIES) },
    kind: { column: "kind", check: oneOf(FACT_KINDS) },
    checkAfter: { column: "check_after", check: (v, w) => (v === null ? null : day(v, w)) },
  },
  promises: {
    text: { column: "text", check: text },
    due: { column: "due", check: (v, w) => (v === null ? null : day(v, w)) },
    byMe: { column: "by_me", check: flag },
  },
  dates: {
    kind: {
      column: "kind",
      check: oneOf(["birthday", "anniversary", "custom"]),
    },
    date: { column: "date", check: text },
    label: { column: "label", check: optionalText },
    yearly: { column: "yearly", check: flag },
  },
  exchanges: {
    kind: { column: "kind", check: oneOf(EXCHANGE_KINDS) },
    direction: { column: "direction", check: oneOf(["to_them", "from_them"]) },
    text: { column: "text", check: text },
    amount: {
      column: "amount",
      check: (v, w) => {
        if (v !== null && (typeof v !== "number" || !Number.isFinite(v))) throw new InvalidInputError(`${w} must be a number`);
        return v;
      },
    },
    currency: { column: "currency", check: optionalText },
  },
  relationships: {
    label: { column: "label", check: words("label") },
    inverse: { column: "inverse", check: words("inverse") },
    note: { column: "note", check: optionalText },
  },
  conversations: {
    date: { column: "date", check: conversationDay },
    kind: { column: "kind", check: oneOf(CONVERSATION_KINDS) },
    place: { column: "place", check: optionalText },
    summary: { column: "summary", check: upTo(MAX_SUMMARY) },
    transcript: { column: "transcript", check: upTo(MAX_TRANSCRIPT) },
  },
};

/**
 * Changes the given fields of an item the viewer recorded. A fact comes back as it now stands; `defaultCheckAfter` when it just
 * became a situation without a checkAfter, so the server chose the day (SITUATION_DAYS from now).
 */
export async function editItem(v: Viewer, table: ItemTable, id: string, patch: Record<string, unknown>): Promise<{ fact?: FactState & { defaultCheckAfter: boolean } }> {
  assertTable(table);
  const d = await db();
  const row = await load(d, v, table, id, true);
  const keys = Object.keys(patch);
  if (!keys.length) throw new InvalidInputError("Nothing to change");
  const set: Record<string, unknown> = {};
  for (const k of keys) {
    const field = Object.hasOwn(FIELDS[table], k) ? FIELDS[table][k] : undefined;
    if (!field)
      throw new InvalidInputError(`A ${table.replace(/s$/, "")} has no editable field "${k}"; editable: ${Object.keys(FIELDS[table]).join(", ")}`);
    set[field.column] = field.check(patch[k], k);
  }
  if (table === "dates") {
    const old = row as unknown as { date: string; yearly: number };
    const date = (set.date ?? old.date) as string;
    const yearly = (set.yearly ?? old.yearly) === 1;
    if (!isDay(date) && !(yearly && isYearless(date)))
      throw new InvalidInputError(`A date must be a real date as YYYY-MM-DD, or --MM-DD when yearly; got "${date}"`);
  }
  // A lasting fact has no day to ask again; a situation always has one, the default when it just became one.
  let defaultCheckAfter = false;
  if (table === "facts") {
    const kind = (set.kind ?? (row as unknown as { kind: string }).kind) as string;
    if (kind === "lasting") {
      if ("check_after" in set && set.check_after !== null) throw new InvalidInputError("checkAfter is for a situation; make it one with kind: situation");
      set.check_after = null;
    } else if (set.check_after === null) throw new InvalidInputError("A situation needs a checkAfter day; make it lasting to drop it");
    else if (set.kind && !("check_after" in set)) {
      set.check_after = addDays(today(), SITUATION_DAYS);
      defaultCheckAfter = true;
    }
  }
  await d
    .updateTable(table as "facts")
    .set(set)
    .where("id", "=", id)
    .execute();
  return table === "facts" ? { fact: { ...(await factState(d, id)), defaultCheckAfter } } : {};
}

/** Whether the conversation, or anything recorded with it (memberships included), is private. */
async function holdsPrivate(d: Kysely<Schema>, conversationId: string): Promise<boolean> {
  const c = await d.selectFrom("conversations").select("visibility").where("id", "=", conversationId).executeTakeFirst();
  if (c?.visibility === "private") return true;
  for (const t of CONVERSATION_ITEMS)
    if (await d.selectFrom(t).select("id").where("conversation_id", "=", conversationId).where("visibility", "=", "private").executeTakeFirst()) return true;
  // Memberships have no id column.
  return !!(await d
    .selectFrom("group_members")
    .select("group_id")
    .where("conversation_id", "=", conversationId)
    .where("visibility", "=", "private")
    .executeTakeFirst());
}

/**
 * The verbatim transcript turns private whenever the conversation or any item recorded with it does. It never turns shared again
 * here: the transcript still holds the text of a private item that was later deleted or shared, so only the recorder's explicit
 * `shareTranscript` may lower it.
 */
async function raiseTranscriptPrivacy(d: Kysely<Schema>, conversationId: string): Promise<void> {
  if (await holdsPrivate(d, conversationId)) await d.updateTable("conversations").set({ transcript_private: 1 }).where("id", "=", conversationId).execute();
}

/**
 * Lets the partner read the transcript of a conversation the viewer recorded: the recorder's word that it holds nothing private any
 * more. Refused while the conversation or anything recorded with it is private.
 */
export async function shareTranscript(v: Viewer, conversationId: string): Promise<void> {
  const d = await db();
  await d.transaction().execute(async (tx) => {
    await load(tx, v, "conversations", conversationId, true);
    if (await holdsPrivate(tx, conversationId))
      throw new InvalidInputError("The conversation or something recorded with it is private: share those first, or keep the transcript private");
    await tx.updateTable("conversations").set({ transcript_private: 0 }).where("id", "=", conversationId).execute();
  });
}

/**
 * Changes who can see an item the viewer recorded. A conversation made private takes its items with it; made shared again, its
 * individually private items stay private. A private result makes the transcript private; nothing here makes it shared again.
 */
export async function setVisibility(v: Viewer, table: ItemTable, id: string, visibility: Visibility): Promise<void> {
  assertTable(table);
  if (!VISIBILITIES.includes(visibility)) throw new InvalidInputError(`Visibility must be one of ${VISIBILITIES.join(", ")}`);
  const d = await db();
  await d.transaction().execute(async (tx) => {
    const row = await load(tx, v, table, id, true);
    if (visibility === "private") await assertReplacesNothingShared(tx, table, id);
    // A private conversation forces private on all its items; share the conversation first.
    if (table !== "conversations" && visibility === "shared" && row.conversation_id) {
      const parent = await tx.selectFrom("conversations").select("visibility").where("id", "=", row.conversation_id).executeTakeFirst();
      if (parent?.visibility === "private") throw new InvalidInputError("This item belongs to a private conversation: share the conversation first");
    }
    await tx
      .updateTable(table as "facts")
      .set({ visibility })
      .where("id", "=", id)
      .execute();
    if (table === "conversations") {
      if (visibility === "private") {
        for (const t of [...CONVERSATION_ITEMS, "group_members"] as const)
          await tx
            .updateTable(t as "facts")
            .set({ visibility })
            .where("conversation_id", "=", id)
            .execute();
      }
      await raiseTranscriptPrivacy(tx, id);
    } else if (row.conversation_id) await raiseTranscriptPrivacy(tx, row.conversation_id);
  });
}

/**
 * A fact that replaced a shared fact stays shared, as recordConversation demands of it at the start: private, it would leave the
 * partner's fact outdated with no successor they can see. Checked for the fact itself, or for every fact of a conversation.
 */
async function assertReplacesNothingShared(d: Kysely<Schema>, table: ItemTable, id: string): Promise<void> {
  if (table !== "facts" && table !== "conversations") return;
  const replaced = await d
    .selectFrom("facts as old")
    .innerJoin("facts as new", "new.id", "old.superseded_by")
    .select("old.id")
    .where("old.visibility", "=", "shared")
    .where(table === "facts" ? "new.id" : "new.conversation_id", "=", id)
    // Within one conversation the old fact turns private along with the new one.
    .$call((qb) => (table === "conversations" ? qb.where((eb) => eb.or([eb("old.conversation_id", "is", null), eb("old.conversation_id", "!=", id)])) : qb))
    .executeTakeFirst();
  if (replaced) throw new InvalidInputError(PRIVATE_REPLACES_SHARED);
}

/**
 * Deletes an item the viewer recorded; a conversation takes its items and participants with it. The conversation's transcript_private
 * is deliberately not recomputed: the transcript still holds the text of what was deleted.
 */
export async function deleteItem(v: Viewer, table: ItemTable, id: string): Promise<void> {
  assertTable(table);
  const d = await db();
  await load(d, v, table, id, true);
  await d
    .deleteFrom(table as "facts")
    .where("id", "=", id)
    .execute();
  // A fact read from a screenshot takes the image with it once no other fact names it.
  if (table === "facts") await pruneScreenshots();
}

/**
 * Turns a fact the viewer recorded into a relationship ("Unsere Vermieterin" → Vermieterin of us), which keeps the fact's visibility
 * and conversation; the fact goes. The fact's person must be on one end.
 */
export async function factToRelationship(
  v: Viewer,
  factId: string,
  r: { from: Target; to: Target; label: string; inverse: string; note?: string },
): Promise<{ ids: string[]; relationships: FiledRelationship[] }> {
  checkRelationship(r, () => {});
  const d = await db();
  const relationships = await d.transaction().execute(async (tx) => {
    const fact = (await load(tx, v, "facts", factId, true)) as Row & { person_id: string };
    const [froms, tos] = await Promise.all([resolveTarget(tx, v, r.from), resolveTarget(tx, v, r.to)]);
    if (!froms.includes(fact.person_id) && !tos.includes(fact.person_id)) throw new InvalidInputError("The relationship must have the fact's person on one end");
    const filed = await insertRelationships(tx, v, { recorded_by: v.userId, conversation_id: fact.conversation_id ?? null, created_at: now() }, { ...r, visibility: fact.visibility as Visibility });
    await tx.deleteFrom("facts").where("id", "=", factId).execute();
    return filed;
  });
  await pruneScreenshots();
  return { ids: relationships.map((x) => x.id), relationships };
}

export async function renamePerson(v: Viewer, id: string, name: string): Promise<void> {
  void v;
  const n = name.trim();
  if (!n) throw new InvalidInputError("A person needs a name");
  const d = await db();
  await d.transaction().execute(async (tx) => {
    if (!(await tx.selectFrom("persons").select("id").where("id", "=", id).executeTakeFirst())) throw new NotFoundError("No such person");
    await tx.updateTable("persons").set({ name: n }).where("id", "=", id).execute();
    // An alias that matches the name adds nothing (insertAlias never stores one).
    await tx.deleteFrom("aliases").where("person_id", "=", id).where("norm", "=", norm(n)).execute();
  });
}

/** What a merge moved over, as the viewer may see it: the other user's private items move too, but never count here. */
export type Moved = { facts: number; promises: number; dates: number; exchanges: number; relationships: number; conversations: number; groups: number };

/**
 * Merges the duplicate `dropId` into `keepId`: every item, alias, participant and setting moves over with its visibility, and the
 * dropped person goes. Rows that would collide with one `keepId` already has are dropped instead of moved. The dropped person may
 * not be a user's own person (a duplicate can be merged into one). Returns the names and what moved that the viewer may see.
 */
export async function mergePeople(v: Viewer, keepId: string, dropId: string): Promise<{ kept: string; dropped: string; moved: Moved }> {
  if (keepId === dropId) throw new InvalidInputError("Can't merge a person into themselves");
  const d = await db();
  return d.transaction().execute(async (tx) => {
    const keep = await tx.selectFrom("persons").select(["id", "name"]).where("id", "=", keepId).executeTakeFirst();
    const drop = await tx.selectFrom("persons").select(["id", "name"]).where("id", "=", dropId).executeTakeFirst();
    if (!keep || !drop) throw new NotFoundError("No such person");
    const own = await tx.selectFrom("users").select("id").where("person_id", "=", dropId).executeTakeFirst();
    if (own) throw new InvalidInputError("Can't merge a user's own person");
    const moved = await movable(tx, v, keepId, dropId);

    for (const t of ["facts", "promises", "dates", "exchanges"] as const)
      await tx.updateTable(t).set({ person_id: keepId }).where("person_id", "=", dropId).execute();

    // A relationship between the two would become one with itself.
    await tx
      .deleteFrom("relationships")
      .where((eb) =>
        eb.or([eb.and([eb("from_id", "=", keepId), eb("to_id", "=", dropId)]), eb.and([eb("from_id", "=", dropId), eb("to_id", "=", keepId)])]),
      )
      .execute();
    await tx.updateTable("relationships").set({ from_id: keepId }).where("from_id", "=", dropId).execute();
    await tx.updateTable("relationships").set({ to_id: keepId }).where("to_id", "=", dropId).execute();

    // The dropped name stays findable as an alias, unless it is the same name once normalised.
    const aliases = await tx.selectFrom("aliases").select("alias").where("person_id", "=", dropId).execute();
    for (const alias of [drop.name, ...aliases.map((a) => a.alias)]) {
      if (norm(alias) === norm(keep.name)) continue;
      await tx
        .insertInto("aliases")
        .values({ person_id: keepId, alias, norm: norm(alias) })
        .onConflict((oc) => oc.doNothing())
        .execute();
    }
    await tx.deleteFrom("aliases").where("person_id", "=", dropId).execute();

    for (const p of await tx.selectFrom("participants").select("conversation_id").where("person_id", "=", dropId).execute())
      await tx
        .insertInto("participants")
        .values({ conversation_id: p.conversation_id, person_id: keepId })
        .onConflict((oc) => oc.doNothing())
        .execute();
    await tx.deleteFrom("participants").where("person_id", "=", dropId).execute();

    for (const m of await tx.selectFrom("group_members").select(["group_id", "recorded_by"]).where("person_id", "=", dropId).execute())
      await moveMembership(tx, m.recorded_by, { group_id: m.group_id, person_id: dropId }, { group_id: m.group_id, person_id: keepId });

    // Settings are per user. The confirmed interval wins; with both or neither confirmed, the smaller one does.
    for (const dropped of await tx.selectFrom("person_settings").selectAll().where("person_id", "=", dropId).execute()) {
      const kept = await tx
        .selectFrom("person_settings")
        .selectAll()
        .where("person_id", "=", keepId)
        .where("user_id", "=", dropped.user_id)
        .executeTakeFirst();
      if (!kept) {
        await tx
          .updateTable("person_settings")
          .set({ person_id: keepId })
          .where("person_id", "=", dropId)
          .where("user_id", "=", dropped.user_id)
          .execute();
        continue;
      }
      let winner = kept;
      if (kept.interval_confirmed !== dropped.interval_confirmed) winner = kept.interval_confirmed ? kept : dropped;
      else if (dropped.interval_days !== null && (kept.interval_days === null || dropped.interval_days < kept.interval_days)) winner = dropped;
      await tx
        .updateTable("person_settings")
        .set({
          interval_days: winner.interval_days,
          interval_confirmed: winner.interval_confirmed,
        })
        .where("person_id", "=", keepId)
        .where("user_id", "=", dropped.user_id)
        .execute();
    }

    await tx.deleteFrom("persons").where("id", "=", dropId).execute(); // takes the remaining settings and rows with it
    return { kept: keep.name, dropped: drop.name, moved };
  });
}

/** What of `dropId` a merge into `keepId` moves over, counting only rows the viewer may see. */
async function movable(tx: Kysely<Schema>, v: Viewer, keepId: string, dropId: string): Promise<Moved> {
  const count = async (q: { executeTakeFirstOrThrow(): Promise<{ n: number | string | bigint }> }) => Number((await q.executeTakeFirstOrThrow()).n);
  const items = async (t: "facts" | "promises" | "dates" | "exchanges") =>
    count(
      tx
        .selectFrom(t)
        .select((eb) => eb.fn.countAll().as("n"))
        .where("person_id", "=", dropId)
        .$call((qb) => visible(qb, v, t)),
    );
  return {
    facts: await items("facts"),
    promises: await items("promises"),
    dates: await items("dates"),
    exchanges: await items("exchanges"),
    // One between the two goes instead.
    relationships: await count(
      tx
        .selectFrom("relationships")
        .select((eb) => eb.fn.countAll().as("n"))
        .where((eb) => eb.or([eb("from_id", "=", dropId), eb("to_id", "=", dropId)]))
        .where((eb) => eb.and([eb("from_id", "!=", keepId), eb("to_id", "!=", keepId)]))
        .$call((qb) => visible(qb, v, "relationships")),
    ),
    conversations: await count(
      tx
        .selectFrom("participants")
        .innerJoin("conversations", "conversations.id", "participants.conversation_id")
        .select((eb) => eb.fn.countAll().as("n"))
        .where("participants.person_id", "=", dropId)
        .$call((qb) => visible(qb, v, "conversations")),
    ),
    groups: await count(
      tx
        .selectFrom("group_members")
        .select((eb) => eb.fn.countAll().as("n"))
        .where("person_id", "=", dropId)
        .$call((qb) => visible(qb, v, "group_members")),
    ),
  };
}
