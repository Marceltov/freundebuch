import { renderToStaticMarkup } from "react-dom/server";
import { expect, test } from "vitest";
import { BookMark } from "./BookMark";

test("shows the book's name", () => {
  const html = renderToStaticMarkup(<BookMark name="Arbeit" />);
  expect(html).toContain("Arbeit");
  expect(html).toContain('aria-label="Buch: Arbeit"');
});
