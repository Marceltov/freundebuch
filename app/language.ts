import { cookies, headers } from "next/headers";
import { IDENTITY_COOKIE, userLanguage, viewerFromCookie, type Language } from "@/backend";
import { copyFor, type Copy } from "@/components/copy";
import { setRequestLanguage } from "@/components/serverCopy";

// The language of a request: the signed-in user's, or (before signing in) the first of German and English the browser asks for,
// German when it asks for neither.
export async function requestLanguage(): Promise<Language> {
  const v = await viewerFromCookie((await cookies()).get(IDENTITY_COOKIE)?.value);
  const language = v ? await userLanguage(v) : browserLanguage((await headers()).get("accept-language"));
  setRequestLanguage(language);
  return language;
}

/** The strings of a page that may be seen signed out, in the request's language. */
export async function siteCopy(): Promise<Copy> {
  return copyFor(await requestLanguage());
}

/** "en-GB,en;q=0.9,de;q=0.8" → en. Weights are read; a language without one counts as 1. */
export function browserLanguage(header: string | null): Language {
  const asked = (header ?? "")
    .split(",")
    .map((part) => {
      const [tag, ...params] = part.trim().split(";");
      const q = params.map((p) => p.trim()).find((p) => p.startsWith("q="));
      return { lang: tag.trim().slice(0, 2).toLowerCase(), q: q ? Number(q.slice(2)) : 1 };
    })
    .filter((a) => (a.lang === "de" || a.lang === "en") && a.q > 0)
    .sort((a, b) => b.q - a.q);
  return (asked[0]?.lang as Language | undefined) ?? "de";
}
