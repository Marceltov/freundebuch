// Reading across the user's books, for the web app's lists: each read runs once per book, in that book alone (as the MCP `each`
// rule does), so privacy and "the viewer's own person" stay what they are within one book; the results are tagged with their
// book and merged. A co-member (someone in several of the user's books) has a person in each: they show once, from the
// oldest book. Groups merge by name, and every book's household group is one.
import { instance, scope } from "../db/scope";
import type { Viewer } from "../core/types";
import { bookRef, viewerIn, type BookRef } from "../people/books";
import { norm } from "../people/names";
import { peopleOverview, type PersonOverview } from "../people/people";
import { visible } from "../visibility";
import { getGroup, listGroups } from "../people/groups";
import { layOut, pickFaces, type OrbitFace } from "../people/orbit";
import { compareDue, whatsDue, type DueItem } from "./due";
import { today } from "../people/dates";
import { listRambles, type RambleSummary } from "../conversations/rambles";
import { search, type SearchHit } from "./search";
import { journalEntries } from "../journal/journal";
import { looks } from "../people/looks";
import type { LookParts } from "../core/types";

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

/** A group as the merged lists show it: every book's group of that name (`ids`), the households as one. `key`: "h" for the
 * households, "n:" and the normalised name for the others, so no name can stand for the household. */
export type GroupAcross = { key: string; name: string; ids: string[]; count: number; household: boolean };

// Each group's key. A second group of the same name in one book (one hidden from the partner, see findGroup) keeps its own,
// with its id: only groups of different books merge.
function groupKeys(groups: readonly InBook<{ id: string; name: string; household: boolean }>[]): Map<string, string> {
  const keys = new Map<string, string>();
  const taken = new Set<string>(); // book id + key
  for (const g of groups) {
    const base = g.household ? "h" : `n:${norm(g.name)}`;
    const key = taken.has(`${g.book.id} ${base}`) ? `${base}:${g.id}` : base;
    taken.add(`${g.book.id} ${base}`);
    keys.set(g.id, key);
  }
  return keys;
}

/** The groups of every book, merged by name; `count` is the people in them the viewer may see, co-members once. */
export async function groupsAcross(v: Viewer): Promise<GroupAcross[]> {
  const [groups, users] = await Promise.all([acrossBooks(v, listGroups), memberUsers(v)]);
  const keyOf = groupKeys(groups);
  const byKey = new Map<string, GroupAcross & { people: Set<string> }>();
  for (const g of groups) {
    const key = keyOf.get(g.id)!;
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
    for (const r of rows) byKey.get(keyOf.get(r.group_id)!)!.people.add(users.get(r.person_id) ?? r.person_id);
  }
  return [...byKey.values()].map(({ people, ...g }) => ({ ...g, count: people.size })).sort((a, b) => a.name.localeCompare(b.name, "de"));
}

/** The merged group a filter names, by its key or by the id of any of its books' groups; null when none does. */
export async function groupIdsFor(v: Viewer, wanted: string | undefined): Promise<GroupAcross | null> {
  if (!wanted) return null;
  return (await groupsAcross(v)).find((g) => g.key === wanted || g.ids.includes(wanted)) ?? null;
}

/** Everyone in the viewer's books but the viewer, co-members once, by name; `groups` are merged group keys, a co-member's
 * from every book they are in. */
export async function peopleAcross(v: Viewer): Promise<InBook<PersonOverview>[]> {
  const [people, users, groups] = await Promise.all([acrossBooks(v, peopleOverview), memberUsers(v), groupsAcross(v)]);
  const keyOf = new Map(groups.flatMap((g) => g.ids.map((id) => [id, g.key] as const)));
  const who = (id: string) => users.get(id) ?? id;
  const groupsOf = new Map<string, Set<string>>();
  for (const p of people) for (const id of p.groups) if (keyOf.has(id)) groupsOf.set(who(p.id), (groupsOf.get(who(p.id)) ?? new Set()).add(keyOf.get(id)!));
  return onceEach(people, (p) => who(p.id))
    .map((p) => ({ ...p, groups: [...(groupsOf.get(who(p.id)) ?? [])] }))
    .sort((a, b) => a.name.localeCompare(b.name, "de"));
}

const newestFirst = <T extends { date: string | null }>(xs: T[]) => xs.sort((a, b) => (b.date ?? "").localeCompare(a.date ?? ""));

/** The orbit of every book as one, co-members once (in the group when they are in it in any book); `group`: a merged group,
 * its key, or the id of one of its groups. */
export async function orbitAcross(v: Viewer, group?: GroupAcross | string, now = Date.now()): Promise<InBook<OrbitFace>[]> {
  const [g, users] = await Promise.all([typeof group === "string" ? groupIdsFor(v, group) : (group ?? null), memberUsers(v)]);
  const all = g ? new Set<string>() : null;
  const picked = await acrossBooks(v, async (w) => {
    let members: Set<string> | null = null;
    if (g) {
      members = new Set();
      for (const id of g.ids) {
        const found = await getGroup(w, id).catch(() => null); // a group of another book isn't found in this one
        for (const m of found?.members ?? []) members.add(m.personId);
      }
      for (const m of members) all!.add(m);
    }
    return pickFaces(w, now, members);
  });
  const who = (id: string) => users.get(id) ?? id;
  const kept = onceEach(picked, (f) => who(f.personId));
  const inGroup = all && new Set([...all].map(who));
  return layOut(kept, inGroup && new Set(kept.filter((f) => inGroup.has(who(f.personId))).map((f) => f.personId)));
}

/** What is due in every book, in whatsDue's order; the same date or nudge about a co-member in a later book is left out, while
 * two alike in one book both stay, as whatsDue gives them. */
export async function dueAcross(v: Viewer, from = today(), horizonDays = 14): Promise<InBook<DueItem>[]> {
  const [items, users] = await Promise.all([acrossBooks(v, (w) => whatsDue(w, from, horizonDays)), memberUsers(v)]);
  const firstIn = new Map<string, string>(); // a co-member's item → the book it was first seen in
  const once = items.filter((d) => {
    const user = users.get(d.personId);
    if (!user || d.kind === "session") return true;
    const key = `${user}|${d.kind}|${d.date ?? ""}|${d.text ?? ""}`;
    const seen = firstIn.get(key);
    if (seen === undefined) firstIn.set(key, d.book.id);
    return seen === undefined || seen === d.book.id;
  });
  return once.sort(compareDue);
}

/** Every book's rambles, newest first. */
export async function ramblesAcross(v: Viewer): Promise<InBook<RambleSummary>[]> {
  return newestFirst(await acrossBooks(v, listRambles));
}

/** Search in every book, newest first, at most `limit`. */
export async function searchAcross(v: Viewer, query: string, limit = 20): Promise<InBook<SearchHit>[]> {
  return newestFirst(await acrossBooks(v, (w) => search(w, query, limit))).slice(0, limit);
}

/** The journal of every book, newest first. */
export async function journalAcross(v: Viewer, q: Parameters<typeof journalEntries>[1]) {
  return newestFirst(await acrossBooks(v, (w) => journalEntries(w, q)));
}

/** The faces of every book's people. */
export async function looksAcross(v: Viewer): Promise<Record<string, LookParts>> {
  const all: Record<string, LookParts> = {};
  const i = await instance();
  for (const id of v.books) Object.assign(all, await looks((await viewerIn(i, v.userId, id))!));
  return all;
}
