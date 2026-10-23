// The partner must never see a private item, through any read function. One fixture, every read, as the other user (B on A's
// recordings). Every later task that adds a read function adds its assertions here.
import { beforeEach, expect, test } from "vitest";
import { getConversation } from "./conversations";
import { NotFoundError } from "./errors";
import { findPeople, getPerson, listPeople } from "./people";
import { DINNER_TRANSCRIPT, seed, type Seed } from "./testing/fixtures";

let s: Seed;

beforeEach(async () => {
  s = await seed();
});

test("getConversation shows B the shared summary and items of A's dinner, but no transcript", async () => {
  const c = await getConversation(s.b, s.dinner);
  expect(c.summary).toBe("Dinner with Anna; she has a new job.");
  expect(c.transcript).toBeNull();
  expect(c.facts.map((f) => f.text)).toEqual(["new job"]);
  expect(c.relationships).toEqual([]);
  expect(c.dates).toEqual([]);
  expect(c.participants.map((p) => p.name).sort()).toEqual(["Alice", "Anna"]);
});

test("A, the recorder, sees the transcript and every item", async () => {
  const c = await getConversation(s.a, s.dinner);
  expect(c.transcript).toBe(DINNER_TRANSCRIPT);
  expect(c.facts.map((f) => f.text).sort()).toEqual(["divorce", "new job"]);
  expect(c.relationships).toHaveLength(1);
  expect(c.dates.map((d) => d.date)).toEqual(["--10-24"]);
});

test("A's private conversation does not exist for B; B's shared call is visible to A in full", async () => {
  await expect(getConversation(s.b, s.coffee)).rejects.toBeInstanceOf(NotFoundError);
  const call = await getConversation(s.a, s.call);
  expect(call.transcript).toBe("Called Anna, we talked about hiking on the weekend.");
});

test("Tom exists for B, but without the partner edge or the birthday", async () => {
  const [tom] = await findPeople(s.b, "Tom");
  expect(tom.id).toBe(s.tom);
  expect(tom.context).toEqual([]);
  expect((await findPeople(s.a, "Tom"))[0].context).toEqual(["partner of Anna"]);
  const [anna] = await findPeople(s.b, "Anna");
  expect(anna.context.join(" ")).not.toContain("Tom");
});

test("createdFrom never points B at where a person was first mentioned in private", async () => {
  // Tom: first mentioned at the shared dinner, but only through private items.
  expect((await getPerson(s.b, s.tom)).createdFrom).toBeNull();
  expect((await getPerson(s.a, s.tom)).createdFrom).toBe(s.dinner);
  // Lena: first mentioned in a private conversation.
  expect((await getPerson(s.b, s.lena)).createdFrom).toBeNull();
  expect((await getPerson(s.a, s.lena)).createdFrom).toBe(s.coffee);
  // Anna was at the shared dinner, so the link is no secret.
  expect((await getPerson(s.b, s.anna)).createdFrom).toBe(s.dinner);
  const listed = new Map((await listPeople(s.b)).map((p) => [p.id, p.createdFrom]));
  expect([listed.get(s.tom), listed.get(s.lena), listed.get(s.anna)]).toEqual([null, null, s.dinner]);
});

test("names and aliases are shared: B finds Lena, without context", async () => {
  const [lena] = await findPeople(s.b, "Lena");
  expect(lena).toMatchObject({ id: s.lena, name: "Lena", context: [] });
});
