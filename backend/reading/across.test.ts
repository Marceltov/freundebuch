import { beforeEach, expect, test } from "vitest";
import { resetDbForTests } from "../db/testing";
import { viewerById } from "../core/users";
import type { Viewer } from "../core/types";
import { acceptInvitationAs, invite } from "../people/invitations";
import { addToGroup } from "../people/relationships";
import { listGroups } from "../people/groups";
import { peopleOverview } from "../people/people";
import { seed, seedWorkBook, type Seed } from "../testing/fixtures";
import { groupIdsFor, groupsAcross, memberUsers, peopleAcross } from "./across";

beforeEach(resetDbForTests);

// B joins A's work book, so B is a member of both books.
async function bInWork(work: Viewer, s: Seed): Promise<Viewer> {
  const { url } = await invite(work, "member");
  await acceptInvitationAs(s.b, url.split("/").pop()!);
  return (await viewerById(s.b.userId))!;
}

test("one book reads as before", async () => {
  const s = await seed();
  const people = await peopleAcross(s.a);
  expect(people.map((p) => p.id)).toEqual((await peopleOverview(s.a)).map((p) => p.id));
  expect(new Set(people.map((p) => p.book.name))).toEqual(new Set(["Unser Buch"]));
});

test("people from both books, each with its book", async () => {
  const s = await seed();
  const { a, lena2, boss } = await seedWorkBook(s);
  const book = new Map((await peopleAcross(a)).map((p) => [p.id, p.book.name]));
  expect(book.get(s.anna)).toBe("Unser Buch");
  expect(book.get(lena2)).toBe("Arbeit");
  expect(book.get(boss)).toBe("Arbeit");
});

test("a co-member in both books shows once", async () => {
  const s = await seed();
  const { a, work } = await seedWorkBook(s);
  await bInWork(work, s);
  const users = await memberUsers(a);
  const ofB = (await peopleAcross(a)).filter((p) => users.get(p.id) === s.b.userId);
  expect(ofB).toHaveLength(1);
  expect(ofB[0].book.name).toBe("Unser Buch");
});

test("groups with one name merge, the household is one", async () => {
  const s = await seed();
  const { a, work } = await seedWorkBook(s);
  const groups = await groupsAcross(a);
  expect(groups.filter((g) => g.key === "freunde")).toHaveLength(1);
  expect(groups.find((g) => g.key === "freunde")!.ids).toHaveLength(2);
  expect(groups.filter((g) => g.household)).toHaveLength(1);
  const workFriends = (await listGroups(work)).find((g) => g.name === "Freunde")!;
  expect(await groupIdsFor(a, workFriends.id)).toEqual(await groupIdsFor(a, "freunde"));
});

test("a private membership doesn't count", async () => {
  const s = await seed();
  const { a, work, lena2 } = await seedWorkBook(s);
  await addToGroup(s.a, { name: "Freunde", members: [s.anna], visibility: "shared" });
  await addToGroup(work, { name: "Freunde", members: [lena2], visibility: "shared" });
  await addToGroup(s.b, { name: "Freunde", members: [s.tom], visibility: "private" });
  expect((await groupsAcross(a)).find((g) => g.key === "freunde")!.count).toBe(2);
  // B sees their own private membership.
  expect((await groupsAcross(s.b)).find((g) => g.key === "freunde")!.count).toBe(2);
});
