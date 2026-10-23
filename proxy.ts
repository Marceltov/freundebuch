import { NextResponse, type NextRequest } from "next/server";
import { IDENTITY_COOKIE, identityOk, publicUrl } from "@/backend";

// Every page needs the identity cookie. Exempt: the sign-in itself (/login, /logout, /api/oidc/*), /health (a probe carries
// no session and it says only whether the instance answers), and /mcp, /api/*, /oauth/* and /.well-known/*, which check
// credentials themselves: redirecting them to /login would turn a client's 401 into a success-looking 307. Icons and the
// manifest are public too, so the login page has them. Only the cookie's signature is checked here (the proxy doesn't ask
// the database); pages get the viewer from viewerFromCookie, which also checks that the user still exists.
const EXEMPT = /^\/(login|logout|health|mcp|favicon\.ico|icon\.svg|icon-[\w-]+\.png|apple-icon\.png|manifest\.webmanifest)$|^\/(api|oauth|\.well-known|_next)\//;

export function proxy(req: NextRequest) {
  const { pathname, search } = req.nextUrl;
  if (EXEMPT.test(pathname) || identityOk(req.cookies.get(IDENTITY_COOKIE)?.value)) return NextResponse.next();
  // Must be absolute (Next rejects a relative Location here); built from the public base,
  // not req.url, so it is right behind a reverse proxy.
  const login = new URL("/login", publicUrl(req.headers));
  if (pathname !== "/") login.searchParams.set("next", pathname + search); // checked by safeNext after sign-in
  return NextResponse.redirect(login);
}

// Next's assets never need a session; skip the proxy there (also exempted above).
export const config = {
  matcher: "/((?!_next/|favicon\\.ico).*)",
};
