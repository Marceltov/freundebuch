import { beforeEach, expect, test } from "vitest";
import { sql } from "kysely";
import { getConversation, recordConversation, remember } from "../conversations/conversations";
import { scope } from "../db/scope";
import { unchecked } from "../db/testing";
import { NotFoundError } from "../core/errors";
import { seed, seedWorkBook, type Seed } from "../testing/fixtures";
import { addRelationship, addToGroup } from "./relationships";
import { getPerson } from "./people";
import { movePeople } from "./moves";

let s: Seed;
let w: Awaited<ReturnType<typeof seedWorkBook>>;

beforeEach(async () => {
  s = await seed();
  w = await seedWorkBook(s);
});

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const inWork = async (table: "facts" | "dates" | "relationships" | "conversations", where: (q: any) => any): Promise<any[]> =>
  where((await scope(w.work)).from(table).selectAll()).execute();

test("a moved person takes their facts, dates and groups, with new ids", async () => {
  await remember(s.a, { visibility: "shared", dates: [{ person: s.lena, kind: "birthday", date: "--05-07", yearly: true }] });
  await addToGroup(s.a, { name: "Uni", members: [s.lena], visibility: "shared" });
  const r = await movePeople(w.a, [s.lena], "Arbeit");
  expect(r.book).toEqual({ id: w.work.bookId, name: "Arbeit" });
  expect(r.people).toEqual([{ from: s.lena, id: expect.any(String), name: "Lena", url: expect.stringContaining("/p/"), remains: false }]);
  const lena = r.people[0].id;
  expect(lena).not.toBe(s.lena);
  expect((await inWork("facts", (q) => q.where("person_id", "=", lena))).map((f) => f.text)).toEqual(["thinking about quitting"]);
  expect((await inWork("dates", (q) => q.where("person_id", "=", lena))).map((d) => d.date)).toEqual(["--05-07"]);
  const groups = await (
    await scope(w.work)
  )
    .from("group_members")
    .innerJoin("groups", "groups.id", "group_members.group_id")
    .select("groups.name")
    .where("group_members.person_id", "=", lena)
    .execute();
  expect(groups.map((g) => g.name)).toContain("Uni");
  await expect(getPerson(s.a, s.lena)).rejects.toBeInstanceOf(NotFoundError);
  expect(r.moved).toMatchObject({ persons: 1, facts: 1, dates: 1, group_members: 1 });
});

test("another member's private fact stays on a remaining entry and isn't counted", async () => {
  await remember(s.b, { visibility: "private", facts: [{ person: s.lena, text: "owes me a book", category: "other" }] });
  const r = await movePeople(w.a, [s.lena], "Arbeit");
  expect(r.people[0].remains).toBe(true);
  expect(JSON.stringify(await inWork("facts", (q) => q))).not.toContain("owes me a book");
  expect(r.stayed.facts).toBeUndefined();
  expect(JSON.stringify(r)).not.toContain("owes me a book");
  const left = await (await scope(s.b)).from("facts").select("text").where("person_id", "=", s.lena).execute();
  expect(left).toEqual([{ text: "owes me a book" }]);
});

test("a relationship to me is re-pointed to my person in Arbeit; one to the partner stays", async () => {
  await addRelationship(s.a, { from: s.lena, to: "me", label: "Kollegin", inverse: "Kollege", visibility: "shared" });
  await addRelationship(s.b, { from: s.lena, to: "me", label: "Nachbarin", inverse: "Nachbar", visibility: "shared" });
  const r = await movePeople(w.a, [s.lena], "Arbeit");
  const lena = r.people[0].id;
  const rels = await inWork("relationships", (q) => q.where("from_id", "=", lena));
  expect(rels.map((x) => [x.label, x.to_id])).toEqual([["Kollegin", w.work.personId]]);
  expect(r.people[0].remains).toBe(true);
  expect(r.stayed.relationships).toBe(1);
});

test("moving a group moves all its members", async () => {
  await addToGroup(s.a, { name: "Uni", members: [s.lena, s.tom], visibility: "shared" });
  const r = await movePeople(w.a, { group: "Uni" }, "Arbeit");
  expect(r.people.map((p) => p.name).sort()).toEqual(["Lena", "Tom"]);
});

test("a move is all or nothing", async () => {
  await remember(s.a, { visibility: "shared", dates: [{ person: s.lena, kind: "birthday", date: "--05-07", yearly: true }] });
  await sql`create trigger boom before insert on dates begin select raise(abort, 'boom'); end`.execute(unchecked());
  await expect(movePeople(w.a, [s.lena], "Arbeit")).rejects.toThrow(/boom/);
  expect((await getPerson(s.a, s.lena)).name).toBe("Lena");
  expect(JSON.stringify(await inWork("facts", (q) => q))).not.toContain("thinking about quitting");
});

test("a call with only the moved colleague moves with its transcript", async () => {
  const r = await movePeople(w.a, [s.lena], "Arbeit");
  const calls = await inWork("conversations", (q) => q.where("summary", "=", "Coffee with Lena."));
  expect(calls).toHaveLength(1);
  const c = await getConversation(w.work, calls[0].id);
  expect(c.transcript).toContain("thinking about quitting");
  expect(r.moved.conversations).toBe(1);
  await expect(getConversation(s.a, s.coffee)).rejects.toBeInstanceOf(NotFoundError);
});

