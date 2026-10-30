// The databases: one SQLite file per household (ADR 0022), each opened and migrated on first use and kept open. A household's
// file holds its whole book, so no query can reach another household's. "home" is the instance's first household, in the file
// a single-household instance always had (freundebuch.db); every other is households/<id>.db. Tests swap in in-memory ones.
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import type { Kysely } from "kysely";
import { config } from "../config";
import { processState } from "../state";
import { connect } from "./connect";
import { migrate } from "./migrations";
import type { Schema } from "./schema";

export type { Schema } from "./schema";

/** Whose book: a household id. A Viewer is one, so `db(v)` opens the viewer's book. */
export type Book = { householdId: string };

/** The household of a single-household instance, and the first of any instance. */
export const HOME = "home";
const HOUSEHOLD_ID = /^(home|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/;
export const isHouseholdId = (id: unknown): id is string => typeof id === "string" && HOUSEHOLD_ID.test(id);

const state = processState("db", () => ({ books: new Map<string, Promise<Kysely<Schema>>>(), memory: false }));

async function open(file: string): Promise<Kysely<Schema>> {
  const d = await connect(file);
  try {
    await migrate(d);
  } catch (e) {
    await d.destroy();
    throw e;
  }
  return d;
}

/** Where a household's book is kept. The id is checked, so it can never name a path of its own. */
export function bookFile(householdId: string): string {
  if (!isHouseholdId(householdId)) throw new Error("not a household id");
  return householdId === HOME ? join(config.dataDir(), "freundebuch.db") : join(config.dataDir(), "households", `${householdId}.db`);
}

/** The household's database; the first call opens its file and migrates it. A failed open is not remembered, so the next call retries. */
export function db(book: Book): Promise<Kysely<Schema>> {
  const id = book.householdId;
  let p = state.books.get(id);
  if (!p) {
    const file = bookFile(id);
    p = open(state.memory ? ":memory:" : file);
    state.books.set(id, p);
    const opened = p;
    opened.catch(() => {
      if (state.books.get(id) === opened) state.books.delete(id);
    });
  }
  return p;
}

/** The households whose book is open in this process. */
export const openBooks = (): string[] => [...state.books.keys()];

export const newId = (): string => randomUUID();
export const now = (): number => Date.now();

/** Test only: every household's database replaced by a fresh, migrated, in-memory one on first use. */
export async function resetDbForTests(): Promise<void> {
  const old = [...state.books.values()];
  state.books.clear();
  state.memory = true;
  await db({ householdId: HOME });
  for (const d of old) await (await d.catch(() => undefined))?.destroy();
}

/** Test only: the home household's database, where the seeded users live. */
export const testDb = (): Promise<Kysely<Schema>> => db({ householdId: HOME });
