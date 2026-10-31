// Runs once when the server starts, before it takes a request. The database is opened and migrated first: a failure stops the
// start, so a server never runs half-migrated. The reminders and the reading of shared files only make sense in the long-running
// Node server, not at build time or in the edge runtime.
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { openDatabase, startScheduler, resumeReading, log } = await import("./backend/server");
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
