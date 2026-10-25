import Link from "next/link";
import type { OrbitFace } from "@/backend";
import { copy } from "@/components/copy";
import { BADGE_ICON, faceColor, initials } from "@/components/Face";

// The start page: "Du" in the middle, three rings around it (backend/orbit.ts places the faces). Close = seen recently, the
// outer ring = due. Each face links to the friend page.
const SIZE = 360;
const C = SIZE / 2;
const RADII = [70, 118, 164] as const;
const MAX_FACE = 21;
const MIN_FACE = 12;

export function Orbit({ faces }: { faces: OrbitFace[] }) {
  // Faces shrink on a crowded ring so they don't overlap.
  const perRing = [0, 1, 2].map((r) => faces.filter((f) => f.ring === r).length);
  const faceR = (ring: number) => Math.max(MIN_FACE, Math.min(MAX_FACE, (Math.PI * RADII[ring]) / Math.max(perRing[ring], 1) - 3));
  return (
    <svg viewBox={`0 0 ${SIZE} ${SIZE}`} className="mx-auto block w-full max-w-md" role="group" aria-label={copy.orbitTitle}>
      <g fill="none" stroke="var(--ink)" strokeOpacity={0.12}>
        {RADII.map((r) => (
          <circle key={r} cx={C} cy={C} r={r} />
        ))}
      </g>
      <circle cx={C} cy={C} r={24} fill="var(--carbon)" />
      <text x={C} y={C} dy="0.35em" textAnchor="middle" fontSize={14} fontWeight={700} fill="var(--on-carbon)">
        {copy.you}
      </text>
      {faces.map((f) => {
        const rad = ((f.angle - 90) * Math.PI) / 180;
        const x = C + RADII[f.ring] * Math.cos(rad);
        const y = C + RADII[f.ring] * Math.sin(rad);
        const r = faceR(f.ring);
        return (
          <Link key={f.personId} href={`/p/${f.personId}`} aria-label={f.name} data-in-group={f.inGroup} style={f.inGroup === false ? { opacity: 0.14 } : undefined}>
            <title>{f.name}</title>
            <circle cx={x} cy={y} r={r} fill={faceColor(f.personId)} opacity={f.ring === 2 ? 0.75 : 1} />
            <text x={x} y={y} dy="0.35em" textAnchor="middle" fontSize={Math.round(r * 0.72)} fontWeight={600} fill="#fff">
              {initials(f.name)}
            </text>
            {f.badges.map((b, i) => {
              const Icon = BADGE_ICON[b];
              const bx = x + r * 0.75 - i * 15;
              const by = y + r * 0.75;
              return (
                <g key={b} aria-hidden>
                  <circle cx={bx} cy={by} r={8} fill="var(--surface)" stroke="var(--rule)" />
                  <Icon x={bx - 5.5} y={by - 5.5} width={11} height={11} color="var(--ink)" />
                </g>
              );
            })}
          </Link>
        );
      })}
    </svg>
  );
}
