// Recording a conversation: the one write path for what Claude extracts from a ramble. Everything lands in one transaction, so a
// bad item leaves nothing behind. Privacy is decided here once: a private conversation makes every item private, and any private
// item makes the verbatim transcript private to the recorder (it contains the private part).
import type { Kysely } from "kysely";
import { addDays, assertDay, isDay, isYearless, notFuture, today } from "./dates";
import { db, newId, now, type Schema } from "./db";
import { AmbiguousError, InvalidInputError, NotFoundError } from "./errors";
import { checkGender, insertPerson, namedLike } from "./people";
import {
  CONVERSATION_KINDS,
  EXCHANGE_KINDS,
  FACT_CATEGORIES,
  FACT_KINDS,
  RELATIONSHIP_TYPES,
  VISIBILITIES,
  type ConversationKind,
  type ExchangeKind,
  type FactCategory,
  type FactKind,
  type Gender,
  type RelationshipType,
  type Viewer,
  type Visibility,
} from "./types";
import { resolveOrCreateGroup } from "./groups";
import { isHouseholdWord, resolvePairs, type Target } from "./household";
import { conversationPath, itemPath, personPath, type AnchoredTable } from "./urls";
import { visible } from "./visibility";

/** An index into `NewConversation.people`. */
export type PersonRef = number;
type DateKind = "birthday" | "anniversary" | "custom";
type Direction = "to_them" | "from_them";

export type NewConversation = {
  date: string;
  kind: ConversationKind;
  place?: string;
  summary: string;
  transcript: string;
  visibility: Visibility;
  /**
   * `id` links an existing person, `name` creates one. `present` makes them a participant. A new name that matches an existing
   * person's name or alias is refused as ambiguous unless `confirmedNew`.
   */
  people: Array<{ id?: string; name?: string; aliases?: string[]; present: boolean; confirmedNew?: boolean; gender?: Gender }>;
  facts?: Array<{ person: PersonRef; text: string; category: FactCategory; private?: boolean; supersedes?: string; kind?: FactKind; checkAfter?: string }>;
  promises?: Array<{ person: PersonRef; text: string; byMe: boolean; due?: string; private?: boolean }>;
  /** `date` is `YYYY-MM-DD`, or `--MM-DD` for a yearly date without a year. */
  dates?: Array<{ person: PersonRef; kind: DateKind; date: string; label?: string; yearly: boolean; private?: boolean }>;
  exchanges?: Array<{ person: PersonRef; kind: ExchangeKind; direction: Direction; text: string; amount?: number; currency?: string; private?: boolean }>;
  /** "me" is the viewer's person, "us" every household person (one relationship each): a role to us ("our landlady"). */
  relationships?: Array<{ from: PersonRef | "me" | "us"; to: PersonRef | "me" | "us"; type: RelationshipType; note?: string; private?: boolean }>;
  groups?: Array<{ name: string; members: PersonRef[]; private?: boolean }>;
};

const ITEM_KINDS = ["facts", "promises", "dates", "exchanges", "relationships", "groups"] as const;

export type Recorded = {
  conversationId: string;
  url: string;
  people: Array<{ ref: PersonRef; id: string; name: string; created: boolean; url: string }>;
  /** Items written; `groups` counts the group memberships written. */
  counts: Record<(typeof ITEM_KINDS)[number], number>;
};

/** `url`: the item's row on the conversation's page, which lists everything filed from it, done and outdated ones too. */
type Item = { id: string; visibility: Visibility; recordedBy: string; url: string };
/** `name`: the name of the person the item is about. */
type About = { personId: string; name: string };
export type ConversationView = {
  id: string;
  date: string;
  kind: ConversationKind;
  place: string | null;
  summary: string;
  /** null when the viewer may not read it: it is private to the recorder whenever anything recorded with it is private. */
  transcript: string | null;
  visibility: Visibility;
  recordedBy: string;
  url: string;
  participants: Array<{ id: string; name: string; url: string }>;
  facts: Array<Item & About & { text: string; category: FactCategory; status: "current" | "outdated" }>;
  /** `byMe` and `by` as in a briefing: from the viewer's side, with the other user's name when they made the promise. */
  promises: Array<Item & About & { text: string; byMe: boolean; by?: string; due: string | null; done: boolean }>;
  dates: Array<Item & About & { kind: DateKind; date: string; label: string | null; yearly: boolean }>;
  /** `by`: the other user's name when they recorded it; `direction` then reads from their side. */
  exchanges: Array<
    Item & About & { kind: ExchangeKind; direction: Direction; by?: string; text: string; amount: number | null; currency: string | null; settled: boolean }
  >;
  relationships: Array<Item & { fromId: string; fromName: string; toId: string; toName: string; type: RelationshipType; note: string | null }>;
};

