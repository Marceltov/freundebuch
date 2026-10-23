import { Cake, Gift, Pin, type LucideIcon } from "lucide-react";
import type { Badge } from "@/backend";
import { copy } from "@/components/copy";

// Until there are photos, a face is a person's initials on a color of their own: a stable hash of their id picks one of 8.
export const PALETTE = ["#e07a5f", "#3d85c6", "#81b29a", "#9b72cf", "#f2a541", "#5e6472", "#d36582", "#2a9d8f"] as const;

export const BADGE_ICON: Record<Badge, LucideIcon> = { birthday: Cake, promise: Pin, gift: Gift };

// FNV-1a over the id.
export function faceColor(id: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 0x01000193);
  return PALETTE[(h >>> 0) % PALETTE.length];
}

/** The first letters of the first and the last word; a single word gives its first two letters. */
export function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (!words.length) return "?";
  const pick = words.length === 1 ? [...words[0]].slice(0, 2) : [[...words[0]][0], [...words[words.length - 1]][0]];
  return pick.join("").toUpperCase();
}

/** The ring's color: fresh, drifting, due. */
export const freshColor = (ratio: number) => (ratio >= 1 ? "var(--due)" : ratio >= 0.75 ? "var(--drift)" : "var(--fresh)");

// `ratio` (days since last seen over the interval) draws the freshness ring: full right after a meeting, empty when due.
export function Face({ id, name, size = 44, ratio, badges = [] }: { id: string; name: string; size?: number; ratio?: number | null; badges?: Badge[] }) {
  const ring = ratio !== undefined && ratio !== null;
  const fill = ring ? Math.round((1 - Math.min(ratio, 1)) * 100) : 0;
  return (
    <span
      role="img"
      aria-label={name}
      title={name}
      className="relative inline-flex shrink-0 rounded-full"
      style={ring ? { padding: 3, background: `conic-gradient(${freshColor(ratio)} ${fill}%, var(--rule) 0)` } : undefined}
    >
      <span
        aria-hidden
        className="inline-flex items-center justify-center rounded-full font-semibold text-white"
        style={{ width: size, height: size, background: faceColor(id), fontSize: Math.round(size * 0.34) }}
      >
        {initials(name)}
      </span>
      {badges.length > 0 && (
        <span className="absolute -right-1.5 -bottom-1.5 flex gap-0.5">
          {badges.map((b) => {
            const Icon = BADGE_ICON[b];
            return (
              <span key={b} title={copy.badge[b]} className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-surface text-ink shadow-card ring-1 ring-rule">
                <Icon aria-hidden className="h-3 w-3" />
              </span>
            );
          })}
        </span>
      )}
    </span>
  );
}
