// Relationships and group memberships set directly, without a conversation (relate): "Lena is Anna's sister", "Anna is in the
// Uni group". They go through the same checks and writers as the ones recorded with a conversation, with conversation_id null.
import type { Kysely } from "kysely";
import { checkGroup, checkRelationship, checkVisibility, insertMemberships, insertRelationship, type ItemBase } from "./conversations";
import { db, now, type Schema } from "./db";
import { InvalidInputError, NotFoundError } from "./errors";
import type { RelationshipType, Viewer, Visibility } from "./types";
import { groupPath } from "./urls";

export type NewRelationship = { from: string; to: string; type: RelationshipType; note?: string; visibility: Visibility };
export type NewMembership = { name: string; members: string[]; visibility: Visibility };

const baseOf = (v: Viewer): ItemBase => ({ recorded_by: v.userId, conversation_id: null, created_at: now() });

async function assertPeople(tx: Kysely<Schema>, ids: string[]): Promise<void> {
  const unique = [...new Set(ids)];
  const found = await tx.selectFrom("persons").select("id").where("id", "in", unique).execute();
  if (found.length !== unique.length) throw new NotFoundError("No such person");
}

export async function addRelationship(v: Viewer, r: NewRelationship): Promise<{ id: string }> {
  checkRelationship(r, () => {});
  checkVisibility(r.visibility);
  return (await db()).transaction().execute(async (tx) => {
    await assertPeople(tx, [r.from, r.to]);
    return { id: await insertRelationship(tx, baseOf(v), { fromId: r.from, toId: r.to, type: r.type, note: r.note, visibility: r.visibility }) };
  });
}

/** `added` counts the new memberships: one the viewer already recorded stays as it is. `name` is the group's own, which the given name may only be another name of. */
export async function addToGroup(v: Viewer, g: NewMembership): Promise<{ added: number; id: string; name: string; url: string }> {
  checkGroup(g, () => {});
  checkVisibility(g.visibility);
  if (!g.members.length) throw new InvalidInputError("A group membership needs at least one person");
  return (await db()).transaction().execute(async (tx) => {
    await assertPeople(tx, g.members);
    const { added, groupId: id } = await insertMemberships(tx, v, baseOf(v), g.name, g.members, g.visibility);
    const { name } = await tx.selectFrom("groups").select("name").where("id", "=", id).executeTakeFirstOrThrow();
    return { added, id, name, url: groupPath(id) };
  });
}
