"use client";

import type { Badge } from "@/backend";
import { BADGE_ICON, faceColor, faceTilt, freshColor, initials } from "@/components/faceStyle";
import { useCopy } from "@/components/i18n";
import { FaceArt } from "@/components/Looks";

// A face is a person's avatar (components/Avatar.tsx), or their initials while nobody described how they look, on their color,
// cut out like a sticker: a light rim and a small tilt (components/faceStyle.ts). A client component, as lists that filter as
// you type draw it too.
// `ratio` (days since last seen over the interval) draws the freshness ring: full right after a meeting, empty when due.
export function Face({ id, name, size = 44, ratio, badges = [] }: { id: string; name: string; size?: number; ratio?: number | null; badges?: Badge[] }) {
  const copy = useCopy();
  const ring = ratio !== undefined && ratio !== null;
  const fill = ring ? Math.round((1 - Math.min(ratio, 1)) * 100) : 0;
  const rim = size >= 56 ? 4 : size >= 32 ? 3 : 2;
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
        className="inline-flex items-center justify-center overflow-hidden rounded-full font-bold text-white shadow-card"
        style={{
          width: size,
          height: size,
          background: faceColor(id),
          fontSize: Math.round(size * 0.34),
          border: `${rim}px solid var(--rim)`,
          transform: `rotate(${faceTilt(id)}deg)`,
        }}
      >
        <FaceArt id={id} size={size - 2 * rim} initials={initials(name)} />
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
