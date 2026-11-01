import { beforeEach, expect, test } from "vitest";
import { resetDbForTests } from "../db/testing";
import { viewerById } from "../core/users";
import type { Viewer } from "../core/types";
import { acceptInvitationAs, invite } from "../people/invitations";
import { addToGroup } from "../people/relationships";
import { listGroups } from "../people/groups";
import { peopleOverview } from "../people/people";
import { seed, seedWorkBook, type Seed } from "../testing/fixtures";
import { instance } from "../db/scope";
import { viewerIn } from "../people/books";
import { remember } from "../conversations/conversations";
import { orbit } from "../people/orbit";
import { compareDue } from "./due";
import { dueAcross, groupIdsFor, groupsAcross, memberUsers, orbitAcross, peopleAcross, ramblesAcross, searchAcross } from "./across";

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

test("orbit across books holds faces of both, each with its book, at most 24", async () => {
  const s = await seed();
  const { a, lena2 } = await seedWorkBook(s);
  const faces = await orbitAcross(a);
  expect(faces.find((f) => f.personId === lena2)?.book.name).toBe("Arbeit");
  expect(faces.find((f) => f.personId === s.anna)?.book.name).toBe("Unser Buch");
  expect(faces.length).toBeLessThanOrEqual(24);
  for (const f of faces) expect(f.angle >= 0 && f.angle < 360).toBe(true);
});

test("a one-book orbit is unchanged", async () => {
  const s = await seed();
  const now = Date.parse("2026-10-25T12:00:00Z");
  expect((await orbitAcross(s.a, undefined, now)).map(({ book: _, ...f }) => f)).toEqual(await orbit(s.a, now)); // eslint-disable-line @typescript-eslint/no-unused-vars
});

test("orbit filtered by Freunde shows the Freunde of both books", async () => {
  const s = await seed();
  const { a, work, lena2 } = await seedWorkBook(s);
  await addToGroup(s.a, { name: "Freunde", members: [s.anna], visibility: "shared" });
  await addToGroup(work, { name: "Freunde", members: [lena2], visibility: "shared" });
  const faces = await orbitAcross(a, "freunde");
  expect(faces.find((f) => f.personId === s.anna)?.inGroup).toBe(true);
  expect(faces.find((f) => f.personId === lena2)?.inGroup).toBe(true);
});

test("a co-member's birthday is one reminder", async () => {
  const s = await seed();
  const { a, work } = await seedWorkBook(s);
  await bInWork(work, s);
  const bThere = (await viewerIn(await instance(), s.b.userId, work.bookId))!.personId;
  await remember(s.a, { visibility: "shared", dates: [{ person: s.b.personId, kind: "birthday", date: "--11-05", yearly: true }] });
  await remember(work, { visibility: "shared", dates: [{ person: bThere, kind: "birthday", date: "--11-05", yearly: true }] });
  const users = await memberUsers(a);
  const due = (await dueAcross(a, "2026-11-01")).filter((d) => d.kind === "date" && users.get(d.personId) === s.b.userId);
  expect(due).toHaveLength(1);
});

test("A's private items never show in B's merged lists", async () => {
  const s = await seed();
  expect((await dueAcross(s.a, "2026-10-23")).map((d) => d.personId)).toContain(s.tom);
  expect((await dueAcross(s.b, "2026-10-23")).map((d) => d.personId)).not.toContain(s.tom);
  expect(await searchAcross(s.b, "divorce")).toEqual([]);
  expect((await ramblesAcross(s.b)).map((r) => r.id)).not.toContain(s.coffee);
  expect(JSON.stringify(await ramblesAcross(s.b))).not.toContain("divorce");
});

test("within one book, two promises alike both stay due", async () => {
  const s = await seed();
  await remember(s.b, {
    visibility: "shared",
    promises: [
      { person: s.a.personId, text: "Brot holen", due: "2026-11-03", byMe: true },
      { person: s.a.personId, text: "Brot holen", due: "2026-11-03", byMe: true },
    ],
  });
  const due = (await dueAcross(s.b, "2026-11-01")).filter((d) => d.kind === "promise");
  expect(due).toHaveLength(2);
  expect(compareDue(due[0], due[1])).toBe(0);
});
