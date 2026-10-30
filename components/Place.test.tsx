import { renderToStaticMarkup } from "react-dom/server";
import { expect, test } from "vitest";
import { PlaceFacts } from "./Place";

const link = (id: string, name: string, base = "/o/") => ({ id, name, url: `${base}${id}` });
const place = { id: "h", name: "Annas Wohnung", aliases: [], parents: [link("n", "Nürnberg"), link("by", "Bayern")], address: "Hauptstraße 5", owners: [link("anna", "Anna", "/p/")], url: "/o/h" };

test("a place says where it sits, its address and whose home it is, each linked", () => {
  const html = renderToStaticMarkup(<PlaceFacts p={{ ...place, inside: [{ ...place, id: "k", name: "Küche", parents: [], owners: [], address: null, url: "/o/k" }] }} />);
  expect(html).toMatch(/in <a [^>]*href="\/o\/n"[^>]*>Nürnberg<\/a> · <a [^>]*href="\/o\/by"[^>]*>Bayern<\/a>/);
  expect(html).toContain("Hauptstraße 5");
  expect(html).toMatch(/Zuhause von <a [^>]*href="\/p\/anna"[^>]*>Anna<\/a>/);
  expect(html).toContain("Darin");
  expect(html).toMatch(/href="\/o\/k"[^>]*>Küche/);
});

test("a place with nothing of that shows nothing", () => {
  expect(renderToStaticMarkup(<PlaceFacts p={{ ...place, parents: [], address: null, owners: [], inside: [] }} />)).toBe("");
});
