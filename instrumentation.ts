// Runs once when the server starts, before it takes a request. The reminders and the reading of shared files only make sense in
// the long-running Node server, not at build time or in the edge runtime; the import stays in the Node branch, so the edge bundle
// never sees it (Next's guide on instrumentation).
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") await (await import("./backend/server")).start();
}
