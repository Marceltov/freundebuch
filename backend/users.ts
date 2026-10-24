// Users come from the OIDC provider. The first login also creates the user's own Person, so "me" is a person like any other.
import { db, newId, now } from "./db";
import type { Viewer } from "./types";

export async function userFromOidc(c: { sub: string; name: string; email?: string }): Promise<Viewer> {
  const d = await db();
  return d.transaction().execute(async (tx) => {
    const user = await tx.selectFrom("users").select(["id", "person_id"]).where("oidc_sub", "=", c.sub).executeTakeFirst();
    if (user?.person_id) {
      await tx.updateTable("users").set({ name: c.name }).where("id", "=", user.id).execute();
      await tx.updateTable("persons").set({ name: c.name }).where("id", "=", user.person_id).execute();
      return { userId: user.id, personId: user.person_id };
    }
    const userId = user?.id ?? newId();
    const personId = newId();
    const t = now();
    if (!user) await tx.insertInto("users").values({ id: userId, oidc_sub: c.sub, name: c.name, email: c.email ?? null, person_id: null, created_at: t }).execute();
    await tx.insertInto("persons").values({ id: personId, name: c.name, created_by: userId, created_from: null, created_at: t }).execute();
    await tx.updateTable("users").set({ name: c.name, person_id: personId }).where("id", "=", userId).execute();
    return { userId, personId };
  });
}

export async function viewerById(userId: string): Promise<Viewer | null> {
  const row = await (await db()).selectFrom("users").select(["id", "person_id"]).where("id", "=", userId).executeTakeFirst();
  return row?.person_id ? { userId: row.id, personId: row.person_id } : null;
}
