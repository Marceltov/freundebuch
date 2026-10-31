import { beforeEach, expect, test } from "vitest";
import { sql } from "kysely";
import { db, resetDbForTests } from "./index";
import { instance, scope } from "./scope";
import type { Viewer } from "../core/types";

const v: Viewer = { userId: "u", personId: "p", bookId: "b", books: ["b"] };
beforeEach(resetDbForTests);

test("a query on a book table outside the scope fails in tests", async () => {
  await expect((await db()).selectFrom("persons").selectAll().execute()).rejects.toThrow("unscoped query on persons");
  await expect((await db()).updateTable("facts").set({ text: "x" }).execute()).rejects.toThrow("unscoped query on facts");
  await expect((await db()).deleteFrom("rambles as r").execute()).rejects.toThrow("unscoped query on rambles");
});

test("a subquery on a book table needs the scope too", async () => {
  const s = await scope(v);
  const d = await db();
  // Kysely runs the plugin on a subquery as it is built, so it throws there.
  await expect(async () => s.from("persons").where("id", "in", d.selectFrom("facts").select("person_id")).selectAll().execute()).rejects.toThrow(
    "unscoped query on facts",
  );
  await expect(s.from("persons").where("id", "in", s.from("facts").select("person_id")).selectAll().execute()).resolves.toEqual([]);
});

test("raw SQL on a book table fails; select 1 and instance tables pass", async () => {
  await expect(sql`select * from persons`.execute(await db())).rejects.toThrow("unscoped query on persons");
  await expect((await instance()).ping()).resolves.toBeUndefined();
  await expect((await instance()).from("users").selectAll().execute()).resolves.toEqual([]);
});
