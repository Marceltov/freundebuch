import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, expect, test } from "vitest";
import { getConversation, record } from "./conversations";
import { getRamble, listRambles } from "./rambles";
import { db } from "./db/testing";
import { InvalidInputError } from "./errors";
import { shareFile } from "./files";
import { seed, type Seed } from "./testing/fixtures";

let s: Seed;
beforeEach(async () => {
  s = await seed();
});

const RAMBLE = "Heute mit Bille in der Hundeschule, Toffee war super. Dann hat Anna angerufen, sie zieht nach Köln. Ich frage mich, ob ich den Job wechseln will.";
const dogSchool = () =>
  record(s.a, {
    date: "2026-10-29",
    transcript: RAMBLE,
    visibility: "shared",
    people: [{ id: s.anna }, { name: "Toffee" }],
    conversations: [{ kind: "call", summary: "Anna hat angerufen: Umzug nach Köln", present: [0] }],
    journal: [{ text: "Ich frage mich, ob ich den Job wechseln will.", mentions: [1] }],
    facts: [{ person: 0, text: "zieht nach Köln", category: "home", in: 0 }],
  });

test("one ramble, split into a conversation, a journal entry and a fact, all told in it", async () => {
  const r = await dogSchool();
  expect(r.conversations).toHaveLength(1);
  expect(r.journal).toEqual([expect.objectContaining({ visibility: "private" })]);
  const d = await db();
  const ramble = await d.selectFrom("rambles").selectAll().where("id", "=", r.rambleId).executeTakeFirstOrThrow();
  expect(ramble).toMatchObject({ transcript: RAMBLE, transcript_private: 1, date: "2026-10-29", recorded_by: s.a.userId });
  const conv = await d.selectFrom("conversations").select(["ramble_id", "date"]).where("id", "=", r.conversations[0].id).executeTakeFirstOrThrow();
  expect(conv).toEqual({ ramble_id: r.rambleId, date: "2026-10-29" });
  const entry = await d.selectFrom("journal_entries").selectAll().where("id", "=", r.journal[0].id).executeTakeFirstOrThrow();
  expect(entry).toMatchObject({ ramble_id: r.rambleId, date: "2026-10-29", text: "Ich frage mich, ob ich den Job wechseln will.", visibility: "private" });
  const mentions = await d.selectFrom("journal_mentions").select("person_id").where("entry_id", "=", entry.id).execute();
  expect(mentions.map((m) => m.person_id)).toEqual([r.people[1].id]);
  const fact = await d.selectFrom("facts").select("conversation_id").where("text", "=", "zieht nach Köln").executeTakeFirstOrThrow();
  expect(fact.conversation_id).toBe(r.conversations[0].id);
});

test("the partner sees the shared conversation, never the journal entry or the transcript", async () => {
  const r = await dogSchool();
  const b = await getConversation(s.b, r.conversations[0].id);
  expect(b.summary).toBe("Anna hat angerufen: Umzug nach Köln");
  expect(b.transcript).toBeNull();
  expect(JSON.stringify(b)).not.toContain("Job");
});

test("a journal entry the user shares is shared; one in a private ramble stays private", async () => {
  const r = await record(s.a, { date: "2026-10-29", transcript: "t", visibility: "shared", people: [], journal: [{ text: "Schöner Tag.", shared: true }] });
  expect(r.journal[0].visibility).toBe("shared");
  const p = await record(s.a, { date: "2026-10-29", transcript: "t", visibility: "private", people: [], journal: [{ text: "Geheim.", shared: true }] });
  expect(p.journal[0].visibility).toBe("private");
});

