// The partner must never see a private item, through any read function. One fixture, every read, as the other user (B on A's
// recordings). Every later task that adds a read function adds its assertions here.
import { beforeEach, expect, test } from "vitest";
import { briefing } from "./briefing";
import { calendarFeed } from "./calendar";
import { getConversation, listConversations, recordConversation } from "./conversations";
import { deleteItem, setVisibility, shareTranscript } from "./corrections";
import { db } from "./db/testing";
import { ForbiddenError, InvalidInputError, NotFoundError } from "./errors";
import { whatsDue } from "./due";
import { lastSeen, setCheckInInterval } from "./intervals";
import { orbit } from "./orbit";
import { addToGroupById, deleteGroup, getGroup, listGroups, mergeGroups, removeFromGroup } from "./groups";
import { findPeople, getPerson, listPeople, peopleOverview } from "./people";
import { addRelationship, addToGroup } from "./relationships";
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

test("deleting or sharing the private items never re-exposes the dinner's transcript to B", async () => {
  const d = await db();
  const id = async (t: "facts" | "dates" | "relationships") => (await d.selectFrom(t).select("id").where("conversation_id", "=", s.dinner).where("visibility", "=", "private").executeTakeFirstOrThrow()).id;
  // The transcript still holds "divorce", whatever happens to the items recorded from it.
  await deleteItem(s.a, "facts", await id("facts"));
  await setVisibility(s.a, "relationships", await id("relationships"), "shared");
  await setVisibility(s.a, "dates", await id("dates"), "shared");
  expect((await getConversation(s.b, s.dinner)).transcript).toBeNull();
  await setVisibility(s.a, "conversations", s.dinner, "private");
  await setVisibility(s.a, "conversations", s.dinner, "shared");
  expect((await getConversation(s.b, s.dinner)).transcript).toBeNull();
  expect(JSON.stringify(await getConversation(s.b, s.dinner))).not.toContain("divorce");
});

test("only the recorder's explicit shareTranscript reveals a transcript, and only once nothing recorded with it is private", async () => {
  const d = await db();
  const privates = async (t: "facts" | "dates" | "relationships") => d.selectFrom(t).select("id").where("conversation_id", "=", s.dinner).where("visibility", "=", "private").execute();
  await expect(shareTranscript(s.a, s.dinner)).rejects.toBeInstanceOf(InvalidInputError);
  await expect(shareTranscript(s.b, s.dinner)).rejects.toBeInstanceOf(ForbiddenError);
  await expect(shareTranscript(s.b, s.coffee)).rejects.toBeInstanceOf(NotFoundError);
  for (const t of ["facts", "dates", "relationships"] as const) for (const r of await privates(t)) await setVisibility(s.a, t, r.id, "shared");
  await setVisibility(s.a, "conversations", s.dinner, "private");
  await expect(shareTranscript(s.a, s.dinner)).rejects.toBeInstanceOf(InvalidInputError); // the conversation itself is private
  await setVisibility(s.a, "conversations", s.dinner, "shared");
  for (const t of ["facts", "dates", "relationships"] as const) for (const r of await privates(t)) await setVisibility(s.a, t, r.id, "shared");
  expect((await getConversation(s.b, s.dinner)).transcript).toBeNull();
  await shareTranscript(s.a, s.dinner);
  expect((await getConversation(s.b, s.dinner)).transcript).toBe(DINNER_TRANSCRIPT);
  // Made private again, an item takes the transcript with it.
  await setVisibility(s.a, "dates", (await d.selectFrom("dates").select("id").where("conversation_id", "=", s.dinner).executeTakeFirstOrThrow()).id, "private");
  expect((await getConversation(s.b, s.dinner)).transcript).toBeNull();
});

