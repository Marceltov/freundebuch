// Why a sign-in failed, for the operator: the browser only ever sees "Die Anmeldung hat nicht geklappt". One `warn` line on
// the `oidc` logger per failure: msg is a fixed reason, the detail its fields. Callers pass only variable names, issuer URLs,
// HTTP statuses and short error codes: never a secret, code, token, state, nonce, verifier, cookie, address, name, sub or
// other claim value. The logger caps and cleans string values, so a value can't fake another line.
import { AuthError } from "../core/errors";
import { logger } from "../core/log";

type Detail = Record<string, string | number>;

export const log = logger("oidc");

// Never throws: a failing log must not change what the browser sees or what counts as a failed sign-in.
export function logFailure(reason: string, detail: Detail = {}): void {
  try {
    log.warn(detail, reason);
  } catch {}
}

// A URL as logged: without userinfo, query or fragment (they may carry credentials), or a placeholder if it isn't one.
export function logUrl(v: unknown): string {
  if (typeof v !== "string" || !URL.canParse(v)) return typeof v === "string" ? "(not a URL)" : typeof v;
  return v.replace(/[?#].*$/s, "").replace(/^([a-z][a-z\d+.-]*:\/\/)[^/]*@/i, "$1");
}

// Logs why, then refuses with the plain AuthError the routes word.
export function fail(reason: string, detail?: Detail): never {
  logFailure(reason, detail);
  throw new AuthError("Sign-in failed");
}

// A provider's error code (`invalid_client`, `access_denied`) when it is one; anything longer is left out.
export const errorCode = (v: unknown): Detail => (typeof v === "string" && /^[\w.-]{1,64}$/.test(v) ? { error: v } : {});
