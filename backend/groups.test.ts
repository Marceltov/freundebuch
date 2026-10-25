import { beforeEach, expect, test } from "vitest";
import { db } from "./db/testing";
import { NotFoundError } from "./errors";
import { findGroup, getGroup, listGroups, resolveOrCreateGroup } from "./groups";
import { setCheckInInterval } from "./intervals";
import { addToGroup } from "./relationships";
import { seed, type Seed } from "./testing/fixtures";

let s: Seed;

beforeEach(async () => {
  s = await seed();
});

const idOf = async (name: string) => (await (await db()).selectFrom("groups").select("id").where("name", "=", name).executeTakeFirstOrThrow()).id;

test("everyone sees the seeded groups, with counts of the people they may see", async () => {
  await addToGroup(s.a, { name: "Familie", members: [s.anna], visibility: "shared" });
  await addToGroup(s.a, { name: "Familie", members: [s.tom], visibility: "private" });
  const a = await listGroups(s.a);
  expect(a.map((g) => g.name)).toEqual(["Arbeit", "Familie", "Freunde"]);
  expect(a.find((g) => g.name === "Familie")).toMatchObject({ count: 2, aliases: ["Verwandte"], url: `/g/${await idOf("Familie")}` });
  expect((await listGroups(s.b)).find((g) => g.name === "Familie")!.count).toBe(1);
  expect((await listGroups(s.b)).find((g) => g.name === "Arbeit")).toMatchObject({ count: 0, aliases: ["Job", "Kollegen"] });
});

test("a name resolves through case, spaces and other names", async () => {
  const arbeit = await idOf("Arbeit");
  for (const n of ["arbeit", "  ARBEIT ", "Kollegen", "job"]) expect(await findGroup(await db(), s.a, n), n).toBe(arbeit);
  expect(await findGroup(await db(), s.a, "Chor")).toBeNull();
});

test("resolveOrCreateGroup reuses a match and otherwise makes the viewer's own group", async () => {
  const d = await db();
  expect(await resolveOrCreateGroup(d, s.a, "kollegen")).toBe(await idOf("Arbeit"));
  const chor = await resolveOrCreateGroup(d, s.a, " Chor ");
  expect(await d.selectFrom("groups").select(["name", "created_by"]).where("id", "=", chor).executeTakeFirst()).toEqual({ name: "Chor", created_by: s.a.userId });
  expect(await resolveOrCreateGroup(d, s.a, "chor")).toBe(chor);
});

test("a group the viewer made is theirs to see even while it is empty; the partner sees it once it has a shared member", async () => {
  await resolveOrCreateGroup(await db(), s.a, "Chor");
  expect((await listGroups(s.a)).map((g) => g.name)).toContain("Chor");
  expect((await listGroups(s.b)).map((g) => g.name)).not.toContain("Chor");
  await addToGroup(s.a, { name: "Chor", members: [s.lena], visibility: "shared" });
  expect((await listGroups(s.b)).map((g) => g.name)).toContain("Chor");
});

test("getGroup lists members most due first, with last seen", async () => {
  await addToGroup(s.a, { name: "Freunde", members: [s.anna, s.lena], visibility: "shared" });
  await setCheckInInterval(s.a, s.anna, 2, true);
  const g = await getGroup(s.a, await idOf("Freunde"));
  expect(g.name).toBe("Freunde");
  expect(g.members.map((m) => m.name)).toEqual(["Anna", "Lena"]);
  expect(g.members[0]).toMatchObject({ personId: s.anna, url: `/p/${s.anna}`, private: false });
  expect(g.members[0].lastSeen).not.toBeNull();
  await expect(getGroup(s.a, "nope")).rejects.toThrow(NotFoundError);
});
