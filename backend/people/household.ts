// "Us" is the household: the persons the book's members are, not a person of its own. A role to us ("our landlady")
// is one relationship per household person; "me" is the viewer's own person.
import type { Scope } from "../db/scope";
import type { Viewer } from "../core/types";

/** A person id, or "me" (the viewer's person) or "us" (every household person). */
export type Target = string;
export const HOUSEHOLD_WORDS: readonly string[] = ["me", "us"];
export const isHouseholdWord = (t: unknown): t is "me" | "us" => t === "me" || t === "us";

/** The household persons: the members of the scope's book, in the order they joined. */
export async function householdPersons(s: Scope): Promise<string[]> {
  const rows = await s.instance.from("members").select("person_id").where("book_id", "=", s.v.bookId).orderBy("created_at").orderBy("user_id").execute();
  return rows.map((r) => r.person_id);
}

/** The person ids a target stands for. */
export async function resolveTarget(s: Scope, v: Viewer, t: Target): Promise<string[]> {
  if (t === "me") return [v.personId];
  if (t === "us") return householdPersons(s);
  return [t];
}

/** Every (from, to) pair the two targets stand for, without a person related to themself (a household person's role to "us"). */
export async function resolvePairs(s: Scope, v: Viewer, from: Target, to: Target): Promise<Array<[string, string]>> {
  const [froms, tos] = await Promise.all([resolveTarget(s, v, from), resolveTarget(s, v, to)]);
  return froms.flatMap((f) => tos.filter((t) => t !== f).map((t): [string, string] => [f, t]));
}
