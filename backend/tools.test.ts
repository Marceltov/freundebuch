import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { SITUATION_DAYS } from "./conversations";
import { fileContent, shareFile } from "./files";
import { addDays, today } from "./dates";
import { db } from "./db/testing";
import { seed, type Seed } from "./testing/fixtures";
import { asRamble } from "./testing/fixtures";
import { TOOLS, toolByName } from "./tools";

let s: Seed;

beforeEach(async () => {
  s = await seed();
});

test("one table holds every tool the MCP endpoint offers", () => {
  expect(TOOLS.map((t) => t.name).sort()).toEqual(["briefing", "calendar_feed", "correct", "experiences", "find_person", "get_transcript", "groups", "inbox", "journal", "people", "places", "record", "relate", "remember", "set_interval", "traits", "whats_due"]);
});

test("a tool runs as the viewer and answers with paths, not absolute urls", async () => {
  const r = (await toolByName("find_person")!.run(s.a, { name: "Anna" })) as { people: { url: string }[] };
  expect(r.people[0].url).toBe(`/p/${s.anna}`);
  expect(toolByName("nope")).toBeUndefined();
});

test("the descriptions tell Claude to file roles in words, to agree a situation's new day, and gender only when said", () => {
  const all = (name: string) => JSON.stringify([toolByName(name)!.description, toolByName(name)!.input.toJSONSchema()]);
  for (const name of ["relate", "record", "correct"]) for (const word of ["Vermieterin", "inverse", '\\"us\\"']) expect(all(name), `${name} ${word}`).toContain(word);
  for (const name of ["remember", "record"]) for (const word of ["situation", "checkAfter", "agree it with the user"]) expect(all(name), `${name} ${word}`).toContain(word);
  for (const name of ["correct", "record", "remember"]) expect(all(name), name).toContain("never from the name");
  expect(all("correct")).toContain("relabel");
  expect(toolByName("briefing")!.description).toContain("roles");
});

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- the tests read tool results by shape, which the output schemas check
type Json = any;
const run = async (v: Seed["a"], name: string, args: object): Promise<Json> => toolByName(name)!.run(v, args);
const factId = async (text: string) => (await (await db()).selectFrom("facts").select("id").where("text", "=", text).executeTakeFirstOrThrow()).id;
const SIX_WEEKS = () => addDays(today(), SITUATION_DAYS);
const lunch = (over: object = {}) => ({
  date: "2026-10-22",
  kind: "in_person",
  summary: "Lunch with Anna.",
  transcript: "Lunch with Anna.",
  visibility: "shared",
  people: [{ id: s.anna, present: true }],
  ...over,
});

