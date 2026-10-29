import { beforeEach, expect, test } from "vitest";
import { getConversation, record } from "./conversations";
import { db } from "./db/testing";
import { deleteItem, editItem } from "./corrections";
import { AmbiguousError, InvalidInputError } from "./errors";
import { addPlaceAlias, findPlaces, mergePlaces, renamePlace } from "./places";
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
