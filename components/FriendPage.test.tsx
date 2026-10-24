import { renderToStaticMarkup } from "react-dom/server";
import { expect, test, vi } from "vitest";
import type { Briefing } from "@/backend";
import { FriendPage } from "./FriendPage";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh() {}, push() {} }) }));

const own = { visibility: "shared" as const, mine: false };
const b: Briefing = {
  person: { id: "p1", name: "Sarah", aliases: [], birthday: { date: "1990-03-15", next: "2027-03-15", age: 37 } },
  groups: ["Choir", "Uni"],
  freshness: { lastSeen: null, intervalDays: null, ratio: null },
  nextDates: [],
  current: [],
  open: {
    promises: [
      { id: "1", text: "send photos", byMe: true, due: null, ...own, mine: true },
      { id: "2", text: "bring the tent", byMe: false, by: "Alice", due: null, ...own },
      { id: "3", text: "call back", byMe: false, due: null, ...own },
    ],
    exchanges: [{ id: "4", kind: "lent", direction: "to_them", by: "Alice", text: "a drill", amount: null, currency: null, ...own }],
    giftIdeas: [],
  },
  recent: [],
  relationships: [],
};

test("the header shows the birthday however far away, with the age, and the groups as chips", () => {
  const html = renderToStaticMarkup(<FriendPage b={b} daysSince={null} />);
  expect(html).toContain("15. März · 37");
  expect(html).toMatch(/Gruppe: <\/span>Choir/);
  expect(html).toMatch(/Gruppe: <\/span>Uni/);
});

test("promises and exchanges name whose they are: Du for the viewer's, the partner's name for theirs", () => {
  const html = renderToStaticMarkup(<FriendPage b={b} daysSince={null} />);
  expect(html).toContain("<b>Du: </b>send photos");
  expect(html).toContain("<b>Alice: </b>bring the tent");
  expect(html).not.toMatch(/<\/b>call back/);
  expect(html).toContain("<b>Alice </b>");
});
