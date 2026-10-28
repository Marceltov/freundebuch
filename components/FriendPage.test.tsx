import { renderToStaticMarkup } from "react-dom/server";
import { expect, test, vi } from "vitest";
import type { Briefing } from "@/backend";
import { FriendPage } from "./FriendPage";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh() {}, push() {} }) }));

const own = { visibility: "shared" as const, mine: false };
const b: Briefing = {
  person: { id: "p1", name: "Sarah", aliases: [], url: "/p/p1", birthday: { id: "d1", date: "1990-03-15", next: "2027-03-15", age: 37 }, gender: null },
  roles: [],
  groups: [
    { id: "g1", name: "Choir", url: "/g/g1", private: true },
    { id: "g2", name: "Uni", url: "/g/g2", private: false },
  ],
  freshness: { lastSeen: null, intervalDays: null, ratio: null },
  nextDates: [],
  situations: [],
  traits: { needs: [], personality: [] },
  known: [],
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
  network: { nodes: [], edges: [] },
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
          { id: "x1", personId: "r1", name: "Ramona", label: "Mutter", inverse: "Tochter", note: null, direction: "in", url: "/p/r1", visibility: "shared", mine: true },
          { id: "x2", personId: "r2", name: "Andreas", label: "Tochter", inverse: "Vater", note: null, direction: "out", url: "/p/r2", visibility: "shared", mine: false },
          { id: "x3", personId: "r3", name: "Sybille", label: "Patentante", inverse: "Patenkind", note: "seit der Taufe", direction: "in", url: "/p/r3", visibility: "private", mine: true },
        ],
      }}
      daysSince={null}
    />,
  );
  // What the other is to this person: their own end's words, whichever way round it was filed.
  expect(html).toMatch(/href="\/p\/r1"[^>]*>.*Ramona.*Mutter/s);
  expect(html).toMatch(/href="\/p\/r2"[^>]*>.*Andreas.*Vater/s);
  expect(html).not.toContain("Tochter");
  // the note follows the words; each can be changed or deleted through its menu
  expect(html).toMatch(/Sybille.*Privat: nur du siehst das.*Patentante · seit der Taufe/s);
  const tile = (id: string) => html.match(new RegExp(`id="relationships-${id}".*?</li>`, "s"))![0];
  expect(tile("x1")).toContain('aria-label="Aktionen"');
  // The partner's shared one too: either of us may change or delete it.
  expect(tile("x2")).toContain('aria-label="Aktionen"');
});

const fact = (id: string, text: string, category: "home" | "other" | "work" = "other") => ({ id, text, category, url: `/p/p1#facts-${id}`, ...own });
const role = (over: Partial<Briefing["roles"][number]> = {}): Briefing["roles"][number] => ({ label: "Vermieterin", with: "us", ids: ["r1", "r2"], ...over });

test("the role line comes first, in the words filed; Unsere or Unser by the person's gender", () => {
  const page = (over: Partial<Briefing>) => renderToStaticMarkup(<FriendPage b={{ ...b, situations: [{ ...fact("s1", "sucht ein Auto"), since: "2026-09-01", checkAfter: "2026-12-01", nudge: false }], ...over }} daysSince={null} today="2026-10-25" />);
  const html = page({ roles: [role()], person: { ...b.person, gender: "female" } });
  expect(html).toContain("Unsere Vermieterin");
  expect(html.indexOf("Unsere Vermieterin")).toBeLessThan(html.indexOf("Gerade los"));
  expect(page({ roles: [role({ label: "Vermieter:in" })] })).toContain("Vermieter:in von uns");
  expect(page({ roles: [role({ label: "Klempner" })], person: { ...b.person, gender: "male" } })).toContain("Unser Klempner");
  expect(page({ roles: [role({ label: "Kollegin", with: "me" })] })).toContain("Kollegin von dir");
  expect(page({ roles: [role({ label: "Kolleg:in", with: "partner", partnerName: "Marcel" }), role({ label: "Nachbar:in" })] })).toContain("Kolleg:in von Marcel · Nachbar:in von uns");
  expect(page({ roles: [] })).not.toContain("data-role-line");
});

test("Gerade los shows situations, nudges first; lasting facts go under Gut zu wissen", () => {
  const html = renderToStaticMarkup(
    <FriendPage
      b={{
        ...b,
        situations: [
          { ...fact("s1", "sucht ein Auto"), since: "2026-09-01", checkAfter: "2026-10-13", nudge: true },
          { ...fact("s2", "renoviert das Bad", "home"), since: "2026-10-20", checkAfter: "2026-12-01", nudge: false },
        ],
        known: [fact("k1", "arbeitet bei Hornbach", "work")],
      }}
      daysSince={null}
      today="2026-10-27"
    />,
  );
  const now = html.indexOf("Gerade los");
  const known = html.indexOf("Gut zu wissen");
  expect(now).toBeGreaterThan(-1);
  expect(known).toBeGreaterThan(now);
  expect(html).toContain("Frag mal nach – seit 8 Wochen nichts gehört");
  expect(html.indexOf("sucht ein Auto")).toBeLessThan(html.indexOf("renoviert das Bad"));
  expect(html.indexOf("renoviert das Bad")).toBeLessThan(known);
  expect(html.indexOf("arbeitet bei Hornbach")).toBeGreaterThan(known);
  const none = renderToStaticMarkup(<FriendPage b={b} daysSince={null} />);
  expect(none).not.toContain("Gerade los");
  expect(none).not.toContain("Gut zu wissen");
});

