// Places: where something happened, a record of its own with other names, as people have. A place exists for a viewer only
// through a part they may see; so a place the other user holds only
// through private parts is neither found nor reused, and a new one is made. Parts are conversations, experiences and series. Names match as people's do (names.ts).
import { scope, type Scope } from "../db/scope";
import { sql, newId, now } from "../db";
import { AmbiguousError, InvalidInputError, NotFoundError } from "../core/errors";
import { norm, rank } from "../people/names";
import type { Viewer } from "../core/types";
import { personPath, placePath } from "../core/urls";
import { otherMembers, resolveTarget } from "../people/household";
import type { Visibility } from "../core/types";
import { visible } from "../visibility";

/**
 * How a part names its place: by name (an exact name or other name is reused), by id, or as a new one the user confirmed. It may
 * say where it sits (`in`, resolved the same way), its address, and whose home it is (`owners`: persons as the caller refers to
 * them, or "me"/"us"; private with `ownersPrivate` or when the part is).
 */
export type PlaceRef<P = string> =
  | string
  | (({ id: string } | { name: string; confirmedNew?: boolean }) & {
      in?: PlaceRef<P>;
      address?: string;
      owners?: Array<P | "me" | "us">;
      ownersPrivate?: boolean;
    });
type Link = { id: string; name: string; url: string };
/** A place as found: `parents` nearest first, `owners` whose home it is, as far as the viewer may see. */
export type PlaceCandidate = { id: string; name: string; aliases: string[]; parents: Link[]; address: string | null; owners: Link[]; url: string };

export const MAX_PLACE = 120;
export const MAX_ADDRESS = 200;

/** The places with something at them the viewer may see, or a home of someone they may see is theirs. */
function seenDirectly(d: Scope, v: Viewer) {
  return d
    .from("places")
    .select("places.id")
    .where((eb) =>
      eb.or([
        ...(["conversations", "experiences", "series"] as const).map((t) =>
          eb(
            "places.id",
            "in",
            d
              .from(t as "conversations")
              .select("place_id")
              .where("place_id", "is not", null)
              .$call((qb) => visible(qb, v, t)) as never,
          ),
        ),
        eb(
          "places.id",
          "in",
          d
            .from("place_owners")
            .select("place_id")
            .$call((qb) => visible(qb, v, "place_owners")),
        ),
      ]),
    );
}

/**
 * The ids of the places the viewer may see: those seen directly (seenDirectly), and every place one of them sits inside. Only
 * upward: whoever sees the Olympiahalle may know it is in München, but a place inside one they see stays hidden unless it is seen
 * itself. A place with nothing left at it is found no more.
 */
export function visiblePlaceIds(d: Scope, v: Viewer) {
  return sql<string>`(with recursive seen(id) as (select id from places where id in ${seenDirectly(d, v)} union select p.parent_id from places p join seen on p.id = seen.id where p.parent_id is not null) select id from seen)`;
}

/** The place `id` and the places inside it, at any depth, that the viewer may see. */
export function placeAndInsideIds(d: Scope, v: Viewer, id: string) {
  return sql<string>`(with recursive down(id) as (select ${id} union select p.id from places p join down on p.parent_id = down.id) select id from down where id in ${visiblePlaceIds(d, v)})`;
}

