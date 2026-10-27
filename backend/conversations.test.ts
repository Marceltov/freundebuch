import { beforeEach, expect, test } from "vitest";
import { recordConversation, getConversation, type NewConversation } from "./conversations";
import { db, resetDbForTests } from "./db/testing";
import { AmbiguousError, InvalidInputError, NotFoundError } from "./errors";
import { getPerson } from "./people";
import { userFromOidc } from "./users";
import type { Viewer } from "./types";

let a: Viewer;

beforeEach(async () => {
  await resetDbForTests();
  a = await userFromOidc({ sub: "a", name: "Alice" });
});

const base = (over: Partial<NewConversation> = {}): NewConversation => ({
  date: "2026-10-20",
  kind: "in_person",
  summary: "Dinner with Anna.",
  transcript: "We had dinner.",
  visibility: "shared",
  people: [{ name: "Anna", present: true }],
  ...over,
});

const ITEM_TABLES = ["facts", "promises", "dates", "exchanges", "relationships", "group_members"] as const;
const rowCount = async (t: string) => Number((await (await db()).selectFrom(t as "facts").select((eb) => eb.fn.countAll().as("n")).executeTakeFirstOrThrow()).n);

test("returns the people and correct counts", async () => {
  const r = await recordConversation(
    a,
    base({
      people: [
        { name: "Anna", aliases: ["Anni"], present: true },
        { name: "Tom", present: false },
      ],
      facts: [
        { person: 0, text: "new job", category: "work" },
        { person: 1, text: "runs marathons", category: "hobby" },
      ],
      promises: [{ person: 0, text: "send the recipe", byMe: true, due: "2026-10-30" }],
      dates: [{ person: 1, kind: "birthday", date: "--10-24", yearly: true }],
      exchanges: [{ person: 0, kind: "money", direction: "to_them", text: "dinner", amount: 42.5, currency: "EUR" }],
      relationships: [{ from: 0, to: 1, label: "Partner:in", inverse: "Partner:in" }],
      groups: [{ name: "Kletterclique", members: [0, 1] }],
    }),
  );
  expect(r.people.map((p) => ({ ref: p.ref, name: p.name, created: p.created }))).toEqual([
    { ref: 0, name: "Anna", created: true },
    { ref: 1, name: "Tom", created: true },
  ]);
  expect(r.counts).toEqual({ facts: 2, promises: 1, dates: 1, exchanges: 1, relationships: 1, groups: 2 });
  expect(await rowCount("group_members")).toBe(2);
  expect((await getPerson(a, r.people[0].id)).aliases).toEqual(["Anni"]);
});

test("creating a new person by name sets created_from; an existing person is linked, not created", async () => {
  const first = await recordConversation(a, base());
  const anna = first.people[0].id;
  expect((await getPerson(a, anna)).createdFrom).toBe(first.conversationId);
  const second = await recordConversation(a, base({ people: [{ id: anna, present: true }] }));
  expect(second.people).toEqual([{ ref: 0, id: anna, name: "Anna", created: false, url: `/p/${anna}` }]);
  expect(second.url).toBe(`/c/${second.conversationId}`);
  expect((await getPerson(a, anna)).createdFrom).toBe(first.conversationId);
});

test("a new person named like an existing person or alias is ambiguous, listing the candidates, unless confirmedNew", async () => {
  const first = await recordConversation(a, base({ people: [{ name: "Anna Schmidt", aliases: ["Anni"], present: true }, { name: "Tom", present: false }], relationships: [{ from: 0, to: 1, label: "Partner:in", inverse: "Partner:in" }] }));
  const anna = first.people[0].id;
  const before = await rowCount("conversations");
  for (const name of ["anna schmidt", " Anni ", "ANNI"]) {
    const err = await recordConversation(a, base({ people: [{ name, present: true }] })).catch((e) => e);
    expect(err, name).toBeInstanceOf(AmbiguousError);
    expect(err.message).toContain(anna);
    expect(err.message).toContain("Anna Schmidt");
    expect(err.message).toContain("Partner:in of Tom");
    expect(err.message).toContain("confirmedNew");
  }
  expect(await rowCount("conversations")).toBe(before);
  // A different name is no match; a confirmed one is a second person.
  expect((await recordConversation(a, base({ people: [{ name: "Annabel", present: true }] }))).people[0].created).toBe(true);
  const second = await recordConversation(a, base({ people: [{ name: "Anni", present: true, confirmedNew: true }] }));
  expect(second.people[0]).toMatchObject({ name: "Anni", created: true });
  expect(second.people[0].id).not.toBe(anna);
});

