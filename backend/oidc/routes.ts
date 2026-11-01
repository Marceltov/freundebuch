// GET /api/oidc/start and GET /api/oidc/callback: sign-in through authentik. What a sign-in in flight needs (state, nonce,
// PKCE verifier, where to go next) rides in a short-lived signed cookie, so nothing is stored. Success creates or updates the
// user (userFromOidc) and sets the identity cookie, or, for an MCP client's authorize request, sends the browser back to that
// client with a code carrying the user.
import { createHash, randomBytes } from "node:crypto";
import { IDENTITY_COOKIE, safeEqual } from "../auth/session";
import { type Payloads, sign, TTL, verify } from "../auth/tokens";
import { AuthError, NotInvitedError } from "../core/errors";
import { cookie, readFields, sameOrigin, seeOther } from "../http/request";
import { authFailed, authWait, clientIp } from "../chat/limits";
import { logger } from "../core/log";
import { checkAuthorize, issueCode } from "../oauth/routes";
import { publicUrl, safeNext } from "../core/urls";
import { userFromOidc } from "../core/users";
import { missingVars, type Provider, provider } from "./config";
import { authorizeUrl, discover, exchange, type Person } from "./flow";
import { errorCode, fail, log } from "./log";

const FLIGHT_COOKIE = "fb_oidc";
const redirectUri = (h: Headers) => `${publicUrl(h)}/api/oidc/callback`;
const random = (bytes: number) => randomBytes(bytes).toString("base64url");

// Secure whenever the public URL is https; the flight cookie only goes to these two routes.
function setCookie(h: Headers, name: string, value: string, maxAge: number, path = "/"): string {
  const secure = publicUrl(h).startsWith("https:") ? "; Secure" : "";
  return `${name}=${value}; Path=${path}; Max-Age=${maxAge}; HttpOnly; SameSite=Lax${secure}`;
}
const flightCookie = (h: Headers, value: string, maxAge: number) => setCookie(h, FLIGHT_COOKIE, value, maxAge, "/api/oidc");

// Where the sign-in started: the MCP client's authorize page, or the login page keeping next.
function failedPage(from: { next?: string; authorize?: Record<string, string> } | null, error: string): string {
  const next = safeNext(from?.next);
  return from?.authorize
    ? `/oauth/authorize?${new URLSearchParams(from.authorize)}&error=${error}`
    : `/login?error=${error}${next === "/" ? "" : `&next=${encodeURIComponent(next)}`}`;
}
const failed = (from: Parameters<typeof failedPage>[0], error: string, h: Headers) =>
  seeOther(failedPage(from, error), { "Set-Cookie": flightCookie(h, "", 0) });

// The provider, or an AuthError logging which variables are missing.
const configured = (): Provider => provider() ?? fail("sign-in is not configured", { missing: missingVars().join(",") });

// Any of these on the GET means an MCP authorize request, which must come as the POST.
const MCP_FIELDS = ["client_id", "redirect_uri", "response_type", "code_challenge", "code_challenge_method", "state", "resource"];

// GET: the login page's plain link (?next=). POST: the MCP authorize page's form, from this instance's own pages
// only. There is no other consent step, so a cross-site navigation must never get a code issued for a client the
// person never saw (open registration lets anyone register one); only checkAuthorize's fields are kept.
async function startRequest(req: Request): Promise<{ next: string; authorize?: Record<string, string> } | Response> {
  const h = req.headers;
  if (req.method !== "POST") {
    const params = new URL(req.url).searchParams;
    if (MCP_FIELDS.some((k) => params.has(k))) return new Response("An MCP sign-in starts from the authorize page's form.", { status: 400 });
    return { next: safeNext(params.get("next")) };
  }
  if (!sameOrigin(h)) return new Response("forbidden", { status: 403 });
  const params = new URLSearchParams();
  for (const [k, v] of (await readFields(req, 16 * 1024)) ?? []) if (typeof v === "string") params.append(k, v);
  const checked = checkAuthorize(params, h);
  if (checked.kind === "redirect") return seeOther(checked.location);
  if (checked.kind === "error") return new Response("invalid authorize request", { status: 400 });
  return { next: "/", authorize: checked.fields };
}

