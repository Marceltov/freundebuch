// Runs once when the server starts. The reminders only make sense in the long-running Node server, not at build time or in the edge runtime.
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") (await import("./backend/notify/daily")).startScheduler();
}
