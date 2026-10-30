import { Cake, Gift, Pin, type LucideIcon } from "lucide-react";
import type { Badge } from "@/backend";

// How a person's face looks wherever it is drawn (Face, the orbit, the network): a color of their own (a stable hash of their id
// picks one of 8), a small tilt that stays the same, their initials while nobody described how they look.
export const PALETTE = ["#e07a5f", "#3d85c6", "#81b29a", "#9b72cf", "#f2a541", "#5e6472", "#d36582", "#2a9d8f"] as const;

export const BADGE_ICON: Record<Badge, LucideIcon> = { birthday: Cake, promise: Pin, gift: Gift };

// FNV-1a over the id.
function hash(id: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 0x01000193);
  return h >>> 0;
}

export const faceColor = (id: string): string => PALETTE[hash(id) % PALETTE.length];

/** A sticker's tilt, -5° to 5°, the same for a person every time. */
export const faceTilt = (id: string): number => ((hash(id) >>> 8) % 11) - 5;

/** The first letters of the first and the last word; a single word gives its first two letters. */
export function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (!words.length) return "?";
  const pick = words.length === 1 ? [...words[0]].slice(0, 2) : [[...words[0]][0], [...words[words.length - 1]][0]];
  return pick.join("").toUpperCase();
}

/** The ring's color: fresh, drifting, due. */
export const freshColor = (ratio: number) => (ratio >= 1 ? "var(--due)" : ratio >= 0.75 ? "var(--drift)" : "var(--fresh)");
