import { beforeEach, expect, test } from "vitest";
import { resetDbForTests, unchecked } from "../db/testing";
import { instance } from "../db/scope";
import { viewerById } from "../core/users";
import { InvalidInputError, NotFoundError } from "../core/errors";
import type { Viewer } from "../core/types";
import { seed, seedOtherBook, seedWorkBook, type Seed } from "../testing/fixtures";
import { acceptInvitationAs, invite } from "./invitations";
import { newBook, viewerIn } from "./books";
import { leaveBook } from "./manage";
import { createPerson } from "./people";
import { linkPeople, markNotSame, nameMatches, partsOf, sameAs, unlinkPerson } from "./links";

beforeEach(resetDbForTests);

const ids = (parts: { id: string }[]) => parts.map((p) => p.id);

async function withWork(): Promise<Seed & { a: Viewer; work: Viewer; lena2: string; boss: string }> {
  const s = await seed();
  return { ...s, ...(await seedWorkBook(s)) };
}

test("linking Lena in both books makes them one identity for Alice only", async () => {
  const s = await withWork();
  const parts = await linkPeople(s.a, [lena2Of(s), s.lena]);
  expect(parts.map((p) => [p.book.name, p.id])).toEqual([
    ["Unser Buch", s.lena],
    ["Arbeit", s.lena2],
  ]);
  const keys = await sameAs(s.a);
  expect(keys.get(s.lena)).toBeDefined();
  expect(keys.get(s.lena)).toBe(keys.get(s.lena2));
  expect(ids(await partsOf(s.a, s.lena2))).toEqual([s.lena, s.lena2]);
  expect((await sameAs(s.b)).has(s.lena)).toBe(false);
});

const lena2Of = (s: { lena2: string }) => s.lena2;

test("a member person can't be linked; nor two people of one book; nor someone outside the user's books", async () => {
  const s = await withWork();
  await expect(linkPeople(s.a, [s.b.personId, s.lena2])).rejects.toThrow(InvalidInputError);
  await expect(linkPeople(s.a, [s.anna, s.tom])).rejects.toThrow(/both in Unser Buch/);
  const { carl } = await seedOtherBook();
  await expect(linkPeople(s.a, [s.lena, carl])).rejects.toThrow(NotFoundError);
  await expect(linkPeople(s.a, [s.lena])).rejects.toThrow(InvalidInputError);
});

test("co-members are one identity by their user, without a link", async () => {
  const s = await withWork();
  const keys = await sameAs(s.a);
  expect(keys.get(s.b.personId)).toBe(`u:${s.b.userId}`);
  expect(keys.get(s.a.personId)).toBe(`u:${s.a.userId}`);
  expect(keys.has(s.anna)).toBe(false);
});

test("linking a third part joins the existing link; linking across two links merges them", async () => {
  const s = await withWork();
  const club = await clubOfAlice(s);
  const lena3 = await createPerson(club, { name: "Lena" });
  await linkPeople(s.a, [s.lena, s.lena2]);
  const a = (await viewerById(s.a.userId))!;
  await linkPeople(a, [lena3, s.lena2]);
  expect(ids(await partsOf(a, lena3))).toEqual([s.lena, s.lena2, lena3]);
  expect(new Set((await unchecked().selectFrom("person_links").select("id").execute()).map((r: { id: string }) => r.id)).size).toBe(1);
});

test("linking across two links that both have a part in one book is refused", async () => {
  const s = await withWork();
  const club = await clubOfAlice(s);
  const lena3 = await createPerson(club, { name: "Lena" });
  const boss3 = await createPerson(club, { name: "Chefin" });
  const a = (await viewerById(s.a.userId))!;
  await linkPeople(a, [s.lena, s.lena2]);
  await linkPeople(a, [lena3, s.anna]);
  // Lena of Unser Buch and Anna of Unser Buch would end up in one link: refused.
  await expect(linkPeople(a, [s.lena2, lena3])).rejects.toThrow(/both in Unser Buch/);
  await linkPeople(a, [boss3, s.boss]);
  expect(ids(await partsOf(a, s.boss))).toEqual([s.boss, boss3]);
});

test("unlinking one of two parts removes the link", async () => {
  const s = await withWork();
  await linkPeople(s.a, [s.lena, s.lena2]);
  await unlinkPerson(s.a, s.lena2);
  expect((await sameAs(s.a)).has(s.lena)).toBe(false);
  expect(await unchecked().selectFrom("person_links").select("id").execute()).toEqual([]);
  await expect(unlinkPerson(s.a, s.lena2)).rejects.toThrow(NotFoundError);
});

test("a deleted part leaves the link", async () => {
  const s = await withWork();
  await linkPeople(s.a, [s.lena, s.lena2]);
  await unchecked().deleteFrom("persons").where("id", "=", s.lena2).execute();
  expect(ids(await partsOf(s.a, s.lena))).toEqual([s.lena]);
  expect((await sameAs(s.a)).has(s.lena)).toBe(false);
});

test("a part in a book the user left drops out", async () => {
  const s = await withWork();
  const club = await clubOfAlice(s);
  const lena3 = await createPerson(club, { name: "Lena" });
  const a = (await viewerById(s.a.userId))!;
  await linkPeople(a, [s.lena, lena3]);
  await leaveBook(club);
  const after = (await viewerById(s.a.userId))!;
  expect(ids(await partsOf(after, s.lena))).toEqual([s.lena]);
  expect((await sameAs(after)).has(s.lena)).toBe(false);
});

test("nameMatches finds Lena in Arbeit for Lena, not after a no, not once linked, never a member person", async () => {
  const s = await withWork();
  expect((await nameMatches(s.a, s.lena)).map((m) => [m.id, m.book.name])).toEqual([[s.lena2, "Arbeit"]]);
  expect((await nameMatches(s.a, s.anna)).length).toBe(0);
  await markNotSame(s.a, s.lena2, s.lena);
  await markNotSame(s.a, s.lena, s.lena2);
  expect(await nameMatches(s.a, s.lena)).toEqual([]);
  expect(await nameMatches(s.a, s.lena2)).toEqual([]);
  // Linking after a no is still the user's to do, and drops the no.
  await linkPeople(s.a, [s.lena, s.lena2]);
  expect(await unchecked().selectFrom("person_not_same").selectAll().execute()).toEqual([]);
  await expect(markNotSame(s.a, s.lena, s.lena2)).rejects.toThrow(/unlink/);
  await expect(markNotSame(s.a, s.anna, s.tom)).rejects.toThrow(InvalidInputError);
  // Alice's own person in Arbeit has her name, but is her, not a match.
  const aliceHere = await createPerson(s.work, { name: "Alice" });
  expect((await nameMatches(s.a, aliceHere)).map((m) => m.id)).not.toContain(s.a.personId);
});

test("B never sees A's links or A's no", async () => {
  const s = await withWork();
  const before = [...(await sameAs(s.b))];
  await linkPeople(s.a, [s.lena, s.lena2]);
  await markNotSame(s.a, s.anna, s.boss);
  expect([...(await sameAs(s.b))]).toEqual(before);
  expect(ids(await partsOf(s.b, s.lena))).toEqual([s.lena]);
});

// Bob's book Club, which Alice joins as a member; her viewer there.
async function clubOfAlice(s: Seed): Promise<Viewer> {
  const club = await newBook(s.b, "Club");
  const bInClub = (await viewerIn(await instance(), s.b.userId, club.id))!;
  const { url } = await invite(bInClub, "member");
  await acceptInvitationAs(s.a, url.split("/").pop()!);
  return (await viewerIn(await instance(), s.a.userId, club.id))!;
}
