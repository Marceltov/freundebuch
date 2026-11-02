// Reading across the user's books, for the web app's lists: each read runs once per book, in that book alone (as the MCP `each`
// rule does), so privacy and "the viewer's own person" stay what they are within one book; the results are tagged with their
// book and merged. A co-member (someone in several of the user's books) has a person in each: they show once, from the
// oldest book. Groups stay each in its book.
import { instance } from "../db/scope";
import type { Viewer } from "../core/types";
import { bookRef, viewerIn, type BookRef } from "../people/books";
import { peopleOverview, type PersonOverview } from "../people/people";
import { getGroup, listGroups, type GroupView } from "../people/groups";
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

/** Every book's groups the viewer sees, each with its book; groups never merge across books. `count`: the people in it the
 * viewer may see. */
export async function groupsAcross(v: Viewer): Promise<InBook<GroupView>[]> {
  return (await acrossBooks(v, listGroups)).sort((a, b) => a.name.localeCompare(b.name, "de"));
}

/** Everyone in the viewer's books but the viewer, co-members once, by name; `groups`: the ids of their groups, a co-member's
 * from every book they are in. */
export async function peopleAcross(v: Viewer): Promise<InBook<PersonOverview>[]> {
  const [people, users] = await Promise.all([acrossBooks(v, peopleOverview), memberUsers(v)]);
  const who = (id: string) => users.get(id) ?? id;
  const groupsOf = new Map<string, Set<string>>();
  for (const p of people) for (const id of p.groups) groupsOf.set(who(p.id), (groupsOf.get(who(p.id)) ?? new Set()).add(id));
  return onceEach(people, (p) => who(p.id))
    .map((p) => ({ ...p, groups: [...(groupsOf.get(who(p.id)) ?? [])] }))
    .sort((a, b) => a.name.localeCompare(b.name, "de"));
}

const newestFirst = <T extends { date: string | null }>(xs: T[]) => xs.sort((a, b) => (b.date ?? "").localeCompare(a.date ?? ""));

/** The orbit of every book as one, co-members once; `groupId`: a group of one of the books, whose members show first and are
 * marked (a co-member when they are in it). */
export async function orbitAcross(v: Viewer, groupId?: string, now = Date.now()): Promise<InBook<OrbitFace>[]> {
  const users = await memberUsers(v);
  const who = (id: string) => users.get(id) ?? id;
  const inGroup = groupId ? new Set<string>() : null;
  const picked = await acrossBooks(v, async (w) => {
    const group = groupId ? await getGroup(w, groupId).catch(() => null) : null; // found only in its own book
    for (const m of group?.members ?? []) inGroup!.add(who(m.personId));
    return pickFaces(w, now, group ? new Set(group.members.map((m) => m.personId)) : null);
  });
  const kept = onceEach(picked, (f) => who(f.personId));
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
