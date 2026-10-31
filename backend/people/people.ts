// Persons and their aliases. Persons themselves are shared by everyone; what hangs off them (relationships, conversations) is
// visible per viewer, and the hints in a Candidate only use what the viewer may see.
import { scope, type Scope } from "../db/scope";
import { newId, now } from "../db";
import { InvalidInputError, NotFoundError } from "../core/errors";
import { lastSeen } from "./intervals";
import { parseLook } from "./looks";
import { norm, rank } from "./names";
import { GENDERS, type Gender, type Look, type Viewer } from "../core/types";
import { personPath } from "../core/urls";
import { visible } from "../visibility";

export type Candidate = { id: string; name: string; aliases: string[]; url: string; context: string[] };
/** `gender` and `look` are shared like the name; null when they aren't known. */
export type PersonView = { id: string; name: string; aliases: string[]; url: string; createdFrom: string | null; gender: Gender | null; look: Look | null };

const MAX_CONTEXT = 3;

type NewPerson = { name: string; aliases?: string[]; createdFrom?: string; gender?: Gender };

export async function createPerson(v: Viewer, p: NewPerson): Promise<string> {
  return (await scope(v)).transaction((tx) => insertPerson(tx, v, p));
}

/** `createPerson` inside the caller's transaction, for writes that create persons along with other rows. */
export async function insertPerson(d: Scope, v: Viewer, p: NewPerson): Promise<string> {
  const name = p.name.trim();
  if (!name) throw new InvalidInputError("A person needs a name");
  if (p.gender !== undefined) checkGender(p.gender);
  const id = newId();
  await d.insert("persons", { id, name, created_by: v.userId, created_from: p.createdFrom ?? null, created_at: now(), gender: p.gender ?? null }).execute();
  for (const alias of p.aliases ?? []) await insertAlias(d, id, name, alias);
  return id;
}

export function checkGender(gender: unknown): asserts gender is Gender | null {
  if (gender !== null && !GENDERS.includes(gender as Gender))
    throw new InvalidInputError(`Gender must be one of ${GENDERS.join(", ")}, or null when it isn't known`);
}

/** A relationship whose words may need the person's new gender: `label` what `from` is to `to`, `inverse` what `to` is to `from`. */
export type Relabel = { id: string; fromId: string; fromName: string; toId: string; toName: string; label: string; inverse: string };

/**
 * Sets or (with null) clears a person's gender. Shared like the name, so either user may set it. The words of a relationship
 * are written in each end's gender, which the server can't change for them: it returns the person's relationships whose word
 * for them may need the new gender (an edit of `label` or `inverse`).
 */
export async function setGender(v: Viewer, personId: string, gender: Gender | null): Promise<{ relabel: Relabel[] }> {
  checkGender(gender);
  const d = await scope(v);
  const before = await d.from("persons").select("gender").where("id", "=", personId).executeTakeFirst();
  if (!before) throw new NotFoundError("No such person");
  await d.update("persons").set({ gender }).where("id", "=", personId).execute();
  return { relabel: await relabelFor(d, v, personId, before.gender, gender) };
}

// Words for one end of a relationship that don't say a gender yet: the ":in" forms and the few neutral nouns.
const NEUTRAL = new Set(["elternteil", "kind", "geschwister", "enkelkind", "patenkind", "partner", "person"]);
const isNeutral = (word: string) => /[:*_/](in|innen|r)\b/i.test(word) || NEUTRAL.has(word.trim().toLowerCase());

/**
 * The person's relationships the viewer may edit (every one they see: their own and the shared ones) whose word for the person
 * may need their new gender. A first gender (from none) needs only the words still neutral ("Vermieter:in", "Kind"): Claude
 * wrote the rest in the gender it already knew. Another gender needs every word; the same one again, none.
 */
