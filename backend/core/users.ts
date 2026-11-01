// Users come from the OIDC provider. The first sign-in joins the instance's book, or makes one on a fresh instance, and creates
// the user's own person in it, so "me" is a person like any other. The person's name follows the sign-in name until someone
// renames the person in freundebuch (Bille signs in, the book knows her as Sybille); from then on the sign-in name only finds
// her, as another name.
import { instance } from "../db/scope";
import { newId, now } from "../db";
import { createBook, joinBook, viewerOf } from "../people/books";
import { insertAlias } from "../people/people";
import type { Viewer } from "./types";

/** The name a fresh instance's first book gets. */
export const FIRST_BOOK = "Unser Buch";

export async function userFromOidc(c: { sub: string; name: string; email?: string }): Promise<Viewer> {
  return (await instance()).transaction(async (i) => {
    const user = await i.from("users").select(["id", "name"]).where("oidc_sub", "=", c.sub).executeTakeFirst();
    const known = user && (await viewerOf(i, user.id));
    if (user && known) {
      const s = i.scope(known);
      const person = await s.from("persons").select("name").where("id", "=", known.personId).executeTakeFirstOrThrow();
      await i.update("users").set({ name: c.name }).where("id", "=", user.id).execute();
      if (person.name === user.name) await s.update("persons").set({ name: c.name }).where("id", "=", known.personId).execute();
      else await insertAlias(s, known.personId, person.name, c.name);
      return known;
    }
    const userId = user?.id ?? newId();
    if (user) await i.update("users").set({ name: c.name }).where("id", "=", userId).execute();
    else await i.insert("users", { id: userId, oidc_sub: c.sub, name: c.name, email: c.email ?? null, created_at: now() }).execute();
    const book = await i.from("books").select("id").orderBy("created_at").orderBy("id").executeTakeFirst();
    // Until invitations (2b) whoever signs in joins the instance's book, as the household's second admin.
    return book ? joinBook(i, book.id, userId, c.name, "admin") : createBook(i, userId, c.name, FIRST_BOOK);
  });
}

export async function viewerById(userId: string): Promise<Viewer | null> {
  return viewerOf(await instance(), userId);
}
