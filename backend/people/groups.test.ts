import { beforeEach, expect, test } from "vitest";
import { firstBook } from "../db/testing";
import { InvalidInputError, NotFoundError } from "../core/errors";
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
import { userFromOidc } from "../core/users";
import { addToGroup } from "./relationships";
import { seed, type Seed, signInInvited } from "../testing/fixtures";

let s: Seed;

beforeEach(async () => {
  s = await seed();
});

const idOf = async (name: string) => (await (await firstBook()).from("groups").select("id").where("name", "=", name).executeTakeFirstOrThrow()).id;

test("everyone sees the seeded groups, with counts of the people they may see", async () => {
  await addToGroup(s.a, { name: "Familie", members: [s.anna], visibility: "shared" });
  await addToGroup(s.a, { name: "Familie", members: [s.tom], visibility: "private" });
  const a = await listGroups(s.a);
  expect(a.map((g) => g.name)).toEqual(["Arbeit", "Familie", "Freunde", "Haushalt"]);
  expect(a.find((g) => g.name === "Familie")).toMatchObject({ count: 2, aliases: ["Verwandte"], url: `/g/${await idOf("Familie")}` });
  expect((await listGroups(s.b)).find((g) => g.name === "Familie")!.count).toBe(1);
  expect((await listGroups(s.b)).find((g) => g.name === "Arbeit")).toMatchObject({ count: 0, aliases: ["Job", "Kollegen"] });
});

test("a name resolves through case, spaces and other names", async () => {
  const arbeit = await idOf("Arbeit");
  for (const n of ["arbeit", "  ARBEIT ", "Kollegen", "job"]) expect(await findGroup(await firstBook(), s.a, n), n).toBe(arbeit);
  expect(await findGroup(await firstBook(), s.a, "Chor")).toBeNull();
});

test("resolveOrCreateGroup reuses a match and otherwise makes the viewer's own group", async () => {
  const d = await firstBook();
  expect(await resolveOrCreateGroup(d, s.a, "kollegen")).toBe(await idOf("Arbeit"));
  const chor = await resolveOrCreateGroup(d, s.a, " Chor ");
  expect(await d.from("groups").select(["name", "created_by"]).where("id", "=", chor).executeTakeFirst()).toEqual({
    name: "Chor",
    created_by: s.a.userId,
  });
  expect(await resolveOrCreateGroup(d, s.a, "chor")).toBe(chor);
});

test("a group the viewer made is theirs to see even while it is empty; the partner sees it once it has a shared member", async () => {
  await resolveOrCreateGroup(await firstBook(), s.a, "Chor");
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
  expect(await findGroup(await firstBook(), s.b, "arbeit")).toBe(id);
});

test("an other name or a new name that names another group is refused, so merging is the way", async () => {
  await expect(addGroupAlias(s.a, await idOf("Freunde"), "kollegen")).rejects.toThrow(InvalidInputError);
  await expect(renameGroup(s.a, await idOf("Freunde"), "Familie")).rejects.toThrow(InvalidInputError);
  await addGroupAlias(s.a, await idOf("Freunde"), "Kumpels");
  expect(await findGroup(await firstBook(), s.b, "kumpels")).toBe(await idOf("Freunde"));
  await removeGroupAlias(s.a, await idOf("Freunde"), "KUMPELS");
  expect(await findGroup(await firstBook(), s.b, "kumpels")).toBeNull();
});

test("merge moves memberships, keeps one row per person and recorder, and turns the dropped names into other names", async () => {
  const [freunde, chor] = [await idOf("Freunde"), await resolveOrCreateGroup(await firstBook(), s.a, "Chor")];
  await addGroupAlias(s.a, chor, "Singen");
  await addToGroupById(s.a, freunde, s.anna, "shared");
  await addToGroupById(s.a, chor, s.anna, "shared");
  await addToGroupById(s.b, chor, s.lena, "shared");
  await mergeGroups(s.a, freunde, chor);
  const g = await getGroup(s.b, freunde);
  expect(g.members.map((m) => m.name).sort()).toEqual(["Anna", "Lena"]);
  expect(g.aliases).toEqual(["Chor", "Freundeskreis", "Singen"]);
  expect(
    await (await firstBook()).from("group_members").select("person_id").where("group_id", "=", freunde).where("person_id", "=", s.anna).execute(),
  ).toHaveLength(1);
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
  expect(await (await firstBook()).from("groups").select("id").where("id", "=", familie).execute()).toEqual([]);
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

test("with two groups of one name in sight, a name finds the viewer's own first, then the oldest", async () => {
  // A's private-only Uni is hidden from B, so B's Uni is a second group; A sees both.
  await addToGroup(s.a, { name: "Uni", members: [s.anna], visibility: "private" });
  await addToGroup(s.b, { name: "Uni", members: [s.lena], visibility: "shared" });
  const own = async (v: typeof s.a) =>
    (await (await firstBook()).from("groups").select("id").where("name", "=", "Uni").where("created_by", "=", v.userId).executeTakeFirstOrThrow()).id;
  for (let i = 0; i < 3; i++) expect(await findGroup(await firstBook(), s.a, "uni")).toBe(await own(s.a));
  expect(await findGroup(await firstBook(), s.b, "uni")).toBe(await own(s.b));
});

test("a group nobody sees any more and nobody made or started with is removed once its last member goes", async () => {
  const familie = await idOf("Familie");
  await addToGroupById(s.a, familie, s.anna, "shared");
  await addToGroupById(s.b, familie, s.lena, "shared");
  await deleteGroup(s.a, familie); // stays for B, no longer seeded or anyone's own
  await removeFromGroup(s.b, familie, s.lena);
  expect(await (await firstBook()).from("groups").select("id").where("id", "=", familie).execute()).toEqual([]);
});

test("Haushalt holds everyone who signs in, and can't be deleted, merged away or emptied of them", async () => {
  const haushalt = await idOf("Haushalt");
  const g = await getGroup(s.a, haushalt);
  expect(g.members.map((m) => m.personId).sort()).toEqual([s.a.personId, s.b.personId].sort());
  expect(g.household).toBe(true);
  const newcomer = await signInInvited(s.a, { sub: "c", name: "Carla" });
  expect((await getGroup(s.a, haushalt)).members.map((m) => m.personId)).toContain(newcomer.personId);
  await expect(deleteGroup(s.a, haushalt)).rejects.toThrow(InvalidInputError);
  await expect(mergeGroups(s.a, await idOf("Freunde"), haushalt)).rejects.toThrow(InvalidInputError);
  await expect(removeFromGroup(s.a, haushalt, s.b.personId)).rejects.toThrow(InvalidInputError);
  expect((await getGroup(s.a, haushalt)).members).toHaveLength(3);
  // Anyone else may come and go, and it may be renamed.
  await addToGroupById(s.a, haushalt, s.anna, "shared");
  await removeFromGroup(s.a, haushalt, s.anna);
  await renameGroup(s.a, haushalt, "Zuhause");
  expect((await getGroup(s.a, haushalt)).aliases).toContain("Haushalt");
});
