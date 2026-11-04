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
import { dueAcross, findAcross, groupsAcross, memberUsers, orbitAcross, peopleAcross, ramblesAcross, searchAcross } from "./across";
import { linkPeople } from "../people/links";
import { createPerson } from "../people/people";
import { setCheckInInterval } from "../people/intervals";
import { today } from "../people/dates";
import { recordConversation } from "../conversations/conversations";

// The orbit reads the last months from now; the seed's conversations are in October 2026.
const NOW = Date.parse("2026-10-25T12:00:00Z");
import { addFollowUp } from "./followups";

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

test("orbit across books holds faces of both, each with its book, at most 24", async () => {
  const s = await seed();
  const { a, lena2 } = await seedWorkBook(s);
  const faces = await orbitAcross(a, undefined, NOW);
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

test("each book keeps its groups: Freunde of two books are two, each with its book", async () => {
  const s = await seed();
  const { a } = await seedWorkBook(s);
  const freunde = (await groupsAcross(a)).filter((g) => g.name === "Freunde");
  expect(freunde.map((g) => g.book.name)).toEqual(["Unser Buch", "Arbeit"]);
  expect(new Set(freunde.map((g) => g.id)).size).toBe(2);
});

test("a private membership doesn't count", async () => {
  const s = await seed();
  await addToGroup(s.a, { name: "Freunde", members: [s.anna], visibility: "shared" });
  await addToGroup(s.b, { name: "Freunde", members: [s.tom], visibility: "private" });
  expect((await groupsAcross(s.a)).find((g) => g.name === "Freunde")!.count).toBe(1);
  expect((await groupsAcross(s.b)).find((g) => g.name === "Freunde")!.count).toBe(2);
});

test("orbit filtered by one book's Freunde marks only that book's", async () => {
  const s = await seed();
  const { a, work, lena2 } = await seedWorkBook(s);
  await addToGroup(s.a, { name: "Freunde", members: [s.anna], visibility: "shared" });
  await addToGroup(work, { name: "Freunde", members: [lena2], visibility: "shared" });
  const workFriends = (await listGroups(work)).find((g) => g.name === "Freunde")!;
  const faces = await orbitAcross(a, workFriends.id, NOW);
  expect(faces.find((f) => f.personId === lena2)?.inGroup).toBe(true);
  expect(faces.find((f) => f.personId === s.anna)?.inGroup).toBe(false);
});

test("a co-member in a group of a newer book only is in it on the merged lists", async () => {
  const s = await seed();
  const { a, work } = await seedWorkBook(s);
  await bInWork(work, s);
  const bThere = (await viewerIn(await instance(), s.b.userId, work.bookId))!.personId;
  await addToGroup(work, { name: "Freunde", members: [bThere], visibility: "shared" });
  const workFriends = (await listGroups(work)).find((g) => g.name === "Freunde")!;
  const users = await memberUsers(a);
  const b = (await peopleAcross(a)).find((p) => users.get(p.id) === s.b.userId)!;
  expect(b.groups).toContain(workFriends.id);
  const face = (await orbitAcross(a, workFriends.id, NOW)).find((f) => users.get(f.personId) === s.b.userId);
  expect(face?.inGroup).toBe(true);
});

test("a linked person shows once in Leute, with both parts and both books' groups", async () => {
  const s = await seed();
  const { a, work, lena2 } = await seedWorkBook(s);
  await addToGroup(s.a, { name: "Freunde", members: [s.lena], visibility: "shared" });
  await addToGroup(work, { name: "Freunde", members: [lena2], visibility: "shared" });
  await linkPeople(a, [s.lena, lena2]);
  const lenas = (await peopleAcross(a)).filter((p) => p.name === "Lena");
  expect(lenas).toHaveLength(1);
  expect(lenas[0].id).toBe(s.lena);
  expect(lenas[0].parts.map((p) => [p.book.name, p.id])).toEqual([
    ["Unser Buch", s.lena],
    ["Arbeit", lena2],
  ]);
  const freunde = (await groupsAcross(a)).filter((g) => g.name === "Freunde").map((g) => g.id);
  expect(lenas[0].groups.sort()).toEqual(freunde.sort());
  // Unlinked, everyone has one part.
  expect((await peopleAcross(a)).find((p) => p.name === "Anna")!.parts).toHaveLength(1);
});

test("a linked person's birthday in both books is one reminder; two different birthdays are two, each with its book", async () => {
  const s = await seed();
  const { a, work, lena2 } = await seedWorkBook(s);
  await linkPeople(a, [s.lena, lena2]);
  await remember(s.a, { visibility: "shared", dates: [{ person: s.lena, kind: "birthday", date: "--11-05", yearly: true }] });
  await remember(work, { visibility: "shared", dates: [{ person: lena2, kind: "birthday", date: "--11-05", yearly: true }] });
  const lena = (d: { personId: string }) => d.personId === s.lena || d.personId === lena2;
  expect((await dueAcross(a, "2026-11-01")).filter((d) => d.kind === "date" && lena(d))).toHaveLength(1);
  await remember(work, { visibility: "shared", dates: [{ person: lena2, kind: "anniversary", date: "--11-06", yearly: true, label: "Jahrestag" }] });
  const two = (await dueAcross(a, "2026-11-01")).filter((d) => d.kind === "date" && lena(d));
  expect(two.map((d) => d.book.name)).toEqual(["Unser Buch", "Arbeit"]);
});

test("the orbit holds a linked person once", async () => {
  const s = await seed();
  const { a, work } = await seedWorkBook(s);
  const anna2 = await createPerson(work, { name: "Anna" });
  const isAnna = (f: { personId: string }) => f.personId === s.anna || f.personId === anna2;
  expect((await orbitAcross(a, undefined, NOW)).filter(isAnna)).toHaveLength(2);
  await linkPeople(a, [s.anna, anna2]);
  expect((await orbitAcross(a, undefined, NOW)).filter(isAnna).map((f) => f.personId)).toEqual([s.anna]);
});

test("findAcross gives Lena once when linked, twice (each with her book) when not", async () => {
  const s = await seed();
  const { a, lena2 } = await seedWorkBook(s);
  expect((await findAcross(a, "Lena")).map((c) => [c.id, c.book.name])).toEqual([
    [s.lena, "Unser Buch"],
    [lena2, "Arbeit"],
  ]);
  await linkPeople(a, [s.lena, lena2]);
  const once = await findAcross(a, "Lena");
  expect(once.map((c) => c.id)).toEqual([s.lena]);
  expect(once[0].parts.map((p) => p.id)).toEqual([s.lena, lena2]);
});

test("findAcross keeps an exact match of a newer book behind five namesakes of the oldest", async () => {
  const s = await seed();
  const { a, work } = await seedWorkBook(s);
  for (const n of ["Lenara", "Lenard", "Lenja", "Lenore", "Lenny"]) await createPerson(s.a, { name: n });
  const len = await createPerson(work, { name: "Len" });
  expect((await findAcross(a, "Len")).map((c) => c.id)).toContain(len);
});

test("a linked person seen lately in one book isn't overdue from the other", async () => {
  const s = await seed();
  const { a, work } = await seedWorkBook(s);
  await setCheckInInterval(s.a, s.anna, 3, true);
  const met = await recordConversation(work, {
    date: today(),
    kind: "call",
    summary: "Called Anna.",
    transcript: "Called Anna.",
    visibility: "shared",
    people: [{ name: "Anna", present: true, confirmedNew: true }],
  });
  const overdueAnna = async () => (await dueAcross(a, today())).filter((d) => d.kind === "overdue" && d.name === "Anna");
  expect(await overdueAnna()).toHaveLength(1);
  await linkPeople(a, [s.anna, met.people[0].id]);
  expect(await overdueAnna()).toEqual([]);
});

test("an open overdue follow-up for one part of a linked person keeps them from being overdue in the other book", async () => {
  const s = await seed();
  const { a, work, lena2 } = await seedWorkBook(s);
  await setCheckInInterval(s.a, s.lena, 7, true);
  await setCheckInInterval(work, lena2, 7, true);
  await linkPeople(a, [s.lena, lena2]);
  const isLena = (d: { kind: string; personId: string }) => d.kind === "overdue" && (d.personId === s.lena || d.personId === lena2);
  const before = (await dueAcross(a, "2026-11-10")).filter(isLena);
  expect(before).toHaveLength(1);
  // The follow-up is in the book whose item was kept, so the other book's would come through without the link check.
  const there = (await viewerIn(await instance(), a.userId, before[0].book.id))!;
  await addFollowUp(there, { kind: "overdue", personId: before[0].personId, day: "2026-11-03" });
  expect((await dueAcross(a, "2026-11-10")).filter(isLena)).toEqual([]);
});