export const MAX_TRANSCRIPT = 200_000;
/** How long after filing a situation without a `checkAfter` it turns into a nudge to ask how it went. */
export const SITUATION_DAYS = 42;
export const MAX_SUMMARY = 2_000;

function oneOf<T extends string>(value: string, allowed: readonly T[], what: string): void {
  if (!allowed.includes(value as T)) throw new InvalidInputError(`Unknown ${what} "${value}"`);
}

/** Everything that can be checked without the database, so most bad input fails before the transaction starts. */
function validate(c: NewConversation): void {
  assertDay(c.date, "The conversation date");
  notFuture(c.date, "The conversation date");
  oneOf(c.kind, CONVERSATION_KINDS, "conversation kind");
  checkVisibility(c.visibility);
  if (c.summary.length > MAX_SUMMARY) throw new InvalidInputError(`The summary holds at most ${MAX_SUMMARY} characters`);
  if (c.transcript.length > MAX_TRANSCRIPT) throw new InvalidInputError(`The transcript holds at most ${MAX_TRANSCRIPT} characters`);
  for (const p of c.people) {
    if (!p.id && !p.name?.trim()) throw new InvalidInputError("Each person needs an id (existing) or a name (new)");
    if (p.gender !== undefined) checkGender(p.gender);
  }
  const ref = (r: PersonRef) => {
    if (!Number.isInteger(r) || r < 0 || r >= c.people.length) throw new InvalidInputError(`Person ${r} is not in people`);
  };
  validateItems(c, ref);
  for (const r of c.relationships ?? []) checkRelationship(r, ref);
  for (const g of c.groups ?? []) checkGroup(g, ref);
}

/**
 * A fact is `lasting` or a `situation` (going on, will end) with `checkAfter`, the day to ask how it went; SITUATION_DAYS after it
 * was filed when not given. A fact that supersedes another takes its kind unless it gives one, so news keeps a situation going.
 */
type Items<P> = {
  facts?: Array<{ person: P; text: string; category: string; private?: boolean; supersedes?: string; kind?: string; checkAfter?: string }>;
  promises?: Array<{ person: P; text: string; byMe: boolean; due?: string; private?: boolean }>;
  dates?: Array<{ person: P; kind: string; date: string; label?: string; yearly: boolean; private?: boolean }>;
  exchanges?: Array<{ person: P; kind: string; direction: string; text: string; amount?: number; currency?: string; private?: boolean }>;
};

/** The checks of facts, promises, dates and exchanges, shared with remember(). `ref` checks one person reference. */
function validateItems<P>(c: Items<P>, ref: (p: P) => void): void {
  for (const f of c.facts ?? []) {
    ref(f.person);
    oneOf(f.category, FACT_CATEGORIES, "fact category");
    if (f.kind !== undefined) oneOf(f.kind, FACT_KINDS, "fact kind");
    if (f.checkAfter !== undefined) assertDay(f.checkAfter, "A situation's checkAfter");
  }
  for (const p of c.promises ?? []) {
    ref(p.person);
    if (p.due !== undefined) assertDay(p.due, "A promise's due date");
  }
  for (const d of c.dates ?? []) {
    ref(d.person);
    oneOf(d.kind, ["birthday", "anniversary", "custom"], "date kind");
    if (!isDay(d.date) && !(d.yearly && isYearless(d.date))) throw new InvalidInputError(`A date must be a real date as YYYY-MM-DD, or --MM-DD when yearly; got "${d.date}"`);
  }
  for (const e of c.exchanges ?? []) {
    ref(e.person);
    oneOf(e.kind, EXCHANGE_KINDS, "exchange kind");
    oneOf(e.direction, ["to_them", "from_them"], "direction");
  }
}

