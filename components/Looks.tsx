"use client";

import { createContext, useContext, type ReactNode } from "react";
import type { LookParts } from "@/backend";
import { AVATAR_VIEWBOX, Avatar, AvatarParts } from "@/components/Avatar";

// Everyone's look, read once by the app's layout (backend looks()), so a face anywhere draws the avatar without each page
// fetching it. Someone without a look keeps their initials.
const Looks = createContext<Record<string, LookParts>>({});

export function LooksProvider({ looks, children }: { looks: Record<string, LookParts>; children: ReactNode }) {
  return <Looks.Provider value={looks}>{children}</Looks.Provider>;
}

export const useLook = (id: string): LookParts | undefined => useContext(Looks)[id];

/** Inside a Face's sticker: the avatar, or the initials when there is no look. */
export function FaceArt({ id, size, initials }: { id: string; size: number; initials: string }) {
  const look = useLook(id);
  return look ? <Avatar look={look} size={size} /> : <>{initials}</>;
}

/** Inside an orbit sticker of radius r at (x, y): the avatar, clipped round, or the initials. */
export function OrbitArt({ id, x, y, r, initials }: { id: string; x: number; y: number; r: number; initials: string }) {
  const look = useLook(id);
  if (!look) {
    return (
      <text x={x} y={y} dy="0.35em" textAnchor="middle" fontSize={Math.round(r * 0.66)} fontWeight={700} fill="#fff">
        {initials}
      </text>
    );
  }
  const clip = `orbit-clip-${id}`;
  return (
    <>
      <clipPath id={clip}>
        <circle cx={x} cy={y} r={r - 1.5} />
      </clipPath>
      <g clipPath={`url(#${clip})`} aria-hidden>
        <svg x={x - r} y={y - r} width={2 * r} height={2 * r} viewBox={AVATAR_VIEWBOX}>
          <AvatarParts look={look} />
        </svg>
      </g>
    </>
  );
}
