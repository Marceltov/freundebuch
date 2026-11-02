import { beforeEach, describe, expect, test } from "vitest";
import { resetDbForTests, unchecked } from "../db/testing";
import { instance, scope } from "../db/scope";
import { userFromOidc, viewerById } from "../core/users";
import { householdPersons } from "./household";
import { createBook, inBook, inBookOf, listBooks, newBook, viewerIn, viewerOf } from "./books";
import { deleteBook, handOver, leaveBook, removeMember, renameBook, setRole } from "./manage";
import { getPerson } from "./people";
import type { Viewer } from "../core/types";
import { ForbiddenError, InvalidInputError, NotFoundError } from "../core/errors";
import { seed, seedOtherBook, seedWorkBook, type Seed, signInInvited } from "../testing/fixtures";

beforeEach(resetDbForTests);

test("the first sign-in on a fresh instance makes a book with Haushalt and the seeded groups", async () => {
  const a = await userFromOidc({ sub: "a", name: "Alice" });
  const books = await (await instance()).from("books").select(["id", "name", "created_by"]).execute();
  expect(books).toEqual([{ id: a.bookId, name: "Unser Buch", created_by: a.userId }]);
  expect(a.books).toEqual([a.bookId]);
  const s = await scope(a);
  const groups = await s.from("groups").select(["name", "seeded", "household"]).orderBy("name").execute();
  expect(groups).toEqual([
    { name: "Arbeit", seeded: 1, household: 0 },
    { name: "Familie", seeded: 1, household: 0 },
    { name: "Freunde", seeded: 1, household: 0 },
    { name: "Haushalt", seeded: 1, household: 1 },
  ]);
  expect(await s.from("group_aliases").select("alias").orderBy("alias").execute()).toHaveLength(4);
  const me = await s.from("persons").select(["id", "name"]).execute();
  expect(me).toEqual([{ id: a.personId, name: "Alice" }]);
  expect(
    await s
      .from("group_members")
      .innerJoin("groups", "groups.id", "group_members.group_id")
      .select("groups.name")
      .where("person_id", "=", a.personId)
      .execute(),
  ).toEqual([{ name: "Haushalt" }]);
});

test("the second user joins the same book and Haushalt; us is both, in sign-in order", async () => {
  const a = await userFromOidc({ sub: "a", name: "Alice" });
  const b = await signInInvited(a, { sub: "b", name: "Bob" });
  expect(b.bookId).toBe(a.bookId);
  expect(b.personId).not.toBe(a.personId);
  expect(await viewerById(b.userId)).toEqual(b);
  expect(await householdPersons(await scope(b))).toEqual([a.personId, b.personId]);
  const household = await (await scope(a)).from("group_members").select("person_id").where("recorded_by", "in", [a.userId, b.userId]).execute();
  expect(household).toHaveLength(2);
});

test("signing in again keeps the book and person; a new sign-in name renames the person unless the book renamed them", async () => {
  const a = await userFromOidc({ sub: "a", name: "Bille" });
  expect(await userFromOidc({ sub: "a", name: "Billie" })).toEqual(a);
  const s = await scope(a);
  expect(await s.from("persons").select("name").where("id", "=", a.personId).executeTakeFirst()).toEqual({ name: "Billie" });
  await s.update("persons").set({ name: "Sybille" }).where("id", "=", a.personId).execute();
  await userFromOidc({ sub: "a", name: "Bille" });
  expect(await s.from("persons").select("name").where("id", "=", a.personId).executeTakeFirst()).toEqual({ name: "Sybille" });
  expect(await s.from("aliases").select("alias").where("person_id", "=", a.personId).execute()).toEqual([{ alias: "Bille" }]);
});

test("a user in no book has no viewer", async () => {
  await (await instance()).insert("users", { id: "x", oidc_sub: "x", name: "X", created_at: 1 }).execute();
  expect(await viewerById("x")).toBeNull();
});

test("a user as a member of one book reads only that book", async () => {
  const a = await userFromOidc({ sub: "a", name: "Alice" });
  const i = await instance();
  const other = await createBook(i, a.userId, "Alice", "Arbeit");
  expect((await viewerOf(i, a.userId))?.books).toEqual([a.bookId, other.bookId]);
  expect(await viewerIn(i, a.userId, other.bookId)).toEqual({ userId: a.userId, personId: other.personId, bookId: other.bookId, books: [other.bookId] });
});

