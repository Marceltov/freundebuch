import { renderToStaticMarkup } from "react-dom/server";
import { expect, test, vi } from "vitest";
import type { Briefing } from "@/backend";
import { FriendPage } from "./FriendPage";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh() {}, push() {} }) }));

const own = { visibility: "shared" as const, mine: false };
const b: Briefing = {
  person: { id: "p1", name: "Sarah", aliases: [], url: "/p/p1", birthday: { id: "d1", date: "1990-03-15", next: "2027-03-15", age: 37 } },
  groups: [
    { id: "g1", name: "Choir", url: "/g/g1", private: true },
    { id: "g2", name: "Uni", url: "/g/g2", private: false },
  ],
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
  const html = renderToStaticMarkup(<FriendPage b={b} daysSince={null} today="2026-10-25" />);
  // The age she is today: 37 only from her birthday on.
  expect(html).toContain("15. März 1990 · 36 Jahre");
  expect(renderToStaticMarkup(<FriendPage b={b} daysSince={null} today="2027-03-15" />)).toContain("15. März 1990 · 37 Jahre");
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

test("each group chip links to the group's page", () => {
  const html = renderToStaticMarkup(<FriendPage b={b} daysSince={null} />);
  expect(html).toContain('href="/g/g1"');
  expect(html).toContain('href="/g/g2"');
  expect(html).toMatch(/Choir<span[^>]*title="Privat: nur du siehst das"/);
  expect(html).not.toMatch(/Uni<span[^>]*title="Privat/);
});

test("Gehört zu lists each person by name with what they are to this one, linking to them", () => {
  const html = renderToStaticMarkup(
    <FriendPage
      b={{
        ...b,
        relationships: [
          { id: "x1", personId: "r1", name: "Ramona", type: "parent", note: null, direction: "in", url: "/p/r1", visibility: "shared", mine: true },
          { id: "x2", personId: "r2", name: "Andreas", type: "parent", note: null, direction: "in", url: "/p/r2", visibility: "shared", mine: false },
          { id: "x3", personId: "r3", name: "Sybille", type: "other", note: "Patentante", direction: "in", url: "/p/r3", visibility: "private", mine: true },
        ],
      }}
      daysSince={null}
    />,
  );
  expect(html).toMatch(/href="\/p\/r1"[^>]*>.*Ramona.*Elternteil/s);
  expect(html).toMatch(/href="\/p\/r2"[^>]*>.*Andreas.*Elternteil/s);
  expect(html).not.toContain("<svg viewBox=\"0 0 320 150\"");
  // the note says what an `other` is; one's own can be changed or deleted through its menu, the partner's not
  expect(html).toMatch(/Sybille.*Privat: nur du siehst das.*Patentante/s);
  const tile = (id: string) => html.match(new RegExp(`id="relationships-${id}".*?</li>`, "s"))![0];
  expect(tile("x1")).toContain('aria-label="Aktionen"');
  expect(tile("x2")).not.toContain('aria-label="Aktionen"');
});
