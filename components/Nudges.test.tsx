import { renderToStaticMarkup } from "react-dom/server";
import { expect, test, vi } from "vitest";
import type { FollowUp } from "@/backend";
import { Nudges } from "./Nudges";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh() {} }) }));

const followUp: FollowUp = {
  id: "f1",
  kind: "overdue",
  personId: "anna",
  name: "Anna",
  factId: null,
  seriesId: null,
  sessionDay: null,
  day: "2026-11-03",
  text: null,
  url: "/people/anna",
};

test("an open follow-up is a line linking to the person", () => {
  const html = renderToStaticMarkup(<Nudges items={[]} followUps={[followUp]} />);
  expect(html).toContain('href="/people/anna"');
  expect(html).toContain("Anna");
  expect(html).toContain("3. November");
  expect(html).toContain("Claude");
});

test("nothing to show renders nothing", () => {
  expect(renderToStaticMarkup(<Nudges items={[]} followUps={[]} />)).toBe("");
});
