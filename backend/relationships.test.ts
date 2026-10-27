import { beforeEach, expect, test } from "vitest";
import { db } from "./db/testing";
import { InvalidInputError, NotFoundError } from "./errors";
import { addRelationship, addToGroup } from "./relationships";
import { seed, type Seed } from "./testing/fixtures";

let s: Seed;

beforeEach(async () => {
  s = await seed();
});

test("a relationship without a conversation keeps what each end is, in words", async () => {
  const { ids: [id] } = await addRelationship(s.a, { from: s.lena, to: s.anna, label: " Kollegin ", inverse: "Kollegin", note: "same office", visibility: "shared" });
  const row = await (await db()).selectFrom("relationships").selectAll().where("id", "=", id).executeTakeFirstOrThrow();
  expect(row).toMatchObject({ from_id: s.lena, to_id: s.anna, label: "Kollegin", inverse: "Kollegin", note: "same office", visibility: "shared", recorded_by: s.a.userId, conversation_id: null });
});

test("a relationship is checked like one recorded with a conversation", async () => {
  await expect(addRelationship(s.a, { from: s.anna, to: s.anna, label: "Freundin", inverse: "Freundin", visibility: "shared" })).rejects.toBeInstanceOf(InvalidInputError);
  await expect(addRelationship(s.a, { from: s.anna, to: s.tom, label: " ", inverse: "Freund", visibility: "shared" })).rejects.toBeInstanceOf(InvalidInputError);
  await expect(addRelationship(s.a, { from: s.anna, to: s.tom, label: "Freundin", inverse: "", visibility: "shared" })).rejects.toBeInstanceOf(InvalidInputError);
  await expect(addRelationship(s.a, { from: s.anna, to: s.tom, label: "x".repeat(61), inverse: "Freund", visibility: "shared" })).rejects.toBeInstanceOf(InvalidInputError);
  await expect(addRelationship(s.a, { from: s.anna, to: s.tom, label: "Freundin", inverse: "Freund", visibility: "secret" as "shared" })).rejects.toBeInstanceOf(InvalidInputError);
  await expect(addRelationship(s.a, { from: s.anna, to: "nope", label: "Freundin", inverse: "Freund", visibility: "shared" })).rejects.toBeInstanceOf(NotFoundError);
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

test("the same relationship again is not recorded twice, either way round and in either gender form", async () => {
  const add = (from: string, to: string, label: string, inverse: string, note?: string) => addRelationship(s.a, { from, to, label, inverse, note, visibility: "shared" }).then((r) => r.ids);
  const parent = await add(s.anna, s.tom, "Mutter", "Sohn");
  expect(await add(s.tom, s.anna, "Sohn", "Mutter")).toEqual(parent);
  expect(await add(s.anna, s.tom, "mutter ", "Sohn")).toEqual(parent);
  // the other way round with the same words is another relationship
  expect(await add(s.tom, s.anna, "Mutter", "Sohn")).not.toEqual(parent);

  const friends = await add(s.anna, s.lena, "Freundin", "Freundin");
  expect(await add(s.lena, s.anna, "Freund:in", "Freundin")).toEqual(friends);
  expect(await add(s.anna, s.lena, "Kollegin", "Kollegin")).not.toEqual(friends);
  const doctor = await add(s.lena, s.tom, "Ärztin", "Patient");
  expect(await add(s.lena, s.tom, "Arzt", "Patient:in")).toEqual(doctor);
  const colleague = await add(s.tom, s.lena, "Kollege", "Kollegin");
  expect(await add(s.lena, s.tom, "Kolleg:in", "Kolleg:in")).toEqual(colleague);
  // the note it lacked is taken over
  expect(await add(s.tom, s.anna, "Sohn", "Mutter", "der Ältere")).toEqual(parent);
  expect((await (await db()).selectFrom("relationships").select("note").where("id", "=", parent[0]).executeTakeFirstOrThrow()).note).toBe("der Ältere");
});

test("a shared relationship of the partner counts; a private one doesn't, and isn't touched", async () => {
  const shared = await addRelationship(s.b, { from: s.anna, to: s.lena, label: "Geschwister", inverse: "Geschwister", visibility: "shared" });
  const again = await addRelationship(s.a, { from: s.lena, to: s.anna, label: "Geschwister", inverse: "Geschwister", note: "Zwilling", visibility: "shared" });
  expect(again.ids).toEqual(shared.ids);
  expect(again.relationships).toMatchObject([{ fromName: "Anna", toName: "Lena", created: false }]);
  expect((await (await db()).selectFrom("relationships").select("note").where("id", "=", shared.ids[0]).executeTakeFirstOrThrow()).note).toBeNull();

  const secret = await addRelationship(s.b, { from: s.anna, to: s.tom, label: "Partner:in", inverse: "Partner:in", visibility: "private" });
  const beside = await addRelationship(s.a, { from: s.anna, to: s.tom, label: "Partner:in", inverse: "Partner:in", visibility: "shared" });
  expect(beside.ids).not.toEqual(secret.ids);
  // It finds A's own from the seed, never B's.
  expect(beside.relationships).toMatchObject([{ created: false, fromName: "Anna", toName: "Tom" }]);
});

const towards = async (id: string) => (await (await db()).selectFrom("relationships").select(["from_id", "to_id", "label"]).where("to_id", "=", id).orderBy("created_at").execute());

test("us files the role to both household persons, once each", async () => {
  const { ids } = await addRelationship(s.a, { from: s.anna, to: "us", label: "Vermieter:in", inverse: "Mieter:in", visibility: "shared" });
  expect(ids).toHaveLength(2);
  const rows = await (await db()).selectFrom("relationships").select(["id", "to_id"]).where("id", "in", ids).execute();
  expect(rows.map((r) => r.to_id).sort()).toEqual([s.a.personId, s.b.personId].sort());
  const count = async () => (await (await db()).selectFrom("relationships").select("id").execute()).length;
  const before = await count();
  expect((await addRelationship(s.a, { from: s.anna, to: "us", label: "Vermieter:in", inverse: "Mieter:in", visibility: "shared" })).ids.sort()).toEqual([...ids].sort());
  expect(await count()).toBe(before);
});

test("us adds only the half that is missing", async () => {
  const { ids: [mine] } = await addRelationship(s.a, { from: s.lena, to: s.a.personId, label: "Nachbar:in", inverse: "Nachbar:in", visibility: "shared" });
  const before = (await (await db()).selectFrom("relationships").select("id").execute()).length;
  const { ids } = await addRelationship(s.a, { from: s.lena, to: "us", label: "Nachbar:in", inverse: "Nachbar:in", visibility: "shared" });
  expect(ids).toContain(mine);
  expect((await (await db()).selectFrom("relationships").select("id").execute()).length).toBe(before + 1);
});

test("me is the viewer's own person", async () => {
  await addRelationship(s.b, { from: s.anna, to: "me", label: "Ärzt:in", inverse: "Patient:in", visibility: "shared" });
  expect(await towards(s.b.personId)).toEqual([{ from_id: s.anna, to_id: s.b.personId, label: "Ärzt:in" }]);
  await expect(addRelationship(s.b, { from: "me", to: "us", label: "Freund:in", inverse: "Freund:in", visibility: "shared" })).rejects.toBeInstanceOf(InvalidInputError);
});

test("a household of one", async () => {
  await (await db()).updateTable("users").set({ person_id: null }).where("id", "=", s.b.userId).execute();
  const { ids } = await addRelationship(s.a, { from: s.anna, to: "us", label: "Vermieter:in", inverse: "Mieter:in", visibility: "shared" });
  expect(ids).toHaveLength(1);
  expect(await towards(s.a.personId)).toEqual([{ from_id: s.anna, to_id: s.a.personId, label: "Vermieter:in" }]);
});

test("a role to us from a household person skips that person", async () => {
  const { ids } = await addRelationship(s.a, { from: s.b.personId, to: "us", label: "Nachbar:in", inverse: "Nachbar:in", visibility: "shared" });
  expect(ids).toHaveLength(1);
  expect(await towards(s.a.personId)).toEqual([{ from_id: s.b.personId, to_id: s.a.personId, label: "Nachbar:in" }]);
});

