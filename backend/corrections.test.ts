import { beforeEach, expect, test } from "vitest";
import { deleteItem, editItem, factToRelationship, markDone, markOutdated, mergePeople, renamePerson, setVisibility, shareTranscript } from "./corrections";
import { briefing } from "./briefing";
import { getConversation, recordConversation, remember } from "./conversations";
import { db } from "./db/testing";
import { ForbiddenError, InvalidInputError, NotFoundError } from "./errors";
import { setCheckInInterval } from "./intervals";
import { getPerson } from "./people";
import { addDays, today } from "./dates";
import { seed, type Seed } from "./testing/fixtures";

let s: Seed;

beforeEach(async () => {
  s = await seed();
});

/** A's shared lunch with Anna: a shared and a private promise, a shared exchange, a private fact; the transcript is private. */
async function lunch() {
  const r = await recordConversation(s.a, {
    date: "2026-10-21",
    kind: "in_person",
    summary: "Lunch with Anna.",
    transcript: "Lunch. In confidence: she is looking for a new flat.",
    visibility: "shared",
    people: [{ id: s.anna, present: true }],
    facts: [{ person: 0, text: "flat hunting", category: "home", private: true }],
    promises: [
      { person: 0, text: "send the recipe", byMe: true },
      { person: 0, text: "keep the secret", byMe: true, private: true },
    ],
    exchanges: [{ person: 0, kind: "lent", direction: "to_them", text: "book" }],
  });
  const d = await db();
  const id = async (t: "facts" | "promises" | "exchanges", text: string) =>
    (await d.selectFrom(t).select("id").where("text", "=", text).executeTakeFirstOrThrow()).id;
  return {
    conversation: r.conversationId,
    privateFact: await id("facts", "flat hunting"),
    sharedPromise: await id("promises", "send the recipe"),
    privatePromise: await id("promises", "keep the secret"),
    exchange: await id("exchanges", "book"),
  };
}

const factId = async (text: string) => (await (await db()).selectFrom("facts").select("id").where("text", "=", text).executeTakeFirstOrThrow()).id;

test("the partner may edit and delete my shared item, but not change its visibility or touch my conversation", async () => {
  const id = await factId("new job");
  await editItem(s.b, "facts", id, { text: "neuer Job im Museum" });
  const row = await (await db()).selectFrom("facts").select(["text", "recorded_by", "visibility"]).where("id", "=", id).executeTakeFirstOrThrow();
  // It stays mine and shared: the partner changed what it says, not whose it is.
  expect(row).toEqual({ text: "neuer Job im Museum", recorded_by: s.a.userId, visibility: "shared" });
  await expect(setVisibility(s.b, "facts", id, "private")).rejects.toBeInstanceOf(ForbiddenError);
  await expect(editItem(s.b, "conversations", s.dinner, { summary: "x" })).rejects.toBeInstanceOf(ForbiddenError);
  await expect(deleteItem(s.b, "conversations", s.dinner)).rejects.toBeInstanceOf(ForbiddenError);
  await deleteItem(s.b, "facts", id);
  expect(await (await db()).selectFrom("facts").select("id").where("id", "=", id).executeTakeFirst()).toBeUndefined();
});

test("acting on my private item is not_found for the partner, whatever the action", async () => {
  const l = await lunch();
  const divorce = await factId("divorce");
  for (const act of [
    () => deleteItem(s.b, "facts", divorce),
    () => editItem(s.b, "facts", divorce, { text: "x" }),
    () => setVisibility(s.b, "facts", divorce, "shared"),
    () => markOutdated(s.b, divorce),
    () => markDone(s.b, "promises", l.privatePromise),
    () => deleteItem(s.b, "conversations", s.coffee),
  ])
    await expect(act()).rejects.toBeInstanceOf(NotFoundError);
});

test("an unknown id is not_found", async () => {
  await expect(deleteItem(s.a, "facts", "nope")).rejects.toBeInstanceOf(NotFoundError);
  await expect(markOutdated(s.a, "nope")).rejects.toBeInstanceOf(NotFoundError);
});

