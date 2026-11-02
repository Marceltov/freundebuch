import { expect, test } from "vitest";
import { moveTargets } from "./PersonMenu";

const books = [
  { id: "b1", name: "Unser Buch" },
  { id: "b2", name: "Arbeit" },
  { id: "b3", name: "Verein" },
];

test("offers the other books only, and none with one book", () => {
  expect(moveTargets(books, "b1", true).map((b) => b.name)).toEqual(["Arbeit", "Verein"]);
  expect(moveTargets(books.slice(0, 1), "b1", true)).toEqual([]);
});

test("a member of the book or the viewer can't be moved", () => {
  expect(moveTargets(books, "b1", false)).toEqual([]);
});

test("the move's address goes to the new id, or to the twin it was merged into", async () => {
  const { movedTo } = await import("./PersonMenu");
  expect(movedTo({ url: "/p/new" })).toBe("/p/new");
  expect(movedTo({ url: "/p/new", twin: "p9" })).toBe("/p/p9");
});

test("PersonMenu offers unlink only for a link of two parts", async () => {
  const { canUnlink } = await import("./PersonMenu");
  const ub = { id: "b1", name: "Unser Buch" };
  const two = [
    { book: ub, id: "p1" },
    { book: { id: "b2", name: "Arbeit" }, id: "p9" },
  ];
  expect(canUnlink([{ book: ub, id: "p1" }], true)).toBe(false);
  expect(canUnlink(two, true)).toBe(true);
  // A writer of two books is one person by their user, not by a link: nothing to unlink.
  expect(canUnlink(two, false)).toBe(false);
});
