import { beforeEach, expect, test } from "vitest";
import { db } from "./db/testing";
import { InvalidInputError, NotFoundError } from "./errors";
import {
  addGroupAlias,
  addToGroupById,
  createGroup,
  deleteGroup,
  findGroup,
  getGroup,
  listGroups,
  mergeGroups,
  removeFromGroup,
  removeGroupAlias,
  renameGroup,
  resolveOrCreateGroup,
} from "./groups";
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

test("rename keeps the old name as another name", async () => {
  const id = await idOf("Arbeit");
  await renameGroup(s.a, id, "Job & Kollegen");
  const g = (await listGroups(s.b)).find((x) => x.id === id)!;
  expect(g.name).toBe("Job & Kollegen");
  expect(g.aliases).toEqual(["Arbeit", "Job", "Kollegen"]);
  expect(await findGroup(await db(), s.b, "arbeit")).toBe(id);
});

test("an other name or a new name that names another group is refused, so merging is the way", async () => {
  await expect(addGroupAlias(s.a, await idOf("Freunde"), "kollegen")).rejects.toThrow(InvalidInputError);
  await expect(renameGroup(s.a, await idOf("Freunde"), "Familie")).rejects.toThrow(InvalidInputError);
  await addGroupAlias(s.a, await idOf("Freunde"), "Kumpels");
  expect(await findGroup(await db(), s.b, "kumpels")).toBe(await idOf("Freunde"));
  await removeGroupAlias(s.a, await idOf("Freunde"), "KUMPELS");
  expect(await findGroup(await db(), s.b, "kumpels")).toBeNull();
});

test("merge moves memberships, keeps one row per person and recorder, and turns the dropped names into other names", async () => {
  const [freunde, chor] = [await idOf("Freunde"), await resolveOrCreateGroup(await db(), s.a, "Chor")];
  await addGroupAlias(s.a, chor, "Singen");
  await addToGroupById(s.a, freunde, s.anna, "shared");
  await addToGroupById(s.a, chor, s.anna, "shared");
  await addToGroupById(s.b, chor, s.lena, "shared");
  await mergeGroups(s.a, freunde, chor);
  const g = await getGroup(s.b, freunde);
  expect(g.members.map((m) => m.name).sort()).toEqual(["Anna", "Lena"]);
  expect(g.aliases).toEqual(["Chor", "Freundeskreis", "Singen"]);
  expect(await (await db()).selectFrom("group_members").select("person_id").where("group_id", "=", freunde).where("person_id", "=", s.anna).execute()).toHaveLength(1);
  await expect(getGroup(s.a, chor)).rejects.toThrow(NotFoundError);
});

test("merging a group into itself is refused", async () => {
  const id = await idOf("Familie");
  await expect(mergeGroups(s.a, id, id)).rejects.toThrow(InvalidInputError);
});

test("delete removes only the viewer's memberships; the group stays while the partner still has some", async () => {
  const familie = await idOf("Familie");
  await addToGroupById(s.a, familie, s.anna, "shared");
  await addToGroupById(s.b, familie, s.lena, "shared");
  await deleteGroup(s.a, familie);
  expect((await getGroup(s.b, familie)).members.map((m) => m.name)).toEqual(["Lena"]);
  await deleteGroup(s.b, familie);
  expect(await (await db()).selectFrom("groups").select("id").where("id", "=", familie).execute()).toEqual([]);
  expect((await listGroups(s.a)).map((g) => g.name)).not.toContain("Familie");
});

test("remove takes out the viewer's and the partner's shared membership", async () => {
  const arbeit = await idOf("Arbeit");
  await addToGroupById(s.a, arbeit, s.anna, "shared");
  await addToGroupById(s.b, arbeit, s.anna, "shared");
  await removeFromGroup(s.b, arbeit, s.anna);
  expect((await getGroup(s.a, arbeit)).members).toEqual([]);
});

test("createGroup returns the group a name already means instead of a duplicate", async () => {
  expect((await createGroup(s.a, "Verwandte")).name).toBe("Familie");
  expect((await createGroup(s.a, "Chor")).count).toBe(0);
});
