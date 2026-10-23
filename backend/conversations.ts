// Recording a conversation: the one write path for what Claude extracts from a ramble. Everything lands in one transaction, so a
// bad item leaves nothing behind. Privacy is decided here once: a private conversation makes every item private, and any private
// item makes the verbatim transcript private to the recorder (it contains the private part).
import type { Kysely } from "kysely";
import { db, newId, now, type Schema } from "./db";
import { InvalidInputError, NotFoundError } from "./errors";
import { insertPerson } from "./people";
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
  /** `id` links an existing person, `name` creates one. `present` makes them a participant. */
  people: Array<{ id?: string; name?: string; aliases?: string[]; present: boolean }>;
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
  people: Array<{ ref: PersonRef; id: string; name: string; created: boolean }>;
  counts: Record<(typeof ITEM_KINDS)[number], number>;
};

type Item = { id: string; visibility: Visibility; recordedBy: string };
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
  participants: Array<{ id: string; name: string }>;
  facts: Array<Item & { personId: string; text: string; category: FactCategory; status: "current" | "outdated" }>;
  promises: Array<Item & { personId: string; text: string; byMe: boolean; due: string | null; done: boolean }>;
  dates: Array<Item & { personId: string; kind: DateKind; date: string; label: string | null; yearly: boolean }>;
  exchanges: Array<Item & { personId: string; kind: ExchangeKind; direction: Direction; text: string; amount: number | null; currency: string | null; settled: boolean }>;
  relationships: Array<Item & { fromId: string; toId: string; type: RelationshipType; note: string | null }>;
};

export const MAX_TRANSCRIPT = 200_000;
export const MAX_SUMMARY = 2_000;
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const YEARLESS = /^--\d{2}-\d{2}$/;

function oneOf<T extends string>(value: string, allowed: readonly T[], what: string): void {
  if (!allowed.includes(value as T)) throw new InvalidInputError(`Unknown ${what} "${value}"`);
}

function day(value: string, what: string): void {
  if (!DAY.test(value)) throw new InvalidInputError(`${what} must be YYYY-MM-DD, got "${value}"`);
}

/** Everything that can be checked without the database, so most bad input fails before the transaction starts. */
function validate(c: NewConversation): void {
  day(c.date, "The conversation date");
  oneOf(c.kind, CONVERSATION_KINDS, "conversation kind");
  oneOf(c.visibility, VISIBILITIES, "visibility");
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
    if (p.due !== undefined) day(p.due, "A promise's due date");
  }
  for (const d of c.dates ?? []) {
    ref(d.person);
    oneOf(d.kind, ["birthday", "anniversary", "custom"], "date kind");
    if (!DAY.test(d.date) && !(d.yearly && YEARLESS.test(d.date))) throw new InvalidInputError(`A date must be YYYY-MM-DD, or --MM-DD when yearly; got "${d.date}"`);
  }
  for (const e of c.exchanges ?? []) {
    ref(e.person);
    oneOf(e.kind, EXCHANGE_KINDS, "exchange kind");
    oneOf(e.direction, ["to_them", "from_them"], "direction");
  }
  for (const r of c.relationships ?? []) {
    ref(r.from);
    ref(r.to);
    oneOf(r.type, RELATIONSHIP_TYPES, "relationship type");
    if (r.from === r.to) throw new InvalidInputError("A relationship needs two different people");
  }
  for (const g of c.groups ?? []) {
    if (!g.name.trim()) throw new InvalidInputError("A group needs a name");
    g.members.forEach(ref);
  }
}

