// The partner must never see a private item, through any read function. One fixture, every read, as the other user (B on A's
// recordings). Every later task that adds a read function adds its assertions here.
import { beforeEach, expect, test } from "vitest";
import { getConversation, recordConversation } from "./conversations";
import { db } from "./db/testing";
import { InvalidInputError, NotFoundError } from "./errors";
import { findPeople, getPerson, listPeople } from "./people";
import { DINNER_TRANSCRIPT, seed, type Seed } from "./testing/fixtures";
import type { Viewer } from "./types";
import { visible } from "./visibility";

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

const record = (v: Viewer, over: Partial<Parameters<typeof recordConversation>[1]>) =>
  recordConversation(v, { date: "2026-10-21", kind: "call", summary: "s", transcript: "t", visibility: "shared", people: [{ id: s.anna, present: true }], ...over });

test("A's private group membership neither blocks nor reveals itself to B's shared one for the same group and person", async () => {
  const mine = await record(s.a, { groups: [{ name: "Uni", members: [0], private: true }] });
  const theirs = await record(s.b, { groups: [{ name: "Uni", members: [0] }] });
  expect([mine.counts.groups, theirs.counts.groups]).toEqual([1, 1]);
  const seen = async (v: Viewer) =>
    (
      await (await db())
        .selectFrom("group_members")
        .innerJoin("groups", "groups.id", "group_members.group_id")
        .select(["groups.name", "group_members.visibility"])
        .where("group_members.person_id", "=", s.anna)
        .$call((qb) => visible(qb, v, "group_members"))
        .orderBy("group_members.visibility")
        .execute()
    ).map((r) => `${r.name}/${r.visibility}`);
  expect(await seen(s.b)).toEqual(["Uni/shared"]);
  expect(await seen(s.a)).toEqual(["Uni/private", "Uni/shared"]);
});

test("a private fact can't outdate B's shared fact, so B's fact stays current", async () => {
  const d = await db();
  const hiking = (await d.selectFrom("facts").select("id").where("text", "=", "likes hiking").executeTakeFirstOrThrow()).id;
  const status = async () => (await d.selectFrom("facts").select("status").where("id", "=", hiking).executeTakeFirstOrThrow()).status;
  const replace = { person: 0, text: "hurt her knee, no more hiking", category: "health" as const, supersedes: hiking };
  await expect(record(s.a, { facts: [{ ...replace, private: true }] })).rejects.toThrow(/private fact can't replace a shared one/);
  await expect(record(s.a, { visibility: "private", facts: [replace] })).rejects.toBeInstanceOf(InvalidInputError);
  expect(await status()).toBe("current");
  // A shared update may replace it, whoever recorded the old fact.
  await record(s.a, { facts: [replace] });
  expect(await status()).toBe("outdated");
});

test("a private fact may replace the recorder's own private fact", async () => {
  const d = await db();
  const divorce = (await d.selectFrom("facts").select("id").where("text", "=", "divorce").executeTakeFirstOrThrow()).id;
  await record(s.a, { facts: [{ person: 0, text: "divorce is final", category: "family", private: true, supersedes: divorce }] });
  expect((await d.selectFrom("facts").select("status").where("id", "=", divorce).executeTakeFirstOrThrow()).status).toBe("outdated");
});
