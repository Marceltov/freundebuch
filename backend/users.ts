// Users come from the OIDC provider. The first login also creates the user's own Person, so "me" is a person like any other.
// The person's name follows the sign-in name until someone renames the person in freundebuch (Bille signs in, the book knows
// her as Sybille); from then on the sign-in name only finds her, as another name.
import { db, newId, now } from "./db";
import { insertAlias } from "./people";
import type { Viewer } from "./types";

export async function userFromOidc(c: { sub: string; name: string; email?: string }): Promise<Viewer> {
  const d = await db();
  return d.transaction().execute(async (tx) => {
    const user = await tx.selectFrom("users").select(["id", "person_id", "name"]).where("oidc_sub", "=", c.sub).executeTakeFirst();
    if (user?.person_id) {
      const person = await tx.selectFrom("persons").select("name").where("id", "=", user.person_id).executeTakeFirstOrThrow();
      await tx.updateTable("users").set({ name: c.name }).where("id", "=", user.id).execute();
      if (person.name === user.name) await tx.updateTable("persons").set({ name: c.name }).where("id", "=", user.person_id).execute();
      else await insertAlias(tx, user.person_id, person.name, c.name);
      return { userId: user.id, personId: user.person_id };
    }
    const userId = user?.id ?? newId();
    const personId = newId();
    const t = now();
    if (!user) await tx.insertInto("users").values({ id: userId, oidc_sub: c.sub, name: c.name, email: c.email ?? null, person_id: null, created_at: t }).execute();
    await tx.insertInto("persons").values({ id: personId, name: c.name, created_by: userId, created_from: null, created_at: t }).execute();
    await tx.updateTable("users").set({ name: c.name, person_id: personId }).where("id", "=", userId).execute();
    // Everyone who signs in is in the household's own group.
    const household = await tx.selectFrom("groups").select("id").where("household", "=", 1).executeTakeFirst();
    if (household)
      await tx.insertInto("group_members").values({ group_id: household.id, person_id: personId, visibility: "shared", recorded_by: userId, conversation_id: null }).execute();
    return { userId, personId };
  });
}

export async function viewerById(userId: string): Promise<Viewer | null> {
  const row = await (await db()).selectFrom("users").select(["id", "person_id"]).where("id", "=", userId).executeTakeFirst();
  return row?.person_id ? { userId: row.id, personId: row.person_id } : null;
}
