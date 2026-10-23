import { renderToStaticMarkup } from "react-dom/server";
import { expect, test, vi } from "vitest";
import { ItemActions } from "./ItemActions";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh() {}, push() {} }) }));

const item = { id: "x", visibility: "shared" as const, text: "t" };

test("no menu at all when it would hold no action: the partner's conversation", () => {
  expect(renderToStaticMarkup(<ItemActions table="conversations" mine={false} {...item} />)).toBe("");
});

test("a menu whenever there is something to do", () => {
  expect(renderToStaticMarkup(<ItemActions table="conversations" mine {...item} />)).toContain("Aktionen");
  // Either user may mark a shared fact outdated or a promise done.
  expect(renderToStaticMarkup(<ItemActions table="facts" mine={false} {...item} />)).toContain("Aktionen");
  expect(renderToStaticMarkup(<ItemActions table="promises" mine={false} {...item} />)).toContain("Aktionen");
});
