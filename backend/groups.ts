// Groups as the viewer sees them: which exist for them (visibleGroups), how a typed name finds one (its name or another name,
// however it is spelled), and who is in one. Group names and other names are shared like person names; memberships carry their
// own visibility, so counts and member lists only include what the viewer may see.
import { sql, type Kysely } from "kysely";
import { db, newId, now, type Schema } from "./db";
import { InvalidInputError, NotFoundError } from "./errors";
import { householdPersons } from "./household";
import { freshness } from "./intervals";
import { norm } from "./names";
import type { Viewer, Visibility } from "./types";
import { groupPath, personPath } from "./urls";
import { visible, visibleGroups } from "./visibility";

/** `household`: Haushalt, the group of everyone who signs in; it can be renamed but not deleted or merged away. */
export type GroupView = { id: string; name: string; aliases: string[]; count: number; url: string; household: boolean };
/** `private`: the viewer's own private membership is the only one they see. */
export type GroupMember = { personId: string; name: string; url: string; private: boolean; lastSeen: string | null; ratio: number | null };

async function views(d: Kysely<Schema>, v: Viewer, rows: { id: string; name: string; household: number }[]): Promise<GroupView[]> {
  if (!rows.length) return [];
  const ids = rows.map((r) => r.id);
  const [aliases, counts] = await Promise.all([
    d.selectFrom("group_aliases").select(["group_id", "alias"]).where("group_id", "in", ids).orderBy("alias").execute(),
    d
      .selectFrom("group_members")
      .select(["group_id", (eb) => eb.fn.count<number>("person_id").distinct().as("n")])
      .where("group_id", "in", ids)
      .$call((qb) => visible(qb, v, "group_members"))
      .groupBy("group_id")
      .execute(),
  ]);
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    aliases: aliases.filter((a) => a.group_id === r.id).map((a) => a.alias),
    count: Number(counts.find((c) => c.group_id === r.id)?.n ?? 0),
    url: groupPath(r.id),
    household: r.household === 1,
  }));
}

/** Every group the viewer sees, by name. */
export async function listGroups(v: Viewer): Promise<GroupView[]> {
  const d = await db(v);
  const rows = await d
    .selectFrom("groups")
    .select(["id", "name", "household"])
    .$call((qb) => visibleGroups(qb, v))
    .orderBy("name")
    .execute();
  return views(
    d,
    v,
    rows.sort((a, b) => a.name.localeCompare(b.name, "de")),
  );
}

/** One group with its members, never seen first, then the most overdue, then by name. */
export async function getGroup(v: Viewer, id: string): Promise<GroupView & { members: GroupMember[] }> {
  const d = await db(v);
  const row = await d
    .selectFrom("groups")
    .select(["id", "name", "household"])
    .where("id", "=", id)
    .$call((qb) => visibleGroups(qb, v))
    .executeTakeFirst();
  if (!row) throw new NotFoundError("No such group");
  const [view] = await views(d, v, [row]);
  const members = await Promise.all(
    (await visibleMembers(d, v, id)).map(async ({ id: personId, ...p }) => {
      const f = await freshness(v, personId);
      return { personId, name: p.name, url: personPath(personId), private: p.private, lastSeen: f.lastSeen, ratio: f.ratio };
    }),
  );
  members.sort(
    (a, b) =>
      Number(b.lastSeen === null) - Number(a.lastSeen === null) || (b.ratio ?? -Infinity) - (a.ratio ?? -Infinity) || a.name.localeCompare(b.name, "de"),
  );
  return { ...view, members };
}

/** The people in a group the viewer may see, by name; `private` when the viewer's own private membership is the only one they see. */
async function visibleMembers(d: Kysely<Schema>, v: Viewer, groupId: string): Promise<Array<{ id: string; name: string; private: boolean }>> {
  const rows = await d
    .selectFrom("group_members")
    .innerJoin("persons", "persons.id", "group_members.person_id")
    .select(["persons.id", "persons.name", "group_members.visibility"])
    .where("group_members.group_id", "=", groupId)
    .$call((qb) => visible(qb, v, "group_members"))
    .execute();
  const people = new Map<string, { name: string; private: boolean }>();
  for (const r of rows) people.set(r.id, { name: r.name, private: (people.get(r.id)?.private ?? true) && r.visibility === "private" });
  return [...people].map(([id, p]) => ({ id, ...p })).sort((a, b) => a.name.localeCompare(b.name, "de"));
}

