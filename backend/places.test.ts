import { beforeEach, expect, test } from "vitest";
import { getConversation, record } from "./conversations";
import { db } from "./db/testing";
import { deleteItem, editItem } from "./corrections";
import { AmbiguousError, InvalidInputError } from "./errors";
import { getPlace, listExperiences } from "./experiences";
import { addPlaceAlias, addPlaceOwner, findPlaces, mergePlaces, removePlaceOwner, renamePlace, setPlaceAddress, setPlaceParent } from "./places";
import { seed, type Seed } from "./testing/fixtures";

let s: Seed;
beforeEach(async () => {
  s = await seed();
});

const at = (v: Seed["a"], place: unknown, visibility: "shared" | "private" = "shared") =>
  record(v, { date: "2026-10-28", transcript: "t", visibility, people: [{ id: s.anna }], conversations: [{ kind: "in_person", summary: "Treffen", present: [0], place } as never] });
const placeOf = async (v: Seed["a"], conversationId: string) => (await getConversation(v, conversationId)).placeId;

test("a conversation's place is a record; the same name, another name of it, or its id finds it again", async () => {
  const first = await at(s.a, "Hundeschule Pfotenglück");
  const id = await placeOf(s.a, first.conversations[0].id);
  expect(id).toBeTruthy();
  expect((await getConversation(s.a, first.conversations[0].id)).place).toBe("Hundeschule Pfotenglück");
  await addPlaceAlias(s.a, id!, "die Hundeschule");
  expect(await placeOf(s.a, (await at(s.a, "hundeschule pfotenglück")).conversations[0].id)).toBe(id);
  expect(await placeOf(s.a, (await at(s.a, "die Hundeschule")).conversations[0].id)).toBe(id);
  expect(await placeOf(s.a, (await at(s.a, { id })).conversations[0].id)).toBe(id);
  expect((await findPlaces(s.a, "Pfotengluck")).map((p) => p.id)).toEqual([id]);
});

test("a near spelling is asked about, not guessed; confirmedNew makes a new place", async () => {
  await at(s.a, "Café Lisa");
  await expect(at(s.a, "Café Lise")).rejects.toThrow(AmbiguousError);
  const r = await at(s.a, { name: "Café Lise", confirmedNew: true });
  expect((await getConversation(s.a, r.conversations[0].id)).place).toBe("Café Lise");
});

test("a place the partner holds only through a private conversation is neither found nor reused", async () => {
  const mine = await at(s.a, "Praxis Dr. Weber", "private");
  const id = await placeOf(s.a, mine.conversations[0].id);
  expect(await findPlaces(s.b, "Praxis Dr. Weber")).toEqual([]);
  const theirs = await at(s.b, "Praxis Dr. Weber");
  expect(await placeOf(s.b, theirs.conversations[0].id)).not.toBe(id);
});

test("renaming keeps the old name as another name; merging moves conversations and other names", async () => {
  const a = await at(s.a, "Pfotenglück");
  const b = await at(s.a, { name: "Hundeschule am See", confirmedNew: true });
  const keep = (await placeOf(s.a, a.conversations[0].id))!;
  const drop = (await placeOf(s.a, b.conversations[0].id))!;
  await renamePlace(s.a, keep, "Hundeschule Pfotenglück");
  await mergePlaces(s.a, keep, drop);
  expect(await placeOf(s.a, b.conversations[0].id)).toBe(keep);
  const [found] = await findPlaces(s.a, "Hundeschule am See");
  expect(found).toMatchObject({ id: keep, name: "Hundeschule Pfotenglück", aliases: expect.arrayContaining(["Pfotenglück", "Hundeschule am See"]) });
  expect(await (await db()).selectFrom("places").select("id").where("id", "=", drop).execute()).toEqual([]);
});

