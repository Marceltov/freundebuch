import { renderToStaticMarkup } from "react-dom/server";
import { expect, test } from "vitest";
import { BookMark } from "./BookMark";

test("shows the book's name", () => {
  const html = renderToStaticMarkup(<BookMark name="Arbeit" />);
  expect(html).toContain("Arbeit");
  expect(html).toContain('aria-label="Buch: Arbeit"');
});

test("entries get their book's name only when there are several books", async () => {
  const { withBookName } = await import("./bookName");
  const items = [{ id: "x", book: { id: "b1", name: "Arbeit" } }];
  expect(withBookName(items, true)[0].bookName).toBe("Arbeit");
  expect(withBookName(items, false)[0].bookName).toBeUndefined();
});