/** Writes facts, promises, dates and exchanges, with or without a conversation (`base.conversation_id`); shared with remember(). */
async function insertItems<P>(tx: Kysely<Schema>, v: Viewer, base: ItemBase, c: Items<P>, id: (p: P) => string, vis: (item: { private?: boolean }) => Visibility): Promise<void> {
  for (const f of c.facts ?? []) {
    const factId = newId();
    const replaced = f.supersedes
      ? await tx.selectFrom("facts").select("kind").where("id", "=", f.supersedes).$call((qb) => visible(qb, v, "facts")).executeTakeFirst()
      : undefined;
    const kind = (f.kind ?? replaced?.kind ?? "lasting") as FactKind;
    if (kind === "lasting" && f.checkAfter !== undefined) throw new InvalidInputError("checkAfter is for a situation; a lasting fact has none");
    const checkAfter = kind === "situation" ? (f.checkAfter ?? addDays(today(), SITUATION_DAYS)) : null;
    await tx
      .insertInto("facts")
      .values({ ...base, id: factId, person_id: id(f.person), text: f.text, category: f.category, kind, check_after: checkAfter, visibility: vis(f) })
      .execute();
    if (f.supersedes) await outdate(tx, v, f.supersedes, factId, id(f.person), vis(f));
  }
  for (const p of c.promises ?? [])
    await tx.insertInto("promises").values({ ...base, id: newId(), person_id: id(p.person), text: p.text, by_me: p.byMe ? 1 : 0, due: p.due ?? null, visibility: vis(p) }).execute();
  for (const d of c.dates ?? [])
    await tx
      .insertInto("dates")
      .values({ ...base, id: newId(), person_id: id(d.person), kind: d.kind as DateKind, date: d.date, label: d.label ?? null, yearly: d.yearly ? 1 : 0, visibility: vis(d) })
      .execute();
  for (const e of c.exchanges ?? [])
    await tx
      .insertInto("exchanges")
      .values({ ...base, id: newId(), person_id: id(e.person), kind: e.kind, direction: e.direction as "to_them" | "from_them", text: e.text, amount: e.amount ?? null, currency: e.currency ?? null, visibility: vis(e) })
      .execute();
}

/** Facts, promises, dates and exchanges about people the book already has, filed without a conversation: "Malou's birthday is 7 February". */
export type Remembered = { visibility: Visibility } & Items<string>;

export async function remember(v: Viewer, r: Remembered): Promise<{ counts: { facts: number; promises: number; dates: number; exchanges: number }; people: Array<{ id: string; name: string; url: string }> }> {
  checkVisibility(r.visibility);
  const count = (r.facts?.length ?? 0) + (r.promises?.length ?? 0) + (r.dates?.length ?? 0) + (r.exchanges?.length ?? 0);
  if (!count) throw new InvalidInputError("Nothing to remember: give at least one fact, promise, date or exchange");
  validateItems(r, (p) => {
    if (typeof p !== "string" || !p) throw new InvalidInputError("Each item needs the id of an existing person");
  });
  const vis = (item: { private?: boolean }): Visibility => (r.visibility === "private" || item.private ? "private" : "shared");
  const base: ItemBase = { recorded_by: v.userId, conversation_id: null, created_at: now() };
  return (await db()).transaction().execute(async (tx) => {
    const ids = [...new Set([...(r.facts ?? []), ...(r.promises ?? []), ...(r.dates ?? []), ...(r.exchanges ?? [])].map((i) => i.person))];
    const people = await tx.selectFrom("persons").select(["id", "name"]).where("id", "in", ids).execute();
    if (people.length !== ids.length) throw new NotFoundError("No such person");
    await insertItems(tx, v, base, r, (p) => p, vis);
    return {
      counts: { facts: r.facts?.length ?? 0, promises: r.promises?.length ?? 0, dates: r.dates?.length ?? 0, exchanges: r.exchanges?.length ?? 0 },
      people: people.map((p) => ({ id: p.id, name: p.name, url: personPath(p.id) })),
    };
  });
}

