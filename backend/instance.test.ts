import { afterEach, beforeEach, expect, test } from "vitest";
import { createCalendarKey, viewerFromCalendarKey } from "./calendar";
import { recordConversation } from "./conversations";
import { HOME, testDb } from "./db/testing";
import { createShareKey, viewerFromShareKey } from "./files";
import { listGroups } from "./groups";
import { householdPersons } from "./household";
import { createInvite, householdOf, householdOfKey, households, inviteOk, instanceDb } from "./instance";
import { findPeople, listPeople } from "./people";
import { search } from "./search";
import { seed, type Seed } from "./testing/fixtures";
import { userFromOidc, viewerById } from "./users";
import { db, isHouseholdId } from "./db";

const setting = process.env.FREUNDEBUCH_HOUSEHOLDS;
let s: Seed;
beforeEach(async () => {
  delete process.env.FREUNDEBUCH_HOUSEHOLDS;
  s = await seed();
});
afterEach(() => {
  if (setting === undefined) delete process.env.FREUNDEBUCH_HOUSEHOLDS;
  else process.env.FREUNDEBUCH_HOUSEHOLDS = setting;
});
const many = () => (process.env.FREUNDEBUCH_HOUSEHOLDS = "many");

test("with one household, everyone who signs in is in home, as before", async () => {
  expect([s.a.householdId, s.b.householdId]).toEqual([HOME, HOME]);
  const c = await userFromOidc({ sub: "c", name: "Carla" });
  expect(c.householdId).toBe(HOME);
  expect(await householdPersons(await testDb())).toEqual([s.a.personId, s.b.personId, c.personId]);
  await expect(createInvite(s.a)).rejects.toThrow(/one household/);
});

test("with many, a sign-in without an invitation starts a book of its own that sees nothing of another (V1)", async () => {
  many();
  const c = await userFromOidc({ sub: "c", name: "Carla" });
  expect(c.householdId).not.toBe(HOME);
  expect(isHouseholdId(c.householdId)).toBe(true);
  // Not a person, not a name, not a search hit, not a member of "us".
  expect((await listPeople(c)).map((p) => p.name)).toEqual(["Carla"]);
  expect(await findPeople(c, "Anna")).toEqual([]);
  await expect(search(c, "museum")).resolves.toEqual([]);
  expect(await householdPersons(await db(c))).toEqual([c.personId]);
  // Each book has its own seeded groups; the household group holds only its own people.
  const ours = (await listGroups(c)).find((g) => g.household);
  expect(ours?.count).toBe(1);
  // And what Carla files stays in her book.
  await recordConversation(c, {
    date: "2026-10-21",
    kind: "call",
    summary: "Called Anna, another Anna.",
    transcript: "Called Anna.",
    visibility: "shared",
    people: [{ name: "Anna", present: true }],
  });
  expect((await findPeople(s.a, "Anna")).map((p) => p.id)).toEqual([s.anna]);
  expect(await households()).toEqual([HOME, c.householdId]);
});

test("an invitation brings its holder into the household, once, and only within a week", async () => {
  many();
  const { code, expiresAt } = await createInvite(s.a);
  expect(code).toMatch(/^fbi_/);
  expect(expiresAt - Date.now()).toBeGreaterThan(6 * 86_400_000);
  expect(await inviteOk(code)).toBe(true);
  const c = await userFromOidc({ sub: "c", name: "Carla" }, code);
  expect(c.householdId).toBe(HOME);
  expect(await householdPersons(await testDb())).toContain(c.personId);
  expect(await inviteOk(code)).toBe(false);
  await expect(userFromOidc({ sub: "d", name: "Dora" }, code)).rejects.toThrow(/used up or has expired/);
  // An expired one is no better.
  const late = await createInvite(s.a);
  const d = await instanceDb();
  await d
    .updateTable("invites")
    .set({ expires_at: Date.now() - 1 })
    .execute();
  await expect(userFromOidc({ sub: "e", name: "Ella" }, late.code)).rejects.toThrow(/used up or has expired/);
  // Someone already in a household stays where they are; the invitation isn't spent on them.
  const again = await createInvite(s.a);
  await d
    .updateTable("invites")
    .set({ expires_at: Date.now() + 1000 })
    .execute();
  const other = await userFromOidc({ sub: "f", name: "Fritz" });
  expect((await userFromOidc({ sub: "f", name: "Fritz" }, again.code)).householdId).toBe(other.householdId);
  expect(await inviteOk(again.code)).toBe(true);
});

test("a user from before households were kept is found in home and recorded there", async () => {
  many();
  // As an older instance left it: a user in home's book, no account for them yet.
  await (await instanceDb()).deleteFrom("accounts").execute();
  expect(await householdOf(s.a.userId)).toBe(HOME);
  expect(await viewerById(s.a.userId)).toEqual(s.a);
  const again = await userFromOidc({ sub: "a", name: "Alice" });
  expect(again).toEqual(s.a);
  expect((await (await instanceDb()).selectFrom("accounts").select("household_id").where("oidc_sub", "=", "a").executeTakeFirst())?.household_id).toBe(HOME);
});

test("calendar and share keys name their household, and home's keep the old shape", async () => {
  many();
  const c = await userFromOidc({ sub: "c", name: "Carla" });
  const home = await createCalendarKey(s.a);
  expect(home).not.toContain("~");
  expect(await viewerFromCalendarKey(home)).toEqual(s.a);
  const theirs = await createCalendarKey(c);
  expect(theirs.startsWith(`fbc_${c.householdId}~`)).toBe(true);
  expect(await viewerFromCalendarKey(theirs)).toEqual(c);
  expect(await viewerFromShareKey(await createShareKey(c))).toEqual(c);
  // The secret of one household's key, pointed at another, finds no one.
  expect(await viewerFromCalendarKey(`fbc_${c.householdId}~${home.slice(4)}`)).toBeNull();
  expect(householdOfKey("fbc_", "fbc_../../etc~x")).toBeNull();
  expect(householdOfKey("fbc_", "fbs_abc")).toBeNull();
});

test("a household id never names a path of its own", () => {
  expect(isHouseholdId("home")).toBe(true);
  expect(isHouseholdId("../instance")).toBe(false);
  expect(isHouseholdId("")).toBe(false);
  expect(() => db({ householdId: "../x" })).toThrow(/not a household id/);
});