export async function oidcStartRoute(req: Request): Promise<Response> {
  const h = req.headers;
  const start = await startRequest(req);
  if (start instanceof Response) return start;
  const { next, authorize } = start;
  // Not configured or the provider unreachable: back where the sign-in started, with no flight.
  let p, meta;
  try {
    p = configured();
    meta = await discover(p);
  } catch (e) {
    if (!(e instanceof AuthError)) throw e;
    return seeOther(failedPage({ next, authorize }, "sign_in_failed"));
  }
  const flight = { state: random(16), nonce: random(16), verifier: random(32), next, ...(authorize ? { authorize } : {}) };
  // ponytail: an MCP client that registered many long redirect URIs makes this cookie exceed the browser's
  // 4 KB; the browser drops it and the callback refuses (fails closed). Keep only the client's hash if that bites.
  const to = authorizeUrl(p, meta, {
    redirectUri: redirectUri(h),
    state: flight.state,
    nonce: flight.nonce,
    challenge: createHash("sha256").update(flight.verifier).digest("base64url"),
  });
  return seeOther(to, { "Set-Cookie": flightCookie(h, sign("oidc", flight), TTL.oidc) });
}

// Throws AuthError (logging why) unless the provider's answer matches the flight and the person may sign in.
async function signIn(params: URLSearchParams, flight: Payloads["oidc"] | null, h: Headers): Promise<Person> {
  const [state, code] = [params.get("state"), params.get("code")];
  if (params.has("error")) fail("provider denied the sign-in", errorCode(params.get("error")));
  if (!flight || state === null || !safeEqual(state, flight.state)) fail("state mismatch or missing sign-in cookie");
  if (!code) fail("no code in the callback");
  const p = configured();
  const meta = await discover(p);
  return exchange(p, meta, { code, redirectUri: redirectUri(h), verifier: flight.verifier, nonce: flight.nonce });
}

// Every failure counts toward the failed sign-in limit, which is checked before anything else.
export async function oidcCallbackRoute(req: Request): Promise<Response> {
  const h = req.headers;
  const ip = clientIp(h);
  const flight = verify("oidc", cookie(h, FLIGHT_COOKIE) ?? "");
  const wait = authWait(ip);
  if (wait !== null) return failed(flight, `too_many_attempts&retry=${wait}`, h);
  let person: Person;
  try {
    person = await signIn(new URL(req.url).searchParams, flight, h);
  } catch (e) {
    if (!(e instanceof AuthError)) throw e;
    authFailed(ip);
    return failed(flight, "sign_in_failed", h);
  }
  // A sign-in that started on an invitation's page joins its book; a stranger without one is turned away.
  const invitation = /^\/einladung\/(fbi_[\w-]+)$/.exec(safeNext(flight!.next))?.[1];
  let userId: string;
  try {
    ({ userId } = await userFromOidc(person, { invitation })); // the first sign-in creates the user
  } catch (e) {
    if (!(e instanceof NotInvitedError)) throw e;
    log.info("sign-in refused: not invited");
    return failed(flight, "not_invited", h);
  }
  log.info("sign-in succeeded"); // never who
  if (flight!.authorize) logger("oauth").info("authorization granted"); // never the client's self-chosen name
  const res = flight!.authorize
    ? issueCode(flight!.authorize, h, userId)
    : seeOther(safeNext(flight!.next), { "Set-Cookie": setCookie(h, IDENTITY_COOKIE, sign("identity", { uid: userId }), TTL.identity) });
  res.headers.append("Set-Cookie", flightCookie(h, "", 0));
  return res;
}
