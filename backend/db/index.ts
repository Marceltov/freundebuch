// The database: one Kysely per process, opened and migrated on first use. Tests swap in a fresh in-memory one.
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import type { Kysely } from "kysely";
import { config } from "../core/config";
import { processState } from "../core/state";
import { connect } from "./connect";
import { BookCheck } from "./check";
import { migrate } from "./migrations";
import type { Schema } from "./schema";

export type { Schema } from "./schema";
/** Raw SQL fragments for expressions inside a scoped query; a whole raw query goes through backend/db. */
export { sql } from "kysely";

const state = processState("db", () => ({ db: undefined as Promise<Kysely<Schema>> | undefined, raw: undefined as Kysely<Schema> | undefined }));

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

/** The database; the first call opens `${DATA_DIR}/freundebuch.db` and migrates it. A failed open is not remembered, so the next call retries. */
export function db(): Promise<Kysely<Schema>> {
  if (!state.db) {
    const p = open(join(config.dataDir(), "freundebuch.db"));
    state.db = p;
    p.catch(() => {
      if (state.db === p) state.db = undefined;
    });
  }
  return state.db;
}

export const newId = (): string => randomUUID();
// Strictly increasing within the process, so rows created in one go still order by `created_at, id` (no rowid).
let last = 0;
export const now = (): number => (last = Math.max(Date.now(), last + 1));

/** Test only: replaces the database with a fresh, migrated, in-memory one, every query checked for its book (check.ts). */
export async function resetDbForTests(): Promise<void> {
  const old = state.raw;
  const raw = await open(":memory:");
  state.raw = raw;
  state.db = Promise.resolve(raw.withPlugin(new BookCheck()));
  await old?.destroy();
}

/** Test only: the test database without the book check, for a test that plants or inspects rows by hand. */
export function unchecked(): Kysely<Schema> {
  if (!state.raw) throw new Error("resetDbForTests() first");
  return state.raw;
}