test("either user may mark a shared promise done, a shared fact outdated and a shared exchange settled", async () => {
  const l = await lunch();
  await markDone(s.b, "promises", l.sharedPromise);
  await markDone(s.b, "exchanges", l.exchange);
  await markOutdated(s.b, await factId("new job"));
  const c = await getConversation(s.b, l.conversation);
  expect(c.promises.map((p) => [p.text, p.done])).toEqual([["send the recipe", true]]);
  expect(c.exchanges[0].settled).toBe(true);
  expect((await getConversation(s.b, s.dinner)).facts[0].status).toBe("outdated");
});

test("the recorder may mark their own private promise done", async () => {
  const l = await lunch();
  await markDone(s.a, "promises", l.privatePromise);
  expect((await getConversation(s.a, l.conversation)).promises.find((p) => p.id === l.privatePromise)?.done).toBe(true);
});

test("the recorder edits an item and bad values are invalid_input", async () => {
  const l = await lunch();
  await editItem(s.a, "promises", l.sharedPromise, {
    text: "send the cake recipe",
    due: "2026-11-01",
    byMe: false,
  });
  const p = (await getConversation(s.a, l.conversation)).promises.find((x) => x.id === l.sharedPromise)!;
  expect([p.text, p.due, p.byMe]).toEqual(["send the cake recipe", "2026-11-01", false]);
  await editItem(s.a, "conversations", l.conversation, {
    summary: "Lunch, better summary",
  });
  expect((await getConversation(s.a, l.conversation)).summary).toBe("Lunch, better summary");
  await expect(editItem(s.a, "promises", l.sharedPromise, { due: "tomorrow" })).rejects.toBeInstanceOf(InvalidInputError);
  await expect(editItem(s.a, "promises", l.sharedPromise, { person_id: "x" })).rejects.toBeInstanceOf(InvalidInputError);
  await expect(editItem(s.a, "facts", l.privateFact, { category: "nonsense" })).rejects.toBeInstanceOf(InvalidInputError);
  await expect(editItem(s.a, "facts", l.privateFact, {})).rejects.toBeInstanceOf(InvalidInputError);
});

test("sharing every item keeps the transcript private until the recorder shares it; a private item hides it again", async () => {
  const l = await lunch();
  const transcriptPrivate = async (id: string) =>
    (await (await db()).selectFrom("rambles").select("transcript_private").where("id", "=", (qb) => qb.selectFrom("conversations").select("ramble_id").where("id", "=", id)).executeTakeFirstOrThrow()).transcript_private;
  expect(await transcriptPrivate(l.conversation)).toBe(1);
  await setVisibility(s.a, "promises", l.privatePromise, "shared");
  await expect(shareTranscript(s.a, l.conversation)).rejects.toBeInstanceOf(InvalidInputError); // the private fact remains
  await setVisibility(s.a, "facts", l.privateFact, "shared");
  expect(await transcriptPrivate(l.conversation)).toBe(1);
  await shareTranscript(s.a, l.conversation);
  expect(await transcriptPrivate(l.conversation)).toBe(0);
  expect((await getConversation(s.b, l.conversation)).transcript).toContain("new flat");
  await setVisibility(s.a, "exchanges", l.exchange, "private");
  expect(await transcriptPrivate(l.conversation)).toBe(1);
  expect((await getConversation(s.b, l.conversation)).transcript).toBeNull();

  // The coffee is private: its items can't be shared on their own, and B's briefing never shows them.
  const coffeeFact = await factId("thinking about quitting");
  await expect(setVisibility(s.a, "facts", coffeeFact, "shared")).rejects.toBeInstanceOf(InvalidInputError);
  expect(await transcriptPrivate(s.coffee)).toBe(1);
  expect(JSON.stringify(await briefing(s.b, s.lena))).not.toContain("quitting");
  await expect(getConversation(s.b, s.coffee)).rejects.toBeInstanceOf(NotFoundError);
});

