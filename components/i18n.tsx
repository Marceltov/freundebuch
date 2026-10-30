"use client";

import { createContext, useContext, type ReactNode } from "react";
import type { Language } from "@/backend";
import { copyFor, type Copy } from "@/components/copy";

// The viewer's language for client components, set once by the root layout. Server components read it with getCopy()
// (components/serverCopy.ts).
const Lang = createContext<Language>("de");

export function LanguageProvider({ language, children }: { language: Language; children: ReactNode }) {
  return <Lang.Provider value={language}>{children}</Lang.Provider>;
}

export const useLanguage = (): Language => useContext(Lang);

/** Every string the UI shows, in the viewer's language. */
export const useCopy = (): Copy => copyFor(useContext(Lang));