// The checks and writers of relationships and group memberships, shared with relate (relationships.ts), which records them
// without a conversation. `ref` checks one person reference: an index here, a person id there.

export function checkVisibility(visibility: string): void {
  oneOf(visibility, VISIBILITIES, "visibility");
}

/** `from` and `to` may be "me" or "us" (household.ts), but not both. */
export function checkRelationship<P>(r: { from: P | "me" | "us"; to: P | "me" | "us"; type: string }, ref: (p: P) => void): void {
  if (isHouseholdWord(r.from) && isHouseholdWord(r.to)) throw new InvalidInputError('A relationship needs someone outside the household on one end: "me" and "us" can\'t both be used');
  if (!isHouseholdWord(r.from)) ref(r.from);
  if (!isHouseholdWord(r.to)) ref(r.to);
  oneOf(r.type, RELATIONSHIP_TYPES, "relationship type");
  if (r.from === r.to) throw new InvalidInputError("A relationship needs two different people");
}

export function checkGroup<P>(g: { name: string; members: P[] }, ref: (p: P) => void): void {
  if (!g.name.trim()) throw new InvalidInputError("A group needs a name");
  g.members.forEach(ref);
}

/** Who recorded an item, when, and with which conversation (null for one set directly). */
export type ItemBase = { recorded_by: string; conversation_id: string | null; created_at: number };

const SYMMETRIC: ReadonlySet<string> = new Set(["partner", "spouse", "sibling", "friend", "colleague", "neighbour", "other"]);

/** The same for every way of writing one relationship: parent A→B is child B→A, a symmetric one reads both ways. */
export function relationshipKey(fromId: string, toId: string, type: string): string {
  if (type === "child") return `parent:${toId}:${fromId}`;
  if (SYMMETRIC.has(type)) return `${type}:${[fromId, toId].sort().join(":")}`;
  return `${type}:${fromId}:${toId}`;
}

const sameNote = (a: string | null | undefined, b: string | null | undefined) => !a?.trim() || !b?.trim() || a.trim().toLowerCase() === b.trim().toLowerCase();

/**
 * Records a relationship, unless the recorder already sees the same one (theirs, or a shared one): then that one's id comes
 * back, and it takes the note if it had none and is the recorder's. Two `other` relationships are the same only when their
 * notes agree; for the rest the type says what they are.
 */
export async function insertRelationship(
  tx: Kysely<Schema>,
  base: ItemBase,
  r: { fromId: string; toId: string; type: RelationshipType; note?: string; visibility: Visibility },
): Promise<string> {
  const key = relationshipKey(r.fromId, r.toId, r.type);
  const known = await tx
    .selectFrom("relationships")
    .select(["id", "from_id", "to_id", "type", "note", "recorded_by"])
    .where((eb) => eb.or([eb.and([eb("from_id", "=", r.fromId), eb("to_id", "=", r.toId)]), eb.and([eb("from_id", "=", r.toId), eb("to_id", "=", r.fromId)])]))
    .where((eb) => eb.or([eb("recorded_by", "=", base.recorded_by), eb("visibility", "=", "shared")]))
    .orderBy("created_at")
    .execute();
  const same = known.find((k) => relationshipKey(k.from_id, k.to_id, k.type) === key && (r.type !== "other" || sameNote(k.note, r.note)));
  if (same) {
    if (!same.note?.trim() && r.note?.trim() && same.recorded_by === base.recorded_by) await tx.updateTable("relationships").set({ note: r.note }).where("id", "=", same.id).execute();
    return same.id;
  }
  const id = newId();
  await tx.insertInto("relationships").values({ ...base, id, from_id: r.fromId, to_id: r.toId, type: r.type, note: r.note ?? null, visibility: r.visibility }).execute();
  return id;
}