test("A's promise and exchange read as Alice's for B, never as B's own", async () => {
  const r = await record(s.a, { promises: [{ person: 0, text: "send photos", byMe: true }], exchanges: [{ person: 0, kind: "lent", direction: "to_them", text: "my drill" }] });
  const b = await getConversation(s.b, r.conversationId);
  expect(b.promises.map((p) => [p.byMe, p.by])).toEqual([[false, "Alice"]]);
  expect(b.exchanges.map((e) => [e.direction, e.by])).toEqual([["to_them", "Alice"]]);
  const a = await getConversation(s.a, r.conversationId);
  expect(a.promises.map((p) => [p.byMe, p.by])).toEqual([[true, undefined]]);
  expect(a.exchanges[0].by).toBeUndefined();
  expect((await briefing(s.b, s.anna)).open.promises.find((p) => p.text === "send photos")).toMatchObject({ byMe: false, by: "Alice" });
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
  // A's group was hidden from B, so B's "Uni" is a group of its own: B sees one, A sees both (and can merge them).
  const names = async (v: Viewer) => (await briefing(v, s.anna)).groups.map((g) => g.name);
  expect(await names(s.b)).toEqual(["Uni"]);
  expect(await names(s.a)).toEqual(["Uni", "Uni"]);
  // A's private membership alone stays A's.
  await record(s.a, { groups: [{ name: "Therapy group", members: [0], private: true }] });
  expect(await names(s.b)).toEqual(["Uni"]);
  expect(await names(s.a)).toEqual(["Therapy group", "Uni", "Uni"]);
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

test("a fact that outdated B's shared fact can't be made private afterwards, on its own or with its conversation", async () => {
  const d = await db();
  const hiking = (await d.selectFrom("facts").select("id").where("text", "=", "likes hiking").executeTakeFirstOrThrow()).id;
  const r = await record(s.a, { facts: [{ person: 0, text: "hurt her knee, no more hiking", category: "health", supersedes: hiking }] });
  const knee = (await d.selectFrom("facts").select("id").where("conversation_id", "=", r.conversationId).executeTakeFirstOrThrow()).id;
  expect((await d.selectFrom("facts").select("superseded_by").where("id", "=", hiking).executeTakeFirstOrThrow()).superseded_by).toBe(knee);
  await expect(setVisibility(s.a, "facts", knee, "private")).rejects.toThrow(/private fact can't replace a shared one/);
  await expect(setVisibility(s.a, "conversations", r.conversationId, "private")).rejects.toThrow(/private fact can't replace a shared one/);
  // B still sees what replaced their fact.
  expect((await briefing(s.b, s.anna, "2026-10-23")).known.map((f) => f.text)).toContain("hurt her knee, no more hiking");
  // A fact that replaced nothing shared may still go private.
  await setVisibility(s.a, "facts", (await d.selectFrom("facts").select("id").where("text", "=", "new job").executeTakeFirstOrThrow()).id, "private");
});

test("a private fact may replace the recorder's own private fact", async () => {
  const d = await db();
  const divorce = (await d.selectFrom("facts").select("id").where("text", "=", "divorce").executeTakeFirstOrThrow()).id;
  await record(s.a, { facts: [{ person: 0, text: "divorce is final", category: "family", private: true, supersedes: divorce }] });
  expect((await d.selectFrom("facts").select("status").where("id", "=", divorce).executeTakeFirstOrThrow()).status).toBe("outdated");
});

test("B's briefing on Anna and Tom and B's whatsDue never contain A's private items", async () => {
  for (const id of [s.anna, s.tom]) {
    const text = JSON.stringify(await briefing(s.b, id, "2026-10-23"));
    for (const secret of ["divorce", "partner", "--10-24", "2026-10-24", "Tom's birthday"]) expect(text, `${id} ${secret}`).not.toContain(secret);
  }
  const anna = await briefing(s.b, s.anna, "2026-10-23");
  expect(anna.known.map((f) => f.text).sort()).toEqual(["likes hiking", "new job"]);
  expect(anna.relationships).toEqual([]);
  // Person-level date reads hide Tom's birthday too, the chip's birthday as well.
  expect((await briefing(s.b, s.tom, "2026-10-23")).nextDates).toEqual([]);
  expect((await briefing(s.b, s.tom, "2026-10-23")).person.birthday).toBeNull();
  expect((await briefing(s.a, s.tom, "2026-10-23")).person.birthday?.next).toBe("2026-10-24");
  expect((await briefing(s.a, s.tom, "2026-10-23")).nextDates.map((d) => d.date)).toEqual(["2026-10-24"]);
  // What's due: the birthday is A's alone, and A's shared promise is not B's to keep.
  await record(s.a, { promises: [{ person: 0, text: "bring the wine", byMe: true, due: "2026-10-24" }] });
  expect((await whatsDue(s.a, "2026-10-23")).filter((i) => i.kind === "promise").map((i) => i.text)).toEqual(["bring the wine"]);
  expect(await whatsDue(s.b, "2026-10-23")).toEqual([]);
  expect(JSON.stringify(await whatsDue(s.b, "2026-10-23"))).not.toContain("Tom");
  expect((await whatsDue(s.a, "2026-10-23")).filter((i) => i.kind === "date").map((i) => i.date)).toEqual(["2026-10-24"]);
  // The calendar feed: no event, title or busy slot of A's for B; A's own feed has the birthday and the promise.
  const now = Date.parse("2026-10-23T12:00:00Z");
  const forB = await calendarFeed(s.b, "https://fb.example", now);
  expect(forB).not.toContain("BEGIN:VEVENT");
  for (const secret of ["Tom", "wine", s.tom]) expect(forB, secret).not.toContain(secret);
  const forA = await calendarFeed(s.a, "https://fb.example", now);
  expect(forA).toContain("SUMMARY:🎂 Tom");
  expect(forA).toContain("bring the wine");
});

test("last seen and the interval are per user: B's call changes nothing for A, and a private conversation is not B's", async () => {
  expect(await lastSeen(s.a, s.anna)).toBe("2026-10-20");
  expect(await lastSeen(s.b, s.anna)).toBe("2026-10-15");
  expect(await lastSeen(s.b, s.lena)).toBeNull();
  expect((await findPeople(s.b, "Anna"))[0].context).toEqual(["last seen 2026-10-15"]);
  await setCheckInInterval(s.a, s.anna, 1, true);
  expect((await whatsDue(s.b, "2026-12-01")).map((i) => i.kind)).not.toContain("overdue");
});

test("the orbit is per viewer: A's private conversation with Anna and Bob doesn't move Anna for B, and A's private items add no faces or badges", async () => {
  const now = Date.parse("2026-10-23T10:00:00Z");
  await setCheckInInterval(s.a, s.anna, 7, true);
  await setCheckInInterval(s.b, s.anna, 7, true);
  // Bob was there, but the conversation is private to A: for B it never happened.
  const coffee = await record(s.a, {
    date: "2026-10-22",
    visibility: "private",
    people: [
      { id: s.anna, present: true },
      { id: s.b.personId, present: true },
    ],
    promises: [{ person: 0, text: "bring the wine", byMe: true }],
  });
  const ring = async (v: Viewer) => (await orbit(v, now)).find((f) => f.personId === s.anna);
  expect(await ring(s.a)).toMatchObject({ ring: 0, badges: ["promise"] });
  // B last saw Anna on 15 Oct: 8 days on a 7-day interval.
  expect(await ring(s.b)).toMatchObject({ ring: 2, badges: [] });
  // Tom's private birthday and Lena's private coffee are A's alone: B sees them only as people B never met (names are shared),
  // with no badge and no ring of their own.
  const b = await orbit(s.b, now);
  for (const id of [s.tom, s.lena]) expect(b.find((f) => f.personId === id), id).toMatchObject({ unseen: true, ring: 2, badges: [] });
  const a = await orbit(s.a, now);
  expect(a.find((f) => f.personId === s.tom)?.badges).toEqual(["birthday"]);
  expect(a.map((f) => f.personId)).toContain(s.lena);
  // Shared, it counts for B too; the promise stays private.
  await setVisibility(s.a, "conversations", coffee.conversationId, "shared");
  expect(await ring(s.b)).toMatchObject({ ring: 0, badges: [] });
});

test("the links B is handed never name one of A's private items or conversations", async () => {
  const d = await db();
  const tables = ["conversations", "facts", "promises", "dates", "exchanges", "relationships"] as const;
  const secret = (await Promise.all(tables.map((t) => d.selectFrom(t).select("id").where("visibility", "=", "private").where("recorded_by", "=", s.a.userId).execute())))
    .flat()
    .map((r) => r.id);
  expect(secret.length).toBeGreaterThan(0);
  const seen = [
    await briefing(s.b, s.anna, "2026-10-23"),
    await briefing(s.b, s.tom, "2026-10-23"),
    await getConversation(s.b, s.dinner),
    await whatsDue(s.b, "2026-10-23"),
    await orbit(s.b),
    await listPeople(s.b),
  ];
  const urls = JSON.stringify(seen).match(/"url":"[^"]*"/g) ?? [];
  expect(urls.length).toBeGreaterThan(0);
  for (const id of secret) expect(urls.join(), id).not.toContain(id);
});

test("a group made only through A's private membership doesn't exist for B", async () => {
  await addToGroup(s.a, { name: "Therapie", members: [s.anna], visibility: "private" });
  expect((await listGroups(s.b)).map((g) => g.name)).not.toContain("Therapie");
  const id = (await listGroups(s.a)).find((g) => g.name === "Therapie")!.id;
  await expect(getGroup(s.b, id)).rejects.toThrow(NotFoundError);
  expect(JSON.stringify(await briefing(s.b, s.anna))).not.toContain("Therapie");
  // B typing the same name makes B's own group; A's stays private and separate.
  await addToGroup(s.b, { name: "Therapie", members: [s.anna], visibility: "shared" });
  expect((await listGroups(s.b)).filter((g) => g.name === "Therapie")).toHaveLength(1);
  expect((await listGroups(s.b)).find((g) => g.name === "Therapie")!.id).not.toBe(id);
  expect((await listGroups(s.a)).filter((g) => g.name === "Therapie")).toHaveLength(2);
});

test("removing and deleting never touch or reveal A's private memberships to B", async () => {
  const familie = (await listGroups(s.a)).find((g) => g.name === "Familie")!.id;
  await addToGroupById(s.a, familie, s.anna, "private");
  await addToGroupById(s.b, familie, s.anna, "shared");
  await removeFromGroup(s.b, familie, s.anna);
  expect((await getGroup(s.b, familie)).members).toEqual([]);
  expect((await getGroup(s.a, familie)).members.map((m) => [m.name, m.private])).toEqual([["Anna", true]]);
  // B never added Lena and can't see A's private membership of her: removing her is no error and changes nothing.
  await addToGroupById(s.a, familie, s.lena, "private");
  await removeFromGroup(s.b, familie, s.lena);
  await deleteGroup(s.b, familie);
  expect((await getGroup(s.a, familie)).members.map((m) => m.name).sort()).toEqual(["Anna", "Lena"]);
  expect((await listGroups(s.b)).map((g) => g.name)).not.toContain("Familie");
});

test("merging never shows B a group name that was hidden from B", async () => {
  // A's private-only "Therapie" merged into the shared Freunde: its name does not become another name B can read.
  const freunde = (await listGroups(s.a)).find((g) => g.name === "Freunde")!.id;
  await addToGroup(s.a, { name: "Therapie", members: [s.anna], visibility: "private" });
  const therapie = (await listGroups(s.a)).find((g) => g.name === "Therapie")!.id;
  await mergeGroups(s.a, freunde, therapie);
  expect(JSON.stringify(await listGroups(s.b))).not.toContain("Therapie");
  expect((await listGroups(s.a)).find((g) => g.id === freunde)!.aliases).not.toContain("Therapie");
  // Merging the shared Freunde, which B uses, into A's hidden "Geheim" is refused: B's memberships would reveal it.
  await addToGroupById(s.b, freunde, s.lena, "shared");
  await addToGroup(s.a, { name: "Geheim", members: [s.tom], visibility: "private" });
  const geheim = (await listGroups(s.a)).find((g) => g.name === "Geheim")!.id;
  await expect(mergeGroups(s.a, geheim, freunde)).rejects.toThrow(InvalidInputError);
  expect(JSON.stringify(await listGroups(s.b))).not.toContain("Geheim");
});

test("the history lists only conversations the viewer may see, newest first, with who was there", async () => {
  expect((await listConversations(s.b)).map((c) => c.id)).toEqual(expect.arrayContaining([s.dinner, s.call]));
  expect((await listConversations(s.b)).map((c) => c.id)).not.toContain(s.coffee);
  const a = await listConversations(s.a);
  expect(a.map((c) => c.id)).toContain(s.coffee);
  expect(a.map((c) => c.date)).toEqual([...a.map((c) => c.date)].sort().reverse());
  const dinner = a.find((c) => c.id === s.dinner)!;
  expect(dinner).toMatchObject({ url: `/c/${s.dinner}`, summary: "Dinner with Anna; she has a new job." });
  expect(dinner.people.map((p) => p.name)).toContain("Anna");
});

test("the people overview is everyone but the viewer, with last seen and groups as the viewer sees them", async () => {
  await addToGroup(s.a, { name: "Therapie", members: [s.lena], visibility: "private" });
  const b = await peopleOverview(s.b);
  expect(b.map((p) => p.id)).not.toContain(s.b.personId);
  const lenaB = b.find((p) => p.id === s.lena)!;
  expect(lenaB).toMatchObject({ name: "Lena", url: `/p/${s.lena}`, lastSeen: null, groups: [] });
  const lenaA = (await peopleOverview(s.a)).find((p) => p.id === s.lena)!;
  expect(lenaA.lastSeen).not.toBeNull();
  expect(lenaA.groups).toHaveLength(1);
  expect(b.map((p) => p.name)).toEqual([...b.map((p) => p.name)].sort((x, y) => x.localeCompare(y, "de")));
});

test("a private role never shows to the partner, not even as 'us'", async () => {
  const { ids: [secret] } = await addRelationship(s.a, { from: s.lena, to: "me", type: "landlord", visibility: "private" });
  await addRelationship(s.b, { from: s.lena, to: "me", type: "landlord", visibility: "shared" });
  expect((await briefing(s.a, s.lena)).roles).toMatchObject([{ with: "us" }]);
  const b = await briefing(s.b, s.lena);
  expect(b.roles).toMatchObject([{ type: "landlord", with: "me" }]);
  expect(b.roles[0].ids).toHaveLength(1);
  expect(b.network.nodes.map((n) => n.id)).not.toContain(s.a.personId);
  expect(b.network.edges.some((e) => e.from === s.a.personId || e.to === s.a.personId)).toBe(false);
  expect(JSON.stringify(b)).not.toContain(secret);
  const network = JSON.stringify(b.network);
  await (await db()).deleteFrom("relationships").where("id", "=", secret).execute();
  expect(JSON.stringify((await briefing(s.b, s.lena)).network)).toBe(network);
});

test("a household node reachable only through A's private edge is absent for B", async () => {
  await addRelationship(s.a, { from: s.anna, to: "me", type: "doctor", visibility: "private" });
  const b = await briefing(s.b, s.anna);
  expect(b.roles).toEqual([]);
  expect(b.network.nodes.map((n) => n.role)).toEqual(["self"]);
  expect(b.network.edges).toEqual([]);
});

test("B never sees A's private situation in the briefing", async () => {
  await record(s.a, { facts: [{ person: 0, text: "sucht heimlich einen Job", category: "work", kind: "situation", private: true }] });
  const b = await briefing(s.b, s.anna);
  expect(b.situations).toEqual([]);
  expect(JSON.stringify(b)).not.toContain("heimlich");
});
