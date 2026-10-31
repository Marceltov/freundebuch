// A book: the people, conversations and items its members keep together. Whoever makes one is its first member; each member is
// a person in it ("me"), and every member is in its own group, Haushalt.
import { newId, now } from "../db";
import type { InstanceDb } from "../db/scope";
import { HOUSEHOLD_GROUP, SEEDED_GROUPS } from "../db/tables";
import type { Viewer } from "../core/types";
import { norm } from "./names";

// The user's person in the book, their member row and their place in Haushalt.
async function addMember(i: InstanceDb, bookId: string, userId: string, userName: string, householdId: string): Promise<Viewer> {
  const v: Viewer = { userId, personId: newId(), bookId, books: [bookId] };
  const s = i.scope(v);
  await s.insert("persons", { id: v.personId, name: userName, created_by: userId, created_from: null, created_at: now() }).execute();
  await i.insert("members", { book_id: bookId, user_id: userId, person_id: v.personId, created_at: now() }).execute();
  await s.insert("group_members", { group_id: householdId, person_id: v.personId, visibility: "shared", recorded_by: userId, conversation_id: null }).execute();
  return v;
}

/** Makes a book with Haushalt and the seeded groups, its maker the first member. */
export async function createBook(i: InstanceDb, userId: string, userName: string, name: string): Promise<Viewer> {
  const bookId = newId();
  const t = now();
  await i.insert("books", { id: bookId, name, created_by: userId, created_at: t }).execute();
  const s = i.scope({ userId, personId: "", bookId, books: [bookId] });
  const householdId = newId();
  await s.insert("groups", { id: householdId, name: HOUSEHOLD_GROUP, created_by: null, created_at: t, seeded: 1, household: 1 }).execute();
  for (const g of SEEDED_GROUPS) {
    const id = newId();
    await s.insert("groups", { id, name: g.name, created_by: null, created_at: t, seeded: 1 }).execute();
    await s
      .insert(
        "group_aliases",
        g.aliases.map((alias) => ({ group_id: id, alias, norm: norm(alias) })),
      )
      .execute();
  }
  return addMember(i, bookId, userId, userName, householdId);
}

/** Makes the user a member of the book. */
export async function joinBook(i: InstanceDb, bookId: string, userId: string, userName: string): Promise<Viewer> {
  const s = i.scope({ userId, personId: "", bookId, books: [bookId] });
  const household = await s.from("groups").select("id").where("household", "=", 1).executeTakeFirstOrThrow();
  return addMember(i, bookId, userId, userName, household.id);
}

/** The user's viewer: their oldest membership is the book they write to; they read every book they are in. */
export async function viewerOf(i: InstanceDb, userId: string): Promise<Viewer | null> {
  const rows = await i.from("members").select(["book_id", "person_id"]).where("user_id", "=", userId).orderBy("created_at").orderBy("book_id").execute();
  if (!rows.length) return null;
  return { userId, personId: rows[0].person_id, bookId: rows[0].book_id, books: rows.map((r) => r.book_id) };
}