/** The people of a group the viewer sees, by name; NotFoundError when the viewer can't see the group. */
export async function groupMembers(v: Viewer, groupId: string): Promise<Array<{ id: string; name: string }>> {
  const d = await db(v);
  const row = await d
    .selectFrom("groups")
    .select("id")
    .where("id", "=", groupId)
    .$call((qb) => visibleGroups(qb, v))
    .executeTakeFirst();
  if (!row) throw new NotFoundError("No such group");
  return (await visibleMembers(d, v, groupId)).map(({ id, name }) => ({ id, name }));
}

/**
 * The visible group whose name or other name is `name` once normalised, or null. Two visible groups may share a name (one was
 * hidden from the partner when theirs was made): the viewer's own wins, then the oldest.
 */
export async function findGroup(tx: Kysely<Schema>, v: Viewer, name: string): Promise<string | null> {
  const n = norm(name);
  if (!n) return null;
  const groups = await tx
    .selectFrom("groups")
    .select(["id", "name"])
    .$call((qb) => visibleGroups(qb, v))
    .orderBy(sql`groups.created_by = ${v.userId}`, "desc")
    .orderBy("created_at")
    .orderBy("id")
    .execute();
  const byName = groups.find((g) => norm(g.name) === n);
  if (byName) return byName.id;
  if (!groups.length) return null;
  const withAlias = new Set(
    (
      await tx
        .selectFrom("group_aliases")
        .select("group_id")
        .where("norm", "=", n)
        .where(
          "group_id",
          "in",
          groups.map((g) => g.id),
        )
        .execute()
    ).map((a) => a.group_id),
  );
  return groups.find((g) => withAlias.has(g.id))?.id ?? null;
}

/** The visible group `name` resolves to, or a new group of the viewer's own by that name. */
export async function resolveOrCreateGroup(tx: Kysely<Schema>, v: Viewer, name: string): Promise<string> {
  const found = await findGroup(tx, v, name);
  if (found) return found;
  const id = newId();
  await tx.insertInto("groups").values({ id, name: name.trim(), created_by: v.userId, created_at: now() }).execute();
  return id;
}

type Slot = { group_id: string; person_id: string };

/**
 * Moves one user's membership row from one group and person to another. Memberships are keyed by (group, person, recorder): a row
 * already at the target wins over the moved one, except that shared beats private.
 */
export async function moveMembership(tx: Kysely<Schema>, recordedBy: string, from: Slot, to: Slot): Promise<void> {
  const at = (x: Slot) =>
    tx
      .selectFrom("group_members")
      .select("visibility")
      .where("group_id", "=", x.group_id)
      .where("person_id", "=", x.person_id)
      .where("recorded_by", "=", recordedBy);
  const moved = await at(from).executeTakeFirst();
  if (!moved) return;
  const there = await at(to).executeTakeFirst();
  const fromRow = tx
    .deleteFrom("group_members")
    .where("group_id", "=", from.group_id)
    .where("person_id", "=", from.person_id)
    .where("recorded_by", "=", recordedBy);
  if (!there) {
    await tx
      .updateTable("group_members")
      .set(to)
      .where("group_id", "=", from.group_id)
      .where("person_id", "=", from.person_id)
      .where("recorded_by", "=", recordedBy)
      .execute();
    return;
  }
  if (there.visibility === "private" && moved.visibility === "shared")
    await tx
      .updateTable("group_members")
      .set({ visibility: "shared" })
      .where("group_id", "=", to.group_id)
      .where("person_id", "=", to.person_id)
      .where("recorded_by", "=", recordedBy)
      .execute();
  await fromRow.execute();
}

