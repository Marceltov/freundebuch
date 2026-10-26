import { beforeEach, expect, test } from "vitest";
import { db } from "./db/testing";
import { InvalidInputError, NotFoundError } from "./errors";
import { relationshipKey } from "./conversations";
import { addRelationship, addToGroup } from "./relationships";
import { seed, type Seed } from "./testing/fixtures";

let s: Seed;

beforeEach(async () => {
  s = await seed();
});

test("a relationship without a conversation", async () => {
  const { ids: [id] } = await addRelationship(s.a, { from: s.lena, to: s.anna, type: "colleague", note: "same office", visibility: "shared" });
  const row = await (await db()).selectFrom("relationships").selectAll().where("id", "=", id).executeTakeFirstOrThrow();
  expect(row).toMatchObject({ from_id: s.lena, to_id: s.anna, type: "colleague", note: "same office", visibility: "shared", recorded_by: s.a.userId, conversation_id: null });
});

test("a relationship is checked like one recorded with a conversation", async () => {
  await expect(addRelationship(s.a, { from: s.anna, to: s.anna, type: "friend", visibility: "shared" })).rejects.toBeInstanceOf(InvalidInputError);
  await expect(addRelationship(s.a, { from: s.anna, to: s.tom, type: "enemy" as "friend", visibility: "shared" })).rejects.toBeInstanceOf(InvalidInputError);
  await expect(addRelationship(s.a, { from: s.anna, to: s.tom, type: "friend", visibility: "secret" as "shared" })).rejects.toBeInstanceOf(InvalidInputError);
  await expect(addRelationship(s.a, { from: s.anna, to: "nope", type: "friend", visibility: "shared" })).rejects.toBeInstanceOf(NotFoundError);
});

test("group memberships without a conversation; adding the same one again is a no-op", async () => {
  expect(await addToGroup(s.a, { name: " Uni ", members: [s.anna, s.lena, s.anna], visibility: "private" })).toMatchObject({ added: 2, name: "Uni" });
  expect(await addToGroup(s.a, { name: "Uni", members: [s.anna], visibility: "shared" })).toMatchObject({ added: 0 });
  // B's own membership of the same person is a row of its own.
  expect(await addToGroup(s.b, { name: "Uni", members: [s.anna], visibility: "shared" })).toMatchObject({ added: 1 });
  const rows = await (await db()).selectFrom("group_members").innerJoin("groups", "groups.id", "group_members.group_id").selectAll().execute();
  expect(rows.map((r) => [r.name, r.recorded_by === s.a.userId ? "a" : "b", r.visibility, r.conversation_id])).toEqual([
    ["Uni", "a", "private", null],
    ["Uni", "a", "private", null],
    ["Uni", "b", "shared", null],
  ]);
  await expect(addToGroup(s.a, { name: " ", members: [s.anna], visibility: "shared" })).rejects.toBeInstanceOf(InvalidInputError);
  await expect(addToGroup(s.a, { name: "Uni", members: ["nope"], visibility: "shared" })).rejects.toBeInstanceOf(NotFoundError);
});

test("the same relationship again is not recorded twice, however it is written", async () => {
  const { ids: [id] } = await addRelationship(s.a, { from: s.anna, to: s.lena, type: "other", visibility: "shared" });
  expect(await addRelationship(s.a, { from: s.lena, to: s.anna, type: "other", note: "Patentante", visibility: "shared" })).toEqual({ ids: [id] });
  expect(await addRelationship(s.a, { from: s.anna, to: s.lena, type: "other", note: "patentante ", visibility: "shared" })).toEqual({ ids: [id] });
  // the note it lacked is taken over; another note is another relationship
  expect((await (await db()).selectFrom("relationships").select("note").where("id", "=", id).executeTakeFirstOrThrow()).note).toBe("Patentante");
  expect(await addRelationship(s.a, { from: s.anna, to: s.lena, type: "other", note: "Nachbarin", visibility: "shared" })).not.toEqual({ ids: [id] });

  const parent = await addRelationship(s.a, { from: s.anna, to: s.tom, type: "parent", visibility: "shared" });
  expect(await addRelationship(s.a, { from: s.tom, to: s.anna, type: "child", visibility: "shared" })).toEqual(parent);
  expect(await addRelationship(s.a, { from: s.tom, to: s.anna, type: "parent", visibility: "shared" })).not.toEqual(parent);
  const friends = await addRelationship(s.a, { from: s.anna, to: s.tom, type: "friend", visibility: "shared" });
  expect(await addRelationship(s.a, { from: s.tom, to: s.anna, type: "friend", visibility: "shared" })).toEqual(friends);
});

