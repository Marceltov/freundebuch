import type { LookParts } from "@/backend";

// A person's avatar, stacked from parts in one flat style on a 100×100 canvas: the hair behind the head, shoulders, neck, ears,
// head, beard, face, the hair in front and glasses on top. The sticker around it (color, rim, tilt) is the Face's. Nothing is
// stored but the choices (backend/people/looks.ts), so a new part style changes every avatar at once.

const SKIN: Record<LookParts["skin"], string> = { light: "#fbe1d0", fair: "#f2c8a5", medium: "#dea478", olive: "#c48c5a", brown: "#94603e", dark: "#5c3a26" };
const HAIR: Record<LookParts["hairColor"], string> = {
  black: "#262322",
  "dark-brown": "#4b2f1e",
  brown: "#7d4b2a",
  blond: "#e2bf6c",
  red: "#b4532c",
  grey: "#9b9a98",
  white: "#ebe8e2",
};
// Half the width and half the height of the head.
const HEAD: Record<LookParts["face"], [number, number]> = { oval: [20, 24], round: [22, 22], long: [18.5, 26] };

/** The part of the canvas a face shows: the head and the top of the shoulders. */
export const AVATAR_VIEWBOX = "12 9 76 76";

const CX = 50;
const CY = 46;
const LINE = "#2b2522";