describe("next: what Claude does after a call", () => {
  test("every tool's output declares next", () => {
    for (const t of TOOLS) expect(t.output.shape, t.name).toHaveProperty("next");
  });

  test("record returns what it filed, and next reads it back with each situation's day and what was already there", async () => {
    const r = await run(
      s.a,
      "record",
      asRamble(lunch({
        people: [{ id: s.anna, present: true }, { id: s.tom, present: false }, { name: "Marina", present: false }],
        facts: [
          { person: 0, text: "sucht ein Auto", category: "other", kind: "situation" },
          { person: 0, text: "zieht nach Köln", category: "home", kind: "situation", checkAfter: "2027-02-01" },
          { person: 0, text: "spielt Cello", category: "hobby" },
        ],
        promises: [{ person: 0, text: "send the playlist", byMe: true }],
        relationships: [
          { from: 0, to: 1, label: "Partner:in", inverse: "Partner:in" },
          { from: 2, to: "us", label: "Vermieterin", inverse: "Mieter:in" },
        ],
      })),
    );
    const c = `/c/${r.conversations[0].id}`;
    const auto = await factId("sucht ein Auto");
    expect(r.filed.facts).toEqual([
      { id: auto, personId: s.anna, name: "Anna", text: "sucht ein Auto", kind: "situation", checkAfter: SIX_WEEKS(), defaultCheckAfter: true, supersedes: null, visibility: "shared", url: `${c}#facts-${auto}` },
      expect.objectContaining({ text: "zieht nach Köln", checkAfter: "2027-02-01", defaultCheckAfter: false }),
      expect.objectContaining({ text: "spielt Cello", kind: "lasting", checkAfter: null, defaultCheckAfter: false }),
    ]);
    expect(r.filed.promises).toEqual([expect.objectContaining({ personId: s.anna, name: "Anna", text: "send the playlist", byMe: true, due: null, url: expect.stringMatching(`^${c}#promises-`) })]);
    const marina = r.people.find((p: Json) => p.name === "Marina");
    expect(marina.created).toBe(true);
    // Anna ↔ Tom was there already (A's own, private); Marina's role to us is new, one row each.
    expect(r.filed.relationships).toEqual([
      expect.objectContaining({ fromName: "Anna", toName: "Tom", label: "Partner:in", inverse: "Partner:in", created: false, url: `/p/${s.anna}#relationships-${r.filed.relationships[0].id}` }),
      expect.objectContaining({ fromName: "Marina", toName: "Alice", label: "Vermieterin", created: true }),
      expect.objectContaining({ fromName: "Marina", toName: "Bob", label: "Vermieterin", created: true }),
    ]);
    expect(r.next).toEqual([
      "Read back in one or two sentences what you filed, part by part, with the day (2026-10-22) and the links.",
      "Marina is new in the book: say so in the read-back.",
      `Anna's situation "sucht ein Auto" nudges on ${SIX_WEEKS()}, a default because you gave no checkAfter: tell the user, and change it with correct (edit, table facts, patch { checkAfter }) if they want another day.`,
      'Anna\'s situation "zieht nach Köln" nudges on 2027-02-01: tell the user that day.',
      `Anna is already Partner:in of Tom (relationship ${r.filed.relationships[0].id}): it was kept as it was, nothing new was filed.`,
    ]);
  });

  test("remember returns its items with their links and each situation's day", async () => {
    const r = await run(s.a, "remember", {
      visibility: "shared",
      facts: [{ person: s.lena, text: "sucht einen Hund", category: "hobby", kind: "situation" }],
      dates: [{ person: s.lena, kind: "birthday", date: "--03-02", yearly: true }],
    });
    const hund = await factId("sucht einen Hund");
    expect(r.filed.facts).toEqual([expect.objectContaining({ id: hund, name: "Lena", checkAfter: SIX_WEEKS(), defaultCheckAfter: true, url: `/p/${s.lena}#facts-${hund}` })]);
    expect(r.filed.dates).toEqual([expect.objectContaining({ personId: s.lena, kind: "birthday", date: "--03-02", url: expect.stringMatching(`^/p/${s.lena}#dates-`) })]);
    expect(r.next).toEqual([
      `Lena's situation "sucht einen Hund" nudges on ${SIX_WEEKS()}, a default because you gave no checkAfter: tell the user, and change it with correct (edit, table facts, patch { checkAfter }) if they want another day.`,
    ]);
  });

  test("relate says whether the relationship was new, and who was in the group already", async () => {
    const args = { kind: "relationship", from: s.lena, to: s.anna, label: "Kollegin", inverse: "Kollegin", visibility: "shared" };
    const first = await run(s.a, "relate", args);
    expect(first.relationships).toEqual([expect.objectContaining({ id: first.id, fromName: "Lena", toName: "Anna", created: true })]);
    expect(first.next).toEqual([]);
    const again = await run(s.a, "relate", { ...args, from: s.anna, to: s.lena, label: "Kolleg:in", inverse: "Kolleg:in" });
    expect(again.relationships).toEqual([expect.objectContaining({ id: first.id, label: "Kollegin", created: false })]);
    expect(again.next).toEqual([`Lena is already Kollegin of Anna (relationship ${first.id}): it was kept as it was, nothing new was filed.`]);
    await run(s.a, "relate", { kind: "group", name: "Uni", members: [s.anna], visibility: "shared" });
    const group = await run(s.a, "relate", { kind: "group", name: "Uni", members: [s.anna, s.lena], visibility: "shared" });
    expect(group).toMatchObject({ added: 1, already: 1 });
    expect(group.next).toEqual(["1 of them was in Uni already; nothing changed for them."]);
  });

  test("correct: an outdated situation asks for the outcome; a fact made a situation gets its day", async () => {
    await run(s.a, "remember", { visibility: "shared", facts: [{ person: s.anna, text: "sucht ein Auto", category: "other", kind: "situation", checkAfter: "2026-11-15" }] });
    const auto = await factId("sucht ein Auto");
    const out = await run(s.a, "correct", { action: "outdated", id: auto });
    expect(out).toMatchObject({ corrected: true, fact: { id: auto, personId: s.anna, name: "Anna", kind: "situation", status: "outdated" } });
    expect(out.next).toEqual([
      'Anna\'s situation "sucht ein Auto" is outdated. When the user has told how it ended, file the outcome as a lasting fact with remember, if it is worth keeping.',
    ]);
    const job = await factId("new job");
    const edit = await run(s.a, "correct", { action: "edit", table: "facts", id: job, patch: { kind: "situation" } });
    expect(edit.fact).toMatchObject({ id: job, kind: "situation", checkAfter: SIX_WEEKS(), defaultCheckAfter: true, status: "current" });
    expect(edit.next).toEqual([
      `Anna's situation "new job" nudges on ${SIX_WEEKS()}, a default because you gave no checkAfter: tell the user, and change it with correct (edit, table facts, patch { checkAfter }) if they want another day.`,
    ]);
    expect((await run(s.a, "correct", { action: "rename", id: s.lena, name: "Lena M." })).next).toEqual([]);
  });

  test("correct: a fact made a trait says where it now shows", async () => {
    const hiking = await factId("likes hiking");
    const edit = await run(s.a, "correct", { action: "edit", table: "facts", id: hiking, patch: { kind: "personality" } });
    expect(edit.fact).toMatchObject({ id: hiking, kind: "personality", checkAfter: null });
    expect(edit.next).toEqual([`"likes hiking" now shows under Anna's traits, as personality: how the person is.`]);
    const need = await run(s.a, "correct", { action: "edit", table: "facts", id: hiking, patch: { kind: "need" } });
    expect(need.next).toEqual([`"likes hiking" now shows under Anna's traits, as a need: something to plan around.`]);
  });

  test("correct merge says what moved; gender says which word to put in it", async () => {
    const merge = await run(s.a, "correct", { action: "merge", id: s.anna, drop: s.tom });
    // Tom's birthday (A's private) moved; the Anna ↔ Tom relationship became one with herself and went.
    expect(merge.moved).toEqual({ facts: 0, promises: 0, dates: 1, exchanges: 0, relationships: 0, conversations: 0, groups: 0 });
    expect(merge.next).toEqual([`Merged Tom into Anna: 1 date moved, and "Tom" now finds Anna. Look over Anna's briefing for anything doubled and fix it with correct.`]);
    await run(s.a, "relate", { kind: "relationship", from: s.lena, to: "me", label: "Nachbar:in", inverse: "Nachbar:in", visibility: "shared" });
    const gender = await run(s.a, "correct", { action: "gender", id: s.lena, gender: "female" });
    const id = gender.relabel[0].id;
    expect(gender.next).toEqual([`Put Lena's word in "Lena is Nachbar:in of Alice" in her new gender: correct (edit, table relationships, id ${id}, patch { label }).`]);
  });

  test("genders for both ends list their relationship once, with a line for each end's word", async () => {
    const { id } = await run(s.a, "relate", { kind: "relationship", from: s.anna, to: s.lena, label: "Elternteil", inverse: "Kind", visibility: "shared" });
    const r = await run(s.a, "remember", { visibility: "shared", genders: [{ person: s.anna, gender: "female" }, { person: s.lena, gender: "female" }] });
    // The seed's other neutral words of theirs come too, but each relationship once.
    const ids = r.relabel.map((x: { id: string }) => x.id);
    expect(ids.filter((x: string) => x === id)).toHaveLength(1);
    expect(new Set(ids).size).toBe(ids.length);
    const lines = r.next.filter((l: string) => l.includes(id));
    expect(lines).toHaveLength(2);
    expect(lines.join(" ")).toMatch(/Anna's word.*patch \{ label \}.*Lena's word.*patch \{ inverse \}/);
  });

  test("remember with a gender says which word to put in it, like correct gender", async () => {
    await run(s.a, "relate", { kind: "relationship", from: s.lena, to: "me", label: "Nachbar:in", inverse: "Nachbar:in", visibility: "shared" });
    const r = await run(s.a, "remember", { visibility: "shared", genders: [{ person: s.lena, gender: "female" }] });
    const id = r.relabel[0].id;
    expect(r.relabel).toEqual([{ id, fromId: s.lena, fromName: "Lena", toId: s.a.personId, toName: "Alice", label: "Nachbar:in", inverse: "Nachbar:in" }]);
    expect(r.next).toEqual([`Put Lena's word in "Lena is Nachbar:in of Alice" in her new gender: correct (edit, table relationships, id ${id}, patch { label }).`]);
    // The same gender again asks for nothing.
    expect((await run(s.a, "remember", { visibility: "shared", genders: [{ person: s.lena, gender: "female" }] })).next).toEqual([]);
    // B may edit A's shared one too, so B is told the same; a private one of A's would never show.
    const fresh = async () => {
      await run(s.b, "correct", { action: "gender", id: s.lena, gender: null });
      return (await run(s.b, "remember", { visibility: "shared", genders: [{ person: s.lena, gender: "female" }] })).next;
    };
    expect(await fresh()).toEqual(r.next);
    await run(s.a, "correct", { action: "visibility", table: "relationships", id, visibility: "private" });
    expect(await fresh()).toEqual([]);
  });

  test("people lists everyone but the user, by name, each with their groups", async () => {
    await run(s.a, "relate", { kind: "group", name: "Laufgruppe", members: [s.anna, s.tom], visibility: "shared" });
    const all = await run(s.a, "people", {});
    const names = all.people.map((p: Json) => p.name);
    expect(names).toEqual(["Anna", "Bob", "Lena", "Tom"]);
    expect(all.people.find((p: Json) => p.name === "Anna")).toMatchObject({ id: s.anna, groups: ["Laufgruppe"], url: expect.stringMatching(`/p/${s.anna}$`) });
    // The partner is in Haushalt, the household's own group, like anyone in a group.
    expect(all.people.find((p: Json) => p.name === "Bob")).toMatchObject({ id: s.b.personId, groups: ["Haushalt"] });
    expect(all.next).toEqual([]);
  });

  test("people without a group lists only those in none, and offers to sort them in", async () => {
    await run(s.a, "relate", { kind: "group", name: "Laufgruppe", members: [s.anna, s.tom], visibility: "shared" });
    const none = await run(s.a, "people", { withoutGroup: true });
    expect(none.people.map((p: Json) => p.name)).toEqual(["Lena"]);
    expect(none.next).toEqual(["Offer to put Lena in a group with relate (kind group); reuse one that fits (groups)."]);
    await run(s.a, "relate", { kind: "group", name: "Laufgruppe", members: [s.lena], visibility: "shared" });
    expect(await run(s.a, "people", { withoutGroup: true })).toMatchObject({ people: [], next: [] });
  });

  test("find_person asks which one, or whether someone is new", async () => {
    expect((await run(s.a, "find_person", { name: "Anna" })).next).toEqual([]);
    const none = await run(s.a, "find_person", { name: "Zoe" });
    expect(none.next).toEqual(['No one in the book is called "Zoe". Ask the user whether this is someone new; if so, file them as a new person with record.']);
    await run(s.a, "record", asRamble(lunch({ people: [{ name: "Anna", present: true, confirmedNew: true }] })));
    const two = await run(s.a, "find_person", { name: "anna" });
    const [first, other] = two.people.map((p: Json) => p.id);
    expect(first).toBe(s.anna);
    // The context tells them apart, from what A may see.
    expect(two.next).toEqual([`2 people match "anna": Anna (id ${first}; Partner:in of Tom, last seen 2026-10-20), Anna (id ${other}; last seen 2026-10-22). Ask the user which one they mean; never guess.`]);
  });

  test("briefing leads with the role, asks about nudging situations first and offers the suggested interval", async () => {
    await run(s.a, "relate", { kind: "relationship", from: s.anna, to: "us", label: "Vermieterin", inverse: "Mieter:in", visibility: "shared" });
    await run(s.a, "remember", { visibility: "shared", facts: [{ person: s.anna, text: "sucht ein Auto", category: "other", kind: "situation", checkAfter: "2026-10-01" }] });
    for (const date of ["2026-10-06", "2026-09-22"]) await run(s.a, "record", asRamble(lunch({ date })));
    const b = await run(s.a, "briefing", { personId: s.anna });
    expect(b.suggestedInterval).toBe(14);
    expect(b.next).toEqual([
      "Lead with who Anna is to the household: Vermieterin of you both.",
      'Ask about "sucht ein Auto" first: its day to ask, 2026-10-01, has come. When the user tells how it went, mark it outdated with correct; news instead supersedes it, with a new checkAfter agreed with the user.',
      "Offer to check in with Anna every 14 days; save it with set_interval once the user agrees.",
    ]);
  });

  test("briefing names what the person needs, right after the role", async () => {
    await run(s.a, "relate", { kind: "relationship", from: s.anna, to: "us", label: "Vermieterin", inverse: "Mieter:in", visibility: "shared" });
    await run(s.a, "remember", {
      visibility: "shared",
      facts: [
        { person: s.anna, text: "vegetarian", category: "health", kind: "need" },
        { person: s.anna, text: "nut allergy", category: "health", kind: "need" },
        { person: s.anna, text: "shy in big groups", category: "other", kind: "personality" },
      ],
    });
    const b = await run(s.a, "briefing", { personId: s.anna });
    expect(b.traits.needs.map((f: { text: string }) => f.text)).toEqual(["vegetarian", "nut allergy"]);
    expect(b.next.slice(0, 2)).toEqual(["Lead with who Anna is to the household: Vermieterin of you both.", "Keep in mind what Anna needs: vegetarian; nut allergy."]);
  });

  test("traits lists people and groups once each and names the needs to keep in mind", async () => {
    const g = await run(s.a, "relate", { kind: "group", name: "Laufgruppe", members: [s.tom, s.anna], visibility: "shared" });
    expect((await run(s.a, "traits", { groups: [g.id] })).next).toEqual([]);
    await run(s.a, "remember", { visibility: "shared", facts: [{ person: s.anna, text: "vegetarian", category: "health", kind: "need" }] });
    const r = await run(s.a, "traits", { people: [s.lena], groups: [g.id] });
    expect(r.people.map((p: { name: string }) => p.name)).toEqual(["Lena", "Anna", "Tom"]);
    expect(r.people[1].url).toMatch(new RegExp(`/p/${s.anna}$`));
    expect(r.next).toEqual(["Keep these needs in mind for the plan: Anna: vegetarian."]);
  });

  test("whats_due suggests asking about the due situations", async () => {
    await run(s.a, "remember", { visibility: "shared", facts: [{ person: s.lena, text: "sucht einen Hund", category: "hobby", kind: "situation", checkAfter: "2026-10-01" }] });
    const due = await run(s.a, "whats_due", {});
    expect(due.next).toEqual(['Suggest asking Lena about "sucht einen Hund": its day to ask, 2026-10-01, has come.']);
  });

  test("groups marks Haushalt as the household's own group", async () => {
    const { groups } = await run(s.a, "groups", {});
    expect(groups.filter((g: Json) => g.household).map((g: Json) => g.name)).toEqual(["Haushalt"]);
  });

  test("the read-only tools without anything to follow up answer with an empty next", async () => {
    expect((await run(s.a, "groups", {})).next).toEqual([]);
    expect((await run(s.a, "set_interval", { personId: s.anna, days: 14 })).next).toEqual([]);
    expect((await run(s.a, "get_transcript", { conversationId: s.dinner })).next).toEqual([]);
  });

  test("calendar_feed: an existing feed can't be shown again, so next offers replace", async () => {
    expect((await run(s.a, "calendar_feed", {})).next).toEqual(["Give the URL only to the user: anyone who has it can read these dates. In Google Calendar it goes under \"From URL\", which refreshes every few hours."]);
    expect((await run(s.a, "calendar_feed", {})).next).toEqual([
      "The user already has a feed, whose URL can't be shown again: tell them, and offer replace, which makes a new URL and stops the old one at once.",
    ]);
  });
});

