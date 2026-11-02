import { renderToStaticMarkup } from "react-dom/server";
import { expect, test, vi } from "vitest";
import { GroupFilter } from "./GroupFilter";

vi.mock("next/navigation", () => ({ useRouter: () => ({ replace() {} }) }));
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

test("with several books, each group's button carries its book", () => {
  const html = renderToStaticMarkup(
    <GroupFilter
      groups={[
        { id: "g1", name: "Freunde", count: 2, bookName: "Unser Buch" },
        { id: "g2", name: "Freunde", count: 1, bookName: "Arbeit" },
      ]}
      current={null}
    />,
  );
  expect(html).toContain('href="/?gruppe=g1"');
  expect(html).toContain('href="/?gruppe=g2"');
  expect(html).toContain('aria-label="Buch: Arbeit"');
});
