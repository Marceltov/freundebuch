import { expect, test } from "vitest";
import { sheetFit } from "./sheetFit";

test("without a keyboard the sheet keeps its own size", () => {
  expect(sheetFit(800, { height: 800, offsetTop: 0 })).toBeNull();
});

test("with the keyboard up the sheet is pinned inside the visible area, top and bottom", () => {
  // 800 tall, keyboard 350, Safari panned the visible area 100 down: it shows 100..550.
  expect(sheetFit(800, { height: 450, offsetTop: 100 })).toEqual({ top: 100 + 36, bottom: 250 });
});

test("Safari panned all the way down to the field: the keyboard is still there, and the sheet fits the visible area", () => {
  // The visible area is the layout's bottom 450 px (350..800): nothing is left below it, yet the keyboard is up.
  expect(sheetFit(800, { height: 450, offsetTop: 350 })).toEqual({ top: 350 + 36, bottom: 0 });
});

test("the top never leaves the visible area, however the area moves", () => {
  for (const offsetTop of [0, 50, 200, 340, 350]) {
    const f = sheetFit(800, { height: 450, offsetTop })!;
    expect(f.top).toBeGreaterThanOrEqual(offsetTop);
    expect(800 - f.bottom).toBe(offsetTop + 450);
  }
});
