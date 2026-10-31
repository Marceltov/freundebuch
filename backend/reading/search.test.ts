import { beforeEach, expect, test } from "vitest";
import { remember } from "../conversations/conversations";
import { InvalidInputError } from "../core/errors";
import { markMatches, search, snippet, searchWords } from "./search";
import { seed, type Seed } from "../testing/fixtures";

let s: Seed;

beforeEach(async () => {
  s = await seed();
});

const kinds = async (v: Seed["a"], q: string) => (await search(v, q)).map((h) => h.kind).sort();

test("a word finds what was told: the transcript, the conversation and the item", async () => {
  const hits = await search(s.a, "hiking");
  expect(hits.map((h) => h.kind).sort()).toEqual(["fact", "transcript"]);
  expect(hits.find((h) => h.kind === "fact")).toMatchObject({
    text: "likes hiking",
    people: ["Anna"],
    url: expect.stringMatching(new RegExp(`^/p/${s.anna}#`)),
  });
  expect(hits.find((h) => h.kind === "transcript")).toMatchObject({ date: "2026-10-15", url: expect.stringMatching(/^\/r\//) });
  expect(await kinds(s.a, "weekend")).toEqual(["conversation", "transcript"]);
});

test("every word must occur, folded: case, umlauts and accents don't matter", async () => {
  await remember(s.a, { visibility: "shared", facts: [{ person: s.anna, text: "Hat einen Spiegel in Hellengerst gekauft", category: "other" }] });
  expect(await kinds(s.a, "spiegel HELLENGERST")).toEqual(["fact"]);
  expect(await kinds(s.a, "spiegel tokio")).toEqual([]);
  await remember(s.a, { visibility: "shared", facts: [{ person: s.anna, text: "Mag Brötchen", category: "other" }] });
  expect(await kinds(s.a, "broetchen")).toEqual(["fact"]);
});

test("the partner's private items never match, nor a transcript they may not read (V2)", async () => {
  // A's dinner holds private parts, so its transcript is A's alone; the divorce is A's private fact; the coffee is private.
  expect(await kinds(s.a, "divorce")).toEqual(["fact", "transcript"]);
  expect(await search(s.b, "divorce")).toEqual([]);
  expect(await search(s.b, "museum")).toEqual([]);
  expect(await search(s.b, "quitting")).toEqual([]);
  expect(await search(s.b, "Lena")).toEqual([]);
  expect(await kinds(s.a, "quitting")).toEqual(["fact", "transcript"]);
  // What is shared in the dinner, B finds.
  expect(await kinds(s.b, "new job")).toEqual(["conversation", "fact"]);
});

test("a place is found by its name", async () => {
  expect((await search(s.a, "luigi")).map((h) => [h.kind, h.text])).toContainEqual(["place", "Luigi's"]);
});

test("a long text is cut around the first match; an empty query is refused", async () => {
  const long = `${"vorher ".repeat(40)}der Spiegel ${"nachher ".repeat(40)}`;
  const cut = snippet(long, searchWords("spiegel"));
  expect(cut).toMatch(/^….*Spiegel.*…$/);
  expect(cut.length).toBeLessThanOrEqual(165);
  expect(snippet("kurz", ["kurz"])).toBe("kurz");
  await expect(search(s.a, "   ")).rejects.toThrow(InvalidInputError);
});

test("at most `limit` hits", async () => {
  expect(await search(s.a, "anna", 2)).toHaveLength(2);
});

test("the words holding a match are marked, the rest left as it was", () => {
  expect(markMatches("Der Spiegel hing über Brötchen.", "spiegel broetchen")).toEqual([
    { text: "Der ", mark: false },
    { text: "Spiegel", mark: true },
    { text: " hing über ", mark: false },
    { text: "Brötchen", mark: true },
    { text: ".", mark: false },
  ]);
  expect(markMatches("nichts", "spiegel")).toEqual([{ text: "nichts", mark: false }]);
});
