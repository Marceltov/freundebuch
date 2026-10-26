import { renderToStaticMarkup } from "react-dom/server";
import { expect, test } from "vitest";
import type { Briefing } from "@/backend";
import { layoutNetwork, Network } from "./Network";

type Net = Briefing["network"];
const node = (id: string, name: string, role: "self" | "household" | "other", gender: "female" | "male" | null = null) => ({ id, name, role, gender, url: `/p/${id}` });
const edge = (id: string, from: string, to: string, type: Net["edges"][number]["type"], note: string | null = null) => ({ id, from, to, type, note });

const marina = node("m", "Marina Reichardt", "self", "female");
const others = (n: number) => Array.from({ length: n }, (_, i) => node(`o${i}`, `Person${i} Langername`, "other"));
const net = (n: number, household = ["a"]): Net => ({
  nodes: [marina, ...household.map((h) => node(h, h === "a" ? "Marcel" : "Sybille", "household", "male")), ...others(n)],
  edges: [...household.map((h) => edge(`h-${h}`, "m", h, "landlord")), ...others(n).map((o, i) => edge(`e${i}`, i % 2 ? o.id : "m", i % 2 ? "m" : o.id, i % 3 ? "parent" : "spouse"))],
});

test("draws one line per edge with its label, and leaves out who isn't connected", () => {
  const html = renderToStaticMarkup(<Network network={net(2)} viewerPersonId="a" />);
  expect(html.match(/<line /g)).toHaveLength(3);
  expect(html).toContain("Du");
  expect(html).not.toContain("Sybille");
  expect(html.match(/data-edge-label/g)).toHaveLength(3);
  expect(html).toContain(">Vermieterin<");
  expect(html).toContain('href="/p/o0"');
  expect(renderToStaticMarkup(<Network network={net(6)} viewerPersonId="a" />)).toBe("");
});

test("labels never overlap each other, a node or a name", () => {
  for (const household of [["a"], ["a", "b"]])
    for (let n = 0; n <= 5; n++) {
      const l = layoutNetwork(net(n, household), "a");
      expect(l, `${n} others`).not.toBeNull();
      const boxes = [...l!.pills, ...l!.names, ...l!.nodes.map((x) => ({ x: x.x - x.r, y: x.y - x.r, w: 2 * x.r, h: 2 * x.r }))];
      for (let i = 0; i < boxes.length; i++)
        for (let j = i + 1; j < boxes.length; j++) {
          const [p, q] = [boxes[i], boxes[j]];
          const apart = p.x + p.w + 4 <= q.x || q.x + q.w + 4 <= p.x || p.y + p.h + 4 <= q.y || q.y + q.h + 4 <= p.y;
          expect(apart, `${household.length} household, ${n} others: ${JSON.stringify([p, q])}`).toBe(true);
        }
      for (const b of boxes) expect(b.x >= 0 && b.x + b.w <= 360).toBe(true);
    }
});

test("the line to the household names what the person is to us; a line below names what the other is to them", () => {
  const l = layoutNetwork(
    { nodes: [marina, node("a", "Marcel", "household"), node("k", "Leo", "other", "male"), node("t", "Tom", "other")], edges: [edge("1", "m", "a", "landlord"), edge("2", "m", "k", "parent"), edge("3", "t", "m", "other", "Patenonkel")] },
    "a",
  )!;
  expect(l.pills.map((p) => p.text)).toEqual(["Vermieterin", "Sohn", "Patenonkel"]);
});