test("minor: merging a place the partner sees into one they can't is refused, so its name never reaches them", async () => {
  const mine = await at(s.a, "Tagesklinik Nord", "private");
  const shared = await at(s.a, { name: "Tagesklinik", confirmedNew: true });
  const hidden = (await placeOf(s.a, mine.conversations[0].id))!;
  const seen = (await placeOf(s.a, shared.conversations[0].id))!;
  await expect(mergePlaces(s.a, hidden, seen)).rejects.toThrow(InvalidInputError);
  await mergePlaces(s.a, seen, hidden);
  expect((await findPlaces(s.b, "Tagesklinik")).map((p) => p.name)).toEqual(["Tagesklinik"]);
});

test("minor: a conversation's place patch of the wrong type is refused, and a failing edit leaves no new place", async () => {
  const r = await at(s.a, "Café Lisa");
  await expect(editItem(s.a, "conversations", r.conversations[0].id, { place: 5 })).rejects.toThrow(InvalidInputError);
  const before = (await (await db()).selectFrom("places").select("id").execute()).length;
  await expect(editItem(s.a, "conversations", r.conversations[0].id, { place: "Neues Café", kind: "nope" })).rejects.toThrow(InvalidInputError);
  expect((await (await db()).selectFrom("places").select("id").execute()).length).toBe(before);
});

test("minor: a place whose last part was deleted is found no more, not even by whoever made it", async () => {
  const r = await at(s.a, "Eisdiele am Eck");
  await deleteItem(s.a, "conversations", r.conversations[0].id);
  expect(await findPlaces(s.a, "Eisdiele am Eck")).toEqual([]);
});

test("a new database has places with a parent, an address, and owners", async () => {
  const d = await db();
  await d.insertInto("places").values({ id: "muc", name: "München", created_by: s.a.userId, created_at: 1 }).execute();
  await d.insertInto("places").values({ id: "oly", name: "Olympiahalle", created_by: s.a.userId, created_at: 1, parent_id: "muc", address: "Spiridon-Louis-Ring 21" }).execute();
  await d.insertInto("place_owners").values({ place_id: "oly", person_id: s.anna, visibility: "private", recorded_by: s.a.userId, created_at: 1 }).execute();
  expect(await d.selectFrom("places").select(["parent_id", "address"]).where("id", "=", "oly").executeTakeFirst()).toEqual({ parent_id: "muc", address: "Spiridon-Louis-Ring 21" });
  expect(await d.selectFrom("place_owners").select(["person_id", "visibility"]).execute()).toEqual([{ person_id: s.anna, visibility: "private" }]);
});

// Nesting set by hand until record files it: `inside(child, parent)`.
const inside = async (child: string, parent: string) => (await db()).updateTable("places").set({ parent_id: parent }).where("id", "=", child).execute();
const experienceAt = (v: Seed["a"], place: unknown, visibility: "shared" | "private" = "shared") =>
  record(v, { date: "2026-10-28", transcript: "t", visibility, people: [{ id: s.anna }], experiences: [{ kind: "Konzert", title: "Konzert", place, present: [0] } as never] });

test("a place inside another shows its parents, and the parent's page shows what happened inside", async () => {
  const muc = (await placeOf(s.a, (await at(s.a, "München")).conversations[0].id))!;
  const oly = (await placeOf(s.a, (await at(s.a, "Olympiahalle")).conversations[0].id))!;
  await inside(oly, muc);
  const concert = await experienceAt(s.a, { id: oly });
  const view = await getPlace(s.a, muc);
  expect(view.inside.map((p) => p.name)).toEqual(["Olympiahalle"]);
  expect(view.conversations).toHaveLength(2);
  expect(view.experiences.map((e) => e.id)).toEqual([concert.experiences[0].id]);
  expect((await findPlaces(s.a, "Olympiahalle"))[0].parents.map((p) => p.name)).toEqual(["München"]);
  expect((await listExperiences(s.a, { placeId: muc })).map((e) => e.id)).toEqual([concert.experiences[0].id]);
});