test("a conversation set to private hides it and its items from the partner and hides the transcript", async () => {
  await setVisibility(s.a, "conversations", s.dinner, "private");
  await expect(getConversation(s.b, s.dinner)).rejects.toBeInstanceOf(NotFoundError);
  const d = await db();
  const rows = await d.selectFrom("facts").select("visibility").where("conversation_id", "=", s.dinner).execute();
  expect(rows.every((r) => r.visibility === "private")).toBe(true);
  expect((await getConversation(s.a, s.dinner)).facts.map((f) => f.visibility)).toEqual(["private", "private"]);
});

test("setting a conversation back to shared does not flip its private items or reveal the transcript", async () => {
  await setVisibility(s.a, "conversations", s.dinner, "private");
  await setVisibility(s.a, "conversations", s.dinner, "shared");
  const c = await getConversation(s.b, s.dinner);
  expect(c.facts).toEqual([]);
  expect(c.transcript).toBeNull();
});

test("deleting a conversation deletes its items and participants; deleting an item leaves the rest", async () => {
  const l = await lunch();
  await deleteItem(s.a, "promises", l.sharedPromise);
  expect((await getConversation(s.a, l.conversation)).promises.map((p) => p.text)).toEqual(["keep the secret"]);
  await deleteItem(s.a, "conversations", l.conversation);
  const d = await db();
  await expect(getConversation(s.a, l.conversation)).rejects.toBeInstanceOf(NotFoundError);
  expect(await d.selectFrom("facts").select("id").where("conversation_id", "=", l.conversation).execute()).toEqual([]);
  expect(await d.selectFrom("participants").select("person_id").where("conversation_id", "=", l.conversation).execute()).toEqual([]);
});

test("renamePerson changes the name for everyone; a blank name is invalid", async () => {
  await renamePerson(s.b, s.anna, "Anna Schmidt");
  expect((await getPerson(s.a, s.anna)).name).toBe("Anna Schmidt");
  await expect(renamePerson(s.b, s.anna, "  ")).rejects.toBeInstanceOf(InvalidInputError);
  await expect(renamePerson(s.b, "nope", "X")).rejects.toBeInstanceOf(NotFoundError);
});

async function duplicateAnna() {
  const r = await recordConversation(s.a, {
    date: "2026-10-22",
    kind: "call",
    summary: "Call with A. Schmidt.",
    transcript: "Call.",
    visibility: "shared",
    people: [{ name: "Anna Schmidt", aliases: ["Annie", "Anna"], present: true }],
    facts: [
      { person: 0, text: "dup private", category: "other", private: true },
      { person: 0, text: "dup shared", category: "other" },
    ],
    dates: [
      {
        person: 0,
        kind: "birthday",
        date: "1990-03-01",
        yearly: true,
        private: true,
      },
    ],
    groups: [{ name: "Choir", members: [0], private: true }],
  });
  return { dup: r.people[0].id, conversation: r.conversationId };
}

test("mergePeople moves items and keeps their visibility", async () => {
  const { dup, conversation } = await duplicateAnna();
  await mergePeople(s.b, s.anna, dup);
  const d = await db();
  expect(await d.selectFrom("persons").select("id").where("id", "=", dup).execute()).toEqual([]);
  const facts = await d.selectFrom("facts").select(["text", "visibility", "person_id"]).where("text", "like", "dup%").orderBy("text").execute();
  expect(facts).toEqual([
    { text: "dup private", visibility: "private", person_id: s.anna },
    { text: "dup shared", visibility: "shared", person_id: s.anna },
  ]);
  const forB = await getConversation(s.b, conversation);
  expect(forB.facts.map((f) => f.text)).toEqual(["dup shared"]);
  expect(forB.dates).toEqual([]);
  expect(forB.participants.map((p) => p.id).sort()).toEqual([s.anna, s.a.personId].sort());
  const p = await getPerson(s.b, s.anna);
  expect(p.aliases.sort()).toEqual(["Anna Schmidt", "Annie"]);
});

