import { beforeEach, expect, test } from "vitest";
import { db } from "./db/testing";
import { InvalidInputError, NotFoundError } from "./errors";
import { addRelationship, addToGroup } from "./relationships";
import { seed, type Seed } from "./testing/fixtures";

let s: Seed;

beforeEach(async () => {
  s = await seed();
});

test("a relationship without a conversation", async () => {
  const { id } = await addRelationship(s.a, { from: s.lena, to: s.anna, type: "colleague", note: "same office", visibility: "shared" });
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
  const { id } = await addRelationship(s.a, { from: s.anna, to: s.lena, type: "other", visibility: "shared" });
  expect(await addRelationship(s.a, { from: s.lena, to: s.anna, type: "other", note: "Patentante", visibility: "shared" })).toEqual({ id });
  expect(await addRelationship(s.a, { from: s.anna, to: s.lena, type: "other", note: "patentante ", visibility: "shared" })).toEqual({ id });
  // the note it lacked is taken over; another note is another relationship
  expect((await (await db()).selectFrom("relationships").select("note").where("id", "=", id).executeTakeFirstOrThrow()).note).toBe("Patentante");
  expect(await addRelationship(s.a, { from: s.anna, to: s.lena, type: "other", note: "Nachbarin", visibility: "shared" })).not.toEqual({ id });

  const parent = await addRelationship(s.a, { from: s.anna, to: s.tom, type: "parent", visibility: "shared" });
  expect(await addRelationship(s.a, { from: s.tom, to: s.anna, type: "child", visibility: "shared" })).toEqual(parent);
  expect(await addRelationship(s.a, { from: s.tom, to: s.anna, type: "parent", visibility: "shared" })).not.toEqual(parent);
  const friends = await addRelationship(s.a, { from: s.anna, to: s.tom, type: "friend", visibility: "shared" });
  expect(await addRelationship(s.a, { from: s.tom, to: s.anna, type: "friend", visibility: "shared" })).toEqual(friends);
});

test("a shared relationship of the partner counts; a private one doesn't, and isn't touched", async () => {
  const shared = await addRelationship(s.b, { from: s.anna, to: s.lena, type: "sibling", visibility: "shared" });
  expect(await addRelationship(s.a, { from: s.lena, to: s.anna, type: "sibling", note: "Zwilling", visibility: "shared" })).toEqual(shared);
  expect((await (await db()).selectFrom("relationships").select("note").where("id", "=", shared.id).executeTakeFirstOrThrow()).note).toBeNull();

  const secret = await addRelationship(s.b, { from: s.anna, to: s.tom, type: "partner", visibility: "private" });
  expect(await addRelationship(s.a, { from: s.anna, to: s.tom, type: "partner", visibility: "shared" })).not.toEqual(secret);
});
