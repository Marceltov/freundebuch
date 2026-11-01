// Reading across the user's books, for the web app's lists: each read runs once per book, in that book alone (as the MCP `each`
// rule does), so privacy and "the viewer's own person" stay what they are within one book; the results are tagged with their
// book and merged. A co-member (someone in several of the user's books) has a person in each: they show once, from the
// oldest book. Groups merge by name, and every book's household group is one.
import { instance, scope } from "../db/scope";
import type { Viewer } from "../core/types";
import { bookRef, viewerIn, type BookRef } from "../people/books";
import { listGroups } from "../people/groups";
import { norm } from "../people/names";
import { peopleOverview, type PersonOverview } from "../people/people";
import { visible } from "../visibility";

export type InBook<T> = T & { book: BookRef };

/** `read` once per book of the viewer, oldest first, each result tagged with its book; the order within a book is kept. */
export async function acrossBooks<T>(v: Viewer, read: (w: Viewer) => Promise<T[]>): Promise<InBook<T>[]> {
  const i = await instance();
  const out: InBook<T>[] = [];
  for (const id of v.books) {
    const w = (await viewerIn(i, v.userId, id))!;
    const book = await bookRef(id);
    for (const x of await read(w)) out.push({ ...x, book });
  }
  return out;
}

/** The persons in the viewer's books that are members of them, to the user each one is. */
export async function memberUsers(v: Viewer): Promise<Map<string, string>> {
  const rows = await (await instance()).from("members").select(["person_id", "user_id"]).where("book_id", "in", v.books).execute();
  return new Map(rows.map((r) => [r.person_id, r.user_id]));
}

/** The first item of each key: with items oldest book first, the oldest book's wins. */
export function onceEach<T>(items: readonly T[], key: (t: T) => string): T[] {
  const seen = new Set<string>();
  return items.filter((x) => {
    const k = key(x);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

/** A group as the merged lists show it: every book's group of that name (`ids`), the households as one. */
export type GroupAcross = { key: string; name: string; ids: string[]; count: number; household: boolean };

const groupKey = (g: { name: string; household: boolean }) => (g.household ? "household" : norm(g.name));

/** The groups of every book, merged by name; `count` is the people in them the viewer may see, co-members once. */
export async function groupsAcross(v: Viewer): Promise<GroupAcross[]> {
  const [groups, users] = await Promise.all([acrossBooks(v, listGroups), memberUsers(v)]);
  const byKey = new Map<string, GroupAcross & { people: Set<string> }>();
  for (const g of groups) {
    const key = groupKey(g);
    const got = byKey.get(key) ?? { key, name: g.name, ids: [], count: 0, household: g.household, people: new Set<string>() };
    got.ids.push(g.id);
    byKey.set(key, got);
  }
  const i = await instance();
  for (const id of v.books) {
    const w = (await viewerIn(i, v.userId, id))!;
    const ids = groups.filter((g) => g.book.id === id).map((g) => g.id);
    if (!ids.length) continue;
    const rows = await (
      await scope(w)
    )
      .from("group_members")
      .select(["group_id", "person_id"])
      .where("group_id", "in", ids)
      .$call((qb) => visible(qb, w, "group_members"))
      .execute();
    for (const r of rows) byKey.get(groupKey(groups.find((g) => g.id === r.group_id)!))!.people.add(users.get(r.person_id) ?? r.person_id);
  }
  return [...byKey.values()].map(({ people, ...g }) => ({ ...g, count: people.size })).sort((a, b) => a.name.localeCompare(b.name, "de"));
}

/** The merged group a filter names, by its key or by the id of any of its books' groups; null when none does. */
export async function groupIdsFor(v: Viewer, wanted: string | undefined): Promise<GroupAcross | null> {
  if (!wanted) return null;
  return (await groupsAcross(v)).find((g) => g.key === wanted || g.ids.includes(wanted)) ?? null;
}

/** Everyone in the viewer's books but the viewer, co-members once, by name; `groups` are merged group keys. */
export async function peopleAcross(v: Viewer): Promise<InBook<PersonOverview>[]> {
  const [people, users, groups] = await Promise.all([acrossBooks(v, peopleOverview), memberUsers(v), groupsAcross(v)]);
  const keyOf = new Map(groups.flatMap((g) => g.ids.map((id) => [id, g.key] as const)));
  return onceEach(people, (p) => users.get(p.id) ?? p.id)
    .map((p) => ({ ...p, groups: [...new Set(p.groups.map((id) => keyOf.get(id)!).filter(Boolean))] }))
    .sort((a, b) => a.name.localeCompare(b.name, "de"));
}