/** A visible group, or NotFoundError. */
async function seen(tx: Kysely<Schema>, v: Viewer, id: string): Promise<{ id: string; name: string; created_by: string | null; household: number }> {
  const g = await tx
    .selectFrom("groups")
    .select(["id", "name", "created_by", "household"])
    .where("id", "=", id)
    .$call((qb) => visibleGroups(qb, v))
    .executeTakeFirst();
  if (!g) throw new NotFoundError("No such group");
  return g;
}

/** Refuses `name` when it already means another visible group: two groups must be merged, not given the same name. */
async function assertFree(tx: Kysely<Schema>, v: Viewer, id: string, name: string): Promise<void> {
  if (!norm(name)) throw new InvalidInputError("A group's name can't be empty");
  const other = await findGroup(tx, v, name);
  if (other && other !== id) {
    const o = await tx.selectFrom("groups").select("name").where("id", "=", other).executeTakeFirstOrThrow();
    throw new InvalidInputError(`"${name.trim()}" is already the group ${o.name}; merge the two groups instead`);
  }
}

async function addAlias(tx: Kysely<Schema>, id: string, alias: string): Promise<void> {
  const g = await tx.selectFrom("groups").select("name").where("id", "=", id).executeTakeFirstOrThrow();
  if (norm(g.name) === norm(alias)) return;
  await tx
    .insertInto("group_aliases")
    .values({ group_id: id, alias: alias.trim(), norm: norm(alias) })
    .onConflict((oc) => oc.doNothing())
    .execute();
}

const tx = async <T>(v: Viewer, f: (tx: Kysely<Schema>) => Promise<T>): Promise<T> => (await db(v)).transaction().execute(f);

/** The group `name` already means for the viewer, or a new one of theirs. */
export async function createGroup(v: Viewer, name: string): Promise<GroupView> {
  if (!norm(name)) throw new InvalidInputError("A group's name can't be empty");
  const id = await tx(v, (t) => resolveOrCreateGroup(t, v, name));
  return (await listGroups(v)).find((g) => g.id === id)!;
}

/** Renames a group; the old name becomes another name, so it still finds the group. */
export async function renameGroup(v: Viewer, id: string, name: string): Promise<void> {
  await tx(v, async (t) => {
    const g = await seen(t, v, id);
    await assertFree(t, v, id, name);
    await t.updateTable("groups").set({ name: name.trim() }).where("id", "=", id).execute();
    await t.deleteFrom("group_aliases").where("group_id", "=", id).where("norm", "=", norm(name)).execute();
    await addAlias(t, id, g.name);
  });
}

export async function addGroupAlias(v: Viewer, id: string, alias: string): Promise<void> {
  await tx(v, async (t) => {
    await seen(t, v, id);
    await assertFree(t, v, id, alias);
    await addAlias(t, id, alias);
  });
}

export async function removeGroupAlias(v: Viewer, id: string, alias: string): Promise<void> {
  await tx(v, async (t) => {
    await seen(t, v, id);
    await t.deleteFrom("group_aliases").where("group_id", "=", id).where("norm", "=", norm(alias)).execute();
  });
}

/** The other users of the household who don't see the group. */
async function blindTo(t: Kysely<Schema>, v: Viewer, id: string): Promise<string[]> {
  const others = await t.selectFrom("users").select("id").where("id", "!=", v.userId).execute();
  const blind: string[] = [];
  for (const u of others) {
    const sees = await t
      .selectFrom("groups")
      .select("id")
      .where("id", "=", id)
      .$call((qb) => visibleGroups(qb, { userId: u.id, personId: "", householdId: v.householdId }))
      .executeTakeFirst();
    if (!sees) blind.push(u.id);
  }
  return blind;
}

/**
 * Merges `dropId` into `keepId`: every membership moves (the partner's private ones too, unseen), and drop's names become other
 * names of keep. Neither may show the partner a name hidden from them: drop's names stay behind when the partner doesn't see
 * drop, and a group the partner uses can't be merged into one they don't see.
 */
