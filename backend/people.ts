// Persons and their aliases. Persons themselves are shared by everyone; what hangs off them (relationships, conversations) is
// visible per viewer, and the hints in a Candidate only use what the viewer may see.
import type { Kysely } from "kysely";
import { db, newId, now, type Schema } from "./db";
import { InvalidInputError, NotFoundError } from "./errors";
import { lastSeen } from "./intervals";
import { norm, within } from "./names";
import type { RelationshipType, Viewer } from "./types";
import { personPath } from "./urls";
import { visible } from "./visibility";

export type Candidate = { id: string; name: string; aliases: string[]; url: string; context: string[] };
export type PersonView = { id: string; name: string; aliases: string[]; url: string; createdFrom: string | null };

const MAX_CONTEXT = 3;
const FUZZY_MIN = 5;

type NewPerson = { name: string; aliases?: string[]; createdFrom?: string };

export async function createPerson(v: Viewer, p: NewPerson): Promise<string> {
  return (await db()).transaction().execute((tx) => insertPerson(tx, v, p));
}

/** `createPerson` inside the caller's transaction, for writes that create persons along with other rows. */
export async function insertPerson(d: Kysely<Schema>, v: Viewer, p: NewPerson): Promise<string> {
  const name = p.name.trim();
  if (!name) throw new InvalidInputError("A person needs a name");
  const id = newId();
  await d.insertInto("persons").values({ id, name, created_by: v.userId, created_from: p.createdFrom ?? null, created_at: now() }).execute();
  for (const alias of p.aliases ?? []) await insertAlias(d, id, name, alias);
  return id;
}

export async function insertAlias(d: Kysely<Schema>, personId: string, name: string, alias: string): Promise<void> {
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
  return Promise.all(hits.map(async ({ p }) => ({ id: p.id, name: p.name, aliases: aliases.get(p.id) ?? [], url: personPath(p.id), context: await contextFor(v, p.id) })));
}

/** The people whose name or one of whose aliases is `name` once normalised; names and aliases are shared, the context is the viewer's. */
export async function namedLike(v: Viewer, name: string): Promise<Candidate[]> {
  const n = norm(name);
  const [people, aliases] = await Promise.all([(await db()).selectFrom("persons").select(["id", "name"]).orderBy("name").execute(), aliasesByPerson()]);
  const hits = people.filter((p) => norm(p.name) === n || (aliases.get(p.id) ?? []).some((a) => norm(a) === n));
  return Promise.all(hits.map(async (p) => ({ id: p.id, name: p.name, aliases: aliases.get(p.id) ?? [], url: personPath(p.id), context: await contextFor(v, p.id) })));
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
    .$call((qb) => visible(qb, v, "relationships"))
    .orderBy("created_at")
    .execute();
  for (const r of rels) {
    const outgoing = r.from_id === personId;
    const label = LABELS[r.type as RelationshipType]?.[outgoing ? "out" : "in"] ?? "knows";
    const other = await d.selectFrom("persons").select("name").where("id", "=", outgoing ? r.to_id : r.from_id).executeTakeFirst();
    if (other) hints.push(`${label} ${other.name}`);
  }
  const last = await lastSeen(v, personId);
  if (last) hints.push(`last seen ${last}`);
  return hints.slice(0, MAX_CONTEXT);
}

/**
 * The conversation a person was first mentioned in, when the viewer may know it: they recorded it, or it is visible and shows the
 * person to them (as a participant or through an item they can see). A person first mentioned only in private items keeps the
 * link hidden, because the link alone would tell the partner where that person came up.
 */
async function createdFromFor(v: Viewer, personId: string, conversationId: string): Promise<string | null> {
  const d = await db();
  const c = await d
    .selectFrom("conversations")
    .select("recorded_by")
    .where("id", "=", conversationId)
    .$call((qb) => visible(qb, v, "conversations"))
    .executeTakeFirst();
  if (!c) return null;
  if (c.recorded_by === v.userId) return conversationId;
  const shows = [
    d.selectFrom("participants").select("person_id").where("conversation_id", "=", conversationId).where("person_id", "=", personId),
    ...(["facts", "promises", "dates", "exchanges"] as const).map((t) =>
      d.selectFrom(t).select("id").where("conversation_id", "=", conversationId).where("person_id", "=", personId).$call((qb) => visible(qb, v, t)),
    ),
    d
      .selectFrom("relationships")
      .select("id")
      .where("conversation_id", "=", conversationId)
      .where((eb) => eb.or([eb("from_id", "=", personId), eb("to_id", "=", personId)]))
      .$call((qb) => visible(qb, v, "relationships")),
  ];
  for (const q of shows) if (await q.executeTakeFirst()) return conversationId;
  return null;
}

async function toViews(v: Viewer, rows: { id: string; name: string; created_from: string | null }[]): Promise<PersonView[]> {
  const aliases = await aliasesByPerson();
  return Promise.all(rows.map(async (r) => ({ id: r.id, name: r.name, aliases: aliases.get(r.id) ?? [], url: personPath(r.id), createdFrom: r.created_from ? await createdFromFor(v, r.id, r.created_from) : null })));
}

export async function getPerson(v: Viewer, id: string): Promise<PersonView> {
  const row = await (await db()).selectFrom("persons").select(["id", "name", "created_from"]).where("id", "=", id).executeTakeFirst();
  if (!row) throw new NotFoundError("No such person");
  return (await toViews(v, [row]))[0];
}

export async function listPeople(v: Viewer): Promise<PersonView[]> {
  return toViews(v, await (await db()).selectFrom("persons").select(["id", "name", "created_from"]).orderBy("name").execute());
}

/** Someone in the people list: last seen and groups as the viewer sees them. */
export type PersonOverview = { id: string; name: string; aliases: string[]; url: string; lastSeen: string | null; groups: string[] };

/** Everyone but the viewer, by name, with when the viewer last saw them and the ids of the groups the viewer sees them in. */
export async function peopleOverview(v: Viewer): Promise<PersonOverview[]> {
  const d = await db();
  const [people, aliases, memberships] = await Promise.all([
    d.selectFrom("persons").select(["id", "name"]).where("id", "!=", v.personId).execute(),
    aliasesByPerson(),
    d.selectFrom("group_members").select(["person_id", "group_id"]).distinct().$call((qb) => visible(qb, v, "group_members")).execute(),
  ]);
  const rows = await Promise.all(
    people.map(async (p) => ({
      id: p.id,
      name: p.name,
      aliases: aliases.get(p.id) ?? [],
      url: personPath(p.id),
      lastSeen: await lastSeen(v, p.id),
      groups: memberships.filter((m) => m.person_id === p.id).map((m) => m.group_id),
    })),
  );
  return rows.sort((a, b) => a.name.localeCompare(b.name, "de"));
}
