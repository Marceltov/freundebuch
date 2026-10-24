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

test("context shows relationships and when the viewer last saw the person", async () => {
  const anna = await createPerson(a, { name: "Anna" });
  const tom = await createPerson(a, { name: "Tom" });
  const d = await db();
  await d.insertInto("relationships").values({ id: newId(), from_id: anna, to_id: tom, type: "partner", note: null, visibility: "shared", recorded_by: a.userId, conversation_id: null, created_at: now() }).execute();
  for (const date of ["2026-10-01", "2026-10-20"]) {
    const id = newId();
    await d.insertInto("conversations").values({ id, date, kind: "call", place: null, summary: "s", transcript: "", visibility: "shared", recorded_by: a.userId, created_at: now() }).execute();
    await d.insertInto("participants").values([{ conversation_id: id, person_id: anna }, { conversation_id: id, person_id: b.personId }]).execute();
  }
  // A conversation the viewer was not part of does not count as seeing Anna.
  const other = newId();
  await d.insertInto("conversations").values({ id: other, date: "2026-10-22", kind: "call", place: null, summary: "s", transcript: "", visibility: "shared", recorded_by: a.userId, created_at: now() }).execute();
  await d.insertInto("participants").values({ conversation_id: other, person_id: anna }).execute();
  const [c] = await findPeople(b, "Anna");
  expect(c.context).toEqual(["partner of Tom", "last seen 2026-10-20"]);
  expect((await findPeople(b, "Tom"))[0].context).toEqual(["partner of Anna"]);
});

test("context never contains anything from a private item of the other user", async () => {
  const anna = await createPerson(a, { name: "Anna" });
  const tom = await createPerson(a, { name: "Tom" });
  const d = await db();
  await d.insertInto("relationships").values({ id: newId(), from_id: anna, to_id: tom, type: "partner", note: null, visibility: "private", recorded_by: b.userId, conversation_id: null, created_at: now() }).execute();
  const cid = newId();
  await d.insertInto("conversations").values({ id: cid, date: "2026-10-20", kind: "call", place: null, summary: "s", transcript: "", visibility: "private", recorded_by: b.userId, created_at: now() }).execute();
  await d.insertInto("participants").values([{ conversation_id: cid, person_id: anna }, { conversation_id: cid, person_id: b.personId }]).execute();
  expect((await findPeople(a, "Anna"))[0].context).toEqual([]);
  expect((await findPeople(b, "Anna"))[0].context).toEqual(["partner of Tom", "last seen 2026-10-20"]);
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

test("Jürgen with alias Jogi is found by every spelling", async () => {
  const id = await createPerson(a, { name: "Jürgen", aliases: ["Jogi"] });
  await createPerson(a, { name: "Jens" });
  for (const q of ["Jürgen", "Juergen", "jürgen", "Ju\u0308rgen", "Jogi"]) expect((await findPeople(a, q))[0].id, q).toBe(id);
});

test("duplicate aliases and an alias equal to the name are stored once or not at all", async () => {
  const id = await createPerson(a, { name: "Katharina", aliases: ["Kathi", "kathi", "KATHARINA"] });
  await addAlias(a, id, "Kathi");
  await addAlias(a, id, "katharina");
  expect((await getPerson(a, id)).aliases).toEqual(["Kathi"]);
});

test("relationship hints read naturally in both directions", async () => {
  const sarah = await createPerson(a, { name: "Sarah" });
  const ella = await createPerson(a, { name: "Ella" });
  const tom = await createPerson(a, { name: "Tom" });
  const anna = await createPerson(a, { name: "Anna" });
  const rel = async (from: string, to: string, type: string) =>
    (await db()).insertInto("relationships").values({ id: newId(), from_id: from, to_id: to, type, note: null, visibility: "shared", recorded_by: a.userId, conversation_id: null, created_at: now() }).execute();
  await rel(sarah, ella, "parent");
  await rel(anna, tom, "introduced_by");
  await rel(tom, ella, "other");
  const ctx = async (q: string) => [...(await findPeople(a, q))[0].context].sort();
  expect(await ctx("Sarah")).toEqual(["parent of Ella"]);
  expect(await ctx("Ella")).toEqual(["child of Sarah", "knows Tom"].sort());
  expect(await ctx("Anna")).toEqual(["introduced by Tom"]);
  expect(await ctx("Tom")).toEqual(["introduced Anna", "knows Ella"].sort());
});
