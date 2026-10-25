import { beforeEach, expect, test } from "vitest";
import { seed, type Seed } from "./testing/fixtures";
import { TOOLS, toolByName } from "./tools";

let s: Seed;

beforeEach(async () => {
  s = await seed();
});

test("one table holds every tool the MCP endpoint offers", () => {
  expect(TOOLS.map((t) => t.name).sort()).toEqual(["briefing", "correct", "find_person", "get_transcript", "groups", "record_conversation", "relate", "set_interval", "whats_due"]);
});

test("a tool runs as the viewer and answers with paths, not absolute urls", async () => {
  const r = (await toolByName("find_person")!.run(s.a, { name: "Anna" })) as { people: { url: string }[] };
  expect(r.people[0].url).toBe(`/p/${s.anna}`);
  expect(toolByName("nope")).toBeUndefined();
});
