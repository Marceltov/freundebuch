// Runs once when the server starts. The reminders and the screenshot reading only make sense in the long-running Node server, not at build time or in the edge runtime.
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  (await import("./backend/notify/daily")).startScheduler();
  // Screenshots a restart interrupted are read again.
  void (await import("./backend/screenshots")).resumeReading();
}
