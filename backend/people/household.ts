// "Us" is the household: the persons some user's `person_id` points at, not a person of its own. A role to us ("our landlady")
// is one relationship per household person; "me" is the viewer's own person.
import { sql, type Kysely } from "kysely";
import type { Schema } from "../db";
import type { Viewer } from "../core/types";

/** A person id, or "me" (the viewer's person) or "us" (every household person). */
export type Target = string;
export const HOUSEHOLD_WORDS: readonly string[] = ["me", "us"];
export const isHouseholdWord = (t: unknown): t is "me" | "us" => t === "me" || t === "us";

/** The household persons, in the order their users signed up. */
export async function householdPersons(tx: Kysely<Schema>): Promise<string[]> {
  const rows = await tx
    .selectFrom("users")
    .select("person_id")
    .where("person_id", "is not", null)
    .orderBy("created_at")
    .orderBy(sql`rowid`)
    .execute();
  return rows.map((r) => r.person_id!);
}

/** The person ids a target stands for. */
export async function resolveTarget(tx: Kysely<Schema>, v: Viewer, t: Target): Promise<string[]> {
  if (t === "me") return [v.personId];
  if (t === "us") return householdPersons(tx);
  return [t];
}

/** Every (from, to) pair the two targets stand for, without a person related to themself (a household person's role to "us"). */
export async function resolvePairs(tx: Kysely<Schema>, v: Viewer, from: Target, to: Target): Promise<Array<[string, string]>> {
  const [froms, tos] = await Promise.all([resolveTarget(tx, v, from), resolveTarget(tx, v, to)]);
  return froms.flatMap((f) => tos.filter((t) => t !== f).map((t): [string, string] => [f, t]));
}