test("createBook makes its maker the owner; who joins through sign-in is an admin", async () => {
  const a = await userFromOidc({ sub: "a", name: "Alice" });
  const b = await signInInvited(a, { sub: "b", name: "Bob" });
  const roles = await (await instance()).from("members").select(["user_id", "role"]).where("book_id", "=", a.bookId).orderBy("created_at").execute();
  expect(roles).toEqual([
    { user_id: a.userId, role: "owner" },
    { user_id: b.userId, role: "admin" },
  ]);
});

describe("books for a viewer", () => {
  let s: Seed;
  let w: Awaited<ReturnType<typeof seedWorkBook>>;
  beforeEach(async () => {
    s = await seed();
    w = await seedWorkBook(s);
  });

  test("listBooks gives the user's books oldest first, with role and members", async () => {
    expect(await listBooks(w.a)).toEqual([
      {
        id: s.a.bookId,
        name: "Unser Buch",
        role: "owner",
        members: [
          { id: s.a.userId, name: "Alice", role: "owner" },
          { id: s.b.userId, name: "Bob", role: "admin" },
        ],
      },
      { id: w.work.bookId, name: "Arbeit", role: "owner", members: [{ id: s.a.userId, name: "Alice", role: "owner" }] },
    ]);
    expect((await listBooks(s.b)).map((b) => [b.name, b.role])).toEqual([["Unser Buch", "admin"]]);
  });

  test("newBook refuses an empty name, and one the user already has", async () => {
    await expect(newBook(w.a, " ")).rejects.toBeInstanceOf(InvalidInputError);
    await expect(newBook(w.a, "x".repeat(61))).rejects.toBeInstanceOf(InvalidInputError);
    await expect(newBook(w.a, " arbeit ")).rejects.toBeInstanceOf(InvalidInputError);
    const made = await newBook(s.b, " Verein ");
    expect(made.name).toBe("Verein");
    expect((await listBooks((await viewerById(s.b.userId))!)).map((b) => b.name)).toEqual(["Unser Buch", "Verein"]);
  });

  test("inBook picks by name or id; without one only when there is one", async () => {
    await expect(inBook(w.a)).rejects.toThrow(/Arbeit/);
    await expect(inBook(w.a)).rejects.toBeInstanceOf(InvalidInputError);
    const byName = await inBook(w.a, "ARBEIT");
    expect(byName).toEqual({ userId: s.a.userId, personId: w.work.personId, bookId: w.work.bookId, books: [w.work.bookId] });
    expect((await inBook(w.a, s.a.bookId)).bookId).toBe(s.a.bookId);
    expect((await inBook(s.b)).bookId).toBe(s.b.bookId);
    await expect(inBook(w.a, "Nope")).rejects.toBeInstanceOf(NotFoundError);
    await expect(inBook(s.b, "Arbeit")).rejects.toBeInstanceOf(NotFoundError);
  });

  test("inBookOf narrows to the book of the ids, and refuses ids from two books", async () => {
    expect(await inBookOf(w.a, [w.boss, "me"])).toEqual({ userId: s.a.userId, personId: w.work.personId, bookId: w.work.bookId, books: [w.work.bookId] });
    await expect(inBookOf(w.a, [w.boss, s.anna])).rejects.toBeInstanceOf(InvalidInputError);
    expect(await inBookOf(w.a, ["me", "us"])).toBeNull();
    expect(await inBookOf(w.a, [])).toBeNull();
    const other = await seedOtherBook();
    await expect(inBookOf(w.a, [other.carl])).rejects.toBeInstanceOf(NotFoundError);
    await expect(inBookOf(s.b, [w.boss])).rejects.toBeInstanceOf(NotFoundError);
    // An item's id finds its book as well as a person's.
    const fact = await (await scope(w.work)).from("facts").select("id").where("person_id", "=", w.boss).executeTakeFirstOrThrow();
    expect((await inBookOf(w.a, [fact.id]))?.bookId).toBe(w.work.bookId);
  });
});