test("mergePeople handles colliding aliases, participants, memberships and the relationship between the two", async () => {
  const { dup } = await duplicateAnna();
  const d = await db();
  // The same group membership for both, by the same recorder; and one conversation with both of them.
  await d.insertInto("groups").values({ id: "g2", name: "Book club", created_at: 0 }).execute();
  for (const p of [s.anna, dup])
    await d
      .insertInto("group_members")
      .values({
        group_id: "g2",
        person_id: p,
        visibility: "shared",
        recorded_by: s.a.userId,
      })
      .execute();
  await d
    .insertInto("group_members")
    .values({
      group_id: "g2",
      person_id: dup,
      visibility: "private",
      recorded_by: s.b.userId,
    })
    .execute();
  const both = await recordConversation(s.a, {
    date: "2026-10-23",
    kind: "event",
    summary: "Party.",
    transcript: "Party.",
    visibility: "shared",
    people: [
      { id: s.anna, present: true },
      { id: dup, present: true },
    ],
    relationships: [{ from: 0, to: 1, label: "Bekannte:r", inverse: "Bekannte:r" }],
  });
  await mergePeople(s.a, s.anna, dup);
  expect(
    (await d.selectFrom("participants").select("person_id").where("conversation_id", "=", both.conversationId).execute())
      .map((r) => r.person_id)
      .sort(),
  ).toEqual([s.a.personId, s.anna].sort());
  expect(await d.selectFrom("relationships").select("id").where("conversation_id", "=", both.conversationId).execute()).toEqual([]);
  const members = await d
    .selectFrom("group_members")
    .select(["group_id", "person_id", "recorded_by", "visibility"])
    .where("group_id", "=", "g2")
    .execute();
  expect(members).toHaveLength(2);
  expect(members.every((m) => m.person_id === s.anna)).toBe(true);
  expect(await d.selectFrom("group_members").select("person_id").where("person_id", "=", dup).execute()).toEqual([]);
  expect((await d.selectFrom("aliases").select("norm").where("person_id", "=", s.anna).execute()).map((r) => r.norm).sort()).toEqual([
    "anna schmidt",
    "annie",
  ]);
});

test("mergePeople keeps the confirmed interval, otherwise the smaller one, per user", async () => {
  const { dup } = await duplicateAnna();
  await setCheckInInterval(s.a, s.anna, 28, false);
  await setCheckInInterval(s.a, dup, 56, true);
  await setCheckInInterval(s.b, s.anna, 35, false);
  await setCheckInInterval(s.b, dup, 21, false);
  await setCheckInInterval(s.a, s.tom, 14, false); // untouched
  await mergePeople(s.a, s.anna, dup);
  const rows = await (
    await db()
  )
    .selectFrom("person_settings")
    .select(["user_id", "person_id", "interval_days", "interval_confirmed"])
    .where("person_id", "=", s.anna)
    .execute();
  const by = (u: string) => rows.find((r) => r.user_id === u);
  expect([by(s.a.userId)?.interval_days, by(s.a.userId)?.interval_confirmed]).toEqual([56, 1]);
  expect([by(s.b.userId)?.interval_days, by(s.b.userId)?.interval_confirmed]).toEqual([21, 0]);
  expect(rows).toHaveLength(2);
});

test("mergePeople moves a setting that only the dropped person had", async () => {
  const { dup } = await duplicateAnna();
  await setCheckInInterval(s.b, dup, 21, true);
  await mergePeople(s.a, s.anna, dup);
  const row = await (await db()).selectFrom("person_settings").selectAll().where("person_id", "=", s.anna).executeTakeFirstOrThrow();
  expect([row.user_id, row.interval_days, row.interval_confirmed]).toEqual([s.b.userId, 21, 1]);
});

test("mergePeople refuses to drop a user's own person but merges a duplicate into one", async () => {
  await expect(mergePeople(s.a, s.anna, s.b.personId)).rejects.toBeInstanceOf(InvalidInputError);
  await expect(mergePeople(s.a, s.anna, s.a.personId)).rejects.toBeInstanceOf(InvalidInputError);
  const { dup } = await duplicateAnna();
  await mergePeople(s.a, s.a.personId, dup);
  const d = await db();
  expect(await d.selectFrom("persons").select("id").where("id", "=", dup).execute()).toEqual([]);
  expect((await d.selectFrom("facts").select("id").where("text", "=", "dup shared").where("person_id", "=", s.a.personId).execute()).length).toBe(1);
});

