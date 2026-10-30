import Link from "next/link";
import type { OrbitFace } from "@/backend";
import { copy } from "@/components/copy";
import { BADGE_ICON, faceColor, faceTilt, initials } from "@/components/Face";
import { OrbitArt } from "@/components/Looks";

// The start page: "Du" in the middle, three dashed rings around it (backend/orbit.ts places the faces). Close = seen recently,
// the outer ring = due. Each face is a sticker with the first name under it and links to the friend page. PAD leaves room
// around the rings for the names of the outer faces.
const SIZE = 360;
const C = SIZE / 2;
const RADII = [70, 118, 164] as const;
const MAX_FACE = 21;
const MIN_FACE = 12;
const PAD = 26;
// The first name, cut to fit under a face.
const firstName = (name: string) => {
  const first = name.trim().split(/\s+/)[0] ?? "";
  return first.length > 10 ? `${first.slice(0, 9)}…` : first;
};

export function Orbit({ faces }: { faces: OrbitFace[] }) {
  // Faces shrink on a crowded ring so they don't overlap.
  const perRing = [0, 1, 2].map((r) => faces.filter((f) => f.ring === r).length);
  const faceR = (ring: number) => Math.max(MIN_FACE, Math.min(MAX_FACE, (Math.PI * RADII[ring]) / Math.max(perRing[ring], 1) - 3));
  return (
    <svg viewBox={`${-PAD} ${-PAD} ${SIZE + 2 * PAD} ${SIZE + 2 * PAD}`} className="mx-auto block w-full max-w-md" role="group" aria-label={copy.orbitTitle}>
      <g fill="none" stroke="var(--ink)" strokeOpacity={0.14} strokeWidth={1.5} strokeDasharray="4 6">
        {RADII.map((r) => (
          <circle key={r} cx={C} cy={C} r={r} />
        ))}
      </g>
      <circle cx={C} cy={C} r={26} fill="var(--carbon)" />
      <text x={C} y={C} dy="0.35em" textAnchor="middle" fontSize={15} fontWeight={700} fill="var(--on-carbon)" className="font-display">
        {copy.you}
      </text>
      {faces.map((f) => {
        const rad = ((f.angle - 90) * Math.PI) / 180;
        const x = C + RADII[f.ring] * Math.cos(rad);
        const y = C + RADII[f.ring] * Math.sin(rad);
        const r = faceR(f.ring);
        return (
          <Link key={f.personId} href={`/p/${f.personId}`} aria-label={f.name} data-in-group={f.inGroup} data-unseen={f.unseen} style={f.inGroup === false ? { opacity: 0.14 } : undefined}>
            <title>{f.name}</title>
            <g transform={`rotate(${faceTilt(f.personId)} ${x} ${y})`} opacity={f.unseen ? 0.5 : undefined}>
              <circle cx={x} cy={y} r={r} fill={faceColor(f.personId)} stroke="var(--rim)" strokeWidth={3} />
              <OrbitArt id={f.personId} x={x} y={y} r={r} initials={initials(f.name)} />
            </g>
            <text x={x} y={y + r + 13} textAnchor="middle" fontSize={12} fontWeight={600} fill="var(--ink)">
              {firstName(f.name)}
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