describe("next never shows the other user's private items", () => {
  test("B's briefing and whats_due never ask about A's private situation; B's relate files anew beside A's private relationship", async () => {
    await run(s.a, "remember", { visibility: "private", facts: [{ person: s.anna, text: "heimliche Bewerbung", category: "work", kind: "situation", checkAfter: "2026-10-01" }] });
    expect(JSON.stringify((await run(s.a, "briefing", { personId: s.anna })).next)).toContain("heimliche Bewerbung");
    const seen = JSON.stringify([(await run(s.b, "briefing", { personId: s.anna })).next, (await run(s.b, "whats_due", {})).next]);
    expect(seen).not.toContain("heimliche Bewerbung");
    // A recorded Anna ↔ Tom as private Partner:in; to B it doesn't exist, so B's is new and next says nothing of A's.
    const rel = await run(s.b, "relate", { kind: "relationship", from: s.anna, to: s.tom, label: "Partner:in", inverse: "Partner:in", visibility: "shared" });
    expect(rel.relationships).toEqual([expect.objectContaining({ created: true })]);
    expect(rel.next).toEqual([]);
  });

  test("a merge by B counts only what B may see: A's private birthday of Tom moves, but not into B's count", async () => {
    const merge = await run(s.b, "correct", { action: "merge", id: s.anna, drop: s.tom });
    expect(merge.moved).toEqual({ facts: 0, promises: 0, dates: 0, exchanges: 0, relationships: 0, conversations: 0, groups: 0 });
    expect(merge.next).toEqual(['Merged Tom into Anna: nothing else moved, and "Tom" now finds Anna. Look over Anna\'s briefing for anything doubled and fix it with correct.']);
  });
});