test("mergePeople refuses itself and unknown persons", async () => {
  await expect(mergePeople(s.a, s.anna, s.anna)).rejects.toBeInstanceOf(InvalidInputError);
  await expect(mergePeople(s.a, s.anna, "nope")).rejects.toBeInstanceOf(NotFoundError);
  await expect(mergePeople(s.a, "nope", s.anna)).rejects.toBeInstanceOf(NotFoundError);
});

test("on a membership collision the less restrictive row wins", async () => {
  const { dup } = await duplicateAnna();
  const d = await db();
  await d.insertInto("groups").values({ id: "g3", name: "Hiking", created_at: 0 }).execute();
  const row = (person_id: string, visibility: string) => ({ group_id: "g3", person_id, visibility, recorded_by: s.a.userId });
  await d
    .insertInto("group_members")
    .values([row(s.anna, "private"), row(dup, "shared")])
    .execute();
  await mergePeople(s.a, s.anna, dup);
  const rows = await d.selectFrom("group_members").select(["person_id", "visibility"]).where("group_id", "=", "g3").execute();
  expect(rows).toEqual([{ person_id: s.anna, visibility: "shared" }]);
});

async function choir(over: { private: boolean }) {
  const r = await recordConversation(s.a, {
    date: "2026-10-22",
    kind: "event",
    summary: "Choir practice.",
    transcript: "Choir practice with Anna.",
    visibility: "shared",
    people: [{ id: s.anna, present: true }],
    facts: [{ person: 0, text: "sings alto", category: "hobby" }],
    groups: [{ name: "Choir", members: [0], private: over.private }],
  });
  return r.conversationId;
}

test("a private membership keeps the transcript private when another item is shared", async () => {
  const c = await choir({ private: true });
  const d = await db();
  const tp = async () =>
    (await d.selectFrom("rambles").select("transcript_private").where("id", "=", (qb) => qb.selectFrom("conversations").select("ramble_id").where("id", "=", c)).executeTakeFirstOrThrow()).transcript_private;
  expect(await tp()).toBe(1);
  await setVisibility(s.a, "facts", await factId("sings alto"), "private");
  await setVisibility(s.a, "facts", await factId("sings alto"), "shared");
  expect(await tp()).toBe(1);
});

test("a conversation set to private makes its memberships private", async () => {
  const c = await choir({ private: false });
  await setVisibility(s.a, "conversations", c, "private");
  const d = await db();
  const rows = await d.selectFrom("group_members").select("visibility").where("conversation_id", "=", c).execute();
  expect(rows).toEqual([{ visibility: "private" }]);
});

test("editItem rejects inherited property names as fields", async () => {
  const id = await factId("new job");
  await expect(editItem(s.a, "facts", id, { constructor: "x" })).rejects.toBeInstanceOf(InvalidInputError);
  await expect(editItem(s.a, "facts", id, { toString: "x" })).rejects.toBeInstanceOf(InvalidInputError);
});

test("the recorder can move a conversation to an earlier day, not to a future one", async () => {
  await editItem(s.a, "conversations", s.dinner, { date: "2026-10-18" });
  expect((await getConversation(s.a, s.dinner)).date).toBe("2026-10-18");
  await expect(editItem(s.a, "conversations", s.dinner, { date: "2999-01-01" })).rejects.toThrow(InvalidInputError);
  await expect(editItem(s.b, "conversations", s.dinner, { date: "2026-10-18" })).rejects.toThrow(ForbiddenError);
});

