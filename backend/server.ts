// What the server runs at start (instrumentation.ts), apart from the pages and routes that import backend/index.ts. The database
// is opened and migrated first: a failure stops the start, so a server never runs half-migrated.
import { openDatabase } from "./db";
import { startScheduler } from "./notify/daily";
import { resumeReading } from "./conversations/files";
import { log } from "./core/log";

export async function start(): Promise<void> {
  try {
    await openDatabase();
  } catch (err) {
    log.fatal({ err }, "the database could not be opened or migrated; not starting");
    process.exit(1);
  }
  startScheduler();
  // Shared files a restart interrupted are read again.
  void resumeReading();
}
