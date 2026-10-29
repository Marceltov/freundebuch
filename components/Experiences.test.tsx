import { renderToStaticMarkup } from "react-dom/server";
import { expect, test, vi } from "vitest";
import type { ExperienceView } from "@/backend";
import { ExperienceItem, SeriesDays } from "./Experiences";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh() {}, push() {} }) }));

const lesson = (over: Partial<ExperienceView> = {}): ExperienceView => ({
  id: "e1",
  date: "2026-10-28",
  kind: "Kurs",
  title: "Erste Stunde Hundeschule",
  summary: "Sitz und Platz geübt",
  place: { id: "o1", name: "Hundeschule Pfotenglück", url: "/o/o1" },
  series: { id: "s1", name: "Hundeschule mit Toffee", url: "/s/s1" },
  people: [{ id: "p1", name: "Sybille", url: "/p/p1" }],
  rambleId: "r1",
  visibility: "shared",
  mine: true,
  url: "/s/s1#experience-e1",
  ...over,
});

test("an experience shows its day, kind, title, place, series and people as links, and a lock while private", () => {
  const html = renderToStaticMarkup(<ExperienceItem e={lesson()} />);
  expect(html).toContain('id="experience-e1"');
  for (const href of ["/o/o1", "/s/s1", "/p/p1", "/r/r1"]) expect(html).toContain(`href="${href}"`);
  expect(html).toContain("Erste Stunde Hundeschule");
  expect(html).not.toContain("Nur für dich");
  expect(renderToStaticMarkup(<ExperienceItem e={lesson({ visibility: "private" })} />)).toContain("Nur für dich");
  // On its series page the series link would point at itself.
  expect(renderToStaticMarkup(<ExperienceItem e={lesson()} series={false} />)).not.toContain('href="/s/s1"');
});

test("a series' days: missing ones say they weren't told, skipped ones say so", () => {
  const html = renderToStaticMarkup(<SeriesDays missed={["2026-11-04"]} skipped={["2026-11-11"]} />);
  expect(html).toContain("noch nicht erzählt");
  expect(html).toContain("ausgelassen");
});