test("a dinner with Tom and Anna stays; Tom's birthday from it moves without the link", async () => {
  const r = await movePeople(w.a, [s.tom], "Arbeit");
  const tom = r.people[0].id;
  const [birthday] = await inWork("dates", (q) => q.where("person_id", "=", tom));
  expect(birthday).toMatchObject({ date: "--10-24", conversation_id: null, visibility: "private" });
  expect((await getConversation(s.a, s.dinner)).summary).toContain("Dinner with Anna");
  expect(r.people[0].remains).toBe(true);
});

test("a conversation at Büro finds Arbeit's Büro", async () => {
  await recordConversation(w.work, {
    date: "2026-10-22",
    kind: "in_person",
    place: "Büro",
    summary: "Standup.",
    transcript: "Standup im Büro.",
    visibility: "shared",
    people: [{ id: w.boss, present: true }],
  });
  await recordConversation(s.a, {
    date: "2026-10-23",
    kind: "in_person",
    place: "Büro",
    summary: "Lunch with Lena at the office.",
    transcript: "Lunch with Lena im Büro.",
    visibility: "shared",
    people: [{ id: s.lena, present: true }],
  });
  await movePeople(w.a, [s.lena], "Arbeit");
  const places = await (await scope(w.work)).from("places").select(["id", "name"]).where("name", "=", "Büro").execute();
  expect(places).toHaveLength(1);
  const [lunch] = await inWork("conversations", (q) => q.where("summary", "=", "Lunch with Lena at the office."));
  expect(lunch.place_id).toBe(places[0].id);
});

test("a transcript that tells of someone who stays doesn't move; what moves loses the link", async () => {
  await recordConversation(s.b, {
    date: "2026-10-24",
    kind: "in_person",
    summary: "Talk with Tom and Anna.",
    transcript: "Talk with Tom and Anna. Anna told us a secret about her health.",
    visibility: "shared",
    people: [
      { id: s.tom, present: true },
      { id: s.anna, present: true },
    ],
    facts: [{ person: 0, text: "plays chess", category: "hobby" }],
  });
  const r = await movePeople(w.a, [s.tom], "Arbeit");
  const rambles = await (await scope(w.work)).from("rambles").select("transcript").execute();
  expect(JSON.stringify(rambles)).not.toContain("health");
  expect(JSON.stringify(rambles)).not.toContain("Luigi");
  const [chess] = await inWork("facts", (q) => q.where("text", "=", "plays chess"));
  expect(chess).toMatchObject({ person_id: r.people[0].id, conversation_id: null, ramble_id: null });
});

test("a journal entry that stays leaves no transcript behind in the other book", async () => {
  const before = (await (await scope(w.work)).from("rambles").select("id").execute()).length;
  const { record } = await import("../conversations/conversations");
  await record(s.a, {
    date: "2026-10-25",
    transcript: "Ich habe an Lena und Tom gedacht.",
    visibility: "shared",
    people: [{ id: s.lena }, { id: s.tom }],
    journal: [{ text: "Gedanken an Lena und Tom", mentions: [0, 1], shared: true }],
  } as never);
  const r = await movePeople(w.a, [s.lena], "Arbeit");
  const after = await (await scope(w.work)).from("rambles").select("transcript").execute();
  expect(JSON.stringify(after)).not.toContain("an Lena und Tom");
  expect(after.length - before).toBe(r.moved.rambles ?? 0);
});

test("what stays counts journal entries, experiences, memberships and homes too", async () => {
  const { record } = await import("../conversations/conversations");
  await record(s.a, {
    date: "2026-10-25",
    transcript: "Ich habe an Lena und Tom gedacht.",
    visibility: "shared",
    people: [{ id: s.lena }, { id: s.tom }],
    journal: [{ text: "Gedanken an Lena und Tom", mentions: [0, 1], shared: true }],
  } as never);
  const r = await movePeople(w.a, [s.lena], "Arbeit");
  expect(r.stayed.journal_entries).toBe(1);
});

test("the partner's check-in interval keeps an entry for the person in the old book", async () => {
  const { setCheckInInterval: setEvery } = await import("./intervals");
  await setEvery(s.b, s.lena, 30, true);
  const r = await movePeople(w.a, [s.lena], "Arbeit");
  expect(r.people[0].remains).toBe(true);
  const kept = await (await scope(s.b)).from("person_settings").select(["user_id", "interval_days"]).where("person_id", "=", s.lena).execute();
  expect(kept).toEqual([{ user_id: s.b.userId, interval_days: 30 }]);
});

test("a copied group keeps its other names, a copied place where it sits", async () => {
  const { addGroupAlias } = await import("./groups");
  const uni = await addToGroup(s.a, { name: "Uni", members: [s.lena], visibility: "shared" });
  await addGroupAlias(s.a, uni.id, "Hochschule");
  await recordConversation(s.a, {
    date: "2026-10-23",
    kind: "in_person",
    place: { name: "Mensa", in: { name: "Campus", confirmedNew: true }, confirmedNew: true },
    summary: "Lunch with Lena in the Mensa.",
    transcript: "Lunch with Lena in der Mensa.",
    visibility: "shared",
    people: [{ id: s.lena, present: true }],
  });
  await movePeople(w.a, [s.lena], "Arbeit");
  const ws = await scope(w.work);
  const g = await ws.from("groups").select("id").where("name", "=", "Uni").executeTakeFirstOrThrow();
  expect((await ws.from("group_aliases").select("alias").where("group_id", "=", g.id).execute()).map((a) => a.alias)).toEqual(["Hochschule"]);
  const mensa = await ws.from("places").select(["parent_id"]).where("name", "=", "Mensa").executeTakeFirstOrThrow();
  const campus = await ws.from("places").select(["id"]).where("name", "=", "Campus").executeTakeFirstOrThrow();
  expect(mensa.parent_id).toBe(campus.id);
});
