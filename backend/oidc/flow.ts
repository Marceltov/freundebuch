// The OIDC relying party: discovery, the authorize URL (code + PKCE S256, state, nonce), and the code
// exchange with the id_token's claims checked. Every failure logs why (log.ts) and is an AuthError; the routes word it.
import { redirectUriOk } from "../oauth/routes";
import { processState } from "../state";
import { allowed, nameFrom, type Provider } from "./config";
import { errorCode, fail, logUrl } from "./log";

export type Meta = { issuer: string; authorization_endpoint: string; token_endpoint: string };
type Fetch = typeof fetch;

const HOUR = 3_600_000;
// Per issuer, so a changed FREUNDEBUCH_OIDC_ISSUER is discovered afresh.
const cache = processState("oidc-discovery", () => new Map<string, { at: number; meta: Meta }>());
export const resetDiscoveryForTests = (): void => cache.clear();

// Issuers compare exactly (OIDC Discovery 4.3, Core 3.1.3.7) except for one trailing slash, which operators get wrong
// and which names the same provider: `https://x/a` and `https://x/a/` match, `https://x/a//` does not. authentik's
// issuer ends in a slash.
const bare = (issuer: string) => issuer.replace(/\/$/, "");
const sameIssuer = (a: unknown, b: string) => typeof a === "string" && bare(a) === bare(b);

const isObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);

// The network error's code (ENOTFOUND, ECONNREFUSED, CERT_HAS_EXPIRED) when undici gives one, else its name.
function netError(e: unknown): string {
  const code = (e as { cause?: { code?: unknown } } | null)?.cause?.code;
  return typeof code === "string" ? code : e instanceof Error ? e.name : "unknown";
}

// The JSON object a provider answers with; anything else (unreachable, non-2xx, not JSON, not an object) fails as
// `reason`, with the status and the provider's short error code (never its error_description).
async function getJson(fetchFn: Fetch, url: string, init: RequestInit, reason: string): Promise<Record<string, unknown>> {
  let res: Response;
  let body: unknown;
  try {
    res = await fetchFn(url, { ...init, redirect: "error", signal: AbortSignal.timeout(10_000) });
    body = await res.json().catch(() => undefined);
  } catch (e) {
    return fail(reason, { error: netError(e) });
  }
  if (!res.ok) return fail(reason, { status: res.status, ...(isObject(body) ? errorCode(body.error) : {}) });
  if (!isObject(body)) return fail(reason, { status: res.status, error: "not a JSON object" });
  return body;
}

export async function discover(provider: Provider, fetchFn: Fetch = fetch, now = Date.now()): Promise<Meta> {
  const { issuer } = provider;
  const key = bare(issuer);
  const hit = cache.get(key);
  if (hit && now - hit.at < HOUR) return hit.meta;
  // TLS to the provider is what lets exchange skip the id_token's signature: https, or plain http on loopback only.
  if (!redirectUriOk(issuer)) fail("issuer is not an https URL", { issuer: logUrl(issuer) });
  const doc = await getJson(fetchFn, `${key}/.well-known/openid-configuration`, { headers: { accept: "application/json" } }, "discovery failed");
  // A document naming another issuer is not this provider's.
  if (!sameIssuer(doc.issuer, issuer)) fail("issuer does not match the discovery document", { issuer: logUrl(issuer), document: logUrl(doc.issuer) });
  const { authorization_endpoint, token_endpoint } = doc;
  if (!redirectUriOk(authorization_endpoint)) fail("discovery endpoint is not https", { endpoint: "authorization_endpoint" });
  if (!redirectUriOk(token_endpoint)) fail("discovery endpoint is not https", { endpoint: "token_endpoint" });
  const meta = { issuer, authorization_endpoint, token_endpoint };
  cache.set(key, { at: now, meta });
  return meta;
}

export function authorizeUrl(provider: Provider, meta: Meta, p: { redirectUri: string; state: string; nonce: string; challenge: string }): string {
  const u = new URL(meta.authorization_endpoint);
  const q = {
    response_type: "code",
    client_id: provider.clientId,
    redirect_uri: p.redirectUri,
    scope: "openid profile email",
    state: p.state,
    nonce: p.nonce,
    code_challenge: p.challenge,
    code_challenge_method: "S256",
  };
  for (const [k, v] of Object.entries(q)) u.searchParams.set(k, v);
  return u.href;
}

// The id_token's payload, unverified: see the ponytail note in exchange.
function payload(idToken: unknown): Record<string, unknown> {
  if (typeof idToken !== "string") fail("token response has no id_token");
  const parts = idToken.split(".");
  let c: unknown;
  try {
    if (parts.length === 3) c = JSON.parse(Buffer.from(parts[1], "base64url").toString());
  } catch {}
  return isObject(c) ? c : fail("id_token invalid", { check: "malformed" });
}

const str = (v: unknown) => (typeof v === "string" ? v : undefined);

export type Person = { sub: string; name: string; email?: string };

// OIDC Core 3.1.3.7: issuer, audience (azp whenever there are several, or one is given), expiry, nonce; then the subject,
// the allow-list and a name to show.
function check(provider: Provider, c: Record<string, unknown>, meta: Meta, nonce: string, now: number): Person {
  const { clientId } = provider;
  const aud = Array.isArray(c.aud) ? c.aud : [c.aud];
  const invalid = (check: string) => fail("id_token invalid", { check });
  if (!sameIssuer(c.iss, meta.issuer)) invalid("iss");
  if (!aud.includes(clientId)) invalid("aud");
  // With several audiences azp must name this client; a single one may leave it out.
  if ((aud.length !== 1 || c.azp !== undefined) && c.azp !== clientId) invalid("azp");
  if (typeof c.exp !== "number" || c.exp * 1000 <= now) invalid("exp");
  if (c.nonce !== nonce) invalid("nonce");
  const sub = str(c.sub);
  if (!sub) return invalid("sub"); // the user is keyed on it
  const email = str(c.email);
  // Which rule refused, never the address.
  if (!allowed(provider, { email, email_verified: c.email_verified === true }))
    fail(email && c.email_verified === true ? "person not on the allow-list" : "address needs a verified email");
  const name = nameFrom(c) ?? fail("no name claim in the id_token");
  return email === undefined ? { sub, name } : { sub, name, email };
}

export async function exchange(
  provider: Provider,
  meta: Meta,
  p: { code: string; redirectUri: string; verifier: string; nonce: string },
  fetchFn: Fetch = fetch,
  now = Date.now(),
): Promise<Person> {
  const { clientId, clientSecret } = provider;
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code: p.code,
    redirect_uri: p.redirectUri,
    code_verifier: p.verifier,
    client_id: clientId,
    client_secret: clientSecret,
  });
  const res = await getJson(
    fetchFn,
    meta.token_endpoint,
    { method: "POST", headers: { accept: "application/json", "content-type": "application/x-www-form-urlencoded" }, body },
    "token request rejected",
  );
  // ponytail: the id_token's signature is not verified. It came straight from the token endpoint over TLS,
  // which OIDC Core 3.1.3.7 lets stand in for it. Verify against the provider's JWKS if tokens ever arrive another way.
  return check(provider, payload(res.id_token), meta, p.nonce, now);
}