test("a part that names a conversation or a person that isn't there is refused, and nothing is filed", async () => {
  const before = await (await db()).selectFrom("rambles").select("id").execute();
  await expect(
    record(s.a, { date: "2026-10-29", transcript: "t", visibility: "shared", people: [{ id: s.anna }], facts: [{ person: 0, text: "x", category: "other", in: 2 }] }),
  ).rejects.toThrow(InvalidInputError);
  await expect(record(s.a, { date: "2026-10-29", transcript: "t", visibility: "shared", people: [], journal: [{ text: "x", mentions: [3] }] })).rejects.toThrow(InvalidInputError);
  await expect(record(s.a, { date: "2026-10-29", transcript: "t", visibility: "shared", people: [] })).rejects.toThrow("Nothing to file");
  expect(await (await db()).selectFrom("rambles").select("id").execute()).toEqual(before);
});

test("a shared file's transcript joins the ramble's", async () => {
  process.env.DATA_DIR = mkdtempSync(join(tmpdir(), "fb-ramble-"));
  const file = await shareFile(s.a, new TextEncoder().encode("Patrick: Freitag Spieleabend"), "text/plain");
  await (await db()).updateTable("files").set({ status: "pending", reading: JSON.stringify({ summary: "s", transcript: "Patrick: Freitag Spieleabend", people: [] }) }).where("id", "=", file.id).execute();
  const r = await record(s.a, { date: "2026-10-29", transcript: "Schau mal.", visibility: "shared", fileIds: [file.id], people: [], journal: [{ text: "Gruppe plant Spieleabend.", shared: true }] });
  const ramble = await (await db()).selectFrom("rambles").select("transcript").where("id", "=", r.rambleId).executeTakeFirstOrThrow();
  expect(ramble.transcript).toBe("Schau mal.\n\n--- Aus einer geteilten Datei ---\nPatrick: Freitag Spieleabend");
});

test("deleting a ramble's last conversation keeps the ramble while a journal entry is told in it", async () => {
  const { deleteItem } = await import("./corrections");
  const r = await dogSchool();
  await deleteItem(s.a, "conversations", r.conversations[0].id);
  expect(await (await db()).selectFrom("rambles").select("id").where("id", "=", r.rambleId).execute()).toHaveLength(1);
  expect(await (await db()).selectFrom("journal_entries").select("id").where("ramble_id", "=", r.rambleId).execute()).toHaveLength(1);
});

test("listRambles: the recorder sees the ramble with its conversation and its entry; the partner only the conversation", async () => {
  const r = await dogSchool();
  const mine = (await listRambles(s.a)).find((x) => x.id === r.rambleId)!;
  expect(mine).toMatchObject({ id: r.rambleId, url: `/r/${r.rambleId}` });
  expect(mine.conversations.map((c) => c.id)).toEqual([r.conversations[0].id]);
  expect(mine.journal.map((j) => j.id)).toEqual([r.journal[0].id]);
  const theirs = (await listRambles(s.b)).find((x) => x.id === r.rambleId)!;
  expect(theirs.conversations.map((c) => c.id)).toEqual([r.conversations[0].id]);
  expect(theirs.journal).toEqual([]);
  expect(JSON.stringify(await listRambles(s.b))).not.toContain("Job");
});

test("a ramble with only a private journal entry doesn't exist for the partner", async () => {
  const r = await record(s.a, { date: "2026-10-29", transcript: "Mir geht es nicht gut.", visibility: "shared", people: [], journal: [{ text: "Mir geht es nicht gut." }] });
  expect((await listRambles(s.b)).map((x) => x.id)).not.toContain(r.rambleId);
  await expect(getRamble(s.b, r.rambleId)).rejects.toThrow(/No such ramble/);
  const mine = await getRamble(s.a, r.rambleId);
  expect(mine).toMatchObject({ transcript: "Mir geht es nicht gut.", journal: [expect.objectContaining({ text: "Mir geht es nicht gut." })] });
});

test("getRamble: the partner gets the shared conversation, no transcript while it is private", async () => {
  const r = await dogSchool();
  const b = await getRamble(s.b, r.rambleId);
  expect(b.transcript).toBeNull();
  expect(b.conversations).toHaveLength(1);
  expect(b.journal).toEqual([]);
});
