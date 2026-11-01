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

test("a group key with & or + survives in the chip's link", () => {
  const html = renderToStaticMarkup(
    <GroupFilter
      groups={[
        { id: "kunst & kultur", name: "Kunst & Kultur", count: 2 },
        { id: "sport+spiel", name: "Sport+Spiel", count: 1 },
      ]}
      current={null}
    />,
  );
  expect(html).toContain('href="/?gruppe=kunst%20%26%20kultur"');
  expect(html).toContain('href="/?gruppe=sport%2Bspiel"');
});