test("a place whose only link to the viewer is a parent of a place they see is found, with nothing of what's not theirs", async () => {
  const oly = (await placeOf(s.a, (await at(s.a, "Olympiahalle")).conversations[0].id))!;
  const d = await db();
  await d.insertInto("places").values({ id: "bay", name: "Bayern", created_by: s.a.userId, created_at: 1 }).execute();
  await inside(oly, "bay");
  expect((await findPlaces(s.b, "Bayern")).map((p) => p.id)).toEqual(["bay"]);
  expect((await getPlace(s.b, "bay")).inside.map((p) => p.name)).toEqual(["Olympiahalle"]);
});

test("a place with only a visible owner is found, and shows its owner", async () => {
  const d = await db();
  await d.insertInto("places").values({ id: "home", name: "Annas Wohnung", created_by: s.a.userId, created_at: 1, address: "Hauptstraße 5" }).execute();
  await d.insertInto("place_owners").values({ place_id: "home", person_id: s.anna, visibility: "shared", recorded_by: s.a.userId, created_at: 1 }).execute();
  const [p] = await findPlaces(s.b, "Annas Wohnung");
  expect(p).toMatchObject({ id: "home", address: "Hauptstraße 5", owners: [{ id: s.anna, name: "Anna" }] });
});

test("a private place inside a shared one stays invisible downward, and a private home shows no owner", async () => {
  const muc = (await placeOf(s.b, (await at(s.b, "München")).conversations[0].id))!;
  const mine = await at(s.a, "Olympiahalle", "private");
  const oly = (await placeOf(s.a, mine.conversations[0].id))!;
  await inside(oly, muc);
  const privateConcert = await experienceAt(s.a, { id: oly }, "private");
  const bob = await getPlace(s.b, muc);
  expect(bob.inside).toEqual([]);
  expect(bob.conversations.map((c) => c.id)).not.toContain(mine.conversations[0].id);
  expect(bob.experiences).toEqual([]);
  expect(await findPlaces(s.b, "Olympiahalle")).toEqual([]);
  expect(await listExperiences(s.b, { placeId: muc })).toEqual([]);
  const alice = await getPlace(s.a, muc);
  expect(alice.inside.map((p) => p.id)).toEqual([oly]);
  expect(alice.experiences.map((e) => e.id)).toEqual([privateConcert.experiences[0].id]);

  await (await db()).insertInto("place_owners").values({ place_id: muc, person_id: s.anna, visibility: "private", recorded_by: s.a.userId, created_at: 1 }).execute();
  expect((await getPlace(s.b, muc)).owners).toEqual([]);
  expect((await getPlace(s.a, muc)).owners.map((o) => o.id)).toEqual([s.anna]);
});

const find = async (v: Seed["a"], name: string) => (await findPlaces(v, name)).find((p) => p.name === name);

test("'at the Olympiahalle in München' files both, nested; a later other parent doesn't overwrite it", async () => {
  await at(s.a, { name: "Olympiahalle", in: "München" });
  expect((await find(s.a, "Olympiahalle"))!.parents.map((p) => p.name)).toEqual(["München"]);
  await at(s.a, { name: "Olympiahalle", in: { name: "Bayern" } });
  expect((await find(s.a, "Olympiahalle"))!.parents.map((p) => p.name)).toEqual(["München"]);
  await at(s.a, { name: "München", in: "Bayern" });
  expect((await find(s.a, "Olympiahalle"))!.parents.map((p) => p.name)).toEqual(["München", "Bayern"]);
});

test("a home is a place with owners and an address, private when told in confidence", async () => {
  await at(s.a, { name: "Annas Wohnung", address: "Hauptstraße 5, 90402 Nürnberg", owners: [0] }, "private");
  expect(await find(s.a, "Annas Wohnung")).toMatchObject({ address: "Hauptstraße 5, 90402 Nürnberg", owners: [{ id: s.anna }] });
  expect(await find(s.b, "Annas Wohnung")).toBeUndefined();
});

