import { beforeEach, expect, test } from "vitest";
import { testDb, newId, now, resetDbForTests } from "./db/testing";
import { InvalidInputError, NotFoundError } from "./errors";
import { addAlias, createPerson, findPeople, getPerson, listPeople, setGender } from "./people";
import { userFromOidc } from "./users";
import type { Viewer } from "./types";

// A ramble for a conversation inserted by hand, returning its id.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const ramble = async (d: { insertInto: (t: "rambles") => any }, id: string, by: string) => (
  await d
    .insertInto("rambles")
    .values({ id, date: "2026-01-01", transcript: "", transcript_private: 0, visibility: "shared", recorded_by: by, created_at: 0 })
    .execute(),
  id
);

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
  const d = await testDb();
  await d
    .insertInto("relationships")
    .values({
      id: newId(),
      from_id: anna,
      to_id: tom,
      label: "Partner:in",
      inverse: "Partner:in",
      note: null,
      visibility: "shared",
      recorded_by: a.userId,
      conversation_id: null,
      created_at: now(),
    })
    .execute();
  for (const date of ["2026-10-01", "2026-10-20"]) {
    const id = newId();
    await d
      .insertInto("conversations")
      .values({
        id,
        date,
        kind: "call",
        summary: "s",
        ramble_id: await ramble(d, id, a.userId),
        visibility: "shared",
        recorded_by: a.userId,
        created_at: now(),
      })
      .execute();
    await d
      .insertInto("participants")
      .values([
        { conversation_id: id, person_id: anna },
        { conversation_id: id, person_id: b.personId },
      ])
      .execute();
  }
  // A conversation the viewer was not part of does not count as seeing Anna.
  const other = newId();
  await d
    .insertInto("conversations")
    .values({
      id: other,
      date: "2026-10-22",
      kind: "call",
      summary: "s",
      ramble_id: await ramble(d, other, a.userId),
      visibility: "shared",
      recorded_by: a.userId,
      created_at: now(),
    })
    .execute();
  await d.insertInto("participants").values({ conversation_id: other, person_id: anna }).execute();
  const [c] = await findPeople(b, "Anna");
  expect(c.context).toEqual(["Partner:in of Tom", "last seen 2026-10-20"]);
  expect((await findPeople(b, "Tom"))[0].context).toEqual(["Partner:in of Anna"]);
});

test("context never contains anything from a private item of the other user", async () => {
  const anna = await createPerson(a, { name: "Anna" });
  const tom = await createPerson(a, { name: "Tom" });
  const d = await testDb();
  await d
    .insertInto("relationships")
    .values({
      id: newId(),
      from_id: anna,
      to_id: tom,
      label: "Partner:in",
      inverse: "Partner:in",
      note: null,
      visibility: "private",
      recorded_by: b.userId,
      conversation_id: null,
      created_at: now(),
    })
    .execute();
  const cid = newId();
  await d
    .insertInto("conversations")
    .values({
      id: cid,
      date: "2026-10-20",
      kind: "call",
      summary: "s",
      ramble_id: await ramble(d, cid, a.userId),
      visibility: "private",
      recorded_by: b.userId,
      created_at: now(),
    })
    .execute();
  await d
    .insertInto("participants")
    .values([
      { conversation_id: cid, person_id: anna },
      { conversation_id: cid, person_id: b.personId },
    ])
    .execute();
  expect((await findPeople(a, "Anna"))[0].context).toEqual([]);
  expect((await findPeople(b, "Anna"))[0].context).toEqual(["Partner:in of Tom", "last seen 2026-10-20"]);
});

test("addAlias adds, dedupes by norm and is found", async () => {
  const id = await createPerson(a, { name: "Katharina" });
  await addAlias(a, id, "Kathi");
  await addAlias(a, id, "kathi");
  expect((await getPerson(a, id)).aliases).toEqual(["Kathi"]);
  expect(await names(a, "kathi")).toEqual(["Katharina"]);
});

