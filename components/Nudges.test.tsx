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

test("a situation names what was asked, a session its series and the session day", () => {
  const situation = renderToStaticMarkup(
    <Nudges items={[]} followUps={[{ ...followUp, kind: "situation", factId: "x", text: "Umzug", url: "/people/anna/facts/x" }]} />,
  );
  expect(situation).toContain("Umzug");
  expect(situation).toContain("was daraus wurde");
  const session = renderToStaticMarkup(
    <Nudges items={[]} followUps={[{ ...followUp, kind: "session", name: "Lauftreff", seriesId: "s", sessionDay: "2026-10-28", url: "/series/s" }]} />,
  );
  expect(session).toContain("Lauftreff");
  expect(session).toContain("28. Oktober");
  expect(session).not.toContain("3. November");
});

test("nothing to show renders nothing", () => {
  expect(renderToStaticMarkup(<Nudges items={[]} followUps={[]} />)).toBe("");
});
