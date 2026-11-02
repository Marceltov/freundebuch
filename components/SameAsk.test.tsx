import { renderToStaticMarkup } from "react-dom/server";
import { expect, test, vi } from "vitest";
import { SameAsk } from "./SameAsk";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh() {} }) }));

test("SameAsk names both books, with a yes and a no for each namesake", () => {
  const html = renderToStaticMarkup(
    <SameAsk personId="p1" name="Lena" book="Unser Buch" matches={[{ id: "p9", name: "Lena", book: { id: "b2", name: "Arbeit" } }]} />,
  );
  expect(html).toContain("Ist Lena (Unser Buch) dieselbe Person wie Lena (Arbeit)?");
  expect(html).toContain("Ja, dieselbe");
  expect(html).toContain(">Nein<");
});
