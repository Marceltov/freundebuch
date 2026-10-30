// Places: where something happened, a record of its own with other names, as people have. A place exists for a viewer only
// through a part they may see; so a place the other user holds only
// through private parts is neither found nor reused, and a new one is made. Parts are conversations, experiences and series. Names match as people's do (names.ts).
import { sql, type Kysely } from "kysely";
import { db, newId, now, type Schema } from "./db";
import { AmbiguousError, InvalidInputError, NotFoundError } from "./errors";
import { norm, rank } from "./names";
import type { Viewer } from "./types";
import { personPath, placePath } from "./urls";
import { visible } from "./visibility";

/** How a part names its place: by name (an exact name or other name is reused), by id, or as a new one the user confirmed. */
export type PlaceRef = string | { id: string } | { name: string; confirmedNew?: boolean };
type Link = { id: string; name: string; url: string };
/** A place as found: `parents` nearest first, `owners` whose home it is, as far as the viewer may see. */
export type PlaceCandidate = { id: string; name: string; aliases: string[]; parents: Link[]; address: string | null; owners: Link[]; url: string };

export const MAX_PLACE = 120;

/** The places with something at them the viewer may see, or a home of someone they may see is theirs. */
function seenDirectly(d: Kysely<Schema>, v: Viewer) {
  return d
    .selectFrom("places")
    .select("places.id")
    .where((eb) =>
      eb.or([
        ...(["conversations", "experiences", "series"] as const).map((t) =>
          eb(
            "places.id",
            "in",
            d
              .selectFrom(t as "conversations")
              .select("place_id")
              .where("place_id", "is not", null)
              .$call((qb) => visible(qb, v, t)) as never,
          ),
        ),
        eb("places.id", "in", d.selectFrom("place_owners").select("place_id").$call((qb) => visible(qb, v, "place_owners"))),
      ]),
    );
}

/**
 * The ids of the places the viewer may see: those seen directly (seenDirectly), and every place one of them sits inside. Only
 * upward: whoever sees the Olympiahalle may know it is in München, but a place inside one they see stays hidden unless it is seen
 * itself. A place with nothing left at it is found no more.
 */
export function visiblePlaceIds(d: Kysely<Schema>, v: Viewer) {
  return sql<string>`(with recursive seen(id) as (select id from places where id in ${seenDirectly(d, v)} union select p.parent_id from places p join seen on p.id = seen.id where p.parent_id is not null) select id from seen)`;
}

/** The place `id` and the places inside it, at any depth, that the viewer may see. */
export function placeAndInsideIds(d: Kysely<Schema>, v: Viewer, id: string) {
  return sql<string>`(with recursive down(id) as (select ${id} union select p.id from places p join down on p.parent_id = down.id) select id from down where id in ${visiblePlaceIds(d, v)})`;
}

async function visiblePlaces(d: Kysely<Schema>, v: Viewer): Promise<PlaceCandidate[]> {
  const rows = await d.selectFrom("places").select(["id", "name", "parent_id", "address"]).where("id", "in", visiblePlaceIds(d, v)).orderBy("name").execute();
  if (!rows.length) return [];
  const ids = rows.map((r) => r.id);
  const [aliases, owners] = await Promise.all([
    d.selectFrom("place_aliases").select(["place_id", "alias"]).where("place_id", "in", ids).orderBy("alias").execute(),
    d
      .selectFrom("place_owners")
      .innerJoin("persons", "persons.id", "place_owners.person_id")
      .select(["place_owners.place_id", "persons.id", "persons.name"])
      .where("place_owners.place_id", "in", ids)
      .$call((qb) => visible(qb, v, "place_owners"))
      .orderBy("persons.name")
      .execute(),
  ]);
  const byId = new Map(rows.map((r) => [r.id, r]));
  const parents = (r: (typeof rows)[number]) => {
    const chain: PlaceCandidate["parents"] = [];
    for (let p = r.parent_id ? byId.get(r.parent_id) : undefined; p && !chain.some((c) => c.id === p!.id); p = p.parent_id ? byId.get(p.parent_id) : undefined)
      chain.push({ id: p.id, name: p.name, url: placePath(p.id) });
    return chain;
  };
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    aliases: aliases.filter((a) => a.place_id === r.id).map((a) => a.alias),
    parents: parents(r),
    address: r.address,
    owners: [...new Map(owners.filter((o) => o.place_id === r.id).map((o) => [o.id, { id: o.id, name: o.name, url: personPath(o.id) }])).values()],
    url: placePath(r.id),
  }));
}

/** One place the viewer may see, with where it sits, its address and owners, and the places directly inside it they may see. */
export async function describePlace(d: Kysely<Schema>, v: Viewer, id: string): Promise<PlaceCandidate & { inside: PlaceCandidate[] }> {
  const all = await visiblePlaces(d, v);
  const p = all.find((x) => x.id === id);
  if (!p) throw new NotFoundError("No such place");
  return { ...p, inside: all.filter((x) => x.parents[0]?.id === id) };
}

/** The places the viewer may see whose name or other name matches `q`, tolerant of spelling, best first. */
export async function findPlaces(v: Viewer, q: string, limit = 5): Promise<PlaceCandidate[]> {
  const nq = norm(q);
  if (!nq) return [];
  return (await visiblePlaces(await db(), v))
    .map((p) => ({ p, r: rank(nq, [p.name, ...p.aliases]) }))
    .filter((h): h is { p: PlaceCandidate; r: number } => h.r !== null)
    .sort((x, y) => x.r - y.r || x.p.name.localeCompare(y.p.name))
    .slice(0, limit)
    .map((h) => h.p);
}

