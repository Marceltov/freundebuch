import { beforeEach, expect, test } from "vitest";
import { record, recordConversation } from "../conversations/conversations";
import { editItem, markOutdated, mergePeople, skipSession } from "../conversations/corrections";
import { NotFoundError } from "../core/errors";
import type { Viewer } from "../core/types";
import { unchecked } from "../db/testing";
import { getPerson } from "../people/people";
import { lastSeen, setCheckInInterval, suggestInterval } from "../people/intervals";
import { movePeople } from "../people/moves";
import { seed, seedWorkBook, type Seed } from "../testing/fixtures";
import { whatsDue } from "./due";
import { addFollowUp, closeAsContact, openFollowUps } from "./followups";

let s: Seed;
beforeEach(async () => {
  s = await seed();
});

const call = (v: Viewer, date: string, over: Partial<Parameters<typeof recordConversation>[1]> = {}) =>
  recordConversation(v, { date, kind: "call", summary: "s", transcript: "t", visibility: "shared", people: [{ id: s.anna, present: true }], ...over });

const situation = async (text: string, checkAfter = "2026-11-01") =>
  (await call(s.a, "2026-10-21", { facts: [{ person: 0, text, category: "home", kind: "situation", checkAfter }] })).filed.facts[0].id;

test("follow-up hides the overdue person until a conversation is filed", async () => {
  await setCheckInInterval(s.a, s.anna, 7, true);
  expect((await whatsDue(s.a, "2026-10-30")).map((i) => i.kind)).toEqual(["overdue"]);
  const id = await addFollowUp(s.a, { kind: "overdue", personId: s.anna, day: "2026-10-30" });
  expect(await whatsDue(s.a, "2026-10-30")).toEqual([]);
  expect(await openFollowUps(s.a)).toEqual([
    { id, kind: "overdue", personId: s.anna, name: "Anna", factId: null, seriesId: null, sessionDay: null, day: "2026-10-30", text: null, url: `/p/${s.anna}` },
  ]);
  expect(await openFollowUps(s.a, s.tom)).toEqual([]);
  // A conversation from before the tick leaves it open; one on the ticked day closes it.
  await call(s.a, "2026-10-25");
  expect(await openFollowUps(s.a)).toHaveLength(1);
  await call(s.a, "2026-10-30");
  expect(await openFollowUps(s.a)).toEqual([]);
});

test("situation follow-up stays open until the checkAfter moves or the fact ends", async () => {
  const house = await situation("sucht ein Haus");
  const id = await addFollowUp(s.a, { kind: "situation", personId: s.anna, factId: house, day: "2026-11-02" });
  expect((await whatsDue(s.a, "2026-11-02")).filter((i) => i.kind === "situation")).toEqual([]);
  expect(await openFollowUps(s.a, s.anna)).toEqual([
    expect.objectContaining({ id, kind: "situation", factId: house, text: "sucht ein Haus", url: `/p/${s.anna}#facts-${house}` }),
  ]);
  await editItem(s.a, "facts", house, { checkAfter: "2026-12-01" });
  expect(await openFollowUps(s.a)).toEqual([]);
  // Once the new checkAfter has come, the situation nudges again.
  expect((await whatsDue(s.a, "2026-12-02")).filter((i) => i.kind === "situation")).toHaveLength(1);

  const car = await situation("sucht ein Auto");
  await addFollowUp(s.a, { kind: "situation", personId: s.anna, factId: car, day: "2026-11-02" });
  expect(await openFollowUps(s.a)).toHaveLength(1);
  await markOutdated(s.a, car);
  expect(await openFollowUps(s.a)).toEqual([]);
});

test("session follow-up closes when the session is skipped", async () => {
  const r = await record(s.a, {
    date: "2026-09-02",
    transcript: "t",
    visibility: "shared",
    people: [{ id: s.anna }],
    experiences: [{ kind: "Kurs", title: "Erste Stunde", present: [0], series: { name: "Hundeschule", rhythmDays: 7 } }],
  });
  const series = r.experiences[0].seriesId!;
  await unchecked()
    .updateTable("series")
    .set({ created_at: Date.parse("2026-09-02T20:00:00Z") })
    .where("id", "=", series)
    .execute();
  expect((await whatsDue(s.a, "2026-09-10")).map((i) => i.kind)).toEqual(["session"]);
  const id = await addFollowUp(s.a, { kind: "session", personId: s.a.personId, seriesId: series, sessionDay: "2026-09-09", day: "2026-09-10" });
  expect(await whatsDue(s.a, "2026-09-10")).toEqual([]);
  expect(await openFollowUps(s.a)).toEqual([
    expect.objectContaining({ id, kind: "session", name: "Hundeschule", seriesId: series, sessionDay: "2026-09-09", url: `/s/${series}` }),
  ]);
  await skipSession(s.a, series, "2026-09-09");
  expect(await openFollowUps(s.a)).toEqual([]);
});

