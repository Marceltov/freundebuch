// What tests share: a fresh in-memory database per test file's `beforeEach`, and ways to plant or inspect rows by hand.
import { systemScope, type Scope } from "./scope";
import { unchecked } from "./index";

export { db, newId, now, resetDbForTests, unchecked } from "./index";

/** A scope on the instance's first book (the household seed's), for planting rows by hand; its inserts carry the book. */
export async function firstBook(): Promise<Scope> {
  const b = await unchecked().selectFrom("books").select("id").orderBy("created_at").executeTakeFirstOrThrow();
  return systemScope(b.id);
}
