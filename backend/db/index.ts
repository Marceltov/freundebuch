// The database: one Kysely per process, opened and migrated on first use. Tests swap in a fresh in-memory one.
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import type { Kysely } from "kysely";
import { config } from "../core/config";
import { processState } from "../core/state";
import { connect } from "./connect";
import { migrate } from "./migrations";
import type { Schema } from "./schema";

export type { Schema } from "./schema";

const state = processState("db", () => ({ db: undefined as Promise<Kysely<Schema>> | undefined }));

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
export const now = (): number => Date.now();

/** Test only: replaces the database with a fresh, migrated, in-memory one. */
export async function resetDbForTests(): Promise<void> {
  const old = state.db;
  state.db = open(":memory:");
  await state.db;
  if (old) await (await old.catch(() => undefined))?.destroy();
}
