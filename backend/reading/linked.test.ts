import { beforeEach, expect, test } from "vitest";
import { resetDbForTests } from "../db/testing";
import { remember } from "../conversations/conversations";
import { linkPeople, markNotSame } from "../people/links";
import { addRelationship } from "../people/relationships";
import { seed, seedWorkBook } from "../testing/fixtures";
import { linkedBriefing } from "./linked";
import { acceptInvitationAs, invite } from "../people/invitations";

beforeEach(resetDbForTests);

async function linked() {
  const s = await seed();
  const w = await seedWorkBook(s);
  await remember(s.a, { visibility: "shared", facts: [{ person: s.lena, text: "plays the cello", category: "hobby" }] });
  return { s, ...w };
}

test("a linked person's briefing holds both books' facts, each with its book", async () => {
  const { s, a, lena2 } = await linked();
  await linkPeople(a, [s.lena, lena2]);
  for (const id of [s.lena, lena2]) {
    const b = await linkedBriefing(a, id);
    expect(b.person.id).toBe(s.lena);
    expect(b.parts.map((p) => [p.book.name, p.id])).toEqual([
      ["Unser Buch", s.lena],
      ["Arbeit", lena2],
    ]);
    const known = new Map(b.known.map((f) => [f.text, f.book?.name]));
    expect(known.get("plays the cello")).toBe("Unser Buch");
    expect(known.get("leads the launch")).toBe("Arbeit");
  }
});

test("an unlinked person's briefing is the book's briefing with one part", async () => {
  const { s, a } = await linked();
  const b = await linkedBriefing(a, s.lena);
  expect(b.parts).toEqual([{ book: { id: s.a.bookId, name: "Unser Buch" }, id: s.lena }]);
  expect(b.known.some((f) => "book" in f)).toBe(false);
  expect(b.known.map((f) => f.text)).not.toContain("leads the launch");
});

test("a part's private item of the other user stays out", async () => {
  const { s, a, lena2 } = await linked();
  await remember(s.b, { visibility: "private", facts: [{ person: s.lena, text: "secretly moving away", category: "other" }] });
  await linkPeople(a, [s.lena, lena2]);
  expect(JSON.stringify(await linkedBriefing(a, lena2))).not.toContain("secretly moving away");
});

test("sameAsAsk names Lena in Arbeit until linked or answered no", async () => {
  const { s, a, lena2 } = await linked();
  expect((await linkedBriefing(a, s.lena)).sameAsAsk.map((m) => [m.id, m.book.name])).toEqual([[lena2, "Arbeit"]]);
  await markNotSame(a, s.lena, lena2);
  expect((await linkedBriefing(a, s.lena)).sameAsAsk).toEqual([]);
});

test("the network of a linked person joins both books, the user and a writer in both once", async () => {
  const { s, a, work, lena2, boss } = await linked();
  await addRelationship(s.a, { from: s.lena, to: "us", label: "Nachbarin", inverse: "Nachbar:in", visibility: "shared" });
  await addRelationship(work, { from: lena2, to: boss, label: "Kollegin", inverse: "Chefin", visibility: "shared" });
  await linkPeople(a, [s.lena, lena2]);
  const n = (await linkedBriefing(a, lena2)).network;
  expect(n.nodes.map((x) => [x.id, x.role])).toEqual([
    [s.lena, "self"],
    [s.a.personId, "writer"],
    [s.b.personId, "writer"],
    [boss, "other"],
  ]);
  expect(n.edges.every((e) => n.nodes.some((x) => x.id === e.from) && n.nodes.some((x) => x.id === e.to))).toBe(true);
  expect(new Set(n.edges.map((e) => e.book?.name))).toEqual(new Set(["Unser Buch", "Arbeit"]));
});

test("a person in none of the user's books is not found", async () => {
  const { a } = await linked();
  await expect(linkedBriefing(a, "00000000-0000-0000-0000-000000000000")).rejects.toThrow();
});

test("linked says whether the parts come from the user's link, not from a writer of several books", async () => {
  const { s, a, work, lena2 } = await linked();
  const { url } = await invite(work, "member");
  await acceptInvitationAs(s.b, url.split("/").pop()!);
  const bob = await linkedBriefing(a, s.b.personId);
  expect(bob.parts).toHaveLength(2);
  expect(bob.linked).toBe(false);
  await linkPeople(a, [s.lena, lena2]);
  expect((await linkedBriefing(a, s.lena)).linked).toBe(true);
});
