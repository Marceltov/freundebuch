// Recording a conversation: the one write path for what Claude extracts from a ramble. Everything lands in one transaction, so a
// bad item leaves nothing behind. Privacy is decided here once: a private conversation makes every item private, and any private
// item makes the verbatim transcript private to the recorder (it contains the private part).
import type { Kysely } from "kysely";
import { assertDay, isDay, isYearless } from "./dates";
import { db, newId, now, type Schema } from "./db";
import { AmbiguousError, InvalidInputError, NotFoundError } from "./errors";
import { insertPerson, namedLike } from "./people";
import {
  CONVERSATION_KINDS,
  EXCHANGE_KINDS,
  FACT_CATEGORIES,
  RELATIONSHIP_TYPES,
  VISIBILITIES,
  type ConversationKind,
  type ExchangeKind,
  type FactCategory,
  type RelationshipType,
  type Viewer,
  type Visibility,
} from "./types";
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
  people: Array<{ id?: string; name?: string; aliases?: string[]; present: boolean; confirmedNew?: boolean }>;
  facts?: Array<{ person: PersonRef; text: string; category: FactCategory; private?: boolean; supersedes?: string }>;
  promises?: Array<{ person: PersonRef; text: string; byMe: boolean; due?: string; private?: boolean }>;
  /** `date` is `YYYY-MM-DD`, or `--MM-DD` for a yearly date without a year. */
  dates?: Array<{ person: PersonRef; kind: DateKind; date: string; label?: string; yearly: boolean; private?: boolean }>;
  exchanges?: Array<{ person: PersonRef; kind: ExchangeKind; direction: Direction; text: string; amount?: number; currency?: string; private?: boolean }>;
  relationships?: Array<{ from: PersonRef; to: PersonRef; type: RelationshipType; note?: string; private?: boolean }>;
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
export const MAX_SUMMARY = 2_000;

function oneOf<T extends string>(value: string, allowed: readonly T[], what: string): void {
  if (!allowed.includes(value as T)) throw new InvalidInputError(`Unknown ${what} "${value}"`);
}

/** Everything that can be checked without the database, so most bad input fails before the transaction starts. */
function validate(c: NewConversation): void {
  assertDay(c.date, "The conversation date");
  oneOf(c.kind, CONVERSATION_KINDS, "conversation kind");
  checkVisibility(c.visibility);
  if (c.summary.length > MAX_SUMMARY) throw new InvalidInputError(`The summary holds at most ${MAX_SUMMARY} characters`);
  if (c.transcript.length > MAX_TRANSCRIPT) throw new InvalidInputError(`The transcript holds at most ${MAX_TRANSCRIPT} characters`);
  for (const p of c.people) if (!p.id && !p.name?.trim()) throw new InvalidInputError("Each person needs an id (existing) or a name (new)");
  const ref = (r: PersonRef) => {
    if (!Number.isInteger(r) || r < 0 || r >= c.people.length) throw new InvalidInputError(`Person ${r} is not in people`);
  };
  for (const f of c.facts ?? []) {
    ref(f.person);
    oneOf(f.category, FACT_CATEGORIES, "fact category");
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
  for (const r of c.relationships ?? []) checkRelationship(r, ref);
  for (const g of c.groups ?? []) checkGroup(g, ref);
}

// The checks and writers of relationships and group memberships, shared with relate (relationships.ts), which records them
// without a conversation. `ref` checks one person reference: an index here, a person id there.

export function checkVisibility(visibility: string): void {
  oneOf(visibility, VISIBILITIES, "visibility");
}

export function checkRelationship<P>(r: { from: P; to: P; type: string }, ref: (p: P) => void): void {
  ref(r.from);
  ref(r.to);
  oneOf(r.type, RELATIONSHIP_TYPES, "relationship type");
  if (r.from === r.to) throw new InvalidInputError("A relationship needs two different people");
}

export function checkGroup<P>(g: { name: string; members: P[] }, ref: (p: P) => void): void {
  if (!g.name.trim()) throw new InvalidInputError("A group needs a name");
  g.members.forEach(ref);
}

/** Who recorded an item, when, and with which conversation (null for one set directly). */
export type ItemBase = { recorded_by: string; conversation_id: string | null; created_at: number };

export async function insertRelationship(
  tx: Kysely<Schema>,
  base: ItemBase,
  r: { fromId: string; toId: string; type: RelationshipType; note?: string; visibility: Visibility },
): Promise<string> {
  const id = newId();
  await tx.insertInto("relationships").values({ ...base, id, from_id: r.fromId, to_id: r.toId, type: r.type, note: r.note ?? null, visibility: r.visibility }).execute();
  return id;
}

/** Adds the people to the group with this name (created when there is none); returns how many memberships were new. */
export async function insertMemberships(tx: Kysely<Schema>, base: ItemBase, name: string, personIds: string[], visibility: Visibility): Promise<number> {
  const groupId = await groupNamed(tx, name.trim());
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
  return added;
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
        people.push({ ref, id: row.id, name: row.name, created: false });
      } else {
        const name = p.name!.trim();
        people.push({ ref, id: await insertPerson(tx, v, { name, aliases: p.aliases, createdFrom: conversationId }), name, created: true });
      }
    }
    const id = (r: PersonRef) => people[r].id;

    const present = new Set([v.personId, ...c.people.flatMap((p, r) => (p.present ? [id(r)] : []))]);
    for (const personId of present) await tx.insertInto("participants").values({ conversation_id: conversationId, person_id: personId }).execute();

    for (const f of c.facts ?? []) {
      const factId = newId();
      await tx.insertInto("facts").values({ ...base, id: factId, person_id: id(f.person), text: f.text, category: f.category, visibility: vis(f) }).execute();
      if (f.supersedes) await outdate(tx, v, f.supersedes, factId, id(f.person), vis(f));
    }
    for (const p of c.promises ?? [])
      await tx.insertInto("promises").values({ ...base, id: newId(), person_id: id(p.person), text: p.text, by_me: p.byMe ? 1 : 0, due: p.due ?? null, visibility: vis(p) }).execute();
    for (const d of c.dates ?? [])
      await tx
        .insertInto("dates")
        .values({ ...base, id: newId(), person_id: id(d.person), kind: d.kind, date: d.date, label: d.label ?? null, yearly: d.yearly ? 1 : 0, visibility: vis(d) })
        .execute();
    for (const e of c.exchanges ?? [])
      await tx
        .insertInto("exchanges")
        .values({ ...base, id: newId(), person_id: id(e.person), kind: e.kind, direction: e.direction, text: e.text, amount: e.amount ?? null, currency: e.currency ?? null, visibility: vis(e) })
        .execute();
    for (const r of c.relationships ?? []) await insertRelationship(tx, base, { fromId: id(r.from), toId: id(r.to), type: r.type, note: r.note, visibility: vis(r) });
    let memberships = 0;
    for (const g of c.groups ?? []) memberships += await insertMemberships(tx, base, g.name, g.members.map(id), vis(g));

    const counts = { ...(Object.fromEntries(ITEM_KINDS.map((k) => [k, c[k]?.length ?? 0])) as Recorded["counts"]), groups: memberships };
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

/** The group with this exact name, created when there is none. Group names carry no visibility; their memberships do. */
async function groupNamed(tx: Kysely<Schema>, name: string): Promise<string> {
  const found = await tx.selectFrom("groups").select("id").where("name", "=", name).executeTakeFirst();
  if (found) return found.id;
  const id = newId();
  await tx.insertInto("groups").values({ id, name }).execute();
  return id;
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
