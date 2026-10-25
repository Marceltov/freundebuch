import { expect, test } from "vitest";
import { recentTurns } from "./chatTurns";

const turns = (n: number) => Array.from({ length: n }, (_, i) => ({ role: i % 2 ? ("assistant" as const) : ("user" as const), content: `t${i}` }));

test("a long chat sends only its last 40 turns, starting with one of the user's", () => {
  const sent = recentTurns(turns(45));
  expect(sent.length).toBeLessThanOrEqual(40);
  expect(sent[0].role).toBe("user");
  expect(sent[sent.length - 1].content).toBe("t44");
});

test("and at most 250,000 characters, dropping the oldest turns first", () => {
  const long = [
    { role: "user" as const, content: "a".repeat(200_000) },
    { role: "assistant" as const, content: "ok", filed: true },
    { role: "user" as const, content: "b".repeat(100_000) },
  ];
  expect(recentTurns(long).map((t) => t.content.slice(0, 1))).toEqual(["b"]);
});

test("a short chat goes as it is, filed marks included", () => {
  const t = [
    { role: "user" as const, content: "x" },
    { role: "assistant" as const, content: "Erfasst.", filed: true },
    { role: "user" as const, content: "y" },
  ];
  expect(recentTurns(t)).toEqual(t);
});