test("the viewer's own person is always a participant; absent people are not", async () => {
  const r = await recordConversation(a, base({ people: [{ name: "Anna", present: true }, { name: "Tom", present: false }] }));
  const c = await getConversation(a, r.conversationId);
  expect(c.participants.map((p) => p.name).sort()).toEqual(["Alice", "Anna"]);
});

test("a private conversation makes all its items private", async () => {
  const r = await recordConversation(
    a,
    base({
      visibility: "private",
      people: [{ name: "Anna", present: true }, { name: "Tom", present: false }],
      facts: [{ person: 0, text: "new job", category: "work", private: false }],
      promises: [{ person: 0, text: "call back", byMe: true }],
      dates: [{ person: 0, kind: "anniversary", date: "2020-06-01", yearly: true }],
      exchanges: [{ person: 0, kind: "gift_idea", direction: "to_them", text: "a book" }],
      relationships: [{ from: 0, to: 1, label: "Partner:in", inverse: "Partner:in" }],
      groups: [{ name: "Uni", members: [0] }],
    }),
  );
  const d = await db();
  for (const t of ITEM_TABLES) {
    const rows = await d.selectFrom(t).select("visibility").execute();
    expect(rows.length, t).toBeGreaterThan(0);
    expect(new Set(rows.map((x) => x.visibility)), t).toEqual(new Set(["private"]));
  }
  const conv = await d.selectFrom("conversations").select(["visibility", "transcript_private"]).where("id", "=", r.conversationId).executeTakeFirstOrThrow();
  expect(conv).toEqual({ visibility: "private", transcript_private: 1 });
});

test("one private item makes the transcript private; none leaves it shared", async () => {
  const d = await db();
  const tp = async (id: string) => (await d.selectFrom("conversations").select("transcript_private").where("id", "=", id).executeTakeFirstOrThrow()).transcript_private;
  const open = await recordConversation(a, base({ facts: [{ person: 0, text: "new job", category: "work" }] }));
  expect(await tp(open.conversationId)).toBe(0);
  const closed = await recordConversation(a, base({ people: [{ id: open.people[0].id, present: true }], promises: [{ person: 0, text: "keep quiet", byMe: true, private: true }] }));
  expect(await tp(closed.conversationId)).toBe(1);
});

test("supersedes marks the old fact outdated", async () => {
  const first = await recordConversation(a, base({ facts: [{ person: 0, text: "works at the bank", category: "work" }] }));
  const anna = first.people[0].id;
  const d = await db();
  const old = await d.selectFrom("facts").select("id").executeTakeFirstOrThrow();
  await recordConversation(a, base({ people: [{ id: anna, present: true }], facts: [{ person: 0, text: "works at the museum", category: "work", supersedes: old.id }] }));
  const rows = await d.selectFrom("facts").select(["text", "status"]).orderBy("created_at").orderBy("text").execute();
  expect(rows).toEqual([
    { text: "works at the bank", status: "outdated" },
    { text: "works at the museum", status: "current" },
  ]);
});

test("the rollback leaves nothing behind when a later item is invalid", async () => {
  const before = { persons: await rowCount("persons"), aliases: await rowCount("aliases") };
  await expect(
    recordConversation(
      a,
      base({
        people: [{ name: "Anna", aliases: ["Anni"], present: true }],
        facts: [
          { person: 0, text: "new job", category: "work" },
          { person: 0, text: "newer job", category: "work", supersedes: "no-such-fact" },
        ],
        promises: [{ person: 0, text: "call back", byMe: true }],
      }),
    ),
  ).rejects.toBeInstanceOf(NotFoundError);
  expect(await rowCount("conversations")).toBe(0);
  expect(await rowCount("participants")).toBe(0);
  expect(await rowCount("persons")).toBe(before.persons);
  expect(await rowCount("aliases")).toBe(before.aliases);
  for (const t of ITEM_TABLES) expect(await rowCount(t), t).toBe(0);
});

test("a 40,000-character transcript round-trips byte for byte", async () => {
  const unit = "Ähm, also Jürgen hat erzählt 🧗‍♀️ — \"quotes\", 'apostrophes', tabs\tand\r\nnewlines\n";
  const transcript = unit.repeat(Math.ceil(40_000 / unit.length)).slice(0, 40_000);
  const r = await recordConversation(a, base({ transcript }));
  expect((await getConversation(a, r.conversationId)).transcript).toBe(transcript);
});

test("enforces the transcript and summary limits", async () => {
  await expect(recordConversation(a, base({ transcript: "x".repeat(200_001) }))).rejects.toBeInstanceOf(InvalidInputError);
  await expect(recordConversation(a, base({ summary: "x".repeat(2_001) }))).rejects.toBeInstanceOf(InvalidInputError);
  await expect(recordConversation(a, base({ transcript: "x".repeat(200_000), summary: "x".repeat(2_000) }))).resolves.toBeDefined();
});

