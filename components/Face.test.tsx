import { renderToStaticMarkup } from "react-dom/server";
import { expect, test } from "vitest";
import { Face, faceColor, initials } from "./Face";

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