describe("inbox", () => {
  const text = (t: string) => new TextEncoder().encode(t);
  beforeEach(() => vi.stubEnv("DATA_DIR", mkdtempSync(join(tmpdir(), "fb-inbox-"))));
  afterEach(() => vi.unstubAllEnvs());

  test("list shows the caller's waiting files only and says how to work them through", async () => {
    const mine = await shareFile(s.a, text("Patrick: Freitag Spieleabend"), "text/plain");
    await shareFile(s.b, text("Bobs Datei"), "text/plain");
    const r = await run(s.a, "inbox", { action: "list" });
    expect(r.files.map((f: Json) => f.id)).toEqual([mine.id]);
    expect(r.next).toEqual([
      "Work through each file with the user: file what it shows with record, passing its id in fileIds (its transcript is kept, the file goes); if nothing in it is worth filing, inbox done.",
      "Date what you file by when it happened: the day a file was shared (sharedOn) unless it shows another day, never the day it is reviewed.",
    ]);
    expect(r.files[0].sharedOn).toBe(today());
    expect((await run(s.b, "inbox", { action: "list" })).files).toHaveLength(1);
    expect(await run(s.a, "inbox", { action: "list" })).toMatchObject({ files: [expect.objectContaining({ id: mine.id })] });
  });

  test("with more than five waiting, five are shown and next says how many more", async () => {
    for (let i = 0; i < 7; i++) await shareFile(s.a, text(`Datei ${i}`), "text/plain");
    const r = await run(s.a, "inbox", { action: "list" });
    expect(r.files).toHaveLength(5);
    expect(r.next[2]).toBe("2 more wait; list again after these.");
  });

  test("done deletes a file with nothing to file; not the partner's; upload is gone", async () => {
    const one = await shareFile(s.a, text("eins"), "text/plain");
    await expect(run(s.b, "inbox", { action: "done", id: one.id })).rejects.toThrow(/No such file/);
    expect(await run(s.a, "inbox", { action: "done", id: one.id })).toMatchObject({ done: true, next: [] });
    expect((await run(s.a, "inbox", { action: "list" })).files).toEqual([]);
    expect(await fileContent(s.a, one.id)).toBeNull();
    await expect(run(s.a, "inbox", { action: "done" })).rejects.toThrow(/id/);
    await expect(run(s.a, "inbox", { action: "upload" })).rejects.toThrow();
  });

});

