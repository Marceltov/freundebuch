// What tests share: fresh in-memory databases (every book and the instance) per test file's `beforeEach`.
import { resetInstanceForTests } from "../instance";
import { resetDbForTests as resetBooks } from "./index";

export { db, HOME, newId, now, testDb } from "./index";

export async function resetDbForTests(): Promise<void> {
  await resetInstanceForTests();
  await resetBooks();
}
