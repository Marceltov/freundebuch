// Persons and their aliases. Persons themselves are shared by everyone; what hangs off them (relationships, conversations) is
// visible per viewer, and the hints in a Candidate only use what the viewer may see.
import type { ExpressionBuilder } from "kysely";
import { db, newId, now } from "./db";
import { InvalidInputError, NotFoundError } from "./errors";
import { norm, within } from "./names";
import type { RelationshipType, Viewer } from "./types";

export type Candidate = { id: string; name: string; aliases: string[]; context: string[] };
export type PersonView = { id: string; name: string; aliases: string[]; createdFrom: string | null };

const MAX_CONTEXT = 3;
const FUZZY_MIN = 5;

/** A row is visible to the viewer when it is shared or they recorded it. Task 4 replaces this with the shared helper in visibility.ts. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const visibleTo = (v: Viewer) => (eb: ExpressionBuilder<any, any>) => eb.or([eb("visibility", "=", "shared"), eb("recorded_by", "=", v.userId)]);

export async function createPerson(v: Viewer, p: { name: string; aliases?: string[]; createdFrom?: string }): Promise<string> {
  const name = p.name.trim();
  if (!name) throw new InvalidInputError("A person needs a name");
  const id = newId();
  const d = await db();
  await d.transaction().execute(async (tx) => {
    await tx.insertInto("persons").values({ id, name, created_by: v.userId, created_from: p.createdFrom ?? null, created_at: now() }).execute();
    for (const alias of p.aliases ?? []) await insertAlias(tx, id, name, alias);
  });
  return id;
}

async function insertAlias(d: Awaited<ReturnType<typeof db>>, personId: string, name: string, alias: string): Promise<void> {
  const a = alias.trim();
  if (!a) throw new InvalidInputError("An alias can't be empty");
  if (norm(a) === norm(name)) return; // the name already matches
  await d.insertInto("aliases").values({ person_id: personId, alias: a, norm: norm(a) }).onConflict((oc) => oc.doNothing()).execute();
}

export async function addAlias(v: Viewer, id: string, alias: string): Promise<void> {
  void v;
  const d = await db();
  const person = await d.selectFrom("persons").select("name").where("id", "=", id).executeTakeFirst();
  if (!person) throw new NotFoundError("No such person");
  await insertAlias(d, id, person.name, alias);
}

async function aliasesByPerson(): Promise<Map<string, string[]>> {
  const rows = await (await db()).selectFrom("aliases").select(["person_id", "alias"]).orderBy("alias").execute();
  const m = new Map<string, string[]>();
  for (const r of rows) m.set(r.person_id, [...(m.get(r.person_id) ?? []), r.alias]);
  return m;
}

/** 0 exact, 1 prefix of the name or one of its words, 2 one edit away; null when it doesn't match. */
function rank(q: string, strings: string[]): number | null {
  let best: number | null = null;
  const consider = (r: number) => (best = best === null ? r : Math.min(best, r));
  for (const s of strings.map(norm)) {
    if (s === q) return 0;
    const words = s.split(" ");
    if (words.some((w) => w.startsWith(q)) || s.startsWith(q)) consider(1);
    else if (q.length >= FUZZY_MIN && [s, ...words].some((w) => w.length >= FUZZY_MIN && within(q, w, 1))) consider(2);
  }
  return best;
}

export async function findPeople(v: Viewer, q: string, limit = 5): Promise<Candidate[]> {
  const nq = norm(q);
  if (!nq) return [];
  const [people, aliases] = await Promise.all([(await db()).selectFrom("persons").select(["id", "name"]).execute(), aliasesByPerson()]);
  const hits = people
    .map((p) => ({ p, r: rank(nq, [p.name, ...(aliases.get(p.id) ?? [])]) }))
    .filter((h): h is { p: (typeof people)[number]; r: number } => h.r !== null)
    .sort((x, y) => x.r - y.r || x.p.name.localeCompare(y.p.name))
    .slice(0, limit);
  return Promise.all(hits.map(async ({ p }) => ({ id: p.id, name: p.name, aliases: aliases.get(p.id) ?? [], context: await contextFor(v, p.id) })));
}

// How a relationship reads from the person's side: `out` when they are `from`, `in` when they are `to`. "Tom" is appended.
const LABELS: Record<RelationshipType, { out: string; in: string }> = {
  partner: { out: "partner of", in: "partner of" },
  spouse: { out: "spouse of", in: "spouse of" },
  sibling: { out: "sibling of", in: "sibling of" },
  friend: { out: "friend of", in: "friend of" },
  colleague: { out: "colleague of", in: "colleague of" },
  parent: { out: "parent of", in: "child of" },
  child: { out: "child of", in: "parent of" },
  introduced_by: { out: "introduced by", in: "introduced" },
  other: { out: "knows", in: "knows" },
};

/** Hints that help tell two people with the same name apart, built only from what the viewer can see. */
async function contextFor(v: Viewer, personId: string): Promise<string[]> {
  const d = await db();
  const hints: string[] = [];
  const rels = await d
    .selectFrom("relationships")
    .select(["from_id", "to_id", "type"])
    .where((eb) => eb.or([eb("from_id", "=", personId), eb("to_id", "=", personId)]))
    .where(visibleTo(v))
    .orderBy("created_at")
    .execute();
  for (const r of rels) {
    const outgoing = r.from_id === personId;
    const label = LABELS[r.type as RelationshipType]?.[outgoing ? "out" : "in"] ?? "knows";
    const other = await d.selectFrom("persons").select("name").where("id", "=", outgoing ? r.to_id : r.from_id).executeTakeFirst();
    if (other) hints.push(`${label} ${other.name}`);
  }
  const last = await d
    .selectFrom("conversations")
    .innerJoin("participants", "participants.conversation_id", "conversations.id")
    .select("conversations.date")
    .where("participants.person_id", "=", personId)
    .where(visibleTo(v))
    .orderBy("conversations.date", "desc")
    .executeTakeFirst();
  if (last) hints.push(`last conversation ${last.date}`);
  return hints.slice(0, MAX_CONTEXT);
}

async function visibleConversationIds(v: Viewer, ids: string[]): Promise<Set<string>> {
  if (!ids.length) return new Set();
  const rows = await (await db()).selectFrom("conversations").select("id").where("id", "in", ids).where(visibleTo(v)).execute();
  return new Set(rows.map((r) => r.id));
}

async function toViews(v: Viewer, rows: { id: string; name: string; created_from: string | null }[]): Promise<PersonView[]> {
  const [aliases, visible] = await Promise.all([aliasesByPerson(), visibleConversationIds(v, rows.flatMap((r) => (r.created_from ? [r.created_from] : [])))]);
  return rows.map((r) => ({ id: r.id, name: r.name, aliases: aliases.get(r.id) ?? [], createdFrom: r.created_from && visible.has(r.created_from) ? r.created_from : null }));
}

export async function getPerson(v: Viewer, id: string): Promise<PersonView> {
  const row = await (await db()).selectFrom("persons").select(["id", "name", "created_from"]).where("id", "=", id).executeTakeFirst();
  if (!row) throw new NotFoundError("No such person");
  return (await toViews(v, [row]))[0];
}

export async function listPeople(v: Viewer): Promise<PersonView[]> {
  return toViews(v, await (await db()).selectFrom("persons").select(["id", "name", "created_from"]).orderBy("name").execute());
}