test("record names the journal entries it filed, and that they are private", async () => {
  const r = await run(s.a, "record", { date: "2026-10-22", transcript: "Ich frage mich, ob ich den Job wechseln will.", visibility: "shared", people: [], journal: [{ text: "Ich frage mich, ob ich den Job wechseln will." }] });
  expect(r.journal).toEqual([expect.objectContaining({ visibility: "private", url: expect.stringMatching(/^\/tagebuch#journal-/) })]);
  expect(r.next).toContain("The journal entry is private to the user: say so in the read-back.");
});

test("journal hands Claude the entries of a period to interpret, never to diagnose", async () => {
  await run(s.a, "record", { date: "2026-10-20", transcript: "t", visibility: "shared", people: [{ id: s.anna }], journal: [{ text: "Viel Stress im Job.", mentions: [0] }] });
  const r = await run(s.a, "journal", { from: "2026-10-01", to: "2026-10-31" });
  expect(r.entries.map((e: Json) => e.text)).toEqual(["Viel Stress im Job."]);
  expect(r.next).toEqual([
    "Interpret these entries for the user: the themes that come back, what changed over the period, and how the people and conversations they name tie in, quoting entries by their date. Reflect patterns; never diagnose or give health advice, and on heavy themes point gently to real help.",
  ]);
  expect((await run(s.a, "journal", { from: "2026-01-01", to: "2026-01-31" })).next).toEqual(["No journal entries in this period: say so, and offer to look at another one."]);
  expect((await run(s.b, "journal", { from: "2026-10-01", to: "2026-10-31" })).entries).toEqual([]);
});

describe("rambles over MCP (review I3, I4)", () => {
  let s: Seed;
  beforeEach(async () => {
    s = await seed();
  });
  const journalOnly = (v: Seed["a"]) => run(v, "record", { date: today(), transcript: "Nur über mich.", visibility: "shared", people: [], journal: [{ text: "Nur über mich." }] });

  test("get_transcript reads a ramble by its id; share_transcript shares it by its id", async () => {
    const r = await journalOnly(s.a);
    const got = await run(s.a, "get_transcript", { rambleId: r.rambleId });
    expect(got).toMatchObject({ rambleId: r.rambleId, conversationId: null, transcript: "Nur über mich." });
    await run(s.a, "correct", { action: "visibility", table: "journal_entries", id: r.journal[0].id, visibility: "shared" });
    await run(s.a, "correct", { action: "share_transcript", id: r.rambleId });
    expect((await run(s.b, "get_transcript", { rambleId: r.rambleId })).transcript).toBe("Nur über mich.");
  });

  test("correct delete_ramble deletes a ramble and every part of it, for its recorder", async () => {
    const r = await journalOnly(s.a);
    await run(s.a, "correct", { action: "delete_ramble", id: r.rambleId });
    expect((await run(s.a, "journal", {})).entries.map((e: Json) => e.id)).not.toContain(r.journal[0].id);
  });
});

describe("experiences over MCP", () => {
  let s: Seed;
  beforeEach(async () => {
    s = await seed();
  });
  const lived = (v: Seed["a"], date: string, kind: string, title: string, extra: object = {}) =>
    run(v, "record", { date: today(), transcript: title, visibility: "shared", people: [], experiences: [{ date, kind, title, ...extra }] });

  test("record reads back an experience with its day and series", async () => {
    const r = await lived(s.a, "2026-10-28", "Kurs", "Erste Stunde Hundeschule", { place: "Hundeschule Pfotenglück", series: { name: "Hundeschule mit Toffee", rhythmDays: 7 } });
    expect(r.experiences).toHaveLength(1);
    expect(r.next.join(" ")).toContain("Hundeschule mit Toffee");
  });

  test("experiences filters by kind and period and returns the kinds and series in use", async () => {
    await lived(s.a, "2025-03-01", "Konzert", "Beatsteaks");
    await lived(s.a, "2025-11-20", "Konzert", "Wanda");
    await lived(s.a, "2026-02-02", "Konzert", "Seeed");
    await lived(s.a, "2026-10-28", "Kurs", "Hundeschule", { series: { name: "Hundeschule mit Toffee", rhythmDays: 7 } });
    const r = await run(s.a, "experiences", { kind: "konzert", from: "2025-01-01", to: "2025-12-31" });
    expect(r.experiences.map((e: Json) => e.title)).toEqual(["Wanda", "Beatsteaks"]);
    expect(r.kinds).toEqual(expect.arrayContaining(["Konzert", "Kurs"]));
    expect(r.series.map((x: Json) => x.name)).toEqual(["Hundeschule mit Toffee"]);
    expect(r.next.join(" ")).toContain("dates");
  });

  test("places finds a place by another name; correct renames, adds other names and merges", async () => {
    const r = await lived(s.a, "2026-10-28", "Kurs", "Hundeschule", { place: "Pfotenglück" });
    const [p] = (await run(s.a, "places", { name: "Pfotenglück" })).places;
    await run(s.a, "correct", { action: "place_alias", id: p.id, alias: "die Hundeschule" });
    expect((await run(s.a, "places", { name: "die Hundeschule" })).places.map((x: Json) => x.id)).toEqual([p.id]);
    await run(s.a, "correct", { action: "place_rename", id: p.id, name: "Hundeschule Pfotenglück" });
    const other = await lived(s.a, "2026-10-28", "Kurs", "Probestunde", { place: { name: "Hundeschule am See", confirmedNew: true } });
    const [drop] = (await run(s.a, "places", { name: "Hundeschule am See" })).places;
    await run(s.a, "correct", { action: "place_merge", id: p.id, drop: drop.id });
    expect((await run(s.a, "experiences", {})).experiences.every((e: Json) => e.place?.id === p.id)).toBe(true);
    void r;
    void other;
  });
});

describe("series over MCP", () => {
  let s: Seed;
  beforeEach(async () => {
    s = await seed();
  });
  test("correct series_skip marks a day skipped, edit ends a series, and a briefing carries the experiences", async () => {
    const r = await run(s.a, "record", { date: today(), transcript: "t", visibility: "shared", people: [{ id: s.anna }], experiences: [{ date: "2026-10-28", kind: "Kurs", title: "Erste Stunde", present: [0], series: { name: "Hundeschule mit Toffee", rhythmDays: 7 } }] });
    const id = r.experiences[0].seriesId;
    await run(s.a, "correct", { action: "series_skip", id, date: "2026-11-04" });
    await run(s.a, "correct", { action: "edit", table: "series", id, patch: { endsOn: "2026-12-16" } });
    const b = await run(s.a, "briefing", { personId: s.anna });
    expect(b.experiences.map((e: Json) => e.title)).toEqual(["Erste Stunde"]);
  });
});

describe("missed sessions over MCP", () => {
  let s: Seed;
  beforeEach(async () => {
    s = await seed();
  });
  test("whats_due's next asks how a missed session went, or whether it was skipped", async () => {
    const r = await run(s.a, "record", { date: "2026-09-02", transcript: "t", visibility: "shared", people: [], experiences: [{ kind: "Kurs", title: "Erste", series: { name: "Hundeschule mit Toffee", rhythmDays: 7 } }] });
    await (await db()).updateTable("series").set({ created_at: Date.parse("2026-09-02T20:00:00Z") }).where("id", "=", r.experiences[0].seriesId).execute();
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-09-10T09:00:00Z"));
    try {
      const due = await run(s.a, "whats_due", {});
      expect(due.next.join(" ")).toContain('Ask how "Hundeschule mit Toffee" on 2026-09-09 went');
    } finally {
      vi.useRealTimers();
    }
  });
});
