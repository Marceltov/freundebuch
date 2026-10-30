import { renderToStaticMarkup } from "react-dom/server";
import { expect, test, vi } from "vitest";
import type { JournalEntry } from "@/backend";
import { canEdit } from "./ItemActions";
import { Journal, JournalItem } from "./Journal";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh() {}, push() {} }) }));

const entry = (over: Partial<JournalEntry> = {}): JournalEntry => ({
  id: "e1",
  date: "2026-10-29",
  text: "Ich frage mich, ob ich den Job wechseln will.",
  people: [{ id: "p1", name: "Anna", url: "/p/p1" }],
  rambleId: "r1",
  visibility: "private",
  mine: true,
  url: "/tagebuch#journal-e1",
  ...over,
});

test("the journal lists entries by month, newest first, with people links, the ramble and a lock while private", () => {
  const html = renderToStaticMarkup(
    <Journal entries={[entry(), entry({ id: "e2", date: "2026-09-03", text: "Urlaub war gut.", people: [], visibility: "shared" })]} />,
  );
  expect(html.indexOf("Oktober 2026")).toBeLessThan(html.indexOf("September 2026"));
  expect(html).toContain('id="journal-e1"');
  expect(html).toContain('href="/p/p1"');
  expect(html).toContain('href="/r/r1"');
  expect(html.match(/Nur für dich/g)).toHaveLength(1);
  // The writer's menu, where an entry is shared or made private again.
  expect(html).toContain("Aktionen");
});

test("an empty journal says how it fills", () => {
  expect(renderToStaticMarkup(<Journal entries={[]} />)).toContain("Noch nichts im Tagebuch");
});

test("only the writer changes an entry: no menu on the partner's shared one", () => {
  expect(renderToStaticMarkup(<JournalItem e={entry({ mine: false, visibility: "shared" })} />)).not.toContain("Aktionen");
  expect(canEdit("journal_entries", false, "shared")).toBe(false);
  expect(canEdit("journal_entries", true, "private")).toBe(true);
});
