// Who is asking. A browser carries the signed fb_identity cookie (set by the OIDC callback); an MCP client or a script
// carries an OAuth access token as `Authorization: Bearer`. Either names a user id, which must still be a user. There is
// no open mode and no password: everything but the sign-in itself, /health and the OAuth endpoints needs one of the two.
import { createHash, timingSafeEqual } from "node:crypto";
import { AuthError } from "../errors";
import { cookie, sameOrigin, seeOther } from "../http/request";
import type { Viewer } from "../types";
import { apiResource, mcpResource } from "../urls";
import { viewerById } from "../users";
import { verify } from "./tokens";

export const IDENTITY_COOKIE = "fb_identity";

// Hash both sides so lengths match and timingSafeEqual never throws.
export function safeEqual(a: string, b: string): boolean {
  const h = (s: string) => createHash("sha256").update(s).digest();
  return timingSafeEqual(h(a), h(b));
}

// The token of `Authorization: Bearer <token>` (scheme in any case, RFC 9110), or "" when there is none.
export const bearerOf = (authorization: string | null): string => /^Bearer\s+(.+)$/i.exec(authorization ?? "")?.[1] ?? "";

/** Whether the identity cookie's value is one we signed and hasn't expired. For the proxy, which can't ask the database. */
export const identityOk = (value: string | undefined): boolean => !!value && verify("identity", value) !== null;

// Where a request arrives. /mcp takes only a bearer access token for `${publicUrl}/mcp`. The API takes a bearer for
// `${publicUrl}/api/v1`, or the identity cookie. A token is good only for the resource it was issued for (RFC 8707).
export type Surface = "mcp" | "api";

// The user id a request names, or undefined. An Authorization header decides alone: a bad bearer is not rescued by a
// cookie. The cookie counts on a GET or HEAD, and on anything else only from this instance's own pages: SameSite=Lax keeps
// it off cross-site subrequests, and the Origin check covers a cross-site form POST in a browser that would send it.
function uidOf(req: Request, surface: Surface): string | undefined {
  const h = req.headers;
  if (h.has("authorization")) {
    const access = verify("access", bearerOf(h.get("authorization")));
    return access && access.aud === (surface === "mcp" ? mcpResource(h) : apiResource(h)) ? access.uid : undefined;
  }
  if (surface === "mcp") return undefined;
  if (!["GET", "HEAD"].includes(req.method) && !sameOrigin(h)) return undefined;
  return verify("identity", cookie(h, IDENTITY_COOKIE) ?? "")?.uid;
}

/** The signed-in viewer on `surface`, or null: no valid cookie or token for it, or a user that no longer exists. */
export async function viewerFromRequest(req: Request, surface: Surface): Promise<Viewer | null> {
  const uid = uidOf(req, surface);
  return typeof uid === "string" ? viewerById(uid) : null;
}

/** The signed-in viewer on `surface`; AuthError (401) when there is none. */
export async function requireViewer(req: Request, surface: Surface): Promise<Viewer> {
  const v = await viewerFromRequest(req, surface);
  if (!v) throw new AuthError();
  return v;
}

/** The viewer an identity cookie's value names, for pages (server components read the cookie themselves); null when it
 * doesn't verify or the user is gone. Pages are GETs, so no Origin check. */
export async function viewerFromCookie(value: string | undefined): Promise<Viewer | null> {
  const uid = value ? verify("identity", value)?.uid : undefined;
  return typeof uid === "string" ? viewerById(uid) : null;
}

// POST /logout: drops the browser's cookie. The cookie itself stays valid until it expires (ADR 0003). Relative Location,
// so it stays correct behind a reverse proxy.
export const logoutRoute = (): Response => seeOther("/login", { "Set-Cookie": `${IDENTITY_COOKIE}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax` });
