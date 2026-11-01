import { beforeEach, describe, expect, test } from "vitest";
import { resetDbForTests } from "../db/testing";
import { instance, scope } from "../db/scope";
import { userFromOidc, viewerById } from "../core/users";
import { householdPersons } from "./household";
import { createBook, inBook, inBookOf, listBooks, newBook, viewerIn, viewerOf } from "./books";
import { InvalidInputError, NotFoundError } from "../core/errors";
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
      { id: s.a.bookId, name: "Unser Buch", role: "owner", members: ["Alice", "Bob"] },
      { id: w.work.bookId, name: "Arbeit", role: "owner", members: ["Alice"] },
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