export async function relabelFor(d: Scope, v: Viewer, personId: string, before: Gender | null, after: Gender | null): Promise<Relabel[]> {
  if (before === after) return [];
  const rels = await d
    .from("relationships")
    .select(["id", "from_id", "to_id", "label", "inverse"])
    .where((eb) => eb.or([eb("from_id", "=", personId), eb("to_id", "=", personId)]))
    .$call((qb) => visible(qb, v, "relationships"))
    .orderBy("created_at")
    .orderBy("id")
    .execute();
  const ids = [...new Set(rels.flatMap((x) => [x.from_id, x.to_id]))];
  const names = new Map(ids.length ? (await d.from("persons").select(["id", "name"]).where("id", "in", ids).execute()).map((p) => [p.id, p.name]) : []);
  return rels
    .filter((x) => before !== null || isNeutral(x.from_id === personId ? x.label : x.inverse))
    .map((x) => ({
      id: x.id,
      fromId: x.from_id,
      fromName: names.get(x.from_id) ?? "",
      toId: x.to_id,
      toName: names.get(x.to_id) ?? "",
      label: x.label,
      inverse: x.inverse,
    }));
}

export async function insertAlias(s: Scope, personId: string, name: string, alias: string): Promise<void> {
  const a = alias.trim();
  if (!a) throw new InvalidInputError("An alias can't be empty");
  if (norm(a) === norm(name)) return; // the name already matches
  await s
    .insert("aliases", { person_id: personId, alias: a, norm: norm(a) })
    .onConflict((oc) => oc.doNothing())
    .execute();
}

export async function addAlias(v: Viewer, id: string, alias: string): Promise<void> {
  void v;
  const d = await scope(v);
  const person = await d.from("persons").select("name").where("id", "=", id).executeTakeFirst();
  if (!person) throw new NotFoundError("No such person");
  await insertAlias(d, id, person.name, alias);
}

async function aliasesByPerson(v: Viewer): Promise<Map<string, string[]>> {
  const rows = await (await scope(v)).from("aliases").select(["person_id", "alias"]).orderBy("alias").execute();
  const m = new Map<string, string[]>();
  for (const r of rows) m.set(r.person_id, [...(m.get(r.person_id) ?? []), r.alias]);
  return m;
}

/** 0 exact, 1 prefix of the name or one of its words, 2 one edit away; null when it doesn't match. */
export async function findPeople(v: Viewer, q: string, limit = 5): Promise<Candidate[]> {
  const nq = norm(q);
  if (!nq) return [];
  const [people, aliases] = await Promise.all([(await scope(v)).from("persons").select(["id", "name"]).execute(), aliasesByPerson(v)]);
  const hits = people
    .map((p) => ({ p, r: rank(nq, [p.name, ...(aliases.get(p.id) ?? [])]) }))
    .filter((h): h is { p: (typeof people)[number]; r: number } => h.r !== null)
    .sort((x, y) => x.r - y.r || x.p.name.localeCompare(y.p.name))
    .slice(0, limit);
  return Promise.all(
    hits.map(async ({ p }) => ({ id: p.id, name: p.name, aliases: aliases.get(p.id) ?? [], url: personPath(p.id), context: await contextFor(v, p.id) })),
  );
}

/** The people whose name or one of whose aliases is `name` once normalised; names and aliases are shared, the context is the viewer's. */
export async function namedLike(v: Viewer, name: string): Promise<Candidate[]> {
  const n = norm(name);
  const [people, aliases] = await Promise.all([(await scope(v)).from("persons").select(["id", "name"]).orderBy("name").execute(), aliasesByPerson(v)]);
  const hits = people.filter((p) => norm(p.name) === n || (aliases.get(p.id) ?? []).some((a) => norm(a) === n));
  return Promise.all(
    hits.map(async (p) => ({ id: p.id, name: p.name, aliases: aliases.get(p.id) ?? [], url: personPath(p.id), context: await contextFor(v, p.id) })),
  );
}

