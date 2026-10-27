import { renderToStaticMarkup } from "react-dom/server";
import { expect, test, vi } from "vitest";
import { factKindActions, ItemActions } from "./ItemActions";

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

test("the fact menu moves a lasting fact to Gerade los, a situation back, and sets when to ask; only for its recorder", () => {
  expect(factKindActions("lasting", true)).toEqual(["Ist gerade los"]);
  expect(factKindActions("situation", true)).toEqual(["Gut zu wissen", "Nachfragen am …"]);
  expect(factKindActions("situation", false)).toEqual([]);
  expect(factKindActions(undefined, true)).toEqual([]);
});
