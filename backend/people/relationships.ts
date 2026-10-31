// Relationships and group memberships set directly, without a conversation (relate): "Lena is Anna's sister", "Anna is in the
// Uni group". They go through the same checks and writers as the ones recorded with a conversation, with conversation_id null.
import type { Kysely } from "kysely";
import {
  checkGroup,
  checkRelationship,
  checkVisibility,
  insertMemberships,
  insertRelationships,
  type FiledRelationship,
  type ItemBase,
} from "../conversations/conversations";
import { db, now, type Schema } from "../db";
import { InvalidInputError, NotFoundError } from "../core/errors";
import type { Viewer, Visibility } from "../core/types";
import { groupPath } from "../core/urls";
import { isHouseholdWord, type Target } from "./household";

/** `from` and `to` are person ids, or "me" / "us" (household.ts); `label` is what `from` is to `to`, `inverse` what `to` is to `from`. */
export type NewRelationship = { from: Target; to: Target; label: string; inverse: string; note?: string; visibility: Visibility };
export type NewMembership = { name: string; members: string[]; visibility: Visibility };

const baseOf = (v: Viewer): ItemBase => ({ recorded_by: v.userId, conversation_id: null, created_at: now() });

async function assertPeople(tx: Kysely<Schema>, ids: string[]): Promise<void> {
  const unique = [...new Set(ids)];
  const found = await tx.selectFrom("persons").select("id").where("id", "in", unique).execute();
  if (found.length !== unique.length) throw new NotFoundError("No such person");
}

/**
 * `ids`: one per pair the targets stand for ("us" is one per household person), an existing one's when the viewer already sees it;
 * `relationships` says of each whether it was new.
 */
export async function addRelationship(v: Viewer, r: NewRelationship): Promise<{ ids: string[]; relationships: FiledRelationship[] }> {
  checkRelationship(r, () => {});
  checkVisibility(r.visibility);
  return (await db()).transaction().execute(async (tx) => {
    await assertPeople(
      tx,
      [r.from, r.to].filter((t) => !isHouseholdWord(t)),
    );
    const relationships = await insertRelationships(tx, v, baseOf(v), r);
    return { ids: relationships.map((x) => x.id), relationships };
  });
}

/**
 * `added` counts the new memberships, `already` the viewer's own that were there: one the viewer already recorded stays as it is.
 * `name` is the group's own, which the given name may only be another name of.
 */
export async function addToGroup(v: Viewer, g: NewMembership): Promise<{ added: number; already: number; id: string; name: string; url: string }> {
  checkGroup(g, () => {});
  checkVisibility(g.visibility);
  if (!g.members.length) throw new InvalidInputError("A group membership needs at least one person");
  return (await db()).transaction().execute(async (tx) => {
    await assertPeople(tx, g.members);
    const { added, groupId: id } = await insertMemberships(tx, v, baseOf(v), g.name, g.members, g.visibility);
    const { name } = await tx.selectFrom("groups").select("name").where("id", "=", id).executeTakeFirstOrThrow();
    return { added, already: new Set(g.members).size - added, id, name, url: groupPath(id) };
  });
}
