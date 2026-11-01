import { beforeEach, expect, test } from "vitest";
import { resetDbForTests } from "../db/testing";
import { instance, scope } from "../db/scope";
import { userFromOidc, viewerById } from "../core/users";
import { householdPersons } from "./household";
import { createBook, viewerIn, viewerOf } from "./books";

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
  const b = await userFromOidc({ sub: "b", name: "Bob" });
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
  const b = await userFromOidc({ sub: "b", name: "Bob" });
  const roles = await (await instance()).from("members").select(["user_id", "role"]).where("book_id", "=", a.bookId).orderBy("created_at").execute();
  expect(roles).toEqual([
    { user_id: a.userId, role: "owner" },
    { user_id: b.userId, role: "admin" },
  ]);
});
