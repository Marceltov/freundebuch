// Managing a book: its name, its members and their roles, leaving it and deleting it. The owner made it and does everything;
// an admin renames it and removes members (not the owner or other admins); every member may leave. Whoever leaves, or is
// removed, takes what they marked private in the book with them (it is deleted); what they shared stays (V8), and so does
// their person, as anyone else the others know.
import { instance, type InstanceDb } from "../db/scope";
import { ForbiddenError, InvalidInputError, NotFoundError } from "../core/errors";
import type { Viewer } from "../core/types";
import type { VisibleTable } from "../visibility";
import { dropBlobs } from "../conversations/files";
import { BOOK_NAME_MAX, listBooks, requireRole, roleOf } from "./books";
import { norm } from "./names";

const PRIVATE_TABLES: readonly VisibleTable[] = [
  "facts",
  "promises",
  "dates",
  "exchanges",
  "relationships",
  "group_members",
  "place_owners",
  "conversations",
  "experiences",
  "series",
  "journal_entries",
  "rambles",
];

async function onlyBook(v: Viewer): Promise<boolean> {
  return (await listBooks(v)).length <= 1;
}

async function memberRole(i: InstanceDb, bookId: string, userId: string) {
  const m = await i.from("members").select("role").where("book_id", "=", bookId).where("user_id", "=", userId).executeTakeFirst();
  if (!m) throw new NotFoundError("Not a member of this book");
  return m.role;
}

export async function renameBook(v: Viewer, name: string): Promise<void> {
  await requireRole(v, ["owner", "admin"], "rename it");
  const n = name.trim();
  if (!n) throw new InvalidInputError("A book needs a name");
  if (n.length > BOOK_NAME_MAX) throw new InvalidInputError(`A book's name has at most ${BOOK_NAME_MAX} characters`);
  if ((await listBooks(v)).some((b) => b.id !== v.bookId && norm(b.name) === norm(n))) throw new InvalidInputError(`There is already a book called ${n}`);
  await (await instance()).update("books").set({ name: n }).where("id", "=", v.bookId).execute();
}

/** Makes a member an admin, or an admin a member; the owner's own role changes only by handing over. */
export async function setRole(v: Viewer, userId: string, role: "admin" | "member"): Promise<void> {
  await requireRole(v, ["owner"], "change roles");
  const i = await instance();
  if ((await memberRole(i, v.bookId, userId)) === "owner") throw new InvalidInputError("The owner's role changes only by handing the book over");
  await i.update("members").set({ role }).where("book_id", "=", v.bookId).where("user_id", "=", userId).execute();
}

/** Hands the book to another member; the old owner stays, as an admin. */
export async function handOver(v: Viewer, userId: string): Promise<void> {
  await requireRole(v, ["owner"], "hand it over");
  if (userId === v.userId) throw new InvalidInputError("You own it already");
  await (
    await instance()
  ).transaction(async (i) => {
    await memberRole(i, v.bookId, userId);
    await i.update("members").set({ role: "admin" }).where("book_id", "=", v.bookId).where("user_id", "=", v.userId).execute();
    await i.update("members").set({ role: "owner" }).where("book_id", "=", v.bookId).where("user_id", "=", userId).execute();
  });
}

export async function removeMember(v: Viewer, userId: string): Promise<void> {
  const mine = await requireRole(v, ["owner", "admin"], "remove members");
  if (userId === v.userId) throw new InvalidInputError("Leave the book instead");
  const i = await instance();
  const theirs = await memberRole(i, v.bookId, userId);
  if (theirs === "owner" || (theirs === "admin" && mine !== "owner")) throw new ForbiddenError("Only the owner may remove an admin, and nobody the owner");
  await dropMember(v, userId);
}

export async function leaveBook(v: Viewer): Promise<void> {
  const role = await roleOf(v);
  if (!role) throw new NotFoundError("Not a member of this book");
  if (role === "owner") throw new InvalidInputError("The owner hands the book over before leaving");
  if (await onlyBook(v)) throw new InvalidInputError("This is your only book: you can't leave it");
  await dropMember(v, v.userId);
}

// Only the viewer's one book, whichever books the viewer handed in can read.
const onlyThis = (v: Viewer): Viewer => ({ ...v, books: [v.bookId] });

// The member row goes, with their settings, waiting files, private rows and place in the book's own group, in this book only;
// one transaction. Files that facts show (filed) stay with the facts.
async function dropMember(v: Viewer, userId: string): Promise<void> {
  const blobs: string[] = [];
  await (
    await instance()
  ).transaction(async (i) => {
    const s = i.scope(onlyThis(v));
    const member = await i.from("members").select("person_id").where("book_id", "=", v.bookId).where("user_id", "=", userId).executeTakeFirstOrThrow();
    for (const t of PRIVATE_TABLES) await s.delete(t).where("recorded_by", "=", userId).where("visibility", "=", "private").execute();
    await s.delete("person_settings").where("user_id", "=", userId).execute();
    const waiting = ["reading", "pending", "failed"] as const;
    const files = await s.from("files").select("blob_key").where("user_id", "=", userId).where("status", "in", waiting).execute();
    blobs.push(...files.map((f) => f.blob_key));
    await s.delete("files").where("user_id", "=", userId).where("status", "in", waiting).execute();
    const household = await s.from("groups").select("id").where("household", "=", 1).executeTakeFirstOrThrow();
    await s.delete("group_members").where("group_id", "=", household.id).where("person_id", "=", member.person_id).execute();
    await i.delete("members").where("book_id", "=", v.bookId).where("user_id", "=", userId).execute();
  });
  await dropBlobs(blobs);
}

/** Deletes the book and everything in it; the owner's, and not their only book. */
export async function deleteBook(v: Viewer): Promise<void> {
  await requireRole(v, ["owner"], "delete it");
  if (await onlyBook(v)) throw new InvalidInputError("This is your only book: you can't delete it");
  const i = await instance();
  const blobs = (await i.scope(onlyThis(v)).from("files").select("blob_key").execute()).map((f) => f.blob_key);
  await i.delete("books").where("id", "=", v.bookId).execute();
  await dropBlobs(blobs);
}