export async function recordConversation(v: Viewer, c: NewConversation): Promise<Recorded> {
  validate(c);
  const vis = (item: { private?: boolean }): Visibility => (c.visibility === "private" || item.private ? "private" : "shared");
  const items = [...(c.facts ?? []), ...(c.promises ?? []), ...(c.dates ?? []), ...(c.exchanges ?? []), ...(c.relationships ?? []), ...(c.groups ?? [])];
  const transcriptPrivate = c.visibility === "private" || items.some((i) => i.private) ? 1 : 0;
  const conversationId = newId();
  const t = now();
  const base = { recorded_by: v.userId, conversation_id: conversationId, created_at: t };

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

    const people: Recorded["people"] = [];
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
      if (f.supersedes) await outdate(tx, v, f.supersedes, id(f.person));
      await tx.insertInto("facts").values({ ...base, id: newId(), person_id: id(f.person), text: f.text, category: f.category, visibility: vis(f) }).execute();
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
    for (const r of c.relationships ?? [])
      await tx.insertInto("relationships").values({ ...base, id: newId(), from_id: id(r.from), to_id: id(r.to), type: r.type, note: r.note ?? null, visibility: vis(r) }).execute();
    for (const g of c.groups ?? []) {
      const groupId = await groupNamed(tx, g.name.trim());
      // A membership that already exists keeps its visibility; only its recorder may change that.
      for (const m of new Set(g.members.map(id)))
        await tx.insertInto("group_members").values({ group_id: groupId, person_id: m, visibility: vis(g), recorded_by: v.userId }).onConflict((oc) => oc.doNothing()).execute();
    }

    const counts = Object.fromEntries(ITEM_KINDS.map((k) => [k, c[k]?.length ?? 0])) as Recorded["counts"];
    return { conversationId, people, counts };
  });
}

/** Marks a fact the viewer can see as outdated; it must be about the same person as the fact that replaces it. */
async function outdate(tx: Kysely<Schema>, v: Viewer, factId: string, personId: string): Promise<void> {
  const old = await tx.selectFrom("facts").select("person_id").where("id", "=", factId).$call((qb) => visible(qb, v, "facts")).executeTakeFirst();
  if (!old) throw new NotFoundError(`No such fact: ${factId}`);
  if (old.person_id !== personId) throw new InvalidInputError("A fact can only supersede a fact about the same person");
  await tx.updateTable("facts").set({ status: "outdated" }).where("id", "=", factId).execute();
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
  const item = (r: { id: string; visibility: string; recorded_by: string }): Item => ({ id: r.id, visibility: r.visibility as Visibility, recordedBy: r.recorded_by });
  const [facts, promises, dates, exchanges, relationships] = await Promise.all([
    d.selectFrom("facts").selectAll().where("conversation_id", "=", id).$call((qb) => visible(qb, v, "facts")).orderBy("created_at").execute(),
    d.selectFrom("promises").selectAll().where("conversation_id", "=", id).$call((qb) => visible(qb, v, "promises")).orderBy("created_at").execute(),
    d.selectFrom("dates").selectAll().where("conversation_id", "=", id).$call((qb) => visible(qb, v, "dates")).orderBy("created_at").execute(),
    d.selectFrom("exchanges").selectAll().where("conversation_id", "=", id).$call((qb) => visible(qb, v, "exchanges")).orderBy("created_at").execute(),
    d.selectFrom("relationships").selectAll().where("conversation_id", "=", id).$call((qb) => visible(qb, v, "relationships")).orderBy("created_at").execute(),
  ]);
  return {
    id: c.id,
    date: c.date,
    kind: c.kind as ConversationKind,
    place: c.place,
    summary: c.summary,
    transcript: c.recorded_by === v.userId || !c.transcript_private ? c.transcript : null,
    visibility: c.visibility as Visibility,
    recordedBy: c.recorded_by,
    participants,
    facts: facts.map((f) => ({ ...item(f), personId: f.person_id, text: f.text, category: f.category as FactCategory, status: f.status })),
    promises: promises.map((p) => ({ ...item(p), personId: p.person_id, text: p.text, byMe: !!p.by_me, due: p.due, done: !!p.done })),
    dates: dates.map((x) => ({ ...item(x), personId: x.person_id, kind: x.kind, date: x.date, label: x.label, yearly: !!x.yearly })),
    exchanges: exchanges.map((e) => ({
      ...item(e),
      personId: e.person_id,
      kind: e.kind as ExchangeKind,
      direction: e.direction,
      text: e.text,
      amount: e.amount,
      currency: e.currency,
      settled: !!e.settled,
    })),
    relationships: relationships.map((r) => ({ ...item(r), fromId: r.from_id, toId: r.to_id, type: r.type as RelationshipType, note: r.note })),
  };
}