test("edit moves a fact between lasting and situation", async () => {
  await remember(s.a, { visibility: "shared", facts: [{ person: s.anna, text: "renoviert das Bad", category: "home" }] });
  const id = await factId("renoviert das Bad");
  const row = async () => (await db()).selectFrom("facts").select(["kind", "check_after"]).where("id", "=", id).executeTakeFirstOrThrow();
  await editItem(s.a, "facts", id, { kind: "situation", checkAfter: "2026-11-30" });
  expect(await row()).toEqual({ kind: "situation", check_after: "2026-11-30" });
  await editItem(s.a, "facts", id, { checkAfter: "2026-12-24" });
  expect(await row()).toEqual({ kind: "situation", check_after: "2026-12-24" });
  await editItem(s.a, "facts", id, { kind: "lasting" });
  expect(await row()).toEqual({ kind: "lasting", check_after: null });
  await editItem(s.a, "facts", id, { kind: "situation" });
  expect(await row()).toEqual({ kind: "situation", check_after: addDays(today(), 42) });
  await expect(editItem(s.a, "facts", id, { checkAfter: "x" })).rejects.toBeInstanceOf(InvalidInputError);
  await expect(editItem(s.a, "facts", id, { kind: "rumour" })).rejects.toBeInstanceOf(InvalidInputError);
  await editItem(s.a, "facts", id, { kind: "lasting" });
  await expect(editItem(s.a, "facts", id, { checkAfter: "2026-12-24" })).rejects.toBeInstanceOf(InvalidInputError);
});

test("a fact becomes a relationship and keeps its privacy", async () => {
  await remember(s.a, { visibility: "private", facts: [{ person: s.anna, text: "Unsere Vermieterin", category: "home" }] });
  const id = await factId("Unsere Vermieterin");
  await expect(factToRelationship(s.b, id, { from: s.anna, to: "us", label: "Vermieter:in", inverse: "Mieter:in" })).rejects.toBeInstanceOf(NotFoundError);
  const { ids } = await factToRelationship(s.a, id, { from: s.anna, to: "us", label: "Vermieter:in", inverse: "Mieter:in" });
  const rows = await (await db()).selectFrom("relationships").selectAll().where("id", "in", ids).execute();
  expect(rows.map((r) => [r.from_id, r.label, r.inverse, r.visibility, r.recorded_by === s.a.userId])).toEqual([
    [s.anna, "Vermieter:in", "Mieter:in", "private", true],
    [s.anna, "Vermieter:in", "Mieter:in", "private", true],
  ]);
  expect(rows.map((r) => r.to_id).sort()).toEqual([s.a.personId, s.b.personId].sort());
  expect(await (await db()).selectFrom("facts").select("id").where("id", "=", id).executeTakeFirst()).toBeUndefined();

  // A relationship that leaves out the fact's person is refused; the partner may turn a shared fact into one.
  await remember(s.a, { visibility: "shared", facts: [{ person: s.anna, text: "Kollegin von mir", category: "work" }] });
  const shared = await factId("Kollegin von mir");
  await expect(factToRelationship(s.a, shared, { from: s.lena, to: "me", label: "Kolleg:in", inverse: "Kolleg:in" })).rejects.toBeInstanceOf(InvalidInputError);
  expect(await factId("Kollegin von mir")).toBe(shared);
  const moved = await factToRelationship(s.b, shared, { from: s.anna, to: "me", label: "Kollegin", inverse: "Kollege" });
  expect(moved.relationships).toMatchObject([{ fromId: s.anna, toId: s.b.personId, label: "Kollegin" }]);
  expect(await (await db()).selectFrom("facts").select("id").where("id", "=", shared).executeTakeFirst()).toBeUndefined();
});

test("edit turns a fact into a trait, which has no day to ask", async () => {
  await remember(s.a, { visibility: "shared", facts: [{ person: s.anna, text: "zieht um", category: "home", kind: "situation", checkAfter: "2026-11-30" }] });
  const id = await factId("zieht um");
  const row = async () => (await db()).selectFrom("facts").select(["kind", "check_after", "text", "category"]).where("id", "=", id).executeTakeFirstOrThrow();
  await editItem(s.a, "facts", id, { kind: "personality" });
  expect(await row()).toEqual({ kind: "personality", check_after: null, text: "zieht um", category: "home" });
  await editItem(s.a, "facts", id, { kind: "need" });
  expect(await row()).toEqual({ kind: "need", check_after: null, text: "zieht um", category: "home" });
  await expect(editItem(s.a, "facts", id, { kind: "need", checkAfter: "2026-12-01" })).rejects.toBeInstanceOf(InvalidInputError);
  await expect(editItem(s.a, "facts", id, { checkAfter: "2026-12-01" })).rejects.toBeInstanceOf(InvalidInputError);
});
