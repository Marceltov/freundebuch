// Groups as the viewer sees them: which exist for them (visibleGroups), how a typed name finds one (its name or another name,
// however it is spelled), and who is in one. Group names and other names are shared like person names; memberships carry their
// own visibility, so counts and member lists only include what the viewer may see.
import type { Kysely } from "kysely";
import { db, newId, now, type Schema } from "./db";
import { NotFoundError } from "./errors";
import { freshness } from "./intervals";
import { norm } from "./names";
import type { Viewer } from "./types";
import { groupPath, personPath } from "./urls";
import { visible, visibleGroups } from "./visibility";

export type GroupView = { id: string; name: string; aliases: string[]; count: number; url: string };
/** `private`: the viewer's own private membership is the only one they see. */
export type GroupMember = { personId: string; name: string; url: string; private: boolean; lastSeen: string | null; ratio: number | null };

async function views(d: Kysely<Schema>, v: Viewer, rows: { id: string; name: string }[]): Promise<GroupView[]> {
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
  }));
}

/** Every group the viewer sees, by name. */
export async function listGroups(v: Viewer): Promise<GroupView[]> {
  const d = await db();
  const rows = await d.selectFrom("groups").select(["id", "name"]).$call((qb) => visibleGroups(qb, v)).orderBy("name").execute();
  return views(d, v, rows.sort((a, b) => a.name.localeCompare(b.name, "de")));
}

/** One group with its members, never seen first, then the most overdue, then by name. */
export async function getGroup(v: Viewer, id: string): Promise<GroupView & { members: GroupMember[] }> {
  const d = await db();
  const row = await d.selectFrom("groups").select(["id", "name"]).where("id", "=", id).$call((qb) => visibleGroups(qb, v)).executeTakeFirst();
  if (!row) throw new NotFoundError("No such group");
  const [view] = await views(d, v, [row]);
  const rows = await d
    .selectFrom("group_members")
    .innerJoin("persons", "persons.id", "group_members.person_id")
    .select(["persons.id", "persons.name", "group_members.visibility"])
    .where("group_members.group_id", "=", id)
    .$call((qb) => visible(qb, v, "group_members"))
    .execute();
  const people = new Map<string, { name: string; private: boolean }>();
  for (const r of rows) people.set(r.id, { name: r.name, private: (people.get(r.id)?.private ?? true) && r.visibility === "private" });
  const members = await Promise.all(
    [...people].map(async ([personId, p]) => {
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

/** The visible group whose name or other name is `name` once normalised, or null. */
export async function findGroup(tx: Kysely<Schema>, v: Viewer, name: string): Promise<string | null> {
  const n = norm(name);
  if (!n) return null;
  const groups = await tx.selectFrom("groups").select(["id", "name"]).$call((qb) => visibleGroups(qb, v)).execute();
  const byName = groups.find((g) => norm(g.name) === n);
  if (byName) return byName.id;
  if (!groups.length) return null;
  const alias = await tx
    .selectFrom("group_aliases")
    .select("group_id")
    .where("norm", "=", n)
    .where(
      "group_id",
      "in",
      groups.map((g) => g.id),
    )
    .executeTakeFirst();
  return alias?.group_id ?? null;
}

/** The visible group `name` resolves to, or a new group of the viewer's own by that name. */
export async function resolveOrCreateGroup(tx: Kysely<Schema>, v: Viewer, name: string): Promise<string> {
  const found = await findGroup(tx, v, name);
  if (found) return found;
  const id = newId();
  await tx.insertInto("groups").values({ id, name: name.trim(), created_by: v.userId, created_at: now() }).execute();
  return id;
}
