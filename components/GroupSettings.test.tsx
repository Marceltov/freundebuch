import { renderToStaticMarkup } from "react-dom/server";
import { expect, test, vi } from "vitest";
import { GroupSettings } from "./GroupSettings";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh() {} }) }));

test("Haushalt can be renamed but has no delete button and is never offered to merge away", () => {
  const html = renderToStaticMarkup(
    <GroupSettings
      groups={[
        { id: "h", name: "Herziis", aliases: ["Haushalt"], count: 2, household: true },
        { id: "f", name: "Freunde", aliases: [], count: 3, household: false },
      ]}
    />,
  );
  const card = (name: string) => html.slice(html.indexOf(`aria-label="${name}"`), html.indexOf("</li>", html.indexOf(`aria-label="${name}"`)));
  expect(card("Herziis")).toContain("Umbenennen");
  expect(card("Herziis")).not.toContain('aria-label="Löschen"');
  expect(card("Freunde")).toContain('aria-label="Löschen"');
  expect(card("Freunde")).not.toContain(">Herziis</option>");
  expect(card("Herziis")).toContain(">Freunde</option>");
});