/** The places the viewer may see, or (`only`) those of them with these ids; the places they sit in are read along for `parents`. */
async function visiblePlaces(d: Scope, v: Viewer, only?: string[]): Promise<PlaceCandidate[]> {
  if (only && !only.length) return [];
  let query = d.from("places").select(["id", "name", "parent_id", "address"]).where("id", "in", visiblePlaceIds(d, v));
  if (only)
    query = query.where(
      "id",
      "in",
      sql<string>`(with recursive up(id) as (select value from json_each(${JSON.stringify(only)}) union select p.parent_id from places p join up on p.id = up.id where p.parent_id is not null) select id from up)`,
    );
  const rows = await query.orderBy("name").execute();
  if (!rows.length) return [];
  const ids = rows.map((r) => r.id);
  const [aliases, owners] = await Promise.all([
    d.from("place_aliases").select(["place_id", "alias"]).where("place_id", "in", ids).orderBy("alias").execute(),
    d
      .from("place_owners")
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
  return rows
    .filter((r) => !only || only.includes(r.id))
    .map((r) => ({
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
export async function describePlace(d: Scope, v: Viewer, id: string): Promise<PlaceCandidate & { inside: PlaceCandidate[] }> {
  const children = await d.from("places").select("id").where("parent_id", "=", id).execute();
  const all = await visiblePlaces(d, v, [id, ...children.map((c) => c.id)]);
  const p = all.find((x) => x.id === id);
  if (!p) throw new NotFoundError("No such place");
  return { ...p, inside: all.filter((x) => x.parents[0]?.id === id) };
}

/** Every place the viewer may see, by name. */
export async function listPlaces(v: Viewer): Promise<PlaceCandidate[]> {
  return visiblePlaces(await scope(v), v);
}

/** The places the viewer may see whose name or other name matches `q`, tolerant of spelling, best first. */
export async function findPlaces(v: Viewer, q: string, limit = 5): Promise<PlaceCandidate[]> {
  const nq = norm(q);
  if (!nq) return [];
  return (await visiblePlaces(await scope(v), v))
    .map((p) => ({ p, r: rank(nq, [p.name, ...p.aliases]) }))
    .filter((h): h is { p: PlaceCandidate; r: number } => h.r !== null)
    .sort((x, y) => x.r - y.r || x.p.name.localeCompare(y.p.name))
    .slice(0, limit)
    .map((h) => h.p);
}

/**
 * The place a part names, in `tx`: an id the viewer may see; a name that is exactly the name or another name of a place they may
 * see; else a new place, unless one comes close (AmbiguousError naming the candidates, so Claude asks) and it isn't confirmedNew.
 * Where it sits (`in`) is set only when it sits nowhere yet; an address given replaces the one it had. `levels` gets the id of the
 * place and of each place it names it sits in, in that order. Owners are filed apart (fileOwnersOf), once the caller knows who
 * they are.
 */
export async function resolvePlace(tx: Scope, v: Viewer, ref: PlaceRef<unknown>, visibility: Visibility = "shared", levels: string[] = []): Promise<string> {
  const id = await findOrMakePlace(tx, v, ref);
  levels.push(id);
  if (typeof ref === "string") return id;
  // A private part writes nothing onto a place the other user sees: its address and where it sits would reach them.
  const refuse = async (what: string) => {
    if (visibility === "private" && (await othersSee(tx, v, id)))
      throw new InvalidInputError(
        `The household sees this place, so a private part can't set ${what}: leave it out, or file it shared, or with correct once the user agrees it may be seen`,
      );
  };
  const row = await tx.from("places").select(["parent_id", "address"]).where("id", "=", id).executeTakeFirstOrThrow();
  if (ref.address !== undefined) {
    const address = checkAddress(ref.address);
    if (address !== row.address) {
      await refuse("its address");
      await tx.update("places").set({ address }).where("id", "=", id).execute();
    }
  }
  if (ref.in !== undefined) {
    const parent = await resolvePlace(tx, v, ref.in, visibility, levels);
    if (!row.parent_id && !(await wouldLoop(tx, id, parent))) {
      await refuse("where it sits");
      await tx.update("places").set({ parent_id: parent }).where("id", "=", id).execute();
    }
  }
  return id;
}

async function findOrMakePlace(tx: Scope, v: Viewer, ref: PlaceRef<unknown>): Promise<string> {
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
  await tx.insert("places", { id, name, created_by: v.userId, created_at: now() }).execute();
  return id;
}

/** The book's other members, as viewers. */
const others = (tx: Scope): Promise<Viewer[]> => otherMembers(tx);

/** Whether `viewer` may see the place `id`. */
async function sees(tx: Scope, viewer: Viewer, id: string): Promise<boolean> {
  return !!(await tx.from("places").select("id").where("id", "=", id).where("id", "in", visiblePlaceIds(tx, viewer)).executeTakeFirst());
}

/** Whether another user sees the place `id` but not the place `other` (or, without `other`, sees `id` at all). */
async function othersSee(tx: Scope, v: Viewer, id: string, other?: string): Promise<boolean> {
  for (const o of await others(tx)) if ((await sees(tx, o, id)) && !(other && (await sees(tx, o, other)))) return true;
  return false;
}

/** The owners a place reference names, as the caller refers to them. */
export const ownersOf = <P>(ref: PlaceRef<P> | undefined): Array<P | "me" | "us"> =>
  placeLevels(ref).flatMap((l) => (typeof l === "object" ? (l.owners ?? []) : []));

/** A place reference and each place it names it sits in, in that order. */
const placeLevels = <P>(ref: PlaceRef<P> | undefined): Array<PlaceRef<P>> =>
  ref === undefined ? [] : [ref, ...(typeof ref === "object" ? placeLevels(ref.in) : [])];

/**
 * Files the owners a place reference names on each level (the place, and each place it sits in) onto the ids resolvePlace gave
 * those levels; `person` turns how the caller refers to someone into a person id, "me" or "us". Private when the part is or the
 * level says so (ownersPrivate); told in `rambleId`, if any.
 */
export async function fileOwnersOf<P>(
  tx: Scope,
  v: Viewer,
  ref: PlaceRef<P> | undefined,
  ids: string[],
  person: (p: P | "me" | "us") => string,
  visibility: Visibility,
  rambleId: string | null,
): Promise<void> {
  for (const [i, level] of placeLevels(ref).entries())
    if (typeof level === "object" && level.owners?.length && ids[i])
      await fileOwners(tx, v, ids[i], level.owners.map(person), visibility === "private" || level.ownersPrivate ? "private" : "shared", rambleId);
}

function checkAddress(address: string | null): string | null {
  if (address === null) return null;
  const a = typeof address === "string" ? address.trim() : "";
  if (!a || a.length > MAX_ADDRESS) throw new InvalidInputError(`An address needs 1 to ${MAX_ADDRESS} characters, or null to clear it`);
  return a;
}

/** Whether `parent` is `id` or sits inside it, at any depth. */
async function wouldLoop(tx: Scope, id: string, parent: string): Promise<boolean> {
  const seen = new Set<string>();
  for (let p: string | null = parent; p && !seen.has(p);) {
    if (p === id) return true;
    seen.add(p);
    p = (await tx.from("places").select("parent_id").where("id", "=", p).executeTakeFirst())?.parent_id ?? null;
  }
  return false;
}

/** Files `owners` (person ids, "me" or "us") as whose home the place is, each the viewer's own ownership with `visibility`; told in
 * `rambleId`, if any (the first ramble that told it keeps it). */
export async function fileOwners(
  tx: Scope,
  v: Viewer,
  placeId: string,
  owners: string[],
  visibility: Visibility,
  rambleId: string | null = null,
): Promise<void> {
  const ids = [...new Set((await Promise.all(owners.map((o) => resolveTarget(tx, v, o)))).flat())];
  if (!ids.length) return;
  const found = await tx.from("persons").select("id").where("id", "in", ids).execute();
  if (found.length !== ids.length) throw new NotFoundError("No such person");
  for (const personId of ids)
    await tx
      .insert("place_owners", { place_id: placeId, person_id: personId, visibility, recorded_by: v.userId, ramble_id: rambleId, created_at: now() })
      .onConflict((oc) => oc.columns(["place_id", "person_id", "recorded_by"]).doUpdateSet({ visibility }))
      .execute();
}

/** Sets (null: clears) the place a place sits inside; refused when that would make it sit inside itself. */
export async function setPlaceParent(v: Viewer, id: string, parentId: string | null): Promise<void> {
  const d = await scope(v);
  await d.transaction(async (tx) => {
    await loadPlace(tx, v, id);
    if (parentId !== null) {
      await loadPlace(tx, v, parentId);
      if (await wouldLoop(tx, id, parentId)) throw new InvalidInputError("A place can't sit inside itself or a place inside it");
      // Whoever sees the place would see the one it sits in: refused when they can't see that yet, so its name and address stay.
      if (await othersSee(tx, v, id, parentId))
        throw new InvalidInputError(
          "The household sees this place but not the one it would sit in, which would show them that place: ask the user before making it seen, e.g. by filing something shared there",
        );
    }
    await tx.update("places").set({ parent_id: parentId }).where("id", "=", id).execute();
  });
}

/** Sets (null: clears) a place's address in words. */
export async function setPlaceAddress(v: Viewer, id: string, address: string | null): Promise<void> {
  const d = await scope(v);
  await loadPlace(d, v, id);
  await d
    .update("places")
    .set({ address: checkAddress(address) })
    .where("id", "=", id)
    .execute();
}

/** Adds whose home a place is: a person id, "me" or "us". */
export async function addPlaceOwner(v: Viewer, id: string, person: string, visibility: Visibility): Promise<void> {
  if (visibility !== "shared" && visibility !== "private") throw new InvalidInputError("visibility is shared or private");
  const d = await scope(v);
  await d.transaction(async (tx) => {
    await loadPlace(tx, v, id);
    await fileOwners(tx, v, id, [person], visibility);
  });
}

/** Drops a person as owner of a place: the viewer's own ownership and a shared one of the partner's. */
export async function removePlaceOwner(v: Viewer, id: string, personId: string): Promise<void> {
  const d = await scope(v);
  await loadPlace(d, v, id);
  await d
    .delete("place_owners")
    .where("place_id", "=", id)
    .where("person_id", "=", personId)
    .$call((qb) => visible(qb, v, "place_owners"))
    .execute();
}

async function loadPlace(d: Scope, v: Viewer, id: string): Promise<{ id: string; name: string }> {
  const p = await d.from("places").select(["id", "name"]).where("id", "=", id).where("id", "in", visiblePlaceIds(d, v)).executeTakeFirst();
  if (!p) throw new NotFoundError("No such place");
  return p;
}

async function insertAlias(d: Scope, placeId: string, alias: string): Promise<void> {
  await d
    .insert("place_aliases", { place_id: placeId, alias, norm: norm(alias) })
    .onConflict((oc) => oc.doNothing())
    .execute();
}

/** Adds another name a place goes by ("die Hundeschule"). */
export async function addPlaceAlias(v: Viewer, id: string, alias: string): Promise<void> {
  const a = alias.trim();
  if (!a || a.length > MAX_PLACE) throw new InvalidInputError(`Another name needs 1 to ${MAX_PLACE} characters`);
  const d = await scope(v);
  const p = await loadPlace(d, v, id);
  if (norm(a) !== norm(p.name)) await insertAlias(d, id, a);
}

/** Renames a place; its old name keeps finding it. */
export async function renamePlace(v: Viewer, id: string, name: string): Promise<void> {
  const n = name.trim();
  if (!n || n.length > MAX_PLACE) throw new InvalidInputError(`A place needs a name of 1 to ${MAX_PLACE} characters`);
  const d = await scope(v);
  await d.transaction(async (tx) => {
    const p = await loadPlace(tx, v, id);
    if (norm(p.name) !== norm(n)) await insertAlias(tx, id, p.name);
    await tx.delete("place_aliases").where("place_id", "=", id).where("norm", "=", norm(n)).execute();
    await tx.update("places").set({ name: n }).where("id", "=", id).execute();
  });
}

/** Merges the duplicate `dropId` into `keepId`: everything at it moves, its names stay as other names, and it is deleted. */
export async function mergePlaces(v: Viewer, keepId: string, dropId: string): Promise<void> {
  if (keepId === dropId) throw new InvalidInputError("Can't merge a place into itself");
  const d = await scope(v);
  await d.transaction(async (tx) => {
    const keep = await loadPlace(tx, v, keepId);
    const drop = await loadPlace(tx, v, dropId);
    // Whoever sees the dropped place would see the kept one's name and other names after the merge: refused when they can't
    // see it yet, so a name from a private context never reaches them. The other way round shows them nothing new.
    if (await othersSee(tx, v, dropId, keepId))
      throw new InvalidInputError(
        `Merge the other way round: keep "${drop.name}" (${dropId}) and drop "${keep.name}" (${keepId}), so the household doesn't learn a name only you can see`,
      );
    // The other way round, the dropped place's names, address and where it sits would show on one they see: those stay behind.
    const hidden = await othersSee(tx, v, keepId, dropId);
    for (const t of ["conversations", "experiences", "series"] as const)
      await tx
        .update(t as "conversations")
        .set({ place_id: keepId })
        .where("place_id", "=", dropId)
        .execute();
    // The kept place keeps where it sits and its address, and takes the dropped one's where it has none; what sat inside the
    // dropped place sits inside the kept one, and its owners move, each recorder's once.
    const [k, dr] = await Promise.all(
      [keepId, dropId].map((id) => tx.from("places").select(["parent_id", "address"]).where("id", "=", id).executeTakeFirstOrThrow()),
    );
    const adopt = !hidden && dr.parent_id && !(await wouldLoop(tx, keepId, dr.parent_id)) ? dr.parent_id : null;
    const parent = k.parent_id && k.parent_id !== dropId ? k.parent_id : adopt;
    await tx
      .update("places")
      .set({ parent_id: parent, address: k.address ?? (hidden ? null : dr.address) })
      .where("id", "=", keepId)
      .execute();
    await tx.update("places").set({ parent_id: keepId }).where("parent_id", "=", dropId).where("id", "!=", keepId).execute();
    for (const o of await tx.from("place_owners").selectAll().where("place_id", "=", dropId).execute())
      await tx
        .insert("place_owners", { ...o, place_id: keepId })
        .onConflict((oc) => oc.doNothing())
        .execute();
    const aliases = await tx.from("place_aliases").select("alias").where("place_id", "=", dropId).execute();
    if (!hidden) for (const a of [drop.name, ...aliases.map((x) => x.alias)]) if (norm(a) !== norm(keep.name)) await insertAlias(tx, keepId, a);
    await tx.delete("places").where("id", "=", dropId).execute();
  });
}

/** The places the viewer may see of the conversations and experiences a person was part of: how often and when last, newest first. */
export async function placesOf(v: Viewer, personId: string): Promise<Array<PlaceCandidate & { times: number; last: string }>> {
  const d = await scope(v);
  const [conversations, experiences] = await Promise.all([
    d
      .from("conversations")
      .innerJoin("participants", "participants.conversation_id", "conversations.id")
      .select(["conversations.place_id", "conversations.date"])
      .where("participants.person_id", "=", personId)
      .where("conversations.place_id", "is not", null)
      .$call((qb) => visible(qb, v, "conversations"))
      .execute(),
    d
      .from("experiences")
      .innerJoin("experience_people", "experience_people.experience_id", "experiences.id")
      .select(["experiences.place_id", "experiences.date"])
      .where("experience_people.person_id", "=", personId)
      .where("experiences.place_id", "is not", null)
      .$call((qb) => visible(qb, v, "experiences"))
      .execute(),
  ]);
  const seen = new Map<string, { times: number; last: string }>();
  for (const r of [...conversations, ...experiences]) {
    const s = seen.get(r.place_id!) ?? { times: 0, last: "" };
    seen.set(r.place_id!, { times: s.times + 1, last: r.date > s.last ? r.date : s.last });
  }
  return (await visiblePlaces(d, v, [...seen.keys()]))
    .map((p) => ({ ...p, ...seen.get(p.id)! }))
    .sort((a, b) => b.last.localeCompare(a.last) || b.times - a.times || a.name.localeCompare(b.name));
}

/** The places directly inside a place, as far as the viewer may see. */
export async function placesInside(v: Viewer, id: string): Promise<PlaceCandidate[]> {
  return (await describePlace(await scope(v), v, id)).inside;
}

/** The homes of a person the viewer may see: the places with an ownership of theirs the viewer may see. */
export async function homesOf(v: Viewer, personId: string): Promise<PlaceCandidate[]> {
  const d = await scope(v);
  const owned = await d
    .from("place_owners")
    .select("place_id")
    .where("person_id", "=", personId)
    .$call((qb) => visible(qb, v, "place_owners"))
    .execute();
  return visiblePlaces(d, v, [...new Set(owned.map((o) => o.place_id))]);
}
