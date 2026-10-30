import { cache } from "react";
import type { Language } from "@/backend";
import { copyFor, type Copy } from "@/components/copy";

// The viewer's language for server components, kept for one request. pageViewer() sets it from the signed-in user, the pages
// without one from the browser's Accept-Language (app/language.ts); until then it is German.
const current = cache((): { language: Language } => ({ language: "de" }));

export function setRequestLanguage(language: Language): void {
  current().language = language;
}

export const getLanguage = (): Language => current().language;

/** Every string the UI shows, in the viewer's language. */
export const getCopy = (): Copy => copyFor(getLanguage());