/** The parts as SVG shapes on the 100×100 canvas, for an <svg> or a nested one (the orbit). */
export function AvatarParts({ look }: { look: LookParts }) {
  const [rx, ry] = HEAD[look.face];
  const skin = SKIN[look.skin];
  const hair = HAIR[look.hairColor];
  const top = CY - ry;
  // The hair over the top of the head down to the forehead line `brow` (a fraction of ry above the centre).
  const cap = (brow: number) =>
    `M${CX - rx - 1.5} ${CY + 2}C${CX - rx - 2} ${CY - ry * 1.45} ${CX + rx + 2} ${CY - ry * 1.45} ${CX + rx + 1.5} ${CY + 2}` +
    `L${CX + rx - 2} ${CY + 2}Q${CX + rx - 3} ${CY - ry * brow} ${CX} ${CY - ry * (brow + 0.05)}Q${CX - rx + 3} ${CY - ry * brow} ${CX - rx + 2} ${CY + 2}Z`;
  // The jaw's lower half, from cheek line `from` down round the chin, cut out at the top along `inner`.
  const jaw = (from: number, inner: number) =>
    `M${CX - rx} ${CY + from}A${rx} ${ry} 0 0 0 ${CX + rx} ${CY + from}Q${CX + rx - 4} ${CY + inner} ${CX + 7} ${CY + inner + 2}Q${CX} ${CY + inner + 4} ${CX - 7} ${CY + inner + 2}Q${CX - rx + 4} ${CY + inner} ${CX - rx} ${CY + from}Z`;
  const moustache = `M${CX - 8} ${CY + 12}Q${CX - 4} ${CY + 7} ${CX} ${CY + 9}Q${CX + 4} ${CY + 7} ${CX + 8} ${CY + 12}Q${CX} ${CY + 10.5} ${CX - 8} ${CY + 12}Z`;
  const curls = Array.from({ length: 9 }, (_, i) => {
    const a = Math.PI + (Math.PI * (i + 0.5)) / 9;
    return { x: CX + (rx + 1) * Math.cos(a), y: CY - 2 + (ry + 1) * Math.sin(a) };
  });
  return (
    <g>
      {/* behind the head */}
      {look.hair === "afro" && <circle cx={CX} cy={CY - 7} r={rx + 13} fill={hair} />}
      {look.hair === "long" && <rect x={CX - rx - 6} y={top - 2} width={2 * rx + 12} height={88 - top} rx={rx} fill={hair} />}
      {look.hair === "wavy" && <rect x={CX - rx - 5} y={top - 2} width={2 * rx + 10} height={ry * 1.65} rx={rx * 0.9} fill={hair} />}
      {look.hair === "ponytail" && <ellipse cx={CX + rx + 2} cy={CY + 10} rx={6} ry={15} transform={`rotate(-14 ${CX + rx + 2} ${CY + 10})`} fill={hair} />}
      {look.hair === "bun" && <circle cx={CX} cy={top - 4} r={8.5} fill={hair} />}

      <path d="M12 100C12 80 30 73 50 73C70 73 88 80 88 100Z" fill="#000" fillOpacity={0.22} />
      <rect x={CX - 7} y={CY + ry - 10} width={14} height={86 - CY - ry} rx={5} fill={skin} />
      <rect x={CX - 7} y={CY + ry - 10} width={14} height={86 - CY - ry} rx={5} fill="#000" fillOpacity={0.08} />
      <circle cx={CX - rx} cy={CY + 2} r={4.5} fill={skin} />
      <circle cx={CX + rx} cy={CY + 2} r={4.5} fill={skin} />
      <ellipse cx={CX} cy={CY} rx={rx} ry={ry} fill={skin} />

      {look.beard === "stubble" && <path d={jaw(0, 6)} fill={hair} fillOpacity={0.32} />}
      {look.beard === "short" && <path d={jaw(4, 9)} fill={hair} />}
      {look.beard === "full" && <path d={jaw(-2, 6)} fill={hair} />}
      {(look.beard === "moustache" || look.beard === "short" || look.beard === "full") && <path d={moustache} fill={hair} />}

      <path
        d={`M${CX - 12} ${CY - 6}L${CX - 4.5} ${CY - 7}M${CX + 4.5} ${CY - 7}L${CX + 12} ${CY - 6}`}
        stroke={look.hair === "none" && look.hairColor === "white" ? LINE : hair}
        strokeOpacity={0.9}
        strokeWidth={2.2}
        strokeLinecap="round"
      />
      <circle cx={CX - 8} cy={CY + 1} r={2.4} fill={LINE} />
      <circle cx={CX + 8} cy={CY + 1} r={2.4} fill={LINE} />
      <path d={`M${CX} ${CY + 3}q-2 4 1 5`} fill="none" stroke="#000" strokeOpacity={0.18} strokeWidth={1.6} strokeLinecap="round" />
      <path d={`M${CX - 5} ${CY + 13}Q${CX} ${CY + 16.5} ${CX + 5} ${CY + 13}`} fill="none" stroke="#8c3b2f" strokeWidth={2} strokeLinecap="round" />

      {/* in front */}
      {look.hair === "buzz" && <path d={cap(0.62)} fill={hair} fillOpacity={0.6} />}
      {(look.hair === "short" || look.hair === "wavy" || look.hair === "long" || look.hair === "bun" || look.hair === "ponytail" || look.hair === "afro") && (
        <path d={cap(0.5)} fill={hair} />
      )}
      {look.hair === "side-part" && (
        <>
          <path d={cap(0.5)} fill={hair} />
          <path
            d={`M${CX - rx + 1} ${CY - ry * 0.35}Q${CX - 6} ${CY - ry * 0.95} ${CX + rx - 2} ${CY - ry * 0.55}L${CX + rx + 1} ${CY - ry * 0.75}Q${CX} ${CY - ry * 1.15} ${CX - rx} ${CY - ry * 0.7}Z`}
            fill={hair}
          />
        </>
      )}
      {look.hair === "curly" && (
        <>
          <path d={cap(0.48)} fill={hair} />
          {curls.map((c, i) => (
            <circle key={i} cx={c.x} cy={c.y} r={6.5} fill={hair} />
          ))}
        </>
      )}

      {look.glasses === "round" && (
        <g fill="#fff" fillOpacity={0.18} stroke={LINE} strokeWidth={1.8}>
          <circle cx={CX - 8} cy={CY + 1} r={6} />
          <circle cx={CX + 8} cy={CY + 1} r={6} />
          <path d={`M${CX - 2} ${CY}h4M${CX - 14} ${CY}L${CX - rx} ${CY - 1}M${CX + 14} ${CY}L${CX + rx} ${CY - 1}`} fill="none" />
        </g>
      )}
      {look.glasses === "square" && (
        <g fill="#fff" fillOpacity={0.18} stroke={LINE} strokeWidth={1.8}>
          <rect x={CX - 15} y={CY - 4} width={12} height={9.5} rx={2} />
          <rect x={CX + 3} y={CY - 4} width={12} height={9.5} rx={2} />
          <path d={`M${CX - 3} ${CY}h6M${CX - 15} ${CY}L${CX - rx} ${CY - 1}M${CX + 15} ${CY}L${CX + rx} ${CY - 1}`} fill="none" />
        </g>
      )}
    </g>
  );
}

/** The avatar on its own, filling its box. */
export function Avatar({ look, size }: { look: LookParts; size: number }) {
  return (
    <svg viewBox={AVATAR_VIEWBOX} width={size} height={size} aria-hidden className="block">
      <AvatarParts look={look} />
    </svg>
  );
}
