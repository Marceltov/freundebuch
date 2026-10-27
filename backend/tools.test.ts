import { beforeEach, expect, test } from "vitest";
import { seed, type Seed } from "./testing/fixtures";
import { TOOLS, toolByName } from "./tools";

let s: Seed;

beforeEach(async () => {
  s = await seed();
});

test("one table holds every tool the MCP endpoint offers", () => {
  expect(TOOLS.map((t) => t.name).sort()).toEqual(["briefing", "calendar_feed", "correct", "find_person", "get_transcript", "groups", "record_conversation", "relate", "remember", "set_interval", "whats_due"]);
});

test("a tool runs as the viewer and answers with paths, not absolute urls", async () => {
  const r = (await toolByName("find_person")!.run(s.a, { name: "Anna" })) as { people: { url: string }[] };
  expect(r.people[0].url).toBe(`/p/${s.anna}`);
  expect(toolByName("nope")).toBeUndefined();
});

test("the descriptions tell Claude to file roles in words, to agree a situation's new day, and gender only when said", () => {
  const all = (name: string) => JSON.stringify([toolByName(name)!.description, toolByName(name)!.input.toJSONSchema()]);
  for (const name of ["relate", "record_conversation", "correct"]) for (const word of ["Vermieterin", "inverse", '\\"us\\"']) expect(all(name), `${name} ${word}`).toContain(word);
  for (const name of ["remember", "record_conversation"]) for (const word of ["situation", "checkAfter", "agree it with the user"]) expect(all(name), `${name} ${word}`).toContain(word);
  for (const name of ["correct", "record_conversation", "remember"]) expect(all(name), name).toContain("never from the name");
  expect(all("correct")).toContain("relabel");
  expect(toolByName("briefing")!.description).toContain("roles");
});