/** Records a relationship between targets (household.ts), one per pair they stand for, each deduped by insertRelationship. */
export async function insertRelationships(
  tx: Kysely<Schema>,
  v: Viewer,
  base: ItemBase,
  r: { from: Target; to: Target; type: RelationshipType; note?: string; visibility: Visibility },
): Promise<string[]> {
  const pairs = await resolvePairs(tx, v, r.from, r.to);
  if (!pairs.length) throw new InvalidInputError("A relationship needs two different people");
  const ids: string[] = [];
  for (const [fromId, toId] of pairs) ids.push(await insertRelationship(tx, base, { fromId, toId, type: r.type, note: r.note, visibility: r.visibility }));
  return ids;
}

/** Adds the people to the group this name resolves to for the viewer (created when none does); returns it and how many memberships were new. */
export async function insertMemberships(
  tx: Kysely<Schema>,
  v: Viewer,
  base: ItemBase,
  name: string,
  personIds: string[],
  visibility: Visibility,
): Promise<{ added: number; groupId: string }> {
  const groupId = await resolveOrCreateGroup(tx, v, name);
  let added = 0;
  // Each user has their own membership row. One the viewer recorded before keeps its visibility; only they may change it.
  for (const m of new Set(personIds)) {
    const r = await tx
      .insertInto("group_members")
      .values({ group_id: groupId, person_id: m, visibility, recorded_by: base.recorded_by, conversation_id: base.conversation_id })
      .onConflict((oc) => oc.doNothing())
      .executeTakeFirst();
    added += Number(r.numInsertedOrUpdatedRows ?? 0);
  }
  return { added, groupId };
}

/**
 * Refuses to create a person who may already exist: a new name equal to an existing person's name or alias, once normalised,
 * unless the entry says `confirmedNew`. The message lists each candidate with the hints the viewer may see.
 */
async function assertNoNamesake(v: Viewer, c: NewConversation): Promise<void> {
  const found: string[] = [];
  for (const p of c.people) {
    if (p.id || p.confirmedNew) continue;
    const candidates = await namedLike(v, p.name!);
    if (!candidates.length) continue;
    const list = candidates.map((x) => `${x.name} (id ${x.id}${x.context.length ? `; ${x.context.join(", ")}` : ""})`).join("; ");
    found.push(`"${p.name!.trim()}" may already be ${candidates.length > 1 ? "one of " : ""}${list}`);
  }
  if (found.length)
    throw new AmbiguousError(`${found.join(". ")}. Link an existing person by id, or set confirmedNew: true on a person the user confirmed is someone new`);
}

export async function recordConversation(v: Viewer, c: NewConversation): Promise<Recorded> {
  validate(c);
  await assertNoNamesake(v, c);
  const vis = (item: { private?: boolean }): Visibility => (c.visibility === "private" || item.private ? "private" : "shared");
  const items = [...(c.facts ?? []), ...(c.promises ?? []), ...(c.dates ?? []), ...(c.exchanges ?? []), ...(c.relationships ?? []), ...(c.groups ?? [])];
  const transcriptPrivate = c.visibility === "private" || items.some((i) => i.private) ? 1 : 0;
  const conversationId = newId();
  const t = now();
  const base: ItemBase = { recorded_by: v.userId, conversation_id: conversationId, created_at: t };

  return (await db()).transaction().execute(async (tx) => {
    await tx
      .insertInto("conversations")
      .values({
        id: conversationId,
        date: c.date,
        kind: c.kind,
        place: c.place?.trim() || null,
        summary: c.summary,
        transcript: c.transcript,
        transcript_private: transcriptPrivate,
        visibility: c.visibility,
        recorded_by: v.userId,
        created_at: t,
      })
      .execute();

    const people: Omit<Recorded["people"][number], "url">[] = [];
    for (const [ref, p] of c.people.entries()) {
      if (p.id) {
        const row = await tx.selectFrom("persons").select(["id", "name"]).where("id", "=", p.id).executeTakeFirst();
        if (!row) throw new NotFoundError(`No such person: ${p.id}`);
        if (p.gender) await tx.updateTable("persons").set({ gender: p.gender }).where("id", "=", row.id).execute();
        people.push({ ref, id: row.id, name: row.name, created: false });
      } else {
        const name = p.name!.trim();
        people.push({ ref, id: await insertPerson(tx, v, { name, aliases: p.aliases, createdFrom: conversationId, gender: p.gender }), name, created: true });
      }
    }
    const id = (r: PersonRef) => people[r].id;

    const present = new Set([v.personId, ...c.people.flatMap((p, r) => (p.present ? [id(r)] : []))]);
    for (const personId of present) await tx.insertInto("participants").values({ conversation_id: conversationId, person_id: personId }).execute();

    await insertItems(tx, v, base, c, id, vis);
    const target = (t: PersonRef | "me" | "us") => (isHouseholdWord(t) ? t : id(t));
    let relationships = 0;
    for (const r of c.relationships ?? []) relationships += (await insertRelationships(tx, v, base, { from: target(r.from), to: target(r.to), type: r.type, note: r.note, visibility: vis(r) })).length;
    let memberships = 0;
    for (const g of c.groups ?? []) memberships += (await insertMemberships(tx, v, base, g.name, g.members.map(id), vis(g))).added;

    const counts = { ...(Object.fromEntries(ITEM_KINDS.map((k) => [k, c[k]?.length ?? 0])) as Recorded["counts"]), relationships, groups: memberships };
    return { conversationId, url: conversationPath(conversationId), people: people.map((p) => ({ ...p, url: personPath(p.id) })), counts };
  });
}