test("an experience's place takes owners by index, and 'us' is the household", async () => {
  const r = await record(s.a, { date: "2026-10-28", transcript: "t", visibility: "shared", people: [{ id: s.anna }], experiences: [{ kind: "Feier", title: "Einweihung", place: { name: "Unser Haus", owners: ["us"] }, present: [0] } as never] });
  expect(r.experiences).toHaveLength(1);
  expect((await find(s.b, "Unser Haus"))!.owners.map((o) => o.id).sort()).toEqual([s.a.personId, s.b.personId].sort());
});

test("a loop is refused, even through a chain", async () => {
  await at(s.a, { name: "A", in: { name: "B", in: "C" } });
  const id = async (n: string) => (await find(s.a, n))!.id;
  await expect(setPlaceParent(s.a, await id("C"), await id("A"))).rejects.toThrow(InvalidInputError);
  await expect(setPlaceParent(s.a, await id("A"), await id("A"))).rejects.toThrow(InvalidInputError);
  await setPlaceParent(s.a, await id("A"), null);
  expect((await find(s.a, "A"))!.parents).toEqual([]);
});

test("an address is 1 to 200 characters; null clears it", async () => {
  await at(s.a, "Café Lisa");
  const { id } = (await find(s.a, "Café Lisa"))!;
  await expect(setPlaceAddress(s.a, id, "x".repeat(201))).rejects.toThrow(InvalidInputError);
  await setPlaceAddress(s.a, id, " Marktplatz 1 ");
  expect((await find(s.a, "Café Lisa"))!.address).toBe("Marktplatz 1");
  await setPlaceAddress(s.a, id, null);
  expect((await find(s.a, "Café Lisa"))!.address).toBeNull();
});

test("owners are added and dropped; a private one stays the recorder's", async () => {
  await at(s.a, "Annas Wohnung");
  const { id } = (await find(s.a, "Annas Wohnung"))!;
  await addPlaceOwner(s.a, id, s.anna, "private");
  expect((await find(s.b, "Annas Wohnung"))!.owners).toEqual([]);
  expect((await find(s.a, "Annas Wohnung"))!.owners.map((o) => o.id)).toEqual([s.anna]);
  await removePlaceOwner(s.a, id, s.anna);
  expect((await find(s.a, "Annas Wohnung"))!.owners).toEqual([]);
});

test("merging moves children and owners and keeps the kept place's parent and address", async () => {
  await at(s.a, { name: "Olympiahalle", in: "München", address: "Spiridon-Louis-Ring 21" });
  await at(s.a, { name: "Olympia-Halle", confirmedNew: true, in: "Bayern", address: "anders", owners: [0] });
  await at(s.a, { name: "Foyer", in: { name: "Olympia-Halle" } });
  const keep = (await find(s.a, "Olympiahalle"))!.id;
  const drop = (await find(s.a, "Olympia-Halle"))!.id;
  await addPlaceOwner(s.a, keep, s.anna, "shared");
  await mergePlaces(s.a, keep, drop);
  expect(await find(s.a, "Olympiahalle")).toMatchObject({ address: "Spiridon-Louis-Ring 21", parents: [{ name: "München" }], owners: [{ id: s.anna }] });
  expect((await find(s.a, "Foyer"))!.parents.map((p) => p.name)).toEqual(["Olympiahalle", "München"]);
});

test("'in' naming the partner's private place makes a new one", async () => {
  await at(s.a, "Klinik Nord", "private");
  const hers = (await find(s.a, "Klinik Nord"))!.id;
  await at(s.b, { name: "Cafeteria", in: "Klinik Nord" });
  const [parent] = (await find(s.b, "Cafeteria"))!.parents;
  expect(parent.name).toBe("Klinik Nord");
  expect(parent.id).not.toBe(hers);
});
