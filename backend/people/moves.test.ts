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
