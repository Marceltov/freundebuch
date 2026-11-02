// "Us" is the book's writers: the persons its members are, not a person of its own. A role to us ("our landlady") is one
// relationship per writer; "me" is the viewer's own person.
import type { Scope } from "../db/scope";
import type { Viewer } from "../core/types";

/** A person id, or "me" (the viewer's person) or "us" (every writer). */
export type Target = string;
export const US_WORDS: readonly string[] = ["me", "us"];
export const isUsWord = (t: unknown): t is "me" | "us" => t === "me" || t === "us";

/** The writers' persons: the members of the scope's book, in the order they joined. */
export async function writerPersons(s: Scope): Promise<string[]> {
  const rows = await s.instance.from("members").select("person_id").where("book_id", "=", s.v.bookId).orderBy("created_at").orderBy("user_id").execute();
  return rows.map((r) => r.person_id);
}

/** The book's members: each user id with their person. */
export async function memberPersons(s: Scope): Promise<Map<string, string>> {
  const rows = await s.instance.from("members").select(["user_id", "person_id"]).where("book_id", "=", s.v.bookId).execute();
  return new Map(rows.map((r) => [r.user_id, r.person_id]));
}

/** The book's other members, as viewers of it. */
export async function otherMembers(s: Scope): Promise<Viewer[]> {
  return [...(await memberPersons(s))]
    .filter(([userId]) => userId !== s.v.userId)
    .map(([userId, personId]) => ({ userId, personId, bookId: s.v.bookId, books: [s.v.bookId] }));
}

/** The person ids a target stands for. */
export async function resolveTarget(s: Scope, v: Viewer, t: Target): Promise<string[]> {
  if (t === "me") return [v.personId];
  if (t === "us") return writerPersons(s);
  return [t];
}

/** Every (from, to) pair the two targets stand for, without a person related to themself (a writer's role to "us"). */
export async function resolvePairs(s: Scope, v: Viewer, from: Target, to: Target): Promise<Array<[string, string]>> {
  const [froms, tos] = await Promise.all([resolveTarget(s, v, from), resolveTarget(s, v, to)]);
  return froms.flatMap((f) => tos.filter((t) => t !== f).map((t): [string, string] => [f, t]));
}
