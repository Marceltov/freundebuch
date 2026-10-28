import { expect, test } from "vitest";
import { PULL_TRIGGER, pulled } from "./PullToRefresh";

test("pulling down drags the indicator with resistance, and past the trigger it is ready", () => {
  expect(pulled(-30)).toEqual({ distance: 0, ready: false });
  expect(pulled(0)).toEqual({ distance: 0, ready: false });
  const small = pulled(40);
  expect(small.distance).toBeGreaterThan(0);
  expect(small.distance).toBeLessThan(40);
  expect(small.ready).toBe(false);
  expect(pulled(400).ready).toBe(true);
  expect(pulled(400).distance).toBeGreaterThanOrEqual(PULL_TRIGGER);
  // However far the finger goes, the indicator stops.
  expect(pulled(5000).distance).toBe(pulled(100000).distance);
});
