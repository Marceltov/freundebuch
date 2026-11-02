// Every string the UI shows, one module per language with the same keys (de.ts, the app's first language, gives the type; en.ts).
import type { Language } from "@/backend";
import { de, type Copy } from "./de";
import { en } from "./en";

export type { Copy };

type Gender = "female" | "male" | "nonbinary" | null;

/**
 * The role line under a person's name: who they are to us, in the words filed, read from the viewer's side ("Unsere
 * Vermieterin", "Kollegin von dir", "Kolleg:in von Marcel"), several joined with " · ". "Unsere"/"Unser" follows the person's
 * gender; without one it reads "Vermieter:in von uns".
 */
export function roleLine(copy: Copy, roles: { label: string; with: "me" | "partner" | "us"; partnerName?: string }[], gender: Gender): string {
  return roles
    .map((r) => {
      const role = r.label.trim();
      if (!role) return "";
      if (r.with === "us") return (gender === "female" ? copy.roleUs : gender === "male" ? copy.roleUsM : copy.roleUsX).replace("{role}", role);
      if (r.with === "me") return copy.roleMe.replace("{role}", role);
      return copy.rolePartner.replace("{role}", role).replace("{name}", r.partnerName ?? "");
    })
    .filter(Boolean)
    .join(" · ");
}

const COPY: Record<Language, Copy> = { de, en };

/** Every string the UI shows, in `language`. */
export const copyFor = (language: Language): Copy => COPY[language];
