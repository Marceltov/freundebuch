// The per-IP limit on failed sign-ins (the OIDC callback). In-memory, fixed one-minute windows.
import { config } from "./config";
import { logger } from "./log";
import { processState } from "./state";

const WINDOW = 60_000;
type Hits = Map<string, { start: number; count: number }>;
const state = processState("limits", () => ({ failures: new Map() as Hits, lastPrune: -Infinity }));
const { failures } = state;
const log = logger("limits");

// Next 16 has no request.ip, and base-server only fills x-forwarded-for from the socket when the
// client did not send one (`??=`), so the header is spoofable. Trust it only behind a proxy, and
// take the last entry: the address the proxy saw (an appending proxy keeps the client's own values in front).
// ponytail: without a proxy everyone shares one bucket; set FREUNDEBUCH_TRUST_PROXY=1 behind one for per-IP limits.
export function clientIp(headers: Headers): string {
  if (!config.trustProxy()) return "direct";
  return headers.get("x-forwarded-for")?.split(",").at(-1)?.trim() || "direct";
}

// Seconds to wait if `key` is over the limit, else null; `count` records this call.
function check(hits: Hits, key: string, now: number, count: boolean): number | null {
  const max = config.rateLimit();
  if (max <= 0) return null;
  // Prune at most once per window, only to free memory; an expired entry is ignored below either way.
  if (now - state.lastPrune >= WINDOW) {
    state.lastPrune = now;
    for (const [k, v] of hits) if (now - v.start >= WINDOW) hits.delete(k);
  }
  const found = hits.get(key);
  const e = found && now - found.start < WINDOW ? found : undefined; // set() below replaces an expired one
  if (e && e.count >= max) {
    log.debug({ kind: "sign-in" }, "rate limit reached"); // never the IP
    return Math.max(1, Math.ceil((e.start + WINDOW - now) / 1000));
  }
  if (count) {
    if (e) e.count++;
    else hits.set(key, { start: now, count: 1 });
  }
  return null;
}

// Failed sign-ins: check before doing anything, count only failures. Seconds to wait, or null if allowed.
export const authWait = (ip: string, now = Date.now()) => check(failures, ip, now, false);
export const authFailed = (ip: string, now = Date.now()) => void check(failures, ip, now, true);

export const resetRateLimitsForTests = () => {
  failures.clear();
  state.lastPrune = -Infinity;
};
