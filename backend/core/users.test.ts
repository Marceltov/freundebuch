import { beforeEach, expect, test } from "vitest";
import { db, resetDbForTests } from "../db/testing";
import { renamePerson } from "../conversations/corrections";
import { findPeople } from "../people/people";
import { userFromOidc, viewerById } from "./users";

beforeEach(() => resetDbForTests());

test("the same sub gives the same viewer and one person", async () => {
  const a = await userFromOidc({ sub: "s1", name: "Marcel", email: "m@x.de" });
  const b = await userFromOidc({ sub: "s1", name: "Marcel B." });
  expect(b).toEqual(a);
  const d = await db();
  expect(await d.selectFrom("users").selectAll().execute()).toHaveLength(1);
  const persons = await d.selectFrom("persons").selectAll().execute();
  expect(persons).toHaveLength(1);
  expect(persons[0].id).toBe(a.personId);
  expect(persons[0].created_by).toBe(a.userId);
  expect(persons[0].name).toBe("Marcel B.");
  expect((await d.selectFrom("users").select("name").executeTakeFirstOrThrow()).name).toBe("Marcel B.");
});

test("different subs give different viewers", async () => {
  const a = await userFromOidc({ sub: "s1", name: "A" });
  const b = await userFromOidc({ sub: "s2", name: "B" });
  expect(a.userId).not.toBe(b.userId);
  expect(a.personId).not.toBe(b.personId);
});

test("viewerById finds a user and returns null for an unknown id", async () => {
  const a = await userFromOidc({ sub: "s1", name: "A" });
  expect(await viewerById(a.userId)).toEqual(a);
  expect(await viewerById("nope")).toBeNull();
});

test("a person renamed in freundebuch keeps that name when the user signs in again; the sign-in name is kept as another name", async () => {
  const v = await userFromOidc({ sub: "bille", name: "Bille" });
  await renamePerson(v, v.personId, "Sybille");
  await userFromOidc({ sub: "bille", name: "Bille" });
  const d = await db();
  expect((await d.selectFrom("persons").select("name").where("id", "=", v.personId).executeTakeFirstOrThrow()).name).toBe("Sybille");
  expect((await d.selectFrom("users").select("name").where("id", "=", v.userId).executeTakeFirstOrThrow()).name).toBe("Bille");
  expect((await findPeople(v, "Bille"))[0]?.id).toBe(v.personId);
});
