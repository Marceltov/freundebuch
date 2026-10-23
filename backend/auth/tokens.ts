// Stateless signed values: the OAuth tokens, the fb_identity sign-in cookie and the cookie of a sign-in in flight.
// base64url(JSON payload) "." base64url(HMAC-SHA256). The key is derived from the server secret, so rotating
// FREUNDEBUCH_SECRET invalidates every token and cookie signed here (ADR 0003).
import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { secret } from "../secret";
import { processState } from "../state";

// `uid` is the signed-in user's id. `until` (epoch seconds) is when that sign-in ends: the refresh chain it starts stops there.
export type Kind = "client" | "code" | "access" | "refresh" | "identity" | "oidc";
export type Payloads = {
  client: { client_name?: string; redirect_uris: string[] };
  code: { cid: string; redirect_uri: string; code_challenge: string; resource: string; jti: string; uid: string; until: number };
  access: { aud: string; uid: string };
  refresh: { cid: string; aud: string; jti: string; uid: string; until: number };
  identity: { uid: string }; // the fb_identity session cookie
  oidc: { state: string; nonce: string; verifier: string; next?: string; authorize?: Record<string, string> }; // a sign-in in flight
};
export const TTL = { code: 300, access: 3600, refresh: 2592000, identity: 604800, oidc: 600 } as const;

// Derived per call: secret() is cached, and tests rotate it. The label keeps this key apart from any other use of the secret.
const key = (): Buffer => createHmac("sha256", secret()).update("freundebuch-oauth-v1").digest();

const mac = (body: string) => createHmac("sha256", key()).update(body).digest();

export function sign<K extends Kind>(t: K, p: Payloads[K], now = Date.now()): string {
  const claims = t === "client" ? { ...p, t } : { ...p, t, exp: Math.floor(now / 1000) + TTL[t as Exclude<Kind, "client">] };
  const body = Buffer.from(JSON.stringify(claims)).toString("base64url");
  return `${body}.${mac(body).toString("base64url")}`;
}

export function verify<K extends Kind>(t: K, token: string, now = Date.now()): (Payloads[K] & { exp?: number }) | null {
  const parts = token.split(".");
  if (parts.length !== 2) return null;
  const [body, sig] = parts;
  const want = mac(body);
  const got = Buffer.from(sig, "base64url");
  // The round trip rejects non-canonical encodings (the last char of a 32-byte MAC has spare bits).
  if (got.length !== want.length || got.toString("base64url") !== sig || !timingSafeEqual(got, want)) return null;
  // Only a token we signed gets parsed and its claims trusted.
  let claims: { t?: unknown; exp?: unknown };
  try {
    claims = JSON.parse(Buffer.from(body, "base64url").toString());
  } catch {
    return null;
  }
  if (!claims || typeof claims !== "object" || claims.t !== t) return null;
  if (t !== "client" && !(typeof claims.exp === "number" && now <= claims.exp * 1000)) return null;
  return claims as Payloads[K] & { exp?: number };
}

export const cid = (clientId: string): string => createHash("sha256").update(clientId).digest("base64url").slice(0, 22);

export const newJti = (): string => randomBytes(16).toString("base64url");

// ponytail: used code/refresh jti are kept in memory; after a restart one could be replayed once within its lifetime. Persist them in DATA_DIR if that matters.
const state = processState("oauth-used", () => ({ used: new Map<string, number>() }));

// True the first time a jti is seen; `exp` is in seconds, and an expired entry is dropped (its token no longer verifies).
export function spendOnce(jti: string, exp: number, now = Date.now()): boolean {
  for (const [j, e] of state.used) if (e * 1000 < now) state.used.delete(j);
  if (state.used.has(jti)) return false;
  state.used.set(jti, exp);
  return true;
}

export const resetTokensForTests = (): void => state.used.clear();