test("getPerson hides createdFrom when the conversation is not visible", async () => {
  const d = await testDb();
  const cid = newId();
  await d
    .insertInto("conversations")
    .values({
      id: cid,
      date: "2026-10-20",
      kind: "call",
      summary: "s",
      ramble_id: await ramble(d, cid, a.userId),
      visibility: "private",
      recorded_by: b.userId,
      created_at: now(),
    })
    .execute();
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
  const rel = async (from: string, to: string, label: string, inverse: string) =>
    (await testDb())
      .insertInto("relationships")
      .values({
        id: newId(),
        from_id: from,
        to_id: to,
        label,
        inverse,
        note: null,
        visibility: "shared",
        recorded_by: a.userId,
        conversation_id: null,
        created_at: now(),
      })
      .execute();
  await rel(sarah, ella, "Mutter", "Tochter");
  await rel(anna, tom, "Nichte", "Onkel");
  await rel(tom, ella, "Nachbar", "Nachbarin");
  const ctx = async (q: string) => [...(await findPeople(a, q))[0].context].sort();
  // What the person is to the other, in the words filed.
  expect(await ctx("Sarah")).toEqual(["Mutter of Ella"]);
  expect(await ctx("Ella")).toEqual(["Nachbarin of Tom", "Tochter of Sarah"]);
  expect(await ctx("Anna")).toEqual(["Nichte of Tom"]);
  expect(await ctx("Tom")).toEqual(["Nachbar of Ella", "Onkel of Anna"]);
});

test("gender is optional, three values, shared like the name", async () => {
  const anna = await createPerson(a, { name: "Anna" });
  expect((await getPerson(b, anna)).gender).toBeNull();
  await setGender(a, anna, "female");
  expect((await getPerson(b, anna)).gender).toBe("female");
  await setGender(b, anna, null);
  expect((await getPerson(a, anna)).gender).toBeNull();
  await expect(setGender(a, anna, "x" as "male")).rejects.toBeInstanceOf(InvalidInputError);
  await expect(setGender(a, "nope", "male")).rejects.toBeInstanceOf(NotFoundError);
});

test("a gender change returns the person's relationships the viewer may edit: their own and the partner's shared ones", async () => {
  const anna = await createPerson(a, { name: "Anna" });
  const tom = await createPerson(a, { name: "Tom" });
  const rel = async (by: Viewer, from: string, to: string, label: string, inverse: string, visibility = "shared") => {
    const id = newId();
    await (
      await testDb()
    )
      .insertInto("relationships")
      .values({ id, from_id: from, to_id: to, label, inverse, note: null, visibility, recorded_by: by.userId, conversation_id: null, created_at: now() })
      .execute();
    return id;
  };
  const mine = await rel(a, anna, tom, "Vermieter:in", "Mieter");
  const theirs = await rel(b, tom, anna, "Kollege", "Kolleg:in");
  await rel(b, anna, a.personId, "Nachbar:in", "Nachbar", "private");
  // B's private one never reaches A.
  expect((await setGender(a, anna, "female")).relabel.map((r) => r.id)).toEqual([mine, theirs]);
  await setGender(b, anna, null);
  expect((await setGender(b, anna, "female")).relabel.map((r) => [r.fromName, r.label])).toEqual([
    ["Anna", "Vermieter:in"],
    ["Tom", "Kollege"],
    ["Anna", "Nachbar:in"],
  ]);
});

test("a first gender asks only for the person's words still in a neutral form; a change of gender asks for all of them", async () => {
  const anna = await createPerson(a, { name: "Anna" });
  const tom = await createPerson(a, { name: "Tom" });
  const lena = await createPerson(a, { name: "Lena" });
  const rel = async (from: string, to: string, label: string, inverse: string) => {
    const id = newId();
    await (
      await testDb()
    )
      .insertInto("relationships")
      .values({
        id,
        from_id: from,
        to_id: to,
        label,
        inverse,
        note: null,
        visibility: "shared",
        recorded_by: a.userId,
        conversation_id: null,
        created_at: now(),
      })
      .execute();
    return id;
  };
  const neutral = await rel(anna, tom, "Vermieter:in", "Mieter");
  const kind = await rel(lena, anna, "Mutter", "Kind");
  await rel(anna, lena, "Kollegin", "Kollege");
  // Anna's own words: "Vermieter:in" and "Kind" are neutral; "Kollegin" was already written in her gender.
  expect((await setGender(a, anna, "female")).relabel.map((r) => r.id)).toEqual([neutral, kind]);
  // The same gender again asks for nothing; another one asks for every word of hers.
  expect((await setGender(a, anna, "female")).relabel).toEqual([]);
  expect((await setGender(a, anna, "male")).relabel).toHaveLength(3);
});
