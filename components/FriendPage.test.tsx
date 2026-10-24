import { renderToStaticMarkup } from "react-dom/server";
import { expect, test, vi } from "vitest";
import type { Briefing } from "@/backend";
import { FriendPage } from "./FriendPage";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh() {}, push() {} }) }));

const own = { visibility: "shared" as const, mine: false };
const b: Briefing = {
  person: { id: "p1", name: "Sarah", aliases: [], url: "/p/p1", birthday: { id: "d1", date: "1990-03-15", next: "2027-03-15", age: 37 } },
  groups: ["Choir", "Uni"],
  freshness: { lastSeen: null, intervalDays: null, ratio: null },
  nextDates: [],
  current: [],
  open: {
    promises: [
      { id: "1", text: "send photos", byMe: true, due: null, url: "/p/p1#promises-1", ...own, mine: true },
      { id: "2", text: "bring the tent", byMe: false, by: "Alice", due: null, url: "/p/p1#promises-2", ...own },
      { id: "3", text: "call back", byMe: false, due: null, url: "/p/p1#promises-3", ...own },
    ],
    exchanges: [{ id: "4", kind: "lent", direction: "to_them", by: "Alice", text: "a drill", amount: null, currency: null, url: "/p/p1#exchanges-4", ...own }],
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

test("each item's row carries the anchor its url ends in, so a link to it lands there", () => {
  const html = renderToStaticMarkup(<FriendPage b={b} daysSince={null} />);
  for (const u of [...b.open.promises, ...b.open.exchanges].map((x) => x.url)) expect(html).toContain(`id="${u.split("#")[1]}"`);
  expect(html).toContain('id="dates-d1"');
});