export async function mergeGroups(v: Viewer, keepId: string, dropId: string): Promise<void> {
  if (keepId === dropId) throw new InvalidInputError("A group can't be merged into itself");
  await tx(v, async (t) => {
    await seen(t, v, keepId);
    const drop = await seen(t, v, dropId);
    if (drop.household) throw new InvalidInputError(`${drop.name} is the household's own group: merge the other group into it instead`);
    const [blindToKeep, blindToDrop] = await Promise.all([blindTo(t, v, keepId), blindTo(t, v, dropId)]);
    if (blindToKeep.some((u) => !blindToDrop.includes(u)))
      throw new InvalidInputError("The other user uses this group but can't see the one to keep; merge them the other way round");
    for (const m of await t.selectFrom("group_members").select(["person_id", "recorded_by"]).where("group_id", "=", dropId).execute())
      await moveMembership(t, m.recorded_by, { group_id: dropId, person_id: m.person_id }, { group_id: keepId, person_id: m.person_id });
    const aliases = await t.selectFrom("group_aliases").select("alias").where("group_id", "=", dropId).execute();
    await t.deleteFrom("groups").where("id", "=", dropId).execute();
    if (blindToDrop.length) return;
    for (const a of [drop.name, ...aliases.map((x) => x.alias)]) await addAlias(t, keepId, a);
  });
}

/**
 * Deletes a group for the viewer: their own memberships go. While the partner still has memberships, the group stays for them,
 * no longer seeded or the viewer's own; once none are left, it goes with its other names.
 */
export async function deleteGroup(v: Viewer, id: string): Promise<void> {
  await tx(v, async (t) => {
    const g = await seen(t, v, id);
    if (g.household) throw new InvalidInputError(`${g.name} is the household's own group and can't be deleted; it can be renamed`);
    await t.deleteFrom("group_members").where("group_id", "=", id).where("recorded_by", "=", v.userId).execute();
    const left = await t.selectFrom("group_members").select("person_id").where("group_id", "=", id).executeTakeFirst();
    if (!left) await t.deleteFrom("groups").where("id", "=", id).execute();
    else await t.updateTable("groups").set({ seeded: 0, created_by: null }).where("id", "=", id).execute();
  });
}

/** Puts a person in a group as the viewer; true when the membership is new. */
export async function addToGroupById(v: Viewer, id: string, personId: string, visibility: Visibility): Promise<boolean> {
  return tx(v, async (t) => {
    await seen(t, v, id);
    if (!(await t.selectFrom("persons").select("id").where("id", "=", personId).executeTakeFirst())) throw new NotFoundError("No such person");
    const r = await t
      .insertInto("group_members")
      .values({ group_id: id, person_id: personId, visibility, recorded_by: v.userId, conversation_id: null })
      .onConflict((oc) => oc.doNothing())
      .executeTakeFirst();
    return Number(r.numInsertedOrUpdatedRows ?? 0) > 0;
  });
}

/**
 * Takes a person out of a group: the viewer's membership and the partner's shared one. The partner's private one stays. A group
 * left with no members that nobody made or started with (one the partner deleted) can't be seen by anyone any more and goes.
 */
export async function removeFromGroup(v: Viewer, id: string, personId: string): Promise<void> {
  await tx(v, async (t) => {
    const g = await seen(t, v, id);
    if (g.household && (await householdPersons(t)).includes(personId))
      throw new InvalidInputError(`Everyone who signs in stays in ${g.name}, the household's own group`);
    await t
      .deleteFrom("group_members")
      .where("group_id", "=", id)
      .where("person_id", "=", personId)
      .where((eb) => eb.or([eb("recorded_by", "=", v.userId), eb("visibility", "=", "shared")]))
      .execute();
    const left = await t.selectFrom("group_members").select("person_id").where("group_id", "=", id).executeTakeFirst();
    if (!left) await t.deleteFrom("groups").where("id", "=", id).where("seeded", "=", 0).where("created_by", "is", null).execute();
  });
}
