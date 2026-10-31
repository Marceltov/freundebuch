import { beforeEach, expect, test } from "vitest";
import { instance, scope, systemScope } from "./scope";
import { resetDbForTests } from "./index";
import type { Viewer } from "../core/types";

const v1: Viewer = { userId: "u1", personId: "p1", bookId: "b1", books: ["b1"] };
const v2: Viewer = { userId: "u2", personId: "p2", bookId: "b2", books: ["b2"] };

beforeEach(async () => {
  await resetDbForTests();
  const i = await instance();
  await i
    .insert("users", [
      { id: "u1", oidc_sub: "u1", name: "Alice", created_at: 1 },
      { id: "u2", oidc_sub: "u2", name: "Carol", created_at: 2 },
    ])
    .execute();
  await i
    .insert("books", [
      { id: "b1", name: "Unser Buch", created_by: "u1", created_at: 1 },
      { id: "b2", name: "Carols Buch", created_by: "u2", created_at: 2 },
    ])
    .execute();
  await (await scope(v1)).insert("persons", { id: "p1", name: "Alice", created_by: "u1", created_at: 1 }).execute();
  await (await scope(v2)).insert("persons", { id: "p2", name: "Carol", created_by: "u2", created_at: 2 }).execute();
});

test("from only sees the scope's books", async () => {
  const rows = await (await scope(v1)).from("persons").select("id").execute();
  expect(rows).toEqual([{ id: "p1" }]);
});

test("from filters an aliased table on its alias", async () => {
  const rows = await (await scope(v2)).from("persons as p").select("p.id").execute();
  expect(rows).toEqual([{ id: "p2" }]);
});

test("insert stores the scope's book", async () => {
  const i = await instance();
  expect(await i.from("books").select("id").orderBy("id").execute()).toHaveLength(2);
  const s = await systemScope("b2");
  expect(await s.from("persons").select(["id", "book_id"]).execute()).toEqual([{ id: "p2", book_id: "b2" }]);
});

test("update and delete can't reach another book's rows", async () => {
  const s = await scope(v1);
  const updated = await s.update("persons").set({ name: "Mallory" }).where("id", "=", "p2").executeTakeFirst();
  const deleted = await s.delete("persons").where("id", "=", "p2").executeTakeFirst();
  expect([updated.numUpdatedRows, deleted.numDeletedRows]).toEqual([0n, 0n]);
  expect(await (await scope(v2)).from("persons").select("name").executeTakeFirst()).toEqual({ name: "Carol" });
});

test("a transaction rolls back every write when it throws", async () => {
  const s = await scope(v1);
  await expect(
    s.transaction(async (t) => {
      await t.insert("persons", { id: "p3", name: "Anna", created_by: "u1", created_at: 3 }).execute();
      await t.update("persons").set({ name: "Al" }).where("id", "=", "p1").execute();
      throw new Error("stop");
    }),
  ).rejects.toThrow("stop");
  expect(await s.from("persons").select(["id", "name"]).execute()).toEqual([{ id: "p1", name: "Alice" }]);
});

test("an instance transaction can write a book through a scope on the same connection", async () => {
  await (
    await instance()
  ).transaction(async (i) => {
    await i.insert("members", { book_id: "b1", user_id: "u1", person_id: "p1", created_at: 1 }).execute();
    await i.scope(v1).insert("persons", { id: "p4", name: "Tom", created_by: "u1", created_at: 4 }).execute();
  });
  expect(await (await scope(v1)).from("persons").select("id").orderBy("id").execute()).toEqual([{ id: "p1" }, { id: "p4" }]);
});
