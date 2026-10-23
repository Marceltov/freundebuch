// GET /health: is this instance able to answer? The database is asked once, by a trivial query. 200 `{"status":"ok"}` when it
// answers, 503 `{"status":"unavailable"}` when not; nothing of the error is in the answer (it is logged). Open and without a
// switch: it says nothing but that, and a probe (Docker, a monitor) has no credential.
import { logger } from "../log";

const log = logger("health");

export type DbProbe = () => unknown | Promise<unknown>;

// Task 2 wires this to the database (`db()`); until then nothing can be down.
let probe: DbProbe = () => undefined;

/** Sets what asks the database whether it answers; it throws or rejects when it does not. */
export const setDbProbe = (p: DbProbe): void => {
  probe = p;
};

export async function healthRoute(): Promise<Response> {
  let ok = true;
  try {
    await probe();
  } catch (e) {
    ok = false;
    log.error({ err: e }, "database check failed");
  }
  return Response.json({ status: ok ? "ok" : "unavailable" }, { status: ok ? 200 : 503, headers: { "Cache-Control": "no-store" } });
}
