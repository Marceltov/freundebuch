// Invitations to a book: a link that works once, for a week, made by the book's owner or an admin (admins only by the owner). Only the token's hash is kept;
// whoever signs in through the link (a new user) or opens it signed in (an existing one) joins the book in the role it names.
import { createHash, randomBytes } from "node:crypto";
import { newId, now } from "../db";
import { instance, type InstanceDb } from "../db/scope";
import { ForbiddenError, InvalidInputError, NotFoundError } from "../core/errors";
import type { Viewer } from "../core/types";
import { inBook, joinBook, requireRole } from "./books";

export const INVITATION_DAYS = 7;
const PREFIX = "fbi_";
const hash = (token: string) => createHash("sha256").update(token).digest("hex");

/** Where an invitation opens, as a path. */
export const invitationPath = (token: string) => `/einladung/${token}`;

/** A new invitation to the viewer's book; the link is shown once. */
export async function invite(v: Viewer, role: "member" | "admin"): Promise<{ id: string; url: string; expiresAt: number }> {
  await requireRole(v, role === "admin" ? ["owner"] : ["owner", "admin"], role === "admin" ? "invite admins" : "invite people");
  const token = PREFIX + randomBytes(32).toString("base64url");
  const id = newId();
  const expiresAt = Date.now() + INVITATION_DAYS * 86_400_000;
  await (
    await instance()
  )
    .insert("invitations", { id, book_id: v.bookId, token_hash: hash(token), role, created_by: v.userId, created_at: now(), expires_at: expiresAt })
    .execute();
  return { id, url: invitationPath(token), expiresAt };
}

/** The book's invitations that can still be used. */
export async function listInvitations(v: Viewer): Promise<{ id: string; role: "member" | "admin"; createdBy: string; expiresAt: number }[]> {
  await requireRole(v, ["owner", "admin"], "see its invitations");
  const rows = await (
    await instance()
  )
    .from("invitations")
    .innerJoin("users", "users.id", "invitations.created_by")
    .select(["invitations.id", "invitations.role", "users.name", "invitations.expires_at"])
    .where("invitations.book_id", "=", v.bookId)
    .where("invitations.used_at", "is", null)
    .where("invitations.expires_at", ">", Date.now())
    .orderBy("invitations.created_at")
    .execute();
  return rows.map((r) => ({ id: r.id, role: r.role, createdBy: r.name, expiresAt: r.expires_at }));
}

/** The open invitations of each of `books` the viewer manages, by book id. A book where the viewer lost the role, or which
 * they left, since `books` was read is left out. */
export async function openInvitations(
  v: Viewer,
  books: readonly { id: string; role: string }[],
): Promise<Record<string, Awaited<ReturnType<typeof listInvitations>>>> {
  const out: Record<string, Awaited<ReturnType<typeof listInvitations>>> = {};
  for (const b of books.filter((x) => x.role !== "member")) {
    try {
      out[b.id] = await listInvitations(await inBook(v, b.id));
    } catch (e) {
      if (!(e instanceof ForbiddenError || e instanceof NotFoundError)) throw e;
    }
  }
  return out;
}

/** Ends an invitation: its link stops working. */
export async function revokeInvitation(v: Viewer, id: string): Promise<void> {
  await requireRole(v, ["owner", "admin"], "revoke invitations");
  const r = await (await instance()).delete("invitations").where("id", "=", id).where("book_id", "=", v.bookId).executeTakeFirst();
  if (!r.numDeletedRows) throw new NotFoundError("No such invitation");
}

async function usable(i: InstanceDb, token: string) {
  if (!token.startsWith(PREFIX)) return null;
  return (
    (await i
      .from("invitations")
      .innerJoin("books", "books.id", "invitations.book_id")
      .innerJoin("users", "users.id", "invitations.created_by")
      // Only while whoever made it may still invite: removing an admin, or taking the role back, ends their invitations.
      .innerJoin("members", (j) => j.onRef("members.book_id", "=", "invitations.book_id").onRef("members.user_id", "=", "invitations.created_by"))
      .select(["invitations.id", "invitations.book_id", "books.name as book", "invitations.role", "users.name as by"])
      .where("members.role", "in", ["owner", "admin"])
      .where("invitations.token_hash", "=", hash(token))
      .where("invitations.used_at", "is", null)
      .where("invitations.expires_at", ">", Date.now())
      .executeTakeFirst()) ?? null
  );
}

/** What an invitation is to: its book, the role and who made it; null when it can't be used (unknown, used, expired). */
export async function invitationFor(token: string): Promise<{ id: string; bookId: string; bookName: string; role: "member" | "admin"; by: string } | null> {
  const r = await usable(await instance(), token);
  return r ? { id: r.id, bookId: r.book_id, bookName: r.book, role: r.role, by: r.by } : null;
}

/** Whether the invitation can be used, on a given handle (inside a transaction). */
export async function invitationUsable(i: InstanceDb, token: string): Promise<boolean> {
  return !!(await usable(i, token));
}

/** Joins the user to the invitation's book and uses the invitation up, in one transaction. */
export async function acceptInvitation(i: InstanceDb, token: string, userId: string, userName: string): Promise<Viewer> {
  return i.transaction(async (tx) => {
    const r = await usable(tx, token);
    if (!r) throw new NotFoundError("This invitation can't be used any more");
    const member = await tx.from("members").select("user_id").where("book_id", "=", r.book_id).where("user_id", "=", userId).executeTakeFirst();
    if (member) throw new InvalidInputError(`Already in ${r.book}`);
    // Used up only if nobody else just did (two accepts at once, on a database that runs them side by side).
    const used = await tx
      .update("invitations")
      .set({ used_by: userId, used_at: Date.now() })
      .where("id", "=", r.id)
      .where("used_at", "is", null)
      .executeTakeFirst();
    if (!used.numUpdatedRows) throw new NotFoundError("This invitation can't be used any more");
    return joinBook(tx, r.book_id, userId, userName, r.role);
  });
}

/** The signed-in user takes the invitation: they join its book. */
export async function acceptInvitationAs(v: Viewer, token: string): Promise<{ id: string; name: string }> {
  const i = await instance();
  const user = await i.from("users").select("name").where("id", "=", v.userId).executeTakeFirstOrThrow();
  const joined = await acceptInvitation(i, token, v.userId, user.name);
  return await i.from("books").select(["id", "name"]).where("id", "=", joined.bookId).executeTakeFirstOrThrow();
}
