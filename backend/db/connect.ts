// Opens the SQLite file ${DATA_DIR}/freundebuch.db (or an in-memory database for tests). The driver is imported here, on first use.
import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { Kysely, SqliteDialect } from "kysely";
import type { Schema } from "./schema";

export async function connect(file: string): Promise<Kysely<Schema>> {
  const { default: Database } = await import("better-sqlite3");
  if (file !== ":memory:") await mkdir(/*turbopackIgnore: true*/ dirname(file), { recursive: true });
  const database = new Database(file);
  database.pragma("journal_mode = WAL");
  database.pragma("foreign_keys = ON"); // the cascades that delete a person's items
  return new Kysely<Schema>({ dialect: new SqliteDialect({ database }) });
}