/** Why a private fact can't replace a shared one; corrections.ts refuses making such a replacement private later with the same words. */
export const PRIVATE_REPLACES_SHARED =
  "A private fact can't replace a shared one: record the update as shared, or keep the old fact and add the private one without supersedes";

/**
 * Marks a fact the viewer can see as outdated by `newId`; it must be about the same person as the fact that replaces it. A private
 * fact may only replace the viewer's own private fact: outdating a shared one would show the partner that something private changed.
 */
async function outdate(tx: Kysely<Schema>, v: Viewer, factId: string, newId: string, personId: string, visibility: Visibility): Promise<void> {
  const old = await tx
    .selectFrom("facts")
    .select(["person_id", "visibility"])
    .where("id", "=", factId)
    .$call((qb) => visible(qb, v, "facts"))
    .executeTakeFirst();
  if (!old) throw new NotFoundError(`No such fact: ${factId}`);
  if (old.person_id !== personId) throw new InvalidInputError("A fact can only supersede a fact about the same person");
  if (visibility === "private" && old.visibility !== "private") throw new InvalidInputError(PRIVATE_REPLACES_SHARED);
  await tx.updateTable("facts").set({ status: "outdated", superseded_by: newId }).where("id", "=", factId).execute();
}

/** Whether the viewer has filed anything yet; until then the start page says how to begin. */
export async function hasRecorded(v: Viewer): Promise<boolean> {
  return !!(await (await db()).selectFrom("conversations").select("id").where("recorded_by", "=", v.userId).limit(1).executeTakeFirst());
}

/** A conversation in the history: when, how, the summary, and who was there. */
export type ConversationSummary = { id: string; date: string; kind: ConversationKind; summary: string; people: Array<{ id: string; name: string }>; url: string };

/** Every conversation the viewer may see, newest first. */
export async function listConversations(v: Viewer): Promise<ConversationSummary[]> {
  const d = await db();
  const convs = await d
    .selectFrom("conversations")
    .select(["id", "date", "kind", "summary"])
    .$call((qb) => visible(qb, v, "conversations"))
    .orderBy("date", "desc")
    .orderBy("created_at", "desc")
    .execute();
  if (!convs.length) return [];
  const present = await d
    .selectFrom("participants")
    .innerJoin("persons", "persons.id", "participants.person_id")
    .select(["participants.conversation_id", "persons.id", "persons.name"])
    .where(
      "participants.conversation_id",
      "in",
      convs.map((c) => c.id),
    )
    .where("persons.id", "!=", v.personId)
    .orderBy("persons.name")
    .execute();
  return convs.map((c) => ({
    id: c.id,
    date: c.date,
    kind: c.kind as ConversationKind,
    summary: c.summary,
    people: present.filter((p) => p.conversation_id === c.id).map((p) => ({ id: p.id, name: p.name })),
    url: conversationPath(c.id),
  }));
}

