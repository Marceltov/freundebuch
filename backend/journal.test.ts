import { beforeEach, expect, test } from "vitest";
import { briefing } from "./briefing";
import { deleteItem, editItem, setVisibility } from "./corrections";
import { record } from "./conversations";
import { journalEntries } from "./journal";
import { seed, type Seed } from "./testing/fixtures";

let s: Seed;
beforeEach(async () => {
  s = await seed();
});

const write = (v: Seed["a"], date: string, text: string, mentions: string[] = [], shared = false) =>
  record(v, { date, transcript: text, visibility: "shared", people: mentions.map((id) => ({ id })), journal: [{ text, mentions: mentions.map((_, i) => i), shared }] });

test("the journal lists the viewer's own entries in a period, newest first, with the people they name", async () => {
  await write(s.a, "2026-09-01", "Alter Gedanke");
  await write(s.a, "2026-10-20", "Ich frage mich, ob ich den Job wechseln will.", [s.anna]);
  await write(s.a, "2026-10-25", "Gute Woche.");
  const got = await journalEntries(s.a, { from: "2026-10-01", to: "2026-10-31" });
  expect(got.map((e) => e.text)).toEqual(["Gute Woche.", "Ich frage mich, ob ich den Job wechseln will."]);
  expect(got[1]).toMatchObject({ date: "2026-10-20", visibility: "private", people: [{ id: s.anna, name: "Anna", url: `/p/${s.anna}` }], url: expect.stringMatching(/^\/tagebuch#journal-/) });
  expect((await journalEntries(s.a, { from: "2026-10-01", to: "2026-10-31", personId: s.anna })).map((e) => e.text)).toEqual(["Ich frage mich, ob ich den Job wechseln will."]);
});

test("the partner never sees a private entry: not in the journal, not in a briefing; a shared one they do", async () => {
  await write(s.a, "2026-10-20", "Geheimer Gedanke über Anna", [s.anna]);
  await write(s.a, "2026-10-21", "Geteilter Gedanke über Anna", [s.anna], true);
  expect((await journalEntries(s.b, { from: "2026-10-01", to: "2026-10-31" })).map((e) => e.text)).toEqual(["Geteilter Gedanke über Anna"]);
  const b = await briefing(s.b, s.anna, "2026-10-25");
  expect(JSON.stringify(b)).not.toContain("Geheimer");
  expect(b.journal).toEqual([]);
  const a = await briefing(s.a, s.anna, "2026-10-25");
  expect(a.journal.map((e) => e.text)).toEqual(["Geteilter Gedanke über Anna", "Geheimer Gedanke über Anna"]);
});

test("an entry is edited, shared and deleted with correct", async () => {
  const r = await write(s.a, "2026-10-20", "Erster Gedanke");
  const id = r.journal[0].id;
  await editItem(s.a, "journal_entries", id, { text: "Zweiter Gedanke" });
  await setVisibility(s.a, "journal_entries", id, "shared");
  expect((await journalEntries(s.b, { from: "2026-10-01", to: "2026-10-31" })).map((e) => e.text)).toEqual(["Zweiter Gedanke"]);
  await deleteItem(s.a, "journal_entries", id);
  expect(await journalEntries(s.a, { from: "2026-10-01", to: "2026-10-31" })).toEqual([]);
});