test("a shared relationship of the partner counts; a private one doesn't, and isn't touched", async () => {
  const shared = await addRelationship(s.b, { from: s.anna, to: s.lena, type: "sibling", visibility: "shared" });
  expect(await addRelationship(s.a, { from: s.lena, to: s.anna, type: "sibling", note: "Zwilling", visibility: "shared" })).toEqual(shared);
  expect((await (await db()).selectFrom("relationships").select("note").where("id", "=", shared.ids[0]).executeTakeFirstOrThrow()).note).toBeNull();

  const secret = await addRelationship(s.b, { from: s.anna, to: s.tom, type: "partner", visibility: "private" });
  expect(await addRelationship(s.a, { from: s.anna, to: s.tom, type: "partner", visibility: "shared" })).not.toEqual(secret);
});

const towards = async (id: string) => (await (await db()).selectFrom("relationships").select(["from_id", "to_id", "type"]).where("to_id", "=", id).orderBy("created_at").execute());

test("us files the role to both household persons, once each", async () => {
  const { ids } = await addRelationship(s.a, { from: s.anna, to: "us", type: "landlord", visibility: "shared" });
  expect(ids).toHaveLength(2);
  const rows = await (await db()).selectFrom("relationships").select(["id", "to_id"]).where("id", "in", ids).execute();
  expect(rows.map((r) => r.to_id).sort()).toEqual([s.a.personId, s.b.personId].sort());
  const count = async () => (await (await db()).selectFrom("relationships").select("id").execute()).length;
  const before = await count();
  expect((await addRelationship(s.a, { from: s.anna, to: "us", type: "landlord", visibility: "shared" })).ids.sort()).toEqual([...ids].sort());
  expect(await count()).toBe(before);
});

test("us adds only the half that is missing", async () => {
  const { ids: [mine] } = await addRelationship(s.a, { from: s.lena, to: s.a.personId, type: "neighbour", visibility: "shared" });
  const before = (await (await db()).selectFrom("relationships").select("id").execute()).length;
  const { ids } = await addRelationship(s.a, { from: s.lena, to: "us", type: "neighbour", visibility: "shared" });
  expect(ids).toContain(mine);
  expect((await (await db()).selectFrom("relationships").select("id").execute()).length).toBe(before + 1);
});

test("me is the viewer's own person", async () => {
  await addRelationship(s.b, { from: s.anna, to: "me", type: "doctor", visibility: "shared" });
  expect(await towards(s.b.personId)).toEqual([{ from_id: s.anna, to_id: s.b.personId, type: "doctor" }]);
  await expect(addRelationship(s.b, { from: "me", to: "us", type: "friend", visibility: "shared" })).rejects.toBeInstanceOf(InvalidInputError);
});

test("a household of one", async () => {
  await (await db()).updateTable("users").set({ person_id: null }).where("id", "=", s.b.userId).execute();
  const { ids } = await addRelationship(s.a, { from: s.anna, to: "us", type: "landlord", visibility: "shared" });
  expect(ids).toHaveLength(1);
  expect(await towards(s.a.personId)).toEqual([{ from_id: s.anna, to_id: s.a.personId, type: "landlord" }]);
});

test("a role to us from a household person skips that person", async () => {
  const { ids } = await addRelationship(s.a, { from: s.b.personId, to: "us", type: "neighbour", visibility: "shared" });
  expect(ids).toHaveLength(1);
  expect(await towards(s.a.personId)).toEqual([{ from_id: s.b.personId, to_id: s.a.personId, type: "neighbour" }]);
});

test("neighbour reads both ways; landlord is directional", () => {
  expect(relationshipKey("x", "y", "neighbour")).toBe(relationshipKey("y", "x", "neighbour"));
  expect(relationshipKey("x", "y", "landlord")).not.toBe(relationshipKey("y", "x", "landlord"));
});
