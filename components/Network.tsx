import Link from "next/link";
import type { Briefing } from "@/backend";
import { getCopy } from "@/components/serverCopy";
import { faceColor, initials } from "@/components/faceStyle";

// Who a person belongs with, drawn in three rows: the household on top (only those of us with a visible relationship to them),
// the person in the middle, their own people below. Every line carries what it is, on a pill the line doesn't run through: to
// the household, what the person is to us ("Vermieterin"); below, what the other is to them ("Sohn"). Built only from the
// briefing's network, so a relationship the viewer may not see leaves no node, line or gap. When the labels can't be placed
// without overlapping, nothing is drawn and the page shows the list instead.

type Net = Briefing["network"];
type Box = { x: number; y: number; w: number; h: number };
type Placed = { id: string; x: number; y: number; r: number; name: string; fullName: string; url: string; color: string; initials: string };
export type Layout = {
  height: number;
  nodes: Placed[];
  lines: { x1: number; y1: number; x2: number; y2: number }[];
  pills: (Box & { text: string })[];
  names: (Box & { text: string })[];
};

const W = 360;
/** The most people of their own the diagram draws in its one row; more and the list carries the page. */
export const MAX_OTHERS = 5;
const PILL_H = 18;
const NAME_H = 14;
const textWidth = (t: string) => t.length * 6.5;
// Where on a line its pill may sit, from the person outwards: the middle first.
const STOPS = [0.5, 0.45, 0.55, 0.4, 0.6, 0.35, 0.65, 0.3, 0.7, 0.75, 0.25, 0.8];

// Labels keep a little air between them, so two pills never read as one.
const GAP = 4;
const overlaps = (a: Box, b: Box) => a.x < b.x + b.w + GAP && b.x < a.x + a.w + GAP && a.y < b.y + b.h + GAP && b.y < a.y + a.h + GAP;
const inside = (a: Box) => a.x >= 0 && a.x + a.w <= W;
const nodeBox = (n: Placed): Box => ({ x: n.x - n.r, y: n.y - n.r, w: 2 * n.r, h: 2 * n.r });

function edgeText(e: Net["edges"][number], selfId: string, above: boolean): string {
  const selfIsFrom = e.from === selfId;
  // Above, the line names the person; below, the other end.
  return above === selfIsFrom ? e.label : e.inverse;
}

