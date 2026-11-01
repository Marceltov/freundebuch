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

test("the move's address goes to the new id, and says when they stayed behind too", async () => {
  const { movedTo } = await import("./PersonMenu");
  expect(movedTo({ url: "/p/new", remains: false }, "Unser Buch")).toBe("/p/new");
  expect(movedTo({ url: "/p/new", remains: true }, "Unser Buch")).toBe("/p/new?blieb=Unser%20Buch");
});
