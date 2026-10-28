import { renderToStaticMarkup } from "react-dom/server";
import { expect, test, vi } from "vitest";
import { inGroup, NO_GROUP, PeopleList, type PersonRow } from "./PeopleList";

vi.mock("next/link", () => ({ default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => <a href={href} {...rest}>{children}</a> }));

const row = (id: string, groups: string[]): PersonRow => ({ id, name: id, aliases: [], url: `/p/${id}`, seen: "", groups });
const people = [row("Anna", ["g1"]), row("Lena", []), row("Bob", ["haushalt"])];

test("Ohne Gruppe narrows to the people in no group", () => {
  expect(people.filter((p) => inGroup(p, NO_GROUP)).map((p) => p.name)).toEqual(["Lena"]);
  expect(people.filter((p) => inGroup(p, "g1")).map((p) => p.name)).toEqual(["Anna"]);
  expect(people.filter((p) => inGroup(p, null))).toHaveLength(3);
});

test("the chip shows with its count only when someone is in no group", () => {
  const html = renderToStaticMarkup(<PeopleList people={people} groups={[{ id: "g1", name: "Uni", count: 1 }, { id: "haushalt", name: "Herziis", count: 1 }]} />);
  expect(html).toMatch(/Ohne Gruppe <span[^>]*>1<\/span>/);
  expect(renderToStaticMarkup(<PeopleList people={[people[0], people[2]]} groups={[{ id: "g1", name: "Uni", count: 1 }]} />)).not.toContain("Ohne Gruppe");
});
