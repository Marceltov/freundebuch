// One household, recorded through the real write path, for the privacy tests of every read function. Alice (A) records a shared
// dinner with Anna that holds private parts, and a private coffee with Lena; Bob (B) records a shared call with Anna.
import { resetDbForTests } from "../db/testing";
import { recordConversation } from "../conversations/conversations";
import { userFromOidc, viewerById } from "../core/users";
import { instance } from "../db/scope";
import { createBook } from "../people/books";
import type { Viewer } from "../core/types";

export type Seed = {
  a: Viewer;
  b: Viewer;
  anna: string;
  tom: string;
  lena: string;
  /** A's shared dinner with Anna: the "new job" fact is shared; the divorce, Anna ↔ Tom and Tom's birthday are private. */
  dinner: string;
  /** A's private coffee with Lena, who was first mentioned there. */
  coffee: string;
  /** B's shared call with Anna. */
  call: string;
};

export const DINNER_TRANSCRIPT =
  "Dinner with Anna at Luigi's. She starts a new job at the museum next month. In confidence: she and Tom are getting divorced. Tom's birthday is on 24 October.";

/** Signs a second user in through an admin invitation to `into`'s book, as the household's partner joins it. */
export async function signInInvited(into: Viewer, c: { sub: string; name: string; email?: string }): Promise<Viewer> {
  const { invite } = await import("../people/invitations");
  const { url } = await invite(into, "admin");
  return userFromOidc(c, { invitation: url.split("/").pop() });
}

/** Resets the database and records the fixture. */
export async function seed(): Promise<Seed> {
  await resetDbForTests();
  const a = await userFromOidc({ sub: "a", name: "Alice" });
  const b = await signInInvited(a, { sub: "b", name: "Bob" });
  const dinner = await recordConversation(a, {
    date: "2026-10-20",
    kind: "in_person",
    place: "Luigi's",
    summary: "Dinner with Anna; she has a new job.",
    transcript: DINNER_TRANSCRIPT,
    visibility: "shared",
    people: [
      { name: "Anna", present: true },
      { name: "Tom", present: false },
    ],
    facts: [
      { person: 0, text: "new job", category: "work" },
      { person: 0, text: "divorce", category: "family", private: true },
    ],
    relationships: [{ from: 0, to: 1, label: "Partner:in", inverse: "Partner:in", private: true }],
    dates: [{ person: 1, kind: "birthday", date: "--10-24", yearly: true, private: true }],
  });
  const [anna, tom] = dinner.people.map((p) => p.id);
  const coffee = await recordConversation(a, {
    date: "2026-10-18",
    kind: "in_person",
    summary: "Coffee with Lena.",
    transcript: "Coffee with Lena, she is thinking about quitting.",
    visibility: "private",
    people: [{ name: "Lena", present: true }],
    facts: [{ person: 0, text: "thinking about quitting", category: "work" }],
  });
  const call = await recordConversation(b, {
    date: "2026-10-15",
    kind: "call",
    summary: "Called Anna about the weekend.",
    transcript: "Called Anna, we talked about hiking on the weekend.",
    visibility: "shared",
    people: [{ id: anna, present: true }],
    facts: [{ person: 0, text: "likes hiking", category: "hobby" }],
  });
  return { a, b, anna, tom, lena: coffee.people[0].id, dinner: dinner.conversationId, coffee: coffee.conversationId, call: call.conversationId };
}

/** A second book on the same instance: Carol's own, with a shared call with Carl. Nothing of it may reach the first book. */
export async function seedOtherBook(): Promise<{ c: Viewer; carl: string; carlCall: string }> {
  const i = await instance();
  await i.insert("users", { id: "carol", oidc_sub: "c", name: "Carol", email: null, created_at: Date.now() }).execute();
  const c = await createBook(i, "carol", "Carol", "Carols Buch");
  const call = await recordConversation(c, {
    date: "2026-10-16",
    kind: "call",
    summary: "Called Carl about the museum.",
    transcript: "Called Carl, he wants to visit the museum where Anna works.",
    visibility: "shared",
    people: [
      { name: "Carl", present: true },
      { name: "Anna", present: false },
    ],
    facts: [{ person: 0, text: "loves museums", category: "hobby" }],
  });
  return { c, carl: call.people[0].id, carlCall: call.conversationId };
}

/** Alice's own work book, Arbeit, next to the household's: a second Lena and her boss, each with a shared fact. `a` reads both books. */
export async function seedWorkBook(s: Seed): Promise<{ a: Viewer; work: Viewer; lena2: string; boss: string }> {
  const work = await createBook(await instance(), s.a.userId, "Alice", "Arbeit");
  const call = await recordConversation(work, {
    date: "2026-10-21",
    kind: "call",
    summary: "Planning call with Lena and the boss.",
    transcript: "Call with Lena and Chefin about the launch.",
    visibility: "shared",
    people: [
      { name: "Lena", present: true },
      { name: "Chefin", present: true },
    ],
    facts: [
      { person: 0, text: "leads the launch", category: "work" },
      { person: 1, text: "wants weekly updates", category: "work" },
    ],
  });
  const [lena2, boss] = call.people.map((p) => p.id);
  return { a: (await viewerById(s.a.userId))!, work, lena2, boss };
}

/** A conversation in the shape record_conversation took, as the ramble record files it: one conversation, everything in it. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function asRamble(c: any): any {
  const { kind, place, summary, people, facts, promises, dates, exchanges, relationships, groups, ...rest } = c;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const inIt = (xs: any[] | undefined) => xs?.map((x) => ({ ...x, in: 0 }));
  return {
    ...rest,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unused-vars
    people: people.map(({ present, ...p }: any) => p),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    conversations: [{ kind, place, summary, present: people.flatMap((p: any, i: number) => (p.present ? [i] : [])) }],
    facts: inIt(facts),
    promises: inIt(promises),
    dates: inIt(dates),
    exchanges: inIt(exchanges),
    relationships: inIt(relationships),
    groups: inIt(groups),
  };
}
