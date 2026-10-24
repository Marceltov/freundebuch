import Link from "next/link";
import type { Briefing } from "@/backend";
import { relationName } from "@/components/copy";
import { faceColor, initials } from "@/components/Face";

// "Ihre Leute": the person in the middle, the people they are related to around them, each labelled with what they are to the
// person and linking to their own page. Only what the briefing holds, so only relationships the viewer may see.
const W = 320;
const H = 150;

export function MiniGraph({ person, relationships }: { person: Briefing["person"]; relationships: Briefing["relationships"] }) {
  const cx = W / 2;
  const cy = H / 2;
  const nodes = relationships.map((r, i) => {
    // Evenly around an ellipse, starting top left, so a few nodes sit on both sides.
    const a = ((i + 0.5) / relationships.length) * 2 * Math.PI + Math.PI;
    return { ...r, x: cx + 115 * Math.cos(a), y: cy + 45 * Math.sin(a) };
  });
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="block w-full">
      <g stroke="var(--ink)" strokeOpacity={0.25}>
        {nodes.map((n) => (
          <line key={n.personId + n.type} x1={cx} y1={cy} x2={n.x} y2={n.y} />
        ))}
      </g>
      <circle cx={cx} cy={cy} r={18} fill={faceColor(person.id)} />
      <text x={cx} y={cy} dy="0.35em" textAnchor="middle" fontSize={12} fontWeight={600} fill="#fff">
        {initials(person.name)}
      </text>
      {nodes.map((n) => (
        <Link key={n.personId + n.type} href={`/p/${n.personId}`} aria-label={n.name}>
          <title>{n.name}</title>
          <circle cx={n.x} cy={n.y} r={14} fill={faceColor(n.personId)} />
          <text x={n.x} y={n.y} dy="0.35em" textAnchor="middle" fontSize={10} fontWeight={600} fill="#fff">
            {initials(n.name)}
          </text>
          <text x={n.x} y={n.y + 26} textAnchor="middle" fontSize={10} fill="var(--muted)">
            {relationName[n.type]?.[n.direction] || n.name.split(" ")[0]}
          </text>
        </Link>
      ))}
    </svg>
  );
}
