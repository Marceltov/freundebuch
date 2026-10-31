// The layer is ready for Postgres: the baseline and scoped queries compile with Kysely's Postgres compiler (no driver needed).
import { DummyDriver, Kysely, PostgresAdapter, PostgresIntrospector, PostgresQueryCompiler } from "kysely";
import { expect, test } from "vitest";
import { MIGRATIONS } from "./migrations";
import { scopeWith } from "./scope";
import type { Schema } from "./schema";

const postgres = (statements: string[]) =>
  new Kysely<Schema>({
    dialect: {
      createAdapter: () => new PostgresAdapter(),
      createDriver: () => new DummyDriver(),
      createIntrospector: (d) => new PostgresIntrospector(d),
      createQueryCompiler: () => new PostgresQueryCompiler(),
    },
    log: (e) => void statements.push(e.query.sql),
  });

test("the baseline compiles for Postgres, every key pointing within the book", async () => {
  const statements: string[] = [];
  for (const m of Object.values(MIGRATIONS)) await m.up(postgres(statements));
  expect(statements.length).toBeGreaterThan(30);
  expect(statements.join("\n")).toContain(`foreign key ("book_id", "person_id") references "persons" ("book_id", "id") on delete cascade`);
  expect(statements.join("\n")).not.toMatch(/rowid|autoincrement/i);
});

test("scoped queries compile for Postgres", async () => {
  const s = scopeWith(postgres([]), { userId: "u", personId: "p", bookId: "b", books: ["b", "c"] });
  expect(s.from("persons as p").select("p.id").compile().sql).toBe(`select "p"."id" from "persons" as "p" where "p"."book_id" in ($1, $2)`);
  expect(s.insert("persons", { id: "x", name: "Anna", created_by: "u", created_at: 1 }).compile().parameters).toContain("b");
  expect(s.update("persons").set({ name: "A" }).compile().sql).toContain(`"persons"."book_id" in`);
  expect(s.delete("persons").compile().sql).toContain(`"persons"."book_id" in`);
});
