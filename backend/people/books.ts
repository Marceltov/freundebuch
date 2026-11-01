// A book: the people, conversations and items its members keep together. Whoever makes one is its first member; each member is
// a person in it ("me"), and every member is in its own group, Haushalt.
import { newId, now } from "../db";
import { instance, scope, type InstanceDb } from "../db/scope";
import { HOUSEHOLD_GROUP, KEYED_TABLES, SEEDED_GROUPS } from "../db/tables";
import { InvalidInputError, NotFoundError } from "../core/errors";
import { isHouseholdWord } from "./household";
import type { Role, Viewer } from "../core/types";
import { norm } from "./names";

// The user's person in the book, their member row and their place in Haushalt.
async function addMember(i: InstanceDb, bookId: string, userId: string, userName: string, householdId: string, role: Role): Promise<Viewer> {
  const v: Viewer = { userId, personId: newId(), bookId, books: [bookId] };
  const s = i.scope(v);
  await s.insert("persons", { id: v.personId, name: userName, created_by: userId, created_from: null, created_at: now() }).execute();
  await i.insert("members", { book_id: bookId, user_id: userId, person_id: v.personId, created_at: now(), role }).execute();
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
  await s.insert("groups", { id: householdId, name: HOUSEHOLD_GROUP, created_by: null, created_at: now(), seeded: 1, household: 1 }).execute();
  for (const g of SEEDED_GROUPS) {
    const id = newId();
    await s.insert("groups", { id, name: g.name, created_by: null, created_at: now(), seeded: 1 }).execute();
    await s
      .insert(
        "group_aliases",
        g.aliases.map((alias) => ({ group_id: id, alias, norm: norm(alias) })),
      )
      .execute();
  }
  return addMember(i, bookId, userId, userName, householdId, "owner");
}

/** Makes the user a member of the book, in the given role. */
export async function joinBook(i: InstanceDb, bookId: string, userId: string, userName: string, role: Role): Promise<Viewer> {
  const s = i.scope({ userId, personId: "", bookId, books: [bookId] });
  const household = await s.from("groups").select("id").where("household", "=", 1).executeTakeFirstOrThrow();
  return addMember(i, bookId, userId, userName, household.id, role);
}

/** The user as a member of one book, reading and writing only it; null when they aren't in it. */
export async function viewerIn(i: InstanceDb, userId: string, bookId: string): Promise<Viewer | null> {
  const m = await i.from("members").select("person_id").where("user_id", "=", userId).where("book_id", "=", bookId).executeTakeFirst();
  return m ? { userId, personId: m.person_id, bookId, books: [bookId] } : null;
}

/** The user's viewer: their oldest membership is the book they write to; they read every book they are in. */
export async function viewerOf(i: InstanceDb, userId: string): Promise<Viewer | null> {
  const rows = await i.from("members").select(["book_id", "person_id"]).where("user_id", "=", userId).orderBy("created_at").orderBy("book_id").execute();
  if (!rows.length) return null;
  return { userId, personId: rows[0].person_id, bookId: rows[0].book_id, books: rows.map((r) => r.book_id) };
}

export type BookRef = { id: string; name: string };

const BOOK_NAME_MAX = 60;

/** The user's books, oldest first, with their role and the names of the members. */
export async function listBooks(v: Viewer): Promise<(BookRef & { role: Role; members: string[] })[]> {
  const i = await instance();
  const mine = await i
    .from("members")
    .innerJoin("books", "books.id", "members.book_id")
    .select(["books.id", "books.name", "members.role"])
    .where("members.user_id", "=", v.userId)
    .orderBy("members.created_at")
    .orderBy("books.id")
    .execute();
  if (!mine.length) return [];
  const names = await i
    .from("members")
    .innerJoin("users", "users.id", "members.user_id")
    .select(["members.book_id", "users.name"])
    .where(
      "members.book_id",
      "in",
      mine.map((b) => b.id),
    )
    .orderBy("members.created_at")
    .orderBy("members.user_id")
    .execute();
  return mine.map((b) => ({ id: b.id, name: b.name, role: b.role, members: names.filter((n) => n.book_id === b.id).map((n) => n.name) }));
}

/** A new book of the viewer's, its maker the owner. */
export async function newBook(v: Viewer, name: string): Promise<BookRef> {
  const n = name.trim();
  if (!n) throw new InvalidInputError("A book needs a name");
  if (n.length > BOOK_NAME_MAX) throw new InvalidInputError(`A book's name has at most ${BOOK_NAME_MAX} characters`);
  if ((await listBooks(v)).some((b) => norm(b.name) === norm(n))) throw new InvalidInputError(`There is already a book called ${n}`);
  return (await instance()).transaction(async (i) => {
    const user = await i.from("users").select("name").where("id", "=", v.userId).executeTakeFirstOrThrow();
    const made = await createBook(i, v.userId, user.name, n);
    return { id: made.bookId, name: n };
  });
}

const named = (books: readonly BookRef[]) => books.map((b) => b.name).join(", ");

/** The viewer in one of their books, by id or name; without one, their only book. */
export async function inBook(v: Viewer, book?: string): Promise<Viewer> {
  const books = await listBooks(v);
  const pick = book === undefined ? (books.length === 1 ? books[0] : undefined) : books.find((b) => b.id === book || norm(b.name) === norm(book));
  if (!pick && book === undefined) throw new InvalidInputError(`Say which book: ${named(books)}`);
  if (!pick) throw new NotFoundError(`No book called ${book}; the books are ${named(books)}`);
  return (await viewerIn(await instance(), v.userId, pick.id))!;
}

/** The viewer narrowed to the one book all `ids` are in ("me" and "us" aside); null when no id is left. */
export async function inBookOf(v: Viewer, ids: readonly (string | undefined | null)[]): Promise<Viewer | null> {
  const wanted = [...new Set(ids.filter((id): id is string => typeof id === "string" && !!id && !isHouseholdWord(id)))];
  if (!wanted.length) return null;
  const s = await scope(v);
  const found = new Map<string, string>();
  for (const table of KEYED_TABLES) {
    const rows = await s.from(table).select(["id", "book_id"]).where("id", "in", wanted).execute();
    for (const r of rows) found.set(r.id, r.book_id);
  }
  const missing = wanted.find((id) => !found.has(id));
  if (missing) throw new NotFoundError(`Nothing with the id ${missing}`);
  const books = [...new Set(found.values())];
  if (books.length > 1) {
    const refs = await Promise.all(books.map(bookRef));
    throw new InvalidInputError(`These are in different books (${named(refs)}); one call works in one book: move one of them first`);
  }
  return viewerIn(s.instance, v.userId, books[0]);
}

export async function bookRef(bookId: string): Promise<BookRef> {
  return (await instance()).from("books").select(["id", "name"]).where("id", "=", bookId).executeTakeFirstOrThrow();
}