test("closeAsContact moves lastSeen to the ticked day and suggestInterval is unchanged", async () => {
  await call(s.a, "2026-10-06");
  expect(await suggestInterval(s.a, s.anna)).toBeNull(); // two conversations: too few to suggest one
  const id = await addFollowUp(s.a, { kind: "overdue", personId: s.anna, day: "2026-10-30" });
  await closeAsContact(s.a, id);
  expect(await lastSeen(s.a, s.anna)).toBe("2026-10-30");
  expect(await suggestInterval(s.a, s.anna)).toBeNull();
  expect(await openFollowUps(s.a)).toEqual([]);
  // The partner's last seen stays theirs.
  expect(await lastSeen(s.b, s.anna)).toBe("2026-10-15");
});

test("contact after the checkAfter moved still counts for lastSeen", async () => {
  const house = await situation("sucht ein Haus");
  const id = await addFollowUp(s.a, { kind: "situation", personId: s.anna, factId: house, day: "2026-11-02" });
  await editItem(s.a, "facts", house, { checkAfter: "2026-12-01" });
  expect(await openFollowUps(s.a)).toEqual([]); // closed by the new checkAfter
  await closeAsContact(s.a, id);
  expect(await lastSeen(s.a, s.anna)).toBe("2026-11-02");
});

test("partner never sees a follow-up", async () => {
  await setCheckInInterval(s.a, s.anna, 7, true);
  await setCheckInInterval(s.b, s.anna, 7, true);
  const id = await addFollowUp(s.a, { kind: "overdue", personId: s.anna, day: "2026-10-30" });
  expect(await openFollowUps(s.b)).toEqual([]);
  expect(await openFollowUps(s.b, s.anna)).toEqual([]);
  expect(await whatsDue(s.b, "2026-10-30")).toEqual([expect.objectContaining({ kind: "overdue", personId: s.anna })]);
  await expect(closeAsContact(s.b, id)).rejects.toThrow(NotFoundError);
  await expect(closeAsContact(s.a, "no-such-id")).rejects.toThrow(NotFoundError);
  // A's contact doesn't move B's last seen.
  await closeAsContact(s.a, id);
  expect(await lastSeen(s.b, s.anna)).toBe("2026-10-15");
});

test("addFollowUp twice keeps one open row", async () => {
  const first = await addFollowUp(s.a, { kind: "overdue", personId: s.anna, day: "2026-10-30" });
  const second = await addFollowUp(s.a, { kind: "overdue", personId: s.anna, day: "2026-10-31" });
  expect(second).toBe(first);
  expect(await openFollowUps(s.a)).toEqual([expect.objectContaining({ id: first, day: "2026-10-30" })]);
  // Once that one is closed, the next tick opens a new one.
  await closeAsContact(s.a, first);
  const third = await addFollowUp(s.a, { kind: "overdue", personId: s.anna, day: "2026-11-03" });
  expect(third).not.toBe(first);
});

test("a merge keeps the follow-ups on the person kept; a move takes them with the person", async () => {
  const id = await addFollowUp(s.a, { kind: "overdue", personId: s.tom, day: "2026-10-30" });
  await closeAsContact(s.a, id);
  await mergePeople(s.a, s.anna, s.tom);
  expect(await lastSeen(s.a, s.anna)).toBe("2026-10-30");

  const w = await seedWorkBook(s);
  await addFollowUp(s.a, { kind: "overdue", personId: s.lena, day: "2026-10-30" });
  await movePeople(w.a, [s.lena], "Arbeit");
  await expect(getPerson(s.a, s.lena)).rejects.toThrow(NotFoundError);
  expect(await openFollowUps(w.a)).toEqual([]);
});