describe("managing a book", () => {
  let s: Seed;
  let w: Awaited<ReturnType<typeof seedWorkBook>>;
  beforeEach(async () => {
    s = await seed();
    w = await seedWorkBook(s);
  });
  const role = async (v: Viewer, userId: string) =>
    (await (await instance()).from("members").select("role").where("book_id", "=", v.bookId).where("user_id", "=", userId).executeTakeFirst())?.role;
  const carol = async () => signInInvited(s.a, { sub: "c", name: "Carol" });
  const asMember = async (userId: string) =>
    (await instance()).update("members").set({ role: "member" }).where("user_id", "=", userId).where("book_id", "=", s.a.bookId).execute();

  test("roles decide who renames, sets roles, removes and deletes", async () => {
    const c = await carol();
    await asMember(c.userId);
    await expect(renameBook(c, "Unseres")).rejects.toBeInstanceOf(ForbiddenError);
    await renameBook(s.b, "Unser Zuhause");
    expect((await listBooks(s.a))[0].name).toBe("Unser Zuhause");
    await expect(setRole(s.b, c.userId, "admin")).rejects.toBeInstanceOf(ForbiddenError);
    await expect(removeMember(s.b, s.a.userId)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(removeMember(c, s.b.userId)).rejects.toBeInstanceOf(ForbiddenError);
    await setRole(s.a, c.userId, "admin");
    await expect(removeMember(s.b, c.userId)).rejects.toBeInstanceOf(ForbiddenError);
    await setRole(s.a, c.userId, "member");
    await removeMember(s.b, c.userId);
    expect(await role(s.a, c.userId)).toBeUndefined();
    await expect(deleteBook(s.b)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(setRole(s.a, s.a.userId, "member")).rejects.toBeInstanceOf(InvalidInputError);
  });

  test("leaving deletes the leaver's private items in that book only", async () => {
    const other = await newBook(s.b, "Bobs Buch");
    const bobs = (await inBook((await viewerById(s.b.userId))!, other.id))!;
    const { remember } = await import("../conversations/conversations");
    await remember(s.b, { visibility: "private", facts: [{ person: s.anna, text: "b private", category: "other" }] });
    await remember(s.b, { visibility: "shared", facts: [{ person: s.anna, text: "b shared", category: "other" }] });
    await remember(s.a, { visibility: "private", facts: [{ person: s.anna, text: "a private", category: "other" }] });
    const { recordConversation } = await import("../conversations/conversations");
    await recordConversation(bobs, {
      date: "2026-10-30",
      kind: "call",
      summary: "x",
      transcript: "x",
      visibility: "private",
      people: [{ name: "Zora", present: true }],
      facts: [{ person: 0, text: "b elsewhere", category: "other" }],
    });
    await leaveBook(s.b);
    const texts = (await unchecked().selectFrom("facts").select("text").execute()).map((f) => f.text);
    expect(texts).not.toContain("b private");
    expect(texts).toEqual(expect.arrayContaining(["b shared", "a private", "b elsewhere"]));
    expect(await role(s.a, s.b.userId)).toBeUndefined();
    // Bob's person stays in the book, as anyone else.
    expect((await getPerson(s.a, s.b.personId)).name).toBe("Bob");
  });

  test("the owner hands over before leaving", async () => {
    await expect(leaveBook(s.a)).rejects.toBeInstanceOf(InvalidInputError);
    await expect(handOver(s.b, s.a.userId)).rejects.toBeInstanceOf(ForbiddenError);
    await handOver(s.a, s.b.userId);
    expect([await role(s.a, s.a.userId), await role(s.a, s.b.userId)]).toEqual(["admin", "owner"]);
    const a = await inBook((await viewerById(s.a.userId))!, s.a.bookId);
    await leaveBook(a);
    expect(await role(s.a, s.a.userId)).toBeUndefined();
  });

  test("deleting a book removes everything in it and nothing else", async () => {
    await deleteBook(w.work);
    expect(await unchecked().selectFrom("books").select("id").where("id", "=", w.work.bookId).execute()).toEqual([]);
    expect(await unchecked().selectFrom("persons").select("id").where("book_id", "=", w.work.bookId).execute()).toEqual([]);
    expect((await getPerson(s.a, s.anna)).name).toBe("Anna");
  });

  test("a user can't leave or delete their only book", async () => {
    await expect(leaveBook(s.b)).rejects.toThrow(/only book/);
    await deleteBook(w.work);
    await expect(deleteBook(await inBook((await viewerById(s.a.userId))!, s.a.bookId))).rejects.toThrow(/only book/);
  });
});

describe("review fixes", () => {
  let s: Seed;
  beforeEach(async () => {
    s = await seed();
  });

  test("an invitation stops working when its maker is removed or no longer an admin", async () => {
    const { invite, invitationFor } = await import("./invitations");
    const c = await signInInvited(s.a, { sub: "c", name: "Carol" });
    const left = await invite(c, "member");
    const kept = await invite(s.b, "member");
    await removeMember(s.a, c.userId);
    expect(await invitationFor(left.url.split("/").pop()!)).toBeNull();
    await setRole(s.a, s.b.userId, "member");
    expect(await invitationFor(kept.url.split("/").pop()!)).toBeNull();
  });

  test("leaving keeps the files the leaver's shared facts show", async () => {
    await unchecked()
      .insertInto("files")
      .values({ id: "f1", book_id: s.a.bookId, user_id: s.b.userId, sha256: "x", status: "filed", reading: null, created_at: 1, blob_key: "k1" })
      .execute();
    const other = await newBook(s.b, "Bobs Buch");
    expect(other.name).toBe("Bobs Buch");
    await leaveBook(await inBook((await viewerById(s.b.userId))!, s.a.bookId));
    expect(await unchecked().selectFrom("files").select("id").where("id", "=", "f1").execute()).toEqual([{ id: "f1" }]);
  });

  test("leaving and deleting touch only the one book, whatever viewer they get", async () => {
    const { remember } = await import("../conversations/conversations");
    const other = await newBook(s.b, "Bobs Buch");
    const bob = (await viewerById(s.b.userId))!;
    const bobs = await inBook(bob, other.id);
    const { recordConversation } = await import("../conversations/conversations");
    await recordConversation(bobs, {
      date: "2026-10-30",
      kind: "call",
      summary: "x",
      transcript: "x",
      visibility: "private",
      people: [{ name: "Zora", present: true }],
      facts: [{ person: 0, text: "b elsewhere", category: "other" }],
    });
    await remember(s.b, { visibility: "private", facts: [{ person: s.anna, text: "b here", category: "other" }] });
    await leaveBook({ ...bob, bookId: s.a.bookId, personId: s.b.personId });
    const texts = (await unchecked().selectFrom("facts").select("text").execute()).map((f) => f.text);
    expect(texts).toContain("b elsewhere");
    expect(texts).not.toContain("b here");
  });

  test("a leaver is out of the book's own group", async () => {
    await newBook(s.b, "Bobs Buch");
    await leaveBook(await inBook((await viewerById(s.b.userId))!, s.a.bookId));
    const haushalt = await unchecked()
      .selectFrom("group_members")
      .innerJoin("groups", "groups.id", "group_members.group_id")
      .select("group_members.person_id")
      .where("groups.household", "=", 1)
      .where("groups.book_id", "=", s.a.bookId)
      .execute();
    expect(haushalt.map((m) => m.person_id)).toEqual([s.a.personId]);
  });

  test("whoever loses their last book by a removal or a deletion gets an empty one of their own", async () => {
    const c = await signInInvited(s.a, { sub: "c", name: "Carol" });
    await setRole(s.a, c.userId, "member");
    await removeMember(s.a, c.userId);
    expect((await listBooks(c)).map((b) => [b.name, b.role])).toEqual([["Mein Buch", "owner"]]);
    expect(await viewerById(c.userId)).not.toBeNull();
    const ours = await newBook(s.a, "Zweites");
    const a = (await viewerById(s.a.userId))!;
    await deleteBook(await inBook(a, s.a.bookId));
    expect((await listBooks(s.b)).map((b) => b.name)).toEqual(["Mein Buch"]);
    expect((await listBooks(s.a)).map((b) => b.id)).toEqual([ours.id]);
  });

  test("a leaver's shared transcripts lose what was private in them", async () => {
    await unchecked()
      .insertInto("rambles")
      .values([
        {
          id: "r1",
          book_id: s.a.bookId,
          date: "2026-10-30",
          transcript: "secret and not",
          transcript_private: 1,
          visibility: "shared",
          recorded_by: s.b.userId,
          created_at: 1,
        },
        {
          id: "r2",
          book_id: s.a.bookId,
          date: "2026-10-30",
          transcript: "all shared",
          transcript_private: 0,
          visibility: "shared",
          recorded_by: s.b.userId,
          created_at: 1,
        },
      ])
      .execute();
    await newBook(s.b, "Bobs Buch");
    await leaveBook(await inBook((await viewerById(s.b.userId))!, s.a.bookId));
    const rows = await unchecked().selectFrom("rambles").select(["id", "transcript"]).where("id", "in", ["r1", "r2"]).orderBy("id").execute();
    expect(rows).toEqual([
      { id: "r1", transcript: "" },
      { id: "r2", transcript: "all shared" },
    ]);
  });
});

describe("the viewer of a page", () => {
  test("a page's id narrows to its book; a household word to the oldest book; none to every book", async () => {
    const { pageScope } = await import("./books");
    const s = await seed();
    const { a, work, lena2 } = await seedWorkBook(s);
    expect((await pageScope(a, lena2)).books).toEqual([work.bookId]);
    expect((await pageScope(a, "me")).books).toEqual([s.a.bookId]);
    expect((await pageScope(a)).books).toEqual(a.books);
  });
});
