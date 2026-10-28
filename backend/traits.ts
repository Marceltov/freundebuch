// What people need and how they are: the facts of kind `need` and `personality`, as the viewer sees them.
import type { Kysely, Selectable } from "kysely";
import type { Fact } from "./briefing";
import type { Schema } from "./db/schema";
import { TRAIT_KINDS, type FactCategory, type Viewer, type Visibility } from "./types";
import { itemPath, personPath, screenshotPath } from "./urls";
import { visible } from "./visibility";

/** `needs`: what to plan around when meeting or inviting the person; `personality`: how they are. Each as filed. */
export type Traits = { needs: Fact[]; personality: Fact[] };

/** A fact row as the briefing and the traits show it, linked from the person's page `page`. */
export function toFact(f: Selectable<Schema["facts"]>, v: Viewer, page: string): Fact {
  return {
    id: f.id,
    text: f.text,
    category: f.category as FactCategory,
    url: itemPath(page, "facts", f.id),
    ...(f.source ? { source: f.source } : {}),
    ...(f.happened_on ? { happenedOn: f.happened_on } : {}),
    ...(f.screenshot_id ? { imageUrl: screenshotPath(f.screenshot_id) } : {}),
    visibility: f.visibility as Visibility,
    mine: f.recorded_by === v.userId,
  };
}

/** Splits a person's current, visible facts (oldest first) into their traits. */
export function splitTraits(facts: Selectable<Schema["facts"]>[], v: Viewer, page: string): Traits {
  return {
    needs: facts.filter((f) => f.kind === "need").map((f) => toFact(f, v, page)),
    personality: facts.filter((f) => f.kind === "personality").map((f) => toFact(f, v, page)),
  };
}

/** The current traits the viewer may see of each person given, an entry (maybe empty) for every one. */
export async function traitsOf(d: Kysely<Schema>, v: Viewer, personIds: string[]): Promise<Map<string, Traits>> {
  const rows = personIds.length
    ? await d
        .selectFrom("facts")
        .selectAll()
        .where("person_id", "in", personIds)
        .where("status", "=", "current")
        .where("kind", "in", TRAIT_KINDS)
        .$call((qb) => visible(qb, v, "facts"))
        .orderBy("created_at")
        .execute()
    : [];
  return new Map(personIds.map((id) => [id, splitTraits(rows.filter((r) => r.person_id === id), v, personPath(id))]));
}