export async function getConversation(v: Viewer, id: string): Promise<ConversationView> {
  const d = await db();
  const c = await d.selectFrom("conversations").selectAll().where("id", "=", id).$call((qb) => visible(qb, v, "conversations")).executeTakeFirst();
  if (!c) throw new NotFoundError("No such conversation");
  const participants = await d
    .selectFrom("participants")
    .innerJoin("persons", "persons.id", "participants.person_id")
    .select(["persons.id", "persons.name"])
    .where("participants.conversation_id", "=", id)
    .orderBy("persons.name")
    .execute();
  const page = conversationPath(id);
  const item = (table: AnchoredTable, r: { id: string; visibility: string; recorded_by: string }): Item => ({
    id: r.id,
    visibility: r.visibility as Visibility,
    recordedBy: r.recorded_by,
    url: itemPath(page, table, r.id),
  });
  // The recorder of every item is the conversation's recorder.
  const recorder = c.recorded_by === v.userId ? null : await d.selectFrom("users").innerJoin("persons", "persons.id", "users.person_id").select("persons.name").where("users.id", "=", c.recorded_by).executeTakeFirst();
  const by = recorder ? { by: recorder.name } : {};
  const [facts, promises, dates, exchanges, relationships] = await Promise.all([
    d.selectFrom("facts").selectAll().where("conversation_id", "=", id).$call((qb) => visible(qb, v, "facts")).orderBy("created_at").execute(),
    d.selectFrom("promises").selectAll().where("conversation_id", "=", id).$call((qb) => visible(qb, v, "promises")).orderBy("created_at").execute(),
    d.selectFrom("dates").selectAll().where("conversation_id", "=", id).$call((qb) => visible(qb, v, "dates")).orderBy("created_at").execute(),
    d.selectFrom("exchanges").selectAll().where("conversation_id", "=", id).$call((qb) => visible(qb, v, "exchanges")).orderBy("created_at").execute(),
    d.selectFrom("relationships").selectAll().where("conversation_id", "=", id).$call((qb) => visible(qb, v, "relationships")).orderBy("created_at").execute(),
  ]);
  const ids = [...new Set([...[facts, promises, dates, exchanges].flat().map((x) => x.person_id), ...relationships.flatMap((r) => [r.from_id, r.to_id])])];
  const names = new Map(ids.length ? (await d.selectFrom("persons").select(["id", "name"]).where("id", "in", ids).execute()).map((p) => [p.id, p.name]) : []);
  const about = (personId: string): About => ({ personId, name: names.get(personId) ?? "" });
  return {
    id: c.id,
    date: c.date,
    kind: c.kind as ConversationKind,
    place: c.place,
    summary: c.summary,
    transcript: c.recorded_by === v.userId || !c.transcript_private ? c.transcript : null,
    visibility: c.visibility as Visibility,
    recordedBy: c.recorded_by,
    url: page,
    participants: participants.map((p) => ({ ...p, url: personPath(p.id) })),
    facts: facts.map((f) => ({ ...item("facts", f), ...about(f.person_id), text: f.text, category: f.category as FactCategory, status: f.status })),
    promises: promises.map((p) => ({ ...item("promises", p), ...about(p.person_id), text: p.text, byMe: !!p.by_me && !recorder, ...(p.by_me ? by : {}), due: p.due, done: !!p.done })),
    dates: dates.map((x) => ({ ...item("dates", x), ...about(x.person_id), kind: x.kind, date: x.date, label: x.label, yearly: !!x.yearly })),
    exchanges: exchanges.map((e) => ({
      ...item("exchanges", e),
      ...about(e.person_id),
      kind: e.kind as ExchangeKind,
      direction: e.direction,
      ...by,
      text: e.text,
      amount: e.amount,
      currency: e.currency,
      settled: !!e.settled,
    })),
    relationships: relationships.map((r) => ({ ...item("relationships", r), fromId: r.from_id, fromName: names.get(r.from_id) ?? "", toId: r.to_id, toName: names.get(r.to_id) ?? "", type: r.type as RelationshipType, note: r.note })),
  };
}
