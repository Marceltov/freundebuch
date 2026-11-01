// Users come from the OIDC provider. A first sign-in joins the book of the invitation it came through, or makes a book (on a fresh
// instance, or with open registration), and creates the user's own person in it, so "me" is a person like any other. The person's name follows the sign-in name until someone
// renames the person in freundebuch (Bille signs in, the book knows her as Sybille); from then on the sign-in name only finds
// her, as another name.
import { instance } from "../db/scope";
import { newId, now } from "../db";
import { createBook, viewerOf } from "../people/books";
import { acceptInvitation, invitationUsable } from "../people/invitations";
import { config } from "./config";
import { NotInvitedError } from "./errors";
import { insertAlias } from "../people/people";
import type { Viewer } from "./types";

/** The name a fresh instance's first book gets. */
export const FIRST_BOOK = "Unser Buch";

/** The name a book gets that someone signing up without an invitation starts with. */
export const OWN_BOOK = "Mein Buch";

/**
 * The viewer a sign-in is. A known user in a book signs in as before (an invitation they came through is accepted on its page).
 * Anyone else joins the invitation's book, or gets a book of their own on a fresh instance or with open registration, or is
 * turned away (NotInvitedError) and no user is made.
 */
export async function userFromOidc(c: { sub: string; name: string; email?: string }, opts: { invitation?: string } = {}): Promise<Viewer> {
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
    const invited = opts.invitation && (await invitationUsable(i, opts.invitation)) ? opts.invitation : undefined;
    const fresh = !(await i.from("books").select("id").executeTakeFirst());
    if (!invited && !fresh && config.registration() !== "open") throw new NotInvitedError();
    const userId = user?.id ?? newId();
    if (user) await i.update("users").set({ name: c.name }).where("id", "=", userId).execute();
    else await i.insert("users", { id: userId, oidc_sub: c.sub, name: c.name, email: c.email ?? null, created_at: now() }).execute();
    if (invited) return acceptInvitation(i, invited, userId, c.name);
    return createBook(i, userId, c.name, fresh ? FIRST_BOOK : OWN_BOOK);
  });
}

export async function viewerById(userId: string): Promise<Viewer | null> {
  return viewerOf(await instance(), userId);
}
