// The one OIDC provider: authentik (any OIDC provider works), from FREUNDEBUCH_OIDC_{ISSUER,CLIENT_ID,CLIENT_SECRET,ALLOW}.
// Sign-in is the only way in, so there is no "off": without the three required variables nobody can sign in, and the start
// route logs which ones are missing. ALLOW is an optional extra restriction; unset, authentik decides who gets in.
import { config } from "../config";

export type Provider = { issuer: string; clientId: string; clientSecret: string; allow: string[] };

// The variables the provider still needs (none when it is complete), by name.
export function missingVars(): string[] {
  const c = config.oidc();
  const set = { ISSUER: c.issuer, CLIENT_ID: c.clientId, CLIENT_SECRET: c.clientSecret };
  return Object.entries(set).flatMap(([k, v]) => (v === "" ? [`FREUNDEBUCH_OIDC_${k}`] : []));
}

export const provider = (): Provider | undefined => (missingVars().length ? undefined : config.oidc());

// `*` lets anyone the provider signs in through, even without an email claim; every other entry
// (address or @domain) needs a verified email.
export function allowed(provider: Pick<Provider, "allow">, c: { email?: string; email_verified?: boolean }): boolean {
  const { allow } = provider;
  if (allow.includes("*")) return true;
  if (c.email_verified !== true || !c.email) return false;
  const email = c.email.toLowerCase();
  return allow.some((a) => (a.startsWith("@") ? email.endsWith(a) : email === a));
}

// What no line of text holds: control characters (C0, U+007F, C1), the line and paragraph separators, and the text-direction
// overrides, embeddings and isolates (they let a text read as another). The marks and joiners stay: right-to-left text and emoji need them.
const FORBIDDEN = /[\u0000-\u001f\u007f-\u009f\u2028-\u202e\u2066-\u2069]/g;

// The user's name, as shown to the other user: the first of name, preferred_username and email that is a non-empty string,
// each forbidden character a space, trimmed.
export function nameFrom(claims: Record<string, unknown>): string | undefined {
  for (const k of ["name", "preferred_username", "email"]) {
    const v = claims[k];
    const clean = typeof v === "string" ? v.replace(FORBIDDEN, " ").trim() : "";
    if (clean) return clean;
  }
  return undefined;
}