test("validates date formats", async () => {
  const bad = [
    base({ date: "20.10.2026" }),
    base({ date: "--10-20" }),
    base({ promises: [{ person: 0, text: "t", byMe: true, due: "next week" }] }),
    base({ dates: [{ person: 0, kind: "custom", date: "--06-01", yearly: false }] }),
    base({ dates: [{ person: 0, kind: "birthday", date: "24.10.", yearly: true }] }),
    // well-formed but not on the calendar
    base({ date: "2026-13-45" }),
    base({ date: "2026-02-29" }),
    base({ promises: [{ person: 0, text: "t", byMe: true, due: "2026-04-31" }] }),
    base({ dates: [{ person: 0, kind: "birthday", date: "--02-30", yearly: true }] }),
    base({ dates: [{ person: 0, kind: "custom", date: "2026-00-10", yearly: false }] }),
  ];
  for (const c of bad) await expect(recordConversation(a, c)).rejects.toBeInstanceOf(InvalidInputError);
  await expect(recordConversation(a, base({ dates: [{ person: 0, kind: "birthday", date: "1990-10-24", yearly: true }] }))).resolves.toBeDefined();
  await expect(recordConversation(a, base({ date: "2024-02-29", people: [{ name: "Ben", present: true }], dates: [{ person: 0, kind: "birthday", date: "--02-29", yearly: true }] }))).resolves.toBeDefined();
});

test("rejects a people entry with neither id nor name, a bad person ref and unknown vocabulary", async () => {
  const bad = [
    base({ people: [{ present: true }] }),
    base({ facts: [{ person: 1, text: "t", category: "work" }] }),
    base({ facts: [{ person: 0, text: "t", category: "gossip" as "work" }] }),
    base({ kind: "telepathy" as "call" }),
    base({ visibility: "secret" as "private" }),
    base({ relationships: [{ from: 0, to: 0, label: "Freund:in", inverse: "Freund:in" }] }),
  ];
  for (const c of bad) await expect(recordConversation(a, c)).rejects.toBeInstanceOf(InvalidInputError);
});

test("an unknown person id is NotFoundError", async () => {
  await expect(recordConversation(a, base({ people: [{ id: "no-such-person", present: true }] }))).rejects.toBeInstanceOf(NotFoundError);
});

test("getConversation of an unknown id is NotFoundError", async () => {
  await expect(getConversation(a, "nope")).rejects.toBeInstanceOf(NotFoundError);
});

test("a conversation's items link to their rows on its page, done and outdated ones too, and name whom they are about", async () => {
  const r = await recordConversation(a, base({ promises: [{ person: 0, text: "send the book", byMe: true }] }));
  const c = await getConversation(a, r.conversationId);
  expect(c.url).toBe(`/c/${c.id}`);
  for (const x of [...c.facts, ...c.promises]) expect(x.url).toBe(`/c/${c.id}#${"category" in x ? "facts" : "promises"}-${x.id}`);
  expect(c.promises[0].name).toBe("Anna");
  expect(c.participants[0].url).toBe(`/p/${c.participants[0].id}`);
});

test("a conversation can't be dated after today", async () => {
  await expect(recordConversation(a, base({ date: "2999-01-01" }))).rejects.toThrow(InvalidInputError);
});

test("a conversation files a role to us", async () => {
  const b = await userFromOidc({ sub: "b", name: "Bob" });
  const r = await recordConversation(a, base({ relationships: [{ from: 0, to: "us", label: "Vermieter:in", inverse: "Mieter:in" }] }));
  expect(r.counts.relationships).toBe(2);
  const rows = await (await db()).selectFrom("relationships").select(["from_id", "to_id", "conversation_id"]).execute();
  expect(rows.map((x) => x.to_id).sort()).toEqual([a.personId, b.personId].sort());
  expect(rows.every((x) => x.from_id === r.people[0].id && x.conversation_id === r.conversationId)).toBe(true);
});

test("a person's gender is filed with the conversation, never made up", async () => {
  const r = await recordConversation(a, base({ people: [{ name: "Anna", present: true, gender: "female" }, { name: "Kim", present: false }] }));
  expect((await getPerson(a, r.people[0].id)).gender).toBe("female");
  expect((await getPerson(a, r.people[1].id)).gender).toBeNull();
  await recordConversation(a, base({ people: [{ id: r.people[1].id, present: true, gender: "nonbinary" }] }));
  expect((await getPerson(a, r.people[1].id)).gender).toBe("nonbinary");
  await expect(recordConversation(a, base({ people: [{ name: "Jo", present: true, gender: "x" as "male" }] }))).rejects.toBeInstanceOf(InvalidInputError);
});