/** Hints that help tell two people with the same name apart, built only from what the viewer can see. */
async function contextFor(v: Viewer, personId: string): Promise<string[]> {
  const d = await scope(v);
  const hints: string[] = [];
  const rels = await d
    .from("relationships")
    .select(["from_id", "to_id", "label", "inverse"])
    .where((eb) => eb.or([eb("from_id", "=", personId), eb("to_id", "=", personId)]))
    .$call((qb) => visible(qb, v, "relationships"))
    .orderBy("created_at")
    .execute();
  for (const r of rels) {
    const outgoing = r.from_id === personId;
    // What the person is to the other, in the words filed ("Vermieterin of Tom").
    const label = outgoing ? r.label : r.inverse;
    const other = await d
      .from("persons")
      .select("name")
      .where("id", "=", outgoing ? r.to_id : r.from_id)
      .executeTakeFirst();
    if (other) hints.push(`${label} of ${other.name}`);
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
  const d = await scope(v);
  const c = await d
    .from("conversations")
    .select("recorded_by")
    .where("id", "=", conversationId)
    .$call((qb) => visible(qb, v, "conversations"))
    .executeTakeFirst();
  if (!c) return null;
  if (c.recorded_by === v.userId) return conversationId;
  const shows = [
    d.from("participants").select("person_id").where("conversation_id", "=", conversationId).where("person_id", "=", personId),
    ...(["facts", "promises", "dates", "exchanges"] as const).map((t) =>
      d
        .from(t)
        .select("id")
        .where("conversation_id", "=", conversationId)
        .where("person_id", "=", personId)
        .$call((qb) => visible(qb, v, t)),
    ),
    d
      .from("relationships")
      .select("id")
      .where("conversation_id", "=", conversationId)
      .where((eb) => eb.or([eb("from_id", "=", personId), eb("to_id", "=", personId)]))
      .$call((qb) => visible(qb, v, "relationships")),
  ];
  for (const q of shows) if (await q.executeTakeFirst()) return conversationId;
  return null;
}

async function toViews(
  v: Viewer,
  rows: { id: string; name: string; created_from: string | null; gender: Gender | null; look: string | null }[],
): Promise<PersonView[]> {
  const aliases = await aliasesByPerson(v);
  return Promise.all(
    rows.map(async (r) => ({
      id: r.id,
      name: r.name,
      aliases: aliases.get(r.id) ?? [],
      url: personPath(r.id),
      createdFrom: r.created_from ? await createdFromFor(v, r.id, r.created_from) : null,
      gender: r.gender,
      look: parseLook(r.look),
    })),
  );
}

export async function getPerson(v: Viewer, id: string): Promise<PersonView> {
  const row = await (await scope(v)).from("persons").select(["id", "name", "created_from", "gender", "look"]).where("id", "=", id).executeTakeFirst();
  if (!row) throw new NotFoundError("No such person");
  return (await toViews(v, [row]))[0];
}

export async function listPeople(v: Viewer): Promise<PersonView[]> {
  return toViews(v, await (await scope(v)).from("persons").select(["id", "name", "created_from", "gender", "look"]).orderBy("name").execute());
}

/** Someone in the people list: last seen and groups as the viewer sees them. */
export type PersonOverview = { id: string; name: string; aliases: string[]; url: string; lastSeen: string | null; groups: string[] };

/** Everyone but the viewer, by name, with when the viewer last saw them and the ids of the groups the viewer sees them in. */
export async function peopleOverview(v: Viewer): Promise<PersonOverview[]> {
  const d = await scope(v);
  const [people, aliases, memberships] = await Promise.all([
    d.from("persons").select(["id", "name"]).where("id", "!=", v.personId).execute(),
    aliasesByPerson(v),
    d
      .from("group_members")
      .select(["person_id", "group_id"])
      .distinct()
      .$call((qb) => visible(qb, v, "group_members"))
      .execute(),
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
