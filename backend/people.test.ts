import { beforeEach, expect, test } from "vitest";
import { db, newId, now, resetDbForTests } from "./db/testing";
import { NotFoundError } from "./errors";
import { addAlias, createPerson, findPeople, getPerson, listPeople } from "./people";
import { userFromOidc } from "./users";
import type { Viewer } from "./types";

let a: Viewer;
let b: Viewer;

beforeEach(async () => {
  await resetDbForTests();
  a = await userFromOidc({ sub: "a", name: "Alice" });
  b = await userFromOidc({ sub: "b", name: "Bob" });
});

const names = async (v: Viewer, q: string) => (await findPeople(v, q)).map((c) => c.name);

test("matches on a name prefix, case and umlaut insensitive", async () => {
  await createPerson(a, { name: "Jürgen Meier" });
  expect(await names(a, "juerg")).toEqual(["Jürgen Meier"]);
  expect(await names(a, "meier")).toEqual(["Jürgen Meier"]);
});

test("matches on an alias and returns it", async () => {
  const id = await createPerson(a, { name: "Katharina Schulz", aliases: ["Kathi"] });
  const [c] = await findPeople(a, "kathi");
  expect(c.id).toBe(id);
  expect(c.aliases).toEqual(["Kathi"]);
});

test("tolerates one edit for names of five or more characters, not for shorter", async () => {
  await createPerson(a, { name: "Sabine" });
  await createPerson(a, { name: "Tom" });
  expect(await names(a, "Sabina")).toEqual(["Sabine"]);
  expect(await names(a, "Tim")).toEqual([]);
});

test("exact matches rank first", async () => {
  await createPerson(a, { name: "Annabelle" });
  await createPerson(a, { name: "Anna" });
  await createPerson(a, { name: "Hanna" });
  expect((await names(a, "anna"))[0]).toBe("Anna");
});

test("two Annas both come back", async () => {
  await createPerson(a, { name: "Anna" });
  await createPerson(a, { name: "Anna" });
  expect(await names(a, "Anna")).toHaveLength(2);
});

test("limit caps the result", async () => {
  for (let i = 0; i < 4; i++) await createPerson(a, { name: `Max ${i}` });
  expect(await findPeople(a, "max", 2)).toHaveLength(2);
});

test("context shows relationships and the last visible conversation", async () => {
  const anna = await createPerson(a, { name: "Anna" });
  const tom = await createPerson(a, { name: "Tom" });
  const d = await db();
  await d.insertInto("relationships").values({ id: newId(), from_id: anna, to_id: tom, type: "partner", note: null, visibility: "shared", recorded_by: a.userId, conversation_id: null, created_at: now() }).execute();
  for (const date of ["2026-10-01", "2026-10-20"]) {
    const id = newId();
    await d.insertInto("conversations").values({ id, date, kind: "call", place: null, summary: "s", transcript: "", visibility: "shared", recorded_by: a.userId, created_at: now() }).execute();
    await d.insertInto("participants").values({ conversation_id: id, person_id: anna }).execute();
  }
  const [c] = await findPeople(b, "Anna");
  expect(c.context).toEqual(["partner of Tom", "last conversation 2026-10-20"]);
  expect((await findPeople(b, "Tom"))[0].context).toEqual(["partner of Anna"]);
});

test("context never contains anything from a private item of the other user", async () => {
  const anna = await createPerson(a, { name: "Anna" });
  const tom = await createPerson(a, { name: "Tom" });
  const d = await db();
  await d.insertInto("relationships").values({ id: newId(), from_id: anna, to_id: tom, type: "partner", note: null, visibility: "private", recorded_by: b.userId, conversation_id: null, created_at: now() }).execute();
  const cid = newId();
  await d.insertInto("conversations").values({ id: cid, date: "2026-10-20", kind: "call", place: null, summary: "s", transcript: "", visibility: "private", recorded_by: b.userId, created_at: now() }).execute();
  await d.insertInto("participants").values({ conversation_id: cid, person_id: anna }).execute();
  expect((await findPeople(a, "Anna"))[0].context).toEqual([]);
  expect((await findPeople(b, "Anna"))[0].context).toEqual(["partner of Tom", "last conversation 2026-10-20"]);
});

test("addAlias adds, dedupes by norm and is found", async () => {
  const id = await createPerson(a, { name: "Katharina" });
  await addAlias(a, id, "Kathi");
  await addAlias(a, id, "kathi");
  expect((await getPerson(a, id)).aliases).toEqual(["Kathi"]);
  expect(await names(a, "kathi")).toEqual(["Katharina"]);
});

test("getPerson hides createdFrom when the conversation is not visible", async () => {
  const d = await db();
  const cid = newId();
  await d.insertInto("conversations").values({ id: cid, date: "2026-10-20", kind: "call", place: null, summary: "s", transcript: "", visibility: "private", recorded_by: b.userId, created_at: now() }).execute();
  const id = await createPerson(b, { name: "Carl", createdFrom: cid });
  expect((await getPerson(b, id)).createdFrom).toBe(cid);
  expect((await getPerson(a, id)).createdFrom).toBeNull();
});

test("getPerson throws NotFoundError for an unknown id", async () => {
  await expect(getPerson(a, "nope")).rejects.toBeInstanceOf(NotFoundError);
});

test("listPeople lists everyone including the users' own persons", async () => {
  await createPerson(a, { name: "Zed" });
  const all = (await listPeople(a)).map((p) => p.name);
  expect(all).toEqual(["Alice", "Bob", "Zed"]);
});
