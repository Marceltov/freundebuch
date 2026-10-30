import { renderToStaticMarkup } from "react-dom/server";
import { expect, test } from "vitest";
import type { LookPart, LookParts } from "@/backend";
import { Avatar } from "./Avatar";
import { copyFor } from "./copy";
import { Face } from "./Face";
import { faceColor, initials } from "./faceStyle";
import { LooksProvider } from "./Looks";

test("initials: first letters of the first and last word", () => {
  expect(initials("Anna Weber")).toBe("AW");
  expect(initials("Oma Gerda")).toBe("OG");
  expect(initials("Lena")).toBe("LE");
  expect(initials("  jürgen   von der Heide ")).toBe("JH");
});

test("the same id always gets the same color, from the palette of 8", () => {
  const ids = Array.from({ length: 40 }, (_, i) => `id-${i}`);
  expect(ids.map(faceColor)).toEqual(ids.map(faceColor));
  expect(new Set(ids.map(faceColor)).size).toBeGreaterThan(1);
  expect(new Set(ids.map(faceColor)).size).toBeLessThanOrEqual(8);
});

test("a face is named for screen readers and shows its badges and freshness ring", () => {
  const html = renderToStaticMarkup(<Face id="x" name="Anna Weber" ratio={0.25} badges={["birthday", "promise"]} />);
  expect(html).toContain('aria-label="Anna Weber"');
  expect(html).toContain(">AW<");
  expect(html).toContain("conic-gradient");
  expect(html).toContain("75%");
  expect(html.match(/<svg/g)).toHaveLength(2);
  expect(renderToStaticMarkup(<Face id="x" name="Anna Weber" />)).not.toContain("conic-gradient");
});

test("a face with a look draws the avatar instead of the initials; without one, the initials stay", () => {
  const look = { face: "round", skin: "fair", hair: "curly", hairColor: "red", glasses: "round", beard: "none" } as const;
  const drawn = renderToStaticMarkup(
    <LooksProvider looks={{ x: look }}>
      <Face id="x" name="Anna Weber" />
      <Face id="y" name="Tom Berg" />
    </LooksProvider>,
  );
  expect(drawn).toContain('aria-label="Anna Weber"');
  expect(drawn).not.toContain(">AW<");
  expect(drawn).toContain('viewBox="12 9 76 76"');
  expect(drawn).toContain(">TB<");
});

test("each part changes the drawing, so every value is visible", () => {
  const base = { face: "oval", skin: "medium", hair: "short", hairColor: "brown", glasses: "none", beard: "none" } as const;
  const draw = (look: LookParts) => renderToStaticMarkup(<Avatar look={look} size={40} />);
  for (const part of Object.keys(copyFor("de").lookValue) as LookPart[]) {
    const drawings = Object.keys(copyFor("de").lookValue[part]).map((value) => draw({ ...base, [part]: value }));
    expect(new Set(drawings).size).toBe(drawings.length);
  }
});