/**
 * The place a part names, in `tx`: an id the viewer may see; a name that is exactly the name or another name of a place they may
 * see; else a new place, unless one comes close (AmbiguousError naming the candidates, so Claude asks) and it isn't confirmedNew.
 */
export async function resolvePlace(tx: Kysely<Schema>, v: Viewer, ref: PlaceRef): Promise<string> {
  const places = await visiblePlaces(tx, v);
  if (typeof ref === "object" && "id" in ref) {
    if (!places.some((p) => p.id === ref.id)) throw new NotFoundError("No such place");
    return ref.id;
  }
  const name = (typeof ref === "string" ? ref : ref.name).trim();
  if (!name || name.length > MAX_PLACE) throw new InvalidInputError(`A place needs a name of 1 to ${MAX_PLACE} characters`);
  const n = norm(name);
  const exact = places.find((p) => [p.name, ...p.aliases].some((x) => norm(x) === n));
  if (exact) return exact.id;
  const near = places.filter((p) => rank(n, [p.name, ...p.aliases]) !== null);
  if (near.length && !(typeof ref === "object" && ref.confirmedNew))
    throw new AmbiguousError(
      `The place "${name}" is close to ${near.map((p) => `"${p.name}" (${p.id})`).join(", ")}. Name an existing place by its id, or set confirmedNew: true on a place the user confirmed is new`,
    );
  const id = newId();
  await tx.insertInto("places").values({ id, name, created_by: v.userId, created_at: now() }).execute();
  return id;
}

async function loadPlace(d: Kysely<Schema>, v: Viewer, id: string): Promise<{ id: string; name: string }> {
  const p = await d.selectFrom("places").select(["id", "name"]).where("id", "=", id).where("id", "in", visiblePlaceIds(d, v)).executeTakeFirst();
  if (!p) throw new NotFoundError("No such place");
  return p;
}

async function insertAlias(d: Kysely<Schema>, placeId: string, alias: string): Promise<void> {
  await d
    .insertInto("place_aliases")
    .values({ place_id: placeId, alias, norm: norm(alias) })
    .onConflict((oc) => oc.doNothing())
    .execute();
}

/** Adds another name a place goes by ("die Hundeschule"). */
export async function addPlaceAlias(v: Viewer, id: string, alias: string): Promise<void> {
  const a = alias.trim();
  if (!a || a.length > MAX_PLACE) throw new InvalidInputError(`Another name needs 1 to ${MAX_PLACE} characters`);
  const d = await db();
  const p = await loadPlace(d, v, id);
  if (norm(a) !== norm(p.name)) await insertAlias(d, id, a);
}

/** Renames a place; its old name keeps finding it. */
export async function renamePlace(v: Viewer, id: string, name: string): Promise<void> {
  const n = name.trim();
  if (!n || n.length > MAX_PLACE) throw new InvalidInputError(`A place needs a name of 1 to ${MAX_PLACE} characters`);
  const d = await db();
  await d.transaction().execute(async (tx) => {
    const p = await loadPlace(tx, v, id);
    if (norm(p.name) !== norm(n)) await insertAlias(tx, id, p.name);
    await tx.deleteFrom("place_aliases").where("place_id", "=", id).where("norm", "=", norm(n)).execute();
    await tx.updateTable("places").set({ name: n }).where("id", "=", id).execute();
  });
}

/** Merges the duplicate `dropId` into `keepId`: everything at it moves, its names stay as other names, and it is deleted. */
export async function mergePlaces(v: Viewer, keepId: string, dropId: string): Promise<void> {
  if (keepId === dropId) throw new InvalidInputError("Can't merge a place into itself");
  const d = await db();
  await d.transaction().execute(async (tx) => {
    const keep = await loadPlace(tx, v, keepId);
    const drop = await loadPlace(tx, v, dropId);
    // Whoever sees the dropped place would see the kept one's name and other names after the merge: refused when they can't
    // see it yet, so a name from a private context never reaches them. The other way round shows them nothing new.
    for (const u of await tx.selectFrom("users").select(["id", "person_id"]).where("id", "!=", v.userId).execute()) {
      const other: Viewer = { userId: u.id, personId: u.person_id ?? "" };
      const sees = async (id: string) => !!(await tx.selectFrom("places").select("id").where("id", "=", id).where("id", "in", visiblePlaceIds(tx, other)).executeTakeFirst());
      if ((await sees(dropId)) && !(await sees(keepId)))
        throw new InvalidInputError(`Merge the other way round: keep "${drop.name}" (${dropId}) and drop "${keep.name}" (${keepId}), so the household doesn't learn a name only you can see`);
    }
    for (const t of ["conversations", "experiences", "series"] as const) await tx.updateTable(t as "conversations").set({ place_id: keepId }).where("place_id", "=", dropId).execute();
    const aliases = await tx.selectFrom("place_aliases").select("alias").where("place_id", "=", dropId).execute();
    for (const a of [drop.name, ...aliases.map((x) => x.alias)]) if (norm(a) !== norm(keep.name)) await insertAlias(tx, keepId, a);
    await tx.deleteFrom("places").where("id", "=", dropId).execute();
  });
}
