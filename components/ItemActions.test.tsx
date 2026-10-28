import { renderToStaticMarkup } from "react-dom/server";
import { expect, test, vi } from "vitest";
import { canEdit, factKindActions, ItemActions, rowPath } from "./ItemActions";

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
  // The partner's shared relationship: theirs to edit or delete too.
  expect(renderToStaticMarkup(<ItemActions table="relationships" mine={false} {...item} />)).toContain("Aktionen");
});

test("either of us edits or deletes a shared item; a conversation and who can see an item stay the recorder's", () => {
  expect(canEdit("facts", false, "shared")).toBe(true);
  expect(canEdit("relationships", false, "shared")).toBe(true);
  expect(canEdit("conversations", false, "shared")).toBe(false);
  expect(canEdit("facts", false, "private")).toBe(false);
  expect(canEdit("conversations", true, "private")).toBe(true);
});

test("the fact menu moves a fact to every other kind; only for who may edit it", () => {
  expect(factKindActions("lasting", true)).toEqual([
    { kind: "situation", label: "Ist gerade los" },
    { kind: "need", label: "Braucht" },
    { kind: "personality", label: "Wesen" },
  ]);
  expect(factKindActions("situation", true).map((a) => a.kind)).toEqual(["lasting", "need", "personality"]);
  expect(factKindActions("need", true).map((a) => a.label)).toEqual(["Gut zu wissen", "Ist gerade los", "Wesen"]);
  expect(factKindActions("need", false)).toEqual([]);
  expect(factKindActions(undefined, true)).toEqual([]);
});

test("an item's link points at its highlighted row on the page it is shared from", () => {
  expect(rowPath("/p/p1", "facts", "f1")).toBe("/p/p1#facts-f1");
  expect(rowPath("/c/c1", "promises", "x")).toBe("/c/c1#promises-x");
});
