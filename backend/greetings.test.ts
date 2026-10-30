import { beforeEach, expect, test } from "vitest";
import { recordConversation } from "./conversations";
import { birthdayMessage, sendLinks } from "./greetings";
import { toolByName } from "./tools";
import { seed, type Seed } from "./testing/fixtures";

let s: Seed;
beforeEach(async () => {
  s = await seed();
  await recordConversation(s.a, {
    date: "2026-10-21",
    kind: "call",
    summary: "Anna's birthday plans.",
    transcript: "Anna turns 40 on 3 November. Her knee surgery went well.",
    visibility: "shared",
    people: [{ id: s.anna, present: true }],
    facts: [{ person: 0, text: "knee surgery", category: "health" }],
    dates: [{ person: 0, kind: "birthday", date: "1986-11-03", yearly: true }],
  });
});

test("a draft draws only on what is shared about the person, never their health", async () => {
  const m = await birthdayMessage(s.a, s.anna, undefined, "2026-10-31");
  expect(m.birthday).toEqual({ date: "2026-11-03", inDays: 3, age: 40 });
  expect(m.known).toEqual(expect.arrayContaining(["new job", "likes hiking"]));
  // Alice's own private "divorce" is hers to know, not to put in a message; the health fact is shared but not for wishes.
  expect([...m.known, ...m.news]).not.toContain("divorce");
  expect([...m.known, ...m.news]).not.toContain("knee surgery");
  expect(m.send).toEqual([]);
  // Bob sees the same, and never Alice's private items.
  expect((await birthdayMessage(s.b, s.anna, undefined, "2026-10-31")).known).not.toContain("divorce");
});

test("with the final text, links that only fill it in", async () => {
  const m = await birthdayMessage(s.a, s.anna, "Alles Gute zum 40., Anna! 🎉", "2026-10-31");
  const by = Object.fromEntries(m.send.map((l) => [l.app, l.url]));
  expect(Object.keys(by)).toEqual(["whatsapp", "telegram", "sms", "email"]);
  expect(by.whatsapp).toBe(`https://wa.me/?text=${encodeURIComponent("Alles Gute zum 40., Anna! 🎉")}`);
  expect(sendLinks("a&b").every((l) => !l.url.includes("a&b"))).toBe(true);
  await expect(birthdayMessage(s.a, s.anna, "  ")).rejects.toThrow(/empty/);
  await expect(birthdayMessage(s.a, s.anna, "x".repeat(2001))).rejects.toThrow(/longer/);
});

test("the tool says to draft, and with no birthday filed, to ask for it first", async () => {
  const tool = toolByName("birthday_message")!;
  const drafting = (await tool.run(s.a, { personId: s.anna })) as { next: string[] };
  expect(drafting.next[0]).toMatch(/^Draft a short birthday message from the user to Anna, .* who turns 40/);
  const none = (await tool.run(s.a, { personId: s.lena })) as { next: string[]; birthday: null };
  expect(none.birthday).toBeNull();
  expect(none.next[0]).toMatch(/No birthday is filed for Lena/);
  const final = (await tool.run(s.a, { personId: s.anna, text: "Alles Gute!" })) as { next: string[]; send: unknown[] };
  expect(final.send).toHaveLength(4);
  expect(final.next[0]).toMatch(/nothing is sent until they do/);
});