/** The diagram's geometry, or null when it can't be drawn legibly (too many people, or labels that would overlap). */
export function layoutNetwork(network: Net, viewerPersonId: string): Layout | null {
  const copy = getCopy();
  const self = network.nodes.find((n) => n.role === "self");
  if (!self) return null;
  const household = network.nodes.filter((n) => n.role === "household");
  const others = network.nodes.filter((n) => n.role === "other");
  if (others.length > MAX_OTHERS) return null;

  const topY = 50;
  const selfY = household.length ? topY + 118 : 34;
  const othersY = selfY + (others.length > 3 ? 150 : 124);
  const spread = (n: number, from: number, to: number) => (i: number) => (n === 1 ? W / 2 : from + (i * (to - from)) / (n - 1));
  const hx = spread(household.length, 70, 290);
  const ox = spread(others.length, 36, 324);
  const place = (n: Net["nodes"][number], x: number, y: number, r: number): Placed => ({
    id: n.id,
    x,
    y,
    r,
    name: n.id === viewerPersonId ? copy.byMe : n.name.trim().split(/\s+/)[0],
    fullName: n.name,
    url: n.url,
    color: faceColor(n.id),
    initials: initials(n.name),
  });
  const nodes = [place(self, W / 2, selfY, 26), ...household.map((n, i) => place(n, hx(i), topY, 18)), ...others.map((n, i) => place(n, ox(i), othersY, 18))];
  const at = new Map(nodes.map((n) => [n.id, n]));
  const center = nodes[0];

  // Names above the household (lines leave them downwards), under the others; cut to the room between neighbours.
  const room = others.length > 1 ? 288 / (others.length - 1) - 6 : 120;
  const names = nodes.slice(1).map((n) => {
    const top = household.some((h) => h.id === n.id);
    const fit = Math.max(3, Math.floor(room / 6.5));
    const text = n.name.length > fit ? `${n.name.slice(0, fit - 1)}…` : n.name;
    const w = textWidth(text) + 4;
    return { text, w, h: NAME_H, x: Math.min(Math.max(n.x - w / 2, 0), W - w), y: top ? n.y - n.r - NAME_H - 5 : n.y + n.r + 5 };
  });

  const taken: Box[] = [...nodes.map(nodeBox), ...names];
  if (taken.some((b) => !inside(b))) return null;
  const pills: Layout["pills"] = [];
  const lines = new Map<string, Layout["lines"][number]>();
  for (const e of network.edges) {
    const far = at.get(e.from === self.id ? e.to : e.from);
    if (!far) continue;
    lines.set(far.id, { x1: center.x, y1: center.y, x2: far.x, y2: far.y });
    const text = edgeText(e, self.id, far.y < center.y);
    if (!text) continue;
    const w = textWidth(text) + 12;
    const spot = STOPS.map((t) => ({
      text,
      w,
      h: PILL_H,
      x: center.x + (far.x - center.x) * t - w / 2,
      y: center.y + (far.y - center.y) * t - PILL_H / 2,
    })).find((p) => inside(p) && !taken.some((b) => overlaps(p, b)));
    if (!spot) return null;
    pills.push(spot);
    taken.push(spot);
  }
  const bottom = Math.max(...nodes.map((n) => n.y + n.r), ...names.map((n) => n.y + n.h));
  return { height: Math.ceil(bottom + 6), nodes, lines: [...lines.values()], pills, names };
}

export function Network({ network, viewerPersonId }: { network: Net; viewerPersonId: string }) {
  const copy = getCopy();
  const l = layoutNetwork(network, viewerPersonId);
  if (!l) return null;
  const [self, ...rest] = l.nodes;
  return (
    <svg viewBox={`0 0 ${W} ${l.height}`} role="img" aria-label={copy.networkOf.replace("{name}", network.nodes[0]?.name ?? "")} className="block w-full">
      <g stroke="var(--ink)" strokeOpacity={0.28} strokeWidth={1.5}>
        {l.lines.map((x) => (
          <line key={`${x.x2}-${x.y2}`} {...x} />
        ))}
      </g>
      <circle cx={self.x} cy={self.y} r={self.r + 4} fill="none" stroke="var(--carbon)" strokeWidth={2} />
      <circle cx={self.x} cy={self.y} r={self.r} fill={self.color} />
      <text x={self.x} y={self.y} dy="0.35em" textAnchor="middle" fontSize={15} fontWeight={700} fill="#fff">
        {self.initials}
      </text>
      {rest.map((n, i) => (
        <Link key={n.id} href={n.url} aria-label={n.fullName}>
          <title>{n.fullName}</title>
          <circle cx={n.x} cy={n.y} r={n.r} fill={n.color} />
          <text x={n.x} y={n.y} dy="0.35em" textAnchor="middle" fontSize={11} fontWeight={700} fill="#fff">
            {n.initials}
          </text>
          <text
            x={l.names[i].x + l.names[i].w / 2}
            y={l.names[i].y + NAME_H / 2}
            dy="0.35em"
            textAnchor="middle"
            fontSize={12}
            fontWeight={600}
            fill="var(--ink)"
          >
            {l.names[i].text}
          </text>
        </Link>
      ))}
      {l.pills.map((p, i) => (
        <g key={i} data-edge-label>
          <rect x={p.x} y={p.y} width={p.w} height={p.h} rx={p.h / 2} fill="var(--paper)" stroke="var(--rule)" />
          <text x={p.x + p.w / 2} y={p.y + p.h / 2} dy="0.35em" textAnchor="middle" fontSize={11} fill="var(--ink)">
            {p.text}
          </text>
        </g>
      ))}
    </svg>
  );
}
